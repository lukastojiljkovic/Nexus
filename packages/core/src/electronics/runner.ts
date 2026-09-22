/**
 * The external runner's closed table — slice E6 of ADR-085.
 *
 * **This file is where every external command line in Nexus is written down.**
 * That is the whole of the answer to the sharpest threat in the module, and it
 * is why the commands live in `@nexus/core` rather than beside the spawn: a
 * `.nexus.zip` is an ordinary, shareable artefact, so every string on a circuit
 * is attacker-controlled in the threat that matters — the attacker is whoever
 * sent the user the file. A runner that assembled a command line out of circuit
 * data would be a general-purpose execution primitive reachable from an
 * imported file. So the command is chosen from this table, the circuit
 * contributes exactly one value (the workspace path, which Nexus derives and
 * never the user types), and `check:runner` fails the build if that stops being
 * true.
 *
 * The table is pure and imports nothing: no filesystem, no `node:path`, no
 * `node:crypto` — because the RENDERER imports this module too. The consent
 * screen's job is to print the literal command the runner will execute rather
 * than a description of it, and the only way for those two to be the same
 * string is for both sides to call {@link buildCommand}.
 *
 * **The Docker image is a network operation, and the only one.** Pulling
 * `RUNNER_IMAGE` contacts Docker Hub from the Docker daemon, not from Nexus —
 * which is why `check:egress` cannot see it and why the consent copy says so.
 * Everything else here runs entirely on the user's machine. See the image's
 * own comment for the pin.
 */

/**
 * The three profiles, in the order the panel offers them.
 *
 * A fourth member is a decision rather than an edit: DEV-007's revisit trigger
 * names „adding a fourth profile whose command is not fully determined by
 * source", and every one of these is determined by source plus the workspace
 * path.
 */
export const RUNNER_PROFILES = ["native", "wsl", "docker"] as const;

export type RunnerProfileId = (typeof RUNNER_PROFILES)[number];

/**
 * The Docker image, pinned by INDEX DIGEST and not by tag.
 *
 * `ros:humble-ros-base` is a mutable tag: it resolves to whatever the registry
 * serves that day, which means the thing executed on the user's machine is
 * chosen by Docker Hub rather than by this file. The digest below is the OCI
 * image INDEX, which is what makes the pin usable on more than one machine
 * shape — an index resolves to `linux/amd64` or `linux/arm64`, where a
 * per-platform digest would pin this app to one architecture.
 *
 * Verified by hand on 2026-09-22 against `registry-1.docker.io`: the
 * `docker-content-digest` header of `GET /v2/library/ros/manifests/humble-ros-base`
 * with an `Accept` of the index media types. Re-verify before changing it; do
 * not take a summarised answer for it, because a wrong digest is a runner that
 * cannot start at all.
 */
export const RUNNER_IMAGE =
  "ros:humble-ros-base@sha256:1813d3c85d7f96ff7d3012d865204583255740182db5d0065f8f8cd029a83138";

/**
 * The pinned image is a decision about DETERMINISM, not about trust.
 *
 * It makes the container the same for every user and every run; it does not
 * make the contents trustworthy, which is OSRF's build and is the thing the
 * user is trusting when they press the button. A later reader must not read
 * „digest" as „verified".
 *
 * And there is deliberately NO fallback to the tag. A pin that falls back is a
 * pin that a later „helpful" edit removes: if the digest is ever unavailable,
 * the honest answer is a failed run whose message says so.
 */

/**
 * The distributions Windows itself owns, which are never a place to build.
 *
 * `docker-desktop` and `docker-desktop-data` are in `wsl.exe -l -q`'s output on
 * every machine with Docker Desktop's WSL backend, and they are not the user's:
 * selecting one would start a distribution that has no business being started
 * and can never have a toolchain in it. This is a closed list in source, so it
 * is not user input being filtered — it is two known-internal names that are
 * not offered.
 */
const INTERNAL_DISTROS: readonly string[] = ["docker-desktop", "docker-desktop-data"];

/** Where the workspace is mounted inside the container, and the cwd the build runs in. */
export const CONTAINER_WORKSPACE = "/ws";

