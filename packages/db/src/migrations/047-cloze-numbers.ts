import type { Migration } from "./migrations.js";

/**
 * Migration 47 — cloze deletions are numbered, not positioned (ADR-068).
 *
 * `cards.cloze_ordinal` stops being a 0-based POSITION in `cloze_text` and
 * becomes the deletion's 1-based NUMBER: the `{{cN::…}}` label a run declares,
 * or its position + 1 when it declares none. Every existing row is rebased by
 * exactly +1, which under that closed rule is the SAME deletion it already
 * asked about — no archive and no database written before this migration can
 * contain a label, because no build before it could write one.
 *
 * Why numbers: position is not identity. Inserting a deletion in the middle of
 * a sentence shifted every later deletion onto a different slot, and their FSRS
 * review histories with it — silently, onto content the user never studied
 * under them.
 *
 * **UPDATE only — never a table rebuild.** ADR-042 proved what a rebuild of
 * `cards` costs: `review_log` references `cards(id)` `ON DELETE CASCADE`, so
 * the implicit DELETE inside `DROP TABLE cards` takes every row of a user's
 * FSRS history with it, and `PRAGMA foreign_keys` is a NO-OP inside the
 * transaction `runMigrations` wraps each migration in, so it cannot be switched
 * off here. (A rebuild would also silently drop the three search-index triggers
 * of migration 017.) Nothing about this change needs one: migration 031's
 * `cloze_ordinal >= 0` CHECK still holds for every value written from here on —
 * a number is 1-based, so it is a strictly narrower domain — and "is this
 * number actually in this template" is enforced where it always was, by
 * `renderClozeCard` in `CardStore` and in the archive parser, which is the only
 * place the `{{…}}` grammar lives.
 *
 * **The key suffix rebases in LOCKSTEP.** A note-derived card's reconcile key
 * is `<block uuid>#<ordinal>` (`@nexus/core`'s `parseCardBlock`), and the
 * generator now writes `#<number>`. If the stored key kept the old suffix, the
 * very next sync of that note would see unfamiliar keys: every cloze card would
 * be soft-deleted and recreated from scratch, taking its review history with
 * it. So the suffix moves in the same transaction as the ordinal.
 *
 * The key rebase keys off the SUFFIX rather than off `cloze_ordinal`, and so
 * covers one row the ordinal cannot: a note-derived cloze card written before
 * migration 031 is still `kind = 'basic'` with a NULL ordinal (ADR-042's lazy
 * upgrade, which happens on its note's next sync) while already carrying a
 * `#0` key. Its slot has to move too, or that sync would find it under the
 * wrong name. A Q/A card's key has no `#…` suffix at all and is left alone.
 *
 * **Why three statements and not one.** `cards_source_block` is UNIQUE over
 * `(profile_id, source_note_id, source_block_key)`, and SQLite checks it per
 * ROW, mid-statement: moving `k#0` onto `k#1` while `k#1` still exists is a
 * constraint violation, whatever order the rows happen to be visited in. So the
 * keys are first parked in a namespace no real key occupies (`#~N`, and a key
 * is a uuid plus `#` plus digits), then the ordinals move, then the marker is
 * removed — by which time every `#N` slot has been vacated.
 */
export const migration047: Migration = {
  version: 47,
  up(db) {
    db.exec(`
      -- 1. Park every note-derived card's numeric key suffix at its new value,
      --    out of the way of the slot it is moving onto. The GLOB pair is
      --    "the suffix is a non-empty run of digits", which also proves there
      --    is no second '#' in it.
      UPDATE cards
         SET source_block_key =
               substr(source_block_key, 1, instr(source_block_key, '#'))
               || '~'
               || (CAST(substr(source_block_key, instr(source_block_key, '#') + 1) AS INTEGER) + 1)
       WHERE source_note_id IS NOT NULL
         AND instr(source_block_key, '#') > 0
         AND length(substr(source_block_key, instr(source_block_key, '#') + 1)) > 0
         AND substr(source_block_key, instr(source_block_key, '#') + 1) NOT GLOB '*[^0-9]*';

      -- 2. The rebase itself: position -> number, on every cloze row there is.
      UPDATE cards SET cloze_ordinal = cloze_ordinal + 1 WHERE cloze_ordinal IS NOT NULL;

      -- 3. Unpark. Every '#N' slot is free by now, so this cannot collide.
      UPDATE cards
         SET source_block_key =
               substr(source_block_key, 1, instr(source_block_key, '#'))
               || substr(source_block_key, instr(source_block_key, '#') + 2)
       WHERE source_note_id IS NOT NULL
         AND instr(source_block_key, '#') > 0
         AND substr(source_block_key, instr(source_block_key, '#') + 1, 1) = '~';
    `);
  },
};
