import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { Rect } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy };

export class PasswordRequired extends Error {}

/** pdf.js transfers (detaches) the buffer it is given, so always hand it a copy. */
export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  try {
    return await pdfjs.getDocument({ data: bytes.slice(), password, isEvalSupported: false }).promise;
  } catch (e: any) {
    if (e?.name === 'PasswordException') throw new PasswordRequired(e.code === 2 ? 'Incorrect password' : 'Password required');
    throw new Error(`This file could not be read as a PDF (${e?.message ?? e})`);
  }
}

export interface PageSize { w: number; h: number }
// ponytail: fetches every page's size up front; fine to a few thousand pages, lazy-size if huge docs matter.
export async function pageSizes(pdf: PDFDocumentProxy): Promise<PageSize[]> {
  return Promise.all(
    Array.from({ length: pdf.numPages }, async (_, i) => {
      const vp = (await pdf.getPage(i + 1)).getViewport({ scale: 1 });
      return { w: vp.width, h: vp.height };
    }),
  );
}

export async function renderToCanvas(page: PDFPageProxy, scale: number, canvas = document.createElement('canvas')) {
  const vp = page.getViewport({ scale });
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

export async function thumbnail(pdf: PDFDocumentProxy, pageIndex = 0, width = 240) {
  const page = await pdf.getPage(pageIndex + 1);
  const c = await renderToCanvas(page, width / page.getViewport({ scale: 1 }).width);
  return c.toDataURL('image/jpeg', 0.8);
}

/** Text runs of a page in page units, used by search and the edit-text tool. */
export interface TextRun extends Rect { str: string; family: 'sans' | 'serif' | 'mono'; size: number; bold: boolean; italic: boolean }

const runCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextRun[]>>>();
export function textRuns(pdf: PDFDocumentProxy, pageIndex: number): Promise<TextRun[]> {
  let m = runCache.get(pdf);
  if (!m) runCache.set(pdf, (m = new Map()));
  if (!m.has(pageIndex)) {
    m.set(
      pageIndex,
      (async () => {
        const page = await pdf.getPage(pageIndex + 1);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        return (tc.items as TextItem[])
          .filter((it) => 'str' in it && it.str.trim())
          .map((it) => {
            const t = pdfjs.Util.transform(vp.transform, it.transform);
            const size = Math.hypot(t[2], t[3]);
            const ff = tc.styles[it.fontName]?.fontFamily ?? '';
            // the real font name (e.g. "Helvetica-Bold") is only known once the page has been rendered
            const name: string = page.commonObjs.has(it.fontName) ? page.commonObjs.get(it.fontName)?.name ?? '' : '';
            return {
              bold: /bold|black|heavy|semibold/i.test(name),
              italic: /italic|oblique/i.test(name),
              str: it.str,
              x: t[4],
              y: t[5] - size,
              w: it.width,
              h: size * 1.2,
              size,
              family: ff.includes('mono') ? 'mono' : ff.includes('serif') && !ff.includes('sans') ? 'serif' : 'sans',
            } as TextRun;
          });
      })(),
    );
  }
  return m.get(pageIndex)!;
}

export interface SearchHit { page: number /* source index */; rect: Rect; snippet: [string, string, string] }

export async function searchPdf(
  pdf: PDFDocumentProxy, order: number[], query: string, opts: { matchCase: boolean; wholeWord: boolean }, limit = 500,
): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(opts.wholeWord ? `\\b${esc}\\b` : esc, opts.matchCase ? 'g' : 'gi');
  const hits: SearchHit[] = [];
  for (const p of order) {
    const runs = await textRuns(pdf, p);
    const full = runs.map((r) => r.str).join(' ');
    let offset = 0;
    const starts = runs.map((r) => ((offset += r.str.length + 1), offset - r.str.length - 1));
    for (const m of full.matchAll(re)) {
      const i = m.index!;
      let ri = starts.findIndex((s, k) => i >= s && i < s + runs[k].str.length);
      if (ri < 0) continue;
      const r = runs[ri];
      const cw = r.w / Math.max(1, r.str.length); // ponytail: proportional char width, exact per-glyph widths if highlights drift
      const local = i - starts[ri];
      hits.push({
        page: p,
        rect: { x: r.x + local * cw, y: r.y, w: Math.min(r.w, m[0].length * cw), h: r.h },
        snippet: [full.slice(Math.max(0, i - 40), i), m[0], full.slice(i + m[0].length, i + m[0].length + 40)],
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

export interface OutlineNode { title: string; page: number | null; items: OutlineNode[] }
export async function outline(pdf: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = (await pdf.getOutline()) ?? [];
  const resolve = async (dest: any): Promise<number | null> => {
    try {
      const d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      if (!d?.[0]) return null;
      return typeof d[0] === 'number' ? d[0] : await pdf.getPageIndex(d[0]);
    } catch {
      return null;
    }
  };
  const walk = async (items: any[]): Promise<OutlineNode[]> =>
    Promise.all(items.map(async (it) => ({ title: it.title, page: await resolve(it.dest), items: await walk(it.items ?? []) })));
  return walk(raw);
}
