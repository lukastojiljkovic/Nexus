import { describe, expect, it } from "vitest";

import { InvalidStateError } from "../boards-shared/errors.js";
import { createRng } from "../boards-shared/rng.js";
import {
  DRAUGHTS_DRAW_PLIES,
  DRAUGHTS_LEVELS,
  DRAUGHTS_SQUARES,
  applyMove,
  bestMove,
  draughtsIsKing,
  draughtsPositionKey,
  draughtsSquareAt,
  fromJSON,
  initialState,
  legalMoves,
  result,
  toJSON,
  type DraughtsKind,
  type DraughtsMove,
  type DraughtsPiece,
  type DraughtsState,
} from "./draughts.js";

/**
 * Draughts is implemented a SECOND time below, in `(row, column)` coordinates
 * over an 8x8 grid of characters, and the two are compared at EVERY node of the
 * move tree — not only at its leaves — so two implementations agreeing on a
 * count cannot hide a rule they both got wrong. `rows[0]` is the bottom row;
 * `x`/`X` are seat 0's man and king, `o`/`O` seat 1's.
 */
type Cell = "." | "x" | "X" | "o" | "O";
type Side = "x" | "o";

const NAIVE_DIAGONALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

interface NaiveMove {
  readonly kind: "step" | "capture";
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  /** The landing squares, in order; one entry for a step and for a single jump. */
  readonly path: readonly (readonly [number, number])[];
}

function naiveSide(cell: Cell): Side | null {
  return cell === "x" || cell === "X" ? "x" : cell === "o" || cell === "O" ? "o" : null;
}

function naiveIsKing(cell: Cell): boolean {
  return cell === "X" || cell === "O";
}

function naiveCrownRow(side: Side): number {
  return side === "x" ? 7 : 0;
}

function naiveForward(side: Side): number {
  return side === "x" ? 1 : -1;
}

function naiveAt(board: readonly (readonly Cell[])[], row: number, column: number): Cell | null {
  if (row < 0 || row > 7 || column < 0 || column > 7) return null;
  return (board[row] as readonly Cell[])[column] as Cell;
}

function naiveBoard(rows: readonly string[]): Cell[][] {
  return rows.map((row) => row.split("") as Cell[]);
}

/** Every complete jump sequence from a square; jumped pieces leave as they are taken. */
function naiveJumps(
  board: Cell[][],
  side: Side,
  kind: DraughtsKind,
  from: readonly [number, number],
  at: readonly [number, number],
  mark: Cell,
  path: [number, number][],
  out: NaiveMove[],
): void {
  let extended = false;
  const king = naiveIsKing(mark);
  for (const [dr, dc] of NAIVE_DIAGONALS) {
    if (!king && kind === "english" && dr !== naiveForward(side)) continue;
    const landings: [number, number][] = [];
    let overRow: number;
    let overColumn: number;
    if (king && kind === "russian") {
      let row = at[0] + dr;
      let column = at[1] + dc;
      while (naiveAt(board, row, column) === ".") {
        row += dr;
        column += dc;
      }
      const occupant = naiveAt(board, row, column);
      if (occupant === null || naiveSide(occupant) === side) continue;
      overRow = row;
      overColumn = column;
      let landingRow = row + dr;
      let landingColumn = column + dc;
      while (naiveAt(board, landingRow, landingColumn) === ".") {
        landings.push([landingRow, landingColumn]);
        landingRow += dr;
        landingColumn += dc;
      }
    } else {
      const occupant = naiveAt(board, at[0] + dr, at[1] + dc);
      const occupantSide = occupant === null ? null : naiveSide(occupant);
      if (occupantSide === null || occupantSide === side) continue;
      if (naiveAt(board, at[0] + 2 * dr, at[1] + 2 * dc) !== ".") continue;
      overRow = at[0] + dr;
      overColumn = at[1] + dc;
      landings.push([at[0] + 2 * dr, at[1] + 2 * dc]);
    }
    const taken = (board[overRow] as Cell[])[overColumn] as Cell;
    for (const landing of landings) {
      extended = true;
      (board[overRow] as Cell[])[overColumn] = ".";
      (board[at[0]] as Cell[])[at[1]] = ".";
      const crowned = !king && landing[0] === naiveCrownRow(side);
      const nextMark: Cell = crowned ? (side === "x" ? "X" : "O") : mark;
      (board[landing[0]] as Cell[])[landing[1]] = nextMark;
      path.push(landing);
      if (crowned && kind === "english") {
        out.push({ kind: "capture", from, to: landing, path: path.slice() });
      } else {
        naiveJumps(board, side, kind, from, landing, nextMark, path, out);
      }
      path.pop();
      (board[landing[0]] as Cell[])[landing[1]] = ".";
      (board[at[0]] as Cell[])[at[1]] = mark;
      (board[overRow] as Cell[])[overColumn] = taken;
    }
  }
  if (!extended && path.length > 0) {
    out.push({
      kind: "capture",
      from,
      to: path[path.length - 1] as [number, number],
      path: path.slice(),
    });
  }
}

