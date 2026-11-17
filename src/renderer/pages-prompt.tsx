import { useEffect, useState } from "react";
import type { ProjectType } from "../shared/contracts.js";
import { GAME_PROJECT_TYPES } from "./project-types.js";
import { downloadAssetBlob } from "./library-assets.js";
import { PromptBox } from "./prompt-box.js";
import { t } from "./i18n.js";

export function readPagesDraft(mode: "game" | "image" | "video"): string {
  try { return localStorage.getItem("must-pages:draft:" + mode) ?? ""; } catch { return ""; }
}
export function savePagesDraft(mode: "game" | "image" | "video", text: string): string {
  try {
    localStorage.setItem("must-pages:draft:" + mode, text);
    return t("pagesPreview.saved");
  } catch { return t("pagesPreview.failed"); }
}
export function PagesExport({ mode, value }: { mode: "game" | "image" | "video"; value: string }) {
  return <button className="home-project-type-trigger" type="button" disabled={!value.trim()} onClick={() => {
    downloadAssetBlob(new Blob([value], { type: "text/plain" }), "must-studio-" + mode + ".txt");
  }}>{t("pagesPreview.export")}</button>;
}
export function PagesPrompt({ preset, projectType, onProjectTypeChange, placeholder = t("jointStudio.placeholder") }: {
  preset?: { text: string }; projectType: ProjectType; onProjectTypeChange?: (value: ProjectType) => void; placeholder?: string;
}) {
  const [prompt, setPrompt] = useState(() => readPagesDraft("game"));
  const [status, setStatus] = useState("");
  useEffect(() => { if (preset) { setPrompt(preset.text); setStatus(""); } }, [preset]);
  return <>
    <PromptBox value={prompt} onChange={value => { setPrompt(value); setStatus(""); }} variant="home"
      placeholder={placeholder}
      onSubmit={() => { if (prompt.trim()) setStatus(savePagesDraft("game", prompt)); }}
      leading={onProjectTypeChange ? <select className="home-project-type-trigger" aria-label={t("creator.projectType")} value={projectType}
        onChange={event => {
          const option = GAME_PROJECT_TYPES.find(item => item.value === event.target.value);
          if (option) onProjectTypeChange(option.value);
        }}>
        {GAME_PROJECT_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select> : undefined}
      actions={<><PagesExport mode="game" value={prompt} /><button type="submit" className="home-project-type-trigger" disabled={!prompt.trim()}>{t("pagesPreview.draft")}</button></>}
    />
    {status ? <p role="status">{status}</p> : null}
  </>;
}
export function PagesNotice() {
  return <p className="must-pages-notice">{t("pagesPreview.notice")}{" "}
    <a href="https://github.com/DNSPre/ohmygame/tree/codex/must-game-design-studio">{t("pagesPreview.fullSource")} ↗</a>
  </p>;
}
