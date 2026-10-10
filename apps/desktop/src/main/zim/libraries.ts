import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

/**
 * The libraries a machine has: which ZIM files this app knows about, and where
 * each one is.
 *
 * **Why this is a device-level file rather than a profile table.** A ZIM is a
 * file on a disk — two gigabytes for the Serbian Wikipedia and a hundred and
 * nineteen for the English one — and two profiles on one machine are looking at
 * the same file. A profile-scoped table would mean downloading it twice, and a
 * per-profile "installed" list for one 119 GB file is a claim about the disk
 * that is not true. This is ADR-091's arrangement for a pack (`installed.json`
 * under `<userData>/packs`) applied to a different kind of content, and ADR-098
 * records it. What IS per-profile is what a person did with the library: which
 * page they read and which they kept, which lives in migration 88.
 *
 * **Why the file is the source of truth and the disk is not walked.** A library
 * can be a `.zim` anywhere the user keeps files (this module accepts a plain
 * file by path, not only a pack under `userData`), so there is no directory to
 * rebuild the list from. The index is therefore authoritative for WHAT IS
 * KNOWN, and every read checks that the file is still there: a library whose
 * file has been moved or deleted is reported as missing rather than silently
 * dropped, because "my Wikipedia is gone" is a thing the user has to be told.
 *
 * **Why the whole record is validated on the way in.** This file is outside the
 * encrypted database and hand-editable — like `cloud.json`, `network.json` and
 * `accounts.json` — and it holds a PATH that the reader will open. A malformed
 * record, an over-long id, an id that is not a usable `nx-zim://` host, or a
 * path that is not an absolute string is refused by dropping that record, and a
 * record dropped is one library this build does not list.
 */

/** The sub-directory of `userData` the index and downloaded files live in. */
export const ZIM_DIR = "zim";

/** The index's own format, so a future one can be recognised rather than guessed at. */
export const LIBRARIES_VERSION = 1;

export const LIBRARIES_FILE = "libraries.json";

/** One library, as stored. Deliberately flat and small. */
export interface ZimLibraryRecord {
  /** The `nx-zim://` host: lower-case, kebab-case, unique on this machine. */
  readonly id: string;
  /** What the page lists it as: the ZIM's own `M/Title`, or the file's name. */
  readonly title: string;
  /** Absolute path of the `.zim` file. */
  readonly path: string;
  readonly bytes: number;
  /**
   * How much this app knows about where the bytes came from.
   *
   * `"checksum"` is a file THIS app downloaded: its SHA-256 was compared with the
   * one Kiwix publishes in the pack's Metalink file, and the ZIM's own MD5 was
   * recomputed from the file after it landed. `"none"` is a file the user
   * pointed at — a USB stick, an old download, somebody else's copy — and
   * nothing about it is known. The page says which of the two it is, because
   * "the bytes are the ones Kiwix published" and "these are some bytes" are
   * different facts, and a checksum is NOT a signature: see ADR-098.
   */
  readonly integrity: "checksum" | "none";
  /** The ZIM's own MD5 trailer, as read from the file. */
  readonly checksum: string;
  /** Where it came from when this app downloaded it, or `null`. */
  readonly source: string | null;
  readonly language: string | null;
  readonly addedAt: number;
}

export function zimRoot(userData: string): string {
  return join(userData, ZIM_DIR);
}

export function librariesPath(userData: string): string {
  return join(zimRoot(userData), LIBRARIES_FILE);
}

/** Where a file this app downloaded lands: `<userData>/zim/<id>.zim`. */
export function downloadTargetPath(userData: string, id: string): string {
  return join(zimRoot(userData), `${id}.zim`);
}

/** Whether the record's file is still where the record says. */
export function libraryPresent(record: ZimLibraryRecord): boolean {
  return existsSync(record.path);
}

/**
 * The index, read. A missing, unreadable or unknown-version file answers an
 * EMPTY list rather than an error: there is nothing an index of nothing can
 * break, and the next write replaces it.
 */
