/**
 * Version comparison for the update check, written by hand because
 * `electron-updater` left the tree in 1.5.0 and `semver` went with it
 * (ADR-089 §3). No dependency was added back for one function.
 *
 * The grammar is exactly `v?MAJOR.MINOR.PATCH`: each part is `0|[1-9]\d*` (no
 * leading zeros) and must be a safe integer, a leading lowercase `v` is the
 * only prefix, and there is no `-prerelease` and no `+build`. Anything else is
 * `null` — which the caller treats as "cannot decide", never as "not newer". A
 * comparison that answered `false` for a tag it did not understand would
 * silently hide a release.
 *
 * Pre-releases are refused rather than ordered. The product never tags one, so
 * a pre-release at `releases/latest` is not a build this updater should offer,
 * and the comparison that used to rank them did it by text, which puts
 * `rc.10` below `rc.9`: an order a crafted tag could use to pass for newer.
 */

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function parseVersion(input: string): ParsedVersion | null {
  const text = input.trim();
  const withoutV = text.startsWith("v") ? text.slice(1) : text;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(withoutV);
  if (match === null) return null;
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (major === undefined || minor === undefined || patch === undefined) return null;
  const majorNumber = Number(major);
  const minorNumber = Number(minor);
  const patchNumber = Number(patch);
  // A part that parses but does not fit a safe integer is not a version this
  // build can compare, and rounding it would silently make two different tags
  // equal.
  if (!Number.isSafeInteger(majorNumber)) return null;
  if (!Number.isSafeInteger(minorNumber)) return null;
  if (!Number.isSafeInteger(patchNumber)) return null;
  return {
    major: majorNumber,
    minor: minorNumber,
    patch: patchNumber,
  };
}

/**
 * Negative when `a` is older, positive when `a` is newer, zero when equal, and
 * `null` when either side is not a version this build understands.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return null;
  const numeric: readonly (keyof Pick<ParsedVersion, "major" | "minor" | "patch">)[] = [
    "major",
    "minor",
    "patch",
  ];
  for (const field of numeric) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  return 0;
}

/** `true` only when `candidate` is a strictly newer, fully understood version. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const order = compareVersions(candidate, current);
  return order !== null && order > 0;
}