/** Every legal move of a position — the naive answer to "what may this side play". */
function naiveMoves(rows: readonly string[], side: Side, kind: DraughtsKind): NaiveMove[] {
  const board = naiveBoard(rows);
  const captures: NaiveMove[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const cell = (board[row] as Cell[])[column] as Cell;
      if (naiveSide(cell) !== side) continue;
      naiveJumps(board, side, kind, [row, column], [row, column], cell, [], captures);
    }
  }
  if (captures.length > 0) {
    if (kind !== "russian") return captures;
    let most = 0;
    for (const capture of captures) if (capture.path.length > most) most = capture.path.length;
    return captures.filter((capture) => capture.path.length === most);
  }
  const steps: NaiveMove[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const cell = (board[row] as Cell[])[column] as Cell;
      if (naiveSide(cell) !== side) continue;
      const king = naiveIsKing(cell);
      for (const [dr, dc] of NAIVE_DIAGONALS) {
        if (!king && dr !== naiveForward(side)) continue;
        if (king && kind === "russian") {
          let r = row + dr;
          let c = column + dc;
          while (naiveAt(board, r, c) === ".") {
            steps.push({ kind: "step", from: [row, column], to: [r, c], path: [[r, c]] });
            r += dr;
            c += dc;
          }
          continue;
        }
        if (naiveAt(board, row + dr, column + dc) === ".") {
          steps.push({
            kind: "step",
            from: [row, column],
            to: [row + dr, column + dc],
            path: [[row + dr, column + dc]],
          });
        }
      }
    }
  }
  return steps;
}

/** The test's own square numbering, which has to be the engine's. */
function squareOf(row: number, column: number): number {
  return row * 4 + (column >> 1);
}

/** One move as one string, produced the same way from both implementations. */
function describeMove(move: NaiveMove | DraughtsMove): string {
  if ("kind" in move && move.kind === "step") {
    const from = Array.isArray(move.from) ? squareOf(move.from[0], move.from[1]) : move.from;
    const to = Array.isArray(move.to) ? squareOf(move.to[0], move.to[1]) : move.to;
    return `step:${from}:${to}`;
  }
  if (move.kind === "capture") {
    const from = Array.isArray(move.from) ? squareOf(move.from[0], move.from[1]) : move.from;
    const path = move.path.map((square) =>
      Array.isArray(square) ? squareOf(square[0], square[1]) : square,
    );
    return `capture:${from}:${path.join(",")}`;
  }
  return "?";
}

/** The rows of a state, in this file's characters. */
function rowsOf(state: DraughtsState): string[] {
  const rows: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    let text = "";
    for (let column = 0; column < 8; column += 1) {
      const square = draughtsSquareAt(row, column);
      if (square === null) {
        text += ".";
        continue;
      }
      const piece = state.squares[square] as DraughtsPiece;
      text += piece === 0 ? "." : piece === 1 ? "x" : piece === 2 ? "X" : piece === 3 ? "o" : "O";
    }
    rows.push(text);
  }
  return rows;
}

/**
 * Walks the move tree to `depth`, comparing the engine's move list with the
 * naive one at every node, and returns the leaf count.
 */
function crossCheck(state: DraughtsState, depth: number): number {
  const moves = legalMoves(state);
  const naive = naiveMoves(rowsOf(state), state.toMove === 0 ? "x" : "o", state.kind).map(describeMove);
  expect(moves.map(describeMove).sort()).toEqual(naive.sort());
  if (depth <= 0 || moves.length === 0) return 1;
  let total = 0;
  for (const move of moves) total += crossCheck(applyMove(state, move), depth - 1);
  return total;
}

