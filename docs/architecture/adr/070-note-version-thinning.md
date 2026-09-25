# ADR-070 — Tiered age thinning of note checkpoints (NOTE-008's last refinement; no migration, no interchange change)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Closes:** the
refinement ADR-015 recorded when note version history shipped — "tiered age
thinning of old checkpoints beyond the window is a noted future refinement,
deliberately not v1".

## 1. What a flat window gets wrong

Today's rule is "keep the newest N". It fails in both directions, and both
failures are ordinary use:

- a note edited heavily for **one afternoon** pushes out every checkpoint from
  the months before it — the history now covers four hours;
- a note edited **twice a year** keeps two checkpoints two years apart — the
  history covers everything and shows nothing.

A version history is not a buffer of recent writes; it is a record of how a
document got here. Density should follow age.

## 2. The schedule

Keep **every** checkpoint from the last 24 hours, **one per hour** for the last
7 days, **one per day** for the last 30 days, and **one per week** beyond that.
On top of that: **a note's oldest surviving checkpoint is never dropped.** The
"where this note started" row is the one a history is most often opened for, and
a schedule that eventually eats it is a schedule that quietly deletes the past.

Within a bucket the **newest** survives — the defensible default, because it is
the state that actually persisted through that hour, day or week.

The existing hard cap stays as the backstop. The tiers decide *which* rows
survive; the cap decides *how many at most*. In practice the tiers bind first
for any note with real history, and the cap only ever catches a pathological
burst.

## 3. Shape: a pure function decides, the store applies

- The schedule is a **pure function in `@nexus/core`** — timestamps plus "now"
  in, keep/drop out. No clock, no IO, no database, so it is testable as a table
  of cases, which is how it is written. That function is the design; everything
  else is plumbing.
- The store applies it **in the same transaction as the insert**, the idiom
  `PrivateNoteStore.writeVersion` already established: a thinning that can land
  without its insert (or the reverse) is a history that loses a row to a crash.
- **Determinism and idempotence** are pinned by test: run it twice with the same
  clock and the second run changes nothing.

## 4. What deliberately does not change

- No schema, no interchange change — this only decides which existing rows
  survive. The history UI keeps listing what exists.
- **The private note store keeps its own fixed keep-count.** Sealed versions are
  a different rule under a different threat model — their containers are opaque
  to everything but the unlocked section — and sharing a schedule between them
  would couple two things whose only similarity is the word "version".
- A restore writes version rows directly, so restoring must not reshape a
  restored note's history by the mere act of restoring. Whatever mechanism
  guarantees that is stated where it lives.
