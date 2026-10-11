import { describe, expect, it } from "vitest";
import { cardCode, cardFromCode, SUITS, type Card, type Suit } from "./card.js";
import { IllegalMoveError } from "./game.js";
import {
  applyFreeCell,
  canUndoFreeCell,
  dealFreeCell,
  freeCellAutoMoves,
  freeCellHint,
  freeCellMoves,
  freeCellSupermoveLimit,
  FREE_CELL_COLUMNS,
  FREE_CELL_COUNT,
  FREE_CELL_SCORE,
  hasFreeCellMoves,
  isFreeCellEntry,
  isFreeCellMove,
  isFreeCellMoveLegal,
  isFreeCellWon,
  replayFreeCell,
  undoFreeCell,
  type FreeCellBoard,
  type FreeCellMove,
  type FreeCellSlot,
  type FreeCellState,
} from "./freecell.js";
import { logMoves, UNDO_ENTRY, type GameLogEntry } from "./log.js";

function card(code: string): Card {
  const parsed = cardFromCode(code);
  if (parsed === null) throw new Error(`fixture is not a card: ${code}`);
  return parsed;
}

/** Columns are written top-last, as the engine stores them; a `_` in `cells` is an empty cell. */
function board(spec: {
  columns: readonly string[];
  cells?: string;
  foundations?: Partial<Record<Suit, string>>;
}): FreeCellBoard {
  const columns = spec.columns.map((text) => text.split(/\s+/).filter(Boolean).map(card));
  const cells = (spec.cells ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (token === "_" ? null : card(token)));
  if (columns.length > FREE_CELL_COLUMNS || cells.length > FREE_CELL_COUNT) {
    throw new Error("fixture has more columns or cells than FreeCell has");
  }
  while (columns.length < FREE_CELL_COLUMNS) columns.push([]);
  while (cells.length < FREE_CELL_COUNT) cells.push(null);
  return {
    columns,
    cells,
    foundations: SUITS.map((suit) =>
      (spec.foundations?.[suit] ?? "").split(/\s+/).filter(Boolean).map(card),
    ),
  };
}

function stateOf(input: FreeCellBoard, seed = 1): FreeCellState {
  return { seed, initial: input, board: input, log: [], score: 0 };
}

const column = (index: number): FreeCellSlot => ({ kind: "column", column: index });
const cell = (index: number): FreeCellSlot => ({ kind: "cell", cell: index });
const foundation = (suit: Suit): FreeCellSlot => ({ kind: "foundation", suit });
const move = (from: FreeCellSlot, to: FreeCellSlot, count = 1): FreeCellMove => ({
  kind: "move",
  from,
  to,
  count,
});
const asText = (value: unknown): string => JSON.stringify(value);

describe("the FreeCell deal", () => {
  /**
   * The published layouts from
   * https://rosettacode.org/wiki/Deal_cards_for_FreeCell. That page prints both
   * deals row by row across the eight columns, which is the transpose of the
   * column-major form asserted here and the same set of cards in the same order.
   */
  it("deals game #1 the layout Rosetta Code publishes", () => {
    const dealt = dealFreeCell(1);
    expect(dealt.board.columns.map((pile) => pile.map(cardCode).join(" "))).toEqual([
      "JD KD 2S 4C 3S 6D 6S",
      "2D KC KS 5C TD 8S 9C",
      "9H 9S 9D TS 4S 8D 2H",
      "JC 5S QD QH TH QS 6H",
      "5D AD JS 4H 8H 6C",
      "7H QC AS AC 2C 3D",
      "7C KH AH 4D JH 8C",
      "5H 3H 3C 7S 7D TC",
    ]);
    expect(dealt.board.columns.map((pile) => pile.length)).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
    expect(dealt.board.cells).toEqual([null, null, null, null]);
    expect(dealt.board.foundations.map((pile) => pile.length)).toEqual([0, 0, 0, 0]);
  });

  it("deals game 617 the layout Rosetta Code publishes", () => {
    const dealt = dealFreeCell(617);
    expect(dealt.board.columns.map((pile) => pile.map(cardCode).join(" "))).toEqual([
      "7D TD TH KD 4C 4S JD",
      "AD 7S QC 5H QS TS KS",
      "5C QD 3H 9S 9C 2H KC",
      "3S AC 9D 3C 9H 5D 4H",
      "5S 6D 6S 8S 7C JC",
      "8C 8H 8D 7H 6H 6C",
      "2D AS 3D 4D 2C JH",
      "AH KH TC JS 2S QH",
    ]);
  });

  it("deals the same table for the same number, and holds every card once", () => {
    expect(dealFreeCell(11982).board).toEqual(dealFreeCell(11982).board);
    expect(dealFreeCell(11982).board).not.toEqual(dealFreeCell(11983).board);
    const codes = dealFreeCell(3).board.columns.flat().map(cardCode);
    expect(codes).toHaveLength(52);
    expect(new Set(codes).size).toBe(52);
  });

  it("refuses a deal number outside the 32 000 the classic game numbers", () => {
    for (const bad of [0, -1, 32_001, 1.5, Number.NaN]) {
      expect(() => dealFreeCell(bad)).toThrow(/FreeCell deal/);
    }
  });
});

