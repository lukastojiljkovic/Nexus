import { describe, expect, it } from "vitest";

import { InvalidStateError } from "../boards-shared/errors.js";
import { createRng } from "../boards-shared/rng.js";
import {
  MLIN_DRAW_PLIES,
  MLIN_LEVELS,
  MLIN_MILLS,
  MLIN_NEIGHBOURS,
  MLIN_PER_SIDE,
  MLIN_POINTS,
  applyMove,
  bestMove,
  evaluate,
  fromJSON,
  initialState,
  legalMoves,
  mlinFlies,
  mlinInHand,
  mlinMills,
  mlinOnBoard,
  mlinPointsInMills,
  result,
  toJSON,
  type MlinMove,
  type MlinPoint,
  type MlinState,
} from "./mlin.js";

/** A board from a list of `[point, piece]`, with the rest empty. */
function board(
  entries: readonly (readonly [number, number])[],
  options: { toMove?: 0 | 1; placed?: readonly [number, number]; sinceProgress?: number } = {},
): MlinState {
  const points = new Array<MlinPoint>(MLIN_POINTS).fill(0);
  for (const [point, piece] of entries) {
    if (points[point] !== 0) throw new Error(`point ${point} given twice`);
    points[point] = piece as MlinPoint;
  }
  return initialState({
    points,
    toMove: options.toMove ?? 0,
    placed: options.placed ?? [MLIN_PER_SIDE, MLIN_PER_SIDE],
    sinceProgress: options.sinceProgress ?? 0,
  });
}

/** One move as one string, so a test can state a whole move set exactly. */
function describeMove(move: MlinMove): string {
  const taken = move.remove === null ? "" : `-take:${move.remove}`;
  if (move.kind === "place") return `place:${move.point}${taken}`;
  return `move:${move.from}>${move.to}${taken}`;
}

const BEFORE_MILL = [
  [0, 1],
  [1, 1],
  [14, 2],
  [20, 2],
] as const;

describe("the board", () => {
  it("has sixteen lines, every point on exactly two of them, and adjacent mids", () => {
    expect(MLIN_NEIGHBOURS).toHaveLength(MLIN_POINTS);
    expect(MLIN_MILLS).toHaveLength(16);
    // Hand-checked against the drawn board: the outer square is 0-1-2 above,
    // and the inner square's right edge is 8-12-17.
    expect([...MLIN_NEIGHBOURS[0]!]).toEqual([1, 9]);
    expect([...MLIN_NEIGHBOURS[12]!]).toEqual([8, 13, 17]);
    // Adjacency is symmetric, no point is its own neighbour, and every mill is
    // a line: its middle point is adjacent to both ends, and its ends are not
    // adjacent to each other.
    for (let point = 0; point < MLIN_POINTS; point += 1) {
      const neighbours = MLIN_NEIGHBOURS[point] as readonly number[];
      expect(neighbours).not.toContain(point);
      for (const neighbour of neighbours) {
        expect(MLIN_NEIGHBOURS[neighbour] as readonly number[]).toContain(point);
      }
    }
    for (const mill of MLIN_MILLS) {
      const [first, middle, last] = mill as readonly number[];
      expect(MLIN_NEIGHBOURS[middle as number] as readonly number[]).toContain(first as number);
      expect(MLIN_NEIGHBOURS[middle as number] as readonly number[]).toContain(last as number);
      expect(MLIN_NEIGHBOURS[first as number] as readonly number[]).not.toContain(last as number);
    }
    // Every point lies on exactly two of the sixteen lines: one drawn line and
    // one perpendicular to it, which is a property of the board.
    for (let point = 0; point < MLIN_POINTS; point += 1) {
      expect(MLIN_MILLS.filter((mill) => mill.includes(point))).toHaveLength(2);
    }
  });
});

describe("the opening", () => {
  it("offers every empty point and nothing else", () => {
    const state = initialState();
    expect(state.points).toHaveLength(MLIN_POINTS);
    expect(mlinInHand(state, 0)).toBe(MLIN_PER_SIDE);
    const moves = legalMoves(state);
    expect(moves).toHaveLength(MLIN_POINTS);
    expect(moves.every((move) => move.kind === "place" && move.remove === null)).toBe(true);
  });
});