export function readLibraries(userData: string): ZimLibraryRecord[] {
  let text: string;
  try {
    text = readFileSync(librariesPath(userData), "utf8");
  } catch {
    return [];
  }
  try {
    return parseLibraries(JSON.parse(text));
  } catch {
    return [];
  }
}

/** The records a parsed `libraries.json` holds, dropping anything this build will not use. */
export function parseLibraries(value: unknown): ZimLibraryRecord[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (record["version"] !== LIBRARIES_VERSION) return [];
  const rows = record["libraries"];
  if (!Array.isArray(rows)) return [];
  const libraries: ZimLibraryRecord[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const library = parseLibrary(row);
    if (library === null || seen.has(library.id)) continue;
    seen.add(library.id);
    libraries.push(library);
  }
  return libraries;
}

function parseLibrary(value: unknown): ZimLibraryRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = row["id"];
  const title = row["title"];
  const path = row["path"];
  const bytes = row["bytes"];
  const checksum = row["checksum"];
  const addedAt = row["addedAt"];
  if (typeof id !== "string" || !isValidLibraryId(id)) return null;
  if (typeof title !== "string" || title === "" || title.length > 200) return null;
  if (typeof path !== "string" || path === "" || path.length > 4096) return null;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) return null;
  if (typeof checksum !== "string" || !/^[0-9a-f]{32}$/.test(checksum)) return null;
  if (typeof addedAt !== "number" || !Number.isFinite(addedAt)) return null;
  const source = row["source"];
  const language = row["language"];
  return {
    id,
    title,
    path,
    bytes,
    integrity: row["integrity"] === "checksum" ? "checksum" : "none",
    checksum,
    source: typeof source === "string" && source.length <= 2048 ? source : null,
    language: typeof language === "string" && language.length <= 32 ? language : null,
    addedAt,
  };
}

/**
 * Whether an id can be an `nx-zim://` host.
 *
 * Lower-case kebab-case only: a `standard` scheme lower-cases its host, so an id
 * with a capital letter in it would be an id the URL could never name again —
 * which is exactly the class of defect `paths.ts` refuses for a path, one layer
 * up.
 */
export function isValidLibraryId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64;
}

/**
 * An id for a ZIM file, derived from its name and made unique against `taken`.
 *
 * Derived rather than random so that a person who has two files can tell them
 * apart in a log, and suffixed rather than refused when the name is taken,
 * because two files named `wikipedia.zim` in two folders is an ordinary thing to
 * have.
 */
export function libraryIdFromPath(path: string, taken: ReadonlySet<string>): string {
  const stem = basename(path, extname(path));
  const base =
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "zim";
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base.slice(0, 56)}-${String(suffix)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 48)}-${String(Date.now() % 100_000)}`;
}

/** Writes the index whole, through a temporary file and a rename — `accounts.ts`'s arrangement, for its reason. */
export function writeLibraries(userData: string, libraries: readonly ZimLibraryRecord[]): void {
  mkdirSync(zimRoot(userData), { recursive: true });
  const path = librariesPath(userData);
  const temporary = `${path}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ version: LIBRARIES_VERSION, libraries }, null, 2)}\n`,
    "utf8",
  );
  renameSync(temporary, path);
}

/** Adds one library and answers the whole index. A second record for the same path replaces the first. */
export function addLibrary(
  userData: string,
  library: ZimLibraryRecord,
): ZimLibraryRecord[] {
  const existing = readLibraries(userData).filter((row) => row.path !== library.path);
  const libraries = [...existing, library];
  writeLibraries(userData, libraries);
  return libraries;
}

/**
 * Forgets one library and answers the whole index.
 *
 * The FILE is never deleted, and that is the deliberate part: 119 GB of somebody
 * else's download is not this app's to remove, and a page that can delete a file
 * on the strength of one click is a page that can delete the wrong one.
 */
export function removeLibrary(userData: string, id: string): ZimLibraryRecord[] {
  const libraries = readLibraries(userData).filter((row) => row.id !== id);
  writeLibraries(userData, libraries);
  return libraries;
}

/** How big a file is, or `null` when it is not there. */
export function libraryFileBytes(path: string): number | null {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}


