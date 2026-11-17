import { Gamepad2, Sparkles, WandSparkles } from "./icons.js";
import mark from "./assets/must-emblem.png";
import { t } from "./i18n.js";

const expert = "Help me scope a game concept before writing code. Ask about the audience, intended play time and the main mechanic. Then propose a core loop, controls, win condition, and first playable milestone.";

export function JointStudioHero() {
  return <header className="must-studio-intro">
    <div>
      <p className="must-studio-eyebrow">{t("jointStudio.partners")}</p>
      <h1>{t("jointStudio.title")}</h1>
      <p className="must-studio-description">{t("jointStudio.description")}</p>
    </div>
    <div className="must-studio-symbol" aria-hidden="true"><img src={mark} alt="" /></div>
  </header>;
}

export function JointStudioActions({ onGames, onPrototype, onPreset }: {
  onGames: () => void;
  onPrototype: () => void;
  onPreset: (text: string) => void;
}) {
  return <div className="must-studio-actions">
    <button type="button" onClick={() => onPreset(expert)}><Sparkles size={15} />{t("jointStudio.expert")}</button>
    <button type="button" onClick={onPrototype}><WandSparkles size={15} />{t("jointStudio.generate")}</button>
    <button type="button" onClick={onGames}><Gamepad2 size={15} />{t("jointStudio.games")}</button>
    <a href="https://66.99.com/" target="_blank" rel="noopener noreferrer">{t("jointStudio.visit")}</a>
  </div>;
}
