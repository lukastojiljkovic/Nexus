import { describe, expect, it } from "vitest";

import { InvalidStateError } from "../boards-shared/errors.js";
import { createRng } from "../boards-shared/rng.js";
import {
  BACKGAMMON_CHECKERS,
  BACKGAMMON_LEVELS,
  type BackgammonMove,
  type BackgammonState,
  applyDouble,
  applyMove,
  backgammonOpening,
  bestMove,
  canDouble,
  declineDouble,
  endTurn,
  evaluateFrom,
  fromJSON,
  initialState,
  legalMoves,
  pipCount,
  result,
  rollFor,
  toJSON,
} from "./backgammon.js";

/**
 * A position from a plain list of what each point holds. Every fixture has to
 * add up to fifteen checkers a side, because that is what `initialState`
 * checks — which is also why these tests say out loud where the rest are.
 */
function position(options: {
  points?: readonly number[];
  bar?: readonly [number, number];
  off?: readonly [number, number];
  toMove?: 0 | 1;
  dice?: readonly number[];
  cube?: number;
  cubeOwner?: 0 | 1 | null;
  cubeEnabled?: boolean;
}): BackgammonState {
  return initialState({
    points: options.points ?? new Array<number>(24).fill(0),
    bar: options.bar ?? [0, 0],
    off: options.off ?? [0, 0],
    toMove: options.toMove ?? 0,
    dice: options.dice ?? [],
    cube: options.cube ?? 1,
    cubeOwner: options.cubeOwner ?? null,
    cubeEnabled: options.cubeEnabled ?? false,
  });
}

/** One turn as a string, so a whole move set can be stated exactly. */
function describeMove(move: BackgammonMove): string {
  return move.plays.map((play) => `${String(play.from)}>${String(play.to)}/${play.die}`).join(" ");
}

describe("the opening", () => {
  it("is fifteen checkers a side, 167 pips each, and worth nothing to either", () => {
    const state = initialState();
    expect(pipCount(state, 0)).toBe(167);
    expect(pipCount(state, 1)).toBe(167);
    // By hand: no checker on the bar, four points made a side, no blot at all.
    expect(evaluateFrom(state, 0)).toBe(0);
    expect(evaluateFrom(state, 1)).toBe(0);
    expect(backgammonOpening().points).toHaveLength(24);
    expect(result(state)).toEqual({ status: "in_progress" });
  });

  it("rolls dice from the seeded source, one turn at a time", () => {
    const state = initialState();
    expect(() => legalMoves(state)).not.toThrow();
    expect(legalMoves(state)).toHaveLength(0);
    expect(() => bestMove(state, 3, createRng(1))).toThrowError(InvalidStateError);
    const rolled = rollFor(state, createRng(0x5eed));
    expect(rolled.dice.length === 4 || rolled.dice.length === 2).toBe(true);
    for (const die of rolled.dice) expect(die).toBeGreaterThanOrEqual(1);
    // A double is stored as the four plays it is worth.
    if ((rolled.dice[0] as number) === (rolled.dice[1] as number)) {
      expect(rolled.dice).toHaveLength(4);
    } else {
      expect(rolled.dice).toHaveLength(2);
    }
    expect(rollFor(state, createRng(0x5eed)).dice).toEqual(rolled.dice);
    expect(() => rollFor(rolled, createRng(1))).toThrowError(InvalidStateError);
    expect(legalMoves(rolled).length).toBeGreaterThan(0);
  });
});

