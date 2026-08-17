import { describe, expect, it, vi } from "vitest";

import { SYNC_LOOP_DEFAULTS, createSyncLoop } from "./loop.js";
import type { SyncLoop, SyncLoopStatus, Timer } from "./loop.js";
import type { SyncRoundOptions, SyncRoundReport } from "./round.js";

const { intervalMs, nudgeMs, backoffMs, backoffMaxMs } = SYNC_LOOP_DEFAULTS;

function report(over: Partial<SyncRoundReport> = {}): SyncRoundReport {
  return {
    pulled: 0,
    applied: 0,
    pushed: 0,
    conflicts: 0,
    quarantined: 0,
    owed: 0,
    halted: null,
    ...over,
  };
}

// ─── A clock whose timers only fire when the test says so ───────────────────

interface Clock {
  now: () => number;
  readonly timer: Timer;
  /** Move time forward and fire everything that came due. */
  advance: (ms: number) => void;
  /** How many timers are armed. The loop must never hold more than one. */
  live: () => number;
}

function fakeClock(start = 1_700_000_000_000): Clock {
  let now = start;
  let next = 0;
  const armed = new Map<number, { at: number; fire: () => void }>();

  return {
    now: () => now,
    live: () => armed.size,
    timer: (ms, fire) => {
      next += 1;
      const id = next;
      armed.set(id, { at: now + ms, fire });
      return () => {
        armed.delete(id);
      };
    },
    advance(ms) {
      now += ms;
      for (const [id, entry] of [...armed]) {
        if (entry.at > now) continue;
        armed.delete(id);
        entry.fire();
      }
    },
  };
}

// ─── A round that answers whatever the test queued ──────────────────────────

interface Runner {
  readonly calls: SyncRoundOptions[];
  /** What the next rounds answer, in order. Exhausted means a quiet round. */
  readonly answers: (SyncRoundReport | Error)[];
  run: (options: SyncRoundOptions) => Promise<SyncRoundReport>;
  /** Make every round block until {@link Runner.release} is called. */
  hold: () => void;
  release: () => void;
}

