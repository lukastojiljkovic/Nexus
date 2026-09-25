# ADR-020 — Calendar grid views (month / week / day)

**Status:** accepted · 2026-07-26.
**Drives:** CAL-002 (month/week/day/agenda views, drag to move, keyboard
navigation) and CAL-003 (overlay of events, dated tasks, exams and study blocks,
each toggleable) from PRD 04. Extends the views engine
([ADR-006](006-code-sharing.md)'s shared layer) with the calendar layout it does
not have yet. Does not touch storage: no migration, no new IPC channel.

## Context

The CAL module today has a working data layer (`events`, with `startAt`, `endAt`,
`allDay`, `location`), a **day-grouped agenda list**, and the Dokumenta panel.
What it does not have is a calendar — the grid that the word "calendar" means to
a user. The agenda answers "what is next"; it cannot answer "how does August
look", which is the question a student with exams in mid-August actually asks.

Three facts about the existing code shape this:

- **The agenda already merges three sources** (events, exams, study blocks) by
  hand inside `CalendarPage.tsx`. A second view must not fork that logic.
- **Timed values are local wall-clock strings** (`YYYY-MM-DDTHH:MM`, no zone),
  all-day values are bare `YYYY-MM-DD`. So a day bucket is `slice(0, 10)` — no
  timezone arithmetic anywhere, and none is introduced here.
- **`endAt` exists in the store and in the IPC types but no UI writes it.** A
  week grid without durations is not a week grid, so this work finishes the
  event form as well.

## Decision

### The layout logic is pure and lives in `@nexus/core`

A new `packages/core/src/calendar/` owns everything a test can check without a
DOM: which days a month grid contains, which days an item covers, which lane a
multi-day bar gets, and which column an overlapping timed item gets. It is
**generic over plain span records** (`{ id, startKey, endKey, … }`), not over
`Event`/`Task`/`Exam` — the domain merge stays in the page, exactly where the
agenda's already is, so core never learns what an exam is.

- `monthGridDays(monthKey, firstDayOfWeek)` — always whole weeks (5 or 6 rows),
  each day flagged `inMonth` so the leading/trailing days render quietly.
- `weekDayKeys(dayKey, firstDayOfWeek)` — the 7 keys of that day's week.
- `daySpanKeys(startKey, endKey)` — the inclusive days an item covers.
- `layoutMonthBars(items, weekKeys)` — per week row, lane assignment for
  multi-day/all-day items: `{ id, dayIndex, span, lane }`.
- `layoutTimedColumns(items)` — side-by-side columns for overlapping timed
  items within one day: `{ id, column, columns }`.

**First day of week is Monday**, passed as a parameter rather than assumed, so
PRD 04 §5's setting is a call-site change when SET grows it — not a rewrite.

### Multi-day items are continuous bars, not repeated chips

A three-day trip renders as **one bar spanning three cells**, lane-assigned per
week row and re-entering on the next row, the way every calendar a user has ever
seen behaves. Repeating an identical chip in each covered day is materially less
work and looks like a prototype; the lane algorithm is ~40 lines of pure code
with tests, and it is the difference between a calendar that reads as designed
and one that does not.

### Four sources, one merge, one set of toggles

Events, **dated tasks** (`dueDate` — new here, CAL-003), exams, and study blocks
merge into one item stream shared by *every* view including the agenda. Four
toggle chips (Događaji / Zadaci / Ispiti / Učenje) persist per profile in
`localStorage`, like the existing view toggle. A toggle means the same thing in
every view; that is why the agenda gains tasks in this work rather than later.

Editing rights follow the owning module, exactly as the agenda already does:
events are editable in place, tasks/exams/blocks are read-only rows here and are
edited in TASK/STUDY.

### Overflow expands the week row, it does not open a popover

A month cell shows what fits and then **"+N još"**, which expands **that whole
week row** until it is clicked again. PRD 04 §7 sketched a popover; a popover
would duplicate a day list inside a floating box with its own focus trap and
dismissal rules, and it would fight the geometry — multi-day bars are laid out
per week row, so a single cell cannot grow on its own without breaking the bars
that pass through it. Expanding the row is the honest unit of expansion, needs
no new component, and keeps the all-day band aligned across the week. (Once the
day view exists, clicking a cell's **date number** navigates to it — a second,
independent affordance, not a replacement.)

### Drag moves a day, not a time

In the month grid, dragging an event to another day shifts `startAt` (and
`endAt` by the same number of days, so duration is preserved); dragging a task
sets its `dueDate` — PRD 04 §8's acceptance criterion. Native HTML5 drag,
following `KanbanView`'s existing idiom (identity through a ref, a `text/plain`
payload only because Firefox needs one, drop targets marked by a token border +
soft background, never a glow). Exams and study blocks are not draggable: they
are derived from STUDY's own scheduling and moving one here would be a lie.

**Dragging inside the time grid (move by minutes, resize by edge) is not in this
work** — it needs a pointer-drag model with snapping and live preview that has
nothing in common with the day-granular HTML5 drag above, and the month grid
carries the acceptance criterion. Recorded in STATUS §4.

### Slices

- **020-a — core calendar engine.** The five pure functions above plus their
  TDD tests. No UI.
- **020-b — the month view.** Grid, navigation (‹ › Danas, ←/→/T keys), the
  four-source merge + toggles, spanning bars, overflow → day, click a day to
  create, click an item to edit, drag to move. The agenda gains tasks and obeys
  the toggles.
- **020-c — the week and day views.** One time grid parameterized by day count
  (7 or 1): an all-day band on top, hour rows below scrolled to the working day,
  timed items positioned by start/end with `layoutTimedColumns`, plus the
  **`endAt` field in the event form** that makes durations real.

## Alternatives rejected

- **A calendar member of `ViewConfig` in the views engine.** The engine's job is
  filter/sort/group over a `CollectionSchema` of one collection; the calendar is
  four heterogeneous sources with no shared schema, and its hard part is
  geometry, not querying. Forcing it into `ViewConfig` would mean inventing a
  schema for exams and study blocks that nothing else wants. The pure layout
  functions live beside the engine and are used directly.
- **A calendar library (FullCalendar, react-big-calendar).** Both would fight
  the token system on every surface, add a dependency an offline-first product
  carries forever, and hand us their interaction model instead of ours. The
  layout maths they encapsulate is the two functions above.
- **Rendering the month grid from the agenda's existing per-day grouping.** It
  buckets by day but knows nothing about spans, lanes, or empty days; a month
  needs the empty cells and the multi-day geometry that grouping deliberately
  throws away.

## Deliberately not in this work

- **Recurrence (CAL-001, CAL-007 birthdays).** There is no recurrence rule in
  the `events` table; it shares TASK-006's unbuilt rule engine, and inventing a
  calendar-only one would be the wrong place to put it.
- **The business/personal overlay (CAL-005).** No business-profile creation UI
  exists, so there is nothing to overlay yet.
- **FIN subscription renewals in the overlay (CAL-003).** The FIN module does not
  exist; the merge is written so a fifth source is one more branch.
- **Time-grid drag/resize** — see above.
- **Week numbers and the semester view (CAL-010, priority C).**
