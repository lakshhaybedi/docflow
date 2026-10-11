import type { ReactNode } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowRight, Bold, Circle, Hexagon, Info, Italic, MousePointerClick, Square, Star, Trash2, Triangle,
} from 'lucide-react';
import type { Annot, AnnotOf, FontFamily, ShapeKind, TextStyle } from '../lib/types';
import { bbox } from '../lib/geom';
import { IconBtn, Segmented, Toggle } from '../ui/ui';
import { MARKS, SWATCHES, useEditor, type ToolOpts } from './ctx';
import { ImagePanel, OcrPanel, RedactPanel, SignaturePanel, StampPanel } from './panels';

const KIND_LABEL: Record<Annot['kind'], string> = {
  text: 'Text', highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough', note: 'Sticky note', comment: 'Comment',
  arrow: 'Callout arrow', ink: 'Drawing', shape: 'Shape', image: 'Image', stamp: 'Stamp', blur: 'Blur', redact: 'Pending redaction',
};

export function RightPanel() {
  const ed = useEditor();
  const sel = ed.state.annotations.find((a) => a.id === ed.selectedId);
  let body: ReactNode;
  if (sel) body = <Selected a={sel} />;
  else if (ed.tool === 'place') body = <Placing />;
  else body = <ToolPanel />;
  const key = sel ? `sel-${sel.id}` : `tool-${ed.tool}`; // re-key so panel content eases in on change
  return <aside className="sidebar right-panel" aria-label="Properties"><div key={key} className="panel-anim">{body}</div></aside>;
}

function Head({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="panel-head">
      <div className="eyebrow">{eyebrow}</div>
      <div className="row-between"><h3>{title}</h3>{children}</div>
    </div>
  );
}

export function Colors({ value, onChange, swatches = SWATCHES, label = 'Color' }: { value: string; onChange: (c: string) => void; swatches?: string[]; label?: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {swatches.map((c) => (
          <button key={c} role="radio" aria-checked={value.toLowerCase() === c} aria-label={c} className={`swatch ${value.toLowerCase() === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />
        ))}
        <label className="swatch custom" data-tip="Custom color" style={{ background: swatches.includes(value.toLowerCase()) ? undefined : value }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Custom ${label.toLowerCase()}`} />
        </label>
      </div>
    </div>
  );
}

function Num({ label, value, onChange, min, max, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="num">
        <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => { const v = +e.target.value; if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v))); }} />
        {suffix && <span className="muted small">{suffix}</span>}
      </div>
    </label>
  );
}

function Typography({ s, set }: { s: TextStyle; set: (p: Partial<TextStyle>) => void }) {
  return (
    <div className="stack">
      <label className="field">
        <span>Font</span>
        <select value={s.font} onChange={(e) => set({ font: e.target.value as FontFamily })}>
          <option value="sans">Helvetica (Sans)</option>
          <option value="serif">Times (Serif)</option>
          <option value="mono">Courier (Mono)</option>
        </select>
      </label>
      <div className="grid2">
        <label className="field">
          <span>Size</span>
          <select value={s.size} onChange={(e) => set({ size: +e.target.value })}>
            {[...new Set([6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72, s.size])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} pt</option>)}
          </select>
        </label>
        <label className="field">
          <span>Weight</span>
          <select value={s.bold ? 'bold' : 'regular'} onChange={(e) => set({ bold: e.target.value === 'bold' })}>
            <option value="regular">Regular</option>
            <option value="bold">Bold</option>
          </select>
        </label>
      </div>
      <div className="row gap">
        <Segmented label="Alignment" value={s.align} onChange={(align) => set({ align })} options={[
          { value: 'left', label: <AlignLeft size={16} />, title: 'Align left' },
          { value: 'center', label: <AlignCenter size={16} />, title: 'Align center' },
          { value: 'right', label: <AlignRight size={16} />, title: 'Align right' },
        ]} />
        <IconBtn icon={<Bold size={16} />} label="Bold" active={s.bold} onClick={() => set({ bold: !s.bold })} />
        <IconBtn icon={<Italic size={16} />} label="Italic" active={s.italic} onClick={() => set({ italic: !s.italic })} />
      </div>
      <div className="grid2">
        <Num label="Line height" value={s.lineHeight} min={0.8} max={3} step={0.05} onChange={(lineHeight) => set({ lineHeight })} />
        <Num label="Letter spacing" value={s.letterSpacing} min={-2} max={20} step={0.1} suffix="pt" onChange={(letterSpacing) => set({ letterSpacing })} />
      </div>
      <Colors value={s.color} onChange={(color) => set({ color })} />
    </div>
  );
}

