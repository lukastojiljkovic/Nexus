import { describe, expect, it } from "vitest";

import {
  appendLog,
  buildCommand,
  CONTAINER_WORKSPACE,
  containerName,
  containerProbe,
  containerRemove,
  EMPTY_LOG,
  LOG_CAP_BYTES,
  logText,
  outputText,
  readDistroList,
  readStatusProbe,
  rosDistroIn,
  RUNNER_IMAGE,
  RUNNER_PROBES,
  RUNNER_PROFILES,
  wslProbe,
  type RunnerTarget,
} from "./runner.js";

/**
 * What these tests are FOR, in one sentence: the command line must be a
 * function of the table and the workspace path, and of nothing else.
 *
 * The workspace is the only value in an argv that is not a literal in
 * `runner.ts`, so the sharpest cases below are the ones that prove it stays a
 * single element — never spliced into a command string, never accompanied by
 * anything derived from a circuit — and that a path which cannot be expressed
 * in a profile's own grammar is refused rather than escaped.
 */

const WINDOWS = "C:\\Users\\Luka Fajlovi\\AppData\\Roaming\\Nexus\\elec-run\\a1b2c3d4";
/** A second host path of the same shape, for the cases that ask what CHANGES when the path does. */
const WINDOWS_2 = "C:\\Users\\Luka Fajlovi\\AppData\\Roaming\\Nexus\\elec-run\\f9e8d7c6";
const POSIX = "/home/luka/.config/Nexus/elec-run/a1b2c3d4";

const NATIVE: RunnerTarget = { profile: "native" };
const WSL: RunnerTarget = { profile: "wsl", distro: "Ubuntu-22.04" };
const DOCKER: RunnerTarget = { profile: "docker" };

/** The argv of a plan that is expected to be a command — fails loudly rather than narrowing every test. */
function argvOf(target: RunnerTarget, workspace: string): readonly string[] {
  const plan = buildCommand(target, workspace);
  if (plan.kind !== "command") throw new Error(`refused: ${plan.reason}`);
  return plan.argv;
}

describe("the table", () => {
  it("has a probe for every profile and no profile without one", () => {
    expect(Object.keys(RUNNER_PROBES).sort()).toEqual([...RUNNER_PROFILES].sort());
  });

  it("pins the Docker image by digest, because a tag is chosen by the registry", () => {
    // The SHAPE rather than the value: the value is verified against the
    // registry by hand (see the constant's comment), and a test that pinned it
    // would have to be edited by whoever bumps it — which is the one edit that
    // must not be silent.
    expect(RUNNER_IMAGE).toMatch(/^ros:[a-z0-9-]+@sha256:[0-9a-f]{64}$/);
  });

  it("probes the Docker ENGINE and not the client, which answers with the engine stopped", () => {
    // Measured, and the reason the probe is `version` rather than `--version`:
    // with Docker Desktop installed and its engine stopped, `docker --version`
    // exits 0 and prints the client's version, while `docker version` exits 1
    // and names the pipe it could not reach. A probe that reported „installed"
    // there would give the user a panel that says the profile is ready and a
    // run that fails on a socket error.
    expect(RUNNER_PROBES.docker).toEqual(["docker", "version"]);
  });
});

describe("the native command", () => {
  it("is the toolchain and nothing else — the path is a working directory, not an argument", () => {
    // The strongest form of the property the slice rests on: for `native`
    // there is no data in the argv AT ALL, on any host.
    const argv = argvOf(NATIVE, WINDOWS);
    expect(argv).toEqual(["colcon", "build"]);
    expect(argvOf(NATIVE, POSIX)).toEqual(argv);
  });

  it("runs in the workspace, which is what tells colcon where the package is", () => {
    const plan = buildCommand(NATIVE, WINDOWS);
    expect(plan.kind === "command" && plan.cwd).toBe(WINDOWS);
  });
});

