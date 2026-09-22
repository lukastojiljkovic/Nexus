import { appendLog, EMPTY_LOG, logText, RUNNER_IMAGE, type RunnerTarget } from "@nexus/core";
import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRunner, type RunnerDeps, type RunnerEvents } from "./elecRunner.js";
import { RUNNER_DIR } from "./elecWorkspace.js";

/**
 * What these tests are FOR, in one sentence: the run's lifecycle — what is
 * spawned, what is captured from it, what a stop achieves, and what happens
 * when the app quits — is exercised end to end without a toolchain.
 *
 * That seam is the point of `deps.spawn`. This machine has no `colcon`, no WSL
 * and no Docker, so every claim about the three profiles would otherwise be
 * untested prose; the parts that ARE testable here are the parts a mistake
 * would be silent in — the argv, the one-at-a-time latch, the environment
 * scrub, the cap, and the stop ladder.
 */

/** A child process that does nothing until a test tells it to, and remembers everything it was told. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly pid = 4242;
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }

  /** Output, then the exit — the order a real tool produces them in. */
  finish(code: number | null, out = "", err = ""): void {
    if (out !== "") this.stdout.emit("data", Buffer.from(out, "utf8"));
    if (err !== "") this.stderr.emit("data", Buffer.from(err, "utf8"));
    this.emit("close", code);
  }

  bytes(chunk: Buffer): void {
    this.stdout.emit("data", chunk);
  }

  /** The process could not be started at all — no such program. */
  fail(message: string): void {
    this.emit("error", new Error(message));
    this.emit("close", null);
  }
}

/** What a spawned program answers with. `null` means „never" — the test drives that child by hand. */
type Answer = { code: number | null; out?: string };

interface Spawned {
  program: string;
  argv: readonly string[];
  options: { cwd?: string; shell?: boolean; env?: NodeJS.ProcessEnv };
  child: FakeChild;
}

let spawned: Spawned[];
let policy: (program: string, argv: readonly string[]) => Answer | null;
let refuseSpawn: boolean;
let events: { output: string[]; states: string[] };

