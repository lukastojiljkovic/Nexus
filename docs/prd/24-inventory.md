# PRD 24 — Inventory & Warranties (INV) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (garancije, računi, lične
stvari), home-maintenance idea.

## Purpose

What you own, what it's worth, and when its warranty dies: belongings with
receipts and warranty expiry, plus recurring home-maintenance reminders.

## Functional requirements

- **INV-001 (M)** Items: name, category, photo, purchase date/price/store,
  receipt attachment (→ DOC), serial number, location (stan/garaža/…),
  archived (prodato/bačeno).
- **INV-002 (M)** Warranty tracking per item via the CAL-004 expiry engine
  (default ladders, status states) — "garancija ističe za 30 dana".
- **INV-003 (M)** Search/browse by category/location (views engine: cards
  with photos, list).
- **INV-004 (S)** Home maintenance schedules: recurring tasks per home
  (filter zamena, servis kotla, dimnjačar) via CAL-009 templates.
- **INV-005 (S)** Total-value snapshot and per-category charts.
- **INV-006 (C)** Lending log ("pozajmio Marku") with return reminders.

## Integrations

CAL/NTF (warranty + maintenance); DOC (receipts, photos EXIF-stripped);
FIN (purchase as optional linked transaction); SRCH; IMEX.

## Edge cases

Receipt exists but warranty period unknown → default per category (2 yrs
EU-style) editable; multi-item receipts → one attachment, many items;
sold items keep history for warranty transfer questions.

## Open questions

1. Barcode/QR quick-add — Android-era feature; desktop v1 manual.