/**
 * The container's name, derived from the LAST SEGMENT of the workspace path.
 *
 * A name is what makes „did the stop stop it" answerable for the Docker profile
 * at all: `docker.exe` exiting on Windows leaves the container running, so
 * watching this process end would establish nothing. It comes from the path
 * rather than from the circuit id for the reason the whole file is written this
 * way — the path is already the one value the command line receives, so naming
 * the container from it adds no input, while naming it from the id would make
 * the command line depend on the circuit twice.
 *
 * The last segment is a hash this app derives, so the shape check below is a
 * statement about that derivation rather than about a user's input: a segment
 * that is not a name Docker would accept is refused, not escaped.
 */
export function containerName(workspace: string): string | null {
  const last = workspace.split(/[\\/]/).filter((part) => part !== "").pop() ?? "";
  const name = `nexus-${last}`;
  return /^[a-z0-9][a-z0-9_.-]*$/.test(name) ? name : null;
}

/**
 * Is the container still there? `--quiet` so the answer is an id or nothing,
 * and the filter anchored because Docker's `name` filter is a SUBSTRING match —
 * unanchored, a run of `nexus-a1b2` would also find `nexus-a1b2c3`.
 */
export function containerProbe(name: string): readonly string[] {
  return ["docker", "ps", "--quiet", "--filter", `name=^${name}$`];
}

/** Removing it, which is what makes „stopped" true rather than intended. */
export function containerRemove(name: string): readonly string[] {
  return ["docker", "rm", "--force", name];
}

/** The build every profile runs: the toolchain against the workspace, and nothing else. */
const BUILD = ["colcon", "build"] as const;

// ---------------------------------------------------------------------------
// Probes — what is installed, asked of the tool itself
// ---------------------------------------------------------------------------

/**
 * The probe per profile: a fixed argv whose EXIT STATUS is the answer.
 *
 * `--help` and `--version` rather than a PATH scan, because a PATH hit proves
 * that something with that name exists and not that it runs — and it is
 * `colcon --help` rather than `colcon --version` because the flag that is
 * documented for every one of these tools is the first, and an undocumented
 * flag is a probe that can fail for a reason that is not the tool's absence.
 */
export const RUNNER_PROBES: Readonly<Record<RunnerProfileId, readonly string[]>> = {
  native: ["colcon", "--help"],
  // The one profile with two questions: which distributions exist, and — once
  // the user has picked one — whether the toolchain is in it.
  wsl: ["wsl.exe", "-l", "-q"],
  // `docker version` and NOT `docker --version`.
  //
  // Measured, not reasoned about: on a machine with Docker Desktop installed
  // and its engine stopped, `docker --version` exits 0 with the client's
  // version while `docker version` exits 1 and says it cannot reach the API at
  // `npipe:////./pipe/dockerDesktopLinuxEngine`. Since Desktop does not start
  // its engine by default, a probe that answered „installed" would give the
  // user a panel that says the profile is ready and a run that fails on a pipe
  // error — which reads as a Nexus bug rather than as a stopped service.
  docker: ["docker", "version"],
};

/**
 * The second WSL question, for a distribution that came out of the first: does
 * the user's OWN shell have ROS in it?
 *
 * **`bash -ic`, and not `bash -lc`.** The chain, verified on a real
 * distribution: ROS's documented setup is
 * `echo "source /opt/ros/<distro>/setup.bash" >> ~/.bashrc`; Ubuntu's
 * `/etc/skel/.bashrc` — and every `~/.bashrc` derived from it — opens with
 * `case $- in *i*) ;; *) return;; esac`; and `bash -lc` here reports `$-` as
 * `hBc`, with no `i`, so that guard returns before the ROS line is ever
 * reached. A LOGIN shell is not an INTERACTIVE one, which is the whole trap:
 * `-lc` would report a correctly configured distribution as unusable, and the
 * user's own terminal — interactive — would work, with both answers „correct".
 *
 * `-i` is therefore the flag that makes this the same shell the user types in.
 * It costs some noise on stderr in environments with no terminal attached, and
 * the noise is left alone: it is the tool quoting itself, and a run that
 * silenced its own stderr would be hiding the errors that matter.
 *
 * `-e` (`--exec`) is not decoration either: without it `wsl.exe` joins the
 * remaining arguments into a command line and hands it to the distribution's
 * default shell. That is a command STRING built from argv, which is the one
 * shape this whole file exists to avoid — so every `wsl.exe` here carries `-e`.
 *
 * The script is a literal and never contains the workspace.
 */
