# ADR-046 — Problem cards: stepwise solutions without a third kind

**Status:** accepted · 2026-07-31 · **migration 033 reserved · interchange 1.12.0 reserved** (032/1.11.0 belong to ADR-045, in flight in parallel)
**Drives:** the problem half of STUDY-006 (PRD 15): "problem statement front;
worked solution back, optionally stepwise", LaTeX everywhere.

## Decision

### 1. No third `kind` — because the constraint AND the semantics both say so

Migration 031's CHECK (`kind IN ('basic','cloze')`) sits on an existing
column, and `cards` can never be rebuilt (the recorded FSRS-cascade/trigger
reasoning). But the deeper reason is semantic: **a problem card minus its
steps IS a basic card** — statement in `front`, worked solution in `back`.
"Problem" is not a third derivation regime the way cloze is; it is an
optional stepwise PRESENTATION of a basic card's solution. So:

- Migration **033**: `ALTER TABLE cards ADD COLUMN problem_steps TEXT NULL
  CHECK (problem_steps IS NULL OR (kind = 'basic' AND
  length(problem_steps) > 0))` — a legal CHECK on an added column; cloze
  rows can never carry steps.
- `kind` stays two values everywhere; the three redundant `CARD_KINDS`
  literals do not move.

### 2. Steps are the source; `back` is derived and kept (the ADR-042 invariant)

`problem_steps` holds the FULL solution text with an in-band step grammar,
and the store **re-derives `back` from it on every write** — the renderer
never sends `back` when steps are given, so the two cannot drift, and
search, the palette, the deck list, `dueQueue`, the CSV export and every
trigger keep reading a complete, readable solution with zero changes.
One pure core module, `packages/core/src/study/problemSteps.ts` (TDD),
owns the grammar for its every reader (editor count line, store
derivation, archive parser, reviewer): a step boundary is **a line
consisting of exactly `--`**; `splitProblemSteps(text)` returns trimmed
non-empty steps in order, `renderProblemBack(text)` joins them with blank
lines (markers stripped). One step is legal (stepwise reveal degenerates to
all-at-once); the text cap is the existing card cap, per column.

### 3. Store semantics

`CardStore`: `createProblem(deckId, front, stepsText, now)` (derives back,
validates under the existing caps); `resolveUpdatedContent`'s basic branch
also accepts `problemSteps` (string sets + re-derives back; `null` clears
steps and the card is a plain basic card again — allowed, since no kind
changed and the FSRS history still belongs to the same question); the cloze
branch refuses it by name. `Card`/`CardRow`/`CARD_COLUMNS`/`SourceCardRow`
and the three explicit-column statements gain the column; both apply
stores' explicit INSERT lists (`restoreStore`, `foreignImportStore`) gain
it too. `syncFromNote` specs do NOT carry it — see §6.

### 4. Reviewer: `revealed` generalizes from a boolean to a step count

`revealedSteps: number` replaces the boolean; basic and cloze cards have
exactly one step, so their behaviour is bit-identical. For a card with N
steps: Space/Enter reveals the next step (statement stays on screen; each
step renders through `MathText` — `$…$`/`$$…$$` just work); the grade keys
1–4 stay **inert until the last step is shown** (the existing
"grade only when revealed" rule, generalized — predictable, never a
"gave up" guess); `previewReview` fires when the final step lands (the
moment grading arms, exactly its current meaning); undo resets to zero
steps. The kind fork in the render gains a steps branch beside cloze's.

### 5. Editor: a third FORM, not a third kind

The segmented toggle (create only) gains „Zadatak": statement textarea +
solution textarea whose hint names the `--` separator, a live „N koraka"
count line (the `clozeCountLabel` recipe, `countUnit` agreement), and the
MathText preview the basic fields already have. Editing an existing basic
card shows the Zadatak form when steps exist, the Osnovna form otherwise —
and switching BETWEEN those two while editing is allowed (both are
`kind: 'basic'`; adding or clearing steps is a content edit, not an
identity change). Cloze stays fixed, as shipped.

### 6. Boundaries, recorded

- **No note syntax.** `parseCardBlock` stays closed at Q/A-then-cloze: a
  `::` inside a problem statement already means Q/A there, and ADR-017's
  same-identity-different-kind escape hatch remains if this is ever
  revisited. Problem cards are deck-editor-authored by construction.
- **Interchange 1.12.0:** `ExportCard` gains optional
  `problemSteps?: string | null` (absent/null = no steps — optional-with-
  default, NO era flag); the parser validates the pair rule (steps only on
  `kind === "basic"`, non-empty, under the cap) and re-runs the grammar for
  nothing (there is no ordinal to check — steps are self-contained).
  Too-new fixtures move to 1.13.0. CSV is untouched: `back` already carries
  the derived full solution.
- **STUDY-010** (interleaved problem sessions) is not built here; when it
  comes, "is a problem card" is `problem_steps IS NOT NULL`, and `dueQueue`
  gaining a kind/steps predicate is that ADR's business.

## Consequences

- Search and every export stay correct for free — the §2 invariant is doing
  the work, second time proving ADR-042's design right.
- A "problem without steps" is a basic card and the product says so —
  no phantom third identity to explain in the UI.
- Foreign import carries steps via the row spread; only the two explicit
  INSERT column lists need the column (recorded for the lane).
