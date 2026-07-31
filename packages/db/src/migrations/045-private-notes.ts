import type { Migration } from "./migrations.js";

/**
 * Migration 45 — private notes (PRIV v1, ADR-057). Three tables, and the
 * narrowest cleartext surface in the schema: **ids and timestamps ONLY**.
 * Everything else about a private note — its title, its body, its attachment
 * list — lives inside `sealed`, one opaque NXP1 container per row
 * (`@nexus/core`'s `privEnvelope.ts`), opened only while the profile's PRIV
 * DEK is held in the main process's memory. There is deliberately no title
 * column, no FTS row, no attachment table: nothing about a private note may
 * exist in the database in queryable form (SEC-ZK-05).
 *
 * No soft delete, deliberately: deleting a private note is a HARD delete. An
 * undo bar holding sealed bytes whose key may re-lock mid-undo is a promise
 * the app cannot keep, so it does not make it.
 *
 * `private_note_versions` keeps up to 20 sealed containers per note (the cap
 * is `PrivateNoteStore`'s, evicted oldest-first in the same transaction as
 * each insert); `seq` is the very sequence number the container's AES-GCM AAD
 * binds, which is what makes a version row unswappable and unrollbackable
 * (see `privEnvelope.ts`'s module header).
 *
 * `private_settings` holds the per-profile key chain (ADR-057 §4): the KDF
 * parameters, the credential wrap, and — optionally, both-or-neither by CHECK
 * — the Recovery Kit wrap, plus the two lock preferences the CHECKs bound
 * exactly as `PrivateSettingsStore` re-validates them. The wraps are TEXT the
 * store treats as opaque; only `apps/desktop/src/main/priv.ts` ever reads
 * meaning into them.
 *
 * All three tables are EXCLUDED from `RESTORE_WIPE_TABLES` — see the
 * exemption comment in `restoreStore.test.ts`: slice d (interchange) decides
 * how private notes travel, and until then a restore of any archive must not
 * destroy sealed rows it knows nothing about.
 */
export const migration045: Migration = {
  version: 45,
  up(db) {
    db.exec(`
      CREATE TABLE private_notes (
        id         TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        sealed     BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- The list screen's one query: this profile's notes, newest-touched
      -- first. Covers everything list() reads, so the sealed blobs never
      -- ride along.
      CREATE INDEX private_notes_profile_updated
        ON private_notes (profile_id, updated_at);

      CREATE TABLE private_note_versions (
        note_id    TEXT NOT NULL REFERENCES private_notes(id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL,
        sealed     BLOB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (note_id, seq)
      );

      CREATE TABLE private_settings (
        profile_id     TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        kdf            TEXT NOT NULL,
        pass_salt      TEXT NOT NULL,
        pass_wrap      TEXT NOT NULL,
        kit_salt       TEXT NULL,
        kit_wrap       TEXT NULL,
        uses_account_passcode INTEGER NOT NULL CHECK (uses_account_passcode IN (0,1)),
        auto_lock_minutes INTEGER NOT NULL DEFAULT 5 CHECK (auto_lock_minutes BETWEEN 1 AND 60),
        lock_on_minimize  INTEGER NOT NULL DEFAULT 1 CHECK (lock_on_minimize IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((kit_salt IS NULL) = (kit_wrap IS NULL))
      );
    `);
  },
};
