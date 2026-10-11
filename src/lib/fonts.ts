// One font model for screen and PDF. Each family is a composite:
//   Latin (WinAnsi) → the PDF standard font (Helvetica / Times / Courier), tiny and metric-identical
//   Devanagari      → Noto Sans Devanagari (embedded, subset)
//   everything else → Noto Sans / Serif / Mono (embedded, subset)
// The browser picks faces with the same unicode-range split the exporter uses, so screen and PDF agree.
import type { FontFamily } from './types';

type Range = [number, number];
const WINANSI_EXTRA = [0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122];
export const WINANSI: Range[] = [[0x20, 0x7e], [0xa0, 0xff], ...WINANSI_EXTRA.map((c) => [c, c] as Range)];
export const DEVANAGARI: Range[] = [[0x900, 0x97f], [0x1cd0, 0x1cff], [0xa8e0, 0xa8ff]];

const inRanges = (c: number, rs: Range[]) => rs.some(([a, b]) => c >= a && c <= b);
const cssRange = (rs: Range[]) => rs.map(([a, b]) => (a === b ? `U+${a.toString(16)}` : `U+${a.toString(16)}-${b.toString(16)}`)).join(', ');

export type Std = 'sans' | 'serif' | 'mono';
const STD: Record<Std, { local: string[]; noto: string; italics: boolean; css: string; metrics: [number, number] }> = {
  sans: { local: ['Helvetica', 'Arial', 'Liberation Sans'], noto: 'NotoSans', italics: true, css: 'DF Sans', metrics: [0.905, 0.212] },
  serif: { local: ['Times New Roman', 'Times', 'Liberation Serif'], noto: 'NotoSerif', italics: true, css: 'DF Serif', metrics: [0.891, 0.216] },
  mono: { local: ['Courier New', 'Courier', 'Liberation Mono'], noto: 'NotoSansMono', italics: false, css: 'DF Mono', metrics: [0.833, 0.3] },
};

export const isCustom = (f: FontFamily): f is `custom:${string}` => f.startsWith('custom:');
export const stdOf = (f: FontFamily): Std => (isCustom(f) ? 'sans' : f);
/** ascent/descent (fraction of em) used to place the PDF baseline where the browser draws it */
export const metricsOf = (f: FontFamily): [number, number] => (isCustom(f) ? customMetrics.get(f) ?? STD.sans.metrics : STD[f].metrics);

export const vendorUrl = (file: string) => new URL(`vendor/fonts/${file}`, document.baseURI).href;
export function notoFile(f: Std | 'deva', bold: boolean, italic: boolean) {
  if (f === 'deva') return `NotoSansDevanagari_${bold ? '700Bold' : '400Regular'}.ttf`;
  const s = STD[f];
  return `${s.noto}_${bold ? '700Bold' : '400Regular'}${italic && s.italics ? '_Italic' : ''}.ttf`;
}

export function cssFont(f: FontFamily) {
  if (isCustom(f)) return `"DF ${f}", "DF Sans", sans-serif`;
  return `"${STD[f].css}", ${STD[f].local.map((n) => `"${n}"`).join(', ')}, ${f === 'mono' ? 'monospace' : f === 'serif' ? 'serif' : 'sans-serif'}`;
}

/** Split text into runs that each use a single font, mirroring the browser's unicode-range fallback. */
export function runs(text: string, family: FontFamily): { text: string; kind: 'std' | 'noto' | 'deva' | 'custom' }[] {
  if (isCustom(family)) return text ? [{ text, kind: 'custom' }] : [];
  const out: { text: string; kind: 'std' | 'noto' | 'deva' }[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const prev = out[out.length - 1];
    // combining marks and joiners stay with the character they modify
    const sticky = (c >= 0x300 && c <= 0x36f) || c === 0x200c || c === 0x200d;
    const kind = sticky && prev ? prev.kind : inRanges(c, DEVANAGARI) ? 'deva' : inRanges(c, WINANSI) ? 'std' : 'noto';
    if (prev && prev.kind === kind) prev.text += ch;
    else out.push({ text: ch, kind });
  }
  return out;
}

