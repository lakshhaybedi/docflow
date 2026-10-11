import {
  PDFDocument, StandardFonts, rgb, BlendMode, LineCapStyle, PDFHexString, PDFFont, PDFPage,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix,
} from '@cantoo/pdf-lib';
import { zipSync } from 'fflate';
import { openPdf, renderToCanvas, type PDFDocumentProxy } from './pdf';
import { arrowHead, bbox, inkPath, intersects, inv, mul, shapePath } from './geom';
import type { Annot, DocState, FontFamily, Rect } from './types';

export type Progress = (fraction: number, label: string) => void;

const hex = (h: string) => {
  const n = parseInt(h.replace('#', '').padEnd(6, '0'), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const FONT_NAMES: Record<FontFamily, StandardFonts[]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};
/** CSS stacks used on screen — metric-compatible with the PDF standard fonts above. */
export const CSS_FONT: Record<FontFamily, string> = {
  sans: 'Helvetica, Arial, sans-serif',
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
};
// ascent/descent of the CSS fonts, used to put the PDF baseline where the browser draws it
const METRICS: Record<FontFamily, [number, number]> = { sans: [0.905, 0.212], serif: [0.891, 0.216], mono: [0.833, 0.3] };

function fontCache(doc: PDFDocument) {
  const cache = new Map<string, Promise<PDFFont>>();
  return (family: FontFamily, bold = false, italic = false) => {
    const name = FONT_NAMES[family][(bold ? 1 : 0) + (italic ? 2 : 0)];
    if (!cache.has(name)) cache.set(name, doc.embedFont(name));
    return cache.get(name)!;
  };
}

/** Matrix that lets us draw in "page units, y-up" (x, H - y) on any page, whatever its rotation or crop box. */
function pageMatrix(vpTransform: number[], H: number) {
  return mul(inv(vpTransform), [1, 0, 0, -1, 0, H]);
}

async function dataUrlBytes(src: string) {
  return new Uint8Array(await (await fetch(src)).arrayBuffer());
}

function wrap(text: string, font: PDFFont, size: number, maxW: number) {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > maxW) (lines.push(line), (line = word));
      else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function safeText(text: string, font: PDFFont) {
  try {
    font.encodeText(text);
    return text;
  } catch {
    throw new Error(`"${text.slice(0, 30)}" uses characters the built-in PDF fonts can't encode (only Latin text is supported).`);
  }
}

interface Ctx {
  doc: PDFDocument;
  font: ReturnType<typeof fontCache>;
  src?: PDFDocumentProxy; // only needed to bake blurs
}

async function drawAnnots(ctx: Ctx, page: PDFPage, srcIndex: number, annots: Annot[], vpTransform: number[], H: number) {
  const M = pageMatrix(vpTransform, H);
  const Y = (y: number) => H - y;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(M[0], M[1], M[2], M[3], M[4], M[5]));
  for (const a of annots) {
    switch (a.kind) {
      case 'highlight':
        for (const r of a.rects)
          page.drawRectangle({ x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h, color: hex(a.color), opacity: 0.4, blendMode: BlendMode.Multiply });
        break;
      case 'underline': case 'strike':
        for (const r of a.rects) {
          const yy = Y(a.kind === 'underline' ? r.y + r.h - 1 : r.y + r.h / 2);
          page.drawLine({ start: { x: r.x, y: yy }, end: { x: r.x + r.w, y: yy }, thickness: 1.2, color: hex(a.color) });
        }
        break;
      case 'text': {
        if (a.bg) {
          const c = a.cover ?? a;
          page.drawRectangle({ x: c.x - 1, y: Y(c.y + c.h) - 1, width: c.w + 2, height: c.h + 2, color: hex(a.bg) });
        }
        const font = await ctx.font(a.font, a.bold, a.italic);
        const lines = a.text.split('\n');
        const lh = a.size * a.lineHeight;
        const [asc, desc] = METRICS[a.font];
        const base = (lh - (asc + desc) * a.size) / 2 + asc * a.size;
        const widthOf = (s: string) => font.widthOfTextAtSize(safeText(s, font), a.size) + a.letterSpacing * Math.max(0, s.length);
        lines.forEach((line, i) => {
          const lw = widthOf(line);
          let x = a.x + (a.align === 'center' ? (a.w - lw) / 2 : a.align === 'right' ? a.w - lw : 0);
          const y = Y(a.y + i * lh + base);
          if (!a.letterSpacing) page.drawText(line, { x, y, size: a.size, font, color: hex(a.color) });
          else
            for (const ch of line) {
              page.drawText(ch, { x, y, size: a.size, font, color: hex(a.color) });
              x += font.widthOfTextAtSize(ch, a.size) + a.letterSpacing;
            }
        });
        break;
      }
      case 'note': {
        page.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color: hex(a.color) });
        const font = await ctx.font('sans');
        wrap(safeText(a.text, font), font, 9, a.w - 16).forEach((l, i) => {
          if (16 + i * 12 < a.h) page.drawText(l, { x: a.x + 8, y: Y(a.y + 16 + i * 12), size: 9, font, color: rgb(0.12, 0.16, 0.22) });
        });
        break;
      }
      case 'comment': {
        // A real PDF comment (sticky-note annotation) so other readers can open it.
        const [ux, uy] = [M[0] * a.x + M[2] * Y(a.y) + M[4], M[1] * a.x + M[3] * Y(a.y) + M[5]];
        const annot = ctx.doc.context.obj({
          Type: 'Annot', Subtype: 'Text', Rect: [ux - 10, uy - 10, ux + 10, uy + 10], Name: 'Comment', F: 4, C: [0.15, 0.39, 0.92],
          Contents: PDFHexString.fromText(a.text), T: PDFHexString.fromText(a.author),
        });
        page.node.addAnnot(ctx.doc.context.register(annot));
        break;
      }
      case 'arrow': {
        const color = hex(a.color);
        page.drawLine({ start: { x: a.x1, y: Y(a.y1) }, end: { x: a.x2, y: Y(a.y2) }, thickness: a.width, color, lineCap: LineCapStyle.Round });
        page.drawSvgPath(arrowHead(a.x1, a.y1, a.x2, a.y2, a.width), { x: 0, y: H, color });
        if (a.text) {
          const font = await ctx.font('sans');
          const w = font.widthOfTextAtSize(safeText(a.text, font), 10) + 12;
          page.drawRectangle({ x: a.x1 - w / 2, y: Y(a.y1 + 10), width: w, height: 20, color: rgb(1, 1, 1), borderColor: color, borderWidth: 1 });
          page.drawText(a.text, { x: a.x1 - w / 2 + 6, y: Y(a.y1 + 3.5), size: 10, font, color: rgb(0.07, 0.09, 0.15) });
        }
        break;
      }
      case 'ink':
        page.drawSvgPath(inkPath(a.points), { x: 0, y: H, borderColor: hex(a.color), borderWidth: a.width, borderLineCap: LineCapStyle.Round });
        break;
      case 'shape':
        page.drawSvgPath(shapePath(a.shape, a), {
          x: 0, y: H, color: a.fillOpacity > 0 ? hex(a.fill) : undefined, opacity: a.fillOpacity,
          borderColor: a.strokeWidth > 0 ? hex(a.stroke) : undefined, borderWidth: a.strokeWidth,
        });
        break;
      case 'image': {
        const bytes = await dataUrlBytes(a.src);
        const img = a.src.startsWith('data:image/png') ? await ctx.doc.embedPng(bytes) : await ctx.doc.embedJpg(bytes);
        page.drawImage(img, { x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h });
        break;
      }
      case 'stamp': {
        const color = hex(a.color);
        const font = await ctx.font('sans', true);
        const size = Math.min(a.h * 0.45, (a.w - 12) / (font.widthOfTextAtSize(a.label, 1) || 1));
        page.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, borderColor: color, borderWidth: 2, color: rgb(1, 1, 1), opacity: 0.85 });
        page.drawText(a.label, { x: a.x + (a.w - font.widthOfTextAtSize(a.label, size)) / 2, y: Y(a.y + a.h / 2 + size * 0.35), size, font, color });
        break;
      }
      case 'blur': {
        // Visual blur only — the content underneath is still in the file. Use redaction to remove it.
        if (!ctx.src) break;
        const scale = 2;
        const full = await renderToCanvas(await ctx.src.getPage(srcIndex + 1), scale);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(a.w * scale));
        c.height = Math.max(1, Math.round(a.h * scale));
        const g = c.getContext('2d')!;
        g.filter = `blur(${a.amount * scale}px)`;
        const pad = a.amount * scale * 3; // sample beyond the edge so the blur doesn't fade to transparent
        g.drawImage(full, a.x * scale - pad, a.y * scale - pad, c.width + pad * 2, c.height + pad * 2, -pad, -pad, c.width + pad * 2, c.height + pad * 2);
        const img = await ctx.doc.embedJpg(await dataUrlBytes(c.toDataURL('image/jpeg', 0.9)));
        page.drawImage(img, { x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h });
        break;
      }
      case 'redact':
        break; // pending redactions are never exported; they must be applied first
    }
  }
  page.pushOperators(popGraphicsState());
}

