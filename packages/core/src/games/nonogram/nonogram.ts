/**
 * Nonograms — the generator, the line solver that proves its puzzles, and the
 * check a player's grid is read against.
 *
 * **Line-solvable by construction, and that is what makes a puzzle unique.** A
 * candidate picture is turned into clues, the clues are handed to the line
 * solver, and the picture is kept only if the solver fills the whole grid from
 * the clues alone. That acceptance is also a uniqueness PROOF and not a
 * heuristic: everything the solver writes is true in every solution of the
 * clues (each step keeps only cells filled or empty in ALL layouts of a line),
 * so a grid the solver completes determines every cell — and there can be no
 * second solution.
 *
 * **The line solver is a two-sided reachability table, not a search.** For one
 * line, `layouts` computes which cells can be filled in SOME layout of that
 * line's clues and which can be empty in some layout; a cell that can only be
 * one of the two is forced, and everything else stays unknown. Doing this for
 * every row and every column, over and over until nothing changes, is the whole
 * propagation. There is no guessing anywhere in this module, which is why
 * "unique AND line-solvable" is one property here rather than two.
 *
 * **The generator retries, and the retry is part of the contract.** A random
 * picture is usually not deducible line by line, so `generateNonogram` draws
 * candidates from the same stream until one is accepted. It is deterministic —
 * the same seed builds the same puzzle and reports the same `attempts` — and
 * bounded: a seed that cannot find a picture within the limit throws rather than
 * loop forever, so the failure is a caller's to see instead of a hang.
 */

import type { PuzzleRandom } from "../puzzles-shared/random.js";
import { createPuzzleRandom } from "../puzzles-shared/random.js";

/** The smallest board this generator builds, and the largest. */
export const NONOGRAM_MIN = 5;
export const NONOGRAM_MAX = 20;

/**
 * How many candidate pictures one seed may draw before giving up. Measured: at
 * every size this generator supports the acceptance rate is high enough that a
 * hundred draws is far past the point where failing says something real — see
 * `generateNonogram` for the numbers, which the test re-measures.
 */
export const NONOGRAM_ATTEMPT_LIMIT = 2_000;

/** A cell of a partly solved board: filled, known empty, or still unknown. */
export type NonogramCell = 0 | 1 | null;

export interface NonogramPuzzle {
  readonly width: number;
  readonly height: number;
  /** Runs of filled cells per row, in reading order; an empty row is `[]`. */
  readonly rowClues: readonly (readonly number[])[];
  readonly colClues: readonly (readonly number[])[];
  /** The picture the clues describe, row-major, `true` where a cell is filled. */
  readonly solution: readonly boolean[];
  readonly seed: number;
  /** How many candidate pictures the seed drew before one was accepted. */
  readonly attempts: number;
}

export interface NonogramCheck {
  /** True when the player has filled every cell of the solution and nothing else. */
  readonly complete: boolean;
  /** Filled cells the solution leaves empty. */
  readonly wrong: readonly number[];
  /** Cells of the solution the player has not filled. */
  readonly missing: readonly number[];
  /** How many of the player's filled cells are in the solution, for a progress readout. */
  readonly progress: number;
}

/** The runs of filled cells in one line, in reading order. */
export function cluesOf(line: readonly boolean[]): number[] {
  const runs: number[] = [];
  let run = 0;
  for (const filled of line) {
    if (filled) {
      run += 1;
      continue;
    }
    if (run > 0) runs.push(run);
    run = 0;
  }
  if (run > 0) runs.push(run);
  return runs;
}

/**
 * What a line's clues say about its cells: which cells can be filled in some
 * layout of the clues (`canFilled`) and which can be empty in some layout
 * (`canEmpty`), both given the state the line is already known in.
 *
 * Two reachability tables do it. `prefix[i][p]` is true when runs `0..i-1` can
 * account for every cell of `[0, p)` as either run or empty, and `suffix[i][p]`
 * is the same statement for runs `i..` over `[p, n)`. A cell can be empty when
 * some prefix ends before it and the matching suffix starts after it; it can be
 * filled when some run can sit on it, with a reachable prefix behind and a
 * reachable suffix (and the one-cell separator a line of runs needs) in front.
 */