export function wslProbe(distro: string): readonly string[] {
  return ["wsl.exe", "-d", distro, "-e", "bash", "-ic", 'echo "$ROS_DISTRO"'];
}

/** What a probe found. `detail` is a version when the tool prints one and null when it does not — never a guess. */
export type ProbeResult =
  | { readonly kind: "found"; readonly detail: string | null }
  | { readonly kind: "missing" }
  /** WSL's first question, which is answered with a list rather than a yes. */
  | { readonly kind: "distros"; readonly distros: readonly string[] };

/**
 * A version out of a banner line, or null.
 *
 * Deliberately lenient and deliberately allowed to fail: this is a LABEL in a
 * panel, not a fact anything acts on. `docker --version` prints one;
 * `colcon --help` prints a usage string with no version in it at all, and
 * inventing one — or writing „unknown" in a slot designed for a version — would
 * be worse than the empty slot.
 */
function versionIn(line: string): string | null {
  const found = /\bv?(\d+\.\d+(?:\.\d+)?)\b/.exec(line);
  return found?.[1] ?? null;
}

/**
 * Reading a probe whose answer is an exit status.
 *
 * `status` is null when the process never started — a tool that is not
 * installed makes `spawn` fail with `ENOENT` rather than exit non-zero — and
 * that is the same answer as a non-zero exit: not here.
 */
export function readStatusProbe(status: number | null, stdout: string): ProbeResult {
  if (status !== 0) return { kind: "missing" };
  const first = stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return { kind: "found", detail: first === undefined ? null : versionIn(first) };
}

/**
 * Reading `wsl.exe -l -q`: one distribution per line, minus Windows' own.
 *
 * The decoding happens before this — `wsl.exe` writes UTF-16LE, so a caller
 * that read its stdout as UTF-8 would see a NUL between every character and
 * find no distribution names at all. What arrives here is text.
 *
 * Names are trimmed and de-duplicated but kept verbatim otherwise: a
 * distribution's name is not an identifier this app may rewrite, because it is
 * the name `wsl.exe -d` will be asked for. The one exception is
 * {@link INTERNAL_DISTROS}, whose names Windows owns.
 */
export function readDistroList(stdout: string): readonly string[] {
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    const name = line.trim();
    if (name === "" || INTERNAL_DISTROS.includes(name)) continue;
    seen.add(name);
  }
  return [...seen];
}

/**
 * The ROS distribution a `wslProbe` answer names, or null.
 *
 * The name is taken from the FIRST line that looks like one, because the shell
 * it is read from runs the user's own `~/.bashrc` and that file is allowed to
 * print a banner before it says anything. Looks-like-one is a closed shape —
 * ROS names are lowercase letters, digits and underscores, and every one of
 * them (`foxy`, `humble`, `iron`, `jazzy`, `rolling`) fits — so this is a
 * validation and not a guess.
 *
 * An empty answer is the ordinary case and not an error: it means the user's
 * own shell has no ROS sourced, which is exactly the question being asked.
 */
