import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Bookmark, BookmarkPlus, MessageSquare, ChevronDown, ChevronUp, Columns2, LayoutGrid, LayoutPanelLeft, List, Minus, PanelLeftClose,
  PanelLeftOpen, Plus, Rows2, Search, Square, SquareStack,
} from 'lucide-react';
import { outline, thumbnail, type OutlineNode, type PDFDocumentProxy } from '../lib/pdf';
import { IconBtn, Menu, Segmented, Toggle } from '../ui/ui';
import { useEditor } from './ctx';

export type LeftTab = 'pages' | 'bookmarks' | 'outline' | 'layout' | 'search';
type SearchOpts = { q: string; matchCase: boolean; wholeWord: boolean };

const TABS: [LeftTab, string, React.ReactNode][] = [
  ['pages', 'Pages', <LayoutGrid size={18} />],
  ['bookmarks', 'Bookmarks', <Bookmark size={18} />],
  ['outline', 'Outline', <List size={18} />],
  ['layout', 'Page layout', <LayoutPanelLeft size={18} />],
  ['search', 'Search in document', <Search size={18} />],
];

export function LeftSidebar(p: {
  open: boolean; setOpen: (v: boolean) => void; tab: LeftTab; setTab: (t: LeftTab) => void; back: () => void;
  search: SearchOpts; setSearch: (s: SearchOpts) => void; setActiveHit: (i: number) => void; onOrganize: () => void;
}) {
  const ed = useEditor();
  if (!p.open)
    return (
      <aside className="sidebar rail" aria-label="Navigation">
        <IconBtn icon={<PanelLeftOpen size={18} />} label="Expand sidebar" onClick={() => p.setOpen(true)} />
        <hr />
        {TABS.map(([t, label, icon]) => <IconBtn key={t} icon={icon} label={label} onClick={() => (p.setTab(t), p.setOpen(true))} />)}
        <div className="grow" />
        <IconBtn icon={<Plus size={16} />} label="Zoom in" onClick={() => ed.setZoom(ed.zoom * 1.2)} />
        <span className="tiny muted">{Math.round(ed.zoom * 100)}%</span>
        <IconBtn icon={<Minus size={16} />} label="Zoom out" onClick={() => ed.setZoom(ed.zoom / 1.2)} />
      </aside>
    );

  return (
    <aside className="sidebar editor-side" aria-label="Navigation">
      <div className="side-head">
        <button className="back-link" onClick={p.back}><ArrowLeft size={14} />Files &amp; Documents</button>
        <IconBtn icon={<PanelLeftClose size={16} />} label="Collapse sidebar" onClick={() => p.setOpen(false)} />
      </div>
      <div className="side-doc">
        <strong title={ed.meta.name}>{ed.meta.name}</strong>
        <span className="muted small">{ed.state.pageOrder.length} pages</span>
      </div>
      <div className="side-tabs" role="tablist">
        {TABS.map(([t, label, icon]) => (
          <button key={t} role="tab" aria-selected={p.tab === t} aria-label={label} data-tip={label} data-tip-pos="below"
            className={`icon-btn ${p.tab === t ? 'is-active' : ''}`} onClick={() => p.setTab(t)}>
            {icon}
          </button>
        ))}
      </div>
      <div className="side-body">
        {p.tab === 'pages' && <PagesTab onOrganize={p.onOrganize} />}
        {p.tab === 'bookmarks' && <BookmarksTab />}
        {p.tab === 'outline' && <OutlineTab />}
        {p.tab === 'layout' && <LayoutTab />}
        {p.tab === 'search' && <SearchTab search={p.search} setSearch={p.setSearch} setActiveHit={p.setActiveHit} />}
      </div>
      <ZoomBar />
    </aside>
  );
}

/* ---------- thumbnails ---------- */
const thumbCache = new WeakMap<PDFDocumentProxy, Map<string, string>>();

export function Thumb({ src, width }: { src: number; width: number }) {
  const ed = useEditor();
  const cache = thumbCache.get(ed.pdf) ?? (thumbCache.set(ed.pdf, new Map()), thumbCache.get(ed.pdf)!);
  const key = `${src}:${width}`;
  const [url, setUrl] = useState(cache.get(key));
  const ref = useRef<HTMLDivElement>(null);
  const s = ed.sizes[src];
  useEffect(() => {
    setUrl(cache.get(key));
    if (cache.has(key)) return;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const u = await thumbnail(ed.pdf, src, width * Math.min(2, window.devicePixelRatio || 1));
      cache.set(key, u);
      setUrl(u);
    }, { rootMargin: '300px' });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, [ed.pdf, key]);
  return (
    <div ref={ref} className="thumb" style={{ width, height: (width * s.h) / s.w }}>
      {url ? <img src={url} alt="" draggable={false} /> : <div className="skeleton fill" />}
    </div>
  );
}

