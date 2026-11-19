import { t } from "../i18n.js";
import { modelRequest, type GuestSettings } from "./models.js";

export async function generateImage(settings: GuestSettings, key: string, prompt: string, signal: AbortSignal): Promise<Blob> {
  if (settings.protocol !== "openai" || !settings.imageModel.trim()) throw new Error(t("guestStudio.needMedia"));
  const result = await (await modelRequest(settings, key, "/images/generations", signal, { model: settings.imageModel, prompt, n: 1 })).json();
  const image = result.data?.[0];
  if (typeof image?.b64_json === "string") {
    const bytes = Uint8Array.from(atob(image.b64_json), char => char.charCodeAt(0));
    return new Blob([bytes], { type: "image/png" });
  }
  if (typeof image?.url === "string" && new URL(image.url).protocol === "https:") {
    const response = await fetch(image.url, { signal, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    if (!response.ok) throw new Error(t("guestStudio.invalidResult"));
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error(t("guestStudio.invalidResult"));
    return blob;
  }
  throw new Error(t("guestStudio.invalidResult"));
}

export async function generateVideo(settings: GuestSettings, key: string, prompt: string, signal: AbortSignal, onJob: (id: string) => void, resumeId?: string): Promise<Blob> {
  if (settings.protocol !== "openai" || !settings.videoModel.trim()) throw new Error(t("guestStudio.needMedia"));
  let id = resumeId;
  if (!id) {
    const body = new FormData();
    body.set("model", settings.videoModel);
    body.set("prompt", prompt);
    body.set("seconds", "4");
    const job = await (await modelRequest(settings, key, "/videos", signal, body)).json();
    if (typeof job.id !== "string") throw new Error(t("guestStudio.invalidResult"));
    id = job.id;
  }
  if (typeof id !== "string" || !id.trim()) throw new Error(t("guestStudio.invalidResult"));
  onJob(id);
  while (!signal.aborted) {
    const job = await (await modelRequest(settings, key, "/videos/" + encodeURIComponent(id), signal)).json();
    if (job.status === "failed") throw new Error(t("guestStudio.videoFailed"));
    if (job.status === "completed") {
      const blob = await (await modelRequest(settings, key, "/videos/" + encodeURIComponent(id) + "/content", signal)).blob();
      if (!blob.type.startsWith("video/")) throw new Error(t("guestStudio.invalidResult"));
      return blob;
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 5000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw signal.reason;
}
