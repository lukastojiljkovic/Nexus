/**
 * What a path inside a pack may be, and nothing else.
 *
 * A pack arrives from outside this machine — a USB stick, a friend's folder,
 * later a download — and every path in it is written by whoever built it. The
 * rules below are the whole of what this app will then do with those paths:
 * join them under a staging directory and open them. So each rule closes a way
 * that join can leave the staging directory, or a way two different names can
 * become one file on a case-insensitive, separator-wandering filesystem.
 *
 * The rules, in the order they are applied:
 *
 *   - a string, non-empty, no NUL and no control character;
 *   - no leading `/` (absolute), no `X:` (a drive), no leading `\\` (UNC);
 *   - no `\` anywhere, because on Windows it IS a separator and a path with
 *     both would mean two things to two layers;
 *   - no empty segment, which covers `a//b` and a trailing `/`;
 *   - no `.` and no `..` segment, in any position;
 *   - no `< > : " | ? *` and no character below 0x20;
 *   - no segment ending in `.` or a space, which Windows silently strips;
 *   - no reserved Windows device name (`CON`, `NUL`, `COM1`, `LPT1`, …), with
 *     or without an extension;
 *   - within `PACK_LIMITS.pathLength` characters and `PACK_LIMITS.pathDepth`
 *     segments.
 *
 * The separators in a pack path are always `/`. That is not a preference: the
 * manifest is JSON, it is written on one machine and read on another, and a
 * format whose meaning depends on which platform wrote it is a format that will
 * one day mean two things.
 */

import { PACK_LIMITS } from "./limits.js";

/** Which rule a path broke. The caller puts this in the message; the code is one. */
export type PackPathProblem =
  | "not-a-string"
  | "empty"
  | "too-long"
  | "nul"
  | "control"
  | "absolute"
  | "drive"
  | "unc"
  | "backslash"
  | "empty-segment"
  | "dot-segment"
  | "forbidden-char"
  | "trailing-dot-or-space"
  | "reserved-name"
  | "too-deep";

/**
 * The device names Windows reserves in every directory. A file called
 * `console.txt` is fine; a file called `CON.txt` is not, because the name
 * Windows compares is the part before the extension.
 */
const WINDOWS_RESERVED: ReadonlySet<string> = new Set<string>([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_unused, index) => `COM${String(index + 1)}`),
  ...Array.from({ length: 9 }, (_unused, index) => `LPT${String(index + 1)}`),
]);

const FORBIDDEN_CHARS = /[<>:"|?*]/;

/**
 * The rule a value broke, or `null` when the value is a path a pack may use.
 * Returning the rule rather than a boolean is what lets each rule have its own
 * test without each rule having its own code.
 */
export function packPathProblem(value: unknown): PackPathProblem | null {
  if (typeof value !== "string") return "not-a-string";
  if (value === "") return "empty";
  if (value.length > PACK_LIMITS.pathLength) return "too-long";
  if (value.includes("\u0000")) return "nul";
  // eslint-disable-next-line no-control-regex -- the C0 range IS the point of this check.
  if (/[\u0000-\u001f\u007f]/.test(value)) return "control";
  if (value.startsWith("/")) return "absolute";
  if (/^[A-Za-z]:/.test(value)) return "drive";
  if (value.startsWith("\\")) return "unc";
  if (value.includes("\\")) return "backslash";

  const segments = value.split("/");
  if (segments.length > PACK_LIMITS.pathDepth) return "too-deep";
  for (const segment of segments) {
    if (segment === "") return "empty-segment";
    if (segment === "." || segment === "..") return "dot-segment";
    if (FORBIDDEN_CHARS.test(segment)) return "forbidden-char";
    if (segment.endsWith(".") || segment.endsWith(" ")) return "trailing-dot-or-space";
    const stem = segment.split(".")[0] ?? segment;
    if (WINDOWS_RESERVED.has(stem.toUpperCase())) return "reserved-name";
  }
  return null;
}

/** Whether a pack may name this path. */
export function isSafePackPath(value: unknown): boolean {
  return packPathProblem(value) === null;
}

/**
 * A pack path as path segments, for joining under a directory this app owns.
 *
 * Only ever called after {@link isSafePackPath} has answered `null`: it is a
 * splitter, not a sanitiser, and a caller that reaches it with a refused path
 * has already lost the argument this module exists to win.
 */
export function packPathSegments(path: string): string[] {
  return path.split("/");
}

/**
 * Whether an id can also be a directory name on this platform.
 *
 * A pack id does double duty: it is the manifest's `id` and the name of the
 * folder the pack is installed into. The Windows rules that matter for a
 * single segment are the reserved names and a trailing dot or space, and they
 * are checked here rather than in `manifest.ts` because they are a property of
 * paths, and this is the module that owns those.
 */
export function isSafePackIdSegment(value: string): boolean {
  if (value === "" || value === "." || value === "..") return false;
  if (value.endsWith(".") || value.endsWith(" ")) return false;
  if (FORBIDDEN_CHARS.test(value)) return false;
  if (WINDOWS_RESERVED.has(value.toUpperCase())) return false;
  return true;
}
