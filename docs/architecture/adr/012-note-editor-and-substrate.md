# ADR-012 — NOTE Block Editor & Yjs Substrate

**Status:** accepted · 2026-07-12 (founder brief same day: *"kao Notion ali
jednostavniji UX kako bi se korisnik lakše snašao"* — Notion-family block
model, deliberately reduced surface; editor-kit choice and v1 block set
delegated to Claude within that brief).
**Drives:** NOTE PRD (09), ADR-001 (Yjs document substrate from day one),
SEC-EL (renderer is untrusted), future SRCH (derived plaintext) and SHARE
(CRDT-ready by construction).

## Context

ADR-001 fixed *what* notes are (Yjs CRDT documents in SQLite: binary
update log + snapshot rows + derived plaintext for FTS) but left open *which*
editor produces them and *how* documents flow across the trust boundary
(renderer edits, main owns the DB). The founder's brief fixes the UX
direction and explicitly asks for less surface than Notion, not more.

## Decision

### Editor kit: TipTap (MIT core, ProseMirror) + Collaboration/Yjs binding

- **TipTap v3** (`@tiptap/core`, `@tiptap/react`, MIT) over ProseMirror, with
  `@tiptap/extension-collaboration` (y-prosemirror underneath) binding the
  editor to a `Y.Doc`. ProseMirror is the most battle-tested Yjs pairing;
  TipTap is a thin, schema-first wrapper that leaves the entire UI to us.
- **Not BlockNote:** it ships Notion's *full* UX (drag handles, side menus,
  its own styled DOM) — we would be deleting UI to honor "jednostavniji" and
  fighting its styling to honor the token discipline; its XL add-ons are
  AGPL/commercial. **Not Lexical:** weaker/less-proven Yjs story than
  y-prosemirror, and its block model is further from PRD 09's needs.
- All editor code is renderer-side only; main never runs ProseMirror. Main
  uses plain `yjs` (pure JS) for storage-side merging only.

### v1 block set (deliberately small, per the brief)

Paragraph, heading 1–3, bulleted list, numbered list, task list (visual
checkboxes only, per PRD 09 §6/TASK), quote, divider, code block (plain, no
highlighting yet). Inline marks: bold, italic, inline code, link. Input =
**markdown shortcuts** (`#`, `-`, `1.`, `[]`, `>`, ```` ``` ````, `**`, `*`,
`` ` ``) + a **Serbian slash menu** — and nothing else: no drag handles, no
tables/callouts/toggles (NOTE-011 is S), no columns, no nested pages.
Everything else in PRD 09 (folders/tags NOTE-002, attachments NOTE-003,
wiki-links NOTE-004, inline flashcards NOTE-006, canvas NOTE-007, versions
NOTE-008, templates NOTE-009) arrives in later slices — tracked in STATUS §4,
not silently dropped.

### Persistence seam (SEC-EL)

One `Y.Doc` per note. The renderer owns the live doc; main owns storage.

- **Tables (migration 010):** `notes` (id, profile FK CASCADE, denormalized
  `title`, timestamps, soft-delete) · `note_updates` (note FK CASCADE,
  per-note monotonic `seq`, binary Yjs update BLOB, created_at) ·
  `note_snapshots` (one row per note: merged snapshot BLOB, derived
  `plaintext`, `covered_seq`, updated_at). Update/snapshot rows are scoped
  through their note (requireActive first), the `document_renewals` pattern.
- **Write path:** the renderer batches local Yjs updates (debounced,
  `Y.mergeUpdates`) and sends `notes:append-update` with the binary update
  (≤ 256 KB, validated in main *and* re-checked in the store) plus the
  derived `title` (first non-empty line, ≤ 200 chars — renderer-supplied is
  trust-consistent: it authors the content itself). Main stamps `updated_at`.
- **Read path:** `notes:load` returns `{ snapshot, updates[], title }`; the
  renderer applies them to a fresh `Y.Doc` and binds the editor.
- **Compaction (main-side, in `main/notes.ts`):** when a note's pending
  updates exceed a threshold (32), main merges snapshot + updates into a new
  snapshot via `yjs`, derives `plaintext` by walking the XML fragment (for
  future SRCH), and calls the store's *atomic* `compact` (write snapshot +
  delete covered updates in one transaction). The store stays CRDT-agnostic
  (opaque blobs + transactional guarantees); CRDT semantics live in main —
  the same pure-logic/storage seam IMEX uses.

### Slices

a1 = substrate (migration 010 + `NoteStore` TDD + IPC/preload + compaction) —
dark, no UI; a2 = TipTap editor page + slash menu + styling (module registers
in `V0_MODULES` only here, per the 2026-07-12 "hidden until built" rule);
a3+ = organization (folders/tags/pin), then the remaining PRD 09 M-items.

## Consequences

- New dependencies: `yjs` (main + renderer), `@tiptap/*` (renderer only,
  a2). All pure JS — no native-ABI interaction with the Electron 42 pin.
- Markdown export fidelity (NOTE-001) is straightforward from the small
  block set; the schema grows block-by-block, each with an explicit
  migration story for existing Yjs docs (additive node types only).
- Version history (NOTE-008) will retain periodic snapshots instead of
  compacting them away — the single-snapshot table gains a retention policy
  then; the schema anticipates this (snapshots keyed by note, `covered_seq`).
