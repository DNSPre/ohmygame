import type { stepGame, LightGame, GameState, GameAction } from "./light-game.js";

export function runLightGame(spec: LightGame, step: typeof stepGame, labels: Labels) {
  let state: GameState = { collected: 0, moves: 0, phase: "playing" };
  const get = (id: string) => document.getElementById(id)!;
  get("title").textContent = spec.title;
  get("objective").textContent = spec.objective;
  get("exit").textContent = labels.exit;
  get("restart").textContent = labels.restart;
  const clueButtons = spec.clues.map((clue, index) => {
    const button = document.createElement("button");
    button.textContent = clue.label;
    button.addEventListener("click", () => act(index));
    get("clues").append(button);
    return button;
  });
  get("exit").addEventListener("click", () => act("exit"));
  get("restart").addEventListener("click", () => act("restart"));
  function act(action: GameAction) {
    const wasPlaying = state.phase === "playing";
    state = step(spec, state, action);
    if (wasPlaying && state.phase === "won" && parent !== window) parent.postMessage("must-light-game:won", "*");
    render();
  }
  function render() {
    const count = spec.clues.filter((_, i) => state.collected & (1 << i)).length;
    get("stats").textContent = labels.clues + " " + count + "/" + spec.threshold + " · " + labels.moves + " " + (spec.moves - state.moves);
    get("outcome").textContent = state.phase === "won" ? spec.ending : state.phase === "lost" ? labels.loss : "";
    (get("exit") as HTMLButtonElement).disabled = state.phase !== "playing" || count < spec.threshold;
    clueButtons.forEach((button, i) => {
      const prior = spec.clues[i]!.after;
      const done = Boolean(state.collected & (1 << i));
      button.disabled = state.phase !== "playing" || done || (prior !== null && !(state.collected & (1 << prior)));
      button.textContent = spec.clues[i]!.label + (done ? " ✓" : "");
    });
  }
  render();
}

type Labels = { exit: string; restart: string; clues: string; moves: string; loss: string };
export function gameLabels(language: "zh" | "en"): Labels {
  return language === "zh"
    ? { exit: "前往出口", restart: "重新开始", clues: "已收集", moves: "剩余行动", loss: "行动次数已用完，请重新开始。" }
    : { exit: "Go to exit", restart: "Restart", clues: "Collected", moves: "Moves remaining", loss: "No moves left. Try again." };
}

export function gameDocument(spec: LightGame, language: "zh" | "en", runtime: string): string {
  const safe = JSON.stringify({ spec, language }).replace(/</g, "\\u003c");
  if (/<\/script/i.test(runtime)) throw new Error("The offline bundle contains an invalid script terminator.");
  return gameShell(language, '<script id="game-config" type="application/json">' + safe + '</script><script>' + runtime + '</script>');
}

export function gameShell(language: "zh" | "en", script: string, hosted = false): string {
  return `<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${hosted ? "'self'" : "'unsafe-inline'"}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Game Prototype</title><style>
*{box-sizing:border-box} body{margin:0;background:#101e39;color:#eaf2ff;font:16px system-ui;padding:clamp(20px,5vw,64px)} main{max-width:650px;margin:auto} h1{font-size:clamp(26px,6vw,48px);margin:.2em 0}
#stats{letter-spacing:.08em;color:#b6dcff} #clues{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:24px 0}
button{font:inherit;background:#eaf2ff;color:#101e39;min-height:44px;border:0;border-radius:11px;padding:10px 16px;cursor:pointer} button:disabled{opacity:.46;cursor:default}
#exit{background:#ffe081} #restart{margin-inline-start:8px;background:#d6dcff} #outcome{min-height:1.5em;color:#ffe081}
</style><body><main><p id="stats" aria-live="polite"></p><h1 id="title"></h1><p id="objective"></p><div id="clues"></div><button id="exit" type="button"></button><button id="restart" type="button"></button><p id="outcome" role="status"></p></main>
${script}</body></html>`;
}
