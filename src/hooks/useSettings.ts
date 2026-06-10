import { useCallback, useEffect, useState } from "react";
import type { Settings } from "../types";
import { loadSettings, saveSettings } from "../storage/settings";

export interface UseSettingsReturn {
  settings: Settings;
  update: (next: Partial<Settings>) => void;
}

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  const update = useCallback((next: Partial<Settings>) => {
    saveSettings(next);
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === "qwen_api_key" ||
        e.key === "boohee_api_key" ||
        e.key === "daily_goal" ||
        e.key === "daily_limit"
      ) {
        setSettings(loadSettings());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { settings, update };
}
