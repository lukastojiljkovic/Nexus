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
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { assertSinglePrebuild } from "./packaged-binary.mjs";
import { platformNoticeEntriesHere } from "./platform-notices.mjs";
import { DEFAULT_DATA_FILE, renderNotices } from "./render-notices.mjs";

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
writeTargetNotices();

/**
 * Reads back what was actually packaged — `packaged-binary.mjs` owns the rule
 * and the reasons for it, because `dist-portable.mjs` builds a second artifact
 * with the exact same failure mode.
 */
function assertPackagedBinary() {
  try {
    const only = assertSinglePrebuild({
      unpackedDir: join("release", target.unpacked),
      platform: process.platform,
      arch: TARGET_ARCH,
    });
    console.log(`\nPackaging check: ${only} is the only prebuild in the package.`);
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exit(1);
  }
}

/**
 * The third-party notices for the installer this run just built, written beside
 * it as `release/THIRD-PARTY-NOTICES.md` (`directories.output` in
 * `electron-builder.yml`).
 *
 * WHY THE COMMITTED NOTICES ARE NOT ENOUGH. `licences.json` — what the app's own
 * Licence screen shows — is generated once and committed, so it must read the
 * same on the Linux CI runner and in a Windows checkout, and the generator
 * therefore leaves out every PLATFORM package (`isPlatformBuild`: `os` or `cpu`
 * is declared, so the package installs only on the machine that can run it).
 * Those are exactly the natives this installer carries most of:
 * `@img/sharp-win32-x64`, 19 812 379 B measured on 2026-10-10 and most of it the
 * two libvips DLLs, plus the `@node-llama-cpp/win-x64*` binaries. An installer
 * that ships them without their notices has not discharged their licences, and
 * the CI-rendered `release-docs/THIRD-PARTY-NOTICES.md` is built on a Linux
 * runner that has never seen them.
 *
 * WHY HERE, AND NOT IN THE GENERATOR. This script runs on the machine it
 * packages for — the header says why an installer is built by a platform that
 * can run it — so the platform builds in this tree are the ones electron-builder
 * just copied in, and `platform-notices.mjs` reads their notices off disk with
 * the same code the committed file is built from. Nothing is invented and
 * nothing is listed by hand.
 *
 * It throws rather than warns when pnpm's licence list cannot be read: a
 * document that silently omits a package the installer carries is the defect
 * this function exists to remove.
 */
function writeTargetNotices() {
  const data = JSON.parse(readFileSync(DEFAULT_DATA_FILE, "utf8"));
  const platform = platformNoticeEntriesHere();
  const document = renderNotices({ packages: [...data.packages, ...platform], fonts: data.fonts });
  const outFile = join("release", "THIRD-PARTY-NOTICES.md");
  writeFileSync(outFile, document);
  const names = platform.map((entry) => `${entry.name}@${entry.version}`).join(", ");
  console.log(
    `Packaging notices: ${outFile} carries ${data.packages.length + platform.length} packages` +
      `, ${platform.length} of them platform builds this installer ships` +
      (names === "" ? "." : ` (${names}).`),
  );
}
