import { useCallback, useRef, useState } from "react";
import type { RecognitionResult, Record } from "../types";
import { enrichWithDatabase } from "../services/boohee";
import { recognizeFood } from "../services/qwen";
import { DEMO_RECOGNITION } from "../data/demoData";
import { normalizeAiResult } from "../services/qwen";

/**
 * Phases of the recognition pipeline. Kept as a small union so the UI
 * can show different copy and so we can reject duplicate submissions.
 */
export type RecognitionStatus = "idle" | "recognizing" | "enriching";

export interface RecognitionState {
  result: RecognitionResult;
  weights: number[];
  aiWeights: number[];
  /**
   * The compressed (1024px) image is held in memory ONLY while the
   * user is on the camera/confirm screen. It MUST NOT be passed into
   * `addRecord` — `addRecord` only accepts the small thumbnail.
   */
  imageDataUrl: string | null;
  thumbnailUrl: string | null;
  note: string;
}

export interface UseRecognitionFlowOptions {
  onError: (message: string) => void;
}

export interface UseRecognitionFlowReturn {
  recognition: RecognitionState | null;
  editingId: string | null;
  status: RecognitionStatus;
  isBusy: boolean;
  startRecognition: (imageBase64: string, thumbnail: string | null) => Promise<void>;
  loadDemo: () => void;
  beginEdit: (record: Record) => void;
  changeWeight: (index: number, weight: number) => void;
  reset: () => void;
  setStatus: (status: RecognitionStatus) => void;
}

/**
 * Owns the recognition-related state machine: a transient
 * `RecognitionState` plus a `RecognitionStatus` that mirrors the
 * current phase of the pipeline.
 *
 * IMPORTANT: the full 1024px image (`imageDataUrl`) is held inside
 * this hook and dropped via `reset()`. `thumbnailUrl` is the only
 * image that may leave this hook (through `beginEdit` / `loadDemo`
 * returning a snapshot that the caller can persist). The full
 * recognition image is never persisted.
 */
export function useRecognitionFlow({
  onError,
}: UseRecognitionFlowOptions): UseRecognitionFlowReturn {
  const [recognition, setRecognition] = useState<RecognitionState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<RecognitionStatus>("idle");
  // Ref mirrors status so `startRecognition` can early-out if a previous
  // call is still in flight, even before React re-renders.
  const statusRef = useRef<RecognitionStatus>("idle");
  statusRef.current = status;

  const isBusy = status !== "idle";

  const reset = useCallback(() => {
    setRecognition(null);
    setEditingId(null);
    setStatus("idle");
    statusRef.current = "idle";
  }, []);

  const startRecognition = useCallback(
    async (imageBase64: string, thumbnail: string | null) => {
      if (statusRef.current !== "idle") {
        // Drop the in-memory image so we don't keep a 1024px base64
        // blob around if the user spam-taps the camera button.
        return;
      }
      setStatus("recognizing");
      statusRef.current = "recognizing";
      try {
        const aiResult = await recognizeFood({ imageBase64 });
        setStatus("enriching");
        statusRef.current = "enriching";
        const enriched = await enrichWithDatabase(aiResult);
        setRecognition({
          result: enriched,
          weights: enriched.foods.map((f) => f.weight_g),
          aiWeights: enriched.foods.map((f) => f.weight_g),
          imageDataUrl: imageBase64,
          thumbnailUrl: thumbnail,
          note: enriched.note || "",
        });
        setEditingId(null);
      } catch (error) {
        onError((error as Error).message || "识别失败，请重试");
      } finally {
        setStatus("idle");
        statusRef.current = "idle";
      }
    },
    [onError],
  );

  const loadDemo = useCallback(() => {
    if (statusRef.current !== "idle") return;
    const normalized = normalizeAiResult(DEMO_RECOGNITION);
    setRecognition({
      result: normalized,
      weights: normalized.foods.map((f) => f.weight_g),
      aiWeights: normalized.foods.map((f) => f.weight_g),
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
      weights: record.foods.map((f) => f.weight_g),
      aiWeights: record.foods.map((f) => f.weight_g),
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
    isBusy,
    startRecognition,
    loadDemo,
    beginEdit,
    changeWeight,
    reset,
    setStatus,
  };
}
