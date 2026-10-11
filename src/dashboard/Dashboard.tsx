import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  CloudUpload, Combine, Copy, Download, FileText, Folder, FolderPlus, Minimize2, MoreHorizontal, PanelLeftClose, PanelLeftOpen,
  Pencil, Plus, RefreshCw, Search, Star, Tag, Trash2, X, FolderOpen, Clock, Lock, Settings,
} from 'lucide-react';
import { LABELS, type DocMeta, type Label } from '../lib/types';
import { deleteDoc, getBytes, getList, listDocs, patchMeta, pushList } from '../lib/store';
import { addDocument, duplicateDoc, importFile } from '../lib/docs';
import { blankPdf } from '../lib/pdfwrite';
import { IconBtn, Menu, download, fmtAgo, fmtSize, useToast, type MenuItem } from '../ui/ui';
import { askConfirm, askText } from '../ui/prompt';
import { ToolDialog, type ToolKind } from './ToolDialog';
import { openSettings } from '../ui/Settings';
import { desktop, onCommand } from '../lib/desktop';

type View = { kind: 'recent' } | { kind: 'starred' } | { kind: 'folder'; name: string } | { kind: 'label'; label: Label };

export const LABEL_CLASS: Record<Label, string> = { Draft: 'sky', Review: 'amber', Approved: 'green', Completed: 'green', Archived: 'gray' };

