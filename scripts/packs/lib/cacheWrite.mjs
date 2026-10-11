// No shebang, for the reason every module in this directory has none: this one is
// imported by the pack builders and by their tests.
//
// THE ONE WAY A BUILDER WRITES INTO ITS CACHE. Three builders keep everything
// they download under `%TEMP%\nexus-pack-cache\<pack id>\` and reuse it on the
// next run, so this is where the two problems a shared directory creates are
// answered once:
//
//   * **The name is predictable.** A cache file is named after the SHA-256 of
//     its URL, which is exactly what makes the second run a cache hit and exactly
//     what lets another process guess a name in a directory everyone may write
//     to. `mkdtempSync` is the creation that is safe there: a name nothing can
//     guess, and owner-only permissions on the directory it makes.
//   * **A check cannot be trusted.** `existsSync(path)` followed by a write is
//     the pattern CodeQL reports as `file-system-race`, with `insecure-temporary-file`
//     and `http-to-file-access` beside it on the same line: the file may appear
//     between the two, and the bytes being written came off the network. Writing
//     into the fresh directory and MOVING the file onto its name needs no check
//     at all, and a reader sees the old file or the new one, never half of
//     either.
//
// Callers pass a name inside the cache directory they already created; the
// digest, the byte count and the fetch date are the caller's business, because
// they are what its `sources.json` records.

import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Writes `data` to `path` without a check, without a race, and without a shared name. */
export function writeCacheFile(path, data) {
  const scratch = mkdtempSync(join(dirname(path), "write-"));
  try {
    const staged = join(scratch, "body");
    writeFileSync(staged, data, { mode: 0o600 });
    renameSync(staged, path);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
