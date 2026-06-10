/**
 * Type declarations for `server/validation.cjs`. Lets the rest of the
 * TypeScript codebase (and the Vitest suite) import the validators with
 * full type checking.
 */

export const MAX_BODY_BYTES: number;
export const MAX_BODY_BYTES_FOR_HUMAN: string;
export const ALLOWED_IMAGE_MIME: readonly string[];

export interface ParsedImage {
  ok: true;
  mime: string;
  base64: string;
}

export interface ValidationError {
  ok: false;
  code:
    | "INVALID_REQUEST"
    | "UNSUPPORTED_MEDIA"
    | "PAYLOAD_TOO_LARGE"
    | "QWEN_NOT_CONFIGURED"
    | "BOOHEE_NOT_CONFIGURED"
    | "UPSTREAM_TIMEOUT"
    | "UPSTREAM_ERROR"
    | "METHOD_NOT_ALLOWED"
    | "ROUTE_NOT_FOUND";
  message: string;
}

export function parseImageDataUrl(raw: unknown): ParsedImage | ValidationError;
export function validateRecognizeBody(body: unknown): ParsedImage | ValidationError;

export interface UpstreamRequest {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  response_format: { type: string };
  temperature: number;
}

export interface UpstreamEnv {
  QWEN_MODEL?: string;
  SYSTEM_PROMPT?: string;
}

export function buildUpstreamRequest(imageBase64: string, env: UpstreamEnv): UpstreamRequest;

export const DEFAULT_SYSTEM_PROMPT: string;
export const DEFAULT_QWEN_MODEL: string;
