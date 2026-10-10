import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyPortableMode,
  decidePortable,
  ensurePortableRoot,
  PORTABLE_DATA_DIR,
  PORTABLE_MARKER_FILE,
  portablePaths,
  type PortableDecision,
  type PortablePathName,
  probePortableMarker,
} from "./portable.js";

/**
 * ADR-102's path decision, and its two filesystem edges.
 *
 * Every case the acceptance names is here: the marker present, absent, an
 * unreadable directory, a drive root, and a path with spaces and non-ASCII
 * letters. The expected values are the ones `node:path` computes for THIS
 * platform — the repo's suites run on Windows and on Linux, and a path module
 * that spelled a separator differently on one of them would be a real finding
 * rather than a test that needs a second copy.
 */

let exeDir: string;

beforeEach(() => {
  exeDir = mkdtempSync(join(tmpdir(), "nexus-portable-"));
});

afterEach(() => {
  rmSync(exeDir, { recursive: true, force: true });
});

/** Write the marker the way the packaging script does: a real file, beside the executable. */
function writeMarker(directory: string, text = "portable\n"): void {
  writeFileSync(join(directory, PORTABLE_MARKER_FILE), text, "utf8");
}

describe("decidePortable", () => {
  it("keeps a launch portable when the marker is beside the executable", () => {
    const decision = decidePortable(exeDir, { kind: "present" });
    expect(decision.portable).toBe(true);
    if (!decision.portable) return;

    // The root is ONE folder beside the executable, named NexusData, and every
    // redirected path is inside it — the whole promise of the marker.
    expect(decision.root).toBe(join(exeDir, PORTABLE_DATA_DIR));
    expect(basename(decision.root)).toBe("NexusData");
    expect(dirname(decision.root)).toBe(exeDir);
    expect(decision.paths).toEqual(portablePaths(exeDir));
    // `userData` IS the root rather than a folder inside it, so a stick shows
    // accounts/, session/, logs/ and temp/ as siblings.
    expect(decision.paths.userData).toBe(decision.root);
    // The other three are direct children, named one word each.
    expect(dirname(decision.paths.sessionData)).toBe(decision.root);
    expect(basename(decision.paths.sessionData)).toBe("session");
    expect(decision.paths.logs).toBe(join(decision.root, "logs"));
    expect(decision.paths.temp).toBe(join(decision.root, "temp"));
  });

  it("changes nothing when the marker is absent", () => {
    const decision = decidePortable(exeDir, { kind: "absent" });
    expect(decision.portable).toBe(false);
    expect(decision).toEqual({ portable: false, reason: "absent", detail: null });
  });

  it("refuses to guess when the directory will not answer", () => {
    const decision = decidePortable(exeDir, {
      kind: "unreadable",
      detail: "EACCES: permission denied",
    });
    expect(decision.portable).toBe(false);
    expect(decision).toEqual({
      portable: false,
      reason: "unreadable",
      detail: "EACCES: permission denied",
    });
  });

  it("works from a drive root, where the executable has no parent of its own", () => {
    // `D:\` rather than a folder on it: the shortest directory Windows can
    // name. The root still has to be a folder UNDER the drive rather than the
    // drive itself, and the drive still has to come back whole.
    const decision = decidePortable("D:\\", { kind: "present" });
    expect(decision.portable).toBe(true);
    if (!decision.portable) return;
    expect(decision.root).toBe(join("D:\\", PORTABLE_DATA_DIR));
    expect(decision.root).not.toBe("D:\\");
    expect(dirname(decision.root)).toBe("D:\\");
  });

  it("keeps spaces and non-ASCII letters exactly", () => {
    // The two things a stick's own label or folder name brings with it, and
    // neither is escaped, normalised or shortened on the way through.
    const label = join(exeDir, "Nexus Štikla — Dragana");
    const decision = decidePortable(label, { kind: "present" });
    expect(decision.portable).toBe(true);
    if (!decision.portable) return;
    expect(decision.root).toBe(join(label, PORTABLE_DATA_DIR));
    // The diacritic, the em dash and the space all arrive unchanged.
    expect(decision.root).toContain("Nexus Štikla — Dragana");
    expect(decision.paths.logs).toBe(join(label, PORTABLE_DATA_DIR, "logs"));
  });
});

