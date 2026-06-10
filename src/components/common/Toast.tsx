import type { Toast as ToastModel } from "../../hooks/useToast";

interface ToastProps {
  toast: ToastModel;
  onDismiss: (id: number) => void;
  onUndo?: () => void;
}

export function ToastView({ toast, onDismiss, onUndo }: ToastProps) {
  if (toast.variant === "undo") {
    return (
      <div className="toast toast-undo" role="status">
        <span>{toast.message}</span>
        <button
          type="button"
          className="toast-undo-btn"
          onClick={() => {
            onUndo?.();
            onDismiss(toast.id);
          }}
        >
          撤销
        </button>
      </div>
    );
  }
  return (
    <div
      className={`toast${toast.variant === "error" ? " toast-error" : ""}`}
      role="status"
      onClick={() => onDismiss(toast.id)}
    >
      {toast.message}
    </div>
  );
}
