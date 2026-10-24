import type { Migration } from "./migrations.js";

/**
 * Migration 100 — the Gallery's profile-owned images.
 *
 * Pack and ZIM images are read-only sources and have no row here. This table is
 * only for images the user imports: metadata is profile data; the encrypted
 * original bytes live in the shared content-addressed blob store.
 */
export const migration100: Migration = {
  version: 100,
  up(db) {
    db.exec(`
      CREATE TABLE gallery_items (
        id             TEXT PRIMARY KEY,
        profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        title          TEXT NOT NULL,
        notes          TEXT NOT NULL DEFAULT '',
        tags_json      TEXT NOT NULL DEFAULT '[]',
        file_name      TEXT NOT NULL,
        mime           TEXT NOT NULL,
        size_bytes     INTEGER NOT NULL CHECK (size_bytes > 0),
        sha256         TEXT NOT NULL CHECK (length(sha256) = 64),
        thumbnail_mime TEXT NOT NULL,
        thumbnail_sha256 TEXT NOT NULL CHECK (length(thumbnail_sha256) = 64),
        thumbnail_size_bytes INTEGER NOT NULL CHECK (thumbnail_size_bytes > 0),
        width          INTEGER NOT NULL CHECK (width > 0),
        height         INTEGER NOT NULL CHECK (height > 0),
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        deleted_at     TEXT
      );
      CREATE INDEX gallery_items_profile_updated
        ON gallery_items(profile_id, deleted_at, updated_at DESC);
      CREATE INDEX gallery_items_sha
        ON gallery_items(sha256);
      CREATE INDEX gallery_items_thumbnail_sha
        ON gallery_items(thumbnail_sha256);
    `);
  },
};
