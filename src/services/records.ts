/**
 * Food records API client.
 */
import { apiRequest } from "./http.js";

export interface FoodItemDTO {
  id: string;
  name: string;
  weightG: number;
  caloriesPer100g: number;
  totalCalories: number;
  confidence: string | null;
  calorieSource: string | null;
  booheeCode: string | null;
  proteinPer100g: number | null;
  fatPer100g: number | null;
  carbohydratePer100g: number | null;
  healthLight: string | null;
}

export interface RecordDTO {
  id: string;
  userId: string;
  sourceId: string | null;
  timestamp: number;
  mealType: string;
  totalCalories: number;
  thumbnailUrl: string | null;
  hasImage: boolean;
  imageMimeType: string | null;
  imageSize: number | null;
  hasOriginalImage: boolean;
  originalImageMimeType: string | null;
  originalImageSize: number | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  foods: FoodItemDTO[];
}

export interface RecordInput {
  timestamp: number;
  mealType: string;
  thumbnailUrl?: string | null;
  thumbnailDataUrl?: string;
  sourceId?: string;
  isDemo?: boolean;
  items: Array<{
    name: string;
    weightG: number;
    caloriesPer100g: number;
    confidence?: "high" | "med" | "low";
    calorieSource?: string;
    booheeCode?: string;
    proteinPer100g?: number | null;
    fatPer100g?: number | null;
    carbohydratePer100g?: number | null;
    healthLight?: 0 | 1 | 2 | 3;
  }>;
}

export type ThumbnailAction =
  | { type: "keep" }
  | { type: "remove" }
  | { type: "replace"; dataUrl: string };

export async function listRecords(options: { from?: number; to?: number; limit?: number } = {}): Promise<RecordDTO[]> {
  const params = new URLSearchParams();
  if (options.from !== undefined) params.set("from", String(options.from));
  if (options.to !== undefined) params.set("to", String(options.to));
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const qs = params.toString();
  const url = qs ? `/api/records?${qs}` : "/api/records";
  const { records } = await apiRequest<{ records: RecordDTO[] }>(url);
  return records;
}

export async function createRecord(input: RecordInput): Promise<RecordDTO> {
  const { record } = await apiRequest<{ record: RecordDTO }>("/api/records", {
    method: "POST",
    body: input,
  });
  return record;
}

export async function updateRecord(
  id: string,
  input: RecordInput,
  thumbnailAction?: ThumbnailAction,
): Promise<RecordDTO> {
  const body: RecordInput & { thumbnailAction?: ThumbnailAction } = { ...input };
  if (thumbnailAction) body.thumbnailAction = thumbnailAction;
  const { record } = await apiRequest<{ record: RecordDTO }>(`/api/records/${encodeURIComponent(id)}`, {
    method: "PUT",
    body,
  });
  return record;
}

export async function deleteRecord(id: string): Promise<{ deletedId: string }> {
  return apiRequest<{ deletedId: string }>(`/api/records/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function importRecords(records: RecordInput[]): Promise<{ imported: number; skipped: number }> {
  return apiRequest<{ imported: number; skipped: number }>("/api/records/import", {
    method: "POST",
    body: { records },
  });
}

export interface SignedImageUrl {
  url: string;
  expiresIn: number;
}

export async function fetchSignedImageUrl(recordId: string, type: "thumbnail" | "original" = "thumbnail"): Promise<SignedImageUrl> {
  const params = type === "original" ? "?type=original" : "";
  return apiRequest<SignedImageUrl>(`/api/records/${encodeURIComponent(recordId)}/image-url${params}`);
}
