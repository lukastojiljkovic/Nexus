import { describe, expect, it } from "vitest";

import { InvalidStateError } from "../boards-shared/errors.js";
import { createRng } from "../boards-shared/rng.js";
import {
  LUDO_DEFAULTS,
  LUDO_HOME,
  LUDO_LEVELS,
  LUDO_TOKENS,
  LUDO_TRACK,
  applyMove,
  bestMove,
  endTurn,
  evaluateFrom,
  fromJSON,
  initialState,
  legalMoves,
  ludoEntry,
  ludoFinished,
  ludoSquare,
  result,
  rollFor,
  toJSON,
  type LudoMove,
  type LudoState,
} from "./ludo.js";

/** A position from a list of tokens per seat, padded with tokens still in the yard. */
function board(
  seats: number,
  tokens: readonly (readonly number[])[],
  options: {
    toMove?: number;
    die?: number | null;
    sixes?: number;
    extraTurnOnSix?: boolean;
    threeSixesLoseTurn?: boolean;
    safeSquares?: boolean;
  } = {},
): LudoState {
  const filled = Array.from({ length: seats }, (_, seat) => {
    const given = tokens[seat] ?? [];
    const seatTokens = new Array<number>(LUDO_TOKENS).fill(0);
    for (let token = 0; token < given.length && token < LUDO_TOKENS; token += 1) {
      seatTokens[token] = given[token] as number;
    }
    return seatTokens;
  });
  return initialState({
    seats,
    tokens: filled,
    toMove: options.toMove ?? 0,
    die: options.die ?? null,
    sixes: options.sixes ?? 0,
    extraTurnOnSix: options.extraTurnOnSix,
    threeSixesLoseTurn: options.threeSixesLoseTurn,
    safeSquares: options.safeSquares,
  });
}

describe("the track", () => {
  it("puts the four entry squares thirteen apart and the home column last", () => {
    expect(ludoEntry(0)).toBe(0);
    expect(ludoEntry(1)).toBe(13);
    expect(ludoEntry(2)).toBe(26);
    expect(ludoEntry(3)).toBe(39);
    // The first step out of the yard is the seat's own entry square, the fiftieth
    // and fifty-first steps are the last two squares before the home column, and
    // progress 52 and up is the column itself, which has no track square.
    expect(ludoSquare(0, 1)).toBe(0);
    expect(ludoSquare(1, 1)).toBe(13);
    expect(ludoSquare(0, 51)).toBe(50);
    expect(ludoSquare(0, 52)).toBeNull();
    expect(ludoSquare(0, LUDO_HOME)).toBeNull();
    expect(LUDO_HOME).toBe(57);
    expect(LUDO_TRACK).toBe(52);
  });
});

describe("entering", () => {
  it("needs a six, and only a six", () => {
    const state = board(2, [[]], { die: 3 });
    expect(legalMoves(state)).toHaveLength(0);
    // A three with nothing to move is a turn that ends: the side passes.
    const passed = endTurn(state);
    expect(passed.toMove).toBe(1);
    expect(passed.die).toBeNull();

    const six = board(2, [[]], { die: 6 });
    expect(legalMoves(six).map((move) => move.token).sort()).toEqual([0, 1, 2, 3]);
    const entered = applyMove(six, { token: 2 });
    expect(entered.tokens[0]?.[2]).toBe(1);
    // The six earns another roll, so the same seat rolls again.
    expect(entered.toMove).toBe(0);
    expect(entered.die).toBeNull();
  });

  it("moves a token already out by the die, and refuses to overshoot home", () => {
    const state = board(2, [[LUDO_HOME - 2], []], { die: 5 });
    // 55 + 5 = 60 > 57: not playable, and the token is the only one out.
    expect(legalMoves(state)).toHaveLength(0);
    const exact = board(2, [[LUDO_HOME - 5], []], { die: 5 });
    expect(legalMoves(exact)).toEqual([{ token: 0 }]);
    const home = applyMove(exact, { token: 0 });
    expect(home.tokens[0]?.[0]).toBe(LUDO_HOME);
    expect(ludoFinished(home, 0)).toBe(false);
  });

  it("finishes a seat whose four tokens are home, and then moves nothing", () => {
    const won = board(2, [new Array<number>(LUDO_TOKENS).fill(LUDO_HOME), [1]], { die: 6 });
    expect(result(won)).toEqual({ status: "win", winner: 0, reason: "finished" });
    expect(legalMoves(won)).toHaveLength(0);
    expect(() => applyMove(won, { token: 0 })).toThrowError(InvalidStateError);
  });
});

