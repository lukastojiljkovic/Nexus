/**
 * Sudoku — the 9×9 generator, the solver that proves its puzzles, and the
 * technique ladder a hint and a difficulty grade are read from.
 *
 * **The generator proves as it digs.** A full grid is laid down first, then the
 * cells are emptied one at a time in a shuffled order, and a hole is kept only
 * while the puzzle still has exactly ONE completion (the solver below counts up
 * to two, which is all "is it unique" needs). So uniqueness is a property of
 * every puzzle this module hands out, not a hope about them, and the acceptance
 * test re-checks it from the outside with the same counter.
 *
 * **The solver is constraint propagation plus backtracking, and the two halves
 * have different jobs.** The technique ladder in `firstStep` is propagation — it
 * places or removes candidates a human can justify, and it is what a HINT and a
 * DIFFICULTY GRADE are computed from. The bitmask search underneath
 * (`countSolutions`) backtracks, is used by the generator and by
 * `sudokuSolution`, and is never asked what technique anything was.
 *
 * **The ladder, weakest first.** A puzzle's grade is the weakest rung that still
 * finishes it, because the solver always takes the first step the ladder offers:
 *
 *  1. `naked-single`, `hidden-single` — one digit left in a cell, or one cell
 *     left for a digit in a unit. A puzzle that needs nothing else is **easy**.
 *  2. `naked-pair`, `hidden-pair`, `pointing`, `box-line` — two candidates
 *     locked to two cells, or a digit locked to a line inside a box (and the
 *     mirror). A puzzle that needs any of these is **medium**.
 *  3. `x-wing` — a digit cornered in two rows at the same two columns (and the
 *     transposed fish). A puzzle that needs it is **hard**, and so is one the
 *     ladder cannot finish at all: everything past X-wing is out of scope here,
 *     and calling the top rung "hard" is honest about that rather than
 *     pretending the grade ladder is complete.
 *
 * **Candidates are carried, not recomputed.** Once a step eliminates a digit
 * from a cell, recomputing candidates from the grid alone would put it back, so
 * the technique solver maintains the mask table as it goes: a placement clears
 * the cell and drops the digit from its peers, an elimination only clears bits.
 * That is also what makes a hint's promise true — every candidate it removes
 * from a grid that was solvable leaves the solution untouched.
 *
 * Pure and platform-neutral: no clock, no IO, no `Math.random`. The caller
 * brings a seed, and a seed replays the same puzzle.
 */

import type { SeededRandom } from "../random.js";
import { createSeededRandom, shuffled } from "../random.js";

export type SudokuCells = readonly number[];

/** The rungs of the ladder above, weakest first. */
export type SudokuDifficulty = "easy" | "medium" | "hard";

export type SudokuTechnique =
  | "naked-single"
  | "hidden-single"
  | "naked-pair"
  | "hidden-pair"
  | "pointing"
  | "box-line"
  | "x-wing";

interface SudokuHintBase {
  readonly technique: SudokuTechnique;
  /** The cells the step is justified by: the pair, the pointing box's cells, the fish's four corners. */
  readonly pattern: readonly number[];
}

/** One cell, one digit, one placement. */
export interface SudokuFillHint extends SudokuHintBase {
  readonly action: "fill";
  readonly cell: number;
  readonly digit: number;
}

/** Every digit in `digits`, struck from every cell in `cells`. */
export interface SudokuEliminateHint extends SudokuHintBase {
  readonly action: "eliminate";
  readonly cells: readonly number[];
  readonly digits: readonly number[];
}

/**
 * Every cell in `cells` keeps only `digits`. A hidden pair is phrased this way
 * and not as an elimination because what it removes differs per cell, and a
 * caller that applied one flat digit list to both would be erasing candidates
 * the technique never licensed.
 */
export interface SudokuNarrowHint extends SudokuHintBase {
  readonly action: "narrow";
  readonly cells: readonly number[];
  readonly digits: readonly number[];
}

/**
 * The next logical step for a grid, as a human would describe it: the technique,
 * what it does, and the cells that justify it.
 */
export type SudokuHint = SudokuFillHint | SudokuEliminateHint | SudokuNarrowHint;