/** A board from eight rows, `rows[0]` the bottom one. */
function grid(
  rows: readonly string[],
  kind: DraughtsKind,
  toMove: 0 | 1 = 0,
  sinceProgress = 0,
): DraughtsState {
  const squares = new Array<DraughtsPiece>(DRAUGHTS_SQUARES).fill(0);
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c += 1) {
      const square = draughtsSquareAt(r, c);
      const mark = row[c] as Cell;
      if (square === null) {
        // A mark on a white square is a typo in a fixture, not a position.
        if (mark !== ".") throw new Error(`unplayable square in fixture: (${r}, ${c})`);
        continue;
      }
      squares[square] =
        mark === "x" ? 1 : mark === "X" ? 2 : mark === "o" ? 3 : mark === "O" ? 4 : 0;
    }
  });
  return initialState({ squares, toMove, kind, sinceProgress });
}

/** A man on (0,0), enemies on (1,1) and (3,3): the whole double jump, by hand. */
const DOUBLE_JUMP = [
  "x.......",
  ".o......",
  "........",
  "...o....",
  "........",
  "........",
  "........",
  "........",
];

/**
 * A man on (5,1), enemies on (6,2) and (6,4). It takes (6,2) and lands on the
 * crown row at (7,3); under `russian` it is crowned there and goes on to take
 * (6,4), landing on (5,5), (4,6) or (3,7) — none of them the crown row.
 */
const CROWNING_CAPTURE = [
  "........",
  "........",
  "........",
  "........",
  "........",
  ".x......",
  "..o.o...",
  "........",
];

/** A king on (0,0) with one enemy on (3,3) and nothing else. */
const FLYING_KING = [
  "X.......",
  "........",
  "........",
  "...o....",
  "........",
  "........",
  "........",
  "........",
];

/** A king on (0,0) and a king on (7,7): the two can never take each other. */
const TWO_KINGS = [
  "X.......",
  "........",
  "........",
  "........",
  "........",
  "........",
  "........",
  ".......O",
];

describe("the opening", () => {
  for (const kind of ["english", "russian"] as const) {
    it(`is twelve men a side and seven moves (${kind})`, () => {
      const state = initialState({ kind });
      expect(state.squares.filter((piece) => piece === 1)).toHaveLength(12);
      expect(state.squares.filter((piece) => piece === 3)).toHaveLength(12);
      // Hand-checked: the four men of seat 0's front row have 1, 2, 2 and 2
      // free squares, and no man behind them can move.
      expect(legalMoves(state)).toHaveLength(7);
      expect(crossCheck(state, 1)).toBe(7);
    });
  }

  it("counts 7, 49, 302 and 1469 leaves to depth four, in both rule sets", () => {
    // Identical under both rule sets, because before four plies no capture
    // exists for a backward jump or a flying king to be made with. The numbers
    // are the checkers perft sequence, and the naive generator computes them
    // here rather than the test remembering them.
    for (const kind of ["english", "russian"] as const) {
      const counts: number[] = [];
      for (let depth = 1; depth <= 4; depth += 1) {
        counts.push(crossCheck(initialState({ kind }), depth));
      }
      expect(counts).toEqual([7, 49, 302, 1469]);
    }
  }, 180_000);
});

