import type Database from "better-sqlite3-multiple-ciphers";
import type { SearchHit, SearchKind } from "@nexus/core";
import { SEARCH_KINDS } from "@nexus/core";
import { SearchValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/**
 * `bm25()` column weights for `search_fts` (title, body, in that column
 * order — migration 017). A hit in a title is worth an order of magnitude
 * more than one buried in a body, so title outweighs body 10:1. They are
 * interpolated into the SQL text rather than bound because they are code-level
 * constants, at the same trust level as the table names around them — no
 * caller-supplied value is ever spliced into a statement in this file.
 */
export const TITLE_BM25_WEIGHT = 10.0;
export const BODY_BM25_WEIGHT = 1.0;

/** `search`/`recent` candidate count when the caller does not ask for a specific `limit`. */
export const DEFAULT_SEARCH_LIMIT = 60;
/** Hard ceiling on `limit`: a caller may ask for fewer, never more — see `validateLimit`. */
export const MAX_SEARCH_LIMIT = 200;

interface SearchHitRow {
  kind: SearchKind;
  entity_id: string;
  parent_id: string | null;
  title: string;
  body: string;
  context_date: string | null;
  updated_at: string;
  rank: number;
}

const HIT_COLUMNS =
  "e.kind AS kind, e.entity_id AS entity_id, e.parent_id AS parent_id, e.title AS title, " +
  "e.body AS body, e.context_date AS context_date, e.updated_at AS updated_at";

export interface SearchOptions {
  /** An FTS5 MATCH expression — build it with `toFtsMatchExpression` (`@nexus/core`), never hand-typed. */
  readonly match: string;
  /** Restricts to these kinds; omit for every kind. Must be non-empty when given. */
  readonly kinds?: readonly SearchKind[];
  /** Candidate cap; defaults to `DEFAULT_SEARCH_LIMIT`, clamped to `MAX_SEARCH_LIMIT`. */
  readonly limit?: number;
}

export interface RecentOptions {
  readonly kinds?: readonly SearchKind[];
  readonly limit?: number;
}

/**
 * Read-only, profile-scoped access to the trigger-maintained global search
 * index (migration 017 / ADR-021). Every row in `search_entries`/`search_fts`
 * is written by a source-table trigger; this store never writes one — its
 * whole surface is `search` (bm25-ranked FTS candidates for a typed query)
 * and `recent` (the profile's freshest entries, for an empty query).
 *
 * Both methods return **candidates**, not a final result list: SQLite's
 * `bm25()` is corpus-dependent and this store's ordering exists only to put
 * the least-bad candidates within `limit` — the actual result order for a
 * live query comes from `rankSearchResults` (`@nexus/core`), which re-ranks
 * with recency, kind priors and title boosts on top. A caller that wants the
 * top 20 results on screen should ask this store for more than 20 and let
 * core choose the best 20 out of them.
 */
export class SearchStore {
  private readonly searchNoFilter: Database.Statement;
  private readonly recentNoFilter: Database.Statement;
  // A `kinds` filter is the less common case (the `k:`-style prefixes in
  // `searchQuery.ts`) — its SQL text depends only on how many placeholders
  // the IN-list needs, not on which specific kinds are bound into it, so
  // these are prepared lazily on first use and cached by kind COUNT rather
  // than re-prepared on every call. The no-filter statements above, by
  // contrast, are the hot path (a plain typed query, or the palette's default
  // recent list) and are worth preparing once, up front.
  private readonly searchByKindCount = new Map<number, Database.Statement>();
  private readonly recentByKindCount = new Map<number, Database.Statement>();

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.searchNoFilter = db.prepare(
      `SELECT ${HIT_COLUMNS}, bm25(search_fts, ${TITLE_BM25_WEIGHT}, ${BODY_BM25_WEIGHT}) AS rank
       FROM search_fts f
       JOIN search_entries e ON e.id = f.rowid
       WHERE search_fts MATCH ? AND e.profile_id = ?
       ORDER BY rank
       LIMIT ?`,
    );
    this.recentNoFilter = db.prepare(
      `SELECT ${HIT_COLUMNS}, 0 AS rank
       FROM search_entries e
       WHERE e.profile_id = ?
       ORDER BY e.updated_at DESC, e.id DESC
       LIMIT ?`,
    );
  }

  /**
   * bm25-ordered candidates for a match expression (ascending: SQLite's
   * `bm25()` is negative and *smaller* means a better match). Not the final
   * result order — see the class doc comment.
   */
  search(options: SearchOptions): SearchHit[] {
    const kinds = validateKinds(options.kinds);
    const limit = validateLimit(options.limit);
    const match = validateMatch(options.match);

    let rows: SearchHitRow[];
    try {
      rows = (
        kinds
          ? this.searchStatementFor(kinds.length).all(match, this.profileId, ...kinds, limit)
          : this.searchNoFilter.all(match, this.profileId, limit)
      ) as SearchHitRow[];
    } catch (error) {
      // Only a generic `SQLITE_ERROR` is reinterpreted as "your expression was
      // malformed". The SQL text itself compiled at prepare time, so the one
      // thing left that can still fail generically at run time is the MATCH
      // expression — but a locked file, a busy writer or a corrupt index all
      // arrive here too, with their own codes, and telling the user their
      // *query* was wrong when the disk failed is a worse lie than an
      // untyped throw. Those propagate untouched.
      //
      // A well-formed expression from `toFtsMatchExpression` cannot trigger
      // this at all; the guard exists because the store's boundary is not
      // allowed to assume its caller is correct (ADR-001: callers see typed
      // errors, never a raw driver throw).
      if (!isGenericSqliteError(error)) throw error;
      throw new SearchValidationError(
        `Malformed search expression ${JSON.stringify(match)}: ${(error as Error).message}`,
      );
    }
    return rows.map(toSearchHit);
  }

  /**
   * The profile's most recently touched entries, already in their FINAL
   * order — what an empty query shows before anything is typed. `bm25` is
   * `0` on every row for type uniformity with `search`'s `SearchHit[]`; these
   * rows must NOT be passed through `rankSearchResults`, which would reorder
   * them by kind prior instead of recency.
   */
  recent(options: RecentOptions = {}): SearchHit[] {
    const kinds = validateKinds(options.kinds);
    const limit = validateLimit(options.limit);

    const rows = (
      kinds
        ? this.recentStatementFor(kinds.length).all(this.profileId, ...kinds, limit)
        : this.recentNoFilter.all(this.profileId, limit)
    ) as SearchHitRow[];
    return rows.map(toSearchHit);
  }

  private searchStatementFor(count: number): Database.Statement {
    const cached = this.searchByKindCount.get(count);
    if (cached) return cached;
    // The IN-list's placeholder COUNT comes from `count`, which is the length
    // of an already allowlist-validated array (`validateKinds` checked every
    // element against SEARCH_KINDS) — never from unsanitized input. The kind
    // VALUES themselves are still bound as ordinary parameters below, never
    // interpolated.
    const statement = this.db.prepare(
      `SELECT ${HIT_COLUMNS}, bm25(search_fts, ${TITLE_BM25_WEIGHT}, ${BODY_BM25_WEIGHT}) AS rank
       FROM search_fts f
       JOIN search_entries e ON e.id = f.rowid
       WHERE search_fts MATCH ? AND e.profile_id = ? AND e.kind IN (${inPlaceholders(count)})
       ORDER BY rank
       LIMIT ?`,
    );
    this.searchByKindCount.set(count, statement);
    return statement;
  }

  private recentStatementFor(count: number): Database.Statement {
    const cached = this.recentByKindCount.get(count);
    if (cached) return cached;
    // Same allowlist-derived placeholder count as searchStatementFor above.
    const statement = this.db.prepare(
      `SELECT ${HIT_COLUMNS}, 0 AS rank
       FROM search_entries e
       WHERE e.profile_id = ? AND e.kind IN (${inPlaceholders(count)})
       ORDER BY e.updated_at DESC, e.id DESC
       LIMIT ?`,
    );
    this.recentByKindCount.set(count, statement);
    return statement;
  }
}