export interface SudokuPuzzle {
  /** Eighty-one cells, row-major, `0` where the puzzle is empty. */
  readonly cells: readonly number[];
  /** The one completion of `cells`. */
  readonly solution: readonly number[];
  /** The rung the techniques above need to finish `cells`. */
  readonly difficulty: SudokuDifficulty;
  readonly seed: number;
  /** How many cells `cells` fills. */
  readonly givens: number;
}

export interface SudokuOptions {
  /**
   * The hardest rung the puzzle may need. `easy` digs the fewest holes, so the
   * grid comes out solvable by singles alone; `hard` is the default and a cap
   * that cannot bite, since nothing here is graded above it. The grade in the
   * result is the one the finished puzzle actually earns, which can be weaker
   * than the cap.
   */
  readonly difficulty?: SudokuDifficulty;
  /** Only 9 exists; anything else is refused rather than approximated. */
  readonly size?: number;
}

const SIZE = 9;
const CELL_COUNT = SIZE * SIZE;
const ALL_DIGITS = 0x1ff;

const rowOf = (index: number): number => (index / SIZE) | 0;
const colOf = (index: number): number => index % SIZE;
const boxOf = (index: number): number =>
  (((index / (SIZE * 3)) | 0) * 3) + (((index % SIZE) / 3) | 0);
const bitOf = (digit: number): number => 1 << (digit - 1);

/**
 * The twenty-seven units of a grid — nine rows, then nine columns, then nine
 * boxes, in that order — exported because every surface that draws a sudoku
 * highlights a unit, and a second copy of these loops in the renderer is a
 * second thing to get wrong.
 */
export const SUDOKU_UNITS: readonly (readonly number[])[] = (() => {
  const units: number[][] = [];
  for (let row = 0; row < SIZE; row += 1) {
    units.push(Array.from({ length: SIZE }, (_, column) => row * SIZE + column));
  }
  for (let column = 0; column < SIZE; column += 1) {
    units.push(Array.from({ length: SIZE }, (_, row) => row * SIZE + column));
  }
  for (let box = 0; box < SIZE; box += 1) {
    const row0 = Math.floor(box / 3) * 3;
    const column0 = (box % 3) * 3;
    units.push(
      Array.from(
        { length: SIZE },
        (_, k) => (row0 + Math.floor(k / 3)) * SIZE + column0 + (k % 3),
      ),
    );
  }
  return units;
})();

/** The cells a placement constrains, in unit order, without the cell itself. */
const PEERS: readonly (readonly number[])[] = (() => {
  const peers: number[][] = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const seen = new Set<number>();
    for (const unit of SUDOKU_UNITS) {
      if (!unit.includes(index)) continue;
      for (const mate of unit) if (mate !== index) seen.add(mate);
    }
    peers.push([...seen]);
  }
  return peers;
})();

function popcount(mask: number): number {
  let count = 0;
  let rest = mask;
  while (rest !== 0) {
    rest &= rest - 1;
    count += 1;
  }
  return count;
}

/**
 * One element of a typed array. `noUncheckedIndexedAccess` reads every element
 * as possibly missing, which for a fixed-length `Int32Array` is a formality; the
 * masks are written with `|=` and `&=`, so the read needs naming exactly once.
 */
function at(array: Int32Array, index: number): number {
  return array[index] ?? 0;
}

/** The digits of a bitmask, ascending. */
function digitsOf(mask: number): number[] {
  const digits: number[] = [];
  for (let digit = 1; digit <= SIZE; digit += 1) if (mask & bitOf(digit)) digits.push(digit);
  return digits;
}

/** The lowest digit of a non-empty mask. */
function lowestDigit(mask: number): number {
  return 31 - Math.clz32(mask & -mask) + 1;
}

/**
 * The digits each empty cell may still hold, as bitmasks `1..9`; a filled cell
 * gets `0`. A cell whose mask is `0` is a dead end, and the caller finds that
 * out by trying to use it.
 */
