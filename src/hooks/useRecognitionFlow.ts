import { useCallback, useRef, useState } from "react";
import type { RecognitionResult, Record } from "../types";
import { enrichWithDatabase } from "../services/boohee";
import { recognizeFood, type RecognizeOutcome } from "../services/qwen";
import { DEMO_RECOGNITION } from "../data/demoData";
import { normalizeAiResult } from "../services/qwen";

export type RecognitionStatus = "idle" | "recognizing" | "enriching";
export type RecognitionFailureReason = "no_food" | "error" | null;

export interface RecognitionState {
  result: RecognitionResult;
  weights: number[];
  aiWeights: number[];
  imageDataUrl: string | null;
  thumbnailUrl: string | null;
  note: string;
}

export interface UseRecognitionFlowOptions {
  onError: (message: string) => void;
  onNoFood?: () => void;
}

export interface UseRecognitionFlowReturn {
  recognition: RecognitionState | null;
  editingId: string | null;
  status: RecognitionStatus;
  failureReason: RecognitionFailureReason;
  isBusy: boolean;
  /**
   * Run the recognition pipeline for a new image. Returns true on
   * success (recognition state is populated), false on failure.
   * In the failure case the caller should stay on the camera page.
   */
  startRecognition: (imageBase64: string, thumbnail: string | null) => Promise<boolean>;
  loadDemo: () => void;
  beginEdit: (record: Record) => void;
  changeWeight: (index: number, weight: number) => void;
  reset: () => void;
  setStatus: (status: RecognitionStatus) => void;
}

export function useRecognitionFlow({
  onError,
  onNoFood,
}: UseRecognitionFlowOptions): UseRecognitionFlowReturn {
  const [recognition, setRecognition] = useState<RecognitionState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<RecognitionStatus>("idle");
  const [failureReason, setFailureReason] = useState<RecognitionFailureReason>(null);
  const statusRef = useRef<RecognitionStatus>("idle");
  statusRef.current = status;

  const isBusy = status !== "idle";

  const reset = useCallback(() => {
    setRecognition(null);
    setEditingId(null);
    setStatus("idle");
    setFailureReason(null);
    statusRef.current = "idle";
  }, []);

  const startRecognition = useCallback(
    async (imageBase64: string, thumbnail: string | null): Promise<boolean> => {
      if (statusRef.current !== "idle") {
        return false;
      }
      setStatus("recognizing");
      setFailureReason(null);
      statusRef.current = "recognizing";
      let outcome: RecognizeOutcome;
      try {
        outcome = await recognizeFood({ imageBase64 });
      } catch (err) {
        // Should not reach here because recognizeFood already converts
        // to an outcome, but keep the safety net.
        outcome = { ok: false, reason: "error", message: (err as Error).message };
      }
      if (!outcome.ok) {
        setStatus("idle");
        setFailureReason(outcome.reason);
        statusRef.current = "idle";
        if (outcome.reason === "no_food") {
          onNoFood?.();
        } else {
          onError(outcome.message ?? "识别失败，请重试");
        }
        return false;
      }
      setStatus("enriching");
      statusRef.current = "enriching";
      try {
        const enriched = await enrichWithDatabase(outcome.result);
        setRecognition({
          result: enriched,
          weights: enriched.foods.map((f) => f.weight_g),
          aiWeights: enriched.foods.map((f) => f.weight_g),
          imageDataUrl: imageBase64,
          thumbnailUrl: thumbnail,
          note: enriched.note || "",
        });
        setEditingId(null);
      } catch (err) {
        setStatus("idle");
        setFailureReason("error");
        statusRef.current = "idle";
        onError((err as Error).message || "营养数据获取失败");
        return false;
      }
      setStatus("idle");
      statusRef.current = "idle";
      return true;
    },
    [onError, onNoFood],
  );

  const loadDemo = useCallback(() => {
    if (statusRef.current !== "idle") return;
    const normalized = normalizeAiResult(DEMO_RECOGNITION);
    setRecognition({
      result: normalized,
      weights: normalized.foods.map((f: { weight_g: number }) => f.weight_g),
      aiWeights: normalized.foods.map((f: { weight_g: number }) => f.weight_g),
      imageDataUrl: null,
      thumbnailUrl: null,
      note: normalized.note || "演示数据用于体验克重调整和保存流程，未调用真实 API。",
    });
    setEditingId(null);
  }, []);

  const beginEdit = useCallback((record: Record) => {
    if (statusRef.current !== "idle") return;
    const editNote = `正在编辑：${record.mealType} ${new Date(record.timestamp).toLocaleString("zh-CN")}`;
    setRecognition({
      result: {
        foods: record.foods.map((f) => ({ ...f })),
        total_calories: record.totalCalories,
        note: editNote,
      },
      weights: record.foods.map((f: { weight_g: number }) => f.weight_g),
      aiWeights: record.foods.map((f: { weight_g: number }) => f.weight_g),
      imageDataUrl: null,
      thumbnailUrl: record.thumbnailUrl,
      note: editNote,
    });
    setEditingId(record.id);
  }, []);

  const changeWeight = useCallback((index: number, weight: number) => {
    setRecognition((prev) => {
      if (!prev) return prev;
      if (index < 0 || index >= prev.weights.length) return prev;
      const next = prev.weights.slice();
      next[index] = weight;
      return { ...prev, weights: next };
    });
  }, []);

  return {
    recognition,
    editingId,
    status,
    failureReason,
    isBusy,
    startRecognition,
    loadDemo,
    beginEdit,
    changeWeight,
    reset,
    setStatus,
  };
}
