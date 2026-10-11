import { useEffect, useLayoutEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { arrowHead, bbox, inkPath, shapePath } from '../lib/geom';
import { cssFont } from '../lib/fonts';
import type { Annot, AnnotOf } from '../lib/types';
import { useEditor } from './ctx';
import { fmtAgo } from '../ui/ui';

export function AnnotLayer({ src }: { src: number }) {
  const ed = useEditor();
  const z = ed.zoom;
  const { w, h } = ed.sizes[src];
  const annots = ed.state.annotations.filter((a) => a.page === src);
  const sel = annots.find((a) => a.id === ed.selectedId);
  const marks = annots.filter((a) => a.kind === 'highlight');
  const vectors = annots.filter((a) => ['underline', 'strike', 'ink', 'shape', 'arrow'].includes(a.kind));

  return (
    <>
      <svg className="annot-svg marks" width={w * z} height={h * z} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {marks.map((a) => a.kind === 'highlight' && (
          <g key={a.id} data-id={a.id} className="hit">
            {a.rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={a.color} opacity={0.4} />)}
          </g>
        ))}
      </svg>
      <svg className="annot-svg" width={w * z} height={h * z} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {vectors.map((a) => <Vector key={a.id} a={a} z={z} />)}
      </svg>
      <div className="annot-html">
        {annots.map((a) => <Html key={a.id} a={a} />)}
      </div>
      {sel && <Selection a={sel} />}
    </>
  );
}

function Vector({ a, z }: { a: Annot; z: number }) {
  const hitW = 8 / z;
  switch (a.kind) {
    case 'underline': case 'strike':
      return (
        <g data-id={a.id} className="hit">
          {a.rects.map((r, i) => {
            const y = a.kind === 'underline' ? r.y + r.h - 1 : r.y + r.h / 2;
            return <g key={i}><line x1={r.x} x2={r.x + r.w} y1={y} y2={y} stroke={a.color} strokeWidth={1.2} /><rect x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" /></g>;
          })}
        </g>
      );
    case 'ink':
      return (
        <g data-id={a.id} className="hit">
          <path d={inkPath(a.points)} stroke="transparent" strokeWidth={a.width + hitW} fill="none" strokeLinecap="round" />
          <path d={inkPath(a.points)} stroke={a.color} strokeWidth={a.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case 'shape':
      return (
        <path data-id={a.id} className="hit" d={shapePath(a.shape, a)} fill={a.fill} fillOpacity={a.fillOpacity}
          stroke={a.strokeWidth ? a.stroke : 'none'} strokeWidth={a.strokeWidth} style={{ pointerEvents: 'all' }} />
      );
    case 'arrow':
      return (
        <g data-id={a.id} className="hit">
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={a.width + hitW} />
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" />
          <path d={arrowHead(a.x1, a.y1, a.x2, a.y2, a.width)} fill={a.color} />
        </g>
      );
  }
  return null;
}

function Html({ a }: { a: Annot }) {
  const ed = useEditor();
  const z = ed.zoom;
  const pos = (x: number, y: number, w?: number, h?: number) => ({ left: x * z, top: y * z, width: w !== undefined ? w * z : undefined, height: h !== undefined ? h * z : undefined });
  switch (a.kind) {
    case 'text': return <TextAnnot a={a} />;
    case 'note': return <NoteAnnot a={a} />;
    case 'comment': return <CommentAnnot a={a} />;
    case 'image':
      return <img data-id={a.id} className="hit annot-img" src={a.src} alt={a.role === 'signature' ? 'Signature' : 'Inserted image'} draggable={false} style={pos(a.x, a.y, a.w, a.h)} />;
    case 'stamp':
      return (
        <div data-id={a.id} className="hit annot-stamp" style={{ ...pos(a.x, a.y, a.w, a.h), color: a.color, borderColor: a.color, borderWidth: 2 * z, fontSize: Math.min(a.h * 0.45, a.w / (a.label.length * 0.68)) * z }}>
          {a.label}
        </div>
      );
    case 'blur':
      return <div data-id={a.id} className="hit annot-blur" style={{ ...pos(a.x, a.y, a.w, a.h), backdropFilter: `blur(${a.amount * z}px)`, WebkitBackdropFilter: `blur(${a.amount * z}px)` }} />;
    case 'redact':
      return <div data-id={a.id} className={`hit annot-redact ${ed.opts.redactPreview ? 'preview' : ''}`} style={pos(a.x, a.y, a.w, a.h)} title="Pending redaction" />;
    case 'arrow':
      return a.text ? <div data-id={a.id} className="hit arrow-label" style={{ left: a.x1 * z, top: a.y1 * z, fontSize: 10 * z, borderColor: a.color }}>{a.text}</div> : null;
  }
  return null;
}

function useEditable(id: string, initial: string, onDone: (text: string) => void) {
  const ed = useEditor();
  const ref = useRef<HTMLElement & { value?: string }>(null);
  const editing = ed.editingId === id;
  // The draft lives in a ref so it can be saved however editing ends: blur, Esc, clicking elsewhere
  // (which unmounts the textarea before any blur fires), or the page scrolling out of view.
  const draft = useRef<{ text: string; dirty: boolean } | null>(null);
  const editingNow = useRef(editing);
  editingNow.current = editing;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    if ('value' in el && el.tagName === 'TEXTAREA') el.value = initial;
    else el.innerText = initial;
    draft.current = { text: initial, dirty: false };
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    if (el.tagName !== 'TEXTAREA') (window.getSelection()?.removeAllRanges(), window.getSelection()?.addRange(range));
    return () => {
      const d = draft.current;
      // StrictMode re-runs effects without ending the edit; only save when editing really ended or text changed
      if (!d || (editingNow.current && !d.dirty)) return;
      draft.current = null;
      done.current(d.text);
    };
  }, [editing]);
  const input = (e: React.FormEvent<HTMLElement>) => {
    const el = e.currentTarget as HTMLElement;
    draft.current = { text: (el.tagName === 'TEXTAREA' ? (el as HTMLTextAreaElement).value : el.innerText).replace(/\n$/, ''), dirty: true };
  };
  const finish = () => ed.editingId === id && ed.setEditing(null);
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
  };
  return { ref, editing, finish, keys, input };
}

