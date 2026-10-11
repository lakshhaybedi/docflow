// Bridge to the macOS shell (electron/preload.cjs). Undefined when running in a normal browser.
interface Desktop {
  platform: string;
  openDialog(): Promise<void>;
  setTheme(theme: 'system' | 'light' | 'dark'): void;
  onOpenFile(cb: (name: string, data: Uint8Array) => void): () => void;
  onMenu(cb: (cmd: string) => void): () => void;
}

export const desktop: Desktop | undefined = (window as any).desktop;
export const isDesktop = !!desktop;
if (desktop) document.documentElement.classList.add('is-desktop');

export type Command =
  | 'settings' | 'new' | 'export' | 'home' | 'undo' | 'redo' | 'find' | 'zoom-in' | 'zoom-out' | 'zoom-fit' | 'tour' | 'welcome';

/** App-wide commands, from the native menu bar or from in-app buttons. */
export function onCommand(fn: (cmd: Command) => void) {
  const h = (e: Event) => fn((e as CustomEvent).detail);
  window.addEventListener('df:cmd', h);
  return () => window.removeEventListener('df:cmd', h);
}
export const runCommand = (cmd: Command) => window.dispatchEvent(new CustomEvent('df:cmd', { detail: cmd }));

desktop?.onMenu((cmd) => {
  // In a text field, Undo/Redo belong to the field, not the document history.
  const typing = (document.activeElement as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
  if ((cmd === 'undo' || cmd === 'redo') && typing) return void document.execCommand(cmd);
  runCommand(cmd as Command);
});
