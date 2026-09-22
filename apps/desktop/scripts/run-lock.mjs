// A harness run owns the sandbox it wipes and the `out/` it builds, for as long
// as it lasts, and nothing enforced that until this file existed.
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
// **ONE LOCK FOR THE WHOLE HARNESS, not one per verb**, and the reason is
// `out/`: `--smoke`, `--shots` and `--demo` build into the same directory and
// then run the same binary out of it. Per-verb locks would let a `smoke` and a
// `shots` run start together and corrupt the half of the run neither of them
// owns alone — while reading, in every line of the code, as though the resource
// were covered. The kind travels INSIDE the lock, so the refusal can still name
// what is in the way.
//
// The lock is a file created with `wx`, so two processes starting in the same
// millisecond cannot both win it. Its contents are the pid, and that is what
// makes a lock left behind by a killed run recoverable rather than a machine
// stuck until somebody finds the file: a lock naming a process that no longer
// exists is taken over.
//
// WHERE. `os.tmpdir()`, not the sandbox directory, because the sandbox path is
// Electron's (`app.getPath("userData")`) and reproducing that formula here would
// be a second copy of a rule nothing in this file could check. On POSIX the temp
// directory is shared between users and the uid goes into the name; on Windows
// it is per-user already.
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The verbs this launcher knows by name. Not a list of what gets locked — the
 * lock is taken whatever was asked for, `--demo` and a bare launch included,
 * because every one of them builds. It is the vocabulary the refusal message
 * prints, and `scripts/run-lock.test.mjs` pins it against the verbs
 * `package.json` actually passes.
 */
export const HARNESS_KINDS = ["smoke", "shots", "demo"];

/** The uid when there is one. Windows has no `getuid`, and its temp directory is already per-user. */
export function uidOf() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

/** Where the lock lives. Exported so the refusal message can name the file. */
export function lockPath(dir = tmpdir(), uid = uidOf()) {
  return join(dir, `nexus-harness${uid === null ? "" : `-${String(uid)}`}.lock`);
}

/**
 * Who holds it: `{ pid, kind }`, or null when the file names nobody.
 *
 * Null covers four cases that are one case to a caller — the file is empty, it
 * holds something that is not a pid, it holds a pid in an older format, or it is
 * gone. None of them is a live holder, and all of them mean the same thing: the
 * lock is free to be taken.
 */
export function holder(path) {
  try {
    const found = /^(\d+) ([a-z]+)\n?$/.exec(readFileSync(path, "utf8"));
    return found === null ? null : { pid: Number(found[1]), kind: found[2] };
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
  if (holder(path)?.pid !== process.pid) return;
  try {
    unlinkSync(path);
  } catch {
    // Already gone. Nothing to give back.
  }
}

/**
 * Take the harness lock for this process, or report who holds it.
 *
 * `{ ok: true, path, release }` or `{ ok: false, path, holder }`, where the
 * holder is `{ pid, kind }` or null when the file names nobody. Anything the
 * filesystem raises other than „it already exists" propagates: a temp directory
 * that cannot be written is a different problem, and reporting it as a busy one
 * would send the reader looking for a process that is not there.
 */
export function acquire(kind, { dir, uid, alive = running } = {}) {
  const path = lockPath(dir ?? tmpdir(), uid ?? uidOf());
  // Two attempts, and only two. The first may lose to a lock left by a run that
  // was killed, and that file is removed once; losing a second `wx` is another
  // process holding it, and retrying there would be a spin.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, `${String(process.pid)} ${kind}\n`);
      closeSync(fd);
      return { ok: true, path, holder: null, release: () => release(path) };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const current = holder(path);
      if (current !== null && alive(current.pid)) return { ok: false, path, holder: current };
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
  return { ok: false, path, holder: holder(path) };
}