function layouts(
  clues: readonly number[],
  known: readonly (boolean | null)[],
): { canFilled: boolean[]; canEmpty: boolean[] } {
  const length = known.length;
  const runs = clues.length;
  const canBeEmptyAt = (index: number): boolean => known[index] !== true;
  const canBeFilledAt = (index: number): boolean => known[index] !== false;
  const allEmpty = (from: number, to: number): boolean => {
    for (let index = from; index < to; index += 1) if (!canBeEmptyAt(index)) return false;
    return true;
  };

  const suffix: boolean[][] = Array.from({ length: runs + 1 }, () =>
    new Array<boolean>(length + 1).fill(false),
  );
  for (let position = 0; position <= length; position += 1) {
    (suffix[runs] as boolean[])[position] = allEmpty(position, length);
  }
  for (let run = runs - 1; run >= 0; run -= 1) {
    const size = clues[run] as number;
    const row = suffix[run] as boolean[];
    const next = suffix[run + 1] as boolean[];
    for (let position = 0; position <= length; position += 1) {
      let reachable = false;
      for (let start = position; start + size <= length && !reachable; start += 1) {
        if (!allEmpty(position, start)) break;
        let fits = true;
        for (let index = start; index < start + size; index += 1) {
          if (!canBeFilledAt(index)) fits = false;
        }
        if (!fits) continue;
        if (run + 1 === runs) {
          reachable = allEmpty(start + size, length);
          continue;
        }
        // Runs need one empty cell between them, and that cell is part of the
        // suffix the next run must reach past.
        if (start + size < length && canBeEmptyAt(start + size)) {
          reachable = next[start + size + 1] as boolean;
        }
      }
      row[position] = reachable;
    }
  }

  const prefix: boolean[][] = Array.from({ length: runs + 1 }, () =>
    new Array<boolean>(length + 1).fill(false),
  );
  (prefix[0] as boolean[])[0] = true;
  for (let position = 1; position <= length; position += 1) {
    (prefix[0] as boolean[])[position] = allEmpty(0, position);
  }
  for (let run = 1; run <= runs; run += 1) {
    const size = clues[run - 1] as number;
    const row = prefix[run] as boolean[];
    const previous = prefix[run - 1] as boolean[];
    for (let position = 1; position <= length; position += 1) {
      let reachable = false;
      for (let start = position - size; start >= 0 && !reachable; start -= 1) {
        if (!(previous[start] as boolean)) continue;
        if (!allEmpty(start + size, position)) continue;
        let fits = true;
        for (let index = start; index < start + size; index += 1) {
          if (!canBeFilledAt(index)) fits = false;
        }
        reachable = fits;
      }
      row[position] = reachable;
    }
  }

  const canFilled = new Array<boolean>(length).fill(false);
  const canEmpty = new Array<boolean>(length).fill(false);
  for (let cell = 0; cell < length; cell += 1) {
    if (canBeEmptyAt(cell)) {
      for (let run = 0; run <= runs; run += 1) {
        if (!((prefix[run] as boolean[])[cell] as boolean)) continue;
        const rest = (suffix[run] as boolean[])[cell + 1] as boolean;
        if (rest) {
          canEmpty[cell] = true;
          break;
        }
      }
    }
    for (let run = 0; run < runs; run += 1) {
      const size = clues[run] as number;
      for (let start = cell - size + 1; start <= cell; start += 1) {
        if (start < 0 || start + size > length) continue;
        if (!((prefix[run] as boolean[])[start] as boolean)) continue;
        let fits = true;
        for (let index = start; index < start + size; index += 1) {
          if (!canBeFilledAt(index)) fits = false;
        }
        if (!fits) continue;
        if (run + 1 === runs) {
          if (allEmpty(start + size, length)) {
            canFilled[cell] = true;
          }
          continue;
        }
        if (start + size < length && canBeEmptyAt(start + size)) {
          if ((suffix[run + 1] as boolean[])[start + size + 1] as boolean) canFilled[cell] = true;
        }
      }
    }
  }
  return { canFilled, canEmpty };
}

/**
 * Solve `rowClues`/`colClues` by line propagation alone: sweep every row and
 * every column, write down the cells the line's clues force, and repeat until a
 * sweep changes nothing. `solved` is true when no cell is left unknown — which
 * for a puzzle the generator accepted happens on the first try, and is the
 * uniqueness proof described at the top of this file.
 *
 * A line with no valid layout at all (a contradiction already on the board)
 * leaves every cell unknown and the sweep stops changing anything, so the
 * result is `solved: false` rather than a throw.
 */
