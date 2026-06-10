/**
 * Object storage abstraction.
 *
 * The rest of the codebase MUST go through this interface, never
 * call the OSS SDK directly. This makes the records service
 * testable with an in-memory fake and keeps the dependency
 * surface small.
 *
 * SECURITY: the implementation that backs this interface holds
 * the OSS access key (server-side only). No browser code path
 * ever imports this module.
 */
export type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp";

export interface UploadImageInput {
  userId: string;
  recordId: string;
  data: Buffer;
  mimeType: SupportedImageMime;
}

export interface UploadedImage {
  objectKey: string;
  size: number;
  mimeType: string;
  etag?: string;
}

export interface ObjectStorage {
  uploadRecordImage(input: UploadImageInput): Promise<UploadedImage>;
  deleteObject(objectKey: string): Promise<void>;
  createSignedGetUrl(objectKey: string, ttlSeconds?: number): Promise<string>;
}

/**
 * Build the canonical object key for a record thumbnail. The user
 * never gets to pick any part of this path.
 *
 *   users/{userId}/records/{recordId}/thumbnail-{random}.{ext}
 */
export function buildThumbnailObjectKey(
  userId: string,
  recordId: string,
  mimeType: SupportedImageMime,
  randomSuffix: string,
): string {
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";
  return `users/${userId}/records/${recordId}/thumbnail-${randomSuffix}.${ext}`;
}
