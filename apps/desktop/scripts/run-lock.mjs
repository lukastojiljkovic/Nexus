// A harness run owns a sandbox for as long as it lasts, and nothing enforced
// that until this file existed.
//
// WHAT IT COST. Two `shots` runs on one machine resolve the same sandbox —
// `<userData>/shots` — and each one wipes it on start. The second wipe deletes
// the first run's `keychain.json` out from under it, so the first run's next
// unlock refuses, honestly, for a reason that is not true of the app. A sweep
// whose evidence says „the app would not unlock" is worse than a sweep that did
// not run at all: it looks like a finding.
//
// The same wipe is why the failure was unreadable from the other side. On
// Windows a directory holding a file another process has open cannot be
// removed, so `rmSync(…, { recursive: true, force: true })` throws `EPERM` —
// `force` forgives a missing path, not a busy one — and it threw inside
// `app.whenReady().then(…)`, which had no `.catch`, so the rest of startup never
// ran and the window sat at 0 % CPU with nothing on screen saying why.
//
// THE LOCK. One file per run kind, created with `wx` so that two processes
// starting in the same millisecond cannot both win it. Its contents are the pid,
// and that is what makes a lock left behind by a killed run recoverable rather
// than a machine that is stuck until somebody finds the file: a lock naming a
// process that no longer exists is taken over.
//
// WHERE. `os.tmpdir()`, not the sandbox directory, because the sandbox path is
// Electron's (`app.getPath("userData")`) and reproducing that formula here would
// be a second copy of a rule nothing in this file could check. What has to be
// unique is the KIND — one `shots` at a time on this machine, from whatever
// checkout it was launched. On POSIX the temp directory is shared between users
// and the uid goes into the name; on Windows it is per-user already.
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The flags that make a run own a sandbox, and therefore take a lock. Anything
 * else is launched unlocked: it draws no sandbox and holds nothing another run
 * would wipe.
 */
export const LOCKED_KINDS = ["smoke", "shots", "demo"];

/** The uid when there is one. Windows has no `getuid`, and its temp directory is already per-user. */
export function uidOf() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

/** Where `kind`'s lock lives. Exported so the refusal message can name the file. */
export function lockPath(kind, dir = tmpdir(), uid = uidOf()) {
  return join(dir, `nexus-harness-${kind}${uid === null ? "" : `-${String(uid)}`}.lock`);
}

/**
 * The pid a lock file names, or null when it names nothing.
 *
 * Null covers three cases that are one case to a caller: the file is empty, it
 * holds something that is not a number, or it is gone. None of them is a live
 * holder, and all three mean the same thing — the lock is free to be taken.
 */
export function holder(path) {
  try {
    const digits = /^\d+\s*$/.exec(readFileSync(path, "utf8"));
    return digits === null ? null : Number(digits[0]);
  } catch {
    return null;
  }
}

/**
 * Whether `pid` is running. `EPERM` means it exists and is not ours to signal,
 * which is still a live holder; anything else means it does not exist.
 */
export function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Give up `path` — but only while it is still this process's.
 *
 * The check is the whole function. A run that was killed leaves its lock behind,
 * a later run takes it over, and then the first run's exit handler runs against
 * a lock that is now somebody else's: without this line it would delete the lock
 * of the run that is still going.
 */
export function release(path) {
  if (holder(path) !== process.pid) return;
  try {
    unlinkSync(path);
  } catch {
    // Already gone. Nothing to give back.
  }
}

/**
 * Take `kind`'s lock for this process, or report who holds it.
 *
 * `{ ok: true, path, release }` or `{ ok: false, path, heldBy }`, where
 * `heldBy` is the holder's pid or null when the file names none. Anything the
 * filesystem raises other than „it already exists" propagates: a temp directory
 * that cannot be written is a different problem, and reporting it as a busy one
 * would send the reader looking for a process that is not there.
 */
export function acquire(kind, { dir, uid, alive = running } = {}) {
  const path = lockPath(kind, dir ?? tmpdir(), uid ?? uidOf());
  // Two attempts, and only two. The first may lose to a lock left by a run that
  // was killed, and that file is removed once; losing a second `wx` is another
  // process holding it, and retrying there would be a spin.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, `${String(process.pid)}\n`);
      closeSync(fd);
      return { ok: true, path, heldBy: null, release: () => release(path) };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const heldBy = holder(path);
      if (heldBy !== null && alive(heldBy)) return { ok: false, path, heldBy };
      // Debris from a killed run, or a file naming nothing. `unlink` may itself
      // lose a race with another process doing the same, and that is fine: the
      // next `openSync` is the one that decides who holds it.
      try {
        unlinkSync(path);
      } catch {
        // Someone else cleared it first.
      }
    }
  }
  return { ok: false, path, heldBy: holder(path) };
}
