import { createContext, useContext } from 'react';
import type { PDFDocumentProxy, PageSize, SearchHit } from '../lib/pdf';
import type { Annot, DocMeta, DocState, Rect, Tool } from '../lib/types';
import type { Prefs, ToolDefaults } from '../lib/prefs';

export type Placeable =
  | { kind: 'image'; src: string; w: number; h: number; role?: 'signature' | 'sticker' }
  | { kind: 'stamp'; label: string; color: string };

export type ToolOpts = ToolDefaults & { redactMode: 'area' | 'text'; place?: Placeable };

export type Layout = Prefs['layout'];
export type Fit = 'width' | 'page' | null;

export interface EditorApi {
  meta: DocMeta;
  pdf: PDFDocumentProxy;
  bytes: Uint8Array;
  sizes: PageSize[];
  state: DocState;
  tool: Tool;
  setTool(t: Tool): void;
  opts: ToolOpts;
  setOpts(p: Partial<ToolOpts>): void;
  selectedId: string | null;
  select(id: string | null): void;
  editingId: string | null;
  setEditing(id: string | null): void;
  zoom: number;
  fit: Fit;
  setZoom(z: number, fit?: Fit): void;
  layout: Layout;
  setLayout(p: Partial<Layout>): void;
  current: number; // display index of the page in view
  setCurrent(i: number): void;
  goto(display: number, rect?: Rect): void;
  scrollers: Set<(display: number, rect?: Rect) => void>;
  /** Push an undo step then change the document. */
  commit(fn: (s: DocState) => DocState): void;
  /** For drags: begin() once, then apply() repeatedly without new undo steps. */
  begin(): void;
  apply(fn: (s: DocState) => DocState): void;
  add(a: Annot, o?: { select?: boolean; edit?: boolean }): void;
  patch(id: string, p: Partial<Annot>, history?: boolean): void;
  remove(id: string): void;
  hits: SearchHit[];
  activeHit: number;
  replaceBytes(bytes: Uint8Array, state: DocState, clearHistory: boolean): Promise<void>;
}

export const EditorCtx = createContext<EditorApi>(null!);
export const useEditor = () => useContext(EditorCtx);

export const SWATCHES = ['#111827', '#2563eb', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#ffffff'];
export const MARKS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'];
