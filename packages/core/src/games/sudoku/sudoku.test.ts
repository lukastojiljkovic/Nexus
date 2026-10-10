import { describe, expect, it } from "vitest";

import {
  countSudokuSolutions,
  generateSudoku,
  solveSudokuLogically,
  sudokuCandidates,
  sudokuConflicts,
  sudokuDifficulty,
  sudokuHint,
  sudokuSolution,
} from "./sudoku.js";

/**
 * Project Euler problem 96 (projecteuler.net/problem=96): fifty published
 * puzzles, every one with a unique solution, and one published answer — the sum
 * of the three-digit number each solution starts with. These are the problem's
 * own fifty, each row of nine written out in full.
 */
const EULER_96: readonly string[] = [
  "003020600900305001001806400008102900700000008006708200002609500800203009005010300",
  "200080300060070084030500209000105408000000000402706000301007040720040060004010003",
  "000000907000420180000705026100904000050000040000507009920108000034059000507000000",
  "030050040008010500460000012070502080000603000040109030250000098001020600080060020",
  "020810740700003100090002805009040087400208003160030200302700060005600008076051090",
  "100920000524010000000000070050008102000000000402700090060000000000030945000071006",
  "043080250600000000000001094900004070000608000010200003820500000000000005034090710",
  "480006902002008001900370060840010200003704100001060049020085007700900600609200018",
  "000900002050123400030000160908000000070000090000000205091000050007439020400007000",
  "001900003900700160030005007050000009004302600200000070600100030042007006500006800",
  "000125400008400000420800000030000095060902010510000060000003049000007200001298000",
  "062340750100005600570000040000094800400000006005830000030000091006400007059083260",
  "300000000005009000200504000020000700160000058704310600000890100000067080000005437",
  "630000000000500008005674000000020000003401020000000345000007004080300902947100080",
  "000020040008035000000070602031046970200000000000501203049000730000000010800004000",
  "361025900080960010400000057008000471000603000259000800740000005020018060005470329",
  "050807020600010090702540006070020301504000908103080070900076205060090003080103040",
  "080005000000003457000070809060400903007010500408007020901020000842300000000100080",
  "003502900000040000106000305900251008070408030800763001308000104000020000005104800",
  "000000000009805100051907420290401065000000000140508093026709580005103600000000000",
  "020030090000907000900208005004806500607000208003102900800605007000309000030020050",
  "005000006070009020000500107804150000000803000000092805907006000030400010200000600",
  "040000050001943600009000300600050002103000506800020007005000200002436700030000040",
  "004000000000030002390700080400009001209801307600200008010008053900040000000000800",
  "360020089000361000000000000803000602400603007607000108000000000000418000970030014",
  "500400060009000800640020000000001008208000501700500000000090084003000600060003002",
  "007256400400000005010030060000508000008060200000107000030070090200000004006312700",
  "000000000079050180800000007007306800450708096003502700700000005016030420000000000",
  "030000080009000500007509200700105008020090030900402001004207100002000800070000090",
  "200170603050000100000006079000040700000801000009050000310400000005000060906037002",
  "000000080800701040040020030374000900000030000005000321010060050050802006080000000",
  "000000085000210009960080100500800016000000000890006007009070052300054000480000000",
  "608070502050608070002000300500090006040302050800050003005000200010704090409060701",
  "050010040107000602000905000208030501040070020901080406000401000304000709020060010",
  "053000790009753400100000002090080010000907000080030070500000003007641200061000940",
  "006080300049070250000405000600317004007000800100826009000702000075040190003090600",
  "005080700700204005320000084060105040008000500070803010450000091600508007003010600",
  "000900800128006400070800060800430007500000009600079008090004010003600284001007000",
  "000080000270000054095000810009806400020403060006905100017000620460000038000090000",
  "000602000400050001085010620038206710000000000019407350026040530900020007000809000",
  "000900002050123400030000160908000000070000090000000205091000050007439020400007000",
  "380000000000400785009020300060090000800302009000040070001070500495006000000000092",
  "000158000002060800030000040027030510000000000046080790050000080004070100000325000",
  "010500200900001000002008030500030007008000500600080004040100700000700006003004050",
  "080000040000469000400000007005904600070608030008502100900000005000781000060000010",
  "904200007010000000000706500000800090020904060040002000001607000000000030300005702",
  "000700800006000031040002000024070000010030080000060290000800070860000500002006000",
  "001007090590080001030000080000005800050060020004100000080000030100020079020700400",
  "000003017015009008060000000100007000009000200000500004000000020500600340340200000",
  "300200000000107000706030500070009080900020004010800050009040301000702000000008006",
];