describe("probePortableMarker", () => {
  it("finds the marker beside the executable", () => {
    writeMarker(exeDir);
    expect(probePortableMarker(exeDir)).toEqual({ kind: "present" });
  });

  it("answers absent for a directory that holds nothing", () => {
    expect(probePortableMarker(exeDir)).toEqual({ kind: "absent" });
  });

  it("answers absent when the path cannot hold a file at all", () => {
    // A regular file where the executable's directory should be: `statSync`
    // throws ENOTDIR, which is "there is nothing there", not "refused".
    const file = join(exeDir, "not-a-directory");
    writeFileSync(file, "");
    expect(probePortableMarker(file)).toEqual({ kind: "absent" });
  });

  it("answers unreadable for a portable.txt that is a directory", () => {
    // A directory cannot be read as a marker and its presence cannot be
    // ignored, so this is neither `present` nor `absent`.
    mkdirSync(join(exeDir, PORTABLE_MARKER_FILE));
    const probe = probePortableMarker(exeDir);
    expect(probe.kind).toBe("unreadable");
    if (probe.kind !== "unreadable") return;
    expect(probe.detail).toContain(PORTABLE_MARKER_FILE);
  });

  it("finds a marker whose bytes nobody may read", () => {
    // Presence, not content: the file is there and stays a marker even when
    // the launch that reads it is not the one that can open it.
    writeMarker(exeDir, "");
    expect(probePortableMarker(exeDir)).toEqual({ kind: "present" });
  });
});

describe("ensurePortableRoot", () => {
  it("creates all four folders, including the parents, and leaves nothing behind", () => {
    // The four `app.setPath` throws on a directory that does not exist, so this
    // is a requirement of the call rather than tidiness.
    const paths = portablePaths(join(exeDir, "stick"));
    expect(ensurePortableRoot(paths)).toEqual({ ok: true });
    // Empty is what a launch should find: the write probe is gone, and nothing
    // else was put there.
    expect(readdirSync(paths.userData).sort()).toEqual(["logs", "session", "temp"]);
    expect(readdirSync(paths.sessionData)).toEqual([]);
    expect(existsSync(paths.logs)).toBe(true);
    expect(existsSync(paths.temp)).toBe(true);
  });

  it("refuses a NexusData that is a file", () => {
    const paths = portablePaths(exeDir);
    writeFileSync(paths.userData, "");
    const result = ensurePortableRoot(paths);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/EEXIST|ENOTDIR|ENOENT/);
  });

  it("refuses a folder whose parent is a file", () => {
    const blocker = join(exeDir, "blocker");
    writeFileSync(blocker, "");
    const result = ensurePortableRoot(portablePaths(blocker));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail.length).toBeGreaterThan(0);
  });

  it("refuses when one of the three folders is a file the user left there", () => {
    // A conflict a stick can genuinely have: something called `session` sitting
    // where the redirect needs a directory.
    const paths = portablePaths(exeDir);
    mkdirSync(paths.userData, { recursive: true });
    writeFileSync(paths.sessionData, "");
    const result = ensurePortableRoot(paths);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/EEXIST|ENOTDIR|ENOENT/);
  });
});

describe("applyPortableMode", () => {
  it("points all four paths at the stick when the marker is there", () => {
    writeMarker(exeDir);
    const set: Array<[PortablePathName, string]> = [];
    const decision = applyPortableMode({
      exeDir,
      setPath: (name, directory) => set.push([name, directory]),
    });

    expect(decision.portable).toBe(true);
    const paths = portablePaths(exeDir);
    expect(set).toEqual([
      ["userData", paths.userData],
      ["sessionData", paths.sessionData],
      ["logs", paths.logs],
      ["temp", paths.temp],
    ]);
    // Chromium's profile is not the app's data root, so the cache a launch
    // accumulates can be deleted without touching an account.
    expect(paths.sessionData).not.toBe(paths.userData);
  });

  it("sets no path at all for an installed build", () => {
    // The acceptance's "without the marker, nothing changes", as a measurement:
    // one call to `setPath` in this case would be a path redirected on every
    // machine that has ever installed Nexus.
    const set: Array<[PortablePathName, string]> = [];
    const decision = applyPortableMode({
      exeDir,
      setPath: (name, directory) => set.push([name, directory]),
    });
    expect(decision).toEqual({ portable: false, reason: "absent", detail: null });
    expect(set).toEqual([]);
  });

  it("reports a read-only stick and redirects nothing", () => {
    writeMarker(exeDir);
    // The stand-in for a read-only stick: the folder the marker points at is a
    // FILE, so no write can succeed there. What the case has to produce is the
    // reason and the OS's words — not a thrown error.
    writeFileSync(join(exeDir, PORTABLE_DATA_DIR), "");
    const set: Array<[PortablePathName, string]> = [];
    const decision: PortableDecision = applyPortableMode({
      exeDir,
      setPath: (name, directory) => set.push([name, directory]),
    });

    expect(decision.portable).toBe(false);
    if (decision.portable) return;
    expect(decision.reason).toBe("unwritable");
    expect(decision.detail).not.toBeNull();
    expect(decision.detail).toMatch(/EEXIST|ENOTDIR|ENOENT/);
    expect(set).toEqual([]);
  });
});