describe("the mill", () => {
  it("is formed by the third piece, and carries the piece it takes", () => {
    const state = board(BEFORE_MILL, { toMove: 0, placed: [2, 2] });
    expect(mlinMills(state.points, 0)).toEqual([]);
    const moves = legalMoves(state);
    // Twenty points are empty with four pieces on the board, and exactly one
    // of them — point 2 — forms 0-1-2 with two pieces to choose between.
    expect(moves).toHaveLength(21);
    expect(moves.filter((move) => move.remove === null)).toHaveLength(19);
    expect(moves.filter((move) => move.remove !== null).map(describeMove).sort()).toEqual([
      "place:2-take:14",
      "place:2-take:20",
    ]);

    const milled = applyMove(state, { kind: "place", point: 2, remove: 14 });
    expect(mlinMills(milled.points, 0)).toEqual([[0, 1, 2]]);
    expect(mlinPointsInMills(milled.points, 0)).toEqual([0, 1, 2]);
    expect(milled.points[14]).toBe(0);
    expect(milled.points[2]).toBe(1);
    expect(milled.placed).toEqual([3, 2]);
    // The turn has moved on: the removal was part of the same move.
    expect(milled.toMove).toBe(1);
    expect(milled.sinceProgress).toBe(0);
    expect(mlinInHand(milled, 0)).toBe(MLIN_PER_SIDE - 3);
    // A mill that takes nothing is not a move, and neither is taking a piece
    // that is not standing on a point.
    expect(() => applyMove(state, { kind: "place", point: 2, remove: null })).toThrowError(
      InvalidStateError,
    );
    expect(() => applyMove(state, { kind: "place", point: 2, remove: 9 })).toThrowError(
      InvalidStateError,
    );
  });

  it("protects a piece in a mill, unless every opponent piece is in one", () => {
    // Seat 1 has a mill of its own (9-10-11) and two pieces outside it.
    const guarded = board(
      [
        [0, 1],
        [1, 1],
        [9, 2],
        [10, 2],
        [11, 2],
        [14, 2],
        [20, 2],
      ],
      { toMove: 0, placed: [2, 5] },
    );
    // Hand-checked: 9, 10 and 11 stand in a mill and may not be taken while 14
    // and 20 stand outside one.
    expect(
      legalMoves(guarded)
        .filter((move) => move.remove !== null)
        .map(describeMove)
        .sort(),
    ).toEqual(["place:2-take:14", "place:2-take:20"]);
    expect(() => applyMove(guarded, { kind: "place", point: 2, remove: 9 })).toThrowError(
      InvalidStateError,
    );

    // The same mill with nothing outside it: any of the three may go.
    const allIn = board(
      [
        [0, 1],
        [1, 1],
        [9, 2],
        [10, 2],
        [11, 2],
      ],
      { toMove: 0, placed: [2, 3] },
    );
    expect(
      legalMoves(allIn)
        .filter((move) => move.remove !== null)
        .map(describeMove)
        .sort(),
    ).toEqual(["place:2-take:10", "place:2-take:11", "place:2-take:9"]);
    const taken = applyMove(allIn, { kind: "place", point: 2, remove: 10 });
    expect(mlinMills(taken.points, 1)).toEqual([]);
  });

  it("takes nothing when the opponent has nothing on the board", () => {
    // Seat 1 has placed two pieces and has none of them left on the board.
    const state = board(
      [
        [0, 1],
        [1, 1],
      ],
      { toMove: 0, placed: [2, 2] },
    );
    expect(legalMoves(state).filter((move) => move.remove !== null)).toHaveLength(0);
    const milled = applyMove(state, { kind: "place", point: 2, remove: null });
    expect(milled.toMove).toBe(1);
    expect(mlinMills(milled.points, 0)).toEqual([[0, 1, 2]]);
  });
});

