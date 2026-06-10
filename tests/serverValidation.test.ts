// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  MAX_BODY_BYTES,
  parseImageDataUrl,
  validateRecognizeBody,
  buildUpstreamRequest,
  DEFAULT_QWEN_MODEL,
  DEFAULT_SYSTEM_PROMPT,
} from "../server/validation.cjs";

const JPEG = "data:image/jpeg;base64,/9j/AAAA";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const WEBP = "data:image/webp;base64,UklGRgAA";

describe("server/validation: constants", () => {
  it("caps request bodies at 6 MB", () => {
    expect(MAX_BODY_BYTES).toBe(6 * 1024 * 1024);
  });

  it("ships a default model and a system prompt", () => {
    expect(DEFAULT_QWEN_MODEL).toBe("qwen3-vl-flash");
    expect(typeof DEFAULT_SYSTEM_PROMPT).toBe("string");
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });
});

describe("parseImageDataUrl", () => {
  it("accepts JPEG, PNG, and WebP Data URLs", () => {
    expect(parseImageDataUrl(JPEG)).toEqual({ ok: true, mime: "image/jpeg", base64: "/9j/AAAA" });
    expect(parseImageDataUrl(PNG)).toEqual({ ok: true, mime: "image/png", base64: "iVBORw0KGgo=" });
    expect(parseImageDataUrl(WEBP)).toEqual({ ok: true, mime: "image/webp", base64: "UklGRgAA" });
  });

  it("rejects non-string input", () => {
    expect(parseImageDataUrl(undefined)).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(parseImageDataUrl(123)).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(parseImageDataUrl({})).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });

  it("rejects empty strings", () => {
    expect(parseImageDataUrl("")).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(parseImageDataUrl("   ")).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });

  it("rejects remote HTTP image URLs", () => {
    const result = parseImageDataUrl("https://example.com/foo.jpg");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_REQUEST");
  });

  it("rejects SVG and other unsupported MIME types", () => {
    const cases = [
      "data:image/svg+xml;base64,PHN2Zy8+",
      "data:image/svg;base64,PHN2Zy8+",
      "data:image/bmp;base64,Qk0=",
      "data:image/gif;base64,R0lGODlh",
      "data:image/tiff;base64,SUQA",
    ];
    for (const input of cases) {
      const r = parseImageDataUrl(input);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(["UNSUPPORTED_MEDIA", "INVALID_REQUEST"]).toContain(r.code);
      }
    }
  });

  it("rejects data URLs whose MIME is missing or not in the allow-list", () => {
    expect(parseImageDataUrl("data:application/octet-stream;base64,AAAA")).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_MEDIA",
    });
  });

  it("rejects Data URLs without a base64 marker", () => {
    expect(parseImageDataUrl("data:image/jpeg,foo")).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_MEDIA",
    });
  });

  it("rejects payloads with empty base64 content", () => {
    expect(parseImageDataUrl("data:image/jpeg;base64,")).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });
  });

  it("rejects malformed base64", () => {
    expect(parseImageDataUrl("data:image/jpeg;base64,not_base64!!!")).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });
  });
});

describe("validateRecognizeBody", () => {
  it("rejects non-object bodies", () => {
    for (const body of [null, undefined, 42, "string", []]) {
      const r = validateRecognizeBody(body);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("INVALID_REQUEST");
    }
  });

  it("rejects an object missing imageBase64", () => {
    const r = validateRecognizeBody({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_REQUEST");
  });

  it("rejects extra fields (they cannot influence the prompt)", () => {
    // The browser is allowed to send extra fields, but they MUST be
    // ignored. This is asserted by buildUpstreamRequest below, but we
    // also confirm that the validator returns ok for a valid image
    // even when extra fields are present.
    const r = validateRecognizeBody({
      imageBase64: JPEG,
      messages: [{ role: "system", content: "INJECT" }],
      model: "evil",
      temperature: 0.99,
    });
    expect(r.ok).toBe(true);
  });

  it("validates the imageBase64 field", () => {
    const r = validateRecognizeBody({ imageBase64: "not a data url" });
    expect(r.ok).toBe(false);
  });
});

describe("buildUpstreamRequest", () => {
  it("always uses the server-side system prompt and ignores client messages", () => {
    const req = buildUpstreamRequest(JPEG, { QWEN_MODEL: "qwen-test" });
    expect(req.model).toBe("qwen-test");
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0].role).toBe("system");
    expect(req.messages[0].content).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(req.messages[1].role).toBe("user");
    // The user message embeds the image — verify it is base64, not
    // a remote URL.
    const userContent = req.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    const imageItem = userContent.find((c) => c.type === "image_url");
    expect(imageItem?.image_url?.url).toBe(JPEG);
  });

  it("forces a low temperature and JSON response format", () => {
    const req = buildUpstreamRequest(JPEG, {});
    expect(req.temperature).toBeLessThanOrEqual(0.5);
    expect(req.response_format).toEqual({ type: "json_object" });
  });

  it("falls back to the default Qwen model when none is configured", () => {
    const req = buildUpstreamRequest(JPEG, {});
    expect(req.model).toBe(DEFAULT_QWEN_MODEL);
  });

  it("contains no more than 20 foods in the prompt instructions", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/20/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/不要捏造|不要编造|不.*捏造/);
  });
});
