# PRD 21 — Health (HLTH) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (lekovi, terapije,
podsetnici). Sensitive-data module: SEC-PRIV data-minimization applies
sharply; medical disclaimer mandatory (as in PRO medical tools).

## Purpose

Personal health admin — medications, therapies, appointments, symptom
notes — reminders that actually fire offline. Not a medical device; an
organizer with disclaimers.

## Functional requirements

- **HLTH-001 (M)** Medications: name, dose, schedule (times/day, with-food
  flags, duration/end date), stock counter with refill reminder threshold.
- **HLTH-002 (M)** Intake logging from notification action (uzeto/preskoči/
  snooze); adherence view (chart kit).
- **HLTH-003 (M)** Therapies/appointments: entries with CAL integration and
  reminder ladders; attach documents (nalazi → DOC, size-capped).
- **HLTH-004 (M)** Medical disclaimer at module first-open; no dosage
  advice, no interactions checking (explicit non-goal v1 — liability).
- **HLTH-005 (S)** Symptom/notes journal (datestamped, optionally excluded
  from SRCH like mood journal).
- **HLTH-006 (S)** Vaccination/checkup recurring reminders (yearly ladders,
  same engine as CAL-004 document types).
- **HLTH-007 (C)** Family member profiles (dete, roditelj) — sub-entities
  within the user's data, not separate accounts.

## Integrations

CAL/NTF (all reminders; max-priority option for critical meds); DOC
(nalazi); FIT (weight lives in FIT; HLTH links, doesn't duplicate); IMEX.

## Edge cases

Timezone travel with timed meds → explicit "shift with me / keep local
time" choice per med; missed logs backfill; stock never negative;
discontinued med archives with history.

## Open questions

1. ~~PRIV-level encryption by default?~~ **Decided (founder 2026-07-05):
   standard storage in v1 with clear labeling; PRIV-level encryption as a
   later opt-in.**