/** Eight columns of which exactly one is empty (1), four cells of which two are taken. */
const ROOMY = board({
  columns: ["KC QD JS TH 9S 8H", "", "2C", "2S", "2H", "2D", "3C", ""],
  cells: "4C 4S _ _",
});

describe("the supermove limit", () => {
  /**
   * https://en.wikipedia.org/wiki/FreeCell § Supermoves: C = 2^M × (N + 1), half
   * of that for a move onto an empty cascade. Computing it as „the empty cascades
   * OTHER than the destination" already includes the halving, which is why the
   * numbers below are what the two rules agree on.
   */
  const limitCases: readonly {
    readonly label: string;
    readonly position: FreeCellBoard;
    readonly to: FreeCellSlot;
    readonly limit: number;
  }[] = [
    {
      label: "four free cells and no empty column",
      position: board({
        columns: ["KC QD", "2C", "2S", "2H", "2D", "3C", "3S", "3H"],
        cells: "_ _ _ _",
      }),
      to: column(1),
      limit: 5,
    },
    {
      label: "no cells and two empty columns",
      position: board({
        columns: ["KC QD", "2C", "2S", "", "2H", "2D", "", "3C"],
        cells: "3S 3H 4C 4S",
      }),
      to: column(1),
      limit: 4,
    },
    {
      label: "one cell and one empty column",
      position: board({
        columns: ["KC QD", "2C", "2S", "2H", "", "2D", "3C", "3S"],
        cells: "3H 4C 4S _",
      }),
      to: column(1),
      limit: 4,
    },
    {
      label: "two cells and the destination the only empty column",
      position: board({
        columns: ["KC QD", "", "2C", "2S", "2H", "2D", "3C", "3S"],
        cells: "3H 4C _ _",
      }),
      to: column(1),
      limit: 3,
    },
    {
      label: "two cells, one spare column and the destination empty",
      position: ROOMY,
      to: column(1),
      limit: 6,
    },
  ];

  for (const testCase of limitCases) {
    it(`counts ${testCase.limit} for ${testCase.label}`, () => {
      expect(freeCellSupermoveLimit(stateOf(testCase.position), testCase.to)).toBe(testCase.limit);
    });
  }

  it("refuses a run longer than the position can carry, and allows the ones it can", () => {
    const tight = board({
      columns: ["KC QD JS TH 9S 8H", "", "2C", "2S", "2H", "2D", "3C", "3S"],
      cells: "4C 4S 4H 4D",
    });
    // Four full cells and no empty column but the destination: one card only.
    expect(freeCellSupermoveLimit(stateOf(tight), column(1))).toBe(1);
    expect(isFreeCellMoveLegal(stateOf(tight), move(column(0), column(1), 6))).toBe(false);
    expect(isFreeCellMoveLegal(stateOf(tight), move(column(0), column(1), 2))).toBe(false);
    expect(isFreeCellMoveLegal(stateOf(tight), move(column(0), column(1), 1))).toBe(true);

    // The same six cards, with two free cells and one spare column: six.
    expect(freeCellSupermoveLimit(stateOf(ROOMY), column(1))).toBe(6);
    expect(isFreeCellMoveLegal(stateOf(ROOMY), move(column(0), column(1), 6))).toBe(true);
  });
});

/** One empty column (5), one empty cell (1), four filled columns and two foundations going. */
const TABLE = board({
  columns: ["KC QD", "8H", "9S", "6C", "2D", "", "3S", "4C"],
  cells: "2C _ _ _",
  foundations: { clubs: "AC", spades: "AS 2S" },
});

