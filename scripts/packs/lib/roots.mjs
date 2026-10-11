/**
 * The two directories the pack builders keep OUTSIDE the repository: the
 * download cache, and the built packs.
 *
 * WHY THEY ARE NOT TEMPORARY FILES, WHICH IS THE WHOLE POINT. Every builder
 * used to name them itself — `join(tmpdir(), "nexus-pack-cache")` and
 * `join(tmpdir(), "nexus-packs")`, written out at twenty-one call sites in
 * thirteen files — and CodeQL's `js/insecure-temporary-file` reported every file
 * written under them, at high severity. The rule is right about the SHAPE, and
 * the fix is therefore here rather than a suppression: a PREDICTABLE NAME IN A
 * WORLD-WRITABLE DIRECTORY is a name another process can create first, or point
 * somewhere else with a symlink, between the moment it is chosen and the moment
 * it is written — and `os.tmpdir()` is exactly that directory on every Unix.
 * `%TEMP%` on Windows is per-user, which is why this went unnoticed here for so
 * long and why the rule fired anyway: the query cannot know which machine it is
 * reading. Neither directory is temporary in any case — the cache exists to be
 * REUSED across runs and the packs exist to be PUBLISHED — so the honest answer
 * is to stop calling a build artefact a temporary file.
 *
 * WHERE THEY LIVE NOW. One per-user directory under the home directory: not
 * world-writable, not swept by the OS between runs, and not inside this
 * repository (nothing here walks it, so no gate ever sees the ~300 MB of packs
 * that accumulate). The two names are the old ones, so a build log reads the
 * same way it did.
 *
 * THE OVERRIDES STILL WIN, and an EMPTY one is ignored rather than honoured:
 * `NEXUS_PACK_OUT=` in a shell is a mistake, and `join("", "art")` would put a
 * pack in whatever directory that shell happened to be in.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** The download cache: one directory per source, read back on every later run. */
export function cacheRoot() {
  const override = process.env["NEXUS_PACK_CACHE"];
  return override === undefined || override === "" ? join(homedir(), ".nexus-pack-cache") : override;
}

/** The built packs, and the `<id>.meta.json` files `pack-sign.mjs` reads beside them. */
export function outputRoot() {
  const override = process.env["NEXUS_PACK_OUT"];
  return override === undefined || override === "" ? join(homedir(), ".nexus-packs") : override;
}

/** The cache directory of one pack. */
export function cacheDirFor(id, ...rest) {
  return join(cacheRoot(), id, ...rest);
}

/** The output directory of one pack. */
export function packDirFor(id, ...rest) {
  return join(outputRoot(), id, ...rest);
}

/** The metadata file of one pack, which lives BESIDE its folder and never inside it. */
export function packMetaPathFor(id) {
  return join(outputRoot(), `${id}.meta.json`);
}