describe("the compulsory capture", () => {
  it("leaves only captures when one exists, and refuses a step", () => {
    const state = grid(DOUBLE_JUMP, "english");
    // Hand-checked: (0,0) over (1,1) onto (2,2), then over (3,3) onto (4,4).
    expect(legalMoves(state).map(describeMove)).toEqual(["capture:0:9,18"]);
    let problem = "";
    try {
      applyMove(state, { kind: "step", from: 0, to: 4 });
    } catch (error) {
      problem = (error as InvalidStateError).problem;
    }
    expect(problem).toBe("capture-available");
  });

  it("refuses a capture that stops while it could go on", () => {
    const state = grid(DOUBLE_JUMP, "english");
    let problem = "";
    try {
      applyMove(state, { kind: "capture", from: 0, path: [9] });
    } catch (error) {
      problem = (error as InvalidStateError).problem;
    }
    expect(problem).toBe("capture-incomplete");
  });

  it("takes the whole double jump, empties the board of the enemy, and counts as progress", () => {
    const state = grid(DOUBLE_JUMP, "english", 0, 7);
    const after = applyMove(state, { kind: "capture", from: 0, path: [9, 18] });
    expect(after.squares.filter((piece) => piece === 3)).toHaveLength(0);
    expect(after.squares[18]).toBe(1);
    expect(after.squares[0]).toBe(0);
    expect(after.squares[4]).toBe(0);
    expect(after.squares[13]).toBe(0);
    expect(after.toMove).toBe(1);
    expect(after.sinceProgress).toBe(0);
  });

  it("takes the longest capture in russian draughts and any capture in english", () => {
    // Two men of seat 0, each with a capture of its own and no other enemy near
    // the other: (0,0) can take one piece and nothing else, and (2,6) walks up
    // the board taking two. Under `russian` only the longer one is a move at
    // all; under `english` the choice is the player's.
    const rows = [
      "x.......",
      ".o......",
      "......x.",
      ".....o..",
      "........",
      "...o....",
      "........",
      "........",
    ];
    expect(legalMoves(grid(rows, "russian")).map(describeMove)).toEqual(["capture:11:18,25"]);
    expect(legalMoves(grid(rows, "english")).map(describeMove).sort()).toEqual([
      "capture:0:9",
      "capture:11:18,25",
    ]);
    let problem = "";
    try {
      applyMove(grid(rows, "russian"), { kind: "capture", from: 0, path: [9] });
    } catch (error) {
      problem = (error as InvalidStateError).problem;
    }
    expect(problem).toBe("capture-not-maximal");
  });
});

describe("the crown row", () => {
  it("ends an english capture on the crown row, and does not go on capturing", () => {
    const state = grid(CROWNING_CAPTURE, "english");
    // Hand-checked: (5,1) over (6,2) onto the crown row at (7,3) — the move
    // ends there, and the man on (6,4) survives.
    expect(legalMoves(state).map(describeMove)).toEqual(["capture:20:29"]);
    const after = applyMove(state, { kind: "capture", from: 20, path: [29] });
    expect(after.squares[29]).toBe(2);
    expect(draughtsIsKing(after.squares[29] as DraughtsPiece)).toBe(true);
    expect(after.squares[26]).toBe(3);
    expect(() => applyMove(state, { kind: "capture", from: 20, path: [29, 22] })).toThrowError(
      InvalidStateError,
    );
  });

  it("continues a russian capture as a king, which need not end on the crown row", () => {
    const state = grid(CROWNING_CAPTURE, "russian");
    // Hand-checked: over (6,2) onto the crown row at (7,3), crowned there, and
    // on as a flying king over (6,4) onto (5,5), (4,6) or (3,7).
    expect(legalMoves(state).map(describeMove).sort()).toEqual([
      "capture:20:29,15",
      "capture:20:29,19",
      "capture:20:29,22",
    ]);
    const after = applyMove(state, { kind: "capture", from: 20, path: [29, 22] });
    // (5,5) is not the crown row, and the piece standing there is a king.
    expect(after.squares[22]).toBe(2);
    expect(after.squares.filter((piece) => piece === 3)).toHaveLength(0);
  });

  it("crowns a man that reaches the crown row and counts the move as progress", () => {
    const state = grid(
      ["........", "........", "........", "........", "........", "........", "x.......", "........"],
      "english",
      0,
      9,
    );
    // Hand-checked: (6,0) has one forward diagonal on this board, and it ends
    // on the crown row at (7,1).
    expect(legalMoves(state).map(describeMove)).toEqual(["step:24:28"]);
    const after = applyMove(state, { kind: "step", from: 24, to: 28 });
    expect(after.squares[28]).toBe(2);
    expect(after.toMove).toBe(1);
    expect(after.sinceProgress).toBe(0);
  });
});

