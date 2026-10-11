import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

export function IconBtn(props: {
  icon: ReactNode; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; tipBelow?: boolean; shortcut?: string; className?: string;
}) {
  const tip = props.shortcut ? `${props.label}  ${props.shortcut}` : props.label;
  return (
    <button
      type="button"
      className={`icon-btn ${props.active ? 'is-active' : ''} ${props.className ?? ''}`}
      aria-label={props.label}
      aria-pressed={props.active}
      data-tip={tip}
      data-tip-pos={props.tipBelow ? 'below' : undefined}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.icon}
    </button>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; icon?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, button.btn-primary, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return props.onClose();
      if (e.key !== 'Tab' || !ref.current) return;
      // keep keyboard focus inside the dialog
      const f = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) (e.preventDefault(), f[f.length - 1].focus());
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) (e.preventDefault(), f[0].focus());
    };
    window.addEventListener('keydown', onKey);
    return () => (window.removeEventListener('keydown', onKey), prev?.focus());
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={props.title} ref={ref} style={{ width: props.width }}>
        <header className="modal-head">
          {props.icon}
          <h2>{props.title}</h2>
          <IconBtn icon={<X size={16} />} label="Close" onClick={props.onClose} tipBelow />
        </header>
        <div className="modal-body">{props.children}</div>
        {props.footer && <footer className="modal-foot">{props.footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- tooltips: one fixed element so scrolling panels never clip them ---------- */
export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; r: DOMRect; pos: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cur: Element | null = null, timer = 0;
    const show = (el: HTMLElement) =>
      el.dataset.tip && setTip({ text: el.dataset.tip, r: el.getBoundingClientRect(), pos: el.dataset.tipPos ?? (el.closest('.rail, .collapsed') ? 'right' : '') });
    const hide = () => { cur = null; clearTimeout(timer); setTip(null); };
    const over = (e: PointerEvent) => {
      const el = (e.target as Element).closest?.<HTMLElement>('[data-tip]') ?? null;
      if (el === cur) return;
      hide();
      cur = el;
      if (el) timer = window.setTimeout(() => show(el), 400);
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as Element).closest?.<HTMLElement>('[data-tip]');
      if (el?.matches(':focus-visible')) show(el);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('pointerover', over);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('keydown', key);
    };
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const { r, pos } = tip, w = el.offsetWidth, h = el.offsetHeight, gap = 8;
    let x: number, y: number;
    if (pos === 'right') (x = r.right + gap), (y = r.top + r.height / 2 - h / 2);
    else {
      x = r.left + r.width / 2 - w / 2;
      y = pos === 'below' || r.top - h - gap < 4 ? r.bottom + gap : r.top - h - gap;
    }
    el.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, x))}px`;
    el.style.top = `${Math.max(4, Math.min(innerHeight - h - 4, y))}px`;
  }, [tip]);
  if (!tip) return null;
  const [label, shortcut] = tip.text.split('  ');
  return createPortal(<div ref={ref} className="tooltip" role="tooltip">{label}{shortcut && <kbd>{shortcut}</kbd>}</div>, document.body);
}

/* ---------- toasts ---------- */
type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string; action?: { label: string; run: () => void } };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random();
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.kind === 'error' ? 8000 : 4000);
  }, []);
  const icon = { success: <CheckCircle2 size={16} />, error: <XCircle size={16} />, info: <Info size={16} /> };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {icon[t.kind]}
            <span>{t.text}</span>
            {t.action && <button className="toast-action" onClick={t.action.run}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- context / dropdown menu ---------- */
export type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; onClick?: () => void; submenu?: MenuItem[]; disabled?: boolean } | 'sep';

export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const [sub, setSub] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = [...(ref.current?.querySelectorAll<HTMLElement>(':scope > .menu-row > button') ?? [])];
        const i = btns.indexOf(document.activeElement as HTMLElement);
        btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
      }
    };
    setTimeout(() => window.addEventListener('mousedown', close));
    window.addEventListener('keydown', key);
    return () => (window.removeEventListener('mousedown', close), window.removeEventListener('keydown', key));
  }, []);
  const left = Math.min(x, window.innerWidth - 230), top = Math.min(y, window.innerHeight - items.length * 32 - 16);
  return (
    <div className="menu" role="menu" ref={ref} style={{ left, top }}>
      {items.map((it, i) =>
        it === 'sep' ? (
          <hr key={i} />
        ) : (
          <div key={i} className="menu-row" onMouseEnter={() => setSub(it.submenu ? i : null)}>
            <button
              role="menuitem"
              aria-haspopup={it.submenu ? 'menu' : undefined}
              aria-expanded={it.submenu ? sub === i : undefined}
              className={`menu-item ${it.danger ? 'danger' : ''} ${sub === i ? 'open' : ''}`}
              disabled={it.disabled}
              onClick={() => (it.submenu ? setSub(i) : (it.onClick?.(), onClose()))}
              onKeyDown={(e) => it.submenu && e.key === 'ArrowRight' && (setSub(i), setTimeout(() => (e.currentTarget.nextElementSibling?.querySelector('button') as HTMLElement | null)?.focus()))}
            >
              {it.icon}
              <span>{it.label}</span>
              {it.submenu && <span className="menu-caret">›</span>}
            </button>
            {it.submenu && sub === i && (
              <div className="menu submenu" role="menu">
                {it.submenu.map((s, k) =>
                  s === 'sep' ? <hr key={k} /> : (
                    <button key={k} role="menuitem" className="menu-item" onClick={() => (s.onClick?.(), onClose())}>
                      {s.icon}
                      <span>{s.label}</span>
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" role="switch" className="toggle" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} aria-label={o.title} data-tip={o.title}
          className={o.value === value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- helpers ---------- */
export const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

export function fmtAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'Yesterday';
  return `${Math.floor(s / 86400)} days ago`;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Normalise any browser-decodable image into a PNG/JPEG data URL (the formats PDFs can embed), capped in size. */
export async function toEmbeddable(src: Blob | string, max = 1600): Promise<{ src: string; w: number; h: number }> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error('That image could not be loaded. It may be an unsupported format or blocked by its host.');
  }
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  if (typeof src !== 'string') URL.revokeObjectURL(url);
  const jpeg = typeof src !== 'string' && src.type === 'image/jpeg';
  try {
    return { src: c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9), w: c.width, h: c.height };
  } catch {
    throw new Error("That image's host doesn't allow it to be used in documents (CORS). Download it and upload the file instead.");
  }
}

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}
