# ADR-068 — Explicit cloze numbering `{{c1::…}}` (NOTE-006's last exclusion; migration 047, interchange 1.26.0)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Replaces:** the
ADR-017 exclusion "explicit cloze numbering — until STUDY has a real cloze card
type there is nothing to number *for*". ADR-042 gave STUDY that card type, so
the reason expired.

## 1. The defect: position is not identity

Today a `{{…}}` deletion is identified by its **left-to-right position** —
`cloze_ordinal` is a 0-based index and note-derived cards are keyed by slot
(`key#0`, `key#1`, …). Insert a deletion in the middle of a sentence and every
later deletion shifts onto a different slot, so their FSRS review histories
silently swap onto different content. Nothing errors; the scheduling just quietly
becomes wrong. It is also the shape real Anki decks are written in, which the
`.apkg` importer has to flatten on the way in.

## 2. The grammar, and the one closed rule

A run's inner text may begin with an explicit label `c<digits>::` —
`{{c1::Beograd}}` is deletion **number 1** with answer `Beograd`. Unlabeled runs
keep working.

> **A deletion's number is its label when it has one, and otherwise
> `position + 1` counting all runs left to right.**

That rule is chosen so today's implicit reading and the explicit spelling of it
are *the same numbering* — which is exactly why materializing labels into an
existing text can never change a card's identity. It is stated in
`clozeText.ts`'s module doc because that module remains the single source of the
grammar; the four readers (editor decorations, the note-card generator,
`CardStore`'s re-derivation, the reviewer) import it back rather than re-parsing.

**Numbers are identity, and identity may repeat.** Two runs carrying the same
number are one card with two blanks — Anki's behaviour, and forced on us anyway
since a card is keyed by (text, number). So masking targets a *set* of runs, and
the reviewer's segment split emits a target segment for each. Labels need not be
contiguous or ordered; cards list in number order.

## 3. The storage rebase (migration 047) — the dangerous part

`cloze_ordinal` stops being a 0-based position and becomes the 1-based number.

- **`UPDATE`, never a table rebuild.** ADR-042 proved that rebuilding this table
  cascade-deletes all FSRS `review_log` history: the cascade fires inside the
  transaction `runMigrations` wraps each migration in, where `PRAGMA
  foreign_keys` is a no-op. A test pins that review history survives 047.
- **The note-derived card keys rebase in the same transaction.** If the ordinal
  moves and the key suffix does not, the next note sync sees unfamiliar keys and
  either duplicates every cloze card or orphans its history. The test that
  proves the migration is the one that syncs a note *after* it.

## 4. Interchange 1.26.0

The field's meaning changes, so the archive says so: an era flag in the
established writer-named style. A reader of one of our older archives (< 1.26.0)
upgrades 0-based ordinals on the way in; a 1.26.0 archive is taken verbatim. The
parser's existing rule — a cloze row whose ordinal its own template does not
contain is rejected with a line number — holds under the new numbering, and
`RestoreStore` and `ForeignImportStore` agree with the parser. The too-new
refusal fixtures move to 1.27.0.

## 5. The editor is where the feature actually pays off

- Decorations render a labeled run as its answer with its number visible —
  muted, typographic, no new colour values, no glow.
- **Inserting a new deletion assigns the next unused number in that text.** This
  is not a nicety: it is the mechanism by which histories stop moving. Adding a
  deletion to an existing unlabeled text materializes that text's labels, which
  the §2 rule makes safe by construction.
- The deck editor's cloze mode and the reviewer follow: all blanks of the target
  number mask together and reveal in place.
- The `.apkg` importer maps Anki's `cN` directly instead of flattening to
  position, repeated `cN` collapsing into one card, existing refusal tiers kept.

## 6. Consequences

- A text using no labels behaves exactly as before — same cards, same numbering
  modulo the +1 rebase, same rendering — and tests fail on any drift.
- Explicit numbering was also the recorded prerequisite for a faithful `.apkg`
  round trip; with it, the importer no longer loses Anki's own grouping.
- Nothing else in NOTE-006 remains excluded except the two deliberate ones: a
  cards panel inside the editor (it would duplicate STUDY's deck view) and
  structure-derived generation (which belongs with NOTE-007, the canvas pairing).