/**
 * AI Escargot, the puzzle Arto Inkala published in late 2006 as the hardest
 * sudoku then known. The grid is the one SudokuWiki.org's "Escargot" page loads
 * (`sudokuwiki.org/Escargot`); the solution below is the value the solver
 * returns, and the test proves it by hand before it compares anything: the grid
 * is checked to be nine of each digit in every unit, to agree with every given,
 * and to be the puzzle's ONLY solution. So this constant is a pin on the
 * solver's answer, and the answer itself is verified rather than believed.
 */
const ESCARGOT =
  "100007090030020008009600500005300900010080002600004000300000010040000007007000300";
const ESCARGOT_SOLUTION =
  "162857493534129678789643521475312986913586742628794135356478219241935867897261354";

/** Read a dot-string (or digit row) as eighty-one cells, `0` for a hole. */
function cellsOf(text: string): number[] {
  return [...text].map((ch) => (ch === "." ? 0 : Number(ch)));
}

/** Every row, column and box is the nine digits exactly once. */
function isSolvedGrid(cells: readonly number[]): boolean {
  const units: number[][] = [];
  for (let row = 0; row < 9; row += 1) {
    units.push(Array.from({ length: 9 }, (_, column) => row * 9 + column));
  }
  for (let column = 0; column < 9; column += 1) {
    units.push(Array.from({ length: 9 }, (_, row) => row * 9 + column));
  }
  for (let box = 0; box < 9; box += 1) {
    const row0 = Math.floor(box / 3) * 3;
    const column0 = (box % 3) * 3;
    units.push(
      Array.from({ length: 9 }, (_, k) => (row0 + Math.floor(k / 3)) * 9 + column0 + (k % 3)),
    );
  }
  return units.every((unit) => {
    const seen = new Set(unit.map((index) => cells[index]));
    return seen.size === 9 && !seen.has(0);
  });
}

function keepsEveryGiven(puzzle: readonly number[], solution: readonly number[]): boolean {
  return puzzle.every((value, index) => value === 0 || value === solution[index]);
}

describe("sudokuSolution", () => {
  it("solves AI Escargot's published hardest sudoku", () => {
    const puzzle = cellsOf(ESCARGOT);
    const solution = sudokuSolution(puzzle) as number[];
    expect(isSolvedGrid(solution)).toBe(true);
    expect(keepsEveryGiven(puzzle, solution)).toBe(true);
    expect(countSudokuSolutions(puzzle, 2)).toBe(1);
    expect(solution).toEqual(cellsOf(ESCARGOT_SOLUTION));
  });

  it("sums the fifty published Euler puzzles to the published answer", () => {
    expect(EULER_96).toHaveLength(50);
    let total = 0;
    for (const text of EULER_96) {
      const puzzle = cellsOf(text);
      expect(countSudokuSolutions(puzzle, 2)).toBe(1);
      const solution = sudokuSolution(puzzle) as number[];
      expect(isSolvedGrid(solution)).toBe(true);
      expect(keepsEveryGiven(puzzle, solution)).toBe(true);
      total += Number(`${solution[0]}${solution[1]}${solution[2]}`);
    }
    expect(total).toBe(24702);
  });

  it("returns null when no completion exists", () => {
    // Row 0 holds 1..8 and is missing only a 9 in its last cell, while column 8
    // already carries a 9: nothing is duplicated, and nothing can be placed.
    const cells = cellsOf(`${"123456780"}${"000000009"}${"0".repeat(63)}`);
    expect(sudokuConflicts(cells)).toEqual([]);
    expect(countSudokuSolutions(cells, 2)).toBe(0);
    expect(sudokuSolution(cells)).toBeNull();
  });

  it("returns null when a puzzle has more than one completion", () => {
    // Four holes in one row, everything else filled: five ways to finish it.
    const cells = cellsOf(`${"123456000"}${"000000000"}${"0".repeat(63)}`);
    expect(countSudokuSolutions(cells, 5)).toBeGreaterThan(1);
    expect(sudokuSolution(cells)).toBeNull();
  });
});

