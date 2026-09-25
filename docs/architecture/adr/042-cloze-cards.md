# ADR-042 — First-class cloze cards (STUDY-006) · migration 031 · interchange 1.10.0

**Status:** accepted · 2026-07-30
**Drives:** the cloze half of STUDY-006 (PRD 15 §Flashcards). NOTE-006/ADR-017
already turns `{{…}}` in a note into working cards by rendering each deletion
into plain front/back at generation time — the note side is finished. What
this ADR adds is the **first-class kind**: its own column, a reviewer that
shows the blank in context and the answer in place, manual cloze authoring in
the deck editor, and the storage shape `.apkg` round-tripping (STUDY-011,
later, with IMEX) requires. Problem cards stay their own item.

## Decision

### 1. The template is the source; the rendered sides are derived — and kept

Migration **031** adds to `cards`:

- `kind TEXT NOT NULL DEFAULT 'basic' CHECK (kind IN ('basic','cloze'))`
- `cloze_text TEXT NULL` — the raw template with its `{{…}}` runs
- `cloze_ordinal INTEGER NULL` — which deletion this row asks
- CHECKs: basic ⇒ both null; cloze ⇒ both set, ordinal ≥ 0.

A cloze card **keeps** rendered `front`/`back` (masked front, fully-unwrapped
back), derived from the template by ONE pure helper — so the search index's
card projection, the palette's snippets, the deck list rows and the export
preview all keep working **untouched**, with no re-projection and no trigger
change. Coherence is enforced structurally: on every cloze write the store
**re-derives front/back itself** from `(cloze_text, cloze_ordinal)` — the
renderer never sends sides for a cloze card, so template and rendering cannot
drift by construction.

### 2. One grammar, extracted (pure core, TDD)

`packages/core/src/study/clozeText.ts`: the run-finding and side-rendering
currently private to `noteCards.ts` (`findClozeRuns`, the mask/unwrap
renderer) moves here and is exported; `noteCards.ts` imports it back, so the
editor's decorations, the note generator, the store's re-derivation and the
reviewer all read the **same** `{{…}}` grammar from one module. The mask is
rendered as `[…]` in derived text exactly as today.

### 3. Store semantics (`CardStore`, TDD)

- `createCloze(deckId, text, now) → Card[]` — ONE transaction, one row per
  deletion, in ordinal order (atomic siblings); refuses a text with zero
  deletions (nothing to ask is not a card) and re-validates length under the
  existing card cap.
- `update` on a cloze card accepts `clozeText` and re-derives that row's own
  sides; it **refuses** a new text in which this row's ordinal no longer
  exists (a card must not silently die under an edit), and refuses direct
  `front`/`back` writes on kind `cloze` (they are derived). Basic cards are
  untouched.
- Siblings are independent rows after creation — editing one edits one. The
  Anki convention (editing a cloze note rewrites all siblings) is deliberately
  NOT copied: Nexus's unit is the card row, and linked-sibling editing would
  need a parent entity nothing else wants. Recorded as a divergence.
- `syncFromNote`: the spec (`ParsedCard`/`NoteCardSpec`) gains
  `kind`/`clozeText`/`clozeOrdinal`; reconcile identity (the block key +
  `#ordinal` suffix) is **unchanged**, and the no-op/update comparison now
  includes the new fields. Existing note-derived cloze rows therefore upgrade
  **in place, lazily, on the next sync of their note** — FSRS state untouched,
  no migration backfill (the templates live in note text the migration cannot
  see). Recorded: until a note is next opened, its cloze cards review as the
  basic cards they already were.

### 4. The reviewer shows the blank — and the answer — in context

For kind `cloze`, the review surface renders `cloze_text` with this row's
ordinal masked as a token-styled blank chip and every other run unwrapped;
on reveal, the **same line** renders with the answer in place, emphasized
typographically (accent + weight — the house active recipe, no glow), so the
context never leaves the screen and the user is never left hunting for which
blank was asked. Rendering composes with `MathText` unchanged (the pure
helper returns plain strings; LaTeX inside a deletion just works). Grading,
keyboard model and FSRS are card-kind-agnostic and untouched.

### 5. Deck editor: manual cloze authoring

The create form gains a segmented Osnovna/Cloze toggle. Cloze mode is one
textarea plus a live line naming how many cards the text currently makes
(„3 praznine → 3 kartice"), with creation disabled at zero; submitting calls
`createCloze` and lands N siblings. Editing an existing cloze card edits its
template in the same textarea (its ordinal fixed, per §3). Serbian copy in
`strings.ts`.

### 6. IPC and interchange

- New channel `cards:create-cloze` (`deckId`, `text`; per-field validated,
  caps imported); `cards:update` gains optional `clozeText`. One frozen
  preload method per channel, SEC-EL as everywhere.
- Interchange **1.9.0 → 1.10.0**: `ExportCard` gains optional `kind`
  (absent = `basic` — an optional-with-default needs **no era flag** by the
  ADR-028 rule; a PRESENT key is strict) and the pair
  `clozeText`/`clozeOrdinal`, required together exactly when
  `kind === "cloze"`, with the parser re-running the grammar to check the
  ordinal actually exists in the text. Restore writes them through; too-new
  refusal fixtures move to `1.11.0`.

## Consequences

- `.apkg` import (STUDY-011) now has a faithful target shape: Anki's
  cloze note + ord maps onto `cloze_text` + `cloze_ordinal` per sibling.
- The search index deliberately keeps indexing the RENDERED sides — a cloze
  card is findable by its visible text, and the `{{…}}` markers never leak
  into search.
- A hand-made cloze card and a note-derived one are the same shape; only
  `sourceNoteId`/`sourceBlockKey` tell them apart, exactly as with basic
  cards.