describe("the king", () => {
  it("flies in russian draughts: over one enemy, onto any empty square beyond", () => {
    const state = grid(FLYING_KING, "russian");
    // Hand-checked: (0,0) over (3,3) onto (4,4), (5,5), (6,6) or (7,7).
    expect(legalMoves(state).map(describeMove).sort()).toEqual([
      "capture:0:18",
      "capture:0:22",
      "capture:0:27",
      "capture:0:31",
    ]);
  });

  it("cannot reach a distant enemy in english draughts, where it steps one square", () => {
    const state = grid(FLYING_KING, "english");
    expect(legalMoves(state).map(describeMove)).toEqual(["step:0:4"]);
  });

  it("slides any distance in russian draughts, one square at a time in english", () => {
    const rows = [
      "X.......",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
    ];
    expect(legalMoves(grid(rows, "russian")).map(describeMove)).toEqual([
      "step:0:4",
      "step:0:9",
      "step:0:13",
      "step:0:18",
      "step:0:22",
      "step:0:27",
      "step:0:31",
    ]);
    expect(legalMoves(grid(rows, "english")).map(describeMove)).toEqual(["step:0:4"]);
  });
});

describe("the man", () => {
  it("captures backwards in russian draughts and not in english", () => {
    const rows = [
      "........",
      "........",
      "........",
      "...o....",
      "....x...",
      "........",
      "........",
      "........",
    ];
    // Hand-checked: the enemy on (3,3) is behind the man on (4,4). Russian
    // draughts jumps it onto (2,2), and a capture beats the two steps.
    expect(legalMoves(grid(rows, "russian")).map(describeMove)).toEqual(["capture:18:9"]);
    // English draughts may not, so the same man steps forward instead.
    expect(legalMoves(grid(rows, "english")).map(describeMove).sort()).toEqual([
      "step:18:21",
      "step:18:22",
    ]);
  });
});

describe("the end", () => {
  it("is a loss for a side that has no move", () => {
    const state = grid(
      ["x.......", ".O......", "..o.....", "........", "........", "........", "........", "........"],
      "english",
    );
    // Hand-checked: (0,0) cannot step onto (1,1) and cannot jump it either,
    // because (2,2) is occupied.
    expect(legalMoves(state)).toHaveLength(0);
    expect(result(state)).toEqual({ status: "win", winner: 1, reason: "no-moves" });
  });

  it("is a loss for a side with no pieces", () => {
    const state = grid(
      ["........", ".o......", "........", "........", "........", "........", "........", "........"],
      "english",
    );
    expect(result(state)).toEqual({ status: "win", winner: 1, reason: "pieces" });
  });
});

describe("the draws", () => {
  it("draws on the counter's last ply, at each rule set's own number", () => {
    // Hand-checked: neither king can take anything here — each stands at the
    // far end of the diagonal with no square beyond it to land on.
    expect(DRAUGHTS_DRAW_PLIES).toEqual({ english: 80, russian: 30 });
    expect(result(grid(TWO_KINGS, "russian", 0, 29)).status).toBe("in_progress");
    expect(result(grid(TWO_KINGS, "russian", 0, 30))).toEqual({
      status: "draw",
      winner: null,
      reason: "no-progress",
    });
    expect(result(grid(TWO_KINGS, "english", 0, 79)).status).toBe("in_progress");
    expect(result(grid(TWO_KINGS, "english", 0, 80)).status).toBe("draw");
  });

  it("counts a king's step and resets on a capture and on a man's move", () => {
    const start = grid(TWO_KINGS, "russian", 0, 12);
    expect(applyMove(start, { kind: "step", from: 0, to: 9 }).sinceProgress).toBe(13);
    const capture = grid(CROWNING_CAPTURE, "russian", 0, 12);
    expect(applyMove(capture, { kind: "capture", from: 20, path: [29, 22] }).sinceProgress).toBe(0);
    const manStep = grid(
      ["........", "........", "........", "........", "........", "........", "x.......", "........"],
      "english",
      0,
      12,
    );
    expect(applyMove(manStep, { kind: "step", from: 24, to: 28 }).sinceProgress).toBe(0);
  });

  it("keys the position by the position alone, for stage 2's repetition count", () => {
    const state = grid(TWO_KINGS, "russian", 0, 5);
    expect(draughtsPositionKey(grid(TWO_KINGS, "russian", 0, 6))).toBe(draughtsPositionKey(state));
    expect(draughtsPositionKey(grid(TWO_KINGS, "russian", 1, 5))).not.toBe(
      draughtsPositionKey(state),
    );
    expect(draughtsPositionKey(grid(TWO_KINGS, "english", 0, 5))).not.toBe(
      draughtsPositionKey(state),
    );
  });
});

