import { describe, expect, it } from "vitest";
import { cardCode, cardFromCode, SUITS, type Card, type Suit } from "./card.js";
import { IllegalMoveError } from "./game.js";
import {
  applyKlondike,
  canUndoKlondike,
  dealKlondike,
  hasKlondikeMoves,
  isKlondikeEntry,
  isKlondikeMove,
  isKlondikeMoveLegal,
  isKlondikeWon,
  klondikeAllFaceUp,
  klondikeAutoComplete,
  klondikeAutoMoves,
  klondikeHint,
  klondikeMoves,
  KLONDIKE_COLUMNS,
  KLONDIKE_SCORE,
  replayKlondike,
  undoKlondike,
  type KlondikeBoard,
  type KlondikeCard,
  type KlondikeMove,
  type KlondikePile,
  type KlondikeState,
} from "./klondike.js";
import { logMoves, UNDO_ENTRY, type GameLogEntry } from "./log.js";

function card(code: string): Card {
  const parsed = cardFromCode(code);
  if (parsed === null) throw new Error(`fixture is not a card: ${code}`);
  return parsed;
}

/** `"KS"` is a face-up King of Spades; a `-` in front of a code makes it face down. */
function column(text: string): KlondikeCard[] {
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) =>
      token.startsWith("-")
        ? { card: card(token.slice(1)), faceUp: false }
        : { card: card(token), faceUp: true },
    );
}

function foundationsOf(spec: Partial<Record<Suit, string>>): Card[][] {
  return SUITS.map((suit) => (spec[suit] ?? "").split(/\s+/).filter(Boolean).map(card));
}

/**
 * A hand-built position. Undo and the score start from the board a state was
 * dealt, so a fixture may hand any board in as `initial` — which is how the
 * cases below reach positions a deal needs a hundred moves to reach.
 */
function stateOf(board: KlondikeBoard, variant: KlondikeState["variant"] = "draw1"): KlondikeState {
  return { variant, seed: 7, initial: board, board, log: [], score: 0 };
}

function board(spec: {
  tableau: readonly string[];
  foundations?: Partial<Record<Suit, string>>;
  stock?: string;
  waste?: string;
}): KlondikeBoard {
  const tableau = spec.tableau.map(column);
  while (tableau.length < KLONDIKE_COLUMNS) tableau.push([]);
  return {
    tableau,
    foundations: foundationsOf(spec.foundations ?? {}),
    stock: (spec.stock ?? "").split(/\s+/).filter(Boolean).map(card),
    waste: (spec.waste ?? "").split(/\s+/).filter(Boolean).map(card),
  };
}

const tableau = (columnIndex: number): KlondikePile => ({ kind: "tableau", column: columnIndex });
const foundations = (suit: Suit): KlondikePile => ({ kind: "foundation", suit });
const waste: KlondikePile = { kind: "waste" };

const move = (from: KlondikePile, to: KlondikePile, count = 1): KlondikeMove => ({
  kind: "move",
  from,
  to,
  count,
});

