/**
 * The external runner — slice E6 of ADR-085, and the ONLY file in the shipped
 * application that starts a process.
 *
 * Until this slice the main process contained no `child_process` call at all:
 * the network was the app's one capability boundary, `main/net/offline.ts`
 * represented it as a switch, and `check:egress` kept it that way. Process
 * execution is strictly more dangerous, because a network call can only
 * exfiltrate what the app already holds while a spawned process runs with the
 * user's own rights. So the design is deliberately narrow:
 *
 * - **The command line comes from `@nexus/core`'s closed table** and takes
 *   exactly one value, the workspace path. Nothing here builds a command, and
 *   nothing a renderer sends can reach one — the IPC channels carry a circuit
 *   id. `scripts/check-runner.mjs` enforces both halves of that.
 * - **Neither `node:child_process` nor the toolchain's names appear outside
 *   this file** (and `runner.ts`), which is what makes „a second spawn site"
 *   something a static check can see rather than something a reviewer has to
 *   notice.
 * - **This module knows nothing about circuits or stores.** It is handed a
 *   target and a workspace. That is DEV-007's first mitigation as a shape
 *   rather than as a promise: a module that could read a circuit is a module
 *   that could put one in a command.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import {
  appendLog,
  buildCommand,
  containerProbe,
  containerRemove,
  EMPTY_LOG,
  outputText,
  readDistroList,
  readStatusProbe,
  rosDistroIn,
  RUNNER_PROBES,
  RUNNER_PROFILES,
  wslProbe,
  type RunnerLog,
  type RunnerProfileId,
  type RunnerRefusal,
  type RunnerTarget,
} from "@nexus/core";

import type {
  RunnerDetection,
  RunnerDistro,
  RunnerOutcome,
  RunnerPlanResult,
  RunnerState,
  RunnerStopState,
} from "../shared/ipc.js";
import { isInsideAccount, packageBuilt } from "./elecWorkspace.js";

/** A probe's answer: an exit status, its output, and whether it ever arrived. */
interface Capture {
  status: number | null;
  stdout: string;
  timedOut: boolean;
}

/**
 * What a caller gets back from `start`.
 *
 * A union rather than a flag beside a reason, so that `reason` cannot be read
 * on a run that started: the wire shape carries `"none"` for that case because
 * the renderer logs the outcome whole, but in here the type says it instead.
 */
export type StartOutcome =
  | { readonly started: true }
  | {
      readonly started: false;
      readonly reason: RunnerRefusal | "already-running" | "write-failed" | "spawn-failed";
      readonly message: string | null;
    };

export interface RunRequest {
  readonly profileId: string;
  readonly target: RunnerTarget;
  /** The account directory the workspace was derived from, checked once more immediately before the spawn. */
  readonly accountDir: string;
  readonly workspace: string;
  /**
   * The package the build is expected to produce — the name `writeWorkspace`
   * wrote under `src/`.
   *
   * It is here for the one question an exit status cannot answer. `colcon build`
   * exits 0 over an empty workspace, so a successful run and a run that built
   * nothing are the same number, and the difference is a directory on disk.
   */
  readonly packageName: string;
}

/** Where output and state go. In the app these are `webContents.send`; in the tests they are arrays. */
export interface RunnerEvents {
  readonly output: (text: string) => void;
  readonly changed: (state: RunnerState) => void;
}

/** How long each thing may take before the app says so, decided by the caller because every one of them is a decision about a user's machine. */
export interface RunnerTimeouts {
  /** How long a stop waits for the process to be gone before answering `still-running`. */
  readonly stopTimeoutMs: number;
  /** How long a probe may take before it is reported as unanswered rather than as missing. */
  readonly probeTimeoutMs: number;
  /** How long the container check after a run may take. */
  readonly containerTimeoutMs: number;
}

export interface RunnerDeps extends RunnerTimeouts {
  /** `node:child_process`'s own `spawn`, injected so a test can drive the whole lifecycle without a toolchain. */
  readonly spawn: typeof spawn;
  readonly now: () => number;
}

