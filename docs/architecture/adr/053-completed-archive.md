# ADR-053 — Završeno ages into an archive (TASK, PRD 04 OQ)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:** the
founder's answer to batch question 9 ("Idu" — completed tasks DO age out of
Završeno into an archive). Resolves PRD 04's open question on completed-task
retention.

## 1. What "archive" is — a query boundary, not a state

Nothing moves, nothing is written, and there is no `archived` column. A
completed task's `completed_at` already says everything: the **Završeno smart
list shows completions from the last `TASK_ARCHIVE_AFTER_DAYS = 30` days**, and
everything older is *the archive*. One constant, chosen not sacred (the 21-day
maturity precedent), exported from `taskSmartLists.ts` where the boundary
lives.

Why not a real state: a column would need a sweeper (a clock deciding when to
flip it), a migration, an interchange bump, and an un-archive affordance — all
to record a fact `completed_at` already records. A lapse of the sweeper would
make the column lie; a pure day-key comparison cannot lie. Re-opening an
archived task (un-ticking it) already works today for free — `done` flips,
`completed_at` nulls, the task simply stops being in either bucket.

## 2. Core: one split, not a sixth list

`taskSmartLists.ts` gains a pure `splitZavrseno(tasks, context)` returning
`{ recent, archived }` over the existing `zavrseno` predicate — `recent` is
`completedAt`-day within `today − 30`, `archived` is the rest, both in the
list's existing order (newest completion first). `matchesSmartList("zavrseno")`
keeps meaning "completed at all" so nothing else (counts, search, Izbor)
changes meaning. No sixth `SmartListId`: the rail still shows one Završeno
entry; the split is presentation inside the view.

## 3. UI: the archive is beneath, collapsed, honest

The Završeno view renders `recent` exactly as today (first 100 + „Prikaži
još"). Beneath it, when `archived` is non-empty: a quiet disclosure row —
**„Arhiva (N)"** — collapsed by default, expanding to the archived tasks with
the same first-100 pagination. Typographic disclosure (the house pattern), no
new chrome. The empty-Završeno state mentions the archive only when the
archive alone is non-empty („Sve završeno starije od 30 dana je u arhivi.").
Izbor (batch selection) works inside the expanded archive exactly as anywhere
else — restore/delete need no special casing because nothing about the rows is
special.

## 4. Consequences

- Zero migration, zero interchange change, zero store change. Renderer +
  core-pure only.
- The 30-day window is not user-configurable in v1 — a setting would need a
  home and a sentence, and nobody has asked. Recorded here so it is a decision,
  not an accident.
- Search still finds archived tasks (they are ordinary done tasks); the smart
  list is the only surface that folds them away.
