# ADR-017 — Inline flashcards (NOTE ↔ STUDY)

**Status:** accepted · 2026-07-25.
**Drives:** NOTE-006 (PRD 09: "`::` and `{{…}}` markers create STUDY cards
linked to the note and subject (mapping UI on first use); **editing the note
text updates the card**") and STUDY-008 ("cards link back to their source
note/section when created inline"). Research §2 names the RemNote pattern as
the all-in-one advantage: the card is created where the knowledge is written,
not retyped afterwards.

## Context

Two finished subsystems have to meet:

- **NOTE.** A note is a Yjs document (ADR-012) — an update log plus a merged
  snapshot, edited through TipTap's Collaboration binding, flushed to main on
  an 800 ms debounce. The renderer already derives two things from the live
  doc inside that flush: the title, and the outbound wiki-link id set
  (`collectNoteLinkIds`, reported through `setNoteLinks` only when it changed).
- **STUDY.** `cards` is a row per flashcard with one column per `ts-fsrs`
  field, plus `front`/`back`. Every card belongs to a deck, every deck to a
  subject. Review history lives in `review_log`, which cascades from the card.

NOTE-006 is a **projection**: the note is the author, the card table is the
projection, and the projection has to survive editing. That single requirement
— *editing the note text updates the card, not replaces it* — decides the whole
design, because updating rather than replacing means every generated card needs
an identity that outlives every edit to its text.

## Decision

### Identity lives in the document, not in the text

A card-bearing block carries a **`cardKey`** attribute: an opaque
`crypto.randomUUID()` assigned by the editor, stored in the Yjs document like
any other block attribute, and never derived from the block's content.

That key is not the card's primary key. The reconcile key is the triple
`(profile_id, source_note_id, source_block_key)`, and main still mints
`cards.id` with `uuidv7()` as it does for every other card. The renderer names
a slot inside one note; it never names a row.

```sql
-- migration 016
ALTER TABLE cards ADD COLUMN source_note_id   TEXT REFERENCES notes(id) ON DELETE SET NULL;
ALTER TABLE cards ADD COLUMN source_block_key TEXT;
CREATE UNIQUE INDEX cards_source_block
  ON cards (profile_id, source_note_id, source_block_key)
  WHERE source_note_id IS NOT NULL;

ALTER TABLE notes ADD COLUMN card_deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL;
```

Three nullable columns on two existing tables, in the shape migration 011
already used to add `folder_id` to `notes`. Nothing existing changes: every
current query over `cards` is unaffected because a hand-made card simply has
`source_note_id IS NULL`, and the new UNIQUE index is partial so those rows do
not collide on `(profile, NULL, NULL)`.

**Rejected — scan the text, match by content.** No document attribute: derive
the card's identity from a hash of its front, or from its ordinal position in
the note. Both fail the one requirement that matters. A content hash means
editing the front *replaces* the card and discards its FSRS history — exactly
the behaviour NOTE-006 exists to avoid. A positional index means inserting a
paragraph above a card silently re-points every card below it at the wrong
review history. Identity has to be stored, and the only place that survives
arbitrary editing is the document itself.

**Rejected — let the renderer choose `cards.id`.** Tempting (no join, no
suffix arithmetic, the doc holds the row's real id), but it hands an untrusted
process the primary key of a table it does not own: a renderer could name an
existing card's id and steer an unrelated row's content through the sync path.
Defending that needs a conditional upsert whose WHERE clause is the only thing
standing between two profiles' cards. A per-note opaque key needs no defence —
it is meaningless outside its `(profile, note)` scope.

### One parser, two callers

The syntax is text, and the rules are pure. `@nexus/core` owns them:

```ts
export function parseCardBlock(text: string): ParsedCard[];   // one block's text
export function collectNoteCards(doc: Y.Doc): NoteCardSpec[]; // the whole document
```

- **Q/A — `Front :: Back`.** The separator is `::` **surrounded by whitespace**.
  That single rule is what keeps `std::vector`, `Foo::bar`, and every other
  scope-resolution operator out of the card table — a non-negotiable detail in
  a codebase whose author writes C++ in his notes. Split at the first
  qualifying separator; both sides must be non-empty after trimming, so a
  half-typed `Pitanje ::` is simply not yet a card.
- **Cloze — `{{…}}`.** Every non-empty `{{…}}` span in a block produces one
  card. For the *i*-th span: **front** is the block's text with that span
  replaced by `[…]` and every other span unwrapped (Anki's behaviour — only the
  target is hidden); **back** is the block's text with all braces stripped.
  Cards from the same block get keys `key#0`, `key#1`, … — the ordinal is a
  suffix on `source_block_key`, so the identity is the *slot*, not the phrase.
  Adding a deletion in the middle of a sentence therefore shifts the later
  slots' content; that is a consequence, and it is why explicit Anki-style
  `{{c1::…}}` numbering exists. Recorded below as future work.
- **`::` wins.** A block containing both is a Q/A block; its braces stay
  literal text. Mixing is not meaningful and nothing is silently rewritten.
- **`codeBlock` is never scanned.** Code is code.
- **Length.** A side over `NOTE_CARD_MAX_TEXT_LENGTH` (10 000, `CardStore`'s
  existing cap) means the block yields **no card** — a 10 000-character
  flashcard is not a flashcard, and refusing it in the parser means the block
  also loses its card styling, so the user *sees* that it is not a card rather
  than watching a save fail. A note yields at most `NOTE_CARDS_MAX_COUNT` (500)
  cards, mirroring `NOTE_LINKS_MAX_COUNT`.

`parseCardBlock` has exactly two callers, and they are the reason it is pure:
the **editor's decoration plugin** (renderer, over the ProseMirror doc, on
every transaction) and **`collectNoteCards`** (over the Y.Doc, in the flush
prologue). What the user sees highlighted and what gets persisted as a card are
the same function's output — they cannot drift.

### Cloze deletions are rendered into front/back; the cloze *card type* is not this feature

`cards` stores basic front/back only (STATUS §4: cloze and problem card types
are unbuilt). A cloze marker in a note produces a **real, reviewable card
today** by rendering the deletion into front/back at generation time. The note
is the source of truth for the text; the row is the render.

This is not a shortcut around STUDY-006. A first-class cloze card *type* —
its own `kind`, a reviewer that shows the blank in context, `.apkg`
round-tripping — is STUDY work with its own UI and IMEX surface, already
recorded as unbuilt. When it lands, the generator writes the same rows with a
different `kind` under the same identity, and nothing about the note side
changes. Choosing the other order would mean building a STUDY card type before
anything produces one.

### The note→deck mapping: one deck per note

`cards.deck_id` is NOT NULL, so cards need a deck before they can exist. The
mapping is **per note**, stored in `notes.card_deck_id`, chosen in the editor
the first time a note contains card syntax (PRD 09: "mapping UI on first use").
A deck belongs to a subject, so picking a deck picks the subject — there is no
second selector and no second source of truth.

Until a deck is chosen, the syntax is highlighted and parsed but nothing is
persisted; the editor says so in one line, with the picker in it. This is the
honest state: the user has written cards, and Nexus needs to know where they
go. Cards never land in an invented deck.

### Sync: the wiki-link report, again

Card sync is the third derivation in the same flush prologue, deliberately
built to the shape NOTE-004b already established and proved:

1. Derive `collectNoteCards(doc)` **synchronously, before any await** — the
   cleanup flush on unmount runs while the doc is still alive but resolves
   after it is destroyed. (This exact class of bug was caught in review in
   NOTE-004b; the link collector's comment records it.)
2. Persist the content first. Card sync happens after, and its failure is
   logged, never surfaced as a save error — the document itself is already
   safe.
3. Send only when the set changed since the last successful send, compared
   field-for-field over the ordered spec list.
4. Choosing a deck for the first time syncs immediately rather than waiting for
   the next keystroke.

### Reconciliation

`CardStore.syncFromNote(noteId, deckId, specs, now)` — one transaction, four
rules over the specs of exactly this note:

| Doc | Row | Action |
|---|---|---|
| key present | none | **create** — a fresh FSRS card in the note's deck |
| key present | active | **update** `front`/`back` if changed; FSRS state untouched |
| key present | soft-deleted | **restore + update** |
| key absent | active | **soft delete** — `review_log` survives |

Rule 3 is what makes editor undo work: undoing a deleted paragraph brings back
the same `cardKey`, and the card returns with its history. It is unambiguous
only because STUDY does not offer a competing delete — see below.

**Rejected — clear `cardKey` when the syntax disappears.** It makes "has a key"
and "is a card" the same predicate, which is tidy, but it destroys history on a
transient edit: deleting the `::` for one keystroke past the debounce would
soft-delete the card, and retyping it would mint a *new* key and a *new* card.
Keys are therefore permanent once assigned, and "is currently a card" is
answered by the parser through decorations — derived state, recomputed on every
transaction, never stored.

**Rejected — cascade the note's soft delete into its cards.** Trashing a note
leaves its cards alone, matching what the same path already does with the
note's attachments. A card is study material with its own review history; the
note going to the trash does not unlearn it. STUDY renders an unresolvable
source in the muted "missing" style the wiki-link chip already uses.

### The document plugins

One TipTap extension, `NoteFlashcard`, with two clearly separated jobs:

- **A document plugin** (`appendTransaction`) assigns a `cardKey` to any block
  that currently parses as a card and has none, and **re-keys duplicates** —
  copy-pasting a card block otherwise produces two blocks claiming one slot,
  and the second would silently never become a card. Assignment lives here, not
  in an input rule, so the invariant holds however the text arrived: typed,
  pasted, imported, or produced by a template.
- **A view plugin** (decorations) styles what the parser found: the card block
  gets an accent left rule, the `::` separator and each `{{…}}` span get their
  own inline decoration. Decorations only — no glow, no node view, nothing
  written to the document.

### STUDY: one source of truth

`Card` gains `sourceNoteId` / `sourceBlockKey` end to end (store → IPC → UI).
In the deck's card list, a note-sourced card:

- shows a chip naming its source note, which **opens that note** (STUDY-008's
  "link back"); an unresolvable note renders muted and inert, exactly like a
  broken wiki-link;
- does **not** offer edit or delete. Its text is owned by the note, and the
  next sync would overwrite an edit or resurrect a delete. Rather than let
  STUDY pretend otherwise, the affordances are replaced by the link to where
  the text actually lives.

Cross-module navigation (STUDY → the note) is the first deep link in the app:
`App` holds a pending note target beside the active module id, and `NotesPage`
selects it on arrival. `NotificationCenter`'s `onNavigate` already switches
modules; this extends the same idea with a payload.

## Slices

- **006-a — core + db.** `parseCardBlock` / `collectNoteCards` (TDD); migration
  016; `NoteMeta.cardDeckId` + `NoteStore.setCardDeck`; `Card.sourceNoteId` /
  `sourceBlockKey` + `CardStore.syncFromNote` (TDD).
- **006-b — IPC.** `notes:cards-sync`, `notes:card-deck-set`; the two new
  `Card` fields and `NoteMeta.cardDeckId` on the wire.
- **006-c — editor.** The `NoteFlashcard` extension, its CSS, the deck-mapping
  bar, and the sync step in the flush.
- **006-d — STUDY.** The source chip, the withdrawn edit/delete affordances,
  and the STUDY → note deep link.

## Explicitly not in v1

**Explicit cloze numbering (`{{c1::…}}`).** Anki's answer to the slot-shift
consequence above, and the shape `.apkg` import will need. Until STUDY has a
cloze card type there is nothing to number *for*.

**A cards panel in the editor.** The note shows which blocks are cards through
their styling; the deck bar names the deck and the count. A full per-note card
list with due dates would duplicate STUDY's deck view inside NOTE.

**Cards from headings/sections and "turn this checklist into cards".**
Generation beyond the two documented markers is a separate feature; NOTE-007
(note → canvas) is where structure-derived generation belongs.

## Consequences

- The card table gains a second author. Every note-sourced row is
  authoritative-elsewhere, and the UI has to say so — which is why STUDY's
  edit/delete withdraw rather than warn.
- Notes and cards now reference each other's tables. Both stores validate the
  other module's foreign key with a profile-scoped existence check, exactly as
  `CardStore` already does for `decks` and `subjects`; the FK alone does not
  enforce the profile.
- Card sync only runs while the note is open. A note edited on another device
  (post-sync) reconciles when it is next opened — acceptable, and the same
  property the wiki-link index already has.
- `$…$` math in a note block flows into the card unchanged and renders through
  the existing `MathText` reviewer path. Nothing was needed for that; it falls
  out of storing the text as written.
