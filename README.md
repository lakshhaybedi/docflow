# DocFlow

Desktop-first PDF workspace: read, annotate, edit, sign, redact, OCR, organize and export PDFs — entirely in the browser.

```
npm install
npm run dev        # web version at http://localhost:5180
npm run app        # build and launch the macOS app
npm run dist:mac   # build release/DocFlow-<version>-arm64.dmg
```

The macOS app (Electron) adds native window vibrancy, a menu bar, File › Open, “Open With” for PDFs and native save dialogs.
First launch shows a skippable welcome, customization step, and a guided tour on a generated practice document.

> Release builds are ad-hoc signed, not notarized. On another Mac, right-click › Open the first time
> (or approve it in System Settings › Privacy & Security).

## Where things live
- `src/lib/pdf.ts` — pdf.js loading, rendering, text runs, search, outline
- `src/lib/pdfwrite.ts` — everything that writes PDFs: flatten/export, merge, compress, secure redaction, OCR text layer, encryption
- `src/lib/geom.ts` — shapes/arrows/ink geometry shared by the on-screen overlay and the PDF writer
- `src/lib/store.ts` — IndexedDB persistence (documents never leave the browser)
- `src/editor/*` — editor shell, viewer, annotation layer, panels; `src/dashboard/*` — file management
- `src/onboarding/*` — welcome flow, guided tour, practice document; `src/lib/prefs.ts` — theme, accent and defaults
- `src/apple.css` — glass materials and motion; `electron/` — macOS shell (main process + preload bridge)

Annotations are stored in page units (PDF points, top-left origin, rotation applied) so they're zoom-independent and map 1:1 to export.

## Honest limits
- **Redaction** rebuilds each redacted page as an image (180 dpi) so no underlying text/vectors survive; output is verified to contain no text on those pages before success is reported. Those pages lose selectable text until you OCR them.
- **Edit existing text** covers the original run and draws new text; the original remains underneath (the UI says so).
- **Blur** is visual only (labelled as such). **Signatures** are images, not cryptographic signatures.
- **Fonts**: added text uses the PDF standard fonts (Helvetica/Times/Courier) — Latin text only.
- **Word/PowerPoint** export needs a conversion engine and is shown as unavailable.
- **Network**: OCR downloads Tesseract + English data from cdn.jsdelivr.net on first use; stock image search queries openverse.org. Nothing else is sent anywhere.
