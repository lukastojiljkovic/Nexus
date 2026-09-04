// Launches the built Electron app for a run that must load the native binary
// (e.g. --smoke).
//
// ELECTRON_RUN_AS_NODE, if inherited, makes Electron run as plain Node and
// leaves `app` undefined. It is scrubbed before spawning the GUI runtime.
//
// This script used to do a second job: better-sqlite3-multiple-ciphers was a
// single-ABI binary shared by `packages/db` (Node ABI, for Vitest) and this app
// (Electron ABI), so a run swapped it and swapped it back. 13.0.3 is a Node-API
// addon with one prebuild per platform and no ABI in the key, so there is
// nothing to swap and nothing to restore — which is also why `smoke` and
// `shots` may now run while the tests do.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const app = spawnSync(require("electron"), [".", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

process.exit(app.status ?? 1);
