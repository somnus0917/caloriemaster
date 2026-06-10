// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  recognizeFood,
  parseAiContent,
  normalizeAiResult,
} from "../src/services/qwen";

const SAMPLE_IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("recognizeFood service", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls /api/recognize-food with only imageBase64 in the body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          content: '{"foods":[{"name":"白米饭","weight_g":150,"calories_per_100g":116,"confidence":"med"}]}',
        }),
      json: async () => ({
        content: '{"foods":[{"name":"白米饭","weight_g":150,"calories_per_100g":116,"confidence":"med"}]}',
      }),
    } as Response);
    const out = await recognizeFood({ imageBase64: SAMPLE_IMAGE });
    expect(out.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/recognize-food");
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(["imageBase64"]);
    expect(body.imageBase64).toBe(SAMPLE_IMAGE);
  });

  it("does NOT include 'messages', 'model', 'response_format', or 'temperature'", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          content: '{"foods":[{"name":"白米饭","weight_g":150,"calories_per_100g":116,"confidence":"med"}]}',
        }),
      json: async () => ({
        content: '{"foods":[{"name":"白米饭","weight_g":150,"calories_per_100g":116,"confidence":"med"}]}',
      }),
    } as Response);
    await recognizeFood({ imageBase64: SAMPLE_IMAGE });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toBeUndefined();
    expect(body.model).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it("returns no_food when the AI returns an empty foods array", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: '{"foods":[],"note":"not a meal"}' }),
      json: async () => ({ content: '{"foods":[],"note":"not a meal"}' }),
    } as Response);
    const out = await recognizeFood({ imageBase64: SAMPLE_IMAGE });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_food");
  });

  it("returns error when the server replies 5xx", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: { code: "QWEN_NOT_CONFIGURED", message: "no key" } }),
      json: async () => ({ error: { code: "QWEN_NOT_CONFIGURED", message: "no key" } }),
    } as Response);
    const out = await recognizeFood({ imageBase64: SAMPLE_IMAGE });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("error");
      expect(out.message).toMatch(/Qwen Key/);
    }
  });

  it("returns no_food when the server replies 400 with code NO_FOOD_DETECTED", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { code: "NO_FOOD_DETECTED", message: "no food" } }),
      json: async () => ({ error: { code: "NO_FOOD_DETECTED", message: "no food" } }),
    } as Response);
    const out = await recognizeFood({ imageBase64: SAMPLE_IMAGE });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("no_food");
  });
});

describe("parseAiContent", () => {
  it("parses plain JSON", () => {
    expect(parseAiContent('{"foo":1}')).toEqual({ foo: 1 });
  });
  it("strips a single ```json fence", () => {
    expect(parseAiContent('```json\n{"foo":1}\n```')).toEqual({ foo: 1 });
  });
  it("rejects invalid JSON", () => {
    expect(() => parseAiContent("not json")).toThrow();
  });
});

describe("normalizeAiResult", () => {
  it("rejects non-object input", () => {
    expect(() => normalizeAiResult(null)).toThrow();
    expect(() => normalizeAiResult("foo")).toThrow();
  });
  it("accepts an empty foods array (the caller treats it as no-food)", () => {
    const result = normalizeAiResult({ foods: [] });
    expect(result.foods).toHaveLength(0);
  });
  it("normalizes a valid AI result", () => {
    const result = normalizeAiResult({
      foods: [{ name: "  白米饭 ", weight_g: 150, calories_per_100g: 116, confidence: "high" }],
      note: "ok",
    });
    expect(result.foods[0].name).toBe("白米饭");
    expect(result.foods[0].total_calories).toBe(174);
  });
});
