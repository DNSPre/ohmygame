import { build } from "esbuild";
import { Window } from "happy-dom";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { DEMO, lightGameDiff, parseModelGame, stepGame, validateLightGame, type GameState } from "../src/shared/light-game.js";
import { gameDocument } from "../src/shared/light-game-template.js";

const start: GameState = { collected: 0, moves: 0, phase: "playing" };

describe("the workshop clue template", () => {
  it("validates a normal demo and finds the shortest playable path", () => {
    const { spec, path } = validateLightGame(DEMO);
    expect(path).toHaveLength(4);
    expect(path.reduce((state, action) => stepGame(spec, state, action), start).phase).toBe("won");
  });
  it.each([
    [{ title: "" }, "text"],
    [{ objective: " " }, "text"],
    [{ ending: undefined }, "text"],
    [{ clues: [] }, "clues"],
    [{ threshold: 5 }, "threshold"],
    [{ threshold: 1.5 }, "threshold"],
    [{ moves: 13 }, "moves"],
    [{ moves: 3 }, "unreachable"],
    [{ clues: [{ label: "A", after: 9 }, { label: "B", after: null }] }, "prerequisite"],
    [{ clues: [{ label: "A", after: 1 }, { label: "B", after: 0 }] }, "cycle"],
    [{ clues: [{ label: "A", after: null }, { label: "A", after: null }] }, "duplicate"],
    [{ externalAsset: "https://example.invalid/a.png" }, "invalid"],
  ])("rejects invalid configuration %#", (change, reason) => {
    expect(() => validateLightGame({ ...DEMO, ...change })).toThrow(reason);
  });
  it("rejects premature exit, locked clues, invalid input and double-collection", () => {
    expect(stepGame(DEMO, start, "exit")).toBe(start);
    expect(stepGame(DEMO, start, 2)).toBe(start);
    expect(stepGame(DEMO, start, -1)).toBe(start);
    const collected = stepGame(DEMO, start, 0);
    expect(stepGame(DEMO, collected, 0)).toBe(collected);
    expect(stepGame(DEMO, collected, 2).moves).toBe(2);
  });
  it("loses at the move limit and resets both a loss and a win", () => {
    const spec = { ...DEMO, moves: 4 };
    const lost = [0, 1, 2, 3].reduce((state, clue) => stepGame(spec, state, clue), start);
    const won = [0, 1, 2, "exit" as const].reduce((state, action) => stepGame(spec, state, action), start);
    expect(lost.phase).toBe("lost");
    expect(won.phase).toBe("won");
    expect(stepGame(spec, lost, "exit")).toBe(lost);
    expect(stepGame(spec, lost, "restart")).toEqual(start);
    expect(stepGame(spec, won, "restart")).toEqual(start);
  });
  it("revises the threshold without changing prerequisites, budget or restart", () => {
    const revised = { ...DEMO, threshold: 2 };
    expect(lightGameDiff(DEMO, revised)).toEqual(["threshold"]);
    expect(stepGame(revised, start, 2)).toBe(start);
    const { path } = validateLightGame(revised);
    expect(path).toHaveLength(3);
    expect(stepGame(revised, path.reduce((state, action) => stepGame(revised, state, action), start), "restart")).toEqual(start);
    expect(DEMO.threshold).toBe(3);
  });
  it("strictly validates structured output from the model", () => {
    expect(parseModelGame("\x60\x60\x60json\n" + JSON.stringify(DEMO) + "\n\x60\x60\x60")).toEqual(DEMO);
    expect(() => parseModelGame('{"threshold":4}')).toThrow("valid, playable specification");
  });
  it("plays and restarts the exported offline game with safely encoded user text", async () => {
    const bundle = await build({ entryPoints: ["src/renderer/light-game-player.ts"], bundle: true, platform: "browser", format: "iife", write: false });
    const html = gameDocument({ ...DEMO, title: "</script><img src=x>" }, "en", bundle.outputFiles[0]!.text);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("<img src=x>");
    const window = new Window();
    try {
      const script = html.match(/<script>([\s\S]+)<\/script>/)![1]!;
      window.document.write(html.replace(/<script>[\s\S]+<\/script>/, ""));
      runInNewContext(script, { document: window.document, window, parent: window, location: window.location });
      const byId = (id: string) => window.document.getElementById(id)!;
      expect(byId("title").textContent).toBe("</script><img src=x>");
      const buttons = byId("clues").querySelectorAll("button");
      expect(buttons[2]!.disabled).toBe(true);
      expect((byId("exit") as typeof buttons[number]).disabled).toBe(true);
      buttons[0]!.click(); buttons[1]!.click(); buttons[2]!.click(); (byId("exit") as typeof buttons[number]).click();
      expect(byId("outcome").textContent).toBe(DEMO.ending);
      (byId("restart") as typeof buttons[number]).click();
      expect(byId("stats").textContent).toContain("0/3");
    } finally {
      await window.happyDOM.close();
    }
  });
});
