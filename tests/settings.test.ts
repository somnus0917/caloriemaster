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
    expect(s.qwenApiKey).toBe("");
    expect(s.booheeApiKey).toBe("");
  });

  it("stores and reloads API keys", () => {
    saveSettings({ qwenApiKey: "sk-test-qwen" });
    saveSettings({ booheeApiKey: "sk-boohee" });
    const s = loadSettings();
    expect(s.qwenApiKey).toBe("sk-test-qwen");
    expect(s.booheeApiKey).toBe("sk-boohee");
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
});
