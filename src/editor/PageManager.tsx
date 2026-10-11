import { useState, type DragEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Trash2 } from 'lucide-react';
import { useEditor } from './ctx';
import { Thumb } from './LeftSidebar';
import { useToast } from '../ui/ui';
import { askConfirm } from '../ui/prompt';

export function PageManager({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const toast = useToast();
  const order = ed.state.pageOrder;
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState<number[] | null>(null);
  const [drop, setDrop] = useState<number | null>(null); // insert before this display index

  const toggle = (src: number) => setSel((s) => { const n = new Set(s); n.has(src) ? n.delete(src) : n.add(src); return n; });

  const moveTo = (moving: number[], before: number) => {
    const rest = order.filter((s) => !moving.includes(s));
    const anchor = order.slice(before).find((s) => !moving.includes(s));
    const at = anchor === undefined ? rest.length : rest.indexOf(anchor);
    const next = [...rest.slice(0, at), ...order.filter((s) => moving.includes(s)), ...rest.slice(at)];
    if (next.join() !== order.join()) ed.commit((s) => ({ ...s, pageOrder: next }));
  };

  const shift = (dir: -1 | 1) => {
    const idx = order.map((s, i) => (sel.has(s) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return;
    const before = dir < 0 ? Math.max(0, idx[0] - 1) : Math.min(order.length, idx[idx.length - 1] + 2);
    moveTo([...sel], before);
  };

  const remove = async () => {
    if (sel.size >= order.length) return toast({ kind: 'error', text: "A document needs at least one page. Keep one page or delete the document from Files." });
    const ok = await askConfirm({ title: `Delete ${sel.size} page${sel.size > 1 ? 's' : ''}?`, body: <p>Their annotations are hidden with them. You can undo this.</p>, confirm: 'Delete pages', danger: true });
    if (!ok) return;
    ed.commit((s) => ({ ...s, pageOrder: s.pageOrder.filter((p) => !sel.has(p)) }));
    setSel(new Set());
  };

  const onDragOver = (e: DragEvent, d: number) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDrop(e.clientX < r.left + r.width / 2 ? d : d + 1);
  };

  return (
    <div className="organizer">
      <div className="organizer-bar">
        <span className="small">{sel.size ? `${sel.size} selected` : 'Select pages to organize or drag to reorder'}</span>
        <div className="row gap">
          {sel.size > 0 && (
            <>
              <button className="btn btn-sm" onClick={() => shift(-1)}><ArrowLeft size={14} />Move earlier</button>
              <button className="btn btn-sm" onClick={() => shift(1)}>Move later<ArrowRight size={14} /></button>
              <button className="btn btn-sm btn-danger-ghost" onClick={remove}><Trash2 size={14} />Delete</button>
            </>
          )}
          <button className="link" onClick={() => setSel(new Set(order))}>Select All</button>
          <button className="link muted" disabled={!sel.size} onClick={() => setSel(new Set())}>Clear Selection</button>
          <button className="btn btn-primary btn-sm" onClick={onClose}><Check size={14} />Done</button>
        </div>
      </div>
      <div className="organizer-grid" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)}>
        {order.map((src, d) => (
          <div key={src} className="org-cell">
            {drop === d && dragging && <span className="drop-bar" />}
            <div
              className={`org-card ${sel.has(src) ? 'is-selected' : ''} ${dragging?.includes(src) ? 'is-dragging' : ''}`}
              draggable
              onDragStart={(e) => { const m = sel.has(src) ? order.filter((s) => sel.has(s)) : [src]; setDragging(m); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => (setDragging(null), setDrop(null))}
              onDragOver={(e) => onDragOver(e, d)}
              onDrop={(e) => { e.preventDefault(); if (dragging && drop !== null) moveTo(dragging, drop); setDragging(null); setDrop(null); }}
              onClick={() => toggle(src)}
              onDoubleClick={() => { onClose(); ed.goto(d); }}
            >
              <input type="checkbox" checked={sel.has(src)} onChange={() => toggle(src)} onClick={(e) => e.stopPropagation()} aria-label={`Select page ${d + 1}`} />
              <Thumb src={src} width={170} />
              <span className="small">{d + 1}</span>
            </div>
            {drop === d + 1 && d === order.length - 1 && dragging && <span className="drop-bar end" />}
          </div>
        ))}
      </div>
      <p className="tiny muted center">Double-click a page to open it. Changes can be undone with {navigator.platform.includes('Mac') ? '⌘Z' : 'Ctrl+Z'}.</p>
    </div>
  );
}
