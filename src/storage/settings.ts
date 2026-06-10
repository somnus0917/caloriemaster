import type { Settings } from "../types";

const GOAL_KEY = "daily_goal";
const LIMIT_KEY = "daily_limit";

const DEFAULT_DAILY_GOAL = 2000;
const DEFAULT_DAILY_LIMIT = 2300;
const MIN_GOAL = 800;
const MAX_GOAL = 6000;
const MAX_LIMIT = 8000;

const GOAL_FALLBACK = (import.meta.env.VITE_DAILY_GOAL ?? "").trim();
const LIMIT_FALLBACK = (import.meta.env.VITE_DAILY_LIMIT ?? "").trim();

function readNumber(key: string, fallback: number): number {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function loadSettings(): Settings {
  return {
    dailyGoal: readNumber(GOAL_KEY, parseFallbackNumber(GOAL_FALLBACK, DEFAULT_DAILY_GOAL)),
    dailyLimit: readNumber(LIMIT_KEY, parseFallbackNumber(LIMIT_FALLBACK, DEFAULT_DAILY_LIMIT)),
  };
}

export function saveSettings(next: Partial<Settings>): void {
  if (typeof localStorage === "undefined") return;
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