const deps: RunnerDeps = {
  spawn: ((program: string, argv: readonly string[], options: Spawned["options"]) => {
    if (refuseSpawn) throw new Error("spawn refused");
    const child = new FakeChild();
    spawned.push({ program, argv: [...argv], options, child });
    const answer = policy(program, argv);
    // Answered off the current tick, because a real child never exits before
    // the call that started it has returned — and a test that could observe
    // otherwise would be testing the mock.
    if (answer !== null) {
      const { code, out = "" } = answer;
      setTimeout(() => {
        child.finish(code, out);
      }, 0);
    }
    return child as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn,
  now: () => Date.parse("2026-09-22T10:00:00.000Z"),
  stopTimeoutMs: 20,
  probeTimeoutMs: 30,
  containerTimeoutMs: 30,
};

const collector: RunnerEvents = {
  output: (text) => events.output.push(text),
  changed: (state) => events.states.push(state.phase),
};

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let accountDir: string;
let workspace: string;
beforeEach(() => {
  spawned = [];
  events = { output: [], states: [] };
  policy = () => null;
  refuseSpawn = false;
  accountDir = mkdtempSync(join(tmpdir(), "nexus-runner-"));
  workspace = join(accountDir, RUNNER_DIR, "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
  mkdirSync(workspace, { recursive: true });
});
afterEach(() => {
  rmSync(accountDir, { recursive: true, force: true });
});

const NATIVE = { profile: "native" } as const;
const DOCKER = { profile: "docker" } as const;

/**
 * The first spawned child, ignoring the kill — the shape a Docker CLI has on
 * Windows, where `kill()` terminates `docker.exe` and the container goes on.
 */
function unmovedByKill(): void {
  const child = spawned[0]?.child;
  if (child !== undefined) child.kill = (): boolean => true;
}

type Runner = ReturnType<typeof createRunner>;
const request = (target: RunnerTarget = NATIVE): Parameters<Runner["start"]>[0] => ({
  profileId: "p1",
  target,
  accountDir,
  workspace,
  packageName: PACKAGE,
});

/** What the generator would have named the package — the name written under `src/`, and what the build is expected to install. */
const PACKAGE = "wiring_node";

/** The directory a successful `colcon build` creates, inside the workspace. */
const installed = (): string => join(workspace, "install", PACKAGE);

describe("the command a run gets", () => {
  it("comes from the closed table, is spawned without a shell, and runs in the workspace", () => {
    const runner = createRunner(deps, collector);
    expect(runner.start(request()).started).toBe(true);

    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.program).toBe("colcon");
    expect(spawned[0]?.argv).toEqual(["build"]);
    expect(spawned[0]?.options.shell).toBe(false);
    expect(spawned[0]?.options.cwd).toBe(workspace);
  });

  it("passes the workspace to Docker only as the mount and the container's name", () => {
    const runner = createRunner(deps, collector);
    runner.start(request(DOCKER));
    const argv = spawned[0]?.argv ?? [];
    expect(spawned[0]?.program).toBe("docker");
    expect(argv).toContain(RUNNER_IMAGE);
    // The mount, and it is spelled the way the Docker CLI documents for a
    // Windows host — forward slashes — so the path reaches exactly one element
    // in either spelling. A second appearance of the PATH would be a second
    // thing the container is told about, and a second `-v` is a second place it
    // can write.
    const spelled = workspace.split("\\").join("/");
    expect(argv.filter((element) => element.includes(spelled))).toHaveLength(1);
    expect(argv.filter((element) => element === "-v")).toHaveLength(1);
    // The name is derived from the same path and is a SECOND element, which is
    // the one addition the stop path needs: without it there is nothing to ask
    // about after `docker.exe` has exited and left the container running.
    const last = workspace.split(/[\\/]/).pop() ?? "";
    expect(argv.filter((element) => element.includes(last))).toHaveLength(2);
  });

  it("does not hand the child anything this app put in the environment", () => {
    // Threat model E2: the runner is never given the passcode, a key or a path
    // to the database. Nothing puts one there today, and this is the test that
    // makes the day something does a red build rather than a quiet leak.
    process.env.NEXUS_TEST_SECRET = "the-passcode";
    process.env.ELECTRON_RUN_AS_NODE = "1";
    try {
      createRunner(deps, collector).start(request());
      const env = spawned[0]?.options.env ?? {};
      expect(Object.keys(env).some((key) => key.startsWith("NEXUS_"))).toBe(false);
      expect(Object.keys(env).some((key) => key.startsWith("ELECTRON_"))).toBe(false);
      // And the environment is not emptied: the toolchain has to be findable.
      expect(env.PATH ?? env.Path).toBeDefined();
    } finally {
      delete process.env.NEXUS_TEST_SECRET;
      delete process.env.ELECTRON_RUN_AS_NODE;
    }
  });

  it("drops the variables that would REDIRECT the command it just built", () => {
    // The other half of the scrub, and it is not about secrecy. The command line
    // is fixed by source, so the environment is the only remaining way to change
    // what the command DOES: a `DOCKER_CONTEXT` pointing at another machine
    // makes every path in the argv name a directory there, and a `WSLENV`
    // forwards and rewrites variables across the Windows/Linux boundary. A run
    // whose stop then asked the wrong daemon about the wrong container would
    // report on work nobody started.
    process.env.DOCKER_CONTEXT = "remote-build-box";
    process.env.DOCKER_HOST = "tcp://10.0.0.7:2376";
    process.env.WSLENV = "PATH/l";
    try {
      createRunner(deps, collector).start(request(DOCKER));
      const env = spawned[0]?.options.env ?? {};
      expect(Object.keys(env).some((key) => key.startsWith("DOCKER_"))).toBe(false);
      expect(env.WSLENV).toBeUndefined();
    } finally {
      delete process.env.DOCKER_CONTEXT;
      delete process.env.DOCKER_HOST;
      delete process.env.WSLENV;
    }
  });

  it("refuses a workspace that is not inside the account directory", () => {
    const runner = createRunner(deps, collector);
    expect(runner.start({ ...request(), workspace: tmpdir() })).toEqual({
      started: false,
      reason: "write-failed",
      message: "the workspace is not inside this account's directory",
    });
    expect(spawned).toHaveLength(0);
    expect(runner.state("p1").phase).toBe("idle");
  });

  it("refuses a second run while one is going, and says which it is", () => {
    const runner = createRunner(deps, collector);
    expect(runner.start(request()).started).toBe(true);
    expect(runner.start(request())).toEqual({
      started: false,
      reason: "already-running",
      message: null,
    });
    expect(spawned).toHaveLength(1);
  });

  it("reports a spawn that threw rather than leaving the panel waiting", () => {
    refuseSpawn = true;
    const outcome = createRunner(deps, collector).start(request());
    expect(outcome).toEqual({ started: false, reason: "spawn-failed", message: "spawn refused" });
  });
});

describe("the output", () => {
  it("strips escapes and control characters before they reach the renderer", () => {
    // I1: a build can print anything, and the panel draws it as text — but a
    // log that can repaint itself is a log the user cannot trust to be whole.
    const runner = createRunner(deps, collector);
    runner.start(request());
    spawned[0]?.child.finish(0, "\u001b[32mStarting >>> wiring\u001b[0m\n\u0007");
    expect(events.output.join("")).toBe("Starting >>> wiring\n");
  });

  it("keeps the TAIL when a run prints more than the cap allows, and says that it did", () => {
    // The end of a build log is the half that matters — the error is the last
    // thing printed — so a head-first cap would keep the banner and throw away
    // the failure. Main holds the same capped log the renderer does, which is
    // what this accumulates it into: what main STREAMS is every chunk, because
    // the cap belongs to whoever is accumulating rather than to the pipe.
    const runner = createRunner(deps, collector);
    runner.start(request());
    const child = spawned[0]?.child;
    for (let i = 0; i < 6; i += 1) {
      child?.bytes(Buffer.from(`${String(i)}${"x".repeat(64 * 1024)}`, "utf8"));
    }
    expect(runner.state("p1").run?.truncated).toBe(true);

    const kept = events.output.reduce((log, chunk) => appendLog(log, chunk), EMPTY_LOG);
    expect(logText(kept)).not.toContain("0x");
    expect(logText(kept)).toContain("5x");
    child?.finish(0);
  });

  it("puts the end of a run that broke mid-character back together", () => {
    // A pipe splits where it likes. `string_decoder` is why a chunk boundary
    // inside a Serbian letter does not become a replacement character.
    const runner = createRunner(deps, collector);
    runner.start(request());
    const bytes = Buffer.from("šđč", "utf8");
    spawned[0]?.child.bytes(bytes.subarray(0, 3));
    spawned[0]?.child.bytes(bytes.subarray(3));
    spawned[0]?.child.finish(0);
    expect(events.output.join("")).toBe("šđč");
  });
});

describe("the state", () => {
  it("is running while the run is, and idle with an outcome once it ends", async () => {
    const runner = createRunner(deps, collector);
    runner.start(request());
    expect(runner.state("p1")).toMatchObject({
      phase: "running",
      run: { choice: "native", workspace },
    });
    spawned[0]?.child.finish(0, "done\n");
    // One tick, and it is the honest shape rather than a test artefact: the
    // conclusion is async because a profile's answer about its own work is, so
    // `state()` can be read for a microtask after the process closed and still
    // say `running`. The `changed` event follows immediately, and nothing in
    // the app reads the state in that window.
    await pause(5);
    expect(events.states).toEqual(["running", "idle"]);
    expect(runner.state("p1")).toMatchObject({
      phase: "idle",
      run: null,
      last: { stopped: false, exitCode: 0, state: "exited", message: null },
    });
  });

  it("is not visible to another profile, and the run does not stop being one", () => {
    const runner = createRunner(deps, collector);
    runner.start(request());
    expect(runner.state("p2")).toEqual({ phase: "idle", run: null, last: null });
    expect(runner.state("p1").phase).toBe("running");
  });

  it("reports a program that is not installed with the child's own words", async () => {
    // `spawn`'s ENOENT, which is how a machine without a toolchain meets this
    // feature, and the message is the child's own rather than this app's
    // paraphrase — a panel that said „colcon is not installed" would be
    // asserting more than the error does.
    const runner = createRunner(deps, collector);
    runner.start(request());
    spawned[0]?.child.fail("spawn colcon ENOENT");
    await pause(5);
    expect(runner.state("p1").last?.message).toBe("spawn colcon ENOENT");
  });
});

describe("the stop", () => {
  it("asks the process to die, and answers `exited` once it has", async () => {
    const runner = createRunner(deps, collector);
    runner.start(request());
    const stopping = runner.stop("p1");
    expect(spawned[0]?.child.killed).toBe(true);
    spawned[0]?.child.finish(null);
    await expect(stopping).resolves.toBe("exited");
    expect(runner.state("p1").last).toMatchObject({ stopped: true, state: "exited" });
  });

  it("leaves another profile's run alone", async () => {
    const runner = createRunner(deps, collector);
    runner.start(request());
    await expect(runner.stop("p2")).resolves.toBe("idle");
    expect(spawned[0]?.child.killed).toBe(false);
    expect(runner.state("p1").phase).toBe("running");
  });

  it("answers `idle` when there is nothing to stop", async () => {
    await expect(createRunner(deps, collector).stop("p1")).resolves.toBe("idle");
  });

  it("kills the CONTAINER when the Docker CLI will not die, and then says so", async () => {
    // D4: `docker.exe` exiting on Windows leaves the container running, so a
    // stop that only watched the local process would report a success it never
    // established. The `run` therefore answers NOTHING here — the CLI is alive
    // and ignoring the kill, which is the situation the ladder exists for. (It
    // matters that the fake says so: a policy that answered the run would end
    // it on its own, and the stop would then be concluding a process that had
    // already gone rather than removing a container that had not.)
    policy = (program, argv) => {
      if (program !== "docker") return null;
      if (argv[0] === "run") return null;
      // The `ps` the conclusion makes finds nothing, because the `rm` worked.
      if (argv[0] === "rm") return { code: 0 };
      return { code: 0, out: "" };
    };
    const runner = createRunner(deps, collector);
    runner.start(request(DOCKER));
    unmovedByKill();

    await expect(runner.stop("p1")).resolves.toBe("exited");
    expect(spawned.some((call) => call.program === "docker" && call.argv[0] === "rm")).toBe(true);
    expect(runner.state("p1").last).toMatchObject({ stopped: true, state: "exited" });
  });

  it("says `still-running` when the container outlives every attempt to remove it", async () => {
    // Also with the `run` alive: the answer under test is about the CONTAINER,
    // and the CLI's own fate is deliberately not part of it.
    policy = (program, argv) => {
      if (program !== "docker") return null;
      if (argv[0] === "run") return null;
      if (argv[0] === "ps") return { code: 0, out: "abc123\n" };
      return { code: 1, out: "Error: container is running" };
    };
    const runner = createRunner(deps, collector);
    runner.start(request(DOCKER));
    unmovedByKill();

    await expect(runner.stop("p1")).resolves.toBe("still-running");
    expect(runner.state("p1").last).toMatchObject({ stopped: true, state: "still-running" });
    // Twice: once by the ladder's own attempt and once by the conclusion's, and
    // neither of them is allowed to be the only one — the first is what kills
    // the work, the second is what would catch a container that came back.
    expect(spawned.filter((call) => call.argv[0] === "rm")).toHaveLength(2);
  });

  it("treats a daemon that cannot be asked as „not established", async () => {
    // An unanswerable question must not come back as a clean bill of health:
    // reporting `exited` for a `docker ps` that failed would be the same lie as
    // reporting it for one that found a container.
    policy = (program, argv) =>
      program === "docker" && argv[0] === "ps" ? { code: 1, out: "" } : null;
    const runner = createRunner(deps, collector);
    runner.start(request(DOCKER));
    unmovedByKill();
    await expect(runner.stop("p1")).resolves.toBe("still-running");
  });

  it("waits for a run that ends on its own", async () => {
    const runner = createRunner(deps, collector);
    runner.start(request());
    spawned[0]?.child.finish(0);
    await pause(5);
    expect(runner.state("p1").phase).toBe("idle");
  });
});

describe("the proof of work", () => {
  /**
   * The one claim an exit status cannot make.
   *
   * `colcon build` exits 0 over a workspace with nothing in it, so „uspešno
   * izgrađeno" is a sentence a zero cannot support — and the difference between
   * a build and an empty directory is a fact on disk, which is what these
   * tests establish by putting one there.
   */
  /** Starts a run, lets it exit with `code`, and answers what main concluded. */
  async function concludedAfter(code: number): Promise<ReturnType<Runner["state"]>["last"]> {
    const runner = createRunner(deps, collector);
    runner.start(request());
    spawned[0]?.child.finish(code);
    await pause(5);
    return runner.state("p1").last;
  }

  it("says the package was built when the build installed one", async () => {
    mkdirSync(installed(), { recursive: true });
    expect(await concludedAfter(0)).toMatchObject({ exitCode: 0, artifact: "present" });
  });

  it("says MISSING when the build exited zero over an empty workspace", async () => {
    // The defect this exists for, and the log here is the one colcon prints
    // over a workspace it found nothing in: a successful-looking success.
    expect(await concludedAfter(0)).toMatchObject({ exitCode: 0, artifact: "missing" });
  });

  it("says nothing at all about a run that did not exit zero", async () => {
    // Not a hedge: a failed build was never asked the question, and a panel
    // that printed „paket nije napravljen" here would be drawing a conclusion
    // from an exit status that already said everything there is to say.
    expect(await concludedAfter(1)).toMatchObject({ exitCode: 1, artifact: null });
  });

  it("asks about a directory this run was given, not about one that happens to exist", async () => {
    // The near miss: a marker in the account directory that this run did not
    // produce. It is not under the workspace, so the containment rule is what
    // refuses it — and the answer is the same `missing` a build that installed
    // nothing gets, because to the user those are one fact.
    mkdirSync(join(accountDir, "install", PACKAGE), { recursive: true });
    expect(await concludedAfter(0)).toMatchObject({ artifact: "missing" });
  });

  it("refuses a package name that would leave the workspace, without throwing mid-run", async () => {
    // A name is joined into a path, so it is contained by `isInsideAccount`'s
    // rule rather than pattern-matched against bad characters. A conclusion
    // that threw would leave the panel reporting `running` for a process that
    // had exited, which is the worst of the three possible answers.
    mkdirSync(join(accountDir, "outside"), { recursive: true });
    const runner = createRunner(deps, collector);
    runner.start({ ...request(), packageName: "..\\..\\outside" });
    spawned[0]?.child.finish(0);
    await pause(5);
    expect(runner.state("p1").last).toMatchObject({ exitCode: 0, artifact: "missing" });
  });
});

describe("the quit", () => {
  it("kills what is running, because a process the user cannot see is not one they kept", () => {
    const runner = createRunner(deps, collector);
    runner.start(request());
    runner.dispose();
    expect(spawned[0]?.child.killed).toBe(true);
    expect(runner.state("p1").run).toBeNull();
  });

  it("removes a Docker container through a process that outlives this one", () => {
    const runner = createRunner(deps, collector);
    runner.start(request(DOCKER));
    runner.dispose();
    const remove = spawned.find((call) => call.argv[0] === "rm");
    expect(remove?.argv.slice(-1)[0]).toMatch(/^nexus-/);
  });

  it("does nothing when no run is going", () => {
    const runner = createRunner(deps, collector);
    expect(() => {
      runner.dispose();
    }).not.toThrow();
    expect(spawned).toHaveLength(0);
  });
});

describe("detection", () => {
  it("reads each tool's own answer, and a version only when one is printed", async () => {
    policy = (program) => {
      if (program === "colcon") return { code: 0, out: "usage: colcon [-h] ...\n" };
      if (program === "docker") return { code: 0, out: "Docker version 27.3.1, build 9e34c9b\n" };
      return { code: 1 };
    };
    const found = await createRunner(deps, collector).detect();
    expect(found).toEqual([
      { profile: "native", present: true, detail: null, timedOut: false, distros: [] },
      { profile: "wsl", present: false, detail: null, timedOut: false, distros: [] },
      { profile: "docker", present: true, detail: "27.3.1", timedOut: false, distros: [] },
    ]);
  });

  it("decodes wsl.exe's UTF-16LE output, and asks each distribution about its toolchain", async () => {
    // The defect this test exists for: read as UTF-8, `wsl.exe -l -q` is a NUL
    // between every character, and a machine with two distributions is reported
    // as having none. The list is therefore driven as BYTES rather than through
    // `finish`, which would encode them as UTF-8 and test nothing.
    policy = (program, argv) => {
      if (program !== "wsl.exe") return { code: 0 };
      if (argv[0] === "-l") return null;
      // `argv[0]` is `-d`, so `argv[1]` is the distribution being asked. The
      // answer carries ROS, because an exit status alone does not make a
      // distribution usable — the shell exits 0 whether or not it found a
      // toolchain, which is what `rosDistroIn` is for.
      return argv[1] === "Ubuntu-22.04" ? { code: 0, out: "humble\n" } : { code: 0, out: "" };
    };
    const searching = createRunner(deps, collector).detect();
    await pause(5);
    const list = spawned.find((call) => call.program === "wsl.exe" && call.argv[0] === "-l");
    list?.child.bytes(Buffer.from("Ubuntu-22.04\r\nUbuntu\r\n", "utf16le"));
    list?.child.finish(0);
    const found = await searching;

    expect(found.find((entry) => entry.profile === "wsl")?.distros).toEqual([
      { name: "Ubuntu-22.04", usable: true },
      { name: "Ubuntu", usable: false },
    ]);
    // Every `wsl.exe` call that asks a distribution to DO something carries
    // `-e`, so nothing is handed a command STRING — without it the remaining
    // arguments are joined into a command line and given to the distribution's
    // own shell. The list probe is excluded because it names no distribution
    // and asks nothing of one; `-d` is exactly the line between the two.
    for (const call of spawned.filter(
      (entry) => entry.program === "wsl.exe" && entry.argv.includes("-d"),
    )) {
      expect(call.argv).toContain("-e");
    }
    expect(spawned.filter((entry) => entry.argv.includes("-d"))).toHaveLength(2);
  });

  it("reports a probe that never answers as unanswered rather than as missing", async () => {
    const found = await createRunner(deps, collector).detect();
    expect(found.map((entry) => entry.timedOut)).toEqual([true, true, true]);
    for (const call of spawned) expect(call.child.killed).toBe(true);
  });
});
