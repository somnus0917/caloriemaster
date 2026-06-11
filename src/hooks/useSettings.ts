import { useCallback, useEffect, useRef, useState } from "react";
import { getSettings, updateSettings as apiUpdateSettings } from "../services/settings";

export type Settings = {
  dailyGoal: number;
  dailyLimit: number;
};

export interface UseSettingsReturn {
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  update: (next: { dailyTarget?: number; dailyLimit?: number }) => Promise<void>;
}

/**
 * `enabled` gates the initial fetch (and any manual `reload()`):
 * pass `false` while the user isn't authenticated, `true` once they
 * are. Without this, the hook fires on mount, gets a 401, and then
 * never retries — leaving `settings` as `null` and the app stuck on
 * the loading spinner.
 */
export function useSettings(enabled: boolean = true): UseSettingsReturn {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const reload = useCallback(async () => {
    if (!enabledRef.current) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const s = await getSettings();
      setSettings({ dailyGoal: s.dailyTarget, dailyLimit: s.dailyLimit });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载设置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, enabled]);

  const update = useCallback(
    async (next: { dailyTarget?: number; dailyLimit?: number }) => {
      const updated = await apiUpdateSettings(next);
      setSettings({ dailyGoal: updated.dailyTarget, dailyLimit: updated.dailyLimit });
    },
    [],
  );

  return { settings, loading, error, reload, update };
}