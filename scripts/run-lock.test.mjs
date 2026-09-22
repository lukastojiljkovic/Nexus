import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquire,
  holder,
  LOCKED_KINDS,
  lockPath,
  release,
  running,
} from "../apps/desktop/scripts/run-lock.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `run-lock` is the guard that keeps two harness runs off one sandbox.
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

/** Take `kind` in the scratch directory, with liveness answered by the caller. */
const take = (kind, options = {}) => acquire(kind, { dir, uid: null, ...options });

describe("lockPath", () => {
  it("names the kind, so two kinds never share one lock", () => {
    expect(lockPath("shots", dir, null)).toBe(join(dir, "nexus-harness-shots.lock"));
    expect(lockPath("smoke", dir, null)).not.toBe(lockPath("shots", dir, null));
  });

  it("carries the uid where there is one, because a POSIX temp directory is not per-user", () => {
    expect(lockPath("shots", dir, 1000)).toBe(join(dir, "nexus-harness-shots-1000.lock"));
    expect(lockPath("shots", dir, 1001)).not.toBe(lockPath("shots", dir, 1000));
  });
});

describe("holder", () => {
  it("reads back the pid a lock names", () => {
    const path = lockPath("shots", dir, null);
    writeFileSync(path, "4242\n");
    expect(holder(path)).toBe(4242);
  });

  it("answers null for a file that names nothing — empty, prose, or gone", () => {
    const path = lockPath("shots", dir, null);
    // All three are one answer to a caller: this lock has no live holder, so it
    // is free. A truncated file is the shape a crash between `openSync` and
    // `writeSync` leaves, and treating it as a holder would deadlock the machine
    // on a file that names nobody.
    writeFileSync(path, "");
    expect(holder(path)).toBeNull();
    writeFileSync(path, "held by someone, probably\n");
    expect(holder(path)).toBeNull();
    writeFileSync(path, "12abc\n");
    expect(holder(path)).toBeNull();
    rmSync(path);
    expect(holder(path)).toBeNull();
  });
});

describe("acquire", () => {
  it("takes a free lock and writes this process's pid into it", () => {
    const lock = take("shots");
    expect(lock.ok).toBe(true);
    expect(lock.release).toBeTypeOf("function");
    expect(holder(lock.path)).toBe(process.pid);
  });

  it("refuses against a LIVE holder, and leaves its lock alone", () => {
    const first = take("shots");
    const second = take("shots", { alive: () => true });
    expect(second.ok).toBe(false);
    expect(second.heldBy).toBe(process.pid);
    // The refusal must not be a take: a loser that deleted the winner's lock on
    // its way out would let the next run in beside it.
    expect(holder(first.path)).toBe(process.pid);
  });

  it("takes over a lock whose holder is gone", () => {
    const dead = take("shots", { alive: () => true });
    expect(dead.ok).toBe(true);
    // The same file, now naming a process that no longer exists.
    const next = take("shots", { alive: () => false });
    expect(next.ok).toBe(true);
    expect(holder(next.path)).toBe(process.pid);
  });

  it("takes over a lock that names nothing at all", () => {
    writeFileSync(lockPath("shots", dir, null), "");
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
    const path = lockPath("shots", dir, null);
    writeFileSync(path, `${String(process.pid)}\n`);
    release(path);
    expect(existsSync(path)).toBe(false);
  });

  it("leaves a lock that names somebody else, which is the whole reason it checks", () => {
    // A run that was killed leaves its lock; a later run takes it over; then the
    // first run's exit handler runs. Without this, that handler would delete the
    // lock of the run that is still going — the same defect, one layer up.
    const path = lockPath("shots", dir, null);
    writeFileSync(path, "999999\n");
    release(path);
    expect(readFileSync(path, "utf8")).toBe("999999\n");
  });

  it("says nothing when the lock is already gone", () => {
    expect(() => release(lockPath("shots", dir, null))).not.toThrow();
  });
});

describe("the set of locked kinds", () => {
  it("recognises this process, which is the one thing `running` can be asked for cheaply", () => {
    expect(running(process.pid)).toBe(true);
  });

  it("covers every harness verb `package.json` can launch, so a fourth one cannot ship unlocked", () => {
    // THE PIN THAT MATTERS. `launch.mjs` locks a run by the flag it was given,
    // and a verb added to `package.json` without being added here would launch
    // with no lock at all — silently, because a run that takes no lock and a run
    // that takes one and releases it are the same run from the outside.
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "apps/desktop/package.json"), "utf8"))
      .scripts;
    const launched = Object.values(scripts)
      .map((command) => /scripts\/launch\.mjs --([a-z]+)/.exec(command)?.[1])
      .filter((kind) => kind !== undefined);
    expect(launched.length).toBeGreaterThan(0);
    expect(new Set(launched)).toEqual(new Set(LOCKED_KINDS));
  });
});
