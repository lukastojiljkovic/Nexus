import {
  MAX_WIKI_LIBRARY_ID_LENGTH,
  MAX_WIKI_PATH_LENGTH,
  MAX_WIKI_TITLE_LENGTH,
} from "@nexus/db";

/**
 * WIKI's archive payload (ADR-090 §imex): what this module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **Why this lives in `main/` rather than in `shared/`.** The bounds it enforces
 * are the STORE's — `MAX_WIKI_PATH_LENGTH`, `MAX_WIKI_TITLE_LENGTH` and
 * `MAX_WIKI_LIBRARY_ID_LENGTH` come from `@nexus/db`, which no file under
 * `shared/` may import (it is SQLite, and the renderer shares that folder). A
 * second copy of 512 and 200 up there would be two numbers that agree until one
 * moves.
 *
 * **Why the payload carries bookmarks and not the reading log.** A mark is
 * something the user deliberately kept, and it names a library and a path that
 * still mean something on another machine with the same pack. A history row is a
 * log of what THIS installation opened — mostly pages reached by clicking a link
 * — and restoring one would recreate a reading trail on a machine that never read
 * it. So a restore replaces the marks and empties the log, which is the honest
 * reading of an archive that says nothing about it (`WikiStore` records the same
 * decision from the other side).
 *
 * **Why the library id is carried as a string and not resolved.** Libraries are
 * device-level, so a restored mark may name a library this machine does not have
 * — a USB stick's pack that is not mounted yet, or one the user has not
 * downloaded. Keeping the row is right: the mark is the user's and the library
 * may arrive later, and the page says which marks are not available right now.
 *
 * **Why `version` is checked rather than assumed.** `ProfileData.modules` holds
 * `payload: unknown`, and core says out loud that the shape belongs to the module.
 * The field is what makes that safe: a payload written by a later build of THIS
 * module is refused by name instead of being half-read.
 */

/** The schema of the payload `exportData` writes. A new shape is a new number, never a quiet reinterpretation. */
export const WIKI_EXPORT_VERSION = 1;

/** How many marks one archive may carry. A bound on untrusted input, and one the store enforces again. */
const MAX_ARCHIVE_BOOKMARKS = 500;

/** One mark, as the archive carries it: what the user kept, and nothing about the row that held it. */
export interface WikiBookmarkExport {
  libraryId: string;
  zimPath: string;
  title: string;
}

/** The whole payload. `version` first, so a reader sees the number before the data. */
export interface WikiExport {
  version: number;
  bookmarks: WikiBookmarkExport[];
}

/** What `exportData` is handed: this module's own rows, already read from the store. */
export function buildWikiExport(
  bookmarks: readonly { libraryId: string; zimPath: string; title: string }[],
): WikiExport {
  return {
    version: WIKI_EXPORT_VERSION,
    bookmarks: bookmarks.map((bookmark) => ({
      libraryId: bookmark.libraryId,
      zimPath: bookmark.zimPath,
      title: bookmark.title,
    })),
  };
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * **Throwing is the contract.** This is a `ModuleImport.parse`: the host runs it
 * when the section is read — at the preview, so the user hears the refusal before
 * confirming a restore — and again before any module writes, and it must write
 * nothing itself. A half-validated payload that failed on its fortieth row would
 * leave a profile holding a fragment of an archive. So this has no early return
 * and no partial result: it either answers with a fully validated, normalised
 * payload or it throws, and every message names the field that is wrong.
 *
 * Two identical marks are refused here rather than by the UNIQUE index, for
 * `parseTimersExport`'s reason: the store's refusal would arrive after its own
 * first insert, and this one arrives before the transaction opens.
 */
export function parseWikiExport(value: unknown): WikiExport {
  const record = asRecord(value, "payload");
  if (record.version !== WIKI_EXPORT_VERSION) {
    throw new Error(
      `Wiki data was written by another version of this module (found ${String(record.version)}, expected ${WIKI_EXPORT_VERSION}).`,
    );
  }
  const raw = record.bookmarks;
  if (!Array.isArray(raw)) throw new Error('Wiki data: "bookmarks" must be an array.');
  if (raw.length > MAX_ARCHIVE_BOOKMARKS) {
    throw new Error(`Wiki data: at most ${String(MAX_ARCHIVE_BOOKMARKS)} bookmark(s) may be restored.`);
  }
  const bookmarks: WikiBookmarkExport[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const bookmark = asRecord(entry, "bookmarks[]");
    const libraryId = asLibraryId(bookmark.libraryId);
    const zimPath = asPath(bookmark.zimPath);
    const key = `${libraryId}\u0000${zimPath}`;
    if (seen.has(key)) throw new Error(`Wiki data: "${zimPath}" is kept twice.`);
    seen.add(key);
    bookmarks.push({ libraryId, zimPath, title: asTitle(bookmark.title) });
  }
  return { version: WIKI_EXPORT_VERSION, bookmarks };
}

/** The archive's own structural rule: an object, never an array or a primitive. */
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Wiki data: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** A library id: the store's own bound and shape, applied before the store sees it. */
function asLibraryId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_WIKI_LIBRARY_ID_LENGTH ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    throw new Error('Wiki data: "bookmarks[].libraryId" must be a library id.');
  }
  return value;
}

/** A ZIM path: the store's own bound, and the shape the reader would look up. */
function asPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_WIKI_PATH_LENGTH) {
    throw new Error(
      `Wiki data: "bookmarks[].zimPath" must be 1..${String(MAX_WIKI_PATH_LENGTH)} characters.`,
    );
  }
  return value;
}

/** A title, trimmed here rather than by the store: a store's refusal would arrive after its own insert. */
function asTitle(value: unknown): string {
  if (typeof value !== "string") throw new Error('Wiki data: "bookmarks[].title" must be a string.');
  const title = value.trim();
  if (title.length === 0 || title.length > MAX_WIKI_TITLE_LENGTH) {
    throw new Error(
      `Wiki data: a title must be 1..${String(MAX_WIKI_TITLE_LENGTH)} characters.`,
    );
  }
  return title;
}
