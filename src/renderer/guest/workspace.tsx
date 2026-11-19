import { useEffect, useRef, useState } from "react";
import { AppSidebar } from "../app-sidebar.js";
import { PagesAuthProvider } from "../auth.js";
import { JointStudioHero } from "../joint-studio.js";
import { t } from "../i18n.js";
import { downloadAssetBlob } from "../library-assets.js";
import { parseAppRoute, sidebarHash, type AppNavigationTarget } from "../routes.js";
import { extractGame, fetchModels, gameSystemPrompt, generateText, persistSettings, previewHtml, readSettings, type GuestSettings } from "./models.js";
import { importProject, readProjects, saveProject, type GuestProject } from "./storage.js";
import { generateImage, generateVideo } from "./media.js";
import { sampleGame } from "./sample.js";
import "./workspace.css";

function navigate(target: AppNavigationTarget) {
  location.hash = target === "settings" ? "#/settings/providers" : sidebarHash(target);
}
function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return t("guestStudio.cancelled");
  if (error instanceof DOMException && error.name === "TimeoutError") return t("guestStudio.timeout");
  return error instanceof Error ? error.message : t("guestStudio.invalidResult");
}

export function GuestWorkspace() {
  const [route, setRoute] = useState(() => parseAppRoute(location.hash));
  const [settings, setSettings] = useState(readSettings);
  // Each tab holds its own credential. Never persist it or include it in a project export.
  const [apiKey, setApiKey] = useState("");
  const [projects, setProjects] = useState<GuestProject[]>([]);
  const [current, setCurrent] = useState<GuestProject>();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState("");
  const pending = useRef<AbortController | undefined>(undefined);
  const importInput = useRef<HTMLInputElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const read = () => { setRoute(parseAppRoute(location.hash)); setStatus(""); };
    window.addEventListener("hashchange", read);
    void readProjects().then(setProjects).catch(error => setStatus(errorMessage(error)));
    const refresh = () => { void readProjects().then(setProjects).catch(error => setStatus(errorMessage(error))); };
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("hashchange", read); window.removeEventListener("focus", refresh); pending.current?.abort(); };
  }, []);

  const page = route.page;
  const mediaMode = page === "image-generation" ? "image" : page === "video-generation" ? "video" : undefined;
  const listing = page === "projects" || page === "library" || page === "asset-canvas";
  const planning = page === "plugins";
  const settingsPage = page === "settings";

  function open(project: GuestProject) {
    setCurrent(project);
    setPrompt("");
    location.hash = project.kind === "image" ? "#/image-generation" : project.kind === "video" ? "#/video-generation" : project.kind === "brief" ? "#/plugins" : "#/";
  }
  async function store(project: GuestProject) {
    setCurrent(project);
    await saveProject(project);
    setProjects(await readProjects());
  }
  function sample() {
    const project: GuestProject = { id: crypto.randomUUID(), kind: "game", name: t("guestStudio.sampleTitle"), prompt: "", content: sampleGame, updatedAt: Date.now() };
    open(project);
    void store(project).catch(error => setStatus(errorMessage(error)));
  }

  async function generate(resumeId?: string) {
    if (pending.current || (!prompt.trim() && !resumeId)) return;
    if ((!mediaMode && !settings.model.trim()) || (mediaMode && (settings.protocol !== "openai" || !(mediaMode === "image" ? settings.imageModel : settings.videoModel).trim()))) {
      setStatus(t(mediaMode ? "guestStudio.needMedia" : "guestStudio.needModel"));
      navigate("settings");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setStatus(t("guestStudio.generating"));
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(mediaMode === "video" ? 900000 : 300000)]);
    const kind = mediaMode ?? (planning ? "brief" : "game");
    try {
      let content = "";
      let media: Blob | undefined;
      if (mediaMode === "image") media = await generateImage(settings, apiKey, prompt, signal);
      else if (mediaMode === "video") {
        media = await generateVideo(settings, apiKey, prompt, signal, id => {
          setJobId(id);
          setStatus(t("guestStudio.videoWait", { id }));
        }, resumeId);
      } else {
        const messages = [{ role: "system", content: planning ? "You are a game design expert. Ask concise clarifying questions when necessary. Propose the core loop, controls, progression, win condition and first playable milestone. Use the user's language. Return plain text." : gameSystemPrompt }];
        if (current?.kind === kind && current.content) messages.push({ role: "assistant", content: current.content });
        messages.push({ role: "user", content: (page === "interactive-story" ? "Create a branching interactive story with several endings. " : "") + prompt });
        content = await generateText(settings, apiKey, messages, signal);
        if (!planning) content = extractGame(content);
      }
      signal.throwIfAborted();
      const project: GuestProject = {
        id: current?.kind === kind && !mediaMode ? current.id : crypto.randomUUID(),
        kind, name: (current?.kind === kind && !mediaMode ? current.name : prompt.slice(0, 60)) || t("guestStudio.video"),
        prompt, content, media, updatedAt: Date.now(),
      };
      await store(project);
      setStatus(t("guestStudio.done"));
      if (mediaMode === "video") setJobId("");
    } catch (error) { setStatus(errorMessage(error)); }
    finally { pending.current = undefined; setBusy(false); }
  }

  const visible = projects.filter(project => page === "library" || page === "asset-canvas" ? Boolean(project.media) : true);
  const active = page === "project" || page === "settings" || page === "game" || page === "playtest" || page === "thumbnail" || page === "plugin-builder" || page === "community-profile" ? "home" : page;

  return <PagesAuthProvider><main className="home-shell must-studio-shell guest-workspace">
    <AppSidebar active={active} pagesPreview onNavigate={navigate} />
    <section className="home-content guest-content">
      <div className="guest-topbar"><span>{t("guestStudio.workspace")}</span><button type="button" onClick={() => navigate("settings")}>{t("guestStudio.settings")}</button></div>
      <p className="guest-privacy">{t("guestStudio.privacy")}</p>
      {settingsPage ? <GuestModelSettings settings={settings} apiKey={apiKey} onSave={(next, key) => { setSettings(next); setApiKey(key); }} /> : <>
        {listing ? <>
          <h1>{t(page === "projects" ? "guestStudio.projects" : page === "asset-canvas" ? "guestStudio.canvas" : "guestStudio.library")}</h1>
          <div className="guest-toolbar">
            <button onClick={() => importInput.current?.click()}>{t("guestStudio.import")}</button>
            <button onClick={() => assetInput.current?.click()}>{t("guestStudio.importAsset")}</button>
          </div>
          {visible.length === 0 && <p>{t("guestStudio.empty")}</p>}
          <div className="guest-projects">{visible.map(project => <button className="guest-project" key={project.id} onClick={() => open(project)}>
            <span className="guest-project-kind">{project.kind === "game" ? "◈" : project.kind === "brief" ? "✧" : "▧"}</span>
            <strong>{project.name}</strong><span>{new Date(project.updatedAt).toLocaleString()}</span>
          </button>)}</div>
        </> : <>
          {page === "home" ? <JointStudioHero /> : <header className="guest-heading"><h1>{t(mediaMode === "image" ? "mediaCreation.image" : mediaMode === "video" ? "mediaCreation.video" : planning ? "guestStudio.skills" : page === "community" ? "guestStudio.community" : page === "interactive-story" ? "guestStudio.story" : "jointStudio.games")}</h1>
            <p>{t(mediaMode ? "guestStudio.mediaProtocol" : planning ? "guestStudio.skillsHint" : page === "community" ? "guestStudio.communityHint" : page === "godot" ? "guestStudio.godotHint" : "guestStudio.gameHint")}</p></header>}
          <form className="guest-composer" onSubmit={event => { event.preventDefault(); void generate(); }}>
            <label className="sr-only" htmlFor="guest-prompt">{t("guestStudio.idea")}</label>
            <textarea id="guest-prompt" value={prompt} disabled={busy} maxLength={8000} onChange={event => setPrompt(event.target.value)} placeholder={t(mediaMode ? "guestStudio.mediaPlaceholder" : "guestStudio.placeholder")} />
            <div className="guest-toolbar">
              <button type="button" onClick={() => navigate("settings")}>{(mediaMode === "image" ? settings.imageModel : mediaMode === "video" ? settings.videoModel : settings.model) || t("guestStudio.configure")} ⚙</button>
              {busy ? <button type="button" onClick={() => pending.current?.abort()}>{t("guestStudio.cancel")}</button> : <button className="guest-primary" type="submit" disabled={!prompt.trim()}>{t(mediaMode === "image" ? "guestStudio.image" : mediaMode === "video" ? "guestStudio.video" : planning ? "guestStudio.brief" : "guestStudio.generate")}</button>}
            </div>
          </form>
          {!mediaMode && <div className="guest-toolbar"><button onClick={sample}>{t("guestStudio.sample")}</button><button onClick={() => { setCurrent(undefined); setPrompt(""); }}>{t("guestStudio.newProject")}</button><button onClick={() => importInput.current?.click()}>{t("guestStudio.import")}</button></div>}
          {mediaMode === "video" && <div className="guest-video-job"><label>{t("guestStudio.videoJob")}<input value={jobId} onChange={event => setJobId(event.target.value)} disabled={busy} /></label><button disabled={!jobId.trim() || busy} onClick={() => void generate(jobId.trim())}>{t("guestStudio.videoResume")}</button></div>}
          {current && current.kind === (mediaMode ?? (planning ? "brief" : "game")) && <ProjectPreview project={current} onSave={project => { void store(project).then(() => setStatus(t("guestStudio.draftSaved"))).catch(error => setStatus(errorMessage(error))); }} />}
        </>}
      </>}
      {status && <p className="guest-status" role="status">{status}</p>}
      <input type="file" accept="application/json,.json" ref={importInput} hidden onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        try { if (file.size > 20_000_000) throw new Error(t("guestStudio.importError")); const project = importProject(JSON.parse(await file.text())); await store(project); open(project); }
        catch (error) { setStatus(errorMessage(error)); }
      }} />
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" ref={assetInput} hidden onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        try {
          if (file.size > 20_000_000 || !["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm"].includes(file.type)) throw new Error(t("guestStudio.assetError"));
          const project: GuestProject = { id: crypto.randomUUID(), name: file.name, kind: file.type.startsWith("image/") ? "image" : "video", content: "", prompt: "", media: file, updatedAt: Date.now() };
          await store(project); open(project);
        } catch (error) { setStatus(errorMessage(error)); }
      }} />
    </section>
  </main></PagesAuthProvider>;
}

