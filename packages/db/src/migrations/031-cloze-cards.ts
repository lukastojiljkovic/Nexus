import type { Migration } from "./migrations.js";

/**
 * Migration 31 — first-class cloze cards (STUDY-006 / ADR-042). Three columns
 * on `cards`, no new table: a cloze card IS an ordinary card, exactly as
 * migration 016 argued for note-sourced ones. `listByDeck`, `dueQueue`,
 * `review`, the search-index triggers of migration 017 and every export that
 * reads `front`/`back` keep working untouched, because a cloze row KEEPS its
 * rendered sides — the masked front and the fully-unwrapped back — beside the
 * template they came from.
 *
 *  - `kind` — `'basic'` or `'cloze'`. NOT NULL with a `'basic'` default, so
 *    every card that existed before this migration becomes exactly what it
 *    already was, with no backfill and no ambiguous NULL to interpret. Cards a
 *    note generated from `{{…}}` syntax are `'basic'` until their note next
 *    syncs, which upgrades them in place with their FSRS history intact
 *    (ADR-042 section 3) — a lazy migration, deliberately, because rewriting
 *    every row here would need this file to re-implement the `{{…}}` grammar
 *    that lives in `@nexus/core`.
 *  - `cloze_text` — the raw template with its `{{…}}` runs, the SOURCE the
 *    sides are derived from. It is the template and not the sides that the
 *    user edits, and it is what the reviewer needs to show the blank in its
 *    context and then the answer in the blank's place.
 *  - `cloze_ordinal` — which deletion of `cloze_text` this row asks. 0-based
 *    POSITION as this migration wrote it; migration 047 rebased every value
 *    onto the deletion's 1-based NUMBER (ADR-068), which is what it means from
 *    there on. The `>= 0` CHECK below still holds — a number is a strictly
 *    narrower domain — and "this number is really in this template" stays where
 *    it always was, in `@nexus/core`'s grammar.
 *
 * The pair invariant — both NULL for `'basic'`, both set for `'cloze'`, the
 * ordinal never negative — is expressed as real CHECK constraints rather than
 * left to the store, because an archive restore writes these columns directly
 * and a half-set pair would be a card that renders a blank nothing can fill.
 *
 * **Why `ALTER TABLE ADD COLUMN` and not the table rebuild migration 021
 * used.** A rebuild is how SQLite changes a CHECK on an EXISTING column, and
 * `cards` cannot afford one: `review_log` references `cards(id)` `ON DELETE
 * CASCADE`, so the implicit DELETE inside `DROP TABLE cards` would take every
 * row of a user's FSRS review history with it — and `PRAGMA foreign_keys` is a
 * no-op inside the transaction `runMigrations` wraps each migration in, so it
 * cannot be switched off here. `cards` also carries the three search-index
 * triggers of migration 017, which a rebuild would silently drop. None of that
 * is needed: SQLite accepts a CHECK on an added column, including one that
 * reads the table's other columns, and applies it to every row written from
 * here on. Existing rows are not re-checked — correctly, since the `'basic'`
 * default already satisfies all three constraints for every one of them.
 */
export const migration031: Migration = {
  version: 31,
  up(db) {
    db.exec(`
      ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'basic'
        CHECK (kind IN ('basic', 'cloze'));

      ALTER TABLE cards ADD COLUMN cloze_text TEXT
        CHECK ((kind = 'cloze') = (cloze_text IS NOT NULL));

      ALTER TABLE cards ADD COLUMN cloze_ordinal INTEGER
        CHECK (((kind = 'cloze') = (cloze_ordinal IS NOT NULL))
               AND (cloze_ordinal IS NULL OR cloze_ordinal >= 0));
    `);
  },
};
