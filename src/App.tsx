import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Dashboard } from './dashboard/Dashboard';
import { Editor } from './editor/Editor';
import { ToastProvider, TooltipHost, useToast } from './ui/ui';
import { SettingsHost, openSettings } from './ui/Settings';
import { PromptHost } from './ui/prompt';
import { Onboarding } from './onboarding/Onboarding';
import { TourHost, startTour } from './onboarding/Tour';
import { createDemoDocument } from './onboarding/demo';
import { getPrefs, setPrefs } from './lib/prefs';
import { desktop, onCommand } from './lib/desktop';
import { importFile } from './lib/docs';
import { listDocs } from './lib/store';

const route = () => location.hash.match(/^#\/doc\/(.+)$/)?.[1] ?? null;

export function App() {
  return (
    <ToastProvider>
      <Shell />
      <SettingsHost />
      <PromptHost />
      <TooltipHost />
      <TourHost />
    </ToastProvider>
  );
}

function Shell() {
  const toast = useToast();
  const [docId, setDocId] = useState(route);
  const [welcome, setWelcome] = useState(!getPrefs().onboarded);

  useEffect(() => {
    // crossfade between Files and the editor where the browser supports view transitions
    const on = () => {
      const next = route();
      const vt = (document as any).startViewTransition;
      if (vt && !getPrefs().reduceMotion) vt.call(document, () => flushSync(() => setDocId(next)));
      else setDocId(next);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const open = (id: string) => (location.hash = `/doc/${id}`);
  const back = () => (location.hash = '');

  const tour = async () => {
    // reuse the practice document if it's still around
    const existing = (await listDocs()).find((d) => d.name === 'Welcome to DocFlow.pdf');
    const id = existing?.id ?? (await createDemoDocument()).id;
    open(id);
    setTimeout(startTour, 900);
  };

  useEffect(() => onCommand((cmd) => {
    if (cmd === 'settings') openSettings();
    if (cmd === 'welcome') setWelcome(true);
    if (cmd === 'tour') void tour();
    if (cmd === 'home') back();
  }), []);

  // PDFs opened from Finder, the Dock or File › Open
  useEffect(() => desktop?.onOpenFile(async (name, data) => {
    try {
      const meta = await importFile(new File([data as BlobPart], name, { type: 'application/pdf' }));
      if (meta) open(meta.id);
    } catch (e: any) {
      toast({ kind: 'error', text: e.message });
    }
  }), []);

  return (
    <>
      {docId ? <Editor key={docId} id={docId} back={back} open={open} /> : <Dashboard open={open} />}
      {welcome && (
        <Onboarding onFinish={(takeTour) => {
          setPrefs({ onboarded: true });
          setWelcome(false);
          if (takeTour) void tour();
        }} />
      )}
    </>
  );
}
