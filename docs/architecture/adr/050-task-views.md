# ADR-050 — The views-engine iteration (TASK-005): configurable kanban, cards, calendar, persisted view config

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:** TASK-005 (M),
PRD 03 §5's "kanban column config per list" (as groupBy choice), the deferred
views-engine a11y items, and two schema corrections (ADR-049's `completedAt`
claim; `startDate`). **Unblocks:** NOTE-002's per-folder cards view (recorded,
not built here).

## 1. Grouping (kanban)

Three groupings ship: **status** (todo→doing→done, as authored), **priority**
(**high→medium→low→none** — a board reads urgent-left; the authored ascending
order stays the chips'/store's), and **section** (options built per render from
the selected list's sections — `SelectFieldDef.options` is a plain array, so no
engine change; the null bucket is the LIST BODY, titled „Telo liste", and is
**always shown** — the ungrouped-hidden-when-empty rule stays for status/priority
where null is impossible, and the component gains a flag for it). Dropping on a
section column dispatches the PLACEMENT write (`moveTaskToSection`), not a field
patch — the page's `onMove` grows a switch on the patch key; the engine stays
honest. **listId** does not ship (no cross-list scope exists — smart lists are
forced to list view). **tags** are REFUSED against PRD §3's mention, recorded: an
N:N link cannot be one-item-one-group.

"Kanban column config per list" is read as **choosing the groupBy per list**
(stored, §4). Column reordering/hiding is deliberately not v1; recorded.

## 2. Cards view

Ships. A responsive `repeat(auto-fill, minmax(240px, 1fr))` grid — a NEW
`nx-cards-view` block in `@nexus/ui` beside ListView/KanbanView, stateless,
`renderItem`-delegated, running the same `applyFilters`+`applySort` pipeline. A
card's face: the checkbox (a task's primary action belongs on every rendering of
it — kanban's bare card is a kanban decision, not a precedent), the title, and
**`taskChips` verbatim** — the "one cluster, all renderings" contract extends to
three. No description excerpt (shown nowhere today; not invented here).
`CardsViewConfig { type: "cards"; sort?; filters? }` joins the union.

## 3. Calendar view

Ships, complete but minimal — a NEW thin task month grid over the pure core
pieces (`monthGridDays` + `layoutMonthBars`; `CalendarMonth.tsx` is CAL-domain
and is not touched): month navigation (‹ › + „Danas"), week start from the
device preference, one bar per task — a span `startDate→dueDate` when both
exist, else a single day on `dueDate`; **undated tasks are listed under the
grid** in a quiet „Bez roka" strip (a calendar that silently hides them would
lie about the list). Day cells are drop targets writing `dueDate := day` (the
write CAL already performs); clicking a bar opens the edit form. Lane overflow
shows „+N" with no day drill-in (recorded). Done tasks stay visible and muted —
CAL's own recorded rule. `CalendarViewConfig { type: "calendar"; filters? }`
joins the union (no sort — the calendar's order is the calendar's).

## 4. Persistence — migration 038, interchange 1.16.0

One migration: `task_lists.default_view`'s CHECK widens to
`('list','kanban','cards','calendar')`, and the table gains **`view_config TEXT`
(nullable JSON)** — one blob per list, keyed by view name:
`{ list?: {sort?, filters?}, kanban?: {groupBy?, sort?, filters?}, cards?:
{sort?, filters?}, calendar?: {filters?} }`. Validation on BOTH sides (the 036
posture): the store validates shape on write and normalizes on read (unknown
keys dropped, unknown fields dropped — a config can only make the page fall back
to defaults, never break it); the archive parser checks parseable JSON plus the
same shape. SQLite cannot widen a CHECK, so the table rebuilds by the
019/021/037 sequence — enumerate `task_lists`' dependents first (FKs from tasks
and task_sections reference it: the rebuild must use the rename dance with
`PRAGMA legacy_alter_table` semantics verified, or rebuild children-safe the way
037 argued — MAP THIS before writing; migration tests must prove FK integrity
survives). Interchange **1.15.0 → 1.16.0**: the task-list record gains optional
`viewConfig` (optional-with-default → NO era flag), both apply stores carry it,
too-new fixtures → 1.17.0.

## 5. Sort vs manual order

The absent list sort stays load-bearing. The list (and cards) view gains a sort
select whose FIRST option is **„Ručni redosled"** (= no sort spec = the store's
order); while any real sort is active, **drag-reorder is disabled and its grips
are not drawn** (the no-dead-affordance rule), and the drop gaps disappear with
them. Kanban intra-column ordering stays the engine's (the `moveBetweenGroups`
`item` seam remains reserved; recorded).

## 6. Filters v1

Equality-only, expressed as closed selects above the view: status (Svi + the
three), priority (Svi + the four). The EXISTING tag filter stays outside the
engine (tags are N:N — recorded as the second mechanism, by design). No
date-range shapes (PRD §5's "completed-task retention in views" stays open).
Filters and sort persist per list per view via §4. Smart lists keep forced list
view with NO stored config (ADR-049's non-goal stands for all four views).

## 7. Schema corrections + a11y

`TASK_SCHEMA` gains `startDate` (date) and `completedAt` (date) — closing
ADR-049's unfulfilled claim and making both sortable/filterable. Kanban cards
gain the keyboard move-to-column ⋯ menu (the MoveMenu recipe — disabled at
ends, never dropped), landing the deferred KanbanView a11y note; ListView's row
activation pass stays deferred, recorded (rows are reachable via their inner
controls today).

## 8. Non-goals, recorded

Column reorder/hide per list; tag grouping; kanban card ordering; date-range
filters; a NOTE-002 cards adoption (next); timeline/Gantt (PRD §10); day
drill-in on the task calendar.
