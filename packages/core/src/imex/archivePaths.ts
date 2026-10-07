/**
 * Pure helpers for turning user-authored text into archive path segments
 * (IMEX, ADR-022 section 3: the Markdown mirror). A note's title or a
 * folder's name is hostile input from an archive's point of view — it must
 * survive being extracted cleanly on Windows (NTFS forbids a handful of
 * characters, silently drops trailing dots/spaces, and reserves a few device
 * names) as well as collide-free extraction on any case-insensitive
 * filesystem (NTFS, APFS).
 *
 * Deliberately NOT the same helper as `apps/desktop`'s `sanitizeFileName`
 * (`main/attachments.ts`), which names a temp copy handed to the OS shell: that
 * one preserves the extension a file's own name already carries and falls back
 * to "prilog", this one builds a path segment inside an archive we own. Two
 * contracts that happen to share a technique, not one contract in two places.
 */

/** The name a note with no title gets in the Markdown mirror — the same "Bez naslova" the UI shows. */
export const UNTITLED_NOTE_NAME = "Bez naslova";

/** Every C0/C1 control character (code points 0-31 and 127), built from character codes so the source file never has to carry a raw control byte. */
function controlCharRange(): string {
  let chars = "";
  for (let code = 0; code <= 0x1f; code += 1) chars += String.fromCharCode(code);
  return chars + String.fromCharCode(0x7f);
}

/** `/ \ : * ? " < > |` plus every C0/C1 control character. */
const FORBIDDEN_CHARS = new RegExp(`[/\\\\:*?"<>|${controlCharRange()}]`, "g");

/**
 * A trailing run of dots and/or spaces removed, in one pass. Windows silently
 * drops these, which would otherwise collapse two distinct names into one.
 *
 * A scan rather than `/[. ]+$/`, which re-walked the run from every position in
 * it: a note title of a hundred thousand dots spent seconds here, and a title is
 * as hostile as the archive it came from.
 */
function trimTrailingDotsAndSpaces(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "." || text[end - 1] === " ")) end -= 1;
  return text.slice(0, end);
}
const MAX_SEGMENT_LENGTH = 80;

/** Windows' reserved device names. Reserved case-insensitively AND with any extension appended — `CON.txt` is still the console device — so the check below reads the stem, not the whole segment. */
const RESERVED_DEVICE_NAMES = new Set<string>([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

/**
 * Turns `raw` (a note title, a folder name) into one filesystem-safe path
 * segment: forbidden characters become `-`, whitespace runs collapse to a
 * single space, trailing dots/spaces are stripped, the result is capped to 80
 * characters, and a result that collapses to nothing (or to `.`/`..`, which
 * would otherwise reference the current/parent directory) falls back to
 * `fallback`. A reserved Windows device name (`CON`, `COM1`, etc, matched
 * case-insensitively) gets a trailing `_` so it stays a normal file/directory
 * name rather than a special device.
 */
export function sanitizePathSegment(raw: string, fallback: string): string {
  let result = raw.replace(FORBIDDEN_CHARS, "-");
  result = result.replace(/\s+/g, " ").trim();
  result = trimTrailingDotsAndSpaces(result);
  // Stripped twice on purpose: the cap slices blind, so it can re-expose a
  // trailing dot or space that Windows then drops silently — which is how two
  // names that differ only past the cap would land on one file.
  result = trimTrailingDotsAndSpaces(result.slice(0, MAX_SEGMENT_LENGTH).trim());

  if (result === "" || result === "." || result === "..") {
    return fallback;
  }
  // The `_` goes on the STEM, not the end: `CON.txt_` still has the stem
  // `CON` and stays reserved, while `CON_.txt` is an ordinary name.
  const dotIndex = result.indexOf(".");
  const stem = dotIndex === -1 ? result : result.slice(0, dotIndex);
  if (RESERVED_DEVICE_NAMES.has(stem.toUpperCase())) {
    return `${stem}_${result.slice(stem.length)}`;
  }
  return result;
}

/**
 * Claims a collision-free name in one directory's registry. `taken` holds
 * every name already used in that directory, case-folded — extraction
 * targets (NTFS, APFS) are case-insensitive, so `Plan.md` and `plan.md` must
 * not both be emitted. Returns `base + extension` if that's free, otherwise
 * numbers it `(2)`, `(3)`, … until free, and registers the chosen name
 * (mutating `taken`) before returning it. Pass `""` as `extension` for a
 * directory segment.
 */
export function claimUniqueName(taken: Set<string>, base: string, extension: string): string {
  let candidate = `${base}${extension}`;
  let suffix = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} (${suffix})${extension}`;
    suffix += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
