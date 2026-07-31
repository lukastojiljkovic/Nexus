import type { Migration } from "./migrations.js";

/**
 * Migration 50 — the profile's own search history (SRCH-009). One row per
 * remembered query: the text exactly as it was typed, and when it was last
 * used. Written only by `SearchHistoryStore`, which upserts on re-use and
 * evicts past `MAX_SEARCH_HISTORY_ENTRIES` in the same transaction.
 *
 * **Deliberately device-local — the `backup_settings` precedent (migration 044
 * / ADR-056), applied to a different kind of fact.** This table is EXCLUDED
 * from the export archive AND from `RESTORE_WIPE_TABLES` (see the exemption
 * comment in `restoreStore.test.ts`), and no interchange version accompanies
 * it, for three reasons worth writing down:
 *
 *  - A search history is a fact about **how this machine was used**, not
 *    content the profile contains. Every other row an archive carries is
 *    something the user made; a query is something the user *did*.
 *  - An archive is a thing you can hand to somebody else, or restore onto
 *    another machine. It must not carry your queries with it — „bolest",
 *    „advokat", a person's name — and the only way to guarantee that is for
 *    the exporter never to read this table at all (`gatherProfileData` has no
 *    field for it, which is a type-level guarantee, not a filter someone can
 *    forget).
 *  - And unlike a genuinely device-local `localStorage` preference, it belongs
 *    to a **profile**: one person's searches must not appear in another
 *    profile on the same install. That is why it lives in the encrypted
 *    database, scoped by `profile_id`, rather than in renderer storage — the
 *    history is as encrypted at rest as the notes it searched.
 *
 * A restore likewise leaves it standing: replacing a profile's data does not
 * change what this device's user searched for, and a restore that silently
 * wiped it (or, worse, filled it from the archive) would be answering a
 * question nobody asked.
 *
 * **Deduped by the primary key.** `(profile_id, query)` is the identity of a
 * remembered search, so re-running one is an `ON CONFLICT ... DO UPDATE` that
 * bumps `used_at` — a second row for the same text is unrepresentable rather
 * than merely avoided. Comparison is SQLite's BINARY TEXT comparison, the same
 * rule `note_categories`' name uniqueness follows: „Ispit" and „ispit" are two
 * entries, because they are two things to replay, and the history stores what
 * was typed rather than a normalized form of it.
 *
 * The CHECKs mirror the rules `SearchHistoryStore` also enforces (a CHECK is
 * what holds when a row arrives outside the store): a query is never empty,
 * never whitespace-only — those are what an *unused* search box contains, and
 * remembering them would be remembering nothing — and never longer than the
 * palette's own input cap, so one paste cannot turn the history into a
 * document store.
 *
 * `search_history_profile_used` serves the only two statements there are: the
 * recency-ordered read, and the eviction's "keep the newest N" subquery.
 */
export const migration050: Migration = {
  version: 50,
  up(db) {
    db.exec(`
      CREATE TABLE search_history (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        query      TEXT NOT NULL,
        used_at    TEXT NOT NULL,
        PRIMARY KEY (profile_id, query),
        CHECK (length(query) BETWEEN 1 AND 500),
        CHECK (trim(query) <> '')
      );

      CREATE INDEX search_history_profile_used
        ON search_history (profile_id, used_at DESC);
    `);
  },
};
