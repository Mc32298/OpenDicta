import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastTone = "ok" | "err" | "info";

interface ToastState {
  text: string;
  tone: ToastTone;
}

interface ToastCtx {
  showOk: (text: string) => void;
  showErr: (text: string) => void;
  showInfo: (text: string) => void;
}

const ToastContext = createContext<ToastCtx>({
  showOk: () => {},
  showErr: () => {},
  showInfo: () => {},
});

export function useToast(): ToastCtx {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = useCallback((text: string, tone: ToastTone) => {
    clearTimer();
    setExiting(false);
    setToast({ text, tone });
    const delay = tone === "err" ? 6000 : 3000;
    timerRef.current = window.setTimeout(() => {
      setExiting(true);
      timerRef.current = window.setTimeout(() => {
        setToast(null);
        setExiting(false);
      }, 300);
    }, delay);
  }, []);

  useEffect(() => () => clearTimer(), []);

  const showOk = useCallback((t: string) => show(t, "ok"), [show]);
  const showErr = useCallback((t: string) => show(t, "err"), [show]);
  const showInfo = useCallback((t: string) => show(t, "info"), [show]);

  return (
    <ToastContext.Provider value={{ showOk, showErr, showInfo }}>
      {children}
      {toast && (
        <div
          className={`wv-toast wv-toast--${toast.tone}${exiting ? " wv-toast--out" : " wv-toast--in"}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="wv-toast-dot" />
          {toast.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}