describe("the capture", () => {
  it("sends an enemy token home when the landing square is not safe", () => {
    // Seat 0's token on progress 13 (square 12) lands on square 14 — seat 1's
    // token on progress 2 — and square 14 is nobody's entry square.
    const state = board(2, [[13], [2]], { die: 2 });
    expect(legalMoves(state)).toEqual([{ token: 0 }]);
    const after = applyMove(state, { token: 0 });
    expect(after.tokens[0]?.[0]).toBe(15);
    expect(after.tokens[1]?.[0]).toBe(0);
    expect(after.toMove).toBe(1);
  });

  it("leaves an enemy token alone on a safe square when the variant says so", () => {
    // Square 13 is seat 1's own entry square: safe under the default rule.
    const state = board(2, [[12], [1]], { die: 2 });
    expect(LUDO_DEFAULTS.safeSquares).toBe(true);
    const safe = applyMove(state, { token: 0 });
    expect(safe.tokens[0]?.[0]).toBe(14);
    expect(safe.tokens[1]?.[0]).toBe(1);
    // With the variant off, the same move takes it.
    const open = applyMove(board(2, [[12], [1]], { die: 2, safeSquares: false }), { token: 0 });
    expect(open.tokens[1]?.[0]).toBe(0);
  });
});

describe("the variants", () => {
  /** A seed whose first roll of a fresh generator is `face`. */
  function seedRolling(face: number): number {
    for (let seed = 1; seed < 10_000; seed += 1) {
      const rolled = rollFor(board(2, [], { toMove: 0 }), createRng(seed));
      if (rolled.die === face) return seed;
    }
    throw new Error(`no seed rolls a ${face}`);
  }

  it("grants another roll for a six, or passes the turn, by the option", () => {
    const seed = seedRolling(6);
    const extra = rollFor(board(2, [], { extraTurnOnSix: true }), createRng(seed));
    expect(extra.die).toBe(6);
    const moved = applyMove(extra, { token: 0 });
    expect(moved.toMove).toBe(0);
    expect(moved.die).toBeNull();

    const single = rollFor(board(2, [], { extraTurnOnSix: false }), createRng(seed));
    const movedOn = applyMove(single, { token: 0 });
    expect(movedOn.toMove).toBe(1);
  });

  it("loses the turn on a third six, or keeps it, by the option", () => {
    const seed = seedRolling(6);
    const lost = rollFor(
      board(2, [], { sixes: 2, threeSixesLoseTurn: true, toMove: 0 }),
      createRng(seed),
    );
    expect(lost.toMove).toBe(1);
    expect(lost.die).toBeNull();
    expect(lost.sixes).toBe(0);

    const kept = rollFor(
      board(2, [], { sixes: 2, threeSixesLoseTurn: false, toMove: 0 }),
      createRng(seed),
    );
    expect(kept.toMove).toBe(0);
    expect(kept.die).toBe(6);
    expect(kept.sixes).toBe(3);
    // A non-six roll clears the run of sixes.
    const notSix = rollFor(board(2, [], { sixes: 2 }), createRng(seedRolling(1)));
    expect(notSix.sixes).toBe(0);
  });

  it("seats two to four and passes the turn in seat order", () => {
    for (const seats of [2, 3, 4]) {
      const state = board(seats, [], { toMove: 0, die: 3 });
      expect(state.tokens).toHaveLength(seats);
      expect(endTurn(state).toMove).toBe(1);
    }
    // A four-seat turn order walks 0, 1, 2, 3 and comes back to 0.
    let state = board(4, [], { toMove: 0, die: 3 });
    const order: number[] = [];
    for (let step = 0; step < 4; step += 1) {
      order.push(state.toMove);
      // Nothing can move on a three, so each seat passes its turn.
      state = { ...endTurn(state), die: 3 };
    }
    expect(order).toEqual([0, 1, 2, 3]);
  });
});

