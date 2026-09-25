# PRD 27 — Library (LIB) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (knjige, članci, kursevi).

## Purpose

Track learning media: books, articles, courses — states, progress, notes.
The "šta sam pročitao/šta učim" ledger; feeds the yearly review.

## Functional requirements

- **LIB-001 (M)** Entries: type (knjiga/članak/kurs/video-kurs), title,
  author/platform, cover (manual or file), status (želim/u toku/završeno/
  napušteno), dates, rating, review note (→ NOTE link).
- **LIB-002 (M)** Progress: pages/chapters/lessons or percent; reading
  sessions optional (links focus time).
- **LIB-003 (M)** Views: cards with covers (views engine), shelves =
  tags/collections; stats (per year, chart kit).
- **LIB-004 (S)** Quotes/highlights capture per entry (→ NOTE blocks with
  source citation).
- **LIB-005 (C)** ISBN lookup for metadata (needs network + source ADR;
  local accounts manual).

## Integrations

NOTE (reviews, quotes); READ (article promotion to LIB); STUDY (course ↔
subject link); STATS ("Nexus Wrapped": books finished); DASH (currently
reading widget); IMEX (Goodreads-class CSV prompt).

## Edge cases

Re-reads (multiple completions per entry); abandoned → resumed transitions;
series grouping later; covers respect image caps.

## Open questions

1. Separate LIB vs merge into READ — kept separate (media vs web inbox);
   revisit if usage shows confusion.
