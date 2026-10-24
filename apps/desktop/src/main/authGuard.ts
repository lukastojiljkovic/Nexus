import {
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

/**
 * The owner-only fallback for an account guard on systems with no usable OS
 * vault.
 *
 * A separate file, rather than plaintext inside `keychain.json`, is the whole
 * security boundary: the keychain's wraps and salts are public parameters and
 * may be readable; the guard contains the device secret that opens the local
 * data-key wrap. The file is created with mode 0600 before any bytes are
 * written and is replaced atomically. This protects against another local user;
 * it cannot protect against code already running as the same user, and the UI
 * states that plainly.
 */

export const OWNER_GUARD_FILE = "guard.json";

export function ownerGuardPath(dir: string): string {
  return join(dir, OWNER_GUARD_FILE);
}

function assertRegularFile(path: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("The owner-only account guard is not a regular file.");
  }
}

/** Reads the fallback guard, or null when it has not been created yet. */
export function readOwnerGuard(dir: string): string | null {
  const path = ownerGuardPath(dir);
  assertRegularFile(path);
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Writes the fallback guard atomically with owner-only permissions.
 *
 * `wx` is intentional: a pre-existing temp path is not followed or silently
 * overwritten, because either could have been planted by another local user.
 */
export function writeOwnerGuard(dir: string, value: string): void {
  const path = ownerGuardPath(dir);
  assertRegularFile(path);
  const tmp = `${path}.tmp`;
  rmSync(tmp, { force: true });
  const fd = openSync(tmp, "wx", 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, value);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  const fd2 = openSync(path, "r");
  try {
    fchmodSync(fd2, 0o600);
    if (!fstatSync(fd2).isFile()) throw new Error("The owner-only account guard is not a regular file.");
  } finally {
    closeSync(fd2);
  }
}
