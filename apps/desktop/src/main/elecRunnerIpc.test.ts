import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Circuit } from "@nexus/core";
import type { ElecSettings, ElecSettingsChanges } from "@nexus/db";

import { createElecRunnerIpc, type ElecRunnerIpcDeps } from "./elecRunnerIpc.js";
import { runnerWorkspacePath } from "./elecWorkspace.js";
import type { ElecRunner, RunRequest, StartOutcome } from "./elecRunner.js";
import type { RunnerState, RunnerStopState } from "../shared/ipc.js";

/**
 * What these tests are FOR, in one sentence: the layer that turns a stored
 * switch into a process must refuse everything it is supposed to refuse, and
 * must hand the runner the same command the user was shown.
 *
 * That second half is the one that is invisible to every other instrument in
 * the tree. The consent screen prints `plan`'s argv and the run spawns `start`'s
 * argv, and they are the same string only because they are the same call to
 * `buildCommand` — a property no type can state and no screenshot can show, so
 * it is asserted here by running both and comparing.
 *
 * The runner is a RECORDING STUB rather than the real one: this module's whole
 * job is to decide whether to call it and what to call it with, and a test that
 * drove the real runner would be testing `elecRunner.test.ts` a second time.
 */

/**
 * A circuit with exactly one placed board — the whole of what the generator
 * needs to say yes or no, since `soleBoard` reads the parts.
 *
 * The board is the Pi 4 and not an Arduino on purpose: `programming: "linux"` is
 * what makes it a ROS 2 machine, and the other half of these tests drives the
 * Arduino, which is the ONE refusal the generator makes about the board itself.
 */
function circuit(board = "raspberry-pi-4b"): Circuit {
  return {
    id: "kolo-1",
    name: "Stanica za vlažnost",
    notes: "",
    board,
    parts: [
      {
        id: "p1",
        circuitId: "kolo-1",
        componentId: board,
        label: "",
        x: 0,
        y: 0,
        rotation: 0,
      },
    ],
    wires: [],
  } as unknown as Circuit;
}

/** A board that runs a sketch and not a Linux: the generator's `not-ros` refusal, which this layer reports as `no-package`. */
function sketchOnly(): Circuit {
  return circuit("arduino-uno");
}

interface Recorded {
  planned: { argv: readonly string[]; workspace: string }[];
  started: RunRequest[];
  detected: number;
  stopped: string[];
  disposed: number;
}

let recorded: Recorded;
let stored: ElecSettings;
let writes: ElecSettingsChanges[];
/** What the runner answers with. Set per test. */
let startAnswer: StartOutcome;
let held: ElecSettings;

function fakeRunner(): ElecRunner {
  return {
    detect() {
      recorded.detected += 1;
      return Promise.resolve([]);
    },
    plan(target, workspace) {
      // The REAL shape of the answer, built the way `elecRunner.plan` builds it:
      // the argv of the closed table plus the cwd it runs in.
      const argv = target.profile === "native" ? ["colcon", "build"] : ["wsl.exe", "build"];
      recorded.planned.push({ argv, workspace });
      return {
        kind: "command",
        argv: [...argv],
        cwd: workspace,
        workspace,
        pullsImage: false,
      };
    },
    start(request) {
      recorded.started.push(request);
      return startAnswer;
    },
    stop(profileId) {
      recorded.stopped.push(profileId);
      return Promise.resolve<RunnerStopState>("exited");
    },
    state(): RunnerState {
      return { phase: "idle", run: null, last: null };
    },
    dispose() {
      recorded.disposed += 1;
    },
  };
}

/** The store's own merge, so `enable`/`choice` can be asserted on the state they leave behind. It states no rules of its own. */
function save(_profileId: string, changes: ElecSettingsChanges, _now: string): ElecSettings {
  writes.push(changes);
  held = {
    enabled: changes.enabled ?? held.enabled,
    choice: changes.choice === undefined ? held.choice : changes.choice,
    distro: changes.distro === undefined ? held.distro : changes.distro,
    consentedAt: changes.consentedAt === undefined ? held.consentedAt : changes.consentedAt,
  };
  return held;
}

let accountDir: string;
let reads: number;

