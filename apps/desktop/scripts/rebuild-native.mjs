// Provisions the `better-sqlite3-multiple-ciphers` native binary for a given
// runtime by downloading the published prebuild — no node-gyp / source compile.
//
// Why this exists: the module loads a single `build/Release/better_sqlite3.node`
// (via `bindings`), and pnpm shares ONE store copy between `packages/db` (whose
// tests need the Node ABI) and this app (which needs the Electron ABI). Only one
// ABI can occupy that binary at a time. `pnpm install` provisions the Node ABI;
// this script switches it to the Electron ABI for `dev`/`smoke`, and
// `node scripts/rebuild-native.mjs node` switches it back for the db tests.
//
// It uses `prebuild-install` (already a dependency of the native module) which
// is download-only: a non-zero exit means no matching prebuilt binary was
// published — it never falls back to compiling. Electron prebuilds are published
// by the package for the pinned Electron version's ABI.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const runtime = process.argv[2] === "node" ? "node" : "electron";

const moduleDir = dirname(
  require.resolve("better-sqlite3-multiple-ciphers/package.json"),
);
const prebuildInstall = require.resolve("prebuild-install/bin.js", {
  paths: [moduleDir],
});

const target =
  runtime === "electron"
    ? require(require.resolve("electron/package.json")).version
    : process.versions.node;

const result = spawnSync(
  process.execPath,
  [
    prebuildInstall,
    "--runtime",
    runtime,
    "--target",
    target,
    "--arch",
    process.arch,
    "--platform",
    process.platform,
  ],
  { cwd: moduleDir, stdio: "inherit" },
);

if (result.status !== 0) {
  console.error(
    `\nFailed to fetch the ${runtime} prebuild for ` +
      `better-sqlite3-multiple-ciphers (target ${target}, ${process.platform}-${process.arch}).\n` +
      "prebuild-install is download-only; a non-zero exit means no matching " +
      "prebuilt binary was published for this runtime/ABI.",
  );
  process.exit(result.status ?? 1);
}

console.log(
  `better-sqlite3-multiple-ciphers ready for ${runtime} ` +
    `(target ${target}, ${process.platform}-${process.arch}).`,
);