function TextAnnot({ a }: { a: AnnotOf<'text'> }) {
  const ed = useEditor();
  const z = ed.zoom;
  const { ref, editing, finish, keys, input } = useEditable(a.id, a.text, (text) => {
    if (!text.trim() && !a.bg) ed.apply((s) => ({ ...s, annotations: s.annotations.filter((x) => x.id !== a.id) }));
    else if (text !== a.text) ed.patch(a.id, { text });
  });
  // keep stored size in sync with the rendered text so selection and export alignment match the screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || editing) return;
    const w = el.offsetWidth / z, h = el.offsetHeight / z;
    if (Math.abs(w - a.w) > 0.5 || Math.abs(h - a.h) > 0.5) ed.patch(a.id, { w, h }, false);
  });
  const style: React.CSSProperties = {
    left: a.x * z, top: a.y * z, fontFamily: cssFont(a.font), fontSize: a.size * z, fontWeight: a.bold ? 700 : 400,
    fontStyle: a.italic ? 'italic' : 'normal', color: a.color, textAlign: a.align, lineHeight: a.lineHeight,
    letterSpacing: a.letterSpacing * z, background: a.bg,
  };
  return (
    <>
      {a.cover && <div className="annot-cover" style={{ left: a.cover.x * z - 1, top: a.cover.y * z - 1, width: a.cover.w * z + 2, height: a.cover.h * z + 2, background: a.bg }} />}
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        data-id={a.id}
        className={`hit annot-text ${editing ? 'editing' : ''}`}
        style={style}
        contentEditable={editing ? ('plaintext-only' as any) : false}
        suppressContentEditableWarning
        onBlur={finish}
        onInput={editing ? input : undefined}
        onKeyDown={editing ? keys : undefined}
        spellCheck={editing}
        role={editing ? 'textbox' : undefined}
        aria-label={editing ? 'Text' : undefined}
        aria-multiline
      >
        {editing ? null : a.text}
      </div>
    </>
  );
}

