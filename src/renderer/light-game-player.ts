import { stepGame, validateLightGame } from "../shared/light-game.js";
import { gameLabels, runLightGame } from "../shared/light-game-template.js";

try {
  const embedded = document.getElementById("game-config")?.textContent;
  const payload = JSON.parse(embedded ?? decodeURIComponent(location.hash.slice(1)));
  const { spec } = validateLightGame(payload.spec);
  const lang = payload.language === "en" ? "en" : "zh";
  document.documentElement.lang = lang;
  runLightGame(spec, stepGame, gameLabels(lang));
} catch {
  const target = document.querySelector("#outcome");
  if (target) target.textContent = "Invalid game specification.";
}
