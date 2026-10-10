import { describe, expect, it } from "vitest";
import { MLIN_LAYOUT, draughts, ludo } from "@nexus/core";
import {
  BACKGAMMON_BAR_COLUMN,
  EIGHT_GRID,
  LUDO_GRID,
  backgammonBarCell,
  backgammonCell,
  draughtsCell,
  ludoHomeCell,
  ludoTokenCell,
  ludoTrackCell,
  ludoYardCell,
  mlinCell,
  reversiCell,
} from "./geometry.js";

/**
 * The boards as they are drawn (ADR-090 stage 2). What is pinned here is the one
 * property a picture can fail without anything else noticing: that a cell's place
 * on the grid is the cell the game's own numbering means — and that no two things
 * are drawn in one place. Every expected value below is either read off the
 * engine's own arithmetic (an oracle) or a hand-checked corner.
 */

function key(cell: { column: number; row: number }): string {
  return `${cell.column}:${cell.row}`;
}

describe("the 8x8 boards", () => {
  it("puts reversi's cell 0 at the bottom-left and cell 63 at the top-right", () => {
    // The engine counts rows from the BOTTOM, the grid from the top, so the flip
    // is `EIGHT_GRID - row` and cell 0 is the bottom-left corner.
    expect(reversiCell(0)).toEqual({ column: 1, row: EIGHT_GRID });
    expect(reversiCell(63)).toEqual({ column: EIGHT_GRID, row: 1 });
    const seen = new Set<string>();
    for (let cell = 0; cell < EIGHT_GRID * EIGHT_GRID; cell += 1) seen.add(key(reversiCell(cell)));
    expect(seen.size).toBe(64);
  });

  it("draws draughts' 32 playable squares on the dark cells and nowhere twice", () => {
    const seen = new Set<string>();
    for (let square = 0; square < draughts.DRAUGHTS_SQUARES; square += 1) {
      const cell = draughtsCell(square);
      seen.add(key(cell));
      // Playable squares are the even-parity ones: `(row + column) % 2 === 0`,
      // counted in the engine's bottom-up rows.
      expect(
        (EIGHT_GRID - cell.row + (cell.column - 1)) % 2,
        `square ${square}`,
      ).toBe(0);
    }
    expect(seen.size).toBe(draughts.DRAUGHTS_SQUARES);
  });

});

describe("the morris board", () => {
  it("draws every point on the lattice its own name is read from", () => {
    const seen = new Set<string>();
    for (let point = 0; point < MLIN_LAYOUT.length; point += 1) {
      const at = MLIN_LAYOUT[point] as readonly [number, number];
      expect(mlinCell(point)).toEqual({ column: at[0] + 1, row: at[1] + 1 });
      seen.add(key(mlinCell(point)));
    }
    expect(seen.size).toBe(24);
  });
});

describe("the backgammon board", () => {
  it("lays the two rows out the way a printed board does, with the bar between them", () => {
    // Bottom row, right to left: point 1 against the right edge, point 6 on the
    // bar's left. Top row, left to right: point 13 at the far left, 24 at the far
    // right. Both halves meet at column 7, which is the bar.
    expect(backgammonCell(0)).toEqual({ column: 13, row: 2 });
    expect(backgammonCell(5)).toEqual({ column: 8, row: 2 });
    expect(backgammonCell(6)).toEqual({ column: 6, row: 2 });
    expect(backgammonCell(11)).toEqual({ column: 1, row: 2 });
    expect(backgammonCell(12)).toEqual({ column: 1, row: 1 });
    expect(backgammonCell(17)).toEqual({ column: 6, row: 1 });
    expect(backgammonCell(18)).toEqual({ column: 8, row: 1 });
    expect(backgammonCell(23)).toEqual({ column: 13, row: 1 });
    expect(backgammonBarCell(0)).toEqual({ column: BACKGAMMON_BAR_COLUMN, row: 2 });
    expect(backgammonBarCell(1)).toEqual({ column: BACKGAMMON_BAR_COLUMN, row: 1 });
    const seen = new Set<string>();
    for (let index = 0; index < 24; index += 1) {
      const cell = backgammonCell(index);
      expect(cell.column).not.toBe(BACKGAMMON_BAR_COLUMN);
      seen.add(key(cell));
    }
    expect(seen.size).toBe(24);
  });
});

describe("the ludo board", () => {
  it("draws the track as the ring the engine numbers, entries at the four corners", () => {
    expect(ludoTrackCell(0)).toEqual({ column: 1, row: LUDO_GRID });
    expect(ludoTrackCell(13)).toEqual({ column: 1, row: 1 });
    expect(ludoTrackCell(26)).toEqual({ column: LUDO_GRID, row: 1 });
    expect(ludoTrackCell(39)).toEqual({ column: LUDO_GRID, row: LUDO_GRID });
    const seen = new Set<string>();
    for (let square = 0; square < ludo.LUDO_TRACK; square += 1) {
      const cell = ludoTrackCell(square);
      // Every track square is on the perimeter of the 14x14 grid: thirteen cells a
      // side, four sides, no corners counted twice.
      const onEdge =
        cell.column === 1 ||
        cell.column === LUDO_GRID ||
        cell.row === 1 ||
        cell.row === LUDO_GRID;
      expect(onEdge, `square ${square} at ${key(cell)}`).toBe(true);
      seen.add(key(cell));
    }
    expect(seen.size).toBe(ludo.LUDO_TRACK);
    // And the four entry squares are exactly the four seats' own entries.
    const entries = new Set([0, 1, 2, 3].map((seat) => key(ludoTrackCell(ludo.ludoEntry(seat)))));
    expect(entries).toEqual(new Set(["1:14", "1:1", "14:1", "14:14"]));
  });

  it("keeps the home runs, the yards and the track in three disjoint sets of cells", () => {
    const track = new Set(Array.from({ length: ludo.LUDO_TRACK }, (_, square) => key(ludoTrackCell(square))));
    const home = new Set<string>();
    const yard = new Set<string>();
    for (let seat = 0; seat < 4; seat += 1) {
      for (let step = 0; step < ludo.LUDO_HOME_COLUMN; step += 1) {
        const cell = key(ludoHomeCell(seat, step));
        expect(track.has(cell)).toBe(false);
        home.add(cell);
      }
      for (let token = 0; token < ludo.LUDO_TOKENS; token += 1) {
        const cell = key(ludoYardCell(seat, token));
        expect(track.has(cell)).toBe(false);
        expect(home.has(cell)).toBe(false);
        yard.add(cell);
      }
    }
    expect(home.size).toBe(4 * ludo.LUDO_HOME_COLUMN);
    expect(yard.size).toBe(16);
  });

  it("draws a token where its progress says it is", () => {
    for (const seat of [0, 1, 2, 3]) {
      expect(ludoTokenCell(seat, 2, 0)).toEqual(ludoYardCell(seat, 2));
      for (const progress of [1, 13, 26, 39, 51]) {
        const square = ludo.ludoSquare(seat, progress) as number;
        expect(ludoTokenCell(seat, 2, progress)).toEqual(ludoTrackCell(square));
      }
      // Progress 52 is the first home square; 57 is home itself, and it is the
      // last of the seat's run rather than a seventh cell that does not exist.
      expect(ludoTokenCell(seat, 0, 52)).toEqual(ludoHomeCell(seat, 0));
      expect(ludoTokenCell(seat, 0, 57)).toEqual(ludoHomeCell(seat, 5));
      expect(ludoTokenCell(seat, 0, ludo.LUDO_HOME)).toEqual(ludoHomeCell(seat, 5));
    }
  });
});
