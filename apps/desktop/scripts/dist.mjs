// Builds the packaged app for the HOST platform (--publish never):
//   Windows → NSIS x64 installer
//   Linux   → AppImage x64 + tar.gz (the payload build/gentoo/ installs)
//
// It builds for the host and only the host, on purpose — but the reason is no
// longer the one that used to be written here. It USED to be the native module:
// the old apparatus fetched a single prebuild for `process.platform`, so a
// cross-built archive carried a Windows .node and failed at the first query
// with an error about the module rather than about the build. That is gone.
// better-sqlite3-multiple-ciphers 13.0.3 ships all eight platform binaries in
// the npm package, and the `files` list keeps the TARGET's rather than the
// host's, so the native module would now cross-build correctly.
//
// What did not change is everything else: an AppImage wants Linux tooling and
// an NSIS installer wants Windows', nothing here has ever produced or opened a
// cross-built artifact, and an installer that has never been run is not a
// shipped installer. Refusing is still the honest outcome; the Linux artifacts
// are built by running this script under Linux (WSL is enough — see
// build/gentoo/README.md).

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

// The one place the target architecture is written. electron-builder's `${arch}`
// macro in electron-builder.yml expands to the TARGET arch, not the host's, so
// the flag below and the check at the end have to agree — and they can only be
// made to agree by coming from the same constant.
const TARGET_ARCH = "x64";

// electron-builder's own directory names for an x64 build. They carry the arch
// only when it is not x64 (`linux-arm64-unpacked`), which is why TARGET_ARCH
// appears in the filename below and not here.
const PLATFORM = {
  win32: { flag: "--win", unpacked: "win-unpacked" },
  linux: { flag: "--linux", unpacked: "linux-unpacked" },
};

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const target = PLATFORM[process.platform];
if (target === undefined) {
  console.error(
    `Nexus is not packaged for ${process.platform}. Run this on Windows or Linux ` +
      "(see the header for why the host platform is the only target).",
  );
  process.exit(1);
}

// require.resolve("electron-vite") only exposes the package's public export
// map, which does not declare the bin script as a subpath; the bin file is
// resolved relative to the package directory instead.
const electronViteBin = join(
  dirname(require.resolve("electron-vite/package.json")),
  "bin/electron-vite.js",
);
run(process.execPath, [electronViteBin, "build"]);

const electronBuilderCli = require.resolve("electron-builder/cli.js");
run(process.execPath, [
  electronBuilderCli,
  target.flag,
  `--${TARGET_ARCH}`,
  "--publish",
  "never",
]);

assertPackagedBinary();

/**
 * Reads back what was actually packaged, because a `files` pattern that misses
 * says nothing.
 *
 * The native module is the whole database, and electron-builder's globs decide
 * which of its eight prebuilds ship. A pattern that excludes too little costs
 * 17 MB and nobody notices; a pattern that excludes too much produces an
 * installer that starts, paints its unlock screen and throws at the first
 * query — and neither shows up in a build log, in `pnpm test`, or in `smoke`,
 * which runs against `out/` and never opens the package. Until this check
 * existed, the only detector was a person installing the result.
 */
function assertPackagedBinary() {
  const expected = `${process.platform}-${TARGET_ARCH}.node`;
  const prebuilds = join(
    "release",
    target.unpacked,
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
    console.error(
      `\nPackaging check failed: ${prebuilds} does not exist, so the packaged app ` +
        "carries no SQLite binary and cannot open a database.",
    );
    process.exit(1);
  }

  if (present.length !== 1 || present[0] !== expected) {
    console.error(
      `\nPackaging check failed: ${prebuilds} holds [${present.join(", ")}], ` +
        `expected exactly [${expected}].\n` +
        "See the `files` list in electron-builder.yml — the exclude and the " +
        "re-include below it are order-dependent.",
    );
    process.exit(1);
  }

  console.log(`\nPackaging check: ${expected} is the only prebuild in the package.`);
}
