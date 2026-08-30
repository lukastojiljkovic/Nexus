import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncHalt, SyncRoundReport, Timer } from "@nexus/sync-engine";

import type { SyncActivityView } from "../../shared/ipc.js";
import type { SyncRoundBlock, SyncRoundInput, SyncRoundOutcome } from "./round.js";
import { createSyncScheduler, type SyncScheduler } from "./scheduler.js";

/**
 * The scheduler is asked one question — what does THIS outcome mean — so a round
 * is a value the test hands it rather than something it has to provoke through a
 * fake server. What is checked here is which of the three destinations an
 * outcome lands in, and the two facts that have to outlive a profile switch.
 */

const REPORT: SyncRoundReport = {
  pulled: 0,
  applied: 0,
  pushed: 0,
  conflicts: 0,
  quarantined: 0,
  owed: 0,
  halted: null,
};

const ran = (halted: SyncHalt | null = null): SyncRoundOutcome => ({
  kind: "ran",
  report: { ...REPORT, halted },
  minted: false,
  unopenable: [],
});

const blocked = (reason: SyncRoundBlock): SyncRoundOutcome => ({
  kind: "blocked",
  reason,
  detail: null,
});

/** A macrotask, by which time every microtask the round queued has drained. */
const flush = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

interface Armed {
  readonly ms: number;
  readonly fire: () => void;
}

interface Harness {
  readonly scheduler: SyncScheduler;
  readonly calls: SyncRoundInput[];
  readonly changes: SyncActivityView[];
  /** What the next round answers, and whether it answers at all yet. */
  readonly state: { answer: SyncRoundOutcome; hold: boolean };
  /** Settle a held round. */
  readonly release: (outcome: SyncRoundOutcome) => void;
  /** Epoch milliseconds of the armed wake, or `null` when nothing is armed. */
  readonly armedAt: () => number | null;
  /** Run the armed timer and let the round it starts finish. */
  readonly tick: () => Promise<void>;
}