/**
 * Seeds a stored state, in BOTH places it has to exist.
 *
 * `stored` is what `settings()` answers; `held` is what the fake `save` merges
 * over, because the real store merges over the ROW and a test that seeded only
 * the read would be asserting on a write starting from an empty one.
 */
function seed(settings: ElecSettings): void {
  stored = settings;
  held = { ...settings };
}

const ON: ElecSettings = {
  enabled: true,
  choice: "native",
  distro: null,
  consentedAt: "2026-09-01T00:00:00.000Z",
};

function deps(): ElecRunnerIpcDeps {
  return {
    runner: fakeRunner(),
    settings: () => {
      reads += 1;
      return { ...stored };
    },
    save,
    circuit: () => circuit(),
    accountDir: () => accountDir,
    now: () => "2026-09-22T10:00:00.000Z",
  };
}

/** The runner is kept so a test can assert on the SAME stub the factory was given. */
let ipc: ReturnType<typeof createElecRunnerIpc>;
let built: ElecRunner;

beforeEach(() => {
  recorded = { planned: [], started: [], detected: 0, stopped: [], disposed: 0 };
  stored = { enabled: false, choice: null, distro: null, consentedAt: null };
  held = { ...stored };
  writes = [];
  reads = 0;
  startAnswer = { started: true };
  accountDir = mkdtempSync(join(tmpdir(), "nexus-runner-ipc-"));
  built = fakeRunner();
  ipc = createElecRunnerIpc({ ...deps(), runner: built });
});
afterEach(() => {
  rmSync(accountDir, { recursive: true, force: true });
});

/** The runner as the factory sees it — the same stub, so `recorded` is the record of what it was asked. */
const RUN = "kolo-1";

describe("the consent gate", () => {
  it("has no command at all while the runner is off, and never asks the runner for one", () => {
    // DEV-007's second mitigation, and the one that must not be a disabled
    // button in a renderer (SEC-EL-02): with the switch off there is no plan and
    // no start, and the runner is not consulted — so there is no command for a
    // renderer to reach, not merely one it is not supposed to ask for.
    expect(ipc.plan("p1", RUN)).toEqual({ kind: "refused", reason: "not-enabled" });
    expect(ipc.start("p1", RUN)).toEqual({
      started: false,
      reason: "not-enabled",
      message: null,
      workspace: null,
    });
    expect(recorded.planned).toEqual([]);
    expect(recorded.started).toEqual([]);
  });

  it("refuses to PROBE while off, because a probe is a process", () => {
    // The same gate, one step earlier: detection spawns `colcon --help`,
    // `wsl.exe -l -q` and `docker version`, so probing before consent would be
    // the consent running backwards.
    return ipc.detect("p1").then(
      () => {
        throw new Error("detect should have refused while the runner is off");
      },
      (error: unknown) => {
        expect(String(error)).toContain("off");
        expect(recorded.detected).toBe(0);
      },
    );
  });

  it("probes once it is on, and only then", async () => {
    seed(ON);
    await expect(ipc.detect("p1")).resolves.toEqual([]);
    expect(recorded.detected).toBe(1);
  });
});

describe("the choice a run needs", () => {
  it("separates „no profile chosen“ from „WSL chosen and no distribution“", () => {
    // TWO REASONS FOR TWO SENTENCES, and this test used to assert the opposite
    // with the argument „one consequence, so one reason“. The consequence is
    // one — no target, so no command — but the reason is not read by a machine.
    // It is read by a person as a sentence, and „Nijedan profil nije izabran“
    // printed beside a radio that is visibly selected tells them about a screen
    // they are not looking at. The axis a refusal has to be split on is the
    // REPAIR, not the consequence: here it is „pick one of the distributions the
    // probe listed“, which is a control this refusal is not about.
    //
    // And it is not a corner. Choosing WSL stores the choice with `distro: null`
    // until one is picked, so this is the ordinary state between two clicks.
    seed({ ...ON, choice: null });
    expect(ipc.plan("p1", RUN)).toEqual({ kind: "refused", reason: "no-choice" });

    seed({ ...ON, choice: "wsl" });
    expect(ipc.plan("p1", RUN)).toEqual({ kind: "refused", reason: "no-distro" });
    expect(recorded.planned).toEqual([]);
  });

  it("refuses a circuit that generates no ROS 2 package", () => {
    seed(ON);
    const noPackage = createElecRunnerIpc({
      ...deps(),
      circuit: () => sketchOnly(),
      runner: built,
    });
    expect(noPackage.plan("p1", RUN)).toEqual({ kind: "refused", reason: "no-package" });
    expect(recorded.planned).toEqual([]);
  });

  it("hands the runner the stored distribution and nothing else", () => {
    seed({ ...ON, choice: "wsl", distro: "Ubuntu-22.04" });
    ipc.plan("p1", RUN);
    // The distribution reaches the runner through the TARGET, which
    // `runnerTarget` built from the settings row — so a renderer cannot name one
    // on the call, and this asserts the value that came out of the store.
    expect(recorded.planned).toHaveLength(1);
  });
});

