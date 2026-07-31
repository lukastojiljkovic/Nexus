import type { Migration } from "./migrations.js";

/**
 * Migration 40 — a profile's picture (SET-001). Three nullable columns on
 * `profiles` itself, not a table of its own: a picture is one fact about one
 * profile, exactly as its `name` is, and a side table keyed by `profile_id`
 * with at most one row would be a join to say what a column already says.
 *
 * The SHAPE is migration 030's background trio, moved onto the profile row —
 * hash, mime, size — and for the same three reasons. The image itself is NOT
 * stored here: it is an ordinary entry in the existing content-addressed,
 * encrypted blob store (ADR-014/019), so a personal photograph gets SEC-DAR's
 * at-rest guarantees for free and a picture that happens to be byte-identical
 * to an attachment is one file on disk. What this table holds is the CHOICE:
 * which hash, served as which mime, at which size.
 *
 * `picture_mime` is the main-process `sniffMime` result taken from the bytes
 * main itself produced (SEC-FILE-02) — never inferred from a file name, and
 * never a claim the renderer made, which for this feature it structurally
 * cannot: the renderer never handles the image at all (see
 * `main/profilePicture.ts`). `picture_size_bytes` rides along for the reason
 * `dashboard_settings.background_size_bytes` does: an archive's binary
 * inventory declares every blob by hash AND size, and a hash with no size
 * would make that inventory only partly true.
 *
 * Three CHECKs, mirroring migration 030's line for line — each one a rule the
 * store also enforces, because a CHECK is what holds when a row arrives
 * through a restore rather than through the store: the three columns are all
 * null (no picture) or all set, since a hash without a mime is a blob nothing
 * can decide how to serve, and a stored size is always positive.
 *
 * Added by `ALTER TABLE ADD COLUMN` rather than by a table rebuild: all three
 * are nullable with no default, so every existing profile gains "no picture",
 * which is exactly what every profile had. The two CHECKs that span the trio
 * hang off the LAST column added — they can only be parsed once every column
 * they name exists — and SQLite applies a CHECK added this way to rows written
 * from here on, which is all that is needed when every pre-existing row already
 * satisfies it by being entirely null.
 *
 * `profiles_picture` covers the reverse lookup main's blob reference count and
 * its mime resolver both run — "does any profile still name this hash" — the
 * same shape `dashboard_settings_background` has, and needed for the same
 * reason: `profiles` is now a member of the one union that decides whether a
 * blob is orphaned.
 */
export const migration040: Migration = {
  version: 40,
  up(db) {
    db.exec(`
      ALTER TABLE profiles ADD COLUMN picture_hash TEXT;
      ALTER TABLE profiles ADD COLUMN picture_mime TEXT
        CHECK ((picture_hash IS NULL) = (picture_mime IS NULL));
      ALTER TABLE profiles ADD COLUMN picture_size_bytes INTEGER
        CHECK ((picture_hash IS NULL) = (picture_size_bytes IS NULL)
               AND (picture_size_bytes IS NULL OR picture_size_bytes > 0));

      CREATE INDEX profiles_picture ON profiles (picture_hash);
    `);
  },
};
