import { describe, expect, it } from "vitest";

import { InvalidStateError } from "../boards-shared/errors.js";
import { createSeededRandom } from "../random.js";
import {
  REVERSI_CELLS,
  REVERSI_LEVELS,
  REVERSI_SIZE,
  applyMove,
  bestMove,
  evaluate,
  fromJSON,
  initialState,
  legalMoves,
  result,
  reversiCounts,
  reversiFlips,
  reversiIndex,
  toJSON,
  type ReversiDisc,
  type ReversiMove,
  type ReversiState,
} from "./reversi.js";

/**
 * This file deliberately implements reversi a SECOND time, in coordinates and
 * with `string` rows, to have something to compare the engine against that
 * shares none of its code. `rows[0]` is the bottom row and `rows[r][c]` is
 * column `c`, row `r`; `X` is seat 0, `O` seat 1.
 */
type Mark = "X" | "O";

const MARK_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function naiveRows(discs: readonly ReversiDisc[]): string[] {
  const rows: string[] = [];
  for (let r = 0; r < REVERSI_SIZE; r += 1) {
    let row = "";
    for (let c = 0; c < REVERSI_SIZE; c += 1) {
      const disc = discs[r * REVERSI_SIZE + c];
      row += disc === 1 ? "X" : disc === 2 ? "O" : ".";
    }
    rows.push(row);
  }
  return rows;
}

function otherMark(mark: Mark): Mark {
  return mark === "X" ? "O" : "X";
}

function naiveAt(rows: readonly string[], c: number, r: number): string {
  if (c < 0 || c >= REVERSI_SIZE || r < 0 || r >= REVERSI_SIZE) return ".";
  return (rows[r] as string)[c] as string;
}

/** The squares a placement on `(c, r)` would turn over, computed naively. */
function naiveFlips(rows: readonly string[], mark: Mark, c: number, r: number): number[][] {
  if (naiveAt(rows, c, r) !== ".") return [];
  const enemy = otherMark(mark);
  const turned: number[][] = [];
  for (const direction of MARK_DIRECTIONS) {
    const dc = direction[0] as number;
    const dr = direction[1] as number;
    let cc = c + dc;
    let rr = r + dr;
    let run = 0;
    while (naiveAt(rows, cc, rr) === enemy) {
      cc += dc;
      rr += dr;
      run += 1;
    }
    if (run === 0 || naiveAt(rows, cc, rr) !== mark) continue;
    for (let step = 1; step <= run; step += 1) turned.push([c + dc * step, r + dr * step]);
  }
  return turned;
}

function naivePlacements(rows: readonly string[], mark: Mark): number[][] {
  const places: number[][] = [];
  for (let r = 0; r < REVERSI_SIZE; r += 1) {
    for (let c = 0; c < REVERSI_SIZE; c += 1) {
      if (naiveFlips(rows, mark, c, r).length > 0) places.push([c, r]);
    }
  }
  return places;
}

function naivePlay(rows: readonly string[], mark: Mark, c: number, r: number): string[] {
  const next = rows.map((row) => row.split(""));
  (next[r] as string[])[c] = mark;
  for (const [fc, fr] of naiveFlips(rows, mark, c, r)) {
    (next[fr as number] as string[])[fc as number] = mark;
  }
  return next.map((row) => row.join(""));
}

/**
 * Leaf count of the placement tree `depth` plies below a node, with the node
 * itself counting at depth 0. A side that cannot place passes without spending
 * depth, which is how reversi's tree is counted everywhere (and why the
 * sequence below is the one every reversi engine reports).
 */
function naivePerft(rows: readonly string[], mark: Mark, depth: number): number {
  if (depth <= 0) return 1;
  const places = naivePlacements(rows, mark);
  if (places.length === 0) {
    const enemy = otherMark(mark);
    if (naivePlacements(rows, enemy).length === 0) return 1;
    return naivePerft(rows, enemy, depth);
  }
  let total = 0;
  for (const [c, r] of places) {
    total += naivePerft(naivePlay(rows, mark, c as number, r as number), otherMark(mark), depth - 1);
  }
  return total;
}

