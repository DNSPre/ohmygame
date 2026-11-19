import { createRequire as __createGuestRequire } from "node:module"; const require = __createGuestRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/daemon/guest-agent-bridge.ts
import { createServer } from "node:http";
import { randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";
import { spawn as spawn3 } from "node:child_process";
import { mkdtemp, readFile as readFile2, rm as rm3 } from "node:fs/promises";
import { tmpdir } from "node:os";
import path8 from "node:path";
import { fileURLToPath } from "node:url";

// src/daemon/agent-runtimes/discovery.ts
import { execFile as execFile3 } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  constants,
  mkdir as mkdir3,
  readdir as readdir3,
  realpath as realpath2,
  rm as rm2,
  stat
} from "node:fs/promises";
import os3 from "node:os";
import path7 from "node:path";

// src/daemon/agent-runtimes/definitions.ts
import { existsSync } from "node:fs";
import path from "node:path";
var AGENT_RUNTIME_DEFINITIONS = {
  "claude-code-cli": {
    id: "claude-code-cli",
    name: "Claude Code",
    binaries: ["claude"],
    versionArgs: ["--version"],
    testedVersion: "2.1.302",
    loginCommand: "claude auth login",
    installUrl: "https://docs.anthropic.com/en/docs/claude-code/setup"
  },
  "codex-cli": {
    id: "codex-cli",
    name: "Codex",
    binaries: ["codex"],
    bundledPaths: {
      darwin: ["/Applications", "~/Applications"].flatMap(
        (directory) => [
          { app: "Codex", source: "codex-app" },
          { app: "ChatGPT", source: "chatgpt-app" }
        ].map(({ app, source }) => ({
          path: `${directory}/${app}.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`,
          source
        }))
      )
    },
    versionArgs: ["--version"],
    testedVersion: "0.163.0",
    loginCommand: "codex login",
    installUrl: "https://developers.openai.com/codex/cli"
  },
  "opencode-cli": {
    id: "opencode-cli",
    name: "OpenCode",
    binaries: ["opencode"],
    versionArgs: ["--version"],
    testedVersion: "2.1.0",
    loginCommand: "opencode auth login",
    installUrl: "https://opencode.ai/v2/docs/"
  }
};
function commandSandbox(id, platform = process.platform, onPath = programOnPath) {
  if (id === "opencode-cli") return "none";
  if (platform === "darwin") return "os";
  if (platform !== "linux") return "none";
  return id === "codex-cli" || onPath("bwrap") && onPath("socat") ? "os" : "none";
}
function programOnPath(program) {
  return (process.env.PATH ?? "").split(path.delimiter).some((folder) => !!folder && existsSync(path.join(folder, program)));
}
function parseVersion(output) {
  return output.match(
    /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/
  )?.[0];
}
function compareVersions(a, b) {
  const parts = (value) => {
    const [core, ...prereleaseParts] = value.split("+", 1)[0].split("-");
    const prerelease = prereleaseParts.join("-") || void 0;
    return {
      core: core.split(".").map(BigInt),
      prerelease: prerelease?.split(".")
    };
  };
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 3; i++) {
    const x = left.core[i] ?? 0n, y = right.core[i] ?? 0n;
    if (x !== y) return x > y ? 1 : -1;
  }
  if (!left.prerelease || !right.prerelease)
    return left.prerelease ? -1 : right.prerelease ? 1 : 0;
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const x = left.prerelease[i], y = right.prerelease[i];
    if (x === y) continue;
    if (x === void 0 || y === void 0) return x === void 0 ? -1 : 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
function versionAtLeast(version, minimum) {
  return compareVersions(version, minimum) >= 0;
}

// src/daemon/agent-runtimes/environment.ts
import { execFile } from "node:child_process";
import os from "node:os";
import path2 from "node:path";

// src/shared/external-mcp.ts
var EXTERNAL_MCP_DISABLED_ENV = "OHMYGAME_EXTERNAL_MCP_DISABLED";

// src/daemon/agent-runtimes/environment.ts
var SHARED = /* @__PURE__ */ new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LANGUAGE",
  "TZ",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // Windows needs these to find the profile, the shell and its programs.
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME"
]);
var RUNTIME_KEEP = {
  "claude-code-cli": ["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN"],
  "codex-cli": ["CODEX_HOME"],
  "opencode-cli": ["OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG"]
};
function agentEnvironment(runtime, binaryPath, extra = {}, source = process.env, shellPath2) {
  const keep = /* @__PURE__ */ new Set([...SHARED, ...RUNTIME_KEEP[runtime]]);
  const result = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === void 0) continue;
    const upper = name.toUpperCase();
    if (keep.has(name) || keep.has(upper) || upper.startsWith("LC_"))
      result[name] = value;
  }
  const pathKey = Object.keys(result).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  result[pathKey] = uniquePath([
    path2.dirname(binaryPath),
    ...shellPath2 ? [shellPath2] : [],
    result[pathKey] ?? "",
    ...commonBinaryDirectories()
  ]);
  return { ...result, [EXTERNAL_MCP_DISABLED_ENV]: "1", ...extra };
}
function commonBinaryDirectories(home = os.homedir()) {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const local = process.env.LOCALAPPDATA;
    return [
      ...appData ? [path2.join(appData, "npm")] : [],
      ...local ? [
        path2.join(local, "Programs", "claude"),
        path2.join(local, "Microsoft", "WinGet", "Links")
      ] : [],
      path2.join(home, ".local", "bin"),
      path2.join(home, ".bun", "bin"),
      path2.join(home, ".opencode", "bin")
    ];
  }
  return [
    path2.join(home, ".local", "bin"),
    path2.join(home, ".claude", "local"),
    path2.join(home, ".opencode", "bin"),
    path2.join(home, ".bun", "bin"),
    path2.join(home, ".npm-global", "bin"),
    path2.join(home, ".volta", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ];
}
var shellPath;
var readingShellPath = false;
function loginShellPath(recheck = false) {
  if (process.platform === "win32") return Promise.resolve(void 0);
  if (recheck && !readingShellPath) shellPath = void 0;
  if (shellPath) return shellPath;
  readingShellPath = true;
  shellPath = new Promise((resolve) => {
    const shell = process.env.SHELL || "/bin/zsh";
    const marker = "__OHMYGAME_PATH__";
    execFile(
      shell,
      ["-ilc", `printf '%s%s%s' '${marker}' "$PATH" '${marker}'`],
      {
        timeout: 4e3,
        encoding: "utf8",
        env: { HOME: os.homedir(), SHELL: shell, TERM: "dumb" }
      },
      (error, stdout) => {
        const match = !error || stdout ? stdout.match(new RegExp(`${marker}(.*)${marker}`)) : null;
        resolve(match?.[1] || void 0);
      }
    );
  }).then((value) => {
    readingShellPath = false;
    if (!value) shellPath = void 0;
    return value;
  });
  return shellPath;
}
function uniquePath(parts) {
  return [
    ...new Set(
      parts.flatMap((part) => part.split(path2.delimiter)).filter(Boolean)
    )
  ].join(path2.delimiter);
}

// src/daemon/agent-runtimes/process-recovery.ts
import { execFile as execFile2 } from "node:child_process";
import { unlinkSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path3 from "node:path";

// src/daemon/process-lifecycle.ts
import { spawn } from "node:child_process";
function registerProjectProcess(child) {
  if (process.env.OHMYGAME_PROJECT_PROCESS_IPC !== "1" || !process.connected)
    return;
  const send = (action) => {
    if (child.pid && process.connected)
      process.send?.(
        { channel: "ohmygame:project-process", action, pid: child.pid },
        () => {
        }
      );
  };
  child.once("spawn", () => send("started"));
  child.once("close", () => send("stopped"));
}
async function signalProcessTree(pid, force) {
  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(pid), "/t", ...force ? ["/f"] : []],
        { stdio: "ignore", windowsHide: true }
      );
      killer.once("error", reject);
      killer.once("close", () => resolve());
    });
    return;
  }
  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
async function terminateProjectProcess(child) {
  if (!child.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    await signalProcessTree(child.pid, true);
    return;
  }
  const closed = new Promise(
    (resolve) => child.once("close", () => resolve())
  );
  await signalProcessTree(child.pid, false);
  let timer;
  const timedOut = await Promise.race([
    closed.then(() => false),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(true), 3e3);
    })
  ]);
  clearTimeout(timer);
  await signalProcessTree(child.pid, true);
  if (timedOut) {
    await Promise.race([
      closed,
      new Promise((resolve) => setTimeout(resolve, 500))
    ]);
  }
}

// src/daemon/agent-runtimes/process-recovery.ts
var pendingIdentities = /* @__PURE__ */ new Map();
var identityQueue = Promise.resolve();
function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve(void 0);
  let identity = pendingIdentities.get(pid);
  if (!identity) {
    identity = identityQueue.then(() => lookUpIdentity(pid)).catch(() => void 0);
    identityQueue = identity;
    pendingIdentities.set(pid, identity);
    void identity.then(() => pendingIdentities.delete(pid));
  }
  return identity;
}
function lookUpIdentity(pid) {
  const [command, args] = process.platform === "win32" ? [
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.StartTime.ToUniversalTime().Ticks; $p.Path }`
    ]
  ] : ["/bin/ps", ["-p", String(pid), "-o", "lstart=", "-o", "comm="]];
  return new Promise((resolve) => {
    execFile2(
      command,
      args,
      { encoding: "utf8", timeout: 1e4, windowsHide: true },
      (error, stdout) => resolve(!error && stdout.trim() || void 0)
    ).stdin?.end();
  });
}
var ownIdentity;
function daemonIdentity() {
  return ownIdentity ??= processIdentity(process.pid).then((identity) => {
    if (!identity) ownIdentity = void 0;
    return identity;
  });
}
function trackAgentProcess(directory, child) {
  let file;
  let closed = false;
  child.once("spawn", async () => {
    const pid = child.pid;
    if (!pid) return;
    const [identity, ownerIdentity] = await Promise.all([
      processIdentity(pid),
      daemonIdentity()
    ]);
    if (!identity || !ownerIdentity || closed) return;
    const record2 = path3.join(directory, `${process.pid}-${pid}.json`);
    try {
      await mkdir(directory, { recursive: true, mode: 448 });
      await writeFile(
        record2,
        JSON.stringify({
          version: 1,
          pid,
          identity,
          owner: process.pid,
          ownerIdentity
        }),
        { mode: 384 }
      );
    } catch {
      return;
    }
    file = record2;
    if (closed) await rm(record2, { force: true }).catch(() => {
    });
  });
  child.once("close", () => {
    closed = true;
    if (file) {
      try {
        unlinkSync(file);
      } catch {
      }
    }
  });
}

// src/daemon/agent-runtimes/process.ts
import { spawn as spawn2 } from "node:child_process";
import readline from "node:readline";
var STDERR_TAIL = 8e3;
var spawnProcess = spawn2;
var live = /* @__PURE__ */ new Set();
var AgentProcess = class {
  child;
  #stderr = "";
  #exited;
  #stopping;
  constructor(options) {
    this.child = spawnProcess(options.binaryPath, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true
    });
    registerProjectProcess(this.child);
    if (options.processDirectory)
      trackAgentProcess(options.processDirectory, this.child);
    live.add(this);
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk) => {
      this.#stderr = (this.#stderr + chunk).slice(-STDERR_TAIL);
    });
    if (options.onLine && this.child.stdout) {
      readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on("line", options.onLine);
    }
    this.child.stdin?.on("error", () => {
    });
    this.#exited = new Promise((resolve) => {
      let reported = false;
      const finish = (code, signal) => {
        if (reported) return;
        reported = true;
        live.delete(this);
        options.onExit?.(code, signal, this.#stderr);
        resolve();
      };
      this.child.once("error", (cause) => {
        this.#stderr += `
${cause.message}`;
        finish(null, null);
      });
      this.child.once("close", finish);
    });
  }
  get running() {
    return this.child.exitCode === null && this.child.signalCode === null && !this.child.killed;
  }
  get stderr() {
    return this.#stderr;
  }
  write(message) {
    if (!this.child.stdin || this.child.stdin.destroyed)
      throw new Error("The agent process is not running");
    this.child.stdin.write(`${JSON.stringify(message)}
`);
  }
  exited() {
    return this.#exited;
  }
  stop() {
    return this.#stopping ??= (async () => {
      this.child.stdin?.end();
      await terminateProjectProcess(this.child).catch(() => {
      });
      await Promise.race([
        this.#exited,
        new Promise((resolve) => setTimeout(resolve, 1e3))
      ]);
    })();
  }
};
function processFailure(name, code, signal, stderr) {
  const tail = stderr.trim().split("\n").filter(Boolean).slice(-6).join("\n");
  const status = signal ? `was stopped (${signal})` : `exited with code ${code ?? "unknown"}`;
  return tail ? `${name} ${status}: ${tail}` : `${name} ${status}`;
}

// src/daemon/agent-runtimes/policy.ts
import os2 from "node:os";
import path4 from "node:path";
import { realpathSync, statSync } from "node:fs";
function planningPolicy(context2) {
  return { ...context2, sandboxedCommands: false, fullAccess: false };
}
function judgeApproval(details, context2) {
  const verdict = judgeRequest(details, context2);
  return verdict === "ask" && context2.fullAccess ? "allow" : verdict;
}
function judgeRequest(details, context2) {
  if (details.paths?.length) {
    const verdicts = details.paths.map(
      (entry) => judgeRequest(
        {
          ...details,
          kind: "file",
          tool: entry.access === "read" ? "Read" : "Write",
          paths: void 0,
          path: entry.path
        },
        context2
      )
    );
    if (verdicts.includes("deny")) return "deny";
    if (verdicts.includes("ask")) return "ask";
  }
  const workspace = canonicalPath(context2.workspacePath);
  const protectedPaths = context2.neverTouch.map(canonicalPath);
  const readablePaths = (context2.readablePaths ?? []).map(canonicalPath);
  if (details.path) {
    const target = canonicalPath(
      path4.resolve(workspace, expandHome(details.path))
    );
    if (["read", "glob", "grep", "ls", "list", "external_directory"].includes(
      details.tool.toLowerCase()
    ) && readablePaths.some((root) => inside(target, root)))
      return "allow";
    if (protectedPaths.some(
      (root) => inside(root, workspace) && reaches(target, [root])
    ))
      return "deny";
    if (inside(target, workspace))
      return details.kind === "file" || details.kind === "other" ? "allow" : "ask";
    if (reaches(target, protectedPaths)) return "deny";
    return "ask";
  }
  if (details.command !== void 0) {
    const command = details.command;
    const named = commandPaths(command, workspace).map(canonicalPath);
    const protectedInWorkspace = protectedPaths.filter(
      (root) => inside(root, workspace)
    );
    if (named.some(
      (target) => !readablePaths.some((root) => inside(target, root)) && reaches(
        target,
        inside(target, workspace) ? protectedInWorkspace : protectedPaths
      )
    ))
      return "deny";
    if (RISKY_COMMAND.test(command)) return "ask";
    if (named.some(
      (target) => !inside(target, workspace) && !SAFE_OUTSIDE.some((root) => inside(target, root))
    ))
      return "ask";
    if (context2.sandboxedCommands) return "allow";
    return SAFE_COMMAND.test(command.trim()) && !SHELL_CONTROL.test(command) && !UNSCOPED_ARGUMENT.test(command) ? "allow" : "ask";
  }
  return details.kind === "tool" ? "allow" : "ask";
}
var SAFE_COMMAND = /^(?:pwd|ls|cat|head|tail|wc|rg|grep)\b/;
var SHELL_CONTROL = /[\n;&|<>`$]|(?:^|\s)--(?:pre|exec|hostname-bin)(?:=|\s|$)|(?:^|\s)(?:-exec|-execdir|-delete)(?:\s|$)/;
var UNSCOPED_ARGUMENT = /[*?[\]{}]|(?:^|\s)(?:-[A-Za-z]*[RL][A-Za-z]*|--dereference-recursive|--follow)(?=\s|$)/;
function canonicalPath(value) {
  const absolute = path4.resolve(value);
  let current = absolute;
  const suffix = [];
  for (; ; ) {
    try {
      return path4.join(realpathSync.native(current), ...suffix);
    } catch {
      const parent = path4.dirname(current);
      if (parent === current) return absolute;
      suffix.unshift(path4.basename(current));
      current = parent;
    }
  }
}
function approvalScope(details, context2) {
  const workspace = canonicalPath(context2.workspacePath);
  if (details.command !== void 0) {
    if (!context2.sandboxedCommands) return void 0;
    const risky = [...details.command.matchAll(RISKY_COMMANDS)].map(
      (match) => match[2].replace(/\s+/g, " ")
    );
    if (risky.some((command) => !REPEATABLE_COMMAND.test(command)))
      return void 0;
    const outside = commandPaths(details.command, workspace).map(canonicalPath).filter(
      (target) => !inside(target, workspace) && !SAFE_OUTSIDE.some((root) => inside(target, root))
    );
    return scope([...new Set(risky)], outside);
  }
  const reads = details.paths?.length ? details.paths : details.path ? [
    {
      path: details.path,
      access: readTool(details.tool) ? "read" : "write"
    }
  ] : [];
  if (!reads.length || reads.some((entry) => entry.access !== "read"))
    return void 0;
  return scope(
    [],
    reads.map(
      (entry) => canonicalPath(path4.resolve(workspace, expandHome(entry.path)))
    )
  );
}
function scope(commands, paths) {
  const folders = [];
  for (const target of paths) {
    const folder = isDirectory(target) ? target : path4.dirname(target);
    if (folder === path4.parse(folder).root || folder === canonicalPath(os2.homedir()))
      return void 0;
    if (!folders.includes(folder)) folders.push(folder);
  }
  if (!commands.length && !folders.length) return void 0;
  return {
    ...commands.length ? { commands } : {},
    ...folders.length ? { readFolders: folders } : {}
  };
}
function readTool(tool) {
  return ["read", "glob", "grep", "ls", "list", "external_directory"].includes(
    tool.toLowerCase()
  );
}
function isDirectory(target) {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}
var RISKY_SOURCE = /(^|[\s;&|(])(sudo|su|doas|git\s+push|npm\s+publish|pnpm\s+publish|yarn\s+publish|security|launchctl|crontab|chmod\s+-R\s+777|curl[^|]*\|\s*(sh|bash|zsh)|wget[^|]*\|\s*(sh|bash|zsh))\b/.source;
var RISKY_COMMAND = new RegExp(RISKY_SOURCE);
var RISKY_COMMANDS = new RegExp(RISKY_SOURCE, "g");
var REPEATABLE_COMMAND = /^(?:git push|(?:npm|pnpm|yarn) publish)$/;
var SAFE_OUTSIDE = [
  "/dev/null",
  "/usr",
  "/bin",
  "/opt/homebrew",
  "/Library/Developer"
].map((root) => path4.resolve(root));
function commandPaths(command, workspace) {
  const words = new Set(command.replace(/["'`]/g, " ").split(/[\s;&|()<>]+/));
  for (const quoted of [/"([^"]*)"/g, /'([^']*)'/g])
    for (const match of command.matchAll(quoted)) words.add(match[1]);
  for (const match of command.matchAll(/(?:\\[\s\S]|[^\s;&|()<>"'`\\])+/g))
    words.add(match[0].replace(/\\([ \t])/g, "$1"));
  const paths = [];
  for (const raw of words) {
    const word = raw.replace(/^[A-Za-z_][A-Za-z0-9_]*=/, "");
    if (!word) continue;
    if (word.startsWith("~") || word.startsWith("$HOME") || word.startsWith("${HOME}"))
      paths.push(path4.resolve(expandHome(word.replace(/^\$\{?HOME\}?/, "~"))));
    else if (path4.isAbsolute(word)) paths.push(path4.resolve(word));
    else if (word === ".." || word.startsWith("../"))
      paths.push(path4.resolve(workspace, word));
    else if (!word.startsWith("-")) paths.push(path4.resolve(workspace, word));
  }
  return paths;
}
function expandHome(value) {
  return value === "~" ? os2.homedir() : value.startsWith("~/") ? path4.join(os2.homedir(), value.slice(2)) : value;
}
function inside(target, root) {
  const relative = path4.relative(root, target);
  return relative === "" || !relative.startsWith("..") && !path4.isAbsolute(relative);
}
function reaches(target, protectedPaths) {
  return protectedPaths.some(
    (root) => inside(target, root) || inside(root, target)
  );
}

// src/daemon/agent-runtimes/driver-context.ts
var PLANNING_DENIAL = "This is a planning turn: do not change anything. Use Read, or one simple read command at a time (ls, cat, head, tail, wc, grep, rg) without pipes, &&, redirection or globs.";
async function decideApproval(details, context2, sink, options) {
  if (options?.signal?.aborted) return "deny";
  const verdict = judgeApproval(details, context2.policy);
  if (verdict === "allow") return "allow";
  if (verdict === "deny") return "deny";
  const sessionScope = details.canAllowSession ? approvalScope(details, context2.policy) : void 0;
  return sink.requestApproval(
    sessionScope ? { ...details, sessionScope } : details,
    options
  );
}
function textResult(value) {
  if (typeof value === "string")
    return { content: [{ type: "text", text: value }] };
  if (Array.isArray(value)) {
    const content = [];
    for (const part of value) {
      if (!part || typeof part !== "object") continue;
      const block = part;
      if (block.type === "text" && typeof block.text === "string")
        content.push({ type: "text", text: block.text });
      else if (block.type === "image") {
        const source = block.source;
        const data = typeof block.data === "string" ? block.data : typeof source?.data === "string" ? source.data : void 0;
        const mimeType = typeof block.mimeType === "string" ? block.mimeType : typeof source?.media_type === "string" ? source.media_type : void 0;
        if (data && mimeType) content.push({ type: "image", data, mimeType });
      }
    }
    return { content };
  }
  if (value === void 0 || value === null) return { content: [] };
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
function piToolCall(name, args) {
  const file = stringValue(args.file_path) ?? stringValue(args.filePath) ?? stringValue(args.path);
  switch (name.toLowerCase()) {
    case "bash":
    case "shell":
      return {
        name: "bash",
        args: {
          command: stringValue(args.command) ?? "",
          ...args.timeout !== void 0 ? { timeout: args.timeout } : {},
          ...stringValue(args.description) ? { description: args.description } : {}
        }
      };
    case "read":
      return {
        name: "read",
        args: {
          ...file ? { path: file } : {},
          ...args.offset !== void 0 ? { offset: args.offset } : {},
          ...args.limit !== void 0 ? { limit: args.limit } : {}
        }
      };
    case "write":
      return { name: "write", args: { ...file ? { path: file } : {} } };
    case "edit":
    case "multiedit":
    case "apply_patch":
    case "patch":
      return { name: "edit", args: { ...file ? { path: file } : {} } };
    case "glob":
    case "find":
      return {
        name: "find",
        args: {
          ...stringValue(args.pattern) ? { pattern: args.pattern } : {},
          ...file ? { path: file } : {}
        }
      };
    case "grep":
      return {
        name: "grep",
        args: {
          ...stringValue(args.pattern) ? { pattern: args.pattern } : {},
          ...file ? { path: file } : {}
        }
      };
    case "ls":
    case "list":
      return { name: "ls", args: { ...file ? { path: file } : {} } };
    default:
      return { name, args };
  }
}
function stringValue(value) {
  return typeof value === "string" && value ? value : void 0;
}
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// src/daemon/agent-runtimes/compatibility.ts
var AgentRuntimeCompatibilityError = class extends Error {
  constructor(detail, capability) {
    super(
      detail.startsWith("Local CLI compatibility: ") ? detail : `Local CLI compatibility: ${detail}`
    );
    this.capability = capability;
    this.name = "AgentRuntimeCompatibilityError";
  }
  capability;
  code = "AGENT_RUNTIME_INCOMPATIBLE";
};
var AgentRuntimeProbeError = class extends Error {
  code = "AGENT_RUNTIME_PROBE_FAILED";
  constructor(detail) {
    super(`Local CLI check failed: ${detail}`);
    this.name = "AgentRuntimeProbeError";
  }
};
function runtimeStartupError(cause) {
  if (cause instanceof AgentRuntimeCompatibilityError || cause instanceof AgentRuntimeProbeError)
    return cause;
  return new AgentRuntimeProbeError(
    cause instanceof Error ? cause.message : String(cause)
  );
}
function checkRuntimeVersionRequirement(id, version, permissionMode, sandbox = commandSandbox(id)) {
  if (id === "opencode-cli") {
    if (!version)
      throw new AgentRuntimeProbeError(
        "OpenCode did not report its v2 API version. Check the CLI and retry."
      );
    if (!versionAtLeast(version, "2.1.0") || versionAtLeast(version, "3.0.0-0"))
      throw new AgentRuntimeCompatibilityError(
        `OpenCode ${version} is unsupported. Install OpenCode 2.1.0 or a newer 2.x version and check again.`,
        "OpenCode HTTP API v2 (>=2.1.0 <3)"
      );
    return;
  }
  if (id !== "claude-code-cli" || permissionMode !== "standard" || sandbox !== "os")
    return;
  if (!version)
    throw new AgentRuntimeProbeError(
      "Claude Code did not report its version. OhMyGame could not verify sandbox.failIfUnavailable, required for Standard permissions on this platform. Check the CLI and retry."
    );
  if (!versionAtLeast(version, "2.1.83"))
    throw new AgentRuntimeCompatibilityError(
      `Claude Code ${version} does not support sandbox.failIfUnavailable, required for Standard permissions on this platform. This feature requires Claude Code 2.1.83 or newer. Update Claude Code and check again in Settings.`,
      "sandbox.failIfUnavailable (>= 2.1.83)"
    );
}
function cliProbeError(name, detail) {
  if (name === "Codex" && /elevated windows sandbox requires effective :root read access/i.test(detail))
    return new AgentRuntimeCompatibilityError(
      "Codex's elevated Windows sandbox requires effective :root read access. Update Codex and check its sandbox configuration, then check again in Settings. See https://learn.chatgpt.com/docs/windows/windows-sandbox",
      "Windows sandbox filesystem read restrictions"
    );
  if (name === "Codex" && /windows (?:unelevated restricted-token|elevated) sandbox cannot enforce (?:split )?filesystem read restrictions/i.test(
    detail
  ))
    return new AgentRuntimeCompatibilityError(
      "Codex's Windows sandbox cannot enforce OhMyGame's filesystem read restrictions. Configure Codex's elevated sandbox, or MXC on a supported device and CLI, then check again in Settings. See https://learn.chatgpt.com/docs/windows/windows-sandbox",
      "Windows sandbox filesystem read restrictions"
    );
  return /unknown (?:argument|option|command)|unrecognized (?:argument|option|command)|unexpected argument|method not found|unsupported (?:method|control request)/i.test(
    detail
  ) ? new AgentRuntimeCompatibilityError(`${name}: ${detail}`) : new Error(detail);
}

// src/daemon/agent-runtimes/codex-app-server.ts
var CODEX_APPROVAL_POLICY = {
  granular: {
    sandbox_approval: false,
    rules: false,
    mcp_elicitations: false,
    request_permissions: true,
    skill_approval: false
  }
};
function requireCodexPermissionProfile(response, profile) {
  if (response.activePermissionProfile?.id !== profile)
    throw new AgentRuntimeCompatibilityError(
      "Codex did not activate OhMyGame's filesystem permissions. A CLI supporting named permission profiles is required. Update Codex and check again in Settings.",
      "permissions / activePermissionProfile"
    );
}
async function checkCodexCompatibility(server, directory, timeoutMs = REQUEST_TIMEOUT_MS) {
  const profile = "ohmygame-compatibility-probe";
  const read = await server.request(
    "config/read",
    { cwd: directory },
    timeoutMs
  );
  const filesystemPermissions = process.platform === "win32" ? { ":root": "read", ":workspace_roots": { ".": "read" } } : { ":minimal": "read", ":workspace_roots": { ".": "read" } };
  const config = {
    default_permissions: profile,
    project_root_markers: [],
    notify: [],
    "features.request_permissions_tool": true,
    "features.shell_snapshot": false,
    permissions: {
      [profile]: {
        filesystem: filesystemPermissions,
        network: { enabled: true }
      }
    }
  };
  for (const name of Object.keys(record(read.config?.mcp_servers) ?? {}))
    config[`mcp_servers.${name}.enabled`] = false;
  const response = await server.request(
    "thread/start",
    {
      cwd: directory,
      ephemeral: true,
      approvalPolicy: CODEX_APPROVAL_POLICY,
      permissions: profile,
      config,
      dynamicTools: [
        {
          type: "function",
          name: "ohmygame_compatibility_probe",
          description: "Compatibility fixture. No turn will be submitted.",
          inputSchema: { type: "object", properties: {} }
        }
      ]
    },
    timeoutMs
  );
  requireCodexPermissionProfile(response, profile);
  if (!response.thread?.id)
    throw new Error("Codex did not start a probe thread");
}
var REQUEST_TIMEOUT_MS = 6e4;
var CODEX_CLIENT = {
  name: "ohmygame",
  title: "OhMyGame",
  version: "1"
};
var CodexAppServer = class {
  constructor(binaryPath, cwd, env, handlers = {}) {
    this.handlers = handlers;
    this.process = new AgentProcess({
      binaryPath,
      args: ["app-server"],
      cwd,
      env,
      processDirectory: handlers.processDirectory,
      onLine: (line) => this.#receive(line),
      onExit: (code, signal, stderr) => {
        this.#closed = new Error(processFailure("Codex", code, signal, stderr));
        for (const pending of this.#pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(this.#closed);
        }
        this.#pending.clear();
        handlers.exit?.(this.#closed.message);
      }
    });
  }
  handlers;
  process;
  #next = 1;
  #pending = /* @__PURE__ */ new Map();
  #closed;
  async initialize(timeoutMs = REQUEST_TIMEOUT_MS) {
    await this.request(
      "initialize",
      {
        clientInfo: CODEX_CLIENT,
        capabilities: { experimentalApi: true }
      },
      timeoutMs
    );
    this.notify("initialized");
  }
  request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (this.#closed) return Promise.reject(this.#closed);
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex did not answer ${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve,
        reject,
        timer
      });
      try {
        this.process.write({ jsonrpc: "2.0", id, method, params });
      } catch (cause) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }
  notify(method, params) {
    this.process.write({
      jsonrpc: "2.0",
      method,
      ...params === void 0 ? {} : { params }
    });
  }
  stop() {
    return this.process.stop();
  }
  #receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const id = message.id;
    if (typeof message.method === "string") {
      const params = record(message.params) ?? {};
      if (id === void 0 || id === null) {
        this.handlers.notification?.(message.method, params);
        return;
      }
      void (this.handlers.request?.(message.method, params) ?? Promise.reject(new Error(`Unsupported request ${message.method}`))).then(
        (result) => {
          if (this.process.running)
            this.process.write({ jsonrpc: "2.0", id, result });
        },
        (cause) => {
          if (this.process.running)
            this.process.write({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32e3,
                message: cause instanceof Error ? cause.message : String(cause)
              }
            });
        }
      );
      return;
    }
    if (typeof id !== "number") return;
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    const error = record(message.error);
    if (error)
      pending.reject(
        cliProbeError("Codex", String(error.message ?? "Codex request failed"))
      );
    else pending.resolve(message.result);
  }
};
function codexLimits(value) {
  const data = record(value);
  const buckets = record(data?.rateLimitsByLimitId) ?? {
    codex: data?.rateLimits
  };
  const limits = [];
  for (const [bucket, raw] of Object.entries(buckets)) {
    const windows = record(raw);
    for (const window of ["primary", "secondary"]) {
      const item = record(windows?.[window]);
      if (typeof item?.usedPercent !== "number") continue;
      limits.push({
        id: `${bucket}/${window}`,
        usedPercent: Math.max(0, Math.min(100, item.usedPercent)),
        ...typeof item.windowDurationMins === "number" ? { windowMinutes: item.windowDurationMins } : {},
        ...typeof item.resetsAt === "number" ? { resetsAt: item.resetsAt } : {}
      });
    }
  }
  return limits;
}

// src/daemon/agent-runtimes/opencode.ts
import { randomBytes } from "node:crypto";
import { writeFile as writeFile2 } from "node:fs/promises";
import path6 from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// node_modules/typebox/build/system/arguments/arguments.mjs
var arguments_exports = {};
__export(arguments_exports, {
  Match: () => Match
});
function Match(args, match) {
  return match[args.length]?.(...args) ?? (() => {
    throw Error("Invalid Arguments");
  })();
}

// node_modules/typebox/build/system/settings/settings.mjs
var settings_exports = {};
__export(settings_exports, {
  Get: () => Get,
  Reset: () => Reset,
  Set: () => Set2
});

// node_modules/typebox/build/guard/guard.mjs
var guard_exports = {};
__export(guard_exports, {
  Counted: () => Counted,
  Entries: () => Entries,
  EntriesRegExp: () => EntriesRegExp,
  Every: () => Every,
  EveryAll: () => EveryAll,
  GraphemeCount: () => GraphemeCount2,
  HasPropertyKey: () => HasPropertyKey,
  IsArray: () => IsArray,
  IsBigInt: () => IsBigInt,
  IsBoolean: () => IsBoolean,
  IsClassInstance: () => IsClassInstance,
  IsConstructor: () => IsConstructor,
  IsDeepEqual: () => IsDeepEqual,
  IsEqual: () => IsEqual,
  IsFunction: () => IsFunction,
  IsGreaterEqualThan: () => IsGreaterEqualThan,
  IsGreaterThan: () => IsGreaterThan,
  IsInteger: () => IsInteger,
  IsLessEqualThan: () => IsLessEqualThan,
  IsLessThan: () => IsLessThan,
  IsMaxLength: () => IsMaxLength2,
  IsMinLength: () => IsMinLength2,
  IsMultipleOf: () => IsMultipleOf,
  IsNull: () => IsNull,
  IsNumber: () => IsNumber,
  IsObject: () => IsObject,
  IsObjectNotArray: () => IsObjectNotArray,
  IsString: () => IsString,
  IsSymbol: () => IsSymbol,
  IsUndefined: () => IsUndefined,
  IsUnsafePropertyKey: () => IsUnsafePropertyKey,
  IsValueLike: () => IsValueLike,
  Keys: () => Keys,
  ShiftLeft: () => ShiftLeft,
  Some: () => Some,
  SomeAll: () => SomeAll,
  Symbols: () => Symbols,
  Values: () => Values
});

// node_modules/typebox/build/guard/string.mjs
function IsBetween(value, min, max) {
  return value >= min && value <= max;
}
function IsZeroWidthJoiner(value) {
  return value === 8205;
}
function IsHighSurrogate(value) {
  return IsBetween(value, 55296, 56319);
}
function IsRegionalIndicator(value) {
  return IsBetween(value, 127462, 127487);
}
function IsVariationSelector(value) {
  return IsBetween(value, 65024, 65039);
}
function IsCombiningMark(value) {
  return IsBetween(value, 768, 879) || IsBetween(value, 6832, 6911) || IsBetween(value, 7616, 7679) || IsBetween(value, 65056, 65071);
}
function CodePointLength(value) {
  return value > 65535 ? 2 : 1;
}
function ConsumeModifiers(value, index) {
  while (index < value.length) {
    const point = value.codePointAt(index);
    if (IsCombiningMark(point) || IsVariationSelector(point)) {
      index += CodePointLength(point);
    } else {
      break;
    }
  }
  return index;
}
function NextGraphemeClusterIndex(value, clusterStart) {
  const startCP = value.codePointAt(clusterStart);
  let clusterEnd = clusterStart + CodePointLength(startCP);
  clusterEnd = ConsumeModifiers(value, clusterEnd);
  while (clusterEnd < value.length - 1 && IsZeroWidthJoiner(value.codePointAt(clusterEnd))) {
    const nextCP = value.codePointAt(clusterEnd + 1);
    clusterEnd += 1 + CodePointLength(nextCP);
    clusterEnd = ConsumeModifiers(value, clusterEnd);
  }
  if (IsRegionalIndicator(startCP) && clusterEnd < value.length && IsRegionalIndicator(value.codePointAt(clusterEnd))) {
    clusterEnd += CodePointLength(value.codePointAt(clusterEnd));
  }
  return clusterEnd;
}
function IsGraphemeCodePoint(value) {
  return value >= 768 && // above special range
  (IsHighSurrogate(value) || IsCombiningMark(value) || IsVariationSelector(value) || IsZeroWidthJoiner(value));
}
function GraphemeCount(value) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
  }
  return count;
}
function IsMinLengthSegmented(value, minLength) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    if (++count >= minLength)
      return true;
  }
  return false;
}
function IsMaxLengthSegmented(value, maxLength) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    if (++count > maxLength)
      return false;
  }
  return true;
}
function IsMinLength(value, minLength) {
  if (minLength === 0)
    return true;
  if (value.length < minLength)
    return false;
  let index = 0;
  while (true) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMinLengthSegmented(value, minLength);
    }
    if (++index >= minLength)
      return true;
  }
}
function IsMaxLength(value, maxLength) {
  if (value.length <= maxLength)
    return true;
  let index = 0;
  while (true) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMaxLengthSegmented(value, maxLength);
    }
    if (++index > maxLength)
      return false;
  }
}

// node_modules/typebox/build/guard/guard.mjs
function IsArray(value) {
  return Array.isArray(value);
}
function IsBigInt(value) {
  return IsEqual(typeof value, "bigint");
}
function IsBoolean(value) {
  return IsEqual(typeof value, "boolean");
}
function IsConstructor(value) {
  if (IsUndefined(value) || !IsFunction(value))
    return false;
  const result = Function.prototype.toString.call(value);
  if (/^class\s/.test(result))
    return true;
  if (/\[native code\]/.test(result))
    return true;
  return false;
}
function IsFunction(value) {
  return IsEqual(typeof value, "function");
}
function IsInteger(value) {
  return Number.isInteger(value);
}
function IsNull(value) {
  return IsEqual(value, null);
}
function IsNumber(value) {
  return Number.isFinite(value);
}
function IsObjectNotArray(value) {
  return IsObject(value) && !IsArray(value);
}
function IsObject(value) {
  return IsEqual(typeof value, "object") && !IsNull(value);
}
function IsString(value) {
  return IsEqual(typeof value, "string");
}
function IsSymbol(value) {
  return IsEqual(typeof value, "symbol");
}
function IsUndefined(value) {
  return IsEqual(value, void 0);
}
function IsEqual(left, right) {
  return left === right;
}
function IsGreaterThan(left, right) {
  return left > right;
}
function IsLessThan(left, right) {
  return left < right;
}
function IsLessEqualThan(left, right) {
  return left <= right;
}
function IsGreaterEqualThan(left, right) {
  return left >= right;
}
function IsMultipleOf(dividend, divisor) {
  if (IsBigInt(dividend) || IsBigInt(divisor)) {
    return BigInt(dividend) % BigInt(divisor) === 0n;
  }
  const tolerance = 1e-10;
  if (!IsNumber(dividend))
    return true;
  if (IsInteger(dividend) && 1 / divisor % 1 === 0)
    return true;
  const mod = dividend % divisor;
  return Math.min(Math.abs(mod), Math.abs(mod - divisor), Math.abs(mod + divisor)) < tolerance;
}
function IsClassInstance(value) {
  if (!IsObject(value))
    return false;
  const proto = globalThis.Object.getPrototypeOf(value);
  if (IsNull(proto))
    return false;
  return IsEqual(typeof proto.constructor, "function") && !(IsEqual(proto.constructor, globalThis.Object) || IsEqual(proto.constructor.name, "Object"));
}
function IsValueLike(value) {
  return IsBigInt(value) || IsBoolean(value) || IsNull(value) || IsNumber(value) || IsString(value) || IsUndefined(value);
}
function GraphemeCount2(value) {
  return GraphemeCount(value);
}
function IsMaxLength2(value, length) {
  return IsMaxLength(value, length);
}
function IsMinLength2(value, length) {
  return IsMinLength(value, length);
}
function Every(value, offset, callback) {
  return value.every((item, index) => index < offset || callback(item, index));
}
function EveryAll(value, offset, callback) {
  let result = true;
  value.forEach((item, index) => {
    if (index >= offset && !callback(item, index))
      result = false;
  });
  return result;
}
function Some(value, callback) {
  return value.some((value2, index) => callback(value2, index));
}
function SomeAll(value, callback) {
  let result = false;
  value.forEach((item, index) => {
    if (callback(item, index))
      result = true;
  });
  return result;
}
function Counted(value, callback) {
  return value.reduce((result, value2, index) => callback(value2, index) ? ++result : result, 0);
}
function ShiftLeft(array, true_, false_) {
  return IsEqual(array.length, 0) ? false_() : true_(array[0], array.slice(1));
}
function IsUnsafePropertyKey(key) {
  return IsEqual(key, "__proto__") || IsEqual(key, "constructor") || IsEqual(key, "prototype");
}
function HasPropertyKey(value, key) {
  return IsUnsafePropertyKey(key) ? Object.prototype.hasOwnProperty.call(value, key) : key in value;
}
function EntriesRegExp(value) {
  return Keys(value).map((key) => [new RegExp(`^${key}$`), value[key]]);
}
function Entries(value) {
  return Object.entries(value);
}
function Keys(value) {
  return Object.getOwnPropertyNames(value);
}
function Symbols(value) {
  return Object.getOwnPropertySymbols(value);
}
function Values(value) {
  return Object.values(value);
}
function DeepEqualObject(left, right) {
  if (!IsObject(right))
    return false;
  const keys = Keys(left);
  return IsEqual(keys.length, Keys(right).length) && keys.every((key) => IsDeepEqual(left[key], right[key]));
}
function DeepEqualArray(left, right) {
  return IsArray(right) && IsEqual(left.length, right.length) && left.every((_, index) => IsDeepEqual(left[index], right[index]));
}
function IsDeepEqual(left, right) {
  return IsArray(left) ? DeepEqualArray(left, right) : IsObject(left) ? DeepEqualObject(left, right) : IsEqual(left, right);
}

// node_modules/typebox/build/guard/globals.mjs
var globals_exports = {};
__export(globals_exports, {
  IsBigInt64Array: () => IsBigInt64Array,
  IsBigUint64Array: () => IsBigUint64Array,
  IsBoolean: () => IsBoolean2,
  IsDate: () => IsDate,
  IsFloat32Array: () => IsFloat32Array,
  IsFloat64Array: () => IsFloat64Array,
  IsInt16Array: () => IsInt16Array,
  IsInt32Array: () => IsInt32Array,
  IsInt8Array: () => IsInt8Array,
  IsMap: () => IsMap,
  IsNumber: () => IsNumber2,
  IsRegExp: () => IsRegExp,
  IsSet: () => IsSet,
  IsString: () => IsString2,
  IsTypeArray: () => IsTypeArray,
  IsUint16Array: () => IsUint16Array,
  IsUint32Array: () => IsUint32Array,
  IsUint8Array: () => IsUint8Array,
  IsUint8ClampedArray: () => IsUint8ClampedArray
});
function IsBoolean2(value) {
  return value instanceof Boolean;
}
function IsNumber2(value) {
  return value instanceof Number;
}
function IsString2(value) {
  return value instanceof String;
}
function IsTypeArray(value) {
  return globalThis.ArrayBuffer.isView(value);
}
function IsInt8Array(value) {
  return value instanceof globalThis.Int8Array;
}
function IsUint8Array(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUint8ClampedArray(value) {
  return value instanceof globalThis.Uint8ClampedArray;
}
function IsInt16Array(value) {
  return value instanceof globalThis.Int16Array;
}
function IsUint16Array(value) {
  return value instanceof globalThis.Uint16Array;
}
function IsInt32Array(value) {
  return value instanceof globalThis.Int32Array;
}
function IsUint32Array(value) {
  return value instanceof globalThis.Uint32Array;
}
function IsFloat32Array(value) {
  return value instanceof globalThis.Float32Array;
}
function IsFloat64Array(value) {
  return value instanceof globalThis.Float64Array;
}
function IsBigInt64Array(value) {
  return value instanceof globalThis.BigInt64Array;
}
function IsBigUint64Array(value) {
  return value instanceof globalThis.BigUint64Array;
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsDate(value) {
  return value instanceof globalThis.Date;
}
function IsSet(value) {
  return value instanceof globalThis.Set;
}
function IsMap(value) {
  return value instanceof globalThis.Map;
}

// node_modules/typebox/build/guard/index.mjs
var guard_default = guard_exports;

// node_modules/typebox/build/system/settings/settings.mjs
var settings = {
  immutableTypes: false,
  maxErrors: 8,
  maxInstantiationCount: 128,
  useAcceleration: true,
  exactOptionalPropertyTypes: false,
  enumerableKind: false,
  correctiveParse: false,
  unionPrioritySort: true
};
function Reset() {
  settings.immutableTypes = false;
  settings.maxErrors = 8;
  settings.maxInstantiationCount = 128;
  settings.useAcceleration = true;
  settings.exactOptionalPropertyTypes = false;
  settings.enumerableKind = false;
  settings.correctiveParse = false;
  settings.unionPrioritySort = true;
}
function Set2(options) {
  for (const key of guard_exports.Keys(options)) {
    const value = options[key];
    if (value !== void 0) {
      Object.defineProperty(settings, key, { value });
    }
  }
}
function Get() {
  return settings;
}

// node_modules/typebox/build/schema/types/_refine.mjs
function IsRefine(value) {
  return guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => guard_exports.IsObject(value2) && guard_exports.HasPropertyKey(value2, "check") && guard_exports.HasPropertyKey(value2, "error") && guard_exports.IsFunction(value2.check) && guard_exports.IsFunction(value2.error));
}

// node_modules/typebox/build/schema/types/schema.mjs
function IsSchemaObject(value) {
  return guard_exports.IsObject(value) && !guard_exports.IsArray(value);
}
function IsSchemaBoolean(value) {
  return guard_exports.IsBoolean(value);
}
function IsSchema(value) {
  return IsSchemaObject(value) || IsSchemaBoolean(value);
}

// node_modules/typebox/build/schema/types/additionalItems.mjs
function IsAdditionalItems(schema) {
  return guard_exports.HasPropertyKey(schema, "additionalItems") && IsSchema(schema.additionalItems);
}

// node_modules/typebox/build/schema/types/additionalProperties.mjs
function IsAdditionalProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "additionalProperties") && IsSchema(schema.additionalProperties);
}

// node_modules/typebox/build/schema/types/allOf.mjs
function IsAllOf(schema) {
  return guard_exports.HasPropertyKey(schema, "allOf") && guard_exports.IsArray(schema.allOf) && schema.allOf.every((value) => IsSchema(value));
}

// node_modules/typebox/build/schema/types/anchor.mjs
function IsAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$anchor") && guard_exports.IsString(schema.$anchor);
}

// node_modules/typebox/build/schema/types/anyOf.mjs
function IsAnyOf(schema) {
  return guard_exports.HasPropertyKey(schema, "anyOf") && guard_exports.IsArray(schema.anyOf) && schema.anyOf.every((value) => IsSchema(value));
}

// node_modules/typebox/build/schema/types/const.mjs
function IsConst(value) {
  return guard_exports.HasPropertyKey(value, "const");
}

// node_modules/typebox/build/schema/types/contains.mjs
function IsContains(schema) {
  return guard_exports.HasPropertyKey(schema, "contains") && IsSchema(schema.contains);
}

// node_modules/typebox/build/schema/types/default.mjs
function IsDefault(schema) {
  return guard_exports.HasPropertyKey(schema, "default");
}

// node_modules/typebox/build/schema/types/dependencies.mjs
function IsDependencies(schema) {
  return guard_exports.HasPropertyKey(schema, "dependencies") && guard_exports.IsObject(schema.dependencies) && Object.values(schema.dependencies).every((value) => IsSchema(value) || guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
}

// node_modules/typebox/build/schema/types/dependentRequired.mjs
function IsDependentRequired(schema) {
  return guard_exports.HasPropertyKey(schema, "dependentRequired") && guard_exports.IsObject(schema.dependentRequired) && Object.values(schema.dependentRequired).every((value) => guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
}

// node_modules/typebox/build/schema/types/dependentSchemas.mjs
function IsDependentSchemas(schema) {
  return guard_exports.HasPropertyKey(schema, "dependentSchemas") && guard_exports.IsObject(schema.dependentSchemas) && Object.values(schema.dependentSchemas).every((value) => IsSchema(value));
}

// node_modules/typebox/build/schema/types/dynamicAnchor.mjs
function IsDynamicAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$dynamicAnchor") && guard_exports.IsString(schema.$dynamicAnchor);
}

// node_modules/typebox/build/schema/types/dynamicRef.mjs
function IsDynamicRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$dynamicRef") && guard_exports.IsString(schema.$dynamicRef);
}

// node_modules/typebox/build/schema/types/else.mjs
function IsElse(schema) {
  return guard_exports.HasPropertyKey(schema, "else") && IsSchema(schema.else);
}

// node_modules/typebox/build/schema/types/enum.mjs
function IsEnum(schema) {
  return guard_exports.HasPropertyKey(schema, "enum") && guard_exports.IsArray(schema.enum);
}

// node_modules/typebox/build/schema/types/exclusiveMaximum.mjs
function IsExclusiveMaximum(schema) {
  return guard_exports.HasPropertyKey(schema, "exclusiveMaximum") && (guard_exports.IsNumber(schema.exclusiveMaximum) || guard_exports.IsBigInt(schema.exclusiveMaximum));
}

// node_modules/typebox/build/schema/types/exclusiveMinimum.mjs
function IsExclusiveMinimum(schema) {
  return guard_exports.HasPropertyKey(schema, "exclusiveMinimum") && (guard_exports.IsNumber(schema.exclusiveMinimum) || guard_exports.IsBigInt(schema.exclusiveMinimum));
}

// node_modules/typebox/build/schema/types/format.mjs
function IsFormat(schema) {
  return guard_exports.HasPropertyKey(schema, "format") && guard_exports.IsString(schema.format);
}

// node_modules/typebox/build/schema/types/id.mjs
function IsId(schema) {
  return guard_exports.HasPropertyKey(schema, "$id") && guard_exports.IsString(schema.$id);
}

// node_modules/typebox/build/schema/types/if.mjs
function IsIf(schema) {
  return guard_exports.HasPropertyKey(schema, "if") && IsSchema(schema.if);
}

// node_modules/typebox/build/schema/types/items.mjs
function IsItems(schema) {
  return guard_exports.HasPropertyKey(schema, "items") && (IsSchema(schema.items) || guard_exports.IsArray(schema.items) && schema.items.every((value) => {
    return IsSchema(value);
  }));
}
function IsItemsSized(schema) {
  return IsItems(schema) && guard_exports.IsArray(schema.items);
}

// node_modules/typebox/build/schema/types/maximum.mjs
function IsMaximum(schema) {
  return guard_exports.HasPropertyKey(schema, "maximum") && (guard_exports.IsNumber(schema.maximum) || guard_exports.IsBigInt(schema.maximum));
}

// node_modules/typebox/build/schema/types/maxContains.mjs
function IsMaxContains(schema) {
  return guard_exports.HasPropertyKey(schema, "maxContains") && guard_exports.IsNumber(schema.maxContains);
}

// node_modules/typebox/build/schema/types/maxItems.mjs
function IsMaxItems(schema) {
  return guard_exports.HasPropertyKey(schema, "maxItems") && guard_exports.IsNumber(schema.maxItems);
}

// node_modules/typebox/build/schema/types/maxLength.mjs
function IsMaxLength3(schema) {
  return guard_exports.HasPropertyKey(schema, "maxLength") && guard_exports.IsNumber(schema.maxLength);
}

// node_modules/typebox/build/schema/types/maxProperties.mjs
function IsMaxProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "maxProperties") && guard_exports.IsNumber(schema.maxProperties);
}

// node_modules/typebox/build/schema/types/minimum.mjs
function IsMinimum(schema) {
  return guard_exports.HasPropertyKey(schema, "minimum") && (guard_exports.IsNumber(schema.minimum) || guard_exports.IsBigInt(schema.minimum));
}

// node_modules/typebox/build/schema/types/minContains.mjs
function IsMinContains(schema) {
  return guard_exports.HasPropertyKey(schema, "minContains") && guard_exports.IsNumber(schema.minContains);
}

// node_modules/typebox/build/schema/types/minItems.mjs
function IsMinItems(schema) {
  return guard_exports.HasPropertyKey(schema, "minItems") && guard_exports.IsNumber(schema.minItems);
}

// node_modules/typebox/build/schema/types/minLength.mjs
function IsMinLength3(schema) {
  return guard_exports.HasPropertyKey(schema, "minLength") && guard_exports.IsNumber(schema.minLength);
}

// node_modules/typebox/build/schema/types/minProperties.mjs
function IsMinProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "minProperties") && guard_exports.IsNumber(schema.minProperties);
}

// node_modules/typebox/build/schema/types/multipleOf.mjs
function IsMultipleOf2(schema) {
  return guard_exports.HasPropertyKey(schema, "multipleOf") && (guard_exports.IsNumber(schema.multipleOf) || guard_exports.IsBigInt(schema.multipleOf));
}

// node_modules/typebox/build/schema/types/not.mjs
function IsNot(schema) {
  return guard_exports.HasPropertyKey(schema, "not") && IsSchema(schema.not);
}

// node_modules/typebox/build/schema/types/oneOf.mjs
function IsOneOf(schema) {
  return guard_exports.HasPropertyKey(schema, "oneOf") && guard_exports.IsArray(schema.oneOf) && schema.oneOf.every((value) => IsSchema(value));
}

// node_modules/typebox/build/schema/types/pattern.mjs
function IsPattern(schema) {
  return guard_exports.HasPropertyKey(schema, "pattern") && (guard_exports.IsString(schema.pattern) || schema.pattern instanceof RegExp);
}

// node_modules/typebox/build/schema/types/patternProperties.mjs
function IsPatternProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "patternProperties") && guard_exports.IsObject(schema.patternProperties) && Object.values(schema.patternProperties).every((value) => IsSchema(value));
}

// node_modules/typebox/build/schema/types/prefixItems.mjs
function IsPrefixItems(schema) {
  return guard_exports.HasPropertyKey(schema, "prefixItems") && guard_exports.IsArray(schema.prefixItems) && schema.prefixItems.every((schema2) => IsSchema(schema2));
}

// node_modules/typebox/build/schema/types/properties.mjs
function IsProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "properties") && guard_exports.IsObject(schema.properties) && Object.values(schema.properties).every((value) => IsSchema(value));
}

// node_modules/typebox/build/schema/types/propertyNames.mjs
function IsPropertyNames(schema) {
  return guard_exports.HasPropertyKey(schema, "propertyNames") && (guard_exports.IsObject(schema.propertyNames) || IsSchema(schema.propertyNames));
}

// node_modules/typebox/build/schema/types/recursiveAnchor.mjs
function IsRecursiveAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$recursiveAnchor") && guard_exports.IsBoolean(schema.$recursiveAnchor);
}
function IsRecursiveAnchorTrue(schema) {
  return IsRecursiveAnchor(schema) && guard_exports.IsEqual(schema.$recursiveAnchor, true);
}

// node_modules/typebox/build/schema/types/recursiveRef.mjs
function IsRecursiveRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$recursiveRef") && guard_exports.IsString(schema.$recursiveRef);
}

// node_modules/typebox/build/schema/types/ref.mjs
function IsRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$ref") && guard_exports.IsString(schema.$ref);
}

// node_modules/typebox/build/schema/types/required.mjs
function IsRequired(schema) {
  return guard_exports.HasPropertyKey(schema, "required") && guard_exports.IsArray(schema.required) && schema.required.every((value) => guard_exports.IsString(value));
}

// node_modules/typebox/build/schema/types/then.mjs
function IsThen(schema) {
  return guard_exports.HasPropertyKey(schema, "then") && IsSchema(schema.then);
}

// node_modules/typebox/build/schema/types/type.mjs
function IsType(schema) {
  return guard_exports.HasPropertyKey(schema, "type") && (guard_exports.IsString(schema.type) || guard_exports.IsArray(schema.type) && schema.type.every((value) => guard_exports.IsString(value)));
}

// node_modules/typebox/build/schema/types/uniqueItems.mjs
function IsUniqueItems(schema) {
  return guard_exports.HasPropertyKey(schema, "uniqueItems") && guard_exports.IsBoolean(schema.uniqueItems);
}

// node_modules/typebox/build/schema/types/unevaluatedItems.mjs
function IsUnevaluatedItems(schema) {
  return guard_exports.HasPropertyKey(schema, "unevaluatedItems") && IsSchema(schema.unevaluatedItems);
}

// node_modules/typebox/build/schema/types/unevaluatedProperties.mjs
function IsUnevaluatedProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "unevaluatedProperties") && IsSchema(schema.unevaluatedProperties);
}

// node_modules/typebox/build/schema/engine/_context.mjs
var CheckContext = class {
  constructor() {
    const indices = /* @__PURE__ */ new Set();
    const keys = /* @__PURE__ */ new Set();
    this.stack = [{ indices, keys }];
  }
  // ----------------------------------------------------------------
  // Stack
  // ----------------------------------------------------------------
  Push() {
    const indices = /* @__PURE__ */ new Set();
    const keys = /* @__PURE__ */ new Set();
    this.stack.push({ indices, keys });
    return true;
  }
  Pop() {
    this.stack.pop();
    return true;
  }
  // ----------------------------------------------------------------
  // Top
  // ----------------------------------------------------------------
  AddIndex(index) {
    this.GetIndices().add(index);
    return true;
  }
  AddKey(key) {
    this.GetKeys().add(key);
    return true;
  }
  GetIndices() {
    const top = this.stack[this.stack.length - 1];
    return top.indices;
  }
  GetKeys() {
    const top = this.stack[this.stack.length - 1];
    return top.keys;
  }
  Merge(results) {
    for (const context2 of results) {
      context2.GetIndices().forEach((value) => this.GetIndices().add(value));
      context2.GetKeys().forEach((value) => this.GetKeys().add(value));
    }
    return true;
  }
};
var ErrorContext = class extends CheckContext {
  constructor() {
    super();
    this.errors = [];
  }
  AtCapacity() {
    return this.errors.length >= settings_exports.Get().maxErrors;
  }
  AddError(error) {
    if (!this.AtCapacity())
      this.errors.push(error);
    return false;
  }
  GetErrors() {
    return this.errors;
  }
};

// node_modules/typebox/build/schema/engine/_refine.mjs
function CheckRefine(_stack, _context, schema, value) {
  return guard_exports.Every(schema["~refine"], 0, (refinement, _) => refinement.check(value));
}
function ErrorRefine(_stack, context2, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(schema["~refine"], 0, (refinement, index) => {
    return refinement.check(value) || context2.AddError({
      keyword: "~refine",
      schemaPath,
      instancePath,
      params: { index, message: refinement.error(value) }
    });
  });
}

// node_modules/typebox/build/schema/engine/additionalItems.mjs
function IsValid(schema) {
  return IsItems(schema) && guard_exports.IsArray(schema.items);
}
function CheckAdditionalItems(stack, context2, schema, value) {
  if (!IsValid(schema))
    return true;
  const isAdditionalItems = guard_exports.Every(value, 0, (item, index) => {
    return guard_exports.IsLessThan(index, schema.items.length) || CheckSchemaPushStack(stack, context2, schema.additionalItems, item) && context2.AddIndex(index);
  });
  return isAdditionalItems;
}
function ErrorAdditionalItems(stack, context2, schemaPath, instancePath, schema, value) {
  if (!IsValid(schema))
    return true;
  const isAdditionalItems = guard_exports.Every(value, 0, (item, index) => {
    const nextSchemaPath = `${schemaPath}/additionalItems`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessThan(index, schema.items.length) || ErrorSchemaPushStack(stack, context2, nextSchemaPath, nextInstancePath, schema.additionalItems, item) && context2.AddIndex(index);
  });
  return isAdditionalItems;
}

// node_modules/typebox/build/schema/engine/_regexp.mjs
function UnicodeRegExp(pattern) {
  return new RegExp(pattern, "u");
}

// node_modules/typebox/build/schema/engine/additionalProperties.mjs
function GetPropertyKeyAsPattern(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escaped}$`;
}
function GetPropertiesPattern(schema) {
  const patterns = [];
  if (IsPatternProperties(schema))
    patterns.push(...guard_exports.Keys(schema.patternProperties));
  if (IsProperties(schema))
    patterns.push(...guard_exports.Keys(schema.properties).map(GetPropertyKeyAsPattern));
  return guard_exports.IsEqual(patterns.length, 0) ? "(?!)" : `(${patterns.join("|")})`;
}
function CheckAdditionalProperties(stack, context2, schema, value) {
  const regexp = UnicodeRegExp(GetPropertiesPattern(schema));
  const isAdditionalProperties = guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => {
    return regexp.test(key) || CheckSchemaPushStack(stack, context2, schema.additionalProperties, value[key]) && context2.AddKey(key);
  });
  return isAdditionalProperties;
}
function ErrorAdditionalProperties(stack, context2, schemaPath, instancePath, schema, value) {
  const regexp = UnicodeRegExp(GetPropertiesPattern(schema));
  const additionalProperties = [];
  const isAdditionalProperties = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
    const nextSchemaPath = `${schemaPath}/additionalProperties`;
    const nextInstancePath = `${instancePath}/${key}`;
    const isAdditionalProperty = regexp.test(key) || ErrorSchemaPushStack(stack, context2, nextSchemaPath, nextInstancePath, schema.additionalProperties, value[key]) && context2.AddKey(key);
    if (!isAdditionalProperty)
      additionalProperties.push(key);
    return isAdditionalProperty;
  });
  return isAdditionalProperties || context2.AddError({
    keyword: "additionalProperties",
    schemaPath,
    instancePath,
    params: { additionalProperties }
  });
}

// node_modules/typebox/build/schema/engine/allOf.mjs
function CheckAllOf(stack, context2, schema, value) {
  const results = schema.allOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsEqual(results.length, schema.allOf.length) && context2.Merge(results);
}
function ErrorAllOf(stack, context2, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const results = schema.allOf.reduce((result, schema2, index) => {
    const nextSchemaPath = `${schemaPath}/allOf/${index}`;
    const nextContext = new ErrorContext();
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isAllOf = guard_exports.IsEqual(results.length, schema.allOf.length) && context2.Merge(results);
  if (!isAllOf)
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context2.AddError(error)));
  return isAllOf;
}

// node_modules/typebox/build/schema/engine/anyOf.mjs
function CheckAnyOf(stack, context2, schema, value) {
  const results = schema.anyOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsGreaterThan(results.length, 0) && context2.Merge(results);
}
function ErrorAnyOf(stack, context2, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const results = schema.anyOf.reduce((result, schema2, index) => {
    const nextContext = new ErrorContext();
    const nextSchemaPath = `${schemaPath}/anyOf/${index}`;
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isAnyOf = guard_exports.IsGreaterThan(results.length, 0) && context2.Merge(results);
  if (!isAnyOf)
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context2.AddError(error)));
  return isAnyOf || context2.AddError({
    keyword: "anyOf",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/typebox/build/schema/engine/boolean.mjs
function CheckSchemaBoolean(_stack, _context, schema, _value) {
  return schema;
}
function ErrorSchemaBoolean(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckSchemaBoolean(stack, context2, schema, value) || context2.AddError({
    keyword: "boolean",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/typebox/build/schema/engine/const.mjs
function CheckConst(_stack, _context, schema, value) {
  return guard_exports.IsValueLike(schema.const) ? guard_exports.IsEqual(value, schema.const) : guard_exports.IsDeepEqual(value, schema.const);
}
function ErrorConst(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckConst(stack, context2, schema, value) || context2.AddError({
    keyword: "const",
    schemaPath,
    instancePath,
    params: { allowedValue: schema.const }
  });
}

// node_modules/typebox/build/schema/engine/contains.mjs
function IsValid2(schema) {
  return !(IsMinContains(schema) && guard_exports.IsEqual(schema.minContains, 0));
}
function CheckContains(stack, context2, schema, value) {
  if (!IsValid2(schema))
    return true;
  return !guard_exports.IsEqual(value.length, 0) && guard_exports.SomeAll(value, (item, index) => {
    return CheckSchema(stack, context2, schema.contains, item) && context2.AddIndex(index);
  });
}
function ErrorContains(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckContains(stack, context2, schema, value) || context2.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains: 1 }
  });
}

// node_modules/typebox/build/schema/engine/dependencies.mjs
function CheckDependencies(stack, context2, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
    return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((key2) => guard_exports.HasPropertyKey(value, key2)) : CheckSchema(stack, context2, schema2, value));
  });
  return isLength || isEvery;
}
function ErrorDependencies(stack, context2, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/dependencies/${key}`;
    return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((dependency) => guard_exports.HasPropertyKey(value, dependency) || context2.AddError({
      keyword: "dependencies",
      schemaPath,
      instancePath,
      params: { property: key, dependencies: schema2 }
    })) : ErrorSchema(stack, context2, nextSchemaPath, instancePath, schema2, value));
  });
  return isLength || isEvery;
}

// node_modules/typebox/build/schema/engine/dependentRequired.mjs
function CheckDependentRequired(_stack, _context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
    return !guard_exports.HasPropertyKey(value, key) || keys.every((key2) => guard_exports.HasPropertyKey(value, key2));
  });
  return isLength || isEvery;
}
function ErrorDependentRequired(_stack, context2, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEveryEntry = guard_exports.EveryAll(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
    return !guard_exports.HasPropertyKey(value, key) || guard_exports.EveryAll(keys, 0, (dependency) => guard_exports.HasPropertyKey(value, dependency) || context2.AddError({
      keyword: "dependentRequired",
      schemaPath,
      instancePath,
      params: { property: key, dependencies: keys }
    }));
  });
  return isLength || isEveryEntry;
}

// node_modules/typebox/build/schema/engine/dependentSchemas.mjs
function CheckDependentSchemas(stack, context2, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
    return !guard_exports.HasPropertyKey(value, key) || CheckSchema(stack, context2, schema2, value);
  });
  return isLength || isEvery;
}
function ErrorDependentSchemas(stack, context2, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/dependentSchemas/${key}`;
    return !guard_exports.HasPropertyKey(value, key) || ErrorSchema(stack, context2, nextSchemaPath, instancePath, schema2, value);
  });
  return isLength || isEvery;
}

// node_modules/typebox/build/schema/engine/dynamicRef.mjs
function CheckDynamicRef(stack, context2, schema, value) {
  const target = stack.DynamicRef(schema) ?? false;
  return IsSchema(target) && CheckSchema(stack, context2, target, value);
}
function ErrorDynamicRef(stack, context2, _schemaPath, instancePath, schema, value) {
  const target = stack.DynamicRef(schema) ?? false;
  return IsSchema(target) && ErrorSchema(stack, context2, "#", instancePath, target, value);
}

// node_modules/typebox/build/schema/engine/enum.mjs
function CheckEnum(_stack, _context, schema, value) {
  return guard_exports.Some(schema.enum, (option) => guard_exports.IsValueLike(option) ? guard_exports.IsEqual(value, option) : guard_exports.IsDeepEqual(value, option));
}
function ErrorEnum(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckEnum(stack, context2, schema, value) || context2.AddError({
    keyword: "enum",
    schemaPath,
    instancePath,
    params: { allowedValues: schema.enum }
  });
}

// node_modules/typebox/build/schema/engine/exclusiveMaximum.mjs
function CheckExclusiveMaximum(_stack, _context, schema, value) {
  return guard_exports.IsLessThan(value, schema.exclusiveMaximum);
}
function ErrorExclusiveMaximum(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckExclusiveMaximum(stack, context2, schema, value) || context2.AddError({
    keyword: "exclusiveMaximum",
    schemaPath,
    instancePath,
    params: { comparison: "<", limit: schema.exclusiveMaximum }
  });
}

// node_modules/typebox/build/schema/engine/exclusiveMinimum.mjs
function CheckExclusiveMinimum(_stack, _context, schema, value) {
  return guard_exports.IsGreaterThan(value, schema.exclusiveMinimum);
}
function ErrorExclusiveMinimum(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckExclusiveMinimum(stack, context2, schema, value) || context2.AddError({
    keyword: "exclusiveMinimum",
    schemaPath,
    instancePath,
    params: { comparison: ">", limit: schema.exclusiveMinimum }
  });
}

// node_modules/typebox/build/format/format.mjs
var format_exports = {};
__export(format_exports, {
  Clear: () => Clear,
  Entries: () => Entries2,
  Get: () => Get2,
  Has: () => Has,
  IsDate: () => IsDate2,
  IsDateTime: () => IsDateTime,
  IsDuration: () => IsDuration,
  IsEmail: () => IsEmail,
  IsHostname: () => IsHostname2,
  IsIPv4: () => IsIPv4,
  IsIPv6: () => IsIPv6,
  IsIdnEmail: () => IsIdnEmail,
  IsIdnHostname: () => IsIdnHostname2,
  IsIri: () => IsIri,
  IsIriReference: () => IsIriReference,
  IsJsonPointer: () => IsJsonPointer,
  IsJsonPointerUriFragment: () => IsJsonPointerUriFragment,
  IsRegex: () => IsRegex,
  IsRelativeJsonPointer: () => IsRelativeJsonPointer,
  IsTime: () => IsTime,
  IsUri: () => IsUri,
  IsUriReference: () => IsUriReference,
  IsUriTemplate: () => IsUriTemplate,
  IsUrl: () => IsUrl,
  IsUuid: () => IsUuid,
  Reset: () => Reset2,
  Set: () => Set3,
  Test: () => Test
});

// node_modules/typebox/build/format/date.mjs
var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
function IsLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function IsDate2(value) {
  const matches = DATE.exec(value);
  if (!matches)
    return false;
  const year = +matches[1];
  const month = +matches[2];
  const day = +matches[3];
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && IsLeapYear(year) ? 29 : DAYS[month]);
}

// node_modules/typebox/build/format/time.mjs
var TIME = /^(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:([Zz])|([+-])(\d\d):(\d\d))?$/;
function IsTime(value, strictTimeZone = true) {
  const matches = TIME.exec(value);
  if (!matches)
    return false;
  if (strictTimeZone && !matches[4] && !matches[5])
    return false;
  const hr = +matches[1];
  const min = +matches[2];
  const sec = +matches[3];
  if (hr > 23 || min > 59 || sec > 60)
    return false;
  if (matches[5]) {
    const tzH2 = +matches[6];
    const tzM2 = +matches[7];
    if (tzH2 > 23 || tzM2 > 59)
      return false;
  }
  if (sec < 60)
    return true;
  const tzSign = matches[5] === "-" ? -1 : 1;
  const tzH = +(matches[6] || 0);
  const tzM = +(matches[7] || 0);
  const totalUtcMin = hr * 60 + min - tzSign * (tzH * 60 + tzM);
  return (totalUtcMin % 1440 + 1440) % 1440 === 1439;
}

// node_modules/typebox/build/format/date_time.mjs
function IsDateTime(value) {
  const dateTime = value.split(/T/i);
  return dateTime.length === 2 && IsDate2(dateTime[0]) && IsTime(dateTime[1]);
}

// node_modules/typebox/build/format/duration.mjs
var Duration = /^P((\d+Y(\d+M(\d+D)?)?|\d+M(\d+D)?|\d+D)(T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S))?|T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S)|\d+W)$/;
function IsDuration(value) {
  return Duration.test(value);
}

// node_modules/typebox/build/format/email.mjs
var Email = /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[^"\\]|\\[\x20-\x7e])*")@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[(?:IPv6:[a-f0-9:]+|(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3})\])$/i;
function IsEmail(value) {
  return Email.test(value);
}

// node_modules/typebox/build/format/idna/pattern/pattern.mjs
var RE_RULE_HYPHEN_PLACEMENT = /^(?!-).*(?<!-)$/;
var RE_RULE_NOT_RESERVED_ACE = /^(?!..--)/;
var RE_ASCII_LDH = /^[a-zA-Z0-9-]*$/;
var RE_ASCII = new RegExp("^\\p{ASCII}*$", "u");
var RE_NON_ASCII = /[^\p{ASCII}]/u;
var RE_ASCII_DIGIT = /[0-9]/;
var RE_ARABIC_INDIC_DIGIT = /[\u{0660}-\u{0669}]/u;
var RE_EXT_ARABIC_INDIC_DIGIT = /[\u{06f0}-\u{06f9}]/u;
var RE_COMMON_SEPARATOR = /[\u{002e}\u{002c}\u{003a}\u{002f}]/u;
var RE_EUROPEAN_SEPARATOR = /[\u{002d}\u{002b}]/u;
var RE_MARK_NONSPACING = new RegExp("\\p{Mn}", "u");
var RE_MARK_SPACING_COMBINING = new RegExp("\\p{Mc}", "u");
var RE_MARK_ENCLOSING = new RegExp("\\p{Me}", "u");
var RE_COMBINING_MARK = /[\p{Mn}\p{Mc}\p{Me}]/u;
var RE_LETTER = new RegExp("\\p{L}", "u");
var RE_NUMBER_DECIMAL = new RegExp("\\p{Nd}", "u");
var RE_SCRIPT_GREEK = new RegExp("\\p{Script=Greek}", "u");
var RE_SCRIPT_HEBREW = new RegExp("\\p{Script=Hebrew}", "u");
var RE_SCRIPT_JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
var RE_SCRIPT_ARABIC_LETTER = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Mandaic}]/u;
var RE_VIRAMA = /[\u{094d}\u{09cd}\u{0a4d}\u{0acd}\u{0b4d}\u{0bcd}\u{0c4d}\u{0ccd}\u{0d3b}\u{0d3c}\u{0d4d}\u{0dca}\u{1b44}\u{1baa}\u{1bab}\u{a9c0}\u{11046}\u{1107f}\u{110b9}\u{11133}\u{11134}\u{111c0}\u{11235}\u{1134d}\u{11442}\u{114c2}\u{115bf}\u{1163f}\u{116b6}\u{11c3f}\u{11d44}\u{11d45}]/u;
var RE_RFC5892_DISALLOWED = /[\u{0640}\u{07fa}\u{302e}\u{302f}\u{3031}\u{3032}\u{3033}\u{3034}\u{3035}\u{303b}]/u;
var RE_CONTEXTO_EXCEPTIONS = /[\u{00b7}\u{0375}\u{05f3}\u{05f4}\u{200c}\u{200d}\u{30fb}]/u;
var RE_PVALID_EXCEPTIONS = /[\u{00df}\u{03c2}\u{06fd}\u{06fe}\u{0f0b}\u{3007}]/u;
var RE_EUROPEAN_NUMBER = new RegExp([
  RE_ASCII_DIGIT,
  RE_EXT_ARABIC_INDIC_DIGIT
].map((regexp) => regexp.source).join("|"), "u");
var RE_PERMITTED_CATEGORY = new RegExp([
  RE_LETTER,
  RE_EUROPEAN_SEPARATOR,
  RE_COMMON_SEPARATOR,
  RE_NUMBER_DECIMAL,
  RE_MARK_NONSPACING,
  RE_MARK_SPACING_COMBINING,
  RE_CONTEXTO_EXCEPTIONS,
  RE_PVALID_EXCEPTIONS
].map((regexp) => regexp.source).join("|"), "u");

// node_modules/typebox/build/format/idna/label/ascii.mjs
function IsAsciiLabel(value) {
  return RE_RULE_HYPHEN_PLACEMENT.test(value) && RE_RULE_NOT_RESERVED_ACE.test(value) && RE_ASCII_LDH.test(value);
}

// node_modules/typebox/build/format/idna/format/puny.mjs
var PUNYCODE_BASE = 36;
var PUNYCODE_TMIN = 1;
var PUNYCODE_TMAX = 26;
var PUNYCODE_SKEW = 38;
var PUNYCODE_DAMP = 700;
var PUNYCODE_INITIAL_BIAS = 72;
var PUNYCODE_INITIAL_N = 128;
function ThrowDontCare() {
  throw null;
}
function IsAcePrefixed(value) {
  return value.toLowerCase().startsWith("xn--");
}
function Adapt(delta, numPoints, firstTime) {
  delta = firstTime ? Math.floor(delta / PUNYCODE_DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > (PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX >> 1) {
    delta = Math.floor(delta / (PUNYCODE_BASE - PUNYCODE_TMIN));
    k += PUNYCODE_BASE;
  }
  return k + Math.floor((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * delta / (delta + PUNYCODE_SKEW));
}
function Decode(value) {
  const output = [];
  let n = PUNYCODE_INITIAL_N;
  let i = 0;
  let bias = PUNYCODE_INITIAL_BIAS;
  const delimIdx = value.lastIndexOf("-");
  if (delimIdx > 0) {
    for (let j = 0; j < delimIdx; j++) {
      const cp2 = value.charCodeAt(j);
      if (cp2 >= 128)
        ThrowDontCare();
      output.push(cp2);
    }
  }
  let inIdx = delimIdx < 0 ? 0 : delimIdx + 1;
  while (inIdx < value.length) {
    const oldi = i;
    let w = 1;
    let k = PUNYCODE_BASE;
    while (true) {
      if (inIdx >= value.length)
        ThrowDontCare();
      const ch = value.charCodeAt(inIdx++);
      let digit;
      if (ch >= 97 && ch <= 122)
        digit = ch - 97;
      else if (ch >= 48 && ch <= 57)
        digit = ch - 48 + 26;
      else
        ThrowDontCare();
      i += digit * w;
      const t = k <= bias ? PUNYCODE_TMIN : k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias;
      if (digit < t)
        break;
      w *= PUNYCODE_BASE - t;
      k += PUNYCODE_BASE;
    }
    const outLen = output.length + 1;
    bias = Adapt(i - oldi, outLen, oldi === 0);
    n += Math.floor(i / outLen);
    i %= outLen;
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}
function DigitToChar(digit) {
  return digit < 26 ? String.fromCharCode(digit + 97) : String.fromCharCode(digit - 26 + 48);
}
var RE_REPLACE_NON_ASCII = new RegExp(RE_NON_ASCII.source, "gu");
function Encode(input) {
  const basic = input.replace(RE_REPLACE_NON_ASCII, "");
  const basicLength = basic.length;
  const result = basicLength > 0 ? [basic, "-"] : [];
  const codePoints = Array.from(input, (char) => char.codePointAt(0));
  let n = PUNYCODE_INITIAL_N;
  let delta = 0;
  let bias = PUNYCODE_INITIAL_BIAS;
  let handledCPCount = basicLength;
  while (handledCPCount < codePoints.length) {
    let m = Infinity;
    for (const cp2 of codePoints) {
      if (cp2 >= n && cp2 < m)
        m = cp2;
    }
    delta += (m - n) * (handledCPCount + 1);
    n = m;
    for (const cp2 of codePoints) {
      if (cp2 < n)
        delta++;
      if (cp2 === n) {
        let q = delta;
        for (let k = PUNYCODE_BASE; ; k += PUNYCODE_BASE) {
          const t = k <= bias ? PUNYCODE_TMIN : k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias;
          if (q < t)
            break;
          const digit = t + (q - t) % (PUNYCODE_BASE - t);
          result.push(DigitToChar(digit));
          q = Math.floor((q - t) / (PUNYCODE_BASE - t));
        }
        result.push(DigitToChar(q));
        bias = Adapt(delta, handledCPCount + 1, handledCPCount === basicLength);
        delta = 0;
        handledCPCount++;
      }
    }
    delta++;
    n++;
  }
  return result.join("");
}

// node_modules/typebox/build/format/idna/format/bidi.mjs
var RE_RTL_ALLOWED = /^(?:R|AL|AN|EN|ES|CS|ET|ON|BN|NSM)$/;
var RE_LTR_ALLOWED = /^(?:L|EN|ES|CS|ET|ON|BN|NSM)$/;
var RE_RTL_CLASSES = /^(?:R|AL|AN)$/;
function HasBidiChars(value) {
  if (IsAcePrefixed(value)) {
    try {
      return HasRightToLeftCharacters(Decode(value.slice(4).toLowerCase()));
    } catch {
      return false;
    }
  }
  return HasRightToLeftCharacters(value);
}
function GetBidiClass(codePoint) {
  const char = String.fromCodePoint(codePoint);
  return RE_EUROPEAN_NUMBER.test(char) ? "EN" : RE_ARABIC_INDIC_DIGIT.test(char) ? "AN" : (
    // Pattern.RE_EUROPEAN_SEPARATOR.test(char) ? 'ES' : // (no-spec-coverage)
    // Pattern.RE_COMMON_SEPARATOR.test(char) ? 'CS' : // (no-spec-coverage)
    RE_MARK_NONSPACING.test(char) ? "NSM" : RE_SCRIPT_HEBREW.test(char) ? "R" : RE_SCRIPT_ARABIC_LETTER.test(char) ? "AL" : RE_LETTER.test(char) ? "L" : "ON"
  );
}
function HasRightToLeftCharacters(value) {
  for (const ch of value)
    if (RE_RTL_CLASSES.test(GetBidiClass(ch.codePointAt(0))))
      return true;
  return false;
}
function SatisfiesBidiRule(value) {
  let isRtl = false;
  let allowed = RE_LTR_ALLOWED;
  let sawEN = false;
  let sawAN = false;
  let isFirst = true;
  for (const ch of value) {
    const bidiClass = GetBidiClass(ch.codePointAt(0));
    if (isFirst) {
      if (bidiClass !== "L" && bidiClass !== "R" && bidiClass !== "AL")
        return false;
      isRtl = bidiClass === "R" || bidiClass === "AL";
      allowed = isRtl ? RE_RTL_ALLOWED : RE_LTR_ALLOWED;
      isFirst = false;
    }
    if (!allowed.test(bidiClass))
      return false;
    if (bidiClass === "EN")
      sawEN = true;
    else if (bidiClass === "AN")
      sawAN = true;
  }
  if (isRtl && sawEN && sawAN)
    return false;
  return true;
}

// node_modules/typebox/build/format/idna/label/unicode.mjs
function ExceedsMaxALabelLength(value) {
  return RE_NON_ASCII.test(value) && Encode(value).length + 4 > 63;
}
function HasInvalidHyphens(chars) {
  if (chars[0] === "-" || chars[chars.length - 1] === "-")
    return true;
  return chars.slice(2).join("").startsWith("--");
}
function IsUnicodeLabel(value) {
  if (ExceedsMaxALabelLength(value))
    return false;
  if (HasRightToLeftCharacters(value) && !SatisfiesBidiRule(value))
    return false;
  const chars = [...value];
  const codePoints = chars.map((c) => c.codePointAt(0));
  const length = codePoints.length;
  if (HasInvalidHyphens(chars))
    return false;
  if (RE_COMBINING_MARK.test(chars[0]))
    return false;
  let hasJapanese = false;
  for (let i = 0; i < length; i++) {
    const codePoint = codePoints[i];
    const char = chars[i];
    if (RE_RFC5892_DISALLOWED.test(char))
      return false;
    if (!RE_PERMITTED_CATEGORY.test(char))
      return false;
    if (RE_SCRIPT_JAPANESE.test(char))
      hasJapanese = true;
    const prev = codePoints[i - 1], next = codePoints[i + 1];
    switch (codePoint) {
      case 183:
        if (prev !== 108 || next !== 108)
          return false;
        break;
      // MIDDLE DOT (Catalan)
      case 885:
        if (!next || !RE_SCRIPT_GREEK.test(chars[i + 1]))
          return false;
        break;
      // Greek KERAIA
      case 1523:
      case 1524:
        if (!prev || !RE_SCRIPT_HEBREW.test(chars[i - 1]))
          return false;
        break;
      // Hebrew GERESH
      case 8204:
        if (!prev || prev < 128 && !RE_VIRAMA.test(chars[i - 1]))
          return false;
        break;
      case 8205:
        if (!prev || !RE_VIRAMA.test(chars[i - 1]))
          return false;
        break;
      case 12539:
        break;
    }
  }
  if (value.includes("\u30FB") && !hasJapanese)
    return false;
  return true;
}

// node_modules/typebox/build/format/idna/label/puny.mjs
function IsPunyLabel(value) {
  if (!IsAcePrefixed(value))
    return false;
  try {
    const body = value.slice(4).toLowerCase();
    if (body.lastIndexOf("-") === 0)
      return false;
    const decoded = Decode(body);
    if (!RE_NON_ASCII.test(decoded))
      return false;
    return IsUnicodeLabel(decoded);
  } catch {
    return false;
  }
}

// node_modules/typebox/build/format/idna/hostname.mjs
function IsValidLabelLength(value) {
  return value.length > 0 && value.length <= 63;
}
function IsLabel(value) {
  return IsValidLabelLength(value) && (IsPunyLabel(value) || IsAsciiLabel(value));
}
function IsHostname(value) {
  if (value.length === 0 || value.length > 253)
    return false;
  if (value.charCodeAt(value.length - 1) === 46)
    return false;
  return value.split(".").every((label) => IsLabel(label));
}

// node_modules/typebox/build/format/idna/idn-hostname.mjs
function IsValidLabelLength2(value) {
  return value.length > 0 && value.length <= 63;
}
function IsLabel2(value) {
  return IsValidLabelLength2(value) && (IsPunyLabel(value) || IsUnicodeLabel(value));
}
function NormalizeHostname(value) {
  return value.replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248)).normalize("NFC").replace(/[\u00ad\u034f\u180b-\u180d\u200b\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu, "").replace(/[\u002E\u3002\uFF0E\uFF61]/g, ".");
}
function IsIdnHostname(value) {
  if (value.length === 0 || value.includes(" "))
    return false;
  const normalized = NormalizeHostname(value);
  if (normalized.length > 253)
    return false;
  const labels = normalized.split(".");
  const hasBidiChars = labels.some((label) => HasBidiChars(label));
  return labels.every((label) => IsLabel2(label) && (!hasBidiChars || SatisfiesBidiRule(label)));
}

// node_modules/typebox/build/format/hostname.mjs
function IsHostname2(value) {
  return IsHostname(value);
}

// node_modules/typebox/build/format/idn_email.mjs
var IdnEmail = /^(?:[A-Za-z0-9!#$%&'*+\/=?^_`{|}~\u{0080}-\u{10FFFF}-]+(?:\.[A-Za-z0-9!#$%&'*+\/=?^_`{|}~\u{0080}-\u{10FFFF}-]+)*|"(?:[^"\\]|\\.)*")@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62})(?<!-)(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62})(?<!-))*$/iu;
function IsIdnEmail(value) {
  return IdnEmail.test(value.normalize("NFC"));
}

// node_modules/typebox/build/format/idn_hostname.mjs
function IsIdnHostname2(value) {
  return IsIdnHostname(value);
}

// node_modules/typebox/build/format/ipv4.mjs
var IPv4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
function IsIPv4(value) {
  return IPv4.test(value);
}

// node_modules/typebox/build/format/ipv6.mjs
var IPv6 = /^(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:)?[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)$/i;
function IsIPv6(value) {
  return IPv6.test(value);
}

// node_modules/typebox/build/format/iri_reference.mjs
var InvalidIriChars = /[\x00-\x20\x7F\\]|%(?![0-9a-fA-F]{2})/;
var MalformedScheme = /^[a-zA-Z][a-zA-Z0-9+\-.]*\/\//;
function IsIriReference(value) {
  return !InvalidIriChars.test(value) && !MalformedScheme.test(value) && URL.canParse(value, "http://example.com");
}

// node_modules/typebox/build/format/iri.mjs
var IpvFutureMatchMaxLength = 2048;
var IpvFutureMatch = /\[[vV][0-9a-fA-F]+\.[^\]]+\]/;
var InvalidIriChars2 = /[\x00-\x20<>\^`{|}\\]/;
var InvalidPercentEncoding = /%(?![0-9a-fA-F]{2})/;
function NarrowIpvFuture(value) {
  return value.length < IpvFutureMatchMaxLength ? value.replace(IpvFutureMatch, "[::1]") : value;
}
function IsIri(value) {
  if (InvalidIriChars2.test(value))
    return false;
  if (InvalidPercentEncoding.test(value))
    return false;
  return URL.canParse(NarrowIpvFuture(value));
}

// node_modules/typebox/build/format/json_pointer_uri_fragment.mjs
var JsonPointerUriFragment = /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
function IsJsonPointerUriFragment(value) {
  return JsonPointerUriFragment.test(value);
}

// node_modules/typebox/build/format/json_pointer.mjs
var JsonPointer = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
function IsJsonPointer(value) {
  return JsonPointer.test(value);
}

// node_modules/typebox/build/format/regex.mjs
function IsRegex(value) {
  try {
    new RegExp(value, "u");
    return true;
  } catch {
    return false;
  }
}

// node_modules/typebox/build/format/relative_json_pointer.mjs
var RelativeJsonPointer = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/;
function IsRelativeJsonPointer(value) {
  return RelativeJsonPointer.test(value);
}

// node_modules/typebox/build/format/uri_reference.mjs
var UriReference = /^(?:[a-z][a-z0-9+\-.]*:(?:\/\/(?:(?:[-a-z0-9._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:[\da-f]{1,4}:){6}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|::(?:[\da-f]{1,4}:){5}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:[\da-f]{1,4})?::(?:[\da-f]{1,4}:){4}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,1}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){3}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,2}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){2}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,3}[\da-f]{1,4})?::[\da-f]{1,4}:(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,4}[\da-f]{1,4})?::(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,5}[\da-f]{1,4})?::[\da-f]{1,4}|(?:(?:[\da-f]{1,4}:){0,6}[\da-f]{1,4})?::)|v[0-9a-f]+\.[-a-z0-9._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[-a-z0-9._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:\/\/(?:(?:[-a-z0-9._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:[\da-f]{1,4}:){6}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|::(?:[\da-f]{1,4}:){5}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:[\da-f]{1,4})?::(?:[\da-f]{1,4}:){4}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,1}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){3}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,2}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){2}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,3}[\da-f]{1,4})?::[\da-f]{1,4}:(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,4}[\da-f]{1,4})?::(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,5}[\da-f]{1,4})?::[\da-f]{1,4}|(?:(?:[\da-f]{1,4}:){0,6}[\da-f]{1,4})?::)|v[0-9a-f]+\.[-a-z0-9._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[-a-z0-9._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[-a-z0-9._~!$&'()*+,;=@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?)(?:\?(?:[-a-z0-9._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[-a-z0-9._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
function IsUriReference(value) {
  return UriReference.test(value);
}

// node_modules/typebox/build/format/uri_template.mjs
var UriTemplate = /^(?:(?:[^\x00-\x20"<>%\\^`{|}\x7f]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?:\.(?:[a-z0-9_]|%[0-9a-f]{2})+)*(?::[1-9]\d{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?:\.(?:[a-z0-9_]|%[0-9a-f]{2})+)*(?::[1-9]\d{0,3}|\*)?)*\})*$/i;
function IsUriTemplate(value) {
  return UriTemplate.test(value);
}

// node_modules/typebox/build/format/uri.mjs
var Uri = /^[a-z][a-z0-9+\-.]*:(?:\/\/(?:(?:[-a-z0-9._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:[\da-f]{1,4}:){6}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|::(?:[\da-f]{1,4}:){5}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:[\da-f]{1,4})?::(?:[\da-f]{1,4}:){4}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,1}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){3}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,2}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){2}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,3}[\da-f]{1,4})?::[\da-f]{1,4}:(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,4}[\da-f]{1,4})?::(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,5}[\da-f]{1,4})?::[\da-f]{1,4}|(?:(?:[\da-f]{1,4}:){0,6}[\da-f]{1,4})?::)|v[0-9a-f]+\.[-a-z0-9._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[-a-z0-9._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[-a-z0-9._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[-a-z0-9._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
function IsUri(value) {
  return Uri.test(value);
}

// node_modules/typebox/build/format/url.mjs
function IsUrl(value) {
  return URL.canParse(value);
}

// node_modules/typebox/build/format/uuid.mjs
var Uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function IsUuid(value) {
  return Uuid.test(value);
}

// node_modules/typebox/build/format/_registry.mjs
var formats = /* @__PURE__ */ new Map();
function Clear() {
  formats.clear();
}
function Entries2() {
  return [...formats.entries()];
}
function Set3(format, check) {
  formats.set(format, check);
}
function Has(format) {
  return formats.has(format);
}
function Get2(format) {
  return formats.get(format);
}
function Test(format, value) {
  return formats.get(format)?.(value) ?? true;
}
function Reset2() {
  Clear();
  formats.set("date-time", IsDateTime);
  formats.set("date", IsDate2);
  formats.set("duration", IsDuration);
  formats.set("email", IsEmail);
  formats.set("hostname", IsHostname2);
  formats.set("idn-email", IsIdnEmail);
  formats.set("idn-hostname", IsIdnHostname2);
  formats.set("ipv4", IsIPv4);
  formats.set("ipv6", IsIPv6);
  formats.set("iri-reference", IsIriReference);
  formats.set("iri", IsIri);
  formats.set("json-pointer-uri-fragment", IsJsonPointerUriFragment);
  formats.set("json-pointer", IsJsonPointer);
  formats.set("regex", IsRegex);
  formats.set("relative-json-pointer", IsRelativeJsonPointer);
  formats.set("time", IsTime);
  formats.set("uri-reference", IsUriReference);
  formats.set("uri-template", IsUriTemplate);
  formats.set("uri", IsUri);
  formats.set("url", IsUrl);
  formats.set("uuid", IsUuid);
}
Reset2();

// node_modules/typebox/build/schema/engine/format.mjs
function CheckFormat(_stack, _context, schema, value) {
  return format_exports.Test(schema.format, value);
}
function ErrorFormat(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckFormat(stack, context2, schema, value) || context2.AddError({
    keyword: "format",
    schemaPath,
    instancePath,
    params: { format: schema.format }
  });
}

// node_modules/typebox/build/schema/engine/if.mjs
function CheckIf(stack, context2, schema, value) {
  const thenSchema = IsThen(schema) ? schema.then : true;
  const elseSchema = IsElse(schema) ? schema.else : true;
  return CheckSchema(stack, context2, schema.if, value) ? CheckSchema(stack, context2, thenSchema, value) : CheckSchema(stack, context2, elseSchema, value);
}
function ErrorIf(stack, context2, schemaPath, instancePath, schema, value) {
  const thenSchema = IsThen(schema) ? schema.then : true;
  const elseSchema = IsElse(schema) ? schema.else : true;
  const trueContext = new ErrorContext();
  const isIf = ErrorSchema(stack, trueContext, `${schemaPath}/if`, instancePath, schema.if, value) ? ErrorSchema(stack, trueContext, `${schemaPath}/then`, instancePath, thenSchema, value) || context2.AddError({
    keyword: "if",
    schemaPath,
    instancePath,
    params: { failingKeyword: "then" }
  }) : ErrorSchema(stack, context2, `${schemaPath}/else`, instancePath, elseSchema, value) || context2.AddError({
    keyword: "if",
    schemaPath,
    instancePath,
    params: { failingKeyword: "else" }
  });
  if (isIf)
    context2.Merge([trueContext]);
  return isIf;
}

// node_modules/typebox/build/schema/engine/items.mjs
function CheckItemsSized(stack, context2, schema, value) {
  return guard_exports.Every(schema.items, 0, (schema2, index) => {
    return guard_exports.IsLessEqualThan(value.length, index) || CheckSchemaPushStack(stack, context2, schema2, value[index]) && context2.AddIndex(index);
  });
}
function ErrorItemsSized(stack, context2, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(schema.items, 0, (schema2, index) => {
    const nextSchemaPath = `${schemaPath}/items/${index}`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessEqualThan(value.length, index) || ErrorSchemaPushStack(stack, context2, nextSchemaPath, nextInstancePath, schema2, value[index]) && context2.AddIndex(index);
  });
}
function CheckItemsUnsized(stack, context2, schema, value) {
  const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
  return guard_exports.Every(value, offset, (element, index) => {
    return CheckSchemaPushStack(stack, context2, schema.items, element) && context2.AddIndex(index);
  });
}
function ErrorItemsUnsized(stack, context2, schemaPath, instancePath, schema, value) {
  const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
  return guard_exports.EveryAll(value, offset, (element, index) => {
    const nextSchemaPath = `${schemaPath}/items`;
    const nextInstancePath = `${instancePath}/${index}`;
    return ErrorSchemaPushStack(stack, context2, nextSchemaPath, nextInstancePath, schema.items, element) && context2.AddIndex(index);
  });
}
function CheckItems(stack, context2, schema, value) {
  return IsItemsSized(schema) ? CheckItemsSized(stack, context2, schema, value) : CheckItemsUnsized(stack, context2, schema, value);
}
function ErrorItems(stack, context2, schemaPath, instancePath, schema, value) {
  return IsItemsSized(schema) ? ErrorItemsSized(stack, context2, schemaPath, instancePath, schema, value) : ErrorItemsUnsized(stack, context2, schemaPath, instancePath, schema, value);
}

// node_modules/typebox/build/schema/engine/maxContains.mjs
function IsValid3(schema) {
  return IsContains(schema);
}
function CheckMaxContains(stack, context2, schema, value) {
  if (!IsValid3(schema))
    return true;
  const count = guard_exports.Counted(value, (item) => CheckSchema(stack, context2, schema.contains, item));
  return guard_exports.IsLessEqualThan(count, schema.maxContains);
}
function ErrorMaxContains(stack, context2, schemaPath, instancePath, schema, value) {
  const minContains = IsMinContains(schema) ? schema.minContains : 1;
  return CheckMaxContains(stack, context2, schema, value) || context2.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains, maxContains: schema.maxContains }
  });
}

// node_modules/typebox/build/schema/engine/maximum.mjs
function CheckMaximum(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(value, schema.maximum);
}
function ErrorMaximum(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckMaximum(stack, context2, schema, value) || context2.AddError({
    keyword: "maximum",
    schemaPath,
    instancePath,
    params: { comparison: "<=", limit: schema.maximum }
  });
}

// node_modules/typebox/build/schema/engine/maxItems.mjs
function CheckMaxItems(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(value.length, schema.maxItems);
}
function ErrorMaxItems(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckMaxItems(stack, context2, schema, value) || context2.AddError({
    keyword: "maxItems",
    schemaPath,
    instancePath,
    params: { limit: schema.maxItems }
  });
}

// node_modules/typebox/build/schema/engine/maxLength.mjs
function CheckMaxLength(_stack, _context, schema, value) {
  return guard_exports.IsMaxLength(value, schema.maxLength);
}
function ErrorMaxLength(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckMaxLength(stack, context2, schema, value) || context2.AddError({
    keyword: "maxLength",
    schemaPath,
    instancePath,
    params: { limit: schema.maxLength }
  });
}

// node_modules/typebox/build/schema/engine/maxProperties.mjs
function CheckMaxProperties(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(guard_exports.Keys(value).length, schema.maxProperties);
}
function ErrorMaxProperties(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckMaxProperties(stack, context2, schema, value) || context2.AddError({
    keyword: "maxProperties",
    schemaPath,
    instancePath,
    params: { limit: schema.maxProperties }
  });
}

// node_modules/typebox/build/schema/engine/minContains.mjs
function IsValid4(schema) {
  return IsContains(schema);
}
function CheckMinContains(stack, context2, schema, value) {
  if (!IsValid4(schema))
    return true;
  const count = guard_exports.Counted(value, (item, index) => CheckSchema(stack, context2, schema.contains, item) && context2.AddIndex(index));
  return guard_exports.IsGreaterEqualThan(count, schema.minContains);
}
function ErrorMinContains(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckMinContains(stack, context2, schema, value) || context2.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains: schema.minContains }
  });
}

// node_modules/typebox/build/schema/engine/minimum.mjs
function CheckMinimum(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(value, schema.minimum);
}
function ErrorMinimum(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckMinimum(stack, context2, schema, value) || context2.AddError({
    keyword: "minimum",
    schemaPath,
    instancePath,
    params: { comparison: ">=", limit: schema.minimum }
  });
}

// node_modules/typebox/build/schema/engine/minItems.mjs
function CheckMinItems(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(value.length, schema.minItems);
}
function ErrorMinItems(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckMinItems(stack, context2, schema, value) || context2.AddError({
    keyword: "minItems",
    schemaPath,
    instancePath,
    params: { limit: schema.minItems }
  });
}

// node_modules/typebox/build/schema/engine/minLength.mjs
function CheckMinLength(_stack, _context, schema, value) {
  return guard_exports.IsMinLength(value, schema.minLength);
}
function ErrorMinLength(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckMinLength(stack, context2, schema, value) || context2.AddError({
    keyword: "minLength",
    schemaPath,
    instancePath,
    params: { limit: schema.minLength }
  });
}

// node_modules/typebox/build/schema/engine/minProperties.mjs
function CheckMinProperties(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(guard_exports.Keys(value).length, schema.minProperties);
}
function ErrorMinProperties(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckMinProperties(stack, context2, schema, value) || context2.AddError({
    keyword: "minProperties",
    schemaPath,
    instancePath,
    params: { limit: schema.minProperties }
  });
}

// node_modules/typebox/build/schema/engine/multipleOf.mjs
function CheckMultipleOf(_stack, _context, schema, value) {
  return guard_exports.IsMultipleOf(value, schema.multipleOf);
}
function ErrorMultipleOf(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckMultipleOf(stack, context2, schema, value) || context2.AddError({
    keyword: "multipleOf",
    schemaPath,
    instancePath,
    params: { multipleOf: schema.multipleOf }
  });
}

// node_modules/typebox/build/schema/engine/not.mjs
function CheckNot(stack, context2, schema, value) {
  const nextContext = new CheckContext();
  const isSchema = !CheckSchema(stack, nextContext, schema.not, value);
  const isNot = isSchema && context2.Merge([nextContext]);
  return isNot;
}
function ErrorNot(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckNot(stack, context2, schema, value) || context2.AddError({
    keyword: "not",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/typebox/build/schema/engine/oneOf.mjs
function CheckOneOf(stack, context2, schema, value) {
  const passedContexts = schema.oneOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsEqual(passedContexts.length, 1) && context2.Merge(passedContexts);
}
function ErrorOneOf(stack, context2, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const passingSchemas = [];
  const passedContexts = schema.oneOf.reduce((result, schema2, index) => {
    const nextContext = new ErrorContext();
    const nextSchemaPath = `${schemaPath}/oneOf/${index}`;
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (isSchema)
      passingSchemas.push(index);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isOneOf = guard_exports.IsEqual(passedContexts.length, 1) && context2.Merge(passedContexts);
  if (!isOneOf && guard_exports.IsEqual(passingSchemas.length, 0))
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context2.AddError(error)));
  return isOneOf || context2.AddError({
    keyword: "oneOf",
    schemaPath,
    instancePath,
    params: { passingSchemas }
  });
}

// node_modules/typebox/build/schema/engine/pattern.mjs
function CheckPattern(_stack, _context, schema, value) {
  const regexp = guard_exports.IsString(schema.pattern) ? UnicodeRegExp(schema.pattern) : schema.pattern;
  return regexp.test(value);
}
function ErrorPattern(stack, context2, schemaPath, instancePath, schema, value) {
  return CheckPattern(stack, context2, schema, value) || context2.AddError({
    keyword: "pattern",
    schemaPath,
    instancePath,
    params: { pattern: schema.pattern }
  });
}

// node_modules/typebox/build/schema/engine/patternProperties.mjs
function CheckPatternProperties(stack, context2, schema, value) {
  return guard_exports.Every(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
    const regexp = UnicodeRegExp(pattern);
    return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
      return !regexp.test(key) || CheckSchemaPushStack(stack, context2, schema2, prop) && context2.AddKey(key);
    });
  });
}
function ErrorPatternProperties(stack, context2, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
    const nextSchemaPath = `${schemaPath}/patternProperties/${pattern}`;
    const regexp = UnicodeRegExp(pattern);
    return guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, value2]) => {
      const nextInstancePath = `${instancePath}/${key}`;
      const notKey = !regexp.test(key);
      return notKey || ErrorSchemaPushStack(stack, context2, nextSchemaPath, nextInstancePath, schema2, value2) && context2.AddKey(key);
    });
  });
}

// node_modules/typebox/build/schema/engine/prefixItems.mjs
function CheckPrefixItems(stack, context2, schema, value) {
  return guard_exports.IsEqual(value.length, 0) || guard_exports.Every(schema.prefixItems, 0, (schema2, index) => {
    return guard_exports.IsLessEqualThan(value.length, index) || CheckSchemaPushStack(stack, context2, schema2, value[index]) && context2.AddIndex(index);
  });
}
function ErrorPrefixItems(stack, context2, schemaPath, instancePath, schema, value) {
  return guard_exports.IsEqual(value.length, 0) || guard_exports.EveryAll(schema.prefixItems, 0, (schema2, index) => {
    const nextSchemaPath = `${schemaPath}/prefixItems/${index}`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessEqualThan(value.length, index) || ErrorSchemaPushStack(stack, context2, nextSchemaPath, nextInstancePath, schema2, value[index]) && context2.AddIndex(index);
  });
}

// node_modules/typebox/build/schema/engine/_exact_optional.mjs
function IsExactOptional(required, key) {
  return required.includes(key) || settings_exports.Get().exactOptionalPropertyTypes;
}
function InexactOptionalCheck(value, key) {
  return guard_exports.IsUndefined(value[key]);
}

// node_modules/typebox/build/schema/engine/properties.mjs
function CheckProperties(stack, context2, schema, value) {
  const required = IsRequired(schema) ? schema.required : [];
  const isProperties = guard_exports.Every(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
    const isProperty = !guard_exports.HasPropertyKey(value, key) || CheckSchemaPushStack(stack, context2, schema2, value[key]) && context2.AddKey(key);
    return IsExactOptional(required, key) ? isProperty : InexactOptionalCheck(value, key) || isProperty;
  });
  return isProperties;
}
function ErrorProperties(stack, context2, schemaPath, instancePath, schema, value) {
  const required = IsRequired(schema) ? schema.required : [];
  const isProperties = guard_exports.EveryAll(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/properties/${key}`;
    const nextInstancePath = `${instancePath}/${key}`;
    const isProperty = () => !guard_exports.HasPropertyKey(value, key) || ErrorSchemaPushStack(stack, context2, nextSchemaPath, nextInstancePath, schema2, value[key]) && context2.AddKey(key);
    return IsExactOptional(required, key) ? isProperty() : InexactOptionalCheck(value, key) || isProperty();
  });
  return isProperties;
}

// node_modules/typebox/build/schema/engine/propertyNames.mjs
function CheckPropertyNames(stack, context2, schema, value) {
  return guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => CheckSchema(stack, context2, schema.propertyNames, key));
}
function ErrorPropertyNames(stack, context2, schemaPath, instancePath, schema, value) {
  const propertyNames = [];
  const isPropertyNames = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
    const nextInstancePath = `${instancePath}/${key}`;
    const nextSchemaPath = `${schemaPath}/propertyNames`;
    const isPropertyName = ErrorSchema(stack, context2, nextSchemaPath, nextInstancePath, schema.propertyNames, key);
    if (!isPropertyName)
      propertyNames.push(key);
    return isPropertyName;
  });
  return isPropertyNames || context2.AddError({
    keyword: "propertyNames",
    schemaPath,
    instancePath,
    params: { propertyNames }
  });
}

// node_modules/typebox/build/schema/engine/recursiveRef.mjs
function CheckRecursiveRef(stack, context2, schema, value) {
  const target = stack.RecursiveRef(schema) ?? false;
  return IsSchema(target) && CheckSchema(stack, context2, target, value);
}
function ErrorRecursiveRef(stack, context2, _schemaPath, instancePath, schema, value) {
  const target = stack.RecursiveRef(schema) ?? false;
  return IsSchema(target) && ErrorSchema(stack, context2, "#", instancePath, target, value);
}

// node_modules/typebox/build/schema/engine/ref.mjs
function CheckRef(stack, context2, schema, value) {
  const target = stack.Ref(schema) ?? false;
  const nextContext = new CheckContext();
  const result = IsSchema(target) && CheckSchema(stack, nextContext, target, value);
  if (result)
    context2.Merge([nextContext]);
  return result;
}
function ErrorRef(stack, context2, _schemaPath, instancePath, schema, value) {
  const target = stack.Ref(schema) ?? false;
  const nextContext = new ErrorContext();
  const result = IsSchema(target) && ErrorSchema(stack, nextContext, "#", instancePath, target, value);
  if (result)
    context2.Merge([nextContext]);
  if (!result)
    nextContext.GetErrors().forEach((error) => context2.AddError(error));
  return result;
}

// node_modules/typebox/build/schema/engine/required.mjs
function CheckRequired(_stack, _context, schema, value) {
  return guard_exports.Every(schema.required, 0, (key) => guard_exports.HasPropertyKey(value, key));
}
function ErrorRequired(_stack, context2, schemaPath, instancePath, schema, value) {
  const requiredProperties = [];
  const isRequired = guard_exports.EveryAll(schema.required, 0, (key) => {
    const hasKey = guard_exports.HasPropertyKey(value, key);
    if (!hasKey)
      requiredProperties.push(key);
    return hasKey;
  });
  return isRequired || context2.AddError({
    keyword: "required",
    schemaPath,
    instancePath,
    params: { requiredProperties }
  });
}

// node_modules/typebox/build/schema/engine/type.mjs
function CheckTypeName(_stack, _context, type, _schema, value) {
  return (
    // jsonschema
    guard_exports.IsEqual(type, "object") ? guard_exports.IsObjectNotArray(value) : guard_exports.IsEqual(type, "array") ? guard_exports.IsArray(value) : guard_exports.IsEqual(type, "boolean") ? guard_exports.IsBoolean(value) : guard_exports.IsEqual(type, "integer") ? guard_exports.IsInteger(value) : guard_exports.IsEqual(type, "number") ? guard_exports.IsNumber(value) : guard_exports.IsEqual(type, "null") ? guard_exports.IsNull(value) : guard_exports.IsEqual(type, "string") ? guard_exports.IsString(value) : (
      // xschema
      guard_exports.IsEqual(type, "bigint") ? guard_exports.IsBigInt(value) : guard_exports.IsEqual(type, "constructor") ? guard_exports.IsConstructor(value) : guard_exports.IsEqual(type, "function") ? guard_exports.IsFunction(value) : guard_exports.IsEqual(type, "symbol") ? guard_exports.IsSymbol(value) : guard_exports.IsEqual(type, "undefined") ? guard_exports.IsUndefined(value) : guard_exports.IsEqual(type, "void") ? guard_exports.IsUndefined(value) : true
    )
  );
}
function CheckTypeNames(stack, context2, types, schema, value) {
  return guard_exports.Some(types, (type) => CheckTypeName(stack, context2, type, schema, value));
}
function CheckType(stack, context2, schema, value) {
  return guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context2, schema.type, schema, value) : CheckTypeName(stack, context2, schema.type, schema, value);
}
function ErrorType(stack, context2, schemaPath, instancePath, schema, value) {
  const isType = guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context2, schema.type, schema, value) : CheckTypeName(stack, context2, schema.type, schema, value);
  return isType || context2.AddError({
    keyword: "type",
    schemaPath,
    instancePath,
    params: { type: schema.type }
  });
}

// node_modules/typebox/build/schema/engine/unevaluatedItems.mjs
function CheckUnevaluatedItems(stack, context2, schema, value) {
  const indices = context2.GetIndices();
  return guard_exports.Every(value, 0, (item, index) => {
    return (indices.has(index) || CheckSchema(stack, context2, schema.unevaluatedItems, item)) && context2.AddIndex(index);
  });
}
function ErrorUnevaluatedItems(stack, context2, schemaPath, instancePath, schema, value) {
  const indices = context2.GetIndices();
  const unevaluatedItems = [];
  const isUnevaluatedItems = guard_exports.EveryAll(value, 0, (item, index) => {
    const nextContext = new ErrorContext();
    const isEvaluatedItem = (indices.has(index) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedItems, item)) && context2.AddIndex(index);
    if (!isEvaluatedItem)
      unevaluatedItems.push(index);
    return isEvaluatedItem;
  });
  return isUnevaluatedItems || context2.AddError({
    keyword: "unevaluatedItems",
    schemaPath,
    instancePath,
    params: { unevaluatedItems }
  });
}

// node_modules/typebox/build/schema/engine/unevaluatedProperties.mjs
function CheckUnevaluatedProperties(stack, context2, schema, value) {
  const keys = context2.GetKeys();
  return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
    return keys.has(key) || CheckSchema(stack, context2, schema.unevaluatedProperties, prop) && context2.AddKey(key);
  });
}
function ErrorUnevaluatedProperties(stack, context2, schemaPath, instancePath, schema, value) {
  const keys = context2.GetKeys();
  const unevaluatedProperties = [];
  const isUnevaluatedProperties = guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, prop]) => {
    const nextContext = new ErrorContext();
    const isEvaluatedProperty = keys.has(key) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedProperties, prop) && context2.AddKey(key);
    if (!isEvaluatedProperty)
      unevaluatedProperties.push(key);
    return isEvaluatedProperty;
  });
  return isUnevaluatedProperties || context2.AddError({
    keyword: "unevaluatedProperties",
    schemaPath,
    instancePath,
    params: { unevaluatedProperties }
  });
}

// node_modules/typebox/build/system/hashing/hash.mjs
var hash_exports = {};
__export(hash_exports, {
  Hash: () => Hash,
  HashCode: () => HashCode
});

// node_modules/typebox/build/system/unreachable/unreachable.mjs
function Unreachable() {
  throw new Error("Unreachable");
}

// node_modules/typebox/build/system/hashing/hash.mjs
function InstanceKeys(value) {
  const propertyKeys = /* @__PURE__ */ new Set();
  let current = value;
  while (current && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (key !== "constructor" && typeof key !== "symbol")
        propertyKeys.add(key);
    }
    current = Object.getPrototypeOf(current);
  }
  return [...propertyKeys];
}
function IsIEEE754(value) {
  return typeof value === "number";
}
var ByteMarker;
(function(ByteMarker2) {
  ByteMarker2[ByteMarker2["Array"] = 0] = "Array";
  ByteMarker2[ByteMarker2["BigInt"] = 1] = "BigInt";
  ByteMarker2[ByteMarker2["Boolean"] = 2] = "Boolean";
  ByteMarker2[ByteMarker2["Date"] = 3] = "Date";
  ByteMarker2[ByteMarker2["Constructor"] = 4] = "Constructor";
  ByteMarker2[ByteMarker2["Function"] = 5] = "Function";
  ByteMarker2[ByteMarker2["Null"] = 6] = "Null";
  ByteMarker2[ByteMarker2["Number"] = 7] = "Number";
  ByteMarker2[ByteMarker2["Object"] = 8] = "Object";
  ByteMarker2[ByteMarker2["RegExp"] = 9] = "RegExp";
  ByteMarker2[ByteMarker2["String"] = 10] = "String";
  ByteMarker2[ByteMarker2["Symbol"] = 11] = "Symbol";
  ByteMarker2[ByteMarker2["TypeArray"] = 12] = "TypeArray";
  ByteMarker2[ByteMarker2["Undefined"] = 13] = "Undefined";
})(ByteMarker || (ByteMarker = {}));
var Accumulator = BigInt("14695981039346656037");
var [Prime, Size] = [BigInt("1099511628211"), BigInt(
  "18446744073709551616"
  /* 2 ^ 64 */
)];
var Bytes = Array.from({ length: 256 }).map((_, i) => BigInt(i));
var F64 = new Float64Array(1);
var F64In = new DataView(F64.buffer);
var F64Out = new Uint8Array(F64.buffer);
function FNV1A64_OP(byte) {
  Accumulator = Accumulator ^ Bytes[byte];
  Accumulator = Accumulator * Prime % Size;
}
function FromArray(value) {
  FNV1A64_OP(ByteMarker.Array);
  for (const item of value) {
    FromValue(item);
  }
}
function FromBigInt(value) {
  FNV1A64_OP(ByteMarker.BigInt);
  F64In.setBigInt64(0, value);
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromBoolean(value) {
  FNV1A64_OP(ByteMarker.Boolean);
  FNV1A64_OP(value ? 1 : 0);
}
function FromConstructor(value) {
  FNV1A64_OP(ByteMarker.Constructor);
  FromValue(value.toString());
}
function FromDate(value) {
  FNV1A64_OP(ByteMarker.Date);
  FromValue(value.getTime());
}
function FromFunction(value) {
  FNV1A64_OP(ByteMarker.Function);
  FromValue(value.toString());
}
function FromNull(_value) {
  FNV1A64_OP(ByteMarker.Null);
}
function FromNumber(value) {
  FNV1A64_OP(ByteMarker.Number);
  F64In.setFloat64(
    0,
    value,
    true
    /* little-endian */
  );
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromObject(value) {
  FNV1A64_OP(ByteMarker.Object);
  for (const key of InstanceKeys(value).sort()) {
    FromValue(key);
    FromValue(value[key]);
  }
}
function FromRegExp(value) {
  FNV1A64_OP(ByteMarker.RegExp);
  FromString(value.toString());
}
var encoder = new TextEncoder();
function FromString(value) {
  FNV1A64_OP(ByteMarker.String);
  for (const byte of encoder.encode(value)) {
    FNV1A64_OP(byte);
  }
}
function FromSymbol(value) {
  FNV1A64_OP(ByteMarker.Symbol);
  FromValue(value.toString());
}
function FromTypeArray(value) {
  FNV1A64_OP(ByteMarker.TypeArray);
  const buffer = new Uint8Array(value.buffer);
  for (let i = 0; i < buffer.length; i++) {
    FNV1A64_OP(buffer[i]);
  }
}
function FromUndefined(_value) {
  return FNV1A64_OP(ByteMarker.Undefined);
}
function FromValue(value) {
  return globals_exports.IsTypeArray(value) ? FromTypeArray(value) : globals_exports.IsDate(value) ? FromDate(value) : globals_exports.IsRegExp(value) ? FromRegExp(value) : globals_exports.IsBoolean(value) ? FromBoolean(value.valueOf()) : globals_exports.IsString(value) ? FromString(value.valueOf()) : globals_exports.IsNumber(value) ? FromNumber(value.valueOf()) : IsIEEE754(value) ? FromNumber(value) : guard_exports.IsArray(value) ? FromArray(value) : guard_exports.IsBoolean(value) ? FromBoolean(value) : guard_exports.IsBigInt(value) ? FromBigInt(value) : guard_exports.IsConstructor(value) ? FromConstructor(value) : guard_exports.IsNull(value) ? FromNull(value) : guard_exports.IsObject(value) ? FromObject(value) : guard_exports.IsString(value) ? FromString(value) : guard_exports.IsSymbol(value) ? FromSymbol(value) : guard_exports.IsUndefined(value) ? FromUndefined(value) : guard_exports.IsFunction(value) ? FromFunction(value) : Unreachable();
}
function HashCode(value) {
  Accumulator = BigInt("14695981039346656037");
  FromValue(value);
  return Accumulator;
}
function Hash(value) {
  return HashCode(value).toString(16).padStart(16, "0");
}

// node_modules/typebox/build/schema/engine/uniqueItems.mjs
function IsValid5(schema) {
  return !guard_exports.IsEqual(schema.uniqueItems, false);
}
function CheckUniqueItems(_stack, _context, schema, value) {
  if (!IsValid5(schema))
    return true;
  const set = new Set(value.map(hash_exports.Hash)).size;
  const isLength = value.length;
  return guard_exports.IsEqual(set, isLength);
}
function ErrorUniqueItems(_stack, context2, schemaPath, instancePath, schema, value) {
  if (!IsValid5(schema))
    return true;
  const set = /* @__PURE__ */ new Set();
  const duplicateItems = value.reduce((result, value2, index) => {
    const hash = hash_exports.Hash(value2);
    if (set.has(hash))
      return [...result, index];
    set.add(hash);
    return result;
  }, []);
  const isUniqueItems = guard_exports.IsEqual(duplicateItems.length, 0);
  return isUniqueItems || context2.AddError({
    keyword: "uniqueItems",
    schemaPath,
    instancePath,
    params: { duplicateItems }
  });
}

// node_modules/typebox/build/schema/engine/schema.mjs
function CheckSchemaPushStack(stack, context2, schema, value) {
  return context2.Push() && CheckSchema(stack, context2, schema, value) && context2.Pop();
}
function CheckSchema(stack, context2, schema, value) {
  stack.Push(schema);
  const result = IsSchemaBoolean(schema) ? CheckSchemaBoolean(stack, context2, schema, value) : (!IsType(schema) || CheckType(stack, context2, schema, value)) && (!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || (!IsRequired(schema) || CheckRequired(stack, context2, schema, value)) && (!IsAdditionalProperties(schema) || CheckAdditionalProperties(stack, context2, schema, value)) && (!IsDependencies(schema) || CheckDependencies(stack, context2, schema, value)) && (!IsDependentRequired(schema) || CheckDependentRequired(stack, context2, schema, value)) && (!IsDependentSchemas(schema) || CheckDependentSchemas(stack, context2, schema, value)) && (!IsPatternProperties(schema) || CheckPatternProperties(stack, context2, schema, value)) && (!IsProperties(schema) || CheckProperties(stack, context2, schema, value)) && (!IsPropertyNames(schema) || CheckPropertyNames(stack, context2, schema, value)) && (!IsMinProperties(schema) || CheckMinProperties(stack, context2, schema, value)) && (!IsMaxProperties(schema) || CheckMaxProperties(stack, context2, schema, value))) && (!guard_exports.IsArray(value) || (!IsAdditionalItems(schema) || CheckAdditionalItems(stack, context2, schema, value)) && (!IsContains(schema) || CheckContains(stack, context2, schema, value)) && (!IsItems(schema) || CheckItems(stack, context2, schema, value)) && (!IsMaxContains(schema) || CheckMaxContains(stack, context2, schema, value)) && (!IsMaxItems(schema) || CheckMaxItems(stack, context2, schema, value)) && (!IsMinContains(schema) || CheckMinContains(stack, context2, schema, value)) && (!IsMinItems(schema) || CheckMinItems(stack, context2, schema, value)) && (!IsPrefixItems(schema) || CheckPrefixItems(stack, context2, schema, value)) && (!IsUniqueItems(schema) || CheckUniqueItems(stack, context2, schema, value))) && (!guard_exports.IsString(value) || (!IsMaxLength3(schema) || CheckMaxLength(stack, context2, schema, value)) && (!IsMinLength3(schema) || CheckMinLength(stack, context2, schema, value)) && (!IsFormat(schema) || CheckFormat(stack, context2, schema, value)) && (!IsPattern(schema) || CheckPattern(stack, context2, schema, value))) && (!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || (!IsExclusiveMaximum(schema) || CheckExclusiveMaximum(stack, context2, schema, value)) && (!IsExclusiveMinimum(schema) || CheckExclusiveMinimum(stack, context2, schema, value)) && (!IsMaximum(schema) || CheckMaximum(stack, context2, schema, value)) && (!IsMinimum(schema) || CheckMinimum(stack, context2, schema, value)) && (!IsMultipleOf2(schema) || CheckMultipleOf(stack, context2, schema, value))) && (!IsRef(schema) || CheckRef(stack, context2, schema, value)) && (!IsRecursiveRef(schema) || CheckRecursiveRef(stack, context2, schema, value)) && (!IsDynamicRef(schema) || CheckDynamicRef(stack, context2, schema, value)) && (!IsConst(schema) || CheckConst(stack, context2, schema, value)) && (!IsEnum(schema) || CheckEnum(stack, context2, schema, value)) && (!IsIf(schema) || CheckIf(stack, context2, schema, value)) && (!IsNot(schema) || CheckNot(stack, context2, schema, value)) && (!IsAllOf(schema) || CheckAllOf(stack, context2, schema, value)) && (!IsAnyOf(schema) || CheckAnyOf(stack, context2, schema, value)) && (!IsOneOf(schema) || CheckOneOf(stack, context2, schema, value)) && (!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || CheckUnevaluatedItems(stack, context2, schema, value))) && (!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || CheckUnevaluatedProperties(stack, context2, schema, value))) && (!IsRefine(schema) || CheckRefine(stack, context2, schema, value));
  stack.Pop(schema);
  return result;
}
function ErrorSchemaPushStack(stack, context2, schemaPath, instancePath, schema, value) {
  return context2.Push() && ErrorSchema(stack, context2, schemaPath, instancePath, schema, value) && context2.Pop();
}
function ErrorSchema(stack, context2, schemaPath, instancePath, schema, value) {
  if (context2.AtCapacity())
    return false;
  stack.Push(schema);
  const result = IsSchemaBoolean(schema) ? ErrorSchemaBoolean(stack, context2, schemaPath, instancePath, schema, value) : !!(+(!IsType(schema) || ErrorType(stack, context2, schemaPath, instancePath, schema, value)) & +(!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || !!(+(!IsRequired(schema) || ErrorRequired(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsAdditionalProperties(schema) || ErrorAdditionalProperties(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsDependencies(schema) || ErrorDependencies(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsDependentRequired(schema) || ErrorDependentRequired(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsDependentSchemas(schema) || ErrorDependentSchemas(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsPatternProperties(schema) || ErrorPatternProperties(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsProperties(schema) || ErrorProperties(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsPropertyNames(schema) || ErrorPropertyNames(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsMinProperties(schema) || ErrorMinProperties(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsMaxProperties(schema) || ErrorMaxProperties(stack, context2, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsArray(value) || !!(+(!IsAdditionalItems(schema) || ErrorAdditionalItems(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsContains(schema) || ErrorContains(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsItems(schema) || ErrorItems(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsMaxContains(schema) || ErrorMaxContains(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsMaxItems(schema) || ErrorMaxItems(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsMinContains(schema) || ErrorMinContains(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsMinItems(schema) || ErrorMinItems(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsPrefixItems(schema) || ErrorPrefixItems(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsUniqueItems(schema) || ErrorUniqueItems(stack, context2, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsString(value) || !!(+(!IsMaxLength3(schema) || ErrorMaxLength(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsMinLength3(schema) || ErrorMinLength(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsFormat(schema) || ErrorFormat(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsPattern(schema) || ErrorPattern(stack, context2, schemaPath, instancePath, schema, value)))) & +(!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || !!(+(!IsExclusiveMaximum(schema) || ErrorExclusiveMaximum(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsExclusiveMinimum(schema) || ErrorExclusiveMinimum(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsMaximum(schema) || ErrorMaximum(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsMinimum(schema) || ErrorMinimum(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsMultipleOf2(schema) || ErrorMultipleOf(stack, context2, schemaPath, instancePath, schema, value)))) & +(!IsRef(schema) || ErrorRef(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsRecursiveRef(schema) || ErrorRecursiveRef(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsDynamicRef(schema) || ErrorDynamicRef(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsConst(schema) || ErrorConst(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsEnum(schema) || ErrorEnum(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsIf(schema) || ErrorIf(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsNot(schema) || ErrorNot(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsAllOf(schema) || ErrorAllOf(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsAnyOf(schema) || ErrorAnyOf(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsOneOf(schema) || ErrorOneOf(stack, context2, schemaPath, instancePath, schema, value)) & +(!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || ErrorUnevaluatedItems(stack, context2, schemaPath, instancePath, schema, value))) & +(!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || ErrorUnevaluatedProperties(stack, context2, schemaPath, instancePath, schema, value)))) && (!IsRefine(schema) || ErrorRefine(stack, context2, schemaPath, instancePath, schema, value));
  stack.Pop(schema);
  return result;
}

// node_modules/typebox/build/schema/resolve/resolve.mjs
var resolve_exports = {};
__export(resolve_exports, {
  Base: () => Base,
  DefaultBase: () => DefaultBase,
  DynamicRef: () => DynamicRef,
  Ref: () => Ref,
  ResolveDynamicRef: () => ResolveDynamicRef,
  ResolveRecursiveRef: () => ResolveRecursiveRef,
  ResolveRef: () => ResolveRef,
  Resource: () => Resource
});

// node_modules/typebox/build/schema/pointer/pointer.mjs
var pointer_exports = {};
__export(pointer_exports, {
  Delete: () => Delete,
  Get: () => Get3,
  Has: () => Has2,
  Indices: () => Indices,
  Set: () => Set4
});
function AssertNotRoot(indices) {
  if (indices.length === 0)
    throw Error("Cannot set root");
}
function AssertCanSet(value) {
  if (!guard_exports.IsObject(value))
    throw Error("Cannot set value");
}
function AssertIndex(index) {
  if (guard_exports.IsUnsafePropertyKey(index))
    throw Error("Pointer contains unsafe property key");
}
function AssertIndices(indices) {
  for (const index of indices)
    AssertIndex(index);
}
function IsNumericIndex(index) {
  return /^(0|[1-9]\d*)$/.test(index);
}
function TakeIndexRight(indices) {
  return [
    indices.slice(0, indices.length - 1),
    indices.slice(indices.length - 1)[0]
  ];
}
function HasIndex(index, value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, index);
}
function GetIndex(index, value) {
  return guard_exports.IsObject(value) && !guard_exports.IsUnsafePropertyKey(index) ? value[index] : void 0;
}
function GetIndices(indices, value) {
  return indices.reduce((value2, index) => GetIndex(index, value2), value);
}
function Indices(pointer) {
  if (guard_exports.IsEqual(pointer.length, 0))
    return [];
  const indices = pointer.split("/").map((index) => index.replace(/~1/g, "/").replace(/~0/g, "~"));
  return indices.length > 0 && indices[0] === "" ? indices.slice(1) : indices;
}
function Has2(value, pointer) {
  let current = value;
  return Indices(pointer).every((index) => {
    if (!HasIndex(index, current))
      return false;
    current = current[index];
    return true;
  });
}
function Get3(value, pointer) {
  const indices = Indices(pointer);
  return GetIndices(indices, value);
}
function Set4(value, pointer, next) {
  const indices = Indices(pointer);
  AssertNotRoot(indices);
  AssertIndices(indices);
  const [head, index] = TakeIndexRight(indices);
  const parent = GetIndices(head, value);
  AssertCanSet(parent);
  parent[index] = next;
  return value;
}
function Delete(value, pointer) {
  const indices = Indices(pointer);
  AssertNotRoot(indices);
  AssertIndices(indices);
  const [head, index] = TakeIndexRight(indices);
  const parent = GetIndices(head, value);
  AssertCanSet(parent);
  if (guard_exports.IsArray(parent) && IsNumericIndex(index)) {
    parent.splice(+index, 1);
  } else {
    delete parent[index];
  }
  return value;
}

// node_modules/typebox/build/schema/resolve/resolve.mjs
var DefaultBase = "https://json-schema.org";
function FindDynamicAnchor(schema, name) {
  if (guard_exports.IsObject(schema) && IsDynamicAnchor(schema) && guard_exports.IsEqual(schema.$dynamicAnchor, name)) {
    return schema;
  }
  if (guard_exports.IsObject(schema)) {
    for (const key of guard_exports.Keys(schema)) {
      const result = FindDynamicAnchor(schema[key], name);
      if (result)
        return result;
    }
  }
  return void 0;
}
function FindBase(schema, base, target) {
  if (guard_exports.IsEqual(schema, target))
    return base.href;
  const nextBase = IsSchemaObject(schema) && IsId(schema) ? new URL(schema.$id, base.href) : base;
  if (guard_exports.IsArray(schema)) {
    for (const item of schema) {
      const result = FindBase(item, nextBase, target);
      if (!guard_exports.IsUndefined(result))
        return result;
    }
  } else if (guard_exports.IsObject(schema)) {
    for (const key of guard_exports.Keys(schema)) {
      const result = FindBase(schema[key], nextBase, target);
      if (!guard_exports.IsUndefined(result))
        return result;
    }
  }
  return void 0;
}
function MatchId(schema, base, ref) {
  if (guard_exports.IsEqual(schema.$id, ref.hash))
    return schema;
  const absoluteRef = new URL(ref.href, base.href);
  if (guard_exports.IsEqual(base.pathname, absoluteRef.pathname))
    return ref.hash.startsWith("#") ? MatchHash(schema, ref) : schema;
  return void 0;
}
function MatchAnchor(schema, base, ref) {
  const absoluteAnchor = new URL(`#${schema.$anchor}`, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  return guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href) ? schema : void 0;
}
function MatchDynamicAnchor(schema, base, ref) {
  const absoluteAnchor = new URL(`#${schema.$dynamicAnchor}`, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  const isMatch = guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href);
  return isMatch ? schema : void 0;
}
function MatchHash(schema, ref) {
  if (ref.href.endsWith("#"))
    return schema;
  if (!ref.hash.startsWith("#"))
    return void 0;
  const fragment = decodeURIComponent(ref.hash.slice(1));
  if (!fragment.startsWith("/"))
    return void 0;
  const result = pointer_exports.Get(schema, fragment);
  return result;
}
function Match2(schema, base, ref) {
  if (IsId(schema)) {
    const result = MatchId(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (IsAnchor(schema)) {
    const result = MatchAnchor(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (IsDynamicAnchor(schema)) {
    const result = MatchDynamicAnchor(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  return MatchHash(schema, ref);
}
function FromArray2(schema, base, ref) {
  return schema.reduce((result, item) => {
    const match = FromValue2(item, base, ref);
    return !guard_exports.IsUndefined(match) ? match : result;
  }, void 0);
}
function SkipProperty(key) {
  return guard_exports.IsEqual(key, "const") || guard_exports.IsEqual(key, "enum");
}
function FromObject2(schema, base, ref) {
  return guard_exports.Keys(schema).reduce((result, key) => {
    if (SkipProperty(key))
      return result;
    const match = FromValue2(schema[key], base, ref);
    return !guard_exports.IsUndefined(match) ? match : result;
  }, void 0);
}
function FromValue2(schema, base, ref) {
  const nextBase = IsSchemaObject(schema) && IsId(schema) ? new URL(schema.$id, base.href) : base;
  if (IsSchemaObject(schema)) {
    const result = Match2(schema, nextBase, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (guard_exports.IsArray(schema))
    return FromArray2(schema, nextBase, ref);
  if (guard_exports.IsObject(schema))
    return FromObject2(schema, nextBase, ref);
  return void 0;
}
function Base(schema, base, target) {
  return FindBase(schema, new URL(base || ".", DefaultBase), target);
}
function Resource(context2, schema, base, ref) {
  const result = Ref(context2, schema, base, ref, false);
  return IsSchemaObject(result) && IsId(result) ? result : void 0;
}
function CanonicalHref(url) {
  return url.href.split("#")[0];
}
function RefContext(context2, ref) {
  return guard_exports.HasPropertyKey(context2, ref) ? context2[ref] : void 0;
}
function RefLocal(schema, base, ref) {
  return FromValue2(schema, base, ref);
}
function RefRemote(context2, base, ref) {
  const canonicalHref = CanonicalHref(ref);
  if (guard_exports.IsEqual(canonicalHref, CanonicalHref(base)))
    return void 0;
  if (!guard_exports.HasPropertyKey(context2, canonicalHref))
    return void 0;
  const remoteSchema = context2[canonicalHref];
  const remoteBase = IsSchemaObject(remoteSchema) && IsId(remoteSchema) ? new URL(remoteSchema.$id, canonicalHref) : new URL(canonicalHref);
  const result = guard_exports.IsEqual(ref.hash, "") ? remoteSchema : FromValue2(remoteSchema, remoteBase, ref);
  return result;
}
function LegacyRetrievedResource(root, lexicalSchema, referenceBase, ref, schema) {
  if (!ref.$ref.startsWith("#"))
    return void 0;
  if (guard_exports.HasPropertyKey(root, "$schema"))
    return void 0;
  const targetBase = Base(lexicalSchema, referenceBase, schema);
  if (guard_exports.IsUndefined(targetBase) || guard_exports.IsEqual(targetBase, referenceBase))
    return void 0;
  return { target: schema, base: targetBase, root: lexicalSchema };
}
function RemoteRetrievedResource(context2, canonical, schema) {
  const remoteRoot = context2[canonical];
  if (!IsSchemaObject(remoteRoot))
    return void 0;
  return { target: schema, base: canonical, root: remoteRoot };
}
function FindRetrievedResource(stackframe, ref, schema, canonical, isRemote) {
  const remote = isRemote ? RemoteRetrievedResource(stackframe.context, canonical, schema) : void 0;
  if (!guard_exports.IsUndefined(remote))
    return remote;
  return LegacyRetrievedResource(stackframe.root, stackframe.lexicalSchema, stackframe.referenceBase, ref, schema);
}
function FindResolvedResource(context2, root, referenceBase, canonical, schema, ids) {
  if (IsId(schema))
    return void 0;
  const resource = Resource(context2, root, referenceBase, canonical);
  if (!resource || ids.includes(resource))
    return void 0;
  return { target: schema, resource };
}
function Ref(remotes, schema, base, ref, applySchemaId = true) {
  const initialBase = new URL(base || ".", DefaultBase);
  const resolvedBase = applySchemaId && IsId(schema) ? new URL(schema.$id, initialBase) : initialBase;
  const initialRef = new URL(ref, resolvedBase.href);
  return RefContext(remotes, ref) ?? RefLocal(schema, resolvedBase, initialRef) ?? RefRemote(remotes, resolvedBase, initialRef);
}
function DynamicRef(context2, root, base, schema, dynamicRef, dynamicAnchors) {
  const initialBase = new URL(base || ".", DefaultBase);
  const fragmentRoot = dynamicRef.$dynamicRef.startsWith("#") ? schema : root;
  const fragmentTarget = Ref(context2, fragmentRoot, base, dynamicRef.$dynamicRef, false);
  if (guard_exports.IsUndefined(fragmentTarget)) {
    const fragment2 = new URL(dynamicRef.$dynamicRef, initialBase).hash;
    if (!fragment2.startsWith("#/") && fragment2.startsWith("#")) {
      const name = decodeURIComponent(fragment2.slice(1));
      const anchorTarget2 = dynamicAnchors.find((anchor) => guard_exports.IsEqual(anchor.$dynamicAnchor, name)) ?? FindDynamicAnchor(root, name);
      return anchorTarget2;
    }
    return void 0;
  }
  if (!IsSchemaObject(fragmentTarget) || !IsDynamicAnchor(fragmentTarget))
    return fragmentTarget;
  const fragment = new URL(dynamicRef.$dynamicRef, initialBase).hash;
  if (fragment.startsWith("#/"))
    return fragmentTarget;
  const anchorTarget = dynamicAnchors.find((anchor) => guard_exports.IsEqual(anchor.$dynamicAnchor, fragmentTarget.$dynamicAnchor));
  return anchorTarget ?? fragmentTarget;
}
function ResolveRef(stackframe, ref) {
  const source = stackframe.inRetrievedFrame ? stackframe.lexicalSchema : stackframe.root;
  const refRoot = ref.$ref.startsWith("#") ? stackframe.lexicalSchema : source;
  const schema = Ref(stackframe.context, refRoot, stackframe.referenceBase, ref.$ref, false);
  if (!schema || !IsSchemaObject(schema))
    return { schema };
  const canonical = new URL(ref.$ref, stackframe.referenceBase).href.split("#")[0];
  const isRemote = !guard_exports.IsEqual(canonical, stackframe.resourceBase);
  const retrievedResource = FindRetrievedResource(stackframe, ref, schema, canonical, isRemote);
  const resolvedResource = isRemote ? FindResolvedResource(stackframe.context, stackframe.root, stackframe.referenceBase, canonical, schema, stackframe.ids) : void 0;
  return { schema, retrievedResource, resolvedResource };
}
function ResolveRecursiveRef(stackframe, recursiveRef) {
  const refRoot = IsRecursiveAnchorTrue(stackframe.lexicalSchema) ? stackframe.recursiveAnchors[0] : stackframe.lexicalSchema;
  return Ref(stackframe.context, refRoot, stackframe.lexicalBase, recursiveRef.$recursiveRef, false);
}
function ResolveDynamicRef(stackframe, dynamicRef) {
  return DynamicRef(stackframe.context, stackframe.root, stackframe.lexicalBase, stackframe.lexicalSchema, dynamicRef, stackframe.dynamicAnchors);
}

// node_modules/typebox/build/schema/engine/_stack.mjs
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _Stack_instances;
var _Stack_StackFrame;
var _Stack_ApplyRefResult;
var _Stack_BuildBase;
var _Stack_ResourceBaseURL;
var _Stack_ReferenceBaseURL;
var _Stack_LexicalSchema;
var _Stack_RegisterResourceAnchorArray;
var _Stack_UnregisterResourceAnchorArray;
var _Stack_RegisterResourceAnchors;
var _Stack_UnregisterResourceAnchors;
var _Stack_RegisterResource;
var _Stack_UnregisterResource;
var _Stack_EnterResolvedResource;
var _Stack_ExitResolvedResource;
var Stack = class {
  constructor(context2, schema) {
    _Stack_instances.add(this);
    this.context = context2;
    this.schema = schema;
    this.ids = [];
    this.resourceIds = [];
    this.anchors = [];
    this.recursiveAnchors = [];
    this.dynamicAnchors = [];
    this.retrievedResources = /* @__PURE__ */ new Map();
    this.retrievedFrames = [];
    this.resolvedResources = /* @__PURE__ */ new Map();
    this.pendingResource = true;
  }
  // ----------------------------------------------------------------
  // LexicalBaseURL
  // ----------------------------------------------------------------
  LexicalBaseURL() {
    return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_BuildBase).call(this, this.ids);
  }
  // ----------------------------------------------------------------
  // Push
  // ----------------------------------------------------------------
  Push(schema) {
    if (!IsSchemaObject(schema))
      return;
    if (IsId(schema))
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResource).call(this, schema);
    if (IsAnchor(schema))
      this.anchors.push(schema);
    if (IsRecursiveAnchorTrue(schema))
      this.recursiveAnchors.push(schema);
    if (IsDynamicAnchor(schema))
      this.dynamicAnchors.push(schema);
    const retrievedResource = this.retrievedResources.get(schema);
    if (retrievedResource) {
      this.retrievedFrames.push({
        schema: retrievedResource.root,
        base: retrievedResource.base,
        idDepth: this.ids.length,
        resourceDepth: this.resourceIds.length
      });
    }
  }
  // ----------------------------------------------------------------
  // Pop
  // ----------------------------------------------------------------
  Pop(schema) {
    if (!IsSchemaObject(schema))
      return;
    if (IsId(schema))
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResource).call(this, schema);
    if (IsAnchor(schema))
      this.anchors.pop();
    if (IsRecursiveAnchorTrue(schema))
      this.recursiveAnchors.pop();
    if (IsDynamicAnchor(schema))
      this.dynamicAnchors.pop();
    if (this.retrievedResources.has(schema))
      this.retrievedFrames.pop();
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ExitResolvedResource).call(this, schema);
  }
  // ----------------------------------------------------------------
  // Ref
  // ----------------------------------------------------------------
  Ref(ref) {
    const result = resolve_exports.ResolveRef(__classPrivateFieldGet(this, _Stack_instances, "m", _Stack_StackFrame).call(this), ref);
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ApplyRefResult).call(this, result);
    return result.schema;
  }
  // ----------------------------------------------------------------
  // RecursiveRef
  // ----------------------------------------------------------------
  RecursiveRef(recursiveRef) {
    const result = resolve_exports.ResolveRecursiveRef(__classPrivateFieldGet(this, _Stack_instances, "m", _Stack_StackFrame).call(this), recursiveRef);
    if (result)
      this.pendingResource = true;
    return result;
  }
  // ----------------------------------------------------------------
  // DynamicRef
  // ----------------------------------------------------------------
  DynamicRef(dynamicRef) {
    const result = resolve_exports.ResolveDynamicRef(__classPrivateFieldGet(this, _Stack_instances, "m", _Stack_StackFrame).call(this), dynamicRef);
    if (result)
      this.pendingResource = true;
    return result;
  }
};
_Stack_instances = /* @__PURE__ */ new WeakSet(), _Stack_StackFrame = function _Stack_StackFrame2() {
  return {
    context: this.context,
    root: this.schema,
    ids: this.ids,
    lexicalSchema: __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_LexicalSchema).call(this),
    lexicalBase: this.LexicalBaseURL(),
    referenceBase: __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ReferenceBaseURL).call(this),
    resourceBase: __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ResourceBaseURL).call(this),
    recursiveAnchors: this.recursiveAnchors,
    dynamicAnchors: this.dynamicAnchors,
    inRetrievedFrame: this.retrievedFrames.length > 0
  };
}, _Stack_ApplyRefResult = function _Stack_ApplyRefResult2(result) {
  if (!guard_exports.IsUndefined(result.schema))
    this.pendingResource = true;
  if (!guard_exports.IsUndefined(result.resolvedResource)) {
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_EnterResolvedResource).call(this, result.resolvedResource.target, result.resolvedResource.resource);
  }
  if (!guard_exports.IsUndefined(result.retrievedResource)) {
    this.retrievedResources.set(result.retrievedResource.target, {
      base: result.retrievedResource.base,
      root: result.retrievedResource.root
    });
  }
}, _Stack_BuildBase = function _Stack_BuildBase2(stack) {
  const frame = this.retrievedFrames[this.retrievedFrames.length - 1];
  const base = frame ? new URL(frame.base) : new URL(resolve_exports.DefaultBase);
  const scoped = frame ? stack.slice(frame.idDepth) : stack;
  return scoped.reduce((result, schema) => new URL(schema.$id, result), base).href;
}, _Stack_ResourceBaseURL = function _Stack_ResourceBaseURL2() {
  const frame = this.retrievedFrames[this.retrievedFrames.length - 1];
  if (!frame)
    return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_BuildBase).call(this, this.resourceIds);
  return this.resourceIds.slice(frame.resourceDepth).reduce((result, schema) => new URL(schema.$id, result), new URL(frame.base)).href;
}, _Stack_ReferenceBaseURL = function _Stack_ReferenceBaseURL2() {
  if (this.retrievedFrames.length > 0)
    return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ResourceBaseURL).call(this);
  const lexical = this.ids[this.ids.length - 1];
  if (lexical && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(lexical.$id))
    return this.LexicalBaseURL();
  return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ResourceBaseURL).call(this);
}, _Stack_LexicalSchema = function _Stack_LexicalSchema2() {
  const frame = this.retrievedFrames[this.retrievedFrames.length - 1];
  if (frame)
    return this.ids.length > frame.idDepth ? this.ids[this.ids.length - 1] : frame.schema;
  return this.ids.length > 0 ? this.ids[this.ids.length - 1] : this.schema;
}, _Stack_RegisterResourceAnchorArray = function _Stack_RegisterResourceAnchorArray2(schema) {
  schema.forEach((schema2) => __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResourceAnchors).call(this, schema2, false));
}, _Stack_UnregisterResourceAnchorArray = function _Stack_UnregisterResourceAnchorArray2(schema) {
  schema.forEach((schema2) => __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResourceAnchors).call(this, schema2, false));
}, _Stack_RegisterResourceAnchors = function _Stack_RegisterResourceAnchors2(schema, isRoot = true) {
  if (IsSchemaBoolean(schema))
    return;
  if (guard_exports.IsArray(schema))
    return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResourceAnchorArray).call(this, schema);
  if (!IsSchemaObject(schema))
    return;
  const current = schema;
  if (!isRoot && IsId(current))
    return;
  if (!isRoot && IsDynamicAnchor(current))
    this.dynamicAnchors.push(current);
  for (const key of guard_exports.Keys(current))
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResourceAnchors2).call(this, current[key], false);
}, _Stack_UnregisterResourceAnchors = function _Stack_UnregisterResourceAnchors2(schema, isRoot = true) {
  if (IsSchemaBoolean(schema))
    return;
  if (guard_exports.IsArray(schema))
    return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResourceAnchorArray).call(this, schema);
  if (!IsSchemaObject(schema))
    return;
  const current = schema;
  if (!isRoot && IsId(current))
    return;
  if (!isRoot && IsDynamicAnchor(current))
    this.dynamicAnchors.pop();
  for (const key of guard_exports.Keys(current))
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResourceAnchors2).call(this, current[key], false);
}, _Stack_RegisterResource = function _Stack_RegisterResource2(schema) {
  this.ids.push(schema);
  const isResource = this.pendingResource;
  this.pendingResource = false;
  if (isResource)
    this.resourceIds.push(schema);
  __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResourceAnchors).call(this, schema, true);
}, _Stack_UnregisterResource = function _Stack_UnregisterResource2(schema) {
  this.ids.pop();
  const isResource = this.resourceIds.length > 0 && guard_exports.IsEqual(this.resourceIds[this.resourceIds.length - 1], schema);
  if (isResource)
    this.resourceIds.pop();
  __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResourceAnchors).call(this, schema, true);
}, _Stack_EnterResolvedResource = function _Stack_EnterResolvedResource2(target, resource) {
  __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResource).call(this, resource);
  this.resolvedResources.set(target, resource);
}, _Stack_ExitResolvedResource = function _Stack_ExitResolvedResource2(target) {
  if (!this.resolvedResources.has(target))
    return;
  const resource = this.resolvedResources.get(target);
  __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResource).call(this, resource);
  this.resolvedResources.delete(target);
};

// node_modules/typebox/build/system/locale/en_US.mjs
function en_US(error) {
  switch (error.keyword) {
    case "additionalProperties":
      return "must not have additional properties";
    case "anyOf":
      return "must match a schema in anyOf";
    case "boolean":
      return "schema is false";
    case "const":
      return "must be equal to constant";
    case "contains":
      return "must contain at least 1 valid item";
    case "dependencies":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "dependentRequired":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "enum":
      return "must be equal to one of the allowed values";
    case "exclusiveMaximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "exclusiveMinimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "format":
      return `must match format "${error.params.format}"`;
    case "if":
      return `must match "${error.params.failingKeyword}" schema`;
    case "maxItems":
      return `must not have more than ${error.params.limit} items`;
    case "maxLength":
      return `must not have more than ${error.params.limit} characters`;
    case "maxProperties":
      return `must not have more than ${error.params.limit} properties`;
    case "maximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "minItems":
      return `must not have fewer than ${error.params.limit} items`;
    case "minLength":
      return `must not have fewer than ${error.params.limit} characters`;
    case "minProperties":
      return `must not have fewer than ${error.params.limit} properties`;
    case "minimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "multipleOf":
      return `must be multiple of ${error.params.multipleOf}`;
    case "not":
      return "must not be valid";
    case "oneOf":
      return "must match exactly one schema in oneOf";
    case "pattern":
      return `must match pattern "${error.params.pattern}"`;
    case "propertyNames":
      return `property names ${error.params.propertyNames.join(", ")} are invalid`;
    case "required":
      return `must have required properties ${error.params.requiredProperties.join(", ")}`;
    case "type":
      return typeof error.params.type === "string" ? `must be ${error.params.type}` : `must be either ${error.params.type.join(" or ")}`;
    case "unevaluatedItems":
      return "must not have unevaluated items";
    case "unevaluatedProperties":
      return "must not have unevaluated properties";
    case "uniqueItems":
      return `must not have duplicate items`;
    case "~refine":
      return error.params.message;
    // deno-coverage-ignore - unreachable
    default:
      return "an unknown validation error occurred";
  }
}

// node_modules/typebox/build/system/locale/_config.mjs
var locale = en_US;
function Get4() {
  return locale;
}

// node_modules/typebox/build/system/memory/memory.mjs
var memory_exports = {};
__export(memory_exports, {
  Assign: () => Assign,
  Clone: () => Clone,
  Create: () => Create,
  Discard: () => Discard,
  Metrics: () => Metrics,
  Update: () => Update
});

// node_modules/typebox/build/system/memory/metrics.mjs
var Metrics = {
  assign: 0,
  create: 0,
  clone: 0,
  discard: 0,
  update: 0
};

// node_modules/typebox/build/system/memory/freeze.mjs
function Freeze(value) {
  return settings_exports.Get().immutableTypes ? Object.freeze(value) : value;
}

// node_modules/typebox/build/system/memory/assign.mjs
function Assign(left, right) {
  Metrics.assign += 1;
  return Freeze({ ...left, ...right });
}

// node_modules/typebox/build/system/memory/clone.mjs
function FromClassInstance(value) {
  return value;
}
function IsSchemaObject2(value) {
  return guard_exports.HasPropertyKey(value, "~kind") || guard_exports.HasPropertyKey(value, "~unsafe");
}
function FromSchemaObject(value) {
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    descriptor.value = FromValue3(descriptor.value);
    if (guard_exports.IsEqual(descriptor.enumerable, true)) {
      result[key] = descriptor.value;
    } else {
      Object.defineProperty(result, key, descriptor);
    }
  }
  return result;
}
function FromPlainObject(value) {
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    result[key] = FromValue3(value[key]);
  }
  for (const key of guard_exports.Symbols(value)) {
    result[key] = FromValue3(value[key]);
  }
  return result;
}
function FromObject3(value) {
  return guard_exports.IsClassInstance(value) ? FromClassInstance(value) : IsSchemaObject2(value) ? FromSchemaObject(value) : FromPlainObject(value);
}
function FromArray3(value) {
  return value.map((element) => FromValue3(element));
}
function FromTypedArray(value) {
  return value.slice();
}
function FromRegExp2(value) {
  return new RegExp(value.source, value.flags);
}
function FromMap(value) {
  return new Map(FromValue3([...value.entries()]));
}
function FromSet(value) {
  return new Set(FromValue3([...value.values()]));
}
function FromValue3(value) {
  return globals_exports.IsTypeArray(value) ? FromTypedArray(value) : globals_exports.IsRegExp(value) ? FromRegExp2(value) : globals_exports.IsMap(value) ? FromMap(value) : globals_exports.IsSet(value) ? FromSet(value) : guard_exports.IsArray(value) ? FromArray3(value) : guard_exports.IsObject(value) ? FromObject3(value) : value;
}
function Clone(value) {
  Metrics.clone += 1;
  return FromValue3(value);
}

// node_modules/typebox/build/system/memory/create.mjs
function MergeHidden(left, right) {
  for (const key of Object.keys(right)) {
    Object.defineProperty(left, key, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: right[key]
    });
  }
  return left;
}
function Merge(left, right) {
  return { ...left, ...right };
}
function Create(hidden, enumerable, options = {}) {
  Metrics.create += 1;
  const withOptions = Merge(enumerable, options);
  const withHidden = settings_exports.Get().enumerableKind ? Merge(withOptions, hidden) : MergeHidden(withOptions, hidden);
  return Freeze(withHidden);
}

// node_modules/typebox/build/system/memory/discard.mjs
function Discard(value, propertyKeys) {
  Metrics.discard += 1;
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (propertyKeys.includes(key))
      continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    descriptor.value = Clone(descriptor.value);
    Object.defineProperty(result, key, descriptor);
  }
  return Freeze(result);
}

// node_modules/typebox/build/system/memory/update.mjs
function Update(current, hidden, enumerable) {
  Metrics.update += 1;
  const settings2 = settings_exports.Get();
  const result = Clone(current);
  for (const key of Object.keys(hidden)) {
    Object.defineProperty(result, key, {
      configurable: true,
      writable: true,
      enumerable: settings2.enumerableKind,
      value: hidden[key]
    });
  }
  for (const key of Object.keys(enumerable)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: enumerable[key]
    });
  }
  return Freeze(result);
}

// node_modules/typebox/build/schema/errors.mjs
function Errors(...args) {
  const [context2, schema, value] = arguments_exports.Match(args, {
    3: (context3, schema2, value2) => [context3, schema2, value2],
    2: (schema2, value2) => [{}, schema2, value2]
  });
  const stack = new Stack(context2, schema);
  const errorContext = new ErrorContext();
  const result = ErrorSchema(stack, errorContext, "#", "", schema, value);
  const errors = errorContext.GetErrors();
  const locale2 = Get4();
  const localized = errors.map((error) => ({ ...error, message: locale2(error) }));
  return [result, localized];
}

// node_modules/typebox/build/schema/check.mjs
function Check(...args) {
  const [context2, schema, value] = arguments_exports.Match(args, {
    3: (context3, schema2, value2) => [context3, schema2, value2],
    2: (schema2, value2) => [{}, schema2, value2]
  });
  const stack = new Stack(context2, schema);
  const checkContext = new CheckContext();
  return CheckSchema(stack, checkContext, schema, value);
}

// node_modules/typebox/build/value/check/check.mjs
function Check2(...args) {
  const [context2, type, value] = arguments_exports.Match(args, {
    3: (context3, type2, value2) => [context3, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return Check(context2, type, value);
}

// node_modules/typebox/build/value/errors/errors.mjs
function Errors2(...args) {
  const [context2, type, value] = arguments_exports.Match(args, {
    3: (context3, type2, value2) => [context3, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const [_, errors] = Errors(context2, type, value);
  return errors;
}

// node_modules/typebox/build/value/assert/assert.mjs
var AssertError = class extends Error {
  constructor(source, value, errors) {
    super(source);
    Object.defineProperty(this, "cause", {
      value: { source, errors, value },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
};

// node_modules/typebox/build/type/types/schema.mjs
function IsKind(value, kind) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], kind);
}
function IsSchema2(value) {
  return guard_exports.IsObject(value);
}

// node_modules/typebox/build/type/types/deferred.mjs
function Deferred(action, parameters, options) {
  return memory_exports.Create({ "~kind": "Deferred" }, { type: "deferred", action, parameters, options }, {});
}
function IsDeferred(value) {
  return IsKind(value, "Deferred");
}

// node_modules/typebox/build/type/engine/readonly/instantiate_add.mjs
function AddReadonlyOperation(type) {
  return memory_exports.Update(type, { "~readonly": true }, {});
}
function AddReadonlyAction(type, options) {
  const result = memory_exports.Update(AddReadonlyOperation(type), {}, options);
  return result;
}
function AddReadonlyInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return AddReadonlyAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/optional/instantiate_add.mjs
function AddOptionalOperation(type) {
  return memory_exports.Update(type, { "~optional": true }, {});
}
function AddOptionalAction(type, options) {
  const result = memory_exports.Update(AddOptionalOperation(type), {}, options);
  return result;
}
function AddOptionalInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return AddOptionalAction(instantiatedType, options);
}

// node_modules/typebox/build/type/types/array.mjs
function _Array_(items, options) {
  return memory_exports.Create({ "~kind": "Array" }, { type: "array", items }, options);
}
function IsArray2(value) {
  return IsKind(value, "Array");
}
function ArrayOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items"]);
}

// node_modules/typebox/build/type/types/constructor.mjs
function Constructor(parameters, instanceType, options = {}) {
  return memory_exports.Create({ "~kind": "Constructor" }, { type: "constructor", parameters, instanceType }, options);
}
function IsConstructor2(value) {
  return IsKind(value, "Constructor");
}
function ConstructorOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "instanceType"]);
}

// node_modules/typebox/build/type/types/function.mjs
function _Function_(parameters, returnType, options = {}) {
  return memory_exports.Create({ ["~kind"]: "Function" }, { type: "function", parameters, returnType }, options);
}
function IsFunction2(value) {
  return IsKind(value, "Function");
}
function FunctionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "returnType"]);
}

// node_modules/typebox/build/type/types/ref.mjs
function Ref2(ref, options) {
  return memory_exports.Create({ ["~kind"]: "Ref" }, { $ref: ref }, options);
}
function IsRef2(value) {
  return IsKind(value, "Ref");
}

// node_modules/typebox/build/type/types/generic.mjs
function Generic(parameters, expression) {
  return memory_exports.Create({ "~kind": "Generic" }, { type: "generic", parameters, expression });
}
function IsGeneric(value) {
  return IsKind(value, "Generic");
}

// node_modules/typebox/build/type/types/any.mjs
function Any(options) {
  return memory_exports.Create({ ["~kind"]: "Any" }, {}, options);
}
function IsAny(value) {
  return IsKind(value, "Any");
}

// node_modules/typebox/build/type/types/never.mjs
var NeverPattern = "(?!)";
function Never(options) {
  return memory_exports.Create({ "~kind": "Never" }, { not: {} }, options);
}
function IsNever(value) {
  return IsKind(value, "Never");
}

// node_modules/typebox/build/type/action/_add_optional.mjs
function AddOptional(type, options = {}) {
  return AddOptionalAction(type, options);
}

// node_modules/typebox/build/type/types/_optional.mjs
function IsOptional(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "~optional");
}

// node_modules/typebox/build/type/types/properties.mjs
function RequiredArray(properties) {
  return guard_exports.Keys(properties).filter((key) => !IsOptional(properties[key]));
}
function PropertyKeys(properties) {
  return guard_exports.Keys(properties);
}
function PropertyValues(properties) {
  return guard_exports.Values(properties);
}

// node_modules/typebox/build/type/types/object.mjs
function _Object_(properties, options = {}) {
  const requiredKeys = RequiredArray(properties);
  const required = requiredKeys.length > 0 ? { required: requiredKeys } : {};
  return memory_exports.Create({ "~kind": "Object" }, { type: "object", ...required, properties }, options);
}
function IsObject2(value) {
  return IsKind(value, "Object");
}
function ObjectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "properties", "required"]);
}

// node_modules/typebox/build/type/types/unknown.mjs
function Unknown(options) {
  return memory_exports.Create({ ["~kind"]: "Unknown" }, {}, options);
}
function IsUnknown(value) {
  return IsKind(value, "Unknown");
}

// node_modules/typebox/build/type/types/cyclic.mjs
function Cyclic($defs, $ref, options) {
  const defs = guard_exports.Keys($defs).reduce((result, key) => {
    return { ...result, [key]: memory_exports.Update($defs[key], {}, { $id: key }) };
  }, {});
  return memory_exports.Create({ ["~kind"]: "Cyclic" }, { $defs: defs, $ref }, options);
}
function IsCyclic(value) {
  return IsKind(value, "Cyclic");
}

// node_modules/typebox/build/type/types/unsafe.mjs
function IsUnsafe(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "~unsafe") && guard_exports.IsNull(value["~unsafe"]);
}

// node_modules/typebox/build/type/types/infer.mjs
function IsInfer(value) {
  return IsKind(value, "Infer");
}

// node_modules/typebox/build/type/types/dependent.mjs
function Dependent(if_, then_, else_, options = {}) {
  return memory_exports.Create({ "~kind": "Dependent" }, { if: if_, then: then_, else: else_ }, options);
}
function IsDependent(value) {
  return IsKind(value, "Dependent");
}
function DependentOptions(type) {
  return memory_exports.Discard(type, ["~kind", "if", "then", "else"]);
}

// node_modules/typebox/build/type/types/enum.mjs
function IsEnum2(value) {
  return IsKind(value, "Enum");
}

// node_modules/typebox/build/type/types/intersect.mjs
function Intersect(types, options = {}) {
  return memory_exports.Create({ "~kind": "Intersect" }, { allOf: types }, options);
}
function IsIntersect(value) {
  return IsKind(value, "Intersect");
}
function IntersectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "allOf"]);
}

// node_modules/typebox/build/type/types/_codec.mjs
function IsCodec(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "~codec") && guard_exports.IsObject(value["~codec"]) && guard_exports.HasPropertyKey(value["~codec"], "encode") && guard_exports.HasPropertyKey(value["~codec"], "decode");
}

// node_modules/typebox/build/type/types/_immutable.mjs
function IsImmutable(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "~immutable");
}

// node_modules/typebox/build/type/action/_add_readonly.mjs
function AddReadonly(type, options = {}) {
  return AddReadonlyAction(type, options);
}

// node_modules/typebox/build/type/types/_readonly.mjs
function IsReadonly(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "~readonly");
}

// node_modules/typebox/build/type/types/bigint.mjs
var BigIntPattern = "-?(?:0|[1-9][0-9]*)n";
function BigInt2(options) {
  return memory_exports.Create({ "~kind": "BigInt" }, { type: "bigint" }, options);
}
function IsBigInt2(value) {
  return IsKind(value, "BigInt");
}

// node_modules/typebox/build/type/types/boolean.mjs
function IsBoolean3(value) {
  return IsKind(value, "Boolean");
}

// node_modules/typebox/build/type/types/integer.mjs
var IntegerPattern = "-?(?:0|[1-9][0-9]*)";
function Integer(options) {
  return memory_exports.Create({ "~kind": "Integer" }, { type: "integer" }, options);
}
function IsInteger2(value) {
  return IsKind(value, "Integer");
}

// node_modules/typebox/build/type/types/literal.mjs
var InvalidLiteralValue = class extends Error {
  constructor(value) {
    super(`Invalid Literal value`);
    Object.defineProperty(this, "cause", {
      value: { value },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
};
function LiteralTypeName(value) {
  return guard_exports.IsBigInt(value) ? "bigint" : guard_exports.IsBoolean(value) ? "boolean" : guard_exports.IsNumber(value) ? "number" : guard_exports.IsString(value) ? "string" : (() => {
    throw new InvalidLiteralValue(value);
  })();
}
function Literal(value, options) {
  return memory_exports.Create({ "~kind": "Literal" }, { type: LiteralTypeName(value), const: value }, options);
}
function IsLiteralValue(value) {
  return guard_exports.IsBigInt(value) || guard_exports.IsBoolean(value) || guard_exports.IsNumber(value) || guard_exports.IsString(value);
}
function IsLiteralBigInt(value) {
  return IsLiteral(value) && guard_exports.IsBigInt(value.const);
}
function IsLiteralBoolean(value) {
  return IsLiteral(value) && guard_exports.IsBoolean(value.const);
}
function IsLiteralNumber(value) {
  return IsLiteral(value) && guard_exports.IsNumber(value.const);
}
function IsLiteralString(value) {
  return IsLiteral(value) && guard_exports.IsString(value.const);
}
function IsLiteral(value) {
  return IsKind(value, "Literal");
}

// node_modules/typebox/build/type/types/null.mjs
function Null(options) {
  return memory_exports.Create({ "~kind": "Null" }, { type: "null" }, options);
}
function IsNull2(value) {
  return IsKind(value, "Null");
}

// node_modules/typebox/build/type/types/number.mjs
var NumberPattern = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?";
function Number2(options) {
  return memory_exports.Create({ "~kind": "Number" }, { type: "number" }, options);
}
function IsNumber3(value) {
  return IsKind(value, "Number");
}

// node_modules/typebox/build/type/types/symbol.mjs
function Symbol2(options) {
  return memory_exports.Create({ "~kind": "Symbol" }, { type: "symbol" }, options);
}
function IsSymbol2(value) {
  return IsKind(value, "Symbol");
}

// node_modules/typebox/build/type/types/string.mjs
var StringPattern = ".*";
function String2(options) {
  return memory_exports.Create({ "~kind": "String" }, { type: "string" }, options);
}
function IsString3(value) {
  return IsKind(value, "String");
}

// node_modules/typebox/build/type/types/union.mjs
function Union(anyOf, options = {}) {
  return memory_exports.Create({ "~kind": "Union" }, { anyOf }, options);
}
function IsUnion(value) {
  return IsKind(value, "Union");
}
function UnionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "anyOf"]);
}

// node_modules/typebox/build/type/engine/patterns/pattern.mjs
function ParsePatternIntoTypes(pattern) {
  const parsed = Pattern(pattern);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : [];
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/is_finite.mjs
function FromLiteral(_value) {
  return true;
}
function FromTypesReduce(types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType(left) ? FromTypesReduce(right) : false, () => true);
}
function FromTypes(types) {
  const result = guard_exports.IsEqual(types.length, 0) ? false : FromTypesReduce(types);
  return result;
}
function FromType(type) {
  return IsUnion(type) ? FromTypes(type.anyOf) : IsLiteral(type) ? FromLiteral(type.const) : false;
}
function IsTemplateLiteralFinite(types) {
  const result = FromTypes(types);
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/create.mjs
function TemplateLiteralCreate(pattern) {
  return memory_exports.Create({ ["~kind"]: "TemplateLiteral" }, { type: "string", pattern }, {});
}

// node_modules/typebox/build/type/engine/template_literal/decode.mjs
function FromLiteralPush(variants, value, result = []) {
  return guard_exports.ShiftLeft(variants, (left, right) => FromLiteralPush(right, value, [...result, `${left}${value}`]), () => result);
}
function FromLiteral2(variants, value) {
  return guard_exports.IsEqual(variants.length, 0) ? [`${value}`] : FromLiteralPush(variants, value);
}
function FromUnion(variants, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => FromUnion(variants, right, [...result, ...FromType2(variants, left)]), () => result);
}
function FromType2(variants, type) {
  const result = IsUnion(type) ? FromUnion(variants, type.anyOf) : IsLiteral(type) ? FromLiteral2(variants, type.const) : Unreachable();
  return result;
}
function DecodeFromSpan(variants, types) {
  return guard_exports.ShiftLeft(types, (left, right) => DecodeFromSpan(FromType2(variants, left), right), () => variants);
}
function VariantsToLiterals(variants) {
  return variants.map((variant) => Literal(variant));
}
function DecodeTypesAsUnion(types) {
  const variants = DecodeFromSpan([], types);
  const literals = VariantsToLiterals(variants);
  const result = Union(literals);
  return result;
}
function DecodeTypes(types) {
  return guard_exports.IsEqual(types.length, 0) ? Unreachable() : (
    // Literal('') :
    guard_exports.IsEqual(types.length, 1) && IsLiteral(types[0]) ? types[0] : DecodeTypesAsUnion(types)
  );
}
function TemplateLiteralDecodeUnsafe(pattern) {
  const types = ParsePatternIntoTypes(pattern);
  const result = guard_exports.IsEqual(types.length, 0) ? String2() : IsTemplateLiteralFinite(types) ? DecodeTypes(types) : TemplateLiteralCreate(pattern);
  return result;
}
function TemplateLiteralDecode(pattern) {
  const decoded = TemplateLiteralDecodeUnsafe(pattern);
  const result = IsTemplateLiteral(decoded) ? String2() : decoded;
  return result;
}

// node_modules/typebox/build/type/engine/record/record_create.mjs
function CreateRecord(key, value) {
  const type = "object";
  const patternProperties = { [key]: value };
  return memory_exports.Create({ ["~kind"]: "Record" }, { type, patternProperties });
}

// node_modules/typebox/build/type/engine/record/from_key_any.mjs
function FromAnyKey(value) {
  return CreateRecord(StringKey, value);
}

// node_modules/typebox/build/type/engine/record/from_key_boolean.mjs
function FromBooleanKey(value) {
  return _Object_({ true: value, false: value });
}

// node_modules/typebox/build/type/types/tuple.mjs
function Tuple(types, options = {}) {
  const [items, minItems, additionalItems] = [types, types.length, false];
  return memory_exports.Create({ ["~kind"]: "Tuple" }, { type: "array", additionalItems, items, minItems }, options);
}
function IsTuple(value) {
  return IsKind(value, "Tuple");
}
function TupleOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items", "minItems", "additionalItems"]);
}

// node_modules/typebox/build/type/engine/readonly/instantiate_remove.mjs
function RemoveReadonlyOperation(type) {
  return memory_exports.Discard(type, ["~readonly"]);
}
function RemoveReadonlyAction(type, options) {
  const result = memory_exports.Update(RemoveReadonlyOperation(type), {}, options);
  return result;
}
function RemoveReadonlyInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return RemoveReadonlyAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/_remove_readonly.mjs
function RemoveReadonly(type, options = {}) {
  return RemoveReadonlyAction(type, options);
}

// node_modules/typebox/build/type/engine/optional/instantiate_remove.mjs
function RemoveOptionalOperation(type) {
  return memory_exports.Discard(type, ["~optional"]);
}
function RemoveOptionalAction(type, options) {
  const result = memory_exports.Update(RemoveOptionalOperation(type), {}, options);
  return result;
}
function RemoveOptionalInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return RemoveOptionalAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/_remove_optional.mjs
function RemoveOptional(type, options = {}) {
  return RemoveOptionalAction(type, options);
}

// node_modules/typebox/build/type/engine/tuple/to_object.mjs
function TupleElementsToProperties(types) {
  const result = types.reduceRight((result2, right, index) => {
    return { [index]: right, ...result2 };
  }, {});
  return result;
}
function TupleToObject(type) {
  const properties = TupleElementsToProperties(type.items);
  const result = _Object_(properties);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/composite.mjs
function CanComposite(type) {
  return IsObject2(type) || IsTuple(type);
}
function IsReadonlyProperty(left, right) {
  return IsReadonly(left) ? IsReadonly(right) ? true : false : false;
}
function IsOptionalProperty(left, right) {
  return IsOptional(left) ? IsOptional(right) ? true : false : false;
}
function CompositeProperty(left, right) {
  const isReadonly = IsReadonlyProperty(left, right);
  const isOptional = IsOptionalProperty(left, right);
  const evaluated = EvaluateIntersect([left, right]);
  const property = RemoveReadonly(RemoveOptional(evaluated));
  return isReadonly && isOptional ? AddReadonly(AddOptional(property)) : isReadonly && !isOptional ? AddReadonly(property) : !isReadonly && isOptional ? AddOptional(property) : property;
}
function CompositePropertyKey(left, right, key) {
  return key in left ? key in right ? CompositeProperty(left[key], right[key]) : left[key] : key in right ? right[key] : Never();
}
function CompositeProperties(left, right) {
  const keys = /* @__PURE__ */ new Set([...guard_exports.Keys(left), ...guard_exports.Keys(right)]);
  const result = [...keys].reduce((result2, key) => {
    return { ...result2, [key]: CompositePropertyKey(left, right, key) };
  }, {});
  return result;
}
function GetProperties(type) {
  const result = IsObject2(type) ? type.properties : IsTuple(type) ? TupleElementsToProperties(type.items) : {};
  return result;
}
function Composite(left, right) {
  const leftProperties = GetProperties(left);
  const rightProperties = GetProperties(right);
  const properties = CompositeProperties(leftProperties, rightProperties);
  const result = _Object_(properties);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/narrow.mjs
function NarrowCompareRule(left, right) {
  const result = Compare(left, right);
  return guard_exports.IsEqual(result, CompareResultLeftInside) ? left : guard_exports.IsEqual(result, CompareResultRightInside) ? right : guard_exports.IsEqual(result, CompareResultEqual) ? right : Never();
}
function NarrowCompositeRule(left, right) {
  const canCompositeLeft = CanComposite(left);
  const canCompositeRight = CanComposite(right);
  return canCompositeLeft && canCompositeRight ? Composite(left, right) : canCompositeLeft && !canCompositeRight ? left : !canCompositeLeft && canCompositeRight ? right : NarrowCompareRule(left, right);
}
function Narrow(left, right) {
  return IsNever(left) ? left : IsAny(left) ? left : IsUnknown(left) ? right : IsNever(right) ? right : IsAny(right) ? right : IsUnknown(right) ? left : NarrowCompositeRule(left, right);
}

// node_modules/typebox/build/type/engine/evaluate/distribute.mjs
function ShouldEvaluate(left, right) {
  const result = IsUnion(left) || IsUnion(right);
  return result;
}
function DistributeOperation(left, right) {
  const evaluatedLeft = EvaluateType(left);
  const evaluatedRight = EvaluateType(right);
  const shouldEvaluate = ShouldEvaluate(evaluatedLeft, evaluatedRight);
  const result = shouldEvaluate ? EvaluateIntersect([evaluatedLeft, evaluatedRight]) : Narrow(evaluatedLeft, evaluatedRight);
  return result;
}
function DistributeType(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeType(type, right, [...result, DistributeOperation(left, type)]), () => guard_exports.IsEqual(result.length, 0) ? [type] : result);
}
function DistributeUnion(types, distribution, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeUnion(right, distribution, [...result, ...Distribute([left], distribution)]), () => result);
}
function Distribute(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => IsUnion(left) ? Distribute(right, DistributeUnion(left.anyOf, result)) : Distribute(right, DistributeType(left, result)), () => result);
}

// node_modules/typebox/build/type/engine/exclude/operation.mjs
function ExcludeType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [] : [left];
  return result;
}
function ExcludeUnion(left, right, result = []) {
  return guard_exports.ShiftLeft(left, (head, tail) => ExcludeUnion(tail, right, [...result, ...ExcludeType(head, right)]), () => result);
}
function ExcludeOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExcludeUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/evaluate.mjs
function EvaluateDependent(if_, then_, else_) {
  const intersected = EvaluateIntersect([if_, then_]);
  const excluded = ExcludeOperation(else_, if_);
  const result = EvaluateUnion([intersected, excluded]);
  return result;
}
function EvaluateEnum(values, result = []) {
  return guard_exports.ShiftLeft(values, (left, right) => EvaluateEnum(right, [...result, Literal(left)]), () => EvaluateUnion(result));
}
function EvaluateIntersect(types) {
  const distribution = Distribute(types);
  const broadend = Broaden(distribution);
  const result = EvaluateUnion(broadend);
  return result;
}
function EvaluateTemplateLiteral(pattern) {
  const evaluated = TemplateLiteralDecode(pattern);
  const result = EvaluateType(evaluated);
  return result;
}
function EvaluateUnion(types) {
  const broadend = Broaden(types);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateType(type) {
  const result = IsDependent(type) ? EvaluateDependent(type.if, type.then, type.else) : IsEnum2(type) ? EvaluateEnum(type.enum) : IsIntersect(type) ? EvaluateIntersect(type.allOf) : IsTemplateLiteral(type) ? EvaluateTemplateLiteral(type.pattern) : IsUnion(type) ? EvaluateUnion(type.anyOf) : type;
  return result;
}
function EvaluateUnionFast(types) {
  const result = guard_exports.IsEqual(types.length, 1) ? types[0] : guard_exports.IsEqual(types.length, 0) ? Never() : Union(types);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_enum.mjs
function FromEnumKey(values, value) {
  const unionKey = EvaluateEnum(values);
  const result = FromKey(unionKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_integer.mjs
function FromIntegerKey(_key, value) {
  const result = CreateRecord(IntegerKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_intersect.mjs
function FromIntersectKey(types, value) {
  const evaluatedKey = EvaluateIntersect(types);
  const result = FromKey(evaluatedKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_literal.mjs
function FromLiteralKey(key, value) {
  return guard_exports.IsString(key) || guard_exports.IsNumber(key) ? _Object_({ [key]: value }) : guard_exports.IsEqual(key, false) ? _Object_({ false: value }) : guard_exports.IsEqual(key, true) ? _Object_({ true: value }) : _Object_({});
}

// node_modules/typebox/build/type/engine/record/from_key_number.mjs
function FromNumberKey(_key, value) {
  const result = CreateRecord(NumberKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_string.mjs
function FromStringKey(key, value) {
  return guard_exports.HasPropertyKey(key, "pattern") && (guard_exports.IsString(key.pattern) || key.pattern instanceof RegExp) ? CreateRecord(key.pattern.toString(), value) : CreateRecord(StringKey, value);
}

// node_modules/typebox/build/type/engine/record/from_key_template_literal.mjs
function FromTemplateKey(pattern, value) {
  const types = ParsePatternIntoTypes(pattern);
  const finite = IsTemplateLiteralFinite(types);
  const result = finite ? FromKey(EvaluateTemplateLiteral(pattern), value) : CreateRecord(pattern, value);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/flatten.mjs
function FlattenType(type) {
  const result = IsUnion(type) ? Flatten(type.anyOf) : [type];
  return result;
}
function Flatten(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => Flatten(right, [...result, ...FlattenType(left)]), () => result);
}

// node_modules/typebox/build/type/engine/record/from_key_union.mjs
function StringOrNumberCheck(types) {
  return types.some((type) => IsString3(type) || IsNumber3(type) || IsInteger2(type));
}
function TryBuildRecord(types, value) {
  return guard_exports.IsEqual(StringOrNumberCheck(types), true) ? CreateRecord(StringKey, value) : void 0;
}
function CreateProperties(types, value) {
  return types.reduce((result, left) => {
    return IsLiteral(left) && (guard_exports.IsString(left.const) || guard_exports.IsNumber(left.const)) ? { ...result, [left.const]: value } : result;
  }, {});
}
function CreateObject(types, value) {
  const properties = CreateProperties(types, value);
  const result = _Object_(properties);
  return result;
}
function FromUnionKey(types, value) {
  const flattened = Flatten(types);
  const record2 = TryBuildRecord(flattened, value);
  return IsSchema2(record2) ? record2 : CreateObject(flattened, value);
}

// node_modules/typebox/build/type/engine/record/from_key.mjs
function FromKey(key, value) {
  const result = IsAny(key) ? FromAnyKey(value) : IsBoolean3(key) ? FromBooleanKey(value) : IsEnum2(key) ? FromEnumKey(key.enum, value) : IsInteger2(key) ? FromIntegerKey(key, value) : IsIntersect(key) ? FromIntersectKey(key.allOf, value) : IsLiteral(key) ? FromLiteralKey(key.const, value) : IsNumber3(key) ? FromNumberKey(key, value) : IsUnion(key) ? FromUnionKey(key.anyOf, value) : IsString3(key) ? FromStringKey(key, value) : IsTemplateLiteral(key) ? FromTemplateKey(key.pattern, value) : _Object_({});
  return result;
}

// node_modules/typebox/build/type/engine/record/instantiate.mjs
function RecordAction(key, value, options) {
  const result = CanInstantiate([key]) ? memory_exports.Update(FromKey(key, value), {}, options) : RecordDeferred(key, value, options);
  return result;
}
function RecordInstantiate(context2, state, key, value, options) {
  const instantiatedKey = InstantiateType(context2, state, key);
  const instantiatedValue = InstantiateType(context2, state, value);
  return RecordAction(instantiatedKey, instantiatedValue, options);
}

// node_modules/typebox/build/type/types/record.mjs
var IntegerKey = `^${IntegerPattern}$`;
var NumberKey = `^${NumberPattern}$`;
var StringKey = `^${StringPattern}$`;
function RecordDeferred(key, value, options = {}) {
  return Deferred("Record", [key, value], options);
}
function Record(key, value, options = {}) {
  return RecordAction(key, value, options);
}
function RecordFromPattern(pattern, value) {
  return CreateRecord(pattern, value);
}
function RecordPatternToType(pattern) {
  const result = guard_exports.IsEqual(pattern, StringKey) ? String2() : guard_exports.IsEqual(pattern, IntegerKey) ? Integer() : guard_exports.IsEqual(pattern, NumberKey) ? Number2() : TemplateLiteralDecodeUnsafe(pattern);
  return result;
}
function RecordPattern(type) {
  return guard_exports.Keys(type.patternProperties)[0];
}
function RecordKey(type) {
  const pattern = RecordPattern(type);
  const result = RecordPatternToType(pattern);
  return result;
}
function RecordValue(type) {
  return type.patternProperties[RecordPattern(type)];
}
function IsRecord(value) {
  return IsKind(value, "Record");
}

// node_modules/typebox/build/type/types/rest.mjs
function Rest(type) {
  return memory_exports.Create({ "~kind": "Rest" }, { type: "rest", items: type }, {});
}
function IsRest(value) {
  return IsKind(value, "Rest");
}

// node_modules/typebox/build/type/types/this.mjs
function IsThis(value) {
  return IsKind(value, "This");
}

// node_modules/typebox/build/type/types/undefined.mjs
function Undefined(options) {
  return memory_exports.Create({ "~kind": "Undefined" }, { type: "undefined" }, options);
}
function IsUndefined2(value) {
  return IsKind(value, "Undefined");
}

// node_modules/typebox/build/type/types/void.mjs
function IsVoid(value) {
  return IsKind(value, "Void");
}

// node_modules/typebox/build/type/script/mapping.mjs
function PatternBigIntMapping(input) {
  return BigInt2();
}
function PatternStringMapping(input) {
  return String2();
}
function PatternNumberMapping(input) {
  return Number2();
}
function PatternIntegerMapping(input) {
  return Integer();
}
function PatternNeverMapping(input) {
  return Never();
}
function PatternTextMapping(input) {
  return Literal(input);
}
function PatternBaseMapping(input) {
  return input;
}
function PatternGroupMapping(input) {
  return Union(input[1]);
}
function PatternUnionMapping(input) {
  return input.length === 3 ? [...input[0], ...input[2]] : input.length === 1 ? [...input[0]] : [];
}
function PatternTermMapping(input) {
  return [input[0], ...input[1]];
}
function PatternBodyMapping(input) {
  return input;
}
function PatternMapping(input) {
  return input[1];
}

// node_modules/typebox/build/type/script/token/internal/match.mjs
function IsMatch(value) {
  return IsEqual(value.length, 2);
}
function Match3(input, ok, fail) {
  return IsMatch(input) ? ok(input[0], input[1]) : fail();
}

// node_modules/typebox/build/type/script/token/internal/take.mjs
function TakeVariant(variant, input) {
  return IsEqual(input.indexOf(variant), 0) ? [variant, input.slice(variant.length)] : [];
}
function Take(variants, input) {
  for (let i = 0; i < variants.length; i++) {
    const result = TakeVariant(variants[i], input);
    if (IsMatch(result))
      return result;
  }
  return [];
}

// node_modules/typebox/build/type/script/token/internal/char.mjs
function Range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i));
}
var Alpha = [
  ...Range(97, 122),
  // Lowercase
  ...Range(65, 90)
  // Uppercase
];
var Zero = "0";
var NonZero = Range(49, 57);
var Digit = [Zero, ...NonZero];
var WhiteSpace = " ";
var NewLine = "\n";
var UnderScore = "_";
var DollarSign = "$";

// node_modules/typebox/build/type/script/token/internal/trim.mjs
var LineComment = "//";
var OpenComment = "/*";
var CloseComment = "*/";
function DiscardMultilineComment(input) {
  const index = input.indexOf(CloseComment);
  const result = IsEqual(index, -1) ? "" : input.slice(index + 2);
  return result;
}
function DiscardLineComment(input) {
  const index = input.indexOf(NewLine);
  const result = IsEqual(index, -1) ? "" : input.slice(index);
  return result;
}
function TrimStartUntilNewline(input) {
  return input.replace(/^[ \t\r\f\v]+/, "");
}
function TrimWhitespace(input) {
  const trimmed = TrimStartUntilNewline(input);
  return trimmed.startsWith(OpenComment) ? TrimWhitespace(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? TrimWhitespace(DiscardLineComment(trimmed.slice(2))) : trimmed;
}
function Trim(input) {
  const trimmed = input.trimStart();
  return trimmed.startsWith(OpenComment) ? Trim(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? Trim(DiscardLineComment(trimmed.slice(2))) : trimmed;
}

// node_modules/typebox/build/type/script/token/unsigned_integer.mjs
var AllowedDigits = [...Digit, UnderScore];

// node_modules/typebox/build/type/script/token/const.mjs
function TakeConst(const_, input) {
  return Take([const_], input);
}
function Const(const_, input) {
  return IsEqual(const_, "") ? ["", input] : const_.startsWith(NewLine) ? TakeConst(const_, TrimWhitespace(input)) : const_.startsWith(WhiteSpace) ? TakeConst(const_, input) : TakeConst(const_, Trim(input));
}

// node_modules/typebox/build/type/script/token/ident.mjs
var Initial = [...Alpha, UnderScore, DollarSign];
var Remaining = [...Initial, ...Digit];

// node_modules/typebox/build/type/script/token/unsigned_number.mjs
var AllowedDigits2 = [...Digit, UnderScore];

// node_modules/typebox/build/type/script/token/until.mjs
function TakeOne(input) {
  const result = IsEqual(input, "") ? [] : [input.slice(0, 1), input.slice(1)];
  return result;
}
function IsInputMatchSentinal(end, input) {
  return ShiftLeft(end, (left, right) => input.startsWith(left) ? true : IsInputMatchSentinal(right, input), () => false);
}
function Until(end, input, result = "") {
  return Match3(
    TakeOne(input),
    (One, Rest2) => IsInputMatchSentinal(end, input) ? [result, input] : Until(end, Rest2, `${result}${One}`),
    () => []
  );
}

// node_modules/typebox/build/type/script/token/until_1.mjs
function Until_1(end, input) {
  return Match3(Until(end, input), (Until2, UntilRest) => IsEqual(Until2, "") ? [] : [Until2, UntilRest], () => []);
}

// node_modules/typebox/build/type/script/parser.mjs
var If = (result, left, right = () => []) => result.length === 2 ? left(result) : right();
var PatternBigInt = (input) => If(Const("-?(?:0|[1-9][0-9]*)n", input), ([_0, input2]) => [PatternBigIntMapping(_0), input2]);
var PatternString = (input) => If(Const(".*", input), ([_0, input2]) => [PatternStringMapping(_0), input2]);
var PatternNumber = (input) => If(Const("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", input), ([_0, input2]) => [PatternNumberMapping(_0), input2]);
var PatternInteger = (input) => If(Const("-?(?:0|[1-9][0-9]*)", input), ([_0, input2]) => [PatternIntegerMapping(_0), input2]);
var PatternNever = (input) => If(Const("(?!)", input), ([_0, input2]) => [PatternNeverMapping(_0), input2]);
var PatternText = (input) => If(Until_1(["-?(?:0|[1-9][0-9]*)n", ".*", "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", "-?(?:0|[1-9][0-9]*)", "(?!)", "(", ")", "$", "|"], input), ([_0, input2]) => [PatternTextMapping(_0), input2]);
var PatternBase = (input) => If(If(PatternBigInt(input), ([_0, input2]) => [_0, input2], () => If(PatternString(input), ([_0, input2]) => [_0, input2], () => If(PatternNumber(input), ([_0, input2]) => [_0, input2], () => If(PatternInteger(input), ([_0, input2]) => [_0, input2], () => If(PatternNever(input), ([_0, input2]) => [_0, input2], () => If(PatternGroup(input), ([_0, input2]) => [_0, input2], () => If(PatternText(input), ([_0, input2]) => [_0, input2], () => []))))))), ([_0, input2]) => [PatternBaseMapping(_0), input2]);
var PatternGroup = (input) => If(If(Const("(", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternGroupMapping(_0), input2]);
var PatternUnion = (input) => If(If(If(PatternTerm(input), ([_0, input2]) => If(Const("|", input2), ([_1, input3]) => If(PatternUnion(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(PatternTerm(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [PatternUnionMapping(_0), input2]);
var PatternTerm = (input) => If(If(PatternBase(input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PatternTermMapping(_0), input2]);
var PatternBody = (input) => If(If(PatternUnion(input), ([_0, input2]) => [_0, input2], () => If(PatternTerm(input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PatternBodyMapping(_0), input2]);
var Pattern = (input) => If(If(Const("^", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const("$", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternMapping(_0), input2]);

// node_modules/typebox/build/type/engine/template_literal/encode.mjs
function JoinString(input) {
  return input.join("|");
}
function UnwrapTemplateLiteralPattern(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function EncodeLiteral(value, right, pattern) {
  return EncodeTypes(right, `${pattern}${value}`);
}
function EncodeBigInt(right, pattern) {
  return EncodeTypes(right, `${pattern}${BigIntPattern}`);
}
function EncodeInteger(right, pattern) {
  return EncodeTypes(right, `${pattern}${IntegerPattern}`);
}
function EncodeNumber(right, pattern) {
  return EncodeTypes(right, `${pattern}${NumberPattern}`);
}
function EncodeBoolean(right, pattern) {
  return EncodeType(Union([Literal("false"), Literal("true")]), right, pattern);
}
function EncodeString(right, pattern) {
  return EncodeTypes(right, `${pattern}${StringPattern}`);
}
function EncodeTemplateLiteral(templatePattern, right, pattern) {
  return EncodeTypes(right, `${pattern}${UnwrapTemplateLiteralPattern(templatePattern)}`);
}
function EncodeTemplateLiteralDeferred(types, right, pattern) {
  const templateLiteral = TemplateLiteralAction(types, {});
  const result = EncodeType(templateLiteral, right, pattern);
  return result;
}
function EncodeEnum(values, right, pattern) {
  const evaluated = EvaluateEnum(values);
  return EncodeType(evaluated, right, pattern);
}
function EncodeUnion(types, right, pattern, result = []) {
  return guard_exports.ShiftLeft(types, (head, tail) => EncodeUnion(tail, right, pattern, [...result, EncodeType(head, [], "")]), () => EncodeTypes(right, `${pattern}(${JoinString(result)})`));
}
function EncodeType(type, right, pattern) {
  return IsEnum2(type) ? EncodeEnum(type.enum, right, pattern) : IsInteger2(type) ? EncodeInteger(right, pattern) : IsLiteral(type) ? EncodeLiteral(type.const, right, pattern) : IsBigInt2(type) ? EncodeBigInt(right, pattern) : IsBoolean3(type) ? EncodeBoolean(right, pattern) : IsNumber3(type) ? EncodeNumber(right, pattern) : IsString3(type) ? EncodeString(right, pattern) : IsTemplateLiteral(type) ? EncodeTemplateLiteral(type.pattern, right, pattern) : IsTemplateLiteralDeferred(type) ? EncodeTemplateLiteralDeferred(type.parameters[0], right, pattern) : IsUnion(type) ? EncodeUnion(type.anyOf, right, pattern) : NeverPattern;
}
function EncodeTypes(types, pattern) {
  return guard_exports.ShiftLeft(types, (left, right) => EncodeType(left, right, pattern), () => pattern);
}
function EncodePattern(types) {
  const encoded = EncodeTypes(types, "");
  const result = `^${encoded}$`;
  return result;
}
function TemplateLiteralEncode(types) {
  const pattern = EncodePattern(types);
  const result = TemplateLiteralCreate(pattern);
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/instantiate.mjs
function TemplateLiteralAction(types, options) {
  const result = CanInstantiate(types) ? memory_exports.Update(TemplateLiteralEncode(types), {}, options) : TemplateLiteralDeferred(types, options);
  return result;
}
function TemplateLiteralInstantiate(context2, state, types, options) {
  const instantiatedTypes = InstantiateTypes(context2, state, types);
  return TemplateLiteralAction(instantiatedTypes, options);
}

// node_modules/typebox/build/type/types/template_literal.mjs
function TemplateLiteralDeferred(types, options = {}) {
  return Deferred("TemplateLiteral", [types], options);
}
function IsTemplateLiteralDeferred(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "TemplateLiteral");
}
function IsTemplateLiteral(value) {
  return IsKind(value, "TemplateLiteral");
}

// node_modules/typebox/build/type/extends/result.mjs
var result_exports = {};
__export(result_exports, {
  ExtendsFalse: () => ExtendsFalse,
  ExtendsTrue: () => ExtendsTrue,
  ExtendsUnion: () => ExtendsUnion,
  IsExtendsFalse: () => IsExtendsFalse,
  IsExtendsTrue: () => IsExtendsTrue,
  IsExtendsTrueLike: () => IsExtendsTrueLike,
  IsExtendsUnion: () => IsExtendsUnion,
  Match: () => Match4
});
function ExtendsUnion(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsUnion" }, { inferred });
}
function IsExtendsUnion(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsUnion") && guard_exports.IsObject(value.inferred);
}
function ExtendsTrue(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsTrue" }, { inferred });
}
function IsExtendsTrue(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsTrue") && guard_exports.IsObject(value.inferred);
}
function ExtendsFalse() {
  return memory_exports.Create({ ["~kind"]: "ExtendsFalse" }, {});
}
function IsExtendsFalse(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], "ExtendsFalse");
}
function IsExtendsTrueLike(value) {
  return IsExtendsUnion(value) || IsExtendsTrue(value);
}
function Match4(result, true_, false_) {
  return IsExtendsTrueLike(result) ? true_(result.inferred) : false_();
}

// node_modules/typebox/build/type/extends/extends_right.mjs
function ExtendsRightInfer(inferred, name, left, right) {
  return Match4(ExtendsLeft(inferred, left, right), (checkInferred) => ExtendsTrue(memory_exports.Assign(memory_exports.Assign(inferred, checkInferred), { [name]: left })), () => ExtendsFalse());
}
function ExtendsRightAny(inferred, _left) {
  return ExtendsTrue(inferred);
}
function ExtendsRightDependent(inferred, left, if_, then_, else_) {
  return Match4(ExtendsLeft(inferred, left, if_), (inferred2) => Match4(ExtendsLeft(inferred2, left, then_), (inferred3) => ExtendsTrue(inferred3), () => ExtendsFalse()), () => Match4(ExtendsLeft(inferred, left, else_), (inferred2) => ExtendsTrue(inferred2), () => ExtendsFalse()));
}
function ExtendsRightEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightIntersect(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match4(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsRightIntersect(inferred2, left, tail), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsRightTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightUnion(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match4(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsRightUnion(inferred, left, tail)), () => ExtendsFalse());
}
function ExtendsRight(inferred, left, right) {
  return IsAny(right) ? ExtendsRightAny(inferred, left) : IsDependent(right) ? ExtendsRightDependent(inferred, left, right.if, right.then, right.else) : IsEnum2(right) ? ExtendsRightEnum(inferred, left, right.enum) : IsInfer(right) ? ExtendsRightInfer(inferred, right.name, left, right.extends) : IsIntersect(right) ? ExtendsRightIntersect(inferred, left, right.allOf) : IsTemplateLiteral(right) ? ExtendsRightTemplateLiteral(inferred, left, right.pattern) : IsUnion(right) ? ExtendsRightUnion(inferred, left, right.anyOf) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/any.mjs
function ExtendsAny(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsUnion(inferred);
}

// node_modules/typebox/build/type/extends/array.mjs
function ExtendsImmutable(left, right) {
  const isImmutableLeft = IsImmutable(left);
  const isImmutableRight = IsImmutable(right);
  return isImmutableLeft && isImmutableRight ? true : !isImmutableLeft && isImmutableRight ? true : isImmutableLeft && !isImmutableRight ? false : true;
}
function ExtendsArray(inferred, arrayLeft, left, right) {
  return IsArray2(right) ? ExtendsImmutable(arrayLeft, right) ? ExtendsLeft(inferred, left, right.items) : ExtendsFalse() : ExtendsRight(inferred, arrayLeft, right);
}

// node_modules/typebox/build/type/extends/bigint.mjs
function ExtendsBigInt(inferred, left, right) {
  return IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/boolean.mjs
function ExtendsBoolean(inferred, left, right) {
  return IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/parameters.mjs
function ParameterCompare(inferred, left, leftRest, right, rightRest) {
  const checkLeft = IsInfer(right) ? left : right;
  const checkRight = IsInfer(right) ? right : left;
  const isLeftOptional = IsOptional(left);
  const isRightOptional = IsOptional(right);
  return !isLeftOptional && isRightOptional ? ExtendsFalse() : Match4(ExtendsLeft(inferred, checkLeft, checkRight), (inferred2) => ExtendsParameters(inferred2, leftRest, rightRest), () => ExtendsFalse());
}
function ParameterRight(inferred, left, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ParameterCompare(inferred, left, leftRest, head, tail), () => IsOptional(left) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function ParametersLeft(inferred, left, rightRest) {
  return guard_exports.ShiftLeft(left, (head, tail) => ParameterRight(inferred, head, tail, rightRest), () => ExtendsTrue(inferred));
}
function ExtendsParameters(inferred, left, right) {
  return ParametersLeft(inferred, left, right);
}

// node_modules/typebox/build/type/extends/return_type.mjs
function ExtendsReturnType(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsLeft(inferred, left, right);
}

// node_modules/typebox/build/type/extends/constructor.mjs
function ExtendsConstructor(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsConstructor2(right) ? Match4(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["instanceType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/dependent.mjs
function ExtendsDependent(inferred, if_, then_, else_, right) {
  return Match4(ExtendsLeft(inferred, if_, right), () => ExtendsLeft(inferred, then_, right), () => ExtendsLeft(inferred, else_, right));
}

// node_modules/typebox/build/type/extends/enum.mjs
function ExtendsEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/function.mjs
function ExtendsFunction(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsFunction2(right) ? Match4(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["returnType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/integer.mjs
function ExtendsInteger(inferred, left, right) {
  return IsInteger2(right) ? ExtendsTrue(inferred) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/intersect.mjs
function ExtendsIntersect(inferred, left, right) {
  const evaluated = EvaluateIntersect(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/literal.mjs
function ExtendsLiteralValue(inferred, left, right) {
  return left === right ? ExtendsTrue(inferred) : ExtendsFalse();
}
function ExtendsLiteralBigInt(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralBoolean(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralNumber(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralString(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteral(inferred, left, right) {
  return guard_exports.IsBigInt(left.const) ? ExtendsLiteralBigInt(inferred, left.const, right) : guard_exports.IsBoolean(left.const) ? ExtendsLiteralBoolean(inferred, left.const, right) : guard_exports.IsNumber(left.const) ? ExtendsLiteralNumber(inferred, left.const, right) : guard_exports.IsString(left.const) ? ExtendsLiteralString(inferred, left.const, right) : Unreachable();
}

// node_modules/typebox/build/type/extends/never.mjs
function ExtendsNever(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : ExtendsTrue(inferred);
}

// node_modules/typebox/build/type/extends/null.mjs
function ExtendsNull(inferred, left, right) {
  return IsNull2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/number.mjs
function ExtendsNumber(inferred, left, right) {
  return IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/object.mjs
function ExtendsPropertyOptional(inferred, left, right) {
  return IsOptional(left) ? IsOptional(right) ? ExtendsTrue(inferred) : ExtendsFalse() : ExtendsTrue(inferred);
}
function ExtendsProperty(inferred, left, right) {
  return (
    // Right TInfer<TNever> is TExtendsFalse
    IsInfer(right) && IsNever(right.extends) ? ExtendsFalse() : Match4(ExtendsLeft(inferred, left, right), (inferred2) => ExtendsPropertyOptional(inferred2, left, right), () => ExtendsFalse())
  );
}
function ExtractInferredProperties(keys, properties) {
  return keys.reduce((result, key) => {
    return key in properties ? IsExtendsTrueLike(properties[key]) ? { ...result, ...properties[key].inferred } : Unreachable() : Unreachable();
  }, {});
}
function ExtendsPropertiesComparer(inferred, left, right) {
  const properties = {};
  for (const rightKey of guard_exports.Keys(right)) {
    properties[rightKey] = rightKey in left ? ExtendsProperty({}, left[rightKey], right[rightKey]) : IsOptional(right[rightKey]) ? IsInfer(right[rightKey]) ? ExtendsTrue(memory_exports.Assign(inferred, { [right[rightKey].name]: right[rightKey].extends })) : ExtendsTrue(inferred) : ExtendsFalse();
  }
  const checked = guard_exports.Values(properties).every((result) => IsExtendsTrueLike(result));
  const extracted = checked ? ExtractInferredProperties(guard_exports.Keys(properties), properties) : {};
  return checked ? ExtendsTrue(extracted) : ExtendsFalse();
}
function ExtendsProperties(inferred, left, right) {
  const compared = ExtendsPropertiesComparer(inferred, left, right);
  return IsExtendsTrueLike(compared) ? ExtendsTrue(memory_exports.Assign(inferred, compared.inferred)) : ExtendsFalse();
}
function ExtendsObjectToObject(inferred, left, right) {
  return ExtendsProperties(inferred, left, right);
}
function RecordMergeInferred(left, right) {
  return guard_exports.Keys(right).reduce((result, key) => {
    return {
      ...result,
      [key]: guard_exports.HasPropertyKey(left, key) ? IsUnion(result[key]) ? Union([...result[key].anyOf, right[key]]) : Union([left[key], right[key]]) : right[key]
    };
  }, left);
}
function ExtendsRecordComparer(properties, keys, type, result) {
  return guard_exports.ShiftLeft(keys, (left, right) => Match4(ExtendsLeft({}, properties[left], type), (inferred) => ExtendsRecordComparer(properties, right, type, RecordMergeInferred(result, inferred)), () => ExtendsFalse()), () => ExtendsTrue(result));
}
function ExtendsObjectToRecord(inferred, properties, _pattern, value) {
  const keys = guard_exports.Keys(properties);
  const result = ExtendsRecordComparer(properties, keys, value, inferred);
  return result;
}
function ExtendsObject(inferred, left, right) {
  return IsRecord(right) ? ExtendsObjectToRecord(inferred, left, RecordPattern(right), RecordValue(right)) : IsObject2(right) ? ExtendsObjectToObject(inferred, left, right.properties) : ExtendsRight(inferred, _Object_(left), right);
}

// node_modules/typebox/build/type/extends/record.mjs
function FromObject4(inferred, properties) {
  return guard_exports.IsEqual(guard_exports.Keys(properties).length, 0) ? ExtendsTrue(inferred) : ExtendsFalse();
}
function FromRecord(inferred, _leftKey, leftValue, _rightKey, rightValue) {
  return ExtendsLeft(inferred, leftValue, rightValue);
}
function ExtendsRecord(inferred, leftPattern, leftValue, right) {
  return IsRecord(right) ? FromRecord(inferred, RecordPatternToType(leftPattern), leftValue, RecordPatternToType(RecordPattern(right)), RecordValue(right)) : IsObject2(right) ? FromObject4(inferred, right.properties) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/string.mjs
function ExtendsString(inferred, left, right) {
  return IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/symbol.mjs
function ExtendsSymbol(inferred, left, right) {
  return IsSymbol2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/template_literal.mjs
function ExtendsTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/inference.mjs
function Inferrable(name, type) {
  return memory_exports.Create({ "~kind": "Inferrable" }, { name, type }, {});
}
function IsInferable(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "name") && guard_exports.HasPropertyKey(value, "type") && guard_exports.IsEqual(value["~kind"], "Inferrable") && guard_exports.IsString(value.name) && guard_exports.IsObject(value.type);
}
function TryRestInferable(type) {
  return IsRest(type) ? IsInfer(type.items) ? IsArray2(type.items.extends) ? Inferrable(type.items.name, type.items.extends.items) : IsUnknown(type.items.extends) ? Inferrable(type.items.name, type.items.extends) : void 0 : Unreachable() : void 0;
}
function TryInferable(type) {
  return IsInfer(type) ? Inferrable(type.name, type.extends) : void 0;
}
function TryInferResults(rest, right, result = []) {
  return guard_exports.ShiftLeft(rest, (head, tail) => Match4(ExtendsLeft({}, head, right), () => TryInferResults(tail, right, [...result, head]), () => void 0), () => result);
}
function InferTupleResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Tuple(results) })) : ExtendsFalse();
}
function InferUnionResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Union(results) })) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/tuple.mjs
function Reverse(types) {
  return [...types].reverse();
}
function ApplyReverse(types, reversed) {
  return reversed ? Reverse(types) : types;
}
function Reversed(types) {
  const first = types.length > 0 ? types[0] : void 0;
  const inferrable = IsSchema2(first) ? TryRestInferable(first) : void 0;
  return IsSchema2(inferrable);
}
function ElementsCompare(inferred, reversed, left, leftRest, right, rightRest) {
  return Match4(ExtendsLeft(inferred, left, right), (checkInferred) => Elements(checkInferred, reversed, leftRest, rightRest), () => ExtendsFalse());
}
function ElementsLeft(inferred, reversed, leftRest, right, rightRest) {
  const inferable = TryRestInferable(right);
  return (
    // Rest Inferrable Right Means we delegate to TInferTupleResult to Generate a Result
    IsInferable(inferable) ? InferTupleResult(inferred, inferable["name"], ApplyReverse(leftRest, reversed), inferable["type"]) : guard_exports.ShiftLeft(leftRest, (head, tail) => ElementsCompare(inferred, reversed, head, tail, right, rightRest), () => ExtendsFalse())
  );
}
function ElementsRight(inferred, reversed, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ElementsLeft(inferred, reversed, leftRest, head, tail), () => guard_exports.IsEqual(leftRest.length, 0) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function Elements(inferred, reversed, leftRest, rightRest) {
  return ElementsRight(inferred, reversed, leftRest, rightRest);
}
function ExtendsTupleToTuple(inferred, left, right) {
  const instantiatedRight = InstantiateElements(inferred, State([], []), right);
  const reversed = Reversed(instantiatedRight);
  return Elements(inferred, reversed, ApplyReverse(left, reversed), ApplyReverse(instantiatedRight, reversed));
}
function ExtendsTupleToArray(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable["name"], left, inferrable["type"]) : guard_exports.ShiftLeft(left, (head, tail) => Match4(ExtendsLeft(inferred, head, right), (inferred2) => ExtendsTupleToArray(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsTuple(inferred, left, right) {
  const instantiatedLeft = InstantiateElements(inferred, State([], []), left);
  return IsTuple(right) ? ExtendsTupleToTuple(inferred, instantiatedLeft, right.items) : IsArray2(right) ? ExtendsTupleToArray(inferred, instantiatedLeft, right.items) : ExtendsRight(inferred, Tuple(instantiatedLeft), right);
}

// node_modules/typebox/build/type/extends/undefined.mjs
function ExtendsUndefined(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : IsUndefined2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/union.mjs
function ExtendsUnionSome(inferred, type, unionTypes) {
  return guard_exports.ShiftLeft(unionTypes, (head, tail) => Match4(ExtendsLeft(inferred, type, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsUnionSome(inferred, type, tail)), () => ExtendsFalse());
}
function ExtendsUnionLeft(inferred, left, right) {
  return guard_exports.ShiftLeft(left, (head, tail) => Match4(ExtendsUnionSome(inferred, head, right), (inferred2) => ExtendsUnionLeft(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsUnion2(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable.name, left, inferrable.type) : IsUnion(right) ? ExtendsUnionLeft(inferred, left, right.anyOf) : ExtendsUnionLeft(inferred, left, [right]);
}

// node_modules/typebox/build/type/extends/unknown.mjs
function ExtendsUnknown(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/void.mjs
function ExtendsVoid(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/extends_left.mjs
function ExtendsLeft(inferred, left, right) {
  return IsAny(left) ? ExtendsAny(inferred, left, right) : IsArray2(left) ? ExtendsArray(inferred, left, left.items, right) : IsBigInt2(left) ? ExtendsBigInt(inferred, left, right) : IsBoolean3(left) ? ExtendsBoolean(inferred, left, right) : IsConstructor2(left) ? ExtendsConstructor(inferred, left.parameters, left.instanceType, right) : IsDependent(left) ? ExtendsDependent(inferred, left.if, left.then, left.else, right) : IsEnum2(left) ? ExtendsEnum(inferred, left.enum, right) : IsFunction2(left) ? ExtendsFunction(inferred, left.parameters, left.returnType, right) : IsInteger2(left) ? ExtendsInteger(inferred, left, right) : IsIntersect(left) ? ExtendsIntersect(inferred, left.allOf, right) : IsLiteral(left) ? ExtendsLiteral(inferred, left, right) : IsNever(left) ? ExtendsNever(inferred, left, right) : IsNull2(left) ? ExtendsNull(inferred, left, right) : IsNumber3(left) ? ExtendsNumber(inferred, left, right) : IsObject2(left) ? ExtendsObject(inferred, left.properties, right) : IsRecord(left) ? ExtendsRecord(inferred, RecordPattern(left), RecordValue(left), right) : IsString3(left) ? ExtendsString(inferred, left, right) : IsSymbol2(left) ? ExtendsSymbol(inferred, left, right) : IsTemplateLiteral(left) ? ExtendsTemplateLiteral(inferred, left.pattern, right) : IsTuple(left) ? ExtendsTuple(inferred, left.items, right) : IsUndefined2(left) ? ExtendsUndefined(inferred, left, right) : IsUnion(left) ? ExtendsUnion2(inferred, left.anyOf, right) : IsUnknown(left) ? ExtendsUnknown(inferred, left, right) : IsVoid(left) ? ExtendsVoid(inferred, left, right) : ExtendsFalse();
}

// node_modules/typebox/build/type/engine/interface/instantiate.mjs
function InterfaceOperation(heritage, properties) {
  const result = EvaluateIntersect([...heritage, _Object_(properties)]);
  return result;
}
function InterfaceAction(heritage, properties, options) {
  const result = CanInstantiate(heritage) ? memory_exports.Update(InterfaceOperation(heritage, properties), {}, options) : InterfaceDeferred(heritage, properties, options);
  return result;
}
function InterfaceInstantiate(context2, state, heritage, properties, options) {
  const instantiatedHeritage = InstantiateTypes(context2, state, heritage);
  const instantiatedProperties = InstantiateProperties(context2, state, properties);
  return InterfaceAction(instantiatedHeritage, instantiatedProperties, options);
}

// node_modules/typebox/build/type/action/interface.mjs
function InterfaceDeferred(heritage, properties, options = {}) {
  return Deferred("Interface", [heritage, properties], options);
}
function IsInterfaceDeferred(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "Interface");
}

// node_modules/typebox/build/type/engine/cyclic/check.mjs
function FromRef(stack, context2, ref) {
  return stack.includes(ref) ? true : FromType3([...stack, ref], context2, context2[ref]);
}
function FromProperties(stack, context2, properties) {
  const types = PropertyValues(properties);
  return FromTypes2(stack, context2, types);
}
function FromTypes2(stack, context2, types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType3(stack, context2, left) ? true : FromTypes2(stack, context2, right), () => false);
}
function FromType3(stack, context2, type) {
  return IsRef2(type) ? FromRef(stack, context2, type.$ref) : IsArray2(type) ? FromType3(stack, context2, type.items) : IsConstructor2(type) ? FromTypes2(stack, context2, [...type.parameters, type.instanceType]) : IsFunction2(type) ? FromTypes2(stack, context2, [...type.parameters, type.returnType]) : IsInterfaceDeferred(type) ? FromProperties(stack, context2, type.parameters[1]) : IsIntersect(type) ? FromTypes2(stack, context2, type.allOf) : IsObject2(type) ? FromProperties(stack, context2, type.properties) : IsUnion(type) ? FromTypes2(stack, context2, type.anyOf) : IsTuple(type) ? FromTypes2(stack, context2, type.items) : IsRecord(type) ? FromType3(stack, context2, RecordValue(type)) : false;
}
function CyclicCheck(stack, context2, type) {
  const result = FromType3(stack, context2, type);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/candidates.mjs
function ResolveCandidateKeys(context2, keys) {
  return keys.reduce((result, left) => {
    return CyclicCheck([left], context2, context2[left]) ? [...result, left] : result;
  }, []);
}
function CyclicCandidates(context2) {
  const keys = PropertyKeys(context2);
  const result = ResolveCandidateKeys(context2, keys);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/dependencies.mjs
function FromRef2(context2, ref, result) {
  return result.includes(ref) ? result : ref in context2 ? FromType4(context2, context2[ref], [...result, ref]) : Unreachable();
}
function FromProperties2(context2, properties, result) {
  const types = PropertyValues(properties);
  return FromTypes3(context2, types, result);
}
function FromTypes3(context2, types, result) {
  return types.reduce((result2, left) => {
    return FromType4(context2, left, result2);
  }, result);
}
function FromType4(context2, type, result) {
  return IsRef2(type) ? FromRef2(context2, type.$ref, result) : IsArray2(type) ? FromType4(context2, type.items, result) : IsConstructor2(type) ? FromTypes3(context2, [...type.parameters, type.instanceType], result) : IsFunction2(type) ? FromTypes3(context2, [...type.parameters, type.returnType], result) : IsInterfaceDeferred(type) ? FromProperties2(context2, type.parameters[1], result) : IsIntersect(type) ? FromTypes3(context2, type.allOf, result) : IsObject2(type) ? FromProperties2(context2, type.properties, result) : IsUnion(type) ? FromTypes3(context2, type.anyOf, result) : IsTuple(type) ? FromTypes3(context2, type.items, result) : IsRecord(type) ? FromType4(context2, RecordValue(type), result) : result;
}
function CyclicDependencies(context2, key, type) {
  const result = FromType4(context2, type, [key]);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/extends.mjs
function FromRef3(_ref) {
  return Any();
}
function FromProperties3(properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: FromType5(properties[key]) };
  }, {});
}
function FromTypes4(types) {
  return types.reduce((result, left) => {
    return [...result, FromType5(left)];
  }, []);
}
function FromType5(type) {
  return IsRef2(type) ? FromRef3(type.$ref) : IsArray2(type) ? _Array_(FromType5(type.items), ArrayOptions(type)) : IsConstructor2(type) ? Constructor(FromTypes4(type.parameters), FromType5(type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes4(type.parameters), FromType5(type.returnType)) : IsIntersect(type) ? Intersect(FromTypes4(type.allOf)) : IsObject2(type) ? _Object_(FromProperties3(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType5(RecordValue(type))) : IsUnion(type) ? Union(FromTypes4(type.anyOf)) : IsTuple(type) ? Tuple(FromTypes4(type.items)) : type;
}
function CyclicAnyFromParameters(defs, ref) {
  return ref in defs ? FromType5(defs[ref]) : Unknown();
}
function CyclicExtends(type) {
  return CyclicAnyFromParameters(type.$defs, type.$ref);
}

// node_modules/typebox/build/type/engine/cyclic/instantiate.mjs
function CyclicInterface(context2, heritage, properties) {
  const instantiatedHeritage = InstantiateTypes(context2, State([], []), heritage);
  const instantiatedProperties = InstantiateProperties({}, State([], []), properties);
  const evaluatedInterface = EvaluateIntersect([...instantiatedHeritage, _Object_(instantiatedProperties)]);
  return evaluatedInterface;
}
function CyclicDefinitions(context2, dependencies) {
  const keys = guard_exports.Keys(context2).filter((key) => dependencies.includes(key));
  return keys.reduce((result, key) => {
    const type = context2[key];
    const instantiatedType = IsInterfaceDeferred(type) ? CyclicInterface(context2, type.parameters[0], type.parameters[1]) : type;
    return { ...result, [key]: instantiatedType };
  }, {});
}
function InstantiateCyclic(context2, ref, type) {
  const dependencies = CyclicDependencies(context2, ref, type);
  const definitions = CyclicDefinitions(context2, dependencies);
  const result = Cyclic(definitions, ref);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/target.mjs
function Resolve(defs, ref) {
  return ref in defs ? IsRef2(defs[ref]) ? Resolve(defs, defs[ref].$ref) : defs[ref] : Never();
}
function CyclicTarget(defs, ref) {
  const result = Resolve(defs, ref);
  return result;
}

// node_modules/typebox/build/type/extends/extends.mjs
function Canonical(type) {
  return IsCyclic(type) ? CyclicExtends(type) : IsUnsafe(type) ? Unknown() : type;
}
function Extends(inferred, left, right) {
  const canonicalLeft = Canonical(left);
  const canonicalRight = Canonical(right);
  return ExtendsLeft(inferred, canonicalLeft, canonicalRight);
}

// node_modules/typebox/build/type/engine/evaluate/compare.mjs
var CompareResultEqual = 0;
var CompareResultDisjoint = 1;
var CompareResultLeftInside = 2;
var CompareResultRightInside = 3;
function Compare(left, right) {
  const extendsCheck = [Extends({}, left, right), Extends({}, right, left)];
  return result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? CompareResultEqual : result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsFalse(extendsCheck[1]) ? CompareResultLeftInside : result_exports.IsExtendsFalse(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? CompareResultRightInside : CompareResultDisjoint;
}

// node_modules/typebox/build/type/engine/evaluate/broaden.mjs
function BroadenFilter(type, types, result = [], all = types) {
  return guard_exports.ShiftLeft(types, (left, right) => {
    const compare = Compare(type, left);
    return guard_exports.IsEqual(compare, CompareResultLeftInside) || guard_exports.IsEqual(compare, CompareResultEqual) ? all : guard_exports.IsEqual(compare, CompareResultDisjoint) ? BroadenFilter(type, right, [...result, left], all) : BroadenFilter(type, right, result, all);
  }, () => [...result, type]);
}
function BroadenType(type, types, result) {
  const evaluated = EvaluateType(type);
  return IsAny(evaluated) ? [evaluated] : (
    // terminate (always the most broad)
    IsUnknown(evaluated) ? [evaluated] : (
      // terminate (always the most broad)
      IsNever(evaluated) ? BroadenTypes(types, result) : (
        // ignored: never is dropped
        IsObject2(evaluated) ? BroadenTypes(types, [...result, evaluated]) : (
          // objects are always considered (too expensive to compare)
          BroadenTypes(types, BroadenFilter(evaluated, result))
        )
      )
    )
  );
}
function BroadenTypes(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => BroadenType(left, right, result), () => result);
}
function Broaden(types) {
  const broadened = BroadenTypes(types);
  const flattened = Flatten(broadened);
  return flattened;
}

// node_modules/typebox/build/type/engine/evaluate/instantiate.mjs
function EvaluateAction(type, options) {
  const result = memory_exports.Update(EvaluateType(type), {}, options);
  return result;
}
function EvaluateInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return EvaluateAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/call/distribute_arguments.mjs
function CollectDistributionNames(expression, result = []) {
  return (
    // Conditional
    IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? IsRef2(expression.parameters[0]) ? CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], [...result, expression.parameters[0]["$ref"]])) : CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], result)) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? IsDeferred(expression.parameters[1]) && guard_exports.IsEqual(expression.parameters[1].action, "KeyOf") && IsRef2(expression.parameters[1].parameters[0]) ? [...result, expression.parameters[1].parameters[0]["$ref"]] : result : result
  );
}
function BuildDistributionArray(parameters, names) {
  return parameters.reduce((result, left) => [...result, names.includes(left.name)], []);
}
function ZipDistributionArray(arguments_, distributionArray, result = []) {
  return guard_exports.ShiftLeft(arguments_, (argumentLeft, argumentRight) => guard_exports.ShiftLeft(distributionArray, (booleanLeft, booleanRight) => ZipDistributionArray(argumentRight, booleanRight, [...result, [booleanLeft, argumentLeft]]), () => result), () => result);
}
function CanonicalArgument(type) {
  return IsTemplateLiteral(type) ? EvaluateTemplateLiteral(type.pattern) : IsEnum2(type) ? EvaluateEnum(type.enum) : type;
}
function Expand(type) {
  const canonicalArgument = CanonicalArgument(type);
  return IsUnion(canonicalArgument) ? [...canonicalArgument.anyOf] : [canonicalArgument];
}
function Append(current, type) {
  return current.reduce((result, left) => [...result, [...left, type]], []);
}
function Cross(current, variants) {
  return variants.reduce((result, left) => {
    return [...result, ...Append(current, left)];
  }, []);
}
function Distribute2(zipped) {
  return zipped.reduce((result, left) => {
    return guard_exports.IsEqual(left[0], true) ? Cross(result, Expand(left[1])) : Cross(result, [left[1]]);
  }, [[]]);
}
function DistributeArguments(parameters, arguments_, expression) {
  const distributionNames = CollectDistributionNames(expression);
  const distributionArray = BuildDistributionArray(parameters, distributionNames);
  const zippedArguments = ZipDistributionArray(arguments_, distributionArray);
  return IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? Distribute2(zippedArguments) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? Distribute2(zippedArguments) : [arguments_];
}

// node_modules/typebox/build/type/engine/call/resolve_target.mjs
function FromNotResolvable() {
  return ["(not-resolvable)", Never()];
}
function FromNotGeneric() {
  return ["(not-generic)", Never()];
}
function FromGeneric(name, parameters, expression) {
  return [name, Generic(parameters, expression)];
}
function FromRef4(context2, ref, arguments_) {
  return ref in context2 ? FromType6(context2, ref, context2[ref], arguments_) : FromNotResolvable();
}
function FromType6(context2, name, target, arguments_) {
  return IsGeneric(target) ? FromGeneric(name, target.parameters, target.expression) : IsRef2(target) ? FromRef4(context2, target.$ref, arguments_) : FromNotGeneric();
}
function ResolveTarget(context2, target, arguments_) {
  return FromType6(context2, "(anonymous)", target, arguments_);
}

// node_modules/typebox/build/type/engine/call/resolve_arguments.mjs
function AssertArgumentExtends(name, type, extends_) {
  if (IsInfer(type) || IsCall(type) || result_exports.IsExtendsTrueLike(Extends({}, type, extends_)))
    return;
  const cause = { parameter: name, expect: extends_, actual: type };
  throw new Error(`Argument for parameter ${name} does not satisfy constraint`, { cause });
}
function BindArgument(context2, state, name, extends_, type) {
  const instantiatedArgument = InstantiateType(context2, state, type);
  AssertArgumentExtends(name, instantiatedArgument, extends_);
  return memory_exports.Assign(context2, { [name]: instantiatedArgument });
}
function BindArguments(context2, state, parameterLeft, parameterRight, arguments_) {
  const instantiatedExtends = InstantiateType(context2, state, parameterLeft.extends);
  const instantiatedEquals = InstantiateType(context2, state, parameterLeft.equals);
  return guard_exports.ShiftLeft(arguments_, (left, right) => BindParameters(BindArgument(context2, state, parameterLeft["name"], instantiatedExtends, left), state, parameterRight, right), () => BindParameters(BindArgument(context2, state, parameterLeft["name"], instantiatedExtends, instantiatedEquals), state, parameterRight, []));
}
function BindParameters(context2, state, parameters, arguments_) {
  return guard_exports.ShiftLeft(parameters, (left, right) => BindArguments(context2, state, left, right, arguments_), () => context2);
}
function ResolveArgumentsContext(context2, state, parameters, arguments_) {
  return BindParameters(context2, state, parameters, arguments_);
}

// node_modules/typebox/build/type/engine/call/instantiate.mjs
var instantiationDepth = 0;
var instantiationCount = 0;
function InstantiationAssert() {
  if (guard_exports.IsLessThan(instantiationCount, settings_exports.Get().maxInstantiationCount))
    return;
  throw Error("Type instantiation is excessively deep and possibly infinite");
}
function InstantiationIncrement() {
  InstantiationAssert();
  instantiationCount++;
  instantiationDepth++;
}
function InstantiationDecrement() {
  instantiationDepth--;
  if (guard_exports.IsEqual(instantiationDepth, 0))
    instantiationCount = 0;
}
function Peek(state) {
  const result = guard_exports.IsGreaterThan(state.callstack.length, 0) ? state.callstack[state.callstack.length - 1] : "";
  return result;
}
function IsTailCall(state, name) {
  const result = guard_exports.IsEqual(Peek(state), name);
  return result;
}
function CallDispatch(context2, state, target, parameters, expression, arguments_) {
  InstantiationIncrement();
  try {
    const argumentsContext = ResolveArgumentsContext(context2, state, parameters, arguments_);
    const returnType = InstantiateType(argumentsContext, State([...state["callstack"], target["$ref"]], state["visited"]), expression);
    return InstantiateType(argumentsContext, State([], []), returnType);
  } finally {
    InstantiationDecrement();
  }
}
function CallDistributed(context2, state, target, parameters, expression, distributedArguments) {
  return distributedArguments.reduce((result, arguments_) => {
    const returnType = CallDispatch(context2, state, target, parameters, expression, arguments_);
    return [...result, returnType];
  }, []);
}
function CallImmediate(context2, state, target, parameters, expression, arguments_) {
  const distributedArguments = DistributeArguments(parameters, arguments_, expression);
  const returnTypes = CallDistributed(context2, state, target, parameters, expression, distributedArguments);
  const result = guard_exports.IsEqual(returnTypes.length, 1) ? returnTypes[0] : EvaluateUnion(returnTypes);
  return result;
}
function CallInstantiate(context2, state, target, arguments_) {
  const instantiatedArguments = InstantiateTypes(context2, state, arguments_);
  const resolved = ResolveTarget(context2, target, arguments_);
  const name = resolved[0];
  const type = resolved[1];
  const result = IsGeneric(type) ? IsTailCall(state, name) ? CallConstruct(Ref2(name), instantiatedArguments) : CallImmediate(context2, state, Ref2(name), type.parameters, type.expression, instantiatedArguments) : CallConstruct(target, instantiatedArguments);
  return result;
}

// node_modules/typebox/build/type/types/call.mjs
function CallConstruct(target, arguments_) {
  return memory_exports.Create({ ["~kind"]: "Call" }, { type: "call", target, arguments: arguments_ }, {});
}
function IsCall(value) {
  return IsKind(value, "Call");
}

// node_modules/typebox/build/type/engine/immutable/instantiate_remove.mjs
function RemoveImmutableOperation(type) {
  return memory_exports.Discard(type, ["~immutable"]);
}
function RemoveImmutableAction(type, options) {
  const result = memory_exports.Update(RemoveImmutableOperation(type), {}, options);
  return result;
}
function RemoveImmutableInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return RemoveImmutableAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/intrinsics/mapping.mjs
function ApplyMapping(mapping, value) {
  return mapping(value);
}

// node_modules/typebox/build/type/engine/intrinsics/from_literal.mjs
function FromLiteral3(mapping, value) {
  return guard_exports.IsString(value) ? Literal(ApplyMapping(mapping, value)) : Literal(value);
}

// node_modules/typebox/build/type/engine/intrinsics/from_template_literal.mjs
function FromTemplateLiteral(mapping, pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType7(mapping, evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/intrinsics/from_union.mjs
function FromUnion2(mapping, types) {
  const result = types.map((type) => FromType7(mapping, type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/intrinsics/from_type.mjs
function FromType7(mapping, type) {
  return IsLiteral(type) ? FromLiteral3(mapping, type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral(mapping, type.pattern) : IsUnion(type) ? FromUnion2(mapping, type.anyOf) : type;
}

// node_modules/typebox/build/type/action/capitalize.mjs
function CapitalizeDeferred(type, options = {}) {
  return Deferred("Capitalize", [type], options);
}

// node_modules/typebox/build/type/action/lowercase.mjs
function LowercaseDeferred(type, options = {}) {
  return Deferred("Lowercase", [type], options);
}

// node_modules/typebox/build/type/action/uncapitalize.mjs
function UncapitalizeDeferred(type, options = {}) {
  return Deferred("Uncapitalize", [type], options);
}

// node_modules/typebox/build/type/action/uppercase.mjs
function UppercaseDeferred(type, options = {}) {
  return Deferred("Uppercase", [type], options);
}

// node_modules/typebox/build/type/engine/intrinsics/instantiate.mjs
var CapitalizeMapping = (input) => input[0].toUpperCase() + input.slice(1);
var LowercaseMapping = (input) => input.toLowerCase();
var UncapitalizeMapping = (input) => input[0].toLowerCase() + input.slice(1);
var UppercaseMapping = (input) => input.toUpperCase();
function CapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(CapitalizeMapping, type), {}, options) : CapitalizeDeferred(type, options);
  return result;
}
function LowercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(LowercaseMapping, type), {}, options) : LowercaseDeferred(type, options);
  return result;
}
function UncapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UncapitalizeMapping, type), {}, options) : UncapitalizeDeferred(type, options);
  return result;
}
function UppercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UppercaseMapping, type), {}, options) : UppercaseDeferred(type, options);
  return result;
}
function CapitalizeInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return CapitalizeAction(instantiatedType, options);
}
function LowercaseInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return LowercaseAction(instantiatedType, options);
}
function UncapitalizeInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return UncapitalizeAction(instantiatedType, options);
}
function UppercaseInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return UppercaseAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/conditional.mjs
function ConditionalDeferred(left, right, true_, false_, options = {}) {
  return Deferred("Conditional", [left, right, true_, false_], options);
}

// node_modules/typebox/build/type/engine/conditional/instantiate.mjs
function ConditionalOperation(context2, state, left, right, true_, false_) {
  const extendsResult = Extends(context2, left, right);
  return result_exports.IsExtendsUnion(extendsResult) ? Union([InstantiateType(extendsResult.inferred, state, true_), InstantiateType(context2, state, false_)]) : result_exports.IsExtendsTrue(extendsResult) ? InstantiateType(extendsResult.inferred, state, true_) : InstantiateType(context2, state, false_);
}
function ConditionalAction(context2, state, left, right, true_, false_, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ConditionalOperation(context2, state, left, right, true_, false_), {}, options) : ConditionalDeferred(left, right, true_, false_, options);
  return result;
}
function ConditionalInstantiate(context2, state, left, right, true_, false_, options) {
  const instantiatedLeft = InstantiateType(context2, state, left);
  const instantiatedRight = InstantiateType(context2, state, right);
  return ConditionalAction(context2, state, instantiatedLeft, instantiatedRight, true_, false_, options);
}

// node_modules/typebox/build/type/action/constructor_parameters.mjs
function ConstructorParametersDeferred(type, options = {}) {
  return Deferred("ConstructorParameters", [type], options);
}

// node_modules/typebox/build/type/engine/constructor_parameters/instantiate.mjs
function ConstructorParametersOperation(type) {
  const parameters = IsConstructor2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ConstructorParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ConstructorParametersOperation(type), {}, options) : ConstructorParametersDeferred(type, options);
  return result;
}
function ConstructorParametersInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return ConstructorParametersAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/exclude.mjs
function ExcludeDeferred(left, right, options = {}) {
  return Deferred("Exclude", [left, right], options);
}

// node_modules/typebox/build/type/engine/exclude/instantiate.mjs
function ExcludeAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExcludeOperation(left, right), {}, options) : ExcludeDeferred(left, right, options);
  return result;
}
function ExcludeInstantiate(context2, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context2, state, left);
  const instantiatedRight = InstantiateType(context2, state, right);
  return ExcludeAction(instantiatedLeft, instantiatedRight, options);
}

// node_modules/typebox/build/type/action/extract.mjs
function ExtractDeferred(left, right, options = {}) {
  return Deferred("Extract", [left, right], options);
}

// node_modules/typebox/build/type/engine/extract/operation.mjs
function ExtractType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [left] : [];
  return result;
}
function ExtractUnion(left, right, result = []) {
  return guard_exports.ShiftLeft(left, (head, tail) => ExtractUnion(tail, right, [...result, ...ExtractType(head, right)]), () => result);
}
function ExtractOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExtractUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/typebox/build/type/engine/extract/instantiate.mjs
function ExtractAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExtractOperation(left, right), {}, options) : ExtractDeferred(left, right, options);
  return result;
}
function ExtractInstantiate(context2, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context2, state, left);
  const instantiatedRight = InstantiateType(context2, state, right);
  return ExtractAction(instantiatedLeft, instantiatedRight, options);
}

// node_modules/typebox/build/type/action/indexed.mjs
function IndexDeferred(type, indexer, options = {}) {
  return Deferred("Index", [type, indexer], options);
}

// node_modules/typebox/build/type/engine/object/from_cyclic.mjs
function FromCyclic(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType8(target);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_dependent.mjs
function FromDependent(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType8(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_intersect.mjs
function CollapseIntersectProperties(left, right) {
  const leftKeys = guard_exports.Keys(left).filter((key) => !guard_exports.HasPropertyKey(right, key));
  const rightKeys = guard_exports.Keys(right).filter((key) => !guard_exports.HasPropertyKey(left, key));
  const sharedKeys = guard_exports.Keys(left).filter((key) => guard_exports.HasPropertyKey(right, key));
  const leftProperties = leftKeys.reduce((result, key) => ({ ...result, [key]: left[key] }), {});
  const rightProperties = rightKeys.reduce((result, key) => ({ ...result, [key]: right[key] }), {});
  const sharedProperties = sharedKeys.reduce((result, key) => ({ ...result, [key]: EvaluateIntersect([left[key], right[key]]) }), {});
  const unique = memory_exports.Assign(leftProperties, rightProperties);
  const shared = memory_exports.Assign(unique, sharedProperties);
  return shared;
}
function FromIntersect(types) {
  return types.reduce((result, left) => {
    return CollapseIntersectProperties(result, FromType8(left));
  }, {});
}

// node_modules/typebox/build/type/engine/object/from_object.mjs
function FromObject5(properties) {
  return properties;
}

// node_modules/typebox/build/type/engine/object/from_tuple.mjs
function FromTuple(types) {
  const object = TupleToObject(Tuple(types));
  const result = FromType8(object);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_union.mjs
function CollapseUnionProperties(left, right) {
  const sharedKeys = guard_exports.Keys(left).filter((key) => key in right);
  const result = sharedKeys.reduce((result2, key) => {
    return { ...result2, [key]: EvaluateUnion([left[key], right[key]]) };
  }, {});
  return result;
}
function ReduceVariants(types, result) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, CollapseUnionProperties(result, FromType8(left))), () => result);
}
function FromUnion3(types) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, FromType8(left)), () => Unreachable());
}

// node_modules/typebox/build/type/engine/object/from_type.mjs
function FromType8(type) {
  return IsCyclic(type) ? FromCyclic(type.$defs, type.$ref) : IsDependent(type) ? FromDependent(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect(type.allOf) : IsUnion(type) ? FromUnion3(type.anyOf) : IsTuple(type) ? FromTuple(type.items) : IsObject2(type) ? FromObject5(type.properties) : {};
}

// node_modules/typebox/build/type/engine/object/collapse.mjs
function CollapseToObject(type) {
  const properties = FromType8(type);
  const result = _Object_(properties);
  return result;
}

// node_modules/typebox/build/type/engine/helpers/keys.mjs
var integerKeyPattern = new RegExp("^(?:0|[1-9][0-9]*)$");
function ConvertToIntegerKey(value) {
  const normal = `${value}`;
  return integerKeyPattern.test(normal) ? parseInt(normal) : value;
}

// node_modules/typebox/build/type/engine/indexed/from_array.mjs
function NormalizeLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function NormalizeIndexerTypes(types) {
  return types.map((type) => NormalizeIndexer(type));
}
function NormalizeIndexer(type) {
  return IsIntersect(type) ? Intersect(NormalizeIndexerTypes(type.allOf)) : IsUnion(type) ? Union(NormalizeIndexerTypes(type.anyOf)) : IsLiteral(type) ? NormalizeLiteral(type.const) : type;
}
function FromArray4(type, indexer) {
  const normalizedIndexer = NormalizeIndexer(indexer);
  const check = Extends({}, normalizedIndexer, Number2());
  const result = (
    // indexer
    result_exports.IsExtendsTrueLike(check) ? type : IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Number2() : Never()
  );
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_cyclic.mjs
function FromCyclic2(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType9(target);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_dependent.mjs
function FromDependent2(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_enum.mjs
function FromEnum(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_intersect.mjs
function FromIntersect2(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_literal.mjs
function FromLiteral4(value) {
  const result = [`${value}`];
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_template_literal.mjs
function FromTemplateLiteral2(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_union.mjs
function FromUnion4(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType9(left)];
  }, []);
}

// node_modules/typebox/build/type/engine/indexable/from_type.mjs
function FromType9(type) {
  return IsCyclic(type) ? FromCyclic2(type.$defs, type.$ref) : IsDependent(type) ? FromDependent2(type.if, type.then, type.else) : IsEnum2(type) ? FromEnum(type.enum) : IsIntersect(type) ? FromIntersect2(type.allOf) : IsLiteral(type) ? FromLiteral4(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral2(type.pattern) : IsUnion(type) ? FromUnion4(type.anyOf) : [];
}

// node_modules/typebox/build/type/engine/indexable/to_indexable_keys.mjs
function ToIndexableKeys(type) {
  const result = FromType9(type);
  return result;
}

// node_modules/typebox/build/type/engine/this/expand_this.mjs
function FromTypes5(properties, types) {
  return types.map((type) => FromType10(properties, type));
}
function FromType10(properties, type) {
  return IsArray2(type) ? _Array_(FromType10(properties, type.items)) : IsConstructor2(type) ? Constructor(FromTypes5(properties, type.parameters), FromType10(properties, type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes5(properties, type.parameters), FromType10(properties, type.returnType)) : IsTuple(type) ? Tuple(FromTypes5(properties, type.items)) : IsUnion(type) ? Union(FromTypes5(properties, type.anyOf)) : IsIntersect(type) ? Intersect(FromTypes5(properties, type.allOf)) : IsThis(type) ? _Object_(properties) : type;
}
function ExpandThis(properties, type) {
  const result = FromType10(properties, type);
  return result;
}

// node_modules/typebox/build/type/engine/indexed/from_object.mjs
function IndexProperty(properties, key) {
  const selectedType = key in properties ? properties[key] : Never();
  const result = ExpandThis(properties, selectedType);
  return result;
}
function IndexProperties(properties, keys) {
  return keys.reduce((result, left) => {
    return [...result, IndexProperty(properties, left)];
  }, []);
}
function FromIndexer(properties, indexer) {
  const keys = ToIndexableKeys(indexer);
  const variants = IndexProperties(properties, keys);
  const result = EvaluateUnion(variants);
  return result;
}
var NumericKeyPattern = new RegExp(IntegerKey);
function NumericKeys(keys) {
  const result = keys.filter((key) => NumericKeyPattern.test(key));
  return result;
}
function FromIndexerNumber(properties) {
  const keys = PropertyKeys(properties);
  const numericKeys = NumericKeys(keys);
  const variants = IndexProperties(properties, numericKeys);
  const result = EvaluateUnion(variants);
  return result;
}
function FromObject6(properties, indexer) {
  const result = IsNumber3(indexer) ? FromIndexerNumber(properties) : FromIndexer(properties, indexer);
  return result;
}

// node_modules/typebox/build/type/engine/indexed/array_indexer.mjs
function ConvertLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function ArrayIndexerTypes(types) {
  return types.map((type) => FormatArrayIndexer(type));
}
function FormatArrayIndexer(type) {
  return IsIntersect(type) ? Intersect(ArrayIndexerTypes(type.allOf)) : IsUnion(type) ? Union(ArrayIndexerTypes(type.anyOf)) : IsLiteral(type) ? ConvertLiteral(type.const) : type;
}

// node_modules/typebox/build/type/engine/indexed/from_tuple.mjs
function IndexElementsWithIndexer(types, indexer) {
  return types.reduceRight((result, right, index) => {
    const check = Extends({}, Literal(index), indexer);
    return result_exports.IsExtendsTrueLike(check) ? [right, ...result] : result;
  }, []);
}
function FromTupleWithIndexer(types, indexer) {
  const formattedArrayIndexer = FormatArrayIndexer(indexer);
  const elements = IndexElementsWithIndexer(types, formattedArrayIndexer);
  return EvaluateUnionFast(elements);
}
function FromTupleWithoutIndexer(types) {
  return EvaluateUnionFast(types);
}
function FromTuple2(types, indexer) {
  return (
    // length (intrinsic)
    IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Literal(types.length) : IsNumber3(indexer) || IsInteger2(indexer) ? FromTupleWithoutIndexer(types) : FromTupleWithIndexer(types, indexer)
  );
}

// node_modules/typebox/build/type/engine/indexed/from_type.mjs
function FromType11(type, indexer) {
  return IsArray2(type) ? FromArray4(type.items, indexer) : IsObject2(type) ? FromObject6(type.properties, indexer) : IsTuple(type) ? FromTuple2(type.items, indexer) : Never();
}

// node_modules/typebox/build/type/engine/indexed/instantiate.mjs
function NormalizeType(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function IndexAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType11(NormalizeType(type), indexer), {}, options) : IndexDeferred(type, indexer, options);
  return result;
}
function IndexInstantiate(context2, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  const instantiatedIndexer = InstantiateType(context2, state, indexer);
  return IndexAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/typebox/build/type/action/instance_type.mjs
function InstanceTypeDeferred(type, options = {}) {
  return Deferred("InstanceType", [type], options);
}

// node_modules/typebox/build/type/engine/instance_type/instantiate.mjs
function InstanceTypeOperation(type) {
  return IsConstructor2(type) ? type["instanceType"] : Never();
}
function InstanceTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(InstanceTypeOperation(type), {}, options) : InstanceTypeDeferred(type, options);
  return result;
}
function InstanceTypeInstantiate(context2, state, type, options = {}) {
  const instantiatedType = InstantiateType(context2, state, type);
  return InstanceTypeAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/keyof.mjs
function KeyOfDeferred(type, options = {}) {
  return Deferred("KeyOf", [type], options);
}

// node_modules/typebox/build/type/engine/keyof/from_any.mjs
function FromAny() {
  return Union([Number2(), String2(), Symbol2()]);
}

// node_modules/typebox/build/type/engine/keyof/from_array.mjs
function FromArray5(_type) {
  return Number2();
}

// node_modules/typebox/build/type/engine/keyof/from_object.mjs
function FromPropertyKeys(keys) {
  const result = keys.reduce((result2, left) => {
    return IsLiteralValue(left) ? [...result2, Literal(ConvertToIntegerKey(left))] : Unreachable();
  }, []);
  return result;
}
function FromObject7(properties) {
  const propertyKeys = guard_exports.Keys(properties);
  const variants = FromPropertyKeys(propertyKeys);
  const result = EvaluateUnionFast(variants);
  return result;
}

// node_modules/typebox/build/type/engine/keyof/from_record.mjs
function FromRecord2(type) {
  return RecordKey(type);
}

// node_modules/typebox/build/type/engine/keyof/from_tuple.mjs
function FromTuple3(types) {
  const result = types.map((_, index) => Literal(index));
  return EvaluateUnionFast(result);
}

// node_modules/typebox/build/type/engine/keyof/from_type.mjs
function FromType12(type) {
  return IsAny(type) ? FromAny() : IsArray2(type) ? FromArray5(type.items) : IsObject2(type) ? FromObject7(type.properties) : IsRecord(type) ? FromRecord2(type) : IsTuple(type) ? FromTuple3(type.items) : Never();
}

// node_modules/typebox/build/type/engine/keyof/instantiate.mjs
function NormalizeType2(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function KeyOfAction(type, options) {
  return CanInstantiate([type]) ? memory_exports.Update(FromType12(NormalizeType2(type)), {}, options) : KeyOfDeferred(type, options);
}
function KeyOfInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return KeyOfAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/mapped.mjs
function MappedDeferred(identifier, type, as, property, options = {}) {
  return Deferred("Mapped", [identifier, type, as, property], options);
}

// node_modules/typebox/build/type/engine/mapped/mapped_variants.mjs
function FromTemplateLiteral3(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType13(evaluated);
  return result;
}
function FromUnion5(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType13(left)];
  }, []);
}
function FromEnum2(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType13(evaluated);
  return result;
}
function FromLiteral5(value) {
  const result = guard_exports.IsNumber(value) ? [Literal(`${value}`)] : [Literal(value)];
  return result;
}
function FromType13(type) {
  const result = IsEnum2(type) ? FromEnum2(type.enum) : IsLiteral(type) ? FromLiteral5(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral3(type.pattern) : IsUnion(type) ? FromUnion5(type.anyOf) : [type];
  return result;
}
function MappedVariants(type) {
  const result = FromType13(type);
  return result;
}

// node_modules/typebox/build/type/engine/mapped/mapped_operation.mjs
function CanonicalAs(instantiatedAs) {
  const result = IsTemplateLiteral(instantiatedAs) ? EvaluateTemplateLiteral(instantiatedAs.pattern) : instantiatedAs;
  return result;
}
function MappedVariant(context2, state, identifier, variant, as, property) {
  const variantContext = memory_exports.Assign(context2, { [identifier["name"]]: variant });
  const instantiatedAs = InstantiateType(variantContext, state, as);
  const canonicalAs = CanonicalAs(instantiatedAs);
  const instantiatedProperty = InstantiateType(variantContext, state, property);
  return IsLiteralNumber(canonicalAs) || IsLiteralString(canonicalAs) ? { [canonicalAs.const]: instantiatedProperty } : {};
}
function MappedProperties(context2, state, identifier, variants, as, property) {
  return variants.reduce((result, left) => {
    return [...result, MappedVariant(context2, state, identifier, left, as, property)];
  }, []);
}
function MappedObjects(properties) {
  return properties.reduce((result, left) => {
    return [...result, _Object_(left)];
  }, []);
}
function MappedOperation(context2, state, identifier, type, as, property) {
  const variants = MappedVariants(type);
  const mappedProperties = MappedProperties(context2, state, identifier, variants, as, property);
  const mappedObjects = MappedObjects(mappedProperties);
  const result = EvaluateIntersect(mappedObjects);
  return result;
}

// node_modules/typebox/build/type/engine/mapped/instantiate.mjs
function MappedAction(context2, state, identifier, type, as, property, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(MappedOperation(context2, state, identifier, type, as, property), {}, options) : MappedDeferred(identifier, type, as, property, options);
  return result;
}
function MappedInstantiate(context2, state, identifier, type, as, property, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return MappedAction(context2, state, identifier, instantiatedType, as, property, options);
}

// node_modules/typebox/build/type/engine/module/instantiate.mjs
function InstantiateCyclics(context2, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context2, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateCyclic(declarationContext, key, declarations[key]) };
  }, {});
}
function InstantiateNonCyclics(context2, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context2, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => !cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateType(declarationContext, State([], []), declarations[key]) };
  }, {});
}
function InstantiateModule(context2, declarations, options) {
  const cyclicCandidates = CyclicCandidates(declarations);
  const instantiatedCyclics = InstantiateCyclics(context2, declarations, cyclicCandidates);
  const instantiatedNonCyclics = InstantiateNonCyclics(context2, declarations, cyclicCandidates);
  const instantiatedModule = { ...instantiatedCyclics, ...instantiatedNonCyclics };
  return memory_exports.Update(instantiatedModule, {}, options);
}
function ModuleInstantiate(context2, _state, declarations, options) {
  const instantiatedModule = InstantiateModule(context2, declarations, options);
  return instantiatedModule;
}

// node_modules/typebox/build/type/action/non_nullable.mjs
function NonNullableDeferred(type, options = {}) {
  return Deferred("NonNullable", [type], options);
}

// node_modules/typebox/build/type/engine/non_nullable/instantiate.mjs
function NonNullableOperation(type) {
  const excluded = Union([Null(), Undefined()]);
  return ExcludeAction(type, excluded, {});
}
function NonNullableAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(NonNullableOperation(type), {}, options) : NonNullableDeferred(type, options);
  return result;
}
function NonNullableInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return NonNullableAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/omit.mjs
function OmitDeferred(type, indexer, options = {}) {
  return Deferred("Omit", [type, indexer], options);
}

// node_modules/typebox/build/type/engine/indexable/to_indexable.mjs
function ToIndexable(type) {
  const collapsed = CollapseToObject(type);
  const result = IsObject2(collapsed) ? collapsed.properties : Unreachable();
  return result;
}

// node_modules/typebox/build/type/engine/omit/from_type.mjs
function FromKeys(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? result2 : { ...result2, [key]: properties[key] };
  }, {});
  return result;
}
function FromType14(type, indexer) {
  const indexable = ToIndexable(type);
  const indexableKeys = ToIndexableKeys(indexer);
  const omitted = FromKeys(indexable, indexableKeys);
  const result = _Object_(omitted);
  return result;
}

// node_modules/typebox/build/type/engine/omit/instantiate.mjs
function OmitAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType14(type, indexer), {}, options) : OmitDeferred(type, indexer, options);
  return result;
}
function OmitInstantiate(context2, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  const instantiatedIndexer = InstantiateType(context2, state, indexer);
  return OmitAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/typebox/build/type/action/parameters.mjs
function ParametersDeferred(type, options = {}) {
  return Deferred("Parameters", [type], options);
}

// node_modules/typebox/build/type/engine/parameters/instantiate.mjs
function ParametersOperation(type) {
  const parameters = IsFunction2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ParametersOperation(type), {}, options) : ParametersDeferred(type, options);
  return result;
}
function ParametersInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return ParametersAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/partial.mjs
function PartialDeferred(type, options = {}) {
  return Deferred("Partial", [type], options);
}

// node_modules/typebox/build/type/engine/partial/from_cyclic.mjs
function FromCyclic3(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType15(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_dependent.mjs
function FromDependent3(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_intersect.mjs
function FromIntersect3(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_union.mjs
function FromUnion6(types) {
  const result = types.map((type) => FromType15(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/partial/from_object.mjs
function FromObject8(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_type.mjs
function FromType15(type) {
  return IsCyclic(type) ? FromCyclic3(type.$defs, type.$ref) : IsDependent(type) ? FromDependent3(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect3(type.allOf) : IsUnion(type) ? FromUnion6(type.anyOf) : IsObject2(type) ? FromObject8(type.properties) : _Object_({});
}

// node_modules/typebox/build/type/engine/partial/instantiate.mjs
function PartialAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType15(type), {}, options) : PartialDeferred(type, options);
  return result;
}
function PartialInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return PartialAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/pick.mjs
function PickDeferred(type, indexer, options = {}) {
  return Deferred("Pick", [type, indexer], options);
}

// node_modules/typebox/build/type/engine/pick/from_type.mjs
function FromKeys2(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? memory_exports.Assign(result2, { [key]: properties[key] }) : result2;
  }, {});
  return result;
}
function FromType16(type, indexer) {
  const indexable = ToIndexable(type);
  const keys = ToIndexableKeys(indexer);
  const applied = FromKeys2(indexable, keys);
  const result = _Object_(applied);
  return result;
}

// node_modules/typebox/build/type/engine/pick/instantiate.mjs
function PickAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType16(type, indexer), {}, options) : PickDeferred(type, indexer, options);
  return result;
}
function PickInstantiate(context2, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  const instantiatedIndexer = InstantiateType(context2, state, indexer);
  return PickAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/typebox/build/type/action/readonly_object.mjs
function ReadonlyObjectDeferred(type, options = {}) {
  return Deferred("ReadonlyObject", [type], options);
}

// node_modules/typebox/build/type/engine/readonly_object/from_array.mjs
function FromArray6(type) {
  const result = AddImmutable(_Array_(type));
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_cyclic.mjs
function FromCyclic4(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType17(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_dependent.mjs
function FromDependent4(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_intersect.mjs
function FromIntersect4(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_object.mjs
function FromObject9(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddReadonly(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_tuple.mjs
function FromTuple4(types) {
  const result = AddImmutable(Tuple(types));
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_union.mjs
function FromUnion7(types) {
  const result = types.map((type) => FromType17(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/readonly_object/from_type.mjs
function FromType17(type) {
  return IsArray2(type) ? FromArray6(type.items) : IsCyclic(type) ? FromCyclic4(type.$defs, type.$ref) : IsDependent(type) ? FromDependent4(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect4(type.allOf) : IsObject2(type) ? FromObject9(type.properties) : IsTuple(type) ? FromTuple4(type.items) : IsUnion(type) ? FromUnion7(type.anyOf) : type;
}

// node_modules/typebox/build/type/engine/readonly_object/instantiate.mjs
function ReadonlyObjectAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType17(type), {}, options) : ReadonlyObjectDeferred(type);
  return result;
}
function ReadonlyObjectInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return ReadonlyObjectAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/ref/instantiate.mjs
function RefInstantiate(context2, state, type, ref) {
  return state.visited.includes(ref) ? type : ref in context2 ? InstantiateType(context2, State(state["callstack"], [...state["visited"], ref]), context2[ref]) : type;
}

// node_modules/typebox/build/type/engine/required/from_cyclic.mjs
function FromCyclic5(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType18(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_dependent.mjs
function FromDependent5(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_intersect.mjs
function FromIntersect5(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_union.mjs
function FromUnion8(types) {
  const result = types.map((type) => FromType18(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/required/from_object.mjs
function FromObject10(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: RemoveOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_type.mjs
function FromType18(type) {
  return IsCyclic(type) ? FromCyclic5(type.$defs, type.$ref) : IsDependent(type) ? FromDependent5(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect5(type.allOf) : IsUnion(type) ? FromUnion8(type.anyOf) : IsObject2(type) ? FromObject10(type.properties) : _Object_({});
}

// node_modules/typebox/build/type/action/required.mjs
function RequiredDeferred(type, options = {}) {
  return Deferred("Required", [type], options);
}

// node_modules/typebox/build/type/engine/required/instantiate.mjs
function RequiredAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType18(type), {}, options) : RequiredDeferred(type, options);
  return result;
}
function RequiredInstantiate(context2, state, type, options) {
  const instaniatedType = InstantiateType(context2, state, type);
  return RequiredAction(instaniatedType, options);
}

// node_modules/typebox/build/type/action/return_type.mjs
function ReturnTypeDeferred(type, options = {}) {
  return Deferred("ReturnType", [type], options);
}

// node_modules/typebox/build/type/engine/return_type/instantiate.mjs
function ReturnTypeOperation(type) {
  return IsFunction2(type) ? type["returnType"] : Never();
}
function ReturnTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ReturnTypeOperation(type), {}, options) : ReturnTypeDeferred(type, options);
  return result;
}
function ReturnTypeInstantiate(context2, state, type, options = {}) {
  const instantiatedType = InstantiateType(context2, state, type);
  return ReturnTypeAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/with.mjs
function WithDeferred(type, options) {
  return Deferred("With", [type, options], {});
}
function With(type, options) {
  return WithAction(type, options);
}

// node_modules/typebox/build/type/engine/with/instantiate.mjs
function WithAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(type, {}, options) : WithDeferred(type, options);
  return result;
}
function WithInstantiate(context2, state, type, options) {
  const instaniatedType = InstantiateType(context2, state, type);
  return WithAction(instaniatedType, options);
}

// node_modules/typebox/build/type/engine/rest/spread.mjs
function SpreadElement(type) {
  const result = IsRest(type) ? IsTuple(type.items) ? RestSpread(type.items.items) : IsInfer(type.items) ? [type] : IsRef2(type.items) ? [type] : [Never()] : [type];
  return result;
}
function RestSpread(types) {
  const result = types.reduce((result2, left) => {
    return [...result2, ...SpreadElement(left)];
  }, []);
  return result;
}

// node_modules/typebox/build/type/engine/instantiate.mjs
function State(callstack, visited) {
  return { callstack, visited };
}
function CanInstantiate(types) {
  return guard_exports.ShiftLeft(types, (left, right) => IsRef2(left) ? false : CanInstantiate(right), () => true);
}
function InstantiateProperties(context2, state, properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: InstantiateType(context2, state, properties[key]) };
  }, {});
}
function InstantiateElements(context2, state, types) {
  const elements = InstantiateTypes(context2, state, types);
  const result = RestSpread(elements);
  return result;
}
function InstantiateTypes(context2, state, types) {
  return types.map((type) => InstantiateType(context2, state, type));
}
function WithModifiers(type, instantiatedType) {
  const withOptional = IsOptional(type) ? AddOptionalAction(instantiatedType, {}) : instantiatedType;
  const withReadonly = IsReadonly(type) ? AddReadonlyAction(withOptional, {}) : withOptional;
  const withImmutable = IsImmutable(type) ? AddImmutableAction(withReadonly, {}) : withReadonly;
  return withImmutable;
}
function InstantiateDeferred(context2, state, action, parameters, options) {
  return (
    // Modifiers
    guard_exports.IsEqual(action, "AddImmutable") ? AddImmutableInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveImmutable") ? RemoveImmutableInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "AddReadonly") ? AddReadonlyInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveReadonly") ? RemoveReadonlyInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "AddOptional") ? AddOptionalInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveOptional") ? RemoveOptionalInstantiate(context2, state, parameters[0], options) : (
      // Actions
      guard_exports.IsEqual(action, "Capitalize") ? CapitalizeInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Conditional") ? ConditionalInstantiate(context2, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "ConstructorParameters") ? ConstructorParametersInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Evaluate") ? EvaluateInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Exclude") ? ExcludeInstantiate(context2, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Extract") ? ExtractInstantiate(context2, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Index") ? IndexInstantiate(context2, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "InstanceType") ? InstanceTypeInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Interface") ? InterfaceInstantiate(context2, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "KeyOf") ? KeyOfInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Lowercase") ? LowercaseInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Mapped") ? MappedInstantiate(context2, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "Module") ? ModuleInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "NonNullable") ? NonNullableInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Pick") ? PickInstantiate(context2, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Parameters") ? ParametersInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Partial") ? PartialInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Omit") ? OmitInstantiate(context2, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "ReadonlyObject") ? ReadonlyObjectInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Record") ? RecordInstantiate(context2, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Required") ? RequiredInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "ReturnType") ? ReturnTypeInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "TemplateLiteral") ? TemplateLiteralInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Uncapitalize") ? UncapitalizeInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "Uppercase") ? UppercaseInstantiate(context2, state, parameters[0], options) : guard_exports.IsEqual(action, "With") ? WithInstantiate(context2, state, parameters[0], parameters[1]) : Deferred(action, parameters, options)
    )
  );
}
function InstantiateImmediate(context2, state, type) {
  const instantiatedType = IsRef2(type) ? RefInstantiate(context2, state, type, type.$ref) : IsArray2(type) ? _Array_(InstantiateType(context2, state, type.items), ArrayOptions(type)) : IsCall(type) ? CallInstantiate(context2, state, type.target, type.arguments) : IsConstructor2(type) ? Constructor(InstantiateTypes(context2, state, type.parameters), InstantiateType(context2, state, type.instanceType), ConstructorOptions(type)) : IsFunction2(type) ? _Function_(InstantiateTypes(context2, state, type.parameters), InstantiateType(context2, state, type.returnType), FunctionOptions(type)) : IsDependent(type) ? Dependent(InstantiateType(context2, state, type.if), InstantiateType(context2, state, type.then), InstantiateType(context2, state, type.else), DependentOptions(type)) : IsIntersect(type) ? Intersect(InstantiateTypes(context2, state, type.allOf), IntersectOptions(type)) : IsObject2(type) ? _Object_(InstantiateProperties(context2, state, type.properties), ObjectOptions(type)) : IsRecord(type) ? RecordFromPattern(RecordPattern(type), InstantiateType(context2, state, RecordValue(type))) : IsRest(type) ? Rest(InstantiateType(context2, state, type.items)) : IsTuple(type) ? Tuple(InstantiateElements(context2, state, type.items), TupleOptions(type)) : IsUnion(type) ? Union(InstantiateTypes(context2, state, type.anyOf), UnionOptions(type)) : type;
  const withModifiers = WithModifiers(type, instantiatedType);
  return withModifiers;
}
function InstantiateType(context2, state, type) {
  const result = IsDeferred(type) ? InstantiateDeferred(context2, state, type.action, type.parameters, type.options) : InstantiateImmediate(context2, state, type);
  return result;
}
function Instantiate(context2, type) {
  return InstantiateType(context2, State([], []), type);
}

// node_modules/typebox/build/type/engine/immutable/instantiate_add.mjs
function AddImmutableOperation(type) {
  return memory_exports.Update(type, { "~immutable": true }, {});
}
function AddImmutableAction(type, options) {
  const result = memory_exports.Update(AddImmutableOperation(type), {}, options);
  return result;
}
function AddImmutableInstantiate(context2, state, type, options) {
  const instantiatedType = InstantiateType(context2, state, type);
  return AddImmutableAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/_add_immutable.mjs
function AddImmutable(type, options = {}) {
  return AddImmutableAction(type, options);
}

// node_modules/typebox/build/type/action/evaluate.mjs
function Evaluate(type, options = {}) {
  return EvaluateAction(type, options);
}

// node_modules/typebox/build/type/engine/priority/priority.mjs
function Comparer(left, right) {
  const compareResult = Compare(left, right);
  return guard_exports.IsEqual(compareResult, CompareResultRightInside) ? 1 : guard_exports.IsEqual(compareResult, CompareResultDisjoint) ? 1 : 0;
}
function Insert(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => guard_exports.IsEqual(Comparer(type, left), 1) ? Insert(type, right, [...result, left]) : [...result, type, ...types], () => [...result, type]);
}
function Sort(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => Sort(right, Insert(left, result)), () => result);
}
function Priority(types) {
  const result = Sort(types);
  return result;
}

// node_modules/typebox/build/value/clean/from_array.mjs
function FromArray7(context2, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  return value.map((value2) => FromType19(context2, type.items, value2));
}

// node_modules/typebox/build/value/clean/from_cyclic.mjs
function FromCyclic6(context2, type, value) {
  return FromType19({ ...context2, ...type.$defs }, Ref2(type.$ref), value);
}

// node_modules/typebox/build/value/clean/from_intersect.mjs
function EvaluateIntersection(context2, type) {
  const additionalProperties = guard_exports.HasPropertyKey(type, "unevaluatedProperties") ? { additionalProperties: type.unevaluatedProperties } : {};
  const instantiated = Instantiate(context2, type);
  const evaluated = Evaluate(instantiated);
  return IsObject2(evaluated) ? With(evaluated, additionalProperties) : evaluated;
}
function FromIntersect6(context2, type, value) {
  const evaluated = EvaluateIntersection(context2, type);
  return FromType19(context2, evaluated, value);
}

// node_modules/typebox/build/value/clean/additional.mjs
function GetAdditionalProperties(type) {
  const additionalProperties = guard_exports.HasPropertyKey(type, "additionalProperties") ? type.additionalProperties : void 0;
  return additionalProperties;
}

// node_modules/typebox/build/value/clean/from_object.mjs
function FromObject11(context2, type, value) {
  if (!guard_exports.IsObject(value) || guard_exports.IsArray(value))
    return value;
  const additionalProperties = GetAdditionalProperties(type);
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.HasPropertyKey(type.properties, key)) {
      value[key] = FromType19(context2, type.properties[key], value[key]);
      continue;
    }
    const unknownCheck = (
      // 1. additionalProperties: true
      guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema2(additionalProperties) && Check2(context2, additionalProperties, value[key])
    );
    if (unknownCheck) {
      value[key] = FromType19(context2, additionalProperties, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}

// node_modules/typebox/build/value/clean/from_record.mjs
function FromRecord3(context2, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const additionalProperties = GetAdditionalProperties(type);
  const [recordPattern, recordValue] = [new RegExp(RecordPattern(type)), RecordValue(type)];
  for (const key of guard_exports.Keys(value)) {
    if (recordPattern.test(key)) {
      value[key] = FromType19(context2, recordValue, value[key]);
      continue;
    }
    const unknownCheck = (
      // 1. additionalProperties: true
      guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema2(additionalProperties) && Check2(context2, additionalProperties, value[key])
    );
    if (unknownCheck) {
      value[key] = FromType19(context2, additionalProperties, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}

// node_modules/typebox/build/value/clean/from_ref.mjs
function FromRef5(context2, type, value) {
  return guard_exports.HasPropertyKey(context2, type.$ref) ? FromType19(context2, context2[type.$ref], value) : value;
}

// node_modules/typebox/build/value/clean/from_tuple.mjs
function FromTuple5(context2, schema, value) {
  if (!guard_exports.IsArray(value))
    return value;
  const length = Math.min(value.length, schema.items.length);
  for (let index = 0; index < length; index++) {
    value[index] = FromType19(context2, schema.items[index], value[index]);
  }
  return guard_exports.IsGreaterThan(value.length, length) ? value.slice(0, length) : value;
}

// node_modules/typebox/build/value/clone/clone.mjs
function Clone2(value) {
  return Clone(value);
}

// node_modules/typebox/build/value/clean/from_union.mjs
function FromUnion9(context2, type, value) {
  for (const schema of type.anyOf) {
    const clean = FromType19(context2, schema, Clone2(value));
    if (Check2(context2, schema, clean))
      return clean;
  }
  return value;
}

// node_modules/typebox/build/value/clean/from_type.mjs
function FromType19(context2, type, value) {
  return IsArray2(type) ? FromArray7(context2, type, value) : IsCyclic(type) ? FromCyclic6(context2, type, value) : IsIntersect(type) ? FromIntersect6(context2, type, value) : IsObject2(type) ? FromObject11(context2, type, value) : IsRecord(type) ? FromRecord3(context2, type, value) : IsRef2(type) ? FromRef5(context2, type, value) : IsTuple(type) ? FromTuple5(context2, type, value) : IsUnion(type) ? FromUnion9(context2, type, value) : value;
}

// node_modules/typebox/build/value/shared/union_priority_sort.mjs
function Modifiers(type, next) {
  for (const key of guard_default.Keys(type)) {
    if (guard_default.HasPropertyKey(next, key))
      continue;
    next[key] = type[key];
  }
  return next;
}
function FromProperties4(properties) {
  const result = {};
  for (const key of guard_default.Keys(properties))
    result[key] = FromType20(properties[key]);
  return result;
}
function FromPriorityTypes(types) {
  return FromTypes6(Priority(types));
}
function FromTypes6(types) {
  return types.map((type) => FromType20(type));
}
function FromType20(type) {
  const next = IsArray2(type) ? _Array_(FromType20(type.items), ArrayOptions(type)) : IsIntersect(type) ? Intersect(FromTypes6(type.allOf)) : IsUnion(type) ? Union(FromPriorityTypes(type.anyOf)) : IsObject2(type) ? _Object_(FromProperties4(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType20(RecordValue(type))) : IsTuple(type) ? Tuple(FromTypes6(type.items)) : type;
  return Modifiers(type, next);
}
function UnionPrioritySort(type) {
  const result = FromType20(type);
  return result;
}

// node_modules/typebox/build/value/clean/clean.mjs
function Clean(...args) {
  const [context2, type, value] = arguments_exports.Match(args, {
    3: (context3, type2, value2) => [context3, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType19(context2, sorted, value);
}

// node_modules/typebox/build/value/convert/try/try.mjs
var try_exports = {};
__export(try_exports, {
  Fail: () => Fail,
  IsOk: () => IsOk,
  Ok: () => Ok,
  TryArray: () => TryArray,
  TryBigInt: () => TryBigInt,
  TryBoolean: () => TryBoolean,
  TryNull: () => TryNull,
  TryNumber: () => TryNumber,
  TryString: () => TryString,
  TryUndefined: () => TryUndefined
});

// node_modules/typebox/build/value/convert/try/try_result.mjs
function IsOk(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "value");
}
function Ok(value) {
  return { value };
}
function Fail() {
  return void 0;
}

// node_modules/typebox/build/value/convert/try/try_array.mjs
function TryArray(value) {
  return guard_exports.IsArray(value) ? Ok(value) : Ok([value]);
}

// node_modules/typebox/build/value/convert/try/try_bigint.mjs
function FromBoolean2(value) {
  return guard_exports.IsEqual(value, true) ? Ok(BigInt(1)) : Ok(BigInt(0));
}
var bigintPattern = /^-?(0|[1-9]\d*)n$/;
var decimalPattern = /^-?(0|[1-9]\d*)\.\d+$/;
var integerPattern = /^-?(0|[1-9]\d*)$/;
function IsStringBigIntLike(value) {
  return bigintPattern.test(value);
}
function IsStringDecimalLike(value) {
  return decimalPattern.test(value);
}
function IsStringIntegerLike(value) {
  return integerPattern.test(value);
}
function FromString2(value) {
  const lowercase = value.toLowerCase();
  return IsStringBigIntLike(value) ? Ok(BigInt(value.slice(0, value.length - 1))) : IsStringDecimalLike(value) ? Ok(BigInt(value.split(".")[0])) : IsStringIntegerLike(value) ? Ok(BigInt(value)) : guard_exports.IsEqual(lowercase, "false") ? Ok(BigInt(0)) : guard_exports.IsEqual(lowercase, "true") ? Ok(BigInt(1)) : Fail();
}
function TryBigInt(value) {
  return guard_exports.IsBigInt(value) ? Ok(value) : guard_exports.IsBoolean(value) ? FromBoolean2(value) : guard_exports.IsNumber(value) ? Ok(BigInt(Math.trunc(value))) : guard_exports.IsNull(value) ? Ok(BigInt(0)) : guard_exports.IsString(value) ? FromString2(value) : guard_exports.IsUndefined(value) ? Ok(BigInt(0)) : Fail();
}

// node_modules/typebox/build/value/convert/try/try_boolean.mjs
function FromBigInt2(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(false) : guard_exports.IsEqual(value, BigInt(1)) ? Ok(true) : Fail();
}
function FromNumber2(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(false) : guard_exports.IsEqual(value, 1) ? Ok(true) : Fail();
}
function FromString3(value) {
  return guard_exports.IsEqual(value.toLowerCase(), "false") ? Ok(false) : guard_exports.IsEqual(value.toLowerCase(), "true") ? Ok(true) : guard_exports.IsEqual(value, "0") ? Ok(false) : guard_exports.IsEqual(value, "1") ? Ok(true) : Fail();
}
function TryBoolean(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt2(value) : guard_exports.IsBoolean(value) ? Ok(value) : guard_exports.IsNumber(value) ? FromNumber2(value) : guard_exports.IsNull(value) ? Ok(false) : guard_exports.IsString(value) ? FromString3(value) : guard_exports.IsUndefined(value) ? Ok(false) : Fail();
}

// node_modules/typebox/build/value/convert/try/try_null.mjs
function FromBigInt3(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(null) : Fail();
}
function FromBoolean3(value) {
  return guard_exports.IsEqual(value, false) ? Ok(null) : Fail();
}
function FromNumber3(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(null) : Fail();
}
function FromString4(value) {
  const lowercase = value.toLowerCase();
  const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
  return predicate ? Ok(null) : Fail();
}
function TryNull(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt3(value) : guard_exports.IsBoolean(value) ? FromBoolean3(value) : guard_exports.IsNumber(value) ? FromNumber3(value) : guard_exports.IsNull(value) ? Ok(null) : guard_exports.IsString(value) ? FromString4(value) : guard_exports.IsUndefined(value) ? Ok(null) : Fail();
}

// node_modules/typebox/build/value/convert/try/try_number.mjs
var maxBigInt = BigInt(Number.MAX_SAFE_INTEGER);
var minBigInt = BigInt(Number.MIN_SAFE_INTEGER);
function FromBigInt4(value) {
  return value <= maxBigInt && value >= minBigInt ? Ok(Number(value)) : Fail();
}
function FromBoolean4(value) {
  return Ok(value ? 1 : 0);
}
function FromString5(value) {
  const coerced = +value;
  if (guard_exports.IsNumber(coerced))
    return Ok(coerced);
  const lowercase = value.toLowerCase();
  if (guard_exports.IsEqual(lowercase, "false"))
    return Ok(0);
  if (guard_exports.IsEqual(lowercase, "true"))
    return Ok(1);
  const result = TryBigInt(value);
  if (IsOk(result))
    return result.value <= maxBigInt && result.value >= minBigInt ? Ok(Number(result.value)) : Fail();
  return Fail();
}
function TryNumber(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt4(value) : guard_exports.IsBoolean(value) ? FromBoolean4(value) : guard_exports.IsNumber(value) ? Ok(value) : guard_exports.IsNull(value) ? Ok(0) : guard_exports.IsString(value) ? FromString5(value) : guard_exports.IsUndefined(value) ? Ok(0) : Fail();
}

// node_modules/typebox/build/value/convert/try/try_string.mjs
function TryString(value) {
  return guard_exports.IsBigInt(value) ? Ok(value.toString()) : guard_exports.IsBoolean(value) ? Ok(value.toString()) : guard_exports.IsNumber(value) ? Ok(value.toString()) : guard_exports.IsNull(value) ? Ok("null") : guard_exports.IsString(value) ? Ok(value) : guard_exports.IsUndefined(value) ? Ok("") : Fail();
}

// node_modules/typebox/build/value/convert/try/try_undefined.mjs
function FromBigInt5(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(void 0) : Fail();
}
function FromBoolean5(value) {
  return guard_exports.IsEqual(value, false) ? Ok(void 0) : Fail();
}
function FromNumber4(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(void 0) : Fail();
}
function FromString6(value) {
  const lowercase = value.toLowerCase();
  const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
  return predicate ? Ok(void 0) : Fail();
}
function TryUndefined(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt5(value) : guard_exports.IsBoolean(value) ? FromBoolean5(value) : guard_exports.IsNumber(value) ? FromNumber4(value) : guard_exports.IsNull(value) ? Ok(void 0) : guard_exports.IsString(value) ? FromString6(value) : guard_exports.IsUndefined(value) ? Ok(value) : Fail();
}

// node_modules/typebox/build/value/convert/from_array.mjs
function FromArray8(context2, type, value) {
  const result = try_exports.TryArray(value);
  return result.value.map((value2) => FromType21(context2, type.items, value2));
}

// node_modules/typebox/build/value/convert/from_bigint.mjs
function FromBigInt6(_context, _type, value) {
  const result = try_exports.TryBigInt(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_boolean.mjs
function FromBoolean6(_context, _type, value) {
  const result = try_exports.TryBoolean(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_cyclic.mjs
function FromCyclic7(context2, type, value) {
  return FromType21({ ...context2, ...type.$defs }, Ref2(type.$ref), value);
}

// node_modules/typebox/build/value/convert/from_enum.mjs
function FromEnum3(context2, type, value) {
  return FromType21(context2, Evaluate(type), value);
}

// node_modules/typebox/build/value/convert/from_integer.mjs
function FromInteger(_context, _type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) ? Math.trunc(result.value) : value;
}

// node_modules/typebox/build/value/convert/from_intersect.mjs
function FromIntersect7(context2, type, value) {
  const instantiated = Instantiate(context2, type);
  const evaluated = Evaluate(instantiated);
  return FromType21(context2, evaluated, value);
}

// node_modules/typebox/build/value/convert/from_literal.mjs
function FromLiteralBigInt(_context, type, value) {
  const result = try_exports.TryBigInt(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralBoolean(_context, type, value) {
  const result = try_exports.TryBoolean(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralNumber(_context, type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralString(_context, type, value) {
  const result = try_exports.TryString(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteral6(context2, type, value) {
  if (guard_exports.IsEqual(type.const, value))
    return value;
  return IsLiteralBigInt(type) ? FromLiteralBigInt(context2, type, value) : IsLiteralBoolean(type) ? FromLiteralBoolean(context2, type, value) : IsLiteralNumber(type) ? FromLiteralNumber(context2, type, value) : IsLiteralString(type) ? FromLiteralString(context2, type, value) : Unreachable();
}

// node_modules/typebox/build/value/convert/from_null.mjs
function FromNull2(_context, _type, value) {
  const result = try_exports.TryNull(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_number.mjs
function FromNumber5(_context, _type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_additional.mjs
function FromAdditionalProperties(context2, entries, additionalProperties, value) {
  const keys = guard_exports.Keys(value);
  for (const [regexp, _] of entries) {
    for (const key of keys) {
      if (!regexp.test(key)) {
        value[key] = FromType21(context2, additionalProperties, value[key]);
      }
    }
  }
  return value;
}

// node_modules/typebox/build/value/shared/optional_undefined.mjs
function IsOptionalUndefined(property, key, value) {
  return IsOptional(property) && guard_exports.IsUndefined(value[key]);
}

// node_modules/typebox/build/value/convert/from_object.mjs
function FromProperties5(context2, type, value) {
  const entries = guard_exports.EntriesRegExp(type.properties);
  const keys = guard_exports.Keys(value);
  for (const [regexp, property] of entries) {
    for (const key of keys) {
      if (!regexp.test(key) || IsOptionalUndefined(property, key, value))
        continue;
      value[key] = FromType21(context2, property, value[key]);
    }
  }
  return guard_exports.HasPropertyKey(type, "additionalProperties") && guard_exports.IsObject(type.additionalProperties) ? FromAdditionalProperties(context2, entries, type.additionalProperties, value) : value;
}
function FromObject12(context2, type, value) {
  return guard_exports.IsObjectNotArray(value) ? FromProperties5(context2, type, value) : value;
}

// node_modules/typebox/build/value/convert/from_record.mjs
function FromPatternProperties(context2, type, value) {
  const entries = guard_exports.EntriesRegExp(type.patternProperties);
  const keys = guard_exports.Keys(value);
  for (const [regexp, schema] of entries) {
    for (const key of keys) {
      if (regexp.test(key)) {
        value[key] = FromType21(context2, schema, value[key]);
      }
    }
  }
  return guard_exports.HasPropertyKey(type, "additionalProperties") && guard_exports.IsObject(type.additionalProperties) ? FromAdditionalProperties(context2, entries, type.additionalProperties, value) : value;
}
function FromRecord4(context2, type, value) {
  return guard_exports.IsObjectNotArray(value) ? FromPatternProperties(context2, type, value) : value;
}

// node_modules/typebox/build/value/convert/from_ref.mjs
function FromRef6(context2, type, value) {
  return guard_exports.HasPropertyKey(context2, type.$ref) ? FromType21(context2, context2[type.$ref], value) : value;
}

// node_modules/typebox/build/value/convert/from_string.mjs
function FromString7(_context, _type, value) {
  const result = try_exports.TryString(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_template_literal.mjs
function FromTemplateLiteral4(context2, type, value) {
  return FromType21(context2, Evaluate(type), value);
}

// node_modules/typebox/build/value/convert/from_tuple.mjs
function FromTuple6(context2, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let index = 0; index < Math.min(type.items.length, value.length); index++) {
    value[index] = FromType21(context2, type.items[index], value[index]);
  }
  return value;
}

// node_modules/typebox/build/value/convert/from_undefined.mjs
function FromUndefined2(_context, _type, value) {
  const result = try_exports.TryUndefined(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_union.mjs
function FromUnion10(context2, type, value) {
  const matched = type.anyOf.some((type2) => Check2(context2, type2, value));
  if (matched)
    return value;
  const candidates = type.anyOf.map((type2) => FromType21(context2, type2, Clone2(value)));
  const selected = candidates.find((value2) => Check2(context2, type, value2));
  return guard_exports.IsUndefined(selected) ? value : selected;
}

// node_modules/typebox/build/value/convert/from_void.mjs
function FromVoid(_context, _type, value) {
  const result = try_exports.TryUndefined(value);
  return try_exports.IsOk(result) ? void 0 : value;
}

// node_modules/typebox/build/value/convert/from_type.mjs
function FromType21(context2, type, value) {
  return IsArray2(type) ? FromArray8(context2, type, value) : IsBigInt2(type) ? FromBigInt6(context2, type, value) : IsBoolean3(type) ? FromBoolean6(context2, type, value) : IsCyclic(type) ? FromCyclic7(context2, type, value) : IsEnum2(type) ? FromEnum3(context2, type, value) : IsInteger2(type) ? FromInteger(context2, type, value) : IsIntersect(type) ? FromIntersect7(context2, type, value) : IsLiteral(type) ? FromLiteral6(context2, type, value) : IsNull2(type) ? FromNull2(context2, type, value) : IsNumber3(type) ? FromNumber5(context2, type, value) : IsObject2(type) ? FromObject12(context2, type, value) : IsRecord(type) ? FromRecord4(context2, type, value) : IsRef2(type) ? FromRef6(context2, type, value) : IsString3(type) ? FromString7(context2, type, value) : IsTemplateLiteral(type) ? FromTemplateLiteral4(context2, type, value) : IsTuple(type) ? FromTuple6(context2, type, value) : IsUndefined2(type) ? FromUndefined2(context2, type, value) : IsUnion(type) ? FromUnion10(context2, type, value) : IsVoid(type) ? FromVoid(context2, type, value) : value;
}

// node_modules/typebox/build/value/convert/convert.mjs
function Convert(...args) {
  const [context2, type, value] = arguments_exports.Match(args, {
    3: (context3, type2, value2) => [context3, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return FromType21(context2, type, value);
}

// node_modules/typebox/build/value/default/from_array.mjs
function FromArray9(context2, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < value.length; i++) {
    value[i] = FromType22(context2, type.items, value[i]);
  }
  return value;
}

// node_modules/typebox/build/value/default/from_cyclic.mjs
function FromCyclic8(context2, type, value) {
  return FromType22({ ...context2, ...type.$defs }, Ref2(type.$ref), value);
}

// node_modules/typebox/build/value/default/from_default.mjs
function FromDefault(type, value) {
  if (!guard_exports.IsUndefined(value))
    return value;
  return guard_exports.IsFunction(type.default) ? type.default() : Clone2(type.default);
}

// node_modules/typebox/build/value/default/from_intersect.mjs
function FromIntersect8(context2, type, value) {
  const instantiated = Instantiate(context2, type);
  const evaluated = Evaluate(instantiated);
  return FromType22(context2, evaluated, value);
}

// node_modules/typebox/build/value/default/from_object.mjs
function FromObject13(context2, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const knownPropertyKeys = guard_exports.Keys(type.properties);
  for (const key of knownPropertyKeys) {
    const propertyValue = FromType22(context2, type.properties[key], value[key]);
    const isUnassignableUndefined = guard_exports.IsUndefined(propertyValue) && (IsOptional(type.properties[key]) || !guard_exports.HasPropertyKey(type.properties[key], "default"));
    if (isUnassignableUndefined)
      continue;
    value[key] = propertyValue;
  }
  if (!IsAdditionalProperties(type) || guard_exports.IsBoolean(type.additionalProperties))
    return value;
  for (const key of guard_exports.Keys(value)) {
    if (knownPropertyKeys.includes(key))
      continue;
    value[key] = FromType22(context2, type.additionalProperties, value[key]);
  }
  return value;
}

// node_modules/typebox/build/value/default/from_record.mjs
function FromRecord5(context2, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const [recordKey, recordValue] = [new RegExp(RecordPattern(type)), RecordValue(type)];
  for (const key of guard_exports.Keys(value)) {
    if (!(recordKey.test(key) && IsDefault(recordValue)))
      continue;
    value[key] = FromType22(context2, recordValue, value[key]);
  }
  if (!IsAdditionalProperties(type))
    return value;
  for (const key of guard_exports.Keys(value)) {
    if (recordKey.test(key))
      continue;
    value[key] = FromType22(context2, type.additionalProperties, value[key]);
  }
  return value;
}

// node_modules/typebox/build/value/default/from_ref.mjs
function FromRef7(context2, type, value) {
  return guard_exports.HasPropertyKey(context2, type.$ref) ? FromType22(context2, context2[type.$ref], value) : value;
}

// node_modules/typebox/build/value/default/from_tuple.mjs
function FromTuple7(context2, schema, value) {
  if (!guard_exports.IsArray(value))
    return value;
  const [items, max] = [schema.items, Math.max(schema.items.length, value.length)];
  for (let i = 0; i < max; i++) {
    if (i < items.length)
      value[i] = FromType22(context2, items[i], value[i]);
  }
  return value;
}

// node_modules/typebox/build/value/default/from_union.mjs
function FromUnion11(context2, schema, value) {
  for (const inner of schema.anyOf) {
    const result = FromType22(context2, inner, Clone2(value));
    if (Check2(context2, inner, result)) {
      return result;
    }
  }
  return value;
}

// node_modules/typebox/build/value/default/from_type.mjs
function FromType22(context2, type, value) {
  const defaulted = IsDefault(type) ? FromDefault(type, value) : value;
  return IsArray2(type) ? FromArray9(context2, type, defaulted) : IsCyclic(type) ? FromCyclic8(context2, type, defaulted) : IsIntersect(type) ? FromIntersect8(context2, type, defaulted) : IsObject2(type) ? FromObject13(context2, type, defaulted) : IsRecord(type) ? FromRecord5(context2, type, defaulted) : IsRef2(type) ? FromRef7(context2, type, defaulted) : IsTuple(type) ? FromTuple7(context2, type, defaulted) : IsUnion(type) ? FromUnion11(context2, type, defaulted) : defaulted;
}

// node_modules/typebox/build/value/default/default.mjs
function Default(...args) {
  const [context2, type, value] = arguments_exports.Match(args, {
    3: (context3, type2, value2) => [context3, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return FromType22(context2, type, value);
}

// node_modules/typebox/build/value/pipeline/pipeline.mjs
function Pipeline(pipeline) {
  return (...args) => {
    const [context2, type, value] = arguments_exports.Match(args, {
      3: (context3, type2, value2) => [context3, type2, value2],
      2: (type2, value2) => [{}, type2, value2]
    });
    return pipeline.reduce((result, func) => func(context2, type, result), value);
  };
}

// node_modules/typebox/build/value/codec/callback.mjs
function Decode2(_context, type, value) {
  return type["~codec"].decode(value);
}
function Encode2(_context, type, value) {
  return type["~codec"].encode(value);
}
function Callback(direction, context2, type, value) {
  if (!IsCodec(type))
    return value;
  return guard_exports.IsEqual(direction, "Decode") ? Decode2(context2, type, value) : Encode2(context2, type, value);
}

// node_modules/typebox/build/value/codec/from_array.mjs
function Decode3(direction, context2, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < value.length; i++) {
    value[i] = FromType23(direction, context2, type.items, value[i]);
  }
  return Callback(direction, context2, type, value);
}
function Encode3(direction, context2, type, value) {
  const exterior = Callback(direction, context2, type, value);
  if (!guard_exports.IsArray(exterior))
    return exterior;
  for (let i = 0; i < exterior.length; i++) {
    exterior[i] = FromType23(direction, context2, type.items, exterior[i]);
  }
  return exterior;
}
function FromArray10(direction, context2, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode3(direction, context2, type, value) : Encode3(direction, context2, type, value);
}

// node_modules/typebox/build/value/codec/from_cyclic.mjs
function FromCyclic9(direction, context2, type, value) {
  value = FromType23(direction, { ...context2, ...type.$defs }, Ref2(type.$ref), value);
  return Callback(direction, context2, type, value);
}

// node_modules/typebox/build/value/codec/from_intersect.mjs
function MergeInteriors(interiors) {
  return interiors.reduce((results, interior) => ({ ...results, ...interior }), {});
}
function NonMatchingInterior(value, interiors) {
  for (const interior of interiors)
    if (!guard_exports.IsDeepEqual(value, interior))
      return interior;
  return value;
}
function Decode4(direction, context2, type, value) {
  if (guard_exports.IsEqual(type.allOf.length, 0))
    return Callback(direction, context2, type, value);
  const interiors = type.allOf.map((schema) => FromType23(direction, context2, schema, Clean(schema, Clone2(value))));
  const structural = interiors.every((result) => guard_exports.IsObject(result));
  const exterior = structural ? MergeInteriors(interiors) : NonMatchingInterior(value, interiors);
  return Callback(direction, context2, type, exterior);
}
function Encode4(direction, context2, type, value) {
  if (guard_exports.IsEqual(type.allOf.length, 0))
    return Callback(direction, context2, type, value);
  const exterior = Callback(direction, context2, type, value);
  const interiors = type.allOf.map((schema) => FromType23(direction, context2, schema, Clean(schema, Clone2(exterior))));
  const structural = interiors.every((result) => guard_exports.IsObject(result));
  if (structural)
    return MergeInteriors(interiors);
  return NonMatchingInterior(exterior, interiors);
}
function FromIntersect9(direction, context2, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode4(direction, context2, type, value) : Encode4(direction, context2, type, value);
}

// node_modules/typebox/build/value/codec/from_object.mjs
function Decode5(direction, context2, type, value) {
  if (!guard_exports.IsObjectNotArray(value))
    return value;
  for (const key of guard_exports.Keys(type.properties)) {
    if (!guard_exports.HasPropertyKey(value, key) || IsOptionalUndefined(type.properties[key], key, value))
      continue;
    value[key] = FromType23(direction, context2, type.properties[key], value[key]);
  }
  return Callback(direction, context2, type, value);
}
function Encode5(direction, context2, type, value) {
  const exterior = Callback(direction, context2, type, value);
  if (!guard_exports.IsObjectNotArray(exterior))
    return exterior;
  for (const key of guard_exports.Keys(type.properties)) {
    if (!guard_exports.HasPropertyKey(exterior, key) || IsOptionalUndefined(type.properties[key], key, exterior))
      continue;
    exterior[key] = FromType23(direction, context2, type.properties[key], exterior[key]);
  }
  return exterior;
}
function FromObject14(direction, context2, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode5(direction, context2, type, value) : Encode5(direction, context2, type, value);
}

// node_modules/typebox/build/value/codec/from_record.mjs
function Decode6(direction, context2, type, value) {
  if (!guard_exports.IsObjectNotArray(value))
    return value;
  const regexp = new RegExp(RecordPattern(type));
  for (const key of guard_exports.Keys(value)) {
    if (!regexp.test(key))
      continue;
    value[key] = FromType23(direction, context2, RecordValue(type), value[key]);
  }
  return Callback(direction, context2, type, value);
}
function Encode6(direction, context2, type, value) {
  const exterior = Callback(direction, context2, type, value);
  if (!guard_exports.IsObjectNotArray(exterior))
    return exterior;
  const regexp = new RegExp(RecordPattern(type));
  for (const key of guard_exports.Keys(exterior)) {
    if (!regexp.test(key))
      continue;
    exterior[key] = FromType23(direction, context2, RecordValue(type), exterior[key]);
  }
  return exterior;
}
function FromRecord6(direction, context2, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode6(direction, context2, type, value) : Encode6(direction, context2, type, value);
}

// node_modules/typebox/build/value/codec/from_ref.mjs
function ResolveRef2(direction, context2, type, value) {
  return guard_exports.HasPropertyKey(context2, type.$ref) ? FromType23(direction, context2, context2[type.$ref], value) : value;
}
function FromRef8(direction, context2, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Callback(direction, context2, type, ResolveRef2(direction, context2, type, value)) : ResolveRef2(direction, context2, type, Callback(direction, context2, type, value));
}

// node_modules/typebox/build/value/codec/from_tuple.mjs
function Decode7(direction, context2, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < Math.min(type.items.length, value.length); i++) {
    value[i] = FromType23(direction, context2, type.items[i], value[i]);
  }
  return Callback(direction, context2, type, value);
}
function Encode7(direction, context2, type, value) {
  const exterior = Callback(direction, context2, type, value);
  if (!guard_exports.IsArray(exterior))
    return value;
  for (let i = 0; i < Math.min(type.items.length, exterior.length); i++) {
    exterior[i] = FromType23(direction, context2, type.items[i], exterior[i]);
  }
  return exterior;
}
function FromTuple8(direction, context2, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode7(direction, context2, type, value) : Encode7(direction, context2, type, value);
}

// node_modules/typebox/build/value/codec/from_union.mjs
function Decode8(direction, context2, type, value) {
  for (const schema of type.anyOf) {
    if (!Check2(context2, schema, value))
      continue;
    const variant = FromType23(direction, context2, schema, value);
    return Callback(direction, context2, type, variant);
  }
  return value;
}
function Encode8(direction, context2, type, value) {
  const exterior = Callback(direction, context2, type, value);
  for (const schema of type.anyOf) {
    const variant = FromType23(direction, context2, schema, Clone2(exterior));
    if (!Check2(context2, schema, variant))
      continue;
    return variant;
  }
  return exterior;
}
function FromUnion12(direction, context2, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode8(direction, context2, type, value) : Encode8(direction, context2, type, value);
}

// node_modules/typebox/build/value/codec/from_type.mjs
function FromType23(direction, context2, type, value) {
  return IsArray2(type) ? FromArray10(direction, context2, type, value) : IsCyclic(type) ? FromCyclic9(direction, context2, type, value) : IsIntersect(type) ? FromIntersect9(direction, context2, type, value) : IsObject2(type) ? FromObject14(direction, context2, type, value) : IsRecord(type) ? FromRecord6(direction, context2, type, value) : IsRef2(type) ? FromRef8(direction, context2, type, value) : IsTuple(type) ? FromTuple8(direction, context2, type, value) : IsUnion(type) ? FromUnion12(direction, context2, type, value) : Callback(direction, context2, type, value);
}

// node_modules/typebox/build/value/codec/decode.mjs
var DecodeError = class extends AssertError {
  constructor(value, errors) {
    super("Decode", value, errors);
  }
};
function Assert(context2, type, value) {
  if (!Check2(context2, type, value))
    throw new DecodeError(value, Errors2(context2, type, value));
  return value;
}
function DecodeUnsafe(context2, type, value) {
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType23("Decode", context2, sorted, value);
}
var Decoder = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context2, type, value) => Default(context2, type, value),
  (context2, type, value) => Convert(context2, type, value),
  (context2, type, value) => Clean(context2, type, value),
  (context2, type, value) => Assert(context2, type, value),
  (context2, type, value) => DecodeUnsafe(context2, type, value)
]);

// node_modules/typebox/build/value/codec/encode.mjs
var EncodeError = class extends AssertError {
  constructor(value, errors) {
    super("Encode", value, errors);
  }
};
function Assert2(context2, type, value) {
  if (!Check2(context2, type, value))
    throw new EncodeError(value, Errors2(context2, type, value));
  return value;
}
function EncodeUnsafe(context2, type, value) {
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType23("Encode", context2, sorted, value);
}
var Encoder = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context2, type, value) => EncodeUnsafe(context2, type, value),
  (context2, type, value) => Default(context2, type, value),
  (context2, type, value) => Convert(context2, type, value),
  (context2, type, value) => Clean(context2, type, value),
  (context2, type, value) => Assert2(context2, type, value)
]);

// node_modules/typebox/build/value/parse/parse.mjs
var ParseError = class extends AssertError {
  constructor(value, errors) {
    super("Parse", value, errors);
  }
};
function Assert3(context2, type, value) {
  if (!Check2(context2, type, value))
    throw new ParseError(value, Errors2(context2, type, value));
  return value;
}
var Parser = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context2, type, value) => Default(context2, type, value),
  (context2, type, value) => Convert(context2, type, value),
  (context2, type, value) => Clean(context2, type, value),
  (context2, type, value) => Assert3(context2, type, value)
]);

// node_modules/typebox/build/value/delta/edit.mjs
var Insert2 = _Object_({
  type: Literal("insert"),
  path: String2(),
  value: Unknown()
});
var Update2 = Object({
  type: Literal("update"),
  path: String2(),
  value: Unknown()
});
var Delete2 = _Object_({
  type: Literal("delete"),
  path: String2()
});
var Edit = Union([Insert2, Update2, Delete2]);

// src/daemon/agent-runtimes/tool-bridge.ts
var BRIDGE_SERVER_NAME = "ohmygame";
var AGENT_OWN_TOOLS = /* @__PURE__ */ new Set([
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
  "recall_image"
]);
var MCP_PROTOCOL_VERSION = "2025-06-18";
var ToolBridge = class {
  #tools;
  #active;
  constructor(tools) {
    this.#tools = new Map(
      tools.filter((tool) => !AGENT_OWN_TOOLS.has(tool.name)).map((tool) => [tool.name, tool])
    );
  }
  get names() {
    return [...this.#tools.keys()];
  }
  /** Limits the tools to those OhMyGame's mode allows, such as planning's read-only set. */
  setActive(names) {
    this.#active = new Set(names);
  }
  /**
   * The tools the current mode allows. `all` lists every tool for agents that
   * register their tools once per native session; `call` still refuses the
   * ones the current mode does not allow.
   */
  list(scope2 = "active") {
    return [...this.#tools.values()].filter(
      (tool) => scope2 === "all" || !this.#active || this.#active.has(tool.name)
    ).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: jsonSchema(tool.parameters),
      // Claude Code otherwise defers MCP tools behind its tool search, where
      // the model may never find update_plan or the media tools.
      _meta: { "anthropic/alwaysLoad": true }
    }));
  }
  async call(name, args, callId, signal) {
    if (signal?.aborted) return failure("The turn was cancelled");
    const tool = this.#tools.get(name);
    if (!tool || this.#active && !this.#active.has(name))
      return failure(`Tool ${name} is not available`);
    const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
    if (!Check2(tool.parameters, input)) {
      const problems = [...Errors2(tool.parameters, input)].slice(0, 5).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
      return failure(`Invalid arguments for ${name}: ${problems}`);
    }
    try {
      const output = await tool.execute(
        callId,
        input,
        signal ?? new AbortController().signal,
        void 0,
        void 0
      );
      return {
        result: {
          content: output.content,
          ...output.details !== void 0 ? { details: output.details } : {}
        },
        isError: false
      };
    } catch (cause) {
      return failure(cause instanceof Error ? cause.message : String(cause));
    }
  }
  /**
   * Answers one MCP JSON-RPC message. A notification gets no answer. Each
   * tool call reports through `observe`, which records it in the conversation
   * with the result the tool returned rather than the text MCP carries back.
   */
  async handle(message, observe, signal) {
    const request = message && typeof message === "object" ? message : {};
    if (request.id === void 0 || request.id === null) return void 0;
    const id = request.id;
    const params = request.params && typeof request.params === "object" ? request.params : {};
    switch (request.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: BRIDGE_SERVER_NAME, version: "1" },
            instructions: "OhMyGame's tools for this game project: canvas checks, image, video, 3D and audio generation, game playtesting and plugin services. Use them instead of writing your own replacements."
          }
        };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: this.list() } };
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const meta = params._meta && typeof params._meta === "object" ? params._meta : {};
        const callId = typeof meta["claudecode/toolUseId"] === "string" ? meta["claudecode/toolUseId"] : `${name}:${String(id)}`;
        const outcome = await this.call(name, params.arguments, callId, signal);
        observe?.({ name, args: params.arguments, callId }, outcome);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: outcome.result.content,
            ...outcome.isError ? { isError: true } : {}
          }
        };
      }
      case "resources/list":
        return { jsonrpc: "2.0", id, result: { resources: [] } };
      case "prompts/list":
        return { jsonrpc: "2.0", id, result: { prompts: [] } };
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method not found: ${String(request.method)}`
          }
        };
    }
  }
};
function failure(text) {
  return { result: { content: [{ type: "text", text }] }, isError: true };
}
function jsonSchema(schema) {
  const value = JSON.parse(JSON.stringify(schema ?? {}));
  return value.type ? value : { type: "object", properties: {}, ...value };
}

// src/daemon/agent-runtimes/skills.ts
import { cp, mkdir as mkdir2, readdir as readdir2, lstat, realpath } from "node:fs/promises";
import path5 from "node:path";
var STAGED_SKILLS = {
  // Claude Code reads Skills from a plugin of the session's own.
  "claude-code-cli": path5.join("claude-plugin", "skills"),
  "codex-cli": "codex-skills",
  "opencode-cli": "opencode-skills"
};
function stagedSkillsRoot(runtime, privateDirectory) {
  return path5.join(privateDirectory, STAGED_SKILLS[runtime]);
}
async function stageSkills(directories, target) {
  await mkdir2(target, { recursive: true, mode: 448 });
  const staged = [];
  const names = /* @__PURE__ */ new Set();
  for (const directory of directories) {
    const name = path5.basename(directory);
    if (!name || names.has(name)) continue;
    try {
      if (!(await lstat(path5.join(directory, "SKILL.md"))).isFile()) continue;
    } catch {
      continue;
    }
    names.add(name);
    await cp(await realpath(directory), path5.join(target, name), {
      recursive: true,
      dereference: false,
      filter: async (source) => !(await lstat(source)).isSymbolicLink(),
      force: true
    });
    staged.push(name);
  }
  return staged;
}

// src/daemon/agent-runtimes/native-session.ts
var NativeSessionExpiredError = class extends Error {
};
var IDLE_PROCESS_MS = 10 * 6e4;

// src/daemon/agent-runtimes/opencode.ts
var START_TIMEOUT_MS = 3e4;
var CALLBACK_PERMISSIONS = [{ action: "*", resource: "*", effect: "ask" }];
var SESSION_PREFIX = "opencode-v2:";
var PERMISSION_DENIAL = "OhMyGame denied this request. Do not retry it through another tool or command. Explain the denial and continue only with permitted work.";
var OpenCodeDriver = class _OpenCodeDriver {
  constructor(context2) {
    this.context = context2;
    this.#legacyResume = Boolean(
      context2.resume && !context2.resume.startsWith(SESSION_PREFIX)
    );
    this.#sessionId = context2.resume?.startsWith(SESSION_PREFIX) ? context2.resume.slice(SESSION_PREFIX.length) : void 0;
  }
  context;
  /** Probe the same server used by real turns, without a session or inference. */
  static async discover(context2) {
    const driver = new _OpenCodeDriver({
      ...context2,
      workspacePath: context2.privateDirectory,
      policy: { workspacePath: context2.privateDirectory, neverTouch: [] },
      bridge: new ToolBridge([]),
      instructions: "",
      model: "",
      skillDirectories: []
    });
    try {
      await driver.#start();
      return await driver.#api("GET", "/model");
    } catch (cause) {
      if (cause instanceof AgentRuntimeCompatibilityError) throw cause;
      throw cliProbeError(
        "OpenCode",
        cause instanceof Error ? cause.message : String(cause)
      );
    } finally {
      await driver.dispose();
    }
  }
  #disposed = false;
  #server;
  #launching;
  #starting;
  #sessionId;
  #projectId;
  #legacyResume = false;
  #turn;
  #bridge;
  #toolInputs = /* @__PURE__ */ new Map();
  /** What bridged OhMyGame tools returned, by tool and arguments: OpenCode's record of the call has only MCP's text. */
  #bridged = /* @__PURE__ */ new Map();
  async runTurn(input, sink, signal) {
    if (signal.aborted) return { status: "aborted" };
    let sessionId;
    try {
      await this.#start();
      if (signal.aborted) return { status: "aborted" };
      sessionId = await this.#session(sink);
      if (signal.aborted) return { status: "aborted" };
    } catch (cause) {
      if (signal.aborted) return { status: "aborted" };
      if (cause instanceof NativeSessionExpiredError) throw cause;
      return {
        status: "failed",
        error: runtimeStartupError(cause).message
      };
    }
    this.#toolInputs.clear();
    return new Promise((resolve) => {
      const turn = {
        sink,
        signal,
        resolve,
        parts: /* @__PURE__ */ new Map(),
        tools: /* @__PURE__ */ new Set(),
        readOnly: input.readOnly
      };
      this.#turn = turn;
      this.#connectBridge(turn).then(() => this.#prompt(sessionId, input, signal)).catch((cause) => {
        if (this.#turn !== turn) return;
        this.#turn = void 0;
        this.#bridge?.revoke();
        resolve(
          signal.aborted ? { status: "aborted" } : {
            status: "failed",
            error: cause instanceof Error ? cause.message : String(cause)
          }
        );
      });
    });
  }
  async interrupt() {
    if (!this.#sessionId || !this.#server) return;
    await this.#api("POST", `/session/${this.#sessionId}/interrupt`).catch(
      () => {
      }
    );
  }
  async compact(sink, signal) {
    if (signal.aborted) return;
    await this.#start();
    if (signal.aborted) return;
    const sessionId = await this.#session(sink);
    if (signal.aborted) return;
    sink.compaction("start");
    const outcome = await new Promise((resolve) => {
      const turn = {
        sink,
        signal,
        resolve,
        parts: /* @__PURE__ */ new Map(),
        tools: /* @__PURE__ */ new Set(),
        manualCompaction: true
      };
      this.#turn = turn;
      this.#api("POST", `/session/${sessionId}/compact`, {}).catch((cause) => {
        if (this.#turn !== turn) return;
        this.#turn = void 0;
        resolve({
          status: "failed",
          error: cause instanceof Error ? cause.message : String(cause)
        });
      });
    });
    sink.compaction(
      "end",
      outcome.status === "failed" ? { error: outcome.error } : {}
    );
    if (outcome.status === "failed") throw new Error(outcome.error);
  }
  async dispose() {
    this.#disposed = true;
    const turn = this.#turn;
    this.#turn = void 0;
    this.#bridge?.revoke();
    this.#bridge = void 0;
    this.#server?.events.abort();
    await (this.#server?.process ?? this.#launching)?.stop();
    turn?.resolve({ status: "aborted" });
    this.#server = void 0;
  }
  /** Whether a turn of this conversation is running, which is when its tool token works. */
  get active() {
    return Boolean(this.#turn);
  }
  async #prompt(sessionId, input, signal) {
    signal.throwIfAborted();
    await this.#checkSavedPermissions();
    signal.throwIfAborted();
    const [providerID, id] = splitModel(this.context.model);
    await this.#api("POST", `/session/${sessionId}/model`, {
      model: {
        providerID,
        id,
        ...this.context.reasoningLevel ? { variant: this.context.reasoningLevel } : {}
      }
    });
    signal.throwIfAborted();
    await this.#api("POST", `/session/${sessionId}/agent`, {
      agent: input.readOnly ? "plan" : "build"
    });
    signal.throwIfAborted();
    await this.#api("POST", `/session/${sessionId}/prompt`, {
      text: input.text,
      files: input.images.map((image, index) => ({
        name: `image-${index + 1}`,
        uri: `data:${image.mimeType};base64,${image.data}`
      }))
    });
  }
  async #session(sink) {
    if (this.#legacyResume)
      throw new NativeSessionExpiredError(
        "OpenCode v1 context must be rebuilt for v2"
      );
    if (this.#sessionId) {
      try {
        await this.#api("GET", `/session/${this.#sessionId}`);
      } catch (cause) {
        if (cause instanceof OpenCodeHttpError && cause.status === 404)
          throw new NativeSessionExpiredError(cause.message);
        throw cause;
      }
    } else {
      const created = record(
        await this.#api("POST", "/session", {
          title: "OhMyGame",
          location: { directory: this.context.workspacePath },
          permissions: CALLBACK_PERMISSIONS
        })
      );
      if (typeof created?.id !== "string")
        throw new Error("OpenCode did not start a session");
      this.#sessionId = created.id;
    }
    await this.#api("PATCH", `/session/${this.#sessionId}`, {
      permissions: CALLBACK_PERMISSIONS
    });
    const info = record(await this.#api("GET", `/session/${this.#sessionId}`));
    const directory = record(info?.location)?.directory;
    if (typeof directory !== "string" || canonicalPath(directory) !== canonicalPath(this.context.workspacePath))
      throw new NativeSessionExpiredError(
        "OpenCode session no longer belongs to this workspace"
      );
    if (!hasCallbackPermissions(info?.permissions))
      throw new AgentRuntimeCompatibilityError(
        "OpenCode did not enable OhMyGame's permission callbacks for this session.",
        "session.permissions=ask"
      );
    sink.nativeSession(SESSION_PREFIX + this.#sessionId);
    return this.#sessionId;
  }
  async #checkSavedPermissions() {
    const result = await this.#api(
      "GET",
      "/permission/saved",
      void 0,
      false,
      { projectID: this.#projectId }
    );
    if (!Array.isArray(result))
      throw new Error("OpenCode did not report its saved permissions");
    if (result.length)
      throw new AgentRuntimeCompatibilityError(
        "OpenCode has saved permissions for this project that can bypass OhMyGame's approvals. Remove those grants in OpenCode and check again. OhMyGame does not delete your CLI permissions.",
        "no saved OpenCode permissions for this project"
      );
  }
  async #start() {
    if (this.#disposed) throw new Error("The agent session was closed");
    if (this.#server?.process.running) return this.#server;
    return this.#starting ??= (async () => {
      try {
        const password = randomBytes(24).toString("base64url");
        const env = {
          ...this.context.env,
          ...await this.#environment(),
          OPENCODE_SERVER_PASSWORD: password
        };
        if (this.#disposed) throw new Error("The agent session was closed");
        let listening = () => {
        };
        const url = new Promise((resolve) => {
          listening = resolve;
        });
        const child = new AgentProcess({
          binaryPath: this.context.binaryPath,
          args: ["serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"],
          cwd: this.context.workspacePath,
          env,
          processDirectory: this.context.processDirectory,
          onLine: (line) => {
            try {
              const info2 = JSON.parse(line);
              if (typeof info2.url === "string" && /^http:\/\/127\.0\.0\.1:\d+$/.test(info2.url))
                listening(info2.url);
            } catch {
            }
          },
          onExit: (code, signal, stderr) => this.#exited(
            child,
            processFailure("OpenCode", code, signal, stderr)
          )
        });
        this.#launching = child;
        let startTimer;
        const address = await Promise.race([
          url,
          child.exited().then(() => void 0),
          new Promise(
            (resolve) => startTimer = setTimeout(
              () => resolve(void 0),
              START_TIMEOUT_MS
            )
          )
        ]);
        clearTimeout(startTimer);
        if (!address) {
          await child.stop();
          throw new Error(
            processFailure(
              "OpenCode",
              child.child.exitCode,
              child.child.signalCode,
              child.stderr || "did not start its server"
            )
          );
        }
        if (this.#disposed) {
          await child.stop();
          throw new Error("The agent session was closed");
        }
        const events = new AbortController();
        const server = {
          process: child,
          url: address,
          auth: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
          events
        };
        this.#server = server;
        let connected;
        let failed;
        const ready = new Promise((resolve, reject) => {
          connected = resolve;
          failed = reject;
        });
        const connectTimer = setTimeout(
          () => events.abort(new Error("OpenCode event stream did not connect")),
          START_TIMEOUT_MS
        );
        void this.#listen(server, connected, failed);
        try {
          await ready;
        } finally {
          clearTimeout(connectTimer);
        }
        if (this.#disposed) throw new Error("The agent session was closed");
        const info = record(await this.#api("GET", "/info", void 0, false));
        checkRuntimeVersionRequirement(
          "opencode-cli",
          typeof info?.version === "string" ? info.version : void 0,
          "standard"
        );
        const location = record(await this.#api("GET", "/location"));
        if (typeof location?.directory !== "string" || !path6.isAbsolute(location.directory) || typeof record(location.project)?.id !== "string")
          throw new AgentRuntimeCompatibilityError(
            "OpenCode did not report its location and project identity.",
            "location.directory / project.id"
          );
        this.#projectId = String(record(location.project).id);
        await this.#checkSavedPermissions();
        const deadline = Date.now() + 5e3;
        for (; ; ) {
          const agents = await this.#api("GET", "/agent");
          if (Array.isArray(agents) && ["build", "plan"].every(
            (id) => agents.some((a) => record(a)?.id === id)
          ) && agents.every(
            (agent) => hasCallbackPermissions(record(agent)?.permissions)
          ))
            break;
          if (Date.now() >= deadline)
            throw new AgentRuntimeCompatibilityError(
              "OpenCode did not enable OhMyGame's permission callbacks for its agents. Check its configuration and plugins, then check again.",
              "build/plan permissions=ask"
            );
          await delay(50, void 0, { signal: events.signal });
        }
        return server;
      } catch (cause) {
        const server = this.#server;
        this.#server = void 0;
        server?.events.abort();
        await (server?.process ?? this.#launching)?.stop();
        throw cause;
      } finally {
        this.#launching = void 0;
        this.#starting = void 0;
      }
    })();
  }
  /** V2 uses the person's CLI configuration, with app instructions and callback rules added. */
  async #environment() {
    const { context: context2 } = this;
    const skills = stagedSkillsRoot("opencode-cli", context2.privateDirectory);
    const staged = context2.skillDirectories.length ? await stageSkills(context2.skillDirectories, skills) : [];
    const instructions = path6.join(context2.privateDirectory, "instructions.md");
    await writeFile2(instructions, context2.instructions, { mode: 384 });
    return {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        share: "disabled",
        snapshots: false,
        permissions: CALLBACK_PERMISSIONS,
        agents: {
          build: { permissions: CALLBACK_PERMISSIONS },
          plan: { permissions: CALLBACK_PERMISSIONS }
        },
        instructions: [instructions],
        ...staged.length ? { skills: [skills] } : {}
      })
    };
  }
  async #api(method, route, body, location = true, query = {}) {
    const server = this.#server;
    if (!server) throw new Error("OpenCode is not running");
    const url = new URL(`/api${route}`, server.url);
    if (location)
      url.searchParams.set("location[directory]", this.context.workspacePath);
    for (const [key, value2] of Object.entries(query))
      url.searchParams.set(key, value2);
    const response = await fetch(url, {
      method,
      headers: {
        authorization: server.auth,
        ...body === void 0 ? {} : { "content-type": "application/json" }
      },
      ...body === void 0 ? {} : { body: JSON.stringify(body) },
      signal: AbortSignal.any([
        AbortSignal.timeout(3e4),
        server.events.signal
      ])
    });
    const text = await response.text();
    if (!response.ok)
      throw new OpenCodeHttpError(
        response.status,
        `OpenCode refused ${route}: ${text.slice(0, 500) || response.status}`
      );
    if (!text) return void 0;
    const value = JSON.parse(text);
    const envelope = record(value);
    return envelope && Object.hasOwn(envelope, "data") ? envelope.data : value;
  }
  async #connectBridge(turn) {
    this.#bridge?.revoke();
    this.#bridged.clear();
    if (!this.context.httpBridge) return;
    turn.signal.throwIfAborted();
    const bridge = await this.context.httpBridge({
      signal: turn.signal,
      active: () => this.#turn === turn && !turn.signal.aborted,
      observe: (call, outcome) => {
        if (this.#turn !== turn || turn.signal.aborted) return;
        const key = bridgedKey(call.name, call.args);
        this.#bridged.set(key, [...this.#bridged.get(key) ?? [], outcome]);
      }
    });
    this.#bridge = bridge;
    try {
      await this.#api("PUT", `/experimental/mcp/${BRIDGE_SERVER_NAME}`, {
        config: {
          type: "remote",
          url: bridge.url,
          disabled: false,
          oauth: false,
          codemode: false,
          headers: { Authorization: `Bearer ${bridge.token}` }
        }
      });
      turn.signal.throwIfAborted();
      await this.#api(
        "POST",
        `/experimental/mcp/${BRIDGE_SERVER_NAME}/connect`
      );
      const servers = await this.#api("GET", "/mcp");
      if (!Array.isArray(servers) || !servers.some(
        (entry) => record(entry)?.name === BRIDGE_SERVER_NAME && record(record(entry)?.status)?.status === "connected"
      ))
        throw new Error("OpenCode could not connect OhMyGame's tool bridge");
      turn.signal.throwIfAborted();
    } catch (cause) {
      bridge.revoke();
      throw cause;
    }
  }
  async #listen(server, connected, failed) {
    try {
      const response = await fetch(`${server.url}/api/event`, {
        headers: {
          authorization: server.auth
        },
        signal: server.events.signal
      });
      if (!response.ok || !response.body)
        throw new Error(`OpenCode event stream failed (${response.status})`);
      connected();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (; ; ) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = chunk.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (!data) continue;
          try {
            this.#event(
              JSON.parse(data)
            );
          } catch {
          }
        }
      }
      if (!server.events.signal.aborted)
        throw new Error("OpenCode event stream disconnected");
    } catch (cause) {
      failed(cause);
      if (!server.events.signal.aborted) {
        const turn = this.#turn;
        this.#turn = void 0;
        await server.process.stop();
        turn?.resolve({
          status: "failed",
          error: cause instanceof Error ? cause.message : String(cause)
        });
      }
    }
  }
  #event(event) {
    const turn = this.#turn;
    const data = event.data ?? {};
    if (event.type === "permission.asked") {
      if (turn) void this.#permission(turn, data);
      else void this.#reply(data, "reject");
      return;
    }
    if (!turn || data.sessionID !== this.#sessionId) return;
    const sink = turn.sink;
    const type = event.type ?? "";
    if (/^session\.(text|reasoning)\.(started|delta|ended)$/.test(type)) {
      const kind = type.includes(".reasoning.") ? "reasoning" : "text";
      const id = `${String(data.assistantMessageID)}:${kind}:${String(data.ordinal)}`;
      let part = turn.parts.get(id);
      if (!part) {
        part = { length: 0, done: false };
        turn.parts.set(id, part);
      }
      if (part.done) return;
      const text = typeof data.text === "string" ? data.text : void 0;
      const delta = type.endsWith(".delta") && typeof data.delta === "string" ? data.delta : text?.slice(part.length) ?? "";
      if (delta) {
        part.length += delta.length;
        if (kind === "text") sink.text(id, delta);
        else sink.thinking(id, delta);
      }
      if (type.endsWith(".ended")) {
        part.done = true;
        if (kind === "text") sink.textDone(id, text);
        else sink.thinkingDone(id, text);
      }
      return;
    }
    switch (type) {
      case "session.tool.input.started":
        this.#toolInputs.set(String(data.id), {
          name: String(data.name),
          input: {}
        });
        return;
      case "session.tool.called": {
        const id = String(data.id);
        const tool = this.#toolInputs.get(id);
        if (!tool || turn.tools.has(id)) return;
        tool.input = record(data.input) ?? {};
        turn.tools.add(id);
        const call = openCodeToolCall(tool.name, tool.input);
        sink.toolCall(id, call.name, call.args);
        sink.toolStarted(id);
        return;
      }
      case "session.tool.success":
      case "session.tool.failed": {
        const id = String(data.id);
        const tool = this.#toolInputs.get(id);
        if (!tool || !turn.tools.has(id)) return;
        const bridged = tool.name.startsWith(`${BRIDGE_SERVER_NAME}_`) ? this.#takeBridged(
          tool.name.slice(BRIDGE_SERVER_NAME.length + 1),
          tool.input
        ) : void 0;
        sink.toolResult(
          id,
          bridged?.result ?? textResult(
            type.endsWith(".failed") ? openCodeError(data.error) : data.content
          ),
          bridged?.isError ?? type.endsWith(".failed")
        );
        this.#toolInputs.delete(id);
        return;
      }
      case "session.step.ended":
      case "session.step.failed": {
        const tokens = record(data.tokens);
        if (tokens) {
          const cache = record(tokens.cache);
          sink.usage(
            {
              input: number(tokens.input),
              output: number(tokens.output),
              cacheRead: number(cache?.read),
              cacheWrite: number(cache?.write)
            },
            this.context.contextWindow,
            number(tokens.input) + number(cache?.read) + number(cache?.write) || void 0
          );
        }
        return;
      }
      case "session.compaction.started":
        if (!turn.manualCompaction) sink.compaction("start");
        return;
      case "session.compaction.ended":
        if (!turn.manualCompaction) sink.compaction("end", {});
        return;
      case "session.compaction.failed":
        turn.error = openCodeError(data.error);
        if (!turn.manualCompaction)
          sink.compaction("end", { error: turn.error });
        return;
      case "session.execution.failed":
        turn.error = openCodeError(data.error);
        break;
      case "session.execution.interrupted":
        break;
      case "session.execution.succeeded":
        break;
      default:
        return;
    }
    this.#turn = void 0;
    this.#toolInputs.clear();
    this.#bridge?.revoke();
    if (turn.signal.aborted || type === "session.execution.interrupted")
      turn.resolve({ status: "aborted" });
    else if (turn.error) turn.resolve({ status: "failed", error: turn.error });
    else turn.resolve({ status: "completed" });
  }
  async #reply(request, decision, message) {
    if (typeof request.sessionID !== "string" || typeof request.id !== "string")
      return;
    await this.#api(
      "POST",
      `/session/${encodeURIComponent(request.sessionID)}/permission/${encodeURIComponent(request.id)}/reply`,
      {
        decision,
        ...message ? { message } : {}
      }
    ).catch(() => {
    });
  }
  #takeBridged(name, args) {
    const key = bridgedKey(name, args);
    const queue = this.#bridged.get(key);
    const outcome = queue?.shift();
    if (queue && !queue.length) this.#bridged.delete(key);
    return outcome;
  }
  async #permission(turn, request) {
    if (typeof request.sessionID !== "string" || !await this.#belongsToSession(request.sessionID) || turn.signal.aborted || this.#turn !== turn) {
      await this.#reply(request, "reject");
      return;
    }
    const permission = String(request.action ?? "");
    const patterns = Array.isArray(request.resources) ? request.resources.map(String) : [];
    const metadata = record(request.metadata) ?? {};
    const filePermission = [
      "external_directory",
      "edit",
      "read",
      "list"
    ].includes(permission);
    const resolvePattern = (value) => path6.resolve(this.context.workspacePath, value);
    const command = typeof metadata.command === "string" ? metadata.command : permission === "shell" ? patterns.join(" ") : void 0;
    const file = typeof metadata.filepath === "string" ? metadata.filepath : typeof metadata.filePath === "string" ? metadata.filePath : ["glob", "grep"].includes(permission) ? typeof metadata.path === "string" ? path6.resolve(this.context.workspacePath, metadata.path) : this.context.workspacePath : filePermission && patterns[0] ? resolvePattern(patterns[0]) : void 0;
    const details = {
      kind: command !== void 0 ? "command" : file ? "file" : "other",
      tool: permission || "tool",
      ...command !== void 0 ? { command } : {},
      ...file ? { path: file } : {},
      ...!file && command === void 0 && patterns.length ? { reason: `Native ${permission} request: ${patterns.join(", ")}` } : {},
      ...filePermission && patterns.length > 1 ? {
        paths: patterns.map((value) => ({
          path: resolvePattern(value),
          access: permission === "edit" ? "write" : "read"
        }))
      } : {},
      canAllowSession: Array.isArray(request.save) && request.save.length > 0 && (file !== void 0 || command !== void 0)
    };
    const callId = typeof record(request.source)?.id === "string" ? String(record(request.source).id) : void 0;
    let decision;
    let feedback;
    try {
      if (OPENCODE_OWN_PERMISSIONS.has(permission) || this.context.bridge.list().some((tool) => `${BRIDGE_SERVER_NAME}_${tool.name}` === permission))
        decision = "allow";
      else if (turn.readOnly && !OPENCODE_READ_PERMISSIONS.has(permission)) {
        decision = permission === "shell" && judgeApproval(details, planningPolicy(this.context.policy)) === "allow" ? "allow" : "deny";
        if (decision === "deny") feedback = PLANNING_DENIAL;
      } else
        decision = await decideApproval(details, this.context, turn.sink, {
          ...callId ? { callId } : {},
          signal: turn.signal
        });
    } catch {
      decision = "deny";
    }
    if (turn.signal.aborted || this.#turn !== turn) {
      decision = "deny";
      feedback = void 0;
    }
    await this.#reply(
      request,
      decision === "deny" ? "reject" : "once",
      decision === "deny" && !turn.signal.aborted && this.#turn === turn ? feedback ?? PERMISSION_DENIAL : void 0
    );
  }
  async #belongsToSession(id) {
    const seen = /* @__PURE__ */ new Set();
    for (let depth = 0; depth < 16; depth++) {
      if (id === this.#sessionId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const info = record(
        await this.#api("GET", `/session/${encodeURIComponent(id)}`).catch(
          () => void 0
        )
      );
      const directory = record(info?.location)?.directory;
      if (typeof directory !== "string" || canonicalPath(directory) !== canonicalPath(this.context.workspacePath))
        return false;
      if (typeof info?.parentID !== "string") return false;
      id = info.parentID;
    }
    return false;
  }
  #exited(child, failure2) {
    if (this.#server?.process !== child) return;
    this.#server.events.abort();
    this.#server = void 0;
    this.#bridge?.revoke();
    const turn = this.#turn;
    this.#turn = void 0;
    turn?.resolve(
      turn.signal.aborted ? { status: "aborted" } : { status: "failed", error: failure2 }
    );
  }
};
var OPENCODE_OWN_PERMISSIONS = /* @__PURE__ */ new Set([
  "subagent",
  "todowrite",
  "todoread",
  "skill",
  "webfetch",
  "websearch"
]);
var OPENCODE_READ_PERMISSIONS = /* @__PURE__ */ new Set([
  "read",
  "glob",
  "grep",
  "list",
  "external_directory"
]);
var OpenCodeHttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
function splitModel(model) {
  const index = model.indexOf("/");
  return index < 0 ? ["opencode", model] : [model.slice(0, index), model.slice(index + 1)];
}
function openCodeToolCall(name, input) {
  const prefix = `${BRIDGE_SERVER_NAME}_`;
  if (name.startsWith(prefix))
    return { name: name.slice(prefix.length), args: input };
  return piToolCall(name, input);
}
function bridgedKey(name, args) {
  return `${name}
${stableJson(args ?? {})}`;
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(",")}}`;
  return JSON.stringify(value);
}
function hasCallbackPermissions(value) {
  if (!Array.isArray(value)) return false;
  const index = value.findLastIndex(
    (v) => record(v)?.action === "*" && record(v)?.resource === "*" && record(v)?.effect === "ask"
  );
  return index >= 0 && value.slice(index + 1).every((v) => ["ask", "deny"].includes(String(record(v)?.effect)));
}
function openCodeError(value) {
  const error = record(value);
  return typeof error?.message === "string" ? error.message : typeof record(error?.data)?.message === "string" ? String(record(error?.data).message) : typeof value === "string" ? value : "OpenCode reported an error";
}

// src/daemon/agent-runtimes/discovery.ts
var PROBE_TIMEOUT_MS = 15e3;
function isCodexNpmShim(binaryPath) {
  return process.platform === "win32" && /^codex\.(?:cmd|ps1)$/i.test(path7.basename(binaryPath));
}
async function resolveBinary(id, override, recheck = false) {
  if (override && /\.(?:cmd|bat|ps1)$/i.test(override) && !(id === "codex-cli" && isCodexNpmShim(override)))
    return void 0;
  if (recheck) await loginShellPath(true);
  if (recheck) {
    for (const key of versionCache.keys())
      if (key.startsWith(`${id}:`)) versionCache.delete(key);
  }
  const definition = AGENT_RUNTIME_DEFINITIONS[id];
  const candidates = override ? [{ path: override, source: "manual" }] : [
    ...await searchCandidates(definition.binaries),
    ...(definition.bundledPaths?.[process.platform] ?? []).map(
      (candidate) => ({
        ...candidate,
        path: candidate.path.startsWith("~/") ? path7.join(os3.homedir(), candidate.path.slice(2)) : candidate.path
      })
    )
  ];
  if (id === "codex-cli" && process.platform === "win32") {
    if (override && isCodexNpmShim(override)) {
      if (!(await stat(override).catch(() => void 0))?.isFile())
        return void 0;
      candidates.splice(
        0,
        candidates.length,
        ...windowsNpmCodexCandidates(path7.dirname(override), "manual")
      );
    } else if (!override) {
      const directories = new Map(
        candidates.map((candidate) => [
          path7.dirname(candidate.path),
          candidate.source
        ])
      );
      for (const [directory, source] of directories)
        candidates.push(...windowsNpmCodexCandidates(directory, source));
      const local = process.env.LOCALAPPDATA;
      if (local) {
        const bin = path7.join(local, "OpenAI", "Codex", "bin");
        const entries = await readdir3(bin, { withFileTypes: true }).catch(
          () => []
        );
        for (const entry of entries)
          if (entry.isDirectory())
            candidates.push({
              path: path7.join(bin, entry.name, "codex.exe"),
              source: "codex-app"
            });
      }
    }
  }
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    try {
      await access(
        candidate.path,
        process.platform === "win32" ? constants.F_OK : constants.X_OK
      );
      const info = await stat(candidate.path);
      if (!info.isFile()) continue;
      const target = await realpath2(candidate.path);
      if (seen.has(target)) continue;
      seen.add(target);
      found.push({
        ...candidate,
        signature: `${candidate.path}:${info.size}:${info.mtimeMs}`
      });
    } catch {
      continue;
    }
  }
  if (found.length <= 1) return found[0];
  const versions = await Promise.all(
    found.map((binary) => cachedVersion(binary, id))
  );
  let best = 0;
  for (let index = 1; index < found.length; index++) {
    const version = versions[index];
    const current = versions[best];
    if (version && (!current || compareVersions(version, current) > 0))
      best = index;
  }
  return found[best];
}
function windowsNpmCodexCandidates(directory, source) {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const target = `${arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc`;
  const root = path7.join(directory, "node_modules", "@openai", "codex");
  const platformPackage = `codex-win32-${arch}`;
  return [
    path7.join(root, "node_modules", "@openai", platformPackage),
    path7.join(directory, "node_modules", "@openai", platformPackage),
    root
  ].flatMap(
    (packageRoot) => ["bin", "codex"].map((folder) => ({
      path: path7.join(packageRoot, "vendor", target, folder, "codex.exe"),
      source
    }))
  );
}
var versionCache = /* @__PURE__ */ new Map();
var VERSION_TTL_MS = 5 * 6e4;
function cachedVersion(binary, id) {
  const key = `${id}:${binary.signature}`;
  const cached = versionCache.get(key);
  if (cached && Date.now() - cached.at < VERSION_TTL_MS) return cached.promise;
  const entry = {
    at: Date.now(),
    promise: probeVersion(
      binary.path,
      id,
      agentEnvironment(id, binary.path)
    ).catch(() => void 0)
  };
  versionCache.set(key, entry);
  void entry.promise.then((version) => {
    if (!version && versionCache.get(key) === entry) versionCache.delete(key);
  });
  if (versionCache.size > 128)
    versionCache.delete(versionCache.keys().next().value);
  return entry.promise;
}
async function searchCandidates(names) {
  const shell = await loginShellPath();
  const directories = /* @__PURE__ */ new Map();
  for (const [folders, source] of [
    [(process.env.PATH ?? "").split(path7.delimiter), "path"],
    [(shell ?? "").split(path7.delimiter), "login-shell"],
    [commonBinaryDirectories(), "common-directory"]
  ])
    for (const folder of folders)
      if (folder && !directories.has(folder)) directories.set(folder, source);
  const extensions = process.platform === "win32" ? [".exe"] : [""];
  return [...directories].flatMap(
    ([directory, source]) => names.flatMap(
      (name) => extensions.map((extension) => ({
        path: path7.join(directory, `${name}${extension}`),
        source
      }))
    )
  );
}
function runCli(binaryPath, args, env, cwd, timeout = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile3(
      binaryPath,
      [...args],
      {
        env,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
        ...cwd ? { cwd } : {}
      },
      (error, stdout, stderr) => {
        const code = error ? typeof error.code === "number" ? error.code : 1 : 0;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
      }
    );
  });
}
async function probeVersion(binaryPath, id, env) {
  const { stdout, stderr, code } = await runCli(
    binaryPath,
    AGENT_RUNTIME_DEFINITIONS[id].versionArgs,
    env
  );
  return code === 0 ? parseVersion(`${stdout}
${stderr}`) : void 0;
}
async function probeAuth(binaryPath, id, env) {
  if (id === "claude-code-cli") {
    const { stdout } = await runCli(binaryPath, ["auth", "status"], env);
    try {
      const status = JSON.parse(stdout);
      if (status.loggedIn !== true)
        return { status: "signed-out", billing: "unknown" };
      const billing = status.apiProvider && status.apiProvider !== "firstParty" ? "provider" : status.authMethod === "claude.ai" || status.authMethod === "oauth_token" ? "subscription" : "api-key";
      return {
        status: "signed-in",
        billing,
        ...typeof status.email === "string" ? { account: status.email } : {}
      };
    } catch {
      return { status: "unknown", billing: "unknown" };
    }
  }
  if (id === "codex-cli") {
    const { stdout, stderr } = await runCli(
      binaryPath,
      ["login", "status"],
      env
    );
    const text = `${stdout}
${stderr}`;
    if (/not logged in/i.test(text))
      return { status: "signed-out", billing: "unknown" };
    if (/logged in using chatgpt/i.test(text))
      return { status: "signed-in", billing: "subscription" };
    if (/logged in using an api key/i.test(text))
      return { status: "signed-in", billing: "api-key" };
    return { status: "unknown", billing: "unknown" };
  }
  return { status: "unknown", billing: "provider" };
}
async function probeModels(binaryPath, id, env, privateDirectory) {
  const name = AGENT_RUNTIME_DEFINITIONS[id].name;
  const model = (modelId, label, levels) => ({
    provider: id,
    id: modelId,
    name: label,
    providerName: name,
    reasoningLevels: [],
    nativeReasoningLevels: [...new Set(levels)]
  });
  if (id === "claude-code-cli") {
    const listed = await claudeModels(binaryPath, env, privateDirectory);
    return {
      models: listed.map(
        (entry) => model(
          entry.value,
          entry.displayName,
          entry.supportsEffort ? entry.supportedEffortLevels ?? [] : []
        )
      )
    };
  }
  if (id === "codex-cli") {
    const server = new CodexAppServer(binaryPath, privateDirectory, env);
    try {
      await server.initialize(PROBE_TIMEOUT_MS);
      await checkCodexCompatibility(server, privateDirectory, PROBE_TIMEOUT_MS);
      const [list, account, limits] = await Promise.all([
        codexModels(server),
        server.request(
          "account/read",
          { refreshToken: false },
          PROBE_TIMEOUT_MS
        ).catch(() => void 0),
        server.request("account/rateLimits/read", {}, PROBE_TIMEOUT_MS).then(codexLimits).catch(() => void 0)
      ]);
      const models = list.filter(
        (entry) => entry.hidden !== true && typeof entry.id === "string"
      ).map(
        (entry) => model(
          String(entry.id),
          typeof entry.displayName === "string" ? entry.displayName : String(entry.id),
          Array.isArray(entry.supportedReasoningEfforts) ? entry.supportedReasoningEfforts.map(
            (effort) => String(
              effort.reasoningEffort
            )
          ) : []
        )
      );
      return {
        models,
        ...typeof account?.account?.email === "string" ? { account: account.account.email } : {},
        ...limits?.length ? { limits } : {}
      };
    } catch (cause) {
      if (cause instanceof AgentRuntimeCompatibilityError) throw cause;
      throw cliProbeError(
        "Codex",
        cause instanceof Error ? cause.message : String(cause)
      );
    } finally {
      await server.stop();
    }
  }
  const output = await OpenCodeDriver.discover({
    binaryPath,
    env,
    privateDirectory
  });
  return {
    models: parseOpenCodeModels(output).map((entry) => ({
      ...model(entry.id, entry.name, entry.variants),
      ...entry.contextWindow ? { contextWindow: entry.contextWindow } : {}
    }))
  };
}
async function codexModels(server) {
  const models = [];
  let cursor;
  const seen = /* @__PURE__ */ new Set();
  do {
    const page = await server.request(
      "model/list",
      { ...cursor ? { cursor } : {}, limit: 100 },
      PROBE_TIMEOUT_MS
    );
    models.push(...page.data ?? []);
    cursor = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : void 0;
    if (cursor && seen.has(cursor))
      throw new Error("Codex returned a repeated model catalog cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return models;
}
async function claudeModels(binaryPath, env, cwd) {
  return new Promise((resolve, reject) => {
    const id = `models-${randomUUID()}`;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void child.stop();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const child = new AgentProcess({
      binaryPath,
      args: [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--permission-prompt-tool",
        "stdio"
      ],
      cwd,
      env,
      onLine: (line) => {
        try {
          const message = JSON.parse(line);
          if (message.type !== "control_response" || !message.response) return;
          const isInitialize = message.response?.request_id === `init-${id}`;
          if (!isInitialize && message.response?.request_id !== id) return;
          if (message.response.subtype === "error")
            finish(
              cliProbeError(
                "Claude Code",
                message.response.error ?? "Claude Code could not list its models"
              )
            );
          else {
            const models = (message.response?.response?.models ?? []).filter(
              (model) => typeof model.value === "string" && typeof model.displayName === "string"
            );
            if (models.length || !isInitialize) finish(models);
            else
              child.write({
                type: "control_request",
                request_id: id,
                request: { subtype: "list_models" }
              });
          }
        } catch {
        }
      },
      onExit: (_code, _signal, stderr) => finish(
        cliProbeError(
          "Claude Code",
          stderr.trim().split("\n").at(-1) || "Claude Code exited before listing its models"
        )
      )
    });
    const timer = setTimeout(
      () => finish(new Error("Claude Code did not list its models in time")),
      PROBE_TIMEOUT_MS
    );
    child.write({
      type: "control_request",
      request_id: `init-${id}`,
      request: {
        subtype: "initialize",
        sdkMcpServers: ["ohmygame"],
        hooks: { PreToolUse: [{ hookCallbackIds: ["ohmygame-policy"] }] }
      }
    });
  });
}
function parseOpenCodeModels(output) {
  if (!Array.isArray(output))
    throw new Error("OpenCode did not return a readable model catalog");
  return output.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value;
    const capabilities = item.capabilities;
    if (typeof item.id !== "string" || typeof item.providerID !== "string" || item.enabled !== true || capabilities?.tools !== true || item.status === "deprecated")
      return [];
    const context2 = item.limit?.context;
    return [
      {
        id: `${item.providerID}/${item.id}`,
        name: typeof item.name === "string" ? item.name : item.id,
        variants: Array.isArray(item.variants) ? item.variants.flatMap(
          (v) => v && typeof v === "object" && typeof v.id === "string" ? [v.id] : []
        ) : [],
        ...typeof context2 === "number" && context2 > 0 ? { contextWindow: context2 } : {}
      }
    ];
  });
}

// src/daemon/guest-agent-bridge.ts
var runtimeIds = { codex: "codex-cli", "claude-code": "claude-code-cli", opencode: "opencode-cli" };
function agentId(value) {
  return typeof value === "string" && Object.hasOwn(runtimeIds, value);
}
function originAllowed(origin) {
  if (!origin) return true;
  if (origin === "https://game.design.cab") return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}
async function context(id, directory) {
  const runtime = runtimeIds[id];
  const binary = await resolveBinary(runtime);
  if (!binary) return void 0;
  return { binary: binary.path, environment: agentEnvironment(runtime, binary.path), directory };
}
async function discoverGuestAgent(id, directory) {
  const native = await context(id, directory);
  if (!native) return { installed: false, auth: "unknown", models: [] };
  const runtime = runtimeIds[id];
  const auth = await probeAuth(native.binary, runtime, native.environment);
  try {
    const result = await probeModels(native.binary, runtime, native.environment, directory);
    return { installed: true, auth: auth.status, models: result.models.map((model) => ({ id: model.id, name: model.name, effort: model.nativeReasoningLevels ?? [] })) };
  } catch {
    return { installed: true, auth: auth.status, models: [], error: "models-unavailable" };
  }
}
async function runGuestAgent(id, model, messages, directory, signal, effort) {
  const native = await context(id, directory);
  if (!native) throw new Error("agent-not-installed");
  const prompt = messages.map((message) => `${message.role.toUpperCase()}
${message.content}`).join("\n\n");
  const outputFile = path8.join(directory, "result.txt");
  let args;
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
  const output = await new Promise((resolve, reject) => {
    const child = spawn3(native.binary, args, { cwd: directory, env: native.environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
    let stdout = "";
    let finished = false;
    const stop = () => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
      }
    };
    const finish = (error) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      if (error) {
        stop();
        reject(error);
      } else resolve(stdout);
    };
    const abort = () => finish(new Error("agent-cancelled"));
    child.on("error", () => finish(new Error("agent-start-failed")));
    child.stdout.on("data", (data) => {
      stdout += data.toString();
      if (stdout.length > 8e6) finish(new Error("agent-output-too-large"));
    });
    child.stderr.resume();
    child.on("close", (code) => finish(code === 0 ? void 0 : new Error("agent-generation-failed")));
    child.stdin.on("error", () => void 0);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    child.stdin.end(prompt);
  });
  if (id === "codex") return readFile2(outputFile, "utf8");
  if (id === "claude-code") {
    const result = JSON.parse(output);
    if (result.is_error || typeof result.result !== "string") throw new Error("agent-generation-failed");
    return result.result;
  }
  const text = output.split("\n").flatMap((line) => {
    try {
      const event = JSON.parse(line);
      return event.type === "text" && typeof event.part?.text === "string" ? [event.part.text] : [];
    } catch {
      return [];
    }
  }).join("\n");
  if (!text) throw new Error("agent-generation-failed");
  return text;
}
async function startGuestAgentBridge(options = {}) {
  const token = options.token ?? randomBytes2(32).toString("hex");
  const directory = await mkdtemp(path8.join(tmpdir(), "must-agent-bridge-"));
  const discover = options.discover ?? discoverGuestAgent;
  const generate = options.generate ?? runGuestAgent;
  const cache = /* @__PURE__ */ new Map();
  const scans = /* @__PURE__ */ new Map();
  let busy = false;
  const jobs = /* @__PURE__ */ new Set();
  function json(response, status, value) {
    if (response.destroyed) return;
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(JSON.stringify(value));
  }
  async function readBody(request) {
    let body = "";
    for await (const chunk of request) {
      body += chunk.toString();
      if (body.length > 2e6) throw new Error("request-too-large");
    }
    return JSON.parse(body);
  }
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const host = request.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !originAllowed(origin)) {
      json(response, 403, { error: "origin-denied" });
      return;
    }
    if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Private-Network": "true" });
      response.end();
      return;
    }
    const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer /, "") ?? "");
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      json(response, 401, { error: "pairing-required" });
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const match = /^\/agents\/(codex|claude-code|opencode)\/models$/.exec(pathname);
    try {
      if (request.method === "GET" && match && agentId(match[1])) {
        const id = match[1];
        const cached = cache.get(id);
        let value = cached && Date.now() - cached.at < 3e4 ? cached.value : void 0;
        if (!value) {
          let scan = scans.get(id);
          if (!scan) {
            scan = (async () => {
              const folder = await mkdtemp(path8.join(directory, "probe-"));
              try {
                const result = await discover(id, folder);
                cache.set(id, { value: result, at: Date.now() });
                return result;
              } finally {
                await rm3(folder, { recursive: true, force: true });
                scans.delete(id);
              }
            })();
            scans.set(id, scan);
          }
          value = await scan;
        }
        json(response, 200, value);
        return;
      }
      if (request.method === "POST" && pathname === "/agents/generate") {
        if (busy) {
          json(response, 409, { error: "agent-busy" });
          return;
        }
        busy = true;
        const controller = new AbortController();
        jobs.add(controller);
        const stop = () => {
          if (!response.writableEnded) controller.abort();
        };
        request.once("aborted", stop);
        response.once("close", stop);
        let folder;
        const timer = setTimeout(() => controller.abort(), 3e5);
        try {
          const body = await readBody(request);
          if (!agentId(body.agent) || typeof body.model !== "string" || !body.model.trim() || body.model.length > 200 || !Array.isArray(body.messages) || body.messages.length > 12 || body.messages.length === 0 || body.messages.some((message) => !message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string")) {
            json(response, 400, { error: "invalid-request" });
            return;
          }
          folder = await mkdtemp(path8.join(directory, "generation-"));
          if (body.effort !== void 0 && (typeof body.effort !== "string" || !/^[a-z-]{1,20}$/.test(body.effort))) {
            json(response, 400, { error: "invalid-request" });
            return;
          }
          const content = await generate(body.agent, body.model, body.messages, folder, controller.signal, body.effort);
          json(response, 200, { content });
        } finally {
          clearTimeout(timer);
          jobs.delete(controller);
          request.removeListener("aborted", stop);
          response.removeListener("close", stop);
          if (folder) await rm3(folder, { recursive: true, force: true });
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
  server.requestTimeout = 32e4;
  server.headersTimeout = 15e3;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 11435, "127.0.0.1", () => resolve());
    });
  } catch (error) {
    await rm3(directory, { recursive: true, force: true });
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bridge-start-failed");
  return { token, port: address.port, server, async close() {
    for (const job of jobs) job.abort();
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm3(directory, { recursive: true, force: true });
  } };
}
if (process.argv[1] && path8.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const bridge = await startGuestAgentBridge();
    console.log("\u6FB3\u9580\u79D1\u6280\u5927\u5B78 \xB7 \u672C\u6A5F\u667A\u80FD\u9AD4\u9023\u63A5\u5668\nLocal agent connector is ready on 127.0.0.1:" + bridge.port);
    console.log("\u5728\u700F\u89BD\u5668\u958B\u555F\u4E0B\u65B9\u9023\u7D50\u914D\u5C0D / Open this link to pair:\nhttps://game.design.cab/#/settings/providers?bridge=" + bridge.token + "&agent=codex");
    console.log("\u5E33\u865F\u767B\u5165\u7531\u4F60\u96FB\u8166\u4E0A\u7684 CLI \u7BA1\u7406\u3002\u6309 Ctrl+C \u505C\u6B62\u9023\u63A5\u3002\nYour CLI manages account sign-in. Press Ctrl+C to disconnect.");
    const stop = () => {
      void bridge.close().finally(() => process.exit(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch {
    console.error("\u7121\u6CD5\u555F\u52D5\u9023\u63A5\u5668\u3002\u8ACB\u78BA\u8A8D Node.js 22 \u4EE5\u4E0A\u53CA 11435 \u57E0\u672A\u88AB\u4F54\u7528\u3002\nCould not start. Use Node.js 22+ and check that port 11435 is free.");
    process.exitCode = 1;
  }
}
export {
  discoverGuestAgent,
  runGuestAgent,
  startGuestAgentBridge
};
