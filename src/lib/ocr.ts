// On-device OCR. The engine, its WebAssembly core and the English model ship with the app (see vite.config.ts),
// so recognition never touches the network.
import { renderToCanvas, type PDFDocumentProxy } from './pdf';
import type { OcrWord } from './pdfwrite';

export interface OcrResult { text: string; words: Map<number, OcrWord[]> }
export type OcrProgress = (p: { page: number; of: number; fraction: number; status: string }) => void;

const asset = (p: string) => new URL(`vendor/ocr/${p}`, document.baseURI).href;

/** Recognize text on the given source pages. Call the returned cancel() to stop early. */
export function ocrPages(pdf: PDFDocumentProxy, pages: number[], onProgress?: OcrProgress) {
  let cancelled = false, terminate: (() => void) | undefined;
  const promise = (async (): Promise<OcrResult> => {
    const { createWorker } = await import('tesseract.js');
    let current = 0;
    const worker = await createWorker('eng', 1, {
      workerPath: asset('worker.min.js'),
      corePath: asset('core'),
      langPath: asset('lang'),
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none',
      logger: (m) => onProgress?.({ page: current + 1, of: pages.length, fraction: m.progress ?? 0, status: m.status === 'recognizing text' ? `Reading page ${current + 1} of ${pages.length}` : 'Preparing OCR…' }),
    });
    terminate = () => void worker.terminate();
    if (cancelled) throw new Error('cancelled');
    const words = new Map<number, OcrWord[]>();
    let text = '';
    try {
      for (const [i, pi] of pages.entries()) {
        current = i;
        const scale = 2;
        const canvas = await renderToCanvas(await pdf.getPage(pi + 1), scale);
        const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
        if (cancelled) throw new Error('cancelled');
        text += (pages.length > 1 ? `\n— Page ${i + 1} —\n` : '') + data.text;
        const ws: OcrWord[] = [];
        for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words)
          if (w.text.trim() && w.confidence > 40)
            ws.push({ text: w.text, x: w.bbox.x0 / scale, y: w.bbox.y0 / scale, w: (w.bbox.x1 - w.bbox.x0) / scale, h: (w.bbox.y1 - w.bbox.y0) / scale });
        words.set(pi, ws);
      }
    } finally {
      await worker.terminate();
    }
    return { text: text.trim(), words };
  })();
  return { promise, cancel: () => { cancelled = true; terminate?.(); } };
}
