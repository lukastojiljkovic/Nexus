import type { Migration } from "./migrations.js";

/**
 * Migration 55 — the HABIT module's storage (HABIT slice a). Two tables, and
 * every decision the module turns on is written into the schema rather than left
 * to a store to remember.
 *
 * **A habit carries NO recurrence rule, deliberately.** `tasks`, `events` and
 * `fin_recurring` all hold ADR-024's canonical JSON in a `recurrence` column;
 * `habits.schedule` holds a different language, and the difference is the point.
 * ADR-024 answers „when does this next occur", while a habit needs „was this
 * period satisfied" — and the rule language can express schedules over which a
 * streak is undefinable (`until`, `count`, „every 3rd Tuesday", a five-week
 * interval). `packages/core/src/habits/habitSchedule.ts` carries the argument in
 * full; it is repeated here because this column is where the next reader will
 * see two schedule languages in one database and reach for the „fix".
 *
 * The column holds `serializeHabitSchedule` output — canonical JSON, exactly the
 * `fin_recurring.recurrence` arrangement — and, as there, the store re-validates
 * it on the way out: this table writes nothing else, so anything that fails to
 * parse is corruption rather than input to coerce.
 *
 * **`archived_at` and `deleted_at` are two INDEPENDENT nullable timestamps**,
 * exactly as migration 054 made `paused_at` and `deleted_at` independent, and for
 * the same reason. They answer different questions — „am I still doing this" and
 * „is this still here" — and a habit you have finished with is not one you threw
 * away: its history is the entire point, it must keep answering the stats, and it
 * must stop cluttering today's list. A single `status` column would have to
 * invent a precedence between them, and archiving-then-deleting-then-restoring
 * would have to guess which fact to give back.
 *
 * **One nullable `target` is what makes „teretana" and „8 čaša vode" one model.**
 * `target IS NULL` is a binary habit, whose entry's `value` is 1; a non-null
 * target makes a day done when `value >= target`. Two tables, or a `kind` column
 * with two shapes, would double every read for a distinction that is one integer.
 * `unit` names what the target counts and is meaningless without one, which the
 * CHECK below says out loud — a unit with nothing to count is a label on an empty
 * number.
 *
 * **Values are INTEGERS, never floats**, and the CHECKs say `typeof(x) =
 * 'integer'` rather than trusting INTEGER affinity — the FIN lesson (migration
 * 051): SQLite converts a REAL to an INTEGER only when the conversion is
 * lossless, so `12.5` would sit happily in an `INTEGER NOT NULL` column and every
 * count over it would be a float from then on. „Pola čaše" is not a thing this
 * module tracks, and the file is what enforces that rather than a convention.
 *
 * **`UNIQUE (habit_id, entry_date)` is the model, not an optimisation.** One row
 * per habit per day, so a double tap is UNREPRESENTABLE rather than deduplicated
 * in code — FIN slice d's rule: an index has to be right once, a guard has to be
 * right every time. `HabitStore.setEntry` names this exact index as its conflict
 * target, so a second tick updates the value while a violated CHECK still throws
 * (which a blanket `INSERT OR IGNORE` would have swallowed).
 *
 * `habit_entries` carries no `profile_id` at all: it is scoped THROUGH its habit,
 * the `note_attachments` arrangement (migration 013). Every statement in
 * `HabitStore` that touches an entry resolves the habit through this profile
 * first, which is what stops a write naming another profile's habit.
 *
 * **Plain `CREATE TABLE`, and the referenced-parent question is worth stating.**
 * Both tables are new here, so there is no rebuild to consider — but `habits` IS
 * a referenced parent from the moment this migration runs (`habit_entries.habit_id`
 * points at it), which is exactly the condition ADR-042 and migration 054
 * document: a later column on `habits` must land by `ALTER TABLE … ADD COLUMN`
 * and never by a table rebuild, because `DROP TABLE`'s implicit DELETE fires
 * every `ON DELETE` action pointing at it and `PRAGMA foreign_keys` is a no-op
 * inside the transaction `runMigrations` wraps a migration in. A rebuild would
 * silently take every entry with it.
 *
 * **Two indexes, both earned; no third.** `habits_profile_active` covers the only
 * habit read there is — „this profile's live habits, by name" — the shape
 * `fin_accounts_profile_active` already has. `habit_entries_habit_day` is the
 * uniqueness above, and it doubles as the only entry index needed: both reads
 * (one habit's entries over a range, and every habit of a profile over a range)
 * are `habit_id` first, `entry_date` second, which is this index's own order. An
 * index on `entry_date` alone would serve no read — nothing ever asks „every
 * habit's ticks on this day" without already knowing which habits, since the
 * profile scope arrives through `habits`.
 *
 * No CHECK on `reminder_time`'s shape: it holds an `HH:MM` wall clock exactly as
 * `ntf_settings.quiet_from` and `morning_hour` do, and those carry none either —
 * `HabitStore` validates it on the way in, which is where those three are
 * validated too. Nor on `colour`: the swatch domain is `note_folders`' closed
 * palette, checked in the store rather than in the schema (migration 011's own
 * choice, made so the palette can evolve without a migration), and this table
 * reuses that palette rather than minting a second one.
 */
export const migration055: Migration = {
  version: 55,
  up(db) {
    db.exec(`
      CREATE TABLE habits (
        id            TEXT PRIMARY KEY,
        profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name          TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 60),
        color         TEXT,
        schedule      TEXT NOT NULL,
        target        INTEGER
                        CHECK (target IS NULL OR (typeof(target) = 'integer' AND target > 0)),
        unit          TEXT CHECK (unit IS NULL OR length(unit) > 0),
        reminder_time TEXT,
        archived_at   TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        deleted_at    TEXT,
        -- A unit counts a target; without one there is nothing for it to be the
        -- unit OF, and a binary habit's tick is not measured in anything.
        CHECK (unit IS NULL OR target IS NOT NULL)
      );

      -- The only habit read there is: "this profile's live habits, by name".
      CREATE INDEX habits_profile_active
        ON habits (profile_id, name, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE habit_entries (
        id         TEXT PRIMARY KEY,
        habit_id   TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        entry_date TEXT NOT NULL,
        value      INTEGER NOT NULL CHECK (typeof(value) = 'integer' AND value > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- One row per habit per day (see the file doc): the double tap is
      -- unrepresentable, and setEntry names this index as its conflict target.
      CREATE UNIQUE INDEX habit_entries_habit_day ON habit_entries (habit_id, entry_date);
    `);
  },
};
