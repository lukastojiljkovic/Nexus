# PRD 23 — Travel (TRAV) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (planovi, itinereri,
budžeti).

## Purpose

Trips as projects: itinerary, checklist, documents, and budget in one
place — planning enjoyable enough to replace the group-chat chaos.

## Functional requirements

- **TRAV-001 (M)** Trips: destination(s), dates, cover, status (ideja/
  planirano/u toku/završeno); appears on CAL as a span.
- **TRAV-002 (M)** Itinerary: day-by-day entries (time, place, note,
  booking ref, attachment → DOC — karte, rezervacije); map-free v1 (links
  open external maps).
- **TRAV-003 (M)** Packing/prep checklists from templates (letovanje,
  zimovanje, city break, custom); reusable personal templates.
- **TRAV-004 (M)** Trip budget: planned vs spent per category; multi-
  currency via FIN-004 rates; optional link of FIN transactions to the trip
  (tag-based).
- **TRAV-005 (S)** Document-expiry awareness: pasoš/viza validity check
  against trip dates (CAL-004 data) with early warning — signature detail.
- **TRAV-006 (C)** Shared trip planning (SHARE read-only v1 semantics;
  collaborative later).

## Integrations

CAL (trip span, itinerary reminders); CAL-004 (passport check); FIN
(budget/spend); DOC (bookings); SHARE (post-v1 co-planning); SHOP (packing
→ shopping candidates); IMEX.

## Edge cases

Timezone-per-destination itinerary times (store local-to-place); overlapping
trips allowed; canceled trip keeps records (status); currency of spend ≠
budget currency → explicit rates.

## Open questions

1. Offline maps/attachments pre-download prompts before departure —
   fast-follow candidate.
