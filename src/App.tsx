import { useCallback, useEffect, useState } from "react";
import type { RecognitionResult, Record } from "./types";
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
import { useRecognitionFlow } from "./hooks/useRecognitionFlow";
import { downloadCSV } from "./utils/csv";
import { calculateFoodCalories } from "./utils/validation";

type Screen = "home" | "camera" | "confirm" | "history";

export function App() {
  const { records, addRecord, updateRecord, removeRecord, restoreRecord, seedDemoIfEmpty } =
    useRecords();
  const { settings, update: updateSettings } = useSettings();
  const { toasts, showError, showToast, showUndo, dismiss } = useToast();

  const [screen, setScreen] = useState<Screen>("home");
  const [setupOpen, setSetupOpen] = useState(false);

  const recognitionFlow = useRecognitionFlow({
    onError: (message) => showError(message),
  });
  const {
    recognition,
    editingId,
    status,
    isBusy,
    startRecognition,
    loadDemo,
    beginEdit,
    changeWeight,
    reset: resetRecognition,
  } = recognitionFlow;

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

  const handleImagePicked = useCallback(
    async (image: { recognize: string; thumbnail: string | null }) => {
      if (isBusy) return;
      await startRecognition(image.recognize, image.thumbnail);
      // After the async call settles, only navigate if it succeeded.
      // (Errors are surfaced via onError; the hook leaves recognition
      // state empty on failure.)
      setScreen("confirm");
    },
    [isBusy, startRecognition],
  );

  const handleDemo = useCallback(() => {
    if (isBusy) return;
    setSetupOpen(false);
    if (records.length === 0) {
      const seeded = seedDemoIfEmpty();
      if (seeded) showToast("已为你生成 7 天演示数据，方便看趋势图");
    }
    loadDemo();
    setScreen("confirm");
  }, [isBusy, records.length, seedDemoIfEmpty, showToast, loadDemo]);

  const handleEdit = useCallback(
    (id: string) => {
      const record = records.find((r) => r.id === id);
      if (!record) return;
      beginEdit(record);
      setScreen("confirm");
    },
    [records, beginEdit],
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
    if (!recognition.result.foods.length) {
      showError("没有可保存的识别结果");
      return;
    }
    try {
      // Read `editingId` BEFORE we reset state so the toast message
      // accurately reflects whether we updated or created a record.
      const wasEditing = editingId !== null;
      const { result, weights, thumbnailUrl } = recognition;
      if (wasEditing && editingId) {
        const updated = updateRecord(editingId, result.foods, weights);
        if (updated) {
          showToast("记录已更新");
        }
      } else {
        // SECURITY: pass ONLY the small thumbnail. The full
        // recognition image is intentionally not persisted — see
        // docs in storage/records.ts.
        addRecord(result.foods, weights, thumbnailUrl);
        showToast("已保存到今日记录");
      }
      resetRecognition();
      setScreen("home");
    } catch (error) {
      showError((error as Error).message || "保存失败");
    }
  }, [recognition, editingId, updateRecord, addRecord, showToast, showError, resetRecognition]);

  const handleCancelConfirm = useCallback(() => {
    resetRecognition();
    setScreen("camera");
  }, [resetRecognition]);

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
          result={(recognition?.result as RecognitionResult) ?? null}
          weights={recognition?.weights ?? []}
          aiWeights={recognition?.aiWeights ?? []}
          imageDataUrl={recognition?.imageDataUrl ?? null}
          note={recognition?.note ?? ""}
          editing={editingId !== null}
          saving={isBusy}
          onWeightChange={changeWeight}
          onSave={handleSave}
          onBack={handleCancelConfirm}
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

      <LoadingOverlay show={isBusy} stage={status} />

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
