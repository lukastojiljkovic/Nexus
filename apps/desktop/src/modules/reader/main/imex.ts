import {
  MAX_READER_ARTICLE_PATH_LENGTH,
  MAX_READER_NOTE_LENGTH,
  MAX_READER_PACK_ID_LENGTH,
  READER_TEXT_SIZES,
  type ReaderTextSize,
} from "@nexus/db";

/**
 * READER's archive payload (ADR-090 §imex): what one module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **Why this lives in `main/` rather than in `shared/`.** The bounds it enforces
 * are the STORE's - the pack id, the article path and the note length come from
 * `@nexus/db`, which no file under `shared/` may import (it is SQLite and
 * therefore Node-only, and the renderer shares that folder). A second copy of
 * `240` and `500` up there would be two numbers that agree until one moves.
 *
 * **Why the payload carries no pack content, and no pack versions.** What a pack
 * holds is not this profile's data (ADR-091 §5) and is reinstalled from a stick or
 * a download; what travels here is what the PERSON wrote - where they stopped,
 * what they bookmarked and the note beside it, how large they want the type, and
 * which notices they accepted. A position naming a pack the target machine does
 * not have is therefore normal rather than corrupt: it is a bookmark for a book
 * that is not on this shelf yet, and it stands there until the book arrives.
 *
 * **Why `version` is checked rather than assumed.** `ProfileData.modules` holds
 * `payload: unknown`, and core says out loud that the shape belongs to the
 * module. The field is what makes that safe: a payload written by a later build
 * of THIS module is refused by name instead of being half-read.
 */

/** The schema of the payload `exportData` writes. A new shape is a new number, never a quiet reinterpretation. */
export const READER_EXPORT_VERSION = 1;

/**
 * How many rows one archive may carry, per list.
 *
 * Bounds on untrusted input rather than limits anybody meets: each count is an
 * array length read out of a file and every entry costs a row. Two thousand
 * bookmarks is far past any real profile and far below anything that would make
 * a restore unpleasant.
 */
export const MAX_READER_ARCHIVE_BOOKMARKS = 2000;
export const MAX_READER_ARCHIVE_POSITIONS = 1000;
export const MAX_READER_ARCHIVE_ACKNOWLEDGED = 1000;

/** One reading position, as the archive carries it: which pack, which article. */
export interface ReaderPositionExport {
  packId: string;
  articlePath: string;
}

/** One bookmark, with the note the user wrote beside it (empty when there is none). */
export interface ReaderBookmarkExport {
  packId: string;
  articlePath: string;
  note: string;
}

/** The whole payload. `version` first, so a reader sees the number before the data. */
export interface ReaderExport {
  version: number;
  positions: ReaderPositionExport[];
  bookmarks: ReaderBookmarkExport[];
  settings: { textSize: ReaderTextSize };
  acknowledged: string[];
}

