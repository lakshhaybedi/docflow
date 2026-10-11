import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from './ui';

type Req =
  | { type: 'text'; title: string; label: string; initial?: string; password?: boolean; confirm?: string; resolve: (v: string | null) => void }
  | { type: 'confirm'; title: string; body: ReactNode; confirm: string; danger?: boolean; icon?: ReactNode; resolve: (v: string | null) => void };

let show: (r: Req) => void = () => {};

export const askText = (o: { title: string; label: string; initial?: string; password?: boolean; confirm?: string }) =>
  new Promise<string | null>((resolve) => show({ type: 'text', ...o, resolve }));

export const askConfirm = (o: { title: string; body: ReactNode; confirm: string; danger?: boolean; icon?: ReactNode }) =>
  new Promise<boolean>((resolve) => show({ type: 'confirm', ...o, resolve: (v) => resolve(v !== null) }));

export function PromptHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [value, setValue] = useState('');
  useEffect(() => void (show = (r) => (setValue(r.type === 'text' ? r.initial ?? '' : ''), setReq(r))), []);
  if (!req) return null;
  const done = (v: string | null) => (req.resolve(v), setReq(null));
  const ok = req.type === 'confirm' || value.trim().length > 0;
  return (
    <Modal
      title={req.title}
      icon={req.type === 'confirm' ? req.icon : undefined}
      onClose={() => done(null)}
      width={440}
      footer={
        <>
          <button className="btn" onClick={() => done(null)}>Cancel</button>
          <button
            className={`btn ${req.type === 'confirm' && req.danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={!ok}
            onClick={() => done(value)}
          >
            {req.confirm ?? 'OK'}
          </button>
        </>
      }
    >
      {req.type === 'confirm' ? (
        <div className="prompt-body">{req.body}</div>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), ok && done(value))}>
          <label className="field">
            <span>{req.label}</span>
            <input autoFocus type={req.password ? 'password' : 'text'} value={value} onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.target.select()} />
          </label>
        </form>
      )}
    </Modal>
  );
}