export function rosDistroIn(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const name = line.trim();
    if (/^[a-z][a-z0-9_]*$/.test(name)) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The build — the one command line, and the two path grammars it crosses
// ---------------------------------------------------------------------------

/**
 * Why a profile could not be built into a command.
 *
 * These are not user errors — the workspace path is derived by Nexus and the
 * distribution comes out of a probe — so reaching one means something upstream
 * changed. They are refusals rather than throws for the reason `generateSketch`
 * gives: a caller with a `switch` is a caller that has to decide what the app
 * says, and an exception is that decision made badly and late.
 */
export type RunnerRefusal =
  | "path-not-absolute"
  /** Absolute, but not expressible in the grammar this profile's path has to cross — see {@link volumeSpec}. */
  | "path-not-representable"
  /** A distribution name out of a probe is data, and a leading dash would be an option to `wsl.exe`. */
  | "distro-leading-dash";

/** Which profile, and the distribution if that profile needs one. */
export type RunnerTarget =
  | { readonly profile: "native" }
  | { readonly profile: "wsl"; readonly distro: string }
  | { readonly profile: "docker" };

/**
 * The target a chosen profile names, or null when the choice is missing a value
 * it needs.
 *
 * This is the ONE place a stored id becomes a `RunnerTarget`, and it is here for
 * the reason {@link RunnerPlan}'s `container` is: the profile ids ARE the tools'
 * own names, so a caller that switched on them would have to spell one outside
 * this file — which `check:runner` fails the build for, and rightly, because a
 * file that can spell a tool's name is a file that can build a command out of
 * one. Every caller instead asks this function, and the only way it can say „not
 * yet" is `null`.
 *
 * It validates nothing else. A distribution's name came out of a probe, and a
 * name that has since been removed from the machine fails at the run, in
 * `wsl.exe`'s own words — a better sentence than anything this file could write
 * about a machine it cannot see.
 */
export function runnerTarget(
  profile: RunnerProfileId,
  distro: string | null,
): RunnerTarget | null {
  if (profile === "wsl") return distro === null ? null : { profile: "wsl", distro };
  return profile === "native" ? { profile: "native" } : { profile: "docker" };
}

/** A command line ready to spawn, or the reason there is not one. */
export type RunnerPlan =
  | {
      readonly kind: "command";
      /** `argv[0]` is the program. Every element is either a literal from this file or the workspace path. */
      readonly argv: readonly string[];
      readonly cwd: string;
      readonly workspace: string;
      /**
       * Whether running this reaches a registry on the first attempt.
       *
       * The only network operation in the module, and the consent screen says so
       * in a sentence of its own — which is why it is a fact the TABLE states
       * rather than one the caller infers. A caller asking „is this the docker
       * profile?" would have to spell a program name outside this file, and that
       * is precisely the edit {@link RunnerPlan}'s `container` exists to make
       * unnecessary.
       */
      readonly pullsImage: boolean;
      /**
       * The container this run names, for the one profile that has one.
       *
       * Carried on the plan rather than worked out again by the caller, and
       * that is a security property rather than tidiness: the profile ids ARE
       * the tools' own names („docker" is both), so a caller that asked „is
       * this the docker profile?" would have to spell a program name outside
       * this file — the one thing `check:runner` exists to prevent. Here the
       * caller asks the only question it needs, „is there a container?", and
       * the vocabulary stays in the table.
       */
      readonly container: string | null;
    }
  | { readonly kind: "refused"; readonly reason: RunnerRefusal };

/**
 * A path is absolute in either grammar, on either host.
 *
 * Hand-rolled rather than `node:path.isAbsolute`, because this module is
 * imported by the renderer and must not reach for a Node builtin — and because
 * the question here is genuinely the union: a Windows host derives `C:\…`, a
 * POSIX host derives `/…`, and which one this is cannot be decided by reading
 * `process.platform` in a module that also runs in a browser context.
 */
function isAbsolute(path: string): boolean {
  return /^([A-Za-z]:[\\/]|\\\\|\/)/.test(path);
}

/**
 * The guard on the one value that is data rather than a literal.
 *
 * A leading dash is REJECTED rather than escaped: it is an option to `colcon`,
 * to `docker` and to `wsl.exe` alike, and „this name starts with `-`" is not a
 * situation a name that came out of a probe can legitimately be in. Escaping it
 * would be the wrong repair twice over — it would make a name that cannot exist
 * look supported, and it would put the decision in the hands of whoever next
 * edits the assembly.
 *
 * The WORKSPACE needs no such guard, and that is worth saying because the
 * threat model asks for one. T2 names a leading `-` as the way argument
 * injection can still enter; for a path it cannot, because a path beginning
 * with a dash is not absolute and {@link buildCommand} refuses it two lines
 * earlier. A distribution's name is not a path and has no such structural
 * cover, which is exactly why it is this function's only caller.
 */
function refuseValue(value: string, dash: RunnerRefusal): RunnerRefusal | null {
  if (value.startsWith("-")) return dash;
  return null;
}

/**
 * The Docker `-v` argument for the workspace.
 *
 * `-v` is a grammar of its own — `host:container`, with any further colon
 * introducing an option — so a host path containing a colon (beyond its drive
 * letter) or a comma cannot be expressed in it, and the honest answer is to
 * refuse rather than to escape and hope. Backslashes are turned into forward
 * slashes, which is what the Docker CLI documents for Windows hosts.
 */
function volumeSpec(hostPath: string): string | null {
  const body = hostPath.replace(/^([A-Za-z]):/, "$1");
  if (body.includes(":") || body.includes(",")) return null;
  return `${hostPath.split("\\").join("/")}:${CONTAINER_WORKSPACE}`;
}

/**
 * The command line for a target and a workspace, or the reason there is not one.
 *
 * **The workspace path is the only value any of these three receives**, and it
 * arrives as one argv element (or, for Docker's `-v`, inside one) rather than
 * as text spliced into a command string. That is the property the whole slice
 * rests on: with no shell in the spawn, an argv element cannot be split, an
 * option cannot be introduced through a space, and the only way to inject
 * anything is to begin with a dash — which {@link refuseValue} rejects.
 *
 * Each profile also gets its own hardening, and each is why the profile exists
 * as a profile rather than as a field:
 *
 * - **native** runs `colcon` directly, with the workspace as the process's
 *   working directory. No path appears in its argv at all.
 * - **wsl** runs it in the distribution the user picked out of the probe's own
 *   output, through an INTERACTIVE shell (`-ic`, see {@link wslProbe}) so the
 *   user's own `source …/setup.bash` is read, with the path going in through
 *   `--cd`. Not a login shell: `-lc` reports `$-` without an `i`, and Ubuntu's
 *   `.bashrc` returns early on exactly that test.
 * - **docker** runs it in the pinned image, mounting the workspace and nothing
 *   else, with `--network none`: the build needs no network, the container
 *   therefore has none, and a build that quietly did reach for one fails
 *   loudly instead of succeeding here and not on the user's own machine. It
 *   also NAMES the container, because a container outlives the CLI that started
 *   it — without a name there is nothing to ask about, and „stopped" would be a
 *   claim about `docker.exe` rather than about the work.
 */
export function buildCommand(target: RunnerTarget, workspace: string): RunnerPlan {
  if (!isAbsolute(workspace)) return { kind: "refused", reason: "path-not-absolute" };

  if (target.profile === "native") {
    return {
      kind: "command",
      argv: [...BUILD],
      cwd: workspace,
      workspace,
      pullsImage: false,
      container: null,
    };
  }

  if (target.profile === "wsl") {
    const named = refuseValue(target.distro, "distro-leading-dash");
    if (named !== null) return { kind: "refused", reason: named };
    // `--cd` takes the Windows path AS IT IS: `wsl.exe` translates it itself,
    // which is the flag's own documented behaviour, and a second translation
    // here would be an implementation of the `/mnt` automount assumption — a
    // thing `/etc/wsl.conf` exists to change. A workspace that is not on a
    // drive letter at all is refused, because that is a UNC path, and a UNC
    // path names a location INSIDE a distribution while the workspace is on
    // this side of the boundary.
    if (!/^[A-Za-z]:[\\/]/.test(workspace)) {
      return { kind: "refused", reason: "path-not-representable" };
    }
    return {
      kind: "command",
      argv: ["wsl.exe", "-d", target.distro, "--cd", workspace, "-e", "bash", "-ic", "exec colcon build"],
      cwd: workspace,
      workspace,
      pullsImage: false,
      container: null,
    };
  }

  const volume = volumeSpec(workspace);
  const name = containerName(workspace);
  if (volume === null || name === null) return { kind: "refused", reason: "path-not-representable" };
  return {
    kind: "command",
    argv: [
      "docker",
      "run",
      "--rm",
      "--network",
      "none",
      "--name",
      name,
      "-v",
      volume,
      "-w",
      CONTAINER_WORKSPACE,
      RUNNER_IMAGE,
      ...BUILD,
    ],
    cwd: workspace,
    workspace,
    // The image is pulled from Docker Hub the first time, from the daemon and
    // not from this app — the one network operation in the module, and the
    // sentence the consent screen owes the user.
    pullsImage: true,
    container: name,
  };
}

// ---------------------------------------------------------------------------
// Output — untrusted text, and a cap that does not lie about itself
// ---------------------------------------------------------------------------

const ESC = String.fromCharCode(0x1b);

/**
 * The escape sequences a build's output can carry: OSC (window titles, the
 * eight-bit hyperlinks `pip` prints) and CSI (colour, cursor movement), then
 * the two-character sequences that are neither.
 *
 * Ordered, because an OSC payload may contain anything but a terminator and
 * stripping CSI first would leave the payload's own escapes behind.
 */
const OSC = new RegExp(`${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)`, "g");
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const OTHER_ESC = new RegExp(`${ESC}[@-Z\\\\^_]`, "g");

/**
 * Every remaining C0 character except the newline and the tab, and every C1
 * character — built from character codes so that no raw control byte is ever
 * carried by this file.
 */
function controlChars(): RegExp {
  let chars = "";
  for (let code = 0; code <= 0x1f; code += 1) {
    if (code === 0x0a || code === 0x09) continue;
    chars += String.fromCharCode(code);
  }
  for (let code = 0x7f; code <= 0x9f; code += 1) chars += String.fromCharCode(code);
  return new RegExp(`[${chars}]`, "g");
}

const CONTROLS = controlChars();

/**
 * One chunk of a child's output as text that is safe to put in front of a user.
 *
 * A build can print anything, including the bytes that would move a cursor,
 * rewrite a line, or set a window title. The renderer draws this as TEXT, so
 * there is no markup to inject into — but a log that can erase its own lines is
 * a log the user cannot trust to be the whole story, and a terminal escape is
 * also the cheapest way to make a wall of output look like it says something it
 * does not.
 *
 * A carriage return becomes a line break rather than nothing, because a tool
 * that draws a progress bar by returning to column zero would otherwise produce
 * one line of interleaved percentages — a rendering artefact that reads as
 * corruption.
 */
export function outputText(chunk: string): string {
  return chunk
    .replace(/\r\n?/g, "\n")
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(OTHER_ESC, "")
    .replace(CONTROLS, "");
}

/**
 * How much of a run's output is kept.
 *
 * A `colcon build` prints a few kilobytes. This is two orders of magnitude of
 * headroom, and it exists because the thing on the other end of the pipe is a
 * toolchain printing as fast as it can for as long as it likes.
 */
export const LOG_CAP_BYTES = 256 * 1024;

/** One chunk, with the size it was measured at when it arrived. */
interface LogChunk {
  readonly text: string;
  readonly bytes: number;
}

/**
 * The captured output of a run.
 *
 * Kept as the chunks it arrived in rather than as one string, so that dropping
 * the oldest output to stay inside the cap is a shift rather than a slice of a
 * string that has to be rebuilt every time. Main and the renderer both hold one
 * of these and both use these functions: the renderer needs the cap for exactly
 * the same reason main does, and two implementations of it would disagree the
 * first time either moved.
 */
export interface RunnerLog {
  readonly chunks: readonly LogChunk[];
  readonly bytes: number;
  /**
   * True once output was dropped. The log is then a WINDOW on the run — the
   * latest output, with the earliest gone — and the UI says so.
   *
   * The alternative was keeping the FIRST `LOG_CAP_BYTES` and reporting the run
   * as complete, which is the failure this flag exists to prevent: a build's
   * errors are at its end, so a head-first cap keeps the one part of the log
   * nobody reads and throws away the part they need.
   */
  readonly truncated: boolean;
}

export const EMPTY_LOG: RunnerLog = { chunks: [], bytes: 0, truncated: false };

/** What a chunk costs, measured once at the door. */
function measure(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Appends a chunk, dropping the oldest whole chunks until the cap holds again.
 *
 * Whole chunks rather than a byte offset into a string: a slice at an arbitrary
 * byte boundary can cut a character in half, and a log whose first visible line
 * is a lone replacement character looks like a decoding bug in the app rather
 * than a truncation the app is reporting.
 */
export function appendLog(log: RunnerLog, chunk: string): RunnerLog {
  const text = outputText(chunk);
  if (text === "") return log;

  const chunks = [...log.chunks, { text, bytes: measure(text) }];
  let bytes = log.bytes + (chunks[chunks.length - 1]?.bytes ?? 0);
  let truncated = log.truncated;
  let first = 0;
  while (bytes > LOG_CAP_BYTES && chunks.length - first > 1) {
    bytes -= chunks[first]?.bytes ?? 0;
    first += 1;
    truncated = true;
  }
  return { chunks: first === 0 ? chunks : chunks.slice(first), bytes, truncated };
}

/** The log as one string, for a renderer that draws it in a `<pre>`. */
export function logText(log: RunnerLog): string {
  return log.chunks.map((chunk) => chunk.text).join("");
}
