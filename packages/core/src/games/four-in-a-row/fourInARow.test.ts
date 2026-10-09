import { describe, expect, it } from "vitest";

import { InvalidStateError } from "../boards-shared/errors.js";
import { createSeededRandom } from "../random.js";
import {
  FOUR_CELLS,
  FOUR_COLUMNS,
  FOUR_LEVELS,
  FOUR_ROWS,
  applyMove,
  bestMove,
  evaluate,
  fourColumnHeight,
  fourIndex,
  fourWinner,
  fromJSON,
  initialState,
  legalMoves,
  result,
  toJSON,
  type FourDisc,
  type FourMove,
  type FourState,
} from "./fourInARow.js";

/**
 * `rows[0]` is the BOTTOM row and `rows[5]` the top, so a grid reads the way the
 * board looks when the columns are written down: `X` is seat 0, `O` seat 1.
 */
function grid(rows: readonly string[]): FourState {
  const cells: FourDisc[] = new Array<FourDisc>(FOUR_CELLS).fill(0);
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c += 1) {
      const mark = row[c];
      cells[fourIndex(c, r)] = mark === "X" ? 1 : mark === "O" ? 2 : 0;
    }
  });
  return initialState({ cells });
}

/**
 * An independent, deliberately naive four-in-a-row scan: every cell and every
 * direction, with no windows and no board-level shortcuts, so a bug in the
 * engine's precomputed windows cannot hide behind it.
 */
function naiveWinner(cells: readonly FourDisc[]): FourDisc | null {
  const at = (column: number, row: number): FourDisc =>
    column < 0 || column >= FOUR_COLUMNS || row < 0 || row >= FOUR_ROWS
      ? 0
      : (cells[fourIndex(column, row)] as FourDisc);
  const directions: readonly (readonly [number, number])[] = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (let row = 0; row < FOUR_ROWS; row += 1) {
    for (let column = 0; column < FOUR_COLUMNS; column += 1) {
      const disc = at(column, row);
      if (disc === 0) continue;
      for (const [dc, dr] of directions) {
        let run = 1;
        while (run < 4 && at(column + dc * run, row + dr * run) === disc) run += 1;
        if (run === 4) return disc;
      }
    }
  }
  return null;
}

describe("the board", () => {
  it("starts empty, 7 columns wide, seat 0 to move", () => {
    const state = initialState();
    expect(state.cells).toHaveLength(FOUR_CELLS);
    expect(state.cells.every((cell) => cell === 0)).toBe(true);
    expect(state.toMove).toBe(0);
    expect(state.moveCount).toBe(0);
    expect(legalMoves(state)).toHaveLength(FOUR_COLUMNS);
  });

  it("drops a disc to the lowest empty row of its column", () => {
    const first = applyMove(initialState(), { column: 3 });
    expect(first.cells[fourIndex(3, 0)]).toBe(1);
    expect(first.toMove).toBe(1);
    const second = applyMove(first, { column: 3 });
    expect(second.cells[fourIndex(3, 1)]).toBe(2);
    expect(fourColumnHeight(second.cells, 3)).toBe(2);
    expect(second.moveCount).toBe(2);
  });

  it("drops a full column from the legal moves and refuses a move into it", () => {
    const state = grid(["X", "O", "X", "O", "X", "O"]);
    expect(state.moveCount).toBe(6);
    expect(legalMoves(state).map((move) => move.column)).toEqual([1, 2, 3, 4, 5, 6]);
    let problem = "";
    try {
      applyMove(state, { column: 0 });
    } catch (error) {
      problem = (error as InvalidStateError).problem;
    }
    expect(problem).toBe("column-full");
  });
});

describe("the win", () => {
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ["horizontal", ["XXXX...", ".......", ".......", ".......", ".......", "......."]],
    ["vertical", ["...X...", "...X...", "...X...", "...X...", ".......", "......."]],
    // The rising diagonal needs the same discs stacked under it as the falling
    // one: (3,3) cannot stand on an empty column, because `initialState`
    // refuses a position gravity would not have produced.
    ["the rising diagonal", ["XOOO...", ".XOO...", "..XO...", "...X...", ".......", "......."]],
    ["the falling diagonal", ["OOOX...", "OOX....", "OX.....", "X......", ".......", "......."]],
  ];

  for (const [name, rows] of cases) {
    it(`is seen in four, ${name}`, () => {
      const state = grid(rows);
      expect(fourWinner(state.cells)).toBe(1);
      expect(naiveWinner(state.cells)).toBe(1);
      expect(result(state)).toEqual({ status: "win", winner: 0, reason: "line" });
    });
  }

  it("is not claimed by three in a row", () => {
    const state = grid(["XXX....", "OO.....", ".......", ".......", ".......", "......."]);
    expect(fourWinner(state.cells)).toBeNull();
    expect(result(state).status).toBe("in_progress");
  });
});

describe("the draw", () => {
  // 42 legal drops that fill the board with no line of four for either seat.
  // Found by random legal play under a scratch script (%TEMP%, deleted) and
  // verified here by `naiveWinner`, so the expected value is computed rather
  // than remembered.
  const FULL_DRAW: readonly number[] = [
    1, 0, 5, 3, 2, 6, 6, 5, 0, 5, 2, 1, 2, 4, 1, 1, 6, 0, 3, 3, 1, 4, 3, 2, 6, 5, 5, 2, 3, 4, 4, 5, 1, 0, 0,
    6, 3, 6, 4, 2, 4, 0,
  ];

  it("is the full board, and the sequence that fills it really has no line", () => {
    let state = initialState();
    for (const column of FULL_DRAW) state = applyMove(state, { column });
    expect(state.moveCount).toBe(FOUR_CELLS);
    expect(legalMoves(state)).toHaveLength(0);
    expect(naiveWinner(state.cells)).toBeNull();
    expect(result(state)).toEqual({ status: "draw", winner: null, reason: "board-full" });
  });
});

