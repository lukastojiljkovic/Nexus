# PRD 14 — Import & Export (IMEX)

**Status:** draft 2026-07-05. Inputs: raw-spec §§18–19 (LLM import prompts —
"ne otkrivamo interne stvari"), SEC-DAR-02/03, SEC-EXT-02/03, module PRDs'
import/export hooks.

## 1. Purpose

Data freedom in both directions: full export is a product guarantee (vision
pillar — Nexus never holds data hostage), and import lowers the switching
cost from users' current tools. The signature v1 import mechanism is the
founder's **LLM prompt pack**: standardized prompts users run in any LLM to
convert their existing data into Nexus-compatible files.

## 2. User stories

- As a new user, I want to bring my existing notes/tasks/finance history,
  so that Nexus starts full, not empty.
- As any user, I want a one-click full export in open formats, so that my
  data is provably mine.
- As a non-technical user, I want a copy-paste prompt that makes ChatGPT
  format my messy data for Nexus, so that import doesn't require skills.

## 3. User experience & flows

**Import center:** per-area cards (Beleške, Taskovi, Finansije, Trening,
Ishrana, Učenje/Anki, Kalendar/ICS, Bookmarks) → each offers (a) direct file
import where a standard exists (md, CSV, ICS, .apkg, JSON) and (b) an **LLM
prompt**: copy prompt → paste into any LLM together with your data → save
returned file → drop into Nexus → validation → preview (what will be
created, collisions) → confirm. **Export center:** full export (everything)
or per-module; encrypted archive by default (SEC-DAR-02), plaintext with
explicit confirmation; private notes per PRIV-010.

## 4. Functional requirements

- **IMEX-001 (M)** Full export shall produce a single archive containing all
  user data in open formats (markdown for notes, JSON/CSV for structured
  data, original files for attachments, ICS for calendar) plus a manifest
  (schema version, counts); encrypted by default.
- **IMEX-002 (M)** Export shall be available regardless of sync state,
  subscription state (future), or verification state — always.
- **IMEX-003 (M)** Per-module export subsets (module PRDs define content).
- **IMEX-004 (M)** The import interchange format shall be a documented,
  versioned, module-scoped JSON schema — public by design and decoupled
  from internal storage (SEC-EXT-03: prompts reveal interchange format
  only, never internals).
- **IMEX-005 (M)** LLM prompt pack v1: Beleške, Taskovi, Finansije
  (transactions), Ishrana (meals/foods), Trening (workouts), Učenje
  (flashcards) — each prompt instructs any LLM to output valid interchange
  JSON from arbitrary user data, with in-prompt examples and validation
  rules.
- **IMEX-006 (M)** Every import shall be schema-validated (SEC-EXT-02:
  LLM output is untrusted input), then shown as a preview (items to create,
  duplicates detected, warnings) before anything is written; import runs as
  an atomic batch with one-click undo immediately after.
- **IMEX-007 (M)** Direct importers v1: markdown files/folder (→ NOTE),
  CSV (→ TASK, FIN with column mapping UI), ICS (→ CAL-008), Anki .apkg
  (→ STUDY-011), browser bookmarks HTML (→ READ when enabled).
- **IMEX-008 (S)** Duplicate detection per module (by external-id when
  present, else heuristic) with skip/merge choices in preview.
- **IMEX-009 (S)** Scheduled automatic local backup uses the IMEX-001
  format (SET-011 surfaces it) — one format for backup and export.
- **IMEX-010 (C)** Tool-specific import guides (Notion, Obsidian, Todoist,
  MyFitnessPal) — documentation + tuned prompts, not custom parsers.

## 5. Options & settings

Export encryption default (on); backup schedule (SET); import duplicate
policy default.

## 6. Integrations

Every module (import targets/export sources via a module IMEX contract:
schema fragment + validator + writer); PRIV (encrypted export path only);
AUTH (export offer before deletion); SET (backup panel); future AI module
replaces the copy-paste LLM step in-app (raw-spec: "kasnije ubacujemo naš
LLM"; the interchange format is the stable layer that makes this a drop-in).

## 7. Edge cases & error states

- LLM returns almost-valid JSON (trailing text, wrong enum) → tolerant
  parser attempts recovery, then a precise error report the user can paste
  back to the LLM to fix ("validation errors as re-prompt").
- Huge imports (10k items) → chunked with progress; failure mid-batch rolls
  back (atomicity per IMEX-006).
- Import collides with existing IDs → always new internal IDs; external-id
  kept for dedup only.
- Malicious import file (oversized, zip bomb in attachments, script in
  markdown) → SEC-FILE caps + sanitization apply to imports identically.
- Export with corrupted attachment blob → export completes, manifest lists
  the corrupt item explicitly (never silent omission).
- Restore of an export from a newer schema version → refused with message
  (forward-compat policy shared with SET-011 restore).

## 8. Acceptance criteria (key)

- Full export → fresh install → import round-trip reproduces the account
  (reference dataset; private notes restored via Recovery-Kit flow).
- Each v1 LLM prompt, run against a real messy sample in a mainstream LLM,
  yields JSON that validates and imports with correct preview counts.
- Deliberately corrupted LLM output produces a human-readable error report
  and imports nothing.
- CSV bank statement (Serbian bank sample) maps via column UI into FIN with
  amounts/dates/currencies correct.
- Import undo immediately after a 1k-item import leaves zero residue.

## 9. Open questions

1. Interchange schema versioning policy (semver + N-2 support proposed) —
   architecture ADR.
2. ~~Should exports include settings/flags?~~ **Decided (founder
   2026-07-05): yes, separate manifest section.**
3. ~~Prompt pack localization?~~ **Decided (founder 2026-07-05): prompts in
   en + sr from v1.**

## 10. Future extensions

In-app AI import assistant (drop any file, agent converts via interchange);
live migrations from cloud tools' APIs; automated backup to user's own
cloud (WebDAV/S3) — encrypted client-side.
