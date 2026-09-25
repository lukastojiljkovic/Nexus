# ADR-031 — Task attachments (the ADR-014 model, applied to TASK)

**Status:** accepted · 2026-07-30
**Drives:** the "attachments" item of Finishing Tasks (PRD 03). Wave-1 Lane C.
**Builds on:** ADR-014 (note attachments — content-addressed blob store),
ADR-019 (encrypted blobs), ADR-023 (restore blob refcounting).
**Supersedes nothing.**

## Decision

Task attachments are **the note-attachment feature mirrored piece for piece**,
for migration-023's reason: it is the same feature on a different entity, and a
second design would only ask the reader to hold two shapes in mind.

1. **Migration 024** — `task_attachments` mirrors `note_attachments` verbatim
   (`task_id` referencing `tasks` instead of `note_id`; same columns,
   constraints, indexes). Rows survive the task's soft delete (undo brings the
   task back with its files); hard delete cascades.
2. **`TaskAttachmentStore`** mirrors `NoteAttachmentStore`'s surface, idiom,
   validation and typed errors. TDD.
3. **One blob store.** `main/attachments.ts` (encrypted, content-addressed,
   `nx-blob:` protocol) is shared, not forked; every place that enumerates
   blob-referencing tables for refcounting/GC — including restore's
   refCount-gated GC — widens to the union with `task_attachments`, proven by
   a desktop test (a blob referenced only by a task attachment must survive).
4. **IPC** — `task-attachments:*` mirrors the note channels (dialogs and file
   IO in main only), plus one `task-attachments:counts` channel (per-task
   counts for the profile's live tasks, the `cardCounts` idiom) feeding the
   row/card count chips.
5. **Interchange 1.4.0 → 1.5.0** — `task-attachment` records in
   `data/tasks.ndjson`; parser twin; **no era flag** (record types are covered
   by the version gate); the export's `blobs/<sha256>` gather widens to the
   union with task attachments; `RestoreStore` wipes and writes the table
   (wipe-list guard forces it mechanically); restored blobs ride the same
   blobs-before-txn path.
6. **UI** — the task **edit** form gains a "Prilozi" section (an uncreated
   task has no id, the note editor's own constraint): attach via native open
   dialog, rows with image thumbnails over `nx-blob:`, open externally / save
   a copy / remove; list rows and kanban cards show a muted "N prilog/priloga"
   chip fed by the counts channel.

## Consequences

- Third consumer of the blob store (note attachments, restore, now tasks);
  the refcount union is now genuinely load-bearing — any future attachment
  table MUST join it, which the desktop GC test documents by example.
- Tasks' NDJSON grows a second record family; CSV mirrors deliberately do not
  carry attachments (same as notes — the blobs directory is the artifact).
