import { describe, expect, it } from "vitest";
import { cardCode, cardFromCode, SUITS, type Card, type Suit } from "./card.js";
import { IllegalMoveError, type SpiderVariant } from "./game.js";
import { logMoves, UNDO_ENTRY, type GameLogEntry } from "./log.js";
import {
  applySpider,
  canUndoSpider,
  dealSpider,
  hasSpiderMoves,
  isSpiderEntry,
  isSpiderMove,
  isSpiderMoveLegal,
  isSpiderWon,
  replaySpider,
  spiderAutoMoves,
  spiderDealCount,
  spiderHint,
  spiderMoves,
  SPIDER_COLUMNS,
  SPIDER_FOUNDATIONS,
  SPIDER_RUN,
  SPIDER_SCORE,
  SPIDER_SUITS,
  undoSpider,
  type SpiderBoard,
  type SpiderCard,
  type SpiderMove,
  type SpiderState,
} from "./spider.js";

function card(code: string): Card {
  const parsed = cardFromCode(code);
  if (parsed === null) throw new Error(`fixture is not a card: ${code}`);
  return parsed;
}

/** A `-` in front of a code makes the card face down; columns are written top-last. */
function column(text: string): SpiderCard[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((token) =>
      token.startsWith("-")
        ? { card: card(token.slice(1)), faceUp: false }
        : { card: card(token), faceUp: true },
    );
}

function board(spec: {
  columns: readonly string[];
  stock?: string;
  runs?: readonly Suit[];
}): SpiderBoard {
  const columns = spec.columns.map(column);
  while (columns.length < SPIDER_COLUMNS) columns.push([]);
  return {
    columns,
    stock: (spec.stock ?? "").split(/\s+/).filter(Boolean).map(card),
    runs: spec.runs ?? [],
  };
}

function stateOf(input: SpiderBoard, variant: SpiderVariant = "suits4"): SpiderState {
  return { variant, seed: 1, initial: input, board: input, log: [], score: SPIDER_SCORE.start };
}

const move = (from: number, to: number, count = 1): SpiderMove => ({
  kind: "move",
  from,
  count,
  to,
});
const collect = (columnIndex: number): SpiderMove => ({ kind: "collect", column: columnIndex });

/** A row of ten cards, which is what the stock deals at a time. */
const STOCK_ROW = "3S 4S 5S 6S 7S 8S 9S TS JS QS";

function countsOf(codes: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const code of codes) counts[code] = (counts[code] ?? 0) + 1;
  return counts;
}

/** A King down to the Ace of one suit, written the way a column holds it. */
function runText(suit: Suit): string {
  return [...Array(SPIDER_RUN).keys()]
    .map((step) => cardCode({ suit, rank: (13 - step) as Card["rank"] }))
    .join(" ");
}