export function Dashboard({ open }: { open: (id: string) => void }) {
  const toast = useToast();
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [view, setView] = useState<View>({ kind: 'recent' });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'opened' | 'name' | 'size'>('opened');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tool, setTool] = useState<{ kind: ToolKind; ids?: string[] } | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('df.sidebar') === '1');

  const refresh = useCallback(async () => {
    setDocs(await listDocs());
    setFolders(await getList('folders'));
  }, []);
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => onCommand((cmd) => cmd === 'new' && newBlank()), []);
  useEffect(() => void localStorage.setItem('df.sidebar', collapsed ? '1' : '0'), [collapsed]);

  const run = async (label: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(label);
    try {
      await fn();
      if (success) toast({ kind: 'success', text: success });
    } catch (e: any) {
      toast({ kind: 'error', text: e?.message ?? String(e) });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const newBlank = () => run('Creating…', async () => open((await addDocument('Untitled.pdf', await blankPdf())).id));

  const importFiles = (files: File[]) =>
    run(files.length > 1 ? `Importing ${files.length} files…` : `Opening ${files[0]?.name}…`, async () => {
      let last: DocMeta | null = null;
      for (const f of files) last = (await importFile(f)) ?? last;
      if (files.length === 1 && last) open(last.id);
      else if (last) toast({ kind: 'success', text: `Imported ${files.length} files` });
    });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) importFiles(files);
  };

  const shown = useMemo(() => {
    if (!docs) return [];
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q) && !(d.label ?? '').toLowerCase().includes(q)) return false;
      if (view.kind === 'starred') return d.starred;
      if (view.kind === 'folder') return d.folder === view.name;
      if (view.kind === 'label') return d.label === view.label;
      return true;
    }).sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.size - a.size : b.openedAt - a.openedAt));
  }, [docs, query, view, sort]);

  const title = view.kind === 'recent' ? 'Recent Files' : view.kind === 'starred' ? 'Starred' : view.kind === 'folder' ? view.name : `${view.label}`;

  const newFolder = async (thenMove?: string[]) => {
    const name = (await askText({ title: 'New folder', label: 'Folder name', confirm: 'Create' }))?.trim();
    if (!name) return;
    await pushList('folders', name, 100);
    if (thenMove) for (const id of thenMove) await patchMeta(id, { folder: name });
    refresh();
  };

  const moveItems = (ids: string[]): MenuItem[] => [
    ...folders.map((f) => ({ label: f, icon: <Folder size={14} />, onClick: () => run('', async () => { for (const id of ids) await patchMeta(id, { folder: f }); }) })),
    ...(folders.length ? ['sep' as const] : []),
    { label: 'New folder…', icon: <FolderPlus size={14} />, onClick: () => newFolder(ids) },
    { label: 'Remove from folder', icon: <X size={14} />, onClick: () => run('', async () => { for (const id of ids) await patchMeta(id, { folder: undefined }); }) },
  ];

  const remove = async (ids: string[]) => {
    const names = docs!.filter((d) => ids.includes(d.id)).map((d) => d.name);
    const ok = await askConfirm({
      title: ids.length > 1 ? `Delete ${ids.length} documents?` : `Delete ${names[0]}?`,
      body: <p>The {ids.length > 1 ? 'documents and their' : 'document and its'} edits will be permanently removed from this browser. This can't be undone.</p>,
      confirm: 'Delete', danger: true,
    });
    if (!ok) return;
    run('Deleting…', async () => { for (const id of ids) await deleteDoc(id); setSelected(new Set()); }, ids.length > 1 ? `Deleted ${ids.length} documents` : `Deleted ${names[0]}`);
  };

  const docMenu = (d: DocMeta): MenuItem[] => [
    { label: 'Open document', icon: <FolderOpen size={14} />, onClick: () => open(d.id) },
    { label: 'Rename', icon: <Pencil size={14} />, onClick: async () => {
      const name = (await askText({ title: 'Rename document', label: 'File name', initial: d.name, confirm: 'Rename' }))?.trim();
      if (name) run('', () => patchMeta(d.id, { name: /\.pdf$/i.test(name) ? name : `${name}.pdf` }));
    } },
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: () => run('Duplicating…', () => duplicateDoc(d), `Duplicated ${d.name}`) },
    { label: d.starred ? 'Remove star' : 'Star', icon: <Star size={14} />, onClick: () => run('', () => patchMeta(d.id, { starred: !d.starred })) },
    { label: 'Move to folder', icon: <Folder size={14} />, submenu: moveItems([d.id]) },
    { label: 'Label', icon: <Tag size={14} />, submenu: [
      ...LABELS.map((l) => ({ label: l, icon: <span className={`dot dot-${LABEL_CLASS[l]}`} />, onClick: () => run('', () => patchMeta(d.id, { label: l })) })),
      'sep' as const,
      { label: 'No label', onClick: () => run('', () => patchMeta(d.id, { label: undefined })) },
    ] },
    'sep',
    { label: 'Compress PDF', icon: <Minimize2 size={14} />, onClick: () => setTool({ kind: 'compress', ids: [d.id] }) },
    { label: 'Export original', icon: <Download size={14} />, onClick: () => run('', async () => {
      const b = await getBytes(d.id);
      if (!b) throw new Error('File data is missing from storage');
      download(new Blob([b as BlobPart], { type: 'application/pdf' }), d.name);
    }) },
    'sep',
    { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => remove([d.id]) },
  ];

  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const navItem = (v: View, icon: React.ReactNode, label: string, count?: number) => {
    const active = JSON.stringify(v) === JSON.stringify(view);
    return (
      <button className={`nav-item ${active ? 'is-active' : ''}`} onClick={() => (setView(v), setSelected(new Set()))} data-tip={collapsed ? label : undefined} aria-label={label}>
        {icon}
        {!collapsed && <span>{label}</span>}
        {!collapsed && count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
      </button>
    );
  };

  return (
    <div className="app" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) (e.preventDefault(), setDragging(true)); }} onDragLeave={(e) => !e.relatedTarget && setDragging(false)} onDrop={onDrop}>
      {dragging && <div className="drop-overlay"><div><CloudUpload size={28} />Drop PDFs to open them</div></div>}
      <header className="topbar">
        <div className="brand"><span className="logo"><FileText size={16} /></span>DocFlow</div>
        <label className="search topbar-search">
          <Search size={16} />
          <input placeholder="Search files and labels…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search documents" />
          {query && <IconBtn icon={<X size={14} />} label="Clear search" onClick={() => setQuery('')} tipBelow />}
        </label>
        <div className="topbar-right">
          <span className="muted small privacy-note"><Lock size={13} />Files stay on this device</span>
          <IconBtn icon={<Settings size={18} />} label="Settings" shortcut="⌘," onClick={openSettings} tipBelow />
        </div>
      </header>

      <div className="dash">
        <aside className={`sidebar dash-side ${collapsed ? 'collapsed' : ''}`}>
          <div className="side-section">
            {!collapsed && <div className="eyebrow">Quick tools</div>}
            <button className="nav-item" data-tip={collapsed ? 'New blank PDF' : undefined} aria-label="New blank PDF"
              onClick={newBlank}>
              <Plus size={16} />{!collapsed && <span>New Blank PDF</span>}
            </button>
            <button className="nav-item" data-tip={collapsed ? 'Merge files' : undefined} aria-label="Merge files" onClick={() => setTool({ kind: 'merge', ids: [...selected] })}>
              <Combine size={16} />{!collapsed && <span>Merge Files</span>}
            </button>
            <button className="nav-item" data-tip={collapsed ? 'Compress PDF' : undefined} aria-label="Compress PDF" onClick={() => setTool({ kind: 'compress', ids: [...selected].slice(0, 1) })}>
              <Minimize2 size={16} />{!collapsed && <span>Compress PDF</span>}
            </button>
            <button className="nav-item" data-tip={collapsed ? 'Convert file' : undefined} aria-label="Convert file" onClick={() => setTool({ kind: 'convert', ids: [...selected].slice(0, 1) })}>
              <RefreshCw size={16} />{!collapsed && <span>Convert File</span>}
            </button>
          </div>
          <div className="side-section">
            {!collapsed && <div className="eyebrow">My files</div>}
            {navItem({ kind: 'recent' }, <Clock size={16} />, 'Recent Files')}
            {navItem({ kind: 'starred' }, <Star size={16} />, 'Starred', docs?.filter((d) => d.starred).length)}
            {folders.map((f) => <div key={f}>{navItem({ kind: 'folder', name: f }, <Folder size={16} />, f, docs?.filter((d) => d.folder === f).length)}</div>)}
            <button className="nav-item subtle" onClick={() => newFolder()} data-tip={collapsed ? 'New folder' : undefined} aria-label="New folder">
              <FolderPlus size={16} />{!collapsed && <span>New folder</span>}
            </button>
          </div>
          {!collapsed && (
            <div className="side-section">
              <div className="eyebrow">Labels</div>
              {LABELS.map((l) => <div key={l}>{navItem({ kind: 'label', label: l }, <span className={`dot dot-${LABEL_CLASS[l]}`} />, l, docs?.filter((d) => d.label === l).length)}</div>)}
            </div>
          )}
          <div className="side-foot">
            <IconBtn icon={collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />} label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)} />
          </div>
        </aside>

        <main className="dash-main">
          <button className={`dropzone ${dragging ? 'is-over' : ''}`} onClick={() => {
            if (desktop) return void desktop.openDialog();
            const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/pdf,.pdf', multiple: true });
            input.onchange = () => input.files?.length && importFiles([...input.files]);
            input.click();
          }}>
            <span className="dz-icon"><CloudUpload size={22} /></span>
            <strong>{dragging ? 'Drop to open' : 'Drag & drop your PDF here to start editing'}</strong>
            <span className="muted">or click to browse from local files</span>
          </button>

          <div className="dash-head">
            <h1>{title}</h1>
            {selected.size === 0 && shown.length > 1 && (
              <label className="sort">
                <span className="muted small">Sort by</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort documents">
                  <option value="opened">Last opened</option>
                  <option value="name">Name</option>
                  <option value="size">Size</option>
                </select>
              </label>
            )}
            {selected.size > 0 && (
              <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
                <span>{selected.size} selected</span>
                <button className="btn btn-sm" disabled={selected.size < 2} onClick={() => setTool({ kind: 'merge', ids: [...selected] })}><Combine size={14} />Merge</button>
                <button className="btn btn-sm" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, items: moveItems([...selected]) }); }}><Folder size={14} />Move</button>
                <button className="btn btn-sm btn-danger-ghost" onClick={() => remove([...selected])}><Trash2 size={14} />Delete</button>
                <IconBtn icon={<X size={14} />} label="Clear selection" onClick={() => setSelected(new Set())} tipBelow />
              </div>
            )}
          </div>

          {docs === null ? (
            <div className="grid">{[0, 1, 2].map((i) => <div key={i} className="card skeleton" />)}</div>
          ) : shown.length === 0 ? (
            <div className="empty">
              <FileText size={28} />
              <strong>{docs.length === 0 ? 'No documents yet' : query ? `Nothing matches "${query}"` : `No documents in ${title}`}</strong>
              <span className="muted">{docs.length === 0 ? 'Drop a PDF above or create a blank one to get started.' : 'Try another view or search.'}</span>
            </div>
          ) : (
            <div className="grid" role="list">
              {shown.map((d) => (
                <div
                  key={d.id}
                  role="listitem"
                  className={`card ${selected.has(d.id) ? 'is-selected' : ''}`}
                  onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, items: docMenu(d) }))}
                >
                  <button className="card-open" aria-label={`Open ${d.name}`}
                    onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey || selected.size ? toggleSel(d.id) : open(d.id))}>
                    <div className="card-thumb">
                      {d.thumb ? <img src={d.thumb} alt="" /> : null}
                      <span className="chip">PAGE 1 / {d.pages}</span>
                    </div>
                    <div className="card-name" title={d.name}>{d.name}</div>
                    <div className="card-meta">
                      <span>{fmtSize(d.size)}{d.label && <span className={`badge badge-${LABEL_CLASS[d.label]}`}>{d.label}</span>}</span>
                      <span>{fmtAgo(d.openedAt)}</span>
                    </div>
                  </button>
                  <input type="checkbox" className="card-check" checked={selected.has(d.id)} onChange={() => toggleSel(d.id)} aria-label={`Select ${d.name}`} />
                  <button className={`card-star ${d.starred ? 'on' : ''}`} aria-label={d.starred ? 'Unstar' : 'Star'} aria-pressed={!!d.starred} data-tip={d.starred ? 'Unstar' : 'Star'}
                    onClick={() => run('', () => patchMeta(d.id, { starred: !d.starred }))}>
                    <Star size={14} />
                  </button>
                  <button className="card-more" aria-label={`More actions for ${d.name}`} data-tip="More"
                    onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, items: docMenu(d) }); }}>
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
      {busy && <div className="busy" role="status"><span className="spinner" />{busy}</div>}
      {tool && docs && (
        <ToolDialog kind={tool.kind} docs={docs} initial={tool.ids ?? []} onClose={() => setTool(null)}
          onDone={(meta) => { setTool(null); refresh(); setSelected(new Set()); if (meta) toast({ kind: 'success', text: `Created ${meta.name}`, action: { label: 'Open', run: () => open(meta.id) } }); }} />
      )}
    </div>
  );
}
