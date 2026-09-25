# ADR-061 — ICS calendar import (the last CAL leg of IMEX's direct importers)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:** the
ICS → CAL direct importer (ADR-043 §direct-importers; IMEX remainder). The
export half shipped at `85fe7ef` (`icsExport.ts`); this is the inverse door.

## 1. Architecture: a translator, not a second importer

ADR-043's rule holds: a direct importer is a TRANSLATOR into
`planForeignImport`'s input — the merge semantics (minted ids, additive-only,
duplicate groups, named per-row salvage, one-slot undo snapshot) are decided
once and not re-decided here. The lane's shape is the `.apkg` lane's
(ADR-052): a pure core parser + translator with tests, pick/preview/apply/
cancel channels in main holding PARSED records (never the raw file) in the
same pending-import session pattern, and a Settings card beside the existing
import surfaces.

## 2. Core: `icsImport.ts` (pure, TDD, hand-rolled — no dependencies)

- **Unfolding + tokenizing** per RFC 5545: CRLF or bare LF accepted, 75-octet
  folded lines unfolded (the export's own folding proven against multi-byte
  Serbian text must round-trip), `\\`/`\;`/`\,`/`\n` unescaping, property
  parameters read case-insensitively.
- **`VEVENT` only.** `VTODO`/`VJOURNAL`/`VALARM` and unknown components are
  counted and skipped BY NAME (the salvage discipline — never silent).
- **Date-times:** floating local (`DTSTART:YYYYMMDDTHHMMSS`) map verbatim to
  Nexus's zone-less wall-clock strings — the export's own representation.
  `VALUE=DATE` → all-day. UTC (`...Z`) and `TZID=` values are converted to
  the MACHINE'S local wall-clock at import time (the app stores no zones; an
  import is a one-time reading, and the machine's zone is the only honest
  reference it has — recorded in the module doc). `DTEND`/`DURATION` → the
  event's end; a `DTEND` equal to `DTSTART` or absent → a point event.
- **Recurrence:** `RRULE` is mapped INTO ADR-024's six shapes where it fits
  (DAILY, WEEKLY±BYDAY incl. weekdays, MONTHLY by date, MONTHLY by ordinal
  weekday, YEARLY; `INTERVAL`, `COUNT`, `UNTIL` — an `UNTIL` in UTC converts
  like any UTC instant). `EXDATE` → exdates. A rule that outgrows the six
  shapes (BYSETPOS beyond one ordinal, BYMONTHDAY lists, WKST games, HOURLY/
  MINUTELY…) imports the MASTER as a one-off event and says so per row —
  `skipCode: "recurrence-unmappable"` — because a silently-simplified series
  is a lie and a refused event is a loss; one occurrence is the truthful
  minimum. Detached overrides (`RECURRENCE-ID`) import as their own one-off
  events, counted by name.
- **Output:** `ForeignImportSource` event rows (title from `SUMMARY`,
  `DESCRIPTION` → description, `LOCATION` appended to description under a
  labeled line — CAL has no location field and inventing one is a migration
  this importer does not get to make) + an `IcsImportReport` naming every
  skip class with counts.

## 3. Main + UI (the `.apkg` recipe verbatim)

- `imex:import-ics-pick` (dialog, `.ics` filter, stat-before-read, size cap —
  the `.apkg` cap constant's posture, 20 MiB), `-preview` (parse + plan →
  the same preview shape the foreign importer renders: counts per module,
  duplicate groups, skip reasons), `-apply` (through the SAME apply path —
  snapshot, write, undo banner), `-cancel`. Parsed records live in the
  pending session in main; the raw text is dropped after parsing.
- Settings: an „Uvoz kalendara (.ics)" row in the existing import card,
  preview → confirm flow identical to `.apkg`'s. Serbian strings in
  `strings.ts`; duplicate handling is the planner's existing event dedup
  (`eventDuplicateKey`), surfaced in the same UI.

## 4. Consequences

- No migration, no interchange change (nothing new travels — imported rows
  are ordinary events from their first byte).
- `icsExport` → `icsImport` round-trip is pinned by test: every exportable
  event re-imports to an equivalent row (recurrence shapes included), with
  the one asymmetry named (reminder ladders do not travel in ICS and import
  with CAL's defaults).
