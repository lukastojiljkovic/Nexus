# ADR-077 — One focus timer: absorbing STUDY's session into UTIL's Pomodoro

**Status:** accepted (2026-08-01) · **Owner:** supervisor · **Implements:** the
PRD's „Sustainable productivity — **Must** (woven in, not a module screen)":
*Pomodoro timers and, during breaks, quick productivity boosters… so rest is
part of the rhythm, not a distraction.* **Arc:** (a) engine + migration + store
+ interchange, (b) the „Fokus" page, the widget, the settings card, the
main-process phase timer and its notification, (c) the converter/calculator
drawer — the *Could* half of UTIL.

## 0. The correction this ADR exists to record

The brief that opened this lane said STUDY had *deferred* its Pomodoro to UTIL,
and told the lane to build `focus_sessions`, `focusStore`, `focus:*` channels
and a `focusSession` interchange record from scratch. **All four already
existed**, shipped with STUDY in migration 008: a subject-scoped elapsed-time
timer with seven IPC channels, a main-process running-session map, export
records and stats. The lane checked its base, found every reserved identifier
occupied, and **stopped and reported instead of building** — the second time
that behaviour has saved a wave, and the reason every dependent brief now opens
with a base check.

Put to the founder, the first question answered itself: *„nećemo da imamo više
tajmera, mislim da je to loše."* **One timer.** UTIL absorbs STUDY's rather than
sitting beside it.

## 1. The unified concept

> A **focus session** is a period of deliberate attention — optionally planned,
> optionally attached to a subject or a task.

- STUDY's session is `kind='work'`, `planned_minutes = NULL`, `subject_id` set.
  Open-ended, unchanged in behaviour.
- A Pomodoro phase is `kind ∈ {work, short_break, long_break}` with
  `planned_minutes` set, usually no subject, optionally a `task_id`.

One table, one store, one history, one stats path. Two tables would have meant
two answers to „how long did I focus today", which is the whole number this
feature exists to produce.

## 2. One row is one phase, not one cycle

A Pomodoro is normally described as a *cycle* — work, break, work, break, long
break. Storing it that way is wrong: a cycle is paused, interrupted, abandoned
halfway, resumed after lunch, and storing it means storing its interruptions
*inside* a row, at which point the daily total stops being checkable by looking
at the rows.

The cycle is not stored at all. It is derived by
`nextPhase(config, completedWorkPhases)`, one pure function owning the „every
Nth break is a long one" rule, so nothing else in the system gets an opinion
about phase order.

Breaks are recorded too, and not as bookkeeping: someone who never actually
takes the break is the precise failure mode „sustainable productivity" aims at,
and you cannot show them that without the rows.

## 3. Wall clock, never ticks

`phaseProgress(session, now)` is pure and derives everything from `startedAt`,
`plannedMinutes` and accumulated pause. It never counts intervals fired by a
renderer.

A tick counter is a lie waiting for the first laptop lid: sleep the machine for
twenty minutes and it resumes claiming twenty minutes of focus that did not
happen; throttle a background window and it drifts the other way. Two timestamps
are immune to both, and they are also what lets the page be closed and reopened
without the timer noticing.

**Overrun is representable rather than hidden.** Past the planned end,
`remainingSeconds` is `0` and `overrunSeconds` grows; it never goes negative,
and a pure function does not end a phase on its own. „You finished at 25:00" and
„you kept going to 31:20" are different facts about how someone works.

## 4. A running session is still never a row — migration 008 was right

The opening brief specified persisted running phases plus a `reconcileStale`
pass marking crashed ones `abandoned`. Migration 008 and `FocusStore` had
already argued the opposite, in prose, deliberately: a running session lives as
main-process runtime state so *a crash loses the in-progress timer honestly
instead of persisting a fabricated duration, and there is no stale-open-row
cleanup to get wrong.*

**That decision stands.** It is the better argument, and the brief only
contradicted it out of ignorance that it existed. Overturning a documented
decision needs a stronger reason than the convenience of the lane rewriting it.

Everything the brief had built around persistence is therefore cut: no
`reconcileStale`, no `abandoned` outcome, no `paused_at` column, no partial
unique index over running rows, no cleanup path. `paused_seconds` survives as a
column because pause time accumulates in memory and is written once with the
finished row, so the recorded duration excludes it.

The consequence is a simplification worth stating: **every persisted row is a
real, observed, positive duration** — the `ended_at > started_at` CHECK keeps
meaning what it says — and `focusStats` needs no „which outcomes count" rule at
all. `outcome` (`completed` / `stopped`) survives only to distinguish finishing
the planned 25 minutes from bailing at 12, and is NULL for open-ended sessions
that never had a plan to finish.

The cost, accepted knowingly: kill the app mid-phase and that phase is gone.
For a 25-minute unit that is a fair trade against a permanent recovery surface.

## 5. The task link carries no foreign key

`task_id` is a plain nullable column beside a `label` snapshot. Two independent
reasons:

1. **A focus session is a historical fact about time you spent.** It must
   survive the deletion of whatever it pointed at — you did that work, and
   deleting the task does not undo it.
2. **It would re-arm the ADR-042 hazard.** Making `focus_sessions` a child of
   `tasks` means a future rebuild of `tasks` fires this table's `ON DELETE`
   action inside a migration transaction where `PRAGMA foreign_keys` is a no-op.
   Paying that hazard for a link that must not cascade anyway is paying for
   nothing.

`subject_id` keeps its existing `ON DELETE CASCADE` — that chain (profiles →
subjects → focus_sessions) is documented and deliberate, and this arc is not the
place to re-litigate it.

## 6. The defect this change would have introduced

`statsStore` sums `focus_sessions` durations for STUDY's honest-stats numbers.
The moment break phases become rows in that table, **every break silently
inflates study time**, and nothing on screen would say so — a number quietly
becoming wrong is worse than a feature visibly missing.

Every stats query treating a `focus_sessions` row as study time is therefore
scoped to `kind = 'work'`, pinned by a test that seeds a break row and asserts
study minutes did not move.

## 7. Migration shape

Migration 057 **rebuilds** `focus_sessions` on the create/copy/drop/rename
template, because `subject_id` must lose `NOT NULL` and `ALTER TABLE` cannot do
that. Added: `kind`, `planned_minutes`, `paused_seconds`, `outcome`, `task_id`,
`label`, `cycle_index`. The ADR-042 precondition is verified at version 56
rather than assumed, `focus_sessions_profile_started` is hand-recreated (a
`DROP TABLE` takes its indexes with it), and the copy is **proved
behaviourally** — a fixture seeds rows, migrates, and counts every row back with
its values intact. A schema assertion is not evidence that data survived.

Interchange goes to a minor bump: the `focus-session` record's new fields are
optional on the wire and the lenient reader defaults an older archive's rows to
`kind='work'` with no plan.

## 8. Deliberate exclusions, with reasons

- **The end-of-phase notification does not go through the NTF ledger.** The
  ledger models *scheduled* reminders that must survive the app being closed and
  must not fire twice. A phase ending while you watch the timer is an immediate
  event — and it cannot be missed-while-closed, because the phase cannot run
  while the app is not.
- **No idle detection, no „are you still there".** It needs global input
  watching, a privacy cost this app will not pay for a feature whose premise is
  that the user is the authority on their own attention.
- **Break boosters ship as prompts, not games.** Sudoku and card games are the
  PRD's *Entertainment — Could*, a separate arc. Stretching and eye-rest prompts
  are curated Serbian copy in `strings.ts` and make no health claims, because we
  have no basis for any.
