// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, saveSettings } from "../src/storage/settings";

beforeEach(() => {
  if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
    try {
      globalThis.localStorage.clear();
    } catch {
      // ignore
    }
  }
});

describe("settings storage", () => {
  it("returns defaults when nothing is stored", () => {
    const s = loadSettings();
    expect(s.dailyGoal).toBe(2000);
    expect(s.dailyLimit).toBe(2300);
  });

  it("clamps goal and limit to safe ranges", () => {
    saveSettings({ dailyGoal: 100 });
    const s1 = loadSettings();
    expect(s1.dailyGoal).toBe(800);

    saveSettings({ dailyGoal: 99999 });
    const s2 = loadSettings();
    expect(s2.dailyGoal).toBe(6000);

    saveSettings({ dailyLimit: 99999 });
    const s3 = loadSettings();
    expect(s3.dailyLimit).toBe(8000);
  });

  it("does not store any API key in the browser", () => {
    saveSettings({ dailyGoal: 1800 });
    const keys = Object.keys(globalThis.localStorage);
    for (const key of keys) {
      expect(key).not.toMatch(/qwen_api_key|boohee_api_key|qwen|boohee/i);
    }
  });
});
