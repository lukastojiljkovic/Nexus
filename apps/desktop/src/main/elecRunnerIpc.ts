/**
 * ADR-085 slice E6 — the runner's IPC surface, and the ONE place a stored choice
 * becomes a command.
 *
 * Everything below is a decision this layer has to make and nothing else does:
 * whether the runner may run at all, which profile a run therefore uses, and
 * which circuit it is about. `elecRunner.ts` is handed a target and a workspace
 * and knows about neither circuits nor settings — that is DEV-007's first
 * mitigation expressed as a shape, because a module that could read a circuit is
 * a module that could put one in a command line.
 *
 * **Nothing a renderer sends can name a command.** The five run channels carry a
 * profile id and a circuit id; the profile comes from the user's own settings
 * row, the circuit id selects a stored document, and the command itself is built
 * by `@nexus/core`'s closed table. The distribution is the only value that is
 * neither an id nor a stored setting, and even it is stored rather than passed —
 * so a single call can never introduce one.
 *
 * **Validation lives here rather than at the registration site**, which is the
 * other half of the same argument: `index.ts` is 13 000 lines and the contract
 * for this surface should be readable in one place. A handler there does
 * `assertTrustedSender`, `asRecord` and `asId` on the ids and passes the rest
 * through as `unknown`; what a field may BE is decided beside the thing that
 * acts on it.
 *
 * The functions here are synchronous where the underlying call is, and that is
 * deliberate rather than incidental: `state`, `settings` and the two settings
 * writes touch a store on a local file, and the runner's own `start` is
 * synchronous by construction — it answers whether the process began, not how
 * the run went. Only `detect` and `stop` await anything, and both await a
 * process.
 */

import {
  catalogueComponent,
  generateRosPackage,
  runnerTarget,
  RUNNER_PROFILES,
  type Circuit,
} from "@nexus/core";

import type { ElecSettings, ElecSettingsChanges } from "@nexus/db";

import type {
  RunnerDetection,
  RunnerPlanResult,
  RunnerProfileId,
  RunnerRefusal,
  RunnerSettings,
  RunnerStartResult,
  RunnerState,
  RunnerStopState,
} from "../shared/ipc.js";
import type { ElecRunner } from "./elecRunner.js";
import { runnerWorkspacePath, writeWorkspace } from "./elecWorkspace.js";

export interface ElecRunnerIpcDeps {
  /** The one runner, shared with `will-quit` — not one per call. */
  readonly runner: ElecRunner;
  /** This profile's settings row, defaults already applied. */
  readonly settings: (profileId: string) => ElecSettings;
  /** The settings write. `now` is stamped by the caller and validated by the store. */
  readonly save: (
    profileId: string,
    changes: ElecSettingsChanges,
    now: string,
  ) => ElecSettings;
  /** The stored circuit a run is about — which is also what proves the caller is in a real session. */
  readonly circuit: (profileId: string, id: string) => Circuit;
  /** `<userData>/accounts/<activeAccountId>`: the root every workspace hangs off. */
  readonly accountDir: () => string;
  readonly now: () => string;
}

/** A resolved run: the command's target, and the package the build is expected to produce. */
type Resolved =
  | { readonly kind: "ready"; readonly target: Parameters<ElecRunner["start"]>[0]["target"]; readonly name: string; readonly files: readonly { path: string; contents: string }[] }
  | { readonly kind: "refused"; readonly reason: RunnerRefusal };

export interface ElecRunnerIpc {
  detect(profileId: string): Promise<RunnerDetection[]>;
  plan(profileId: string, id: string): RunnerPlanResult;
  start(profileId: string, id: string): RunnerStartResult;
  stop(profileId: string): Promise<RunnerStopState>;
  state(profileId: string): RunnerState;
  settings(profileId: string): RunnerSettings;
  enable(profileId: string, enabled: unknown): RunnerSettings;
  choice(profileId: string, choice: unknown, distro: unknown): RunnerSettings;
  /**
   * The quit path, forwarded to the runner — which is the only thing here that
   * owns something the process can outlive. Synchronous, because `will-quit`
   * cannot await, and it is reached through this interface rather than through
   * the runner directly because the runner is this module's business and
   * `index.ts` should not have to hold two handles to stop one run.
   */
  dispose(): void;
}

