import type { Migration } from "./migrations.js";

/**
 * Migration 86 - the READER module's storage (ADR-100).
 *
 * **Four tables, and none of them holds a pack's content.** What a pack contains
 * lives in `<userData>/packs` (ADR-091) and is not this profile's data at all:
 * the Reader stores only what a PERSON wrote while reading - where they stopped,
 * what they bookmarked, what they noted beside a bookmark, how large they want
 * the type, and which safety notices they have acknowledged.
 *
 * `reader_positions` is one row per (profile, pack), keyed by the pair rather
 * than by a surrogate id, because "where I am in this book" IS that pair: a
 * second row for one pack is a second answer to the same question. The value is
 * the article's path inside the pack, which is the pack's own identity for an
 * article - a pack that renames a file loses the position for that file, and that
 * is honest rather than a guess (the manifest's paths are the pack's identity
 * everywhere else too).
 *
 * `reader_bookmarks` is one row per (profile, pack, article), enforced by a
 * UNIQUE index rather than left to the store: two bookmarks on one article are
 * one bookmark the user cannot tell from the other, which is `timers_presets`'
 * argument one module over. `note` is the optional sentence beside it, capped and
 * defaulting to empty, so "bookmarked, no note" is one shape rather than a NULL
 * that every reader has to decide about.
 *
 * `reader_settings` holds the module's one preference per profile - the reading
 * size, one of three named steps - and `reader_acknowledged` records the packs
 * whose safety notice this profile has accepted. That one is a table rather than
 * a column because the acknowledgement is per PACK: a profile that read the
 * survival handbook's notice has not thereby acknowledged the laws'.
 *
 * **Hours of `typeof(x) = 'integer'` care are not needed here**: nothing in this
 * module counts, and every value is text. The text-size CHECK pins the three
 * steps the UI offers, so a fourth cannot arrive without a migration that says
 * so.
 *
 * Plain `CREATE TABLE` for all four: nothing references them, so a later column
 * may still land by `ALTER TABLE ... ADD COLUMN` (ADR-042).
 */
export const migration086: Migration = {
  version: 86,
  up(db) {
    db.exec(`
      CREATE TABLE reader_positions (
        profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        pack_id      TEXT NOT NULL CHECK (length(pack_id) > 0 AND length(pack_id) <= 64),
        article_path TEXT NOT NULL
                       CHECK (length(article_path) > 0 AND length(article_path) <= 240),
        updated_at   TEXT NOT NULL,
        PRIMARY KEY (profile_id, pack_id)
      );

      -- "This profile's positions", which is the only read there is.
      CREATE INDEX reader_positions_profile ON reader_positions (profile_id);

      CREATE TABLE reader_bookmarks (
        id           TEXT PRIMARY KEY,
        profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        pack_id      TEXT NOT NULL CHECK (length(pack_id) > 0 AND length(pack_id) <= 64),
        article_path TEXT NOT NULL
                       CHECK (length(article_path) > 0 AND length(article_path) <= 240),
        -- The optional note. Empty is the absence of one, and 500 characters is
        -- a sentence about a page rather than a second article.
        note         TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      -- One bookmark per article; see this file's own doc.
      CREATE UNIQUE INDEX reader_bookmarks_article
        ON reader_bookmarks (profile_id, pack_id, article_path);

      -- This profile's bookmarks in one pack, in the order a list draws them.
      CREATE INDEX reader_bookmarks_profile
        ON reader_bookmarks (profile_id, pack_id, article_path);

      CREATE TABLE reader_settings (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        text_size  TEXT NOT NULL CHECK (text_size IN ('s', 'm', 'l')),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE reader_acknowledged (
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        pack_id         TEXT NOT NULL CHECK (length(pack_id) > 0 AND length(pack_id) <= 64),
        acknowledged_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, pack_id)
      );
    `);
  },
};
