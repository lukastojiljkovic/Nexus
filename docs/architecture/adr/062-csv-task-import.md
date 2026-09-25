# ADR-062 — CSV column-mapping import → TASK (IMEX's last TASK leg)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:** the
CSV → TASK direct importer (ADR-043 §direct-importers; IMEX remainder). FIN's
CSV half explicitly waits for FIN — this ADR is tasks only.

## 1. Architecture

The ADR-043 translator rule again: parse + map into `planForeignImport`'s
task rows; merge semantics stay the planner's (minted ids, additive-only,
salvage by name, one-slot undo). The `.apkg` session pattern in main; the
new piece is the MAPPING step — CSV has no fixed schema, so between preview
and apply the user says which column is which.

## 2. Core: `csvImport.ts` (pure, TDD, hand-rolled)

- **Reader:** the RFC-4180 inverse of `csv.ts` (quoted fields, doubled
  quotes, embedded CRLF/LF, final line with or without terminator).
  **Delimiter sniffing** comma vs semicolon (Serbian Excel writes `;`) by
  counting outside quotes on the first rows; the sniff is overridable in the
  mapping UI. First row = header when every cell is non-numeric and
  non-empty, also overridable.
- **Column roles** (closed vocabulary): `title` (required), `description`,
  `dueDate`, `priority`, `status`, `list`, `section`, `tags`, `ignore`.
  A **suggested mapping** comes from header-name matching over a small
  bilingual table (naziv/title/task, rok/due/deadline, prioritet/priority,
  status/done, lista/list, sekcija/section, oznake/tags/labels …) — a
  suggestion the user confirms, never a silent guess.
- **Cell readings, each lenient and each failure named per row:** dates
  accept ISO `YYYY-MM-DD` and Serbian `d.M.yyyy`/`d.M.yyyy.` (a two-digit
  year is refused, not guessed); priority maps
  visok/high/1→high, srednji/medium/2→medium, nizak/low/3→low, else none;
  status maps done/završeno/gotovo/true/1/x→done, else open; `tags` splits
  on `,`/`;` inside the cell after the field's own quoting. An unreadable
  due date imports the task WITHOUT a date and counts the drop by name — a
  task without its date is still a task; a refused row is a loss.
- **Row rule:** empty `title` → the row is skipped by name. Output:
  `ForeignImportSource` task rows targeted at one list — an EXISTING list
  chosen in the mapping step, or a new named list the import creates (via
  the planner's own list handling; its default-list collapse rule applies) —
  plus a report of every named drop with row numbers (1-based, header
  excluded, so the user can find the cell in their spreadsheet).

## 3. Main + UI

- `imex:import-csv-pick` (dialog, `.csv`/`.txt` filter, stat-before-read,
  5 MiB cap — a bigger CSV is not a hand-kept table), `-preview` (parse +
  sniff + suggested mapping → columns with their first 3 sample values),
  `-map` (the user's confirmed mapping → the plan preview: counts,
  duplicates, named drops with row numbers), `-apply`, `-cancel`. Parsed
  cells live in the pending session; the mapping is applied in MAIN against
  the session's parsed rows (the renderer sends role assignments, never
  data).
- Settings: „Uvoz zadataka (.csv)" in the import card. The mapping step is
  one house dialog: a row per detected column — header name, sample values,
  a role select — plus the delimiter/header toggles and the target-list
  picker. Serbian strings centralized.

## 4. Consequences

- No migration, no interchange change. Imported tasks are ordinary tasks —
  quick-add, recurrence, reminders all apply from the first byte.
- The role vocabulary deliberately excludes `startDate`, `reminder`,
  recurrence and subtask columns in v1: no mainstream export writes them in
  a mappable way, and the honest path for those is the LLM prompt pack
  (which already exists for arbitrary shapes). Recorded here so the refusal
  is a decision, not an oversight.
