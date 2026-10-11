import type { Annot, Rect, ShapeKind } from './types';

/** SVG path (page units, y-down) for a shape inside a rect. Shared by the overlay and the PDF writer. */
export function shapePath(shape: ShapeKind, { x, y, w, h }: Rect): string {
  const poly = (pts: [number, number][]) => 'M' + pts.map(([px, py]) => `${x + px * w} ${y + py * h}`).join(' L') + ' Z';
  switch (shape) {
    case 'rect':
      return poly([[0, 0], [1, 0], [1, 1], [0, 1]]);
    case 'triangle':
      return poly([[0.5, 0], [1, 1], [0, 1]]);
    case 'hexagon':
      return poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
    case 'star':
      return poly(
        Array.from({ length: 10 }, (_, i) => {
          const r = i % 2 ? 0.2 : 0.5, a = (Math.PI / 5) * i - Math.PI / 2;
          return [0.5 + r * Math.cos(a), 0.52 + r * Math.sin(a)] as [number, number];
        }),
      );
    case 'ellipse': {
      const rx = w / 2, ry = h / 2, cx = x + rx;
      return `M${cx - rx} ${y + ry} A${rx} ${ry} 0 1 0 ${cx + rx} ${y + ry} A${rx} ${ry} 0 1 0 ${cx - rx} ${y + ry} Z`;
    }
  }
}

export function arrowHead(x1: number, y1: number, x2: number, y2: number, width: number): string {
  const a = Math.atan2(y2 - y1, x2 - x1), s = 6 + width * 3;
  const p = (da: number) => `${x2 - s * Math.cos(a + da)} ${y2 - s * Math.sin(a + da)}`;
  return `M${x2} ${y2} L${p(0.45)} L${p(-0.45)} Z`;
}

export function inkPath(pts: number[]): string {
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length; i += 2) d += ` L${pts[i]} ${pts[i + 1]}`;
  return pts.length === 2 ? d + ` L${pts[0] + 0.1} ${pts[1]}` : d;
}

export function bbox(a: Annot): Rect {
  switch (a.kind) {
    case 'highlight': case 'underline': case 'strike': return union(a.rects);
    case 'comment': return { x: a.x - 10, y: a.y - 10, w: 20, h: 20 };
    case 'arrow': return norm(a.x1, a.y1, a.x2, a.y2);
    case 'ink': {
      const xs = a.points.filter((_, i) => i % 2 === 0), ys = a.points.filter((_, i) => i % 2 === 1);
      return norm(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
    default: return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}

export const norm = (x1: number, y1: number, x2: number, y2: number): Rect =>
  ({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });

export function union(rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}

export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Move an annotation by dx,dy page units. */
export function translate(a: Annot, dx: number, dy: number): Annot {
  switch (a.kind) {
    case 'highlight': case 'underline': case 'strike':
      return { ...a, rects: a.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })) };
    case 'comment': return { ...a, x: a.x + dx, y: a.y + dy };
    case 'arrow': return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case 'ink': return { ...a, points: a.points.map((v, i) => v + (i % 2 ? dy : dx)) };
    default: return { ...a, x: a.x + dx, y: a.y + dy };
  }
}

/** Resize rect-like annotations; ink scales its points. */
export function resize(a: Annot, r: Rect): Annot {
  if (a.kind === 'ink') {
    const b = bbox(a), sx = r.w / (b.w || 1), sy = r.h / (b.h || 1);
    return { ...a, points: a.points.map((v, i) => (i % 2 ? r.y + (v - b.y) * sy : r.x + (v - b.x) * sx)) };
  }
  if ('w' in a) return { ...a, ...r };
  return a;
}

/** Compose affines [a,b,c,d,e,f] (pdf.js convention): m2 is applied first, then m1. */
export const mul = (m1: number[], m2: number[]) => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
export function inv([a, b, c, d, e, f]: number[]) {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** "1-3, 5, 8-12" -> zero-based indices. Throws a readable message on bad input. */
export function parseRange(s: string, n: number): number[] {
  const out = new Set<number>();
  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`"${part}" isn't a page or range like 2-5`);
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b > n || a > b) throw new Error(`"${part}" is outside 1–${n}`);
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  if (!out.size) throw new Error('Enter at least one page');
  return [...out].sort((x, y) => x - y);
}
