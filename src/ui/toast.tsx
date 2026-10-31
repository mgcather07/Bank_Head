import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastItem { id: number; text: string; action?: { label: string; run: () => void } }
interface ToastApi { show: (text: string, opts?: { action?: ToastItem['action']; ms?: number }) => void }
const Ctx = createContext<ToastApi>({ show: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const show = useCallback<ToastApi['show']>((text, opts) => {
    const id = ++seq.current;
    setItems((x) => [...x.slice(-2), { id, text, action: opts?.action }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), opts?.ms ?? 4500);
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">{items.map((t) => <div key={t.id} className="toast"><span>{t.text}</span>{t.action && <button onClick={() => { t.action!.run(); setItems((x) => x.filter((i) => i.id !== t.id)); }}>{t.action.label}</button>}</div>)}</div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