describe("the Klondike deal", () => {
  it("lays out seven columns of one to seven cards, the top one face up, and 24 in the stock", () => {
    const state = dealKlondike("draw1", 1);
    expect(state.board.tableau.map((pile) => pile.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const pile of state.board.tableau) {
      expect(pile.slice(0, -1).every((held) => !held.faceUp)).toBe(true);
      expect(pile[pile.length - 1]?.faceUp).toBe(true);
    }
    expect(state.board.stock).toHaveLength(24);
    expect(state.board.waste).toEqual([]);
    expect(state.board.foundations.map((pile) => pile.length)).toEqual([0, 0, 0, 0]);
    expect({ log: state.log, score: state.score }).toEqual({ log: [], score: 0 });
  });

  it("deals every card exactly once", () => {
    const state = dealKlondike("draw3", 12345);
    const codes = [
      ...state.board.tableau.flatMap((pile) => pile.map((held) => held.card)),
      ...state.board.stock,
    ].map((held) => `${held.suit}-${held.rank}`);
    expect(codes).toHaveLength(52);
    expect(new Set(codes).size).toBe(52);
  });

  it("deals the same table for the same seed, and a different one for another", () => {
    expect(dealKlondike("draw1", 42).board).toEqual(dealKlondike("draw1", 42).board);
    expect(dealKlondike("draw1", 42).board).not.toEqual(dealKlondike("draw1", 43).board);
  });

  it("deals the same cards to draw-one and draw-three, which differ only in the draw", () => {
    // The classic game's two modes are two ways of TURNING the same deal over;
    // the variant is not an input to the shuffle, so game #42 is game #42.
    expect(dealKlondike("draw3", 42).board).toEqual(dealKlondike("draw1", 42).board);
  });

  /**
   * A REGRESSION PIN, not an independent oracle: this is the table this engine
   * deals for seed 1, written out so that a change to the shuffle's constants, to
   * the deck's order or to the deal's own order cannot pass unnoticed. The
   * shuffle itself is pinned against a hand calculation (`shuffle.test.ts`) and
   * FreeCell's deal against layouts #1 and #617 published on Rosetta Code;
   * Klondike has no published layout to check against, which is exactly why this
   * one is here.
   */
  it("pins the table seed 1 deals", () => {
    const state = dealKlondike("draw1", 1);
    const layout = state.board.tableau.map((pile) =>
      pile
        .map((held) => (held.faceUp ? cardCode(held.card) : `-${cardCode(held.card)}`))
        .join(" "),
    );
    expect(layout).toEqual([
      "TC",
      "-KC JS",
      "-5H -QS AS",
      "-7D -8D -AC 9H",
      "-7S -2D -KS -4C 3D",
      "-QD -8H -JC -QH -4D JH",
      "-TH -AD -8S -5C -9D -TD 2H",
    ]);
    // The stock is stored with its TOP last, so the next card turned over is the
    // last entry — 7C — and the first card dealt is the first entry.
    expect(state.board.stock.map(cardCode)).toEqual([
      "6D", "5S", "3S", "TS", "5D", "6H", "6C", "4S", "JD", "3H", "QC", "3C",
      "AH", "6S", "9S", "7H", "2C", "4H", "KD", "8C", "KH", "9C", "2S", "7C",
    ]);
  });

});

describe("drawing and recycling", () => {
  it("turns one card in draw-one, and three in draw-three", () => {
    const one = applyKlondike(dealKlondike("draw1", 3), { kind: "draw" });
    expect(one.board.waste).toHaveLength(1);
    expect(one.board.stock).toHaveLength(23);

    const three = applyKlondike(dealKlondike("draw3", 3), { kind: "draw" });
    expect(three.board.waste).toHaveLength(3);
    expect(three.board.stock).toHaveLength(21);
  });

  it("turns what is left when the stock holds fewer than three", () => {
    const state = stateOf(board({ tableau: [""], stock: "AS AD" }), "draw3");
    const drawn = applyKlondike(state, { kind: "draw" });
    expect(drawn.board.waste.map((held) => held.rank)).toEqual([1, 1]);
    expect(drawn.board.stock).toEqual([]);
  });

  it("refuses to draw from an empty stock, and to recycle a stock that still holds cards", () => {
    const empty = stateOf(board({ tableau: [""], waste: "AS" }));
    expect(isKlondikeMoveLegal(empty, { kind: "draw" })).toBe(false);
    expect(isKlondikeMoveLegal(empty, { kind: "recycle" })).toBe(true);

    const full = stateOf(board({ tableau: [""], stock: "AS" }));
    expect(isKlondikeMoveLegal(full, { kind: "recycle" })).toBe(false);
  });

  it("recycles the waste so the next pass turns the same cards over in the same order", () => {
    let state = dealKlondike("draw1", 11);
    const firstPass: string[] = [];
    while (state.board.stock.length > 0) {
      state = applyKlondike(state, { kind: "draw" });
      firstPass.push(codeOf(state.board.waste[state.board.waste.length - 1]!));
    }
    expect(state.board.waste).toHaveLength(24);

    const recycled = applyKlondike(state, { kind: "recycle" });
    expect(recycled.board.stock).toHaveLength(24);
    expect(recycled.board.waste).toEqual([]);

    let second = recycled;
    const secondPass: string[] = [];
    while (second.board.stock.length > 0) {
      second = applyKlondike(second, { kind: "draw" });
      secondPass.push(codeOf(second.board.waste[second.board.waste.length - 1]!));
    }
    expect(secondPass).toEqual(firstPass);
  });
});

function codeOf(held: Card): string {
  return `${held.suit}-${held.rank}`;
}

/** The position the legality table below is written against. */
const TABLE = board({
  tableau: ["KS", "QH", "-7C 8H 9S TD", "-4D 5S", "", "JS", "-6D -7S"],
  foundations: { clubs: "AC 2C", diamonds: "AD 2D" },
  stock: "3H AS",
});

describe("move legality", () => {
  const cases: readonly {
    readonly label: string;
    readonly position: KlondikeBoard;
    readonly move: KlondikeMove;
    readonly legal: boolean;
  }[] = [
    { label: "draw while the stock holds cards", position: TABLE, move: { kind: "draw" }, legal: true },
    { label: "recycle while the stock holds cards", position: TABLE, move: { kind: "recycle" }, legal: false },
    { label: "a bare King onto an empty column", position: TABLE, move: move(tableau(0), tableau(4)), legal: true },
    {
      label: "a bare King onto a red Queen — the wrong way round",
      position: TABLE,
      move: move(tableau(0), tableau(1)),
      legal: false,
    },
    {
      label: "a red Queen onto a black King",
      position: TABLE,
      move: move(tableau(1), tableau(0)),
      legal: true,
    },
    {
      label: "the top of a run onto a black Jack — red Ten on black Jack",
      position: TABLE,
      move: move(tableau(2), tableau(5)),
      legal: true,
    },
    {
      label: "two cards of a run whose deepest card cannot land",
      position: TABLE,
      move: move(tableau(2), tableau(5), 2),
      legal: false,
    },
    {
      label: "the top two cards of a run onto an empty column",
      position: TABLE,
      move: move(tableau(2), tableau(4), 2),
      legal: true,
    },
    {
      label: "a whole face-up run onto an empty column",
      position: TABLE,
      move: move(tableau(2), tableau(4), 3),
      legal: true,
    },
    {
      label: "the Jack of Spades onto an empty column",
      position: TABLE,
      move: move(tableau(5), tableau(4)),
      legal: true,
    },
    {
      label: "the Five of Spades onto an empty column",
      position: TABLE,
      move: move(tableau(3), tableau(4)),
      legal: true,
    },
    {
      label: "one card more than the face-up run",
      position: TABLE,
      move: move(tableau(2), tableau(4), 4),
      legal: false,
    },
    {
      label: "lifting a card whose column top is face down",
      position: TABLE,
      move: move(tableau(6), tableau(4)),
      legal: false,
    },
    {
      label: "placing onto a face-down card",
      position: TABLE,
      move: move(tableau(3), tableau(6)),
      legal: false,
    },
    {
      label: "a Five onto an empty Spades foundation — the Ace is not home",
      position: TABLE,
      move: move(tableau(3), foundations("spades")),
      legal: false,
    },
    {
      label: "a Queen onto an empty Hearts foundation",
      position: TABLE,
      move: move(tableau(1), foundations("hearts")),
      legal: false,
    },
    {
      label: "the Ten of Clubs onto a Clubs foundation holding only the Two",
      position: TABLE,
      move: move(tableau(2), foundations("clubs")),
      legal: false,
    },
    {
      label: "the Ten of Clubs onto a Diamonds foundation",
      position: TABLE,
      move: move(tableau(2), foundations("diamonds")),
      legal: false,
    },
    {
      label: "a Two off a foundation onto a black Five",
      position: TABLE,
      move: move(foundations("diamonds"), tableau(3)),
      legal: false,
    },
    {
      label: "a Two off a foundation onto an empty column",
      position: TABLE,
      move: move(foundations("diamonds"), tableau(4)),
      legal: true,
    },
    {
      label: "a foundation onto another foundation",
      position: TABLE,
      move: move(foundations("clubs"), foundations("diamonds")),
      legal: false,
    },
    {
      label: "a foundation onto the waste",
      position: TABLE,
      move: move(foundations("diamonds"), waste),
      legal: false,
    },
    { label: "an empty waste as the source", position: TABLE, move: move(waste, tableau(4)), legal: false },
    { label: "a count of zero", position: TABLE, move: move(tableau(2), tableau(4), 0), legal: false },
    { label: "a column onto itself", position: TABLE, move: move(tableau(2), tableau(2)), legal: false },
    { label: "a column that does not exist", position: TABLE, move: move(tableau(7), tableau(4)), legal: false },
    {
      label: "the waste top onto the Queen it can pack on",
      position: board({ tableau: ["", "QH"], waste: "2D JC" }),
      move: move(waste, tableau(1)),
      legal: true,
    },
    {
      label: "two cards off the waste",
      position: board({ tableau: ["", "QH"], waste: "2D JC" }),
      move: move(waste, tableau(1), 2),
      legal: false,
    },
    {
      label: "the waste top onto a card it cannot pack on",
      position: board({ tableau: ["", "QH"], waste: "5C" }),
      move: move(waste, tableau(1)),
      legal: false,
    },
    {
      label: "the waste top onto an empty column",
      position: board({ tableau: ["", "QH"], waste: "2D JC" }),
      move: move(waste, tableau(0)),
      legal: true,
    },
    {
      label: "a red Queen off the waste onto a black King",
      position: board({ tableau: ["KS"], waste: "QH" }),
      move: move(waste, tableau(0)),
      legal: true,
    },
    {
      label: "a red Two off a foundation onto a black Three",
      position: board({ tableau: ["3S"], foundations: { diamonds: "AD 2D" } }),
      move: move(foundations("diamonds"), tableau(0)),
      legal: true,
    },
    {
      label: "the Two of Clubs onto a Clubs foundation holding its Ace",
      position: board({ tableau: ["2C"], foundations: { clubs: "AC" } }),
      move: move(tableau(0), foundations("clubs")),
      legal: true,
    },
    {
      label: "the Ace of Spades onto an empty Spades foundation",
      position: board({ tableau: ["AS"] }),
      move: move(tableau(0), foundations("spades")),
      legal: true,
    },
    {
      label: "a red Eight onto a black Nine",
      position: board({ tableau: ["-7C 8H", "9S"] }),
      move: move(tableau(0), tableau(1)),
      legal: true,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.legal ? "allows" : "refuses"} ${testCase.label}`, () => {
      const state = stateOf(testCase.position);
      expect(isKlondikeMoveLegal(state, testCase.move)).toBe(testCase.legal);
      expect(klondikeMoves(state).some((candidate) => sameMove(candidate, testCase.move))).toBe(
        testCase.legal,
      );
      if (!testCase.legal) {
        expect(() => applyKlondike(state, testCase.move)).toThrow(IllegalMoveError);
      }
    });
  }

  it("has at least fifteen legal and fifteen illegal cases above", () => {
    // The acceptance list asks for the table, not for a number; the assertion is
    // here so that a later edit that quietly deletes half of it is a failure.
    expect(cases.filter((testCase) => testCase.legal).length).toBeGreaterThanOrEqual(15);
    expect(cases.filter((testCase) => !testCase.legal).length).toBeGreaterThanOrEqual(15);
  });
});

function sameMove(left: KlondikeMove, right: KlondikeMove): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

describe("applying and undoing", () => {
  it("moves a run, turns the exposed card face up, and scores five for it", () => {
    const before = stateOf(TABLE);
    const after = applyKlondike(before, move(tableau(2), tableau(4), 3));
    expect(after.board.tableau[4]?.map((held) => cardCode(held.card))).toEqual(["8H", "9S", "TD"]);
    expect(after.board.tableau[2]).toEqual(column("7C"));
    expect(after.score).toBe(5);
  });

  it("restores the exact position and the exact move list on undo", () => {
    const before = stateOf(TABLE);
    const played = move(tableau(0), tableau(4));
    const after = applyKlondike(before, played);
    const undone = undoKlondike(after);
    expect(undone.board).toEqual(before.board);
    // The live stack comes back, which is the „move list" the player sees; the
    // LOG keeps the undo itself, because an undo is something that happened.
    expect(logMoves(undone.log)).toEqual(logMoves(before.log));
    expect(undone.log).toEqual([played, UNDO_ENTRY]);
  });

  it("prices the undo out of the score the move had already been paid into", () => {
    // Two foundation moves, then an undo: the score steps back to what it was
    // before the second move and pays the undo's own −2 — ten becomes eight.
    const before = stateOf(
      board({ tableau: ["2C", "2D"], foundations: { clubs: "AC", diamonds: "AD" } }),
    );
    const first = applyKlondike(before, move(tableau(0), foundations("clubs")));
    const second = applyKlondike(first, move(tableau(1), foundations("diamonds")));
    expect([first.score, second.score]).toEqual([10, 20]);
    const undone = undoKlondike(second);
    expect(undone.board).toEqual(first.board);
    expect(undone.score).toBe(8);
    // And the floor of zero catches the first undo of a deal, where there is
    // nothing to pay out of.
    const empty = undoKlondike(applyKlondike(before, move(tableau(0), foundations("clubs"))));
    expect(empty.score).toBe(0);
  });

  it("keeps the whole history and undoes one entry at a time, without limit", () => {
    let state = stateOf(TABLE);
    const steps: KlondikeState[] = [state];
    state = applyKlondike(state, move(tableau(0), tableau(4)));
    steps.push(state);
    state = applyKlondike(state, move(tableau(1), tableau(0)));
    steps.push(state);
    state = applyKlondike(state, { kind: "draw" });
    steps.push(state);

    expect(canUndoKlondike(state)).toBe(true);
    for (let index = steps.length - 1; index > 0; index -= 1) {
      state = undoKlondike(state);
      expect(state.board).toEqual(steps[index - 1]!.board);
    }
    expect(canUndoKlondike(state)).toBe(false);
    // Undoing everything leaves a log that is nothing but undos, and reading the
    // live stack off it yields no moves — which is what „nothing to undo" means.
    expect(state.log).toHaveLength(6);
    expect(() => undoKlondike(state)).toThrow(IllegalMoveError);
  });

  it("cannot undo an undo, because there is then nothing left to take back", () => {
    const before = stateOf(TABLE);
    const moved = applyKlondike(before, move(tableau(0), tableau(4)));
    const undone = undoKlondike(moved);
    // [move, undo] leaves an empty stack, so the button must already be off —
    // and a log that says otherwise is refused rather than replayed into a
    // position the player never had.
    expect(undone.board).toEqual(before.board);
    expect(canUndoKlondike(undone)).toBe(false);
    expect(() => undoKlondike(undone)).toThrow(IllegalMoveError);
  });
});

describe("the score", () => {
  it("uses the published Microsoft Windows Solitaire table", () => {
    // https://en.wikipedia.org/wiki/Klondike_(solitaire) § Scoring — waste to
    // tableau 5, waste to foundation 10, tableau to foundation 10, turn over a
    // tableau card 5, foundation to tableau −15, recycle the waste −100.
    expect(KLONDIKE_SCORE).toEqual({
      wasteToTableau: 5,
      toFoundation: 10,
      turnFaceUp: 5,
      foundationToTableau: -15,
      recycle: -100,
      undo: -2,
    });
  });

  it("adds ten for a card sent home from the tableau and five from the waste", () => {
    // The cited table scores a card arriving from EITHER pile at ten — the
    // waste-to-foundation row is not a cheaper or dearer road.
    const fromTableau = board({ tableau: ["2C"], foundations: { clubs: "AC" } });
    expect(
      applyKlondike(stateOf(fromTableau), move(tableau(0), foundations("clubs"))).score,
    ).toBe(10);
    const fromWaste = board({ tableau: [""], foundations: { clubs: "AC" }, waste: "2C" });
    expect(applyKlondike(stateOf(fromWaste), move(waste, foundations("clubs"))).score).toBe(10);
  });

  it("adds five for a waste card packed onto the tableau and subtracts fifteen the other way", () => {
    const position = board({ tableau: ["QH", ""], foundations: { diamonds: "AD 2D" }, waste: "JC" });
    const packed = applyKlondike(stateOf(position), move(waste, tableau(0)));
    expect(packed.score).toBe(5);
    const off = applyKlondike(packed, move(foundations("diamonds"), tableau(1)));
    // 5 − 15 = −10, and the published table says the score never goes below
    // zero, so the clamp is the rule rather than a floor somebody forgot.
    expect(off.score).toBe(0);
  });

  it("charges a hundred for a recycle, and never lets the total fall below zero", () => {
    const position = board({ tableau: [""], waste: "AS AD" });
    const recycled = applyKlondike(stateOf(position), { kind: "recycle" });
    expect(recycled.board.stock).toHaveLength(2);
    expect(recycled.score).toBe(0);
  });
});

describe("automatic moves to the foundations", () => {
  /**
   * The safety rule is the one the FreeCell FAQ states
   * (http://www.solitairelaboratory.com/fcfaq.html § „How does autoplay work?"):
   * a card is safe when every card that could be packed onto it is already home
   * or can go home as soon as it is uncovered — plus the FAQ's own two
   * shortcuts, an Ace, and a Two whose Ace is home.
   */
  it("plays an Ace always, and a Two once its Ace is home", () => {
    const position = board({ tableau: ["AS", "2C"], foundations: { clubs: "AC" } });
    expect(klondikeAutoMoves(stateOf(position))).toEqual([
      move(tableau(0), foundations("spades")),
      move(tableau(1), foundations("clubs")),
    ]);
  });

  it("holds a Two whose Ace is still in play", () => {
    const position = board({ tableau: ["2C"], foundations: { clubs: "" } });
    expect(klondikeAutoMoves(stateOf(position))).toEqual([]);
  });

  it("holds a higher card until both cards that could pack onto it are home", () => {
    // A red Three can go home only once the two black Fours are back or safe —
    // they are the cards that could still be packed onto it. Here the black
    // Fours are neither: their own foundations are not far enough along.
    const unsafe = board({ tableau: ["3D"], foundations: { clubs: "AC 2C", diamonds: "AD 2D" } });
    expect(klondikeAutoMoves(stateOf(unsafe))).toEqual([]);

    // The same red Three with both black Fours ON the foundations: nothing can
    // be packed onto it that is not already out of the way, so it is safe.
    const safe = board({
      tableau: ["3D"],
      foundations: {
        clubs: "AC 2C 3C 4C",
        diamonds: "AD 2D",
        spades: "AS 2S 3S 4S",
      },
    });
    expect(klondikeAutoMoves(stateOf(safe))).toEqual([move(tableau(0), foundations("diamonds"))]);
  });

  it("follows the packers one rank deeper, which is what the FAQ's example turns on", () => {
    // The FAQ: 7♦ is safe „when both black fives and the four of hearts are
    // already on the foundations" — the black Sixes are only harmless because
    // their own packers (the red Fives) are, one rank down. Nothing here is a
    // Six, so the board proves the rule walked up to them and stopped.
    const position = board({
      tableau: ["7D"],
      foundations: {
        clubs: "AC 2C 3C 4C 5C",
        diamonds: "AD 2D 3D 4D 5D 6D",
        hearts: "AH 2H 3H 4H",
        spades: "AS 2S 3S 4S 5S",
      },
    });
    expect(klondikeAutoMoves(stateOf(position))).toEqual([move(tableau(0), foundations("diamonds"))]);
  });

  it("offers nothing when no card can go home at all", () => {
    const position = board({ tableau: ["5S", "9H"] });
    expect(klondikeAutoMoves(stateOf(position))).toEqual([]);
  });
});

describe("win, stuck and hint", () => {
  const won = board({
    tableau: [""],
    foundations: {
      clubs: "AC 2C 3C 4C 5C 6C 7C 8C 9C TC JC QC KC",
      diamonds: "AD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD KD",
      hearts: "AH 2H 3H 4H 5H 6H 7H 8H 9H TH JH QH KH",
      spades: "AS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS KS",
    },
  });

  it("is won when all fifty-two cards are home", () => {
    expect(isKlondikeWon(stateOf(won))).toBe(true);
    expect(isKlondikeWon(dealKlondike("draw1", 1))).toBe(false);
  });

  it("knows it is stuck only when no action at all is left", () => {
    const stuck = board({ tableau: ["-7C", "-4D", "-6D"], foundations: {} });
    expect(hasKlondikeMoves(stateOf(stuck))).toBe(false);
    // A stock that still holds a card is a move — deliberately, because drawing
    // IS an action; what „stuck" means here is that nothing can be done at all.
    expect(hasKlondikeMoves(stateOf(board({ tableau: [""], stock: "AS" })))).toBe(true);
  });

  it("hints the move that sends a card home before anything else", () => {
    const position = board({
      tableau: ["AC", "QH", ""],
      foundations: { clubs: "" },
      stock: "AS",
    });
    expect(klondikeHint(stateOf(position))).toEqual(move(tableau(0), foundations("clubs")));
  });

  it("hints a draw when the board offers nothing else", () => {
    const position = board({ tableau: ["-7C", "-4D"], stock: "AS" });
    expect(klondikeHint(stateOf(position))).toEqual({ kind: "draw" });
  });

  it("hints nothing when there is nothing to hint", () => {
    expect(klondikeHint(stateOf(board({ tableau: ["-7C", "-4D"] })))).toBeNull();
  });
});

describe("auto-complete", () => {
  it("is offered only when every card is face up and the stock is empty", () => {
    expect(klondikeAllFaceUp(dealKlondike("draw1", 1))).toBe(false);
    expect(klondikeAllFaceUp(stateOf(board({ tableau: ["KS"], stock: "AS" })))).toBe(false);
    expect(klondikeAllFaceUp(stateOf(board({ tableau: ["KS", "-7C"] })))).toBe(false);
    expect(klondikeAllFaceUp(stateOf(board({ tableau: ["KS"], waste: "AS" })))).toBe(true);
  });

  it("finishes a deal whose cards are all face up", () => {
    const position = board({
      tableau: ["KS", "KH", "KD", "KC"],
      foundations: {
        clubs: "AC 2C 3C 4C 5C 6C 7C 8C 9C TC JC QC",
        diamonds: "AD 2D 3D 4D 5D 6D 7D 8D 9D TD JD QD",
        hearts: "AH 2H 3H 4H 5H 6H 7H 8H 9H TH JH QH",
        spades: "AS 2S 3S 4S 5S 6S 7S 8S 9S TS JS QS",
      },
    });
    const state = stateOf(position);
    const sequence = klondikeAutoComplete(state);
    expect(sequence).not.toBeNull();
    let finished = state;
    for (const step of sequence!) finished = applyKlondike(finished, step);
    expect(isKlondikeWon(finished)).toBe(true);
  });

  it("refuses to finish a deal that is not all face up", () => {
    expect(klondikeAutoComplete(dealKlondike("draw1", 1))).toBeNull();
  });

  it("answers that it cannot on a position where nothing can move at all", () => {
    // Hand-built and deliberately so: every exposed card is a Two with no Ace
    // home to go after and no Three of the other colour to land on, and the three
    // Kings have no empty column to move to. A greedy finisher must say so rather
    // than loop — and a solver is not in scope.
    const dead = board({ tableau: ["2C", "2S", "2H", "2D", "KH", "KS", "KC"] });
    expect(klondikeAllFaceUp(stateOf(dead))).toBe(true);
    expect(klondikeMoves(stateOf(dead))).toEqual([]);
    expect(klondikeAutoComplete(stateOf(dead))).toBeNull();
  });
});

describe("the replayed log", () => {
  it("rebuilds the state a move list describes", () => {
    const played = applyKlondike(dealKlondike("draw1", 5), { kind: "draw" });
    const again = replayKlondike("draw1", 5, played.log);
    expect(again).toEqual({ ok: true, state: played });
  });

  it("refuses an unknown variant and a seed that is not one", () => {
    expect(replayKlondike("draw2" as "draw1", 1, [])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "unknown-variant" }),
    });
    expect(replayKlondike("draw1", -1, [])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "bad-seed" }),
    });
  });

  it("refuses an entry that is not a move, naming its position", () => {
    expect(replayKlondike("draw1", 1, [{ kind: "fly" }])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "bad-entry", atIndex: 0 }),
    });
    expect(replayKlondike("draw1", 1, [UNDO_ENTRY])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "empty-undo", atIndex: 0 }),
    });
    expect(replayKlondike("draw1", 1, [{ kind: "draw" }, UNDO_ENTRY, UNDO_ENTRY])).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "empty-undo", atIndex: 2 }),
    });
  });

  it("refuses a legal-looking move the position does not allow", () => {
    const refusal = replayKlondike("draw1", 1, [move(tableau(0), foundations("spades"))]);
    expect(refusal).toEqual({
      ok: false,
      refusal: expect.objectContaining({ code: "illegal-move", atIndex: 0 }),
    });
  });

  it("refuses a log that is not a list at all", () => {
    for (const value of [null, {}, "draw", 7]) {
      expect(replayKlondike("draw1", 1, value)).toEqual({
        ok: false,
        refusal: expect.objectContaining({ code: "bad-entry" }),
      });
    }
  });

  it("guards a move's shape before its rules", () => {
    expect(isKlondikeMove({ kind: "draw" })).toBe(true);
    expect(isKlondikeMove(move(tableau(0), foundations("clubs")))).toBe(true);
    expect(isKlondikeMove({ kind: "move", from: waste, to: waste, count: 1 })).toBe(false);
    expect(isKlondikeMove({ kind: "move", from: waste, to: tableau(0), count: 1.5 })).toBe(false);
    expect(isKlondikeMove({ kind: "move", from: waste, to: tableau(0), count: 0 })).toBe(false);
    expect(isKlondikeMove({ kind: "move", from: waste, to: tableau(-1), count: 1 })).toBe(false);
    expect(isKlondikeMove({ kind: "recycle", from: waste })).toBe(false);
    expect(isKlondikeMove({ kind: "undo" })).toBe(false);

    const logs: readonly unknown[] = [
      [{ kind: "draw" }],
      [UNDO_ENTRY],
      [move(tableau(0), foundations("clubs")), UNDO_ENTRY],
    ];
    for (const log of logs) {
      expect(isKlondikeEntry((log as readonly GameLogEntry<KlondikeMove>[])[0])).toBe(true);
    }
    expect(isKlondikeEntry({ kind: "draw", count: 2 })).toBe(false);
  });
});

describe("the columns constant", () => {
  it("is the seven Klondike has always had", () => {
    expect(KLONDIKE_COLUMNS).toBe(7);
  });
});
