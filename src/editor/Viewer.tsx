import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { pdfjs, textRuns, type TextRun } from '../lib/pdf';
import { uid } from '../lib/store';
import { bbox, inkPath, norm, translate, resize } from '../lib/geom';
import type { Annot, Rect, Tool } from '../lib/types';
import { useEditor, type EditorApi } from './ctx';
import { AnnotLayer } from './AnnotLayer';

const PAD = 32;
/** rAF, with a timer fallback because background tabs pause animation frames. */
const nextFrame = (fn: () => void) => {
  let done = false;
  const run = () => !done && ((done = true), fn());
  requestAnimationFrame(run);
  setTimeout(run, 50);
};
const TEXT_TOOLS: Tool[] = ['select', 'highlight', 'underline', 'strike'];

export function Viewer({ primary }: { primary?: boolean }) {
  const ed = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 800, h: 600, top: 0 });
  const { spread, continuous, gaps, numbers } = ed.layout;
  const gapY = gaps ? 20 : 0, gapX = gaps ? 16 : 0, labelH = numbers ? 22 : 0;
  const z = ed.zoom;
  const order = ed.state.pageOrder;

  const { rows, total, maxW } = useMemo(() => {
    const groups: number[][] = [];
    for (let i = 0; i < order.length; i += spread) groups.push(Array.from({ length: Math.min(spread, order.length - i) }, (_, k) => i + k));
    const shown = continuous ? groups : [groups[Math.min(groups.length - 1, Math.floor(ed.current / spread))]];
    let y = PAD, maxW = 0;
    const rows = shown.map((pages) => {
      const sz = pages.map((d) => ed.sizes[order[d]]);
      const height = Math.max(...sz.map((s) => s.h * z));
      const width = sz.reduce((t, s) => t + s.w * z, 0) + gapX * (pages.length - 1);
      const row = { pages, top: y, height, width };
      y += height + labelH + gapY;
      maxW = Math.max(maxW, width);
      return row;
    });
    return { rows, total: y - gapY + PAD, maxW };
  }, [order, ed.sizes, z, spread, continuous, gapX, gapY, labelH, ed.current]);

  const contentW = Math.max(vp.w, maxW + PAD * 2);
  const latest = useRef({ rows, vp, z });
  latest.current = { rows, vp, z };

  // remember where the reader is, so zoom/layout/panel changes keep them in place
  const anchor = useRef({ page: 0, frac: 0 });
  const onScroll = () => {
    const el = ref.current!;
    setVp((v) => ({ ...v, top: el.scrollTop }));
    const probe = el.scrollTop + el.clientHeight / 3;
    const row = rows.find((r) => probe < r.top + r.height + labelH + gapY) ?? rows[rows.length - 1];
    if (!row) return;
    anchor.current = { page: row.pages[0], frac: (el.scrollTop - row.top) / row.height };
    if (primary && continuous && row.pages[0] !== ed.current) ed.setCurrent(row.pages[0]);
  };
  useLayoutEffect(() => {
    const el = ref.current!;
    const row = rows.find((r) => r.pages.includes(anchor.current.page));
    if (row && continuous) el.scrollTop = row.top + anchor.current.frac * row.height;
    if (!continuous) el.scrollTop = 0;
    setVp((v) => ({ ...v, top: el.scrollTop })); // virtualization must follow even if no scroll event fires
  }, [z, spread, gaps, numbers, continuous, continuous || ed.current]);

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight, top: el.scrollTop }));
    ro.observe(el);
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      ed_.current.setZoom(latest.current.z * Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => (ro.disconnect(), el.removeEventListener('wheel', wheel));
  }, []);
  const ed_ = useRef<EditorApi>(ed);
  ed_.current = ed;

  // fit modes follow the available space (e.g. when a sidebar opens)
  useEffect(() => {
    if (!primary || !ed.fit) return;
    const widest = Math.max(...Array.from({ length: Math.ceil(order.length / spread) }, (_, g) =>
      order.slice(g * spread, g * spread + spread).reduce((t, s) => t + ed.sizes[s].w, 0)));
    const tallest = Math.max(...order.map((s) => ed.sizes[s].h));
    const avail = vp.w - PAD * 2 - gapX * (spread - 1);
    let next = avail / widest;
    if (ed.fit === 'page') next = Math.min(next, (vp.h - PAD * 2 - labelH) / tallest);
    if (Math.abs(next - z) > 0.002) ed.setZoom(next, ed.fit);
  }, [ed.fit, vp.w, vp.h, spread, order, labelH]);

  // jump-to-page
  useEffect(() => {
    const go = (d: number, rect?: Rect) => {
      nextFrame(() => {
        const { rows, vp, z } = latest.current;
        const row = rows.find((r) => r.pages.includes(d));
        if (!row || !ref.current) return;
        const top = row.top + (rect ? rect.y * z - vp.h / 3 : -PAD / 2);
        anchor.current = { page: row.pages[0], frac: (top - row.top) / row.height }; // survive a zoom/fit that lands right after
        ref.current.scrollTo({ top, behavior: rect ? 'smooth' : 'auto' });
        if (!rect) setVp((v) => ({ ...v, top: ref.current!.scrollTop })); // render the target pages now, not on the next scroll event
      });
    };
    ed.scrollers.add(go);
    return () => void ed.scrollers.delete(go);
  }, []);

  // hand tool panning
  const pan = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const onDown = (e: RPE) => {
    if (ed.tool !== 'hand') return;
    pan.current = { x: e.clientX, y: e.clientY, l: ref.current!.scrollLeft, t: ref.current!.scrollTop };
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
  };
  const onMove = (e: RPE) => {
    if (!pan.current) return;
    ref.current!.scrollLeft = pan.current.l - (e.clientX - pan.current.x);
    ref.current!.scrollTop = pan.current.t - (e.clientY - pan.current.y);
  };

  const visible = rows.filter((r) => r.top + r.height > vp.top - vp.h && r.top < vp.top + vp.h * 2);
  return (
    <div ref={ref} className={`viewer tool-${ed.tool} ${pan.current ? 'panning' : ''}`} onScroll={onScroll}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (pan.current = null)} tabIndex={-1} aria-label="Document pages">
      <div className="viewer-inner" style={{ height: total, width: contentW }}>
        {visible.map((row) => {
          let x = (contentW - row.width) / 2;
          return row.pages.map((d) => {
            const s = ed.sizes[order[d]];
            const left = x;
            x += s.w * z + gapX;
            return <PageView key={order[d]} display={d} src={order[d]} left={left} top={row.top} />;
          });
        })}
      </div>
      {!continuous && (
        <div className="pager">
          <button className="btn btn-sm" disabled={ed.current < spread} onClick={() => ed.goto(ed.current - spread)}>Previous</button>
          <span className="small">Page {ed.current + 1} of {order.length}</span>
          <button className="btn btn-sm" disabled={ed.current + spread >= order.length} onClick={() => ed.goto(ed.current + spread)}>Next</button>
        </div>
      )}
    </div>
  );
}

