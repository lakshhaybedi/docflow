import { openPdf, PasswordRequired, thumbnail } from './pdf';
import { decrypt } from './pdfwrite';
import { getBytes, getState, putBytes, putMeta, putState, uid } from './store';
import { askText } from '../ui/prompt';
import type { DocMeta, DocState } from './types';

export async function addDocument(name: string, bytes: Uint8Array, state?: DocState): Promise<DocMeta> {
  const pdf = await openPdf(bytes);
  const now = Date.now();
  const meta: DocMeta = {
    id: uid(), name, size: bytes.length, pages: state?.pageOrder.length ?? pdf.numPages, createdAt: now, openedAt: now,
    thumb: await thumbnail(pdf, state?.pageOrder[0] ?? 0),
  };
  await pdf.destroy();
  await putBytes(meta.id, bytes);
  if (state) await putState(meta.id, state);
  await putMeta(meta);
  return meta;
}

/** Reads a user-chosen file. Encrypted PDFs are unlocked once and stored decrypted, locally only. */
export async function importFile(file: File): Promise<DocMeta | null> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))
    throw new Error(`${file.name} isn't a PDF. DocFlow opens .pdf files.`);
  let bytes = new Uint8Array(await file.arrayBuffer());
  let password: string | undefined;
  for (;;) {
    try {
      await (await openPdf(bytes, password)).destroy();
      break;
    } catch (e) {
      if (!(e instanceof PasswordRequired)) throw e;
      const pw = await askText({ title: `${file.name} is password protected`, label: e.message, password: true, confirm: 'Unlock' });
      if (pw === null) return null;
      password = pw;
    }
  }
  if (password) bytes = await decrypt(bytes, password);
  return addDocument(file.name, bytes);
}

export async function loadDoc(meta: DocMeta) {
  const bytes = await getBytes(meta.id);
  if (!bytes) throw new Error(`The file data for ${meta.name} is missing from this browser's storage.`);
  return { bytes, state: await getState(meta.id, meta.pages) };
}

export async function duplicateDoc(meta: DocMeta) {
  const { bytes, state } = await loadDoc(meta);
  const name = meta.name.replace(/(\.pdf)?$/i, ' (copy).pdf');
  return addDocument(name, bytes, structuredClone(state));
}

export const withSuffix = (name: string, suffix: string, ext = 'pdf') => `${name.replace(/\.pdf$/i, '')}${suffix}.${ext}`;