describe("the moving phase", () => {
  it("walks one point along a line when the side has more than three pieces", () => {
    const state = board([
      [0, 1],
      [22, 1],
      [6, 1],
      [8, 1],
      [1, 2],
      [21, 2],
    ]);
    expect(mlinFlies(state, 0)).toBe(false);
    // Hand-checked, point by point: 0 has 9 free; 22 has 19 and 23; 6 has 7 and
    // 11; and 8 has 7 and 12 — seven moves, every one of them adjacent.
    const moves = legalMoves(state);
    expect(moves).toHaveLength(7);
    expect(moves.every((move) => move.remove === null)).toBe(true);
    for (const move of moves) {
      if (move.kind !== "move") throw new Error("expected a move");
      expect(MLIN_NEIGHBOURS[move.from] as readonly number[]).toContain(move.to);
    }
    expect(() => applyMove(state, { kind: "move", from: 0, to: 3, remove: null })).toThrowError(
      InvalidStateError,
    );
  });

  it("flies with exactly three pieces", () => {
    const state = board([
      [0, 1],
      [6, 1],
      [8, 1],
      [1, 2],
      [21, 2],
    ]);
    expect(mlinFlies(state, 0)).toBe(true);
    // Three pieces, and 24 - 3 - 2 = 19 empty points for each of them: 57
    // moves, and a fifty-eighth because flying from 0 onto 7 completes the mill
    // 6-7-8, which makes that one move a choice of two removals.
    const moves = legalMoves(state);
    expect(moves).toHaveLength(58);
    expect(moves).toContainEqual({ kind: "move", from: 0, to: 23, remove: null });
    expect(moves).toContainEqual({ kind: "move", from: 8, to: 20, remove: null });
    expect(
      moves.filter((move) => move.remove !== null).map(describeMove).sort(),
    ).toEqual(["move:0>7-take:1", "move:0>7-take:21"]);
  });

  it("does not fly with four pieces", () => {
    const state = board([
      [0, 1],
      [6, 1],
      [8, 1],
      [23, 1],
      [1, 2],
      [21, 2],
    ]);
    expect(mlinFlies(state, 0)).toBe(false);
    expect(legalMoves(state)).not.toContainEqual({ kind: "move", from: 0, to: 23, remove: null });
  });
});

describe("the end", () => {
  it("is a loss at two pieces once the hand is empty", () => {
    const state = board([
      [0, 1],
      [1, 1],
    ]);
    expect(result(state)).toEqual({ status: "win", winner: 1, reason: "pieces" });
  });

  it("is a loss for a side walled in", () => {
    // Hand-checked: seat 0's four pieces on 0, 6, 8 and 23 have every one of
    // their neighbours occupied, and none of them forms a mill.
    const state = board(
      [
        [0, 1],
        [6, 1],
        [8, 1],
        [23, 1],
        [1, 2],
        [7, 2],
        [9, 2],
        [11, 2],
        [12, 2],
        [14, 2],
        [20, 2],
        [22, 2],
      ],
      { placed: [MLIN_PER_SIDE, 8] },
    );
    expect(mlinOnBoard(state.points, 1)).toBe(8);
    expect(legalMoves(state)).toHaveLength(0);
    expect(result(state)).toEqual({ status: "win", winner: 1, reason: "no-moves" });
  });

  it("draws after sixty plies with nothing removed", () => {
    expect(MLIN_DRAW_PLIES).toBe(60);
    const near = [
      [0, 1],
      [6, 1],
      [8, 1],
      [23, 1],
      [1, 2],
      [7, 2],
      [9, 2],
    ] as const;
    expect(result(board(near, { sinceProgress: MLIN_DRAW_PLIES }))).toEqual({
      status: "draw",
      winner: null,
      reason: "no-progress",
    });
    expect(result(board(near, { sinceProgress: MLIN_DRAW_PLIES - 1 })).status).toBe("in_progress");
  });
});

describe("a short scripted game", () => {
  it("places, mills, takes and hands the turn over, move by move", () => {
    let state = initialState();
    const script: readonly MlinMove[] = [
      { kind: "place", point: 0, remove: null },
      { kind: "place", point: 21, remove: null },
      { kind: "place", point: 1, remove: null },
      { kind: "place", point: 22, remove: null },
      // The third piece of 0-1-2: a mill, and 21 is not in one, so it goes.
      { kind: "place", point: 2, remove: 21 },
      { kind: "place", point: 23, remove: null },
    ];
    for (const move of script) state = applyMove(state, move);
    expect(state.placed).toEqual([3, 3]);
    expect(state.points[0]).toBe(1);
    expect(state.points[1]).toBe(1);
    expect(state.points[2]).toBe(1);
    expect(state.points[21]).toBe(0);
    expect(state.points[22]).toBe(2);
    expect(state.points[23]).toBe(2);
    expect(state.toMove).toBe(0);
    expect(result(state).status).toBe("in_progress");
    expect(mlinMills(state.points, 0)).toEqual([[0, 1, 2]]);
    // The evaluation says the mill is worth more than the three pieces alone.
    expect(evaluate(state)).toBeGreaterThan(0);
  });
});