export interface ElecRunner {
  detect(): Promise<RunnerDetection[]>;
  plan(target: RunnerTarget, workspace: string): RunnerPlanResult;
  start(request: RunRequest): StartOutcome;
  stop(profileId: string): Promise<RunnerStopState>;
  state(profileId: string): RunnerState;
  /** Kills anything running. Called from `will-quit`, where nothing can be awaited. */
  dispose(): void;
}

/** One run, for as long as it lasts. Exactly one of these exists at a time — `current` is that fact. */
interface Active {
  readonly profileId: string;
  readonly choice: RunnerProfileId;
  readonly workspace: string;
  readonly argv: readonly string[];
  /**
   * The container this run is, for the one profile that has one — taken from
   * the plan and not derived again here.
   *
   * It is the whole of what main knows about how to reach the work: `null` means
   * the process this app started IS the work, and a name means it is not, so
   * every question about the run's fate is asked through this one value. That
   * is also why the profile id is never compared to a tool's name in this file —
   * the two are spelled the same, and `check:runner` would be right to fail a
   * build where a caller had to spell one to ask a question.
   */
  readonly container: string | null;
  /** What the build is expected to have produced, for the check an exit status cannot make. */
  readonly packageName: string;
  readonly startedAt: string;
  readonly child: ChildProcess;
  log: RunnerLog;
  /** The user asked it to stop, which the outcome reports and a natural exit does not. */
  stopping: boolean;
  /** Set when the process could not be started at all — `spawn`'s `ENOENT`, a refused mount. */
  message: string | null;
  /** The conclusion in flight, so that two paths reaching it await one answer rather than racing. */
  concluding: Promise<void> | null;
  settled: boolean;
}

/**
 * A probe's output as text, tolerating the one tool that does not write UTF-8.
 *
 * `wsl.exe -l -q` writes UTF-16LE — a NUL between every ASCII character — so a
 * caller that read its stdout as UTF-8 would find no distribution names at all
 * and report that a machine with four distributions has none. The test is the
 * BYTE PATTERN and not the profile, because the encoding is a property of the
 * tool's build as much as of the tool, and a probe that guessed from a table
 * would be wrong on the first machine that differed.
 *
 * Probes are small and are decoded once, whole, which is why this can be a
 * buffer test rather than a streaming decoder.
 */
function decodeProbe(bytes: Buffer): string {
  return bytes.subarray(0, 200).includes(0) ? bytes.toString("utf16le") : bytes.toString("utf8");
}

/** A probe's output is a few lines; this bounds a tool that decides to print forever. */
const PROBE_OUTPUT_CAP = 64 * 1024;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The runner the application uses: this file's own `spawn`, this file's own
 * clock, and the timeouts the caller decided.
 *
 * `createRunner` is the seam a test drives; this is the door main comes in by.
 * It exists so that `index.ts` never has to name `node:child_process` — the
 * capability lives in ONE file, and `check:runner` is what keeps that true
 * rather than the file's own good manners.
 */
export function createElecRunner(timeouts: RunnerTimeouts, events: RunnerEvents): ElecRunner {
  return createRunner({ spawn, now: () => Date.now(), ...timeouts }, events);
}

