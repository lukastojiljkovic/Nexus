/**
 * What calls the round, and what it does with the answer.
 *
 * `syncOnce` deliberately has no retry in it: retrying means deciding how long
 * to wait, and that is a scheduler's question with a platform's answer. This is
 * the scheduler. It owns three things and nothing else — when the next round
 * runs, what that round has to cover, and which halts mean „later" rather than
 * „stop".
 *
 * ─── Two clocks, because they answer different questions ────────────────────
 *
 * The interval is the one that makes sync CORRECT: a device that hears nothing
 * still converges, because every `intervalMs` it walks every collection's log
 * from its own watermark. Nothing else in the system guarantees that. The nudge
 * is the one that makes sync FEEL instant — a local edit, or a Realtime
 * broadcast naming the collections that changed — and it is allowed to be
 * incomplete precisely because the interval is not. {@link SyncLoop.nudge} may
 * therefore carry a hint; a round nobody hinted is always a full one.
 *
 * The interval is a DEADLINE and not a gap, which is the difference between the
 * guarantee holding and merely usually holding. Measured as „wait `intervalMs`
 * after whatever ran last", a user typing steadily keeps pulling the wake
 * forward into a hinted round and re-arming from there, and the full walk that
 * catches what the hints missed never runs at all. Measured from the last FULL
 * round, a nudge can only make a round happen sooner, never make the complete
 * one happen later: coverage is decided when a round starts, from how long it
 * has been, and a hinted round whose deadline has passed is simply a full one.
 *
 * ─── A halt is not one thing ────────────────────────────────────────────────
 *
 * `SyncHalt` has four members and they need four different answers, which is the
 * whole reason this file exists rather than a `setInterval` somewhere:
 *
 * - `offline` is a delay. Back off, jittered, and try the whole thing again.
 * - `malformed` is also a delay, and deliberately not a stop. A page this build
 *   cannot parse is a fault to report, but the PUSH half of a round is
 *   unaffected by it and a device that stopped syncing over one bad row would be
 *   holding the user's own writes hostage to somebody else's.
 * - `forbidden` is not a delay. The session is dead or this device was revoked,
 *   and no amount of waiting fixes either — a timer would turn „sign in again"
 *   into an app that quietly never syncs. The loop halts and says so, and comes
 *   back only when the caller has done something about it and calls
 *   {@link SyncLoop.start} again.
 * - `nonce-reuse` is an alarm. Under XChaCha20-Poly1305 a repeated nonce
 *   publishes the XOR of two plaintexts and the Poly1305 forging key, so the
 *   loop must not merely pause: it LATCHES. Once seen, nothing arms a wake
 *   again — not a timer, not a nudge, not the user's own button — because the
 *   refusal sits in `arm`, which every one of those has to go through. The only
 *   way back is code that constructs a NEW loop, which is code somebody has to
 *   write after deciding the key was rotated. A boolean nobody can clear is the
 *   point, and one choke point rather than four is what keeps it true.
 *
 * ─── It holds no timers of its own ──────────────────────────────────────────
 *
 * `setTimeout` is not imported here, for the reason the rest of the package
 * imports no `fetch`: the same loop runs in the Electron main process and in a
 * browser tab, and a module that reached for a global would be choosing one of
 * them. {@link Timer} arrives in the deps, which is also what makes the tests
 * able to run a week of backoff in a millisecond.
 */

import type { SyncHalt, SyncRoundOptions, SyncRoundReport } from "./round.js";

/**
 * Arm a one-shot timer. The returned function cancels it, and calling it after
 * the timer has fired must be harmless.
 */
export type Timer = (ms: number, fire: () => void) => () => void;

export interface SyncLoopSettings {
  /** A full round on this cadence, however quiet things are. */
  readonly intervalMs: number;
  /** How long a nudge waits, so a burst of edits becomes one round. */
  readonly nudgeMs: number;
  /** The first backoff, doubled per consecutive failure. */
  readonly backoffMs: number;
  /** And the ceiling it doubles towards. */
  readonly backoffMaxMs: number;
}

export const SYNC_LOOP_DEFAULTS: SyncLoopSettings = {
  intervalMs: 5 * 60_000,
  nudgeMs: 750,
  backoffMs: 2_000,
  // The same as the interval on purpose. A device that has been failing for an
  // hour polls exactly as often as a device that has nothing to do, so the worst
  // case of backing off is the ordinary case of being idle.
  backoffMaxMs: 5 * 60_000,
};

export type SyncLoopPhase = "stopped" | "waiting" | "running" | "halted";

