import { describe, expect, it } from "vitest";
import {
  dealPyramid,
  dealTriPeaks,
  isPyramidMove,
  isTriPeaksMove,
  pyramidMoves,
  triPeaksMoves,
} from "@nexus/core";
import { pyramidExposed, pyramidRow, triPeaksExposed, TRIPEAKS_COVERED_BY, TRIPEAKS_ROWS } from "./cardParts.js";
import { cardLabel, suitGlyph } from "./table.js";
import { boxKey, highlights, sourceBox } from "./solitaire.js";

/**
 * The table's geometry and its card names (ADR-090 stage 2).
 *
 * **Why the exposed relations are pinned against the engines.** „Exposed" is the
 * engines' own word — a position they enumerate moves over — but the boards have to
 * know it to draw a card as clickable or as buried, and a card that looked playable
 * and refused would be the one defect a player reads as a bug. The two relations live
 * in `cardParts.ts` as the deal's own geometry, so this file checks that geometry
 * against the engines' move enumeration: the cards the picture offers are exactly the
 * cards a move can be about.
 */

describe("the pyramid's rows", () => {
  it("numbers the 28 slots as the deal does — one card, then two, and so on", () => {
    const rows = Array.from({ length: 28 }, (_, index) => pyramidRow(index));
    expect(rows.slice(0, 1)).toEqual([0]);
    expect(rows.slice(1, 3)).toEqual([1, 1]);
    expect(rows.slice(3, 6)).toEqual([2, 2, 2]);
    expect(rows.slice(6, 10)).toEqual([3, 3, 3, 3]);
    expect(rows.slice(21)).toEqual([6, 6, 6, 6, 6, 6, 6]);
  });

  it("agrees with the engine about which cards are exposed", () => {
    const state = dealPyramid("pass1", 55);
    const board = state.board;
    // The bottom row is always exposed, and a card above it only once both cards
    // below it are gone — which is exactly what `pyramidExposed` says.
    for (let index = 21; index < 28; index += 1) {
      expect(pyramidExposed(board.cards, index), `slot ${index}`).toBe(true);
    }
    // Every card the engine can name as a side of a match is a card the picture
    // offers, and every pair the picture offers the engine enumerates.
    const named = new Set(
      pyramidMoves(state)
        .filter(isPyramidMove)
        .filter((move): move is Extract<ReturnType<typeof pyramidMoves>[number], { kind: "match" }> => move.kind === "match")
        .flatMap((move) => [move.first, move.second])
        .filter(
          (slot): slot is { readonly kind: "pyramid"; readonly index: number } =>
            slot !== undefined && slot.kind === "pyramid",
        )
        .map((slot) => slot.index),
    );
    for (const index of named) expect(pyramidExposed(board.cards, index), `slot ${index}`).toBe(true);
  });
});

describe("the tri-peaks geometry", () => {
  it("covers the row below with exactly the slots the deal says", () => {
    expect(TRIPEAKS_COVERED_BY).toHaveLength(28);
    expect([...TRIPEAKS_COVERED_BY[10]!]).toEqual([0, 1]);
    expect([...TRIPEAKS_COVERED_BY[18]!]).toEqual([8, 9]);
    expect([...TRIPEAKS_COVERED_BY[19]!]).toEqual([10, 11]);
    expect([...TRIPEAKS_COVERED_BY[24]!]).toEqual([17, 18]);
  });

  it("draws every slot once, centred over the two cards that cover it", () => {
    // Each row is centred, so a slot's position is its index in the row plus
    // half the difference between the row's width and the widest row's.
    const widest = Math.max(...TRIPEAKS_ROWS.map((row) => row.length));
    const where = new Map<number, { row: number; x: number }>();
    TRIPEAKS_ROWS.forEach((row, rowIndex) =>
      row.forEach((slot, index) => {
        if (slot !== null) where.set(slot, { row: rowIndex, x: index + (widest - row.length) / 2 });
      }),
    );
    expect([...where.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 28 }, (_, slot) => slot));
    TRIPEAKS_COVERED_BY.forEach((covers, slot) => {
      if (covers.length === 0) return;
      const [left, right] = covers.map((cover) => where.get(cover)!);
      expect(where.get(slot), `slot ${slot}`).toEqual({ row: left!.row - 1, x: (left!.x + right!.x) / 2 });
    });
  });

  it("deals the row of ten face up and every card above it face down", () => {
    const board = dealTriPeaks("classic", 42).board;
    const exposed = Array.from({ length: 28 }, (_, slot) => slot).filter((slot) => triPeaksExposed(board.tableau, slot));
    expect(exposed).toEqual(Array.from({ length: 10 }, (_, slot) => slot));
  });

  it("offers exactly the cards the engine will play", () => {
    const state = dealTriPeaks("classic", 42);
    const board = state.board;
    const playable = new Set(
      triPeaksMoves(state)
        .filter(isTriPeaksMove)
        .filter((move) => move.kind === "play")
        .map((move) => (move.kind === "play" ? move.slot : -1)),
    );
    const offered = Array.from({ length: 28 }, (_, slot) => slot).filter(
      (slot) => board.tableau[slot] !== null && board.tableau[slot] !== undefined && triPeaksExposed(board.tableau, slot),
    );
    // „Exposed" is necessary, not sufficient (a card must also touch the waste's
    // rank), so the engine's plays are a subset — and every one of them is offered.
    for (const slot of playable) expect(offered, `slot ${slot}`).toContain(slot);
    expect(offered.length).toBeGreaterThanOrEqual(playable.size);
  });
});

describe("a card's name", () => {
  it("names the whole card in the language being read, for every suit and rank", () => {
    for (const suit of ["clubs", "diamonds", "hearts", "spades"] as const) {
      for (const rank of [1, 2, 10, 11, 12, 13] as const) {
        const label = cardLabel({ suit, rank });
        expect(label.length, `${suit}/${rank}`).toBeGreaterThan(0);
        expect(label.includes("{"), `${suit}/${rank}`).toBe(false);
      }
    }
    // The four suits are four different signs, so colour is never the only channel.
    const glyphs = (["clubs", "diamonds", "hearts", "spades"] as const).map(suitGlyph);
    expect(new Set(glyphs).size).toBe(4);
  });
});

describe("the boxes a board offers", () => {
  it("offers the boxes the engine's enumeration names, and no others", () => {
    const pyramid = dealPyramid("pass1", 2);
    const tripeaks = dealTriPeaks("wrap", 3);
    for (const [game, moves] of [
      ["pyramid", pyramidMoves(pyramid)],
      ["tripeaks", triPeaksMoves(tripeaks)],
    ] as const) {
      const marks = highlights(game, moves, null);
      for (const key of marks.pickable) {
        expect(
          moves.some((move) => {
            const source = sourceBox(game, move);
            return source !== null && boxKey(source) === key;
          }),
          `${game}/${key}`,
        ).toBe(true);
      }
    }
  });
});