describe("the wsl command", () => {
  it("carries `-e`, because without it wsl.exe joins the arguments into a command string", () => {
    // The trap this asserts against: `wsl.exe -d X colcon build` builds a shell
    // command line out of its arguments. Every element here is a literal today,
    // so nothing is injectable today — and a later edit that added an element
    // from anywhere would be injectable without `-e`. The flag is the thing
    // that makes the argv an argv.
    const argv = argvOf(WSL, WINDOWS);
    expect(argv).toContain("-e");
    expect(argv.indexOf("-e")).toBeLessThan(argv.indexOf("bash"));
  });

  it("hands the path to `--cd` in the HOST's own spelling, because wsl.exe translates it", () => {
    // There is no `/mnt` translation here, and its absence is a decision rather
    // than an oversight. `--cd` is documented to accept a Windows path and
    // translate it itself, so a second translation in this file would be an
    // implementation of the AUTOMOUNT assumption — the thing `/etc/wsl.conf`
    // exists to change, and a machine that moved its mounts would get a build
    // in the wrong directory rather than an error.
    const argv = argvOf(WSL, WINDOWS);
    expect(argv[argv.indexOf("--cd") + 1]).toBe(WINDOWS);
    expect(argv.join(" ")).not.toContain("/mnt/");
  });

  it("leaves the distribution's name exactly as the probe spelled it", () => {
    expect(argvOf(WSL, WINDOWS)).toContain("Ubuntu-22.04");
  });

  it("hands the shell a literal script, so the workspace never enters a shell string", () => {
    // The one element a shell parses is the script, and it must be a constant:
    // if a workspace path could reach it, quoting would become the only thing
    // between a directory name and a command. `exec` so that the process the
    // app watches IS the build rather than a shell waiting on it.
    const [a, b] = [argvOf(WSL, WINDOWS), argvOf(WSL, WINDOWS_2)];
    const scriptAt = a.indexOf("bash") + 2;
    expect(a[scriptAt]).toBe("exec colcon build");
    expect(b[scriptAt]).toBe("exec colcon build");
  });

  it("refuses a distribution whose name begins with a dash rather than escaping it", () => {
    expect(buildCommand({ profile: "wsl", distro: "--install" }, WINDOWS)).toEqual({
      kind: "refused",
      reason: "distro-leading-dash",
    });
  });

  it("refuses a UNC workspace, which names a place inside a distribution and not on the host", () => {
    expect(buildCommand(WSL, "\\\\wsl$\\Ubuntu\\home\\luka\\ws")).toEqual({
      kind: "refused",
      reason: "path-not-representable",
    });
  });

  it("refuses a POSIX workspace, because there is no wsl.exe on a host that spells paths that way", () => {
    expect(buildCommand(WSL, POSIX)).toEqual({ kind: "refused", reason: "path-not-representable" });
  });

  it("asks the distribution for ROS through an INTERACTIVE shell, because a login shell never reads .bashrc's ROS line", () => {
    // `-ic` and not `-lc`, and this is the whole of why. ROS's documented setup
    // appends `source /opt/ros/<distro>/setup.bash` to `~/.bashrc`; Ubuntu's
    // skeleton `.bashrc` — and every file derived from it — opens with
    // `case $- in *i*) ;; *) return;; esac`; and a `-lc` shell reports `$-` as
    // `hBc`, with no `i`, so that guard returns before the ROS line is reached.
    // A login shell would therefore call a correctly configured distribution
    // unusable while the user's own terminal — interactive — worked, and both
    // answers would be „right".
    expect(wslProbe("Ubuntu-22.04")).toEqual([
      "wsl.exe",
      "-d",
      "Ubuntu-22.04",
      "-e",
      "bash",
      "-ic",
      'echo "$ROS_DISTRO"',
    ]);
  });
});

