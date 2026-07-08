// Builds the packaged Windows installer (NSIS x64, --publish never).
//
// Mirrors launch.mjs's ABI-restore guarantee: better-sqlite3-multiple-ciphers
// must be the Electron-ABI prebuild while electron-builder packages the app
// (npmRebuild is disabled in electron-builder.yml, so nothing else provisions
// it), but the repo must be left on the Node ABI afterwards so `pnpm test`
// (the db suite) keeps passing — even if the build itself fails. The restore
// runs in a `finally` around the whole flow, not just around the spawned
// subprocesses, so a script-level throw (e.g. a bad module path) still leaves
// the repo on the Node ABI.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const rebuild = join(scriptsDir, "rebuild-native.mjs");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function restoreNodeAbi() {
  spawnSync(process.execPath, [rebuild, "node"], { stdio: "inherit" });
}

process.on("exit", restoreNodeAbi);

run(process.execPath, [rebuild, "electron"]);

// require.resolve("electron-vite") only exposes the package's public export
// map, which does not declare the bin script as a subpath; the bin file is
// resolved relative to the package directory instead.
const electronViteBin = join(
  dirname(require.resolve("electron-vite/package.json")),
  "bin/electron-vite.js",
);
run(process.execPath, [electronViteBin, "build"]);

const electronBuilderCli = require.resolve("electron-builder/cli.js");
run(process.execPath, [electronBuilderCli, "--win", "--x64", "--publish", "never"]);

// restoreNodeAbi() runs automatically via the "exit" listener above, whether
// we reach here or `run()` called process.exit() earlier.
