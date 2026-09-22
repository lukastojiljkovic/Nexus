// Runs the Electron app for one of the harness verbs — `--smoke`, `--shots`,
// `--demo` — building it first and holding the harness lock for as long as it
// lasts.
//
// THE BUILD IS IN HERE rather than in front of the call as an `&&`, for the
// same reason the lock exists: a run owns the sandbox it WIPES and the `out/` it
// WRITES, and every verb writes the same `out/`. A lock taken after the build
// would cover one of those and not the other, while reading in every line of
// this file as though it covered both. `run-lock.mjs` has the defect behind this
// — two `shots` runs on one machine wiping the same sandbox, the first one's key
// chain going with it, and the resulting sweep reporting an app that would not
// unlock.
//
// ELECTRON_RUN_AS_NODE, if inherited, makes Electron run as plain Node and
// leaves `app` undefined. It is scrubbed before spawning the GUI runtime.
//
// This script used to do a second job: better-sqlite3-multiple-ciphers was a
// single-ABI binary shared by `packages/db` (Node ABI, for Vitest) and this app
// (Electron ABI), so a run swapped it and swapped it back. 13.0.3 is a Node-API
// addon with one prebuild per platform and no ABI in the key, so there is
// nothing to swap and nothing to restore — which is also why a run may now go on
// while the tests do. That is runs against TESTS; two runs against each other
// are what the lock is for.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { acquire } from "./run-lock.mjs";

const require = createRequire(import.meta.url);

/** The app's own directory, so neither spawn below depends on where this was called from. */
const appDir = dirname(dirname(fileURLToPath(import.meta.url)));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

/** The verb, without its dashes, for the lock to name and the refusal to print. A bare launch is a „run". */
const asked = (process.argv[2] ?? "").replace(/^--/, "");
const kind = /^[a-z]+$/.test(asked) ? asked : "run";

// TAKEN WHATEVER WAS ASKED FOR, and before the build rather than before the
// launch: `out/` is shared by every verb, so a lock that started after the build
// would cover the sandbox and not the half of the run two processes can corrupt
// — and would read, in every line of this file, as though it covered both.
const lock = acquire(kind);
if (!lock.ok) {
  const held = lock.holder;
  process.stderr.write(
    `harness: another harness run is already going — ` +
      `${held === null ? "an unnamed run" : `\`${held.kind}\`, pid ${String(held.pid)}`}.\n` +
      `  It owns the sandbox this run would wipe on start and the build it would\n` +
      `  write over, so this one is refused rather than allowed to delete the key\n` +
      `  chain of the run in progress.\n` +
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
  lock.release();
}
process.exit(status);