function runner(): Runner {
  const calls: SyncRoundOptions[] = [];
  const answers: (SyncRoundReport | Error)[] = [];
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;

  return {
    calls,
    answers,
    hold() {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release() {
      open?.();
      gate = null;
      open = null;
    },
    async run(options) {
      calls.push(options);
      if (gate !== null) await gate;
      const answer = answers.shift() ?? report();
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

interface Harness {
  readonly loop: SyncLoop;
  readonly clock: Clock;
  readonly rounds: Runner;
  readonly seen: SyncLoopStatus[];
}

/** `random` defaults to 1, which makes every backoff its own ceiling exactly. */
function harness(random: () => number = () => 1): Harness {
  const clock = fakeClock();
  const rounds = runner();
  const seen: SyncLoopStatus[] = [];
  const loop = createSyncLoop({
    run: rounds.run,
    timer: clock.timer,
    now: clock.now,
    random,
    onChange: (status) => seen.push(status),
  });
  return { loop, clock, rounds, seen };
}

/** Wait for the round in flight, if there is one, to have been settled. */
async function idle(loop: SyncLoop): Promise<SyncLoopStatus> {
  await vi.waitFor(
    () => {
      expect(loop.status().phase).not.toBe("running");
    },
    { interval: 1 },
  );
  return loop.status();
}

/** Fire the armed wake and wait for the round it starts. */
async function fire(h: Harness): Promise<SyncLoopStatus> {
  const at = h.loop.status().nextRunAt;
  expect(at).not.toBeNull();
  h.clock.advance(at! - h.clock.now());
  return idle(h.loop);
}

/** How long the loop intends to wait from now. */
function delay(h: Harness): number {
  const at = h.loop.status().nextRunAt;
  expect(at).not.toBeNull();
  return at! - h.clock.now();
}

describe("the sync loop", () => {
  it("starts stopped, and holds no timer until it is told to run", () => {
    const h = harness();
    expect(h.loop.status().phase).toBe("stopped");
    expect(h.clock.live()).toBe(0);
  });

  it("runs a full round first — a round nobody asked for covers everything", async () => {
    const h = harness();
    h.loop.start();
    expect(delay(h)).toBe(nudgeMs);

    const status = await fire(h);
    expect(h.rounds.calls).toEqual([{}]);
    expect(status.phase).toBe("waiting");
    expect(status.lastRunAt).toBe(h.clock.now());
  });

  it("waits the interval after a quiet round", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);
    expect(delay(h)).toBe(intervalMs);
    expect(h.clock.live()).toBe(1);
  });

  it("runs only the collections a hint named", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);

    h.loop.nudge(["notes", "tasks"]);
    expect(delay(h)).toBe(nudgeMs);
    await fire(h);
    expect(h.rounds.calls[1]).toEqual({ collections: ["notes", "tasks"] });
  });

  it("upgrades a hinted wake to a full one when a hintless nudge arrives", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);

    h.loop.nudge(["notes"]);
    h.loop.nudge();
    await fire(h);
    expect(h.rounds.calls[1]).toEqual({});
  });

  it("does not push an armed wake later when a nudge arrives after it", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);
    h.loop.nudge(["notes"]);

    h.clock.advance(nudgeMs - 1);
    h.loop.nudge(["tasks"]);
    expect(delay(h)).toBe(1);

    await fire(h);
    expect(h.rounds.calls[1]).toEqual({ collections: ["notes", "tasks"] });
  });

  it("runs the full walk on its deadline, however many hints arrive first", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);
    const walked = h.clock.now();

    // A user typing steadily: a hinted round every few seconds, for longer than
    // the interval. Measured as a gap rather than a deadline, each of these
    // would postpone the complete walk and it would never happen at all.
    while (h.clock.now() + nudgeMs - walked < intervalMs) {
      h.loop.nudge(["notes"]);
      await fire(h);
      expect(h.rounds.calls.at(-1)).toEqual({ collections: ["notes"] });
      // Idle time between bursts, stopping just short of the armed wake: this
      // test is about what a NUDGED round covers, so the interval's own wake
      // must not be the thing that fires.
      const armed = h.loop.status().nextRunAt ?? h.clock.now();
      h.clock.advance(Math.min(5_000, Math.max(1, armed - h.clock.now() - 1)));
    }

    h.loop.nudge(["notes"]);
    await fire(h);
    expect(h.rounds.calls.at(-1)).toEqual({});
    expect(h.clock.now() - walked).toBeGreaterThanOrEqual(intervalMs);
  });

  it("never schedules the next round past the deadline", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);
    const walked = h.clock.now();

    h.clock.advance(10_000);
    h.loop.nudge(["notes"]);
    await fire(h);

    // A hinted round happened, and then silence. The wake it leaves behind is
    // the deadline itself, not an interval measured from the hinted round —
    // which would push the complete walk out by however late the nudge was.
    expect(h.loop.status().nextRunAt).toBe(walked + intervalMs);
  });

  it("does not let a round that halted pass for the walk it did not finish", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);
    const walked = h.clock.now();

    // Nearly a whole interval later, a full round starts and dies on the network.
    h.clock.advance(intervalMs - 20_000);
    h.rounds.hold();
    h.rounds.answers.push(report({ halted: "offline" }));
    h.loop.nudge();
    h.clock.advance(nudgeMs);
    // A hint lands while that round is in flight, so what the retry covers is
    // decided by the deadline and by nothing else.
    h.loop.nudge(["notes"]);
    h.rounds.release();
    await idle(h.loop);

    // The retry comes after the deadline. The round that halted walked nothing,
    // so the complete walk is still owed and this is the round that owes it.
    h.clock.advance(30_000);
    await idle(h.loop);
    expect(h.clock.now() - walked).toBeGreaterThan(intervalMs);
    expect(h.rounds.calls.at(-1)).toEqual({});
  });

  it("coalesces a burst of nudges into one round", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);

    for (let i = 0; i < 5; i += 1) h.loop.nudge(["notes"]);
    await fire(h);
    expect(h.rounds.calls).toHaveLength(2);
    expect(h.clock.live()).toBe(1);
  });

  it("serves a nudge that arrived mid-round with exactly one more round", async () => {
    const h = harness();
    h.rounds.hold();
    h.loop.start();
    h.clock.advance(nudgeMs);
    expect(h.loop.status().phase).toBe("running");

    h.loop.nudge(["notes"]);
    h.loop.nudge(["notes"]);
    expect(h.rounds.calls).toHaveLength(1);

    h.rounds.release();
    await idle(h.loop);
    expect(delay(h)).toBe(nudgeMs);

    await fire(h);
    expect(h.rounds.calls).toHaveLength(2);
    expect(h.rounds.calls[1]).toEqual({ collections: ["notes"] });
  });

  it("comes back soon after a conflict, because a pull is what resolves one", async () => {
    const h = harness();
    h.rounds.answers.push(report({ conflicts: 1, owed: 1 }));
    h.loop.start();
    await fire(h);
    expect(delay(h)).toBe(nudgeMs);
    expect(h.rounds.calls[1]).toBeUndefined();

    await fire(h);
    expect(h.rounds.calls[1]).toEqual({});
  });

  // ─── Failure ──────────────────────────────────────────────────────────────

  it("backs off when the network is not answering, doubling and then capping", async () => {
    const h = harness();
    for (let i = 0; i < 12; i += 1) h.rounds.answers.push(report({ halted: "offline" }));
    h.loop.start();

    await fire(h);
    expect(delay(h)).toBe(backoffMs);
    expect(h.loop.status().failures).toBe(1);

    await fire(h);
    expect(delay(h)).toBe(backoffMs * 2);
    await fire(h);
    expect(delay(h)).toBe(backoffMs * 4);

    for (let i = 0; i < 8; i += 1) await fire(h);
    expect(delay(h)).toBe(backoffMaxMs);
  });

  it("jitters the wait so two devices that fell over together do not return together", async () => {
    const low = harness(() => 0);
    low.rounds.answers.push(report({ halted: "offline" }));
    low.loop.start();
    await fire(low);
    expect(delay(low)).toBe(backoffMs / 2);
  });

  it("retries with a FULL round even when the round that failed was hinted", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);
    h.rounds.answers.push(report({ halted: "offline" }));
    h.loop.nudge(["notes"]);
    await fire(h);

    await fire(h);
    expect(h.rounds.calls[2]).toEqual({});
  });

  it("ignores a nudge while it is backing off — an edit does not fix a network", async () => {
    const h = harness();
    h.rounds.answers.push(report({ halted: "offline" }));
    h.loop.start();
    await fire(h);

    const at = h.loop.status().nextRunAt;
    h.loop.nudge(["notes"]);
    expect(h.loop.status().nextRunAt).toBe(at);
  });

  it("treats a malformed page as a delay, not as the end of the loop", async () => {
    const h = harness();
    h.rounds.answers.push(report({ halted: "malformed" }));
    h.loop.start();
    const status = await fire(h);
    expect(status.phase).toBe("waiting");
    expect(status.stoppedBy).toBeNull();
    expect(delay(h)).toBe(backoffMs);
  });

  it("survives a round that throws, and says what it was", async () => {
    const h = harness();
    h.rounds.answers.push(new Error("the database is locked"));
    h.loop.start();
    const status = await fire(h);

    expect(status.phase).toBe("waiting");
    expect(status.lastError).toBe("the database is locked");
    expect(status.lastReport).toBeNull();
    expect(delay(h)).toBe(backoffMs);

    const next = await fire(h);
    expect(next.lastError).toBeNull();
    expect(next.failures).toBe(0);
  });

  it("forgets the backoff after a round that worked", async () => {
    const h = harness();
    h.rounds.answers.push(report({ halted: "offline" }), report({ halted: "offline" }));
    h.loop.start();
    await fire(h);
    await fire(h);
    expect(h.loop.status().failures).toBe(2);

    await fire(h);
    expect(h.loop.status().failures).toBe(0);
    expect(delay(h)).toBe(intervalMs);
  });

  // ─── The two halts that end the loop ──────────────────────────────────────

  it("stops on a revoked session, and arms nothing — that is not a delay", async () => {
    const h = harness();
    h.rounds.answers.push(report({ halted: "forbidden" }));
    h.loop.start();
    const status = await fire(h);

    expect(status.phase).toBe("halted");
    expect(status.stoppedBy).toBe("forbidden");
    expect(status.nextRunAt).toBeNull();
    expect(h.clock.live()).toBe(0);

    h.clock.advance(intervalMs * 10);
    expect(h.rounds.calls).toHaveLength(1);
  });

  it("runs again after a revoked session once the caller has signed in", async () => {
    const h = harness();
    h.rounds.answers.push(report({ halted: "forbidden" }));
    h.loop.start();
    await fire(h);

    h.loop.start();
    expect(h.loop.status().phase).toBe("waiting");
    const status = await fire(h);
    expect(status.phase).toBe("waiting");
    expect(status.stoppedBy).toBeNull();
    expect(h.rounds.calls).toHaveLength(2);
  });

  it("a reused nonce stops the loop, and NOTHING starts it again", async () => {
    const h = harness();
    h.rounds.answers.push(report({ halted: "nonce-reuse" }));
    h.loop.start();
    const status = await fire(h);

    expect(status.phase).toBe("halted");
    expect(status.stoppedBy).toBe("nonce-reuse");
    expect(h.clock.live()).toBe(0);

    h.loop.start();
    h.loop.nudge();
    h.loop.nudge(["notes"]);
    h.loop.syncNow();
    h.clock.advance(backoffMaxMs * 100);
    await idle(h.loop);

    expect(h.rounds.calls).toHaveLength(1);
    expect(h.clock.live()).toBe(0);
    expect(h.loop.status().phase).toBe("halted");
    expect(h.loop.status().stoppedBy).toBe("nonce-reuse");

    // Nor may switching sync off take the reason off the screen with it.
    h.loop.stop();
    expect(h.loop.status().phase).toBe("halted");
    expect(h.loop.status().stoppedBy).toBe("nonce-reuse");
  });

  it("latches the nonce alarm even when the loop was stopped mid-round", async () => {
    const h = harness();
    h.rounds.hold();
    h.rounds.answers.push(report({ halted: "nonce-reuse" }));
    h.loop.start();
    h.clock.advance(nudgeMs);

    h.loop.stop();
    h.rounds.release();
    const status = await idle(h.loop);

    expect(status.phase).toBe("halted");
    expect(status.stoppedBy).toBe("nonce-reuse");
    h.loop.start();
    expect(h.loop.status().phase).toBe("halted");
  });

  // ─── Stopping, and asking for a round by hand ─────────────────────────────

  it("stops between rounds, keeping no timer", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);
    h.loop.stop();

    expect(h.loop.status().phase).toBe("stopped");
    expect(h.loop.status().nextRunAt).toBeNull();
    expect(h.clock.live()).toBe(0);
    h.clock.advance(intervalMs * 10);
    expect(h.rounds.calls).toHaveLength(1);
  });

  it("lets a round in flight finish, and schedules nothing after it", async () => {
    const h = harness();
    h.rounds.hold();
    h.loop.start();
    h.clock.advance(nudgeMs);
    expect(h.loop.status().phase).toBe("running");

    h.loop.stop();
    h.rounds.release();
    const status = await idle(h.loop);

    expect(status.phase).toBe("stopped");
    expect(h.clock.live()).toBe(0);
    expect(h.rounds.calls).toHaveLength(1);
  });

  it("ignores a nudge while it is stopped", () => {
    const h = harness();
    h.loop.nudge(["notes"]);
    expect(h.clock.live()).toBe(0);
    expect(h.loop.status().phase).toBe("stopped");
  });

  it("runs at once when the user asks, clearing the backoff", async () => {
    const h = harness();
    h.rounds.answers.push(report({ halted: "offline" }), report({ halted: "offline" }));
    h.loop.start();
    await fire(h);
    await fire(h);
    expect(h.loop.status().failures).toBe(2);

    h.loop.syncNow();
    expect(delay(h)).toBe(0);
    const status = await fire(h);
    expect(status.failures).toBe(0);
    expect(h.rounds.calls[2]).toEqual({});
  });

  it("runs a full round when the user asks during a hinted wait", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);
    h.loop.nudge(["notes"]);
    h.loop.syncNow();
    await fire(h);
    expect(h.rounds.calls[1]).toEqual({});
  });

  it("never runs two rounds at once", async () => {
    const h = harness();
    h.rounds.hold();
    h.loop.start();
    h.clock.advance(nudgeMs);

    h.loop.syncNow();
    h.loop.nudge();
    h.clock.advance(intervalMs);
    expect(h.rounds.calls).toHaveLength(1);

    h.rounds.release();
    await idle(h.loop);
    expect(h.rounds.calls).toHaveLength(1);
  });

  // ─── What the screen is told ─────────────────────────────────────────────

  it("reports every phase it passes through", async () => {
    const h = harness();
    h.loop.start();
    await fire(h);
    h.loop.stop();

    expect(h.seen.map((status) => status.phase)).toEqual([
      "waiting",
      "running",
      "waiting",
      "stopped",
    ]);
  });

  it("hands out a snapshot, not a view that changes underneath the reader", async () => {
    const h = harness();
    h.loop.start();
    const armed = h.loop.status();
    await fire(h);

    expect(armed.phase).toBe("waiting");
    expect(armed.lastRunAt).toBeNull();
    expect(h.loop.status().lastRunAt).not.toBeNull();
  });

  it("keeps the last report, so a screen can say what happened", async () => {
    const h = harness();
    h.rounds.answers.push(report({ pulled: 7, applied: 3, pushed: 2, owed: 1 }));
    h.loop.start();
    const status = await fire(h);

    expect(status.lastReport).toEqual(report({ pulled: 7, applied: 3, pushed: 2, owed: 1 }));
  });

  it("does not let a listener that throws take the loop down", async () => {
    const clock = fakeClock();
    const rounds = runner();
    const loop = createSyncLoop({
      run: rounds.run,
      timer: clock.timer,
      now: clock.now,
      onChange: () => {
        throw new Error("the window is gone");
      },
    });

    loop.start();
    clock.advance(nudgeMs);
    await vi.waitFor(
      () => {
        expect(loop.status().phase).toBe("waiting");
      },
      { interval: 1 },
    );
    expect(rounds.calls).toHaveLength(1);
  });
});
