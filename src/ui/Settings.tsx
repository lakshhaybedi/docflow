import { useEffect, useState, type ReactNode } from 'react';
import { Check, Database, Eye, Monitor, Moon, Palette, PenLine, RotateCcw, Sun, Trash2 } from 'lucide-react';
import { ACCENTS, SIG_FONTS, resetPrefs, setPrefs, usePrefs, type Prefs, type ToolDefaults } from '../lib/prefs';
import { deleteDoc, getList, listDocs, removeFromList } from '../lib/store';
import { cssFont, customFonts, removeCustomFont, type CustomFont } from '../lib/fonts';
import type { FontFamily } from '../lib/types';
import { FontSelect } from './FontSelect';
import { IconBtn, Modal, Segmented, Toggle, fmtSize, useToast } from './ui';
import { askConfirm } from './prompt';

let open: (v: boolean) => void = () => {};
export const openSettings = () => open(true);

type Section = 'appearance' | 'editing' | 'viewing' | 'data';

export function SettingsHost() {
  const [isOpen, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('appearance');
  useEffect(() => {
    open = setOpen;
    const key = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && e.key === ',' && (e.preventDefault(), setOpen(true));
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  if (!isOpen) return null;
  const nav: [Section, string, ReactNode][] = [
    ['appearance', 'Appearance', <Palette size={16} />],
    ['editing', 'Editing defaults', <PenLine size={16} />],
    ['viewing', 'Viewing', <Eye size={16} />],
    ['data', 'Data & storage', <Database size={16} />],
  ];
  return (
    <Modal title="Settings" onClose={() => setOpen(false)} width={760}>
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {nav.map(([k, label, icon]) => (
            <button key={k} className={`nav-item ${section === k ? 'is-active' : ''}`} aria-current={section === k} onClick={() => setSection(k)}>
              {icon}<span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {section === 'appearance' && <Appearance />}
          {section === 'editing' && <Editing />}
          {section === 'viewing' && <Viewing />}
          {section === 'data' && <Data />}
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label"><span>{label}</span>{hint && <span className="muted tiny">{hint}</span>}</div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Appearance() {
  const p = usePrefs();
  return (
    <div className="stack">
      <h3 className="settings-h">Appearance</h3>
      <Row label="Theme">
        <Segmented label="Theme" value={p.theme} onChange={(theme) => setPrefs({ theme })} options={[
          { value: 'light', label: <><Sun size={14} /> Light</> },
          { value: 'dark', label: <><Moon size={14} /> Dark</> },
          { value: 'system', label: <><Monitor size={14} /> System</> },
        ]} />
      </Row>
      <Row label="Accent color" hint="Buttons, selections and active tools">
        <div className="swatches" role="radiogroup" aria-label="Accent color">
          {ACCENTS.map((c) => (
            <button key={c} role="radio" aria-checked={p.accent === c} aria-label={c} className={`swatch swatch-lg ${p.accent === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => setPrefs({ accent: c })}>
              {p.accent === c && <Check size={14} color="#fff" />}
            </button>
          ))}
          <label className="swatch swatch-lg custom" data-tip="Custom color" style={{ background: ACCENTS.includes(p.accent) ? undefined : p.accent }}>
            <input type="color" value={p.accent} onChange={(e) => setPrefs({ accent: e.target.value })} aria-label="Custom accent color" />
          </label>
        </div>
      </Row>
      <Row label="Page appearance" hint="Changes how pages look on screen only — exports are unaffected">
        <Segmented label="Page appearance" value={p.pageTone} onChange={(pageTone) => setPrefs({ pageTone })} options={[
          { value: 'normal', label: 'Normal' }, { value: 'sepia', label: 'Sepia' }, { value: 'night', label: 'Night' },
        ]} />
      </Row>
      <Row label="Reduce motion" hint="Turns off animations and smooth scrolling">
        <input type="checkbox" role="switch" className="toggle" checked={p.reduceMotion} onChange={(e) => setPrefs({ reduceMotion: e.target.checked })} aria-label="Reduce motion" />
      </Row>
    </div>
  );
}

function Editing() {
  const p = usePrefs();
  const t = p.tools;
  const setTools = (patch: Partial<ToolDefaults>) => setPrefs((q) => ({ tools: { ...q.tools, ...patch } }));
  const setText = (patch: Partial<ToolDefaults['text']>) => setTools({ text: { ...t.text, ...patch } });
  return (
    <div className="stack">
      <h3 className="settings-h">Editing defaults</h3>
      <p className="muted small">Used for new items. Changing a style in the properties panel also updates these.</p>
      <Row label="Your name" hint="Shown on comments, and kept in exported PDF comments">
        <input value={t.author} onChange={(e) => setTools({ author: e.target.value })} onBlur={(e) => !e.target.value.trim() && setTools({ author: 'You' })} aria-label="Your name" />
      </Row>
      <Row label="Text font">
        <FontSelect value={t.text.font} onChange={(font) => setText({ font })} />
      </Row>
      <YourFonts />
      <Row label="Text size">
        <select value={t.text.size} onChange={(e) => setText({ size: +e.target.value })} aria-label="Default text size">
          {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32].map((n) => <option key={n} value={n}>{n} pt</option>)}
        </select>
      </Row>
      <Row label="Text color"><ColorPick value={t.text.color} onChange={(color) => setText({ color })} /></Row>
      <div className="setting-preview" style={{ fontFamily: cssFont(t.text.font), fontSize: Math.min(t.text.size, 24), color: t.text.color }}>The quick brown fox jumps over the lazy dog</div>
      <Row label="Highlight color"><ColorPick value={t.markColor} onChange={(markColor) => setTools({ markColor })} swatches={['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74']} /></Row>
      <Row label="Pen color"><ColorPick value={t.pen.color} onChange={(color) => setTools({ pen: { ...t.pen, color } })} /></Row>
      <Row label="Pen width">
        <select value={t.pen.width} onChange={(e) => setTools({ pen: { ...t.pen, width: +e.target.value } })} aria-label="Default pen width">
          {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n} px</option>)}
        </select>
      </Row>
      <div className="field"><span>Signature style <span className="muted tiny">· for typed signatures</span></span>
        <div className="sig-fonts">
          {SIG_FONTS.map((f) => (
            <button key={f} className={`sig-font ${t.sigFont === f ? 'is-active' : ''}`} style={{ fontFamily: `"${f}", cursive` }} onClick={() => setTools({ sigFont: f })} aria-pressed={t.sigFont === f}>
              {t.author && t.author !== 'You' ? t.author : 'Jane Doe'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function YourFonts() {
  const [fonts, setFonts] = useState<CustomFont[] | null>(null);
  useEffect(() => void customFonts().then(setFonts), []);
  if (!fonts?.length) return <p className="tiny muted">Need another font or language? Choose “Add font…” in the font menu to use any .ttf or .otf file. Non-Latin text works out of the box with the built-in fonts.</p>;
  return (
    <div className="field">
      <span>Your fonts</span>
      <ul className="plain-list">
        {fonts.map((f) => (
          <li key={f.id} className="list-row">
            <span className="list-main" style={{ fontFamily: cssFont(`custom:${f.id}`) }}>{f.name}</span>
            <IconBtn icon={<Trash2 size={14} />} label={`Remove ${f.name}`} onClick={async () => (await removeCustomFont(f.id), setFonts(await customFonts()))} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ColorPick({ value, onChange, swatches = ['#111827', '#2563eb', '#16a34a', '#dc2626', '#ea580c', '#7c3aed'] }: { value: string; onChange: (c: string) => void; swatches?: string[] }) {
  return (
    <div className="swatches">
      {swatches.map((c) => <button key={c} aria-label={c} className={`swatch ${value === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />)}
      <label className="swatch custom" data-tip="Custom color" style={{ background: swatches.includes(value) ? undefined : value }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Custom color" />
      </label>
    </div>
  );
}

function Viewing() {
  const p = usePrefs();
  const L = p.layout;
  const setLayout = (patch: Partial<Prefs['layout']>) => setPrefs({ layout: { ...L, ...patch } });
  return (
    <div className="stack">
      <h3 className="settings-h">Viewing</h3>
      <Row label="Default zoom">
        <Segmented label="Default zoom" value={p.zoom} onChange={(zoom) => setPrefs({ zoom })} options={[
          { value: 'width', label: 'Fit width' }, { value: 'page', label: 'Fit page' }, { value: '1', label: '100%' },
        ]} />
      </Row>
      <Row label="Pages per row">
        <Segmented label="Pages per row" value={String(L.spread) as '1' | '2'} onChange={(v) => setLayout({ spread: +v as 1 | 2 })} options={[
          { value: '1', label: 'Single' }, { value: '2', label: 'Two pages' },
        ]} />
      </Row>
      <Toggle label="Continuous scroll" checked={L.continuous} onChange={(continuous) => setLayout({ continuous })} />
      <Toggle label="Show page gaps" checked={L.gaps} onChange={(gaps) => setLayout({ gaps })} />
      <Toggle label="Show page numbers" checked={L.numbers} onChange={(numbers) => setLayout({ numbers })} />
      <Toggle label="Reopen documents where I left off" checked={p.resume} onChange={(resume) => setPrefs({ resume })} />
    </div>
  );
}

function Data() {
  const toast = useToast();
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [counts, setCounts] = useState({ docs: 0, sigs: 0, stickers: 0 });
  const refresh = async () => {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage !== undefined) setUsage({ used: est.usage, quota: est.quota ?? 0 });
    setCounts({ docs: (await listDocs()).length, sigs: (await getList('signatures')).length, stickers: (await getList('stickers')).length });
  };
  useEffect(() => void refresh(), []);
  const clear = async (key: 'signatures' | 'stickers', label: string) => {
    if (!(await askConfirm({ title: `Delete saved ${label}?`, body: <p>They're removed from this browser. Items already placed in documents stay.</p>, confirm: 'Delete', danger: true }))) return;
    for (const v of await getList(key)) await removeFromList(key, v);
    toast({ kind: 'success', text: `Deleted saved ${label}` });
    refresh();
  };
  return (
    <div className="stack">
      <h3 className="settings-h">Data &amp; storage</h3>
      <p className="muted small">Everything is stored in this browser on this device. Nothing is uploaded. Clearing your browser's site data deletes it.</p>
      {usage && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row-between small"><span>Storage used</span><span className="muted">{fmtSize(usage.used)}{usage.quota ? ` of ${fmtSize(usage.quota)}` : ''}</span></div>
          <div className="progress-bar"><span style={{ width: `${usage.quota ? Math.max(1, (usage.used / usage.quota) * 100) : 0}%` }} /></div>
        </div>
      )}
      <Row label="Saved signatures" hint={`${counts.sigs} saved`}>
        <button className="btn btn-sm btn-danger-ghost" disabled={!counts.sigs} onClick={() => clear('signatures', 'signatures')}><Trash2 size={14} />Delete all</button>
      </Row>
      <Row label="Recent stickers" hint={`${counts.stickers} saved`}>
        <button className="btn btn-sm btn-danger-ghost" disabled={!counts.stickers} onClick={() => clear('stickers', 'stickers')}><Trash2 size={14} />Delete all</button>
      </Row>
      <Row label="Preferences" hint="Theme, defaults and layout">
        <button className="btn btn-sm" onClick={async () => {
          if (await askConfirm({ title: 'Reset all preferences?', body: <p>Theme, accent, editing defaults and view settings go back to their defaults. Documents aren't affected.</p>, confirm: 'Reset' })) {
            resetPrefs();
            toast({ kind: 'success', text: 'Preferences reset' });
          }
        }}><RotateCcw size={14} />Reset</button>
      </Row>
      <Row label="All documents" hint={`${counts.docs} in this browser`}>
        <button className="btn btn-sm btn-danger-ghost" disabled={!counts.docs} onClick={async () => {
          if (!(await askConfirm({ title: `Delete all ${counts.docs} documents?`, body: <p>Every document and its edits will be permanently removed from this browser. This can't be undone. Export anything you want to keep first.</p>, confirm: 'Delete everything', danger: true }))) return;
          for (const d of await listDocs()) await deleteDoc(d.id);
          toast({ kind: 'success', text: 'All documents deleted' });
          refresh();
          location.hash = '';
        }}><Trash2 size={14} />Delete all</button>
      </Row>
    </div>
  );
}
