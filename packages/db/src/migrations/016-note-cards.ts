import type { Migration } from "./migrations.js";

/**
 * Migration 16 — inline flashcards' storage hook (NOTE-006 slice a). A note's
 * own text can *author* flashcards (`Pitanje :: Odgovor`, `{{cloze}}`)
 * without a note-sourced card becoming a different kind of object — this
 * migration wires that into the existing STUDY schema instead of inventing a
 * parallel one.
 *
 * The reconcile identity is `(profile_id, source_note_id, source_block_key)`,
 * never a renderer-chosen `cards.id`: the renderer is untrusted (SEC-EL-02)
 * and must only ever name a *slot* — "this block, inside a note I already
 * own" — for `CardStore.syncFromNote` to resolve to a row, never a row's own
 * primary key.
 *
 * `cards_source_block` is a **partial** unique index
 * (`WHERE source_note_id IS NOT NULL`): every hand-made card has
 * `source_note_id IS NULL`, and a plain (non-partial) unique index would
 * collide every one of them against `(profile, NULL, NULL)` after the first.
 * Scoping the constraint to note-sourced rows only is what lets both kinds
 * of card share one table without a schema-level collision between them.
 *
 * Both new `cards` columns are nullable, added to the existing table rather
 * than living in a join table: a note-sourced card *is* an ordinary card —
 * `listByDeck`, `dueQueue`, `review`, every existing query over `cards` keeps
 * working untouched. A join table would mean teaching each of those queries
 * about a second place a card's front/back could live, for no benefit.
 *
 * `ON DELETE SET NULL` on both new foreign keys: hard-deleting a note (a
 * profile teardown; the same fate `note_attachments`/`note_versions` share)
 * must not take its generated cards' FSRS review history down with it — the
 * cards simply stop being "from" anything and become ordinary hand-made
 * cards. Symmetrically, `notes.card_deck_id` losing its deck on a deck
 * delete means "unmapped again", never a dangling reference or a deleted
 * note.
 *
 * `notes.card_deck_id` is a note's *only* deck selector: one note maps to at
 * most one deck, so choosing a deck for a note's cards is the entire
 * decision — there is no second field and no second source of truth to keep
 * in sync with it.
 */
export const migration016: Migration = {
  version: 16,
  up(db) {
    db.exec(`
      ALTER TABLE cards ADD COLUMN source_note_id   TEXT REFERENCES notes(id) ON DELETE SET NULL;
      ALTER TABLE cards ADD COLUMN source_block_key TEXT;

      CREATE UNIQUE INDEX cards_source_block
        ON cards (profile_id, source_note_id, source_block_key)
        WHERE source_note_id IS NOT NULL;

      ALTER TABLE notes ADD COLUMN card_deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL;
    `);
  },
};
