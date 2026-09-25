# ADR-014 — NOTE Attachments & Blob Store

**Status:** accepted · 2026-07-18 (Claude, within delegated technical
leadership; no new founder decision needed — NOTE-003 is fully specified in
PRD 09 and this ADR only fixes the mechanism).
**Drives:** NOTE-003 (attachments with inline preview), future DOC (the full
preview pipeline consumes the same blob store), future IMEX (attachment
export), future sync (content-addressed blobs merge trivially, PRD 09 §7).

## Context

NOTE-003 requires "any file via blob store with inline preview (images/PDF
inline; others as preview chips via DOC); size caps per SEC-FILE-02". The DOC
module (the sandboxed per-format preview pipeline of the file-preview
research) does not exist yet. The renderer is untrusted (SEC-EL); binding
rules: main never accepts renderer-supplied filesystem paths, every user file
is hostile (SEC-FILE-01), type comes from magic bytes not extension
(SEC-FILE-02), blobs are served with correct `Content-Type` + `nosniff`,
never as HTML (SEC-FILE-06).

## Decision

### Content-addressed blob store, bytes in main, rows in the db

- Attachment **bytes** live on disk under
  `userData/attachments/<aa>/<sha256>` (two-level fanout, atomic
  write-temp-then-rename, write-if-absent). Content addressing dedupes
  identical files and is the future sync/IMEX unit (PRD 09 §7).
- Attachment **rows** live in a new table **`note_attachments`** (migration
  013): `id` (uuidv7 PK), `note_id` FK → `notes(id) ON DELETE CASCADE`,
  `file_name` (original, display-only), `mime` (main-sniffed, never the
  renderer's claim), `size_bytes` (CHECK > 0), `sha256`, `created_at`;
  indexes on `note_id` and `sha256` (refcount). A new
  **`NoteAttachmentStore`** (mirroring `NoteOrgStore`'s shape: own
  active-note guard, profile-scoped every statement) owns add/list/remove
  plus `refCount(sha256)`; the db package stays pure SQL — file IO lives in
  `main/attachments.ts` (the notifications/imex deps-injection pattern).
- **GC on detach:** removing the last row referencing a hash deletes the
  blob. A note's *hard* delete cascades rows without a file-side hook — no
  purge flow exists yet; when one arrives it runs a sweep (blob dir listing
  vs `SELECT DISTINCT sha256`). Soft-deleted notes keep rows and blobs, so
  undo restores attachments for free.

### No paths cross the trust boundary — bytes do

Both attach flows (the "Priloži" button via `<input type="file">` and
drag-drop onto the editor) read the `File` in the renderer and send **bytes**
over IPC (`notes:attach`: profileId, note id, fileName, `Uint8Array` ≤
`NOTE_ATTACHMENT_MAX_BYTES` = **50 MB**, the SEC-FILE-02 cap, enforced
renderer-side, main-side, and store-side like note updates). Main computes
sha256, sniffs the real type from magic bytes, stores blob + row. Main never
sees a renderer-chosen path; the save-as flow uses main's native save dialog
(the IMEX pattern), and open-externally copies the blob to a main-owned temp
file named by the sanitized original `file_name` (extension preserved for app
association) before `shell.openPath`.

### Inline preview: Chromium decodes, main only streams

A custom **`nx-blob:` protocol** (registered privileged before app-ready;
`protocol.handle` in main) serves blob bytes by hash — only when a
`note_attachments` row with that hash exists — with the *stored sniffed*
`Content-Type` + `X-Content-Type-Options: nosniff`, never `text/html`; the
prod CSP's `img-src` gains `nx-blob:`. Image attachments (magic-byte
allowlist: png/jpeg/gif/webp) render inline as `<img
src="nx-blob://<sha256>">` — decoding happens in Chromium's sandboxed
renderer pipeline, never in main, satisfying SEC-FILE-01 without a thumbnail
service (no main-side media processing at all, SEC-FILE-04 by omission; CSS
caps display size). Everything else — including PDF for now — is a **chip**
(type icon, name, human size) with open-externally and save-as actions.
**PDF/Office inline preview is explicitly the DOC module's pipeline**
(PDF.js-class viewers, sandboxed per the file-preview research) and arrives
with DOC — recorded in STATUS §4, not half-built here.

### Editor surface

A quiet **"Prilozi"** section in the editor pane (between the content and
"Povratne veze"): attach button, drag-drop target (accent border + soft
background, never a glow), image previews + file chips, per-chip "⋯" popover
(open / save-as / remove — removal is deliberate-by-menu, no accidental
single-click destruction; no undo window, unlike notes, because the blob GC
is immediate). Dropping or attaching an **image** additionally inserts an
**`attachmentImage` inline-block atom** at the caret whose only durable
attribute is the attachment row's `id` (the ADR-013 identity pattern): a
NodeView resolves the `nx-blob:` URL live; a detached attachment leaves a
muted placeholder (like a missing wiki-link). Deleting the block never
detaches — the panel is the source of truth for what the note carries.

### Rejected alternatives

- **BLOBs in SQLite:** simple, but couples database size/backup to media,
  breaks the content-addressed sync/IMEX story, and doubles memory on serve.
- **Renderer-supplied paths for drag-drop** (`webUtils.getPathForFile`):
  standard Electron, but it would carve an exception into the "main never
  accepts renderer paths" rule for no gain — bytes-over-IPC already fits the
  note-update transfer pattern and the 50 MB cap bounds it.
- **Main-side thumbnailing:** violates SEC-FILE-01 (parsing hostile media in
  a privileged process) for a marginal win at local disk speeds.

## Consequences

- The blob store directory becomes part of the app's data footprint story
  (uninstaller already offers data deletion; IMEX export of attachments is a
  recorded later slice).
- `attachmentImage` is an additive schema node (ADR-012's migration story
  holds); markdown export of image blocks resolves via IMEX later.
- Slices: **003-a** data + blob + IPC (migration 013, `NoteAttachmentStore`
  TDD, `main/attachments.ts`, `nx-blob:` protocol + CSP, five channels,
  preload), **003-b** editor UI (Prilozi panel, drag-drop, chips + previews,
  `attachmentImage` node, strings/CSS).
