# ADR-024 — Recurrence for tasks and events

**Status:** accepted · 2026-07-29
**Drives:** TASK-006 (recurring tasks) and CAL-001's recurrence clause; the
"this / this-and-future / all" edit rule PRD 04 §7 fixes. CAL-007 (birthdays)
consumes the same yearly rule later, in its own people-lite slice — it needs a
people store first, which is a data feature, not a recurrence feature.
**Supersedes nothing.**

## Context

Neither `tasks` nor `events` carries any recurrence rule today. TASK-006 asks
for common rules (daily, weekdays, weekly×n, monthly by date/ordinal, yearly,
custom interval) with **next-occurrence-on-completion** semantics and an end
condition (never/date/count); CAL-001 asks for the **same rule engine** on
events; PRD 04 §7 requires editing a recurring event to offer an explicit
this / this-and-future / all choice. A calendar-only or task-only engine would
be the wrong shape — the PRDs say so explicitly — so the rule model and the
occurrence math live once, in `@nexus/core`, and the two modules consume it
with deliberately *different* materialization strategies, because the two
surfaces genuinely differ.

## Decision

### 1. One rule model, one pure engine, in `packages/core`

```ts
type RecurrenceRule = {
  freq:
    | { kind: "daily"; interval: number }               // every n days
    | { kind: "weekdays" }                              // Mon–Fri, interval-free
    | { kind: "weekly"; interval: number; days: Weekday[] }  // weekly×n on chosen days
    | { kind: "monthly-date"; interval: number; day: number }     // 1..31
    | { kind: "monthly-ordinal"; interval: number; ordinal: 1 | 2 | 3 | 4 | -1; weekday: Weekday }
    | { kind: "yearly"; interval: number };
  end:
    | { kind: "never" }
    | { kind: "until"; date: string }                   // inclusive bare date
    | { kind: "count"; total: number };                 // total occurrences incl. the first
};
```

Pure functions, TDD, no Date-object timezone traps — all math on **bare dates**
(`YYYY-MM-DD`) in plain calendar arithmetic:

- `nextOccurrenceDate(rule, anchor, after)` — the first occurrence strictly
  after `after`, anchored at `anchor` (the series' first date; `interval`
  phases are measured from it). `null` when the end condition is exhausted.
- `occurrenceDatesInRange(rule, anchor, range, exdates)` — every occurrence
  date in a closed range, minus exceptions, with a hard cap (guards a hostile
  or degenerate rule; mirrors the caps discipline everywhere else).
- `validateRecurrenceRule(value: unknown)` — the parser twin every boundary
  (IPC, store, import) reuses; a rule is stored as **canonical JSON in one
  TEXT column**, and only this function ever admits one.

`monthly-date` with `day` 29–31 **skips** months that lack the day (RFC 5545 /
Google semantics — an event "on the 31st" happens only in months that have a
31st). "Last X of the month" is what `monthly-ordinal` with `-1` is for.
Events are timed, but their recurrence advances by *calendar* days: an
occurrence keeps the master's time-of-day and duration, computed by shifting
the stored UTC instant by whole days (consistent with ADR-020's all-UTC grid
math). DST-shifting local wall clocks are exactly the trap bare-date math
avoids; a "keep local time across DST" refinement would need real timezone
data and is deliberately not v1.

### 2. Tasks advance in place (the Todoist model), never spawn rows

Completing a task whose `recurrence` is set does **not** complete it: it
*advances* it — `dueDate` moves to the next occurrence, `count` ends tick
down, and every **subtask is reset to open** (PRD 03 §7: recurrence copies
structure, never completion state). The row's identity, subtasks, description
and priority all persist because the row itself persists. Only when the end
condition is exhausted does completion complete the task for real
(`status = done`, `completedAt` set).

Rejected alternative — spawning a new row per occurrence — creates two
problems for nothing: un-completing must then *retract* the spawned row (or
toggling done piles up duplicates), and every subtask/dependency must be
deep-copied per occurrence. Advancing in place makes undo trivial (put the
old `dueDate`/counter back) and keeps history semantics unchanged. The cost,
stated honestly: individual past occurrences do not appear in Završeno —
matching Todoist, and nothing in PRD 03 requires per-occurrence rows.

A task with no `dueDate` cannot have a rule (there is nothing to advance);
the store enforces it both ways.

### 3. Events expand virtually; exceptions are exdates plus detached copies

A recurring event stays **one row** — the series master. The calendar's
merge layer expands it into occurrences for the visible range with
`occurrenceDatesInRange` (the pure layout engine already consumes span
records; occurrences are just more of them, each tagged with its source
event id and occurrence date). Nothing is ever materialized into `events`
for plain display.

PRD 04 §7's three-way edit choice maps onto exactly two primitives:

- **all** — edit the master row.
- **this** — add the occurrence date to the master's `recurrence_exdates`
  (a JSON array of bare dates in one TEXT column) and, for an edit (as
  opposed to a delete), create an ordinary standalone event with the changed
  fields. The copy is *detached* on purpose: it is a real event the user now
  owns, and deleting the series later must not silently take an
  independently-edited day with it.
- **this-and-future** — split the series: the master's `end` becomes
  `until` (the day before the chosen occurrence), and a new master starts at
  the occurrence carrying the same rule and the edited fields. Deleting
  this-and-future is the same split without the new master.

### 4. Storage: two columns on each table, validated in the store

Migration 018 adds `recurrence TEXT` (canonical rule JSON, nullable) to
`tasks` and `events`, plus `recurrence_exdates TEXT` to `events` only (tasks
advance in place and need no exceptions). No SQL CHECK can validate JSON
deeply, so the stores are the gate: every write runs
`validateRecurrenceRule`, and the IMEX parser (ADR-023's stricter consumer)
gains the same twin so an archive with a corrupt rule refuses instead of
writing it. The interchange row shapes (`ExportTask`/`ExportEvent`) carry the
new fields as required members — the ADR-022 lesson: a forgotten module is a
type error, not a silent omission.

### 5. UI: a preset-first picker, and the explicit three-way dialog

Both forms get the same Serbian "Ponavljanje" control: a select of the common
cases (Ne ponavlja se / Svakog dana / Radnim danima / Svake nedelje /
Svakog meseca / Svake godine / Prilagođeno…), where Prilagođeno opens
interval + weekday/ordinal detail plus the end condition. Editing or deleting
an occurrence of a recurring event asks the PRD's explicit question (Samo
ovaj / Ovaj i buduće / Sve) — a dialog, never a silent default. Completing a
recurring task shows the standard toast with the next date ("Sledeći put:
{datum}") and undo puts the previous date back.

## Consequences

- The engine is the third pure-core consumer of the bare-date discipline
  (after the plan engine and the calendar grids); its tests are plain
  date-in/date-out tables, no clocks mocked.
- `syncFromNote`, FSRS, notifications and search are untouched: recurrence
  changes *when* a task is due and *how many* event spans the calendar draws,
  never what an entity is.
- Restore (ADR-023) keeps its guarantee mechanically: the new columns ride
  the interchange as required fields, `RestoreStore` writes them verbatim,
  and the wipe-list guard test already fails on any new table.
- CAL-007 birthdays become "a people-lite row rendered through the same
  yearly rule" — no second recurrence path.