type Drag =
  | { kind: 'rect'; tool: Tool; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'ink'; points: number[] }
  | { kind: 'move'; id: string; orig: Annot; x0: number; y0: number; started: boolean }
  | { kind: 'resize'; id: string; orig: Annot; box: Rect; handle: string; x0: number; y0: number; started: boolean }
  | { kind: 'erase'; started: boolean };

function PageView({ display, src, left, top }: { display: number; src: number; left: number; top: number }) {
  const ed = useEditor();
  const z = ed.zoom;
  const size = ed.sizes[src];
  const W = size.w * z, H = size.h * z;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [runs, setRuns] = useState<TextRun[]>([]);
  const rendered = useRef(false);

  // page bitmap — re-rendered (debounced) when zoom changes; the old bitmap stretches meanwhile
  useEffect(() => {
    let cancelled = false, task: { cancel(): void } | undefined;
    const t = setTimeout(async () => {
      const page = await ed.pdf.getPage(src + 1);
      if (cancelled) return;
      let scale = z * (window.devicePixelRatio || 1);
      const maxPx = 16_000_000;
      if (size.w * size.h * scale * scale > maxPx) scale = Math.sqrt(maxPx / (size.w * size.h));
      const viewport = page.getViewport({ scale });
      const off = document.createElement('canvas');
      off.width = Math.ceil(viewport.width);
      off.height = Math.ceil(viewport.height);
      const r = page.render({ canvasContext: off.getContext('2d')!, viewport });
      task = r;
      try { await r.promise; } catch { return; }
      const c = canvasRef.current;
      if (cancelled || !c) return;
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d')!.drawImage(off, 0, 0);
      rendered.current = true;
      setReady(true);
    }, rendered.current ? 180 : 0);
    return () => { cancelled = true; clearTimeout(t); task?.cancel(); };
  }, [src, z, ed.pdf]);

  // selectable text — rendered once; it scales with the --scale-factor CSS variable
  useEffect(() => {
    let tl: InstanceType<typeof pdfjs.TextLayer> | undefined;
    (async () => {
      const page = await ed.pdf.getPage(src + 1);
      const el = textRef.current;
      if (!el) return;
      el.replaceChildren();
      tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: el, viewport: page.getViewport({ scale: 1 }) });
      await tl.render().catch(() => {});
    })();
    return () => tl?.cancel();
  }, [src, ed.pdf]);

  useEffect(() => {
    if (ed.tool === 'editText') textRuns(ed.pdf, src).then(setRuns);
  }, [ed.tool, ed.pdf, src]);

  const pt = (e: { clientX: number; clientY: number }) => {
    const r = pageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
  };
  const base = () => ({ id: uid(), page: src, createdAt: Date.now() });
  const runAt = (p: { x: number; y: number }) => runs.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);

  const hitDrawn = (p: { x: number; y: number }) =>
    ed.state.annotations.filter((a) => a.page === src).reverse().find((a) => {
      if (a.kind === 'ink') {
        const tol = a.width / 2 + 4 / z;
        for (let i = 2; i < a.points.length; i += 2)
          if (segDist(p.x, p.y, a.points[i - 2], a.points[i - 1], a.points[i], a.points[i + 1]) < tol) return true;
        return a.points.length === 2 && Math.hypot(p.x - a.points[0], p.y - a.points[1]) < tol;
      }
      if (a.kind === 'arrow') return segDist(p.x, p.y, a.x1, a.y1, a.x2, a.y2) < a.width / 2 + 4 / z;
      if (a.kind === 'shape') { const b = bbox(a); return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; }
      return false;
    });

  const onPointerDown = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0 || ed.tool === 'hand') return;
    const p = pt(e);
    const target = e.target as HTMLElement;
    const handle = target.closest<HTMLElement>('[data-handle]');
    const hitEl = target.closest<HTMLElement>('[data-id]');
    if (target.closest('.no-drag')) return;
    const capture = () => { try { pageRef.current!.setPointerCapture(e.pointerId); } catch { /* pointer already released */ } };

    if (handle && ed.selectedId) {
      const orig = ed.state.annotations.find((a) => a.id === ed.selectedId)!;
      setDrag({ kind: 'resize', id: orig.id, orig, box: bbox(orig), handle: handle.dataset.handle!, x0: p.x, y0: p.y, started: false });
      capture();
      return e.preventDefault();
    }
    if (hitEl && ['select', 'text', 'note', 'comment', 'shape', 'arrow', 'place'].includes(ed.tool)) {
      const a = ed.state.annotations.find((x) => x.id === hitEl.dataset.id);
      if (!a) return;
      if (ed.tool !== 'select') ed.setTool('select');
      if (ed.editingId === a.id) return; // let the caret move inside the editor
      ed.select(a.id);
      setDrag({ kind: 'move', id: a.id, orig: a, x0: p.x, y0: p.y, started: false });
      capture();
      return e.preventDefault();
    }
    switch (ed.tool) {
      case 'select':
        if (ed.selectedId) ed.select(null);
        return; // native text selection
      case 'text': {
        const s = ed.opts.text;
        ed.add({ ...base(), kind: 'text', text: '', x: p.x, y: p.y - (s.size * s.lineHeight) / 2, w: 10, h: s.size * s.lineHeight, ...s }, { edit: true });
        return e.preventDefault();
      }
      case 'editText': {
        const r = runAt(p);
        if (!r) return;
        const cover = { x: r.x, y: r.y, w: r.w, h: r.h };
        ed.setTool('select');
        ed.add({ ...base(), kind: 'text', text: r.str, ...ed.opts.text, font: r.family, size: Math.round(r.size * 10) / 10, color: '#000000',
          bold: r.bold, italic: r.italic, lineHeight: 1.15, letterSpacing: 0, x: r.x, y: r.y, w: r.w, h: r.h, bg: '#ffffff', cover }, { edit: true });
        return e.preventDefault();
      }
      case 'note':
        ed.setTool('select');
        ed.add({ ...base(), kind: 'note', text: '', color: ed.opts.noteColor, x: p.x, y: p.y, w: 150, h: 110 }, { edit: true });
        return e.preventDefault();
      case 'comment':
        ed.setTool('select');
        ed.add({ ...base(), kind: 'comment', x: p.x, y: p.y, text: '', author: ed.opts.author }, { edit: true });
        return e.preventDefault();
      case 'place': {
        const pl = ed.opts.place;
        if (!pl) return;
        let a: Annot;
        if (pl.kind === 'stamp') a = { ...base(), kind: 'stamp', label: pl.label, color: pl.color, x: p.x - 70, y: p.y - 22, w: 140, h: 44 };
        else {
          const w = Math.min(pl.role === 'signature' ? 180 : 220, pl.w), h = (w * pl.h) / pl.w;
          a = { ...base(), kind: 'image', src: pl.src, role: pl.role, x: p.x - w / 2, y: p.y - h / 2, w, h };
        }
        ed.setTool('select');
        ed.add(a);
        return e.preventDefault();
      }
      case 'pencil':
        setDrag({ kind: 'ink', points: [p.x, p.y] });
        capture();
        return e.preventDefault();
      case 'eraser': {
        setDrag({ kind: 'erase', started: false });
        capture();
        erase(p, false);
        return e.preventDefault();
      }
      case 'shape': case 'arrow': case 'blur':
        setDrag({ kind: 'rect', tool: ed.tool === 'shape' && ed.opts.shape.shape === 'arrow' ? 'arrow' : ed.tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        capture();
        return e.preventDefault();
      case 'redact':
        if (ed.opts.redactMode === 'text') return;
        setDrag({ kind: 'rect', tool: 'redact', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        capture();
        return e.preventDefault();
    }
  };

  const erase = (p: { x: number; y: number }, started: boolean) => {
    const hit = hitDrawn(p);
    if (!hit) return started;
    if (!started) ed.begin();
    ed.apply((s) => ({ ...s, annotations: s.annotations.filter((a) => a.id !== hit.id) }));
    return true;
  };

  const onPointerMove = (e: RPE<HTMLDivElement>) => {
    const p = pt(e);
    if (ed.tool === 'editText' || ed.tool === 'place') setHover(p);
    if (!drag) return;
    switch (drag.kind) {
      case 'rect': return setDrag({ ...drag, x1: p.x, y1: p.y });
      case 'ink': return setDrag({ ...drag, points: [...drag.points, p.x, p.y] });
      case 'erase': return setDrag({ ...drag, started: erase(p, drag.started) });
      case 'move': {
        const dx = p.x - drag.x0, dy = p.y - drag.y0;
        if (!drag.started && Math.hypot(dx, dy) * z < 3) return;
        if (!drag.started) ed.begin();
        setDrag({ ...drag, started: true });
        ed.apply((s) => ({ ...s, annotations: s.annotations.map((a) => (a.id === drag.id ? translate(drag.orig, dx, dy) : a)) }));
        return;
      }
      case 'resize': {
        if (!drag.started) ed.begin();
        setDrag({ ...drag, started: true });
        const next = resizeWith(drag, p, e.shiftKey);
        ed.apply((s) => ({ ...s, annotations: s.annotations.map((a) => (a.id === drag.id ? next : a)) }));
      }
    }
  };

  const onPointerUp = () => {
    const d = drag;
    setDrag(null);
    if (TEXT_TOOLS.includes(ed.tool) || (ed.tool === 'redact' && ed.opts.redactMode === 'text')) setTimeout(() => fromSelection(), 0);
    if (!d) return;
    if (d.kind === 'ink' && d.points.length >= 2)
      ed.add({ ...base(), kind: 'ink', points: d.points.map((v) => Math.round(v * 10) / 10), ...ed.opts.pen }, { select: false });
    if (d.kind === 'rect') {
      const r = norm(d.x0, d.y0, d.x1, d.y1);
      const tiny = r.w * z < 4 && r.h * z < 4;
      if (d.tool === 'arrow') {
        if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) * z < 8) return;
        const o = ed.tool === 'shape' ? { color: ed.opts.shape.stroke, width: ed.opts.shape.strokeWidth || 2 } : ed.opts.arrow;
        ed.setTool('select');
        ed.add({ ...base(), kind: 'arrow', x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1, ...o });
      } else if (d.tool === 'shape') {
        const { shape, ...style } = ed.opts.shape;
        const rr = tiny ? { x: d.x0 - 50, y: d.y0 - 35, w: 100, h: 70 } : r;
        ed.setTool('select');
        ed.add({ ...base(), kind: 'shape', shape: shape as Exclude<typeof shape, 'arrow'>, ...style, ...rr });
      } else if (!tiny && d.tool === 'blur') ed.add({ ...base(), kind: 'blur', amount: ed.opts.blur, ...r }, { select: false });
      else if (!tiny && d.tool === 'redact') ed.add({ ...base(), kind: 'redact', ...r }, { select: false });
    }
  };

  /** Turn the browser's text selection on this page into highlight/underline/strike/redact annotations. */
  const fromSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !textRef.current?.contains(sel.anchorNode)) return;
    const kind = ed.tool === 'redact' ? 'redact' : ed.tool;
    if (kind === 'select') return;
    const pr = pageRef.current!.getBoundingClientRect();
    const raw = [...sel.getRangeAt(0).getClientRects()]
      .map((r) => ({ x: (r.left - pr.left) / z, y: (r.top - pr.top) / z, w: r.width / z, h: r.height / z }))
      .filter((r) => r.w > 0.5 && r.h > 0.5 && r.x < size.w && r.y < size.h);
    const rects = mergeLines(raw);
    sel.removeAllRanges();
    if (!rects.length) return;
    if (kind === 'redact') {
      ed.begin();
      ed.apply((s) => ({ ...s, annotations: [...s.annotations, ...rects.map((r) => ({ ...base(), id: uid(), kind: 'redact' as const, ...r }))] }));
    } else {
      const color = kind === 'highlight' ? ed.opts.markColor : ed.opts.lineColor;
      ed.add({ ...base(), kind: kind as 'highlight', rects, color }, { select: false });
    }
  };

  const hits = ed.hits.filter((h) => h.page === src);
  const activeHit = ed.hits[ed.activeHit];
  const hoverRun = ed.tool === 'editText' && hover ? runAt(hover) : undefined;
  const textActive = TEXT_TOOLS.includes(ed.tool) || (ed.tool === 'redact' && ed.opts.redactMode === 'text');

  return (
    <div className="page-wrap" style={{ left, top, width: W }}>
      <div
        ref={pageRef}
        className={`page ${textActive ? 'text-active' : ''} ${ready ? '' : 'loading'}`}
        style={{ width: W, height: H, ['--scale-factor' as any]: z }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(e) => {
          const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id;
          const a = ed.state.annotations.find((x) => x.id === id);
          if (a && ['text', 'note', 'comment'].includes(a.kind)) ed.setEditing(a.id);
        }}
        aria-label={`Page ${display + 1}`}
        role="region"
      >
        <canvas ref={canvasRef} style={{ width: W, height: H }} aria-hidden />
        <div ref={textRef} className="textLayer" />
        {hits.map((h, i) => (
          <div key={i} className={`search-hit ${h === activeHit ? 'active' : ''}`}
            style={{ left: h.rect.x * z, top: h.rect.y * z, width: h.rect.w * z, height: h.rect.h * z }} />
        ))}
        <AnnotLayer src={src} />
        {hoverRun && <div className="run-hover" style={{ left: hoverRun.x * z - 2, top: hoverRun.y * z - 2, width: hoverRun.w * z + 4, height: hoverRun.h * z + 4 }} />}
        {ed.tool === 'place' && hover && ed.opts.place && <PlaceGhost p={hover} z={z} />}
        {drag?.kind === 'rect' && (drag.tool === 'arrow' ? (
          <svg className="draft" width={W} height={H}><line x1={drag.x0 * z} y1={drag.y0 * z} x2={drag.x1 * z} y2={drag.y1 * z} /></svg>
        ) : (
          <div className={`draft-rect draft-${drag.tool}`} style={(() => { const r = norm(drag.x0, drag.y0, drag.x1, drag.y1); return { left: r.x * z, top: r.y * z, width: r.w * z, height: r.h * z }; })()} />
        ))}
        {drag?.kind === 'ink' && (
          <svg className="draft" width={W} height={H} viewBox={`0 0 ${size.w} ${size.h}`}>
            <path d={inkPath(drag.points)} stroke={ed.opts.pen.color} strokeWidth={ed.opts.pen.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {ed.layout.numbers && <div className={`page-num ${display === ed.current ? 'current' : ''}`}>{display + 1}</div>}
    </div>
  );
}

function PlaceGhost({ p, z }: { p: { x: number; y: number }; z: number }) {
  const pl = useEditor().opts.place!;
  if (pl.kind === 'stamp')
    return <div className="ghost stamp" style={{ left: (p.x - 70) * z, top: (p.y - 22) * z, width: 140 * z, height: 44 * z, color: pl.color, borderColor: pl.color, fontSize: 18 * z }}>{pl.label}</div>;
  const w = Math.min(pl.role === 'signature' ? 180 : 220, pl.w), h = (w * pl.h) / pl.w;
  return <img className="ghost" src={pl.src} alt="" style={{ left: (p.x - w / 2) * z, top: (p.y - h / 2) * z, width: w * z, height: h * z }} />;
}

function resizeWith(d: Extract<Drag, { kind: 'resize' }>, p: { x: number; y: number }, free: boolean): Annot {
  const { orig, box, handle } = d;
  if (orig.kind === 'arrow') return handle === 'p1' ? { ...orig, x1: p.x, y1: p.y } : { ...orig, x2: p.x, y2: p.y };
  let { x, y, w, h } = box;
  const dx = p.x - d.x0, dy = p.y - d.y0;
  if (handle.includes('e')) w += dx;
  if (handle.includes('s')) h += dy;
  if (handle.includes('w')) (x += dx, (w -= dx));
  if (handle.includes('n')) (y += dy, (h -= dy));
  const keepAspect = (orig.kind === 'image' || orig.kind === 'text') !== free && handle.length === 2;
  if (keepAspect) {
    const k = Math.max(w / box.w, h / box.h);
    const nw = box.w * k, nh = box.h * k;
    if (handle.includes('w')) x = box.x + box.w - nw;
    if (handle.includes('n')) y = box.y + box.h - nh;
    (w = nw), (h = nh);
  }
  const r = { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.max(6, Math.abs(w)), h: Math.max(6, Math.abs(h)) };
  if (orig.kind === 'text') return { ...orig, x: r.x, y: r.y, size: Math.max(4, Math.round(orig.size * (r.w / box.w) * 10) / 10) };
  return resize(orig, r);
}

function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0;
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

function mergeLines(rs: Rect[]): Rect[] {
  const sorted = [...rs].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) / 2 && r.x <= last.x + last.w + 4) {
      const x2 = Math.max(last.x + last.w, r.x + r.w), y2 = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x); last.y = Math.min(last.y, r.y);
      last.w = x2 - last.x; last.h = y2 - last.y;
    } else out.push({ ...r });
  }
  return out;
}
