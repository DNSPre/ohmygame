import { useEffect, useRef, useState } from "react";
import { DEMO, lightGameDiff, TEMPLATE_VERSION, validateLightGame, type LightGame } from "../shared/light-game.js";
import playerRuntime from "virtual:must-light-game-runtime";
import { gameDocument } from "../shared/light-game-template.js";
import { request } from "./api.js";
import { AppSidebar } from "./app-sidebar.js";
import { t } from "./i18n.js";
import type { AppNavigationTarget } from "./routes.js";
import { WindowDragRegion } from "./window-drag-region.js";
import "./light-game-studio.css";

type Version = { id: string; at: string; spec: LightGame; change: string; fields: (keyof LightGame)[]; steps: number; played?: string; model?: string };
const storage = "must-light-game-versions-v1";
const ruleFields = ["title", "objective", "clues", "threshold", "moves", "ending"] as const;
function loadVersions(): Version[] {
  try {
    const list = JSON.parse(localStorage.getItem(storage) ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.slice(0, 30).flatMap((entry) => {
      try {
        if (!entry || typeof entry.id !== "string" || typeof entry.at !== "string" || typeof entry.change !== "string") return [];
        const { spec, path } = validateLightGame(entry.spec);
        return [{ id: entry.id, at: entry.at, spec, change: entry.change, fields: ruleFields.filter(k => Array.isArray(entry.fields) && entry.fields.includes(k)), steps: path.length, played: typeof entry.played === "string" ? entry.played : undefined, model: typeof entry.model === "string" ? entry.model : undefined }];
      } catch { return []; }
    });
  } catch { return []; }
}
function saveFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LightGameStudio({ onNavigate }: { onNavigate: (page: AppNavigationTarget) => void }) {
  const [versions, setVersions] = useState(loadVersions);
  const [activeId, setActiveId] = useState<string | undefined>(() => {
    try { return localStorage.getItem(storage + ":selected") ?? undefined; } catch { return undefined; }
  });
  const [draft, setDraft] = useState<LightGame>(() => (versions.find(v => v.id === activeId) ?? versions[0])?.spec ?? DEMO);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [model, setModel] = useState<string | undefined>(() => (versions.find(v => v.id === activeId) ?? versions[0])?.model);
  const [revision, setRevision] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const active = versions.find(v => v.id === activeId) ?? versions[0];
  const diff = active ? lightGameDiff(active.spec, draft) : ruleFields;
  const lang = t("lightGame.lang") === "zh" ? "zh" : "en";
  const playHtml = active ? gameDocument(active.spec, lang, playerRuntime) : undefined;

  useEffect(() => {
    try {
      localStorage.setItem(storage, JSON.stringify(versions));
      if (activeId) localStorage.setItem(storage + ":selected", activeId);
      setStorageError(false);
    }
    catch { setStorageError(true); }
  }, [versions, activeId]);

  useEffect(() => {
    if (!active) return;
    const id = active.id;
    function record(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null" || event.data !== "must-light-game:won") return;
      setVersions(items => items.map(item => item.id === id && !item.played ? { ...item, played: new Date().toISOString() } : item));
    }
    window.addEventListener("message", record);
    return () => window.removeEventListener("message", record);
  }, [active?.id]);

  function edit(next: LightGame) { setDraft(next); setError(""); setNotice(""); }
  function choose(version: Version) {
    setActiveId(version.id); edit(version.spec); setModel(version.model); setRevision(false);
  }
  function loadDemo() {
    edit(DEMO); setBrief(""); setModel(undefined); setRevision(false);
  }
  async function propose() {
    if (!brief.trim() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request<{ spec: LightGame; model: { provider: string; id: string } }>("/light-game/specification", {
        method: "POST", body: JSON.stringify({ brief: brief.trim(), ...(revision && active ? { previous: active.spec } : {}) }),
      });
      edit(validateLightGame(result.spec).spec);
      setModel(result.model.provider + "/" + result.model.id);
      setNotice(t("lightGame.suggested"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  function publishDraft() {
    setError(""); setNotice("");
    try {
      const { spec, path } = validateLightGame(draft);
      const fields = active ? lightGameDiff(active.spec, spec) : [...ruleFields];
      if (!fields.length) { setNotice(t("lightGame.unchanged")); return; }
      const next = { id: crypto.randomUUID(), spec, at: new Date().toISOString(), change: brief.trim().slice(0, 4000), fields, steps: path.length, model };
      setVersions(items => [next, ...items].slice(0, 30));
      setActiveId(next.id); setDraft(spec);
      setNotice(t("lightGame.passed", { count: path.length }));
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "invalid";
      switch (code) {
        case "text": setError(t("lightGame.errorText")); break;
        case "threshold": setError(t("lightGame.errorThreshold")); break;
        case "moves": setError(t("lightGame.errorMoves")); break;
        case "prerequisite": case "cycle": setError(t("lightGame.errorPrerequisite")); break;
        case "unreachable": setError(t("lightGame.errorUnreachable")); break;
        case "duplicate": setError(t("lightGame.errorDuplicate")); break;
        default: setError(t("lightGame.errorInvalid"));
      }
    }
  }
  function exportEvidence() {
    if (!active) return;
    const { path } = validateLightGame(active.spec);
    saveFile("game-evidence.json", JSON.stringify({
      templateVersion: TEMPLATE_VERSION, selectedVersion: active.id, versions,
      winningPath: path, assets: [], checks: { validConfiguration: true, reachableEnding: true, observedWin: Boolean(active.played) },
      launch: "Open game-prototype.html in a browser. Collect clues, go to the exit, and restart.",
    }, null, 2), "application/json");
  }
  const labels: Record<keyof LightGame, string> = {
    title: t("lightGame.fieldTitle"), objective: t("lightGame.objective"), ending: t("lightGame.ending"),
    clues: t("lightGame.clues"), threshold: t("lightGame.threshold"), moves: t("lightGame.moves"),
  };

  return <main className="home-shell must-studio-shell">
    <AppSidebar active="light-game" onNavigate={onNavigate} />
    <section className="home-content must-light-content">
      <WindowDragRegion />
      <header className="must-light-header">
        <p className="must-studio-eyebrow">{t("lightGame.brand")}</p>
        <h1>{t("lightGame.nav")}</h1>
        <p>{t("lightGame.intro")}</p>
      </header>
      <div className="must-light-grid">
        <div>
          <fieldset className="must-light-panel" disabled={busy}>
            <legend>{t("lightGame.concept")}</legend>
            <textarea aria-label={t("lightGame.concept")} rows={3} maxLength={4000} value={brief} onChange={e => setBrief(e.target.value)} placeholder={t("lightGame.placeholder")} />
            {active ? <label className="must-light-revision"><input type="checkbox" checked={revision} onChange={e => setRevision(e.target.checked)} />{t("lightGame.revise")}</label> : null}
            <div className="must-light-actions">
              <button type="button" disabled={!brief.trim()} onClick={() => void propose()}>{t("lightGame.propose")}</button>
              <button type="button" onClick={loadDemo}>{t("lightGame.loadDemo")}</button>
            </div>
          </fieldset>
          <fieldset className="must-light-panel" disabled={busy}>
            <legend>{t("lightGame.specification")}</legend>
            <label>{labels.title}<input maxLength={48} value={draft.title} onChange={e => edit({ ...draft, title: e.target.value })} /></label>
            <label>{labels.objective}<textarea rows={2} maxLength={240} value={draft.objective} onChange={e => edit({ ...draft, objective: e.target.value })} /></label>
            <div className="must-light-rule-pair">
              <label>{labels.threshold}<input type="number" min={1} max={draft.clues.length} value={Number.isNaN(draft.threshold) ? "" : draft.threshold} onChange={e => edit({ ...draft, threshold: e.target.valueAsNumber })} /></label>
              <label>{labels.moves}<input type="number" min={2} max={12} value={Number.isNaN(draft.moves) ? "" : draft.moves} onChange={e => edit({ ...draft, moves: e.target.valueAsNumber })} /></label>
            </div>
            <div className="must-light-clues">
              <strong>{labels.clues}</strong>
              {draft.clues.map((clue, i) => <div className="must-light-clue" key={i}>
                <input aria-label={labels.clues + " " + (i + 1)} value={clue.label} maxLength={40} onChange={e => edit({ ...draft, clues: draft.clues.map((c, n) => n === i ? { ...c, label: e.target.value } : c) })} />
                <select aria-label={t("lightGame.after") + " " + (i + 1)} value={clue.after ?? ""} onChange={e => edit({ ...draft, clues: draft.clues.map((c, n) => n === i ? { ...c, after: e.target.value ? Number(e.target.value) : null } : c) })}>
                  <option value="">{t("lightGame.noAfter")}</option>
                  {draft.clues.map((c, n) => n === i ? null : <option key={n} value={n}>{t("lightGame.after")} · {c.label || n + 1}</option>)}
                </select>
              </div>)}
              <div className="must-light-actions">
                <button type="button" disabled={draft.clues.length >= 8} onClick={() => edit({ ...draft, clues: [...draft.clues, { label: "", after: null }] })}>{t("lightGame.addClue")}</button>
                <button type="button" disabled={draft.clues.length <= 2} onClick={() => edit({ ...draft, clues: draft.clues.slice(0, -1).map(c => c.after === draft.clues.length - 1 ? { ...c, after: null } : c) })}>{t("lightGame.removeClue")}</button>
              </div>
            </div>
            <label>{labels.ending}<input maxLength={160} value={draft.ending} onChange={e => edit({ ...draft, ending: e.target.value })} /></label>
            {active && diff.length ? <p>{t("lightGame.changed", { fields: diff.map(k => labels[k]).join(" · ") })}</p> : null}
            <button className="must-light-primary" type="button" onClick={publishDraft}>{t("lightGame.confirm")}</button>
          </fieldset>
          {busy ? <p role="status">{t("lightGame.thinking")}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
          {error ? <p className="must-light-error" role="alert">{error}</p> : null}
          {storageError ? <p className="must-light-error" role="alert">{t("lightGame.storageError")}</p> : null}
        </div>
        <div>
          <section className="must-light-panel" aria-label={t("lightGame.preview")}>
            <h2>{t("lightGame.preview")}</h2>
            {active && playHtml ? <>
              <iframe key={active.id} ref={frame} title={t("lightGame.preview")} sandbox="allow-scripts" src={new URL("light-game-player.html", window.location.href.split("#")[0]).href + "#" + encodeURIComponent(JSON.stringify({ spec: active.spec, language: lang }))} />
              <p>{t("lightGame.passed", { count: active.steps })} {active.played ? t("lightGame.played") : ""}</p>
              <div className="must-light-actions">
                <button type="button" onClick={() => saveFile("game-prototype.html", playHtml, "text/html")}>{t("lightGame.exportGame")}</button>
                <button type="button" onClick={exportEvidence}>{t("lightGame.exportEvidence")}</button>
              </div>
            </> : <p>{t("lightGame.empty")}</p>}
          </section>
          <section className="must-light-panel" aria-label={t("lightGame.history")}>
            <h2>{t("lightGame.history")}</h2>
            {!versions.length ? <p>{t("lightGame.noHistory")}</p> : <ol className="must-light-history">{versions.map((v, i) => <li key={v.id}>
              <button type="button" aria-pressed={active?.id === v.id} onClick={() => choose(v)} disabled={busy}>{v.spec.title} · {new Date(v.at).toLocaleString()} · {versions.length - i}</button>
              <small>{v.fields.map(k => labels[k]).join(" · ")}{v.played ? " ✓" : ""}</small>
            </li>)}</ol>}
          </section>
        </div>
      </div>
    </section>
  </main>;
}
