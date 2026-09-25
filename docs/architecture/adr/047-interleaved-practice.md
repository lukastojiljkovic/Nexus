# ADR-047 — Interleaved practice (STUDY-010): mixed, randomized sessions over chosen decks

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:** STUDY-010 (PRD 15 §4)
**Builds on:** ADR-042 (cloze), ADR-046 (problem cards — which pre-committed that
"is a problem card" is `problem_steps IS NOT NULL` and that `dueQueue` gaining a
kind/steps predicate is this ADR's business).

## 1. What the PRD asks, read against what exists

PRD 15:75-76: *"Interleaved practice sets: user selects topics → mixed,
randomized problem-card session."* There is no `topics` table and never was; the
topic-shaped entity in the schema is the **deck** (a "thin subject-scoped
grouping", `decks.subject_id NOT NULL`). So "topics of a subject" is read as
**decks of a subject**, and STUDY-010 becomes: *from a subject, select decks →
one session that mixes their cards, randomized, optionally problems-only.*

Cross-deck queueing already exists (`dueQueue({subjectId})` and the unscoped
form). What is genuinely unbuilt is exactly three things, and this ADR ships all
three and nothing else:

- **selection** — a queue over an explicit set of decks (`deckIds`),
- **ordering** — interleave + randomization (nothing in the repo shuffles today),
- **kind predicate** — problems-only, per ADR-046's definition.

Out of scope, recorded: session caps and end-of-session summary (STUDY-009),
persisted session identity / study log (STUDY-014), per-deck retention
(STUDY-007). No schema change; no interchange change; no new dependencies.

## 2. The queue: two additive scope fields, one leak fixed

`DueQueueOptions` (db) and `ReviewQueueScope` (ipc) — hand-mirrored, and they
stay hand-mirrored (a shared-type extraction is its own chore, noted §7) — gain:

- `deckIds?: readonly string[]` — mutually exclusive with `deckId`/`subjectId`;
  the store now **enforces** "at most one scope" (the comment always claimed it;
  supplying two becomes an error, closing the silent `deckId`-wins preference).
  Validated: non-empty array, ≤ 100 non-empty strings. SQL: `AND deck_id IN
  (…)` against decks of the profile with `deleted_at IS NULL`.
- `problemsOnly?: boolean` — SQL `AND problem_steps IS NOT NULL`. Deliberately a
  boolean, not a kind vocabulary: `CardKind` is `"basic" | "cloze"` and a problem
  card IS basic, so `kind = ?` can never express it (ADR-046 §2).

Both apply to the due AND new sections. `newLimit` semantics unchanged.

**The leak fix (behaviour change, tested):** the unscoped due/new statements
never join `decks`, so cards of a soft-deleted deck still surface in an unscoped
queue (the subject-scoped and deck-scoped paths already filter). Fix with the
`statsStore` idiom (JOIN with `deleted_at IS NULL`) on the unscoped path.
Archived subjects stay INCLUDED in the unscoped queue: archiving hides surfaces,
and every queue the UI can launch is already scoped to a visible subject or deck
— recorded here so nobody re-litigates it.

The main-process handler extends its field-by-field validators in place
(SEC-EL): `deckIds` via the existing string-array validator pattern,
`problemsOnly` as a strict boolean, `now` still stamped in main.

## 3. Interleave: a pure core module, applied in the renderer

The store keeps returning its deterministic `ORDER BY due, id` rows — SQL does
not learn to shuffle. A new pure module `packages/core/src/study/interleave.ts`
(TDD) owns the arrangement:

```
interleavePractice(cards, deckOf, seed) → Card[]
```

- **Seeded PRNG** (mulberry32-style, implemented in the module — no dependency),
  seed minted once per session by the renderer. Same seed + same input = same
  order: the tests pin real arrangements, and a re-render never re-shuffles.
- **Per-deck shuffle, then round-robin merge** across decks. This is both the
  PRD's "randomized" and the pedagogy of "interleaved": round-robin guarantees
  no blocked runs of one deck (the failure mode of plain due-order, where batch
  creation stamps adjacent dues), and the per-deck shuffle randomizes within.
  Deck pick order per round is also seed-driven.
- New cards are interleaved WITH due cards in practice — the trailing-new rule
  is the ordinary reviewer's; in a practice set the mixing is the point (the
  primary use is "wrote 30 problems today, now practice them").

Applied client-side after the queue fetch, before the session materializes its
array. Undo is untouched: it unshifts onto the already-materialized queue, and
the arrangement never re-runs mid-session. Grading is untouched: FSRS is
card-id-keyed and deck-agnostic — practice IS review, grades schedule normally.

## 4. Entry point: a dialog, not a fourth route

The `route` union stays three-armed. The subject header gains **„Vežbaj"**
beside „Uči sve" (enabled by the existing `subjectHasStudiable` gate), opening a
house-recipe dialog (recur-dialog: overlay, backdrop, Escape, portal):

- checkbox rows for the subject's decks (Serbian-collated, as the hub lists
  them), each with its existing due/new counts from `countsByDeck`; all checked
  by default;
- a **„Samo zadaci"** toggle (unchecked by default — the PRD's problem-card
  reading is the headline use, but a mixed-kind practice over chosen decks is
  the same machinery and there is no reason to withhold it);
- **„Počni"**, disabled until ≥ 1 deck is checked.

Start = the existing `{kind:"review"}` arm with the widened scope plus a
renderer-only session config (seed, practice flag) that is NOT sent over IPC —
the preload payload carries only the fields `ReviewQueueScope` names.

## 5. The session: deck context, honest empty state, its own title

- Practice sessions title the topbar **„Vežbanje"** (the ordinary reviewer keeps
  „Učenje").
- **Per-card deck chip**: the session currently names no deck anywhere. When a
  session's scope spans more than one deck, each card shows a quiet chip with
  its deck's name — client-side Map-join from the subject's already-loaded deck
  list passed down as a prop (the ExamsWidget join idiom; the `Card` contract
  does not change).
- **`total === 0` is not "all done"**: a practice selection that yields nothing
  (e.g. „Samo zadaci" over decks with no problem cards) shows a dedicated line
  — „Nema kartica za vežbanje u ovom izboru." — with the back button, never the
  celebratory `reviewCompleteTitle`. (`DeckCounts` deliberately does NOT grow a
  kind breakdown for the dialog; the honest empty state is the cheap, complete
  answer.)

## 6. Copy (all in `strings.ts`, Serbian)

`study.practice`: `open` „Vežbaj" · `title` „Vežbanje" · `decksLabel` „Špilovi" ·
`problemsOnly` „Samo zadaci" · `start` „Počni" · `empty` „Nema kartica za
vežbanje u ovom izboru." · `close` „Otkaži". Exact final copy may be tuned at
implementation, but stays in this register.

## 7. Recorded consequences and non-goals

- `DueQueueOptions`/`ReviewQueueScope` duplication deepens by two fields;
  extraction into `packages/core/src/contracts/` is deliberately deferred.
- The at-most-one-scope enforcement is a (theoretical) breaking change to a
  store call nothing makes.
- The unscoped-leak fix changes unscoped-queue behaviour; no UI surface calls
  unscoped today, so the visible change is zero.
- Session identity, caps, summaries: STUDY-009/014's business, untouched.
