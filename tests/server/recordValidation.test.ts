// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RecordInputSchema, THUMBNAIL_MAX } from "../../src/server/ai/validation";

function makeRecord(thumbnailDataUrl?: string) {
  return {
    timestamp: 1700000000000,
    mealType: "午餐",
    thumbnailDataUrl,
    items: [
      {
        name: "米饭",
        weightG: 150,
        caloriesPer100g: 116,
        confidence: "med",
      },
    ],
  };
}

describe("RecordInputSchema", () => {
  it("accepts a client-side 512px thumbnail-sized data URL", () => {
    const payload = makeRecord(`data:image/jpeg;base64,${"a".repeat(128 * 1024)}`);

    expect(RecordInputSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects oversized thumbnail data URLs", () => {
    const payload = makeRecord(`data:image/jpeg;base64,${"a".repeat(THUMBNAIL_MAX)}`);

    expect(RecordInputSchema.safeParse(payload).success).toBe(false);
  });
});
