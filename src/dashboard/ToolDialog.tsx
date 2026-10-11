import { useState } from 'react';
import { ArrowDown, ArrowUp, Combine, Minimize2, RefreshCw } from 'lucide-react';
import type { DocMeta } from '../lib/types';
import { addDocument, loadDoc, withSuffix } from '../lib/docs';
import { compress, merge, type Quality } from '../lib/pdfwrite';
import { Modal, fmtSize } from '../ui/ui';
import { ExportDialog } from '../editor/ExportDialog';

export type ToolKind = 'merge' | 'compress' | 'convert';

export function ToolDialog({ kind, docs, initial, onClose, onDone }: {
  kind: ToolKind; docs: DocMeta[]; initial: string[]; onClose: () => void; onDone: (created?: DocMeta) => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial.filter((id) => docs.some((d) => d.id === id)));
  const [level, setLevel] = useState<'lossless' | Quality>('medium');
  const [progress, setProgress] = useState<{ f: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState<{ meta: DocMeta; bytes: Uint8Array; state: any } | null>(null);
  const multi = kind === 'merge';
  const byId = (id: string) => docs.find((d) => d.id === id)!;

  if (converting)
    return <ExportDialog meta={converting.meta} bytes={converting.bytes} state={converting.state} defaultFormat="png" onClose={() => onDone()} />;

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : multi ? [...p, id] : [id]));
  const move = (i: number, d: number) =>
    setPicked((p) => { const n = [...p]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });

  const go = async () => {
    setError(null);
    setProgress({ f: 0, label: 'Starting…' });
    try {
      const onP = (f: number, label: string) => setProgress({ f, label });
      if (kind === 'merge') {
        const parts = await Promise.all(picked.map((id) => loadDoc(byId(id))));
        const out = await merge(parts, onP);
        onDone(await addDocument(withSuffix(byId(picked[0]).name, ' (merged)'), out));
      } else if (kind === 'compress') {
        const meta = byId(picked[0]);
        const { bytes, state } = await loadDoc(meta);
        const out = await compress(bytes, state, level, onP);
        if (out.length >= bytes.length) {
          setProgress(null);
          setError(`This setting produced ${fmtSize(out.length)}, not smaller than the original ${fmtSize(bytes.length)}. Try a lower quality.`);
          return;
        }
        onDone(await addDocument(withSuffix(meta.name, ' (compressed)'), out));
      } else {
        const meta = byId(picked[0]);
        setConverting({ meta, ...(await loadDoc(meta)) });
      }
    } catch (e: any) {
      setProgress(null);
      setError(e?.message ?? String(e));
    }
  };

  const titles = { merge: 'Merge files', compress: 'Compress PDF', convert: 'Convert file' };
  const icons = { merge: <Combine size={18} />, compress: <Minimize2 size={18} />, convert: <RefreshCw size={18} /> };
  const ready = multi ? picked.length >= 2 : picked.length === 1;

  return (
    <Modal title={titles[kind]} icon={icons[kind]} onClose={onClose} width={560}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={!!progress}>Cancel</button>
          <button className="btn btn-primary" disabled={!ready || !!progress} onClick={go}>
            {kind === 'merge' ? `Merge ${picked.length || ''} files` : kind === 'compress' ? 'Compress' : 'Continue'}
          </button>
        </>
      }>
      {docs.length === 0 ? <p className="muted">Add some PDFs first.</p> : (
        <>
          <p className="muted small">{multi ? 'Choose files in the order they should appear. Annotations are included.' : 'Choose a document.'}</p>
          <div className="pick-list">
            {docs.map((d) => (
              <label key={d.id} className={`pick ${picked.includes(d.id) ? 'is-on' : ''}`}>
                <input type={multi ? 'checkbox' : 'radio'} name="pick" checked={picked.includes(d.id)} onChange={() => toggle(d.id)} />
                <span className="pick-name">{d.name}</span>
                <span className="muted small">{d.pages} pages · {fmtSize(d.size)}</span>
                {multi && picked.includes(d.id) && <span className="pick-order">{picked.indexOf(d.id) + 1}</span>}
              </label>
            ))}
          </div>
          {multi && picked.length > 1 && (
            <div className="order-list" aria-label="Merge order">
              {picked.map((id, i) => (
                <div key={id} className="order-row">
                  <span>{i + 1}. {byId(id).name}</span>
                  <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                  <button className="icon-btn" aria-label="Move down" disabled={i === picked.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                </div>
              ))}
            </div>
          )}
          {kind === 'compress' && (
            <fieldset className="options">
              <legend className="eyebrow">Compression</legend>
              {([
                ['lossless', 'Lossless', 'Repacks the file. Keeps selectable text; savings are usually small.'],
                ['medium', 'Medium — 150 dpi', 'Pages become images. Much smaller; text is no longer selectable.'],
                ['low', 'Smallest — 96 dpi', 'Pages become low-resolution images. Best for sharing on screen.'],
              ] as const).map(([v, l, desc]) => (
                <label key={v} className={`pick ${level === v ? 'is-on' : ''}`}>
                  <input type="radio" name="level" checked={level === v} onChange={() => setLevel(v)} />
                  <span className="pick-name">{l}</span>
                  <span className="muted small">{desc}</span>
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
      {progress && (
        <div className="progress" role="progressbar" aria-valuenow={Math.round(progress.f * 100)}>
          <div className="progress-bar"><span style={{ width: `${progress.f * 100}%` }} /></div>
          <span className="small muted">{progress.label}</span>
        </div>
      )}
      {error && <div className="alert alert-error" role="alert">{error}</div>}
    </Modal>
  );
}