/** The same count taken through the engine's own `legalMoves`/`applyMove`. */
function enginePerft(state: ReversiState, depth: number): number {
  if (depth <= 0) return 1;
  const moves = legalMoves(state);
  if (moves.length === 0) return 1;
  if (moves.length === 1 && (moves[0] as ReversiMove).kind === "pass") {
    return enginePerft(applyMove(state, moves[0] as ReversiMove), depth);
  }
  let total = 0;
  for (const move of moves) total += enginePerft(applyMove(state, move), depth - 1);
  return total;
}

/** A board built from eight rows, `rows[0]` the bottom one. */
function grid(rows: readonly string[], toMove: 0 | 1 = 0): ReversiState {
  const discs = new Array<ReversiDisc>(REVERSI_CELLS).fill(0);
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c += 1) {
      const mark = row[c];
      discs[reversiIndex(c, r)] = mark === "X" ? 1 : mark === "O" ? 2 : 0;
    }
  });
  return initialState({ discs, toMove });
}

/** `c4`, `d3`, … to the engine's cell index, so the tests can read as the game does. */
function square(name: string): number {
  const column = name.charCodeAt(0) - "a".charCodeAt(0);
  const row = Number(name[1]) - 1;
  return reversiIndex(column, row);
}

/** `[[column, row]]` from the naive implementation, as engine cell indices. */
function cellsOf(pairs: readonly number[][]): number[] {
  return pairs.map((pair) => reversiIndex(pair[0] as number, pair[1] as number)).sort((a, b) => a - b);
}

describe("the board", () => {
  it("opens with the four centre discs on their diagonals and four placements", () => {
    const state = initialState();
    expect(reversiCounts(state.discs)).toEqual([2, 2]);
    expect(state.toMove).toBe(0);
    // Checked against the standard board by name, not by index arithmetic.
    expect(state.discs[square("d4")]).toBe(2);
    expect(state.discs[square("e5")]).toBe(2);
    expect(state.discs[square("d5")]).toBe(1);
    expect(state.discs[square("e4")]).toBe(1);
    // Ascending cell order, which is how the engine hands them out.
    expect(legalMoves(state).map((move) => move.kind === "place" && move.cell)).toEqual([
      square("d3"),
      square("c4"),
      square("f5"),
      square("e6"),
    ]);
    // Every opening move turns exactly one disc over, and the naive
    // implementation agrees with the engine about which.
    const rows = naiveRows(state.discs);
    for (const name of ["c4", "d3", "e6", "f5"]) {
      const column = name.charCodeAt(0) - "a".charCodeAt(0);
      const row = Number(name[1]) - 1;
      const cell = square(name);
      const turned = cellsOf(naiveFlips(rows, "X", column, row));
      expect(turned).toHaveLength(1);
      expect([...reversiFlips(state.discs, 0, cell)].sort((a, b) => a - b)).toEqual(turned);
    }
  });

  it("turns over in all eight directions at once", () => {
    // The one position that exercises the whole rule with one move: an empty
    // centre, seat 1 on all eight neighbours, seat 0 on all eight
    // second-neighbours. Every direction has exactly one enemy disc bracketed.
    const discs = new Array<ReversiDisc>(REVERSI_CELLS).fill(0);
    const neighbours: number[] = [];
    const seconds: number[] = [];
    for (const [dc, dr] of MARK_DIRECTIONS) {
      neighbours.push(reversiIndex(3 + dc, 3 + dr));
      seconds.push(reversiIndex(3 + 2 * dc, 3 + 2 * dr));
    }
    for (const cell of neighbours) discs[cell] = 2;
    for (const cell of seconds) discs[cell] = 1;
    const state = initialState({ discs });
    const centre = reversiIndex(3, 3);
    expect(cellsOf(naivePlacements(naiveRows(discs), "X"))).toEqual([centre]);
    expect(legalMoves(state)).toEqual([{ kind: "place", cell: centre }]);

    const after = applyMove(state, { kind: "place", cell: centre });
    const flipped = [...neighbours].sort((a, b) => a - b);
    expect([...reversiFlips(state.discs, 0, centre)].sort((a, b) => a - b)).toEqual(flipped);
    expect(cellsOf(naiveFlips(naiveRows(discs), "X", 3, 3))).toEqual(flipped);
    expect(naiveRows(after.discs)).toEqual(naivePlay(naiveRows(discs), "X", 3, 3));
    // Nine of seat 0's discs (the centre and the eight turned ones) and the
    // eight second-neighbours that were already seat 0's: seventeen.
    expect(reversiCounts(after.discs)).toEqual([17, 0]);
    expect(after.toMove).toBe(1);
    expect(result(after)).toEqual({ status: "win", winner: 0, reason: "pieces" });
  });

  it("refuses a placement that turns nothing over, and a pass nothing needs", () => {
    const state = initialState();
    const problems: string[] = [];
    for (const bad of [square("a1"), square("d4")]) {
      try {
        applyMove(state, { kind: "place", cell: bad });
      } catch (error) {
        problems.push((error as InvalidStateError).problem);
      }
    }
    expect(problems).toEqual(["illegal", "illegal"]);
    expect(() => applyMove(state, { kind: "pass" })).toThrowError(InvalidStateError);
  });
});

