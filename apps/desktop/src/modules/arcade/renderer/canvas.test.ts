import { describe, expect, it } from "vitest";

import { backingScale, boardPixels, cellSizeFor } from "./canvas.js";

/**
 * The board geometry (ADR-090). Every expectation below is a hand calculation
 * from the box the page hands in, and the two boards that decide them are the
 * real ones: Minesweeper's expert board is 30 x 16 and Blocks' is 12 x 22.
 */

describe("cellSizeFor", () => {
  it("takes the largest whole cell that fits both sides of the box", () => {
    // 640 / 30 = 21.3 and 460 / 16 = 28.75, so the width is what binds: 21.
    expect(cellSizeFor(30, 16, { maxWidth: 640, maxHeight: 460 })).toBe(21);
    // 640 / 12 = 53.3 and 460 / 22 = 20.9, so the height binds: 20.
    expect(cellSizeFor(12, 22, { maxWidth: 640, maxHeight: 460 })).toBe(20);
    // A 9 x 9 beginner board would fit 51 or 71 px; the cap is what stops a
    // board of nine cells looking like a chart.
    expect(cellSizeFor(9, 9, { maxWidth: 640, maxHeight: 460 })).toBe(44);
    expect(cellSizeFor(9, 9, { maxWidth: 640, maxHeight: 460, maxCell: 60 })).toBe(51);
  });

  it("keeps a custom board inside the box rather than letting it scroll sideways", () => {
    // The largest board the engine accepts: 30 x 24 at 640 x 460.
    const cell = cellSizeFor(30, 24, { maxWidth: 640, maxHeight: 460 });
    const board = boardPixels(30, 24, cell);
    expect(cell).toBe(19);
    expect(board.width).toBeLessThanOrEqual(640);
    expect(board.height).toBeLessThanOrEqual(460);
  });

  it("does not go below the floor it was given, and refuses a board that is not a board", () => {
    // A box of 90 px across fits 3 px cells; the floor answers 4 rather than a
    // smear. The page's own box is wide enough that this never binds for a board
    // the engine allows (30 columns fit 21 px in 640), which is the point of the
    // floor being a guard rather than a knob.
    expect(cellSizeFor(30, 24, { maxWidth: 90, maxHeight: 460, minCell: 4 })).toBe(4);
    expect(() => cellSizeFor(0, 9, { maxWidth: 640, maxHeight: 460 })).toThrow(RangeError);
    expect(() => cellSizeFor(9.5, 9, { maxWidth: 640, maxHeight: 460 })).toThrow(RangeError);
    expect(() => cellSizeFor(9, -1, { maxWidth: 640, maxHeight: 460 })).toThrow(RangeError);
  });
});

describe("boardPixels", () => {
  it("is the cell times the count, which is what the canvas box is set to", () => {
    expect(boardPixels(30, 16, 21)).toEqual({ width: 630, height: 336 });
    expect(boardPixels(12, 22, 20)).toEqual({ width: 240, height: 440 });
    expect(boardPixels(4, 4, 44)).toEqual({ width: 176, height: 176 });
  });
});

describe("backingScale", () => {
  it("never goes below one, and never above three", () => {
    expect(backingScale(0.8)).toBe(1);
    expect(backingScale(1)).toBe(1);
    expect(backingScale(1.5)).toBe(1.5);
    expect(backingScale(2)).toBe(2);
    expect(backingScale(4)).toBe(3);
    expect(backingScale(Number.NaN)).toBe(1);
  });
});