/** Copy the chosen pages (display order) into a new document, optionally drawing annotations on top. */
export async function flatten(
  bytes: Uint8Array, state: DocState, opts: { pages?: number[]; annotations?: boolean } = {}, progress?: Progress,
): Promise<PDFDocument> {
  const srcLib = await PDFDocument.load(bytes);
  const srcJs = await openPdf(bytes);
  const order = (opts.pages ?? state.pageOrder.map((_, i) => i)).map((i) => state.pageOrder[i]);
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(srcLib, order);
  const ctx: Ctx = { doc, font: fontCache(doc), src: state.annotations.some((a) => a.kind === 'blur') ? srcJs : undefined };
  for (let i = 0; i < order.length; i++) {
    progress?.(i / order.length, `Preparing page ${i + 1} of ${order.length}`);
    const page = doc.addPage(pages[i]);
    if (opts.annotations === false) continue;
    const annots = state.annotations.filter((a) => a.page === order[i]);
    if (!annots.length) continue;
    const vp = (await srcJs.getPage(order[i] + 1)).getViewport({ scale: 1 });
    await drawAnnots(ctx, page, order[i], annots, vp.transform, vp.height);
  }
  await srcJs.destroy();
  return doc;
}

/** Re-render every page to a JPEG — smaller files, but text is no longer selectable. */
export async function rasterize(bytes: Uint8Array, dpi: number, quality: number, progress?: Progress) {
  const src = await openPdf(bytes);
  const doc = await PDFDocument.create();
  for (let i = 1; i <= src.numPages; i++) {
    progress?.((i - 1) / src.numPages, `Compressing page ${i} of ${src.numPages}`);
    const page = await src.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const c = await renderToCanvas(page, dpi / 72);
    const img = await doc.embedJpg(await dataUrlBytes(c.toDataURL('image/jpeg', quality)));
    doc.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
  }
  await src.destroy();
  return doc.save();
}