describe("what the user consented to and what runs", () => {
  it("are the same command, because both come from one call", async () => {
    // The property the whole consent screen rests on. `plan` is what the panel
    // PRINTED; `start` is what the app SPAWNED; they are equal only while both
    // are `buildCommand`'s answer for the same target and workspace.
    seed(ON);
    const plan = ipc.plan("p1", RUN);
    expect(plan.kind).toBe("command");
    const started = ipc.start("p1", RUN);
    expect(started.started).toBe(true);

    expect(recorded.planned).toHaveLength(1);
    expect(recorded.started).toHaveLength(1);
    const shown = plan.kind === "command" ? plan : null;
    expect(shown?.workspace).toBe(recorded.started[0]?.workspace);
    expect(shown?.cwd).toBe(recorded.started[0]?.workspace);
  });

  it("names a workspace derived from the account and the circuit, never one a caller passed", () => {
    seed(ON);
    ipc.start("p1", RUN);
    const expected = runnerWorkspacePath(accountDir, RUN);
    expect(recorded.started[0]?.workspace).toContain("elec-run");
    expect(recorded.started[0]?.accountDir).toBe(accountDir);
    // The generated package's name, which is what the proof-of-work check looks
    // for under `install/` — so a caller cannot name a package the build is not
    // about.
    expect(recorded.started[0]?.packageName).toBe("stanica_za_vlaznost");
    expect(expected).toContain("elec-run");
  });

  it("answers with the workspace it wrote, and with no workspace when the write failed", () => {
    seed(ON);
    const started = ipc.start("p1", RUN);
    expect(started.workspace).toBe(recorded.started[0]?.workspace);
  });

  it("reports a run that the runner refused rather than claiming it began", () => {
    seed(ON);
    startAnswer = { started: false, reason: "already-running", message: null };
    expect(ipc.start("p1", RUN)).toEqual({
      started: false,
      reason: "already-running",
      message: null,
      workspace: null,
    });
  });
});

