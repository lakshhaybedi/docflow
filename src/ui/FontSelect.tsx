import { useEffect, useState } from 'react';
import { addCustomFont, customFonts, type CustomFont } from '../lib/fonts';
import type { FontFamily } from '../lib/types';
import { pickFile, useToast } from './ui';

/** Font picker: the three built-in families, any fonts the user added, and "Add font…". */
export function FontSelect({ value, onChange, label = 'Font' }: { value: FontFamily; onChange: (f: FontFamily) => void; label?: string }) {
  const toast = useToast();
  const [fonts, setFonts] = useState<CustomFont[]>([]);
  useEffect(() => void customFonts().then(setFonts), []);
  const known = ['sans', 'serif', 'mono', ...fonts.map((f) => `custom:${f.id}`)];
  return (
    <select
      aria-label={label}
      value={known.includes(value) ? value : 'sans'}
      onChange={async (e) => {
        if (e.target.value !== '__add') return onChange(e.target.value as FontFamily);
        const [file] = await pickFile('.ttf,.otf,.woff,.woff2,font/ttf,font/otf');
        if (!file) return;
        try {
          const f = await addCustomFont(file);
          setFonts(await customFonts());
          onChange(`custom:${f.id}`);
          toast({ kind: 'success', text: `Added ${f.name}` });
        } catch (err: any) {
          toast({ kind: 'error', text: err.message });
        }
      }}
    >
      <option value="sans">Sans (Helvetica)</option>
      <option value="serif">Serif (Times)</option>
      <option value="mono">Mono (Courier)</option>
      {fonts.length > 0 && <optgroup label="Your fonts">{fonts.map((f) => <option key={f.id} value={`custom:${f.id}`}>{f.name}</option>)}</optgroup>}
      <option value="__add">Add font…</option>
    </select>
  );
}