export function createRunner(deps: RunnerDeps, events: RunnerEvents): ElecRunner {
  let current: Active | null = null;
  let phase: RunnerState["phase"] = "idle";
  let last: RunnerOutcome | null = null;
  /** The probe round in flight, so a second `detect` joins it instead of starting another. */
  let probing: Promise<RunnerDetection[]> | null = null;

  function view(): RunnerState {
    return {
      phase,
      run:
        current === null
          ? null
          : {
              profileId: current.profileId,
              choice: current.choice,
              workspace: current.workspace,
              argv: [...current.argv],
              startedAt: current.startedAt,
              truncated: current.log.truncated,
            },
      last,
    };
  }

  /**
   * One probe: a fixed argv, an exit status, and a deadline.
   *
   * The deadline is not decoration. A tool that is installed but hangs — which
   * is what `wsl.exe` does when the WSL service is not running — would
   * otherwise leave the panel reporting nothing forever, and its absence is a
   * DIFFERENT sentence to the user than a tool that is not there.
   */
  function runCapture(argv: readonly string[], timeoutMs: number): Promise<Capture> {
    return new Promise<Capture>((resolve) => {
      let child: ChildProcess;
      try {
        child = deps.spawn(argv[0] ?? "", argv.slice(1), {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          // Explicit rather than defaulted, because it is the property this
          // whole file is arranged around: with no shell, an argv element is
          // an argument and never a word that can be split.
          shell: false,
        });
      } catch {
        resolve({ status: null, stdout: "", timedOut: false });
        return;
      }

      const parts: Buffer[] = [];
      let bytes = 0;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        resolve({ status: null, stdout: decodeProbe(Buffer.concat(parts)), timedOut: true });
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        if (bytes >= PROBE_OUTPUT_CAP) return;
        bytes += chunk.length;
        parts.push(chunk);
      });
      child.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: null, stdout: "", timedOut: false });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: code, stdout: decodeProbe(Buffer.concat(parts)), timedOut: false });
      });
    });
  }

  /**
   * What the profile itself says about whether the WORK is gone.
   *
   * This exists for one reason, and it is D4 in the threat model: `docker.exe`
   * exiting on Windows leaves the container running, so „stopped" cannot be
   * established by watching the process this app started. The container is
   * named after the workspace, so it can be asked about by name, and `--rm`
   * means a container that finished on its own is already gone.
   *
   * For `native` and `wsl` there is nothing to ask: the process that was
   * started is the only thing this app can see, and when it has exited the
   * answer is that it has exited. A distribution that keeps a Linux-side
   * process alive after its relay exits is not detectable from here, and the
   * threat model records that as a residual rather than claiming otherwise.
   */
  async function profileState(active: Active): Promise<RunnerOutcome["state"]> {
    const name = active.container;
    // No container means the process this app started is the work, and it has
    // exited — there is nothing else to ask.
    if (name === null) return "exited";
    const found = await runCapture(containerProbe(name), deps.containerTimeoutMs);
    // A daemon that could not be asked is not a daemon that answered „nothing
    // running": an unanswerable question must not be reported as a clean bill
    // of health, which is the whole reason this function exists.
    if (found.status !== 0) return "still-running";
    if (found.stdout.trim() === "") return "exited";
    const removed = await runCapture(containerRemove(name), deps.containerTimeoutMs);
    return removed.status === 0 ? "exited" : "still-running";
  }

  /**
   * Ends the run, once.
   *
   * `error` and `close` can both fire for one process, and `stop` can conclude
   * a run the close handler is already concluding — so the conclusion is a
   * PROMISE stored on the run, and the second caller awaits the first one's
   * answer instead of racing it. Without that, a stop could read `last` before
   * the conclusion had written it and report the previous run's outcome.
   */
  function conclude(active: Active, exitCode: number | null): Promise<void> {
    active.concluding ??= finish(active, exitCode);
    return active.concluding;
  }

  async function finish(active: Active, exitCode: number | null): Promise<void> {
    active.settled = true;
    const state = await profileState(active);
    if (current === active) current = null;
    phase = "idle";
    // Asked only of a run that exited zero, because that is the only case where
    // the exit status makes a claim this can be checked against. A build that
    // failed, or that never started, is reported as having no opinion.
    const artifact =
      exitCode === 0 ? (packageBuilt(active.workspace, active.packageName) ? "present" : "missing") : null;
    last = { stopped: active.stopping, exitCode, state, message: active.message, artifact };
    events.changed(view());
  }

  /**
   * What is installed, asked of each tool itself. Spawns, which is why no panel
   * does it on mount.
   *
   * **One probe round at a time, and it is the run's own rule.** This is the
   * second of the two places in the app that start a process, and the renderer
   * is untrusted: a caller that asked twice would otherwise get two rounds of
   * three probes, and a caller in a loop would get a process storm — which is
   * D2 in the threat model, the one that names „many runs". A second caller
   * therefore JOINS the round in flight rather than starting one, which is also
   * what it wants: the answer is about the machine, not about the caller.
   */
  async function detect(): Promise<RunnerDetection[]> {
    probing ??= probe();
    const round = probing;
    try {
      return await round;
    } finally {
      if (probing === round) probing = null;
    }
  }

  async function probe(): Promise<RunnerDetection[]> {
    // Sequential rather than concurrent: each probe is a process, and a machine
    // that runs three of them at once is a machine whose task manager shows
    // three processes appear the moment a panel is opened.
    const found: RunnerDetection[] = [];
    for (const profile of RUNNER_PROFILES) {
      const probe = await runCapture(RUNNER_PROBES[profile], deps.probeTimeoutMs);
      if (profile !== "wsl") {
        const read = readStatusProbe(probe.status, probe.stdout);
        found.push({
          profile,
          present: read.kind === "found",
          detail: read.kind === "found" ? read.detail : null,
          timedOut: probe.timedOut,
          distros: [],
        });
        continue;
      }

      const names = probe.status === 0 ? readDistroList(probe.stdout) : [];
      const distros: RunnerDistro[] = [];
      for (const name of names) {
        // Every distribution is asked, in order, and the answer is a fact
        // rather than an assumption: a list that showed all of them as usable
        // would send the user into a build that fails inside a distribution
        // whose toolchain was never there.
        const inner = await runCapture(wslProbe(name), deps.probeTimeoutMs);
        // An exit status is not enough to call a distribution usable: the shell
        // exits 0 whether or not it found ROS, and `rosDistroIn` is what turns
        // „the shell ran" into „the shell has a toolchain in it".
        distros.push({ name, usable: inner.status === 0 && rosDistroIn(inner.stdout) !== null });
      }
      found.push({
        profile,
        present: probe.status === 0,
        detail: null,
        timedOut: probe.timedOut,
        distros,
      });
    }
    return found;
  }

  /**
   * The literal command a start would run.
   *
   * Pure, apart from `@nexus/core`, and answered for the CONSENT SCREEN — the
   * screen and the start call the same function, which is the only way the
   * command the user agreed to and the command that runs can be one string.
   */
  function plan(target: RunnerTarget, workspace: string): RunnerPlanResult {
    const built = buildCommand(target, workspace);
    if (built.kind === "refused") return { kind: "refused", reason: built.reason };
    return {
      kind: "command",
      argv: [...built.argv],
      cwd: built.cwd,
      workspace: built.workspace,
      // Whether this reaches a registry, which the consent copy says in a
      // sentence of its own. Carried by the table for the reason `container`
      // is: the alternative is asking which profile this is, and the profile
      // ids are the tools' own names.
      pullsImage: built.pullsImage,
    };
  }

  function start(request: RunRequest): StartOutcome {
    if (current !== null) return { started: false, reason: "already-running", message: null };

    // T3, re-checked at the last moment rather than only where the workspace was
    // written: the two are separate moments, and the interval between them is
    // where a symlink swap would live.
    if (!isInsideAccount(request.accountDir, request.workspace)) {
      return {
        started: false,
        reason: "write-failed",
        message: "the workspace is not inside this account's directory",
      };
    }

    const built = buildCommand(request.target, request.workspace);
    if (built.kind === "refused") return { started: false, reason: built.reason, message: null };

    let child: ChildProcess;
    try {
      child = deps.spawn(built.argv[0] ?? "", built.argv.slice(1), {
        cwd: built.cwd,
        env: childEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      return { started: false, reason: "spawn-failed", message: messageOf(error) };
    }

    const active: Active = {
      profileId: request.profileId,
      choice: request.target.profile,
      workspace: built.workspace,
      argv: built.argv,
      container: built.container,
      packageName: request.packageName,
      startedAt: new Date(deps.now()).toISOString(),
      child,
      log: EMPTY_LOG,
      stopping: false,
      message: null,
      concluding: null,
      settled: false,
    };
    current = active;
    phase = "running";
    events.changed(view());

    // `string_decoder` rather than `chunk.toString()`: a pipe splits where it
    // likes, and a chunk boundary inside a Serbian letter would otherwise put a
    // replacement character in the middle of a build log.
    const decoder = new StringDecoder("utf8");
    const onData = (chunk: Buffer): void => {
      const text = outputText(decoder.write(chunk));
      if (text === "") return;
      active.log = appendLog(active.log, text);
      events.output(text);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("error", (error) => {
      // A program that is not installed arrives here rather than as an exit
      // status — on Windows and on POSIX alike — and it is the case a user
      // meets most often, because it is what a machine without the toolchain
      // does. The message is the child's own words.
      active.message = messageOf(error);
      void conclude(active, null);
    });
    child.on("close", (code) => {
      const tail = outputText(decoder.end());
      if (tail !== "") {
        active.log = appendLog(active.log, tail);
        events.output(tail);
      }
      void conclude(active, code);
    });

    return { started: true };
  }

  /** How a stop proceeds: ask, wait, and then establish what is TRUE rather than what was intended. */
  async function stop(profileId: string): Promise<RunnerStopState> {
    const active = current;
    // A run belonging to another profile is not this caller's to stop.
    if (active === null || active.profileId !== profileId) return "idle";

    active.stopping = true;
    phase = "stopping";
    events.changed(view());
    active.child.kill();

    await new Promise<void>((resolve) => {
      if (active.settled) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, deps.stopTimeoutMs);
      active.child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    // The Docker profile's answer is about the container and not about the CLI,
    // so a process that would not die is followed by the only thing that kills
    // the WORK. `conclude` then asks the profile what it achieved, which is how
    // a stop that did not take reports `still-running` instead of assuming.
    if (!active.settled && active.container !== null) {
      await runCapture(containerRemove(active.container), deps.containerTimeoutMs);
    }

    await conclude(active, null);
    return last?.state === "exited" ? "exited" : "still-running";
  }

  function state(profileId: string): RunnerState {
    const full = view();
    if (full.run !== null && full.run.profileId !== profileId) return { phase: "idle", run: null, last: null };
    return full;
  }

  /**
   * The quit path. `will-quit` runs synchronously and nothing there can await,
   * so the kill is issued and the Docker profile's container is removed by a
   * detached process that outlives this one. A simulation left running after
   * the window closed is a process the user cannot see and did not keep.
   */
  function dispose(): void {
    const active = current;
    if (active === null) return;
    active.settled = true;
    current = null;
    active.child.kill();
    if (active.container !== null) {
      const remove = containerRemove(active.container);
      try {
        // Detached, because this process is about to stop existing and the
        // removal has to outlive it. `unref` so that it cannot hold the app
        // open for one second longer than the user asked.
        deps
          .spawn(remove[0] ?? "", remove.slice(1), {
            detached: true,
            stdio: "ignore",
            shell: false,
          })
          .unref();
      } catch {
        // Quitting. Nothing here can report anywhere, and `--rm` means the
        // container removes itself when its command finishes.
      }
    }
  }

  return { detect, plan, start, stop, state, dispose };
}

/**
 * The environment the toolchain runs in: the user's own, minus what would
 * change the MEANING of the command this app just built.
 *
 * The child has to inherit `PATH`, `HOME` and the rest — that is how `colcon`
 * is found at all — so this cannot be a minimal environment. Three families are
 * removed, and they are removed for two different reasons.
 *
 * `NEXUS_*` and `ELECTRON_*` are this app's own: threat model E2 says the runner
 * is never handed the passcode, a key or a path to the database, and a
 * `process.env` copied wholesale is exactly how that would happen by accident
 * the day something starts putting one there. The test that pins this exists so
 * that the day is a red build.
 *
 * `DOCKER_*` and `WSLENV` are different, and this half is not about secrecy at
 * all. Both families are REDIRECTIONS: `DOCKER_CONTEXT` and `DOCKER_HOST` make
 * the `docker` this app spawns talk to a machine that is not this one, so every
 * path in the argv — the mount, and the container's name — would name a
 * directory on the wrong computer, and a „stopped" established by asking that
 * daemon would be about a container nobody started. `WSLENV` does the same to
 * `wsl.exe`, forwarding and translating variables across the boundary. The
 * command line is fixed by source; the environment is not, so the environment
 * is where the command can be changed by whoever set it.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NEXUS_") || key.startsWith("ELECTRON_")) delete env[key];
    else if (key.startsWith("DOCKER_") || key === "WSLENV") delete env[key];
  }
  return env;
}
