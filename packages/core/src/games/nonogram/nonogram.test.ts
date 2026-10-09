import { describe, expect, it } from "vitest";

import {
  NONOGRAM_ATTEMPT_LIMIT,
  NONOGRAM_MAX,
  NONOGRAM_MIN,
  checkNonogram,
  cluesOf,
  generateNonogram,
  solveNonogramLines,
} from "./nonogram.js";

/** A picture written as rows of `#` (filled) and `.` (empty). */
function picture(rows: readonly string[]): boolean[] {
  return rows.flatMap((row) => [...row].map((ch) => ch === "#"));
}

/** The picture drawn as a grid, for a failure message a reader can check. */
function draw(cells: readonly (0 | 1 | null)[], width: number): string {
  const lines: string[] = [];
  for (let index = 0; index < cells.length; index += width) {
    lines.push(
      cells
        .slice(index, index + width)
        .map((cell) => (cell === 1 ? "#" : cell === 0 ? "." : "?"))
        .join(""),
    );
  }
  return lines.join("\n");
}

describe("cluesOf", () => {
  const cases: readonly (readonly [readonly boolean[], readonly number[]])[] = [
    [[], []],
    [[true, true, true, true, true], [5]],
    [[true, false, true, true, false], [1, 2]],
    [[false, false, false], []],
    [[true, false, false, false], [1]],
    [[false, false, true], [1]],
    [[true, true, false, true, true], [2, 2]],
  ];
  for (const [line, clues] of cases) {
    it(`reads ${line.map((filled) => (filled ? "#" : ".")).join("")} as ${clues.join(",")}`, () => {
      expect(cluesOf(line)).toEqual(clues);
    });
  }
});

describe("solveNonogramLines", () => {
  it("solves a 5x5 frame from its clues alone", () => {
    const frame = picture(["#####", "#...#", "#...#", "#...#", "#####"]);
    // The frame's own clues: rows are [5], [1,1], [1,1], [1,1], [5] and the
    // columns are the same by symmetry.
    const lines = [[5], [1, 1], [1, 1], [1, 1], [5]];
    expect(cluesOf(frame.slice(0, 5))).toEqual(lines[0]);
    const { cells, solved } = solveNonogramLines(lines, lines, 5, 5);
    expect(solved).toBe(true);
    expect(draw(cells, 5)).toBe("#####\n#...#\n#...#\n#...#\n#####");
  });

  it("does not claim a grid it cannot determine", () => {
    // Every row and every column wants one filled cell: the clues admit all the
    // permutation grids, so nothing about any cell is forced.
    const allSingles = [[1], [1], [1], [1], [1]];
    const { cells, solved } = solveNonogramLines(allSingles, allSingles, 5, 5);
    expect(solved).toBe(false);
    expect(cells.every((cell) => cell === null)).toBe(true);
  });

  it("leaves a contradictory line unknown instead of inventing cells", () => {
    // A row that wants five filled cells in a four-cell line has no layout.
    const { solved } = solveNonogramLines([[5]], [[1], [1], [1], [1]], 4, 1);
    expect(solved).toBe(false);
  });
});

