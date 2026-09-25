# ADR-038 — Task batch operations

**Status:** accepted · 2026-07-30
**Drives:** the "batch operations (S)" item — the TASK module's last S.
Wave-5 Lane K. No schema change, no interchange change.

## Decision

1. **An explicit selection mode**, list view only: a toolbar "Izbor" toggle.
   While active, clicking a ROW toggles its selection (click-to-edit, drag and
   the done checkbox are suspended — a mode must not overload gestures that
   already mean something), selection renders as the house drop-target recipe
   (accent border + soft background, never a glow), Escape or the toggle
   exits and clears, and switching to kanban exits it (recorded — kanban
   cards are drag surfaces; a kanban selection mode is speculative).
2. **The action bar** (the undo-bar recipe) appears with ≥1 selected:
   "N izabrano" (dayUnit agreement) + Premesti… (list picker over the rail's
   lists; lands in the target's body), Prioritet…, Rok… (date input +
   "Ukloni rok"), Obriši. **No bulk complete, deliberately:** completion runs
   through per-task dialogs (recurrence advance, the open-descendants ask)
   that cannot be answered meaningfully once for N tasks.
3. **Store: bulk methods on `TaskStore`, each ONE transaction that iterates
   the store's own single-row primitives**, so every existing invariant holds
   per row and none is re-spelled: `bulkMoveToList(ids, listId, sectionId)`,
   `bulkSetPriority(ids, priority)`, `bulkSetDueDate(ids, dueDate | null)`,
   `bulkSoftDelete(ids)` — stamping ONE shared `deleted_at` (the ADR-029
   equal-stamp idiom) and returning it — and `bulkRestore(ids)` (per-row
   `restore` semantics, Inbox fallback included). **Atomic,
   refuse-on-any-error:** a batch that would clear the due date under a
   task's recurrence anchor or ladder refuses WHOLE, naming the offending
   id — half-applied bulk edits are the restore lesson over again. Caps:
   ≤ 500 ids, deduped, every id an active same-profile task. TDD.
4. **IPC:** five `tasks:bulk-*` channels; arrays validated element-wise;
   caps imported from the store.
5. **Undo:** bulk delete feeds the page's single-pending-undo bar with the
   exact id set; undo calls `bulkRestore`. A new bulk delete replaces the
   previous pending offer (the house single-undo rule).

## Consequences

- Deleting a parent in bulk leaves its children exactly as a single delete
  does (the orphan-render rule covers them); no cascade is added here.
- Smart-list/bulk-tag ideas stay out; recorded in STATUS if ever wanted.
