import type { Migration } from "./migrations.js";

/**
 * Migration 77 — the RECORDER's storage (voice and video diary, slice a). Three
 * tables: one recording, the markers inside it, and the module's one preference
 * (which stage 2 extended this migration with, while it is still unreleased:
 * the numbering rule is that a NEW table for an unreleased module is a line
 * here, not a second migration beside it).
 *
 * **A recording is an INDEX ROW, never its bytes.** The media lives in the same
 * content-addressed, encrypted blob store every attachment uses
 * (`<userData>/blobs`, ADR-019, owned entirely by
 * `apps/desktop/src/main/attachments.ts`), and this table carries the `sha256`
 * that names it plus the facts needed to draw it without reading it: the mime
 * main sniffed, the size, and the duration the capture side measured. That is
 * migration 024's arrangement exactly, and it is reused rather than reinvented
 * so the blob store stays ONE store: two records holding byte-identical media
 * are one file on disk whichever table names them, and a reference count must
 * therefore consult this table too before anything is garbage-collected.
 *
 * A recording's size is bounded in `RecorderStore` (`MAX_RECORDING_BYTES`) at
 * something far larger than an attachment's 50 MB, because a diary video is
 * hundreds of megabytes — but the BOUND exists, and the reason is memory rather
 * than taste: the blob store encrypts and decrypts a blob as one buffer, so a
 * recording is held whole in main while it is written. The store's own comment
 * carries the measurement; stage 2 decides whether capture has to stream.
 *
 * **`mime` is a closed list, and here it is a CHECK.** The four strings are what
 * Chromium's `MediaRecorder` produces for this product's capture settings
 * (`@nexus/core`'s `RECORDING_MIME_TYPES`, which the store validates against on
 * the way in). Unlike the note/task attachment mime, which is whatever main
 * sniffed from arbitrary bytes the user picked, a recording's mime is chosen
 * from a set this app can enumerate — so the file states it, and a fifth codec
 * arrives as a migration rather than as a row nothing can explain.
 *
 * **`is_diary` and `diary_date` are one fact, and the CHECK says so.** A diary
 * entry has a calendar date it was FILED under, which may differ from the day it
 * was created (recorded at 23:50 for tomorrow, or on the road for the trip's
 * day); a memo has neither. `(is_diary = 1) = (diary_date IS NOT NULL)` makes
 * half a pair unrepresentable, the shape migration 055's `unit`/`target` CHECK
 * has one module over.
 *
 * **Markers are scoped THROUGH their recording** — no `profile_id` of their own,
 * the `habit_entries`/`note_attachments` arrangement, so every statement in the
 * store resolves the recording in this profile before it touches a marker. The
 * one rule that CANNOT live here is the interesting one: a marker's `at_ms` must
 * sit inside its recording's `duration_ms`, and SQLite cannot CHECK one table's
 * column against its parent's, so `RecorderStore` enforces it on every write and
 * this file says out loud that it does not. A marker is hard-deleted, like an
 * attachment row, and a recording's soft delete leaves its markers exactly where
 * they are.
 *
 * **No `sync_journal` triggers, deliberately.** Sync is on hold permanently, and
 * migration 063 states the rule for new tables: a collection is journaled when
 * it is a collection, and these two are not in `SYNC_MAP` (nor in
 * `RESTORE_WIPE_TABLES`). When sync resumes, this module's triggers arrive in a
 * new migration beside the map entries that earn them — never as an edit to the
 * schema a past version already produced.
 *
 * **Three indexes, each earned.** `recordings_profile_active` is the only
 * recording read there is — "this profile's live recordings, newest first", which
 * is `RecorderStore`'s own `ORDER BY created_at DESC, id DESC` and needs no
 * second index. `recordings_sha` is the reverse lookup the blob store's GC and
 * the `nx-blob:` protocol both need, on migration 024's reasoning and
 * deliberately not scoped by profile, because the blob store is content-addressed
 * across the whole database. `recording_markers_recording` is both the only
 * marker read and the delete scope: a recording's markers, in time order.
 */
export const migration077: Migration = {
  version: 77,
  up(db) {
    db.exec(`
      CREATE TABLE recordings (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('audio', 'video')),
        -- Empty is allowed on purpose: the „date and time“ default title
        -- belongs to stage 2's copy, and the store must not invent one.
        title       TEXT NOT NULL CHECK (length(title) <= 200),
        created_at  TEXT NOT NULL,
        duration_ms INTEGER NOT NULL
                      CHECK (typeof(duration_ms) = 'integer' AND duration_ms > 0),
        mime        TEXT NOT NULL
                      CHECK (mime IN ('audio/webm;codecs=opus', 'audio/ogg;codecs=opus',
                                      'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus')),
        size_bytes  INTEGER NOT NULL
                      CHECK (typeof(size_bytes) = 'integer' AND size_bytes > 0),
        sha256      TEXT NOT NULL CHECK (length(sha256) = 64),
        -- Canonical JSON: an array of tag NAMES, the task_templates.tags
        -- arrangement, because a recording's tags are labels rather than rows.
        tags        TEXT NOT NULL,
        notes       TEXT NOT NULL CHECK (length(notes) <= 2000),
        is_diary    INTEGER NOT NULL CHECK (is_diary IN (0, 1)),
        diary_date  TEXT,
        -- Empty until a later local speech-to-text pass fills it; the length
        -- bound is a sanity cap on that pass's output, not a product limit.
        transcript  TEXT NOT NULL CHECK (length(transcript) <= 40000),
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT,
        -- A diary entry has a date and a memo has none; half a pair is
        -- unrepresentable (migration 055's unit/target CHECK, one module over).
        CHECK ((is_diary = 1) = (diary_date IS NOT NULL))
      );

      -- The only recording read there is: this profile's live recordings,
      -- newest first (RecorderStore's own ORDER BY).
      CREATE INDEX recordings_profile_active
        ON recordings (profile_id, created_at, id)
        WHERE deleted_at IS NULL;

      -- The blob store's reverse lookup: how many rows reference this hash, and
      -- which mime to serve it as. Deliberately not profile-scoped (migration 024).
      CREATE INDEX recordings_sha ON recordings (sha256);

      CREATE TABLE recording_markers (
        id           TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
        -- Milliseconds from the recording's start. Bounded below by the schema
        -- and above by the store, which is the only layer that can see the
        -- parent's duration_ms.
        at_ms        INTEGER NOT NULL CHECK (typeof(at_ms) = 'integer' AND at_ms >= 0),
        label        TEXT NOT NULL CHECK (length(label) > 0 AND length(label) <= 80),
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      -- A recording's markers, in time order — the only marker read there is.
      CREATE INDEX recording_markers_recording
        ON recording_markers (recording_id, at_ms, id);

      -- The module's one preference (REC stage 2): whether a capture on this
      -- profile waits a few seconds before it starts. A PROFILE row rather than
      -- a device one, on the rule the kit's settings card states — what a module
      -- archives travels in the profile's own archive, and the „Vrati na
      -- podrazumevano" link belongs to the DEVICE-only cards (SET §5). Zero or
      -- one row per profile, so an absent row is answered by the store's default.
      CREATE TABLE recorder_settings (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        countdown  INTEGER NOT NULL CHECK (countdown IN (0, 1))
      );
    `);
  },
};