describe("the move tree", () => {
  it("counts the same leaves as an independent generator, depth 1 to 6", () => {
    // Measured on this branch: 4, 12, 56, 244, 1396, 8200 — the sequence every
    // reversi engine reports, computed here rather than remembered.
    const counts: number[] = [];
    for (let depth = 1; depth <= 6; depth += 1) {
      const fromEngine = enginePerft(initialState(), depth);
      const fromNaive = naivePerft(naiveRows(initialState().discs), "X", depth);
      expect(fromEngine).toBe(fromNaive);
      counts.push(fromEngine);
    }
    expect(counts).toEqual([4, 12, 56, 244, 1396, 8200]);
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index] as number).toBeGreaterThan(counts[index - 1] as number);
    }
  });
});

describe("passing and the end", () => {
  /**
   * Seeded random play, the way the end of a reversi game arrives: the first
   * position in which the side to move has no placement but the opponent does
   * is a pass, and the game ends once neither has one. Twenty games are enough
   * for both, and every one of them is checked against the naive
   * implementation rather than against a stored expectation.
   */
  it("passes only when stuck, and ends when both sides are", () => {
    const random = createSeededRandom(0x5eed);
    let passesSeen = 0;
    for (let game = 0; game < 20; game += 1) {
      let state = initialState();
      for (let ply = 0; ply < 200; ply += 1) {
        const moves = legalMoves(state);
        const rows = naiveRows(state.discs);
        const mark: Mark = state.toMove === 0 ? "X" : "O";
        if (moves.length === 0) {
          // Over: neither side may place, and the count decides.
          expect(naivePlacements(rows, mark)).toHaveLength(0);
          expect(naivePlacements(rows, otherMark(mark))).toHaveLength(0);
          expect(result(state).status).not.toBe("in_progress");
          break;
        }
        if ((moves[0] as ReversiMove).kind === "pass") {
          passesSeen += 1;
          expect(moves).toHaveLength(1);
          expect(naivePlacements(rows, mark)).toHaveLength(0);
          expect(naivePlacements(rows, otherMark(mark)).length).toBeGreaterThan(0);
          expect(result(state).status).toBe("in_progress");
          const passed = applyMove(state, { kind: "pass" });
          expect(passed.discs).toBe(state.discs);
          expect(passed.toMove).toBe(otherMark(mark) === "X" ? 0 : 1);
          state = passed;
          continue;
        }
        const index = Math.floor(random.next() * moves.length);
        const move = moves[Math.min(index, moves.length - 1)] as ReversiMove;
        const played = applyMove(state, move);
        if (move.kind === "place") {
          const column = move.cell % REVERSI_SIZE;
          const row = Math.floor(move.cell / REVERSI_SIZE);
          expect(naiveRows(played.discs)).toEqual(naivePlay(rows, mark, column, row));
        }
        state = played;
      }
    }
    expect(passesSeen).toBeGreaterThan(0);
  });
});