function candidateMasks(cells: SudokuCells): Int32Array {
  const rows = new Int32Array(SIZE);
  const columns = new Int32Array(SIZE);
  const boxes = new Int32Array(SIZE);
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const value = cells[index] as number;
    if (value === 0) continue;
    const bit = bitOf(value);
    const row = rowOf(index);
    const column = colOf(index);
    const box = boxOf(index);
    rows[row] = at(rows, row) | bit;
    columns[column] = at(columns, column) | bit;
    boxes[box] = at(boxes, box) | bit;
  }
  const masks = new Int32Array(CELL_COUNT);
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if ((cells[index] as number) !== 0) continue;
    const used =
      at(rows, rowOf(index)) | at(columns, colOf(index)) | at(boxes, boxOf(index));
    masks[index] = ALL_DIGITS & ~used;
  }
  return masks;
}

/**
 * All completions of `cells` up to `limit`, with the first one found. A
 * duplicate already on the board is zero completions, not an error: a puzzle
 * with a conflict is a puzzle nobody can finish.
 *
 * The search picks the emptiest cell first (minimum remaining values) and tries
 * its digits in ascending order, so it is deterministic and the solution a
 * caller gets for a puzzle never depends on the machine.
 */
function countSolutionsInner(
  cells: SudokuCells,
  limit: number,
): { count: number; first: number[] | null } {
  const grid = new Int32Array(CELL_COUNT);
  const rows = new Int32Array(SIZE);
  const columns = new Int32Array(SIZE);
  const boxes = new Int32Array(SIZE);
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const value = cells[index] as number;
    grid[index] = value;
    if (value === 0) continue;
    const bit = bitOf(value);
    const row = rowOf(index);
    const column = colOf(index);
    const box = boxOf(index);
    if (((rows[row] as number) | (columns[column] as number) | (boxes[box] as number)) & bit) {
      return { count: 0, first: null };
    }
    rows[row] = at(rows, row) | bit;
    columns[column] = at(columns, column) | bit;
    boxes[box] = at(boxes, box) | bit;
  }

  let count = 0;
  let first: number[] | null = null;

  const recurse = (): void => {
    let best = -1;
    let bestMask = 0;
    let bestCount = SIZE + 1;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if ((grid[index] as number) !== 0) continue;
      const mask =
        ALL_DIGITS &
        ~((rows[rowOf(index)] as number) |
          (columns[colOf(index)] as number) |
          (boxes[boxOf(index)] as number));
      const available = popcount(mask);
      if (available === 0) return;
      if (available < bestCount) {
        bestCount = available;
        best = index;
        bestMask = mask;
        if (available === 1) break;
      }
    }
    if (best === -1) {
      count += 1;
      if (first === null) first = Array.from(grid);
      return;
    }
    const row = rowOf(best);
    const column = colOf(best);
    const box = boxOf(best);
    for (let digit = 1; digit <= SIZE; digit += 1) {
      const bit = bitOf(digit);
      if ((bestMask & bit) === 0) continue;
      grid[best] = digit;
      rows[row] = at(rows, row) | bit;
      columns[column] = at(columns, column) | bit;
      boxes[box] = at(boxes, box) | bit;
      recurse();
      grid[best] = 0;
      rows[row] = at(rows, row) & ~bit;
      columns[column] = at(columns, column) & ~bit;
      boxes[box] = at(boxes, box) & ~bit;
      if (count >= limit) return;
    }
  };

  recurse();
  return { count, first };
}

/** The one completion of `cells`, or `null` when there is none, or more than one. */
export function sudokuSolution(cells: SudokuCells): number[] | null {
  const { count, first } = countSolutionsInner(cells, 2);
  return count === 1 ? first : null;
}

/**
 * How many completions `cells` has, counted no further than `limit` — the
 * generator's own question is "exactly one", and two is its limit.
 */
export function countSudokuSolutions(cells: SudokuCells, limit = 2): number {
  return countSolutionsInner(cells, limit).count;
}

/** The digits each empty cell may hold, and an empty list for a filled one. */
export function sudokuCandidates(cells: SudokuCells): readonly (readonly number[])[] {
  const masks = candidateMasks(cells);
  return Array.from({ length: CELL_COUNT }, (_, index) =>
    (cells[index] as number) === 0 ? digitsOf(masks[index] as number) : [],
  );
}

