// Ensures Electron's platform binary is present after install.
//
// pnpm's dependency build-script gate does not reliably trigger electron's own
// postinstall in this workspace (even with `allowBuilds: electron`), which would
// leave `electron .` with no binary to run. This provisions it explicitly by
// invoking electron's own install.js — the exact work its postinstall does. It
// is idempotent: a no-op once electron has written its `path.txt` marker.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

let electronDir;
try {
  electronDir = dirname(require.resolve("electron/package.json"));
} catch {
  // electron not installed (e.g. a --prod install); nothing to provision.
  process.exit(0);
}

if (existsSync(join(electronDir, "path.txt"))) process.exit(0);

const result = spawnSync(process.execPath, [join(electronDir, "install.js")], {
  cwd: electronDir,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
