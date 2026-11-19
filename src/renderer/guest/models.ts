import { t } from "../i18n.js";

export interface GuestSettings {
  protocol: "ollama" | "openai";
  baseUrl: string;
  model: string;
  imageModel: string;
  videoModel: string;
}
const defaults: GuestSettings = { protocol: "ollama", baseUrl: "http://127.0.0.1:11434", model: "", imageModel: "", videoModel: "" };
const settingsKey = "must:personal-model-settings";

export function readSettings(): GuestSettings {
  try {
    const value = JSON.parse(localStorage.getItem(settingsKey) ?? "null") as GuestSettings | null;
    if (value && ["ollama", "openai"].includes(value.protocol) && [value.baseUrl, value.model, value.imageModel, value.videoModel].every(item => typeof item === "string")) return value;
  } catch { /* Start with defaults when a preference cannot be read. */ }
  return { ...defaults };
}
export function baseUrl(value: string): string {
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/$/, "");
  } catch { throw new Error(t("guestStudio.badUrl")); }
}
export function persistSettings(settings: GuestSettings): GuestSettings {
  const clean: GuestSettings = { protocol: settings.protocol, baseUrl: baseUrl(settings.baseUrl), model: settings.model, imageModel: settings.imageModel, videoModel: settings.videoModel };
  try { localStorage.setItem(settingsKey, JSON.stringify(clean)); } catch { throw new Error(t("guestStudio.storageError")); }
  return clean;
}

export async function modelRequest(settings: GuestSettings, key: string, path: string, signal: AbortSignal, body?: object | FormData): Promise<Response> {
  let response: Response;
  const headers: Record<string, string> = {};
  if (key) headers.Authorization = "Bearer " + key;
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  try {
    response = await fetch(baseUrl(settings.baseUrl) + path, {
      method: body ? "POST" : "GET", headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal,
    });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new Error(t("guestStudio.networkError"), { cause: error });
  }
  if (!response.ok) throw new Error(t("guestStudio.requestError", { status: response.status }));
  return response;
}

export async function fetchModels(settings: GuestSettings, key: string): Promise<string[]> {
  const response = await modelRequest(settings, key, settings.protocol === "ollama" ? "/api/tags" : "/models", AbortSignal.timeout(12000));
  const result = await response.json();
  const values = settings.protocol === "ollama" ? result.models?.map((item: { name: string }) => item.name) : result.data?.map((item: { id: string }) => item.id);
  return Array.isArray(values) ? values.filter((item: unknown): item is string => typeof item === "string").slice(0, 1000) : [];
}

export async function generateText(settings: GuestSettings, key: string, messages: { role: string; content: string }[], signal: AbortSignal): Promise<string> {
  if (!settings.model.trim()) throw new Error(t("guestStudio.needModel"));
  const local = settings.protocol === "ollama";
  const response = await modelRequest(settings, key, local ? "/api/chat" : "/chat/completions", signal, {
    model: settings.model, messages, stream: false,
    ...(local ? { options: { num_predict: 6000, num_ctx: 16384 } } : {}),
  });
  const result = await response.json();
  const content: unknown = local ? result.message?.content : result.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim() || content.length > 4_000_000) throw new Error(t("guestStudio.invalidResult"));
  return content;
}

export function extractGame(content: string): string {
  const fenced = /```(?:html)?\s*([\s\S]*?)```/i.exec(content);
  const html = (fenced?.[1] ?? content).trim();
  if (!/<(?:!doctype\s+html|html|body|canvas|script)\b/i.test(html)) throw new Error(t("guestStudio.invalidResult"));
  return html;
}

export function previewHtml(content: string): string {
  // The opaque sandbox has no origin permissions. Block network and all nested documents.
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' + policy + '"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + content + '</body></html>';
}

export const gameSystemPrompt = "You are a game development agent. Return ONLY one complete, self-contained HTML document. Implement a fully playable browser game matching the user's request. Include inline CSS and JavaScript, clear instructions, keyboard and touch controls, scoring, a win or lose condition and a restart button. Use Canvas or plain DOM. No external scripts, imports, URLs, images, fetch, libraries or server. Draw graphics procedurally. The game runs in an isolated iframe without network or storage. Make it responsive and polished. Follow the language of the user's request.";
