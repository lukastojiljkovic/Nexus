# PRD 22 — Car (CAR) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (registracija, servisi,
gume, potrošnja, osiguranje); founder persona (sređivanje auta).

## Purpose

Vehicle admin without the shoebox of papers: deadlines (registracija,
osiguranje, tehnički), service history, tires, and fuel log with consumption
math.

## Functional requirements

- **CAR-001 (M)** Vehicles: make/model/year/plate, photo, documents
  (saobraćajna, polisa → DOC attachments).
- **CAR-002 (M)** Deadline items per vehicle: registracija, osiguranje,
  tehnički pregled, custom — powered by the CAL-004 expiry engine (ladders,
  renewal history).
- **CAR-003 (M)** Service log: date, odometer, type (mali/veliki servis,
  popravka), items/notes, cost (optional FIN link), workshop; next-service
  reminder by date or km.
- **CAR-004 (M)** Fuel log: date, odometer, liters, price; computed
  l/100km and cost/km trends (chart kit).
- **CAR-005 (S)** Tire tracker: sets (letnje/zimske), storage location,
  swap reminders (seasonal), DOT/age note.
- **CAR-006 (C)** Trip/putni troškovi log (links TIME/TRAV later).

## Integrations

CAL/NTF (deadlines, seasonal reminders); DOC (documents); FIN (costs as
optional linked transactions, no double-entry); DASH (upcoming deadlines
widget); IMEX.

## Edge cases

Odometer entered lower than previous → validation with override (odometer
replaced); multiple vehicles; sold vehicle → archive with full history;
missing odometer on fuel entries → consumption gaps handled (skip segment).

## Open questions

1. Serbian registration cost calculator (varies by engine/age) — nice PRO/
   UTIL candidate; out of CAR v1.
