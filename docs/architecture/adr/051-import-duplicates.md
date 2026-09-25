# ADR-051 — Duplicate detection in the foreign-import preview (IMEX-008)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:** IMEX-008 (S),
qualifying ADR-043's "importing twice creates duplicates — deliberate" consequence:
that line stays true by DEFAULT, and the preview now names the duplicates and lets
the user skip them. **Also closes two latent identity defects the recon found.**

## 1. Scope: exact/strong identities only, four leaf types

There is no external-id substrate (zero hits repo-wide), so v1 is heuristic —
but only where the heuristic is honest, and only on LEAF rows (no cascade):

- **attachment rows** (note/task/subject) by **sha256** — exact; the bytes
  already dedup, the rows now can too;
- **events** by **(title, startAt, allDay)**;
- **people** by **(name, month, day)** — the fact is year-less by design;
- **documents** by **(docType, label)**.

Explicitly deferred with reasons recorded (so nobody relitigates): tasks
(repeated chores are legitimately identical), notes (title is fuzzy;
content-hash needs main-side Yjs decoding and target plaintext that a
never-compacted note does not have), lists/folders (ADR-043's „Posao" rule),
subjects/decks/exams/cards (container cascade — merge-not-skip territory, a
later ADR when containers are admitted).

## 2. The two defects, fixed in the same slice

1. **Note templates**: the DB holds UNIQUE (profile, name) but the planner
   plans them unconditionally → an archive carrying a name the target holds
   crashes the whole apply transaction into a generic error.
   `ForeignImportTarget` gains `noteTemplateNames`; the planner reuses the
   existing `template-name-taken` code as a third (code, module, type) line.
2. **Builtin default templates**: `note_folders.defaultTemplateId` may hold a
   `builtin:*` constant; `mapped()` throws on it and the whole PREVIEW fails.
   The remap becomes tolerant (`ctx.ids.get(id) ?? id`), matching ADR-036's
   "a dangling default means no template".

## 3. Mechanics

- **Granularity: per-TYPE** (per-module too coarse, per-row a checkbox wall).
  One choice per detected-duplicate type, default **Preskoči**.
- **Choices are exercised by a RE-PLAN, never by filtering at apply**: the
  cached plan stays the contract; a new `imex:import-replan` reuses the
  still-open archive's in-memory files (never asks the passphrase twice),
  re-reads the target, re-plans with the choices, mints a fresh token, returns
  a full `ImportPreview`. Apply is untouched — one token, one cached plan.
- **DODAJE stays inviolable**: no branch may UPDATE a pre-existing target row.
  „Uvezi svejedno" is today's behaviour verbatim; „Preskoči" removes rows.
- **Report arithmetic**: one new skip code `duplicate-of-existing`, grouped by
  the existing (code, module, type) mechanism — `parsed = imported + merged +
  skipped` balances by construction; `ImportModuleCounts` does not widen.
- **Merge (adopt-target-id) is NOT offered in v1**: for leaves it is
  behaviourally identical to skip (nothing points at them). Recorded: merge
  becomes real exactly when a container type is admitted, where it is the SAFE
  option because `mapped()` throws on unresolved references.
- **No default-policy setting** (PRD 14 §5's clause has no SET requirement);
  the per-import default is Preskoči, chosen in the preview each time.
  Recorded as deferred, not silently unimplemented.

## 4. UI

Inside the existing preview, above the skip list: one quiet row per detected
group — type label · count · the identity in words („isti naslov i vreme" /
„ista datoteka" / „isto ime i datum" / „ista vrsta i naziv") · a two-state
Preskoči / Uvezi svejedno control (verbs, not checkboxes). Changing a control
re-previews through the re-plan channel (the busy state exists). The
ImportRecordType-keyed identity vocabulary is a closed map in `strings.ts`
(`satisfies`), so a new identity is a compile error until copy exists.
