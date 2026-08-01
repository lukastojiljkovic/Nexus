import { DEFAULT_FOCUS_CONFIG } from "@nexus/core";
import { describe, expect, it } from "vitest";

import type { FocusSession } from "../../shared/ipc.js";
import { focusDayTotals, plannedWorkPhases, upcomingPhase } from "./focusPhases.js";

/**
 * „Fokus"'s page-level derivations, kept out of the component for
 * `habitDone.ts`'s reason: what counts towards a cycle, and what a day adds up
 * to, are rules — and a rule inside a `.tsx` is a rule nothing can test.
 */

let seq = 0;

function session(fields: Partial<FocusSession>): FocusSession {
  seq += 1;
  return {
    id: `s${seq}`,
    profileId: "p",
    subjectId: null,
    startedAt: "2026-08-01T09:00:00.000Z",
    endedAt: "2026-08-01T09:25:00.000Z",
    kind: "work",
    plannedMinutes: 25,
    pausedSeconds: 0,
    outcome: "completed",
    cycleIndex: 0,
    taskId: null,
    label: null,
    createdAt: "2026-08-01T09:25:00.000Z",
    updatedAt: "2026-08-01T09:25:00.000Z",
    ...fields,
  };
}

describe("plannedWorkPhases", () => {
  it("counts the work phases that carried a PLAN, and nothing else", () => {
    expect(
      plannedWorkPhases([
        session({}),
        session({}),
        session({ kind: "short_break", plannedMinutes: 5 }),
        session({ kind: "long_break", plannedMinutes: 15 }),
      ]),
    ).toBe(2);
  });

  // An open-ended session is STUDY's timer: „uči dok ne staneš", which is not a
  // Pomodoro work phase and did not earn a place in anybody's cycle. Counting it
  // would let an afternoon of studying push the timer into a long break the user
  // never worked towards.
  it("does not count an OPEN-ENDED work session towards the cycle", () => {
    expect(plannedWorkPhases([session({ plannedMinutes: null }), session({})])).toBe(1);
  });

  // A phase you stopped at nineteen minutes is still a work phase that happened,
  // and the break after it is one you did work for. The outcome records HOW it
  // ended, never whether it counts — which is the same rule `statsByKind` follows
  // when it sums attention with no asterisk about outcomes.
  it("counts a stopped phase exactly like a completed one", () => {
    expect(plannedWorkPhases([session({ outcome: "stopped" }), session({ outcome: null })])).toBe(2);
  });

  it("is 0 for an empty day", () => {
    expect(plannedWorkPhases([])).toBe(0);
  });
});

describe("upcomingPhase", () => {
  /** A day's phases in the order they ran — each one starting after the last. */
  function day(...kinds: readonly ("work" | "short_break" | "long_break")[]) {
    return kinds.map((kind, index) =>
      session({
        kind,
        plannedMinutes: kind === "work" ? 25 : 5,
        startedAt: `2026-08-01T${String(9 + index).padStart(2, "0")}:00:00.000Z`,
        endedAt: `2026-08-01T${String(9 + index).padStart(2, "0")}:25:00.000Z`,
      }),
    );
  }

  it("opens a fresh day on work, and follows the classic four-then-long rule", () => {
    const c = DEFAULT_FOCUS_CONFIG;
    expect(upcomingPhase(c, [])).toEqual({ kind: "work", plannedMinutes: c.workMinutes });
    expect(upcomingPhase(c, day("work"))).toEqual({
      kind: "short_break",
      plannedMinutes: c.shortBreakMinutes,
    });
    expect(
      upcomingPhase(
        c,
        day("work", "short_break", "work", "short_break", "work", "short_break", "work"),
      ),
    ).toEqual({ kind: "long_break", plannedMinutes: c.longBreakMinutes });
  });

  // `nextPhase` deliberately does not model this — a function taking one number
  // could not tell a just-finished break from a just-finished work phase — so
  // the caller has to look at what actually ran last. Without it, finishing a
  // short break would go on suggesting the same short break, because the work
  // count has not moved and the engine would keep answering the question it was
  // last asked.
  it("goes back to work after a break, whatever kind it was", () => {
    expect(upcomingPhase(DEFAULT_FOCUS_CONFIG, day("work", "short_break")).kind).toBe("work");
    expect(
      upcomingPhase(
        DEFAULT_FOCUS_CONFIG,
        day("work", "short_break", "work", "short_break", "work", "short_break", "work", "long_break"),
      ).kind,
    ).toBe("work");
  });

  it("decides which phase was last from the clock rather than from the array's order", () => {
    // The store answers newest-first, so a caller handing the list straight in
    // must get the same answer as one that reversed it.
    const ran = day("work", "short_break");
    expect(upcomingPhase(DEFAULT_FOCUS_CONFIG, [...ran].reverse()).kind).toBe("work");
  });

  it("reads its lengths from the config it was handed, never from a constant of its own", () => {
    const config = {
      workMinutes: 50,
      shortBreakMinutes: 10,
      longBreakMinutes: 30,
      cyclesBeforeLongBreak: 2,
    };
    expect(upcomingPhase(config, [])).toEqual({ kind: "work", plannedMinutes: 50 });
    expect(upcomingPhase(config, day("work"))).toEqual({
      kind: "short_break",
      plannedMinutes: 10,
    });
    expect(upcomingPhase(config, day("work", "short_break", "work"))).toEqual({
      kind: "long_break",
      plannedMinutes: 30,
    });
  });
});

describe("focusDayTotals", () => {
  it("answers all three kinds always, so a day with no break says so with a zero", () => {
    const totals = focusDayTotals([session({})]);
    expect(totals.work).toEqual({ sessions: 1, minutes: 25 });
    // The whole point of the zero: somebody who never takes a break must be able
    // to SEE that, and an absent row would read as „no data" instead.
    expect(totals.short_break).toEqual({ sessions: 0, minutes: 0 });
    expect(totals.long_break).toEqual({ sessions: 0, minutes: 0 });
  });

  it("sums ATTENTION, not wall time — a paused stretch is not focus", () => {
    const totals = focusDayTotals([
      session({ startedAt: "2026-08-01T09:00:00.000Z", endedAt: "2026-08-01T09:45:00.000Z", pausedSeconds: 900 }),
    ]);
    expect(totals.work).toEqual({ sessions: 1, minutes: 30 });
  });

  it("groups by kind and adds up across sessions", () => {
    const totals = focusDayTotals([
      session({}),
      session({}),
      session({
        kind: "short_break",
        plannedMinutes: 5,
        startedAt: "2026-08-01T09:25:00.000Z",
        endedAt: "2026-08-01T09:30:00.000Z",
      }),
    ]);
    expect(totals.work).toEqual({ sessions: 2, minutes: 50 });
    expect(totals.short_break).toEqual({ sessions: 1, minutes: 5 });
  });

  it("is all zeros for an empty day rather than an empty object", () => {
    expect(focusDayTotals([])).toEqual({
      work: { sessions: 0, minutes: 0 },
      short_break: { sessions: 0, minutes: 0 },
      long_break: { sessions: 0, minutes: 0 },
    });
  });
});