describe("the score", () => {
  it("is zero on the symmetric opening, by hand", () => {
    // Positional weights cancel (no corner, X- or C-square is occupied),
    // mobility is four against four, and the counts are two against two.
    expect(evaluate(initialState())).toBe(0);
  });

  it("is the disc difference plus MATE on a full board, and its negation for the loser", () => {
    const discs = new Array<ReversiDisc>(REVERSI_CELLS).fill(0);
    for (let cell = 0; cell < REVERSI_CELLS; cell += 1) discs[cell] = cell < 40 ? 1 : 2;
    const zero = initialState({ discs, toMove: 0 });
    const one = initialState({ discs, toMove: 1 });
    expect(legalMoves(zero)).toHaveLength(0);
    expect(result(zero)).toEqual({ status: "win", winner: 0, reason: "pieces" });
    // Seat 1 to move changes whose turn it is, not who owns the discs: seat 1
    // has 24 and seat 0 has 40, so the win is still seat 0's.
    expect(result(one)).toEqual({ status: "win", winner: 0, reason: "pieces" });
    expect(evaluate(zero)).toBe(10_016);
    expect(evaluate(one)).toBe(-10_016);
    expect(bestMove(zero, 3, createSeededRandom(1))).toEqual({
      move: null,
      score: 10_016,
      depth: 0,
      nodes: 0,
      cut: false,
    });
  });

  it("draws when the count is equal", () => {
    const discs = new Array<ReversiDisc>(REVERSI_CELLS).fill(0);
    for (let cell = 0; cell < REVERSI_CELLS; cell += 1) discs[cell] = cell % 2 === 0 ? 1 : 2;
    const state = initialState({ discs, toMove: 0 });
    expect(result(state)).toEqual({ status: "draw", winner: null, reason: "pieces" });
    expect(evaluate(state)).toBe(0);
  });
});

describe("the computer", () => {
  it("always answers with a legal move, and never spends more than its budget", () => {
    const random = createSeededRandom(0xbeef);
    let checked = 0;
    // A hundred positions: a thousand searches at level 3 kept this file busy for 339 s
    // on the CI runners, and every level-3 answer is drawn from `legalMoves` either way.
    for (let sample = 0; sample < 100; sample += 1) {
      let state = initialState();
      const plies = Math.floor(random.next() * 30);
      for (let ply = 0; ply < plies; ply += 1) {
        const moves = legalMoves(state);
        if (moves.length === 0) break;
        state = applyMove(state, moves[Math.floor(random.next() * moves.length)] as ReversiMove);
      }
      const level = 3;
      const choice = bestMove(state, level, createSeededRandom(sample));
      expect(choice.nodes).toBeLessThanOrEqual(REVERSI_LEVELS[level - 1]!.nodeBudget);
      const moves = legalMoves(state);
      if (moves.length === 0) {
        expect(choice.move).toBeNull();
        continue;
      }
      checked += 1;
      expect(choice.move).not.toBeNull();
      expect(moves).toContainEqual(choice.move);
    }
    expect(checked).toBeGreaterThan(90);
  }, 180_000);

  it("prefers a corner to giving one away", () => {
    // Seat 0 may take the a1 corner (turning b2 over) or play the middle of
    // the board (turning f6 over). Both are legal; the corner is worth more
    // than any disc, and the search is what has to see that.
    const state = grid([
      "........",
      ".O......",
      "..X.....",
      "........",
      "........",
      "......O.",
      ".......X",
      "........",
    ]);
    const moves = legalMoves(state).map((move) => (move.kind === "place" ? move.cell : -1));
    expect(moves).toContain(square("a1"));
    expect(moves).toContain(square("f5"));
    const choice = bestMove(state, 3, createSeededRandom(7));
    expect(choice.move).toEqual({ kind: "place", cell: square("a1") });
  });
});

describe("the saved game", () => {
  it("round-trips through JSON", () => {
    let state = initialState();
    state = applyMove(state, { kind: "place", cell: square("d3") });
    state = applyMove(state, { kind: "place", cell: square("c5") });
    expect(fromJSON(toJSON(state))).toEqual(state);
    expect(fromJSON(JSON.parse(JSON.stringify(toJSON(state))) as unknown)).toEqual(state);
  });

  it("refuses a malformed saved game", () => {
    expect(() => fromJSON(null)).toThrowError(InvalidStateError);
    expect(() => fromJSON({ discs: [0], toMove: 0 })).toThrowError(InvalidStateError);
    const discs = new Array<ReversiDisc>(REVERSI_CELLS).fill(0);
    discs[0] = 7 as ReversiDisc;
    expect(() => fromJSON({ discs, toMove: 0 })).toThrowError(InvalidStateError);
    expect(() =>
      fromJSON({ discs: new Array<ReversiDisc>(REVERSI_CELLS).fill(0), toMove: 2 }),
    ).toThrowError(InvalidStateError);
  });
});