describe("the computer", () => {
  it("returns a legal move at level 3 on a thousand rolled positions", () => {
    const random = createRng(0x5eed);
    let checked = 0;
    for (let sample = 0; sample < 1_000; sample += 1) {
      const seats = 2 + (sample % 3);
      let state = initialState({ seats });
      // Enough turns that the six a token needs to leave the yard has usually
      // come and gone, so the position has something to decide.
      const turns = 15 + Math.floor(random() * 30);
      for (let turn = 0; turn < turns; turn += 1) {
        if (result(state).status !== "in_progress") break;
        state = rollFor(state, random);
        // A third six takes the turn with it, leaving no die to play.
        if (state.die === null) continue;
        const moves = legalMoves(state);
        if (moves.length === 0) {
          state = endTurn(state);
          continue;
        }
        state = applyMove(state, moves[Math.floor(random() * moves.length)] as LudoMove);
      }
      if (result(state).status !== "in_progress") continue;
      if (state.die === null) state = rollFor(state, random);
      // A third six can leave the next seat to roll and no die to play.
      if (state.die === null) continue;
      const moves = legalMoves(state);
      const choice = bestMove(state, 3, createRng(sample));
      expect(choice.nodes).toBeLessThanOrEqual(LUDO_LEVELS[2]!.nodeBudget);
      if (moves.length === 0) {
        expect(choice.move).toBeNull();
        continue;
      }
      checked += 1;
      expect(choice.move).not.toBeNull();
      expect(moves).toContainEqual(choice.move);
    }
    // A thousand positions go in; the ones where a die was forfeited to a third
    // six or where nothing can move are not a choice and are counted out.
    expect(checked).toBeGreaterThan(700);
  }, 300_000);

  it("stays inside every level's budget, and takes the capture on offer", () => {
    const random = createRng(0xbeef);
    let checked = 0;
    for (let sample = 0; sample < 200; sample += 1) {
      let state = initialState({ seats: 2 + (sample % 3) });
      for (let turn = 0; turn < 30; turn += 1) {
        if (result(state).status !== "in_progress") break;
        if (state.die === null) state = rollFor(state, random);
        if (state.die === null) continue;
        const moves = legalMoves(state);
        state =
          moves.length === 0
            ? endTurn(state)
            : applyMove(state, moves[Math.floor(random() * moves.length)] as LudoMove);
      }
      if (result(state).status !== "in_progress") continue;
      if (state.die === null) state = rollFor(state, random);
      if (state.die === null) continue;
      const level = 1 + (sample % 3);
      const choice = bestMove(state, level, createRng(sample));
      expect(choice.nodes).toBeLessThanOrEqual(LUDO_LEVELS[level - 1]!.nodeBudget);
      const moves = legalMoves(state);
      if (moves.length === 0) expect(choice.move).toBeNull();
      else {
        checked += 1;
        expect(moves).toContainEqual(choice.move);
      }
    }
    expect(checked).toBeGreaterThan(50);

    // Seat 0 may take seat 1's token on square 50 — seat 1 has carried it 38 of
    // its 57 steps — or walk another token on. A capture takes back everything
    // that token had travelled.
    const onOffer = board(2, [[49, 20], [38]], { die: 2 });
    const legal = legalMoves(onOffer);
    expect(legal).toContainEqual({ token: 0 });
    expect(legal).toContainEqual({ token: 1 });
    const choice = bestMove(onOffer, 1, createRng(3));
    expect(choice.move).toEqual({ token: 0 });
    const taken = applyMove(onOffer, { token: 0 });
    expect(taken.tokens[1]?.[0]).toBe(0);
    expect(evaluateFrom(taken, 0)).toBeGreaterThan(evaluateFrom(applyMove(onOffer, { token: 1 }), 0));
  }, 180_000);
});

describe("the saved game", () => {
  it("round-trips through JSON", () => {
    const state = rollFor(board(3, [[3, 7], [1]], { toMove: 2, extraTurnOnSix: false }), createRng(5));
    expect(state.die).not.toBeNull();
    expect(fromJSON(toJSON(state))).toEqual(state);
    expect(fromJSON(JSON.parse(JSON.stringify(toJSON(state))) as unknown)).toEqual(state);
    // A state between rolls, with the die still to come, round-trips too.
    const waiting = { ...state, die: null };
    expect(fromJSON(toJSON(waiting))).toEqual(waiting);
  });

  it("refuses a malformed or impossible saved game", () => {
    const good = toJSON(board(2, [[1], [2]], { die: 3 }));
    expect(() => fromJSON(null)).toThrowError(InvalidStateError);
    expect(() => fromJSON({ ...good, seats: 1 })).toThrowError(InvalidStateError);
    expect(() => fromJSON({ ...good, seats: 5 })).toThrowError(InvalidStateError);
    expect(() => fromJSON({ ...good, tokens: [[1]] })).toThrowError(InvalidStateError);
    expect(() => fromJSON({ ...good, tokens: [[1, 2, 3, 99], []] })).toThrowError(
      InvalidStateError,
    );
    expect(() => fromJSON({ ...good, toMove: 2 })).toThrowError(InvalidStateError);
    expect(() => fromJSON({ ...good, die: 7 })).toThrowError(InvalidStateError);
    expect(() => fromJSON({ ...good, sixes: 9 })).toThrowError(InvalidStateError);
    expect(() => fromJSON({ ...good, safeSquares: "yes" })).toThrowError(InvalidStateError);
  });
});