const SHAPES: [ShapeKind | 'arrow', string, ReactNode][] = [
  ['rect', 'Rectangle', <Square size={16} />], ['ellipse', 'Ellipse', <Circle size={16} />], ['arrow', 'Arrow', <ArrowRight size={16} />],
  ['triangle', 'Triangle', <Triangle size={16} />], ['star', 'Star', <Star size={16} />], ['hexagon', 'Hexagon', <Hexagon size={16} />],
];

function ShapeStyle({ v, set }: { v: { fill: string; fillOpacity: number; stroke: string; strokeWidth: number }; set: (p: Partial<ToolOpts['shape']>) => void }) {
  return (
    <div className="stack">
      <Colors label="Fill color" value={v.fill} onChange={(fill) => set({ fill })} />
      <label className="field">
        <span>Fill opacity · {Math.round(v.fillOpacity * 100)}%</span>
        <input type="range" min={0} max={1} step={0.05} value={v.fillOpacity} onChange={(e) => set({ fillOpacity: +e.target.value })} />
      </label>
      <Colors label="Stroke color" value={v.stroke} onChange={(stroke) => set({ stroke })} />
      <label className="field">
        <span>Stroke weight</span>
        <select value={v.strokeWidth} onChange={(e) => set({ strokeWidth: +e.target.value })}>
          {[0, 1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n ? `${n} px` : 'None'}</option>)}
        </select>
      </label>
    </div>
  );
}

function Selected({ a }: { a: Annot }) {
  const ed = useEditor();
  const set = (p: Partial<Annot>) => ed.patch(a.id, p);
  const display = ed.state.pageOrder.indexOf(a.page) + 1;
  let body: ReactNode = null;
  switch (a.kind) {
    case 'text':
      body = (
        <>
          {a.bg && <div className="alert alert-info"><Info size={14} />This replaces the original text visually. The original stays in the file underneath — use Redact to remove it.</div>}
          <Typography s={a} set={set} />
          <button className="btn btn-block" onClick={() => ed.setEditing(a.id)}>Edit text</button>
        </>
      );
      break;
    case 'shape':
      body = (
        <>
          <div className="field"><span>Shape</span>
            <div className="shape-grid">
              {SHAPES.filter(([k]) => k !== 'arrow').map(([k, label, icon]) => (
                <IconBtn key={k} icon={icon} label={label} active={a.shape === k} onClick={() => set({ shape: k as ShapeKind })} />
              ))}
            </div>
          </div>
          <ShapeStyle v={a} set={set as any} />
        </>
      );
      break;
    case 'ink':
      body = <><Colors value={a.color} onChange={(color) => set({ color })} /><Num label="Stroke width" value={a.width} min={0.5} max={20} step={0.5} suffix="px" onChange={(width) => set({ width })} /></>;
      break;
    case 'arrow':
      body = (
        <>
          <label className="field"><span>Callout label</span><input value={a.text ?? ''} placeholder="Optional text at the tail" onFocus={() => ed.begin()} onChange={(e) => ed.patch(a.id, { text: e.target.value }, false)} /></label>
          <Colors value={a.color} onChange={(color) => set({ color })} />
          <Num label="Width" value={a.width} min={1} max={12} suffix="px" onChange={(width) => set({ width })} />
        </>
      );
      break;
    case 'highlight':
      body = <Colors value={a.color} swatches={MARKS} onChange={(color) => set({ color })} />;
      break;
    case 'underline': case 'strike':
      body = <Colors value={a.color} onChange={(color) => set({ color })} />;
      break;
    case 'note':
      body = (
        <>
          <Colors value={a.color} swatches={['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa']} onChange={(color) => set({ color })} />
          <button className="btn btn-block" onClick={() => ed.setEditing(a.id)}>Edit note</button>
        </>
      );
      break;
    case 'comment':
      body = (
        <>
          <p className="small">{a.text || <span className="muted">Empty comment</span>}</p>
          <p className="muted tiny">By {a.author}. Exported PDFs keep this as a real PDF comment.</p>
          <button className="btn btn-block" onClick={() => ed.setEditing(a.id)}>Edit comment</button>
        </>
      );
      break;
    case 'image':
      body = (
        <>
          {a.role === 'signature' && <div className="alert alert-info"><Info size={14} />This is an image of a signature, not a cryptographically verified digital signature.</div>}
          <p className="muted small">Drag to move. Drag a corner to resize (hold Shift to stretch freely).</p>
        </>
      );
      break;
    case 'stamp':
      body = (
        <>
          <label className="field"><span>Label</span><input value={a.label} onFocus={() => ed.begin()} onChange={(e) => ed.patch(a.id, { label: e.target.value.toUpperCase() }, false)} /></label>
          <Colors value={a.color} onChange={(color) => set({ color })} />
        </>
      );
      break;
    case 'blur':
      body = (
        <>
          <div className="alert alert-warn"><Info size={14} />Blur is visual only. The content underneath stays in the file and can be recovered. Use Redact for sensitive information.</div>
          <label className="field"><span>Strength</span><input type="range" min={2} max={16} value={a.amount} onChange={(e) => set({ amount: +e.target.value })} /></label>
        </>
      );
      break;
    case 'redact':
      body = <p className="small muted">Marked for redaction. Nothing is removed until you apply redactions from the Redact tool.</p>;
      break;
  }
  return (
    <>
      <Head eyebrow={`Selected · Page ${display}`} title={KIND_LABEL[a.kind]}>
        <IconBtn icon={<Trash2 size={16} />} label="Delete" shortcut="Del" onClick={() => ed.remove(a.id)} className="danger" />
      </Head>
      <div className="panel-body stack">{body}</div>
    </>
  );
}

