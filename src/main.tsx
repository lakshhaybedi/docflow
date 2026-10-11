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
import { customFonts, installFontFaces } from './lib/fonts';

installFontFaces();
void customFonts(); // register any fonts the user added

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
