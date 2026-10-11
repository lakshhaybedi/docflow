import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pdfjs-dist/web/pdf_viewer.css';
import '@fontsource/great-vibes';
import '@fontsource/dancing-script/600.css';
import '@fontsource/caveat/600.css';
import './styles.css';
import './apple.css';
import './lib/desktop';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
