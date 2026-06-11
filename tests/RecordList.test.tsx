// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecordList } from "../src/components/records/RecordList";
import type { Record } from "../src/types";

function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

const RECORD: Record = {
  id: "r1",
  timestamp: 1700000000000,
  mealType: "午餐",
  foods: [
    {
      name: "米饭",
      weight_g: 150,
      calories_per_100g: 116,
      total_calories: 174,
      confidence: "med",
      cal_source: "ai_estimate",
    },
  ],
  totalCalories: 174,
  thumbnailUrl: null,
  hasImage: false,
  hasOriginalImage: false,
  isDemo: false,
};

describe("RecordList", () => {
  it("lets action buttons receive clicks without starting a swipe gesture", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <RecordList
        records={[RECORD]}
        today
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(onEdit).toHaveBeenCalledWith("r1");

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith("r1");
  });

  it("still supports swipe-to-delete on the card body", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <RecordList
        records={[RECORD]}
        today
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    const card = screen.getByTestId("record-card");
    const swipeTarget = card.parentElement;
    expect(swipeTarget).not.toBeNull();
    fireEvent(swipeTarget!, pointerEvent("pointerdown", 160));
    fireEvent(swipeTarget!, pointerEvent("pointermove", 60));
    fireEvent(swipeTarget!, pointerEvent("pointerup", 60));

    expect(onDelete).toHaveBeenCalledWith("r1");
    expect(onEdit).not.toHaveBeenCalled();
  });
});
