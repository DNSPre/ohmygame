import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeAuth, probeModels, resolveBinary } from "./agent-runtimes/discovery.js";
import { agentEnvironment } from "./agent-runtimes/environment.js";
import type { AgentRuntimeId } from "../shared/agent-runtimes.js";
import type { AgentModel } from "../shared/contracts.js";

const runtimeIds = { codex: "codex-cli", "claude-code": "claude-code-cli", opencode: "opencode-cli" } as const;
export type GuestAgentId = keyof typeof runtimeIds;
interface AgentInfo { installed: boolean; auth: string; models: { id: string; name: string; effort?: string[] }[]; error?: string }
interface ModelMessage { role: string; content: string }
interface NativeContext { binary: string; environment: Record<string, string>; directory: string }

function agentId(value: unknown): value is GuestAgentId {
  return typeof value === "string" && Object.hasOwn(runtimeIds, value);
}

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // Command-line clients still need the pairing token.
  if (origin === "https://game.design.cab") return true;
  try { const url = new URL(origin); return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname); }
  catch { return false; }
}

async function context(id: GuestAgentId, directory: string): Promise<NativeContext | undefined> {
  const runtime = runtimeIds[id] as AgentRuntimeId;
  const binary = await resolveBinary(runtime);
  if (!binary) return undefined;
  return { binary: binary.path, environment: agentEnvironment(runtime, binary.path), directory };
}

export async function discoverGuestAgent(id: GuestAgentId, directory: string): Promise<AgentInfo> {
  const native = await context(id, directory);
  if (!native) return { installed: false, auth: "unknown", models: [] };
  const runtime = runtimeIds[id];
  const auth = await probeAuth(native.binary, runtime, native.environment);
  try {
    const result = await probeModels(native.binary, runtime, native.environment, directory);
    return { installed: true, auth: auth.status, models: result.models.map((model: AgentModel) => ({ id: model.id, name: model.name, effort: model.nativeReasoningLevels ?? [] })) };
  } catch {
    // Do not return CLI output: it can include account details and local paths.
    return { installed: true, auth: auth.status, models: [], error: "models-unavailable" };
  }
}

export async function runGuestAgent(id: GuestAgentId, model: string, messages: ModelMessage[], directory: string, signal: AbortSignal, effort?: string): Promise<string> {
  const native = await context(id, directory);
  if (!native) throw new Error("agent-not-installed");
  const prompt = messages.map(message => `${message.role.toUpperCase()}\n${message.content}`).join("\n\n");
  const outputFile = path.join(directory, "result.txt");
  let args: string[];
  if (id === "codex") {
    args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--json", "--model", model, "--output-last-message", outputFile, "-"];
  } else if (id === "claude-code") {
    args = ["-p", "--output-format", "json", "--model", model, "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands", "--no-session-persistence", "--no-chrome", "--setting-sources", "user"];
  } else {
    args = ["run", "--pure", "--format", "json", "--model", model];
    native.environment.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { "*": "deny" } });
  }
  if (effort) {
    if (!/^[a-z-]{1,20}$/.test(effort)) throw new Error("agent-invalid-effort");
    if (id === "codex") args.splice(args.length - 1, 0, "--config", "model_reasoning_effort=" + JSON.stringify(effort));
    else args.push(id === "claude-code" ? "--effort" : "--variant", effort);
  }
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(native.binary, args, { cwd: directory, env: native.environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
    let stdout = "";
    let finished = false;
    const stop = () => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* Already stopped. */ }
    };
    const finish = (error?: Error) => {
      if (finished) return; finished = true;
      signal.removeEventListener("abort", abort);
      if (error) { stop(); reject(error); } else resolve(stdout);
    };
    const abort = () => finish(new Error("agent-cancelled"));
    child.on("error", () => finish(new Error("agent-start-failed")));
    child.stdout.on("data", data => { stdout += data.toString(); if (stdout.length > 8_000_000) finish(new Error("agent-output-too-large")); });
    child.stderr.resume();
    child.on("close", code => finish(code === 0 ? undefined : new Error("agent-generation-failed")));
    child.stdin.on("error", () => undefined);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    child.stdin.end(prompt);
  });
  if (id === "codex") return readFile(outputFile, "utf8");
  if (id === "claude-code") {
    const result = JSON.parse(output);
    if (result.is_error || typeof result.result !== "string") throw new Error("agent-generation-failed");
    return result.result;
  }
  const text = output.split("\n").flatMap(line => {
    try { const event = JSON.parse(line); return event.type === "text" && typeof event.part?.text === "string" ? [event.part.text] : []; }
    catch { return []; }
  }).join("\n");
  if (!text) throw new Error("agent-generation-failed");
  return text;
}

interface BridgeOptions {
  port?: number;
  token?: string;
  discover?: typeof discoverGuestAgent;
  generate?: typeof runGuestAgent;
}

