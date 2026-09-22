// Runs the Electron app for one of the harness verbs — `--smoke`, `--shots`,
// `--demo` — building it first and holding a lock for as long as it lasts.
//
// THE BUILD IS IN HERE rather than in front of the call as an `&&`, for the
// same reason the lock exists. `--smoke` and `--shots` each own a sandbox and
// each write `out/`, so „a run" is the build and the process together; a lock
// that started after the build would leave the half of the run that two
// processes can corrupt unguarded, while reading as though the whole run were
// covered. `run-lock.mjs` has the defect behind this — two `shots` runs on one
// machine wiping the same sandbox, the first one's key chain going with it, and
// the resulting sweep reporting an app that would not unlock.
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { acquire, LOCKED_KINDS } from "./run-lock.mjs";

const require = createRequire(import.meta.url);

/** The app's own directory, so neither spawn below depends on where this was called from. */
const appDir = dirname(dirname(fileURLToPath(import.meta.url)));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

/** The verb, without its dashes. Anything unrecognised is launched with no lock — it owns no sandbox. */
const kind = (process.argv[2] ?? "").replace(/^--/, "");
const lock = LOCKED_KINDS.includes(kind) ? acquire(kind) : null;
if (lock !== null && !lock.ok) {
  process.stderr.write(
    `harness: another ${kind} run is already going (pid ${String(lock.heldBy)}).\n` +
      `  It owns the sandbox this run would wipe on start, so this one is refused\n` +
      `  rather than allowed to delete the key chain of the run in progress.\n` +
      `  If that process is gone, delete ${lock.path} and try again.\n`,
  );
  process.exit(1);
}

/** The build, then the app, in that order and never in parallel. Returns the status to exit with. */
function run() {
  // `electron-vite`'s CLI is resolved through its `package.json`, which its
  // `exports` map does allow — the bin path itself is not exported, and the
  // alternative is a PATH lookup that only works because pnpm put a shim there.
  const viteManifest = require.resolve("electron-vite/package.json");
  const viteBin = join(
    dirname(viteManifest),
    require("electron-vite/package.json").bin["electron-vite"],
  );
  const build = spawnSync(process.execPath, [viteBin, "build"], {
    stdio: "inherit",
    env,
    cwd: appDir,
  });
  if (build.status !== 0) return build.status ?? 1;

  const app = spawnSync(require("electron"), [".", ...process.argv.slice(2)], {
    stdio: "inherit",
    env,
    cwd: appDir,
  });
  return app.status ?? 1;
}

// `process.exit` does not unwind, so the release cannot live in a `finally`
// around it — the lock would be given back only on the paths that fall through.
// `status` has no initial value and needs none: the only way past this block
// without an assignment is a throw out of `run()`, and that never reaches the
// exit below.
let status;
try {
  status = run();
} finally {
  lock?.release();
}
process.exit(status);
