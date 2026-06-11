// @vitest-environment node
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processImage, MAX_THUMBNAIL_BYTES, OUTPUT_MIME } from "../../src/server/storage/imageProcessor";

async function makeJpeg(size = 100): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function makeJpegWithExif(): Promise<Buffer> {
  // A tiny JPEG with EXIF metadata embedded.
  return sharp({
    create: {
      width: 200,
      height: 200,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .withExif({ IFD0: { Software: "should-be-stripped", Make: "ACME" } })
    .jpeg()
    .toBuffer();
}

describe("processImage", () => {
  it("re-encodes a valid JPEG into WebP and stays under the size cap", async () => {
    const input = await makeJpeg(120);
    const out = await processImage(input);
    expect(out.mimeType).toBe(OUTPUT_MIME);
    expect(out.size).toBeLessThanOrEqual(MAX_THUMBNAIL_BYTES);
    expect(out.size).toBeGreaterThan(0);
  });

  it("strips EXIF metadata", async () => {
    const input = await makeJpegWithExif();
    const out = await processImage(input);
    const meta = await sharp(out.data).metadata();
    // After processImage, no EXIF / camera info should remain.
    if (meta.exif) {
      const size = (meta.exif as Buffer).length ?? 0;
      expect(size).toBe(0);
    }
  });

  it("scales down images that exceed the max dimension", async () => {
    // 1000x1000 should be resized to 512x512 (max dimension).
    const input = await makeJpeg(1000);
    const out = await processImage(input);
    const meta = await sharp(out.data).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(512);
  });

  it("refuses oversized raw input", async () => {
    const huge = Buffer.alloc(11 * 1024 * 1024, 1);
    await expect(processImage(huge)).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it("refuses non-image input", async () => {
    const garbage = Buffer.from("not an image at all just text");
    await expect(processImage(garbage)).rejects.toMatchObject({ code: "IMAGE_INVALID" });
  });
});