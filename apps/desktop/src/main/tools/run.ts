/**
 * ADR-094's tool runner: the one place this application starts a process that
 * somebody else wrote.
 *
 * **Running a program is a capability, and this is where it is spent.** Before
 * the Elektronika runner the shipped app could reach exactly one thing outside
 * itself — the network, off by default — and a `tool` pack adds the sharper one:
 * a program from a signed pack, running on this machine, over input a user
 * chose. A pack is a folder of bytes from outside (ADR-091), and `tool` is the
 * one kind of it that is executed, so every guarantee the app can give about it
 * is enforced here rather than promised in copy:
 *
 * 1. **The program is the manifest's entry, and nothing else.** The argv is the
 *    manifest's fixed `args` plus what this module's caller appends; no path, no
 *    host name and no argument ever arrives from the renderer, and `shell` is
 *    `false`, so argv elements reach the program as a LIST rather than being
 *    re-read as a command line by `cmd.exe`.
 * 2. **Its bytes are the bytes the release key signed.** Before the FIRST spawn
 *    of a session the entry file is read back and hashed, and the digest must be
 *    the one in the manifest that `openPackSource` or `readInstalled` already
 *    verified a signature over. A pack whose entry was replaced after install
 *    does not run, and the check costs one read of one file per session.
 * 3. **It runs in an empty directory of its own, under a name this module
 *    chose.** The working directory is a new folder under `%TEMP%`, and a caller
 *    that has an input file stages it there first (`stageInput`). The program is
 *    therefore never told where the user's file lives, and anything it writes
 *    during the run is something `close()` deletes.
 * 4. **It inherits nothing this app holds.** `toolEnvironment` builds the
 *    child's environment from nothing rather than filtering `process.env`: a
 *    filter is a list of the names somebody remembered, and an unfiltered spread
 *    is one forgotten name away from handing `AWS_*`, an SSH agent socket or the
 *    user's own `PATH` to a program that has not earned them.
 * 5. **It cannot run forever and cannot talk forever.** A time limit and an
 *    output cap come from `TOOL_LIMITS`, and breaching either kills the process.
 *    `killAllToolSessions()` is what an app-quit handler calls, because a
 *    process that outlives the window that started it is a process with no owner
 *    and no cancel.
 *
 * What this module is NOT is a sandbox. It does not cap the child's memory, its
 * file-system reach, or its ability to start another process; it does not put it
 * in a job object, and it cannot take the network away from it. What it gives is
 * a bounded, killable, hash-checked process with a clean directory and a clean
 * environment — the part an in-process API can actually guarantee. The research
 * behind ADR-094 (`research/dwg/report.md`) says plainly that a DWG decoder is
 * memory-unsafe C, so the honest reading of a tool pack is: untrusted code from
 * a publisher this app chose to trust, not a program this app has contained.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PackManifest } from "../packs/manifest.js";
import { sha256File } from "../packs/verify.js";

/**
 * The caps every tool process runs under.
 *
 * Loose enough that no correct program meets them, tight enough that a broken
 * or hostile one cannot spend the machine: a minute of CPU, eight mebibytes of
 * console, and half a gigabyte for the one input file this module will stage.
 * The DWG converter's deadline is the same minute (ADR-094 names it) and its
 * output file has its own cap in `dwg.ts`, because that number is about a DXF
 * rather than about a process.
 */
export const TOOL_LIMITS = {
  /** Longest one tool process may run before it is killed. */
  timeoutMs: 60_000,
  /** Most stdout and stderr, together, a tool process may write before it is killed. */
  outputBytes: 8 * 1024 * 1024,
  /** Largest input file `stageInput` will copy into a session's directory. */
  inputBytes: 512 * 1024 * 1024,
} as const;

/** Why a tool could not be started, or an input could not be staged. */
export type ToolRefusal =
  /** The manifest is not a tool pack: it carries no `tool` record to run. */
  | "no-tool"
  /** The entry the manifest names is not in the installed folder whose bytes match it. */
  | "missing-entry"
  /** The entry's bytes are not the bytes the signed manifest claims. */
  | "hash-mismatch"
  /** The process could not be started at all. */
  | "spawn-failed"
  /** An input file is larger than this module will copy. */
  | "input-too-large"
  /** A file could not be read or written. */
  | "io";