/**
 * The cells that duplicate a digit inside a unit — every cell of every offending
 * group, not just the later one, because a surface has to mark both to be
 * useful. Sorted, so a test can name the answer.
 */
export function sudokuConflicts(cells: SudokuCells): readonly number[] {
  const offending = new Set<number>();
  for (const unit of SUDOKU_UNITS) {
    const byDigit = new Map<number, number[]>();
    for (const index of unit) {
      const value = cells[index] as number;
      if (value === 0) continue;
      const seen = byDigit.get(value);
      if (seen) seen.push(index);
      else byDigit.set(value, [index]);
    }
    for (const group of byDigit.values()) {
      if (group.length < 2) continue;
      for (const index of group) offending.add(index);
    }
  }
  return [...offending].sort((a, b) => a - b);
}

/** The technique solver's working state: the grid plus candidates it carries. */
interface LogicalState {
  grid: Int32Array;
  candidates: Int32Array;
}

function findNakedSingle(state: LogicalState): SudokuHint | null {
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if ((state.grid[index] as number) !== 0) continue;
    const mask = state.candidates[index] as number;
    if (popcount(mask) !== 1) continue;
    return {
      technique: "naked-single",
      action: "fill",
      cell: index,
      digit: lowestDigit(mask),
      pattern: [index],
    };
  }
  return null;
}

function findHiddenSingle(state: LogicalState): SudokuHint | null {
  for (const unit of SUDOKU_UNITS) {
    for (let digit = 1; digit <= SIZE; digit += 1) {
      const bit = bitOf(digit);
      let only = -1;
      let found = 0;
      for (const index of unit) {
        if ((state.grid[index] as number) !== 0) continue;
        if (((state.candidates[index] as number) & bit) === 0) continue;
        only = index;
        found += 1;
        if (found > 1) break;
      }
      if (found === 1) {
        return {
          technique: "hidden-single",
          action: "fill",
          cell: only,
          digit,
          pattern: [only],
        };
      }
    }
  }
  return null;
}

function findNakedPair(state: LogicalState): SudokuHint | null {
  for (const unit of SUDOKU_UNITS) {
    for (let a = 0; a < unit.length; a += 1) {
      const first = unit[a] as number;
      if ((state.grid[first] as number) !== 0) continue;
      const mask = state.candidates[first] as number;
      if (popcount(mask) !== 2) continue;
      for (let b = a + 1; b < unit.length; b += 1) {
        const second = unit[b] as number;
        if ((state.grid[second] as number) !== 0) continue;
        if ((state.candidates[second] as number) !== mask) continue;
        const targets = unit.filter(
          (index) =>
            index !== first &&
            index !== second &&
            (state.grid[index] as number) === 0 &&
            ((state.candidates[index] as number) & mask) !== 0,
        );
        if (targets.length === 0) continue;
        return {
          technique: "naked-pair",
          action: "eliminate",
          cells: targets,
          digits: digitsOf(mask),
          pattern: [first, second],
        };
      }
    }
  }
  return null;
}

function findHiddenPair(state: LogicalState): SudokuHint | null {
  for (const unit of SUDOKU_UNITS) {
    for (let d1 = 1; d1 <= SIZE; d1 += 1) {
      for (let d2 = d1 + 1; d2 <= SIZE; d2 += 1) {
        const bit1 = bitOf(d1);
        const bit2 = bitOf(d2);
        const where1 = unit.filter(
          (index) =>
            (state.grid[index] as number) === 0 &&
            ((state.candidates[index] as number) & bit1) !== 0,
        );
        if (where1.length !== 2) continue;
        const where2 = unit.filter(
          (index) =>
            (state.grid[index] as number) === 0 &&
            ((state.candidates[index] as number) & bit2) !== 0,
        );
        if (where2.length !== 2) continue;
        if (where1[0] !== where2[0] || where1[1] !== where2[1]) continue;
        const foreign = (bit1 | bit2) ^ ALL_DIGITS;
        const targets = where1.filter(
          (index) => ((state.candidates[index] as number) & foreign) !== 0,
        );
        if (targets.length === 0) continue;
        return {
          technique: "hidden-pair",
          action: "narrow",
          cells: targets,
          digits: [d1, d2],
          pattern: where1,
        };
      }
    }
  }
  return null;
}