describe("the docker command", () => {
  it("mounts the workspace read-write, at the cwd, and nothing else", () => {
    const argv = argvOf(DOCKER, WINDOWS);
    const spelled = WINDOWS.split("\\").join("/");
    expect(argv).toContain(`${spelled}:${CONTAINER_WORKSPACE}`);
    expect(argv[argv.indexOf("-w") + 1]).toBe(CONTAINER_WORKSPACE);
    // One mount, and it is the workspace. A second `-v` would be a second thing
    // the container can write to — the Docker socket and the user's home are
    // the two that matter, and neither can be named by anything in this file.
    expect(argv.filter((element) => element === "-v")).toHaveLength(1);
    // And the workspace reaches exactly ONE element, which is the mount. The
    // build itself is a literal, so nothing about the directory appears in the
    // command the container is asked to run.
    expect(argv.filter((element) => element.includes(spelled))).toHaveLength(1);
  });

  it("gives the container no network, because a build does not need one", () => {
    const argv = argvOf(DOCKER, WINDOWS);
    expect(argv[argv.indexOf("--network") + 1]).toBe("none");
  });

  it("names the container after the workspace, so the stop path has something to ask about", () => {
    // Derived from the path and not from the circuit id: the path is already
    // the one value the command line receives, so this adds no second input.
    const argv = argvOf(DOCKER, WINDOWS);
    expect(argv[argv.indexOf("--name") + 1]).toBe("nexus-a1b2c3d4");
    expect(containerName(WINDOWS)).toBe("nexus-a1b2c3d4");
  });

  it("turns any last segment into a name, and never into an option", () => {
    // The `nexus-` prefix is what makes that true: a segment of `--rm` becomes
    // `nexus---rm`, which Docker reads as a name because it no longer starts
    // with a dash. A directory whose PARENT holds a space is the ordinary case
    // and does not reach the name at all — only the last segment does.
    expect(containerName("C:\\ws\\--rm")).toBe("nexus---rm");
    expect(containerName("C:\\Users\\Luka Fajlovi\\ws")).toBe("nexus-ws");
    expect(containerName("C:\\ws\\")).toBe("nexus-ws");
  });

  it("refuses a segment Docker would not take as a name, rather than escaping it", () => {
    expect(containerName("/ws/$weird")).toBeNull();
    expect(containerName("/ws/a b")).toBeNull();
    expect(buildCommand(DOCKER, "C:\\ws\\a b")).toEqual({
      kind: "refused",
      reason: "path-not-representable",
    });
  });

  it("answers about its OWN container, with the filter anchored", () => {
    // Docker's `name` filter is a substring match, so an unanchored filter for
    // `nexus-a1b2` would also find `nexus-a1b2c3` — a different circuit's run,
    // and a stop that would then report on the wrong thing.
    expect(containerProbe("nexus-a1b2c3d4")).toEqual([
      "docker",
      "ps",
      "--quiet",
      "--filter",
      "name=^nexus-a1b2c3d4$",
    ]);
    expect(containerRemove("nexus-a1b2c3d4")).toEqual([
      "docker",
      "rm",
      "--force",
      "nexus-a1b2c3d4",
    ]);
  });

  it("removes the container when it exits, so a stopped run leaves nothing behind", () => {
    expect(argvOf(DOCKER, WINDOWS)).toContain("--rm");
  });

  it("refuses a host path it cannot express in -v's grammar, rather than escaping it", () => {
    // `-v` is `host:container` with any further colon introducing an option, so
    // a path with one in it cannot be spelled. The refusal is the honest
    // answer: escaping would produce a mount of something other than the
    // workspace, which is the failure T4 is about.
    expect(buildCommand(DOCKER, "C:\\Users\\a:b\\ws")).toEqual({
      kind: "refused",
      reason: "path-not-representable",
    });
    expect(buildCommand(DOCKER, "C:\\Users\\a,b\\ws")).toEqual({
      kind: "refused",
      reason: "path-not-representable",
    });
  });

  it("accepts a POSIX host, because the app is an Electron app and not a Windows one", () => {
    expect(argvOf(DOCKER, POSIX)).toContain(`${POSIX}:${CONTAINER_WORKSPACE}`);
  });
});

describe("what the plan says about the run, so no caller has to ask", () => {
  it("names the container only for the profile that has one, and names it the same one the argv does", () => {
    // The security property rather than a convenience. The profile ids ARE the
    // tools' own names — `docker` is both — so a caller asking „is this the
    // docker profile?" has to spell a program name outside the table, and
    // `check:runner` fails the build when one does. Carrying the name here means
    // the spawn site asks the only question it needs: is there a container?
    //
    // The two must also AGREE, which is why this compares them rather than
    // asserting each separately: a plan whose `container` disagreed with its
    // `--name` would leave the stop path asking about a container nobody
    // started.
    for (const target of [NATIVE, WSL]) {
      const plan = buildCommand(target, WINDOWS);
      if (plan.kind !== "command") throw new Error("expected a command");
      expect(plan.container, target.profile).toBeNull();
    }
    const docker = buildCommand(DOCKER, WINDOWS);
    if (docker.kind !== "command") throw new Error("expected a command");
    expect(docker.container).toBe("nexus-a1b2c3d4");
    expect(docker.argv[docker.argv.indexOf("--name") + 1]).toBe(docker.container);
  });

  it("says which profile reaches a registry, so the consent copy can say so too", () => {
    const pulls = [NATIVE, WSL, DOCKER].map((target) => {
      const plan = buildCommand(target, WINDOWS);
      if (plan.kind !== "command") throw new Error("expected a command");
      return [target.profile, plan.pullsImage] as const;
    });
    // Exactly one, and it is the one whose image is pulled from Docker Hub —
    // from the daemon and not from this app, which is why `check:egress` cannot
    // see it and why the consent screen has to say it in a sentence.
    expect(pulls.filter(([, image]) => image).map(([profile]) => profile)).toEqual(["docker"]);
  });
});