describe("the bar", () => {
  // Seat 0 has one checker on the bar and fourteen on point 24; seat 1 holds
  // point 20 with two checkers, so entering with a 5 is blocked and entering
  // with a 3 is not.
  const BARRED = () => {
    const points = new Array<number>(24).fill(0);
    points[23] = 14;
    points[19] = -2;
    points[22] = -13;
    return position({ points, bar: [1, 0], dice: [3, 5], toMove: 0 });
  };

  it("must enter before anything else moves, and a blocked entry is no entry", () => {
    const moves = legalMoves(BARRED());
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      // Point 22 is entered with a 3 (index 21) and point 20 with a 5
      // (index 19), and index 19 holds two enemy checkers.
      expect(move.plays[0]?.from).toBe("bar");
      expect(move.plays.some((play) => play.to === 19)).toBe(false);
    }
    // The 5 cannot enter, so the 3 goes first and the 5 is then played from
    // point 24 (index 23) — one of the turns, stated in full.
    expect(moves.map(describeMove)).toContain("bar>21/3 23>18/5");
    // A checker already on the board may not move while one is on the bar.
    expect(() =>
      applyMove(BARRED(), { plays: [{ from: 23, to: 21, die: 2 }] }),
    ).toThrowError(InvalidStateError);
  });

  it("sends a hit checker to the bar", () => {
    const points = new Array<number>(24).fill(0);
    points[23] = 14;
    points[10] = 1;
    points[7] = -1;
    points[0] = -14;
    const state = position({ points, dice: [3, 1], toMove: 0 });
    const hit = legalMoves(state).find((move) => describeMove(move) === "10>7/3 23>22/1");
    expect(hit).toBeDefined();
    const after = applyMove(state, hit as BackgammonMove);
    expect(after.points[7]).toBe(1);
    expect(after.bar[1]).toBe(1);
    expect(after.toMove).toBe(1);
    expect(after.dice).toEqual([]);
  });
});

describe("the dice", () => {
  it("plays both dice when both can be played", () => {
    // Seat 0 has one checker on point 3 (index 2) and two on point 5 (index 4),
    // with twelve already off; seat 1 is parked on point 24.
    const points = new Array<number>(24).fill(0);
    points[2] = 1;
    points[4] = 2;
    points[23] = -15;
    const state = position({ points, off: [12, 0], dice: [3, 2] });
    const moves = legalMoves(state);
    expect(moves.every((move) => move.plays.length === 2)).toBe(true);
    // The 3 bears off from point 3 and the 2 brings point 5 down to point 3.
    expect(moves.map(describeMove)).toContain("2>off/3 4>2/2");
  });

  it("plays the larger die when only one of them can be played", () => {
    // One checker on point 1 (index 0) and fourteen off. A 5 bears it off (a
    // number larger than any point holding a checker); a 1 bears it off too,
    // but only one die can be used, and the rules say the larger one.
    const points = new Array<number>(24).fill(0);
    points[0] = 1;
    points[23] = -15;
    const state = position({ points, off: [14, 0], dice: [5, 1] });
    const moves = legalMoves(state);
    expect(moves.map(describeMove)).toEqual(["0>off/5"]);
  });

  it("bears off with a number higher than the furthest checker, and not from a lower one", () => {
    // Seat 0 has one checker on point 3 (index 2, three pips from home) and two
    // on point 4 (index 3, four pips), thirteen already off. A 5 is larger than
    // either distance, so it bears off the furthest checker — index 3 — and may
    // not be used on index 2, which still has a checker behind it.
    const points = new Array<number>(24).fill(0);
    points[2] = 1;
    points[3] = 2;
    points[23] = -15;
    const state = position({ points, off: [12, 0], dice: [5, 1] });
    const moves = legalMoves(state);
    expect(moves.some((move) => describeMove(move).includes("3>off/5"))).toBe(true);
    expect(moves.some((move) => describeMove(move).includes("2>off/5"))).toBe(false);
    // Both dice still have to be used, so the 1 is played as well.
    expect(moves.every((move) => move.plays.length === 2)).toBe(true);
    // Bearing off is refused while a checker is still outside the home board:
    const outside = new Array<number>(24).fill(0);
    outside[2] = 1;
    outside[3] = 2;
    outside[22] = 1;
    outside[23] = -15;
    expect(
      legalMoves(position({ points: outside, off: [11, 0], dice: [5, 1] })).some((move) =>
        describeMove(move).includes("off"),
      ),
    ).toBe(false);
  });

  it("passes the turn only when the dice cannot be played at all", () => {
    // A checker on the bar and both entry points blocked by two checkers each.
    const points = new Array<number>(24).fill(0);
    points[23] = 14;
    points[21] = -2;
    points[19] = -2;
    points[20] = -11;
    const state = position({ points, bar: [1, 0], dice: [3, 5] });
    expect(legalMoves(state)).toHaveLength(0);
    const passed = endTurn(state);
    expect(passed.toMove).toBe(1);
    expect(passed.dice).toEqual([]);
    expect(() =>
      endTurn(position({ points: backgammonOpening().points, dice: [3, 5] })),
    ).toThrowError(InvalidStateError);
  });
});