interface BoxSpan {
  readonly rows: readonly number[];
  readonly columns: readonly number[];
  readonly cells: readonly number[];
}

/** The boxes' row, column and cell spans, in box order. */
const BOX_SPANS: readonly BoxSpan[] = Array.from({ length: SIZE }, (_, box) => {
  const row0 = Math.floor(box / 3) * 3;
  const column0 = (box % 3) * 3;
  const rows = [row0, row0 + 1, row0 + 2];
  const columns = [column0, column0 + 1, column0 + 2];
  const cells: number[] = [];
  for (const row of rows) for (const column of columns) cells.push(row * SIZE + column);
  return { rows, columns, cells };
});

function findPointing(state: LogicalState): SudokuHint | null {
  for (let box = 0; box < SIZE; box += 1) {
    const span = BOX_SPANS[box] as BoxSpan;
    const inside = span.cells;
    for (let digit = 1; digit <= SIZE; digit += 1) {
      const bit = bitOf(digit);
      const held = inside.filter(
        (index) =>
          (state.grid[index] as number) === 0 &&
          ((state.candidates[index] as number) & bit) !== 0,
      );
      if (held.length < 2) continue;
      const rows = new Set(held.map(rowOf));
      if (rows.size === 1) {
        const row = rowOf(held[0] as number);
        const targets = (SUDOKU_UNITS[row] as readonly number[]).filter(
          (index) =>
            !inside.includes(index) &&
            (state.grid[index] as number) === 0 &&
            ((state.candidates[index] as number) & bit) !== 0,
        );
        if (targets.length > 0) {
          return {
            technique: "pointing",
            action: "eliminate",
            cells: targets,
            digits: [digit],
            pattern: held,
          };
        }
      }
      const columns = new Set(held.map(colOf));
      if (columns.size === 1) {
        const column = colOf(held[0] as number);
        const targets = (SUDOKU_UNITS[SIZE + column] as readonly number[]).filter(
          (index) =>
            !inside.includes(index) &&
            (state.grid[index] as number) === 0 &&
            ((state.candidates[index] as number) & bit) !== 0,
        );
        if (targets.length > 0) {
          return {
            technique: "pointing",
            action: "eliminate",
            cells: targets,
            digits: [digit],
            pattern: held,
          };
        }
      }
    }
  }
  return null;
}

function findBoxLine(state: LogicalState): SudokuHint | null {
  for (let unitIndex = 0; unitIndex < SIZE * 2; unitIndex += 1) {
    const unit = SUDOKU_UNITS[unitIndex] as readonly number[];
    for (let digit = 1; digit <= SIZE; digit += 1) {
      const bit = bitOf(digit);
      const held = unit.filter(
        (index) =>
          (state.grid[index] as number) === 0 &&
          ((state.candidates[index] as number) & bit) !== 0,
      );
      if (held.length < 2) continue;
      const boxes = new Set(held.map(boxOf));
      if (boxes.size !== 1) continue;
      const box = boxOf(held[0] as number);
      const targets = (SUDOKU_UNITS[SIZE * 2 + box] as readonly number[]).filter(
        (index) =>
          !held.includes(index) &&
          (state.grid[index] as number) === 0 &&
          ((state.candidates[index] as number) & bit) !== 0,
      );
      if (targets.length > 0) {
        return {
          technique: "box-line",
          action: "eliminate",
          cells: targets,
          digits: [digit],
          pattern: held,
        };
      }
    }
  }
  return null;
}