describe("the computer", () => {
  it("returns a legal move at level 3 on a thousand positions per rule set", () => {
    const random = createRng(0x5eed);
    for (const kind of ["english", "russian"] as const) {
      let checked = 0;
      for (let sample = 0; sample < 1_000; sample += 1) {
        let state = initialState({ kind });
        const plies = 4 + Math.floor(random() * 40);
        for (let ply = 0; ply < plies; ply += 1) {
          const moves = legalMoves(state);
          if (moves.length === 0) break;
          state = applyMove(state, moves[Math.floor(random() * moves.length)] as DraughtsMove);
        }
        const moves = legalMoves(state);
        const choice = bestMove(state, 3, createRng(sample));
        expect(choice.nodes).toBeLessThanOrEqual(DRAUGHTS_LEVELS[2]!.nodeBudget);
        if (result(state).status !== "in_progress") continue;
        checked += 1;
        expect(choice.move).not.toBeNull();
        expect(moves).toContainEqual(choice.move);
      }
      expect(checked).toBeGreaterThan(900);
    }
  }, 300_000);

  it("stays inside every level's budget, and always captures when it must", () => {
    const random = createRng(0xbeef);
    for (let sample = 0; sample < 300; sample += 1) {
      let state = initialState({ kind: sample % 2 === 0 ? "english" : "russian" });
      const plies = 4 + Math.floor(random() * 30);
      for (let ply = 0; ply < plies; ply += 1) {
        const moves = legalMoves(state);
        if (moves.length === 0) break;
        state = applyMove(state, moves[Math.floor(random() * moves.length)] as DraughtsMove);
      }
      const moves = legalMoves(state);
      if (moves.length === 0 || result(state).status !== "in_progress") continue;
      const level = 1 + (sample % 3);
      const choice = bestMove(state, level, createRng(sample));
      expect(choice.nodes).toBeLessThanOrEqual(DRAUGHTS_LEVELS[level - 1]!.nodeBudget);
      expect(moves).toContainEqual(choice.move);
    }
    const forced = grid(DOUBLE_JUMP, "english");
    expect(bestMove(forced, 3, createRng(3)).move?.kind).toBe("capture");
  }, 180_000);
});

describe("the saved game", () => {
  it("round-trips through JSON", () => {
    let state = initialState({ kind: "russian" });
    state = applyMove(state, legalMoves(state)[0] as DraughtsMove);
    state = applyMove(state, legalMoves(state)[0] as DraughtsMove);
    expect(fromJSON(toJSON(state))).toEqual(state);
    expect(fromJSON(JSON.parse(JSON.stringify(toJSON(state))) as unknown)).toEqual(state);
  });

  it("refuses a malformed or impossible saved game", () => {
    const squares = initialState({ kind: "english" }).squares;
    expect(() => fromJSON(null)).toThrowError(InvalidStateError);
    expect(() =>
      fromJSON({ squares: [0], toMove: 0, kind: "english", sinceProgress: 0 }),
    ).toThrowError(InvalidStateError);
    expect(() => fromJSON({ squares, toMove: 0, kind: "chess", sinceProgress: 0 })).toThrowError(
      InvalidStateError,
    );
    expect(() => fromJSON({ squares, toMove: 2, kind: "english", sinceProgress: 0 })).toThrowError(
      InvalidStateError,
    );
    expect(() => fromJSON({ squares, toMove: 0, kind: "english" })).toThrowError(InvalidStateError);
    const illegal = new Array<DraughtsPiece>(DRAUGHTS_SQUARES).fill(0);
    for (let square = 0; square < 13; square += 1) illegal[square] = 1;
    expect(() =>
      fromJSON({ squares: illegal, toMove: 0, kind: "english", sinceProgress: 0 }),
    ).toThrowError(InvalidStateError);
    const unknown = new Array<DraughtsPiece>(DRAUGHTS_SQUARES).fill(0);
    unknown[0] = 7 as DraughtsPiece;
    expect(() =>
      fromJSON({ squares: unknown, toMove: 0, kind: "english", sinceProgress: 0 }),
    ).toThrowError(InvalidStateError);
  });
});
