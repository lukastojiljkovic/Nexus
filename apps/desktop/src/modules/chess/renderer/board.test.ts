import { describe, expect, it } from "vitest";

import { createGame, legalUci } from "@nexus/core";
import {
  afterSquareActivated,
  displayRows,
  isLight,
  moveFields,
  moveRows,
  pieceGlyph,
  plyAfter,
  squareInDirection,
  squareOf,
  squareParts,
  type BoardCells,
} from "./board.js";

/**
 * The board's own arithmetic, pinned with hand-checked values.
 *
 * Every expected value below is either the board's own definition (a1 is dark,
 * an arrow points where it looks) or a list `chess.js` produced for a named
 * position, which is what makes these tests able to fail: the destination of an
 * arrow, the meaning of a second press and the numbering of a move list are the
 * decisions a board makes on every keystroke, and none of them is visible in a
 * screenshot.
 */

/** The start position's board, as `chess.board()` answers it — the fixture the geometry tests read. */
function startCells(): BoardCells {
  return createGame().board();
}

describe("squares", () => {
  it("spells a zero-based file and rank as the algebraic name, and nothing off the board", () => {
    expect(squareOf(0, 0)).toBe("a1");
    expect(squareOf(4, 3)).toBe("e4");
    expect(squareOf(7, 7)).toBe("h8");
    expect(squareOf(-1, 0)).toBeNull();
    expect(squareOf(8, 0)).toBeNull();
    expect(squareOf(0, 8)).toBeNull();
  });

  it("reads a name back, and answers null for anything that is not a square", () => {
    expect(squareParts("e4")).toEqual({ file: 4, rank: 3 });
    expect(squareParts("a1")).toEqual({ file: 0, rank: 0 });
    expect(squareParts("i1")).toBeNull();
    expect(squareParts("e9")).toBeNull();
    expect(squareParts("e44")).toBeNull();
    expect(squareParts("")).toBeNull();
  });

  it("calls a1 dark and h1 light — the corner every board agrees about", () => {
    expect(isLight(0, 0)).toBe(false);
    expect(isLight(1, 0)).toBe(true);
    expect(isLight(7, 0)).toBe(true);
    // e1 is a dark square and e4 a light one, which is the pair a player checks
    // their own mental picture against.
    expect(isLight(4, 0)).toBe(false);
    expect(isLight(4, 3)).toBe(true);
  });
});

describe("displayRows", () => {
  it("draws the eighth rank first when White is at the bottom", () => {
    const rows = displayRows(startCells(), false);
    expect(rows[0]?.map((cell) => cell.square)).toEqual([
      "a8", "b8", "c8", "d8", "e8", "f8", "g8", "h8",
    ]);
    expect(rows[7]?.map((cell) => cell.square)).toEqual([
      "a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1",
    ]);
    // What stands where: a rook on the corner, and the empty middle of the board.
    expect(rows[0]?.[0]?.piece).toEqual({ color: "b", type: "r", square: "a8" });
    // a8 is a LIGHT square and a1 a dark one, which is the same fact as „a1 is
    // dark" read from the other end of the file.
    expect(rows[0]?.[0]?.light).toBe(true);
    expect(rows[7]?.[0]?.light).toBe(false);
    expect(rows[4]?.[4]?.piece).toBeNull();
  });

  it("turns the whole board round when it is flipped, and names the empty squares too", () => {
    const rows = displayRows(startCells(), true);
    expect(rows[0]?.map((cell) => cell.square)).toEqual([
      "h1", "g1", "f1", "e1", "d1", "c1", "b1", "a1",
    ]);
    expect(rows[7]?.map((cell) => cell.square)).toEqual([
      "h8", "g8", "f8", "e8", "d8", "c8", "b8", "a8",
    ]);
    // h1 is a light square whichever way it is drawn, which is the point of
    // reading the colour off the SQUARE rather than off the loop index.
    expect(rows[0]?.[0]?.light).toBe(true);
    expect(rows[4]?.[3]?.piece).toBeNull();
  });
});

describe("squareInDirection", () => {
  it("points where the key looks, not where the board's own axes run", () => {
    expect(squareInDirection("e4", "ArrowUp", false)).toBe("e5");
    expect(squareInDirection("e4", "ArrowDown", false)).toBe("e3");
    expect(squareInDirection("e4", "ArrowLeft", false)).toBe("d4");
    expect(squareInDirection("e4", "ArrowRight", false)).toBe("f4");
    // Flipped, „up" is towards the FIRST rank, because that is what is on screen.
    expect(squareInDirection("e4", "ArrowUp", true)).toBe("e3");
    expect(squareInDirection("e4", "ArrowDown", true)).toBe("e5");
    expect(squareInDirection("e4", "ArrowLeft", true)).toBe("f4");
    expect(squareInDirection("e4", "ArrowRight", true)).toBe("d4");
  });

  it("stops at the edge rather than wrapping onto the next rank", () => {
    expect(squareInDirection("a1", "ArrowLeft", false)).toBeNull();
    expect(squareInDirection("a1", "ArrowDown", false)).toBeNull();
    expect(squareInDirection("h8", "ArrowRight", false)).toBeNull();
    expect(squareInDirection("h8", "ArrowUp", false)).toBeNull();
    // The same edge, seen from the flipped board.
    expect(squareInDirection("a1", "ArrowRight", true)).toBeNull();
    expect(squareInDirection("a1", "ArrowDown", true)).toBe("a2");
  });
});

