// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { recognizeFood, parseAiContent, normalizeAiResult } from "../src/services/qwen";

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
      json: async () => ({
        content: '{"foods":[{"name":"白米饭","weight_g":150,"calories_per_100g":116,"confidence":"med"}]}',
      }),
    } as Response);

    await recognizeFood({ imageBase64: SAMPLE_IMAGE });

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

  it("uses POST and application/json content type", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        content: '{"foods":[{"name":"白米饭","weight_g":150,"calories_per_100g":116,"confidence":"med"}]}',
      }),
    } as Response);

    await recognizeFood({ imageBase64: SAMPLE_IMAGE });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("translates a 503 with code=QWEN_NOT_CONFIGURED into a user-friendly error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({
        error: { code: "QWEN_NOT_CONFIGURED", message: "no key" },
      }),
    } as Response);

    await expect(recognizeFood({ imageBase64: SAMPLE_IMAGE })).rejects.toThrow(/Qwen Key/);
  });

  it("translates a 413 with code=PAYLOAD_TOO_LARGE into a user-friendly error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 413,
      json: async () => ({
        error: { code: "PAYLOAD_TOO_LARGE", message: "too big" },
      }),
    } as Response);

    await expect(recognizeFood({ imageBase64: SAMPLE_IMAGE })).rejects.toThrow(/图片过大/);
  });
});

describe("parseAiContent (AI JSON parsing)", () => {
  it("parses plain JSON", () => {
    expect(parseAiContent('{"foods":[],"note":"x"}')).toEqual({ foods: [], note: "x" });
  });

  it("strips a single outermost ```json fence", () => {
    expect(parseAiContent('```json\n{"foo":1}\n```')).toEqual({ foo: 1 });
  });

  it("strips a ``` fence with no language tag", () => {
    expect(parseAiContent('```\n{"foo":2}\n```')).toEqual({ foo: 2 });
  });

  it("rejects invalid JSON", () => {
    expect(() => parseAiContent("not json")).toThrow();
    expect(() => parseAiContent('{ "foods":')).toThrow();
  });
});

describe("normalizeAiResult (AI result sanitization)", () => {
  it("rejects an empty foods array", () => {
    expect(() => normalizeAiResult({ foods: [] })).toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => normalizeAiResult(null)).toThrow();
    expect(() => normalizeAiResult("foo")).toThrow();
    expect(() => normalizeAiResult(undefined)).toThrow();
  });

  it("rejects malformed entries inside the foods array", () => {
    expect(() => normalizeAiResult({ foods: [null, "bad", 1] })).toThrow();
  });

  it("normalizes a valid AI result and computes totals from weight × calories", () => {
    const result = normalizeAiResult({
      foods: [
        {
          name: "  白米饭 ",
          weight_g: 150,
          calories_per_100g: 116,
          confidence: "high",
        },
      ],
      note: "ok",
    });
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0].name).toBe("白米饭");
    expect(result.foods[0].total_calories).toBe(174);
  });
});
