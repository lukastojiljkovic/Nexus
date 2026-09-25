# ADR-034 — Pointer drag & resize inside the calendar time grid

**Status:** accepted · 2026-07-30
**Drives:** ADR-020's deliberately-scoped-out item (STATUS §4): moving by
minutes and dragging an edge in the week/day views. Wave-2 Lane F.

## Decision

1. **Scope:** timed **events only**, in the week and day views. All-day bars
   keep the existing HTML5 day-granular drag; exams, study blocks, tasks and
   birthdays stay non-draggable (read-only mirrors or day-granular by nature).
2. **Model:** pointer events with capture. Pointerdown on an event body arms a
   **move** — it becomes a drag past a 4 px threshold, below which the
   existing click-to-edit fires unchanged. A 6 px bottom-edge handle arms a
   **resize**. While dragging, the event's own block renders at the candidate
   position/height (a ghost via transform — the overlap-column layout is NOT
   recomputed mid-drag); **Escape cancels**, pointerup commits.
3. **Snapping:** 15-minute grid. Move preserves duration (a null `endAt`
   moves as a point — only `startAt` shifts); in the week view the target day
   is the column under the pointer, so a move can cross days. Resize adjusts
   `endAt` only, minimum duration 15 minutes; resizing an event with no
   `endAt` sets one. Everything clamps inside the day.
4. **Pure math in core:** `packages/core/src/calendar/timeGridDrag.ts` — pixel
   offset ↔ minutes, snapping, clamping, min-duration and cross-day-column
   resolution as clock-free pure functions with exhaustive unit tests; the
   renderer only wires pointers to them.
5. **Recurrence:** committing a drag on an expanded occurrence opens the
   existing `RecurrenceScopeDialog` and rides the exact month-grid flow
   (`applyMoveScope` semantics, **create-before-except** ordering), widened to
   carry minutes rather than whole days. A master dragged under "Svi" keeps
   its rule; only the anchor time moves.
6. Commits go through the existing `updateEvent`/scope helpers,
   await-then-refetch, no new IPC.

## Consequences

- Keyboard-accessible rescheduling stays the edit form (recorded, not built).
- The now-line, click-hour-to-create and overlap layout are untouched except
  that a commit refetches and relays out.
