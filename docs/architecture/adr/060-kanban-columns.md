# ADR-060 — Kanban column configuration (TASK-005's last clause; interchange gate inside)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:**
the one unshipped clause of TASK-005 (M): kanban's "configurable … columns".
Grouping (status/priority/section), drag-between-columns, cards and the task
calendar shipped with ADR-050; what remains is per-list control over WHICH
columns show and in WHAT order.

## 1. Model: two optional fields on the existing `view_config`

`task_lists.view_config` (ADR-050: strict-write, lenient-read, empty → SQL
NULL) gains two OPTIONAL members:

- `hiddenColumns: string[]` — column KEYS the board does not draw. A key is
  the grouping's own vocabulary: a status value, a priority value, or a
  section id (sections: the id, so a rename does not unhide). Hiding is a
  VIEW fact — rows in hidden columns still exist, still count in the rail,
  still surface in list view; the board simply does not draw that column,
  and a „Skrivene kolone: N" chip in the board header says so (never a
  silent loss).
- `columnOrder: string[]` — the drawn columns' order, same key vocabulary.
  Keys absent from the list draw AFTER the ordered ones in their natural
  order (new statuses/sections appear, never vanish); unknown keys are
  dropped on read. Section-grouped boards keep section order as the natural
  base (the store's own ordering is already user-controlled there —
  `columnOrder` applies but the UI only offers reordering for status/
  priority groupings, where no other order control exists; recorded).

Both default absent ≡ today's board. Validation at the store boundary as
ADR-050 does it (closed vocabulary per grouping re-checked on write; a
hidden set that would hide EVERY column is refused — a board with no columns
is not a view).

## 2. UI

- Each column's ⋯ header menu (exists for move-to-column) gains „Sakrij
  kolonu".
- The board header gains a quiet „Kolone" popover: checkboxes per column
  (drawn = checked), ↑/↓ reorder rows for status/priority groupings — the
  ⋯-menu keyboard-parity discipline of ADR-045, no drag needed in v1.
- Drag-between-columns, „Telo liste", placement writes: untouched.

## 3. The interchange gate (decide by READING, not by assuming)

`view_config` travels inside task-list rows. **If the exporter carries the
stored JSON string VERBATIM and restore writes it back untouched**, an older
reader round-trips the new fields blind — nothing resets, and NO interchange
bump is needed. **If any path re-serializes from the PARSED form** (dropping
unknown keys), an older build would silently strip the user's column choices
— and repo posture (the 1.19.0 snooze precedent) then requires a MINOR bump.
The implementing lane must read `exportArchive`/`importArchive`/restore and
state which case holds; if a bump is needed, it is pre-assigned **1.24.0**
(fixtures → 1.25.0) with the gap protocol against the in-flight 1.23.0 lane.

## 4. Consequences

- No migration. Core-pure changes in `taskViewConfig.ts` (+ tests, red
  first); board rendering in TasksPage; Serbian strings.
- Cards view and calendar view are untouched — columns are a kanban fact.
- A hidden column with rows keeps its rows reachable via list view and the
  count chip — pinned by test.
