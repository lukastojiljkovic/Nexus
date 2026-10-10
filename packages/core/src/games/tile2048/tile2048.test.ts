import { describe, expect, it } from "vitest";

import { createSeededRandom } from "../random.js";
import {
  TILE_2048_WIN,
  canMoveTile2048,
  continueAfterWin,
  createTile2048,
  highestTile,
  mergeLine,
  moveTile2048,
  nextTileValue,
  tile2048From,
  undoLastMove,
} from "./tile2048.js";

describe("mergeLine", () => {
  // Every case is worked by hand in the comment beside it.
  const cases: readonly (readonly [readonly number[], readonly number[], number])[] = [
    // The acceptance case: the leftmost pair merges, the second pair merges, and
    // the two fours never see each other.
    [[2, 2, 2, 2], [4, 4, 0, 0], 8],
    // A tile merges at most once: these four fours make two eights, not a 16.
    [[4, 4, 4, 4], [8, 8, 0, 0], 16],
    // Gaps close first, so the two twos are neighbours once the zeros are gone.
    [[2, 0, 2, 2], [4, 2, 0, 0], 4],
    // A pair that is already merged cannot merge again with the next chain.
    [[2, 2, 4, 0], [4, 4, 0, 0], 4],
    // Three in a row: the first two merge and the third survives.
    [[2, 2, 2, 0], [4, 2, 0, 0], 4],
    [[4, 4, 4, 0], [8, 4, 0, 0], 8],
    // Nothing to do.
    [[2, 4, 8, 16], [2, 4, 8, 16], 0],
    [[0, 0, 0, 0], [0, 0, 0, 0], 0],
    // A single tile slides without merging.
    [[0, 0, 0, 2], [2, 0, 0, 0], 0],
  ];

  for (const [before, after, gained] of cases) {
    it(`turns ${before.join(" ")} into ${after.join(" ")}`, () => {
      expect(mergeLine(before)).toEqual({ line: [...after], gained });
    });
  }

  it("does not touch the line it was given", () => {
    const line = [2, 2, 2, 2];
    mergeLine(line);
    expect(line).toEqual([2, 2, 2, 2]);
  });
});

describe("nextTileValue", () => {
  it("draws a 2 nine times in ten over a hundred thousand spawns", () => {
    const random = createSeededRandom(20261009);
    let fours = 0;
    const draws = 100_000;
    for (let i = 0; i < draws; i += 1) if (nextTileValue(random) === 4) fours += 1;
    const share = fours / draws;
    // Ten percent with a tolerance of one percentage point: the standard error
    // of this count is sqrt(0.1 * 0.9 / 100000) = 0.00095, so the band is more
    // than ten standard errors wide and a rule that had drifted (a 1 in 8, say)
    // lands outside it immediately.
    expect(share).toBeGreaterThan(0.09);
    expect(share).toBeLessThan(0.11);
  });

  it("only ever returns 2 or 4", () => {
    const random = createSeededRandom(7);
    for (let i = 0; i < 1_000; i += 1) expect([2, 4]).toContain(nextTileValue(random));
  });
});

describe("createTile2048", () => {
  it("opens with two tiles", () => {
    for (const size of [4, 5, 6] as const) {
      const state = createTile2048(11, size);
      expect(state.size).toBe(size);
      expect(state.cells).toHaveLength(size * size);
      expect(state.cells.filter((value) => value !== 0)).toHaveLength(2);
      expect(state.score).toBe(0);
      expect(state.over).toBe(false);
      expect(state.won).toBe(false);
    }
  });

  it("replays the same opening for the same seed", () => {
    expect(createTile2048(1234)).toEqual(createTile2048(1234));
    expect(createTile2048(1234).cells).not.toEqual(createTile2048(1235).cells);
  });

  it("refuses a size it does not build", () => {
    expect(() => createTile2048(1, 7 as unknown as 4)).toThrow(RangeError);
  });
});