function Placing() {
  const ed = useEditor();
  const pl = ed.opts.place!;
  return (
    <>
      <Head eyebrow="Place on page" title={pl.kind === 'stamp' ? 'Stamp' : pl.role === 'signature' ? 'Signature' : pl.role === 'sticker' ? 'Sticker' : 'Image'} />
      <div className="panel-body stack">
        <div className="place-preview">
          {pl.kind === 'stamp' ? <span className="annot-stamp static" style={{ color: pl.color, borderColor: pl.color }}>{pl.label}</span> : <img src={pl.src} alt="" />}
        </div>
        <p className="small"><MousePointerClick size={14} /> Click anywhere on a page to place it. Press Esc to cancel.</p>
        <button className="btn" onClick={() => ed.setTool('select')}>Cancel</button>
      </div>
    </>
  );
}

function ToolPanel() {
  const ed = useEditor();
  const o = ed.opts;
  switch (ed.tool) {
    case 'text':
      return <><Head eyebrow="Text tool" title="Text formatting" /><div className="panel-body"><p className="muted small">Click on a page to add text.</p><Typography s={o.text} set={(p) => ed.setOpts({ text: { ...o.text, ...p } })} /></div></>;
    case 'editText':
      return (
        <><Head eyebrow="Edit text" title="Edit existing text" />
          <div className="panel-body stack">
            <p className="small">Hover over the document to see editable text runs, then click one to edit it.</p>
            <div className="alert alert-info"><Info size={14} />PDF text can't always be changed in place. DocFlow covers the original run with your edited text; the original remains in the file underneath. Use Redact to remove it permanently.</div>
            <p className="muted small">Scanned pages have no text runs — run OCR first.</p>
          </div></>
      );
    case 'highlight':
      return <><Head eyebrow="Annotate" title="Highlight" /><div className="panel-body stack"><p className="muted small">Select text on the page to highlight it.</p><Colors value={o.markColor} swatches={MARKS} onChange={(markColor) => ed.setOpts({ markColor })} /></div></>;
    case 'underline': case 'strike':
      return <><Head eyebrow="Annotate" title={ed.tool === 'underline' ? 'Underline' : 'Strikethrough'} /><div className="panel-body stack"><p className="muted small">Select text on the page.</p><Colors value={o.lineColor} onChange={(lineColor) => ed.setOpts({ lineColor })} /></div></>;
    case 'note':
      return <><Head eyebrow="Annotate" title="Sticky note" /><div className="panel-body stack"><p className="muted small">Click on a page to add a note.</p><Colors value={o.noteColor} swatches={['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa']} onChange={(noteColor) => ed.setOpts({ noteColor })} /></div></>;
    case 'comment':
      return <><Head eyebrow="Annotate" title="Comment" /><div className="panel-body stack"><p className="muted small">Click on a page to pin a comment.</p><label className="field"><span>Your name</span><input value={o.author} onChange={(e) => ed.setOpts({ author: e.target.value || 'You' })} /></label></div></>;
    case 'arrow':
      return <><Head eyebrow="Annotate" title="Callout arrow" /><div className="panel-body stack"><p className="muted small">Drag from the label position to what you're pointing at.</p><Colors value={o.arrow.color} onChange={(color) => ed.setOpts({ arrow: { ...o.arrow, color } })} /><Num label="Width" value={o.arrow.width} min={1} max={12} suffix="px" onChange={(width) => ed.setOpts({ arrow: { ...o.arrow, width } })} /></div></>;
    case 'pencil':
      return <><Head eyebrow="Draw" title="Pencil" /><div className="panel-body stack"><Colors value={o.pen.color} onChange={(color) => ed.setOpts({ pen: { ...o.pen, color } })} /><Num label="Stroke width" value={o.pen.width} min={0.5} max={20} step={0.5} suffix="px" onChange={(width) => ed.setOpts({ pen: { ...o.pen, width } })} /></div></>;
    case 'eraser':
      return <><Head eyebrow="Draw" title="Eraser" /><div className="panel-body"><p className="muted small">Drag over drawings, shapes or arrows to erase them. Undo brings them back.</p></div></>;
    case 'shape':
      return (
        <><Head eyebrow="Shape tool" title="Shape properties" />
          <div className="panel-body stack">
            <div className="field"><span>Shapes</span>
              <div className="shape-grid">
                {SHAPES.map(([k, label, icon]) => <IconBtn key={k} icon={icon} label={label} active={o.shape.shape === k} onClick={() => ed.setOpts({ shape: { ...o.shape, shape: k } })} />)}
              </div>
            </div>
            <p className="muted small">Drag on a page to draw. Click for a default size.</p>
            <ShapeStyle v={o.shape} set={(p) => ed.setOpts({ shape: { ...o.shape, ...p } })} />
          </div></>
      );
    case 'blur':
      return (
        <><Head eyebrow="Blur tool" title="Blur area" />
          <div className="panel-body stack">
            <div className="alert alert-warn"><Info size={14} />Blur only hides content visually. It stays in the file and can be recovered. Use Redact for sensitive information.</div>
            <label className="field"><span>Strength</span><input type="range" min={2} max={16} value={o.blur} onChange={(e) => ed.setOpts({ blur: +e.target.value })} /></label>
            <p className="muted small">Drag over the area to blur.</p>
          </div></>
      );
    case 'redact': return <RedactPanel />;
    case 'image': return <ImagePanel />;
    case 'stamp': return <StampPanel />;
    case 'signature': return <SignaturePanel />;
    case 'ocr': return <OcrPanel />;
    default: return <AnnotationList />;
  }
}

