// All documents stay in this browser's IndexedDB. Nothing is uploaded.
import { get, set, del, update } from 'idb-keyval';
import type { DocMeta, DocState } from './types';

export const uid = () => crypto.randomUUID();

export async function listDocs(): Promise<DocMeta[]> {
  return ((await get<DocMeta[]>('docs')) ?? []).sort((a, b) => b.openedAt - a.openedAt);
}

export async function putMeta(meta: DocMeta) {
  await update<DocMeta[]>('docs', (docs = []) => [...docs.filter((d) => d.id !== meta.id), meta]);
}

export async function patchMeta(id: string, patch: Partial<DocMeta>) {
  await update<DocMeta[]>('docs', (docs = []) => docs.map((d) => (d.id === id ? { ...d, ...patch } : d)));
}

export async function deleteDoc(id: string) {
  await update<DocMeta[]>('docs', (docs = []) => docs.filter((d) => d.id !== id));
  await Promise.all([del(`bytes:${id}`), del(`state:${id}`)]);
}

export const getBytes = (id: string) => get<Uint8Array>(`bytes:${id}`);
export const putBytes = (id: string, bytes: Uint8Array) => set(`bytes:${id}`, bytes);

export async function getState(id: string, pages: number): Promise<DocState> {
  return (await get<DocState>(`state:${id}`)) ?? { pageOrder: [...Array(pages).keys()], annotations: [], bookmarks: [] };
}
export const putState = (id: string, state: DocState) => set(`state:${id}`, state);

export const getList = async (key: 'folders' | 'signatures' | 'stickers') => (await get<string[]>(key)) ?? [];
export async function pushList(key: 'folders' | 'signatures' | 'stickers', value: string, max = 12) {
  await update<string[]>(key, (xs = []) => [value, ...xs.filter((x) => x !== value)].slice(0, max));
}
export async function removeFromList(key: 'folders' | 'signatures' | 'stickers', value: string) {
  await update<string[]>(key, (xs = []) => xs.filter((x) => x !== value));
}
