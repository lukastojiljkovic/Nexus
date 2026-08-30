/**
 * The one sync loop this desktop runs, and what it is allowed to run for.
 *
 * `createSyncLoop` owns *when* a round happens. This owns *whether there is a
 * loop at all* — which profile it is bound to, what happens when that profile
 * changes, and which of `runSyncRound`'s refusals mean „later" rather than
 * „stop". Those are desktop questions with desktop answers, and none of them
 * belongs in a package that also has to run in a browser tab.
 *
 * ─── One profile at a time, and it is the open one ──────────────────────────
 *
 * A round is about one profile: it opens that profile's content key, walks that
 * profile's cursors, drains that profile's outbox. A loop per profile would
 * multiply every round's traffic by however many profiles exist on the machine —
 * including the ones nobody has opened this year — so the loop follows the
 * profile that is open, and a profile that is not open catches up the moment it
 * is. The cost is stated rather than hidden: a change made on another device to
 * a profile that is closed here does not arrive here until it is opened.
 *
 * ─── Three answers, not two ─────────────────────────────────────────────────
 *
 * `SyncHalt` has four members because the engine's failures need four answers.
 * A desktop round can fail in ways the engine never sees — cloud is off, the
 * database is locked, this machine holds no key that opens what it must seal —
 * and collapsing those into the engine's vocabulary would make a screen say
 * „sign in again" to somebody whose session is perfectly fine. So the mapping is
 * explicit, it is exhaustive, and it has three destinations:
 *
 * - **delay** — try the whole thing again later. `offline`, `malformed`,
 *   `contested`, and `locked`. Locked belongs here rather than under „stop"
 *   because it costs nothing: the round refuses before the first request, and
 *   the round after the user unlocks simply works.
 * - **halt** — stop, and say why; only a person can fix it. `forbidden` and
 *   `signed_out`, which are one sentence to the user and two facts to the log.
 * - **stop** — the loop should not be running at all. `cloud_off`,
 *   `not_enabled` and `key_unavailable`.
 *
 * ─── The nonce alarm outlives the loop ──────────────────────────────────────
 *
 * `createSyncLoop` latches on `nonce-reuse` and nothing clears it — a repeated
 * nonce under XChaCha20-Poly1305 publishes the plaintext XOR and the Poly1305
 * forging key, so the loop must never come back on a timer, a nudge or a button.
 * That latch lives inside ONE loop object, and this file creates loop objects: a
 * profile switched away from and back to would have got a brand-new loop with a
 * clean latch, which is the latch being bypassed by the only code that could
 * bypass it. So the scheduler remembers which profiles have poisoned, and the
 * check sits in `loopFor` — the one place a loop is ever constructed — for the
 * same reason the engine's sits in `arm`.
 */

import type { SyncHalt, SyncLoop, SyncRoundOptions, SyncRoundReport, Timer } from "@nexus/sync-engine";
import { createSyncLoop } from "@nexus/sync-engine";

import type { SyncActivityView, SyncProblem } from "../../shared/ipc.js";
import type { SyncRoundBlock, SyncRoundInput, SyncRoundOutcome } from "./round.js";

export interface SyncSchedulerDeps {
  /**
   * One round.
   *
   * A function rather than the round's own dependencies, for the same reason
   * `SyncLoopDeps` takes one: this file exists to decide what an OUTCOME means,
   * and a test that had to reach that decision through a fake HTTP server would
   * be re-deriving `round.ts` in order to ask a question about this file.
   */
  readonly round: (input: SyncRoundInput) => Promise<SyncRoundOutcome>;
  /** Arm a one-shot timer. Injected so a test can run a week of backoff instantly. */
  readonly timer?: Timer;
  /** Epoch milliseconds. */
  readonly clock?: () => number;
  /** Called on every change, so the main process can push it to a window. */
  readonly onChange?: (activity: SyncActivityView) => void;
}

export interface SyncScheduler {
  readonly status: () => SyncActivityView;
  /**
   * Bind the loop to a profile and start it. Binding to the one already open is
   * a no-op, so „the renderer asked again" costs nothing and does not restart a
   * backoff.
   */
  readonly open: (profileId: string) => void;
  /** Unbind and stop. A round already in flight finishes and is then discarded. */
  readonly close: () => void;
  /** The user pressed the button. */
  readonly syncNow: () => void;
  /** Something changed locally, or a peer said so. Coalesced by the loop. */
  readonly nudge: (collections?: readonly string[]) => void;
}

/** A round that did not happen, in the shape the loop reads. */
const NOTHING: SyncRoundReport = {
  pulled: 0,
  applied: 0,
  pushed: 0,
  conflicts: 0,
  quarantined: 0,
  owed: 0,
  halted: null,
};

