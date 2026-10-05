import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquire,
  HARNESS_KINDS,
  holder,
  lockPath,
  release,
  running,
} from "../apps/desktop/scripts/run-lock.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCH = join(REPO_ROOT, "apps", "desktop", "scripts", "launch.mjs");

/**
 * `run-lock` is the guard that keeps two harness runs off one machine.
 *
 * The class it closes is a SHARED RESOURCE with no owner: `--smoke` and
 * `--shots` each resolve the same `app.getPath("userData")/<kind>` and each wipe
 * it on start, so the second run deletes the first one's `keychain.json` and the
 * first one's next unlock refuses — for a reason that is not true of the app,
 * which is the worst thing a sweep's evidence can be. On Windows the wipe
 * against a directory another process holds open throws `EPERM` instead, and
 * that throw landed in a callback with no `.catch`, stranding startup behind a
 * window at 0 % CPU. Two runs, two failure modes, one cause.
 *
 * Nothing else in the tree can see either one: a lock that is never taken looks
 * exactly like a lock that is taken and released, and both runs exit zero.
 */

/** A scratch directory per test, so no case can be affected by another's locks. */
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-run-lock-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The lock file this suite writes.
 *
 * `lockPath` alone cannot show why the path is a private one - its own default
 * parameter is `os.tmpdir()`, which is what put every write here in
 * js/insecure-temporary-file (#20-#24) - and the harness itself creates the
 * file with an explicit owner-only mode (#19). The write below says the same
 * thing, so what the tests write is what the lock is.
 */
const writeLock = (path, contents) => writeFileSync(path, contents, { mode: 0o600 });

/** Take the lock in the scratch directory, with liveness answered by the caller. */
const take = (kind, options = {}) => acquire(kind, { dir, uid: null, ...options });

describe("lockPath", () => {
  it("is ONE lock for the whole harness — the kind is not part of the name", () => {
    // The property that matters, and the one a well-meaning „give each verb its
    // own lock" would break: every verb builds into the same `out/`, so two
    // verbs running together corrupt a resource neither owns alone.
    expect(lockPath(dir, null)).toBe(join(dir, "nexus-harness.lock"));
  });

  it("carries the uid where there is one, because a POSIX temp directory is not per-user", () => {
    expect(lockPath(dir, 1000)).toBe(join(dir, "nexus-harness-1000.lock"));
    expect(lockPath(dir, 1001)).not.toBe(lockPath(dir, 1000));
  });
});

describe("holder", () => {
  it("reads back the pid and the kind a lock names", () => {
    const path = lockPath(dir, null);
    writeLock(path, "4242 shots\n");
    expect(holder(path)).toEqual({ pid: 4242, kind: "shots" });
  });

  it("answers null for a file that names nobody — empty, prose, an older format, or gone", () => {
    const path = lockPath(dir, null);
    // All four are one answer to a caller: this lock has no live holder, so it
    // is free. A truncated file is the shape a crash between `openSync` and
    // `writeSync` leaves, and treating it as a holder would deadlock the machine
    // on a file that names nobody.
    for (const debris of ["", "held by someone, probably\n", "4242\n", "4242 ORCHESTRA\n"]) {
      writeLock(path, debris);
      expect(holder(path), JSON.stringify(debris)).toBeNull();
    }
    rmSync(path);
    expect(holder(path)).toBeNull();
  });
});

describe("acquire", () => {
  it("takes a free lock and writes this process's pid and the kind into it", () => {
    const lock = take("shots");
    expect(lock.ok).toBe(true);
    expect(lock.release).toBeTypeOf("function");
    expect(holder(lock.path)).toEqual({ pid: process.pid, kind: "shots" });
  });

  it("refuses against a LIVE holder, and leaves its lock alone", () => {
    const first = take("shots");
    const second = take("smoke", { alive: () => true });
    expect(second.ok).toBe(false);
    expect(second.holder).toEqual({ pid: process.pid, kind: "shots" });
    // The refusal must not be a take: a loser that deleted the winner's lock on
    // its way out would let the next run in beside it. And the kind is the
    // WINNER's, so the message names what is actually in the way.
    expect(holder(first.path)).toEqual({ pid: process.pid, kind: "shots" });
  });

  it("takes over a lock whose holder is gone", () => {
    expect(take("shots", { alive: () => true }).ok).toBe(true);
    // The same file, now naming a process that no longer exists.
    const next = take("smoke", { alive: () => false });
    expect(next.ok).toBe(true);
    expect(holder(next.path)).toEqual({ pid: process.pid, kind: "smoke" });
  });

  it("takes over a lock that names nobody at all", () => {
    writeLock(lockPath(dir, null), "");
    expect(take("shots").ok).toBe(true);
  });

  it("propagates a filesystem failure that is not „already exists\"", () => {
    // A lock that cannot be created because the directory is gone is a different
    // problem from a busy lock, and reporting it as a busy one would send the
    // reader looking for a process that is not there.
    expect(() => acquire("shots", { dir: join(dir, "no-such-dir"), uid: null })).toThrow();
  });

  it("gives back the real thing — a second take after a release succeeds", () => {
    const first = take("shots");
    first.release();
    expect(existsSync(first.path)).toBe(false);
    expect(take("shots", { alive: () => true }).ok).toBe(true);
  });
});

describe("release", () => {
  it("removes a lock this process owns", () => {
    const path = lockPath(dir, null);
    writeLock(path, `${String(process.pid)} shots\n`);
    release(path);
    expect(existsSync(path)).toBe(false);
  });

  it("leaves a lock that names somebody else, which is the whole reason it checks", () => {
    // A run that was killed leaves its lock; a later run takes it over; then the
    // first run's exit handler runs. Without this, that handler would delete the
    // lock of the run that is still going — the same defect, one layer up.
    const path = lockPath(dir, null);
    writeLock(path, "999999 shots\n");
    release(path);
    expect(readFileSync(path, "utf8")).toBe("999999 shots\n");
  });

  it("says nothing when the lock is already gone", () => {
    expect(() => release(lockPath(dir, null))).not.toThrow();
  });
});

describe("the launcher that uses it", () => {
  const source = readFileSync(LAUNCH, "utf8");

  it("takes the lock before it builds, which is the only place that order is visible", () => {
    // Two properties, both load-bearing and both invisible from the outside: the
    // lock must be held during the BUILD (or `out/` is unguarded while the code
    // reads as though it were guarded), and it must be released on the way out
    // of every path — including the throw, which is why the release is in a
    // `finally` and the `process.exit` is outside it.
    const acquired = source.indexOf("acquire(kind)");
    const built = source.indexOf('"build"]');
    expect(acquired, "launch.mjs no longer acquires a lock").toBeGreaterThan(-1);
    expect(built, "launch.mjs no longer builds — re-derive this test").toBeGreaterThan(-1);
    expect(acquired).toBeLessThan(built);
    expect(source.indexOf("lock.release()")).toBeGreaterThan(-1);
  });

  it("knows every verb `package.json` launches, so a fourth one cannot ship unnamed", () => {
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "apps/desktop/package.json"), "utf8"))
      .scripts;
    const launched = Object.values(scripts)
      .map((command) => /scripts\/launch\.mjs --([a-z]+)/.exec(command)?.[1])
      .filter((kind) => kind !== undefined);
    expect(launched.length).toBeGreaterThan(0);
    expect(new Set(launched)).toEqual(new Set(HARNESS_KINDS));
  });
});

describe("running", () => {
  it("recognises this process, which is the one pid it can be asked for cheaply", () => {
    expect(running(process.pid)).toBe(true);
  });
});
