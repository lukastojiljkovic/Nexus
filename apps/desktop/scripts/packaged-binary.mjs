// The read-back both packaging scripts run against what they just built.
//
// Extracted from `dist.mjs` when `dist-portable.mjs` arrived (ADR-102): the
// portable folder is a second artifact with the same failure mode, and a second
// copy of a load-bearing assertion is a second place for it to drift. The
// reasoning below is `dist.mjs`'s own, moved here with the code.
//
// WHY IT EXISTS. Reads back what was actually packaged, because a `files`
// pattern that misses says nothing.
//
// The native module is the whole database, and electron-builder's globs decide
// which of its eight prebuilds ship. A pattern that excludes too little costs
// 17 MB and nobody notices; a pattern that excludes too much produces an
// installer that starts, paints its unlock screen and throws at the first
// query — and neither shows up in a build log, in `pnpm test`, or in `smoke`,
// which runs against `out/` and never opens the package. Until this check
// existed, the only detector was a person installing the result.

import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Throws unless `unpackedDir` carries exactly the TARGET's own SQLite prebuild
 * — never none, and never more than one.
 *
 * `unpackedDir` is the platform directory electron-builder wrote
 * (`release/win-unpacked`, `release/linux-unpacked`); the two names it needs to
 * know about the build — the platform and the arch — are the caller's, because
 * the caller chose the target.
 */
export function assertSinglePrebuild({ unpackedDir, platform, arch }) {
  const expected = `${platform}-${arch}.node`;
  const prebuilds = join(
    unpackedDir,
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "better-sqlite3-multiple-ciphers",
    "prebuilds",
  );

  let present;
  try {
    present = readdirSync(prebuilds).sort();
  } catch {
    throw new Error(
      `Packaging check failed: ${prebuilds} does not exist, so the packaged app ` +
        "carries no SQLite binary and cannot open a database.",
    );
  }

  if (present.length !== 1 || present[0] !== expected) {
    throw new Error(
      `Packaging check failed: ${prebuilds} holds [${present.join(", ")}], ` +
        `expected exactly [${expected}].\n` +
        "See the `files` list in electron-builder.yml — the exclude and the " +
        "re-include below it are order-dependent.",
    );
  }

  return expected;
}