describe("pieceGlyph", () => {
  it("draws the two sides from the two halves of Unicode's chess block", () => {
    // U+2654 is the hollow king, U+265A the solid one: the sides differ in SHAPE,
    // so a dark theme cannot invert the game's own convention.
    expect(pieceGlyph("w", "k").codePointAt(0)).toBe(0x2654);
    expect(pieceGlyph("b", "k").codePointAt(0)).toBe(0x265a);
    expect(pieceGlyph("w", "q").codePointAt(0)).toBe(0x2655);
    expect(pieceGlyph("w", "p").codePointAt(0)).toBe(0x2659);
    expect(pieceGlyph("b", "p").codePointAt(0)).toBe(0x265f);
    expect(pieceGlyph("w", "n")).not.toBe(pieceGlyph("b", "n"));
  });
});

describe("moveFields", () => {
  it("splits a move into its three fields and refuses anything else", () => {
    expect(moveFields("e2e4")).toEqual({ from: "e2", to: "e4", promotion: null });
    expect(moveFields("e7e8q")).toEqual({ from: "e7", to: "e8", promotion: "q" });
    expect(moveFields("e2e4x")).toBeNull();
    expect(moveFields("e2")).toBeNull();
    expect(moveFields("")).toBeNull();
  });
});

describe("afterSquareActivated", () => {
  const start = legalUci(createGame());

  it("picks a piece up when the first press lands on one that can move", () => {
    expect(afterSquareActivated(null, "e2", start)).toEqual({
      selected: "e2",
      move: null,
      promotion: [],
    });
    // A square with nothing movable on it chooses nothing rather than selecting it.
    expect(afterSquareActivated(null, "e3", start).selected).toBeNull();
    expect(afterSquareActivated(null, "e7", start).selected).toBeNull();
  });

  it("plays the move when the second press lands on a legal destination", () => {
    expect(afterSquareActivated("e2", "e4", start)).toEqual({
      selected: null,
      move: "e2e4",
      promotion: [],
    });
    expect(afterSquareActivated("g1", "f3", start).move).toBe("g1f3");
  });

  it("re-picks when the second press lands on another piece of the same side", () => {
    // The press that changes your mind: g1 holds the king's knight, who can
    // move, so the selection moves to him rather than being dropped. (d1 would
    // NOT do: the queen there is boxed in by her own pawn and bishop in the
    // start position, and a square with no legal move is not a new selection.)
    expect(afterSquareActivated("e2", "g1", start).selected).toBe("g1");
    expect(afterSquareActivated("e2", "d1", start).selected).toBeNull();
  });

  it("drops the selection when the second press lands where nothing can go", () => {
    expect(afterSquareActivated("e2", "e5", start)).toEqual({
      selected: null,
      move: null,
      promotion: [],
    });
  });

  it("keeps the same piece selected when its own square is pressed again", () => {
    // Pressing the square you already hold is not a drop: it is the same
    // selection, which is what makes a double click harmless.
    expect(afterSquareActivated("e2", "e2", start).selected).toBe("e2");
  });

  it("hands back the four answers a promotion has instead of choosing one", () => {
    // A white pawn on a7 with nothing but the two kings beside it: its four
    // promotion moves are the only legal moves from a7.
    const promotionPosition = createGame("8/P7/8/8/8/8/8/K6k w - - 0 1");
    const legal = legalUci(promotionPosition, "a7");
    expect(afterSquareActivated("a7", "a8", legal)).toEqual({
      selected: null,
      move: null,
      // Queen first: the picker draws these in ONE order, and the generator's own
      // order is not a decision the board should inherit.
      promotion: ["a7a8q", "a7a8r", "a7a8b", "a7a8n"],
    });
    // ...and the choice the user then makes is one of those four, played as any
    // other move is.
    expect(afterSquareActivated(null, "a7", legal).selected).toBe("a7");
  });
});

describe("moveRows", () => {
  it("numbers the plies in pairs, White's move left and Black's right", () => {
    const rows = moveRows(["e2e4", "e7e5", "g1f3"], ["e4", "e5", "Nf3"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      number: 1,
      white: { ply: 1, uci: "e2e4", san: "e4" },
      black: { ply: 2, uci: "e7e5", san: "e5" },
    });
    // An odd game ends with a row whose black half is empty rather than absent.
    expect(rows[1]).toEqual({
      number: 2,
      white: { ply: 3, uci: "g1f3", san: "Nf3" },
      black: null,
    });
  });

  it("draws nothing for a game with no moves", () => {
    expect(moveRows([], [])).toEqual([]);
  });

  it("stops at the shorter list rather than drawing half a row", () => {
    expect(moveRows(["e2e4", "e7e5"], ["e4"])).toHaveLength(1);
  });
});

describe("plyAfter", () => {
  it("walks one ply and clamps at both ends of the game", () => {
    expect(plyAfter(3, "next", 5)).toBe(4);
    expect(plyAfter(3, "previous", 5)).toBe(2);
    expect(plyAfter(0, "previous", 5)).toBe(0);
    expect(plyAfter(5, "next", 5)).toBe(5);
    expect(plyAfter(3, "first", 5)).toBe(0);
    expect(plyAfter(3, "last", 5)).toBe(5);
  });

  it("answers 0 for a game with no moves, whichever control is pressed", () => {
    for (const action of ["first", "previous", "next", "last"] as const) {
      expect(plyAfter(0, action, 0)).toBe(0);
    }
  });
});