describe("the switch", () => {
  it("records when consent was given, and keeps the FIRST record", () => {
    // „When did this person agree to let Nexus start processes here" is one
    // historical fact. A toggle flipped off and on again is the same agreement,
    // not a second one, and overwriting the column would quietly lose the only
    // evidence that there was ever a consent at all.
    ipc.enable("p1", true);
    expect(writes[0]).toEqual({ enabled: true, consentedAt: "2026-09-22T10:00:00.000Z" });

    seed({ ...ON, choice: null });
    ipc.enable("p1", true);
    expect(writes[1]?.consentedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("clears the choice and the distribution in the SAME write when it goes off", () => {
    // The store refuses a choice on a runner that is off — and so does
    // migration 069's CHECK — so the three have to move together or the write is
    // refused rather than half-applied.
    seed({ ...ON, choice: "wsl", distro: "Ubuntu-22.04" });
    expect(ipc.enable("p1", false)).toEqual({
      enabled: false,
      choice: null,
      distro: null,
      consentedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(writes).toEqual([{ enabled: false, choice: null, distro: null }]);
  });

  it("refuses a switch that is not a boolean, because the renderer is not the gate", () => {
    expect(() => ipc.enable("p1", "yes")).toThrow(/boolean/);
    expect(writes).toEqual([]);
  });
});

describe("the choice channel", () => {
  it("stores a profile and a distribution together", () => {
    seed({ ...ON, choice: null });
    expect(ipc.choice("p1", "wsl", "Ubuntu-22.04")).toMatchObject({
      choice: "wsl",
      distro: "Ubuntu-22.04",
    });
  });

  it("clears both when the choice is cleared", () => {
    // A name kept beside no choice is a value nothing can act on — and the store
    // refuses it outright, so the two have to move together.
    seed({ ...ON, choice: "wsl", distro: "Ubuntu-22.04" });
    expect(ipc.choice("p1", null, null)).toMatchObject({ choice: null, distro: null });
    expect(writes).toEqual([{ choice: null, distro: null }]);
  });

  it("clears a stale distribution when the choice moves to a profile without one", () => {
    seed({ ...ON, choice: "wsl", distro: "Ubuntu-22.04" });
    // Not a preference about tidiness: a distribution under any other choice is
    // a row the store refuses, so leaving it would make the switch to `native`
    // fail with a message about a field the user never touched.
    expect(ipc.choice("p1", "native", null)).toMatchObject({ choice: "native", distro: null });
    expect(writes).toEqual([{ choice: "native", distro: null }]);
  });

  it("validates the profile against the closed table rather than a local copy of it", () => {
    expect(() => ipc.choice("p1", "gcc", null)).toThrow(/Invalid IPC payload/);
    expect(() => ipc.choice("p1", "docker ", null)).toThrow(/Invalid IPC payload/);
    expect(writes).toEqual([]);
  });

  it("refuses a distribution that is not a non-empty string", () => {
    expect(() => ipc.choice("p1", "wsl", "")).toThrow(/distro/);
    expect(() => ipc.choice("p1", "wsl", 7)).toThrow(/distro/);
    expect(writes).toEqual([]);
  });

  it("refuses a distribution under a profile that is not the WSL one", () => {
    // The store refuses this too, in a sentence written for whoever wrote the
    // row. This is the sentence for what actually happened — and it is here
    // rather than left to the store so that the refusal happens BEFORE a write
    // that would fail with a message about a field the user never chose.
    expect(() => ipc.choice("p1", "native", "Ubuntu-22.04")).toThrow(/WSL/);
    expect(writes).toEqual([]);
  });

  it("keeps a WSL choice with no distribution yet, which is an ordinary state", () => {
    // The middle of the flow: the user has picked the profile and has not picked
    // a distribution out of the probe's list. It is a row, not a refusal — the
    // refusal for it is `no-distro`, and it comes from `plan` where there really
    // is no command to build. This is also the state the dialog's „Izaberi
    // distribuciju“ option produces, and the reason that option has to send
    // `null`: the empty string reaches `asDistro` and throws, so main is right
    // to refuse it and the select was wrong to send it.
    seed({ ...ON, choice: null });
    expect(ipc.choice("p1", "wsl", null)).toMatchObject({ choice: "wsl", distro: null });
    expect(writes).toEqual([{ choice: "wsl", distro: null }]);
  });
});

describe("the lifecycle", () => {
  it("stops the run that belongs to the profile that asked", async () => {
    await expect(ipc.stop("p1")).resolves.toBe("exited");
    expect(recorded.stopped).toEqual(["p1"]);
  });

  it("reaches the runner on dispose, which is what `will-quit` calls", () => {
    ipc.dispose();
    expect(recorded.disposed).toBe(1);
  });
});

describe("the settings it reads and writes", () => {
  it("answers the renderer in the wire's own shape", () => {
    seed(ON);
    // An explicit object on the way out, so that a change on either side of the
    // wire is a compile error rather than a field that quietly stops crossing.
    expect(Object.keys(ipc.settings("p1")).sort()).toEqual([
      "choice",
      "consentedAt",
      "distro",
      "enabled",
    ]);
  });

  it("reads the stored settings once per call and never caches them", () => {
    // The row can change under a long-lived panel — another window, or the same
    // user turning the switch off — and a cached copy would be a panel deciding
    // whether to spawn from a value that is no longer true.
    ipc.settings("p1");
    ipc.settings("p1");
    expect(reads).toBe(2);
  });
});
