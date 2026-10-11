import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TourStep { target: string; title: string; body: string; place: 'top' | 'bottom' | 'left' | 'right' }

const STEPS: TourStep[] = [
  { target: '.toolbar', title: 'Your tools', body: 'Everything for marking up a document floats here. Hover any tool to see its name and shortcut.', place: 'top' },
  { target: '.toolbar [aria-label="Highlight text"]', title: 'Highlight', body: 'Pick the highlighter, then drag across any text on the page.', place: 'top' },
  { target: '.toolbar [aria-label="Add text"]', title: 'Add text', body: 'Click anywhere on the page to type. Style it from the panel on the right.', place: 'top' },
  { target: '.toolbar [aria-label="Signature"]', title: 'Sign', body: 'Type, draw or upload your signature once, then place it in a click.', place: 'top' },
  { target: '.toolbar [aria-label="Redact"]', title: 'Redact for real', body: 'Unlike drawing a black box, redaction permanently removes the content from the file.', place: 'top' },
  { target: '.editor-side .side-tabs', title: 'Find your way', body: 'Page thumbnails, bookmarks, the outline, layouts and search all live in the sidebar.', place: 'right' },
  { target: '.right-panel', title: 'Properties', body: 'Options for the selected tool or object appear here. With nothing selected, you see every annotation.', place: 'left' },
  { target: '.topbar .btn-primary', title: 'Export', body: 'Save as PDF, PNG or JPG — with a password if you need one. Your changes also save automatically.', place: 'bottom' },
  { target: '.topbar [aria-label="Settings"]', title: 'Make it yours', body: 'Change the theme, accent color and defaults anytime from Settings (⌘,).', place: 'bottom' },
];

/* tiny global store so the tour can be started from anywhere (onboarding, Help menu) */
let setActive: (v: boolean) => void = () => {};
export const startTour = () => setActive(true);

export function TourHost() {
  const [active, set] = useState(false);
  useEffect(() => void (setActive = set), []);
  return active ? <Tour onClose={() => set(false)} /> : null;
}

function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const step = STEPS[i];

  // find the target; if it isn't on screen, skip forward rather than pointing at nothing
  useLayoutEffect(() => {
    let tries = 0, t = 0;
    const find = () => {
      const el = document.querySelector(step.target);
      const r = el?.getBoundingClientRect();
      if (r && r.width && r.height) return setRect(r);
      if (tries++ < 20) t = window.setTimeout(find, 100);
      else if (i < STEPS.length - 1) setI(i + 1);
      else onClose();
    };
    find();
    const onResize = () => { const r = document.querySelector(step.target)?.getBoundingClientRect(); if (r) setRect(r); };
    window.addEventListener('resize', onResize);
    return () => (clearTimeout(t), window.removeEventListener('resize', onResize));
  }, [i]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  const next = () => (i < STEPS.length - 1 ? setI(i + 1) : onClose());
  useEffect(() => void bubble.current?.querySelector<HTMLElement>(".btn-primary")?.focus(), [i]);

  const pad = 8;
  const hole = rect && { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  const pos: React.CSSProperties = {};
  if (hole) {
    const W = 320, gap = 16;
    if (step.place === 'top') Object.assign(pos, { left: clamp(hole.left + hole.width / 2 - W / 2, W), bottom: innerHeight - hole.top + gap });
    if (step.place === 'bottom') Object.assign(pos, { left: clamp(hole.left + hole.width / 2 - W / 2, W), top: hole.top + hole.height + gap });
    if (step.place === 'right') Object.assign(pos, { left: hole.left + hole.width + gap, top: Math.max(16, hole.top) });
    if (step.place === 'left') Object.assign(pos, { left: hole.left - W - gap, top: Math.max(16, hole.top + 40) });
  }

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label="Guided tour">
      {hole && <div className="tour-hole" style={hole} />}
      {hole && (
        <div ref={bubble} key={i} className={`tour-bubble glass place-${step.place}`} style={pos}>
          <div className="tour-count">{i + 1} of {STEPS.length}</div>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
          <div className="row-between">
            <button className="link muted" onClick={onClose}>Skip tour</button>
            <div className="row gap">
              {i > 0 && <button className="btn btn-sm" onClick={() => setI(i - 1)}>Back</button>}
              <button className="btn btn-sm btn-primary" onClick={next}>{i === STEPS.length - 1 ? 'Done' : 'Next'}</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

const clamp = (x: number, w: number) => Math.max(16, Math.min(innerWidth - w - 16, x));
