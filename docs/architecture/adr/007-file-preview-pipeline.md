# ADR-007 — File Preview Pipeline

**Status:** accepted (draft pending founder sign-off) · 2026-07-05
**Drives:** DOC PRD (DOC-001..011), decision #11 (PDF annotation v1.x);
SEC-FILE-01..05. Fully local for local accounts — no cloud conversion.

## Context

File-preview research (2026-07-05) already tiered the formats and rejected
bundling LibreOffice (size, process management, licensing friction). This
ADR fixes the engines, the sandbox model, and the annotation approach.

## Decision

Per-format engines, all lazy-loaded, all parsing in sandboxed contexts:

| Format class | Engine | Notes |
| --- | --- | --- |
| PDF | PDF.js | Rendering + text layer; annotations as a Nexus overlay store rendered above the page (PRD-friction #2) — never mutating the file v1 |
| Word (.docx) | mammoth → sanitized HTML | Labeled "approximate preview"; escape hatch: open externally |
| Excel (.xlsx/.csv) | SheetJS CE (read-only) | Virtualized grid via views engine; approximate label |
| Slides (.pptx) | Not previewed v1 | Listed with metadata + open-externally (research tiering) |
| Images | Chromium native | EXIF stripped on import where the target is shared/avatar (SEC-FILE-04); dimensions capped against decompression bombs |
| Audio/video | Chromium native `<audio>/<video>` | Codec support = Chromium's; no bundled ffmpeg for *preview* (UTIL conversion is a separate concern, UTIL OQ#1) |
| Archives (.zip) | zip.js — listing + selective entry preview | Bomb caps: max entries, max ratio, max nested depth (SEC-FILE-03) |
| Code/text | Shiki highlighter | Lazy per-language grammars; size cap with "open full file" |

Sandbox model (SEC-FILE-01/02):

- **Desktop:** parsing runs in a dedicated sandboxed renderer or
  `utilityProcess` with no Node integration and no filesystem access
  beyond the streamed bytes; results cross IPC as sanitized data
  (HTML from mammoth passes DOMPurify with a strict allowlist).
- **Web:** same code in a sandboxed iframe/worker (`sandbox` attr, no
  same-origin), CSP-restricted.
- Type detection by magic bytes, never extension alone; declared type,
  detected type, and size are validated before any parser runs
  (SEC-FILE-02); parser crashes degrade to the generic file card, never
  the app.

## Consequences

- Viewer bundles load on first use — keeps base bundle and memory budget
  intact (overview budgets).
- Office fidelity is "approximate" by design; the DOC OQ#1
  fidelity-complaint threshold (defined in the PRD as a beta metric)
  triggers a revisit ADR for a commercial WASM engine — until then, zero
  license cost.
- PDF annotation as overlay data means annotations sync like any Nexus
  data and survive file replacement — but exported PDFs need a flattening
  step later (DOC future extension).

## Sources

- `docs/research/file-preview.md` (tiering, engine comparison, bomb caps).
- [PDF.js](https://mozilla.github.io/pdf.js/), [mammoth.js](https://github.com/mwilliamson/mammoth.js),
  [SheetJS CE](https://docs.sheetjs.com/), [zip.js](https://gildas-lormeau.github.io/zip.js/),
  [Shiki](https://shiki.style/).
