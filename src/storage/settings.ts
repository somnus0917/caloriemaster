import type { Settings } from "../types";

const QWEN_KEY = "qwen_api_key";
const BOOHEE_KEY = "boohee_api_key";
const GOAL_KEY = "daily_goal";
const LIMIT_KEY = "daily_limit";

const DEFAULT_QWEN_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEFAULT_QWEN_MODEL = "qwen3-vl-flash";
const DEFAULT_DAILY_GOAL = 2000;
const DEFAULT_DAILY_LIMIT = 2300;
const MIN_GOAL = 800;
const MAX_GOAL = 6000;
const MAX_LIMIT = 8000;

const GOAL_FALLBACK = (import.meta.env.VITE_DAILY_GOAL ?? "").trim();
const LIMIT_FALLBACK = (import.meta.env.VITE_DAILY_LIMIT ?? "").trim();
const QWEN_URL_FALLBACK = (import.meta.env.VITE_QWEN_API_URL ?? "").trim();
const QWEN_MODEL_FALLBACK = (import.meta.env.VITE_QWEN_MODEL ?? "").trim();

function readNumber(key: string, fallback: number): number {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readString(key: string): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(key) || "";
}

export function loadSettings(): Settings {
  return {
    qwenApiKey: readString(QWEN_KEY),
    booheeApiKey: readString(BOOHEE_KEY),
    dailyGoal: readNumber(GOAL_KEY, parseFallbackNumber(GOAL_FALLBACK, DEFAULT_DAILY_GOAL)),
    dailyLimit: readNumber(LIMIT_KEY, parseFallbackNumber(LIMIT_FALLBACK, DEFAULT_DAILY_LIMIT)),
    qwenApiUrl: QWEN_URL_FALLBACK || DEFAULT_QWEN_API_URL,
    qwenModel: QWEN_MODEL_FALLBACK || DEFAULT_QWEN_MODEL,
  };
}

export function saveSettings(next: Partial<Settings>): void {
  if (typeof localStorage === "undefined") return;
  if (next.qwenApiKey !== undefined) {
    if (next.qwenApiKey) localStorage.setItem(QWEN_KEY, next.qwenApiKey);
    else localStorage.removeItem(QWEN_KEY);
  }
  if (next.booheeApiKey !== undefined) {
    if (next.booheeApiKey) localStorage.setItem(BOOHEE_KEY, next.booheeApiKey);
    else localStorage.removeItem(BOOHEE_KEY);
  }
  if (next.dailyGoal !== undefined) {
    const g = clampNumber(next.dailyGoal, MIN_GOAL, MAX_GOAL);
    localStorage.setItem(GOAL_KEY, String(g));
  }
  if (next.dailyLimit !== undefined) {
    const goal = readNumber(GOAL_KEY, DEFAULT_DAILY_GOAL);
    const min = goal;
    const max = MAX_LIMIT;
    const l = clampNumber(next.dailyLimit, Math.min(min, max), max);
    localStorage.setItem(LIMIT_KEY, String(l));
  }
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseFallbackNumber(raw: string, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
