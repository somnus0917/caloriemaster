/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_QWEN_API_URL?: string;
  readonly VITE_QWEN_MODEL?: string;
  readonly VITE_DAILY_GOAL?: string;
  readonly VITE_DAILY_LIMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