export interface SyncLoopStatus {
  readonly phase: SyncLoopPhase;
  /**
   * The halt that ENDED the loop, as against one that only delayed it.
   *
   * Deliberately not the same field as `lastReport.halted`: `offline` appears
   * there on a round the loop will simply repeat, and a screen that read one
   * field for both would tell the user their session had died because their
   * wifi dropped.
   */
  readonly stoppedBy: SyncHalt | null;
  /** Epoch milliseconds, or `null` when nothing is scheduled. */
  readonly nextRunAt: number | null;
  /** Epoch milliseconds of the last round's END, or `null` before the first. */
  readonly lastRunAt: number | null;
  /** `null` when the last round threw rather than returning. */
  readonly lastReport: SyncRoundReport | null;
  /** Consecutive rounds that failed. Zero after any round that did not. */
  readonly failures: number;
  /** The last throw's message. A developer's fault report, never user copy. */
  readonly lastError: string | null;
}

export interface SyncLoopDeps {
  /** One round. Throwing is allowed: it is a failure like any other. */
  readonly run: (options: SyncRoundOptions) => Promise<SyncRoundReport>;
  readonly timer: Timer;
  /** Epoch milliseconds. */
  readonly now: () => number;
  /** Jitter source in [0, 1). Defaults to `Math.random`. */
  readonly random?: () => number;
  /** Called on every phase change, with a snapshot. */
  readonly onChange?: (status: SyncLoopStatus) => void;
  readonly settings?: Partial<SyncLoopSettings>;
}

export interface SyncLoop {
  readonly status: () => SyncLoopStatus;
  /**
   * Begin, or begin again after a halt. Runs the first round shortly, not
   * immediately: a launch has a database to open and a session to resume, and a
   * round that started in the same tick would race both.
   */
  readonly start: () => void;
  /**
   * Cease. A round already in flight finishes — cancelling one mid-write is what
   * `sync_outbox` exists to avoid needing — and nothing is scheduled after it.
   */
  readonly stop: () => void;
  /**
   * Something changed. Coalesced: many nudges before the next round are one
   * round, and their hints are unioned.
   *
   * A nudge never shortens a backoff. An edit is not evidence that the network
   * came back, and treating it as such turns an unreachable server into a device
   * that hammers it once per keystroke.
   */
  readonly nudge: (collections?: readonly string[]) => void;
  /** The user pressed the button: run now, and forget the backoff. */
  readonly syncNow: () => void;
}

interface Wake {
  readonly at: number;
  readonly cancel: () => void;
}