export type Quality = 'high' | 'medium' | 'low';
const RASTER: Record<Quality, { dpi: number; q: number }> = { high: { dpi: 200, q: 0.92 }, medium: { dpi: 150, q: 0.75 }, low: { dpi: 96, q: 0.6 } };

export interface ExportOptions {
  format: 'pdf' | 'png' | 'jpg';
  pages?: number[];
  annotations: boolean;
  quality: Quality; // pdf: high = keep vector text; medium/low rasterize. images: dpi
  password?: string;
}

export async function exportDocument(bytes: Uint8Array, state: DocState, o: ExportOptions, progress: Progress) {
  const flat = await flatten(bytes, state, { pages: o.pages, annotations: o.annotations }, (f, l) => progress(f * 0.5, l));
  let out = await flat.save({ useObjectStreams: true });
  if (o.format === 'pdf') {
    if (o.quality !== 'high') out = await rasterize(out, RASTER[o.quality].dpi, RASTER[o.quality].q, (f, l) => progress(0.5 + f * 0.45, l));
    if (o.password) {
      const enc = await PDFDocument.load(out);
      enc.encrypt({ userPassword: o.password, ownerPassword: o.password });
      out = await enc.save();
    }
    progress(1, 'Done');
    return new Blob([out as BlobPart], { type: 'application/pdf' });
  }
  const src = await openPdf(out);
  const { dpi, q } = RASTER[o.quality];
  const mime = o.format === 'png' ? 'image/png' : 'image/jpeg';
  const files: Record<string, Uint8Array> = {};
  for (let i = 1; i <= src.numPages; i++) {
    progress(0.5 + ((i - 1) / src.numPages) * 0.5, `Rendering page ${i} of ${src.numPages}`);
    const c = await renderToCanvas(await src.getPage(i), dpi / 72);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, mime, q));
    if (!blob) throw new Error('The browser could not encode this page — try a lower quality setting.');
    files[`page-${String(i).padStart(3, '0')}.${o.format}`] = new Uint8Array(await blob.arrayBuffer());
  }
  await src.destroy();
  progress(1, 'Done');
  const names = Object.keys(files);
  return names.length === 1
    ? new Blob([files[names[0]] as BlobPart], { type: mime })
    : new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' });
}

