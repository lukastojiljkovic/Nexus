import type { Migration } from "./migrations.js";

/**
 * Migration 79 — the calculator's storage (CALC stage 1). Two tables: the
 * history, and the one saved session per profile.
 *
 * **`calc_history` is a LOG, not a document, and the schema says so.** No
 * `deleted_at`: the tables that keep one hold things a person MADE and can want
 * back, while a history line records that an expression was evaluated once.
 * Nothing references the row, no archive replays a tombstone for it, and a soft
 * delete would only make the cap count rows the user cannot see. Migration 050's
 * `search_history` made the same call for the same reason.
 *
 * **Pinned rows are outside the cap, which is why the cap is not a CHECK.** The
 * rule is „at most 200 UNPINNED rows“, and SQL can express that only as a
 * trigger counting rows on every insert; `CalculatorStore` enforces it in the
 * same transaction that adds the row instead, the `SearchHistoryStore.record`
 * arrangement. What the schema DOES pin down is what a row is: an expression
 * that is never empty and never longer than the engine accepts (1000), a result
 * that is never empty and never longer than the store's own cap (4096), and a
 * flag that is exactly 0 or 1. The two numbers are literals rather than imports
 * on purpose — a migration describes what it did at version 79 and must keep
 * producing that schema for a file upgraded a year from now, exactly as
 * migration 055 spells out its own name and unit lengths.
 *
 * **`calc_sessions` is one row per profile, and it carries no CHECK.** The
 * column holds the JSON `@nexus/core`'s `serializeCalculatorSession` writes, and
 * SQL can only bound the length of a document it cannot parse: the caps that
 * matter are per ENTRY (a variable's value, a function's body, how many of each)
 * and live in core's validator, which the store runs on the way in and on the
 * way out. A second bound written here could only drift from that one. The row
 * is ABSENT for a profile that never saved a session, and absence IS the empty
 * session (`emptyCalculatorSession`), which is what keeps the default in one
 * place.
 *
 * **No sync journal triggers, deliberately.** Migration 063's journal is
 * populated by triggers written at version 63 for the collections that existed
 * then, and sync is on hold permanently (CLAUDE.md, 2026-08-31): new tables do
 * not declare whether they are journaled because nothing journals them. The day
 * sync resumes, this module needs its triggers in a migration of its own, which
 * is the same rule 063 states for every collection added after it.
 *
 * **Neither table is in the archive yet, and neither is in
 * `RESTORE_WIPE_TABLES`.** The brief splits this module in two: stage 1 is the
 * engine and the store, stage 2 is the page, the IPC and the profile archive.
 * Until the archive carries a calculator, a restore neither wipes these rows nor
 * writes them — which is why they are in the exemption ledger in
 * `restoreStore.test.ts` with that reason beside them, rather than in the wipe
 * list where a wipe would destroy history the archive could not put back.
 *
 * **One index.** `calc_history_profile_created` serves both reads there are —
 * newest-first for the page and oldest-first for the archive, which is the same
 * index walked the other way — and the eviction subquery, which orders the
 * unpinned rows by the same two columns. `calc_sessions` needs none: its primary
 * key IS `profile_id`, so the row is found by the key that identifies it.
 */
export const migration079: Migration = {
  version: 79,
  up(db) {
    db.exec(`
      CREATE TABLE calc_history (
        id         TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        expression TEXT NOT NULL CHECK (length(expression) BETWEEN 1 AND 1000),
        result     TEXT NOT NULL CHECK (length(result) BETWEEN 1 AND 4096),
        -- 0 or 1 and nothing else: a flag with a third state is a flag every
        -- reader has to interpret.
        pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX calc_history_profile_created
        ON calc_history (profile_id, created_at DESC, id DESC);

      CREATE TABLE calc_sessions (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        session    TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
};