describe("the Spider deal", () => {
  it("lays fifty-four cards over ten columns, four of them one card longer", () => {
    const state = dealSpider("suits4", 1);
    expect(state.board.columns.map((pile) => pile.length)).toEqual([6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
    for (const pile of state.board.columns) {
      expect(pile.slice(0, -1).every((held) => !held.faceUp)).toBe(true);
      expect(pile[pile.length - 1]?.faceUp).toBe(true);
    }
    expect(state.board.stock).toHaveLength(50);
    expect(state.board.runs).toEqual([]);
    expect(state.score).toBe(SPIDER_SCORE.start);
  });

  /**
   * A Spider deck is 104 cards in every variant, and each rank appears eight
   * times: eight Spades of each rank in the one-suit game, four Spades and four
   * Hearts in the two-suit game, two of each suit in the four-suit game. Eight
   * runs need exactly that.
   */
  it("deals one hundred and four cards, eight of every rank", () => {
    const four = dealSpider("suits4", 7);
    const codes = [...four.board.columns.flat(), ...four.board.stock.map((held) => ({ card: held, faceUp: false }))]
      .map((held) => cardCode(held.card));
    expect(codes).toHaveLength(104);
    expect(new Set(codes).size).toBe(52);

    const one = dealSpider("suits1", 7);
    const spades = [...one.board.columns.flat().map((held) => held.card), ...one.board.stock].map(
      cardCode,
    );
    expect(spades).toHaveLength(104);
    expect(new Set(spades).size).toBe(13);
    expect(spades.every((code) => code.endsWith("S"))).toBe(true);
    expect(countsOf(spades)["AS"]).toBe(8);

    const two = dealSpider("suits2", 7);
    const twoSuits = [...two.board.columns.flat().map((held) => held.card), ...two.board.stock].map(
      cardCode,
    );
    expect(twoSuits).toHaveLength(104);
    expect(new Set(twoSuits).size).toBe(26);
    expect(countsOf(twoSuits)["AS"]).toBe(4);
  });

  it("deals the same table for the same seed and variant, and another for another", () => {
    expect(dealSpider("suits4", 99).board).toEqual(dealSpider("suits4", 99).board);
    expect(dealSpider("suits4", 99).board).not.toEqual(dealSpider("suits4", 100).board);
    expect(dealSpider("suits1", 99).board).not.toEqual(dealSpider("suits4", 99).board);
  });

  it("counts the deals left in the stock, five of ten cards", () => {
    expect(spiderDealCount(dealSpider("suits4", 1))).toBe(5);
    const dealt = stateOf(board({ columns: Array(SPIDER_COLUMNS).fill("AS"), stock: "KS QS" }));
    expect(spiderDealCount(dealt)).toBe(0);
  });

  /**
   * A REGRESSION PIN, not an independent oracle: the tops this engine deals for
   * seed 1 and the ten cards its first row would deal. Spider has no published
   * layout to check against (unlike FreeCell), so this is the record that the
   * shuffle's constants, the deck's composition and the deal's order are the
   * ones that shipped.
   */
  it("pins the tops and the first row of seed 1", () => {
    const state = dealSpider("suits4", 1);
    const tops = state.board.columns.map((pile) => cardCode(pile[pile.length - 1]!.card));
    expect(tops).toEqual(["5S", "JH", "JC", "QH", "5D", "5C", "9D", "QC", "3H", "KC"]);
    // The stock's last ten cards are the first row, one card per column in order.
    expect(state.board.stock.slice(-SPIDER_COLUMNS).map(cardCode)).toEqual([
      "TH", "5D", "JS", "3C", "AS", "9C", "QD", "4H", "KS", "5H",
    ]);
  });
});

/** Four columns to work with, each topped by something a case can name. */
const TABLE = board({
  columns: ["-7C 8H 9S", "-4D 5S", "QS", "KD", "2C", "3H", "4S", "5D", "AS", "AC"],
  stock: "KS QS JS",
});

describe("move legality", () => {
  const cases: readonly {
    readonly label: string;
    readonly position: SpiderBoard;
    readonly move: SpiderMove;
    readonly legal: boolean;
  }[] = [
    {
      label: "a card onto the next rank up, whatever the suit",
      position: TABLE,
      move: move(8, 6),
      legal: false,
    },
    {
      label: "a Two onto a red Three",
      position: board({ columns: ["3H", "2C"] }),
      move: move(1, 0),
      legal: true,
    },
    {
      label: "a Two onto a black Three",
      position: board({ columns: ["3S", "2C"] }),
      move: move(1, 0),
      legal: true,
    },
    {
      label: "a Two onto a Four",
      position: board({ columns: ["4C", "2C"] }),
      move: move(1, 0),
      legal: false,
    },
    {
      label: "a same-suit run of two moved together",
      position: board({ columns: ["9S 8S", "TS"] }),
      move: move(0, 1, 2),
      legal: true,
    },
    {
      label: "a run of two whose cards are different suits",
      position: board({ columns: ["9S 8H", "TS"] }),
      move: move(0, 1, 2),
      legal: false,
    },
    {
      label: "the top card of a mixed run on its own",
      position: board({ columns: ["9S 8H", "9D"] }),
      move: move(0, 1),
      legal: true,
    },
    {
      label: "one card more than the run holds",
      position: board({ columns: ["-7C 9S 8S", "TS"] }),
      move: move(0, 1, 3),
      legal: false,
    },
    {
      label: "a card whose column top is face down",
      position: board({ columns: ["-9S -8S", "TS"] }),
      move: move(0, 1),
      legal: false,
    },
    {
      label: "a card onto an empty column",
      position: board({ columns: ["2C", ""] }),
      move: move(0, 1),
      legal: true,
    },
    {
      label: "a whole column onto an empty column",
      position: board({ columns: ["9S 8S", ""] }),
      move: move(0, 1, 2),
      legal: true,
    },
    {
      label: "a column onto itself",
      position: TABLE,
      move: move(2, 2),
      legal: false,
    },
    {
      label: "a column that does not exist",
      position: TABLE,
      move: move(2, 10),
      legal: false,
    },
    {
      label: "a count of zero",
      position: TABLE,
      move: move(2, 3, 0),
      legal: false,
    },
    {
      label: "a deal while a column is empty",
      position: board({ columns: ["AS", "", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S"], stock: "KS QS" }),
      move: { kind: "deal" },
      legal: false,
    },
    {
      label: "a deal with every column filled",
      position: board({
        columns: Array(SPIDER_COLUMNS).fill("AS"),
        stock: STOCK_ROW,
      }),
      move: { kind: "deal" },
      legal: true,
    },
    {
      label: "a deal with an empty stock",
      position: board({ columns: Array(SPIDER_COLUMNS).fill("AS") }),
      move: { kind: "deal" },
      legal: false,
    },
    {
      label: "collecting a complete run",
      position: board({ columns: [runText("spades")] }),
      move: collect(0),
      legal: true,
    },
    {
      label: "collecting the second of two complete runs",
      position: board({ columns: [runText("spades"), runText("hearts")] }),
      move: collect(1),
      legal: true,
    },
    {
      label: "a same-suit run of three moved together",
      position: board({ columns: ["9S 8S 7S", "TS"] }),
      move: move(0, 1, 3),
      legal: true,
    },
    {
      label: "the lowest card of a same-suit run on its own",
      position: board({ columns: ["9S 8S 7S", "8D"] }),
      move: move(0, 1),
      legal: true,
    },
    {
      label: "a King onto an empty column",
      position: board({ columns: ["KS", ""] }),
      move: move(0, 1),
      legal: true,
    },
    {
      label: "a same-suit run of four onto an empty column",
      position: board({ columns: ["9S 8S 7S 6S", ""] }),
      move: move(0, 1, 4),
      legal: true,
    },
    {
      label: "a Two onto a Three of the same suit",
      position: board({ columns: ["3C", "2C"] }),
      move: move(1, 0),
      legal: true,
    },
    {
      label: "an Ace onto a Two",
      position: board({ columns: ["2C", "AS"] }),
      move: move(1, 0),
      legal: true,
    },
    {
      label: "a same-suit run of three onto a Four",
      position: board({ columns: ["4C", "3S 2S AS"] }),
      move: move(1, 0, 3),
      legal: true,
    },
    {
      label: "collecting a run that stops at the Two",
      position: board({ columns: [runText("spades").replace("2S", "3S")] }),
      move: collect(0),
      legal: false,
    },
    {
      label: "collecting a run of mixed suits",
      position: board({ columns: [runText("spades").replace("2S", "2H")] }),
      move: collect(0),
      legal: false,
    },
    {
      label: "anything else while a complete run waits to be collected",
      position: board({ columns: [runText("spades"), "3H"], stock: STOCK_ROW }),
      move: move(1, 2),
      legal: false,
    },
    {
      label: "a deal when the stock holds less than a full row",
      position: board({ columns: Array(SPIDER_COLUMNS).fill("AS"), stock: "KS QS JS" }),
      move: { kind: "deal" },
      legal: false,
    },
    {
      label: "collecting from a column that holds no complete run",
      position: board({ columns: [runText("spades"), runText("hearts")] }),
      move: collect(2),
      legal: false,
    },
    {
      label: "collecting from a column that does not exist",
      position: board({ columns: [runText("spades")] }),
      move: collect(9),
      legal: false,
    },
    {
      label: "a card onto a rank two higher",
      position: board({ columns: ["4C", "2C"] }),
      move: move(1, 0),
      legal: false,
    },
    {
      label: "a face-down card at the top of a column as the source",
      position: board({ columns: ["-3C 2C", "3S"] }),
      move: move(0, 1, 2),
      legal: false,
    },
    {
      label: "a move whose run crosses a suit change",
      position: board({ columns: ["9S 8H 7S", "TS"] }),
      move: move(0, 1, 2),
      legal: false,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.legal ? "allows" : "refuses"} ${testCase.label}`, () => {
      const state = stateOf(testCase.position);
      expect(isSpiderMoveLegal(state, testCase.move)).toBe(testCase.legal);
      expect(
        spiderMoves(state).some(
          (candidate) => JSON.stringify(candidate) === JSON.stringify(testCase.move),
        ),
      ).toBe(testCase.legal);
      if (!testCase.legal) {
        expect(() => applySpider(state, testCase.move)).toThrow(IllegalMoveError);
      }
    });
  }

  it("has at least fifteen legal and fifteen illegal cases above", () => {
    expect(cases.filter((testCase) => testCase.legal).length).toBeGreaterThanOrEqual(15);
    expect(cases.filter((testCase) => !testCase.legal).length).toBeGreaterThanOrEqual(15);
  });
});

describe("completing a run", () => {
  it("removes a King-to-Ace run, turns the card under it face up, and pays a hundred", () => {
    const before = stateOf(board({ columns: [`-2S ${runText("hearts")}`, "3C"] }));
    expect(spiderAutoMoves(before)).toEqual([collect(0)]);
    const after = applySpider(before, collect(0));
    expect(after.board.runs).toEqual(["hearts"]);
    expect(after.board.columns[0]?.map((held) => cardCode(held.card))).toEqual(["2S"]);
    expect(after.board.columns[0]?.[0]?.faceUp).toBe(true);
    expect(after.score).toBe(SPIDER_SCORE.start + SPIDER_SCORE.perRun);
  });

  it("counts eight runs as the win", () => {
    const runs: Suit[] = ["spades", "spades", "hearts", "hearts", "diamonds", "diamonds", "clubs", "clubs"];
    expect(isSpiderWon(stateOf(board({ columns: [], runs })))).toBe(true);
    expect(isSpiderWon(stateOf(board({ columns: [], runs: runs.slice(0, 7) })))).toBe(false);
  });

  it("finds nothing to collect on a fresh deal", () => {
    expect(spiderAutoMoves(dealSpider("suits4", 1))).toEqual([]);
  });
});

describe("dealing a row and moving cards", () => {
  it("gives one card to every column, face up", () => {
    const filled = stateOf(
      board({ columns: Array(SPIDER_COLUMNS).fill("-2C"), stock: STOCK_ROW }),
    );
    const dealt = applySpider(filled, { kind: "deal" });
    expect(dealt.board.columns.map((pile) => pile.length)).toEqual(Array(SPIDER_COLUMNS).fill(2));
    expect(dealt.board.stock).toHaveLength(0);
    expect(dealt.board.columns.every((pile) => pile[pile.length - 1]?.faceUp)).toBe(true);
    expect(dealt.score).toBe(SPIDER_SCORE.start + SPIDER_SCORE.perAction);
  });

  it("turns the card a move exposes face up", () => {
    const before = stateOf(board({ columns: ["-7C 9S", "TS"] }));
    const after = applySpider(before, move(0, 1));
    expect(after.board.columns[0]?.map((held) => cardCode(held.card))).toEqual(["7C"]);
    expect(after.board.columns[0]?.[0]?.faceUp).toBe(true);
    expect(after.board.columns[1]?.map(cardCodeOf)).toEqual(["TS", "9S"]);
  });

  it("restores the exact position on undo, and charges the undo as a move", () => {
    const before = stateOf(board({ columns: ["-7C 9S", "TS"] }));
    const after = applySpider(before, move(0, 1));
    const undone = undoSpider(after);
    expect(undone.board).toEqual(before.board);
    expect(logMoves(undone.log)).toEqual([]);
    expect(undone.log).toEqual([move(0, 1), UNDO_ENTRY]);
    // Both the move and the undo are actions, which the published table charges
    // one point each.
    expect(undone.score).toBe(before.score - 2);
    expect(canUndoSpider(undone)).toBe(false);
    expect(() => undoSpider(undone)).toThrow(IllegalMoveError);
  });
});

function cardCodeOf(held: SpiderCard): string {
  return cardCode(held.card);
}

describe("stuck and hint", () => {
  it("knows it is stuck when nothing can move and no row can be dealt", () => {
    const dead = stateOf(
      board({
        columns: [
          "AC KC", "AD KD", "AH KH", "AS KS",
          "3C 2C", "3D 2D", "3H 2H", "3S 2S",
          "4C 5C", "4D 5D",
        ],
      }),
    );
    expect(spiderMoves(dead)).toEqual([]);
    expect(hasSpiderMoves(dead)).toBe(false);
    expect(spiderHint(dead)).toBeNull();
  });

  it("hints the collection of a finished run before anything else", () => {
    const position = stateOf(board({ columns: [runText("spades"), "3H"], stock: STOCK_ROW }));
    expect(spiderHint(position)).toEqual(collect(0));
  });

  it("hints the move that turns a face-down card over", () => {
    const position = stateOf(board({ columns: ["-7C 9S", "TS"] }));
    expect(spiderHint(position)).toEqual(move(0, 1));
  });

  it("hints a deal when the tableau offers nothing", () => {
    const position = stateOf(
      board({ columns: Array(SPIDER_COLUMNS).fill("2C"), stock: STOCK_ROW }),
    );
    expect(spiderHint(position)).toEqual({ kind: "deal" });
  });
});

describe("the replayed log", () => {
  it("rebuilds the state a move list describes, including the runs", () => {
    const played = applySpider(
      applySpider(dealSpider("suits1", 3), { kind: "deal" }),
      spiderMoves(applySpider(dealSpider("suits1", 3), { kind: "deal" }))[0]!,
    );
    expect(replaySpider("suits1", 3, played.log)).toEqual({ ok: true, state: played });
  });

  it("refuses an unknown variant, a bad entry and an impossible move", () => {
    expect(replaySpider("suits3" as SpiderVariant, 1, [])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "unknown-variant" }),
    });
    expect(replaySpider("suits4", 1, [{ kind: "fly" }])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "bad-entry", atIndex: 0 }),
    });
    expect(replaySpider("suits4", 1, [UNDO_ENTRY])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "empty-undo", atIndex: 0 }),
    });
    expect(replaySpider("suits4", 1, [move(0, 1)])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "illegal-move", atIndex: 0 }),
    });
  });

  it("guards a move's shape before its rules", () => {
    expect(isSpiderMove({ kind: "deal" })).toBe(true);
    expect(isSpiderMove(move(0, 1))).toBe(true);
    expect(isSpiderMove(collect(0))).toBe(true);
    expect(isSpiderMove({ kind: "deal", column: 0 })).toBe(false);
    expect(isSpiderMove({ kind: "move", from: 0, to: 1, count: 0 })).toBe(false);
    expect(isSpiderMove({ kind: "move", from: -1, to: 1, count: 1 })).toBe(false);
    expect(isSpiderMove({ kind: "move", from: 0, to: 10, count: 1 })).toBe(false);
    expect(isSpiderMove({ kind: "collect" })).toBe(false);
    expect(isSpiderMove({ kind: "undo" })).toBe(false);
    expect(isSpiderEntry(UNDO_ENTRY)).toBe(true);
    expect(isSpiderEntry({ kind: "fly" })).toBe(false);
  });
});

describe("the shape of the game", () => {
  it("has ten columns, eight foundations and a thirteen-card run", () => {
    expect(SPIDER_COLUMNS).toBe(10);
    expect(SPIDER_FOUNDATIONS).toBe(8);
    expect(SPIDER_RUN).toBe(13);
  });

  it("plays one, two or four suits, and Spades is the one-suit deck", () => {
    expect(SPIDER_SUITS.suits1).toEqual(["spades"]);
    expect(SPIDER_SUITS.suits2).toEqual(["spades", "hearts"]);
    expect(SPIDER_SUITS.suits4).toEqual(SUITS);
  });

  it("keeps the log typed as entries of the move vocabulary", () => {
    const log: readonly GameLogEntry<SpiderMove>[] = [UNDO_ENTRY, { kind: "deal" }];
    expect(logMoves(log)).toHaveLength(1);
  });
});
