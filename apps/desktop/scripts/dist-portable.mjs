// Builds the portable Windows build (ADR-102): a FOLDER to copy to a USB stick,
// plus a zip of it.
//
//   release/win-unpacked/                              the folder
//   release/Nexus-<version>-portable-win-x64.zip       the same folder, zipped
//
// WHY THE `dir` TARGET AND NOT AN INSTALLER. Portable mode is decided by a
// marker file BESIDE the executable, so the artifact has to be a folder with an
// executable at its top: an installer is the one shape that cannot carry it —
// it unpacks to a directory the user never sees, and its payload is a set of
// `.7z` parts rather than a tree a person can copy. `dir` is electron-builder's
// own name for „the packaged application, laid out, no installer".
//
// THE CONFIG IS THE SHIPPED ONE. Nothing here rewrites `electron-builder.yml`
// or adds a second config file beside it: the target is passed on the command
// line and everything else — the `files` list, `asarUnpack`, the native
// module's prebuild, the Electron fuses — is exactly what an installed build
// gets. A portable build that drifted from the installed one would be a second
// product to keep honest.
//
// WHAT THIS ADDS to that shared work, and the whole of it: the marker
// (`build/portable.txt`, copied verbatim — see `src/main/portable.ts`, where
// presence rather than content decides), an empty `NexusData/` so the folder
// says where data will go before the first run, and the zip.
//
// WINDOWS ONLY, for `dist.mjs`'s host rule and one of its own. The host rule is
// the same (an artifact nobody has run is not a shipped artifact). The second
// reason is the product's: „run Nexus.exe on any Windows computer" is what a
// stick is FOR, and on Linux the equivalent is an AppImage — a single FILE,
// where „beside the executable" means something else that has not been decided.
// Refusing is the honest answer until it is.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSinglePrebuild } from "./packaged-binary.mjs";
import { zipDirectory } from "./portable-zip.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, "..");

// The one place the target architecture is written, for `dist.mjs`'s reason:
// electron-builder's `${arch}` macro expands to the TARGET, and the flag below
// and the read-back at the end have to agree, which they can only do by coming
// from the same constant.
const TARGET_ARCH = "x64";

/** The marker, as it is checked in: what lands beside the executable is this file, byte for byte. */
const MARKER_SOURCE = join(APP_ROOT, "build", "portable.txt");

/** The folder `dir` writes for an x64 Windows build. `dist.mjs` names the Linux one for the same reason. */
const UNPACKED = join("release", "win-unpacked");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform !== "win32") {
  console.error(
    `A portable build is a Windows artifact, and this is ${process.platform}. ` +
      "See the header for what a Linux portable build would still have to decide.",
  );
  process.exit(1);
}

// require.resolve("electron-vite") only exposes the package's public export
// map, which does not declare the bin script as a subpath; the bin file is
// resolved relative to the package directory instead. `dist.mjs`'s line, and
// the same one — both scripts build the same `out/` the packagers then read.
const electronViteBin = join(
  dirname(require.resolve("electron-vite/package.json")),
  "bin/electron-vite.js",
);
run(process.execPath, [electronViteBin, "build"]);

const electronBuilderCli = require.resolve("electron-builder/cli.js");
run(process.execPath, [
  electronBuilderCli,
  "--win",
  "dir",
  `--${TARGET_ARCH}`,
  "--publish",
  "never",
]);

// The same read-back an installed build gets, before anything is added to the
// folder: an app packaged without its SQLite binary starts, paints its unlock
// screen and dies at the first query, and the zip would carry that silently.
let prebuild;
try {
  prebuild = assertSinglePrebuild({
    unpackedDir: UNPACKED,
    platform: "win32",
    arch: TARGET_ARCH,
  });
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}

copyFileSync(MARKER_SOURCE, join(UNPACKED, "portable.txt"));
mkdirSync(join(UNPACKED, "NexusData"), { recursive: true });

const version = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")).version;
const zipPath = join("release", `Nexus-${version}-portable-win-${TARGET_ARCH}.zip`);
await zipDirectory({
  from: UNPACKED,
  to: zipPath,
  // One top-level folder, so extracting the archive gives a folder to copy
  // rather than a pile of files in whatever directory the user extracted into.
  entryRoot: "Nexus",
  emptyDirectories: ["NexusData"],
});

console.log(
  `\nPackaging check: ${prebuild} is the only prebuild in the package.\n` +
    `Portable build:\n` +
    `  folder  ${UNPACKED}   — copy this to the stick\n` +
    `  archive ${zipPath}\n` +
    `Both carry portable.txt: Nexus.exe beside it keeps everything in\n` +
    `NexusData, on the stick and nowhere else.`,
);
