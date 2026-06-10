import { useCallback, useEffect, useState } from "react";
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

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
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
  }, [reload]);

  const update = useCallback(
    async (next: { dailyTarget?: number; dailyLimit?: number }) => {
      const updated = await apiUpdateSettings(next);
      setSettings({ dailyGoal: updated.dailyTarget, dailyLimit: updated.dailyLimit });
    },
    [],
  );

  return { settings, loading, error, reload, update };
}