function NoteAnnot({ a }: { a: AnnotOf<'note'> }) {
  const ed = useEditor();
  const z = ed.zoom;
  const { ref, editing, finish, keys, input } = useEditable(a.id, a.text, (text) => text !== a.text && ed.patch(a.id, { text }));
  const style = { left: a.x * z, top: a.y * z, width: a.w * z, height: a.h * z, background: a.color, fontSize: 9 * z, padding: 8 * z, lineHeight: `${12 * z}px` };
  return (
    <div data-id={a.id} className="hit annot-note" style={style}>
      {editing ? (
        <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} className="no-drag" onBlur={finish} onInput={input} onKeyDown={keys} aria-label="Sticky note text" placeholder="Write a note…" style={{ fontSize: 9 * z, lineHeight: `${12 * z}px` }} />
      ) : (
        a.text || <span className="placeholder">Double-click to write</span>
      )}
    </div>
  );
}

function CommentAnnot({ a }: { a: AnnotOf<'comment'> }) {
  const ed = useEditor();
  const z = ed.zoom;
  const open = ed.selectedId === a.id || ed.editingId === a.id;
  const { ref, editing, finish, keys, input } = useEditable(a.id, a.text, (text) => {
    if (!text.trim() && !a.text) ed.apply((s) => ({ ...s, annotations: s.annotations.filter((x) => x.id !== a.id) }));
    else if (text !== a.text) ed.patch(a.id, { text });
  });
  return (
    <>
      <button data-id={a.id} className={`hit comment-pin ${open ? 'open' : ''}`} style={{ left: a.x * z - 12, top: a.y * z - 12 }} aria-label={`Comment by ${a.author}`}>
        <MessageSquare size={14} />
      </button>
      {open && (
        <div className="comment-pop no-drag" style={a.x > ed.sizes[a.page].w / 2 ? { right: (ed.sizes[a.page].w - a.x) * z + 16, top: a.y * z - 12 } : { left: a.x * z + 16, top: a.y * z - 12 }}>
          <div className="row-between"><strong className="small">{a.author}</strong><span className="muted tiny">{fmtAgo(a.createdAt)}</span></div>
          {editing ? (
            <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} onBlur={finish} onInput={input} onKeyDown={keys} aria-label="Comment" placeholder="Add a comment…" rows={3} />
          ) : (
            <p className="small" onDoubleClick={() => ed.setEditing(a.id)}>{a.text}</p>
          )}
          {!editing && <button className="link small" onClick={() => ed.setEditing(a.id)}>Edit</button>}
        </div>
      )}
    </>
  );
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function Selection({ a }: { a: Annot }) {
  const ed = useEditor();
  const z = ed.zoom;
  if (ed.editingId === a.id || a.kind === 'comment') return null;
  if (a.kind === 'arrow')
    return (
      <>
        {[['p1', a.x1, a.y1], ['p2', a.x2, a.y2]].map(([k, x, y]) => (
          <div key={k as string} data-handle={k} className="handle" style={{ left: (x as number) * z - 5, top: (y as number) * z - 5 }} />
        ))}
      </>
    );
  const b = bbox(a);
  const resizable = !['highlight', 'underline', 'strike'].includes(a.kind);
  const handles = a.kind === 'text' ? ['nw', 'ne', 'se', 'sw'] : HANDLES;
  return (
    <div className="selection" style={{ left: b.x * z - 3, top: b.y * z - 3, width: b.w * z + 6, height: b.h * z + 6 }}>
      {resizable && handles.map((hd) => <div key={hd} data-handle={hd} className={`handle h-${hd}`} />)}
    </div>
  );
}
