import type Database from "better-sqlite3-multiple-ciphers";

import { DatabaseError } from "../errors.js";
import { isDateTime } from "../finance/money.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** The longest ZIM path a row may hold, in characters — the same bound `main/zim/paths.ts` applies. */
export const MAX_WIKI_PATH_LENGTH = 512;

/** The longest title a row may hold, in characters. A ZIM title is a page name, not a sentence. */
export const MAX_WIKI_TITLE_LENGTH = 200;

/** The longest library id a row may name: the `nx-zim://` host's own bound. */
export const MAX_WIKI_LIBRARY_ID_LENGTH = 64;

/**
 * How many visits one profile keeps.
 *
 * A reading log is useful for "where was I" and useless at ten thousand rows, and
 * this one rides in the same payload as the module's whole view — which the page
 * loads on every mount and after every mutation. Two hundred is far past the
 * point anybody scrolls and small enough that the view stays a payload rather
 * than a document.
 */
export const MAX_WIKI_HISTORY = 200;

/** How many marks one profile may keep. The same argument as the history cap, with a lower number: marks are deliberate. */
export const MAX_WIKI_BOOKMARKS = 500;

/** Thrown when a wiki write is refused at the store boundary. */
export class WikiValidationError extends DatabaseError {}

/** Thrown when an operation names a row this profile does not have. */
export class WikiNotFoundError extends DatabaseError {}

/** One place somebody read: which library, which entry, and what it was called. */
export interface WikiHistoryEntry {
  readonly id: string;
  readonly libraryId: string;
  readonly zimPath: string;
  readonly title: string;
  readonly visitedAt: string;
}

/** One page somebody kept. */
export interface WikiBookmark {
  readonly id: string;
  readonly libraryId: string;
  readonly zimPath: string;
  readonly title: string;
  readonly createdAt: string;
}

/** What a visit or a mark names. */
export interface WikiPlaceInput {
  readonly libraryId: string;
  readonly zimPath: string;
  readonly title: string;
}

/** The whole of one profile's archived wiki state. */
export interface WikiArchive {
  readonly bookmarks: readonly WikiPlaceInput[];
}

interface HistoryRow {
  id: string;
  library_id: string;
  path: string;
  title: string;
  visited_at: string;
}

interface BookmarkRow {
  id: string;
  library_id: string;
  path: string;
  title: string;
  created_at: string;
}

/**
 * Serbian Latin ordering for the bookmark list, on `TimersStore`'s terms: plain
 * `"sr"` mis-tailors š/č/ć/ž, and SQLite's BINARY collation would put „Šetnja"
 * after „Kafa".
 */
const WIKI_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * The library id shape, stated here rather than imported.
 *
 * `apps/desktop` and `packages/db` are separate packages: the app's check is the
 * one the URL scheme is validated against and this one is the column's. They
 * check the same thing because they are the two ends of one boundary, and a store
 * that trusted the wire would be a store that trusted a compromised renderer
 * (SEC-EL-02).
 */
const LIBRARY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function historyFromRow(row: HistoryRow): WikiHistoryEntry {
  return {
    id: row.id,
    libraryId: row.library_id,
    zimPath: row.path,
    title: row.title,
    visitedAt: row.visited_at,
  };
}

function bookmarkFromRow(row: BookmarkRow): WikiBookmark {
  return {
    id: row.id,
    libraryId: row.library_id,
    zimPath: row.path,
    title: row.title,
    createdAt: row.created_at,
  };
}

/**
 * WIKI's storage (migration 86): which pages this profile read, and which it
 * kept.
 *
 * **Why a visit is an UPDATE and not an INSERT.** The table's UNIQUE index says a
 * profile has at most one row per place, and this store is what makes that true
 * without an exception: `recordVisit` moves the existing row's instant rather
 * than adding a second. A log that appended would be the same article forty times
 * after an afternoon of reading, and the interesting question — where was I, most
 * recently — would then need a GROUP BY the page cannot afford per keystroke.
 *
 * **Why the trim lives here.** `MAX_WIKI_HISTORY` is a bound on a table whose
 * rows the reader shows whole, so it is enforced where the rows are written —
 * after the insert, in the same transaction — rather than hoped for at the
 * reader.
 *
 * **Why the archive carries no history.** The archive is what the user AUTHORED,
 * on `main/imex.ts`'s terms for the timers module: bookmarks are pages somebody
 * deliberately kept, and they name a library and a path that are still meaningful
 * on another machine with the same pack. A history row is a log of what THIS
 * installation opened — mostly pages reached by clicking a link — and restoring
 * it would recreate a reading trail on a machine that never read it. So a restore
 * replaces the marks and EMPTIES the history, which is the honest reading of an
 * archive that says nothing about it.
 */
