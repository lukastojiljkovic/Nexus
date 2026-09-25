# ADR-074 — Pausing a subscription (FIN, migration 054, interchange 1.31.0)

**Status:** accepted (2026-08-01) · **Owner:** supervisor · **Commissioned by
the founder:** „Može pauza" (2026-08-01), answering the first of the three
questions FIN's arc closed with. **Extends:** ADR-073 slice d (subscriptions),
whose schedule is ADR-024's engine.

## 1. The gap

FIN slice d shipped subscriptions with exactly two states: live, or
soft-deleted (reversible through the undo bar). So the only way to say „stop
charging me" was to delete the subscription — which is the wrong sentence. A
paused gym membership is not a deleted one: you still hold it, you still want
to see it in the list, and you intend to resume. Delete-and-recreate loses the
name, the amount, the category, the schedule and the reminder ladder, and it
loses the *history*: the charges already generated point at a `recurring_id`
that no longer names anything live.

## 2. Two nullable timestamps, not a status enum

Migration 054 adds `paused_at TEXT NULL` to `fin_recurring`. `paused_at` and
`deleted_at` are independent — that is the house idiom (a row is deleted, or
paused, or both, and each is a separate fact with its own clock), and it keeps
every existing `deleted_at IS NULL` predicate correct without revisiting it. A
`status` column would have forced every one of those predicates to be re-read
and re-decided, which is exactly how a filter gets missed.

**It must be `ALTER TABLE … ADD COLUMN`, never a rebuild.**
`fin_transactions.recurring_id` references `fin_recurring`, so this table is a
parent; ADR-042 proved that rebuilding a referenced parent fires its children's
`ON DELETE` actions *inside* the migration transaction, where
`PRAGMA foreign_keys` is a no-op — there, it silently deleted the entire
`review_log`. Here it would silently delete every generated charge, i.e. money
history. A test seeds a subscription with charges, migrates, and counts every
charge back.

## 3. What „paused" means, structurally

While `paused_at IS NOT NULL`:

- **`generateDue` skips the row** — one `AND paused_at IS NULL` on the
  generator's own read.
- **`upcoming()` contributes nothing for it.** This is the load-bearing line:
  the calendar's „Pretplate" source, the dashboard's upcoming-renewals widget
  and the renewal notifications *all three* derive from `upcoming()`, so one
  predicate silences all three with no per-surface special case. A surface that
  did not derive from `upcoming()` would be a defect in slice d, not a case to
  handle here — each of the three is pinned by its own test.
- **`listActive()` still returns it.** Keeping the subscription visible *is*
  the feature; a pause that hides the row is a delete with extra steps.
- **Editing stays allowed.** `requireActive` filters on `deleted_at` only, and
  that is correct: you may fix the amount of a subscription you are not
  currently paying.

## 4. Resume re-anchors the cursor — it does not back-charge

The decision that distinguishes pause from „delete and recreate later":

- `pause(id, now)` writes `paused_at` and leaves `next_run` untouched. While
  paused, `next_run` is not meaningful.
- `resume(id, now, today)` clears `paused_at` and recomputes the cursor as
  **the first occurrence the rule places on or after `today`**, with the phase
  preserved from `anchor_date` — one function with an explicit „from" day,
  shared with the existing `firstOccurrence` rather than a near-copy of it.
  Paused 10 March, resumed 20 April, monthly-on-the-5th → next charge 5 May.
  Pause skips occurrences; it does not shift the schedule.

Freezing the cursor instead would, on resume, charge every occurrence the user
paused specifically in order to avoid — the single worst thing this feature
could do. A series already spent (`next_run IS NULL` because `count`/`until`
ran out) stays spent, because the recomputation runs through the same engine
bounds and returns `null`. Resuming on a day the rule names charges that day:
resume means „bill me again from now", and today's occurrence is now.

`pause` on a paused row and `resume` on a live one refuse, on exactly the
`changes === 0` posture `softDelete`/`restore` already use.

**Delete/restore composes:** soft-deleting a paused subscription and restoring
it returns it **still paused**. The pause is a fact about the subscription, not
about its visibility.

## 5. The archive — 1.31.0, no era flag

`pausedAt` travels on the `fin-recurring` record. The minor bumps because a
1.30.0 reader would drop the pause and start charging a subscription the user
paused — a wrong outcome, not a missing nicety. No era flag: an older archive
carrying no `pausedAt` parses to `null`, which is exactly „not paused" — the
correct reading, not a lossy guess (the ADR-042 `kind` precedent). Foreign
import keeps the imported row's paused state: it is a fact about the row, not a
reference to remap.

## 6. The surface

Two channels — `fin-recurring:pause` and `fin-recurring:resume` — deliberately
two rather than one `set-paused` boolean, because resume carries a `today`
re-anchor that pause does not; they are different operations with different
payloads, and one channel would have hidden that behind a flag. Main stamps
both `now` and the local `today`, reusing the generator's existing local-day
helper.

On the page: „Pauziraj" / „Nastavi" in the row's actions; a paused row stays in
the one alphabetical list (splitting it in two would make a reversible state
look like a category), rendered muted with a „Pauzirano" chip in the same
muted-outlined family as tasks' „Blokiran" — no glow, no accent fill — and its
„sledeća naplata" line replaced by the pause fact rather than a date that will
not happen. No aggregate on the page counts a paused subscription.

## 7. Consequences

- One column, one migration, one interchange minor, two channels. No new table,
  no second recurrence language, nothing materialised into the future.
- The three renewal surfaces needed no code of their own, which is the proof
  that slice d's „derive everything from the rule" was the right shape.
- The two „too-new refusal" fixtures move from `1.31.0` to `1.32.0`; that
  vocabulary is always „the nearest minor strictly ahead of this build" and has
  to move with every bump.
