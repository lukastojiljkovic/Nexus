import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { FIXTURE_ENTRY, fixtureScript, removeSharedToolPacks, sharedToolPack } from "./fixtures.js";
import {
  TOOL_LIMITS,
  ToolError,
  createToolSession,
  killAllToolSessions,
  liveToolSessionCount,
  stageInput,
  toolEnvironment,
  type ToolResult,
  type ToolSession,
} from "./run.js";

/**
 * The runner against a real process, because every guarantee it makes is about a
 * process it did not write. The fixture pack's entry is a hard link to this Node
 * (`fixtures.ts` explains why) and the modes of `fake-tool.mts` are the ways a
 * program misbehaves; each case below is one of the runner's caps meeting one of
 * them.
 */

const sessions: ToolSession[] = [];

afterEach(async () => {
  // The packs are shared (see `fixtures.ts`: a fresh executable path costs about
  // a second of antivirus work), so a case closes its SESSIONS and not the
  // folders; `afterAll` removes the folders once.
  for (const session of sessions.splice(0)) await session.close();
  killAllToolSessions();
});

afterAll(() => {
  removeSharedToolPacks();
});

/**
 * A session over the fixture pack the whole file shares.
 *
 * One pack, not one per case: the entry is a 92 MB executable and the OS scans a
 * fresh path the first time it is run (`fixtures.ts` measured 904 ms against
 * 55 ms for a path already known), so a pack per case would put this file over
 * its ten-second budget on a machine slower than this one. The manifest's fixed
 * argument `--fixed` is what the argv case asserts on, and every case supplies
 * its mode as the one argument a caller may append.
 */
async function sessionFor(
  options: { readonly outputBytes?: number; readonly timeoutMs?: number } = {},
): Promise<{ readonly session: ToolSession }> {
  const fixture = sharedToolPack({
    tool: { protocol: "stdio", args: [fixtureScript("fake-tool.mts"), "--fixed"] },
  });
  const session = await createToolSession({
    dir: fixture.dir,
    manifest: fixture.manifest,
    tempRoot: fixture.root,
    limits: {
      timeoutMs: options.timeoutMs ?? TOOL_LIMITS.timeoutMs,
      outputBytes: options.outputBytes ?? TOOL_LIMITS.outputBytes,
      inputBytes: TOOL_LIMITS.inputBytes,
    },
  });
  sessions.push(session);
  return { session };
}

/** The one-line key of what a run printed, so a case can assert on a value rather than on a blob. */
function field(result: ToolResult, name: string): string {
  const line = result.stdout.toString("utf8").split("\n").find((entry) => entry.startsWith(`${name}: `));
  return line?.slice(name.length + 2).trim() ?? "";
}

describe("the tool environment", () => {
  it("builds a Windows environment from nothing, with PATH at the entry's own folder", () => {
    expect(
      toolEnvironment({ platform: "win32", workDir: "C:\\tmp\\w", entryDir: "C:\\packs\\t\\1.0.0", systemRoot: "C:\\Windows" }),
    ).toEqual({
      PATH: "C:\\packs\\t\\1.0.0",
      TEMP: "C:\\tmp\\w",
      TMP: "C:\\tmp\\w",
      SystemRoot: "C:\\Windows",
      windir: "C:\\Windows",
    });
  });

  it("omits the system variables a machine could not state, rather than guessing a path", () => {
    const environment = toolEnvironment({ platform: "win32", workDir: "w", entryDir: "e", systemRoot: null });
    expect(Object.keys(environment).sort()).toEqual(["PATH", "TEMP", "TMP"]);
  });

  it("gives a POSIX program a home inside the session and C.UTF-8, and no inherited variable", () => {
    expect(
      toolEnvironment({ platform: "linux", workDir: "/tmp/w", entryDir: "/packs/t", systemRoot: null }),
    ).toEqual({ PATH: "/packs/t", HOME: "/tmp/w", TMPDIR: "/tmp/w", LANG: "C.UTF-8" });
  });
});

