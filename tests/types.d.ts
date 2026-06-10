// Type shim so TypeScript can resolve `import ... from "../server/validation.cjs"`
// even though the source file is CommonJS. The actual declarations live in
// `server/validation.d.ts` (auto-included via tsconfig).
declare module "*validation.cjs" {
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
    code: string;
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
}
