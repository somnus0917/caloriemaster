// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decodeDataUrlImage } from "../../src/server/storage/dataUrl";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const WEBP = "data:image/webp;base64,UklGRgAA";

describe("decodeDataUrlImage", () => {
  it("accepts JPEG, PNG, WebP Data URLs", () => {
    expect(decodeDataUrlImage(JPEG)).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(decodeDataUrlImage(PNG)).toMatchObject({ ok: true, mime: "image/png" });
    expect(decodeDataUrlImage(WEBP)).toMatchObject({ ok: true, mime: "image/webp" });
  });

  it("rejects non-string input", () => {
    for (const v of [undefined, null, 1, {}, []]) {
      const r = decodeDataUrlImage(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("IMAGE_INVALID");
    }
  });

  it("rejects empty strings and oversized payloads", () => {
    expect(decodeDataUrlImage("")).toMatchObject({ ok: false, code: "IMAGE_INVALID" });
    const huge = "data:image/jpeg;base64," + "a".repeat(400 * 1024);
    expect(decodeDataUrlImage(huge)).toMatchObject({ ok: false, code: "IMAGE_TOO_LARGE" });
  });

  it("rejects remote HTTP URLs", () => {
    expect(decodeDataUrlImage("https://example.com/x.jpg")).toMatchObject({
      ok: false,
      code: "IMAGE_INVALID",
    });
  });

  it("rejects SVG and other unsupported MIMEs", () => {
    const cases = [
      "data:image/svg+xml;base64,PHN2Zy8+",
      "data:image/bmp;base64,Qk0=",
      "data:image/gif;base64,R0lGODlh",
      "data:image/tiff;base64,SUQA",
    ];
    for (const v of cases) {
      const r = decodeDataUrlImage(v);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(["IMAGE_INVALID", "UNSUPPORTED_MEDIA"]).toContain(r.code);
      }
    }
  });

  it("rejects malformed base64 payloads", () => {
    expect(decodeDataUrlImage("data:image/jpeg;base64,not_base64!!!")).toMatchObject({
      ok: false,
      code: "IMAGE_INVALID",
    });
    expect(decodeDataUrlImage("data:image/jpeg;base64,AAA")).toMatchObject({
      ok: false,
      code: "IMAGE_INVALID",
    });
  });
});