# ADR-023 — Restoring a Nexus archive

**Status:** accepted · 2026-07-28
**Drives:** IMEX slice 3 (import/restore) — the slice ADR-022 called "slice d".
Extends ADR-009 (container, versioning, "validate before any write") and
ADR-022 (what an archive contains, the `NXA1` encrypted container).
**Supersedes nothing.**

## Context

The export half is finished: an archive now reproduces a profile completely
(ADR-022) and is sealed under a passphrase. Nothing can read one back. Until
that exists the feature is a backup nobody can restore, which is the same class
of broken guarantee ADR-022 was written to repair — a promise the UI makes and
the code does not keep.

Two distinct operations hide under the word "import" in PRD 14, and conflating
them is the main risk in this slice:

- **Restore** — take *our own* archive and reproduce the account it came from.
  PRD 14 §8's first acceptance criterion ("full export → fresh install →
  round-trip reproduces the account") and SET-011's backup/restore are this.
- **Foreign import** — take somebody else's data (Anki, ICS, CSV, an LLM's
  interchange JSON) and merge it into an account that already has data.
  IMEX-005/007/008 and PRD 14 §7's "always new internal IDs" are this.

This ADR decides **restore only**. Foreign import keeps its own requirements,
its own dedup rules, and its own slice; it is listed in `STATUS.md` §4 and is
not started here.

## Decision

### 1. Restore replaces a profile; it does not merge

The restored profile ends up exactly as the archive describes: every row the
archive carries is written, and every row of that profile which the archive
does not carry is gone.

This is not a preference between two workable designs — merge is excluded by
what an archive is:

- **Ids must be preserved.** A note's Yjs document embeds other rows' ids
  inside its own content: `noteLink` nodes carry a target note id (ADR-013),
  `attachmentImage` nodes carry an attachment id (ADR-014), and a flashcard
  block carries an opaque `cardKey` that reconciles against `(profile, note,
  block)` (ADR-017). Minting new ids on the way in would mean rewriting ids
  *inside CRDT documents* — a lossy, merge-hostile rewrite of user content.
  So the archive's ids are written verbatim.
- **With ids preserved, "merge" only ever means upsert**, and an upsert cannot
  express the operation a backup exists for. The reason to restore last week's
  archive is usually that this week is wrong; a merge would faithfully preserve
  exactly the mess the user is trying to undo.

Consequence to accept and say plainly in the UI: **restore is destructive**,
and its safety comes from the preview and the undo below, not from being
non-destructive.

### 2. It restores into the *active* profile, retargeting profile ids

An archive names the profile it came from (`manifest.profile`), but a fresh
install has a different profile id — that is the round-trip PRD 14 §8 asks
for. So every restored row's `profile_id` is set to the **currently active
profile**, not the archive's. Unlike row ids, a profile id is never embedded in
document content, so this rewrite is mechanical and total.

