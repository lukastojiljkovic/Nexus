import type { Migration } from "./migrations.js";

/**
 * Migration 83 - the MINI-APPS module's storage (stage 2 of the mini-apps
 * brief; the engines themselves are `@nexus/core`'s `miniapps/`).
 *
 * **ONE table, holding ONE document.** Nine small tools share this module, and
 * the state each of them KEEPS is what the user authored: the tally counters,
 * the scoreboard's players and rounds, the typing tutor's progress, the picked
 * cities, the dice history, and which tile was last opened. None of them
 * references another, no query joins across them, and every read is "the whole
 * kept state of this profile" - so they are one bounded JSON document in one
 * row, the shape `pantryStore` and `emergencyCardStore` already use for state
 * that is authored and read whole rather than queried into.
 *
 * **Why not a table per app.** A relational shape would buy nothing this module
 * asks for: there is no cross-app query, no per-row update path that a JSON
 * rewrite does not already give (the document is a few kilobytes), and no
 * foreign key between a counter and a city. What it would cost is what it
 * always costs - a table, an index, a row mapper and a migration per app - and a
 * store that has to be able to answer "what is a scoreboard round" in SQL as
 * well as in the engine that already answers it.
 *
 * **The payload is bounded, not merely stored.** `MiniappsStore` validates every
 * field of the document on the way in AND on the way out (the engines' own
 * limits, `@nexus/core`'s `TALLY_MAX_*`/`SCOREBOARD_MAX_*` among them), and the
 * CHECK below is the second, dumbest bound: a document is a few kilobytes, and
 * half a megabyte is far past anything a real profile can author while still
 * being nothing a hand-edited database can use to fill the disk.
 *
 * **No `sync_journal` triggers, and deliberately not in `RESTORE_WIPE_TABLES`.**
 * Migration 063's rule: a table is journaled when it is a collection, and this
 * one is not in `SYNC_MAP`. It is also not in `RESTORE_WIPE_TABLES`, because
 * that list is derived into `@nexus/sync`'s collection map and a module built on
 * the kit replaces its own rows instead (ADR-090 section 6) - the module's
 * `importData` is what empties this row, and `restoreStore.test.ts` names it in
 * the exemption list.
 *
 * One index is unnecessary here and is not created: the only read is by
 * `profile_id`, which is the primary key.
 */
export const migration083: Migration = {
  version: 83,
  up(db) {
    db.exec(`
      CREATE TABLE miniapps_state (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        payload    TEXT NOT NULL CHECK (length(payload) > 0 AND length(payload) <= 524288),
        updated_at TEXT NOT NULL
      );
    `);
  },
};