/**
 * The settings as the renderer sees them.
 *
 * Written out field by field rather than returned as the store's own object, so
 * that a change to either side is a compile error rather than a value that
 * quietly stops crossing. It is four fields, and the day it is five is the day
 * somebody has to decide what the fifth one means on the wire.
 */
function toWire(settings: ElecSettings): RunnerSettings {
  return {
    enabled: settings.enabled,
    choice: settings.choice,
    distro: settings.distro,
    consentedAt: settings.consentedAt,
  };
}

/**
 * The profile a request names, validated against the closed table.
 *
 * `asPartRotation`'s shape, and `RUNNER_PROFILES` rather than three literals: a
 * validator that spelled the ids would be a second copy of the closed table,
 * which is exactly how a closed table stops being closed.
 */
function asProfile(value: unknown): RunnerProfileId {
  if (!(RUNNER_PROFILES as readonly unknown[]).includes(value)) {
    throw new Error(
      `Invalid IPC payload: "choice" must be null or one of ${RUNNER_PROFILES.join(", ")}.`,
    );
  }
  return value as RunnerProfileId;
}

/** A distribution's name: a bounded, non-empty string. The bound is the store's, and the store states it. */
function asDistro(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Invalid IPC payload: "distro" must be a non-empty string.`);
  }
  return value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createElecRunnerIpc(deps: ElecRunnerIpcDeps): ElecRunnerIpc {
  /**
   * Everything that has to be true before a command exists.
   *
   * **The consent comes first**, because it is the gate and not a preference:
   * `enabled` is a row a person wrote after reading what enabling means, and it
   * is checked here rather than in the renderer for SEC-EL-02's reason — a
   * renderer is never the gate. A disabled runner has no command at all, which
   * is why the answer is a refusal and not an empty argv.
   *
   * The circuit is read through the STORE rather than taken from the renderer,
   * so the package that is built and the package that was displayed are the same
   * bytes: main regenerates from what is stored. `generateRosPackage` is pure
   * and lives in `@nexus/core`, which the renderer imports for its own preview —
   * so this is a second call to one function, never a second implementation.
   */
  function resolve(profileId: string, id: string): Resolved {
    const stored = deps.settings(profileId);
    if (!stored.enabled) return { kind: "refused", reason: "not-enabled" };
    if (stored.choice === null) return { kind: "refused", reason: "no-choice" };

    const target = runnerTarget(stored.choice, stored.distro);
    // Non-null exactly when a WSL choice has no distribution yet, because
    // `runnerTarget` is the one place that mapping exists — and it is its own
    // refusal rather than a second `no-choice`, because the sentence a reader
    // needs is about a distribution and not about a profile they can see is
    // selected. Reaching here is ordinary: choosing WSL stores the choice with
    // `distro: null` until one is picked.
    if (target === null) return { kind: "refused", reason: "no-distro" };

    const code = generateRosPackage(deps.circuit(profileId, id), catalogueComponent);
    if (code.kind === "refused") return { kind: "refused", reason: "no-package" };
    return { kind: "ready", target, name: code.name, files: code.files };
  }

  function refused(reason: RunnerRefusal): RunnerPlanResult {
    return { kind: "refused", reason };
  }

  /**
   * What is installed, asked of the machine.
   *
   * Gated on the switch, and that is the whole reason it is a method here rather
   * than a call to `runner.detect()`: a probe is a PROCESS, so probing before the
   * user has consented to Nexus starting processes would be the deviation's
   * second mitigation inverted. After consent it is an ordinary read — and the
   * runner joins a round already in flight rather than starting a second one.
   */
  function detect(profileId: string): Promise<RunnerDetection[]> {
    if (!deps.settings(profileId).enabled) {
      return Promise.reject(
        new Error("The runner is off — nothing is probed on this machine until it is on."),
      );
    }
    return deps.runner.detect();
  }

  function plan(profileId: string, id: string): RunnerPlanResult {
    const resolved = resolve(profileId, id);
    if (resolved.kind === "refused") return refused(resolved.reason);
    // The command the user reads and the command that runs are one call to one
    // function — `RunnerPlan`'s own argument, and the only way those two can be
    // the same string.
    return deps.runner.plan(resolved.target, runnerWorkspacePath(deps.accountDir(), id));
  }

  function start(profileId: string, id: string): RunnerStartResult {
    const resolved = resolve(profileId, id);
    if (resolved.kind === "refused") {
      return { started: false, reason: resolved.reason, message: null, workspace: null };
    }

    const accountDir = deps.accountDir();
    let workspace: string;
    try {
      // Derived inside `writeWorkspace` from `accountDir` and the circuit id, so
      // no argument here can name a directory the user has. The workspace for a
      // circuit is a function of the circuit, which is why `plan` can name it
      // before this runs and be right.
      workspace = writeWorkspace(accountDir, id, resolved.name, resolved.files);
    } catch (error) {
      return { started: false, reason: "write-failed", message: messageOf(error), workspace: null };
    }

    const outcome = deps.runner.start({
      profileId,
      target: resolved.target,
      accountDir,
      workspace,
      packageName: resolved.name,
    });
    if (!outcome.started) {
      return { started: false, reason: outcome.reason, message: outcome.message, workspace: null };
    }
    return { started: true, reason: "none", message: null, workspace };
  }

  function stop(profileId: string): Promise<RunnerStopState> {
    return deps.runner.stop(profileId);
  }

  function state(profileId: string): RunnerState {
    return deps.runner.state(profileId);
  }

  function settings(profileId: string): RunnerSettings {
    return toWire(deps.settings(profileId));
  }

  /**
   * The switch — the one write that records a consent, and therefore the one
   * channel that could grant the deviation to a user who never gave it.
   *
   * **The first consent is the one that is kept.** `consentedAt` is not
   * overwritten by a later flip of the switch, because the column's meaning is
   * „when this person agreed to let Nexus start processes on this computer" —
   * one historical fact, not the most recent time a toggle moved. Turning off
   * LEAVES the record, which is what the store's own doc says and what makes the
   * refusal to re-enable without one impossible to reach by accident.
   *
   * **Turning off clears the choice and the distribution with it**, in the same
   * write, because the store and migration 069 both refuse a remembered choice
   * on a runner that is off — and the pair has to move together or the write is
   * refused rather than half-applied.
   */
  function enable(profileId: string, enabled: unknown): RunnerSettings {
    if (typeof enabled !== "boolean") {
      throw new Error(`Invalid IPC payload: "enabled" must be a boolean.`);
    }
    const now = deps.now();
    const stored = deps.settings(profileId);
    return toWire(
      enabled
        ? deps.save(profileId, { enabled: true, consentedAt: stored.consentedAt ?? now }, now)
        : deps.save(profileId, { enabled: false, choice: null, distro: null }, now),
    );
  }

  /**
   * Which profile runs, and — for WSL — which distribution.
   *
   * The two are not interchangeable and cannot be written apart: a choice of
   * `"wsl"` with no distribution has no target, and the store refuses a
   * distribution under any other choice. So this channel validates both against
   * each other, and the shape checks below are the only ones made here — the
   * domain is the store's, and a name that is a name is not re-probed (see the
   * wire contract's own note).
   */
  function choice(profileId: string, choice: unknown, distro: unknown): RunnerSettings {
    const now = deps.now();
    if (choice === null) {
      // Clearing the choice clears the distribution with it, and for the same
      // reason turning off does: a name kept beside no choice is a value with
      // nothing that could act on it.
      return toWire(deps.save(profileId, { choice: null, distro: null }, now));
    }
    const profile = asProfile(choice);
    // **`distro` is written on EVERY call, including the null one**, and that is
    // the whole of this function's care. The store merges a partial change over
    // the row, so omitting the field would LEAVE whatever was stored — and a
    // user moving from a WSL choice to another one would keep a distribution
    // under a profile that has none, which the store refuses outright. The write
    // would then fail with a message about a field nobody touched.
    if (distro === null) {
      return toWire(deps.save(profileId, { choice: profile, distro: null }, now));
    }
    // A distribution under any other choice is refused HERE rather than by the
    // store, because the store's own sentence is written for whoever wrote the
    // row and this one is written for what actually happened.
    if (profile !== "wsl") {
      throw new Error(
        `Invalid IPC payload: "distro" belongs to the WSL choice and to no other.`,
      );
    }
    return toWire(deps.save(profileId, { choice: profile, distro: asDistro(distro) }, now));
  }

  function dispose(): void {
    deps.runner.dispose();
  }

  return { detect, plan, start, stop, state, settings, enable, choice, dispose };
}
