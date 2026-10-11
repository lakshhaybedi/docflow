// A short practice document for the guided tour, generated on the fly so nothing is bundled or downloaded.
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { addDocument } from '../lib/docs';

export async function createDemoDocument() {
  const doc = await PDFDocument.create();
  const [regular, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  const ink = rgb(0.07, 0.09, 0.15), muted = rgb(0.42, 0.45, 0.5), blue = rgb(0, 0.48, 1);

  const page = (title: string, n: number) => {
    const p = doc.addPage([612, 792]);
    p.drawText('DOCFLOW · PRACTICE DOCUMENT', { x: 56, y: 740, size: 8.5, font: bold, color: muted });
    p.drawText(`${n} / 2`, { x: 530, y: 740, size: 8.5, font: regular, color: muted });
    p.drawText(title, { x: 56, y: 690, size: 26, font: bold, color: ink });
    return p;
  };
  const para = (p: ReturnType<typeof page>, text: string, y: number, size = 11.5) => {
    let line = '';
    for (const w of text.split(' ')) {
      if (regular.widthOfTextAtSize(`${line} ${w}`, size) > 500) (p.drawText(line, { x: 56, y, size, font: regular, color: ink }), (y -= size * 1.6), (line = w));
      else line = line ? `${line} ${w}` : w;
    }
    p.drawText(line, { x: 56, y, size, font: regular, color: ink });
    return y - size * 2.4;
  };

  const p1 = page('Welcome to DocFlow', 1);
  let y = para(p1, 'This is a practice document. Nothing you do here can hurt anything, so try every tool. Your changes save automatically, and Undo is always one keystroke away.', 650);
  p1.drawText('1. Highlight', { x: 56, y, size: 13, font: bold, color: blue });
  y = para(p1, 'Choose the highlighter, then drag across this sentence to highlight it.', y - 20);
  p1.drawText('2. Add text', { x: 56, y, size: 13, font: bold, color: blue });
  y = para(p1, 'Choose the Text tool and click anywhere on the page to start typing.', y - 20);
  p1.drawText('3. Redact', { x: 56, y, size: 13, font: bold, color: blue });
  y = para(p1, 'Account number: 4417-2290-1186-0042. Redaction removes it from the file for good.', y - 20);
  p1.drawText('4. Sign', { x: 56, y, size: 13, font: bold, color: blue });
  y = para(p1, 'Create a signature once, then place it anywhere.', y - 20);
  p1.drawRectangle({ x: 56, y: y - 50, width: 220, height: 56, borderColor: rgb(0.8, 0.82, 0.86), borderWidth: 1, borderDashArray: [4, 3] });
  p1.drawText('Sign here', { x: 64, y: y - 44, size: 9, font: regular, color: muted });

  const p2 = page('Quarterly summary', 2);
  y = para(p2, 'A second page so you can try thumbnails, search and page organizing. Search for "revenue" to see results across pages.', 650);
  const rows = [['Region', 'Revenue', 'Change'], ['North', '$1.24M', '+12%'], ['South', '$0.98M', '+4%'], ['West', '$1.61M', '+18%']];
  rows.forEach((r, i) => {
    const ry = y - i * 26;
    if (i === 0) p2.drawRectangle({ x: 56, y: ry - 8, width: 500, height: 24, color: rgb(0.95, 0.96, 0.98) });
    r.forEach((c, k) => p2.drawText(c, { x: 66 + k * 170, y: ry, size: 11, font: i === 0 ? bold : regular, color: ink }));
  });
  [70, 54, 92].forEach((h, i) => p2.drawRectangle({ x: 140 + i * 120, y: 300, width: 56, height: h * 1.6, color: i === 2 ? blue : rgb(0.82, 0.84, 0.87) }));

  return addDocument('Welcome to DocFlow.pdf', await doc.save());
}
