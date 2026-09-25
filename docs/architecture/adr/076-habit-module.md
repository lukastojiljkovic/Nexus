# ADR-076 — The HABIT module: habits, gentle streaks, and what a streak is allowed to mean

**Status:** accepted (2026-08-01) · **Owner:** supervisor · **Implements:**
PRD's „Habits & Streaks (HABIT) — Should": *build habits with gentle streaks and
progress; habit definitions + completion history feeding dashboard streak
widgets and stats.* **Arc:** three slices — (a) data, (b) page + registration,
(c) the outward wires.

## 1. The decision the whole module turns on: a habit is not an appointment

The obvious move is to give a habit ADR-024's recurrence rule, the way tasks,
events and subscriptions have it. **We do not**, and the reason is precise: the
rule engine answers *„when does this next occur"*, while a habit needs
*„was this period satisfied"* — a different question. Worse, the rule language
can express things that make a streak undefinable: `until`, `count`, „every 3rd
Tuesday", intervals of 5 weeks. A streak over „every 3rd Tuesday of the month
until March" is not a concept anyone can defend, and the moment the picker
offers it, some user's streak becomes arbitrary.

So HABIT gets its own schedule vocabulary, of exactly two kinds and no third:

- **`days`** — expected on a set of weekdays (`daily` is simply all seven).
- **`quota`** — expected N times per week, on any days.

Two kinds because both are real and neither expresses the other: „gym Mon/Wed/
Fri" is not „gym 3× a week" (the second forgives Tuesday), and a tracker that
offers only one of them makes half its users lie to it. Both are small enough
to be fully defined by the streak semantics below, which is the test a third
kind would have to pass.

## 2. What is recorded: one row per habit per day, with a value

`habit_entries` is keyed `(habit_id, entry_date)` — one row per day, uniqueness
in the schema so a double tap is unrepresentable rather than deduped in code
(FIN slice d's rule: an index has to be right once; a guard has to be right
every time).

An entry carries an integer `value`. A habit carries an optional integer
`target` and a short `unit`: when `target IS NULL` the habit is binary and an
entry's value is 1; otherwise a day counts as done when `value >= target`. One
nullable column turns „teretana" and „8 čaša vode" into the same model, and the
streak asks one question of both.

Values are integers, never floats — the FIN lesson, for the same reason (2.5
pages is not a thing anyone means, and `typeof(x)='integer'` is cheap to
assert).

## 3. Gentle streaks, defined

One pure function in `@nexus/core`, beside — not inside — STUDY's
`computeStreak`, whose consecutive-calendar-day model is the wrong shape here
(a habit's unscheduled day must not break anything).

- **`days` habits:** walk back from today over the days the schedule *expects*.
  An expected day with no satisfying entry ends the run. Unscheduled days are
  invisible — they neither extend nor break it.
- **`quota` habits:** the unit is the week. A week is satisfied when its entry
  count reaches the quota; the streak is consecutive satisfied weeks.
- **The gentleness, in both:** the current period never breaks a streak,
  because it is not over. Today's unticked habit and this week's unmet quota
  both leave the streak standing until the period closes. This is exactly
  `computeStreak`'s stated „a streak only breaks after a full missed day",
  restated for two period kinds — the same promise, not a second one.
- `best` is the longest run anywhere in the history; `current` is the run
  ending now.

There is no freeze, no repair, no „streak insurance". A gentle streak is one
that is honest about the current period, not one that can be bought back.

Week boundaries follow the existing first-day-of-week setting — a quota week
that disagrees with the calendar the user is looking at would be its own bug.
That setting is a *device* preference in renderer storage, so the streak
function takes the week start as a **parameter** and every caller passes it;
the store never guesses it, and main never needs it (a reminder is „today at
this time", which has no week in it).

## 4. Slices

**a) Data.** Migration: `habits` (name, colour from the accent vocabulary,
schedule JSON validated to the two kinds, `target`, `unit`, optional
`reminder_time` as HH:MM, `archived_at`, `deleted_at`) and `habit_entries`.
`HabitStore` with the create/update/soft-delete/restore posture every store
here has, plus `setEntry(habitId, day, value)` / `clearEntry` and a range read.
The streak engine and the schedule validator in `@nexus/core`. Archive travel
as two record types, one interchange minor.

`archived_at` is separate from `deleted_at` on purpose: a habit you have
finished with is not a habit you deleted — its history is the point, and it
must keep answering the stats page without cluttering today's list.

**b) Page + registration.** The module page: today's expected habits with
one-tap check-off (and a stepper where a target exists), a per-habit history
grid (the last N weeks as a compact calendar — the one visualisation this
module owes), streak and completion-rate figures that are *derived and stated
plainly*, and the create/edit form with the two-kind schedule picker. Module
manifest, route, sidebar entry.

**c) Wires.** A notification source for `reminder_time` (NTF's minute-granular
due model from ADR-025 already fits — a habit reminder is „today, at this
time", and a habit already ticked today fires nothing), a dashboard widget
(„Navike danas": today's expected set with check-off and the streak), and an
ADR-071 settings panel.

## 5. Deliberate exclusions, with reasons

- **No calendar source.** A daily habit would put 365 bars a year in a calendar
  built for appointments. The page and the widget are the surfaces.
- **No „skip today" state.** Three states (done / not done / skipped) let a user
  argue with their own history, and the quota kind already expresses „some days
  off" honestly.
- **No habit→task generation.** A habit that becomes a task every morning is
  two records of one intention, and the completion of one would have to write
  the other.
- **No negative habits** („don't smoke") in v1 — recorded, because the streak
  semantics invert (a day is satisfied by *absence*, so a missing entry means
  success, and every „no data" day becomes a silent lie in the user's favour).
  That needs its own decision, not a boolean.