describe("countSudokuSolutions", () => {
  it("stops at the cap it is given", () => {
    const cells = cellsOf(`${"123456000"}${"000000000"}${"0".repeat(63)}`);
    expect(countSudokuSolutions(cells, 2)).toBe(2);
    expect(countSudokuSolutions(cells, 3)).toBe(3);
  });

  it("counts one completion for a finished grid and none for a broken one", () => {
    const solved = cellsOf(ESCARGOT_SOLUTION);
    expect(countSudokuSolutions(solved, 2)).toBe(1);
    const broken = [...solved];
    broken[1] = broken[0] as number;
    expect(countSudokuSolutions(broken, 2)).toBe(0);
  });
});

describe("sudokuCandidates", () => {
  it("lists what a cell may still hold and nothing for a filled cell", () => {
    const cells = cellsOf(`${"123456780"}${"0".repeat(72)}`);
    const candidates = sudokuCandidates(cells);
    expect(candidates[0]).toEqual([]);
    expect(candidates[8]).toEqual([9]);
    // Cell 17 is row 1's last cell: row 1 is empty, so only the box bites, and
    // 7 and 8 are in it.
    expect(candidates[17]).toEqual([1, 2, 3, 4, 5, 6, 9]);
  });
});

describe("sudokuConflicts", () => {
  it("is empty for a clean grid", () => {
    expect(sudokuConflicts(cellsOf(ESCARGOT))).toEqual([]);
  });

  it("names both cells of a repeat in a row", () => {
    const cells = cellsOf(`11${"0".repeat(79)}`);
    expect(sudokuConflicts(cells)).toEqual([0, 1]);
  });

  it("names a repeat in a column and a repeat in a box", () => {
    const column = cellsOf(`${"1"}${"0".repeat(17)}${"1"}${"0".repeat(62)}`);
    expect(sudokuConflicts(column)).toEqual([0, 18]);
    const box = cellsOf(
      `${"1"}${"0".repeat(9)}${"1"}${"0".repeat(70)}`,
    );
    expect(sudokuConflicts(box)).toEqual([0, 10]);
  });

  it("names every cell of a group of three", () => {
    const cells = cellsOf(`444${"0".repeat(78)}`);
    expect(sudokuConflicts(cells)).toEqual([0, 1, 2]);
  });
});

describe("sudokuHint", () => {
  it("is null on a finished grid", () => {
    expect(sudokuHint(cellsOf(ESCARGOT_SOLUTION))).toBeNull();
  });

  it("agrees with the ladder's first step", () => {
    const puzzle = generateSudoku(3);
    const hint = sudokuHint(puzzle.cells);
    const { techniques } = solveSudokuLogically(puzzle.cells);
    expect(techniques.length).toBeGreaterThan(0);
    expect(hint).not.toBeNull();
    expect((hint as NonNullable<typeof hint>).technique).toBe(techniques[0]);
  });

  it("never contradicts the answer, over fifty generated puzzles", { timeout: 120_000 }, () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const puzzle = generateSudoku(seed);
      const solution = puzzle.solution;
      const hint = sudokuHint(puzzle.cells);
      if (hint === null) continue;
      expect(hint.pattern.length).toBeGreaterThan(0);
      if (hint.action === "fill") {
        expect(puzzle.cells[hint.cell]).toBe(0);
        expect(solution[hint.cell]).toBe(hint.digit);
        continue;
      }
      expect(hint.cells.length).toBeGreaterThan(0);
      for (const cell of hint.cells) {
        expect(puzzle.cells[cell]).toBe(0);
        const answer = solution[cell] as number;
        if (hint.action === "eliminate") expect(hint.digits).not.toContain(answer);
        else expect(hint.digits).toContain(answer);
      }
    }
  });

  it("finds a naked pair in a grid where the pair is the only way forward", () => {
    // Row 0 holds 3..9 already; cells 0 and 1 are in the same row and box, so
    // both hold exactly {1, 2} and nothing else in the row can take 1 or 2
    // except through that pair. The other empty cells of the row still list
    // digits the pair does not touch, so the pair is worth reporting.
    const cells = cellsOf(`003456789${"0".repeat(72)}`);
    const candidates = sudokuCandidates(cells);
    expect(candidates[0]).toEqual([1, 2]);
    expect(candidates[1]).toEqual([1, 2]);
    const hint = sudokuHint(cells);
    expect(hint).not.toBeNull();
    expect((hint as NonNullable<typeof hint>).technique).toBe("naked-pair");
    expect((hint as NonNullable<typeof hint>).pattern).toEqual([0, 1]);
  });
});