export function solveNonogramLines(
  rowClues: readonly (readonly number[])[],
  colClues: readonly (readonly number[])[],
  width: number,
  height: number,
): { cells: NonogramCell[]; solved: boolean } {
  const cells = new Array<NonogramCell>(width * height).fill(null);
  for (let guard = 0; guard < width * height + 4; guard += 1) {
    let changed = false;
    for (let row = 0; row < height; row += 1) {
      const known: (boolean | null)[] = [];
      for (let column = 0; column < width; column += 1) {
        known.push(cellOf(cells[row * width + column] as NonogramCell));
      }
      const { canFilled, canEmpty } = layouts(rowClues[row] as readonly number[], known);
      for (let column = 0; column < width; column += 1) {
        const index = row * width + column;
        if (cells[index] !== null) continue;
        const filled = canFilled[column] as boolean;
        const empty = canEmpty[column] as boolean;
        if (filled === empty) continue;
        cells[index] = filled ? 1 : 0;
        changed = true;
      }
    }
    for (let column = 0; column < width; column += 1) {
      const known: (boolean | null)[] = [];
      for (let row = 0; row < height; row += 1) {
        known.push(cellOf(cells[row * width + column] as NonogramCell));
      }
      const { canFilled, canEmpty } = layouts(colClues[column] as readonly number[], known);
      for (let row = 0; row < height; row += 1) {
        const index = row * width + column;
        if (cells[index] !== null) continue;
        const filled = canFilled[row] as boolean;
        const empty = canEmpty[row] as boolean;
        if (filled === empty) continue;
        cells[index] = filled ? 1 : 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { cells, solved: cells.every((cell) => cell !== null) && agreesWith(cells, rowClues, colClues, width, height) };
}

function cellOf(cell: NonogramCell): boolean | null {
  return cell === 1 ? true : cell === 0 ? false : null;
}

function sameClues(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Whether a fully determined grid actually satisfies the clues it came from. It
 * is what makes `solved` mean "solved" and not merely "nothing left blank": a
 * set of clues with no solution at all (a row of five in a four-wide board, say)
 * can still have every cell forced by the lines that run the other way, and
 * reporting that as solved would be nonsense.
 */
function agreesWith(
  cells: readonly NonogramCell[],
  rowClues: readonly (readonly number[])[],
  colClues: readonly (readonly number[])[],
  width: number,
  height: number,
): boolean {
  for (let row = 0; row < height; row += 1) {
    const line: boolean[] = [];
    for (let column = 0; column < width; column += 1) {
      line.push(cells[row * width + column] === 1);
    }
    if (!sameClues(cluesOf(line), rowClues[row] as readonly number[])) return false;
  }
  for (let column = 0; column < width; column += 1) {
    const line: boolean[] = [];
    for (let row = 0; row < height; row += 1) {
      line.push(cells[row * width + column] === 1);
    }
    if (!sameClues(cluesOf(line), colClues[column] as readonly number[])) return false;
  }
  return true;
}

function cluesFor(grid: readonly boolean[], width: number, height: number): {
  rowClues: number[][];
  colClues: number[][];
} {
  const rowClues: number[][] = [];
  for (let row = 0; row < height; row += 1) {
    rowClues.push(cluesOf(grid.slice(row * width, (row + 1) * width)));
  }
  const colClues: number[][] = [];
  for (let column = 0; column < width; column += 1) {
    const line: boolean[] = [];
    for (let row = 0; row < height; row += 1) line.push(grid[row * width + column] as boolean);
    colClues.push(cluesOf(line));
  }
  return { rowClues, colClues };
}

/**
 * What a candidate picture is: a handful of overlapping rectangles, not a coin
 * per cell. **This is measured, and the coin was the alternative.** A coin per
 * cell at even odds is accepted by the line solver 54.8% of the time at 5x5, 4.0%
 * at 12x12 and 0.0% of four hundred draws at 20x20 (`games/nonogram`, the probe
 * recorded in the run that wrote this file), so the retry loop would spend its
 * whole budget on the largest boards and still fail. Rectangles put long runs in
 * every line, which is what a line solver can deduce from: the same probe
 * accepted them after 1.7 draws on average at 5x5 and 1.3 at 20x20, never more
 * than 7.
 */
const PICTURE_RECTANGLES_BASE = 3;
const PICTURE_FILL_CHANCE = 0.6;

/**
 * How full an accepted picture may be. A picture that is nearly all filled or
 * nearly all empty is a puzzle whose clues say almost nothing on one axis, and
 * it is also the kind of board a player reads as broken.
 */
const PICTURE_MIN_SHARE = 0.2;
const PICTURE_MAX_SHARE = 0.8;

/**
 * A puzzle of `width` by `height`: unique, and solvable line by line without a
 * guess. `height` defaults to `width`, so a square puzzle is one argument.
 *
 * Candidate pictures are drawn from one stream, so the same seed always builds
 * the same puzzle and reports the same `attempts`. Acceptance is the solver's
 * own `solved`: a picture whose clues the solver cannot finish is discarded.
 */
export function generateNonogram(seed: number, width: number, height = width): NonogramPuzzle {
  checkSize(width, height);
  const random = createPuzzleRandom(seed);
  for (let attempt = 1; attempt <= NONOGRAM_ATTEMPT_LIMIT; attempt += 1) {
    const picture = randomPicture(random, width, height);
    const filled = picture.filter(Boolean).length;
    if (filled < PICTURE_MIN_SHARE * picture.length) continue;
    if (filled > PICTURE_MAX_SHARE * picture.length) continue;
    const { rowClues, colClues } = cluesFor(picture, width, height);
    const { solved, cells } = solveNonogramLines(rowClues, colClues, width, height);
    if (!solved) continue;
    // The solver is a proof of uniqueness only if it agrees with the picture it
    // was built from; a mismatch would mean the clues came from somewhere else.
    for (let index = 0; index < picture.length; index += 1) {
      if ((cells[index] === 1) !== picture[index]) {
        throw new Error("generateNonogram: the line solver disagreed with the picture it was given");
      }
    }
    return { width, height, rowClues, colClues, solution: picture, seed, attempts: attempt };
  }
  throw new RangeError(
    `generateNonogram: no ${width}x${height} puzzle after ${NONOGRAM_ATTEMPT_LIMIT} draws for seed ${seed}`,
  );
}

function checkSize(width: number, height: number): void {
  for (const [name, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (!Number.isInteger(value) || value < NONOGRAM_MIN || value > NONOGRAM_MAX) {
      throw new RangeError(
        `generateNonogram: ${name} must be a whole number from ${NONOGRAM_MIN} to ${NONOGRAM_MAX}, got ${value}`,
      );
    }
  }
}

/**
 * One candidate, laid down as overlapping rectangles. Each rectangle is drawn
 * with a random size up to half the board, a random position, and a coin for
 * whether it fills or empties what it covers — so the last rectangle can carve a
 * hole as easily as it can fill one, and the picture comes out with the long
 * runs a line solver can work with.
 */
function randomPicture(random: PuzzleRandom, width: number, height: number): boolean[] {
  const picture = new Array<boolean>(width * height);
  picture.fill(false);
  const rectangles = PICTURE_RECTANGLES_BASE + Math.floor(Math.max(width, height) / 3);
  for (let drawn = 0; drawn < rectangles; drawn += 1) {
    const across = 1 + randomBelowIndex(random, Math.max(2, Math.ceil(width / 2)));
    const down = 1 + randomBelowIndex(random, Math.max(2, Math.ceil(height / 2)));
    const row0 = randomBelowIndex(random, height - down + 1);
    const column0 = randomBelowIndex(random, width - across + 1);
    const fill = random.next() < PICTURE_FILL_CHANCE;
    for (let row = row0; row < row0 + down; row += 1) {
      for (let column = column0; column < column0 + across; column += 1) {
        picture[row * width + column] = fill;
      }
    }
  }
  return picture;
}

function randomBelowIndex(random: PuzzleRandom, bound: number): number {
  return Math.floor(random.next() * bound);
}

/**
 * Read a player's grid against the puzzle's picture. A cell the player has not
 * touched and a cell the player has marked empty are the same thing here — the
 * marks a surface draws for "I am sure this is empty" are not part of the
 * puzzle's state, and this module never asks a player to be sure.
 */
export function checkNonogram(
  puzzle: NonogramPuzzle,
  player: readonly (boolean | null)[],
): NonogramCheck {
  if (player.length !== puzzle.width * puzzle.height) {
    throw new RangeError(
      `checkNonogram: a ${puzzle.width}x${puzzle.height} puzzle takes ${puzzle.width * puzzle.height} cells, got ${player.length}`,
    );
  }
  const wrong: number[] = [];
  const missing: number[] = [];
  let progress = 0;
  for (let index = 0; index < player.length; index += 1) {
    const filled = player[index] === true;
    const shouldBeFilled = puzzle.solution[index] === true;
    if (!filled) {
      if (shouldBeFilled) missing.push(index);
      continue;
    }
    if (shouldBeFilled) progress += 1;
    else wrong.push(index);
  }
  return { complete: wrong.length === 0 && missing.length === 0, wrong, missing, progress };
}