describe("the results", () => {
  /** Seat 0 with everything off, and seat 1 arranged by the test. */
  function finished(seatOne: readonly number[], offOne: number, cube = 1, cubeOwner: 0 | 1 | null = null): BackgammonState {
    return position({
      points: seatOne,
      off: [BACKGAMMON_CHECKERS, offOne],
      cube,
      cubeOwner,
    });
  }

  it("is a single when the loser has borne a checker off", () => {
    const points = new Array<number>(24).fill(0);
    points[23] = -14;
    expect(result(finished(points, 1))).toEqual({
      status: "win",
      winner: 0,
      kind: "single",
      multiplier: 1,
      cube: 1,
      points: 1,
    });
  });

  it("is a gammon when the loser has borne nothing off", () => {
    const points = new Array<number>(24).fill(0);
    points[23] = -15;
    expect(result(finished(points, 0))).toEqual({
      status: "win",
      winner: 0,
      kind: "gammon",
      multiplier: 2,
      cube: 1,
      points: 2,
    });
  });

  it("is a backgammon when the loser is also caught in the winner's home", () => {
    const points = new Array<number>(24).fill(0);
    points[23] = -14;
    // Point 1 (index 0) is in seat 0's home board.
    points[0] = -1;
    expect(result(finished(points, 0))).toEqual({
      status: "win",
      winner: 0,
      kind: "backgammon",
      multiplier: 3,
      cube: 1,
      points: 3,
    });
    // The same board on a cube of 2 owned by seat 0 is worth 6.
    expect(result(finished(points, 0, 2, 0))).toMatchObject({ points: 6, cube: 2 });
    // And a behind-the-lines checker that is NOT in the home board is a gammon.
    const late = new Array<number>(24).fill(0);
    late[23] = -14;
    late[6] = -1;
    expect(result(finished(late, 0))).toMatchObject({ kind: "gammon" });
  });
});

describe("the cube", () => {
  it("is out of play unless the option turns it on", () => {
    const state = position({ points: backgammonOpening().points });
    expect(canDouble(state, 0)).toBe(false);
    expect(() => applyDouble(state, 0)).toThrowError(InvalidStateError);
  });

  it("doubles and passes to the opponent, and a refusal scores the old cube", () => {
    const state = position({
      points: backgammonOpening().points,
      cube: 1,
      cubeEnabled: true,
    });
    // Only the side to move with no dice rolled, and only while the cube is
    // centred or already theirs.
    expect(canDouble(state, 0)).toBe(true);
    expect(canDouble(state, 1)).toBe(false);
    const offered = applyDouble(state, 0);
    expect(offered.cube).toBe(2);
    expect(offered.cubeOwner).toBe(1);
    expect(canDouble(offered, 0)).toBe(false);
    // The cube is seat 1's now, and it may double it again on its own turn.
    expect(canDouble({ ...offered, toMove: 1 }, 1)).toBe(true);
    expect(declineDouble(state, 0)).toEqual({ winner: 0, kind: "declined", points: 1 });
    // After the double the cube is seat 1's, and a refusal then scores 2.
    expect(declineDouble({ ...offered, toMove: 1 }, 1)).toEqual({
      winner: 1,
      kind: "declined",
      points: 2,
    });
    expect(() => declineDouble(offered, 0)).toThrowError(InvalidStateError);
    // Rolled dice mean the turn has started and the cube can no longer be
    // offered this turn.
    expect(canDouble({ ...state, dice: [3, 5] }, 0)).toBe(false);
  });
});

