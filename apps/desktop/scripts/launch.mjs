// Launches the built Electron app for a run that must load the native binary
// (e.g. --smoke), handling two environment realities:
//
//  1. The shared better-sqlite3-multiple-ciphers binary is single-ABI. This
//     switches it to the Electron ABI for the run, then restores the Node ABI
//     afterwards so `pnpm test` (the db suite) keeps passing — even if the run
//     itself fails.
//  2. ELECTRON_RUN_AS_NODE, if inherited, makes Electron run as plain Node and
//     leaves `app` undefined. It is scrubbed before spawning the GUI runtime.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rebuild = join(dirname(fileURLToPath(import.meta.url)), "rebuild-native.mjs");

function run(command, args, opts = {}) {
  return spawnSync(command, args, { stdio: "inherit", ...opts });
}

const toElectron = run(process.execPath, [rebuild, "electron"]);
if (toElectron.status !== 0) process.exit(toElectron.status ?? 1);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const app = run(require("electron"), [".", ...process.argv.slice(2)], { env });

// Always restore the Node ABI, regardless of the run's outcome.
run(process.execPath, [rebuild, "node"]);

process.exit(app.status ?? 1);
