// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseUrl, extractGame, generateText, persistSettings, previewHtml, readSettings, type GuestSettings } from "../src/renderer/guest/models.js";
import { importProject } from "../src/renderer/guest/storage.js";

const settings: GuestSettings = { protocol: "openai", baseUrl: "https://models.example/v1", model: "test-model", imageModel: "", videoModel: "" };
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("personal workspace boundaries", () => {
  it("persists model preferences without credentials", () => {
    persistSettings(settings);
    expect(readSettings()).toEqual(settings);
    expect(localStorage.getItem("must:personal-model-settings")).not.toContain("key");
  });
  it("rejects URLs that embed credentials or insecure remote services", () => {
    for (const url of ["http://remote.example/v1", "https://user:secret@models.example/v1", "https://models.example/?key=secret", "file:///tmp/test"]) {
      expect(() => baseUrl(url)).toThrow();
    }
    expect(baseUrl("http://127.0.0.1:11434/")).toBe("http://127.0.0.1:11434");
  });
  it("sends an API key only to the configured endpoint and omits cookies", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "result" } }] })));
    vi.stubGlobal("fetch", fetch);
    expect(await generateText(settings, "visitor-test-key", [{role:"user",content:"test"}], new AbortController().signal)).toBe("result");
    expect(fetch.mock.calls[0]?.[0]).toBe("https://models.example/v1/chat/completions");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit", redirect: "error", headers: { Authorization: "Bearer visitor-test-key" } });
    expect(localStorage.length).toBe(0);
  });
  it("blocks storage/network privileges in game previews", () => {
    const html = previewHtml('<script>fetch("https://example.com")</script>');
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script>"));
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("frame-src 'none'");
    expect(html).toContain("form-action 'none'");
  });
  it("imports a fresh project identity without accepting foreign properties", () => {
    const input = { id:"foreign",name:"shared",kind:"game",prompt:"test",content:"<html></html>",apiKey:"never-import",tenant:"foreign" };
    const result = importProject(input);
    expect(result.id).not.toBe(input.id);
    expect(result).not.toHaveProperty("apiKey");
    expect(result).not.toHaveProperty("tenant");
    expect(() => importProject({kind:"game",content:{}})).toThrow();
  });
  it("extracts HTML and rejects a prose-only model response", () => {
    expect(extractGame("```html\n<html></html>\n```")).toBe("<html></html>");
    expect(() => extractGame("Here are some ideas")).toThrow();
  });
});