export async function merge(parts: { bytes: Uint8Array; state: DocState }[], progress?: Progress) {
  const out = await PDFDocument.create();
  for (const [i, p] of parts.entries()) {
    progress?.(i / parts.length, `Merging file ${i + 1} of ${parts.length}`);
    const flat = await flatten(p.bytes, p.state);
    for (const pg of await out.copyPages(flat, flat.getPageIndices())) out.addPage(pg);
  }
  return out.save({ useObjectStreams: true });
}

export async function compress(bytes: Uint8Array, state: DocState, level: 'lossless' | Quality, progress?: Progress) {
  const flat = await (await flatten(bytes, state)).save({ useObjectStreams: true });
  return level === 'lossless' ? flat : rasterize(flat, RASTER[level].dpi, RASTER[level].q, progress);
}

export async function blankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

export async function decrypt(bytes: Uint8Array, password: string) {
  return (await PDFDocument.load(bytes, { password })).save();
}

/**
 * Secure redaction. Every page with a redaction is re-rendered to an image with the areas painted black, and the
 * new document is built from scratch, so the original text, vectors and images of those pages are not carried over.
 * Returns the new bytes plus the annotations that survive (pending redactions and anything overlapping them are dropped).
 */
export async function applyRedactions(bytes: Uint8Array, state: DocState, progress?: Progress) {
  const reds = state.annotations.filter((a): a is Extract<Annot, { kind: 'redact' }> => a.kind === 'redact');
  const byPage = new Map<number, Rect[]>();
  for (const r of reds) byPage.set(r.page, [...(byPage.get(r.page) ?? []), r]);

  const srcLib = await PDFDocument.load(bytes);
  const srcJs = await openPdf(bytes);
  const doc = await PDFDocument.create();
  const keep = srcLib.getPageIndices().filter((i) => !byPage.has(i));
  const copied = new Map((await doc.copyPages(srcLib, keep)).map((p, k) => [keep[k], p]));
  const scale = 2.5; // 180 dpi
  for (let i = 0; i < srcLib.getPageCount(); i++) {
    const rects = byPage.get(i);
    if (!rects) {
      doc.addPage(copied.get(i)!);
      continue;
    }
    progress?.(i / srcLib.getPageCount(), `Redacting page ${i + 1}`);
    const page = await srcJs.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const c = await renderToCanvas(page, scale);
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    for (const r of rects) g.fillRect(r.x * scale - 1, r.y * scale - 1, r.w * scale + 2, r.h * scale + 2);
    const img = await doc.embedJpg(await dataUrlBytes(c.toDataURL('image/jpeg', 0.9)));
    doc.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
  }
  await srcJs.destroy();
  const out = await doc.save({ useObjectStreams: true });
  // Verify before reporting success: redacted pages must carry no extractable text at all.
  const check = await openPdf(out);
  for (const i of byPage.keys()) {
    const tc = await (await check.getPage(i + 1)).getTextContent();
    if (tc.items.length) throw new Error(`Verification failed: page ${i + 1} still contains text. Nothing was changed.`);
  }
  await check.destroy();
  const annotations = state.annotations.filter(
    (a) => a.kind !== 'redact' && !(byPage.get(a.page) ?? []).some((r) => intersects(r, bbox(a))),
  );
  return { bytes: out, annotations, pagesRasterized: byPage.size };
}

export interface OcrWord { text: string; x: number; y: number; w: number; h: number }

/** Adds invisible, selectable/searchable text over scanned pages. Words the standard font can't encode are skipped. */
export async function addTextLayer(bytes: Uint8Array, words: Map<number, OcrWord[]>) {
  const doc = await PDFDocument.load(bytes);
  const js = await openPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let added = 0;
  for (const [pi, ws] of words) {
    const page = doc.getPage(pi);
    const vp = (await js.getPage(pi + 1)).getViewport({ scale: 1 });
    const M = pageMatrix(vp.transform, vp.height);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(M[0], M[1], M[2], M[3], M[4], M[5]));
    for (const w of ws) {
      try {
        const unit = font.widthOfTextAtSize(w.text, 1);
        const size = Math.min(w.h, w.w / (unit || 1));
        page.drawText(w.text, { x: w.x, y: vp.height - (w.y + w.h) + w.h * 0.2, size, font, opacity: 0 });
        added++;
      } catch {
        /* character outside WinAnsi — skip this word */
      }
    }
    page.pushOperators(popGraphicsState());
  }
  await js.destroy();
  return { bytes: await doc.save(), added };
}
