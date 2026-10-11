import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Camera, CheckCircle2, Copy, Eraser, ImageUp, Info, Keyboard, Link, Loader2, PenLine, Search, ShieldAlert, Trash2, Upload, X,
} from 'lucide-react';
import { applyRedactions, addTextLayer, type OcrWord } from '../lib/pdfwrite';
import { renderToCanvas, textRuns } from '../lib/pdf';
import { getList, pushList, removeFromList } from '../lib/store';
import { IconBtn, Segmented, Toggle, pickFile, toEmbeddable, useToast } from '../ui/ui';
import { askConfirm } from '../ui/prompt';
import { useEditor, type Placeable } from './ctx';
import { SIG_FONTS } from '../lib/prefs';

function Head({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="panel-head"><div className="eyebrow">{eyebrow}</div><h3>{title}</h3></div>;
}

function usePlace() {
  const ed = useEditor();
  return (p: Placeable) => (ed.setOpts({ place: p }), ed.setTool('place'));
}

/* ---------------- redaction ---------------- */
export function RedactPanel() {
  const ed = useEditor();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const pending = ed.state.annotations.filter((a) => a.kind === 'redact');
  const pages = new Set(pending.map((a) => a.page));

  const apply = async () => {
    const ok = await askConfirm({
      title: 'Confirm redaction',
      icon: <span className="confirm-icon danger"><ShieldAlert size={18} /></span>,
      danger: true,
      confirm: 'Apply Redaction',
      body: (
        <>
          <p>This permanently removes the content under {pending.length} area{pending.length > 1 ? 's' : ''} on {pages.size} page{pages.size > 1 ? 's' : ''}. This cannot be undone.</p>
          <ul className="small muted bullets">
            <li>Redacted pages are rebuilt as images, so their other text won't be selectable. You can run OCR afterwards.</li>
            <li>Annotations overlapping redacted areas are removed.</li>
            <li>Undo history is cleared, and no export can restore the removed content.</li>
          </ul>
        </>
      ),
    });
    if (!ok) return;
    setBusy('Starting…');
    try {
      const res = await applyRedactions(ed.bytes, ed.state, (_, l) => setBusy(l));
      await ed.replaceBytes(res.bytes, { ...ed.state, annotations: res.annotations }, true);
      toast({ kind: 'success', text: `Redaction applied to ${res.pagesRasterized} page${res.pagesRasterized > 1 ? 's' : ''}` });
    } catch (e: any) {
      toast({ kind: 'error', text: `Redaction failed — nothing was changed. ${e?.message ?? ''}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Head eyebrow="Redaction tool" title="Tool properties" />
      <div className="panel-body stack">
        <div className="field"><span>Mode</span>
          <Segmented label="Redaction mode" value={ed.opts.redactMode} onChange={(redactMode) => ed.setOpts({ redactMode })}
            options={[{ value: 'area', label: 'Rectangle' }, { value: 'text', label: 'Text' }]} />
        </div>
        <p className="muted small">{ed.opts.redactMode === 'area' ? 'Drag over any area to mark it.' : 'Select text on the page to mark it.'}</p>
        <Toggle label="Show live redaction preview" checked={ed.opts.redactPreview} onChange={(redactPreview) => ed.setOpts({ redactPreview })} />
        <hr />
        <div className="row-between">
          <span className="eyebrow">Pending · {pending.length}</span>
          {pending.length > 0 && <button className="link small" onClick={() => ed.commit((s) => ({ ...s, annotations: s.annotations.filter((a) => a.kind !== 'redact') }))}>Clear all</button>}
        </div>
        {pending.length === 0 ? <p className="muted small">No areas marked yet.</p> : (
          <ul className="plain-list">
            {pending.map((a, i) => (
              <li key={a.id} className="list-row">
                <button className="list-main" onClick={() => ed.goto(ed.state.pageOrder.indexOf(a.page), a.kind === 'redact' ? a : undefined)}>Area {i + 1} · Page {ed.state.pageOrder.indexOf(a.page) + 1}</button>
                <IconBtn icon={<X size={14} />} label="Remove mark" onClick={() => ed.remove(a.id)} />
              </li>
            ))}
          </ul>
        )}
        <button className="btn btn-primary btn-block" disabled={!pending.length || !!busy} onClick={apply}>
          {busy ? <><Loader2 size={14} className="spin" />{busy}</> : 'Apply Redaction'}
        </button>
        <p className="tiny muted">Unlike Blur, redaction removes the underlying text and graphics from the file.</p>
      </div>
    </>
  );
}

/* ---------------- images ---------------- */
type StockResult = { id: string; thumbnail: string; title: string; creator?: string; license: string; foreign_landing_url: string };

export function ImagePanel() {
  const place = usePlace();
  const [tab, setTab] = useState<'upload' | 'url' | 'stock'>('upload');
  const [url, setUrl] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<StockResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const use = async (src: Blob | string) => {
    setErr(null);
    setBusy(true);
    try {
      const img = await toEmbeddable(src);
      place({ kind: 'image', ...img });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=20&mature=false`);
      if (!r.ok) throw new Error(`Openverse returned ${r.status}${r.status === 429 ? ' — too many searches, wait a minute' : ''}`);
      setResults((await r.json()).results);
    } catch (e: any) {
      setErr(e.message?.includes('fetch') ? "Couldn't reach Openverse. Check your connection." : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Head eyebrow="Insert" title="Image" />
      <div className="panel-body stack">
        <Segmented label="Image source" value={tab} onChange={setTab} options={[
          { value: 'upload', label: 'Upload' }, { value: 'url', label: 'URL' }, { value: 'stock', label: 'Stock' },
        ]} />
        {tab === 'upload' && (
          <button className="upload-box" onClick={async () => { const [f] = await pickFile('image/*'); if (f) use(f); }}>
            <ImageUp size={22} /><strong>Choose an image</strong><span className="muted small">PNG, JPG, WebP, GIF or SVG</span>
          </button>
        )}
        {tab === 'url' && (
          <form className="stack" onSubmit={(e) => (e.preventDefault(), url && use(url))}>
            <label className="field"><span>Image URL</span><input type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
            <button className="btn btn-primary" disabled={!url || busy}><Link size={14} />Insert from URL</button>
            <p className="tiny muted">The image is fetched by your browser. Some sites block this; if so, download the image and upload it.</p>
          </form>
        )}
        {tab === 'stock' && (
          <>
            <form className="row gap" onSubmit={(e) => (e.preventDefault(), search())}>
              <label className="search grow"><Search size={14} /><input placeholder="Search free images" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock images" /></label>
              <button className="btn" disabled={busy}>Search</button>
            </form>
            <p className="tiny muted">Searches are sent to Openverse (openverse.org). Check each image's license before publishing.</p>
            {results && results.length === 0 && <p className="muted small">No images found.</p>}
            <div className="stock-grid">
              {results?.map((r) => (
                <button key={r.id} className="stock-item" onClick={() => use(r.thumbnail)} title={`${r.title}${r.creator ? ` by ${r.creator}` : ''} · ${r.license.toUpperCase()}`}>
                  <img src={r.thumbnail} alt={r.title} loading="lazy" crossOrigin="anonymous" />
                  <span className="tiny">{r.license.toUpperCase()}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {busy && <p className="small muted"><Loader2 size={14} className="spin" /> Loading…</p>}
        {err && <div className="alert alert-error" role="alert">{err}</div>}
        {!err && !busy && <p className="tiny muted">After choosing, click on a page to place it. Drag corners to resize.</p>}
      </div>
    </>
  );
}

/* ---------------- stamps & stickers ---------------- */
const STAMPS: [string, string][] = [
  ['APPROVED', '#16a34a'], ['REJECTED', '#dc2626'], ['DRAFT', '#2563eb'], ['URGENT', '#ea580c'], ['CONFIDENTIAL', '#7c3aed'], ['REVIEWED', '#0891b2'],
];

export function StampPanel() {
  const place = usePlace();
  const [recent, setRecent] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => void getList('stickers').then(setRecent), []);
  const useSticker = async (src: string) => {
    const img = await toEmbeddable(src, 600);
    place({ kind: 'image', role: 'sticker', ...img });
  };
  return (
    <>
      <Head eyebrow="Insert" title="Stamps & stickers" />
      <div className="panel-body stack">
        <div className="eyebrow">Stamps</div>
        <div className="stamp-grid">
          {STAMPS.map(([label, color]) => (
            <button key={label} className="stamp-btn" style={{ color, borderColor: color }} onClick={() => place({ kind: 'stamp', label, color })}>{label}</button>
          ))}
        </div>
        <hr />
        <div className="eyebrow">Custom stickers</div>
        <button className="btn btn-block" onClick={async () => {
          setErr(null);
          const [f] = await pickFile('image/*');
          if (!f) return;
          try {
            const img = await toEmbeddable(f, 600);
            await pushList('stickers', img.src);
            setRecent(await getList('stickers'));
            place({ kind: 'image', role: 'sticker', ...img });
          } catch (e: any) { setErr(e.message); }
        }}><Upload size={14} />Upload sticker</button>
        {err && <div className="alert alert-error">{err}</div>}
        {recent.length > 0 && (
          <>
            <div className="eyebrow">Recently used</div>
            <div className="sticker-grid">
              {recent.map((s) => (
                <div key={s} className="sticker">
                  <button onClick={() => useSticker(s)} aria-label="Place sticker"><img src={s} alt="" /></button>
                  <IconBtn icon={<X size={12} />} label="Remove from recent" onClick={async () => (await removeFromList('stickers', s), setRecent(await getList('stickers')))} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ---------------- signatures ---------------- */
function trim(c: HTMLCanvasElement, pad = 6): string | null {
  const g = c.getContext('2d')!;
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) (x0 = Math.min(x0, x), y0 = Math.min(y0, y), x1 = Math.max(x1, x), y1 = Math.max(y1, y));
  if (x1 < 0) return null;
  const out = Object.assign(document.createElement('canvas'), { width: x1 - x0 + pad * 2, height: y1 - y0 + pad * 2 });
  out.getContext('2d')!.drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** Keep dark "ink" pixels, make the paper transparent. */
function inkOnly(c: HTMLCanvasElement, threshold: number, color?: [number, number, number]) {
  const g = c.getContext('2d')!;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum > threshold) d[i + 3] = 0;
    else if (color) (d[i] = color[0], d[i + 1] = color[1], d[i + 2] = color[2], (d[i + 3] = Math.min(255, (threshold - lum) * 4)));
  }
  g.putImageData(img, 0, 0);
}

const INKS: [string, [number, number, number]][] = [['#111827', [17, 24, 39]], ['#1d4ed8', [29, 78, 216]]];

export function SignaturePanel() {
  const ed = useEditor();
  const place = usePlace();
  const toast = useToast();
  const [mode, setMode] = useState<'type' | 'draw' | 'upload' | 'webcam'>('type');
  const [name, setName] = useState('');
  const [ink, setInk] = useState(0);
  const [saved, setSaved] = useState<string[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => void getList('signatures').then(setSaved), []);

  // typed signature preview
  useEffect(() => {
    if (mode !== 'type') return;
    if (!name.trim()) return setDraft(null);
    let alive = true;
    const font = ed.opts.sigFont;
    document.fonts.load(`72px "${font}"`).then(() => {
      const c = Object.assign(document.createElement('canvas'), { width: 900, height: 200 });
      const g = c.getContext('2d')!;
      g.font = `72px "${font}", cursive`;
      g.fillStyle = INKS[ink][0];
      g.textBaseline = 'middle';
      g.fillText(name, 20, 100, 860);
      if (alive) setDraft(trim(c));
    });
    return () => { alive = false; };
  }, [name, ink, mode, ed.opts.sigFont]);

  useEffect(() => void (setDraft(null), setErr(null)), [mode]);

  const save = async () => {
    if (!draft) return;
    await pushList('signatures', draft, 8);
    setSaved(await getList('signatures'));
    const img = new Image();
    img.src = draft;
    await img.decode();
    toast({ kind: 'success', text: 'Signature saved — click on the page to place it' });
    place({ kind: 'image', role: 'signature', src: draft, w: img.width, h: img.height });
  };
  const placeSaved = async (src: string) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    place({ kind: 'image', role: 'signature', src, w: img.width, h: img.height });
  };

  const modes: [typeof mode, string, ReactNode][] = [
    ['type', 'Type Your Name', <Keyboard size={16} />], ['draw', 'Draw Signature', <PenLine size={16} />],
    ['upload', 'Upload Image', <ImageUp size={16} />], ['webcam', 'Scan via Webcam', <Camera size={16} />],
  ];

  return (
    <>
      <Head eyebrow="Sign" title="Signature" />
      <div className="panel-body stack">
        <div className="sig-modes" role="radiogroup" aria-label="Signature method">
          {modes.map(([m, label, icon]) => (
            <button key={m} role="radio" aria-checked={mode === m} className={`sig-mode ${mode === m ? 'is-active' : ''}`} onClick={() => setMode(m)}>
              {icon}{label}{m === 'webcam' && <span className="badge">Advanced</span>}
            </button>
          ))}
        </div>
        <div className="row gap">
          <span className="small muted">Ink</span>
          {INKS.map(([c], i) => <button key={c} className={`swatch ${ink === i ? 'is-active' : ''}`} style={{ background: c }} aria-label={i ? 'Blue ink' : 'Black ink'} onClick={() => setInk(i)} />)}
        </div>
        {mode === 'type' && (
          <>
            <label className="field"><span>Type your name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoFocus /></label>
            <div className="sig-fonts" role="radiogroup" aria-label="Signature style">
              {SIG_FONTS.map((f) => (
                <button key={f} role="radio" aria-checked={ed.opts.sigFont === f} className={`sig-font ${ed.opts.sigFont === f ? 'is-active' : ''}`}
                  style={{ fontFamily: `"${f}", cursive` }} onClick={() => ed.setOpts({ sigFont: f })}>{name || 'Jane Doe'}</button>
              ))}
            </div>
          </>
        )}
        {mode === 'draw' && <DrawPad color={INKS[ink][0]} onChange={setDraft} />}
        {mode === 'upload' && (
          <button className="upload-box" onClick={async () => {
            const [f] = await pickFile('image/*');
            if (!f) return;
            try {
              const { src } = await toEmbeddable(f, 1200);
              const img = new Image();
              img.src = src;
              await img.decode();
              const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
              c.getContext('2d')!.drawImage(img, 0, 0);
              inkOnly(c, 200);
              setDraft(trim(c));
            } catch (e: any) { setErr(e.message); }
          }}>
            <Upload size={20} /><strong>Choose an image of your signature</strong><span className="muted small">A white background is removed automatically</span>
          </button>
        )}
        {mode === 'webcam' && <Webcam rgb={INKS[ink][1]} onCapture={setDraft} onError={setErr} />}
        {draft && <div className="sig-preview"><img src={draft} alt="Signature preview" /></div>}
        {err && <div className="alert alert-error" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={!draft} onClick={save}>Save Signature</button>
        <p className="tiny muted"><Info size={12} /> Inserted signatures are images. They are not cryptographically verified digital signatures.</p>
        {saved.length > 0 && (
          <>
            <hr />
            <div className="eyebrow">Saved signatures</div>
            <div className="saved-sigs">
              {saved.map((s) => (
                <div key={s} className="saved-sig">
                  <button onClick={() => placeSaved(s)} aria-label="Place this signature"><img src={s} alt="Saved signature" /></button>
                  <IconBtn icon={<Trash2 size={13} />} label="Delete saved signature" onClick={async () => (await removeFromList('signatures', s), setSaved(await getList('signatures')))} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function DrawPad({ color, onChange }: { color: string; onChange: (src: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * ref.current!.width) / r.width, y: ((e.clientY - r.top) * ref.current!.height) / r.height };
  };
  return (
    <div className="stack">
      <canvas ref={ref} width={640} height={240} className="drawpad" aria-label="Draw your signature"
        onPointerDown={(e) => { ref.current!.setPointerCapture(e.pointerId); last.current = pos(e); }}
        onPointerMove={(e) => {
          if (!last.current) return;
          const g = ref.current!.getContext('2d')!;
          const p = pos(e);
          g.strokeStyle = color; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
          g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke();
          last.current = p;
        }}
        onPointerUp={() => { last.current = null; onChange(trim(ref.current!)); }} />
      <button className="btn btn-sm" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); onChange(null); }}><Eraser size={14} />Clear</button>
    </div>
  );
}

function Webcam({ rgb, onCapture, onError }: { rgb: [number, number, number]; onCapture: (s: string | null) => void; onError: (e: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [threshold, setThreshold] = useState(110);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);
  const start = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setStream(s);
      requestAnimationFrame(() => { if (video.current) (video.current.srcObject = s, video.current.play()); });
    } catch (e: any) {
      onError(e?.name === 'NotAllowedError' ? 'Camera access was denied. Allow it in your browser settings to use this.' : `Camera unavailable: ${e?.message ?? e}`);
    }
  };
  const capture = () => {
    const v = video.current!;
    const c = Object.assign(document.createElement('canvas'), { width: v.videoWidth, height: v.videoHeight });
    c.getContext('2d')!.drawImage(v, 0, 0);
    inkOnly(c, threshold, rgb);
    onCapture(trim(c));
  };
  if (!stream)
    return (
      <div className="stack">
        <p className="small muted">Sign on white paper and hold it up to the camera. The image stays on your device.</p>
        <button className="btn btn-block" onClick={start}><Camera size={14} />Start camera</button>
      </div>
    );
  return (
    <div className="stack">
      <video ref={video} className="webcam" muted playsInline />
      <label className="field"><span>Ink sensitivity</span><input type="range" min={60} max={180} value={threshold} onChange={(e) => setThreshold(+e.target.value)} /></label>
      <div className="row gap">
        <button className="btn btn-primary grow" onClick={capture}><Camera size={14} />Capture</button>
        <button className="btn" onClick={() => (stream.getTracks().forEach((t) => t.stop()), setStream(null))}>Stop</button>
      </div>
    </div>
  );
}

/* ---------------- OCR ---------------- */
export function OcrPanel() {
  const ed = useEditor();
  const toast = useToast();
  const [scope, setScope] = useState<'page' | 'all'>('page');
  const [phase, setPhase] = useState<{ kind: 'idle' } | { kind: 'running'; page: number; of: number; f: number; status: string } | { kind: 'done'; text: string; words: Map<number, OcrWord[]> }>({ kind: 'idle' });
  const [hasText, setHasText] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  const src = ed.state.pageOrder[ed.current];

  useEffect(() => void textRuns(ed.pdf, src).then((r) => setHasText(r.length > 0)), [ed.pdf, src]);
  useEffect(() => () => cancel.current?.(), []);

  const run = async () => {
    const pages = scope === 'page' ? [src] : ed.state.pageOrder;
    let stopped = false;
    setPhase({ kind: 'running', page: 1, of: pages.length, f: 0, status: 'Loading OCR engine…' });
    try {
      const { createWorker } = await import('tesseract.js');
      let current = 0;
      const worker = await createWorker('eng', 1, {
        logger: (m) => setPhase((p) => (p.kind === 'running' ? { ...p, f: m.progress ?? 0, status: m.status === 'recognizing text' ? `Scanning page ${current + 1} of ${pages.length}` : m.status } : p)),
      });
      cancel.current = () => { stopped = true; worker.terminate(); };
      const words = new Map<number, OcrWord[]>();
      let text = '';
      for (const [i, pi] of pages.entries()) {
        current = i;
        const scale = 2;
        const canvas = await renderToCanvas(await ed.pdf.getPage(pi + 1), scale);
        const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
        if (stopped) return;
        text += (pages.length > 1 ? `\n— Page ${ed.state.pageOrder.indexOf(pi) + 1} —\n` : '') + data.text;
        const ws: OcrWord[] = [];
        for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words)
          if (w.text.trim() && w.confidence > 40) ws.push({ text: w.text, x: w.bbox.x0 / scale, y: w.bbox.y0 / scale, w: (w.bbox.x1 - w.bbox.x0) / scale, h: (w.bbox.y1 - w.bbox.y0) / scale });
        words.set(pi, ws);
      }
      await worker.terminate();
      cancel.current = null;
      setPhase({ kind: 'done', text: text.trim(), words });
      toast({ kind: 'info', text: `OCR scan complete — ${pages.length} page${pages.length > 1 ? 's' : ''} processed` });
    } catch (e: any) {
      if (stopped) return;
      setPhase({ kind: 'idle' });
      toast({ kind: 'error', text: `OCR failed: ${e?.message ?? e}. The engine downloads from cdn.jsdelivr.net — check your connection.` });
    }
  };

  const addLayer = async () => {
    if (phase.kind !== 'done') return;
    setAdding(true);
    try {
      const { bytes, added } = await addTextLayer(ed.bytes, phase.words);
      await ed.replaceBytes(bytes, ed.state, false);
      toast({ kind: 'success', text: `Added ${added} searchable words. You can now search and select this text.` });
      setPhase({ kind: 'idle' });
    } catch (e: any) {
      toast({ kind: 'error', text: `Couldn't add the text layer: ${e?.message ?? e}` });
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <Head eyebrow="OCR" title="Recognize text" />
      <div className="panel-body stack">
        {phase.kind === 'idle' && (
          <>
            <Segmented label="Pages to scan" value={scope} onChange={setScope} options={[
              { value: 'page', label: `Page ${ed.current + 1}` }, { value: 'all', label: `All ${ed.state.pageOrder.length} pages` },
            ]} />
            {hasText && scope === 'page' && <div className="alert alert-info"><Info size={14} />This page already has selectable text. OCR is for scanned pages.</div>}
            <p className="small muted">Language: English. OCR runs in your browser — your document isn't uploaded. The engine and language data (~15 MB) download from cdn.jsdelivr.net on first use.</p>
            <button className="btn btn-primary btn-block" onClick={run}>Start OCR scan</button>
          </>
        )}
        {phase.kind === 'running' && (
          <>
            <div className="progress" role="progressbar" aria-valuenow={Math.round(((phase.page - 1 + phase.f) / phase.of) * 100)}>
              <div className="progress-bar"><span style={{ width: `${phase.f * 100}%` }} /></div>
              <span className="small muted">{phase.status}</span>
            </div>
            <button className="btn" onClick={() => (cancel.current?.(), setPhase({ kind: 'idle' }))}>Cancel</button>
          </>
        )}
        {phase.kind === 'done' && (
          <>
            <div className="ok-line"><CheckCircle2 size={16} />Scanning complete</div>
            <div className="eyebrow">Extracted text preview</div>
            <textarea className="ocr-text" readOnly value={phase.text || '(No text found)'} rows={10} aria-label="Extracted text" />
            <button className="btn btn-block" disabled={!phase.text} onClick={async () => {
              try { await navigator.clipboard.writeText(phase.text); toast({ kind: 'success', text: 'Copied extracted text' }); }
              catch { toast({ kind: 'error', text: "Couldn't access the clipboard. Select the text and copy it manually." }); }
            }}><Copy size={14} />Copy Extracted Text</button>
            <button className="btn btn-primary btn-block" disabled={adding || ![...phase.words.values()].some((w) => w.length)} onClick={addLayer}>
              {adding ? <><Loader2 size={14} className="spin" />Adding…</> : 'Make document searchable'}
            </button>
            <p className="tiny muted">Adds invisible text over the scanned image so you can search, select and copy it. Characters outside Latin text are skipped.</p>
            <button className="link small" onClick={() => setPhase({ kind: 'idle' })}>Scan again</button>
          </>
        )}
      </div>
    </>
  );
}