describe("the workspace is the only value in any argv", () => {
  it("refuses a path that is not absolute", () => {
    for (const target of [NATIVE, WSL, DOCKER]) {
      expect(buildCommand(target, "elec-run/a1b2")).toEqual({
        kind: "refused",
        reason: "path-not-absolute",
      });
      expect(buildCommand(target, "")).toEqual({ kind: "refused", reason: "path-not-absolute" });
    }
  });

  it("refuses a path beginning with a dash, which is an option to all three tools", () => {
    // The threat model's T2, and the reason it needs no separate guard: a path
    // that begins with a dash is not absolute, so it never reaches an element.
    expect(buildCommand(DOCKER, "-v-evil")).toEqual({
      kind: "refused",
      reason: "path-not-absolute",
    });
  });

  it("changes NOTHING but the path when the path changes", () => {
    // The property behind every case above, stated exactly: take a command,
    // rename the workspace's last segment, and the result is the OTHER command.
    // Anything derived from anywhere else — a circuit, a clock, a store —
    // would survive that renaming and show up here.
    //
    // Two elements move for `docker` (the mount and the container's name) and
    // one for `wsl` (the `--cd` directory), which is why the test renames
    // rather than counting: what matters is that the rename is a COMPLETE
    // account of the difference.
    for (const target of [NATIVE, WSL, DOCKER]) {
      const a = argvOf(target, WINDOWS);
      const b = argvOf(target, WINDOWS_2);
      expect(a).toHaveLength(b.length);
      const renamed = a.map((element) => element.split("a1b2c3d4").join("f9e8d7c6"));
      expect(renamed, `${target.profile} differs outside its path`).toEqual(b);
    }
  });

  it("gives `native` two commands that are identical on any host, because it has no path in its argv", () => {
    expect(argvOf(NATIVE, WINDOWS)).toEqual(argvOf(NATIVE, POSIX));
  });
});

describe("reading a probe", () => {
  it("takes an exit status of zero as present, and a version when the tool prints one", () => {
    expect(readStatusProbe(0, "Docker version 27.3.1, build 9e34c9b\n")).toEqual({
      kind: "found",
      detail: "27.3.1",
    });
  });

  it("says found with no version rather than inventing one", () => {
    // `colcon --help` prints a usage string and no version at all, and a panel
    // that put „unknown" in a slot designed for a version would be showing the
    // user a fact about the parser instead of about their machine.
    expect(readStatusProbe(0, "usage: colcon [-h] ...\n")).toEqual({ kind: "found", detail: null });
    expect(readStatusProbe(0, "")).toEqual({ kind: "found", detail: null });
  });

  it("takes a non-zero exit and a process that never started as the same answer", () => {
    // `ENOENT` is not an exit status — a tool that is not installed makes
    // `spawn` fail — so the caller passes null, and it means what a failure to
    // run means: not here.
    expect(readStatusProbe(1, "")).toEqual({ kind: "missing" });
    expect(readStatusProbe(null, "")).toEqual({ kind: "missing" });
    expect(readStatusProbe(null, "Docker version 27.3.1")).toEqual({ kind: "missing" });
  });

  it("reads wsl.exe's distribution list as names, keeping the case the probe used", () => {
    // The names are what `-d` will be asked for. Trimming is safe; rewriting is
    // not, and this is the reason the reader does no more than trim.
    expect(readDistroList("Ubuntu-22.04\r\nUbuntu\r\n\r\n  Debian  \n")).toEqual([
      "Ubuntu-22.04",
      "Ubuntu",
      "Debian",
    ]);
    expect(readDistroList("")).toEqual([]);
    expect(readDistroList("\u0000")).toEqual(["\u0000"]);
  });

  it("drops a duplicated name, because two rows of one distribution is a choice the user cannot make", () => {
    expect(readDistroList("Ubuntu\nUbuntu\nkali-linux")).toEqual(["Ubuntu", "kali-linux"]);
  });

  it("drops the distributions Windows owns, which are on every machine with Docker Desktop", () => {
    // `docker-desktop` and `docker-desktop-data` are WSL distributions that
    // exist to run Docker's own backend. They are not the user's, they can
    // never have a toolchain in them, and offering one would start a service
    // the user did not ask for — so the filter is a closed list in source and
    // not an attempt to guess from a name.
    expect(readDistroList("Ubuntu\ndocker-desktop\ndocker-desktop-data\nDebian")).toEqual([
      "Ubuntu",
      "Debian",
    ]);
  });

  it("reads a ROS distribution out of an interactive shell's answer, or nothing", () => {
    // The shell this is read from runs the user's own `~/.bashrc`, so the first
    // line may be a banner rather than the answer — which is why the reader
    // takes the first line that LOOKS like a ROS name instead of the first line
    // it sees, and why it is a validation rather than a guess.
    expect(rosDistroIn("humble\n")).toBe("humble");
    expect(rosDistroIn("Welcome to Ubuntu 22.04 LTS\nhumble\n")).toBe("humble");
    expect(rosDistroIn("rolling\r\n")).toBe("rolling");
  });

  it("answers null for an empty one, which is the question rather than an error", () => {
    // No ROS sourced in the user's shell is the ordinary case this probe exists
    // to detect: the distribution is present and cannot build, and the panel
    // has to be able to say that without calling the machine broken.
    expect(rosDistroIn("")).toBeNull();
    expect(rosDistroIn("bash: cannot set terminal process group: no such job\n")).toBeNull();
    // A name that is not a ROS distribution name is not one, whatever else it
    // is — the shape is the check.
    expect(rosDistroIn("/opt/ros/humble/setup.bash")).toBeNull();
    expect(rosDistroIn("ROS_DISTRO\n")).toBeNull();
  });
});