function GuestModelSettings({ settings, apiKey, onSave }: { settings: GuestSettings; apiKey: string; onSave: (settings: GuestSettings, key: string) => void }) {
  const [draft, setDraft] = useState(settings);
  const [draftKey, setDraftKey] = useState(apiKey);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const change = (field: keyof GuestSettings, value: string) => setDraft(current => ({ ...current, [field]: value }));
  return <section className="guest-settings"><h1>{t("guestStudio.settings")}</h1>
    <form onSubmit={event => { event.preventDefault(); try { const clean = persistSettings(draft); onSave(clean, draftKey); setDraft(clean); setStatus(t("guestStudio.saved")); } catch (error) { setStatus(errorMessage(error)); } }}>
      <label>{t("guestStudio.protocol")}<select value={draft.protocol} onChange={event => {
        const protocol = event.target.value as GuestSettings["protocol"];
        setDraftKey(""); setModels([]); setStatus(""); setDraft(current => ({ ...current, protocol, model: "", baseUrl: protocol === "ollama" ? "http://127.0.0.1:11434" : "https://api.openai.com/v1" }));
      }}><option value="ollama">{t("guestStudio.local")}</option><option value="openai">{t("guestStudio.cloud")}</option></select></label>
      <label>{t("guestStudio.baseUrl")}<input type="url" required value={draft.baseUrl} onChange={event => { setDraftKey(""); setModels([]); change("baseUrl", event.target.value); }} /></label>
      <label>{t("guestStudio.key")}<input type="password" autoComplete="off" value={draftKey} onChange={event => setDraftKey(event.target.value)} /></label>
      <div className="guest-toolbar"><button type="button" disabled={loading} onClick={async () => {
        setLoading(true); setStatus(""); try { const result = await fetchModels(draft, draftKey); setModels(result); if (!draft.model && result[0]) change("model", result[0]); setStatus(t(result.length ? "guestStudio.connected" : "guestStudio.noModels")); } catch (error) { setStatus(errorMessage(error)); } finally { setLoading(false); }
      }}>{t(loading ? "guestStudio.generating" : "guestStudio.loadModels")}</button></div>
      <datalist id="guest-model-options">{models.map(model => <option key={model} value={model} />)}</datalist>
      <label>{t("guestStudio.textModel")}<input list="guest-model-options" value={draft.model} onChange={event => change("model", event.target.value)} /></label>
      {draft.protocol === "openai" && <><label>{t("guestStudio.imageModel")}<input value={draft.imageModel} onChange={event => change("imageModel", event.target.value)} /></label><label>{t("guestStudio.videoModel")}<input value={draft.videoModel} onChange={event => change("videoModel", event.target.value)} /></label></>}
      <p>{t("guestStudio.modelHelp")}</p>
      <button type="submit" className="guest-primary">{t("guestStudio.save")}</button>
      {status && <p role="status">{status}</p>}
    </form>
    {draft.protocol === "ollama" && <details><summary>{t("guestStudio.localHelp")}</summary><pre>OLLAMA_HOST=127.0.0.1:11434 OLLAMA_ORIGINS=https://game.design.cab ollama serve</pre><p>Windows PowerShell</p><pre>{'$env:OLLAMA_ORIGINS="https://game.design.cab"\nollama serve'}</pre></details>}
  </section>;
}

function ProjectPreview({ project, onSave }: { project: GuestProject; onSave: (project: GuestProject) => void }) {
  const [code, setCode] = useState(false);
  const [source, setSource] = useState(project.content);
  const [preview, setPreview] = useState(0);
  const [mediaUrl, setMediaUrl] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => { setSource(project.content); setCode(false); }, [project.id, project.content]);
  useEffect(() => {
    if (!project.media) { setMediaUrl(""); return; }
    const url = URL.createObjectURL(project.media); setMediaUrl(url); return () => URL.revokeObjectURL(url);
  }, [project.media]);
  const updatePreview = () => frame.current?.contentWindow?.postMessage({ html: previewHtml(project.content) }, "*");
  useEffect(updatePreview, [project.content]);
  return <section className="guest-preview"><header><h2>{project.name}</h2><div className="guest-toolbar">
    {project.kind === "game" && <><button onClick={() => setCode(value => !value)}>{t(code ? "guestStudio.play" : "guestStudio.code")}</button><button onClick={() => setPreview(value => value + 1)}>{t("guestStudio.restart")}</button></>}
    <button onClick={() => {
      if (project.media) downloadAssetBlob(project.media, project.name.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 60) + (project.kind === "image" ? ".png" : ".mp4"));
      else downloadAssetBlob(new Blob([project.content], { type: project.kind === "game" ? "text/html" : "text/plain" }), "game." + (project.kind === "game" ? "html" : "txt"));
    }}>{t("guestStudio.download")}</button>
    {!project.media && <button onClick={() => downloadAssetBlob(new Blob([JSON.stringify({ ...project, media: undefined })], { type: "application/json" }), "workspace-project.json")}>{t("guestStudio.export")}</button>}
  </div></header>
    {project.kind === "game" ? code ? <><textarea className="guest-source" aria-label={t("guestStudio.code")} value={source} onChange={event => setSource(event.target.value)} /><button onClick={() => onSave({ ...project, content: source, updatedAt: Date.now() })}>{t("guestStudio.saveChanges")}</button></> : <iframe key={project.id + preview} ref={frame} title={t("guestStudio.previewTitle")} sandbox="allow-scripts" src="/guest-player.html" onLoad={updatePreview} />
      : project.kind === "brief" ? <pre className="guest-brief">{project.content}</pre>
      : project.kind === "image" ? <img src={mediaUrl} alt={project.prompt || project.name} /> : <video src={mediaUrl} controls />}
  </section>;
}
