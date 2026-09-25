# ADR-028 — Per-task reminders through NTF

**Status:** accepted · 2026-07-30
**Drives:** the "per-task reminders (via NTF)" item of Finishing Tasks (PRD 03
§6's NTF integration). Builds on ADR-025 (which added the minute-granular
event source) — but a task's due date is a **bare date**, so task reminders
are the **document model**, not the event model: days-before offsets firing at
`morningHour`.
**Supersedes nothing.**

## Decision

1. **`tasks.reminder_offsets`** (migration 021): JSON days-before-due ladder,
   the exact shape `tracked_documents.reminder_offsets` holds — unique
   non-negative integers (0 = "na dan roka"), each ≤ 365, at most 8, stored
   ascending, store-gated. A ladder requires a `dueDate`, enforced against the
   merged pair in both directions (the recurrence-anchor precedent).
2. **A fifth source `"task"`** — migration 021 rebuilds `notifications` and
   `ntf_source_settings` once more (the 019 pattern verbatim, one CHECK wider).
3. **Engine**: one day-granular occurrence per (task, offset), fireDate =
   `dueDate − offset` days, `occurrenceKey = "<dueDate> <offset>"` — the due
   date is in the key because a recurring task ADVANCES in place (ADR-024):
   each advance re-keys the next occurrence's reminders for free, and old
   ledger rows are harmless history. **Relevant while the task is not done and
   `today <= dueDate`** — the document catch-up rule with `done` as the extra
   kill switch. Overdue *nudges* ("rok je prošao") are a different occurrence
   type with appetite rules of their own and are deliberately not in this
   slice; recorded in STATUS.
4. **Priority always `normal`** — the `max` final-warning exception stays a
   document concept.
5. **Scheduler**: tasks with a non-empty ladder and a bare-date due date feed
   the engine directly — no expansion needed (the row's CURRENT due date is
   the only occurrence that can ever be due; unlike events, there is no series
   to look ahead through, because the series lives in the row's own advance).
   Copy: `taskNotificationCopy(title, dueDate, today, offset)` — "Zadatak:
   <title>", body naming the due day (danas/sutra/date) and the lead time.
6. **UI**: the task form gains the "Podsetnik" chip row — ladder `[0, 1, 3,
   7]` (Na dan roka / 1 dan ranije / 3 dana ranije / 7 dana ranije) plus a
   chip for any stored off-ladder offset (the CAL-006 rule: editing never
   silently drops one). Disabled with a caption while the form has no date.
   Appetite presets put `"task"` beside `"document"` and `"event"` in every
   tier — explicitly attached, least noisy kind.
7. **Interchange**: `ExportTask.reminderOffsets` required; parser twin; the
   source enum widens in every mirror; `RestoreStore` writes the column.
   Version bumps 1.1.0 → 1.2.0: **adding a required field IS a minor bump**,
   same as a record type.

   **Corrected during implementation** (the first draft of this section
   stopped at the bump): a bump alone does not keep older archives
   restorable — a required field means the strict parser refuses every
   archive written before the field existed, and recurrence/exdates/event
   ladders had already shipped INSIDE 1.0.x with no bump at all, so those
   were silently breaking 1.0.0 backups too. The reader therefore gained
   **era-gated defaulting**: the declared version is read once into an
   `ArchiveEra`, and a field the writer of that era did not yet emit is
   defaulted when ABSENT (1.0.x: recurrence null / exdates [] / event ladder
   []; below 1.2.0: task ladder []) while a PRESENT key — including an
   explicit null — is validated strictly in every era, and absence at an era
   that wrote the field stays `invalid-record`. A backup that cannot be
   restored is not a backup; leniency confined to absence in the exact eras
   where absence is legitimate keeps both promises at once. Future required
   fields MUST ship with their own era flag and a bump, which makes their
   era unambiguous — the 1.0.x ambiguity is the scar of not having done so.

## Consequences

- Third consumer of the reminder-ladder idiom; if a fourth appears (habits),
  extract a shared validator then, not now (rule of three is satisfied but the
  two existing gates differ in unit and cap — days/minutes — so the extraction
  would abstract the wrong thing).
- The recurring-task advance already re-keys reminders with zero new code —
  the reward for putting the due date in the occurrence key.
