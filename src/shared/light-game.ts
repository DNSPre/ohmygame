export interface Clue { label: string; after: number | null }
export interface LightGame {
  title: string;
  objective: string;
  clues: Clue[];
  threshold: number;
  moves: number;
  ending: string;
}
export interface GameState { collected: number; moves: number; phase: "playing" | "won" | "lost" }
export type GameAction = number | "exit" | "restart";
export const TEMPLATE_VERSION = 1;
export const DEMO: LightGame = {
  title: "澳门寻迹", objective: "在旧城区找到至少三条线索，然后前往议事亭交付调查结果。",
  clues: [{ label: "街角路牌", after: null }, { label: "老店地图", after: null }, { label: "石阶纹样", after: 0 }, { label: "广场钟声", after: 1 }],
  threshold: 3, moves: 5, ending: "线索齐全！你完成了旧城区调查。",
};

// Self-contained so the offline template and the rules validator run the same transitions.
export function stepGame(spec: LightGame, state: GameState, action: GameAction): GameState {
  if (action === "restart") return { collected: 0, moves: 0, phase: "playing" };
  if (state.phase !== "playing") return state;
  if (action === "exit") {
    let count = 0;
    for (let index = 0; index < spec.clues.length; index++) if (state.collected & (1 << index)) count++;
    return count >= spec.threshold ? { ...state, moves: state.moves + 1, phase: "won" } : state;
  }
  if (!Number.isInteger(action) || action < 0 || action >= spec.clues.length) return state;
  const bit = 1 << action;
  const after = spec.clues[action]!.after;
  if ((state.collected & bit) || (after !== null && !(state.collected & (1 << after)))) return state;
  const moves = state.moves + 1;
  return { collected: state.collected | bit, moves, phase: moves >= spec.moves ? "lost" : "playing" };
}

export function shortestWin(spec: LightGame): GameAction[] | undefined {
  const start: GameState = { collected: 0, moves: 0, phase: "playing" };
  const queue: { state: GameState; path: GameAction[] }[] = [{ state: start, path: [] }];
  const visited = new Set<number>([0]);
  for (let i = 0; i < queue.length; i++) {
    const { state, path } = queue[i]!;
    if (stepGame(spec, state, "exit").phase === "won") return [...path, "exit"];
    for (let j = 0; j < spec.clues.length; j++) {
      const next = stepGame(spec, state, j);
      if (next.phase !== "playing" || visited.has(next.collected)) continue;
      visited.add(next.collected);
      queue.push({ state: next, path: [...path, j] });
    }
  }
}

export function validateLightGame(input: unknown): { spec: LightGame; path: GameAction[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid");
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !["title", "objective", "clues", "threshold", "moves", "ending"].includes(key))) throw new Error("invalid");
  function str(v: unknown, max: number) {
    if (typeof v !== "string" || !v.trim() || v.trim().length > max) throw new Error("text");
    return v.trim();
  }
  function int(v: unknown, min: number, max: number, error: string) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new Error(error);
    return v;
  }
  if (!Array.isArray(raw.clues) || raw.clues.length < 2 || raw.clues.length > 8) throw new Error("clues");
  const clues: Clue[] = raw.clues.map((clue: unknown, index) => {
    if (!clue || typeof clue !== "object" || Array.isArray(clue) || Object.keys(clue).some((k) => k !== "label" && k !== "after")) throw new Error("invalid");
    const item = clue as Record<string, unknown>;
    const after = item.after === null ? null : int(item.after, 0, raw.clues instanceof Array ? raw.clues.length - 1 : 0, "prerequisite");
    if (after === index) throw new Error("prerequisite");
    return { label: str(item.label, 40), after };
  });
  if (new Set(clues.map((c) => c.label)).size !== clues.length) throw new Error("duplicate");
  for (let i = 0; i < clues.length; i++) {
    const seen = new Set<number>();
    for (let j: number | null = i; j !== null; j = clues[j]!.after) {
      if (seen.has(j)) throw new Error("cycle");
      seen.add(j);
    }
  }
  const spec = {
    title: str(raw.title, 48), objective: str(raw.objective, 240), ending: str(raw.ending, 160), clues,
    threshold: int(raw.threshold, 1, clues.length, "threshold"),
    moves: int(raw.moves, 2, 12, "moves"),
  };
  const path = shortestWin(spec);
  if (!path) throw new Error("unreachable");
  return { spec, path };
}

export function lightGameDiff(previous: LightGame, next: LightGame): (keyof LightGame)[] {
  return (["title", "objective", "clues", "threshold", "moves", "ending"] as const)
    .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
}

export function parseModelGame(text: string): LightGame {
  const json = text.trim().replace(/^\s*```(?:json)?\s*([\s\S]+?)\s*```\s*$/i, "$1");
  try { return validateLightGame(JSON.parse(json)).spec; }
  catch { throw new Error("The model did not return a valid, playable specification."); }
}
