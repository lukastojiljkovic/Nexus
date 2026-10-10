import type Database from "better-sqlite3-multiple-ciphers";
import { DatabaseError } from "../errors.js";
import { isDateTime } from "../finance/money.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** The three reading sizes the page offers, in order. A fourth is a migration, not a string. */
export const READER_TEXT_SIZES = ["s", "m", "l"] as const;
export type ReaderTextSize = (typeof READER_TEXT_SIZES)[number];

/** The default a profile answers before anybody has touched the control. */
export const READER_DEFAULT_TEXT_SIZE: ReaderTextSize = "m";

/** A note beside a bookmark: a sentence about a page, not a second article. */
export const MAX_READER_NOTE_LENGTH = 500;

/**
 * The longest pack id and article path this store will hold. Both are the pack
 * format's own bounds (`PACK_LIMITS.idLength` and `PACK_LIMITS.pathLength`),
 * restated here because `@nexus/db` may not import the desktop's packs layer:
 * a store that accepted more than the format can produce would be storing a row
 * nothing could ever point at.
 */
export const MAX_READER_PACK_ID_LENGTH = 64;
export const MAX_READER_ARTICLE_PATH_LENGTH = 240;

/** Thrown when a reader write is refused at the store boundary. */
export class ReaderValidationError extends DatabaseError {}

/** Where one profile stopped reading one pack. */
export interface ReaderPosition {
  readonly packId: string;
  readonly articlePath: string;
  readonly updatedAt: string;
}