describe("moveTile2048", () => {
  it("merges a row, scores the merge and spawns one tile", () => {
    const state = tile2048From({
      cells: [2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      seed: 5,
    });
    const after = moveTile2048(state, "left");
    expect(after.score).toBe(8);
    expect(after.moves).toBe(1);
    // The two fours are the merge; the third tile is the spawn.
    expect(after.cells.slice(0, 2)).toEqual([4, 4]);
    const tiles = after.cells.filter((value) => value !== 0);
    expect(tiles).toHaveLength(3);
    expect(tiles.filter((value) => value === 4)).toHaveLength(2);
  });

  it("leaves the state it was handed alone", () => {
    const state = tile2048From({ cells: [2, 2, 0, 0, ...new Array<number>(12).fill(0)], seed: 3 });
    const before = [...state.cells];
    moveTile2048(state, "left");
    expect(state.cells).toEqual(before);
    expect(state.score).toBe(0);
  });

  it("does not move, score or spawn when nothing can move", () => {
    const cells = [
      2, 4, 2, 4,
      4, 2, 4, 2,
      2, 4, 2, 4,
      4, 2, 4, 2,
    ];
    const state = tile2048From({ cells, seed: 9 });
    expect(canMoveTile2048(state)).toBe(false);
    expect(state.over).toBe(true);
    expect(moveTile2048(state, "left")).toBe(state);
  });

  it("slides right as the reverse of sliding left", () => {
    const left = moveTile2048(
      tile2048From({ cells: [2, 2, 4, 0, ...new Array<number>(12).fill(0)], seed: 2 }),
      "left",
    );
    const right = moveTile2048(
      tile2048From({ cells: [0, 4, 2, 2, ...new Array<number>(12).fill(0)], seed: 2 }),
      "right",
    );
    // The left board's first row becomes 4 4 0 0; the right board's becomes
    // 0 0 4 4, because a rightward merge leaves its result at the far end.
    expect(left.cells.slice(0, 2)).toEqual([4, 4]);
    expect(right.cells.slice(2, 4)).toEqual([4, 4]);
    expect(left.score).toBe(4);
    expect(right.score).toBe(4);
  });

  it("runs on a five by five and a six by six board", () => {
    for (const size of [5, 6] as const) {
      const state = createTile2048(77, size);
      let played = state;
      for (const move of ["left", "down", "right", "up", "left"] as const) {
        played = moveTile2048(played, move);
      }
      expect(played.cells).toHaveLength(size * size);
      expect(played.moves).toBeGreaterThan(0);
    }
  });
});

describe("winning", () => {
  it("flags the 2048 tile and keeps going when the player says so", () => {
    const state = tile2048From({
      cells: [1024, 1024, 0, 0, ...new Array<number>(12).fill(0)],
      seed: 1,
    });
    expect(state.won).toBe(false);
    const after = moveTile2048(state, "left");
    expect(highestTile(after)).toBe(TILE_2048_WIN);
    expect(after.won).toBe(true);
    expect(after.keepGoing).toBe(false);
    const carriedOn = continueAfterWin(after);
    expect(carriedOn.keepGoing).toBe(true);
    expect(continueAfterWin(carriedOn)).toBe(carriedOn);
    const later = moveTile2048(carriedOn, "down");
    expect(later.won).toBe(true);
    expect(later.keepGoing).toBe(true);
  });

  it("reads a saved board that already holds the winning tile as won", () => {
    const state = tile2048From({ cells: [2048, 0, 0, 0, ...new Array<number>(12).fill(0)] });
    expect(state.won).toBe(true);
    expect(state.keepGoing).toBe(false);
  });
});

describe("undoLastMove", () => {
  it("steps back over the last move exactly, once", () => {
    const state = createTile2048(4242);
    const after = moveTile2048(state, "left");
    expect(after).not.toEqual(state);
    const back = undoLastMove(after);
    expect(back).not.toBeNull();
    const restored = back as NonNullable<typeof back>;
    expect(restored.cells).toEqual(state.cells);
    expect(restored.score).toBe(state.score);
    expect(restored.rngState).toBe(state.rngState);
    expect(restored.moves).toBe(state.moves);
    expect(undoLastMove(restored)).toBeNull();
  });

  it("has nothing to undo on a fresh board", () => {
    expect(undoLastMove(createTile2048(1))).toBeNull();
  });

  it("keeps the step of undo when a move changed nothing", () => {
    const cells = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
    const state = tile2048From({ cells, seed: 1 });
    expect(moveTile2048(state, "left")).toBe(state);
    expect(state.undo).toBeNull();
  });
});

describe("tile2048From", () => {
  it("refuses a board of the wrong length or with a tile that is not a power of two", () => {
    expect(() => tile2048From({ cells: [2, 2, 2] })).toThrow(RangeError);
    expect(() => tile2048From({ cells: [3, 0, 0, 0, ...new Array<number>(12).fill(0)] })).toThrow(
      RangeError,
    );
    expect(() => tile2048From({ cells: new Array<number>(16).fill(0), size: 5 })).toThrow(
      RangeError,
    );
  });

  it("carries a score and a move count through", () => {
    const state = tile2048From({
      cells: new Array<number>(16).fill(0),
      score: 128,
      moves: 9,
      seed: 4,
    });
    expect(state.score).toBe(128);
    expect(state.moves).toBe(9);
    expect(highestTile(state)).toBe(0);
  });
});