function PagesTab({ onOrganize }: { onOrganize: () => void }) {
  const ed = useEditor();
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => void activeRef.current?.scrollIntoView({ block: 'nearest' }), [ed.current]);
  const counts = new Map<number, number>();
  ed.state.annotations.forEach((a) => counts.set(a.page, (counts.get(a.page) ?? 0) + 1));
  return (
    <>
      <div className="row-between pad-x">
        <span className="eyebrow">Page list</span>
        <button className="link small" onClick={onOrganize}><SquareStack size={14} />Organize</button>
      </div>
      <div className="thumb-list">
        {ed.state.pageOrder.map((src, d) => (
          <button key={src} ref={d === ed.current ? activeRef : undefined} className={`thumb-item ${d === ed.current ? 'is-active' : ''}`}
            onClick={() => ed.goto(d)} aria-label={`Go to page ${d + 1}`} aria-current={d === ed.current ? 'page' : undefined}>
            <Thumb src={src} width={200} />
            <span className="thumb-label">
              {d + 1}
              {ed.state.bookmarks.includes(src) && <Bookmark size={11} className="accent" />}
              {counts.get(src) ? <span className="badge badge-blue" title={`${counts.get(src)} annotations`}><MessageSquare size={10} />{counts.get(src)}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function BookmarksTab() {
  const ed = useEditor();
  const cur = ed.state.pageOrder[ed.current];
  const marked = ed.state.bookmarks.includes(cur);
  const list = ed.state.bookmarks.map((src) => ({ src, d: ed.state.pageOrder.indexOf(src) })).filter((b) => b.d >= 0).sort((a, b) => a.d - b.d);
  const toggle = (src: number) =>
    ed.commit((s) => ({ ...s, bookmarks: s.bookmarks.includes(src) ? s.bookmarks.filter((b) => b !== src) : [...s.bookmarks, src] }));
  return (
    <div className="pad-x stack">
      <button className="btn btn-block" onClick={() => toggle(cur)}>
        <BookmarkPlus size={14} />{marked ? `Remove bookmark from page ${ed.current + 1}` : `Bookmark page ${ed.current + 1}`}
      </button>
      {list.length === 0 ? <p className="muted small">No bookmarks yet. Bookmark pages you want to come back to.</p> : (
        <ul className="plain-list">
          {list.map(({ src, d }) => (
            <li key={src} className="list-row">
              <button className="list-main" onClick={() => ed.goto(d)}><Bookmark size={14} className="accent" />Page {d + 1}</button>
              <IconBtn icon={<Minus size={14} />} label="Remove bookmark" onClick={() => toggle(src)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OutlineTab() {
  const ed = useEditor();
  const [items, setItems] = useState<OutlineNode[] | null>(null);
  useEffect(() => void outline(ed.pdf).then(setItems).catch(() => setItems([])), [ed.pdf]);
  const node = (n: OutlineNode, i: number) => {
    const d = n.page === null ? -1 : ed.state.pageOrder.indexOf(n.page);
    const link = (
      <button className="outline-link" disabled={d < 0} onClick={() => ed.goto(d)} title={d < 0 ? 'Page removed or not found' : `Page ${d + 1}`}>
        <span>{n.title}</span>{d >= 0 && <span className="muted tiny">{d + 1}</span>}
      </button>
    );
    return n.items.length ? (
      <details key={i} open>
        <summary>{link}</summary>
        <div className="outline-children">{n.items.map(node)}</div>
      </details>
    ) : <div key={i}>{link}</div>;
  };
  if (!items) return <p className="pad-x muted small">Loading outline…</p>;
  if (!items.length) return <p className="pad-x muted small">This document has no outline. PDFs created with headings or a table of contents usually include one.</p>;
  return <div className="pad-x outline">{items.map(node)}</div>;
}

function LayoutTab() {
  const ed = useEditor();
  const L = ed.layout;
  return (
    <div className="pad-x stack">
      <div className="eyebrow">Page layout</div>
      <Segmented label="Pages per row" value={String(L.spread) as '1' | '2'} onChange={(v) => ed.setLayout({ spread: +v as 1 | 2 })}
        options={[{ value: '1', label: 'Single Page' }, { value: '2', label: 'Two Page' }]} />
      <Toggle label="Continuous scroll" checked={L.continuous} onChange={(v) => ed.setLayout({ continuous: v })} />
      <hr />
      <div className="eyebrow">Split view</div>
      <Segmented label="Split view" value={L.split} onChange={(v) => ed.setLayout({ split: v })}
        options={[
          { value: 'none', label: <Square size={16} />, title: 'No split' },
          { value: 'vertical', label: <Columns2 size={16} />, title: 'Side by side' },
          { value: 'horizontal', label: <Rows2 size={16} />, title: 'Top and bottom' },
        ]} />
      <hr />
      <div className="eyebrow">View options</div>
      <Toggle label="Show page gaps" checked={L.gaps} onChange={(v) => ed.setLayout({ gaps: v })} />
      <Toggle label="Show page numbers" checked={L.numbers} onChange={(v) => ed.setLayout({ numbers: v })} />
    </div>
  );
}

function SearchTab({ search, setSearch, setActiveHit }: { search: SearchOpts; setSearch: (s: SearchOpts) => void; setActiveHit: (i: number) => void }) {
  const ed = useEditor();
  const go = (i: number) => {
    const n = ed.hits.length;
    if (!n) return;
    const k = ((i % n) + n) % n;
    setActiveHit(k);
    ed.goto(ed.state.pageOrder.indexOf(ed.hits[k].page), ed.hits[k].rect);
  };
  return (
    <div className="pad-x stack">
      <label className="search">
        <Search size={14} />
        <input id="doc-search" placeholder="Search in document" value={search.q} aria-label="Search in document"
          onChange={(e) => setSearch({ ...search, q: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && go(ed.activeHit + (e.shiftKey ? -1 : 1))} />
      </label>
      <div className="row gap">
        <label className="check"><input type="checkbox" checked={search.matchCase} onChange={(e) => setSearch({ ...search, matchCase: e.target.checked })} />Match case</label>
        <label className="check"><input type="checkbox" checked={search.wholeWord} onChange={(e) => setSearch({ ...search, wholeWord: e.target.checked })} />Whole word</label>
      </div>
      {search.q && (
        <div className="row-between">
          <span className="small muted" role="status">{ed.hits.length ? `${ed.activeHit + 1} of ${ed.hits.length}${ed.hits.length >= 500 ? '+' : ''} results` : 'No results'}</span>
          <span className="row">
            <IconBtn icon={<ChevronUp size={14} />} label="Previous result" onClick={() => go(ed.activeHit - 1)} disabled={!ed.hits.length} />
            <IconBtn icon={<ChevronDown size={14} />} label="Next result" onClick={() => go(ed.activeHit + 1)} disabled={!ed.hits.length} />
          </span>
        </div>
      )}
      {search.q && ed.hits.length === 0 && <p className="muted small">Scanned pages have no text to search. Run OCR from the toolbar to make them searchable.</p>}
      <ul className="plain-list results">
        {ed.hits.slice(0, 200).map((h, i) => (
          <li key={i}>
            <button className={`result ${i === ed.activeHit ? 'is-active' : ''}`} onClick={() => go(i)}>
              <span className="badge">Pg. {ed.state.pageOrder.indexOf(h.page) + 1}</span>
              <span className="small">…{h.snippet[0]}<mark>{h.snippet[1]}</mark>{h.snippet[2]}…</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ZoomBar() {
  const ed = useEditor();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // log scale so 25%–400% feels even
  const toSlider = (z: number) => Math.round(Math.log2(z) * 100);
  return (
    <div className="zoombar">
      <IconBtn icon={<Minus size={14} />} label="Zoom out" shortcut="⌘−" onClick={() => ed.setZoom(ed.zoom / 1.2)} />
      <input type="range" min={-200} max={200} value={toSlider(ed.zoom)} aria-label="Zoom" onChange={(e) => ed.setZoom(2 ** (+e.target.value / 100))} />
      <IconBtn icon={<Plus size={14} />} label="Zoom in" shortcut="⌘+" onClick={() => ed.setZoom(ed.zoom * 1.2)} />
      <button className="zoom-pct" aria-label="Zoom presets" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.top }); }}>
        {Math.round(ed.zoom * 100)}%
      </button>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: 'Fit to width', onClick: () => ed.setZoom(ed.zoom, 'width') },
          { label: 'Fit to page', onClick: () => ed.setZoom(ed.zoom, 'page') },
          'sep',
          ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => ({ label: `${z * 100}%`, onClick: () => ed.setZoom(z) })),
        ]} />
      )}
    </div>
  );
}