export async function startGuestAgentBridge(options: BridgeOptions = {}) {
  const token = options.token ?? randomBytes(32).toString("hex");
  const directory = await mkdtemp(path.join(tmpdir(), "must-agent-bridge-"));
  const discover = options.discover ?? discoverGuestAgent;
  const generate = options.generate ?? runGuestAgent;
  const cache = new Map<GuestAgentId, { value: AgentInfo; at: number }>();
  const scans = new Map<GuestAgentId, Promise<AgentInfo>>();
  let busy = false;
  const jobs = new Set<AbortController>();

  function json(response: ServerResponse, status: number, value: object) {
    if (response.destroyed) return;
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(JSON.stringify(value));
  }
  async function readBody(request: IncomingMessage) {
    let body = "";
    for await (const chunk of request) {
      body += chunk.toString();
      if (body.length > 2_000_000) throw new Error("request-too-large");
    }
    return JSON.parse(body);
  }
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const host = request.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !originAllowed(origin)) { json(response, 403, { error: "origin-denied" }); return; }
    if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Private-Network": "true" });
      response.end(); return;
    }
    const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer /, "") ?? "");
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { json(response, 401, { error: "pairing-required" }); return; }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const match = /^\/agents\/(codex|claude-code|opencode)\/models$/.exec(pathname);
    try {
      if (request.method === "GET" && match && agentId(match[1])) {
        const id = match[1];
        const cached = cache.get(id);
        let value = cached && Date.now() - cached.at < 30000 ? cached.value : undefined;
        if (!value) {
          let scan = scans.get(id);
          if (!scan) {
            scan = (async () => {
              const folder = await mkdtemp(path.join(directory, "probe-"));
              try { const result = await discover(id, folder); cache.set(id, { value: result, at: Date.now() }); return result; }
              finally { await rm(folder, { recursive: true, force: true }); scans.delete(id); }
            })();
            scans.set(id, scan);
          }
          value = await scan;
        }
        json(response, 200, value); return;
      }
      if (request.method === "POST" && pathname === "/agents/generate") {
        if (busy) { json(response, 409, { error: "agent-busy" }); return; }
        busy = true;
        const controller = new AbortController();
        jobs.add(controller);
        const stop = () => { if (!response.writableEnded) controller.abort(); };
        request.once("aborted", stop); response.once("close", stop);
        let folder: string | undefined;
        const timer = setTimeout(() => controller.abort(), 300000);
        try {
          const body = await readBody(request);
          if (!agentId(body.agent) || typeof body.model !== "string" || !body.model.trim() || body.model.length > 200 || !Array.isArray(body.messages) || body.messages.length > 12 || body.messages.length === 0 || body.messages.some((message: ModelMessage) => !message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string")) {
            json(response, 400, { error: "invalid-request" }); return;
          }
          folder = await mkdtemp(path.join(directory, "generation-"));
          if (body.effort !== undefined && (typeof body.effort !== "string" || !/^[a-z-]{1,20}$/.test(body.effort))) { json(response, 400, { error: "invalid-request" }); return; }
          const content = await generate(body.agent, body.model, body.messages, folder, controller.signal, body.effort);
          json(response, 200, { content });
        } finally {
          clearTimeout(timer); jobs.delete(controller); request.removeListener("aborted", stop); response.removeListener("close", stop);
          if (folder) await rm(folder, { recursive: true, force: true });
          busy = false;
        }
        return;
      }
      json(response, 404, { error: "not-found" });
    } catch (error) {
      const code = error instanceof Error && /^agent-[a-z-]+$/.test(error.message) ? error.message : "bridge-request-failed";
      json(response, 502, { error: code });
    }
  });
  server.requestTimeout = 320000;
  server.headersTimeout = 15000;
  try { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 11435, "127.0.0.1", () => resolve()); }); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bridge-start-failed");
  return { token, port: address.port, server, async close() {
    for (const job of jobs) job.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const bridge = await startGuestAgentBridge();
    console.log("澳門科技大學 · 本機智能體連接器\nLocal agent connector is ready on 127.0.0.1:" + bridge.port);
    console.log("在瀏覽器開啟下方連結配對 / Open this link to pair:\nhttps://game.design.cab/#/settings/providers?bridge=" + bridge.token + "&agent=codex");
    console.log("帳號登入由你電腦上的 CLI 管理。按 Ctrl+C 停止連接。\nYour CLI manages account sign-in. Press Ctrl+C to disconnect.");
    const stop = () => { void bridge.close().finally(() => process.exit(0)); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  } catch { console.error("無法啟動連接器。請確認 Node.js 22 以上及 11435 埠未被佔用。\nCould not start. Use Node.js 22+ and check that port 11435 is free."); process.exitCode = 1; }
}
