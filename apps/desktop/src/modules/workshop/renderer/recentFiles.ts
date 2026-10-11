import { WORKSHOP_TARGETS, type WorkshopTarget } from "../shared/ipc.js";

/**
 * The list of files this module last opened, on this machine and for this
 * profile.
 *
 * **Paths only, and that rule is the whole reason this file exists on its own.**
 * A viewer's input is somebody else's document, so keeping the CONTENTS anywhere
 * - in `localStorage`, in the database, in an archive - would turn a preview
 * into a second, unmanaged copy of a file that lives on a disk the user chose.
 * What is kept is the path, which makes the list a reminder rather than a store,
 * and the module's settings card says so in the reader's language.
 *
 * **Why `localStorage` and not the profile's tables.** This is a fact about the
 * MACHINE - the files a person opened on this computer - on the `filePrefs.ts` /
 * `accent.ts` recipe. It is also why the module has no migration and puts
 * nothing in an archive: another computer has its own files, and a restored
 * profile must not claim to know them.
 *
 * **Why the key carries the profile.** `accent.ts` scopes its device preference
 * the same way, for the same reason: two profiles on one machine are two people,
 * and a list of the files the other one opened is nobody's business.
 *
 * **Why the reads are total.** Everything in this key was written by this
 * module, but a hand-edited `localStorage` - or one written by a build that
 * stored something else - must not become a crash on a settings card. The parse
 * validates the whole array and drops what it understands nothing about.
 */

const RECENT_KEY_PREFIX = "nexus.workshop.recent.";

/** Most paths the list keeps: what somebody would actually reopen in a session. */
export const RECENT_MAX = 8;

/** One remembered file: what to show, and which viewer opened it. */
export interface RecentFile {
  readonly path: string;
  readonly name: string;
  /** Which viewer opened it, so a row can ask for the same one again. */
  readonly target: WorkshopTarget;
  /** When it was opened, as an ISO instant - a sort key and a record, nothing more. */
  readonly at: string;
}

/** The storage key for one profile - exported so a test asserts the scoping rather than assuming it. */
export function recentStorageKey(profileId: string): string {
  return `${RECENT_KEY_PREFIX}${profileId}`;
}

/** The list as stored: most recent first, no duplicates, at most `RECENT_MAX`. */
export function readRecentFiles(profileId: string): readonly RecentFile[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(recentStorageKey(profileId));
  } catch {
    // A storage that refuses to be read (a hardened profile, a full disk) is a
    // reason to show no list, never a reason for the page to fail.
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const files: RecentFile[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    const file = asRecentFile(entry);
    if (file === null) continue;
    // A repeated path is one file, and the FIRST occurrence is the more recent
    // one: the list is written most-recent-first, so a later copy is stale.
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    files.push(file);
    if (files.length === RECENT_MAX) break;
  }
  return files;
}

/**
 * Records one opened file, and answers the list it produced.
 *
 * The entry is promoted to the front rather than appended, which is what makes
 * the list most-recent-first without a sort; a file already in it therefore
 * moves up, with its old instant replaced.
 */
export function rememberRecentFile(
  profileId: string,
  file: { readonly path: string; readonly name: string; readonly target: WorkshopTarget },
  at: string,
): readonly RecentFile[] {
  const next: RecentFile[] = [
    { path: file.path, name: file.name, target: file.target, at },
    ...readRecentFiles(profileId).filter((entry) => entry.path !== file.path),
  ].slice(0, RECENT_MAX);
  write(profileId, next);
  return next;
}

/** Forgets the whole list for one profile - the card's one button. */
export function forgetRecentFiles(profileId: string): void {
  try {
    localStorage.removeItem(recentStorageKey(profileId));
  } catch {
    // Same answer as the read above: nothing this module can do about a storage
    // that refuses, and nothing the user loses by it.
  }
}

/** One stored entry, or `null` for anything that is not one. */
function asRecentFile(value: unknown): RecentFile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const path = record.path;
  const name = record.name;
  const at = record.at;
  const target = record.target;
  if (typeof path !== "string" || path === "") return null;
  if (typeof name !== "string" || name === "") return null;
  if (typeof at !== "string") return null;
  if (typeof target !== "string" || !isTarget(target)) return null;
  return { path, name, target, at };
}

function isTarget(value: string): value is WorkshopTarget {
  return WORKSHOP_TARGETS.some((target) => target === value);
}

function write(profileId: string, files: readonly RecentFile[]): void {
  try {
    localStorage.setItem(recentStorageKey(profileId), JSON.stringify(files));
  } catch {
    // The list is a convenience; a storage that refuses the write costs it and
    // nothing else.
  }
}
