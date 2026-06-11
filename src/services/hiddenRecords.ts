const HIDDEN_RECORD_IDS_KEY = "caloriemaster.hiddenRecordIds.v1";

function readHiddenIds(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(HIDDEN_RECORD_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeHiddenIds(ids: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(HIDDEN_RECORD_IDS_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore storage failures: server-side deletion can still proceed.
  }
}

export function isRecordHidden(id: string): boolean {
  return readHiddenIds().has(id);
}

export function hideRecord(id: string): void {
  const ids = readHiddenIds();
  ids.add(id);
  writeHiddenIds(ids);
}

export function unhideRecord(id: string): void {
  const ids = readHiddenIds();
  ids.delete(id);
  writeHiddenIds(ids);
}