The profile's **name**, feature flags and notification settings are restored
too (they are in the archive by founder decision #11, and "reproduces the
account" includes them). The preview names the profile being overwritten and
the name it will take, so nothing changes silently.

**Row ids are global, and that bounds where an archive can land** (found while
writing the restore's tests, which is exactly what tests are for). Every row id
is a primary key over the whole table, not scoped by profile. Since §1 preserves
ids rather than re-minting them, an archive can only be written somewhere that
does not already hold those ids under a *different* profile. Two places qualify,
and they are the only two the product offers:

- **the profile the archive came from** — the ordinary case, "restore last
  week's backup over this week's mess". It works because the wipe runs first,
  inside the same transaction, so every id is free again before it is rewritten;
- **a fresh install** — PRD 14 §8's round-trip criterion, where nothing holds
  those ids yet.

Restoring an archive *beside* its own source profile in the same database is the
remaining case, and it fails: the first colliding insert aborts the transaction
and both profiles are left exactly as they were. That is the correct outcome —
the alternative is re-minting ids, which §1 rules out — and it is a tested,
specified behaviour rather than a surprise. It is also unreachable today, since
there is no way to create a second profile.

Multi-profile selection is deliberately absent: there is no business-profile
creation UI yet (see AUTH-024 in `STATUS.md` §4), so "the active profile" is
the only target that exists. When profiles become real, the target becomes a
choice in the preview — and the constraint above becomes a real one the preview
must state, since "restore this archive into my *other* profile" is precisely
what it forbids.

### 3. Validate everything, then write, or write nothing

SEC-EXT-02: an archive is untrusted input even when we wrote it. The whole file
is parsed and validated before a single row is written, and **any invalid row
refuses the entire restore** with a precise, human-readable report.

Skipping bad rows is right for foreign import (salvage what you can from an
LLM's output) and wrong for restore: a backup that silently restores 94% of
itself is worse than one that refuses, because the user believes they are whole.
This is the same failure mode as slice 1's silent note omission, and it gets
the same answer.

The boundary checks, in the order a hostile file meets them:

| Check | Rule |
| --- | --- |
| Container | `NXA1` magic → decrypt (ADR-022's reader); otherwise a zip. Nothing is written to disk in the clear at any point. |
| Zip shape | Entry count, per-entry uncompressed size, and total uncompressed size are capped (zip bomb, SEC-FILE). Entry names are matched against the layout ADR-022 fixes; anything else is ignored, never opened. Names are never used as filesystem paths. |
| `schemaVersion` | Refused when **newer than ours in major or minor**. Older majors within N-2 get migration functions when they exist; today `1.0.0` is the only released version, so the rule reduces to "major 1, minor ≤ 0". |
| Checksums | The manifest's sha256 per `data/*.ndjson` must match. A mismatch is corruption and refuses. |
| Rows | Every field of every record is validated against the interchange contract — types, enums, ISO-8601 shapes, id references. An unknown `type` is an **error** (see below); a known type with a bad field is an error. |
| Yjs state | Every `.ydoc` is applied to a fresh `Y.Doc` before the restore begins. A blob that does not parse is an error, not a note that silently arrives empty. |
| Blobs | `blobs/<name>` must be 64 lowercase hex characters, and the bytes must hash to that name. An attachment row whose blob is absent from the archive is a **warning**, shown in the preview and counted — the row is restored and the file is missing, which is what the export already does in the other direction (`missingAttachments`). |

**Why an unknown record type is an error** (corrected during implementation; the
first draft of this ADR called it a warning). "Ignore what you do not
recognise" is the right rule for additive schema evolution, and it is what
ADR-009's N-2 promise seems to invite — but it is **unreachable here**. The
version rule above already refuses any archive newer than this build in major
or minor, and an *older* archive can only ever carry *fewer* record types than
this build knows. So a type we do not recognise is never a newer Nexus; it is a
damaged or hand-edited file, and skipping the line would quietly drop real rows
from a backup. The two rules were in tension, and the version rule is the one
worth keeping: for a backup, refusing to restore a file we cannot fully read
beats restoring most of it.

The only surviving warning is therefore a missing blob — the one case where
what is lost is visible to the user (an image that will not render) rather than
silent.

### 4. The preview is a dry run of the real parse

The preview is not an estimate. It is the full parse and validation, with the
result held in main so that confirming does not re-read or re-validate anything
— the bytes the user approved are the bytes that get written. It shows, per
module, **what is there now and what it will become**, plus every warning, plus
the profile being overwritten. Confirming is the only thing that writes.

### 5. Undo is the pre-restore snapshot, applied through the same path

Before applying, main gathers the profile's current state using **the exact
function the exporter gathers with**, and keeps it in memory. Undo applies that
snapshot through the identical replace path.

This is why `gatherProfileData` is extracted out of `handleExport` rather than
duplicated: the undo snapshot and the export archive are then provably the same
shape, and any module a future slice forgets to gather is a module both of them
lose — one bug, one place, one type error.

Boundaries, stated rather than hidden:

- Undo lives in main-process memory and lasts until the app quits or locks.
  "One-click undo immediately after" (IMEX-006) is exactly that window; a
  durable multi-step history is not what the requirement asks for and would
  need its own storage design.
- Attachment **blobs** are content-addressed and shared. A restore only ever
  *adds* blobs. Undo removes precisely those the restore created, and only
  through `deleteBlobIfOrphaned` with a live reference count read from the
  database — so a blob that anything still references survives the check
  regardless of who wrote it.

### 6. Derived data is rebuilt, never restored

ADR-022 excluded derived tables from the archive; the restore rebuilds them:

- `search_entries`/`search_fts` — rebuilt **for free**. Migration 017 maintains
  the index entirely through SQL triggers, so rows inserted by the restore are
  indexed by the same triggers that index rows inserted by the app. This is the
  design paying for itself: there is no "remember to reindex after restore"
  step to forget.
- `note_links` — *not* free. They are extracted from note content by the
  renderer at flush time (ADR-013), and a restore writes documents without a
  renderer. So the restore re-derives each note's outbound links from its
  restored Yjs state through a new pure extractor in `@nexus/core`, and writes
  them with `setOutboundLinks` — the same store method the live path uses.
- `note_updates` — the op log is not exported; the merged snapshot is. A
  restored note's snapshot takes `covered_seq = max(coveredSeq of its restored
  versions, 0)`, so the next `appendUpdate` cannot mint a `seq` that collides
  with a version checkpoint's key.

### 7. Everything on screen is stale afterwards

A restore replaces the data under a running UI: open notes hold live `Y.Doc`s,
lists hold rows that no longer exist, and a focus timer may be counting against
a subject that is gone. Rather than invent a per-view invalidation protocol for
a once-in-a-blue-moon operation, a completed restore (and a completed undo)
**reloads the renderer**. The main process keeps the unlocked data key, so the
reload comes back unlocked rather than dropping the user at the lock screen. A
running focus session is stopped first, because its row is about to be replaced.

### 8. Where the code lives

ADR-009 named a `packages/interchange` package. It does not exist and is not
created here: the export builder and the archive container already live in
`packages/core/src/imex`, and the reader is the same contract read backwards —
splitting one contract across two packages would let the halves drift, which is
precisely the failure this module keeps having. `packages/interchange` in
ADR-009 should be read as "the interchange layer", which is `core/imex`.

## Consequences

- The interchange row shapes gain a second, stricter consumer. Until now they
  were only ever *written*; a field the exporter emits and the parser does not
  accept is now a test failure, which makes ADR-009's "public contract" claim
  enforceable rather than aspirational.

  It paid for itself immediately. `ExportCard` did not declare a card's
  `sourceNoteId`/`sourceBlockKey` (NOTE-006/ADR-017). Nothing ever complained,
  because the exporter spreads whole store rows (`{ type: "card", ...row }`) —
  so the two fields were *in* every archive on disk, and only the declared
  contract was missing them. Writing the reader is what asked the question
  "what does a restore do with this column?", and the answer was that it would
  restore every note-sourced card orphaned: the next time the user opened that
  note, `syncFromNote` would find no row for any block key and generate a
  second card per block, leaving the original's FSRS history on a row nothing
  points at. Fixed here, in the same slice, because a backup that quietly
  duplicates a user's flashcard deck is the §3 failure mode wearing different
  clothes. The pair is validated both-or-neither, and `sourceNoteId` is now a
  checked reference like every other foreign key.
- The strongest test available is a **round trip**: build an archive with
  `buildExportArchive`, parse it back, and assert the data is identical. That
  test is the acceptance criterion of PRD 14 §8 in executable form, and it is
  required for this slice.
- Reading an encrypted archive needs random access to a decrypted stream that
  is never fully in memory and never on disk in the clear. `NXA1` frames make
  this cheap: plaintext frames are fixed-size except the last, so a plaintext
  offset divides directly into a frame index, and one pass over the frame
  prefixes builds the offset table.
- A restore's atomicity is SQLite's: one transaction over the delete and every
  insert. A failure mid-restore leaves the profile exactly as it was, with no
  undo snapshot needed for that case.