/** Refusals a later round can resolve on its own. */
const DELAY: ReadonlySet<SyncRoundBlock> = new Set<SyncRoundBlock>([
  "offline",
  "malformed",
  "contested",
  "locked",
]);

/** Refusals that need a person before anything can work. */
const HALT: ReadonlySet<SyncRoundBlock> = new Set<SyncRoundBlock>(["forbidden", "signed_out"]);

const defaultTimer: Timer = (ms, fire) => {
  const handle = setTimeout(fire, ms);
  return () => {
    clearTimeout(handle);
  };
};

export function createSyncScheduler(deps: SyncSchedulerDeps): SyncScheduler {
  const timer = deps.timer ?? defaultTimer;
  const clock = deps.clock ?? Date.now;

  let profileId: string | null = null;
  let loop: SyncLoop | null = null;
  /** Written in exactly one place — `run` — so it can never disagree with itself. */
  let problem: SyncProblem | null = null;
  /** Profiles whose content key has been used twice with one nonce. Never emptied. */
  const poisoned = new Set<string>();

  const status = (): SyncActivityView => {
    const inner = loop?.status();
    const report = inner?.lastReport ?? null;
    return {
      profileId,
      phase: inner?.phase ?? "stopped",
      problem,
      nextRunAt: inner?.nextRunAt ?? null,
      lastRunAt: inner?.lastRunAt ?? null,
      // Without the report's `halted`, which `problem` already carries in the
      // vocabulary the screen has sentences for — two fields for one fact is how
      // a surface ends up showing both at once — and without the two counts that
      // no Serbian sentence names. `SyncActivityView` says which, and why.
      lastRound:
        report === null
          ? null
          : {
              applied: report.applied,
              pushed: report.pushed,
              quarantined: report.quarantined,
              owed: report.owed,
            },
      failures: inner?.failures ?? 0,
    };
  };

  const emit = (): void => {
    deps.onChange?.(status());
  };

  /**
   * One round, translated into the only vocabulary the loop understands.
   *
   * A „stop" refusal ends the loop from inside the round that learned it.
   * `SyncLoop.stop()` during a round is safe by design — the round in flight
   * finishes and records the stop itself when it settles — and doing it here
   * rather than making the caller poll is what keeps „this loop should not be
   * running" a fact about the loop rather than a note somewhere else.
   */
  const run = async (options: SyncRoundOptions): Promise<SyncRoundReport> => {
    const bound = profileId;
    if (bound === null) return NOTHING;

    const outcome = await deps.round({
      profileId: bound,
      ...(options.collections === undefined ? {} : { collections: options.collections }),
    });

    if (outcome.kind === "ran") {
      // Keyed by profile, so it is recorded before the staleness check below:
      // the alarm is about a key, and a key does not stop being compromised
      // because the user changed profiles while the round was in flight.
      if (outcome.report.halted === "nonce-reuse") poisoned.add(bound);
      if (outcome.unopenable.length > 0) {
        console.error(
          `sync: ${String(outcome.unopenable.length)} content key generation(s) did not open —`,
          outcome.unopenable.join(", "),
        );
      }
    } else if (outcome.detail !== null) {
      console.error(`sync: round blocked (${outcome.reason}) —`, outcome.detail);
    }

    // A round that finishes after a profile switch describes the profile it was
    // STARTED for. Recording its outcome now would file one profile's failure
    // under another's name, and stop a loop that is not the one that ran.
    if (profileId !== bound) return NOTHING;

    if (outcome.kind === "ran") {
      problem = fromHalt(outcome.report.halted);
      return outcome.report;
    }

    problem = outcome.reason;
    if (DELAY.has(outcome.reason)) return { ...NOTHING, halted: "offline" };
    if (HALT.has(outcome.reason)) return { ...NOTHING, halted: "forbidden" };
    loop?.stop();
    return NOTHING;
  };

  /**
   * The one place a loop is constructed, and therefore the one place the nonce
   * alarm can be honoured across a profile switch.
   */
  const loopFor = (): SyncLoop | null => {
    if (profileId === null || poisoned.has(profileId)) return null;
    return createSyncLoop({ run, timer, now: clock, onChange: emit });
  };

  return {
    status,

    open(next) {
      if (next === profileId) return;
      loop?.stop();
      profileId = next;
      problem = poisoned.has(next) ? "nonce_reuse" : null;
      loop = loopFor();
      loop?.start();
      emit();
    },

    close() {
      loop?.stop();
      loop = null;
      profileId = null;
      problem = null;
      emit();
    },

    syncNow() {
      loop?.syncNow();
    },

    nudge(collections) {
      loop?.nudge(collections);
    },
  };
}

/** A round's own halt in this file's vocabulary. */
function fromHalt(halt: SyncHalt | null): SyncProblem | null {
  if (halt === null) return null;
  return halt === "nonce-reuse" ? "nonce_reuse" : halt;
}