export class WikiStore {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {}

  /** The places this profile has read, newest first. */
  history(): WikiHistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, library_id, path, title, visited_at
           FROM wiki_history
          WHERE profile_id = ?
          ORDER BY visited_at DESC, id DESC
          LIMIT ?`,
      )
      .all(this.profileId, MAX_WIKI_HISTORY) as HistoryRow[];
    return rows.map(historyFromRow);
  }

  /** The pages this profile kept, by title in the Serbian collator's order. */
  bookmarks(): WikiBookmark[] {
    const rows = this.db
      .prepare(
        `SELECT id, library_id, path, title, created_at
           FROM wiki_bookmarks
          WHERE profile_id = ?`,
      )
      .all(this.profileId) as BookmarkRow[];
    return rows.map(bookmarkFromRow).sort((left, right) => {
      const byTitle = WIKI_COLLATOR.compare(left.title, right.title);
      return byTitle !== 0 ? byTitle : left.zimPath.localeCompare(right.zimPath);
    });
  }

  /**
   * Records a visit: moves the row if this place is already known, adds one if it
   * is not, and trims the tail. All of it in one transaction, because a visit
   * that inserted and then failed to trim would grow the table by one row per
   * failure.
   */
  recordVisit(place: WikiPlaceInput, now: string): void {
    const libraryId = this.validLibraryId(place.libraryId);
    const zimPath = this.validPath(place.zimPath);
    const title = this.validTitle(place.title);
    const stamp = this.validInstant(now);
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO wiki_history
             (id, profile_id, library_id, path, title, visited_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (profile_id, library_id, path)
             DO UPDATE SET title = excluded.title,
                           visited_at = excluded.visited_at,
                           updated_at = excluded.updated_at`,
        )
        .run(uuidv7(), this.profileId, libraryId, zimPath, title, stamp, stamp, stamp);
      this.trimHistory();
    })();
  }

  clearHistory(): void {
    this.db.prepare("DELETE FROM wiki_history WHERE profile_id = ?").run(this.profileId);
  }

  /** Keeps a page, or moves an existing mark for it to the newer title. */
  bookmark(place: WikiPlaceInput, now: string): WikiBookmark {
    const libraryId = this.validLibraryId(place.libraryId);
    const zimPath = this.validPath(place.zimPath);
    const title = this.validTitle(place.title);
    const stamp = this.validInstant(now);
    this.db.transaction(() => {
      const existing = this.db
        .prepare(
          "SELECT id FROM wiki_bookmarks WHERE profile_id = ? AND library_id = ? AND path = ?",
        )
        .get(this.profileId, libraryId, zimPath) as { id: string } | undefined;
      if (existing === undefined) {
        const count = this.db
          .prepare("SELECT COUNT(*) AS count FROM wiki_bookmarks WHERE profile_id = ?")
          .get(this.profileId) as { count: number };
        if (count.count >= MAX_WIKI_BOOKMARKS) {
          throw new WikiValidationError(
            `At most ${String(MAX_WIKI_BOOKMARKS)} pages may be kept.`,
          );
        }
      }
      this.db
        .prepare(
          `INSERT INTO wiki_bookmarks
             (id, profile_id, library_id, path, title, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (profile_id, library_id, path)
             DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
        )
        .run(uuidv7(), this.profileId, libraryId, zimPath, title, stamp, stamp);
    })();
    const row = this.db
      .prepare(
        `SELECT id, library_id, path, title, created_at
           FROM wiki_bookmarks
          WHERE profile_id = ? AND library_id = ? AND path = ?`,
      )
      .get(this.profileId, libraryId, zimPath) as BookmarkRow | undefined;
    if (row === undefined) throw new WikiNotFoundError("The mark was not stored.");
    return bookmarkFromRow(row);
  }

  unbookmark(id: string): void {
    const result = this.db
      .prepare("DELETE FROM wiki_bookmarks WHERE id = ? AND profile_id = ?")
      .run(id, this.profileId);
    if (result.changes === 0) throw new WikiNotFoundError(`No mark "${id}".`);
  }

  /**
   * Replaces this profile's marks with what an archive carried, and empties the
   * history (see the class comment).
   *
   * Rows are re-minted rather than restored by id: a mark's id is this database's
   * own key and no other profile holds it, so the archive carries what the user
   * kept — a library, a path and a title — and the keys are made here. A payload
   * already validated by the module's own `parse` is checked again below, because
   * a transaction that rolls back is a better answer than a row that violates a
   * CHECK.
   */
  replaceFromArchive(archive: WikiArchive | null, now: string): void {
    const stamp = this.validInstant(now);
    const rows: { libraryId: string; zimPath: string; title: string }[] = [];
    if (archive !== null) {
      if (archive.bookmarks.length > MAX_WIKI_BOOKMARKS) {
        throw new WikiValidationError(
          `At most ${String(MAX_WIKI_BOOKMARKS)} pages may be restored.`,
        );
      }
      const seen = new Set<string>();
      for (const place of archive.bookmarks) {
        const libraryId = this.validLibraryId(place.libraryId);
        const zimPath = this.validPath(place.zimPath);
        const title = this.validTitle(place.title);
        const key = `${libraryId}\u0000${zimPath}`;
        if (seen.has(key)) {
          throw new WikiValidationError("One archive keeps the same page twice.");
        }
        seen.add(key);
        rows.push({ libraryId, zimPath, title });
      }
    }
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM wiki_bookmarks WHERE profile_id = ?").run(this.profileId);
      this.db.prepare("DELETE FROM wiki_history WHERE profile_id = ?").run(this.profileId);
      const insert = this.db.prepare(
        `INSERT INTO wiki_bookmarks
           (id, profile_id, library_id, path, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        insert.run(uuidv7(), this.profileId, row.libraryId, row.zimPath, row.title, stamp, stamp);
      }
    })();
  }

  // --- Internals ------------------------------------------------------------

  /** Keeps the newest `MAX_WIKI_HISTORY` rows and deletes the rest. */
  private trimHistory(): void {
    this.db
      .prepare(
        `DELETE FROM wiki_history
          WHERE profile_id = ?
            AND id NOT IN (
              SELECT id FROM wiki_history
               WHERE profile_id = ?
               ORDER BY visited_at DESC, id DESC
               LIMIT ?
            )`,
      )
      .run(this.profileId, this.profileId, MAX_WIKI_HISTORY);
  }

  private validInstant(value: string): string {
    if (!isDateTime(value)) {
      throw new WikiValidationError(`"${value}" is not an instant.`);
    }
    return value;
  }

  private validLibraryId(raw: string): string {
    if (raw.length === 0 || raw.length > MAX_WIKI_LIBRARY_ID_LENGTH || !LIBRARY_ID.test(raw)) {
      throw new WikiValidationError(
        `A library id must be lower-case kebab-case, at most ${String(MAX_WIKI_LIBRARY_ID_LENGTH)} characters.`,
      );
    }
    return raw;
  }

  private validPath(raw: string): string {
    if (raw.length === 0 || raw.length > MAX_WIKI_PATH_LENGTH) {
      throw new WikiValidationError(
        `A path must be 1..${String(MAX_WIKI_PATH_LENGTH)} characters.`,
      );
    }
    return raw;
  }

  private validTitle(raw: string): string {
    const title = raw.trim();
    if (title.length === 0 || title.length > MAX_WIKI_TITLE_LENGTH) {
      throw new WikiValidationError(
        `A title must be 1..${String(MAX_WIKI_TITLE_LENGTH)} characters.`,
      );
    }
    return title;
  }
}
