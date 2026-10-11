import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, FileText, FileUp, Loader2, PanelRightClose, PanelRightOpen, Search, Settings } from 'lucide-react';
import { openSettings } from '../ui/Settings';
import { onCommand } from '../lib/desktop';
import { importFile } from '../lib/docs';
import type { Annot, DocMeta, DocState, Rect, Tool } from '../lib/types';
import { getBytes, getState, listDocs, patchMeta, putBytes, putState } from '../lib/store';
import { translate } from '../lib/geom';
import { openPdf, pageSizes, searchPdf, thumbnail, type PDFDocumentProxy, type PageSize, type SearchHit } from '../lib/pdf';
import { IconBtn, useToast } from '../ui/ui';
import { askText } from '../ui/prompt';
import { EditorCtx, type EditorApi, type Fit, type Placeable, type ToolOpts } from './ctx';
import { getPrefs, lastPage, setPrefs, usePrefs } from '../lib/prefs';
import { Viewer } from './Viewer';
import { LeftSidebar, type LeftTab } from './LeftSidebar';
import { RightPanel } from './RightPanel';
import { Toolbar } from './Toolbar';
import { ExportDialog } from './ExportDialog';
import { PageManager } from './PageManager';
import { LABEL_CLASS } from '../dashboard/Dashboard';

type Status = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';

interface Loaded { meta: DocMeta; bytes: Uint8Array; pdf: PDFDocumentProxy; sizes: PageSize[] }