/** One bookmarked article, with the note the user chose to write beside it. */
export interface ReaderBookmark {
  readonly id: string;
  readonly packId: string;
  readonly articlePath: string;
  readonly note: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The module's one stored preference. */
export interface ReaderSettings {
  readonly textSize: ReaderTextSize;
}

/** What one archive carries for this module, already validated by the module's own `parse`. */
export interface ReaderArchiveInput {
  readonly positions: readonly { readonly packId: string; readonly articlePath: string }[];
  readonly bookmarks: readonly {
    readonly packId: string;
    readonly articlePath: string;
    readonly note: string;
  }[];
  readonly textSize: ReaderTextSize | null;
  readonly acknowledged: readonly string[];
}

interface PositionRow {
  pack_id: string;
  article_path: string;
  updated_at: string;
}

interface BookmarkRow {
  id: string;
  pack_id: string;
  article_path: string;
  note: string;
  created_at: string;
  updated_at: string;
}

function positionFromRow(row: PositionRow): ReaderPosition {
  return { packId: row.pack_id, articlePath: row.article_path, updatedAt: row.updated_at };
}

function bookmarkFromRow(row: BookmarkRow): ReaderBookmark {
  return {
    id: row.id,
    packId: row.pack_id,
    articlePath: row.article_path,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * READER's storage (migration 084): where each profile stopped, what it
 * bookmarked and noted, its reading size, and the safety notices it accepted.
 *
 * **Why nothing about a pack's content is here.** A pack is not one profile's
 * data (ADR-091): two profiles share one installed Wikipedia, and neither
 * profile's archive should carry somebody else's library. So this store holds
 * only what the profile AUTHORED - positions, notes, a preference, an
 * acknowledgement - and every read of it is scoped by `profile_id`.
 *
 * **Why the pack id and the path are validated here as well as on the wire.** A
 * store is the last place before a row exists, and the bounds here are the pack
 * format's own; a row holding a path longer than the format allows would be a
 * bookmark nothing could ever resolve.
 */
export class ReaderStore {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {}

  // --- Positions ------------------------------------------------------------

  listPositions(): ReaderPosition[] {
    const rows = this.db
      .prepare(
        `SELECT pack_id, article_path, updated_at
           FROM reader_positions
          WHERE profile_id = ?
          ORDER BY pack_id`,
      )
      .all(this.profileId) as PositionRow[];
    return rows.map(positionFromRow);
  }

  position(packId: string): ReaderPosition | null {
    const row = this.db
      .prepare(
        `SELECT pack_id, article_path, updated_at
           FROM reader_positions
          WHERE profile_id = ? AND pack_id = ?`,
      )
      .get(this.profileId, this.validPackId(packId)) as PositionRow | undefined;
    return row === undefined ? null : positionFromRow(row);
  }

  /**
   * Records where this profile is in one pack. An upsert, because "where I am"
   * is one fact per book: the row is replaced rather than accumulated, and the
   * `updated_at` stamp is the only history it keeps.
   */
  setPosition(packId: string, articlePath: string, now: string): ReaderPosition {
    const id = this.validPackId(packId);
    const path = this.validArticlePath(articlePath);
    const stamp = this.validInstant(now);
    this.db
      .prepare(
        `INSERT INTO reader_positions (profile_id, pack_id, article_path, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (profile_id, pack_id)
           DO UPDATE SET article_path = excluded.article_path, updated_at = excluded.updated_at`,
      )
      .run(this.profileId, id, path, stamp);
    return { packId: id, articlePath: path, updatedAt: stamp };
  }

  // --- Bookmarks ------------------------------------------------------------

  listBookmarks(): ReaderBookmark[] {
    const rows = this.db
      .prepare(
        `SELECT id, pack_id, article_path, note, created_at, updated_at
           FROM reader_bookmarks
          WHERE profile_id = ?
          ORDER BY pack_id, article_path`,
      )
      .all(this.profileId) as BookmarkRow[];
    return rows.map(bookmarkFromRow);
  }

  bookmarksOf(packId: string): ReaderBookmark[] {
    const rows = this.db
      .prepare(
        `SELECT id, pack_id, article_path, note, created_at, updated_at
           FROM reader_bookmarks
          WHERE profile_id = ? AND pack_id = ?
          ORDER BY article_path`,
      )
      .all(this.profileId, this.validPackId(packId)) as BookmarkRow[];
    return rows.map(bookmarkFromRow);
  }

  /**
   * Bookmarks one article, or rewrites the note beside an existing bookmark.
   *
   * One method for both because the user pressed one control: a bookmark with no
   * note and the same bookmark with a sentence are one bookmark whose note
   * changed. The `created_at` of an existing row is kept - it is when this
   * article was first bookmarked, which is a fact the note's edit does not
   * change.
   */
  setBookmark(packId: string, articlePath: string, note: string, now: string): ReaderBookmark {
    const id = this.validPackId(packId);
    const path = this.validArticlePath(articlePath);
    const text = this.validNote(note);
    const stamp = this.validInstant(now);
    this.db
      .prepare(
        `INSERT INTO reader_bookmarks
           (id, profile_id, pack_id, article_path, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (profile_id, pack_id, article_path)
           DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(uuidv7(), this.profileId, id, path, text, stamp, stamp);
    const row = this.db
      .prepare(
        `SELECT id, pack_id, article_path, note, created_at, updated_at
           FROM reader_bookmarks
          WHERE profile_id = ? AND pack_id = ? AND article_path = ?`,
      )
      .get(this.profileId, id, path) as BookmarkRow | undefined;
    if (row === undefined) throw new ReaderValidationError(`The bookmark for "${path}" was not written.`);
    return bookmarkFromRow(row);
  }

  /** Removes one article's bookmark. Answering `false` when there was none, so a double click is not an error. */
  removeBookmark(packId: string, articlePath: string): boolean {
    const result = this.db
      .prepare(
        "DELETE FROM reader_bookmarks WHERE profile_id = ? AND pack_id = ? AND article_path = ?",
      )
      .run(this.profileId, this.validPackId(packId), this.validArticlePath(articlePath));
    return result.changes > 0;
  }

  // --- Settings -------------------------------------------------------------

  settings(): ReaderSettings {
    const row = this.db
      .prepare("SELECT text_size FROM reader_settings WHERE profile_id = ?")
      .get(this.profileId) as { text_size: string } | undefined;
    return { textSize: readerTextSize(row?.text_size) ?? READER_DEFAULT_TEXT_SIZE };
  }

  setTextSize(size: ReaderTextSize, now: string): ReaderSettings {
    const stamp = this.validInstant(now);
    this.db
      .prepare(
        `INSERT INTO reader_settings (profile_id, text_size, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (profile_id)
           DO UPDATE SET text_size = excluded.text_size, updated_at = excluded.updated_at`,
      )
      .run(this.profileId, readerTextSize(size) ?? READER_DEFAULT_TEXT_SIZE, stamp);
    return this.settings();
  }

  // --- Acknowledged notices --------------------------------------------------

  /** The pack ids whose safety notice this profile has accepted. */
  listAcknowledged(): string[] {
    const rows = this.db
      .prepare("SELECT pack_id FROM reader_acknowledged WHERE profile_id = ? ORDER BY pack_id")
      .all(this.profileId) as { pack_id: string }[];
    return rows.map((row) => row.pack_id);
  }

  acknowledge(packId: string, now: string): void {
    this.db
      .prepare(
        `INSERT INTO reader_acknowledged (profile_id, pack_id, acknowledged_at)
         VALUES (?, ?, ?)
         ON CONFLICT (profile_id, pack_id) DO NOTHING`,
      )
      .run(this.profileId, this.validPackId(packId), this.validInstant(now));
  }

  // --- The archive ----------------------------------------------------------

  /**
   * Replaces this profile's Reader rows with one archive payload (ADR-090's imex section).
   *
   * One method inside one transaction, on `TimersStore.replaceFromArchive`'s
   * terms: what a restore puts back is exactly what the archive carried, whole.
   * An archive that carries no text size (`null`) DELETES the settings row rather
   * than writing today's default, so the default stays written down in exactly
   * one place - `settings()` - and a profile restored from an archive that never
   * chose one behaves as a fresh profile does.
   */
  replaceFromArchive(input: ReaderArchiveInput, now: string): void {
    const stamp = this.validInstant(now);
    const positions = input.positions.map((row) => ({
      packId: this.validPackId(row.packId),
      articlePath: this.validArticlePath(row.articlePath),
    }));
    // Two positions for one pack are one position the archive cannot order, so
    // they are refused before the transaction opens rather than silently
    // collapsed by the primary key.
    if (new Set(positions.map((row) => row.packId)).size !== positions.length) {
      throw new ReaderValidationError("Two positions in one archive name the same pack.");
    }
    const bookmarks = input.bookmarks.map((row) => ({
      id: uuidv7(),
      packId: this.validPackId(row.packId),
      articlePath: this.validArticlePath(row.articlePath),
      note: this.validNote(row.note),
    }));
    // Duplicates are refused here rather than by the UNIQUE index, for the timers
    // module's reason: the index's refusal would arrive after its own first insert,
    // and this one arrives before the transaction opens. A set per pack rather than
    // one joined key, so no separator character has to be chosen.
    const seen = new Map<string, Set<string>>();
    for (const row of bookmarks) {
      const paths = seen.get(row.packId) ?? new Set<string>();
      if (paths.has(row.articlePath)) {
        throw new ReaderValidationError("Two bookmarks in one archive name the same article.");
      }
      paths.add(row.articlePath);
      seen.set(row.packId, paths);
    }
    const acknowledged = input.acknowledged.map((packId) => this.validPackId(packId));
    const textSize = input.textSize === null ? null : (readerTextSize(input.textSize) ?? null);

    this.db.transaction(() => {
      this.db.prepare("DELETE FROM reader_positions WHERE profile_id = ?").run(this.profileId);
      this.db.prepare("DELETE FROM reader_bookmarks WHERE profile_id = ?").run(this.profileId);
      this.db.prepare("DELETE FROM reader_acknowledged WHERE profile_id = ?").run(this.profileId);

      const position = this.db.prepare(
        `INSERT INTO reader_positions (profile_id, pack_id, article_path, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (profile_id, pack_id) DO NOTHING`,
      );
      for (const row of positions) {
        position.run(this.profileId, row.packId, row.articlePath, stamp);
      }

      const bookmark = this.db.prepare(
        `INSERT INTO reader_bookmarks
           (id, profile_id, pack_id, article_path, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of bookmarks) {
        bookmark.run(row.id, this.profileId, row.packId, row.articlePath, row.note, stamp, stamp);
      }

      const ack = this.db.prepare(
        `INSERT INTO reader_acknowledged (profile_id, pack_id, acknowledged_at)
         VALUES (?, ?, ?)
         ON CONFLICT (profile_id, pack_id) DO NOTHING`,
      );
      for (const packId of acknowledged) ack.run(this.profileId, packId, stamp);

      if (textSize === null) {
        this.db.prepare("DELETE FROM reader_settings WHERE profile_id = ?").run(this.profileId);
      } else {
        this.setTextSize(textSize, stamp);
      }
    })();
  }

  // --- Internals ------------------------------------------------------------

  private validPackId(value: string): string {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_READER_PACK_ID_LENGTH) {
      throw new ReaderValidationError(
        `A pack id must be 1..${String(MAX_READER_PACK_ID_LENGTH)} characters.`,
      );
    }
    return value;
  }

  private validArticlePath(value: string): string {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > MAX_READER_ARTICLE_PATH_LENGTH ||
      value.includes("\u0000")
    ) {
      throw new ReaderValidationError(
        `An article path must be 1..${String(MAX_READER_ARTICLE_PATH_LENGTH)} characters.`,
      );
    }
    return value;
  }

  private validNote(value: string): string {
    if (typeof value !== "string" || value.length > MAX_READER_NOTE_LENGTH) {
      throw new ReaderValidationError(
        `A bookmark note may be at most ${String(MAX_READER_NOTE_LENGTH)} characters.`,
      );
    }
    return value;
  }

  private validInstant(value: string): string {
    if (!isDateTime(value)) throw new ReaderValidationError(`"${value}" is not an instant.`);
    return value;
  }
}

/** A stored text size, or `null` when the column holds something this build does not offer. */
function readerTextSize(value: string | undefined): ReaderTextSize | null {
  return value === "s" || value === "m" || value === "l" ? value : null;
}
