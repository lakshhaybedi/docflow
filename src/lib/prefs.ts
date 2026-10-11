// User preferences: appearance, viewing defaults and tool defaults. Kept in this browser only.
import { useSyncExternalStore } from 'react';
import type { ShapeKind, TextStyle } from './types';
import { desktop } from './desktop';

export interface ToolDefaults {
  text: TextStyle;
  markColor: string;
  lineColor: string;
  pen: { color: string; width: number };
  shape: { shape: ShapeKind | 'arrow'; fill: string; fillOpacity: number; stroke: string; strokeWidth: number };
  noteColor: string;
  arrow: { color: string; width: number };
  blur: number;
  redactPreview: boolean;
  author: string;
  sigFont: string;
}

export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  accent: string;
  pageTone: 'normal' | 'sepia' | 'night';
  reduceMotion: boolean;
  zoom: 'width' | 'page' | '1';
  layout: { spread: 1 | 2; continuous: boolean; gaps: boolean; numbers: boolean; split: 'none' | 'vertical' | 'horizontal' };
  resume: boolean; // reopen documents on the last page viewed
  onboarded: boolean;
  tools: ToolDefaults;
}

export const ACCENTS = ['#007aff', '#4f46e5', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0d9488', '#475569'];
export const SIG_FONTS = ['Great Vibes', 'Dancing Script', 'Caveat'];

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  accent: '#007aff',
  pageTone: 'normal',
  reduceMotion: false,
  zoom: 'width',
  layout: { spread: 1, continuous: true, gaps: true, numbers: true, split: 'none' },
  resume: true,
  onboarded: false,
  tools: {
    text: { font: 'sans', size: 14, bold: false, italic: false, color: '#111827', align: 'left', lineHeight: 1.3, letterSpacing: 0 },
    markColor: '#fde047',
    lineColor: '#dc2626',
    pen: { color: '#2563eb', width: 2 },
    shape: { shape: 'rect', fill: '#ef4444', fillOpacity: 0.2, stroke: '#b91c1c', strokeWidth: 2 },
    noteColor: '#fef08a',
    arrow: { color: '#2563eb', width: 2 },
    blur: 6,
    redactPreview: true,
    author: 'You',
    sigFont: 'Great Vibes',
  },
};

const KEY = 'df.prefs';
function load(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (p.accent === '#2563eb') delete p.accent; // the old default; move to system blue
    return { ...DEFAULT_PREFS, ...p, layout: { ...DEFAULT_PREFS.layout, ...p.layout }, tools: { ...DEFAULT_PREFS.tools, ...p.tools, text: { ...DEFAULT_PREFS.tools.text, ...p.tools?.text } } };
  } catch {
    return DEFAULT_PREFS;
  }
}

let prefs = load();
const subs = new Set<() => void>();

export const getPrefs = () => prefs;
export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  prefs = { ...prefs, ...(typeof patch === 'function' ? patch(prefs) : patch) };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage full or blocked: keep in memory */ }
  applyAppearance();
  subs.forEach((f) => f());
}
export const resetPrefs = () => setPrefs(DEFAULT_PREFS);

export function usePrefs() {
  return useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => prefs);
}

/* ---------- appearance ---------- */
const media = window.matchMedia('(prefers-color-scheme: dark)');

function luminance(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function resolvedTheme() {
  return prefs.theme === 'system' ? (media.matches ? 'dark' : 'light') : prefs.theme;
}

export function applyAppearance() {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme();
  root.dataset.pageTone = prefs.pageTone;
  root.dataset.reduceMotion = String(prefs.reduceMotion);
  root.style.setProperty('--accent', prefs.accent);
  // white text unless the accent is too light to read it on
  root.style.setProperty('--on-accent', luminance(prefs.accent) > 0.45 ? '#111827' : '#ffffff');
  root.style.colorScheme = resolvedTheme();
  desktop?.setTheme(prefs.theme); // keeps the native window material in step
}

media.addEventListener('change', () => prefs.theme === 'system' && (applyAppearance(), subs.forEach((f) => f())));
applyAppearance();

/* ---------- reading position ---------- */
export const lastPage = {
  get: (id: string) => { try { return +(localStorage.getItem(`df.pos.${id}`) ?? 0) || 0; } catch { return 0; } },
  set: (id: string, page: number) => { try { localStorage.setItem(`df.pos.${id}`, String(page)); } catch { /* ignore */ } },
};
