import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, FileText, Lock, Monitor, Moon, PenLine, ShieldCheck, Sparkles, Sun } from 'lucide-react';
import { ACCENTS, setPrefs, usePrefs } from '../lib/prefs';
import type { FontFamily } from '../lib/types';
import { cssFont } from '../lib/fonts';

type Step = 'welcome' | 'features' | 'customize' | 'tour';
const STEPS: Step[] = ['welcome', 'features', 'customize', 'tour'];

export function Onboarding({ onFinish }: { onFinish: (takeTour: boolean) => void }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const step = STEPS[i];
  const go = (d: 1 | -1) => { setDir(d); setI((n) => Math.max(0, Math.min(STEPS.length - 1, n + d))); };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, button')) return; // focused controls handle their own keys
      if (e.key === 'Escape') onFinish(false);
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && step !== 'tour')) go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [step]);

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Welcome to DocFlow">
      <div className="ob-backdrop" aria-hidden><span /><span /><span /></div>
      <div className="ob-drag" aria-hidden />
      {step !== 'tour' && <button className="ob-skip" onClick={() => onFinish(false)}>Skip</button>}
      <div className="ob-card glass">
        <div key={step} className={`ob-step ${dir > 0 ? 'from-right' : 'from-left'}`}>
          {step === 'welcome' && <Welcome next={() => go(1)} />}
          {step === 'features' && <Features next={() => go(1)} />}
          {step === 'customize' && <Customize next={() => go(1)} />}
          {step === 'tour' && <TourOffer onFinish={onFinish} />}
        </div>
        <div className="ob-foot">
          {i > 0 ? <button className="ob-back" onClick={() => go(-1)} aria-label="Back"><ArrowLeft size={16} /></button> : <span />}
          <div className="ob-dots" role="tablist" aria-label="Progress">
            {STEPS.map((s, k) => <span key={s} className={k === i ? 'on' : ''} aria-current={k === i ? 'step' : undefined} />)}
          </div>
          <span />
        </div>
      </div>
    </div>
  );
}

function AppIcon({ size = 96 }: { size?: number }) {
  return (
    <div className="app-icon" style={{ width: size, height: size, borderRadius: size * 0.225 }}>
      <FileText size={size * 0.48} strokeWidth={1.6} />
    </div>
  );
}

function Welcome({ next }: { next: () => void }) {
  return (
    <div className="ob-center">
      <AppIcon />
      <h1 className="ob-title">Welcome to DocFlow</h1>
      <p className="ob-lede">Read, edit, sign and protect your PDFs — beautifully, and entirely on your Mac.</p>
      <button className="btn btn-primary btn-lg" onClick={next} autoFocus>Get Started</button>
    </div>
  );
}

function Features({ next }: { next: () => void }) {
  const items: [ReactNode, string, string][] = [
    [<PenLine size={22} />, 'Edit and annotate', 'Add text, highlight, draw, comment and rearrange pages with full undo.'],
    [<ShieldCheck size={22} />, 'Sign and redact', 'Reusable signatures, and redaction that truly removes sensitive content.'],
    [<Lock size={22} />, 'Private by design', 'Your documents never leave this Mac. No account, no uploads.'],
  ];
  return (
    <div className="ob-left">
      <h2 className="ob-h2">Everything you need, nothing you don't</h2>
      <ul className="ob-features">
        {items.map(([icon, title, body], k) => (
          <li key={title} style={{ animationDelay: `${80 + k * 70}ms` }}>
            <span className="ob-feat-icon">{icon}</span>
            <div><strong>{title}</strong><p className="muted">{body}</p></div>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary btn-lg ob-cta" onClick={next} autoFocus>Continue</button>
    </div>
  );
}

function Customize({ next }: { next: () => void }) {
  const p = usePrefs();
  const themes: [typeof p.theme, string, ReactNode][] = [['light', 'Light', <Sun size={14} />], ['dark', 'Dark', <Moon size={14} />], ['system', 'Auto', <Monitor size={14} />]];
  return (
    <div className="ob-left">
      <h2 className="ob-h2">Make it yours</h2>
      <p className="muted ob-sub">You can change any of this later in Settings.</p>

      <div className="ob-label">Appearance</div>
      <div className="theme-cards" role="radiogroup" aria-label="Appearance">
        {themes.map(([v, label, icon]) => (
          <button key={v} role="radio" aria-checked={p.theme === v} className={`theme-card ${p.theme === v ? 'is-active' : ''}`} onClick={() => setPrefs({ theme: v })}>
            <span className={`theme-mini mini-${v}`}><i /><b /></span>
            <span className="row gap" style={{ gap: 6 }}>{icon}{label}</span>
          </button>
        ))}
      </div>

      <div className="ob-label">Accent color</div>
      <div className="swatches" role="radiogroup" aria-label="Accent color">
        {ACCENTS.map((c) => (
          <button key={c} role="radio" aria-checked={p.accent === c} aria-label={c} className={`swatch swatch-lg ${p.accent === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => setPrefs({ accent: c })} />
        ))}
      </div>

      <div className="ob-grid">
        <label className="field">
          <span>Your name</span>
          <input placeholder="Shown on comments and signatures" value={p.tools.author === 'You' ? '' : p.tools.author}
            onChange={(e) => setPrefs((q) => ({ tools: { ...q.tools, author: e.target.value || 'You' } }))} />
        </label>
        <div className="field">
          <span>Text style</span>
          <div className="segmented" role="radiogroup" aria-label="Default text style">
            {(['sans', 'serif', 'mono'] as FontFamily[]).map((f) => (
              <button key={f} role="radio" aria-checked={p.tools.text.font === f} className={p.tools.text.font === f ? 'is-active' : ''} style={{ fontFamily: cssFont(f) }}
                onClick={() => setPrefs((q) => ({ tools: { ...q.tools, text: { ...q.tools.text, font: f } } }))}>
                Aa {f === 'sans' ? 'Sans' : f === 'serif' ? 'Serif' : 'Mono'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button className="btn btn-primary btn-lg ob-cta" onClick={next}>Continue</button>
    </div>
  );
}

function TourOffer({ onFinish }: { onFinish: (takeTour: boolean) => void }) {
  return (
    <div className="ob-center">
      <div className="ob-sparkle"><Sparkles size={34} /></div>
      <h2 className="ob-h2">Take a one-minute tour?</h2>
      <p className="ob-lede">We'll open a practice document and show you where everything is. You can try every tool safely.</p>
      <div className="row gap" style={{ gap: 10 }}>
        <button className="btn btn-lg" onClick={() => onFinish(false)}>Not Now</button>
        <button className="btn btn-primary btn-lg" onClick={() => onFinish(true)} autoFocus>Start Tour</button>
      </div>
    </div>
  );
}