describe("a tool session", () => {
  it("runs the entry in an empty directory under %TEMP%, with a minimal environment", async () => {
    const { session } = await sessionFor();
    // A secret in THIS process's environment is the thing the child must not see.
    // It is set rather than assumed so the case fails if inheritance ever returns.
    process.env["NEXUS_TOOL_TEST_SECRET"] = "must-not-travel";
    try {
      const result = await session.run({ args: ["ok"], stdin: "" });
      expect(result.code).toBe(0);
      expect(result.stopped).toBeNull();
      expect(field(result, "cwd")).toBe(session.workDir);
      expect(field(result, "secret")).toBe("absent");
      // The manifest's fixed argument arrives first, the caller's second: argv is
      // a list of values and its ORDER is the manifest's decision.
      expect(field(result, "argv")).toBe("--fixed ok");
      // And it is the short list, not the machine's: nothing outside the names
      // `toolEnvironment` writes is there, apart from the fixed handful Node
      // itself adds to every child on Windows (and which cannot carry a secret:
      // `NEXUS_TOOL_TEST_SECRET` is in this process's environment and is not in
      // the child's).
      const allowed = new Set([
        "PATH",
        "TEMP",
        "TMP",
        "SystemRoot",
        "windir",
        "HOME",
        "TMPDIR",
        "LANG",
        // Node's own additions on Windows, named in `toolEnvironment`'s comment.
        "HOMEDRIVE",
        "HOMEPATH",
        "LOGONSERVER",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "USERDOMAIN",
        "USERNAME",
        "USERPROFILE",
        "WINDIR",
      ]);
      const seen = field(result, "env").split(",").filter((name) => name !== "");
      expect(seen.every((name) => allowed.has(name))).toBe(true);
      expect(seen).not.toContain("NEXUS_TOOL_TEST_SECRET");
    } finally {
      delete process.env["NEXUS_TOOL_TEST_SECRET"];
    }
    // Measured: 504 ms warm, and this file is 4.6 s to 5.8 s on this machine —
    // the first spawn of a fresh executable, and the antivirus scan behind it, is
    // where that goes. The budget is the margin CI needs on a slower runner.
  }, 30_000);

  it("refuses a manifest that is not a tool pack", async () => {
    const fixture = sharedToolPack({ kind: "zim" });
    await expect(
      createToolSession({ dir: fixture.dir, manifest: fixture.manifest, tempRoot: fixture.root }),
    ).rejects.toMatchObject({ code: "no-tool" });
  });

  it("refuses an entry whose bytes are not the bytes the manifest states", async () => {
    const fixture = sharedToolPack({ tool: { protocol: "stdio" }, entryBytes: "not this node" });
    const session = await createToolSession({ dir: fixture.dir, manifest: fixture.manifest, tempRoot: fixture.root });
    sessions.push(session);
    await expect(session.start({ args: ["ok"] })).rejects.toMatchObject({
      code: "hash-mismatch",
    });
  });

  it("refuses an entry the folder does not hold", async () => {
    // `fresh`: this case DELETES the entry, so it must not be handed the folder
    // the cases above are still using.
    const fixture = sharedToolPack({ tool: { protocol: "stdio" }, fresh: true });
    rmSync(join(fixture.dir, FIXTURE_ENTRY), { force: true });
    const session = await createToolSession({ dir: fixture.dir, manifest: fixture.manifest, tempRoot: fixture.root });
    sessions.push(session);
    await expect(session.start()).rejects.toMatchObject({ code: "missing-entry" });
  });

  it("kills a program that runs past the time limit and says why", async () => {
    const { session } = await sessionFor({ timeoutMs: 250 });
    const started = Date.now();
    const result = await session.run({ args: ["hang"], stdin: "" });
    expect(result.stopped).toBe("timeout");
    // It was killed rather than waited for: the measured wall clock is the
    // assertion that the deadline is what ended it, not a later event.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.stdout.toString("utf8")).toContain("ready");
  });

  it("kills a program that outruns the output cap", async () => {
    const cap = 4 * 1024;
    const { session } = await sessionFor({ outputBytes: cap });
    const result = await session.run({ args: ["spam"], stdin: "" });
    expect(result.stopped).toBe("output-limit");
    // The cap is not a promise about what was already in flight when it was
    // breached, so the bound is the cap plus the largest chunk a pipe can hand
    // over at once.
    expect(result.stdout.byteLength).toBeLessThanOrEqual(cap + 64 * 1024);
  });

  it("kills a program on cancel", async () => {
    const { session } = await sessionFor({ timeoutMs: 30_000 });
    const controller = new AbortController();
    const running = session.run({ args: ["hang"], stdin: "", signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    const result = await running;
    expect(result.stopped).toBe("cancelled");
  });

  it("kills a program that ignores SIGTERM, rather than waiting for it", async () => {
    const { session } = await sessionFor({ timeoutMs: 250 });
    const result = await session.run({ args: ["stubborn"], stdin: "" });
    expect(result.stopped).toBe("timeout");
  });

  it("reports a program that failed, with its exit code and its stderr", async () => {
    const { session } = await sessionFor();
    const result = await session.run({ args: ["fail"], stdin: "" });
    expect(result.code).toBe(3);
    expect(result.stopped).toBeNull();
    expect(result.stderr.toString("utf8")).toContain("failed on purpose");
  });

  it("gives the program a working directory it can write in, and removes it at close", async () => {
    const { session } = await sessionFor();
    const result = await session.run({ args: ["touch"], stdin: "" });
    expect(result.code).toBe(0);
    const workDir = session.workDir;
    expect(readFileSync(join(workDir, "touched.txt"), "utf8")).toContain("working directory");
    await session.close();
    expect(existsSync(join(workDir, "touched.txt"))).toBe(false);
    expect(liveToolSessionCount()).toBe(0);
  });

  it("kills every live session on request, which is what an app quit does", async () => {
    const { session } = await sessionFor({ timeoutMs: 30_000 });
    const started = Date.now();
    const proc = await session.start({ args: ["hang"], stdin: "" });
    // Waited for by its own output rather than by a sleep: the entry is a hard
    // link to Node, and hashing it before the first spawn takes longer than a
    // fixed pause would assume, which is how a kill can arrive before there is
    // anything to kill.
    const deadline = Date.now() + 10_000;
    while (!proc.stdout.toString("utf8").includes("ready") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(proc.stdout.toString("utf8")).toContain("ready");
    expect(liveToolSessionCount()).toBeGreaterThan(0);
    killAllToolSessions();
    const exit = await proc.exited;
    expect(exit.stopped).toBeNull();
    // The process's own deadline was thirty seconds away; that this resolved at
    // all, promptly, is the kill having worked rather than the timer.
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe("staging a hostile input", () => {
  it("copies the file under a name of this module's choosing", async () => {
    const { session } = await sessionFor();
    const source = join(mkdtempSync(join(tmpdir(), "nexus-input-")), "the user's drawing.dwg");
    writeFileSync(source, "drawing bytes");
    try {
      const staged = await stageInput(session, source, { suffix: ".dwg" });
      expect(basename(staged)).not.toBe("the user's drawing.dwg");
      expect(basename(staged).endsWith(".dwg")).toBe(true);
      expect(readFileSync(staged, "utf8")).toBe("drawing bytes");
    } finally {
      rmSync(dirname(source), { recursive: true, force: true });
    }
  });

  it("refuses a file larger than the cap before copying a byte of it", async () => {
    const { session } = await sessionFor();
    const source = join(mkdtempSync(join(tmpdir(), "nexus-input-")), "big.dwg");
    writeFileSync(source, "0123456789");
    try {
      await expect(stageInput(session, source, { suffix: ".dwg", maxBytes: 4 })).rejects.toBeInstanceOf(ToolError);
      await expect(stageInput(session, source, { suffix: ".dwg", maxBytes: 4 })).rejects.toMatchObject({
        code: "input-too-large",
      });
    } finally {
      rmSync(dirname(source), { recursive: true, force: true });
    }
  });
});
