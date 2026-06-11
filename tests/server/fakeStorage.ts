/**
 * In-memory `ObjectStorage` for tests.
 *
 * Records every call so tests can assert upload/delete behaviour and
 * compensation. Can be configured to fail uploads or deletes to
 * exercise the failure paths.
 */
import type {
  ObjectStorage,
  UploadedImage,
  SupportedImageMime,
  UploadImageInput,
} from "../../src/server/storage/storage";

export interface UploadCall {
  userId: string;
  recordId: string;
  mimeType: string;
  size: number;
}

export interface FakeStorageOptions {
  failUploads?: boolean;
  failDeletes?: boolean;
  /** When set, `uploadRecordImage` returns this objectKey instead of generating one. */
  forceObjectKey?: string;
}

export class FakeStorage implements ObjectStorage {
  readonly uploads: UploadCall[] = [];
  readonly deletes: string[] = [];
  /** map<objectKey, base64-ish placeholder> */
  readonly objects = new Map<string, Buffer>();
  readonly opts: FakeStorageOptions;

  constructor(opts: FakeStorageOptions = {}) {
    this.opts = opts;
  }

  async uploadRecordImage(input: UploadImageInput): Promise<UploadedImage> {
    if (this.opts.failUploads) {
      throw new Error("fake storage: upload failure");
    }
    const suffix = Math.random().toString(36).slice(2, 14);
    const ext = input.mimeType === "image/jpeg" ? "jpg" : input.mimeType === "image/png" ? "png" : "webp";
    const objectKey =
      this.opts.forceObjectKey ?? `users/${input.userId}/records/${input.recordId}/thumbnail-${suffix}.${ext}`;
    this.uploads.push({
      userId: input.userId,
      recordId: input.recordId,
      mimeType: input.mimeType,
      size: input.data.length,
    });
    this.objects.set(objectKey, input.data);
    return { objectKey, size: input.data.length, mimeType: input.mimeType };
  }

  async uploadOriginalImage(input: UploadImageInput): Promise<UploadedImage> {
    if (this.opts.failUploads) {
      throw new Error("fake storage: upload failure");
    }
    const suffix = Math.random().toString(36).slice(2, 14);
    const ext = input.mimeType === "image/jpeg" ? "jpg" : input.mimeType === "image/png" ? "png" : "webp";
    const objectKey =
      this.opts.forceObjectKey ?? `users/${input.userId}/records/${input.recordId}/original-${suffix}.${ext}`;
    this.uploads.push({
      userId: input.userId,
      recordId: input.recordId,
      mimeType: input.mimeType,
      size: input.data.length,
    });
    this.objects.set(objectKey, input.data);
    return { objectKey, size: input.data.length, mimeType: input.mimeType };
  }

  async deleteObject(objectKey: string): Promise<void> {
    if (this.opts.failDeletes) {
      throw new Error("fake storage: delete failure");
    }
    this.deletes.push(objectKey);
    this.objects.delete(objectKey);
  }

  async createSignedGetUrl(objectKey: string, ttlSeconds = 600): Promise<string> {
    if (!this.objects.has(objectKey)) {
      throw new Error("fake storage: object not found");
    }
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `https://fake-oss.example/${encodeURIComponent(objectKey)}?Expires=${exp}&Signature=fake`;
  }

  async getObjectBytes(objectKey: string): Promise<Buffer | null> {
    return this.objects.get(objectKey) ?? null;
  }
}

export function makeFakeStorage(opts?: FakeStorageOptions): FakeStorage {
  return new FakeStorage(opts);
}

void ({} as SupportedImageMime);