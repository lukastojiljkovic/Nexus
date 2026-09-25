# ADR-025 — Event reminders through NTF

**Status:** accepted · 2026-07-29
**Drives:** CAL-006 ("reminders on any event/expiry item via NTF: relative
offsets (multiple), snooze-aware"). The expiry-item half has existed since the
document ladder; this closes the event half. Builds on ADR-024 (a recurring
event is one series master) and the NTF derive-don't-materialize design.
**Supersedes nothing.**

## Context

The notification engine is **day-granular**: every occurrence carries a bare
`fireDate` and fires at the profile's `morningHour`. That is right for
documents ("30 days before expiry") and exams, and wrong for events — "10
minutes before the meeting" is the entire point of an event reminder. Events
also recur now, and a series master must remind per *occurrence*, not once.
Finally, migration 009 fixed the `source` domains with SQL `CHECK`s
(`'document','exam','study-day'`), which SQLite cannot alter in place.

## Decision

### 1. Offsets live on the event, in minutes

`events.reminder_offsets TEXT NOT NULL DEFAULT '[]'` — a JSON array of
minutes-before, the same shape as `tracked_documents.reminder_offsets` holds
days-before. Store-validated (no SQL CHECK can read JSON): unique non-negative
integers, each ≤ 43 200 (30 days), at most 8 per event, stored sorted
ascending. `0` means "at start". Set through create/update like any field; the
UI offers a fixed chip set (u vreme početka / 10 min / 30 min / 1 h / 1 dan
ranije), while the store accepts any bounded value so the interchange and
future UI are not constrained by today's chips.

### 2. A fourth source, `"event"`, with a minute-granular due model

`NotificationSource` gains `"event"` everywhere the closed domain is mirrored
(core engine, db store consts, importArchive's enum, the wire, the renderer's
source list and digest counts). Migration 019 **rebuilds** `notifications` and
`ntf_source_settings` (create-new → copy → drop → rename, index re-created) to
widen both CHECKs — the standard SQLite dance, done once and tested.

The engine gains event occurrences beside the day-granular ones. Each carries
a full **local wall-clock fire instant** (`YYYY-MM-DDTHH:MM` — the app's
timestamps are zone-less wall-clock strings, so "local now" is
`` `${today}T${nowLocalTime}` `` and fixed-width strings compare directly):

- **Timed event:** fire instant = `startAt` − offset minutes.
- **All-day event:** there is no start time to subtract from, so the offset
  degrades to the day-granular model the rest of the engine already speaks:
  fire at `morningHour` on `startDate − floor(offset / 1440)` days.
- **Due** = fire instant ≤ now, **relevant** = now ≤ the occurrence's own
  start. Past the start, "starts in 10 minutes" is noise, not information —
  the study-day rule, not the document catch-up rule. The relevance window is
  what bounds catch-up after sleep: a reminder missed while the lid was closed
  still fires if the event has not started yet, and silently never exists if
  it has.
- **Priority is always `normal`.** Quiet hours hold event reminders, and one
  whose event starts inside quiet hours is consequently never delivered at
  all (it re-derives after quiet ends and is no longer relevant). That is the
  user's do-not-disturb doing exactly what it says; the "final warning"
  `max` exception remains a document-ladder concept.

### 3. Recurrence-aware derivation

The scheduler (main) expands each ruled master over a small forward window —
`[today, today + ceil(maxOffset/1440) + 1 days]`, per event, from its own
offsets — with `occurrenceDatesInRange` (exdates honoured), and hands the
engine one input row per occurrence. `occurrenceKey = "<occurrenceDate>
<offset>"`; a one-off uses its own start date as the occurrence date, so the
key shape is uniform and the ledger's `UNIQUE (profile, source, entity,
occurrence_key)` dedupe works unchanged. Rescheduling an event simply changes
which occurrences derive; old ledger rows are harmless history, per the NTF
design. Snooze/re-fire needs zero new code: `dueSnoozed` already re-fires a
row only while its occurrence is still among the current candidates.

### 4. Presets

The Settings appetite presets place `"event"` beside `"document"`:
minimalno = document + event, normalno = + exam, sve = + study-day. An event
reminder is the least noisy kind there is — the user explicitly attached it to
that one event — so it belongs in every preset.

### 5. Interchange

`ExportEvent.reminderOffsets` is a **required** member (the ADR-022 lesson),
validated by a parser twin of the store rule; `RestoreStore` writes the column
verbatim; notification ledger rows with `source: "event"` ride the existing
notification record path once the parser's source enum learns the value.

## Consequences

- The engine stays pure and clock-free; only its input grows. The scheduler
  remains the single place that reads clocks and expands recurrence.
- The 60-second check interval bounds delivery lateness to one minute, which
  is what it already was for the morning-hour sources.
- Digest grouping, the notification center, snooze presets and the source
  toggle UI all inherit the new source through the existing generic paths;
  only Serbian copy is new (`eventNotificationCopy`, source name, digest
  line).
- CAL-009-style reminder defaults per event category are out of scope; the
  chips are per-event, and a default ladder would be a Settings concern later.
