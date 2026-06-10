import { useCallback, useRef, useState } from "react";

export type ToastVariant = "info" | "error" | "undo";

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  /** When set, an "撤销" button is shown for 5 seconds. */
  onUndo?: () => void;
  durationMs?: number;
}

let toastId = 0;

export interface UseToastReturn {
  toasts: Toast[];
  showToast: (message: string, options?: { variant?: ToastVariant; durationMs?: number }) => void;
  showError: (message: string) => void;
  showUndo: (message: string, onUndo: () => void) => void;
  dismiss: (id: number) => void;
}

export function useToast(): UseToastReturn {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timerRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timerRefs.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timerRefs.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = ++toastId;
      const full: Toast = { id, ...toast };
      setToasts((prev) => [...prev, full]);
      const duration = toast.durationMs ?? 3000;
      const timer = setTimeout(() => dismiss(id), duration);
      timerRefs.current.set(id, timer);
    },
    [dismiss],
  );

  const showToast = useCallback(
    (message: string, options?: { variant?: ToastVariant; durationMs?: number }) => {
      push({ message, variant: options?.variant ?? "info", durationMs: options?.durationMs ?? 3000 });
    },
    [push],
  );

  const showError = useCallback(
    (message: string) => {
      push({ message, variant: "error" });
    },
    [push],
  );

  const showUndo = useCallback(
    (message: string, onUndo: () => void) => {
      push({ message, variant: "undo", onUndo, durationMs: 5000 });
    },
    [push],
  );

  return { toasts, showToast, showError, showUndo, dismiss };
}