export function createSyncLoop(deps: SyncLoopDeps): SyncLoop {
  const settings: SyncLoopSettings = { ...SYNC_LOOP_DEFAULTS, ...deps.settings };
  const random = deps.random ?? Math.random;

  let phase: SyncLoopPhase = "stopped";
  let stoppedBy: SyncHalt | null = null;
  /** Does the caller want this loop running at all? Independent of a halt. */
  let wanted = false;
  /** Latched by `nonce-reuse`, and by nothing else. Never cleared. */
  let poisoned = false;
  let wake: Wake | null = null;
  let lastRunAt: number | null = null;
  /** When a round last walked EVERY collection to its end. The deadline's origin. */
  let lastFullAt: number | null = null;
  let lastReport: SyncRoundReport | null = null;
  let lastError: string | null = null;
  let failures = 0;
  /** A nudge arrived and has not been served by a round yet. */
  let asked = false;
  /** ...and it named no collections, so the round it asks for is a full one. */
  let askedFull = false;
  const hinted = new Set<string>();

  const status = (): SyncLoopStatus => ({
    phase,
    stoppedBy,
    nextRunAt: wake?.at ?? null,
    lastRunAt,
    lastReport,
    failures,
    lastError,
  });

  const emit = (): void => {
    if (deps.onChange === undefined) return;
    try {
      deps.onChange(status());
    } catch {
      // A listener that throws is a bug in the listener, and it must not be able
      // to stop the loop: the one that will do this is a renderer bridge whose
      // window has just closed, and sync going quiet until the app restarts is a
      // far worse outcome than a dropped status line.
    }
  };

  const disarm = (): void => {
    wake?.cancel();
    wake = null;
  };

  const arm = (ms: number): void => {
    // The ONE place a round can be scheduled from, and therefore the one place
    // the nonce alarm is honoured. `start`, `syncNow`, a nudge and the settle
    // path all funnel through here, so a fifth caller written later inherits the
    // refusal instead of having to remember it — and „the loop cannot resume"
    // stops being four checks that must all stay correct.
    if (poisoned) return;
    disarm();
    // Arming IS the act of leaving a halt, so this is where the reason for one
    // stops being true. Clearing it at the entry points instead would wipe the
    // sentence off the screen for a loop that then refuses to arm anyway.
    stoppedBy = null;
    const at = deps.now() + ms;
    const cancel = deps.timer(ms, () => {
      wake = null;
      void round();
    });
    wake = { at, cancel };
    phase = "waiting";
    emit();
  };

  /** How long until a full walk is owed. Zero when one is owed already. */
  const untilFull = (): number =>
    lastFullAt === null ? 0 : Math.max(0, lastFullAt + settings.intervalMs - deps.now());

  const halt = (reason: SyncHalt): void => {
    disarm();
    stoppedBy = reason;
    phase = "halted";
    emit();
  };

  /**
   * Equal jitter: half the ceiling, plus a random half of it.
   *
   * Two devices that lost the network at the same moment must not come back at
   * the same moment — and the ones most likely to have failed together are the
   * ones behind the same router, syncing the same account.
   */
  const backoff = (): number => {
    const doublings = Math.min(failures - 1, 30);
    const ceiling = Math.min(settings.backoffMs * 2 ** doublings, settings.backoffMaxMs);
    return Math.round(ceiling / 2 + (ceiling * random()) / 2);
  };

  async function round(): Promise<void> {
    // Three ways to be a full round, and the first is the guarantee: the
    // deadline has come. The other two are „a hint that named nothing" and „no
    // hint at all", which is every interval fire, every backoff retry and every
    // start.
    const full = untilFull() === 0 || askedFull || !asked;
    const options: SyncRoundOptions = full ? {} : { collections: [...hinted] };
    // Cleared BEFORE the await, not after it: a nudge that arrives while this
    // round is in flight is asking for a round that starts later than this one
    // did, and clearing afterwards would swallow it.
    asked = false;
    askedFull = false;
    hinted.clear();
    phase = "running";
    emit();

    let result: SyncRoundReport | null = null;
    try {
      result = await deps.run(options);
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    lastRunAt = deps.now();
    lastReport = result;
    // Only a full round that RAN OUT OF WORK resets the deadline. One that
    // halted stopped somewhere in the middle of the collection list, and
    // treating it as a completed walk would push the next complete one an
    // interval into the future on the strength of a walk that did not happen.
    if (full && result !== null && result.halted === null) lastFullAt = lastRunAt;
    settle(result);
  }

  function settle(result: SyncRoundReport | null): void {
    // Before `wanted`, deliberately. The alarm is about a key, not about whether
    // anybody currently wants sync running, so a `stop()` that landed while the
    // round was in flight must not be able to swallow it.
    if (result?.halted === "nonce-reuse") {
      poisoned = true;
      wanted = false;
      halt("nonce-reuse");
      return;
    }
    if (!wanted) {
      disarm();
      phase = "stopped";
      emit();
      return;
    }
    if (result === null) {
      failures += 1;
      arm(backoff());
      return;
    }
    if (result.halted === "forbidden") {
      halt("forbidden");
      return;
    }
    if (result.halted !== null) {
      // `offline`, `malformed`, and whatever is added next. A halt this file has
      // not been taught about is a delay rather than a silence: the failure mode
      // of guessing wrong that way is a device that retries too often, and the
      // other way is a device that stops syncing and never says why.
      failures += 1;
      arm(backoff());
      return;
    }

    failures = 0;
    // A refused push is the one outcome another round is KNOWN to resolve: the
    // conflict is a peer's row, and this device's next pull merges it. Either
    // way the deadline caps the wait rather than being one of the options —
    // nothing here may schedule the next round later than the full walk is due.
    const soon = asked || result.conflicts > 0;
    arm(soon ? Math.min(settings.nudgeMs, untilFull()) : untilFull());
  }

  return {
    status,

    start() {
      wanted = true;
      if (phase === "running" || phase === "waiting") return;
      failures = 0;
      // A start is not the resumption of whatever was pending. Hints gathered
      // while the loop was down describe a device that has since been offline,
      // signed out or halted, and the round that comes back from that is the one
      // that should miss nothing.
      asked = false;
      askedFull = false;
      hinted.clear();
      arm(settings.nudgeMs);
    },

    stop() {
      wanted = false;
      disarm();
      // A round in flight records the stop itself when it ends, and a latched
      // alarm is not a state `stop()` is allowed to clear — hiding the reason
      // would leave a loop that refuses to start with nothing on screen saying
      // why.
      if (phase === "running" || poisoned) return;
      phase = "stopped";
      stoppedBy = null;
      emit();
    },

    nudge(collections) {
      if (!wanted) return;
      asked = true;
      if (collections === undefined) askedFull = true;
      else for (const name of collections) hinted.add(name);

      // No wake means running, halted or stopped. The first serves this when it
      // ends; the other two are exited by `start` or `syncNow`, never by an edit.
      if (wake === null) return;
      if (failures > 0) return;

      // Only ever EARLIER. What the round covers is decided when it starts, so
      // a nudge that lands during a wait needs nothing of the armed wake except
      // that it not be further away than a nudge's own delay.
      if (Math.max(0, wake.at - deps.now()) <= settings.nudgeMs) return;
      arm(settings.nudgeMs);
    },

    syncNow() {
      wanted = true;
      asked = true;
      askedFull = true;
      // The user pressing the button is new information — they have probably
      // just fixed whatever the backoff was waiting out.
      failures = 0;
      if (phase === "running") return;
      arm(0);
    },
  };
}