describe("the computer", () => {
  it("returns a legal move at level 3 on a thousand random positions", () => {
    const random = createRng(0x5eed);
    let checked = 0;
    for (let sample = 0; sample < 1_000; sample += 1) {
      let state = initialState();
      const plies = 4 + Math.floor(random() * 40);
      for (let ply = 0; ply < plies; ply += 1) {
        const moves = legalMoves(state);
        if (moves.length === 0 || result(state).status !== "in_progress") break;
        state = applyMove(state, moves[Math.floor(random() * moves.length)] as MlinMove);
      }
      const moves = legalMoves(state);
      const choice = bestMove(state, 3, createRng(sample));
      expect(choice.nodes).toBeLessThanOrEqual(MLIN_LEVELS[2]!.nodeBudget);
      if (moves.length === 0 || result(state).status !== "in_progress") continue;
      checked += 1;
      expect(choice.move).not.toBeNull();
      expect(moves).toContainEqual(choice.move);
    }
    expect(checked).toBeGreaterThan(900);
  }, 300_000);

  it("stays inside every level's budget, and takes a mill that is on offer", () => {
    const random = createRng(0xbeef);
    for (let sample = 0; sample < 200; sample += 1) {
      let state = initialState();
      const plies = 4 + Math.floor(random() * 30);
      for (let ply = 0; ply < plies; ply += 1) {
        const moves = legalMoves(state);
        if (moves.length === 0 || result(state).status !== "in_progress") break;
        state = applyMove(state, moves[Math.floor(random() * moves.length)] as MlinMove);
      }
      if (result(state).status !== "in_progress") continue;
      const level = 1 + (sample % 3);
      const choice = bestMove(state, level, createRng(sample));
      expect(choice.nodes).toBeLessThanOrEqual(MLIN_LEVELS[level - 1]!.nodeBudget);
      expect(legalMoves(state)).toContainEqual(choice.move);
    }
    // A mill one placement away: seat 0 plays 2 and the search has to see it,
    // removal and all. The two-ply value is 119 by hand: after the mill seat 0
    // has 3 pieces and a mill, seat 1 has 1, seat 1's best reply makes it 2 and
    // builds a two-in-line of its own, so 100 * (3 - 2) + 25 - 6.
    const onOffer = board(BEFORE_MILL, { toMove: 0, placed: [2, 2] });
    const choice = bestMove(onOffer, 1, createRng(11));
    expect(choice.move).toMatchObject({ kind: "place", point: 2 });
    expect((choice.move as { remove: number | null }).remove).not.toBeNull();
    expect(choice.score).toBe(119);
    // The same position seen from the opponent's side, before its reply:
    // material -200 and the mill -25.
    const afterMill = applyMove(onOffer, { kind: "place", point: 2, remove: 14 });
    expect(evaluate(afterMill)).toBe(-225);
  }, 180_000);
});

describe("the saved game", () => {
  it("round-trips through JSON", () => {
    let state = initialState();
    state = applyMove(state, { kind: "place", point: 0, remove: null });
    state = applyMove(state, { kind: "place", point: 21, remove: null });
    state = applyMove(state, { kind: "place", point: 1, remove: null });
    expect(fromJSON(toJSON(state))).toEqual(state);
    expect(fromJSON(JSON.parse(JSON.stringify(toJSON(state))) as unknown)).toEqual(state);
  });

  it("refuses a malformed or impossible saved game", () => {
    const points = initialState().points;
    expect(() => fromJSON(null)).toThrowError(InvalidStateError);
    expect(() => fromJSON({ points: [0], toMove: 0, placed: [0, 0], sinceProgress: 0 })).toThrowError(
      InvalidStateError,
    );
    expect(() => fromJSON({ points, toMove: 0, placed: [0, 0] })).toThrowError(InvalidStateError);
    expect(() => fromJSON({ points, toMove: 3, placed: [0, 0], sinceProgress: 0 })).toThrowError(
      InvalidStateError,
    );
    expect(() => fromJSON({ points, toMove: 0, placed: [10, 0], sinceProgress: 0 })).toThrowError(
      InvalidStateError,
    );
    // A piece standing on the board that was never placed.
    const withPiece = initialState().points.slice() as MlinPoint[];
    withPiece[0] = 1;
    expect(() =>
      fromJSON({ points: withPiece, toMove: 0, placed: [0, 0], sinceProgress: 0 }),
    ).toThrowError(InvalidStateError);
    const unknown = initialState().points.slice() as MlinPoint[];
    unknown[0] = 5 as MlinPoint;
    expect(() =>
      fromJSON({ points: unknown, toMove: 0, placed: [0, 0], sinceProgress: 0 }),
    ).toThrowError(InvalidStateError);
  });
});