function findXWing(state: LogicalState): SudokuHint | null {
  for (let digit = 1; digit <= SIZE; digit += 1) {
    const bit = bitOf(digit);
    const lines: { index: number; places: number[] }[] = [];
    for (let unitIndex = 0; unitIndex < SIZE * 2; unitIndex += 1) {
      const unit = SUDOKU_UNITS[unitIndex] as readonly number[];
      const places = unit.filter(
        (index) =>
          (state.grid[index] as number) === 0 &&
          ((state.candidates[index] as number) & bit) !== 0,
      );
      if (places.length === 2) lines.push({ index: unitIndex, places });
    }
    for (let a = 0; a < lines.length; a += 1) {
      for (let b = a + 1; b < lines.length; b += 1) {
        const first = lines[a] as NonNullable<(typeof lines)[number]>;
        const second = lines[b] as NonNullable<(typeof lines)[number]>;
        // The two lines must run the same way (both rows or both columns) and
        // hold the digit in the same two places on the crossing axis.
        const transposed = (first.index < SIZE) !== (second.index < SIZE);
        if (transposed) continue;
        const firstRow = first.index < SIZE;
        const crossingA = first.places.map((index) => (firstRow ? colOf(index) : rowOf(index)));
        const crossingB = second.places.map((index) => (firstRow ? colOf(index) : rowOf(index)));
        if (crossingA[0] !== crossingB[0] || crossingA[1] !== crossingB[1]) continue;
        const corners = [...first.places, ...second.places];
        const targets: number[] = [];
        for (const crossing of crossingA as number[]) {
          const unit = SUDOKU_UNITS[(firstRow ? SIZE : 0) + crossing] as readonly number[];
          for (const index of unit) {
            if (corners.includes(index)) continue;
            if ((state.grid[index] as number) !== 0) continue;
            if (((state.candidates[index] as number) & bit) === 0) continue;
            targets.push(index);
          }
        }
        if (targets.length > 0) {
          return {
            technique: "x-wing",
            action: "eliminate",
            cells: targets,
            digits: [digit],
            pattern: corners,
          };
        }
      }
    }
  }
  return null;
}

/** The weakest step the ladder can take on this state, or `null` if it is stuck. */
function firstStep(state: LogicalState): SudokuHint | null {
  return (
    findNakedSingle(state) ??
    findHiddenSingle(state) ??
    findNakedPair(state) ??
    findHiddenPair(state) ??
    findPointing(state) ??
    findBoxLine(state) ??
    findXWing(state)
  );
}

function applyStep(state: LogicalState, step: SudokuHint): void {
  if (step.action === "fill") {
    const bit = bitOf(step.digit);
    const cell = step.cell;
    state.grid[cell] = step.digit;
    state.candidates[cell] = 0;
    for (const peer of PEERS[cell] as readonly number[]) {
      state.candidates[peer] = at(state.candidates, peer) & ~bit;
    }
    return;
  }
  if (step.action === "eliminate") {
    let bits = 0;
    for (const digit of step.digits) bits |= bitOf(digit);
    for (const cell of step.cells) state.candidates[cell] = at(state.candidates, cell) & ~bits;
    return;
  }
  let keep = 0;
  for (const digit of step.digits) keep |= bitOf(digit);
  for (const cell of step.cells) state.candidates[cell] = at(state.candidates, cell) & keep;
}

function stateOf(cells: SudokuCells): LogicalState {
  return { grid: Int32Array.from(cells), candidates: candidateMasks(cells) };
}

function isComplete(grid: Int32Array): boolean {
  return grid.every((value) => value !== 0);
}

/**
 * The next logical step for `cells`, or `null` when the ladder has nothing left
 * to offer — a finished grid, or one that needs a technique past X-wing (or has
 * no solution at all, which the ladder cannot tell apart from that).
 */
export function sudokuHint(cells: SudokuCells): SudokuHint | null {
  const state = stateOf(cells);
  if (isComplete(state.grid)) return null;
  return firstStep(state);
}

/**
 * What the ladder alone makes of a grid: the techniques it used, in the order it
 * used them, and whether it finished.
 *
 * The ladder is applied weakest-first at every step, so this is the least
 * demanding route through the puzzle and not an artefact of the order the
 * techniques happen to be written in. It is exported rather than kept private to
 * the grade because a surface can replay it: the same list that grades a puzzle
 * says which step to show next.
 */
export interface SudokuLogicalSolve {
  /** True when the ladder filled every cell without being told the answer. */
  readonly solved: boolean;
  readonly techniques: readonly SudokuTechnique[];
}

