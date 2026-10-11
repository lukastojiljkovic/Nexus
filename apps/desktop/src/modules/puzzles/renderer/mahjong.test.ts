import { describe, expect, it } from "vitest";
import {
  TURTLE_LAYER_COUNTS,
  TURTLE_SLOTS,
  createMahjongDeal,
  createMahjongGame,
} from "@nexus/core";
import {
  boardBox,
  facesMatch,
  freeSlots,
  isFree,
  isStuck,
  isWon,
  gameOf,
  remainingCount,
  stackOrder,
  stateOf,
  takePair,
  tileBox,
  tileFace,
} from "./mahjong.js";

/**
 * The mahjong board's own numbers.
 *
 * The turtle's geometry is asserted against the layer counts the engine's test
 * pins (87 + 36 + 16 + 4 + 1 = 144), the tiles that may be taken are read from a
 * deal the engine made, and the drawing box is arithmetic this file states the
 * operands of — 30 quarters across and 16 down, at 14px a quarter.
 */
describe("the mahjong geometry", () => {
  it("places a tile at its own quarters, two quarters wide and two down", () => {
    // The first row of the base layer starts at x = 1, y = 0, and the drawn
    // board is shifted so that the leftmost tile stands at 0.
    expect(tileBox({ x: 1, y: 0, z: 0 }, 14)).toEqual({
      left: 0,
      top: 0,
      width: 28,
      height: 28,
    });
    // The tail of the turtle's middle row: x = 29, one quarter from the right
    // edge of a board 30 quarters wide.
    expect(tileBox({ x: 29, y: 7, z: 0 }, 14)).toEqual({
      left: 392,
      top: 98,
      width: 28,
      height: 28,
    });
    // The single tile at the very top, four layers up: drawn 4 × 2px higher than
    // the layer below it, which is presentation and not geometry.
    expect(tileBox({ x: 14, y: 7, z: 4 }, 14)).toEqual({
      left: 182,
      top: 90,
      width: 28,
      height: 28,
    });
  });

  it("makes the board exactly as wide as its widest tile, plus the lift", () => {
    const cell = 14;
    // x runs 1..29 and a tile is two quarters, so 30 quarters across; y runs
    // 0..14, so 16 down, plus 4 layers of lift at 2px each.
    expect(boardBox(cell)).toEqual({
      width: 30 * cell,
      height: 16 * cell + 4 * 2,
    });
    const widest = TURTLE_SLOTS.map((slot) => tileBox(slot, cell)).reduce(
      (max, box) => Math.max(max, box.left + box.width),
      0,
    );
    expect(widest).toBe(boardBox(cell).width);
  });

  it("draws layer by layer, so painting order is stacking order", () => {
    const order = stackOrder();
    expect(order).toHaveLength(144);
    // The count per layer is the engine's own turtle: 87, 36, 16, 4 and 1.
    const perLayer = [0, 0, 0, 0, 0];
    for (const index of order) {
      const { z } = TURTLE_SLOTS[index] as { z: number };
      perLayer[z] = (perLayer[z] ?? 0) + 1;
    }
    expect(perLayer).toEqual([...TURTLE_LAYER_COUNTS]);
    // And the order itself never steps back down a layer.
    let highest = 0;
    for (const index of order) {
      const { z } = TURTLE_SLOTS[index] as { z: number };
      expect(z).toBeGreaterThanOrEqual(highest);
      highest = z;
    }
  });
});

describe("the mahjong board's rules", () => {
  it("reads a face into the shape a tile draws", () => {
    expect(tileFace("bamboo-3")).toEqual({
      kind: "suit",
      suit: "bamboo",
      name: null,
      rank: 3,
    });
    expect(tileFace("wind-east")).toEqual({
      kind: "wind",
      suit: null,
      name: "east",
      rank: 0,
    });
    expect(tileFace("dragon-red")).toEqual({
      kind: "dragon",
      suit: null,
      name: "red",
      rank: 0,
    });
    expect(tileFace("flower-2")).toEqual({
      kind: "flower",
      suit: null,
      name: null,
      rank: 2,
    });
    expect(tileFace("season-4")).toEqual({
      kind: "season",
      suit: null,
      name: null,
      rank: 4,
    });
    // Total rather than throwing: the store refuses a face off the set, so this
    // is the branch corruption lands in rather than a page that blanks.
    expect(tileFace("not-a-tile")).toEqual({
      kind: "unknown",
      suit: null,
      name: null,
      rank: 0,
    });
    expect(tileFace("circles-10").kind).toBe("unknown");
  });

  it("counts what is left, and lets only free tiles and matching faces be taken", () => {
    const game = createMahjongGame(11);
    expect(remainingCount(stateOf(game, 0))).toBe(144);

    const free = freeSlots(game);
    // The turtle's base layer has open ends, so at least one pair of tiles is
    // takeable from the first position of a deal the engine built backwards.
    expect(free.length).toBeGreaterThan(0);
    const first = free[0] as number;
    expect(isFree(game, first)).toBe(true);

    // A blocked tile is not a play, and neither is a pair whose faces differ.
    const blocked = [...game.remaining.keys()].find((index) => !free.includes(index));
    if (blocked !== undefined) {
      expect(takePair(game, first, blocked)).toBeNull();
    }
    const mismatched = free.find((candidate) => !facesMatch(game.faces[first] as string, game.faces[candidate] as string));
    if (mismatched !== undefined && mismatched !== first) {
      expect(takePair(game, first, mismatched)).toBeNull();
    }
    expect(takePair(game, first, first)).toBeNull();
  });

  it("walks a deal the engine made to the end, two tiles at a time", () => {
    // The deal's own witness is a removal order, so following it must clear the
    // board and every step must be legal — which is what the panel does with a
    // person's clicks.
    const deal = createMahjongDeal(13);
    let game = gameOf(
      { faces: deal.faces, remaining: new Array<boolean>(144).fill(true), shuffles: 0 },
      13,
    );
    let steps = 0;
    while (!isWon(game)) {
      const next = deal.witness[steps];
      if (next === undefined) throw new Error("the deal's witness ran out before the board was clear");
      const taken = takePair(game, next[0], next[1]);
      if (taken === null) throw new Error(`pair ${steps} of the witness was refused`);
      game = taken;
      steps += 1;
      expect(isStuck(game)).toBe(false);
    }
    // 144 tiles come off 72 times, and the deal says exactly that.
    expect(steps).toBe(72);
    expect(remainingCount(stateOf(game, 0))).toBe(0);
  });
});