export function Editor({ id, back, open }: { id: string; back: () => void; open: (id: string) => void }) {
  const toast = useToast();
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setStateRaw] = useState<DocState | null>(null);
  const stateRef = useRef<DocState | null>(null);
  const past = useRef<DocState[]>([]);
  const future = useRef<DocState[]>([]);
  const [, bump] = useState(0);
  const [status, setStatus] = useState<Status>('loading');
  const [saveError, setSaveError] = useState('');
  const dirty = useRef(false);
  const timer = useRef<number>();
  const thumbFor = useRef<number>(-1);

  const [tool, setToolRaw] = useState<Tool>('select');
  const prefs = usePrefs();
  const [place, setPlace] = useState<Placeable | undefined>();
  const [redactMode, setRedactMode] = useState<'area' | 'text'>('area');
  const opts: ToolOpts = useMemo(() => ({ ...prefs.tools, redactMode, place }), [prefs.tools, redactMode, place]);
  const [selectedId, select] = useState<string | null>(null);
  const [editingId, setEditing] = useState<string | null>(null);
  const [zoom, setZoomRaw] = useState(1);
  const [fit, setFit] = useState<Fit>(() => (prefs.zoom === '1' ? null : prefs.zoom));
  const layout = prefs.layout;
  const [current, setCurrent] = useState(0);
  const [leftTab, setLeftTab] = useState<LeftTab>('pages');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [showExport, setShowExport] = useState(false);
  const [organize, setOrganize] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [search, setSearch] = useState({ q: '', matchCase: false, wholeWord: false });
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeHit, setActiveHit] = useState(0);
  const scrollers = useRef(new Set<(d: number, r?: Rect) => void>()).current;

  /* ---------- load ---------- */
  useEffect(() => {
    let alive = true, pdf: PDFDocumentProxy | undefined;
    (async () => {
      const meta = (await listDocs()).find((d) => d.id === id);
      if (!meta) throw new Error("This document doesn't exist in this browser anymore.");
      const bytes = await getBytes(id);
      if (!bytes) throw new Error(`The file data for ${meta.name} is missing from storage.`);
      pdf = await openPdf(bytes);
      const [sizes, st] = await Promise.all([pageSizes(pdf), getState(id, pdf.numPages)]);
      if (!alive) return;
      await patchMeta(id, { openedAt: Date.now() });
      stateRef.current = st;
      thumbFor.current = st.pageOrder[0];
      setStateRaw(st);
      setDoc({ meta, bytes, pdf, sizes });
      setStatus('saved');
    })().catch((e) => alive && (setLoadError(e.message ?? String(e)), setStatus('error')));
    return () => { alive = false; pdf?.destroy(); };
  }, [id]);

  // reopen where the reader left off
  useEffect(() => {
    if (!doc || !getPrefs().resume) return;
    const p = Math.min(lastPage.get(id), stateRef.current!.pageOrder.length - 1);
    if (p > 0) setTimeout(() => apiRef.current?.goto(p), 50);
  }, [doc?.meta.id]);
  useEffect(() => void (doc && lastPage.set(id, current)), [current]);
  // flush pending edits if the editor goes away without "Back" (browser back button, switching documents)
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (dirty.current && stateRef.current) void putState(id, stateRef.current);
  }, [id]);

  /* ---------- save ---------- */
  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (!dirty.current || !stateRef.current) return;
    dirty.current = false;
    setStatus('saving');
    const snap = stateRef.current;
    try {
      await putState(id, snap);
      const patch: Partial<DocMeta> = { pages: snap.pageOrder.length };
      if (doc && snap.pageOrder[0] !== thumbFor.current) {
        patch.thumb = await thumbnail(doc.pdf, snap.pageOrder[0]);
        thumbFor.current = snap.pageOrder[0];
      }
      await patchMeta(id, patch);
      setStatus(dirty.current ? 'unsaved' : 'saved');
    } catch (e: any) {
      dirty.current = true; // keep the edits; they're still in memory
      setSaveError(e?.name === 'QuotaExceededError' ? 'Browser storage is full' : e?.message ?? 'Unknown error');
      setStatus('error');
    }
  }, [id, doc]);

  const markDirty = useCallback(() => {
    dirty.current = true;
    setStatus('unsaved');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(save, 800);
  }, [save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const leave = async (then: () => void) => {
    await save();
    if (dirty.current) {
      toast({ kind: 'error', text: "Your changes couldn't be saved. Fix the problem or export before leaving." });
      return;
    }
    then();
  };

  /* ---------- state + history ---------- */
  const setDocState = useCallback((next: DocState) => {
    stateRef.current = next;
    setStateRaw(next);
    markDirty();
  }, [markDirty]);
  const begin = useCallback(() => {
    past.current.push(stateRef.current!);
    if (past.current.length > 200) past.current.shift();
    future.current = [];
  }, []);
  const apply = useCallback((fn: (s: DocState) => DocState) => setDocState(fn(stateRef.current!)), [setDocState]);
  const commit = useCallback((fn: (s: DocState) => DocState) => (begin(), apply(fn)), [begin, apply]);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(stateRef.current!);
    setEditing(null);
    setDocState(prev);
    bump((n) => n + 1);
  }, [setDocState]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(stateRef.current!);
    setDocState(next);
    bump((n) => n + 1);
  }, [setDocState]);

  useEffect(() => {
    if (selectedId && state && !state.annotations.some((a) => a.id === selectedId)) select(null);
  }, [state, selectedId]);

  /* ---------- search ---------- */
  useEffect(() => {
    if (!doc || !state) return;
    let alive = true;
    const t = setTimeout(async () => {
      const h = await searchPdf(doc.pdf, state.pageOrder, search.q, search);
      if (alive) (setHits(h), setActiveHit(0));
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [search, doc, state?.pageOrder]);

  const api: EditorApi | null = useMemo(() => {
    if (!doc || !state) return null;
    const goto = (display: number, rect?: Rect) => {
      const d = Math.max(0, Math.min(state.pageOrder.length - 1, display));
      setCurrent(d);
      scrollers.forEach((s) => s(d, rect));
    };
    return {
      meta: doc.meta, pdf: doc.pdf, bytes: doc.bytes, sizes: doc.sizes, state,
      tool, setTool: (t) => {
        setToolRaw(t);
        setEditing(null);
        if (t !== 'select') select(null);
        if (t !== 'place') setPlace(undefined);
        if (['image', 'stamp', 'signature', 'ocr', 'redact'].includes(t)) setRightOpen(true); // their controls live in the panel
      },
      opts, setOpts: (p) => {
        const { place: pl, redactMode: rm, ...rest } = p;
        if ('place' in p) setPlace(pl);
        if (rm) setRedactMode(rm);
        if (Object.keys(rest).length) setPrefs((q) => ({ tools: { ...q.tools, ...rest } }));
      },
      selectedId, select: (i) => { select(i); if (i !== editingId) setEditing(null); }, editingId, setEditing,
      zoom, fit, setZoom: (z, f = null) => { setZoomRaw(Math.max(0.25, Math.min(4, z))); setFit(f); },
      layout, setLayout: (p) => setPrefs((q) => ({ layout: { ...q.layout, ...p } })),
      current, setCurrent, goto, scrollers,
      commit, begin, apply,
      add: (a, o = {}) => {
        commit((s) => ({ ...s, annotations: [...s.annotations, a] }));
        if (o.select ?? true) select(a.id);
        if (o.edit) setEditing(a.id);
      },
      patch: (aid, p, history = true) =>
        (history ? commit : apply)((s) => ({ ...s, annotations: s.annotations.map((a) => (a.id === aid ? ({ ...a, ...p } as Annot) : a)) })),
      remove: (aid) => { commit((s) => ({ ...s, annotations: s.annotations.filter((a) => a.id !== aid) })); select(null); setEditing(null); },
      hits, activeHit,
      replaceBytes: async (bytes, next, clearHistory) => {
        await putBytes(id, bytes);
        const pdf = await openPdf(bytes);
        const sizes = await pageSizes(pdf);
        await doc.pdf.destroy();
        if (clearHistory) (past.current = [], future.current = []);
        const thumb = await thumbnail(pdf, next.pageOrder[0]);
        setDoc({ ...doc, bytes, pdf, sizes, meta: { ...doc.meta, size: bytes.length, thumb } });
        await patchMeta(id, { size: bytes.length, thumb });
        setDocState(next);
        await save();
      },
    };
  }, [doc, state, tool, opts, selectedId, editingId, zoom, fit, layout, current, hits, activeHit, commit, begin, apply, setDocState, save]);

  /* ---------- native menu commands ---------- */
  useEffect(() => onCommand((cmd) => {
    const a = apiRef.current;
    if (!a) return;
    if (cmd === 'undo') undo();
    if (cmd === 'redo') redo();
    if (cmd === 'export') setShowExport(true);
    if (cmd === 'find') (setLeftOpen(true), setLeftTab('search'), setTimeout(() => document.getElementById('doc-search')?.focus()));
    if (cmd === 'zoom-in') a.setZoom(a.zoom * 1.2);
    if (cmd === 'zoom-out') a.setZoom(a.zoom / 1.2);
    if (cmd === 'zoom-fit') a.setZoom(a.zoom, 'width');
  }), [undo, redo]);

  /* ---------- keyboard ---------- */
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = apiRef.current;
      if (!a) return;
      const mod = e.metaKey || e.ctrlKey;
      const typing = (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      if (mod && e.key.toLowerCase() === 's') return e.preventDefault(), void save();
      if (mod && e.key.toLowerCase() === 'f') return e.preventDefault(), setLeftOpen(true), setLeftTab('search'), setTimeout(() => document.getElementById('doc-search')?.focus());
      if (mod && (e.key === '=' || e.key === '+')) return e.preventDefault(), a.setZoom(a.zoom * 1.2);
      if (mod && e.key === '-') return e.preventDefault(), a.setZoom(a.zoom / 1.2);
      if (mod && e.key === '0') return e.preventDefault(), a.setZoom(a.zoom, 'width');
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') return e.preventDefault(), e.shiftKey ? redo() : undo();
      if (mod && e.key.toLowerCase() === 'y') return e.preventDefault(), redo();
      if (mod) return;
      const sel = a.state.annotations.find((x) => x.id === a.selectedId);
      if (sel && (e.key === 'Delete' || e.key === 'Backspace')) return e.preventDefault(), a.remove(sel.id);
      if (e.key === 'Escape') return a.selectedId ? a.select(null) : a.setTool('select');
      if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key as 'ArrowUp'] ?? [0, 0];
        a.commit((s) => ({ ...s, annotations: s.annotations.map((x) => (x.id === sel.id ? translate(x, dx, dy) : x)) }));
        return;
      }
      if (e.key === 'PageDown' || (!a.layout.continuous && e.key === 'ArrowRight')) return e.preventDefault(), a.goto(a.current + a.layout.spread);
      if (e.key === 'PageUp' || (!a.layout.continuous && e.key === 'ArrowLeft')) return e.preventDefault(), a.goto(a.current - a.layout.spread);
      const keys: Record<string, Tool> = { v: 'select', h: 'hand', t: 'text', p: 'pencil', e: 'eraser', r: 'shape', n: 'note', c: 'comment' };
      if (keys[e.key]) a.setTool(keys[e.key]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, redo]);

  const rename = async () => {
    const name = (await askText({ title: 'Rename document', label: 'File name', initial: doc?.meta.name, confirm: 'Rename' }))?.trim();
    if (!name || !doc) return;
    const full = /\.pdf$/i.test(name) ? name : `${name}.pdf`;
    await patchMeta(id, { name: full });
    setDoc({ ...doc, meta: { ...doc.meta, name: full } });
  };

  const topBar = (status: Status) => (
      <header className="topbar">
        <button className="brand" onClick={() => leave(back)} aria-label="DocFlow — back to files"><span className="logo"><FileText size={16} /></span>DocFlow</button>
        <DocSwitcher onPick={(d) => leave(() => open(d))} />
        <div className="doc-title">
          {doc && (
            <>
              <FileText size={16} className="muted" />
              <button className="doc-name" onClick={rename} data-tip="Rename" data-tip-pos="below">{doc.meta.name}</button>
              {doc.meta.label && <span className={`badge badge-${LABEL_CLASS[doc.meta.label]}`}>{doc.meta.label}</span>}
            </>
          )}
          <SaveStatus status={status} error={saveError} retry={save} />
        </div>
        <div className="topbar-right">
          {doc && <IconBtn icon={rightOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />} label={rightOpen ? 'Hide properties' : 'Show properties'} onClick={() => setRightOpen(!rightOpen)} tipBelow />}
          <IconBtn icon={<Settings size={18} />} label="Settings" shortcut="⌘," onClick={openSettings} tipBelow />
          <button className="btn btn-primary" disabled={!doc} onClick={() => setShowExport(true)}>Export</button>
        </div>
      </header>
  );


  if (loadError)
    return (
      <div className="app center-screen">
        <AlertCircle size={28} className="err" />
        <strong>Couldn't open this document</strong>
        <span className="muted">{loadError}</span>
        <button className="btn btn-primary" onClick={back}>Back to files</button>
      </div>
    );

  if (!api || !doc)
    return (
      <div className="app">
        {topBar('loading')}
        <div className="center-screen grow"><Loader2 className="spin" size={24} /><span className="muted">Loading document…</span></div>
      </div>
    );

  return (
    <EditorCtx.Provider value={api}>
      <div className="app"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) (e.preventDefault(), setDropping(true)); }}
        onDragLeave={(e) => !e.relatedTarget && setDropping(false)}
        onDrop={async (e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDropping(false);
          try {
            const meta = await importFile(e.dataTransfer.files[0]);
            if (meta) leave(() => open(meta.id));
          } catch (err: any) {
            toast({ kind: 'error', text: err.message });
          }
        }}>
        {dropping && <div className="drop-overlay"><div><FileUp size={28} />Drop to open this PDF</div></div>}
        {topBar(status)}
        <div className="workspace">
          <LeftSidebar open={leftOpen} setOpen={setLeftOpen} tab={leftTab} setTab={setLeftTab} back={() => leave(back)}
            search={search} setSearch={setSearch} setActiveHit={setActiveHit} onOrganize={() => setOrganize(true)} />
          <main className="canvas-area">
            {organize ? (
              <PageManager onClose={() => setOrganize(false)} />
            ) : (
              <>
                <div className={`viewers split-${layout.split}`}>
                  <Viewer primary />
                  {layout.split !== 'none' && <Viewer />}
                </div>
                <Toolbar undo={undo} redo={redo} canUndo={past.current.length > 0} canRedo={future.current.length > 0} />
              </>
            )}
          </main>
          {rightOpen && <RightPanel />}
        </div>
        {showExport && <ExportDialog meta={doc.meta} bytes={doc.bytes} state={state!} onClose={() => setShowExport(false)} />}
      </div>
    </EditorCtx.Provider>
  );
}