describe("output", () => {
  it("strips the sequences that would let a build repaint the panel", () => {
    expect(outputText("\u001b[31mERROOOR\u001b[0m\n")).toBe("ERROOOR\n");
    expect(outputText("\u001b[2K\u001b[1Gdone")).toBe("done");
  });

  it("strips an OSC sequence ended either way, and the lone two-character escapes", () => {
    expect(outputText("\u001b]0;a title\u0007text")).toBe("text");
    expect(outputText("\u001b]8;;http://example.com\u001b\\link\u001b]8;;\u001b\\")).toBe("link");
    expect(outputText("a\u001bMb")).toBe("ab");
  });

  it("turns a carriage return into a line break, because a progress bar is not one line", () => {
    // Deleting the carriage return would splice the percentages into a line
    // that reads as corruption rather than as progress.
    expect(outputText("10%\r20%\r\n100%\n")).toBe("10%\n20%\n100%\n");
  });

  it("removes control characters but keeps the tab, the newline and every visible character", () => {
    expect(outputText("a\u0000\u0007b\tšđčćž\n🙂")).toBe("ab\tšđčćž\n🙂");
  });

  it("leaves text that carries no escapes exactly as it was", () => {
    const line = "Starting >>> wiring\nFinished <<< wiring [1.2s]\n";
    expect(outputText(line)).toBe(line);
  });
});

describe("the log", () => {
  it("appends, measures and joins", () => {
    const log = appendLog(appendLog(EMPTY_LOG, "one\n"), "two\n");
    expect(logText(log)).toBe("one\ntwo\n");
    expect(log.bytes).toBe(8);
    expect(log.truncated).toBe(false);
  });

  it("drops nothing when the chunk is only escapes", () => {
    expect(appendLog(EMPTY_LOG, "\u001b[0m")).toEqual(EMPTY_LOG);
  });

  it("drops the OLDEST output first, and says that it did", () => {
    // The end of a build log is the half that matters — the error is the last
    // thing printed. A cap that kept the first N bytes would keep the banner
    // and throw away the failure, and would still call the run complete.
    const chunk = "x".repeat(64 * 1024);
    let log = EMPTY_LOG;
    for (let i = 0; i < 6; i += 1) log = appendLog(log, `${String(i)}${chunk}`);

    expect(log.truncated).toBe(true);
    expect(log.bytes).toBeLessThanOrEqual(LOG_CAP_BYTES);
    expect(logText(log)).not.toContain("0x");
    expect(logText(log)).toContain("5x");
  });

  it("keeps one chunk even when that chunk alone is over the cap", () => {
    // A chunk is what the pipe delivered, and there is no smaller unit to fall
    // back to. Dropping the last one would leave an empty log that reports
    // itself as truncated rather than as having seen nothing.
    const log = appendLog(EMPTY_LOG, "y".repeat(LOG_CAP_BYTES + 1));
    expect(logText(log)).toHaveLength(LOG_CAP_BYTES + 1);
    expect(log.bytes).toBeGreaterThan(LOG_CAP_BYTES);
  });

  it("counts BYTES and not characters, because the cap bounds memory", () => {
    const log = appendLog(EMPTY_LOG, "š".repeat(10));
    expect(logText(log)).toHaveLength(10);
    expect(log.bytes).toBe(20);
  });

  it("never counts the bytes of a chunk it dropped", () => {
    const chunk = "z".repeat(64 * 1024);
    let log = EMPTY_LOG;
    for (let i = 0; i < 6; i += 1) log = appendLog(log, chunk);
    expect(log.chunks.reduce((sum, part) => sum + part.bytes, 0)).toBe(log.bytes);
  });
});