export function solveSudokuLogically(cells: SudokuCells): SudokuLogicalSolve {
  const state = stateOf(cells);
  const techniques: SudokuTechnique[] = [];
  // A guard, not a budget: every step either fills a cell or removes a candidate
  // bit, and both are finite, so the loop terminates on its own.
  for (let guard = 0; guard < 200_000; guard += 1) {
    const step = firstStep(state);
    if (step === null) break;
    techniques.push(step.technique);
    applyStep(state, step);
  }
  return { solved: isComplete(state.grid), techniques };
}

/**
 * The rung `cells` is solved on: the weakest technique the ladder needs to
 * finish it, or `hard` when the ladder cannot finish it at all.
 */
export function sudokuDifficulty(cells: SudokuCells): SudokuDifficulty {
  const { solved, techniques } = solveSudokuLogically(cells);
  if (!solved) return "hard";
  if (techniques.includes("x-wing")) return "hard";
  if (techniques.some((technique) => !technique.endsWith("single"))) return "medium";
  return "easy";
}

/**
 * A complete valid grid, from the standard shift pattern
 * `(3a + floor(a/3) + b) mod 9` with the bands, the rows inside them, the stacks,
 * the columns inside them and the nine digits each permuted. Every permutation
 * there preserves validity, and together they reach far more grids than the
 * pattern alone — with the seed reshuffling them all, the same seed always
 * yields the same grid and different seeds yield unrelated ones.
 */
function filledGrid(random: SeededRandom): number[] {
  const rowOrder: number[] = [];
  for (const band of shuffled([0, 1, 2], random)) {
    for (const row of shuffled([0, 1, 2], random)) rowOrder.push(band * 3 + row);
  }
  const columnOrder: number[] = [];
  for (const stack of shuffled([0, 1, 2], random)) {
    for (const column of shuffled([0, 1, 2], random)) columnOrder.push(stack * 3 + column);
  }
  const digits = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], random);
  const cells = new Array<number>(CELL_COUNT);
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      const a = rowOrder[row] as number;
      const b = columnOrder[column] as number;
      const base = (a * 3 + Math.floor(a / 3) + b) % SIZE;
      cells[row * SIZE + column] = digits[base] as number;
    }
  }
  return cells;
}

const CELL_INDEXES: readonly number[] = Array.from({ length: CELL_COUNT }, (_, i) => i);

const RUNG: Record<SudokuDifficulty, number> = { easy: 0, medium: 1, hard: 2 };

/**
 * Holes, dug one cell at a time, kept only while the puzzle stays unique. A cap
 * is applied by grading after each hole that survives: a hole that pushes the
 * puzzle past the cap is filled back in, and the dig carries on with the cells
 * that are left. Grading here is the expensive half and runs only when a cap was
 * asked for.
 */
function digHoles(
  solution: readonly number[],
  random: SeededRandom,
  cap: SudokuDifficulty | undefined,
): number[] {
  const cells = [...solution];
  for (const index of shuffled(CELL_INDEXES, random)) {
    const saved = cells[index] as number;
    cells[index] = 0;
    if (countSolutionsInner(cells, 2).count !== 1) {
      cells[index] = saved;
      continue;
    }
    if (cap !== undefined && RUNG[sudokuDifficulty(cells)] > RUNG[cap]) cells[index] = saved;
  }
  return cells;
}

/**
 * A puzzle for `seed`: unique by construction, and graded by the techniques it
 * needs. The same seed builds the same puzzle, which is what lets a test name an
 * exact grid and the app store only the seed.
 */
export function generateSudoku(seed: number, options: SudokuOptions = {}): SudokuPuzzle {
  const size = options.size ?? SIZE;
  if (size !== SIZE) {
    throw new RangeError(`generateSudoku: this engine builds 9x9 puzzles only, got ${size}`);
  }
  const random = createSeededRandom(seed);
  const solution = filledGrid(random);
  const cells = digHoles(solution, random, options.difficulty);
  return {
    cells,
    solution,
    difficulty: sudokuDifficulty(cells),
    seed,
    givens: cells.filter((value) => value !== 0).length,
  };
}
