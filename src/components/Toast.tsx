import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';

interface ToastState { text: string; path?: string }
type Notify = (text: string, path?: string) => void;

const Ctx = createContext<Notify>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const notify = useCallback<Notify>((text, path) => {
    setToast({ text, path });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);
  return (
    <Ctx.Provider value={notify}>
      {children}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.path && <button type="button" onClick={() => api.reveal(toast.path!)}>Show in folder</button>}
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useNotify = () => useContext(Ctx);

/** Run an export and report the result. */
export function useExport() {
  const notify = useNotify();
  return useCallback(async (label: string, run: () => Promise<string | null>) => {
    try {
      const path = await run();
      if (path) notify(`${label} saved`, path);
    } catch (err) {
      notify(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [notify]);
}
