# PRD 13 — Documents & Preview (DOC)

**Status:** draft 2026-07-05. Inputs: raw-spec §6, `docs/research/file-preview.md`,
SEC-FILE (binding), blob-store concept (offline-sync research).

## 1. Purpose

Files as first-class citizens: attach anywhere, preview practically
anything, fully offline — the "preview svih file formata" founder
requirement. DOC provides the shared preview pipeline and a light document
library; it is infrastructure for NOTE, CANV, STUDY, FIN (receipts), READ.

## 2. User stories

- As a student, I want to open PDFs and skripte inside the app, so that
  studying doesn't scatter across viewers.
- As a user, I want any attachment to show a preview instantly, so that I
  recognize files without opening them elsewhere.
- As a careful user, I want dangerous files handled safely, so that a
  malicious PDF can't hurt me.
- As an organizer, I want a library of everything I've attached, so that
  files are findable across modules.

## 3. User experience & flows

Preview opens in-place (panel or lightbox) from any attachment chip:
PDF (paged, zoom, text selection, search), images (zoom/rotate), video/audio
(player), text/code (highlighted, read-only), markdown (rendered), DOCX/XLSX
(approximate preview + "otvori u podrazumevanoj aplikaciji" escape hatch),
ZIP (tree listing, preview entries in-place). Library view: all files across
modules (views engine: list/cards), filters by type/module/date, storage
usage stats. Every preview surface shows filename, size, source module link,
and actions (download/copy/open externally).

## 4. Functional requirements

- **DOC-001 (M)** Shared preview pipeline consumed by all modules; all
  parsing sandboxed per SEC-FILE-01 (utility process; no network; no fs
  beyond target), type by magic bytes (SEC-FILE-02).
- **DOC-002 (M)** v1 format tiers (file-preview research §2): PDF (PDF.js-
  class), images (incl. thumbnails; EXIF stripped on share per SEC-FILE-04),
  video/audio (Chromium-native codecs), TXT/MD/code (highlighting), CSV,
  DOCX (text-focused approximate), XLSX (grid preview), ZIP (listing +
  nested preview with SEC-FILE-03 caps).
- **DOC-003 (M)** Escape hatch on every preview: open in OS default app
  (desktop); download (web).
- **DOC-004 (M)** Fidelity labeling: Office previews marked "pregled" with
  tooltip explaining approximation (research conclusion #3).
- **DOC-005 (M)** Thumbnail service: shared, cached, size-capped thumbnails
  for file cards (CANV), lists, and widgets; generation in the sandbox.
- **DOC-006 (M)** Library: cross-module file inventory with type/module/
  date filters, per-file "gde se koristi" (references list), storage usage
  by module; deleting from library warns about all references.
- **DOC-007 (M)** Per-format size caps and lazy-loaded viewer modules
  (bundle discipline per research §3).
- **DOC-008 (S)** PDF extras: text search within document, page thumbnails
  sidebar, remembered last-read position per file (study use case).
- **DOC-009 (S)** Text extraction feed to SRCH for indexable formats
  (SRCH-008, opt-in).
- **DOC-010 (C)** PPTX/EPUB/RTF/ODT previews (tier-2 per research).
- **DOC-011 (C)** PDF annotation (highlights, notes) — student value;
  fast-follow candidate; annotations stored Nexus-side, original untouched.

## 5. Options & settings

Attachment content indexing (off default); thumbnail cache size; per-format
"always open externally" override.

## 6. Integrations

Blob store (all files); NOTE/CANV/STUDY/FIN/READ (attachment consumers);
SRCH (extraction); IMEX (attachments in exports; corrupt-blob manifest
rule); PRIV (same pipeline, decrypt-in-memory, encrypted/no thumbnail cache
per PRIV edge cases).

## 7. Edge cases & error states

- Unknown/unsupported format → generic file card with metadata + escape
  hatch, never an error dialog.
- Corrupt file → sandbox failure contained; card shows "pregled nije moguć"
  + external open still offered.
- Zip bomb / oversized decompression → SEC-FILE-03 caps abort with honest
  message.
- Huge PDF (2,000 pages) → progressive page rendering; memory budget.
- Video codec unsupported by Chromium → detect and offer external open (no
  bundled codec packs v1).
- File renamed/moved externally after "open externally" — irrelevant (blob
  store owns bytes; export creates copies).
- Web app: no OS default apps → download-only escape hatch; same sandbox
  guarantees via browser.

## 8. Acceptance criteria (key)

- Malformed-file corpus (fuzzed PDFs, zip bombs, image bombs per SEC-VER-02)
  produces zero crashes of the main app and zero sandbox escapes; each
  yields the graceful error card.
- A 50 MB skripta PDF opens < 1 s to first page, searches text, remembers
  position on reopen.
- DOCX with tables/images previews readably and is labeled approximate;
  escape hatch opens Word/LibreOffice when installed.
- ZIP with nested folders lists instantly; entry preview works without full
  extraction.
- Library shows a file attached in both NOTE and CANV with both references;
  delete warns listing them.

## 9. Open questions

1. Commercial WASM Office engine ADR trigger: define the fidelity-complaint
   threshold (research OQ#1).
2. ~~PDF annotation (DOC-011) in v1.x?~~ **Confirmed (founder 2026-07-05):
   yes — priority for v1.x.**
3. Library as separate visible module vs utility surface inside settings/
   modules — recommendation: visible when any file exists, auto.

## 10. Future extensions

OCR (searchable scans); CAD/exotic viewers via plugins; file versioning;
scan-from-phone capture into desktop library (companion flow).