describe("the computer", () => {
  /**
   * A position with a winning move that only a real search finds: seat 0 drops
   * into column 3 (or 4), which opens two lines at once â€” the board's `XX_XX`
   * split in row 2 needs (3,2), and blocking that hands seat 0 the diagonal
   * (6,0)-(5,1)-(4,2)-(3,3) up column 3 instead. Seat 0 is a move ahead (8
   * discs to 8, it moved first), so the position is reachable, and neither side
   * has a line yet.
   */
  const FORCED_WIN: readonly string[] = [
    "OOOXOXX",
    "OOOXOXX",
    ".XX....",
    ".......",
    ".......",
    ".......",
  ];

  it("level 3 finds the forced win, which an independent scan confirms is forced", () => {
    const state = grid(FORCED_WIN);
    expect(state.toMove).toBe(0);
    expect(naiveWinner(state.cells)).toBeNull();

    // A seat-0 move is winning when seat 1 has no reply that both survives and
    // denies seat 0 a line on the move after it.
    const forcesWin = (first: FourMove): boolean => {
      const after = applyMove(state, first);
      if (result(after).status === "win") return true;
      const replies = legalMoves(after);
      if (replies.length === 0) return false;
      return replies.every((reply) => {
        const answered = applyMove(after, reply);
        if (result(answered).status !== "in_progress") return false;
        return legalMoves(answered).some(
          (finish) => result(applyMove(answered, finish)).status === "win",
        );
      });
    };
    const moves = legalMoves(state);
    const forced = moves.filter(forcesWin).map((move) => move.column);
    expect(forced).toContain(3);
    // Winning at all is a choice, and a poor one exists: the position is not
    // trivially won for whoever moves.
    expect(forced.length).toBeGreaterThan(0);
    expect(forced.length).toBeLessThan(moves.length);

    const choice = bestMove(state, 3, createSeededRandom(1));
    expect(choice.cut).toBe(false);
    expect(forced).toContain(choice.move?.column ?? -1);
    // Level 3 reports a mate; level 1, which sees only its own reply, does not.
    expect(choice.score).toBeGreaterThanOrEqual(90_000);
    expect(bestMove(state, 1, createSeededRandom(1)).score).toBeLessThan(10_000);
  });

  it("stays inside its node budget at every level, and always plays legally", () => {
    const random = createSeededRandom(0x5eed);
    for (let sample = 0; sample < 1_000; sample += 1) {
      let state = initialState();
      const plies = 4 + Math.floor(random.next() * 20);
      for (let ply = 0; ply < plies; ply += 1) {
        const moves = legalMoves(state);
        if (moves.length === 0) break;
        state = applyMove(state, moves[Math.floor(random.next() * moves.length)] as FourMove);
      }
      const moves = legalMoves(state);
      if (moves.length === 0) continue;
      const level = 1 + (sample % 3);
      const choice = bestMove(state, level, createSeededRandom(sample));
      expect(choice.nodes).toBeLessThanOrEqual(FOUR_LEVELS[level - 1]!.nodeBudget);
      expect(choice.move).not.toBeNull();
      expect(moves).toContainEqual(choice.move);
    }
  }, 180_000);

  it("scores the side to move, and prefers the quicker of two wins", () => {
    const quick = grid(["XXXX...", ".......", ".......", ".......", ".......", "......."]);
    // Only seat 0 has a line, and it took 25 discs to get there: the same win,
    // reached later, so the faster one must score higher.
    const slow = grid(["XOXOXOX", "XOXOXOX", "XOXOXOX", "XXXX...", ".......", "......."]);
    // Seat 0 has the line in both, and seat 0 is to move: the score is positive.
    expect(evaluate(quick)).toBeGreaterThan(0);
    expect(evaluate(slow)).toBeGreaterThan(0);
    expect(quick.moveCount).toBe(4);
    expect(slow.moveCount).toBe(25);
    expect(evaluate(quick)).toBeGreaterThan(evaluate(slow));
    // The same finished board seen from seat 1's side is a loss.
    expect(evaluate(initialState({ cells: quick.cells, toMove: 1 }))).toBeLessThan(0);
  });
});

describe("the saved game", () => {
  it("round-trips through JSON", () => {
    let state = initialState();
    state = applyMove(state, { column: 2 });
    state = applyMove(state, { column: 4 });
    expect(fromJSON(toJSON(state))).toEqual(state);
    expect(fromJSON(JSON.parse(JSON.stringify(toJSON(state))) as unknown)).toEqual(state);
  });

  it("refuses a malformed or impossible saved game", () => {
    expect(() => fromJSON(null)).toThrowError(InvalidStateError);
    expect(() => fromJSON({ cells: [0], toMove: 0, moveCount: 0 })).toThrowError(InvalidStateError);
    const floating = new Array<FourDisc>(FOUR_CELLS).fill(0);
    floating[fourIndex(0, 3)] = 1;
    expect(() => fromJSON({ cells: floating, toMove: 0, moveCount: 1 })).toThrowError(InvalidStateError);
    expect(() =>
      fromJSON({ cells: new Array<FourDisc>(FOUR_CELLS).fill(0), toMove: 0, moveCount: 7 }),
    ).toThrowError(InvalidStateError);
  });
});