function SaveStatus({ status, error, retry }: { status: Status; error: string; retry: () => void }) {
  if (status === 'loading') return <span className="status status-muted"><Loader2 size={12} className="spin" />Loading</span>;
  if (status === 'saving') return <span className="status status-muted" role="status"><Loader2 size={12} className="spin" />Saving…</span>;
  if (status === 'unsaved') return <span className="status status-warn" role="status"><span className="dot dot-amber" />Unsaved changes</span>;
  if (status === 'error')
    return (
      <span className="status status-error" role="alert">
        <AlertCircle size={12} />Save failed{error ? `: ${error}` : ''}
        <button className="link" onClick={retry}>Retry</button>
      </span>
    );
  return <span className="status status-ok" role="status"><Check size={12} />Saved</span>;
}

function DocSwitcher({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [open, setOpen] = useState(false);
  const shown = docs.filter((d) => d.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div className="switcher" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <label className="search">
        <Search size={14} />
        <input placeholder="Search documents…" value={q} aria-label="Search documents" aria-expanded={open}
          onFocus={async () => (setDocs(await listDocs()), setOpen(true))} onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown[0]) onPick(shown[0].id);
            if (e.key === 'ArrowDown') (e.preventDefault(), (e.currentTarget.closest('.switcher')?.querySelector('.switcher-item') as HTMLElement | null)?.focus());
            if (e.key === 'Escape') (setOpen(false), e.currentTarget.blur());
          }} />
      </label>
      {open && (
        <div className="switcher-list" role="listbox">
          {shown.length === 0 ? <div className="muted small pad">No matching documents</div> : shown.map((d) => (
            <button key={d.id} role="option" className="switcher-item" onClick={() => onPick(d.id)}
              onKeyDown={(e) => {
                const sib = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.key === 'ArrowUp' ? e.currentTarget.previousElementSibling : null;
                if (sib) (e.preventDefault(), (sib as HTMLElement).focus());
                if (e.key === 'Escape') setOpen(false);
              }}>
              <FileText size={14} /><span>{d.name}</span><span className="muted small">{d.pages} p</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