describe("the computer", () => {
  it("returns a legal turn at level 3 on a hundred rolled positions", () => {
    const random = createRng(0x5eed);
    let checked = 0;
    // A hundred positions: a thousand searches at level 3 kept this file busy for 170 s
    // on the CI runners, and every level-3 answer is drawn from `legalMoves` either way.
    for (let sample = 0; sample < 100; sample += 1) {
      let state = initialState();
      const turns = Math.floor(random() * 30);
      for (let turn = 0; turn < turns; turn += 1) {
        if (result(state).status === "win") break;
        state = rollFor(state, random);
        const moves = legalMoves(state);
        if (moves.length === 0) {
          state = endTurn(state);
          continue;
        }
        state = applyMove(state, moves[Math.floor(random() * moves.length)] as BackgammonMove);
      }
      if (result(state).status === "win") continue;
      state = rollFor(state, random);
      const moves = legalMoves(state);
      const choice = bestMove(state, 3, createRng(sample));
      expect(choice.nodes).toBeLessThanOrEqual(BACKGAMMON_LEVELS[2]!.nodeBudget);
      if (moves.length === 0) {
        expect(choice.move).toBeNull();
        continue;
      }
      checked += 1;
      expect(choice.move).not.toBeNull();
      expect(moves).toContainEqual(choice.move);
    }
    expect(checked).toBeGreaterThan(90);
  }, 300_000);

  it("stays inside every level's budget", () => {
    const random = createRng(0xbeef);
    let checked = 0;
    for (let sample = 0; sample < 200; sample += 1) {
      let state = initialState();
      for (let ply = 0; ply < 40; ply += 1) {
        if (result(state).status === "win") break;
        if (state.dice.length === 0) state = rollFor(state, random);
        const moves = legalMoves(state);
        state =
          moves.length === 0
            ? endTurn(state)
            : applyMove(state, moves[Math.floor(random() * moves.length)] as BackgammonMove);
      }
      if (result(state).status === "win") continue;
      if (state.dice.length === 0) state = rollFor(state, random);
      checked += 1;
      const level = 1 + (sample % 3);
      const choice = bestMove(state, level, createRng(sample));
      expect(choice.nodes).toBeLessThanOrEqual(BACKGAMMON_LEVELS[level - 1]!.nodeBudget);
      const moves = legalMoves(state);
      if (moves.length === 0) expect(choice.move).toBeNull();
      else expect(moves).toContainEqual(choice.move);
    }
    expect(checked).toBeGreaterThan(100);
  }, 180_000);
});

describe("the saved game", () => {
  it("round-trips through JSON", () => {
    const state = rollFor(
      position({ points: backgammonOpening().points, cube: 4, cubeOwner: 1, cubeEnabled: true }),
      createRng(7),
    );
    expect(fromJSON(toJSON(state))).toEqual(state);
    expect(fromJSON(JSON.parse(JSON.stringify(toJSON(state))) as unknown)).toEqual(state);
  });

  it("refuses a malformed or impossible saved game", () => {
    const points = backgammonOpening().points;
    expect(() => fromJSON(null)).toThrowError(InvalidStateError);
    expect(() => fromJSON({ points: [0], bar: [0, 0], off: [0, 0], toMove: 0, dice: [], cube: 1, cubeOwner: null, cubeEnabled: false })).toThrowError(
      InvalidStateError,
    );
    // Fourteen checkers a side is not a backgammon position.
    const short = points.slice();
    short[23] = 1;
    expect(() =>
      fromJSON({ points: short, bar: [0, 0], off: [0, 0], toMove: 0, dice: [], cube: 1, cubeOwner: null, cubeEnabled: false }),
    ).toThrowError(InvalidStateError);
    expect(() =>
      fromJSON({ points, bar: [0, 0], off: [0, 0], toMove: 0, dice: [7, 1], cube: 1, cubeOwner: null, cubeEnabled: false }),
    ).toThrowError(InvalidStateError);
    expect(() =>
      fromJSON({ points, bar: [0, 0], off: [0, 0], toMove: 0, dice: [], cube: 3, cubeOwner: null, cubeEnabled: false }),
    ).toThrowError(InvalidStateError);
    expect(() =>
      fromJSON({ points, bar: [0, 0], off: [0, 0], toMove: 2, dice: [], cube: 1, cubeOwner: null, cubeEnabled: false }),
    ).toThrowError(InvalidStateError);
  });
});
