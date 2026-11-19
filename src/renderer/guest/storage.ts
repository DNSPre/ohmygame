import { t } from "../i18n.js";

export interface GuestProject {
  id: string;
  name: string;
  kind: "game" | "brief" | "image" | "video";
  prompt: string;
  content: string;
  media?: Blob;
  updatedAt: number;
}

let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("must-personal-workspace", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error(t("guestStudio.storageError"))); };
    request.onblocked = () => { database = undefined; reject(new Error(t("guestStudio.storageError"))); };
  });
}

export async function saveProject(project: GuestProject): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("projects", "readwrite");
    transaction.objectStore("projects").put(project);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(new Error(t("guestStudio.storageError")));
  });
}

export async function readProjects(): Promise<GuestProject[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("projects", "readonly");
    const request = transaction.objectStore("projects").getAll();
    transaction.oncomplete = () => resolve((request.result as GuestProject[]).sort((a, b) => b.updatedAt - a.updatedAt));
    transaction.onabort = transaction.onerror = () => reject(new Error(t("guestStudio.storageError")));
  });
}

export function importProject(value: unknown): GuestProject {
  const data = value as Partial<GuestProject> | null;
  if (!data || !["game", "brief"].includes(data.kind ?? "") || typeof data.name !== "string" || typeof data.content !== "string" || typeof data.prompt !== "string" || data.content.length > 4_000_000) {
    throw new Error(t("guestStudio.importError"));
  }
  return { id: crypto.randomUUID(), kind: data.kind as "game" | "brief", name: data.name.slice(0, 100), content: data.content, prompt: data.prompt.slice(0, 8000), updatedAt: Date.now() };
}
