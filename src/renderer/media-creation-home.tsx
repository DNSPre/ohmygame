import { useEffect, useRef, useState } from "react";
import type { AssetCanvasReference, ImageModel, MediaModelCatalog, VideoModel } from "../shared/contracts.js";
import { createAssetCanvasStarterDocument, preferredImageOption } from "../shared/asset-canvas.js";
import { videoReferenceAspectRatios } from "../shared/video-references.js";
import { PagesExport, PagesNotice, readPagesDraft, savePagesDraft } from "./pages-prompt.js";
import { AppSidebar } from "./app-sidebar.js";
import { createProject, deleteProject, listImageModelCatalog, listVideoModelCatalog, uploadLibraryAsset, waitForRuntime } from "./api.js";
import { generateCanvasMedia, getCanvasBoard, getCanvasWorkspace, saveCanvasBoard } from "./canvas-api.js";
import { Plus, SendArrow } from "./icons.js";
import { t } from "./i18n.js";
import type { AppNavigationTarget } from "./routes.js";
import muyuMark from "./assets/muyu-ai-icon.png";
import { WindowDragRegion } from "./window-drag-region.js";

type Mode = "image" | "video";
type Model = ImageModel | VideoModel;
type Draft = { projectId: string; nodeId: string };

export function MediaCreationHome({ mode, onNavigate, onOpen, pagesPreview = false }: {
  mode: Mode;
  pagesPreview?: boolean;
  onNavigate: (page: AppNavigationTarget) => void;
  onOpen: (projectId: string, nodeId: string) => void;
}) {
  const [catalog, setCatalog] = useState<MediaModelCatalog<Model>>();
  const [prompt, setPrompt] = useState(() => pagesPreview ? readPagesDraft(mode) : "");
  const [draftStatus, setDraftStatus] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [autoRun, setAutoRun] = useState(!pagesPreview);
  const [reference, setReference] = useState<File>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const fileInput = useRef<HTMLInputElement>(null);
  const page = mode === "image" ? "image-generation" : "video-generation";

  useEffect(() => {
    if (pagesPreview) return;
    let live = true;
    void waitForRuntime().then<MediaModelCatalog<Model>>(() => mode === "image" ? listImageModelCatalog() : listVideoModelCatalog())
      .then((models) => { if (live) setCatalog(models); })
      .catch((cause: unknown) => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [mode, pagesPreview]);

  const models = catalog?.models ?? [];
  const defaultModel = catalog?.defaultModel;
  const model = modelKey
    ? models.find((item) => key(item) === modelKey)
    : models.find((item) => item.provider === defaultModel?.provider && item.id === defaultModel?.id) ?? models[0];
  const acceptsReference = model && ("generationOptions" in model ? model.supportsReferenceImage : model.maxImageReferences > 0);
  const canSubmit = Boolean(prompt.trim() && !busy && (!autoRun || model) && (!reference || acceptsReference));

  async function submit(): Promise<void> {
    if (!canSubmit || saving.current) return;
    if (pagesPreview) { setDraftStatus(savePagesDraft(mode, prompt)); return; }
    saving.current = true;
    setBusy(true);
    setError(undefined);
    setDraft(undefined);
    let projectId: string | undefined;
    let saved: Draft | undefined;
    try {
      const { document, nodeId } = createAssetCanvasStarterDocument(mode);
      const node = document.nodes[0];
      if (node?.type !== "image" && node?.type !== "video") throw new Error("Missing media node");
      node.data.prompt = prompt.trim();
      if (node.type === "image" && model && "generationOptions" in model) {
        node.data.model = { provider: model.provider, id: model.id };
        const option = preferredImageOption(model);
        if (option) {
          node.data.aspectRatio = option.aspectRatio;
          node.data.resolution = option.resolution;
        }
      }
      if (node.type === "video" && model && "durations" in model) {
        node.data.model = { provider: model.provider, id: model.id };
        node.data.referenceMode = model.imageReferenceMode ?? model.referenceModes?.[0] ?? "frame";
        node.data.resolution = model.resolutions[0] ?? node.data.resolution;
        node.data.duration = model.durations[0] ?? node.data.duration;
        node.data.aspectRatio = videoReferenceAspectRatios(model, reference ? 1 : 0, node.data.referenceMode)[0] ?? node.data.aspectRatio;
      }
      const project = await createProject({ type: "asset-canvas" });
      projectId = project.id;
      const workspace = await getCanvasWorkspace(projectId);
      const board = await getCanvasBoard(projectId, workspace.boards[0]!.id);
      if (reference) {
        const contentType = reference.type;
        if (contentType !== "image/png" && contentType !== "image/jpeg" && contentType !== "image/webp") throw new Error(t("mediaCreation.badReference"));
        const asset = await uploadLibraryAsset(reference, contentType, undefined, "reference");
        const attachment: AssetCanvasReference = { type: "library", assetId: asset.id };
        if (node.type === "image") node.data.images = [attachment];
        else node.data.references = [attachment];
      }
      await saveCanvasBoard(projectId, { board: { ...document, id: board.board.id }, revision: board.revision });
      saved = { projectId, nodeId };
      if (autoRun) await generateCanvasMedia(projectId, board.board.id, nodeId);
      onOpen(projectId, nodeId);
    } catch (cause) {
      if (saved) setDraft(saved);
      else if (projectId) await deleteProject(projectId).catch(() => undefined);
      setError(message(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return <main className="home-shell must-studio-shell">
    <AppSidebar active={page} pagesPreview={pagesPreview} onNavigate={(target) => { if (!saving.current) onNavigate(target); }} />
    <section className="home-content home-content-fitted">
      <WindowDragRegion />
      <div className="home-start">
        <header className="must-studio-intro">
          <div>
            <p className="must-studio-eyebrow">{t("jointStudio.partners")}</p>
            <h1>{t(mode === "image" ? "mediaCreation.image" : "mediaCreation.video")}</h1>
            <p className="must-studio-description">{t(mode === "image" ? "mediaCreation.imageHint" : "mediaCreation.videoHint")}</p>
          </div>
          <div className="must-studio-symbol must-media-brand"><img src={muyuMark} alt="目鱼 AI" width={80} height={80} /></div>
        </header>
        <form className="must-media-composer" aria-busy={busy} inert={busy} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <textarea aria-label={t("mediaCreation.prompt")} maxLength={4000} value={prompt} onChange={(event) => setPrompt(event.target.value)}
            placeholder={t(mode === "image" ? "mediaCreation.imagePrompt" : "mediaCreation.videoPrompt")} />
          {reference ? <div className="must-media-reference"><span>{reference.name}</span><button type="button" aria-label={t("mediaCreation.removeReference")} onClick={() => setReference(undefined)}>×</button></div> : null}
          <div className="must-media-toolbar">
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
                setError(t("mediaCreation.badReference"));
                return;
              }
              setError(undefined);
              setReference(file);
            }} />
            <button className="must-media-add" type="button" aria-label={t("mediaCreation.addReference")} disabled={!acceptsReference} onClick={() => fileInput.current?.click()}><Plus size={16} /></button>
            <select aria-label={t("mediaCreation.mode")} value={page} onChange={(event) => {
              const target = event.target.value;
              if (target === "home" || target === "image-generation" || target === "video-generation") onNavigate(target);
            }}>
              <option value="home">{t("mediaCreation.game")}</option>
              <option value="image-generation">{t("mediaCreation.image")}</option>
              <option value="video-generation">{t("mediaCreation.video")}</option>
            </select>
            <label className="must-media-switch">{t("mediaCreation.autoRun")} <input type="checkbox" role="switch" checked={autoRun} disabled={pagesPreview} onChange={(event) => setAutoRun(event.target.checked)} /></label>
            <select aria-label={t("mediaCreation.autoModel")} value={modelKey} disabled={pagesPreview} onChange={(event) => setModelKey(event.target.value)}>
              <option value="">{t("mediaCreation.autoModel")}</option>
              {models.map((item) => <option key={key(item)} value={key(item)}>{item.providerName} · {item.name}</option>)}
            </select>
            <button className="must-media-send" type="submit" disabled={!canSubmit} aria-label={t(autoRun ? "mediaCreation.generate" : "mediaCreation.draft")} title={t(autoRun ? "mediaCreation.generate" : "mediaCreation.draft")}><SendArrow size={17} /></button>
          </div>
        </form>
        {draftStatus ? <p role="status">{draftStatus}</p> : null}
        {pagesPreview ? <><PagesExport mode={mode} value={prompt} /><PagesNotice /></> : null}
        {busy ? <p role="status">{t("mediaCreation.saving")}</p> : null}
        {catalog && !models.length ? <p className="must-media-notice">{t("mediaCreation.noModel")} <button type="button" disabled={busy} onClick={() => onNavigate("settings")}>{t("mediaCreation.manage")}</button></p> : null}
        {reference && !acceptsReference ? <p role="alert">{t("mediaCreation.noReference")}</p> : null}
        {error ? <p role="alert">{error} {draft ? <button type="button" onClick={() => onOpen(draft.projectId, draft.nodeId)}>{t("mediaCreation.openDraft")}</button> : null}</p> : null}
      </div>
    </section>
  </main>;
}

function key(model: Model): string {
  return JSON.stringify([model.provider, model.id]);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
