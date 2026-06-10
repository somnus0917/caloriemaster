import { useCallback, useEffect, useState } from "react";
import type { Food, RecognitionResult, Record } from "./types";
import { HomePage } from "./pages/HomePage";
import { CameraPage } from "./pages/CameraPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { HistoryPage } from "./pages/HistoryPage";
import { TopNav } from "./components/layout/TopNav";
import { BottomNav } from "./components/layout/BottomNav";
import { LoadingOverlay } from "./components/common/LoadingOverlay";
import { SetupModal } from "./components/common/SetupModal";
import { ToastView } from "./components/common/Toast";
import { useRecords } from "./hooks/useRecords";
import { useSettings } from "./hooks/useSettings";
import { useToast } from "./hooks/useToast";
import { enrichWithDatabase } from "./services/boohee";
import { recognizeFood } from "./services/qwen";
import { downloadCSV } from "./utils/csv";
import { calculateFoodCalories } from "./utils/validation";
import { DEMO_RECOGNITION } from "./data/demoData";
import { normalizeAiResult } from "./services/qwen";

type Screen = "home" | "camera" | "confirm" | "history";

interface RecognitionState {
  result: RecognitionResult;
  weights: number[];
  aiWeights: number[];
  imageDataUrl: string | null;
  thumbnailUrl: string | null;
  note: string;
}

function describeError(message: string): string {
  if (message.includes("超时")) return message;
  if (message.includes("401") || message.includes("403"))
    return "API Key 无效或无权限，请检查配置";
  if (message.includes("429")) return "请求过于频繁，请稍后再试";
  if (message.includes("格式异常")) return "AI 返回异常，请重试";
  if (message.includes("Network") || message.includes("Failed"))
    return "网络错误，请检查连接后重试";
  return message || "识别失败，请重试";
}