function AnnotationList() {
  const ed = useEditor();
  const list = ed.state.annotations
    .map((a) => ({ a, d: ed.state.pageOrder.indexOf(a.page) }))
    .filter((x) => x.d >= 0)
    .sort((x, y) => x.d - y.d || x.a.createdAt - y.a.createdAt);
  const describe = (a: Annot) =>
    a.kind === 'text' ? a.text : a.kind === 'note' || a.kind === 'comment' ? a.text : a.kind === 'stamp' ? a.label
      : a.kind === 'arrow' ? a.text ?? '' : '';
  return (
    <>
      <Head eyebrow="Annotations" title={`${list.length} item${list.length === 1 ? '' : 's'}`} />
      <div className="panel-body">
        {list.length === 0 ? (
          <p className="muted small">No annotations yet. Pick a tool from the toolbar below to highlight, comment, draw or sign.</p>
        ) : (
          <ul className="plain-list annot-list">
            {list.map(({ a, d }) => (
              <li key={a.id}>
                <button className={`annot-item ${ed.selectedId === a.id ? 'is-active' : ''}`} onClick={() => { ed.select(a.id); ed.goto(d, bbox(a)); }}>
                  <span className="row-between"><strong className="small">{a.kind === 'image' && a.role ? (a.role === 'signature' ? 'Signature' : 'Sticker') : KIND_LABEL[a.kind]}</strong><span className="badge">Pg. {d + 1}</span></span>
                  {describe(a) && <span className="small clamp">{describe(a)}</span>}
                  <span className="tiny muted">{a.kind === 'comment' ? `${(a as AnnotOf<'comment'>).author} · ` : ''}{new Date(a.createdAt).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.some(({ a }) => a.kind === 'redact') && <Toggle label="Preview redactions as black" checked={ed.opts.redactPreview} onChange={(redactPreview) => ed.setOpts({ redactPreview })} />}
      </div>
    </>
  );
}