/** A refusal, with the code that names the rule that was broken. */
export class ToolError extends Error {
  readonly code: ToolRefusal;

  constructor(code: ToolRefusal, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

/** Why a run ended, when it was this module rather than the program that ended it. */
export type ToolStop = "timeout" | "output-limit" | "cancelled";

export interface ToolExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Non-null when one of this module's own caps — not the program — ended the run. */
  readonly stopped: ToolStop | null;
  /** The message of the `error` event, when the process never started. */
  readonly spawnError: string | null;
}

export interface ToolResult extends ToolExit {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export interface ToolRunOptions {
  /** Arguments appended after the manifest's own fixed ones. */
  readonly args?: readonly string[];
  /**
   * Written to stdin, which is then closed.
   *
   * Omitted leaves stdin open, which is what a request/response protocol (UCI)
   * needs; a one-shot filter passes `""` so a program that reads until end of
   * input is not left waiting for a console nobody will type into.
   */
  readonly stdin?: string;
  /**
   * Overrides `TOOL_LIMITS.timeoutMs` for this run.
   *
   * `null` is "no deadline", which is what a request/response engine needs: it
   * is meant to outlive a search, and each REQUEST carries its own deadline
   * instead (`uci.ts`). Omitted means the session's limit.
   */
  readonly timeoutMs?: number | null;
  /** Kills the process when it aborts: a cancel from the user, or a screen being left. */
  readonly signal?: AbortSignal;
}

/** A process the session started. `run` is this plus "wait for it and keep the output". */
export interface ToolProcess {
  readonly pid: number | undefined;
  /** Everything written to stdout so far, up to the output cap. */
  readonly stdout: Buffer;
  /** Everything written to stderr so far, up to the output cap. */
  readonly stderr: Buffer;
  write(data: string): void;
  endStdin(): void;
  onStdout(listener: (chunk: Buffer) => void): () => void;
  onStderr(listener: (chunk: Buffer) => void): () => void;
  onExit(listener: (exit: ToolExit) => void): () => void;
  kill(): void;
  readonly exited: Promise<ToolExit>;
}

export interface ToolSession {
  /** The session's own empty directory under `%TEMP%`: every run's working directory. */
  readonly workDir: string;
  /** The pack's `tool` record, resolved, so a caller need not re-check for one. */
  readonly tool: {
    readonly entry: string;
    readonly protocol: "uci" | "stdio";
    readonly args: readonly string[];
  };
  start(options?: ToolRunOptions): Promise<ToolProcess>;
  /** Starts, waits, and answers with the process's exit and its output. */
  run(options?: ToolRunOptions): Promise<ToolResult>;
  /** Kills whatever this session started. */
  kill(): void;
  /** Kills, then removes the working directory. Safe to call twice. */
  close(): Promise<void>;
}

export interface ToolLimits {
  readonly timeoutMs: number;
  readonly outputBytes: number;
  readonly inputBytes: number;
}

export interface ToolSessionInput {
  /** The installed pack's version folder — where the manifest's files live. */
  readonly dir: string;
  /**
   * The pack's signed manifest.
   *
   * Taken as given, and the caller is the one that has to have verified it: the
   * only two ways to hold one are `openPackSource` and `readInstalled`, and both
   * check the release key's signature first. This module checks the ENTRY
   * against what the manifest says, which is a different question — whether the
   * bytes on disk are still the bytes that were signed.
   */
  readonly manifest: PackManifest;
  /** Where the fresh working directory is made. Injected for tests; `%TEMP%` by default. */
  readonly tempRoot?: string;
  /** The platform whose environment rules apply. Injected for tests; this process's by default. */
  readonly platform?: NodeJS.Platform;
  /** Windows' own directory, for the two variables a console program expects. Injected for tests. */
  readonly systemRoot?: string | null;
  readonly limits?: ToolLimits;
}

/**
 * The environment a tool process is given, built from nothing.
 *
 * `process.env` is neither spread nor filtered here, and that is the decision:
 * the names that matter (`AWS_SECRET_ACCESS_KEY`, `NODE_OPTIONS`, a token, an
 * SSH agent socket, the user's `PATH`) are exactly the ones a filter is written
 * a week too late for. So the child gets the short list below, and `PATH` is the
 * entry's OWN directory — a program finds the helpers beside it and nothing else
 * on the machine.
 *
 * `TEMP`/`TMP` point at the session's directory, so a program that writes a
 * scratch file writes it where `close()` will delete it. On Windows `SystemRoot`
 * and `windir` stay, because parts of the Win32 API read them and a program that
 * cannot find the system directory would fail for a reason that has nothing to
 * do with this application.
 *
 * MEASURED, on this machine, because it is the kind of claim that reads true and
 * is not: Node itself adds a fixed list to any child on Windows — `HOMEDRIVE`,
 * `HOMEPATH`, `LOGONSERVER`, `SYSTEMDRIVE`, `SYSTEMROOT`, `TEMP`, `USERDOMAIN`,
 * `USERNAME`, `USERPROFILE`, `WINDIR` — taking each from this process's
 * environment unless the list above already sets it. So a Windows tool learns
 * the account name and the profile path whether or not it is told; what it does
 * NOT learn is any variable this application holds, which is the part that
 * matters and the part a test asserts. `TEMP` being named above is what keeps
 * the scratch directory the session's own, whichever side supplied the name.
 */
export function toolEnvironment(input: {
  readonly platform: NodeJS.Platform;
  readonly workDir: string;
  readonly entryDir: string;
  readonly systemRoot: string | null;
}): Record<string, string> {
  if (input.platform === "win32") {
    return {
      PATH: input.entryDir,
      TEMP: input.workDir,
      TMP: input.workDir,
      ...(input.systemRoot === null ? {} : { SystemRoot: input.systemRoot, windir: input.systemRoot }),
    };
  }
  return {
    PATH: input.entryDir,
    HOME: input.workDir,
    TMPDIR: input.workDir,
    LANG: "C.UTF-8",
  };
}

/** The sessions this process has alive, so an app-quit handler can kill them all. */
const liveSessions = new Set<ToolSession>();

/** How many sessions are live. A test asserts the registry empties; nothing else needs it. */
export function liveToolSessionCount(): number {
  return liveSessions.size;
}

/**
 * Kills every process every live session started.
 *
 * This is what the app calls on quit: a tool process that outlives the window
 * has no owner and no cancel, and its own time limit is a minute, which is far
 * too long to be the only thing standing between a quit and a stray program.
 */
export function killAllToolSessions(): void {
  for (const session of [...liveSessions]) session.kill();
}

/**
 * Copies a hostile input file into the session's directory under a name this
 * module chose, and answers that path.
 *
 * Hostile in the two ways that matter to a runner. Its SIZE is checked before a
 * byte is copied: a tool pack may be asked to convert a drawing, never to be
 * handed a disk image. Its NAME is not used at all: the staged file is a random
 * hex name plus the caller's suffix, so nothing a user or an archive wrote ends
 * up in a path, in argv, or in a program's own output directory. `suffix` comes
 * from the caller and is never derived from the input's own name, for that
 * reason — `.dwg` is a fact about what the tool expects, not a claim about a
 * file.
 */
export async function stageInput(
  session: ToolSession,
  source: string,
  options: { readonly suffix: string; readonly maxBytes?: number },
): Promise<string> {
  const maxBytes = options.maxBytes ?? TOOL_LIMITS.inputBytes;
  let size: number;
  try {
    size = (await stat(source)).size;
  } catch (error) {
    throw new ToolError("io", `"${source}" could not be read: ${messageOf(error)}`);
  }
  if (size > maxBytes) {
    throw new ToolError(
      "input-too-large",
      `"${source}" is ${String(size)} bytes; a tool input may be at most ${String(maxBytes)}.`,
    );
  }
  const staged = join(session.workDir, `${randomBytes(8).toString("hex")}${options.suffix}`);
  try {
    await writeFile(staged, await readFile(source));
  } catch (error) {
    throw new ToolError("io", `"${source}" could not be staged: ${messageOf(error)}`);
  }
  return staged;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates a session: one fresh working directory, one verified-entry promise,
 * and the caps every run under it uses.
 *
 * The directory is made now rather than per run, because the whole point of it
 * is that the program never sees the folder it came from or the folder the user
 * picked. It is removed by `close()`, which the caller owns.
 */
export async function createToolSession(input: ToolSessionInput): Promise<ToolSession> {
  const spec = input.manifest.tool;
  if (input.manifest.kind !== "tool" || spec === undefined) {
    throw new ToolError("no-tool", `Pack "${input.manifest.id}" is not a tool pack.`);
  }
  // Destructured into plain consts rather than read off `spec` inside the
  // closures below: a narrowing lives in the scope that made it, and a property
  // read inside a callback is read again with the type it was declared with.
  const entry = spec.entry;
  const protocol = spec.protocol;
  const fixedArgs: readonly string[] = spec.args ?? [];
  const limits = input.limits ?? TOOL_LIMITS;
  const platform = input.platform ?? process.platform;
  const segments = entry.split("/");
  const entryPath = join(input.dir, ...segments);
  const entryDir = join(input.dir, ...segments.slice(0, -1));
  const workDir = await mkdtemp(join(input.tempRoot ?? tmpdir(), "nexus-tool-"));

  let verification: Promise<void> | null = null;
  const children = new Set<ChildProcess>();
  /** One promise per live child, settled when it has really exited. `close` waits on these. */
  const pending = new Set<Promise<void>>();
  let closed = false;

  /**
   * The entry against the manifest, once per session.
   *
   * Memoised as the PROMISE rather than as a boolean, so two runs racing to be
   * first cannot both hash the file and, worse, cannot both decide.
   */
  function verifyEntry(): Promise<void> {
    verification ??= (async () => {
      const listed = input.manifest.files.find((file) => file.path === entry);
      if (listed === undefined) {
        // `parsePackManifest` refuses this shape, so reaching it means the
        // manifest did not come through that parser.
        throw new ToolError("missing-entry", `"${entry}" is not one of the pack's files.`);
      }
      let actual: string;
      try {
        actual = await sha256File(entryPath);
      } catch (error) {
        throw new ToolError("missing-entry", `"${entry}" could not be read: ${messageOf(error)}`);
      }
      if (actual !== listed.sha256) {
        throw new ToolError(
          "hash-mismatch",
          `"${entry}" does not have the SHA-256 the signed manifest states.`,
        );
      }
    })();
    return verification;
  }

  function start(options: ToolRunOptions = {}): Promise<ToolProcess> {
    if (closed) return Promise.reject(new ToolError("io", "This tool session is closed."));
    return verifyEntry().then(() => {
      const argv = [...fixedArgs, ...(options.args ?? [])];
      const child = spawn(entryPath, argv, {
        cwd: workDir,
        env: toolEnvironment({
          platform,
          workDir,
          entryDir,
          systemRoot:
            input.systemRoot === undefined ? (process.env["SystemRoot"] ?? null) : input.systemRoot,
        }),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      children.add(child);
      let childDone: () => void = () => undefined;
      const done = new Promise<void>((resolve) => {
        childDone = resolve;
      });
      pending.add(done);

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stopped: ToolStop | null = null;
      let spawnError: string | null = null;
      const stdoutListeners = new Set<(chunk: Buffer) => void>();
      const stderrListeners = new Set<(chunk: Buffer) => void>();
      const exitListeners = new Set<(exit: ToolExit) => void>();

      let settle: (exit: ToolExit) => void = () => undefined;
      const exited = new Promise<ToolExit>((resolve) => {
        settle = resolve;
      });

      /**
       * One of this module's caps ended the run, so the reason is recorded
       * before the kill: the exit event that follows says only that the process
       * died, and a caller that could not tell "the program crashed" from "this
       * app killed it" would report the wrong one to the user.
       */
      function terminate(): void {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill();
        // A program in user space can ignore a polite signal; nothing ignores
        // the second one. `unref` because this timer must not be the reason the
        // app stays open.
        setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      }

      function stop(reason: ToolStop): void {
        stopped ??= reason;
        terminate();
      }

      const deadline = options.timeoutMs === undefined ? limits.timeoutMs : options.timeoutMs;
      const timeout = deadline === null ? null : setTimeout(() => stop("timeout"), deadline);
      const onAbort = (): void => stop("cancelled");
      if (options.signal?.aborted === true) stop("cancelled");
      options.signal?.addEventListener("abort", onAbort, { once: true });

      /**
       * The cap counts stdout and stderr together: the console is one resource
       * however a program splits it, and a bound that covered only one of the
       * two would be a bound a misbehaving program steps around by using the
       * other.
       */
      function underCap(): boolean {
        if (stdoutBytes + stderrBytes > limits.outputBytes) {
          stop("output-limit");
          return false;
        }
        return true;
      }

      child.stdout?.on("data", (chunk: Buffer) => {
        if (!underCap()) return;
        stdoutBytes += chunk.byteLength;
        stdout.push(chunk);
        for (const listener of stdoutListeners) listener(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (!underCap()) return;
        stderrBytes += chunk.byteLength;
        stderr.push(chunk);
        for (const listener of stderrListeners) listener(chunk);
      });

      function finish(code: number | null, signal: NodeJS.Signals | null): void {
        if (timeout !== null) clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
        children.delete(child);
        pending.delete(done);
        childDone();
        const exit: ToolExit = { code, signal, stopped, spawnError };
        for (const listener of exitListeners) listener(exit);
        settle(exit);
      }

      // A failed spawn (`ENOENT`, a file that is not executable) arrives here
      // and NOT through `close` on every platform, which is why both handlers
      // call the same `finish` and why `finish` is idempotent by construction:
      // whichever fires last settles the promise that has already settled.
      child.on("error", (error: Error) => {
        spawnError ??= error.message;
        finish(null, null);
      });
      child.on("close", (code, signal) => finish(code, signal));

      /**
       * A stream error is not this run's failure. The one that happens in
       * practice is `EPIPE` on stdin: a program this module killed — or one that
       * exited on its own — leaves a closed pipe behind, and the `end` below
       * raises an error event that would otherwise reach the process as an
       * unhandled exception and take a whole test file down with it. The exit
       * itself is already reported, with the reason, through `finish`.
       */
      child.stdin?.on("error", () => undefined);
      child.stdout?.on("error", () => undefined);
      child.stderr?.on("error", () => undefined);

      if (options.stdin !== undefined) child.stdin?.end(options.stdin);

      return {
        pid: child.pid,
        get stdout() {
          return Buffer.concat(stdout, stdoutBytes);
        },
        get stderr() {
          return Buffer.concat(stderr, stderrBytes);
        },
        write(data) {
          // Writing to a killed program's stdin is a no-op rather than a throw:
          // the caller's next step is the exit it is already waiting for.
          try {
            child.stdin?.write(data);
          } catch {
            // See the stream-error handler below: the pipe is gone, and the exit
            // event is the answer.
          }
        },
        endStdin() {
          child.stdin?.end();
        },
        onStdout(listener) {
          stdoutListeners.add(listener);
          return (): void => {
            stdoutListeners.delete(listener);
          };
        },
        onStderr(listener) {
          stderrListeners.add(listener);
          return (): void => {
            stderrListeners.delete(listener);
          };
        },
        onExit(listener) {
          exitListeners.add(listener);
          return (): void => {
            exitListeners.delete(listener);
          };
        },
        kill: terminate,
        exited,
      };
    });
  }

  const session: ToolSession = {
    workDir,
    tool: { entry, protocol, args: fixedArgs },
    start,
    async run(options = {}) {
      const started = await start(options);
      const exit = await started.exited;
      if (exit.spawnError !== null) {
        throw new ToolError("spawn-failed", exit.spawnError);
      }
      return { ...exit, stdout: started.stdout, stderr: started.stderr };
    },
    kill() {
      for (const child of [...children]) child.kill();
    },
    async close() {
      closed = true;
      // Killed, then WAITED for: the working directory is a child's own cwd, and
      // on Windows a directory whose process is still exiting cannot be removed.
      // A close that answered before the process was gone would leave a folder
      // behind and report success.
      for (const child of [...children]) child.kill();
      const exits = Promise.all([...pending]);
      const grace = new Promise<void>((resolve) => {
        setTimeout(resolve, 5_000).unref();
      });
      await Promise.race([exits, grace]);
      liveSessions.delete(session);
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
  liveSessions.add(session);
  return session;
}