function harness(): Harness {
  let now = 1_000;
  let armed: Armed | null = null;
  const calls: SyncRoundInput[] = [];
  const changes: SyncActivityView[] = [];
  const state = { answer: ran(), hold: false };
  let held: ((outcome: SyncRoundOutcome) => void) | null = null;

  const timer: Timer = (ms, fire) => {
    const entry: Armed = { ms, fire };
    armed = entry;
    return () => {
      if (armed === entry) armed = null;
    };
  };

  const scheduler = createSyncScheduler({
    round: (input) => {
      calls.push(input);
      if (!state.hold) return Promise.resolve(state.answer);
      return new Promise<SyncRoundOutcome>((resolve) => {
        held = resolve;
      });
    },
    timer,
    clock: () => now,
    onChange: (activity) => changes.push(activity),
  });

  return {
    scheduler,
    calls,
    changes,
    state,
    release: (outcome) => {
      const resolve = held;
      held = null;
      resolve?.(outcome);
    },
    armedAt: () => (armed === null ? null : now + armed.ms),
    tick: async () => {
      const entry = armed;
      if (entry === null) throw new Error("nothing is armed");
      armed = null;
      now += entry.ms;
      entry.fire();
      await flush();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("what the scheduler is bound to", () => {
  it("holds nothing before a profile is opened", () => {
    const h = harness();
    expect(h.scheduler.status()).toMatchObject({
      profileId: null,
      phase: "stopped",
      problem: null,
      nextRunAt: null,
    });
  });

  it("runs rounds for the profile that is open", async () => {
    const h = harness();
    h.scheduler.open("p1");
    await h.tick();

    expect(h.calls).toEqual([{ profileId: "p1" }]);
    expect(h.scheduler.status()).toMatchObject({ profileId: "p1", phase: "waiting" });
  });

  it("re-opening the same profile changes nothing", async () => {
    const h = harness();
    h.scheduler.open("p1");
    await h.tick();
    const armed = h.armedAt();

    h.scheduler.open("p1");

    // Not merely „it did not run a round": a second `start()` on a fresh loop
    // arms at the NUDGE delay, so a screen that asks for its status once a
    // second would quietly turn a five-minute interval into one second.
    expect(h.armedAt()).toBe(armed);
    expect(h.calls).toHaveLength(1);
  });

  it("switching profiles binds rounds to the new one", async () => {
    const h = harness();
    h.scheduler.open("p1");
    await h.tick();
    h.scheduler.open("p2");
    await h.tick();

    expect(h.calls).toEqual([{ profileId: "p1" }, { profileId: "p2" }]);
  });

  it("closing stops the loop and forgets the profile", async () => {
    const h = harness();
    h.scheduler.open("p1");
    await h.tick();

    h.scheduler.close();

    expect(h.armedAt()).toBeNull();
    expect(h.scheduler.status()).toMatchObject({ profileId: null, phase: "stopped" });
  });
});

describe("the three destinations", () => {
  it("delays on a refusal a later round can resolve", async () => {
    for (const reason of ["offline", "malformed", "contested", "locked"] as const) {
      const h = harness();
      h.state.answer = blocked(reason);
      h.scheduler.open("p1");
      await h.tick();

      expect(h.scheduler.status()).toMatchObject({
        phase: "waiting",
        problem: reason,
        failures: 1,
      });

      // And the delay is a delay: the next wake runs another round.
      await h.tick();
      expect(h.calls).toHaveLength(2);
    }
  });

  it("halts on a refusal only a person can clear", async () => {
    for (const reason of ["forbidden", "signed_out"] as const) {
      const h = harness();
      h.state.answer = blocked(reason);
      h.scheduler.open("p1");
      await h.tick();

      expect(h.scheduler.status()).toMatchObject({ phase: "halted", problem: reason });
      expect(h.armedAt()).toBeNull();
    }
  });

  it("stops the loop when it should not be running at all", async () => {
    for (const reason of ["cloud_off", "not_enabled", "key_unavailable"] as const) {
      const h = harness();
      h.state.answer = blocked(reason);
      h.scheduler.open("p1");
      await h.tick();

      expect(h.scheduler.status()).toMatchObject({ phase: "stopped", problem: reason });
      expect(h.armedAt()).toBeNull();

      // Nothing brings it back on its own — and a nudge is what would, since a
      // local edit happens whether or not sync is in a position to do anything.
      h.scheduler.nudge(["notes"]);
      expect(h.armedAt()).toBeNull();
      expect(h.calls).toHaveLength(1);
    }
  });

  it("reports a halt the round itself met, and keeps going", async () => {
    const h = harness();
    h.state.answer = ran("offline");
    h.scheduler.open("p1");
    await h.tick();

    // The engine's own `offline` never reaches `stoppedBy` — the loop delays on
    // it rather than stopping — so without this mapping a device with no network
    // would show „nothing is wrong" for as long as it had none.
    expect(h.scheduler.status()).toMatchObject({ phase: "waiting", problem: "offline" });
  });

  it("clears the problem on the round that works", async () => {
    const h = harness();
    h.state.answer = blocked("locked");
    h.scheduler.open("p1");
    await h.tick();
    expect(h.scheduler.status().problem).toBe("locked");

    h.state.answer = ran();
    await h.tick();
    expect(h.scheduler.status()).toMatchObject({ problem: null, failures: 0 });
  });
});

describe("the nonce alarm", () => {
  it("latches for a profile, across a switch away and back", async () => {
    const h = harness();
    h.state.answer = ran("nonce-reuse");
    h.scheduler.open("p1");
    await h.tick();
    expect(h.scheduler.status()).toMatchObject({ phase: "halted", problem: "nonce_reuse" });

    h.state.answer = ran();
    h.scheduler.open("p2");
    await h.tick();
    expect(h.calls).toEqual([{ profileId: "p1" }, { profileId: "p2" }]);

    // Back to the poisoned one. A brand-new loop has a clean latch, which is
    // precisely what the scheduler's own record of it exists to survive.
    h.scheduler.open("p1");
    expect(h.armedAt()).toBeNull();
    expect(h.scheduler.status()).toMatchObject({
      profileId: "p1",
      phase: "stopped",
      problem: "nonce_reuse",
    });

    h.scheduler.syncNow();
    h.scheduler.nudge();
    expect(h.armedAt()).toBeNull();
    expect(h.calls).toHaveLength(2);
  });

  it("latches even when the round lands after a profile switch", async () => {
    const h = harness();
    h.state.hold = true;
    h.scheduler.open("p1");
    await h.tick();

    h.scheduler.open("p2");
    h.release(ran("nonce-reuse"));
    await flush();

    // The key is compromised whatever is on screen now, so the fact is recorded
    // by profile and outlives the switch that the OUTCOME does not.
    h.state.hold = false;
    h.scheduler.open("p1");
    expect(h.armedAt()).toBeNull();
    expect(h.scheduler.status().problem).toBe("nonce_reuse");
  });
});

describe("a round that outlives its profile", () => {
  it("does not file its outcome under the profile that is open now", async () => {
    const h = harness();
    h.state.hold = true;
    h.scheduler.open("p1");
    await h.tick();

    h.state.hold = false;
    h.scheduler.open("p2");
    const armed = h.armedAt();

    h.release(blocked("key_unavailable"));
    await flush();

    // p1's failure is p1's. p2 has not finished a round, so it has no problem —
    // and its loop is still armed: a `stop()` aimed at the loop that ran would
    // have hit the loop that did not.
    expect(h.scheduler.status()).toMatchObject({ profileId: "p2", problem: null });
    expect(h.armedAt()).toBe(armed);
  });
});

describe("what reaches the caller", () => {
  it("hints the round when a nudge names collections", async () => {
    const h = harness();
    h.scheduler.open("p1");
    await h.tick();

    h.scheduler.nudge(["notes", "tasks"]);
    await h.tick();

    expect(h.calls[1]).toEqual({ profileId: "p1", collections: ["notes", "tasks"] });
  });

  it("walks everything when nothing was hinted", async () => {
    const h = harness();
    h.scheduler.open("p1");
    await h.tick();

    h.scheduler.syncNow();
    await h.tick();

    expect(h.calls[1]).toEqual({ profileId: "p1" });
  });

  it("publishes an activity on every change", async () => {
    const h = harness();
    // `pulled` and `conflicts` are non-zero so that dropping them is OBSERVABLE:
    // a projection that carried them through would fail the `toEqual` below.
    h.state.answer = {
      kind: "ran",
      report: { ...REPORT, pulled: 9, applied: 3, conflicts: 4 },
      minted: true,
      unopenable: [],
    };
    h.scheduler.open("p1");
    await h.tick();

    expect(h.changes.map((change) => change.phase)).toEqual(["waiting", "waiting", "running", "waiting"]);
    expect(h.changes.at(-1)).toMatchObject({ profileId: "p1", problem: null });
    // `toEqual` rather than `toMatchObject`, which matches nested objects
    // partially and would therefore pass on exactly the leak this asserts.
    expect(h.changes.at(-1)?.lastRound).toEqual({
      applied: 3,
      pushed: 0,
      quarantined: 0,
      owed: 0,
    });
  });

  it("says out loud when a generation did not open", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = harness();
    h.state.answer = { kind: "ran", report: REPORT, minted: false, unopenable: [1, 2] };
    h.scheduler.open("p1");
    await h.tick();

    // Rows sealed at those epochs will quarantine, which is the designed answer
    // — and nothing else in the system would ever mention it out loud.
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("2 content key"), "1, 2");
  });
});
