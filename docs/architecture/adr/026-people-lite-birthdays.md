# ADR-026 — People-lite and birthdays on the calendar

**Status:** accepted · 2026-07-29
**Drives:** CAL-007 ("birthday/anniversary entries shall recur yearly with age
computation"), the last unblocked M requirement in CAL. The founder decided
the open question on 2026-07-05: a **minimal people-lite store inside CAL**,
promotable to a real contacts module later. The gift-tracker hook (SHOP) is
post-v1 and not built here.
**Supersedes nothing.**

## Context

The calendar overlays events, dated tasks, exams, study blocks and document
expiries; birthdays are the source PRD 04 §3 lists that has no data behind it.
A birthday is not an event row — it belongs to a *person*, recurs yearly
forever, needs an age computed from a birth year the user may not know, and
must survive being promoted into a future contacts module without a data
rewrite.

## Decision

### 1. A `people` table, deliberately minimal

Migration 020:

```sql
CREATE TABLE people (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('birthday', 'anniversary')),
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  day         INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
  year        INTEGER,          -- birth/anniversary year when known; age needs it
  note        TEXT,             -- free text ("kolega", "kum"...), nullable
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT              -- soft delete + undo, the house pattern
);
```

Month/day as integers, not a date column: there is no year in the recurring
fact itself, and a fake year inside a date string is exactly the kind of
lie that leaks. The store (`PeopleStore`, `packages/db/src/people/`) validates
the (month, day) pair against a real calendar (Feb 30 refused; Feb 29
allowed — leap-day birthdays exist), `year` when present is a plausible
4-digit year not in the future, `name` non-empty. Standard CRUD +
soft-delete/restore, every statement profile-scoped.

### 2. Expansion clamps Feb 29 — it does not reuse the yearly engine rule

ADR-024's yearly rule *skips* years that lack the anchor's day (RFC 5545
semantics — correct for events). For a birthday that is wrong: a person born
on Feb 29 has a birthday every year, and skipping three out of four would be
a product bug wearing a spec. So birthdays get their own tiny pure expansion
in `packages/core/src/calendar/birthdays.ts`:

- `birthdayOccurrencesInRange(person, range)` — one bare date per year in the
  closed range where (month, day) lands, with **Feb 29 clamped to Feb 28 in
  non-leap years** (the common civil convention).
- `ageAtOccurrence(person, occurrenceDate)` — `occurrenceYear − year` when
  `year` is known, else null. An anniversary's number is the same arithmetic
  ("15. godišnjica").

### 3. A fifth calendar source

`calendarItems.ts` gains `"birthdays"` beside the four existing sources: a
toggle chip like the others, one all-day item per occurrence (id
`person-<id>@<date>`), labelled with the person's name and, when the year is
known, the age/anniversary number. Month/week/day/agenda and Dashboard's
Danas all inherit it from the one merge, exactly as recurrence expansion did.
Birthday items are read-only on the grid (no drag, no resize — a birthday is
not reschedulable), and clicking one opens the person in the management
panel.

### 4. The "Ljudi" panel

A sixth Calendar view tab beside Dokumenta, mirroring `DocumentsPanel`'s
pattern: a list (name, kind, date, age when known), an add/edit form
(name, kind select, day+month selects, optional year, optional note), delete
with the house undo. All copy Serbian in `strings.ts`.

### 5. Interchange: the first schema-minor bump

A new record type `"person"` rides in `data/calendar.ndjson`. Per ADR-009's
semver policy, **adding a record type is a minor bump**:
`INTERCHANGE_SCHEMA_VERSION` becomes `1.1.0`. An older build's parser refuses
a `1.1.0` archive (its version gate stops at its own minor) — which is
correct and is precisely why the unknown-record-type rule could afford to be
an error (ADR-023): the version gate, not silent skipping, is the
compatibility mechanism. This build still reads `1.0.x` archives, whose
absent people restore as none. `ExportPerson` is a required member of
`ProfileData`; `parsePerson` is the parser twin; `RestoreStore` wipes and
writes the table (the wipe-list guard test forces this mechanically);
`countProfileModules` counts people into the `calendar` bucket.

### 6. Deliberately not here

- **Notifications** for birthdays (NTF gift/birthday nudges) — a later NTF
  source, designed with SHOP's gift hook; nothing in CAL-007's acceptance
  needs it.
- **Contact fields** (phone, email, photo) — the promotion path to a real
  contacts module adds columns; nothing has to be re-modelled.
- **Recurring "custom događaji" templates (CAL-009)** — INV territory.

## Consequences

- CAL's M-set closes except the two items blocked on other modules (FIN
  renewals, business overlay) and the ADR-020-scoped drag/resize refinement.
- The people-lite store is the app's first module-owned auxiliary entity
  (a row that is not itself a calendar item but projects one) — the same
  shape FIN subscriptions will take for their renewals.
- Search: people are deliberately not added to the SRCH index in this slice;
  if wanted later it is one projection view + triggers per ADR-021's recipe.
