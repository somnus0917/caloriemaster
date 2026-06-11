/**
 * Aliyun OSS implementation of `ObjectStorage`.
 *
 * The constructor is the only place that holds `accessKeySecret`.
 * The key is consumed by the SDK and then dropped from the
 * closure; we do not log it, do not stash it on the instance, and
 * do not export it.
 *
 * Signed URL endpoint:
 *   - The browser MUST reach OSS over the public network.
 *   - For an ECS deployed in the same region we upload via the
 *     internal endpoint to save bandwidth, but `signedUrl()`
 *     ALWAYS uses the public endpoint (or a custom public domain
 *     if one is configured).
 */
import { randomBytes } from "node:crypto";
import OSS from "ali-oss";
import {
  buildThumbnailObjectKey,
  buildOriginalImageObjectKey,
  type ObjectStorage,
  type SupportedImageMime,
  type UploadImageInput,
  type UploadedImage,
} from "./storage.js";

export interface OssConfig {
  region: string;
  bucket: string;
  /** Used for server-side PutObject / DeleteObject. May be the internal endpoint. */
  internalEndpoint?: string;
  /** Used for signed GET URLs that the browser loads from. Must be publicly reachable. */
  publicEndpoint: string;
  accessKeyId: string;
  accessKeySecret: string;
  signedUrlTtlSeconds: number;
}

/** The ali-oss SDK ships loose typings; we narrow to the surface we
 *  actually use. Both signatures return `Promise`s and accept a
 *  Buffer / string as the body. */
interface OssClientLike {
  put(name: string, data: Buffer, options: { headers: Record<string, string> }): Promise<{
    name?: string;
    res?: { size?: number; headers?: Record<string, unknown> };
  }>;
  delete(name: string): Promise<unknown>;
  signatureUrl(name: string, options: { method: string; expires: number }): string;
}

function normalizeEndpointForSdk(endpoint: string, bucket: string): { endpoint: string; cname: boolean } {
  try {
    const url = new URL(endpoint);
    const bucketPrefix = `${bucket}.`;
    if (url.hostname.startsWith(bucketPrefix) && url.hostname.endsWith(".aliyuncs.com")) {
      url.hostname = url.hostname.slice(bucketPrefix.length);
      return { endpoint: url.toString().replace(/\/$/, ""), cname: false };
    }
    if (url.hostname.endsWith(".aliyuncs.com")) {
      return { endpoint, cname: false };
    }
    return { endpoint, cname: true };
  } catch {
    return { endpoint, cname: false };
  }
}

export function createOssStorage(config: OssConfig): ObjectStorage {
  const uploadEndpoint = normalizeEndpointForSdk(
    config.internalEndpoint || config.publicEndpoint,
    config.bucket,
  );
  const client = new OSS({
    region: config.region,
    bucket: config.bucket,
    endpoint: uploadEndpoint.endpoint,
    cname: uploadEndpoint.cname,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    secure: true,
  }) as unknown as OssClientLike;
  // The client is created with `secure: true`, which means it will
  // only use https. We never want to fall back to http for a private
  // bucket.
  return new OssStorage(client, config);
}

class OssStorage implements ObjectStorage {
  constructor(
    private readonly client: OssClientLike,
    private readonly config: OssConfig,
  ) {}

  async uploadRecordImage(input: UploadImageInput): Promise<UploadedImage> {
    const suffix = randomBytes(6).toString("hex");
    const objectKey = buildThumbnailObjectKey(
      input.userId,
      input.recordId,
      input.mimeType as SupportedImageMime,
      suffix,
    );
    const headers: Record<string, string> = {
      "Content-Type": input.mimeType,
      "Cache-Control": "private, max-age=3600",
    };
    const result = await this.client.put(objectKey, input.data, {
      headers,
      // `x-oss-object-acl` is intentionally NOT set: the bucket's
      // default ACL is private, and we never want a public object.
    });
    return {
      objectKey: result.name ?? objectKey,
      size: typeof result.res?.size === "number" ? result.res.size : input.data.length,
      mimeType: input.mimeType,
      etag: typeof result.res?.headers?.etag === "string" ? result.res.headers.etag : undefined,
    };
  }

  async uploadOriginalImage(input: UploadImageInput): Promise<UploadedImage> {
    const suffix = randomBytes(6).toString("hex");
    const objectKey = buildOriginalImageObjectKey(
      input.userId,
      input.recordId,
      input.mimeType as SupportedImageMime,
      suffix,
    );
    const headers: Record<string, string> = {
      "Content-Type": input.mimeType,
      "Cache-Control": "private, max-age=3600",
    };
    const result = await this.client.put(objectKey, input.data, {
      headers,
    });
    return {
      objectKey: result.name ?? objectKey,
      size: typeof result.res?.size === "number" ? result.res.size : input.data.length,
      mimeType: input.mimeType,
      etag: typeof result.res?.headers?.etag === "string" ? result.res.headers.etag : undefined,
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.delete(objectKey);
  }

  async createSignedGetUrl(objectKey: string, ttlSeconds?: number): Promise<string> {
    const ttl = Math.max(1, Math.min(ttlSeconds ?? this.config.signedUrlTtlSeconds, 3600));
    // Use a fresh client bound to the public endpoint so the URL
    // is reachable from the browser, even if we uploaded via the
    // internal endpoint.
    let publicClient: OssClientLike = this.client;
    if (this.config.internalEndpoint) {
      const publicEndpoint = normalizeEndpointForSdk(this.config.publicEndpoint, this.config.bucket);
      publicClient = new OSS({
        region: this.config.region,
        bucket: this.config.bucket,
        endpoint: publicEndpoint.endpoint,
        cname: publicEndpoint.cname,
        accessKeyId: this.config.accessKeyId,
        accessKeySecret: this.config.accessKeySecret,
        secure: true,
      }) as unknown as OssClientLike;
    }
    return publicClient.signatureUrl(objectKey, {
      method: "GET",
      expires: ttl,
    });
  }
}
