/**
 * User settings API client.
 */
import { apiRequest } from "./http.js";

export interface SettingsDTO {
  dailyTarget: number;
  dailyLimit: number;
  updatedAt: string;
}

export async function getSettings(): Promise<SettingsDTO> {
  const { settings } = await apiRequest<{ settings: SettingsDTO }>("/api/settings");
  return settings;
}

export async function updateSettings(input: { dailyTarget?: number; dailyLimit?: number }): Promise<SettingsDTO> {
  const { settings } = await apiRequest<{ settings: SettingsDTO }>("/api/settings", {
    method: "PUT",
    body: input,
  });
  return settings;
}
