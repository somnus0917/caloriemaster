/**
 * Parse a thumbnail Data URL submitted by the client.
 *
 * We accept the Data URL form purely as a transport — the buffer
 * it produces is then handed to `processImage()` which re-validates
 * the format by magic bytes and re-encodes to WebP.
 *
 * This module NEVER trusts the MIME declared in the Data URL — it
 * only accepts the three allowed prefixes and lets the downstream
 * processor verify the actual content.
 */

const ALLOWED_PREFIXES = [
  "data:image/jpeg;base64,",
  "data:image/png;base64,",
  "data:image/webp;base64,",
] as const;

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const HTTP_RE = /^https?:\/\//i;
const MAX_DATA_URL_LENGTH = 350 * 1024; // ~250 KB after header

export type DecodedImage = {
  ok: true;
  mime: "image/jpeg" | "image/png" | "image/webp";
  data: Buffer;
} | {
  ok: false;
  code: "IMAGE_INVALID" | "IMAGE_TOO_LARGE";
  message: string;
};

export function decodeDataUrlImage(raw: unknown): DecodedImage {
  if (typeof raw !== "string") {
    return { ok: false, code: "IMAGE_INVALID", message: "thumbnailDataUrl 必须是字符串" };
  }
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, code: "IMAGE_INVALID", message: "thumbnailDataUrl 不能为空" };
  }
  if (value.length > MAX_DATA_URL_LENGTH) {
    return { ok: false, code: "IMAGE_TOO_LARGE", message: "图片过大，请压缩后再上传" };
  }
  if (HTTP_RE.test(value)) {
    return { ok: false, code: "IMAGE_INVALID", message: "不支持远程图片 URL" };
  }
  const lower = value.toLowerCase();
  if (lower.startsWith("data:image/svg")) {
    return { ok: false, code: "IMAGE_INVALID", message: "不支持 SVG" };
  }
  if (!value.startsWith("data:")) {
    return { ok: false, code: "IMAGE_INVALID", message: "thumbnailDataUrl 必须是 Data URL" };
  }
  let prefix: (typeof ALLOWED_PREFIXES)[number] | null = null;
  for (const candidate of ALLOWED_PREFIXES) {
    if (value.startsWith(candidate)) {
      prefix = candidate;
      break;
    }
  }
  if (!prefix) {
    return { ok: false, code: "IMAGE_INVALID", message: "仅支持 jpeg / png / webp 格式" };
  }
  const base64 = value.slice(prefix.length);
  if (base64.length === 0 || base64.length % 4 !== 0 || !BASE64_RE.test(base64)) {
    return { ok: false, code: "IMAGE_INVALID", message: "thumbnailDataUrl 编码不合法" };
  }
  const data = Buffer.from(base64, "base64");
  if (data.length === 0) {
    return { ok: false, code: "IMAGE_INVALID", message: "thumbnailDataUrl 数据为空" };
  }
  const mime = prefix.slice(5, prefix.indexOf(";")) as "image/jpeg" | "image/png" | "image/webp";
  return { ok: true, mime, data };
}