describe("generateNonogram", () => {
  it("builds a puzzle the line solver finishes, at every size from five to twenty", { timeout: 600_000 }, () => {
    let worstAttempts = 0;
    for (let size = NONOGRAM_MIN; size <= NONOGRAM_MAX; size += 1) {
      for (let seed = 0; seed < 4; seed += 1) {
        const puzzle = generateNonogram(seed * 1_000 + size, size);
        expect(puzzle.width).toBe(size);
        expect(puzzle.height).toBe(size);
        expect(puzzle.attempts).toBeGreaterThanOrEqual(1);
        expect(puzzle.attempts).toBeLessThanOrEqual(NONOGRAM_ATTEMPT_LIMIT);
        worstAttempts = Math.max(worstAttempts, puzzle.attempts);
        // The clues must be the puzzle's own: recomputed from the picture here,
        // not taken on trust from the generator.
        for (let row = 0; row < size; row += 1) {
          expect(puzzle.rowClues[row]).toEqual(
            cluesOf(puzzle.solution.slice(row * size, (row + 1) * size)),
          );
        }
        for (let column = 0; column < size; column += 1) {
          const line: boolean[] = [];
          for (let row = 0; row < size; row += 1) line.push(puzzle.solution[row * size + column] as boolean);
          expect(puzzle.colClues[column]).toEqual(cluesOf(line));
        }
        // Solvable line by line, and the result is the picture: which by the
        // argument in the module header is also the uniqueness proof.
        const { cells, solved } = solveNonogramLines(
          puzzle.rowClues,
          puzzle.colClues,
          size,
          size,
        );
        expect(draw(cells, size)).toBe(
          draw(puzzle.solution.map((filled) => (filled ? 1 : 0) as 0 | 1), size),
        );
        expect(solved).toBe(true);
      }
    }
    // A record of what the generator costs: over these seeds it never needed
    // more than this many draws, and the limit above is the hard bound.
    expect(worstAttempts).toBeLessThan(NONOGRAM_ATTEMPT_LIMIT);
  });

  it("builds rectangles as well as squares", { timeout: 120_000 }, () => {
    const puzzle = generateNonogram(7, 8, 5);
    expect(puzzle.width).toBe(8);
    expect(puzzle.height).toBe(5);
    expect(puzzle.rowClues).toHaveLength(5);
    expect(puzzle.colClues).toHaveLength(8);
    const { solved } = solveNonogramLines(puzzle.rowClues, puzzle.colClues, 8, 5);
    expect(solved).toBe(true);
  });

  it("is stable for a seed", () => {
    expect(generateNonogram(31, 7)).toEqual(generateNonogram(31, 7));
  });

  it("refuses a size outside the range it builds", () => {
    expect(() => generateNonogram(1, NONOGRAM_MIN - 1)).toThrow(RangeError);
    expect(() => generateNonogram(1, NONOGRAM_MAX + 1)).toThrow(RangeError);
    expect(() => generateNonogram(1, 6, 4)).toThrow(RangeError);
  });

  it("keeps every accepted picture between a fifth and four fifths filled", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const puzzle = generateNonogram(seed, 5);
      const filled = puzzle.solution.filter(Boolean).length;
      expect(filled).toBeGreaterThanOrEqual(Math.ceil(0.2 * 25));
      expect(filled).toBeLessThanOrEqual(Math.floor(0.8 * 25));
    }
  });
});

describe("checkNonogram", () => {
  const puzzle = generateNonogram(5, 5);
  const solution = puzzle.solution;

  it("reports a finished grid with nothing wrong and only the right cells filled", () => {
    const filled = solution.map((value) => value || null);
    const check = checkNonogram(puzzle, filled);
    expect(check.complete).toBe(true);
    expect(check.wrong).toEqual([]);
    expect(check.missing).toEqual([]);
    expect(check.progress).toBe(solution.filter(Boolean).length);
  });

  it("separates a wrong square from a square not filled yet", () => {
    const firstFilled = solution.indexOf(true);
    const firstEmpty = solution.indexOf(false);
    const player = solution.map((value): boolean | null => (value ? true : null));
    player[firstEmpty] = true; // filled where the picture is empty
    player[firstFilled] = null;
    const check = checkNonogram(puzzle, player);
    expect(check.complete).toBe(false);
    expect(check.wrong).toEqual([firstEmpty]);
    expect(check.missing).toEqual([firstFilled]);
    expect(check.progress).toBe(solution.filter(Boolean).length - 1);
  });

  it("treats an untouched cell and a cell marked empty as the same thing", () => {
    const untouched = solution.map(() => null as boolean | null);
    const markedEmpty = solution.map((value): boolean | null => (value ? null : false));
    expect(checkNonogram(puzzle, untouched)).toEqual(checkNonogram(puzzle, markedEmpty));
  });

  it("refuses a grid of the wrong size", () => {
    expect(() => checkNonogram(puzzle, new Array<boolean | null>(7).fill(null))).toThrow(RangeError);
  });
});

describe("the generator's cost", () => {
  it("draws a twenty by twenty puzzle in a handful of attempts", { timeout: 120_000 }, () => {
    // Measured for the header's claim about rectangles: over twenty seeds the
    // largest board averages 1.3 draws, and the probe recorded in the module a
    // worst case of 7 over forty puzzles per size. The bound below is loose on
    // purpose; a strategy that regressed to a coin per cell would average in the
    // hundreds here, or run out of attempts.
    let attempts = 0;
    for (let seed = 0; seed < 20; seed += 1) attempts += generateNonogram(seed, 20).attempts;
    expect(attempts / 20).toBeLessThan(20);
  });
});
