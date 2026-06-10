/**
 * Image processor.
 *
 * Given a raw image buffer (already validated by magic bytes), this
 * module:
 *   - auto-rotates based on EXIF orientation
 *   - strips ALL metadata (GPS, camera, etc.)
 *   - resizes so neither dimension exceeds MAX_PIXELS
 *   - re-encodes to WebP at quality 80
 *
 * We never trust user-supplied EXIF or original dimensions; a
 * "decompression bomb" is mitigated by the limit on `failOn` and
 * the explicit pixel ceiling.
 *
 * `sharp` is invoked with a memory + pixel cap to refuse
 * pathological inputs early.
 */
import sharp from "sharp";
import type { SupportedImageMime } from "./storage.js";

export const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MB raw upload
export const MAX_PIXELS = 4_000_000; // 4 megapixels after decode
export const MAX_OUTPUT_BYTES = 200 * 1024; // 200 KB final WebP
export const MAX_DIMENSION = 256; // we only need a tiny thumbnail
export const OUTPUT_MIME: SupportedImageMime = "image/webp";
export const OUTPUT_QUALITY = 80;

export interface ProcessedImage {
  data: Buffer;
  mimeType: SupportedImageMime;
  size: number;
}

export class ImageProcessingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "IMAGE_INVALID"
      | "IMAGE_TOO_LARGE"
      | "IMAGE_PROCESSING_FAILED",
  ) {
    super(message);
    this.name = "ImageProcessingError";
  }
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length > MAX_INPUT_BYTES) {
    throw new ImageProcessingError(
      "原图过大",
      "IMAGE_TOO_LARGE",
    );
  }

  // sharp().metadata() reads only the header, so it's cheap and
  // refuses files that aren't a known image format. It also fails
  // fast on malformed / truncated images.
  let pipeline: sharp.Sharp;
  try {
    pipeline = sharp(input, { failOn: "error", limitInputPixels: MAX_PIXELS });
    const meta = await pipeline.metadata();
    if (!meta.format) {
      throw new ImageProcessingError("无法识别图片格式", "IMAGE_INVALID");
    }
    if (meta.width === undefined || meta.height === undefined) {
      throw new ImageProcessingError("无法识别图片尺寸", "IMAGE_INVALID");
    }
  } catch (err) {
    if (err instanceof ImageProcessingError) throw err;
    throw new ImageProcessingError("图片解析失败", "IMAGE_INVALID");
  }

  try {
    // Sharp's default is to strip ALL metadata (EXIF, GPS, ICC,
    // XMP, IPTC) when none is requested. We rely on that default:
    // no .withMetadata() call anywhere on the pipeline.
    const out = await sharp(input, { failOn: "error", limitInputPixels: MAX_PIXELS })
      // .rotate() reads the EXIF orientation tag, applies it
      // visually, and drops the tag from the metadata block.
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: OUTPUT_QUALITY, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (out.data.length > MAX_OUTPUT_BYTES) {
      throw new ImageProcessingError(
        `处理后图片仍然过大 (${out.data.length} 字节)`,
        "IMAGE_TOO_LARGE",
      );
    }
    return {
      data: out.data,
      mimeType: OUTPUT_MIME,
      size: out.data.length,
    };
  } catch (err) {
    if (err instanceof ImageProcessingError) throw err;
    throw new ImageProcessingError("图片处理失败", "IMAGE_PROCESSING_FAILED");
  }
}
