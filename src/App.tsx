import { useCallback, useEffect, useState } from "react";
import type { Food, RecognitionResult, Record } from "./types";
import { HomePage } from "./pages/HomePage";
import { CameraPage } from "./pages/CameraPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { HistoryPage } from "./pages/HistoryPage";
import { EditPage } from "./pages/EditPage";
import { AuthForm } from "./pages/AuthForm";
import { TopNav } from "./components/layout/TopNav";
import { BottomNav } from "./components/layout/BottomNav";
import { LoadingOverlay } from "./components/common/LoadingOverlay";
import { SetupModal } from "./components/common/SetupModal";
import { ToastView } from "./components/common/Toast";
import { MigrationPrompt } from "./components/common/MigrationPrompt";
import { useRecords } from "./hooks/useRecords";
import { useSettings } from "./hooks/useSettings";
import { useToast } from "./hooks/useToast";
import { useAuth } from "./hooks/useAuth";
import { useRecognitionFlow } from "./hooks/useRecognitionFlow";
import { downloadCSV } from "./utils/csv";
import { calculateFoodCalories } from "./utils/validation";
import { hasPendingMigration } from "./services/migrate";

type Screen = "home" | "camera" | "confirm" | "history" | "edit";
type AuthMode = "login" | "register";

export function App() {
  const auth = useAuth();
  // Gate data hooks on auth status so they don't fire 401 requests
  // before the user logs in. Without this, the initial fetch fails,
  // state stays null, and the app appears stuck on a loading spinner.
  const records = useRecords(auth.status === "authenticated");
  const { settings, update: updateSettings } = useSettings(auth.status === "authenticated");
  const { toasts, showError, showToast, showUndo, dismiss } = useToast();

  const [screen, setScreen] = useState<Screen>("home");
  const [setupOpen, setSetupOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [showMigration, setShowMigration] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Record | null>(null);

  const recognitionFlow = useRecognitionFlow({
    onError: (message) => showError(message),
    onNoFood: () => showError("没有识别到食物，请重新拍摄"),
  });
  const {
    recognition,
    editingId,
    status,
    isBusy,
    startRecognition,
    loadDemo,
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

    const unregisterLegacy = async () => {
      // Force-remove any pre-existing SW (especially old CACHE_NAME
      // values) so a browser with a stale bundle picks up the latest
      // JS and AuthForm code on next reload.
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.map((r) =>
          r.unregister().catch(() => undefined),
        ),
      );
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k).catch(() => undefined)));
      }
    };

    const onLoad = () => {
      void unregisterLegacy().then(() => {
        // Re-register so future deploys are still served from cache.
        navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  // When the user becomes authenticated, see if they have legacy
  // localStorage data to import.
  useEffect(() => {
    if (auth.status === "authenticated" && hasPendingMigration()) {
      setShowMigration(true);
    }
  }, [auth.status]);

  const handleImagePicked = useCallback(
    async (image: { recognize: string; thumbnail: string | null }) => {
      if (isBusy) return;
      const ok = await startRecognition(image.recognize, image.thumbnail);
      if (ok) {
        setScreen("confirm");
      }
      // On failure, stay on the camera page so the user can retry.
    },
    [isBusy, startRecognition],
  );

  const handleDemo = useCallback(() => {
    if (isBusy) return;
    setSetupOpen(false);
    void records.seedDemoIfEmpty().then((seeded) => {
      if (seeded) showToast("已为你生成 7 天演示数据，方便看趋势图");
      loadDemo();
      setScreen("confirm");
    });
  }, [isBusy, records, showToast, loadDemo]);

  const handleEdit = useCallback(
    (id: string) => {
      const record = records.records.find((r) => r.id === id);
      if (!record) return;
      setEditingRecord(record);
      setScreen("edit");
    },
    [records.records],
  );

  const handleDelete = useCallback(
    (id: string) => {
      void records
        .removeRecord(id)
        .then((removed) => {
          if (!removed) return;
          showUndo("记录已删除", () => {
            void records.restoreRecord(removed, {
              dataUrl: recognition?.imageDataUrl ?? undefined,
            });
          });
        })
        .catch((err: Error) => {
          showError(err.message || "删除失败");
        });
    },
    [records, showUndo, showError, recognition?.imageDataUrl],
  );

  const handleSave = useCallback(() => {
    if (!recognition) {
      showError("没有可保存的识别结果");
      return;
    }
    if (recognition.result.foods.length === 0) {
      showError("没有可保存的识别结果");
      return;
    }
    const wasEditing = editingId !== null;
    const { result, weights, thumbnailUrl } = recognition;
    const thumbnail = thumbnailUrl ? { dataUrl: thumbnailUrl } : null;
    const promise = wasEditing && editingId
      ? records.updateRecord(editingId, result.foods as Food[], weights).then((r) => (r ? "updated" : null))
      : records.addRecord(result.foods as Food[], weights, thumbnail).then(() => "created");
    promise
      .then((status) => {
        if (status === "updated") showToast("记录已更新");
        if (status === "created") showToast("已保存到今日记录");
        resetRecognition();
        setScreen("home");
      })
      .catch((err: Error) => {
        showError(err.message || "保存失败");
      });
  }, [recognition, editingId, records, showToast, showError, resetRecognition]);

  const handleCancelConfirm = useCallback(() => {
    resetRecognition();
    setScreen("camera");
  }, [resetRecognition]);

  const handleEditSave = useCallback(
    (id: string, weights: number[]) => {
      if (!editingRecord) return;
      records
        .updateRecord(id, editingRecord.foods as Food[], weights)
        .then((r) => {
          if (r) {
            showToast("记录已更新");
            setEditingRecord(null);
            setScreen("home");
          }
        })
        .catch((err: Error) => {
          showError(err.message || "保存失败");
        });
    },
    [editingRecord, records, showToast, showError],
  );

  const handleEditBack = useCallback(() => {
    setEditingRecord(null);
    setScreen("home");
  }, []);

  const handleExport = useCallback(() => {
    if (!records.records.length) {
      showToast("暂无记录可导出");
      return;
    }
    downloadCSV(records.records);
    showToast(`已导出 ${records.records.length} 条记录`);
  }, [records.records, showToast]);

  const handleLogout = useCallback(async () => {
    await auth.logout();
    setScreen("home");
  }, [auth]);

  // ---- Render branches ----

  if (auth.status === "loading") {
    return (
      <div className="app-shell">
        <div className="boot-screen">
          <div className="spinner" />
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <div className="app-shell">
        <AuthForm
          mode={authMode}
          onSwitch={() => setAuthMode((m) => (m === "login" ? "register" : "login"))}
          onLogin={auth.login}
          onRegister={auth.register}
        />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="app-shell">
        <div className="boot-screen">
          <div className="spinner" />
          <p>加载设置...</p>
        </div>
      </div>
    );
  }

  const isFullFlow = screen === "camera" || screen === "confirm" || screen === "edit";
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
          records={records.records}
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
          records={records.records}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onBack={() => setScreen("home")}
        />
      )}
      {screen === "edit" && editingRecord && (
        <EditPage
          record={editingRecord}
          onSave={handleEditSave}
          onBack={handleEditBack}
          saving={isBusy}
        />
      )}

      {!isFullFlow ? (
        <BottomNav
          active={screen === "history" ? "history" : "home"}
          onHome={() => setScreen("home")}
          onHistory={() => setScreen("history")}
        />
      ) : null}

      <LoadingOverlay show={isBusy} stage={status} />

      <SetupModal
        open={setupOpen}
        settings={settings}
        onSave={(s) => {
          void updateSettings(s);
        }}
        onClose={() => setSetupOpen(false)}
        onDemo={handleDemo}
        onLogout={handleLogout}
      />

      {showMigration ? (
        <MigrationPrompt
          onDone={() => {
            setShowMigration(false);
            void records.reload();
          }}
          onSkip={() => setShowMigration(false)}
        />
      ) : null}

      <div id="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={dismiss} onUndo={t.onUndo} />
        ))}
      </div>

      <span hidden data-testid="total-calories-hidden">{totalForConfirm}</span>
    </div>
  );
}

// Suppress TS unused-var check when Record is only used in the type tree.
void (null as unknown as Record);