export function App() {
  const { records, addRecord, updateRecord, removeRecord, restoreRecord, seedDemoIfEmpty } =
    useRecords();
  const { settings, update: updateSettings } = useSettings();
  const { toasts, showError, showToast, showUndo, dismiss } = useToast();

  const [screen, setScreen] = useState<Screen>("home");
  const [setupOpen, setSetupOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recognition, setRecognition] = useState<RecognitionState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (screen === "home" || screen === "history") {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [screen]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch(() => undefined);
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  const startRecognition = useCallback(
    async (imageBase64: string, thumbnail: string | null) => {
      setLoading(true);
      try {
        let result = await recognizeFood({ imageBase64 });
        result = await enrichWithDatabase(result);
        setRecognition({
          result,
          weights: result.foods.map((f) => f.weight_g),
          aiWeights: result.foods.map((f) => f.weight_g),
          imageDataUrl: imageBase64,
          thumbnailUrl: thumbnail,
          note: result.note || "",
        });
        setEditingId(null);
        setScreen("confirm");
      } catch (error) {
        showError(describeError((error as Error).message));
      } finally {
        setLoading(false);
      }
    },
    [showError],
  );

  const handleImagePicked = useCallback(
    async (image: { recognize: string; thumbnail: string | null }) => {
      await startRecognition(image.recognize, image.thumbnail);
    },
    [startRecognition],
  );

  const handleDemo = useCallback(() => {
    setSetupOpen(false);
    if (records.length === 0) {
      const seeded = seedDemoIfEmpty();
      if (seeded) showToast("已为你生成 7 天演示数据，方便看趋势图");
    }
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
    setScreen("confirm");
  }, [records.length, seedDemoIfEmpty, showToast]);

  const handleEdit = useCallback(
    (id: string) => {
      const record = records.find((r) => r.id === id);
      if (!record) return;
      setEditingId(id);
      setRecognition({
        result: {
          foods: record.foods.map((f) => ({ ...f })),
          total_calories: record.totalCalories,
          note: `正在编辑：${record.mealType} ${new Date(record.timestamp).toLocaleString("zh-CN")}`,
        },
        weights: record.foods.map((f) => f.weight_g),
        aiWeights: record.foods.map((f) => f.weight_g),
        imageDataUrl: null,
        thumbnailUrl: record.thumbnailUrl,
        note: `正在编辑：${record.mealType} ${new Date(record.timestamp).toLocaleString("zh-CN")}`,
      });
      setScreen("confirm");
    },
    [records],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const record = records.find((r) => r.id === id);
      if (!record) return;
      removeRecord(id);
      showUndo("记录已删除", () => restoreRecord(record));
    },
    [records, removeRecord, restoreRecord, showUndo],
  );

  const handleSave = useCallback(() => {
    if (!recognition) {
      showError("没有可保存的识别结果");
      return;
    }
    const { result, weights, thumbnailUrl, imageDataUrl } = recognition;
    if (!result.foods.length) {
      showError("没有可保存的识别结果");
      return;
    }
    try {
      // Important: read `editingId` BEFORE we mutate state so the toast
      // message accurately reflects whether we updated or created a record.
      const wasEditing = editingId !== null;
      if (wasEditing && editingId) {
        const updated = updateRecord(editingId, result.foods as Food[], weights);
        if (updated) {
          showToast("记录已更新");
        }
      } else {
        addRecord(
          result.foods as Food[],
          weights,
          thumbnailUrl ?? (imageDataUrl ? imageDataUrl : null),
        );
        showToast("已保存到今日记录");
      }
      setRecognition(null);
      setEditingId(null);
      setScreen("home");
    } catch (error) {
      showError((error as Error).message || "保存失败");
    }
  }, [recognition, editingId, updateRecord, addRecord, showToast, showError]);

  const handleWeightChange = useCallback((index: number, weight: number) => {
    setRecognition((prev) => {
      if (!prev) return prev;
      const next = prev.weights.slice();
      next[index] = weight;
      return { ...prev, weights: next };
    });
  }, []);

  const handleExport = useCallback(() => {
    if (!records.length) {
      showToast("暂无记录可导出");
      return;
    }
    downloadCSV(records);
    showToast(`已导出 ${records.length} 条记录`);
  }, [records, showToast]);

  const isFullFlow = screen === "camera" || screen === "confirm";
  const totalForConfirm = recognition
    ? recognition.result.foods.reduce(
        (sum, food, i) => sum + calculateFoodCalories(food, recognition.weights[i] ?? food.weight_g),
        0,
      )
    : 0;

  return (
    <div className="app-shell">
      <div className={isFullFlow ? "hidden" : ""}>
        <TopNav
          onExport={handleExport}
          onSettings={() => setSetupOpen(true)}
        />
      </div>

      {screen === "home" && (
        <HomePage
          records={records}
          settings={settings}
          onGoCamera={() => setScreen("camera")}
          onGoHistory={() => setScreen("history")}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onDaySelect={() => showToast("所选日期没有记录")}
        />
      )}
      {screen === "camera" && (
        <CameraPage
          onImagePicked={handleImagePicked}
          onError={showError}
          onBack={() => setScreen("home")}
          onDemo={handleDemo}
        />
      )}
      {screen === "confirm" && (
        <ConfirmPage
          result={recognition?.result ?? null}
          weights={recognition?.weights ?? []}
          aiWeights={recognition?.aiWeights ?? []}
          imageDataUrl={recognition?.imageDataUrl ?? null}
          note={recognition?.note ?? ""}
          editing={editingId !== null}
          saving={loading}
          onWeightChange={handleWeightChange}
          onSave={handleSave}
          onBack={() => setScreen("camera")}
        />
      )}
      {screen === "history" && (
        <HistoryPage
          records={records as Record[]}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onBack={() => setScreen("home")}
        />
      )}

      <div className={isFullFlow ? "bottom-bar hidden" : "bottom-bar"}>
        <BottomNav onHome={() => setScreen("home")} onHistory={() => setScreen("history")} />
      </div>

      <LoadingOverlay show={loading} />

      <SetupModal
        open={setupOpen}
        settings={settings}
        onSave={updateSettings}
        onClose={() => setSetupOpen(false)}
        onDemo={handleDemo}
      />

      <div id="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={dismiss} onUndo={t.onUndo} />
        ))}
      </div>

      <span hidden data-testid="total-calories-hidden">{totalForConfirm}</span>
    </div>
  );
}
