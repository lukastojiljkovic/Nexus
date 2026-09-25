# ADR-064 — In-app file preview (DOC tier 0 + tier 1; no dependencies, no migration)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Based on:** the
2026-07-31 preview recon (verified in code; Electron 42.8.0 realities cited
there). **Implements:** the first DOC slice — previewing what the app already
stores, from the attachment surfaces it already has. The DOC module PAGE
(browse-everything) is a later slice; this ADR is the capability.

## 1. Tiers, honestly scoped

- **Tier 0 — images, text, markdown**: in-app, inline. Images already render
  by `nx-blob://` on three surfaces — a preview is presentation (a house
  lightbox), zero protocol change. Text/markdown gains a real path (see §3).
- **Tier 1 — PDF**: Chromium's own PDFium viewer in a DEDICATED hardened
  preview window (see §2). No dependency; `nx-blob:` already serves
  `application/pdf` with `nosniff`.
- **Out by name — DOCX/XLSX/PPTX and friends**: they sniff as
  `application/zip`; no renderer exists in Electron and a dependency-free one
  would be a product, not a feature. They keep „Otvori" (external, tmp-open
  discipline) only, and the preview menu simply does not offer them.
- **PRIV attachments are excluded in v1** — the recorded priv limit ("bez
  otvaranja u spoljnim programima") stands; a priv preview window is a
  revisit trigger once the section's threat review covers a second window
  holding decrypted bytes.

## 2. The PDF host: a separate window, not a flag on the shell

`plugins: true` goes on a NEW dedicated preview `BrowserWindow` — never on
the main window. The preview window: `sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`, **no preload at all** (a
PDFium compromise lands in a renderer with no IPC surface),
`setWindowOpenHandler` deny, `will-navigate` locked to exactly the one
`nx-blob://<hash>` URL it was opened with, closed on every lock alongside
the tmp-open wipe (an open preview must not outlive the session that could
read it — the protocol already 404s on lock, the window follows). It loads
the blob URL as its MAIN FRAME document — no iframe, so the shell's CSP is
not in play and needs no `frame-src` widening. Title = the stored file name;
size remembered per the house window defaults.

Opening is main-owned: one channel `doc:preview { module, attachmentId }` —
`assertTrustedSender` + validators, main resolves the hash through the SAME
per-module stores the open/save-as handlers use (the renderer never names a
hash), refuses non-previewable mimes by name. The viewer's own download
button triggers Electron's default save dialog — functionally the existing
„Sačuvaj kao", left UNINTERCEPTED in v1 and recorded here; print likewise
(a user who can open externally can already do both).

**The spike is part of the lane, not a prior**: custom-protocol PDF in an
Electron window has a history of version-specific breakage. The lane must
prove the render in the BUILT app (the smoke path applies the packaged CSP
and real protocol wiring — extend the smoke run with a preview leg that
loads a fixture PDF and asserts the window reaches `did-finish-load` without
a download starting). If PDFium refuses `nx-blob:` in 42.8.0, the honest
fallback ships instead: PDFs keep external-open only, the refusal and the
Electron issue land in this ADR as an addendum, and tier 0 still ships.

## 3. Tier 0 text/markdown: the mime gap closes

- `sniffMime` gains a bounded UTF-8-validity heuristic returning
  `text/plain` — preserving the stated invariant (NEVER a markup type; the
  worst case stays an inert download). `isInlineImageMime` gets a sibling
  `isPreviewableMime` predicate (image / pdf / text).
- Text bytes do NOT cross via fetch (packaged `connect-src 'self'` blocks it,
  and the house posture is "the attachment's bytes never cross this
  boundary" — they still don't): one typed channel `doc:read-text
  { module, attachmentId }`, size-capped well under the blob caps (1 MiB —
  a bigger "text file" is not for reading in a pane), decoded in main,
  answering `{ name, text }`.
- Rendering: `.md` composes the two pieces that already exist —
  `parseMarkdownNote` (core, tested) into the read-only TipTap preview
  pattern (`editable: false`, the version-history/template-pane recipe);
  `.txt` is an escaped `<pre>`. Both in one house preview dialog
  („Pregledaj") reached from the attachment ⋯ menus on the three public
  surfaces (notes panel, task attachments, subject materials). Images join
  the same dialog as a lightbox around the existing `nx-blob://` URL.

## 4. Consequences

- No migration, no interchange change, zero dependencies. The serving side
  (protocols, sniffing at add time, caps) is untouched except the
  `text/plain` sniff extension (+ its tests, red first).
- Memory note recorded: `readBlob` buffers whole containers and the PDF
  viewer may re-fetch 2–3×; bounded by the 50 MB cap, acceptable, stated.
- Surfaces touched: `sniff.ts` (+tests), one preview-window factory in main
  (copying the hardening ritual), two channels + preload methods, the three
  attachment menus, `strings.ts`, `app.css`. Smoke gains the preview leg.
- The subject-materials surface keeps its no-thumbnail row (deliberate);
  „Pregledaj" joins its menu all the same.