describe("move legality", () => {
  const cases: readonly {
    readonly label: string;
    readonly position: FreeCellBoard;
    readonly move: FreeCellMove;
    readonly legal: boolean;
  }[] = [
    {
      label: "a card off a column into an empty cell",
      position: TABLE,
      move: move(column(1), cell(1)),
      legal: true,
    },
    {
      label: "a card into a cell that is already taken",
      position: TABLE,
      move: move(column(1), cell(0)),
      legal: false,
    },
    {
      label: "two cards into one cell",
      position: TABLE,
      move: move(column(0), cell(1), 2),
      legal: false,
    },
    {
      label: "a card from one cell into another",
      position: TABLE,
      move: move(cell(0), cell(1)),
      legal: false,
    },
    {
      label: "the Two of Clubs out of a cell onto its foundation",
      position: TABLE,
      move: move(cell(0), foundation("clubs")),
      legal: true,
    },
    {
      label: "the Two of Clubs onto the Spades foundation",
      position: TABLE,
      move: move(cell(0), foundation("spades")),
      legal: false,
    },
    {
      label: "an empty cell as a source",
      position: TABLE,
      move: move(cell(1), foundation("clubs")),
      legal: false,
    },
    {
      label: "a column card onto a foundation that is not ready for it",
      position: TABLE,
      move: move(column(3), foundation("clubs")),
      legal: false,
    },
    {
      label: "a black Nine onto a red Eight, which is the wrong way round",
      position: TABLE,
      move: move(column(2), column(1)),
      legal: false,
    },
    {
      label: "a red Two onto a black Three",
      position: board({ columns: ["3S", "2D"] }),
      move: move(column(1), column(0)),
      legal: true,
    },
    {
      label: "a red Two onto a red Three",
      position: board({ columns: ["3H", "2D"] }),
      move: move(column(1), column(0)),
      legal: false,
    },
    {
      label: "a card onto an empty column",
      position: TABLE,
      move: move(column(1), column(5)),
      legal: true,
    },
    {
      label: "a column onto itself",
      position: TABLE,
      move: move(column(1), column(1)),
      legal: false,
    },
    {
      label: "a column that does not exist",
      position: TABLE,
      move: move(column(9), column(5)),
      legal: false,
    },
    {
      label: "a cell card onto a column that cannot take it",
      position: TABLE,
      move: move(cell(0), column(3)),
      legal: false,
    },
    {
      label: "a cell card onto a column that can take it",
      position: board({ columns: ["3D"], cells: "2C" }),
      move: move(cell(0), column(0)),
      legal: true,
    },
    {
      label: "a foundation card back onto a column",
      position: board({ columns: ["3C"], foundations: { hearts: "AH 2H" } }),
      move: move(foundation("hearts"), column(0)),
      legal: true,
    },
    {
      label: "a foundation card onto a column that cannot take it",
      position: board({ columns: ["4C"], foundations: { hearts: "AH 2H" } }),
      move: move(foundation("hearts"), column(0)),
      legal: false,
    },
    {
      label: "a column card onto a foundation that is ready for it",
      position: board({ columns: ["2C"], foundations: { clubs: "AC" } }),
      move: move(column(0), foundation("clubs")),
      legal: true,
    },
    {
      label: "a cell card onto an empty column",
      position: board({ columns: ["KC QD", ""], cells: "AS" }),
      move: move(cell(0), column(1)),
      legal: true,
    },
    {
      label: "a foundation Ace back onto an empty column",
      position: board({ columns: [""], foundations: { clubs: "AC" } }),
      move: move(foundation("clubs"), column(0)),
      legal: true,
    },
    {
      label: "a red Jack onto a black Queen",
      position: board({ columns: ["QS", "JD"] }),
      move: move(column(1), column(0)),
      legal: true,
    },
    {
      label: "a black Queen onto a red King",
      position: board({ columns: ["KD", "QS"] }),
      move: move(column(1), column(0)),
      legal: true,
    },
    {
      label: "a red Ten onto a black Jack",
      position: board({ columns: ["JS", "TD"] }),
      move: move(column(1), column(0)),
      legal: true,
    },
    {
      label: "a King onto an empty column",
      position: board({ columns: ["KC", ""] }),
      move: move(column(0), column(1)),
      legal: true,
    },
    {
      label: "a two-card run onto a black Jack",
      position: board({
        columns: ["JS TH 9S", "JC", "4C", "4S", "4H", "4D", "5C", "5S"],
        cells: "2C 3C",
      }),
      move: move(column(0), column(1), 2),
      legal: true,
    },
    {
      label: "a three-card run onto a red Queen",
      position: board({
        columns: ["JS TH 9S", "QD", "4C", "4S", "4H", "4D", "5C", "5S"],
        cells: "2C 3C",
      }),
      move: move(column(0), column(1), 3),
      legal: true,
    },
    {
      label: "a two-card run into an empty column",
      position: board({ columns: ["KC QD", "", "4C", "4S", "4H", "4D", "5C", "5S"] }),
      move: move(column(0), column(1), 2),
      legal: true,
    },
    {
      label: "a foundation onto a foundation",
      position: board({ columns: [""], foundations: { spades: "AS", clubs: "AC" } }),
      move: move(foundation("spades"), foundation("clubs")),
      legal: false,
    },
    {
      label: "a whole run out of a column into a cell",
      position: board({ columns: ["KC QD JS"] }),
      move: move(column(0), cell(0), 3),
      legal: false,
    },
    {
      label: "a run two cards long whose cards are not in sequence",
      position: board({ columns: ["8H TC", "9D"] }),
      move: move(column(0), column(1), 2),
      legal: false,
    },
    {
      label: "a count of zero",
      position: TABLE,
      move: move(column(1), cell(1), 0),
      legal: false,
    },
    {
      label: "more cards than the position can carry",
      position: board({
        columns: ["KC QD JS TH", "", "2C", "2S", "2H", "2D", "3C", "3S"],
        cells: "4C 4S 4H 4D",
      }),
      move: move(column(0), column(1), 4),
      legal: false,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.legal ? "allows" : "refuses"} ${testCase.label}`, () => {
      const state = stateOf(testCase.position);
      expect(isFreeCellMoveLegal(state, testCase.move)).toBe(testCase.legal);
      expect(freeCellMoves(state).some((held) => asText(held) === asText(testCase.move))).toBe(
        testCase.legal,
      );
      if (!testCase.legal) {
        expect(() => applyFreeCell(state, testCase.move)).toThrow(IllegalMoveError);
      }
    });
  }

  it("has at least fifteen legal and fifteen illegal cases above", () => {
    expect(cases.filter((testCase) => testCase.legal).length).toBeGreaterThanOrEqual(15);
    expect(cases.filter((testCase) => !testCase.legal).length).toBeGreaterThanOrEqual(15);
  });
});

describe("applying the rules", () => {
  it("spends a free cell and gives it back", () => {
    const before = stateOf(TABLE);
    const parked = applyFreeCell(before, move(column(1), cell(1)));
    expect(parked.board.columns[1]).toEqual([]);
    expect(parked.board.cells.filter((held) => held !== null).map(cardCode)).toEqual(["2C", "8H"]);
    const back = applyFreeCell(parked, move(cell(1), column(1)));
    expect(back.board.columns[1]?.map(cardCode)).toEqual(["8H"]);
  });

  it("scores ten for a card sent home and takes ten back when it comes out again", () => {
    const before = stateOf(board({ columns: [""], cells: "2S", foundations: { spades: "AS" } }));
    const home = applyFreeCell(before, move(cell(0), foundation("spades")));
    expect(home.board.foundations[SUITS.indexOf("spades")]?.map(cardCode)).toEqual(["AS", "2S"]);
    expect(home.board.cells).toEqual([null, null, null, null]);
    expect(home.score).toBe(FREE_CELL_SCORE.toFoundation);
    const out = applyFreeCell(home, move(foundation("spades"), column(0)));
    expect(out.board.columns[0]?.map(cardCode)).toEqual(["2S"]);
    expect(out.score).toBe(0);
  });

  it("moves a whole run for one action, and undoes it in one", () => {
    const before = stateOf(ROOMY);
    const moved = applyFreeCell(before, move(column(0), column(1), 6));
    expect(moved.board.columns[1]?.map(cardCode)).toEqual([
      "KC", "QD", "JS", "TH", "9S", "8H",
    ]);
    expect(moved.board.columns[0]).toEqual([]);
    const undone = undoFreeCell(moved);
    expect(undone.board).toEqual(before.board);
    expect(logMoves(undone.log)).toEqual([]);
    expect(undone.log).toEqual([move(column(0), column(1), 6), UNDO_ENTRY]);
    expect(undone.score).toBe(before.score + FREE_CELL_SCORE.undo);
    expect(canUndoFreeCell(undone)).toBe(false);
  });
});

describe("win, stuck and hint", () => {
  const won = board({
    columns: [""],
    foundations: {
      clubs: "AC 2C 3C 4C 5C 6C 7C 8C 9C TC JC QC KC",
      diamonds: "AD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD KD",
      hearts: "AH 2H 3H 4H 5H 6H 7H 8H 9H TH JH QH KH",
      spades: "AS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS KS",
    },
  });

  it("is won when all fifty-two cards are home", () => {
    expect(isFreeCellWon(stateOf(won))).toBe(true);
    expect(isFreeCellWon(dealFreeCell(1))).toBe(false);
  });

  it("knows it is stuck when every cell is spent and no card fits anywhere", () => {
    const dead = board({
      columns: ["KC QD", "KH QS", "KD QH", "KS QC", "2C", "2S", "2H", "2D"],
      cells: "3C 3S 3H 3D",
    });
    expect(hasFreeCellMoves(stateOf(dead))).toBe(false);
    expect(freeCellHint(stateOf(dead))).toBeNull();
    // One cell short of that, and parking a card is a move: the position is not
    // over, which is exactly what the free cells are for.
    const parked = board({
      columns: ["KC QD", "KH QS", "KD QH", "KS QC", "2C", "2S", "2H", "2D"],
      cells: "3C 3S 3H _",
    });
    expect(hasFreeCellMoves(stateOf(parked))).toBe(true);
  });

  it("hints the card that goes home before anything else", () => {
    const position = board({ columns: ["2C", "8H"], foundations: { clubs: "AC" } });
    expect(freeCellHint(stateOf(position))).toEqual(move(column(0), foundation("clubs")));
  });

  it("hints the move that empties a column when nothing can go home", () => {
    const position = board({ columns: ["QS", "KD"] });
    expect(freeCellHint(stateOf(position))).toEqual(move(column(0), column(1)));
  });
});

describe("automatic moves to the foundations", () => {
  it("plays an Ace out of a cell, and a Two whose Ace is home", () => {
    const position = board({
      columns: ["QS", "2C"],
      cells: "AS KS",
      foundations: { clubs: "AC" },
    });
    expect(freeCellAutoMoves(stateOf(position))).toEqual([
      move(cell(0), foundation("spades")),
      move(column(1), foundation("clubs")),
    ]);
  });

  it("holds a Two whose Ace is still in play", () => {
    const position = board({ columns: ["2C"], cells: "KS _ _ _" });
    expect(freeCellAutoMoves(stateOf(position))).toEqual([]);
  });
});

describe("the replayed log", () => {
  it("rebuilds the state a move list describes", () => {
    const played = applyFreeCell(dealFreeCell(1), move(column(0), cell(0)));
    expect(replayFreeCell(1, played.log)).toEqual({ ok: true, state: played });
  });

  it("refuses a deal number out of range, a bad entry and an impossible move", () => {
    expect(replayFreeCell(32_001, [])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "bad-seed" }),
    });
    expect(replayFreeCell(1, [{ kind: "fly" }])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "bad-entry", atIndex: 0 }),
    });
    expect(replayFreeCell(1, [UNDO_ENTRY])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "empty-undo", atIndex: 0 }),
    });
    // Game #1's first two columns end in the Six of Spades and the Nine of
    // Clubs: a black Six may not land on a black Nine.
    expect(replayFreeCell(1, [move(column(0), column(1))])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "illegal-move", atIndex: 0 }),
    });
  });

  it("guards a move's shape before its rules", () => {
    expect(isFreeCellMove(move(column(0), cell(0)))).toBe(true);
    expect(isFreeCellMove({ kind: "move", from: column(0), to: cell(0), count: 2 })).toBe(true);
    expect(isFreeCellMove({ kind: "move", from: cell(0), to: cell(1), count: 1 })).toBe(true);
    expect(isFreeCellMove({ kind: "move", from: column(0), to: cell(0), count: 0 })).toBe(false);
    expect(isFreeCellMove({ kind: "move", from: column(0), to: column(0) })).toBe(false);
    expect(isFreeCellMove({ kind: "move", from: column(-1), to: column(0), count: 1 })).toBe(false);
    expect(isFreeCellMove({ kind: "undo" })).toBe(false);
    expect(isFreeCellEntry({ kind: "draw" })).toBe(false);
    expect(isFreeCellEntry(UNDO_ENTRY)).toBe(true);
    expect(isFreeCellEntry(move(column(0), cell(0)))).toBe(true);
  });
});

describe("the shape of the game", () => {
  it("has four free cells and eight columns", () => {
    expect(FREE_CELL_COUNT).toBe(4);
    expect(FREE_CELL_COLUMNS).toBe(8);
  });

  it("keeps the log typed as entries of the move vocabulary", () => {
    const log: readonly GameLogEntry<FreeCellMove>[] = [
      UNDO_ENTRY,
      move(column(0), cell(0)),
    ];
    expect(logMoves(log)).toHaveLength(1);
  });
});
