import type Database from "better-sqlite3-multiple-ciphers";
import { SearchValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/**
 * How many queries one profile remembers (SRCH-009). Twenty is roughly what a
 * palette's empty box and the page's browse block can show without becoming a
 * log: enough that yesterday's search is still there, few enough that the list
 * stays something a person reads rather than scrolls. Enforced in the SAME
 * transaction as the insert (`record`), never by a sweep — a history that is
 * over its cap between two writes is a state no crash may leave behind.
 */
export const MAX_SEARCH_HISTORY_ENTRIES = 20;

/**
 * Longest query the history will hold — migration 050's own CHECK bound,
 * declared here because the store is where a caller meets it as a named error
 * rather than a raw constraint failure. Equal to the palette's IPC cap
 * (`SEARCH_QUERY_MAX_BYTES`) by intent, declared independently for the reason
 * that constant itself gives: this package imports nothing from the desktop
 * app's wire contract.
 */
export const MAX_SEARCH_HISTORY_QUERY_LENGTH = 500;

/** Accepts a full ISO-8601 date-time — the same shape every other store's `now` takes. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** One remembered search: the text as it was typed, and when it was last used. */
export interface SearchHistoryEntry {
  query: string;
  usedAt: string;
}

interface HistoryRow {
  query: string;
  used_at: string;
}

/**
 * The profile's search history (SRCH-009 / migration 050), over prepared,
 * parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Constructed one per profile and reused, like every other
 * store here; every statement is scoped by `profile_id`.
 *
 * Three promises, and they are the whole design:
 *
 *  - **Deduped.** `(profile_id, query)` is migration 050's primary key, so
 *    re-running a query is an upsert that bumps `used_at` — a second row for
 *    the same text is unrepresentable, not merely avoided.
 *  - **Recency-ordered.** `list` reads newest-first, tie-broken by the query
 *    text so the order is total (two searches recorded in the same
 *    millisecond must not swap places between two reads of the same table).
 *  - **Bounded.** `record` inserts and evicts in ONE transaction, the
 *    `PrivateNoteStore.writeVersion` idiom.
 *
 * The query is stored **as typed**, operators included (`#oznaka`,
 * `rok:danas`) — a history that dropped them would replay as a different
 * search than the one it claims to remember. The one normalization is outer
 * whitespace, which no search treats as meaningful and whose absence is what
 * makes „upit " and „upit" one entry rather than two.
 *
 * Deliberately device-local, like `backup_settings`: this table is excluded
 * from the export archive and from the restore wipe alike (see migration 050's
 * doc comment). It lives in the profile's encrypted database rather than in
 * renderer storage for the reason that comment gives — a history belongs to a
 * PROFILE, and must be as encrypted at rest as the notes it searched.
 */
export class SearchHistoryStore {
  private readonly selectRecent: Database.Statement;
  private readonly upsertQuery: Database.Statement;
  private readonly evictQueries: Database.Statement;
  private readonly deleteQuery: Database.Statement;
  private readonly deleteAll: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectRecent = db.prepare(
      `SELECT query, used_at FROM search_history
        WHERE profile_id = ?
        ORDER BY used_at DESC, query ASC
        LIMIT ?`,
    );
    this.upsertQuery = db.prepare(
      `INSERT INTO search_history (profile_id, query, used_at)
       VALUES (?, ?, ?)
       ON CONFLICT (profile_id, query) DO UPDATE SET used_at = excluded.used_at`,
    );
    // "Keep the newest N of THIS profile" — the subquery repeats the same
    // profile scope as the outer DELETE, so a profile filling its history to
    // the cap can never evict a row of another's.
    this.evictQueries = db.prepare(
      `DELETE FROM search_history
        WHERE profile_id = ?
          AND query NOT IN (
            SELECT query FROM search_history
             WHERE profile_id = ?
             ORDER BY used_at DESC, query ASC
             LIMIT ?
          )`,
    );
    this.deleteQuery = db.prepare(
      `DELETE FROM search_history WHERE profile_id = ? AND query = ?`,
    );
    this.deleteAll = db.prepare(`DELETE FROM search_history WHERE profile_id = ?`);
  }

  /** This profile's remembered queries, newest first. `limit` defaults to — and is clamped to — the cap, since nothing beyond it exists to read. */
  list(limit?: number): SearchHistoryEntry[] {
    const rows = this.selectRecent.all(this.profileId, validateLimit(limit)) as HistoryRow[];
    return rows.map((row) => ({ query: row.query, usedAt: row.used_at }));
  }

  /**
   * Remembers one query as used at `now`, evicting anything past
   * `MAX_SEARCH_HISTORY_ENTRIES` in the same transaction. Re-recording a query
   * already in the history moves it to the top — which also rescues it from
   * eviction, since the cap is applied to the freshly-bumped order.
   */
  record(query: string, now: string): void {
    const text = validateQuery(query);
    validateDateTime(now);
    // Insert and eviction as ONE transaction: a history over its cap (or an
    // eviction without the insert that justified it) is a state no crash may
    // leave behind — `PrivateNoteStore.writeVersion`'s rule.
    this.db.transaction((): void => {
      this.upsertQuery.run(this.profileId, text, now);
      this.evictQueries.run(this.profileId, this.profileId, MAX_SEARCH_HISTORY_ENTRIES);
    })();
  }

  /**
   * Forgets one query. Removing something that is not there is DONE, not an
   * error: the surface that asks can be a keystroke stale (a second window, or
   * a clear that landed first), and a failure the user has to read would be
   * about our bookkeeping rather than about anything they did.
   */
  remove(query: string): void {
    this.deleteQuery.run(this.profileId, validateQuery(query));
  }

  /** Forgets everything this profile searched for, returning how many entries went — what the „Obriši istoriju pretrage" control reports. */
  clear(): number {
    return this.deleteAll.run(this.profileId).changes;
  }
}

/** Trims the outer whitespace — the ONE normalization (see the class doc) — and refuses what is left of an unused search box. */
function validateQuery(query: string): string {
  if (typeof query !== "string") {
    throw new SearchValidationError(`"query" must be a string.`);
  }
  const text = query.trim();
  if (text.length === 0) {
    throw new SearchValidationError(
      "A search history entry must carry a query; empty and whitespace-only queries are never recorded.",
    );
  }
  if (text.length > MAX_SEARCH_HISTORY_QUERY_LENGTH) {
    throw new SearchValidationError(
      `"query" must be at most ${MAX_SEARCH_HISTORY_QUERY_LENGTH} characters.`,
    );
  }
  return text;
}

function validateLimit(limit: number | undefined): number {
  const value = limit ?? MAX_SEARCH_HISTORY_ENTRIES;
  if (!Number.isInteger(value) || value <= 0) {
    throw new SearchValidationError(`limit must be a positive integer, got ${value}.`);
  }
  return Math.min(value, MAX_SEARCH_HISTORY_ENTRIES);
}

function validateDateTime(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new SearchValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