describe("generateSudoku", () => {
  it("is stable for a seed", () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const first = generateSudoku(seed);
      const again = generateSudoku(seed);
      expect(again).toEqual(first);
      expect(first.difficulty).toBe(sudokuDifficulty(first.cells));
      expect(keepsEveryGiven(first.cells, first.solution)).toBe(true);
      expect(countSudokuSolutions(first.cells, 2)).toBe(1);
    }
  });

  it("generates a thousand puzzles, each with exactly one solution", { timeout: 600_000 }, () => {
    const grades: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
    for (let seed = 0; seed < 1_000; seed += 1) {
      const puzzle = generateSudoku(seed);
      expect(countSudokuSolutions(puzzle.cells, 2)).toBe(1);
      expect(sudokuSolution(puzzle.cells)).toEqual(puzzle.solution);
      expect(keepsEveryGiven(puzzle.cells, puzzle.solution)).toBe(true);
      expect(puzzle.givens).toBe(puzzle.cells.filter((value) => value !== 0).length);
      grades[puzzle.difficulty] = (grades[puzzle.difficulty] as number) + 1;
    }
    // Measured over these thousand seeds: 492 easy, 186 medium, 322 hard. The
    // bands are wide enough to survive a deliberate reshuffle of the dig and
    // narrow enough that a generator which stopped reaching past singles, or
    // stopped producing easy puzzles at all, fails here.
    expect(grades.easy).toBeGreaterThan(300);
    expect(grades.easy).toBeLessThan(700);
    expect(grades.medium).toBeGreaterThan(100);
    expect(grades.hard).toBeGreaterThan(100);
  });

  it("honours a difficulty cap", { timeout: 120_000 }, () => {
    for (let seed = 0; seed < 8; seed += 1) {
      const puzzle = generateSudoku(seed, { difficulty: "easy" });
      expect(puzzle.difficulty).toBe("easy");
      expect(countSudokuSolutions(puzzle.cells, 2)).toBe(1);
      expect(puzzle.givens).toBeGreaterThan(0);
    }
  });

  it("refuses a size it does not build", () => {
    expect(() => generateSudoku(1, { size: 16 })).toThrow(RangeError);
  });
});

describe("solveSudokuLogically", () => {
  it("reaches every rung of the ladder over three hundred puzzles", { timeout: 300_000 }, () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 300; seed += 1) {
      const puzzle = generateSudoku(seed);
      for (const technique of new Set(solveSudokuLogically(puzzle.cells).techniques)) {
        seen.add(technique);
      }
    }
    // Measured over these seeds, the number of the three hundred that need each
    // rung: naked single 285, hidden single 294, naked pair 115, hidden pair 51,
    // pointing 98, box/line 24, X-wing 12. So every technique in the ladder is
    // reached by the generator's own puzzles rather than only by a hand case.
    expect([...seen].sort()).toEqual([
      "box-line",
      "hidden-pair",
      "hidden-single",
      "naked-pair",
      "naked-single",
      "pointing",
      "x-wing",
    ]);
  });

  it("finishes an easy puzzle with singles alone", () => {
    const puzzle = generateSudoku(1, { difficulty: "easy" });
    const { solved, techniques } = solveSudokuLogically(puzzle.cells);
    expect(solved).toBe(true);
    expect(techniques.length).toBe(puzzle.givens ? 81 - puzzle.givens : 0);
    expect(techniques.every((technique) => technique.endsWith("single"))).toBe(true);
  });

  it("does not finish a puzzle that needs more than the ladder", () => {
    // AI Escargot is the published case that needs chains, so the ladder must
    // stop short of it rather than pretend to finish.
    const { solved } = solveSudokuLogically(cellsOf(ESCARGOT));
    expect(solved).toBe(false);
  });
});
