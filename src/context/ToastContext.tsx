import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

const icons = { success: CheckCircle2, error: XCircle, info: Info };
const tones = {
  success: 'border-emerald-200 text-emerald-800',
  error: 'border-red-200 text-red-800',
  info: 'border-slate-200 text-slate-800',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((list) => list.filter((t) => t.id !== id));

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, tone, message }]);
    setTimeout(() => dismiss(id), 5000);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite" role="status">
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div key={t.id} className={`pointer-events-auto flex items-start gap-3 rounded-lg border bg-white p-3 text-sm shadow-lg ${tones[t.tone]}`}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="flex-1">{t.message}</p>
              <button type="button" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-slate-400 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600" aria-label="Dismiss notification">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
