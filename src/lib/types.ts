export const LABELS = ['Draft', 'Review', 'Approved', 'Completed', 'Archived'] as const;
export type Label = (typeof LABELS)[number];

export interface DocMeta {
  id: string;
  name: string;
  size: number;
  pages: number;
  createdAt: number;
  openedAt: number;
  starred?: boolean;
  label?: Label;
  folder?: string;
  thumb?: string;
}

/** All annotation geometry is in page units: the page's viewport at scale 1 (PDF points, origin top-left, rotation applied). */
export interface Rect { x: number; y: number; w: number; h: number }

interface Base { id: string; page: number /* index into the source PDF, stable across reorders */; createdAt: number }

export type FontFamily = 'sans' | 'serif' | 'mono';
export interface TextStyle {
  font: FontFamily;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'star' | 'hexagon';

export type Annot = Base &
  (
    | ({ kind: 'text'; text: string; bg?: string /* set for edits of existing text */; cover?: Rect } & Rect & TextStyle)
    | { kind: 'highlight' | 'underline' | 'strike'; rects: Rect[]; color: string }
    | ({ kind: 'note'; text: string; color: string } & Rect)
    | { kind: 'comment'; x: number; y: number; text: string; author: string }
    | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; text?: string }
    | { kind: 'ink'; points: number[] /* x,y pairs */; color: string; width: number }
    | ({ kind: 'shape'; shape: ShapeKind; fill: string; fillOpacity: number; stroke: string; strokeWidth: number } & Rect)
    | ({ kind: 'image'; src: string; role?: 'signature' | 'sticker' } & Rect)
    | ({ kind: 'stamp'; label: string; color: string } & Rect)
    | ({ kind: 'blur'; amount: number } & Rect)
    | ({ kind: 'redact' } & Rect)
  );

export type AnnotOf<K extends Annot['kind']> = Extract<Annot, { kind: K }>;

export interface DocState {
  pageOrder: number[]; // display order -> source page index
  annotations: Annot[];
  bookmarks: number[]; // source page indices
}

export type Tool =
  | 'select' | 'hand' | 'text' | 'editText' | 'highlight' | 'underline' | 'strike' | 'note' | 'comment'
  | 'arrow' | 'pencil' | 'eraser' | 'shape' | 'blur' | 'redact' | 'image' | 'stamp' | 'signature' | 'ocr' | 'place';
