import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Lock } from 'lucide-react';
import type { DocMeta, DocState } from '../lib/types';
import { parseRange } from '../lib/geom';
import { exportDocument, type ExportOptions, type Quality } from '../lib/pdfwrite';
import { Modal, Toggle, download, fmtSize } from '../ui/ui';
import { withSuffix } from '../lib/docs';

type Format = ExportOptions['format'] | 'docx' | 'pptx';

export function ExportDialog({ meta, bytes, state, onClose, defaultFormat = 'pdf' }: {
  meta: DocMeta; bytes: Uint8Array; state: DocState; onClose: () => void; defaultFormat?: Format;
}) {
  const n = state.pageOrder.length;
  const [format, setFormat] = useState<Format>(defaultFormat);
  const [quality, setQuality] = useState<Quality>('high');
  const [allPages, setAllPages] = useState(true);
  const [range, setRange] = useState('');
  const [annotations, setAnnotations] = useState(true);
  const [protect, setProtect] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [phase, setPhase] = useState<{ kind: 'idle' } | { kind: 'running'; f: number; label: string } | { kind: 'done'; blob: Blob; name: string } | { kind: 'error'; msg: string }>({ kind: 'idle' });

  const pending = state.annotations.filter((a) => a.kind === 'redact').length;
  const blurs = state.annotations.filter((a) => a.kind === 'blur').length;
  const rangeErr = useMemo(() => {
    if (allPages) return null;
    try { parseRange(range, n); return null; } catch (e: any) { return e.message as string; }
  }, [allPages, range, n]);
  const pwErr = protect && format === 'pdf' ? (pw.length < 4 ? 'Use at least 4 characters' : pw !== pw2 ? "Passwords don't match" : null) : null;
  const unsupported = format === 'docx' || format === 'pptx';

  const qualityHelp: Record<Quality, string> = format === 'pdf'
    ? { high: 'Original quality. Text stays selectable.', medium: 'Pages saved as 150 dpi images. Smaller; text not selectable.', low: 'Pages saved as 96 dpi images. Smallest; text not selectable.' }
    : { high: '200 dpi — print quality', medium: '150 dpi — balanced', low: '96 dpi — screen only' };

  const run = async () => {
    setPhase({ kind: 'running', f: 0, label: 'Preparing…' });
    try {
      const fmt = format as ExportOptions['format'];
      const blob = await exportDocument(bytes, state, {
        format: fmt, quality, annotations, pages: allPages ? undefined : parseRange(range, n), password: protect && fmt === 'pdf' ? pw : undefined,
      }, (f, label) => setPhase({ kind: 'running', f, label }));
      const ext = blob.type === 'application/zip' ? 'zip' : fmt;
      const name = ext === 'pdf' ? meta.name : withSuffix(meta.name, fmt === 'pdf' ? '' : `-${fmt}`, ext);
      download(blob, name);
      setPhase({ kind: 'done', blob, name });
    } catch (e: any) {
      setPhase({ kind: 'error', msg: e?.message ?? String(e) });
    }
  };

  if (phase.kind === 'done')
    return (
      <Modal title="Export complete" onClose={onClose} width={440}
        footer={<><button className="btn" onClick={() => download(phase.blob, phase.name)}><Download size={14} />Download again</button><button className="btn btn-primary" onClick={onClose}>Done</button></>}>
        <div className="done-state">
          <CheckCircle2 size={32} className="ok" />
          <strong>{phase.name}</strong>
          <span className="muted">{fmtSize(phase.blob.size)} · download started by your browser</span>
        </div>
      </Modal>
    );

  const running = phase.kind === 'running';
  return (
    <Modal title="Export & Convert PDF" onClose={() => !running && onClose()} width={680}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={running}>Cancel</button>
          <button className="btn btn-primary" onClick={run} disabled={running || unsupported || !!rangeErr || !!pwErr}>
            {running ? 'Exporting…' : 'Export Document'}
          </button>
        </>
      }>
      <div className="export-grid">
        <div className="export-preview">
          {meta.thumb && <img src={meta.thumb} alt="" />}
          <span className="small">{meta.name} ({n} pages)</span>
        </div>
        <div className="export-form">
          <div className="eyebrow">Output format</div>
          <div className="pills" role="radiogroup" aria-label="Output format">
            {(['pdf', 'png', 'jpg', 'docx', 'pptx'] as Format[]).map((f) => (
              <button key={f} role="radio" aria-checked={format === f} className={`pill ${format === f ? 'is-active' : ''}`} onClick={() => setFormat(f)}>
                {{ pdf: 'PDF', png: 'PNG', jpg: 'JPG', docx: 'Word', pptx: 'PowerPoint' }[f]}
              </button>
            ))}
          </div>
          {unsupported ? (
            <div className="alert alert-info">
              {format === 'docx' ? 'Word' : 'PowerPoint'} conversion needs a document conversion engine, which isn't available in this build. Export to PDF, PNG or JPG instead.
            </div>
          ) : (
            <>
              <div className="eyebrow row-between">Quality <span className="accent">{quality[0].toUpperCase() + quality.slice(1)}</span></div>
              <input type="range" min={0} max={2} step={1} value={['low', 'medium', 'high'].indexOf(quality)} aria-label="Quality"
                onChange={(e) => setQuality((['low', 'medium', 'high'] as Quality[])[+e.target.value])} />
              <span className="small muted">{qualityHelp[quality]}</span>

              <div className="eyebrow">Page range</div>
              <div className="pills">
                <button className={`pill ${allPages ? 'is-active' : ''}`} onClick={() => setAllPages(true)} aria-pressed={allPages}>All pages</button>
                <button className={`pill ${!allPages ? 'is-active' : ''}`} onClick={() => setAllPages(false)} aria-pressed={!allPages}>Custom range</button>
              </div>
              {!allPages && (
                <label className="field">
                  <input placeholder={`e.g. 1-3, 5, 8-${n}`} value={range} onChange={(e) => setRange(e.target.value)} aria-invalid={!!rangeErr && !!range} aria-label="Page range" autoFocus />
                  {range && rangeErr && <span className="field-error">{rangeErr}</span>}
                </label>
              )}

              <Toggle label="Include annotations & edits" checked={annotations} onChange={setAnnotations} />
              {format === 'pdf' && (
                <>
                  <Toggle label={<><Lock size={14} /> Password protection</>} checked={protect} onChange={setProtect} />
                  {protect && (
                    <div className="pw-grid">
                      <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" autoComplete="new-password" />
                      <input type="password" placeholder="Confirm password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-label="Confirm password" autoComplete="new-password" />
                      {pwErr && (pw || pw2) && <span className="field-error">{pwErr}</span>}
                      <span className="small muted">AES-256. If you forget the password the file can't be opened.</span>
                    </div>
                  )}
                </>
              )}
              {pending > 0 && <div className="alert alert-warn"><AlertTriangle size={14} />{pending} pending redaction{pending > 1 ? 's are' : ' is'} not applied and won't be in the export. Apply them first from the Redact tool.</div>}
              {blurs > 0 && annotations && <div className="alert alert-info">Blurred areas are visual only — the original content is still in the file. Use Redact to remove it.</div>}
            </>
          )}
          {running && (
            <div className="progress" role="progressbar" aria-valuenow={Math.round(phase.f * 100)}>
              <div className="progress-bar"><span style={{ width: `${phase.f * 100}%` }} /></div>
              <span className="small muted">{phase.label}</span>
            </div>
          )}
          {phase.kind === 'error' && <div className="alert alert-error" role="alert">Export failed: {phase.msg}</div>}
        </div>
      </div>
    </Modal>
  );
}