/** `n` bound `?` placeholders for an `IN (...)` list — see the callers' comments on why `n` is safe to interpolate. */
function inPlaceholders(n: number): string {
  return Array(n).fill("?").join(", ");
}

/** `SQLITE_ERROR` is SQLite's catch-all for a statement it could not run — here, the MATCH expression. Anything with a more specific code (busy, I/O, corrupt) is not a query-syntax problem. */
function isGenericSqliteError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "SQLITE_ERROR"
  );
}

function toSearchHit(row: SearchHitRow): SearchHit {
  return {
    kind: row.kind,
    entityId: row.entity_id,
    parentId: row.parent_id,
    title: row.title,
    body: row.body,
    contextDate: row.context_date,
    updatedAt: row.updated_at,
    bm25: row.rank,
  };
}

function validateMatch(match: string): string {
  if (match.trim().length === 0) {
    throw new SearchValidationError(
      "match must not be empty or whitespace-only; an empty query should call recent() instead of search().",
    );
  }
  return match;
}

function validateKinds(
  kinds: readonly SearchKind[] | undefined,
): readonly SearchKind[] | undefined {
  if (kinds === undefined) return undefined;
  if (kinds.length === 0) {
    // Widening silently to "every kind" would hide a caller bug; an explicit
    // error is the safer failure mode for a filter that came in empty.
    throw new SearchValidationError(
      "kinds must not be an empty array; omit the option to search every kind instead.",
    );
  }
  for (const kind of kinds) {
    if (!SEARCH_KINDS.includes(kind)) {
      throw new SearchValidationError(`Unknown search kind "${String(kind)}".`);
    }
  }
  return kinds;
}

function validateLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_SEARCH_LIMIT;
  if (!Number.isInteger(value) || value <= 0) {
    throw new SearchValidationError(`limit must be a positive integer, got ${value}.`);
  }
  return Math.min(value, MAX_SEARCH_LIMIT);
}

/** The nine kind-projection views migration 017 defines, read verbatim — never re-spelled — by both `rebuildSearchIndex` below and the migration's own backfill. */
const SEARCH_SOURCE_VIEWS = [
  "search_source_task",
  "search_source_event",
  "search_source_note",
  "search_source_document",
  "search_source_subject",
  "search_source_exam",
  "search_source_deck",
  "search_source_card",
  "search_source_attachment",
] as const;

const SEARCH_ENTRY_COLUMNS =
  "kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at";

/**
 * Rebuilds the ENTIRE file's search index from scratch — a corruption-recovery
 * tool, not a per-profile operation, which is why this is a standalone
 * function rather than a `SearchStore` method: "rebuild the index" can only
 * mean "for every profile in this file," and putting it on a profile-scoped
 * store would imply a per-profile guarantee it does not give.
 *
 * Runs in one transaction:
 *  1. Empties `search_fts` UNCONDITIONALLY (a bare `DELETE`, not scoped
 *     through `search_entries`), so a row whose `search_entries` parent is
 *     already gone — an orphan no `AFTER DELETE` trigger could ever reach,
 *     since there is no `search_entries` delete event to fire one — is
 *     cleared too. Empirically confirmed against this build (SQLite 3.53.2,
 *     `content = ''` + `contentless_delete = 1`) with a throwaway probe
 *     script, since deleted: a bare `DELETE FROM search_fts` clears every
 *     row, orphans included, so a rebuild genuinely repairs a desynchronized
 *     index rather than only refilling the parts that were already
 *     consistent.
 *  2. Empties `search_entries`. Its own `AFTER DELETE` trigger reissues
 *     `DELETE FROM search_fts WHERE rowid = old.id` per row, which is now a
 *     harmless no-op given step 1 already emptied `search_fts`.
 *  3. Re-runs the exact same nine `INSERT INTO search_entries (...) SELECT
 *     ... FROM search_source_<kind>` projections the migration's own
 *     backfill uses (`SEARCH_SOURCE_VIEWS`, read by name only — never
 *     re-spelled), so this function and that backfill can never drift apart.
 *
 * View names are a fixed, code-level constant array, never user input, so
 * building the `FROM <view>` clause from them is the same trust level as
 * writing a table name literally in SQL text (every store in this codebase
 * already does that); no bound value is ever skipped.
 *
 * Returns the resulting row count.
 */
export function rebuildSearchIndex(db: DatabaseHandle): number {
  const rebuild = db.transaction((): number => {
    db.prepare("DELETE FROM search_fts").run();
    db.prepare("DELETE FROM search_entries").run();

    for (const view of SEARCH_SOURCE_VIEWS) {
      db.prepare(
        `INSERT INTO search_entries (${SEARCH_ENTRY_COLUMNS}) SELECT ${SEARCH_ENTRY_COLUMNS} FROM ${view}`,
      ).run();
    }

    return (db.prepare("SELECT count(*) AS n FROM search_entries").get() as { n: number }).n;
  });

  return rebuild();
}
