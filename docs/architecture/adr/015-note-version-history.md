# ADR-015 — NOTE Version History (CRDT checkpoints)

**Status:** accepted · 2026-07-18.
**Drives:** NOTE-008 (PRD 09: browse and restore prior versions; restore is
never destructive), building directly on ADR-012's substrate (update log +
single merged snapshot) and its anticipation that "version history will retain
periodic snapshots instead of compacting them away."

## Context

The substrate persists one Yjs update log per note plus a single merged
snapshot (`note_snapshots`) that exists purely as a load-time cache — each
compaction overwrites it. Version history needs the opposite lifecycle:
immutable point-in-time checkpoints that survive compaction and can be browsed
and restored.

Two Yjs facts shape the design:

1. **A full-state snapshot (`Y.encodeStateAsUpdate`) is self-contained** — it
   replays onto a fresh `Y.Doc` with no other rows needed. A checkpoint is
   therefore just "the merged snapshot blob at a moment", exactly what
   compaction already computes.
2. **Yjs state is monotone** — applying an *old* snapshot to a doc that
   already contains later edits is a no-op (its ops are already known).
   Restore therefore cannot be "load the old bytes back"; it must be a
   **forward edit** that rewrites the current document's content to match the
   old version. That is also exactly what the PRD demands ("restore creates a
   new version — never destructive").

## Decision

### Storage: a sibling `note_versions` table (migration 014), not a retention flag on `note_snapshots`

ADR-012 sketched "the single-snapshot table gains a retention policy"; the
cleaner realization is a sibling table, because the two lifecycles share
nothing: the cache row is mutable and hot on every load, versions are
immutable, append-only, pruned. `note_snapshots` and the entire live
read/write path stay byte-for-byte untouched.

```sql
CREATE TABLE note_versions (
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  covered_seq INTEGER NOT NULL,   -- highest update seq this checkpoint contains
  snapshot    BLOB NOT NULL,      -- full state, Y.encodeStateAsUpdate
  title       TEXT NOT NULL,      -- the note's title at capture time (list label)
  created_at  TEXT NOT NULL,
  PRIMARY KEY (note_id, covered_seq)
);
```

The PK doubles as the browse index (`ORDER BY covered_seq DESC`) and as the
dedupe guard: two captures of the same state (same `covered_seq`) collapse to
one row (`INSERT OR IGNORE`). Rows are scoped through their note
(`requireActive` first — the `note_updates` pattern), `ON DELETE CASCADE` for
a future hard purge.

### Capture policy (main-owned, like compaction)

- **On compaction** (`compactIfNeeded`, after `compact` succeeds): if the
  note's latest version is absent or older than `VERSION_MIN_AGE_MS`
  (**10 minutes**), insert the freshly merged snapshot as a version at
  `covered_seq = last.seq`. Long editing sessions thus checkpoint roughly
  every 10 minutes; an untouched note gains no rows.
- **Before every restore** (`notes:version-capture`, explicit): merge the
  current snapshot + pending updates and capture at the current max seq — no
  age gate (a user action, not a cadence), deduped by the PK. A note with no
  persisted state yet (`covered_seq` would be 0) is a no-op. This is the
  safety checkpoint: the pre-restore state is always browsable afterwards.
- **Retention:** `MAX_NOTE_VERSIONS = 50` per note; each capture prunes the
  lowest-`covered_seq` rows beyond the cap in the same transaction. With the
  10-minute gate that is 8+ hours of active-editing history plus every restore
  point; tiered age thinning (daily/weekly beyond the recent window) is a
  future refinement, deliberately not v1.
- **Trust:** `notes:version-capture` is renderer-triggered but writes only
  what main itself merges from stored state; spamming it churns at most the
  50-row window and requires real appends between calls — the same bounded
  harm class as `notes:append-update` itself.

The store gains mechanism only (`captureVersion` = INSERT OR IGNORE + prune,
`listVersions`, `loadVersion`, `latestVersion`); *when* to capture stays in
`main/notes.ts` next to the compaction policy. `NoteCompactionRead` gains a
`coveredSeq` field (additive) so main knows the seq to stamp when no updates
are pending.

### Restore: a renderer-side forward content rewrite

Browsing and restoring live where the document already lives (the renderer
owns the live `Y.Doc`; SEC-EL unchanged — versions cross the boundary as
opaque `Uint8Array` snapshots, ids validated in main, store re-scopes):

1. `notes:versions` lists `{ coveredSeq, title, createdAt }`, newest first.
2. `notes:version-load` returns one version's snapshot bytes; the renderer
   replays them onto a throwaway `Y.Doc` and renders a **read-only** editor
   preview (same extensions — wiki-links resolve live titles, attachment
   blocks resolve current attachments or the removed-placeholder, honestly).
3. Restore = `notes:version-capture` (safety checkpoint), then the pure
   `replaceNoteContent(liveDoc, versionSnapshot)` (`@nexus/core`): one
   `doc.transact` that deletes the live "default" fragment's children and
   inserts deep clones (`node.clone()`) of the version doc's children. The
   binding treats it as a remote change and rebuilds the view; the normal
   debounced flush persists it as a regular update, so title, wiki-link index,
   and everything else re-derive through the existing pipeline unchanged.

A rewrite is one transaction → one update; if a huge note's rewrite exceeds
`NOTE_UPDATE_MAX_BYTES` (256 KB) the existing flush path surfaces
`OversizeUpdateError` — never silent loss. Ctrl+Z does not undo a restore
(the transaction's origin is outside the collaboration binding's tracked
scope); reverting a restore is what the safety checkpoint in the version
browser is for.

### Slices

**008-a** (dark): `replaceNoteContent` + tests in `@nexus/core` · migration
014 + `NoteStore` version methods (TDD) in `@nexus/db` · capture policy +
`notes:versions` / `notes:version-load` / `notes:version-capture` + preload in
desktop main. **008-b**: the "Istorija verzija" UI — version list, read-only
preview, confirm-restore flow, Serbian strings, token-styled.

## Consequences

- Storage bound: ≤ 50 full snapshots per note — for typical notes tens of KB
  each; acceptable, and the pruning keeps it flat. No new dependencies.
- IMEX does not export notes yet at all; when it does, versions ride along or
  are deliberately excluded — decided there, no coupling now.
- SHARE/sync later: checkpoints are plain full-state updates, so any future
  device merge can still replay them; nothing here assumes single-device.
