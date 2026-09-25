# PRD 04 — Calendar & Reminders (CAL)

**Status:** draft 2026-07-05. Inputs: raw-spec §17 + document-expiry idea,
founder decision #4 (shared calendar overlay), gifts/home-maintenance/
subscriptions ideas (renewal surfaces).

## 1. Purpose

One time surface for everything dated: events, exams, birthdays, deadlines,
dated tasks, and the founder's signature feature — **document-expiry
reminders** (lična karta, pasoš, vozačka, registracija, bankovne kartice).
CAL is also the only shared surface between personal and business profiles.

## 2. User stories

- As a user, I want all my dated items on one calendar, so that nothing
  dated lives in a silo.
- As a citizen, I want the app to remind me weeks before my documents and
  registrations expire, so that bureaucracy never surprises me (founder's
  own bank/car/papers persona).
- As a student, I want exams on the calendar with countdowns, so that study
  planning has an anchor.
- As a dual-profile user, I want personal and business events on one grid
  but visually distinct, so that I plan around both without mixing data.

## 3. User experience & flows

Month / week / day / agenda views (views engine). Event creation via click-
drag on grid or quick-add with NL parsing (shared with TASK). Overlay
chips toggle sources: events, tasks, exams, birthdays, expiry items,
business-profile layer (distinct texture/border per decision #4). Document
expiry: a dedicated "Dokumenta" panel lists tracked documents with status
(ok / uskoro ističe / istekao); adding one asks type, expiry date, and
reminder schedule (sane defaults per type, e.g. lična karta: 60/30/7 dana).

## 4. Functional requirements

- **CAL-001 (M)** Events shall have title, start/end (timed or all-day),
  optional recurrence (same rule engine as TASK-006), location text, notes,
  color/category, and reminders.
- **CAL-002 (M)** Views: month, week, day, agenda; drag to move/resize
  events; keyboard navigation.
- **CAL-003 (M)** The calendar shall overlay: native events, dated tasks
  (TASK), exams (STUDY), birthdays (contacts-lite, see OQ#2), document
  expiry items, and subscription renewals (FIN) — each source toggleable.
- **CAL-004 (M)** Document-expiry tracking: predefined types (lična karta,
  pasoš, vozačka dozvola, registracija vozila, bankovna kartica, polisa
  osiguranja, custom) with per-type default reminder ladders (editable),
  status states, and renewal flow (mark renewed → new expiry, history kept).
- **CAL-005 (M)** Business/personal overlay per decision #4: both profiles'
  events visible in either profile's calendar with unmistakable visual
  distinction; event *data* stays in its profile; creating an event always
  targets the active profile explicitly.
- **CAL-006 (M)** Reminders on any event/expiry item via NTF: relative
  offsets (multiple), snooze-aware.
- **CAL-007 (M)** Birthday/anniversary entries shall recur yearly with age
  computation and gift-tracker hook (SHOP, post-v1).
- **CAL-008 (S)** ICS import (one-time) via IMEX; ICS export of Nexus
  calendar. Live external calendar subscription (Google/Outlook) is
  post-v1 (OQ#3).
- **CAL-009 (S)** "Custom događaji" templates (recurring structures like
  home-maintenance ladders: servis kotla, filteri) instantiable from INV
  when enabled.
- **CAL-010 (C)** Week-numbering and semester view for students.

## 5. Options & settings

First day of week; default event duration; default reminder ladders per
document type; source-toggle memory; time format.

## 6. Integrations

TASK (bidirectional: drag task on grid reschedules); STUDY (exams render
with countdown chip; exam planner blocks study time as calendar items —
managed); FIN (subscription renewals); NTF (all reminders); SHOP (gifts
before birthdays); INV (maintenance schedules); DASH (agenda/countdown
widgets); IMEX (ICS).

## 7. Edge cases & error states

- Timezone travel: timed events shift with zone, all-day and expiry items
  never do.
- Recurring event edited: this / this-and-future / all — explicit choice,
  consistent with TASK repeats.
- Expiry item with past date at creation → immediately "istekao" state, no
  retroactive notification storm (one summary notification).
- Sync conflict: per-field LWW; a deleted-vs-edited event conflict keeps the
  edit (conflict copy per sync research).
- 5+ overlapping sources on one day → stacking and overflow ("+3 još")
  with popover; performance budget for month view with 500 items.
- Profile deleted (business) → its events disappear from overlay; no
  orphaned reminders (NTF cleanup contract).

## 8. Acceptance criteria (key)

- Adding "registracija vozila" with expiry in 45 days schedules the default
  ladder (60 skipped as past, 30/7 scheduled) and shows status "uskoro".
- Business event is visually distinct in personal profile and unopenable
  beyond preview there without switching (password prompt per AUTH-024).
- Dragging a task from Thursday to Friday updates its due date in TASK and
  the change syncs.
- Renewing a document creates the next cycle and archives the old one.
- ICS import of a 200-event file completes with a summary (imported/skipped
  duplicates).

## 9. Open questions

1. ~~Default reminder ladders per document type.~~ **Confirmed (founder
   2026-07-05): ID/passport 90/30/7; registracija 30/14/3; kartica 30/7
   (days before; per-document override).**
2. ~~Birthdays: people list vs contacts module.~~ **Decided (founder
   2026-07-05): minimal people-lite store inside CAL, promotable later.**
3. External calendar two-way sync — post-v1 ADR (OAuth, privacy).

## 10. Future extensions

Live Google/Outlook subscription; scheduling links; travel-aware timezone
assistant; national holidays packs (sr-RS first).
