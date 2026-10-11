import {
  Droplets, Eraser, Hand, Highlighter, ImagePlus, MessageSquare, MousePointer2, MoveUpRight, Pencil, Redo2, ScanText, ShieldOff,
  Signature, Square, Stamp, StickyNote, Strikethrough, TextCursorInput, Type, Underline, Undo2,
} from 'lucide-react';
import type { Tool } from '../lib/types';
import { IconBtn } from '../ui/ui';
import { useEditor } from './ctx';

const GROUPS: [Tool, string, React.ReactNode, string?][][] = [
  [['select', 'Select', <MousePointer2 size={18} />, 'V'], ['hand', 'Pan', <Hand size={18} />, 'H']],
  [['text', 'Add text', <Type size={18} />, 'T'], ['editText', 'Edit existing text', <TextCursorInput size={18} />]],
  [
    ['highlight', 'Highlight text', <Highlighter size={18} />], ['underline', 'Underline text', <Underline size={18} />],
    ['strike', 'Strike through', <Strikethrough size={18} />], ['note', 'Sticky note', <StickyNote size={18} />, 'N'],
    ['comment', 'Comment', <MessageSquare size={18} />, 'C'], ['arrow', 'Callout arrow', <MoveUpRight size={18} />],
  ],
  [['pencil', 'Draw', <Pencil size={18} />, 'P'], ['eraser', 'Eraser', <Eraser size={18} />, 'E'], ['shape', 'Shapes', <Square size={18} />, 'R'], ['blur', 'Blur (visual only)', <Droplets size={18} />]],
  [['image', 'Insert image', <ImagePlus size={18} />], ['stamp', 'Stamps & stickers', <Stamp size={18} />], ['signature', 'Signature', <Signature size={18} />]],
  [['redact', 'Redact', <ShieldOff size={18} />], ['ocr', 'OCR — recognize text', <ScanText size={18} />]],
];

const placeTool = (p: ReturnType<typeof useEditor>['opts']['place']): Tool | undefined =>
  !p ? undefined : p.kind === 'stamp' || p.role === 'sticker' ? 'stamp' : p.role === 'signature' ? 'signature' : 'image';

export function Toolbar({ undo, redo, canUndo, canRedo }: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }) {
  const ed = useEditor();
  const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';
  return (
    <div className="toolbar" role="toolbar" aria-label="Editing tools">
      {GROUPS.map((g, i) => (
        <div className="tb-group" key={i}>
          {g.map(([t, label, icon, key]) => (
            <IconBtn key={t} icon={icon} label={label} shortcut={key} active={ed.tool === t || (ed.tool === 'place' && placeTool(ed.opts.place) === t)}
              onClick={() => ed.setTool(ed.tool === t && t !== 'select' ? 'select' : t)} />
          ))}
        </div>
      ))}
      <div className="tb-group">
        <IconBtn icon={<Undo2 size={18} />} label="Undo" shortcut={`${mod}Z`} onClick={undo} disabled={!canUndo} />
        <IconBtn icon={<Redo2 size={18} />} label="Redo" shortcut={`${mod}⇧Z`} onClick={redo} disabled={!canRedo} />
      </div>
    </div>
  );
}
