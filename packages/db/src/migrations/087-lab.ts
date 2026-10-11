import type { Migration } from "./migrations.js";

/**
 * Migration 87 — the LAB module's storage (ADR-090's kit, the hardware drawer).
 *
 * **Three tables, and each one is a different kind of fact.**
 *
 * `lab_logs` is a named sensor log: what the user called it and which columns
 * its lines carry. The columns are CANONICAL JSON — an array of names, the
 * `task_templates.tags` arrangement — because a column name is a label rather
 * than a row: nothing points at a column, nothing renames one, and a second
 * table would be a join for every read that already has the whole array in hand.
 * `UNIQUE (profile_id, name)` is the model rather than an optimisation, on
 * `timers_presets`' terms: two logs called „Radionica" are one log the user
 * cannot tell from the other, so the index makes that unrepresentable and the
 * store translates the violated index into a sentence.
 *
 * `lab_samples` is the readings themselves: one row per line the device
 * printed, with the instant it arrived and its values as a JSON array in the
 * log's column order. Two decisions live here.
 *
 * The first is that samples are scoped THROUGH their log — no `profile_id` of
 * their own, the `recording_markers` arrangement — because every statement the
 * store runs resolves the log in this profile before it touches a reading, and a
 * second scope column would be a second answer to „whose row is this".
 *
 * The second is that the readings column is JSON rather than a table with one
 * column per sensor. A device's columns are the SKETCH's, not ours: they change with a
 * reflash, they were never fixed at schema time, and a table per column set
 * would be a migration per project. The store validates the array's length
 * against its log's columns and every element as a finite number, which is the
 * part SQLite cannot check across two tables and is therefore stated in the
 * store instead — exactly as `recording_markers.at_ms` against its recording's
 * duration is.
 *
 * `lab_offgrid` is one row per profile: the device list and the three numbers an
 * off-grid budget is computed from. It is a PROFILE fact rather than a device
 * one — the appliances in a house are the user's, and they travel in the profile
 * archive — and it is a single row rather than a table of devices because a
 * budget is read and written WHOLE: the panel that comes out of it depends on
 * every device at once, so a half-saved list is a wrong answer rather than an
 * incomplete one. `depth_of_discharge` is bounded to (0, 1] by the schema, and
 * the three numbers carry range CHECKs rather than `typeof(x) = 'integer'`: they
 * are real numbers by nature (45.5 W, 2.5 h, 0.8 of a pack), and SQLite storing
 * a whole number in a REAL column loses nothing — unlike the reverse, which is
 * the FIN lesson migration 051 records and why the INTEGER columns in this
 * module's neighbours carry the strict form.
 *
 * **No `sync_journal` triggers, deliberately**, on migration 077's terms: sync is
 * on hold permanently, a collection is journaled when it is a collection, and
 * these three are not in `SYNC_MAP` — nor in `RESTORE_WIPE_TABLES`, because a kit
 * module replaces its own rows through `ModuleContext.importData` rather than
 * through the wipe list (`apps/desktop/src/modules/lab/main/register.ts` says
 * so). When sync resumes, the triggers arrive in a new migration beside the map
 * entries that earn them.
 *
 * **Three indexes, each earned.** `lab_logs_profile` is the only log list read
 * ("this profile's logs, by name") and is kept beside the UNIQUE below for the
 * reason `timers_presets_profile` is: the UNIQUE is a RULE, this is a READ, and a
 * later change to the rule must not silently drop the read's index.
 * `lab_samples_log` is both the only sample read (a log's readings in time order)
 * and the delete scope the retention bound uses.
 */
export const migration087: Migration = {
  version: 87,
  up(db) {
    db.exec(`
      CREATE TABLE lab_logs (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name        TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 60),
        -- Canonical JSON: an array of column names.
        columns     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      -- The only log list there is: this profile's logs, by name.
      CREATE INDEX lab_logs_profile ON lab_logs (profile_id, name, id);

      -- Two logs with one name are one log the user cannot tell from the other.
      CREATE UNIQUE INDEX lab_logs_profile_name ON lab_logs (profile_id, name);

      CREATE TABLE lab_samples (
        id         TEXT PRIMARY KEY,
        log_id     TEXT NOT NULL REFERENCES lab_logs(id) ON DELETE CASCADE,
        at         TEXT NOT NULL,
        -- Canonical JSON: an array of numbers, one per column of the log, in the
        -- log's own order. The length and the finiteness are the STORE's rule --
        -- SQLite cannot check one table's array against its parent's columns.
        --
        -- Named "values_json" rather than the obvious "values", and that is not
        -- style: VALUES is a reserved word, so a column called "values" makes
        -- every INSERT and every CREATE parse as a syntax error (near "values"),
        -- which is how this table was found to be wrong the first time it ran.
        values_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- A log's readings, in time order -- the only sample read there is, and the
      -- scope of the retention delete.
      CREATE INDEX lab_samples_log ON lab_samples (log_id, at, id);

      CREATE TABLE lab_offgrid (
        profile_id          TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        -- Canonical JSON: an array of { name, watts, hoursPerDay }.
        devices             TEXT NOT NULL,
        battery_wh          REAL NOT NULL CHECK (battery_wh >= 0 AND battery_wh <= 1000000),
        depth_of_discharge  REAL NOT NULL
                              CHECK (depth_of_discharge > 0 AND depth_of_discharge <= 1),
        sun_hours           REAL NOT NULL CHECK (sun_hours > 0 AND sun_hours <= 24),
        updated_at          TEXT NOT NULL
      );
    `);
  },
};