/** What `exportData` is handed: the module's own rows, already read from the store. */
export function buildReaderExport(
  positions: readonly { readonly packId: string; readonly articlePath: string }[],
  bookmarks: readonly { readonly packId: string; readonly articlePath: string; readonly note: string }[],
  settings: { readonly textSize: ReaderTextSize },
  acknowledged: readonly string[],
): ReaderExport {
  return {
    version: READER_EXPORT_VERSION,
    positions: positions.map((row) => ({ packId: row.packId, articlePath: row.articlePath })),
    bookmarks: bookmarks.map((row) => ({
      packId: row.packId,
      articlePath: row.articlePath,
      note: row.note,
    })),
    settings: { textSize: settings.textSize },
    acknowledged: [...acknowledged],
  };
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * **Throwing is the contract.** This is a `ModuleImport.parse`: the host runs it
 * when the section is read (at the preview, so the user hears the refusal before
 * confirming a restore) and again before any module writes, and it must write
 * nothing itself. A half-validated payload that failed on its four-hundredth row
 * would leave a profile holding a fragment of an archive. So there is no early
 * return and no partial result: it either answers a fully validated payload or it
 * throws, and every message names the field that is wrong.
 *
 * Duplicates are refused here rather than by the primary key, for the timers
 * module's reason: the store's refusal would arrive after its own first insert,
 * and this one arrives before the transaction opens.
 */
export function parseReaderExport(value: unknown): ReaderExport {
  const record = asRecord(value, "payload");
  if (record.version !== READER_EXPORT_VERSION) {
    throw new Error(
      `Reader data was written by another version of this module (found ${String(record.version)}, expected ${READER_EXPORT_VERSION}).`,
    );
  }

  const positions = asArray(record.positions, "positions", MAX_READER_ARCHIVE_POSITIONS).map(
    (entry, index) => {
      const row = asRecord(entry, `positions[${String(index)}]`);
      return {
        packId: asPackId(row.packId, `positions[${String(index)}].packId`),
        articlePath: asArticlePath(row.articlePath, `positions[${String(index)}].articlePath`),
      };
    },
  );
  const packs = new Set(positions.map((row) => row.packId));
  if (packs.size !== positions.length) {
    throw new Error('Reader data: two positions name the same pack in "positions".');
  }

  const bookmarks = asArray(record.bookmarks, "bookmarks", MAX_READER_ARCHIVE_BOOKMARKS).map(
    (entry, index) => {
      const row = asRecord(entry, `bookmarks[${String(index)}]`);
      return {
        packId: asPackId(row.packId, `bookmarks[${String(index)}].packId`),
        articlePath: asArticlePath(row.articlePath, `bookmarks[${String(index)}].articlePath`),
        note: asNote(row.note, `bookmarks[${String(index)}].note`),
      };
    },
  );
  const articles = new Set(bookmarks.map((row) => `${row.packId}\u0000${row.articlePath}`));
  if (articles.size !== bookmarks.length) {
    throw new Error('Reader data: two bookmarks name the same article in "bookmarks".');
  }

  const settings = asRecord(record.settings, "settings");
  const textSize = settings.textSize;
  if (!(READER_TEXT_SIZES as readonly unknown[]).includes(textSize)) {
    throw new Error(`Reader data: "settings.textSize" must be one of ${READER_TEXT_SIZES.join(", ")}.`);
  }

  const acknowledged = asArray(record.acknowledged, "acknowledged", MAX_READER_ARCHIVE_ACKNOWLEDGED).map(
    (entry, index) => asPackId(entry, `acknowledged[${String(index)}]`),
  );
  if (new Set(acknowledged).size !== acknowledged.length) {
    throw new Error('Reader data: "acknowledged" names one pack twice.');
  }

  return {
    version: READER_EXPORT_VERSION,
    positions,
    bookmarks,
    settings: { textSize: textSize as ReaderTextSize },
    acknowledged,
  };
}

/** The archive's own structural rule: an object, never an array or a primitive. */
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Reader data: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string, cap: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Reader data: "${field}" must be an array.`);
  if (value.length > cap) {
    throw new Error(`Reader data: at most ${String(cap)} entries may be restored in "${field}".`);
  }
  return value;
}

function asPackId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_READER_PACK_ID_LENGTH) {
    throw new Error(
      `Reader data: "${field}" must be a pack id of 1..${String(MAX_READER_PACK_ID_LENGTH)} characters.`,
    );
  }
  return value;
}

function asArticlePath(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_READER_ARTICLE_PATH_LENGTH ||
    value.includes("\u0000")
  ) {
    throw new Error(
      `Reader data: "${field}" must be a path of 1..${String(MAX_READER_ARTICLE_PATH_LENGTH)} characters.`,
    );
  }
  return value;
}

function asNote(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > MAX_READER_NOTE_LENGTH) {
    throw new Error(
      `Reader data: "${field}" must be a string of at most ${String(MAX_READER_NOTE_LENGTH)} characters.`,
    );
  }
  return value;
}
