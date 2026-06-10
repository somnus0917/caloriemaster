/**
 * Wires the configured `ObjectStorage` implementation.
 *
 * If the OSS env vars are absent we expose a no-op storage so the
 * rest of the app keeps working (records just won't have images).
 * The health check endpoint surfaces whether storage is configured.
 */
import { loadConfig } from "../config.js";
import { createOssStorage, type OssConfig } from "./oss.js";
import type { ObjectStorage } from "./storage.js";

/** Storage that accepts no images and refuses signed URLs. */
class NullStorage implements ObjectStorage {
  async uploadRecordImage(): Promise<never> {
    throw new Error("OSS not configured");
  }
  async deleteObject(): Promise<void> {
    // Best-effort no-op: when we never uploaded anything, there is
    // nothing to delete.
  }
  async createSignedGetUrl(): Promise<never> {
    throw new Error("OSS not configured");
  }
}

let _storage: ObjectStorage | null = null;

export function getObjectStorage(): ObjectStorage {
  if (_storage) return _storage;
  const config = loadConfig();
  if (!config.OSS_REGION || !config.OSS_BUCKET || !config.OSS_ACCESS_KEY_ID || !config.OSS_ACCESS_KEY_SECRET) {
    _storage = new NullStorage();
    return _storage;
  }
  const ossConfig: OssConfig = {
    region: config.OSS_REGION,
    bucket: config.OSS_BUCKET,
    internalEndpoint: config.OSS_INTERNAL_ENDPOINT,
    publicEndpoint: config.OSS_PUBLIC_ENDPOINT ?? derivePublicEndpoint(config.OSS_REGION, config.OSS_BUCKET),
    accessKeyId: config.OSS_ACCESS_KEY_ID,
    accessKeySecret: config.OSS_ACCESS_KEY_SECRET,
    signedUrlTtlSeconds: config.OSS_SIGNED_URL_TTL_SECONDS,
  };
  _storage = createOssStorage(ossConfig);
  return _storage;
}

export function isStorageConfigured(): boolean {
  const config = loadConfig();
  return Boolean(
    config.OSS_REGION &&
      config.OSS_BUCKET &&
      config.OSS_ACCESS_KEY_ID &&
      config.OSS_ACCESS_KEY_SECRET,
  );
}

/**
 * Best-effort public endpoint derivation: the regional public
 * endpoint for a private bucket is `https://<bucket>.<region>.aliyuncs.com`.
 * Callers that need a CDN / custom domain should set
 * `OSS_PUBLIC_ENDPOINT` explicitly.
 */
function derivePublicEndpoint(region: string, bucket: string): string {
  return `https://${bucket}.${region}.aliyuncs.com`;
}

export function setObjectStorageForTests(storage: ObjectStorage | null): void {
  _storage = storage;
}
