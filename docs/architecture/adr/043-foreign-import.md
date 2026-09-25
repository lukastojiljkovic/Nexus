# ADR-043 — Foreign import: merging another account's archive

**Status:** accepted · 2026-07-30 · **no migration** · **no interchange bump**
**Drives:** the "foreign import" item of the IMEX remainder (STATUS §4) — the
operation ADR-023 deliberately did not decide. Restore REPLACES a profile and
preserves ids because a note's Yjs doc embeds other rows' ids; foreign import
is the opposite contract: it **merges somebody else's archive** (or the user's
other account's) into a profile that already has data. It therefore **mints
new ids for every imported row, remaps every reference — including inside Yjs
state — deduplicates only where identity is certain, and salvages what it can
instead of refusing on the first bad row.** Same container, same parser, same
version gate and era defaulting; different downstream semantics.

## Decision

### 1. Salvage is a parser MODE, not a second parser

`parseImportArchive` gains `mode: "restore" | "import"` (default `"restore"`,
existing call sites untouched). In import mode, a **per-row** structural error
is demoted to a warning and the row is **dropped**; dropping cascades along
references (a dropped list's tasks fall to the Inbox rule below; a dropped
deck's cards drop with it; a dropped note's attachments, versions and derived
cards drop) and every drop is **counted and named** in the problem list —
salvage never becomes silence. Archive-level problems (bad zip, bad manifest,
bad checksums, unsupported version, malformed NDJSON line) stay hard errors in
both modes: a corrupt container is not something to guess at. One parser, one
grammar, two strictness policies — the rules stay in one file.

### 2. A pure merge planner in core (the heart of the arc)

`planForeignImport(parsed, target, mintId)` in `packages/core/src/imex/`:

- **`mintId` is injected** (core stays platform-free); every imported row gets
  a fresh id, and the old→new map is built once, for every table.
- **References remap through that map**: task parents/lists/sections, tag
  links, dependencies (both ends), cards→decks, cards→sourceNoteId,
  exams→subjects, plans/blocks, review log→cards, attachments→notes/tasks,
  folders' parents and `default_template_id`, note versions, exdate splits —
  everything the interchange carries.
- **Dedup only where identity is certain:** note tags and task tags merge by
  the stores' own `(profile, name)` get-or-create identity — links remap onto
  the target's existing tag when names match. **Nothing else dedups.** Two
  lists named „Posao" coexist; guessing that same-named rows are the same row
  is the never-guess rule violated with someone else's data.
- **Singletons collapse:** rows in the source's Inbox land in the TARGET's
  Inbox (the Inbox is per-profile and undeletable — a second one is refused
  by the store, and rightly); an imported folder's `is_capture_default` is
  **cleared** when the target already claims it (partial unique index; the
  target's choice wins — recorded); `dashboard-settings` and notification
  settings are **not imported at all** (the target profile's preferences are
  its own).
- **The notification ledger is not imported** — it is a record of what THIS
  device showed THIS user, not portable content. Skipped by design, reported
  as such. Review log IS imported (FSRS history is real study data), remapped
  to the minted card ids. Focus sessions import (merging one's own second
  account is a first-class use).
- Output: the remapped `ProfileData`, the blob name set, and an
  `ImportPlanReport` (per-module imported/merged/skipped counts + the named
  drops) the preview renders verbatim.

### 3. Yjs state is rewritten, not trusted

`remapNoteState(snapshot, idMap)` in core (beside `extractNoteLinkTargets`,
whose walk it reuses): decode the doc, rewrite every `noteLink` node's
`noteId` and every `attachmentImage` node's `attachmentId` through the map,
re-encode. A link whose target is **not** in the import stays as it is and
renders as today's dead link to a deleted note — honest, and exactly what the
UI already handles. Note-derived cards import with `sourceNoteId` remapped and
`sourceBlockKey` intact, so the next open of the note reconciles instead of
duplicating (ADR-017's identity, unchanged).

### 4. Apply is additive, transactional, and undoable

`ForeignImportStore` (db): one transaction of **plain INSERTs with the minted
ids** plus the tag get-or-create — no DELETEs, no UPDATE of any pre-existing
row. Blobs are content-addressed, so writing them before the transaction
dedups against the target for free (the restore arrangement, reused). Undo
reuses the **existing whole-profile snapshot mechanism** (`RestoreUndo`): one
snapshot before apply, the same banner, the same one-slot semantics — an
undone import vanishes entirely. Main reuses restore's pick/preview/apply
scaffolding (open-archive-held-between-preview-and-apply, token-bound apply,
passphrase handling for `NXA1`) with its own `imex:import-*` channels — the
flows share machinery but never a channel, so neither surface can trigger the
other's semantics (SEC-EL).

### 5. UI: a second card beside restore

Settings gains „Uvoz iz arhive" beside „Vraćanje iz arhive": pick, preview
(per-module counts, the merged-tags count, and the skip report — every named
drop visible before anything is written), „Uvezi", then the shared undo
banner. Copy makes the contract explicit: uvoz DODAJE u postojeći profil;
vraćanje ZAMENJUJE profil. Serbian strings in `strings.ts`.

### 6. Slices (sequential lanes, each gated)

- **043-a — core:** parser import mode + `planForeignImport` +
  `remapNoteState` + report shapes. Pure, TDD-heavy, no schema/IPC/UI.
- **043-b — db + main:** `ForeignImportStore`, orchestration, channels,
  blob path, undo wiring.
- **043-c — UI:** the Settings card + preview + apply + undo surfacing.

## Consequences

- Direct importers (Anki `.apkg`, ICS, CSV, markdown — STATUS §4) become
  translators into `ProfileData` that feed THIS planner; the merge semantics
  are decided once, here.
- An archive can be restored OR imported; the product must present them as
  different verbs, never as one button with a mode.
- Importing the same archive twice creates duplicates (minted ids are fresh
  each time) — deliberate: dedup-by-content is guessing. The preview's counts
  and the undo are the guard rails. Recorded.
