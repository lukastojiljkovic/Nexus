# ADR-049 — Task smart lists (TASK-003): Danas, Sledećih 7 dana, Hitno, Kasni, Završeno

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:** TASK-003 (M),
TASK-009's Danas clause, TASK-001's missing `startDate` input (folded in).
**Grounded in:** ADR-029 (which deferred smart lists as a view-layer feature),
ADR-037 (blocked is derived), ADR-039 (a surface that is a query), ADR-030/search
operators (the day-range vocabulary).

## 1. What they are

Five virtual lists — queries, never copies (the PRD's own words). No schema
change, no migration, no new IPC: the page already materializes every live task
of the profile on load, every comparable feature filters in the renderer
(dashboard Danas card, tag filter, calendar merge, search operators — whose
docblock records WHY post-SQL: SQLite cannot reduce an instant to a local
calendar day), and the views engine's `FilterSpec` docblock nominates TASK-003
as the moment richer predicates arrive. So: **pure predicates in
`@nexus/core/src/tasks/taskSmartLists.ts`** (beside `searchOperators.ts`),
taking `today` as a parameter, TDD, applied in the renderer.

## 2. The five, pinned

All exclude `deleted` (already absent from `listActive`) and undated tasks
belong to no date list. `isBlocked` is the existing renderer derivation.

- **Danas** — `!done && dueDate` is the local today **only** (disjoint from
  Kasni — one row appears in exactly one of them), excluding `startDate` in the
  future (TASK-001's input ships in this same slice, so the predicate never
  filters on data no user can enter), excluding blocked tasks **by default**
  (PRD §8), configurable (§4). Order: priority descending, then `createdAt`.
- **Sledećih 7 dana** — `!done`, due in `[today, today+6]` (the search
  operator's exact „nedelja" span — one meaning for one word), same
  startDate/blocked rules as Danas. Order: `dueDate` asc, then priority desc,
  then `createdAt`.
- **Hitno** — `!done && priority === "high"` — high only, so the list and the
  one accent-rendered priority chip agree on what "urgent" means (OQ#2 about
  4-vs-3 levels stays open; this definition survives either answer). Order:
  `dueDate` asc with undated last, then `createdAt`.
- **Kasni** — `!done && dueDate < today` (a stale recurring task sits here
  once, at its un-advanced due — ADR-024's in-place model needs nothing
  special). Order: `dueDate` asc (oldest first).
- **Završeno** — `done`, ordered `completedAt` desc (CHECK-guaranteed non-null
  exactly when done; the field joins `TASK_SCHEMA`). **Bounded honestly** per
  the ADR-039 recipe: first 100 with a quiet "prikazano prvih N" line and
  „Prikaži još" in chunks of 50. **No auto-archive** — OQ#3 stays open; the
  revisit trigger is a profile whose done count regularly exceeds the cap.
  PRD §5's separate "completed-task retention in ordinary views" setting is
  out of scope, recorded.

## 3. The rail

A second fixed section **„Pregledi"**, its own `tasks__rail-heading`, ABOVE
„Liste" (the PRD's Inbox-first ordering is deviated from knowingly — Inbox
lives inside the Liste tree and tearing it out is not worth the churn;
recorded). Rows are typographically like list rows but carry **no ✎/+/⋯/×
cluster and are NOT drop targets** (a query has no `listId` to write; the
house rule draws no dead affordance — handlers simply absent). **Counts as
muted text, on Danas and Kasni only** (the two actionable ones; no filled
pills — the badge aesthetic is the banned chrome). Selection is a
discriminated union beside list selection; nothing about it persists (matches
today's non-persisted list selection).

## 4. Inside a smart list

- **Forced `list` view**; no view toggle (nothing to remember it on), no
  sections, no „Nova sekcija", **no drag-reorder** (order is derived), and
  **no quick-add / create form** — the invitation to type would file into the
  Inbox while the user is looking at „Danas", which is a lie of place. Editing,
  checkbox completion, the ⋯ menu, and the edit form all work as anywhere.
- **Izbor (batch) works**: Premesti offers every list (the single-list
  assumption in `moveTargets` is re-derived over the visible rows), bulk
  rok/prioritet/obriši unchanged; the subtask-tear guard keeps operating on
  picked ids.
- **A quiet list-name chip** joins each row's chip cluster only when rendered
  inside a smart list — cross-list rows need their place named. Data variant,
  tokens only.
- **Per-list empty states** with their own Serbian descriptions („Nema
  zadataka za danas." etc.) — never the generic "write your first task"
  invitation.

## 5. Overdue made visible (globally)

Kasni's presentation cannot live only inside Kasni: the shared `taskChips`
cluster exists so a list row and a kanban card say the same things. The due
chip switches to the **danger variant when overdue and not done** — the
documents module's expired-status precedent, tokens only. This is the app's
first overdue affordance; recorded.

## 6. Blocked-in-Danas toggle + startDate input

- localStorage device preference (`weekStart.ts` idiom, key
  `nexus.tasks.blockedInToday`, default false = excluded), surfaced in
  Settings among device preferences and wired into settings search. PRD §5
  names it ("blocked-task visibility"). No migration, no IPC.
- The task form gains **„Počinje"** (start date) beside the due field —
  TASK-001's stored-but-uninputtable column closed. Validation mirrors the due
  field; no other surface changes required (a future-start task simply stays
  out of Danas/7-dana until its day).

## 7. Keyboard and search

No new global chord (ADR-040's set stays five). The five smart lists become
**palette commands** (`searchCommands.ts`) — the precedent-backed keyboard
route. Relationship to SearchPage, stated so the two never drift: search is a
jump surface; a smart list is a task **working surface** (checkboxes, Izbor,
edit form). Both must keep meaning the same thing by „danas"/„nedelja" — the
core module reuses `shiftDayKey` and the search span constant's semantics.

## 8. Non-goals, recorded

No persistence of smart-list selection; no per-smart-list view memory; no
drops; no counts on Hitno/7-dana/Završeno; no auto-archive (OQ#3 open); no
"retention in ordinary views" setting; OQ#2 (priority levels) untouched.
