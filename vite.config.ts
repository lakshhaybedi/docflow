import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync } from 'node:fs';

/** Ship the OCR engine and Unicode fonts with the app so nothing is fetched from a CDN at runtime. */
function vendorAssets(): Plugin {
  const copy = (from: string, to: string) => cpSync(`node_modules/${from}`, `public/vendor/${to}`);
  return {
    name: 'docflow-vendor-assets',
    buildStart() {
      for (const d of ['ocr/core', 'ocr/lang', 'fonts']) mkdirSync(`public/vendor/${d}`, { recursive: true });
      copy('tesseract.js/dist/worker.min.js', 'ocr/worker.min.js');
      for (const v of ['', 'simd-', 'relaxedsimd-']) copy(`tesseract.js-core/tesseract-core-${v}lstm.wasm.js`, `ocr/core/tesseract-core-${v}lstm.wasm.js`);
      copy('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'ocr/lang/eng.traineddata.gz');
      const fonts: [string, string, string[]][] = [
        ['noto-sans', 'NotoSans', ['400Regular', '400Regular_Italic', '700Bold', '700Bold_Italic']],
        ['noto-serif', 'NotoSerif', ['400Regular', '400Regular_Italic', '700Bold', '700Bold_Italic']],
        ['noto-sans-mono', 'NotoSansMono', ['400Regular', '700Bold']],
        ['noto-sans-devanagari', 'NotoSansDevanagari', ['400Regular', '700Bold']],
      ];
      for (const [pkg, name, weights] of fonts)
        for (const w of weights) copy(`@expo-google-fonts/${pkg}/${w}/${name}_${w}.ttf`, `fonts/${name}_${w}.ttf`);
    },
  };
}

// base './' so the bundle also loads from the desktop app's app:// origin
export default defineConfig({ base: './', plugins: [react(), vendorAssets()], server: { port: 5180 } });
