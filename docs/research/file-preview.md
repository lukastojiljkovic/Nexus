# Research: File Preview Pipeline

**Domain:** local, offline rendering of PDF/Office/media/code/archives in an
Electron + web app, and its security posture.
**Session:** 2026-07-05 (research phase 1, session 9 — closes phase 1).
**Nexus context:** DOC module (S) — "preview as many formats as possible";
must be fully local for local accounts (`SEC-FILE-01`: sandboxed,
least-privilege parsing; never in main process).

## 1. Conclusions

1. **Per-format tiering, not one mega-viewer.** Verified viable, all local:
   - **PDF:** PDF.js (Mozilla, open source) is the standard, embeddable and
     battle-tested in Electron ([Nutrient's PDF.js guide](https://www.nutrient.io/blog/how-to-build-an-electron-pdf-viewer-with-pdfjs/));
     commercial engines (PDFium-WASM class) exist if fidelity demands grow.
   - **Office (DOCX/XLSX/PPTX):** two roads — client-side JS/WASM renderers
     (commercial SDKs like Nutrient render Office → PDF in-browser without
     LibreOffice/MS Office; open-source per-format libs: mammoth for DOCX,
     SheetJS/exceljs for XLSX render acceptably for *preview*), or bundled
     LibreOffice headless conversion (heavy: hundreds of MB in the
     installer). Open-source React viewers are dated/low-fidelity
     ([Office viewer options](https://www.nutrient.io/guides/web/viewer/office-documents/)).
     Recommendation: v1 = open-source per-format preview (fidelity labeled
     as "preview, not print-exact"); evaluate commercial WASM engine or
     optional LibreOffice companion download in architecture if fidelity
     complaints arrive.
   - **Images/video/audio:** Chromium's native capabilities cover the
     mainstream formats free; thumbnails via sharp-class tooling.
   - **Code/text/markdown:** editor-grade highlighting (CodeMirror-class),
     sanitized markdown render (`SEC-FILE-05`).
   - **Archives (ZIP):** listing + nested preview with `SEC-FILE-03` caps.
2. **Security architecture is the hard requirement, not rendering:** all
   parsing in a sandboxed renderer/utility process with `contextIsolation`,
   no Node in preview contexts, IPC-mediated file access (`SEC-EL-01/02/04`,
   `SEC-FILE-01`) — Electron's own defaults since v12 support this posture
   ([Electron security notes in PDF viewer guides](https://www.nutrient.io/blog/how-to-build-an-electron-pdf-viewer-with-pdfjs/)).
   Web app gets the same JS/WASM viewers minus filesystem (upload/blob only).
3. **Preview ≠ fidelity promise.** Label complex XLSX/PPTX previews as
   approximate; offer "open in default app" as the escape hatch on desktop —
   cheap and honest.
4. **Licensing check in architecture:** PDF.js (Apache-2), mammoth (BSD),
   SheetJS community edition (Apache-2) are safe; any commercial SDK is a
   paid ADR decision.

## 2. Format coverage plan (v1 → later)

| Tier | Formats | Engine |
| --- | --- | --- |
| v1 | PDF, images, video/audio (Chromium-native), TXT/MD/code, ZIP listing | PDF.js, native, CodeMirror-class, archive lib |
| v1 | DOCX (text-focused), XLSX (grid preview), CSV | mammoth-class, SheetJS-class |
| later | PPTX, EPUB, RTF, ODT/ODS, nested archives, email formats | per-format libs / commercial WASM ADR |
| later | Subtitle preview w/ video (ties to UTIL subtitle editor) | existing video pipeline |

## 3. Pitfalls

- **Fidelity complaints on Office files** — set expectations in UI; the
  escape hatch ("open externally") defuses most.
- **Memory on huge files** — stream/paginate; per-format size caps
  (`SEC-FILE-02`); never load a 2GB video into memory for a thumbnail.
- **Malicious files are the #1 attack surface** (`SEC-FILE` whole section;
  fuzzing per `SEC-FILE-07`); zip bombs and image decompression bombs have
  explicit caps.
- **Bundle bloat:** every format engine adds MBs; lazy-load viewers per
  format, keep LibreOffice out of the base installer.

## 4. Open questions → PRD (DOC) / architecture

1. Commercial Office-rendering SDK vs open-source preview quality — decide
   after a fidelity spike on real Serbian student/business documents.
2. Thumbnail generation service (used by canvas media cards, file lists) —
   shared utility process design.
3. Preview inside canvas cards and read-later items — same pipeline, confirm
   in CANV/READ PRDs.