/* ---------- screen: register composite @font-face rules once ---------- */
let installed = false;
export function installFontFaces() {
  if (installed) return;
  installed = true;
  const css: string[] = [];
  const metrics = (m: [number, number]) => `ascent-override: ${m[0] * 100}%; descent-override: ${m[1] * 100}%; line-gap-override: 0%;`;
  for (const [key, s] of Object.entries(STD) as [Std, (typeof STD)[Std]][]) {
    for (const bold of [false, true])
      for (const italic of [false, true]) {
        const face = `font-family: "${s.css}"; font-weight: ${bold ? 700 : 400}; font-style: ${italic ? 'italic' : 'normal'}; ${metrics(s.metrics)} font-display: swap;`;
        // later rules win for overlapping ranges, so: Noto for everything → Devanagari → system Latin
        css.push(`@font-face { ${face} src: url("${vendorUrl(notoFile(key, bold, italic))}"); }`);
        css.push(`@font-face { ${face} src: url("${vendorUrl(notoFile('deva', bold, false))}"); unicode-range: ${cssRange(DEVANAGARI)}; }`);
        const style = (n: string) => (italic ? [`${n}${bold ? ' Bold' : ''} Italic`, `${n}${bold ? ' Bold' : ''} Oblique`] : [bold ? `${n} Bold` : n]);
        const locals = s.local.flatMap(style).map((n) => `local("${n}")`).join(', ');
        css.push(`@font-face { ${face} src: ${locals}; unicode-range: ${cssRange(WINANSI)}; }`);
      }
  }
  const el = document.createElement('style');
  el.id = 'df-fonts';
  el.textContent = css.join('\n');
  document.head.appendChild(el);
}

/* ---------- user fonts ---------- */
export interface CustomFont { id: string; name: string; data: Uint8Array }
const customMetrics = new Map<string, [number, number]>();
let customCache: CustomFont[] | null = null;

export async function customFonts(): Promise<CustomFont[]> {
  if (customCache) return customCache;
  const { get } = await import('idb-keyval');
  customCache = (await get<CustomFont[]>('customFonts')) ?? [];
  await Promise.all(customCache.map(registerCustom));
  return customCache;
}

async function registerCustom(f: CustomFont) {
  const key = `custom:${f.id}`;
  if (document.fonts.check(`12px "DF ${key}"`)) return;
  const face = new FontFace(`DF ${key}`, f.data.slice().buffer);
  document.fonts.add(await face.load());
  const fk = (await import('@cantoo/fontkit')).default as any;
  const parsed = fk.create(f.data);
  customMetrics.set(key, [parsed.ascent / parsed.unitsPerEm, Math.abs(parsed.descent) / parsed.unitsPerEm]);
}

export async function addCustomFont(file: File): Promise<CustomFont> {
  const data = new Uint8Array(await file.arrayBuffer());
  const fk = (await import('@cantoo/fontkit')).default as any;
  let name: string;
  try {
    const parsed = fk.create(data);
    if (parsed.fonts) throw new Error('collection');
    name = parsed.fullName || parsed.familyName || file.name.replace(/\.\w+$/, '');
  } catch (e: any) {
    throw new Error(e?.message === 'collection'
      ? `${file.name} is a font collection (.ttc). Export a single font from Font Book, or use a .ttf or .otf file.`
      : `${file.name} isn't a font DocFlow can read. Use a .ttf or .otf file.`);
  }
  const font = { id: crypto.randomUUID(), name, data };
  await registerCustom(font);
  const { set } = await import('idb-keyval');
  customCache = [...(await customFonts()), font];
  await set('customFonts', customCache);
  return font;
}

export async function removeCustomFont(id: string) {
  const { set } = await import('idb-keyval');
  customCache = (await customFonts()).filter((f) => f.id !== id);
  await set('customFonts', customCache);
}

