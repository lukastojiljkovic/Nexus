# ADR-037 — Task dependencies

**Status:** accepted · 2026-07-30
**Drives:** the "dependencies (S)" item of the TASK remainder (PRD 03).
Wave-4 Lane I.

## Decision

1. **Model (migration 029):** `task_dependencies` (blocker_id, blocked_id) —
   PK the pair, both `REFERENCES tasks(id) ON DELETE CASCADE`, plus the
   reverse index. Profile scoping rides the tasks (the migration-023 shape).
   Self-dependency refused; **cycles refused in the store** by the recursive
   walk the folder/list parent checks use (following blocker edges from the
   candidate blocker back to the blocked task). Links survive soft delete
   (the tag-link rule) so undo restores them; reads filter through live
   tasks.
2. **"Blocked" is DERIVED, never a column:** a task is blocked while any of
   its blockers is live and not done. No status change, no store-side
   completion refusal — real life completes blocked tasks anyway, and a
   silent hard refusal would fight the single-completion path ADR-024 fixed.
   Completing a blocked task simply works; the UI says what it is doing
   (the chip is visible right there).
3. **Store:** `TaskDependencyStore` (migration-023's store shape):
   `listLinks()` (live-filtered), `addDependency(blockerId, blockedId)`
   (same-profile live tasks, self/cycle refusal, idempotent pair),
   `removeDependency`. TDD.
4. **IPC:** `task-dependencies:list/add/remove` — three channels, the
   task-tags surface one concept over.
5. **Interchange 1.7.0 → 1.8.0:** record type `task-dependency` in
   `data/tasks.ndjson` (pair-keyed duplicates refused like `task-tag-link`;
   both ends reference-checked; **the parser also refuses a cycle** across
   the archive's edges — the store's invariant needs its parser twin);
   no era flag (record type). `RestoreStore` wipe + raw INSERTs; guard test
   forces it.
6. **UI (TasksPage):** the edit form gains a "Zavisnosti" block (edit-only,
   like Prilozi): current blockers as removable rows; "Dodaj zavisnost"
   opens a NotePopover-family picker listing the profile's OPEN tasks
   (excluding self, its descendants-in-render sense is irrelevant — the
   cycle check is the store's), filtered by a TextField over folded title
   match, capped visually at ~8 rows. Rows and kanban cards show a muted
   outlined "Blokiran" chip while blocked (the tag-chip recipe; a
   state-adjacent label, but deliberately outlined like metadata — it
   describes the row's relations, not its status column). Completing a
   blocked task is not intercepted (see §2).

## Consequences

- No scheduler/NTF interaction in v1 — a blocked task's reminders still
  fire (its due date is its own promise); recorded as a possible refinement.
- The picker lists open tasks only; a done blocker is vacuous and a deleted
  one invisible — both by the same live-filter rule the reads use.
