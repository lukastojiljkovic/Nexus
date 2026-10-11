import { describe, expect, it } from "vitest";

import { BLOCKS_TICK_MS } from "@nexus/core";
import {
  BLOCKS_ARR_MS,
  BLOCKS_DAS_MS,
  BLOCKS_SOFT_DROP_MS,
  blocksActionFor,
  directionFor,
  isChordKey,
  isMarkKey,
  isRevealKey,
  isUndoKey,
  minesweeperStepFor,
  paddleFor,
  tile2048MoveFor,
} from "./input.js";
import { repeatCount } from "./loop.js";

/**
 * The keyboard maps (ADR-090): every game's keys, one table each, plus the two
 * rates a held key repeats at. The expected values are the engines' own
 * vocabularies, so a key mapped onto a word an engine does not have is a
 * compile error before it is a failing test.
 */

describe("blocksActionFor", () => {
  it("maps the arrows and their letter aliases onto the engine's seven actions", () => {
    expect(blocksActionFor("ArrowLeft")).toBe("left");
    expect(blocksActionFor("a")).toBe("left");
    expect(blocksActionFor("ArrowRight")).toBe("right");
    expect(blocksActionFor("d")).toBe("right");
    expect(blocksActionFor("ArrowUp")).toBe("rotateCW");
    expect(blocksActionFor("x")).toBe("rotateCW");
    expect(blocksActionFor("z")).toBe("rotateCCW");
    expect(blocksActionFor("ArrowDown")).toBe("softDrop");
    expect(blocksActionFor(" ")).toBe("hardDrop");
    expect(blocksActionFor("c")).toBe("hold");
    expect(blocksActionFor("Shift")).toBe("hold");
  });

  it("is case-blind for a letter and leaves a named key alone", () => {
    expect(blocksActionFor("A")).toBe("left");
    expect(blocksActionFor("Z")).toBe("rotateCCW");
    // A named key is not folded: `arrowleft` is what a bad caller sends, and it
    // is not a key.
    expect(blocksActionFor("arrowleft")).toBeNull();
  });

  it("answers null for a key it does not use", () => {
    for (const key of ["q", "Escape", "Tab", "1", "Enter"]) {
      expect(blocksActionFor(key), key).toBeNull();
    }
  });
});

describe("directionFor and the two games that read it", () => {
  it("gives the four directions from the arrows and WASD, and nothing else", () => {
    expect(directionFor("ArrowUp")).toBe("up");
    expect(directionFor("w")).toBe("up");
    expect(directionFor("s")).toBe("down");
    expect(directionFor("ArrowLeft")).toBe("left");
    expect(directionFor("d")).toBe("right");
    expect(directionFor("q")).toBeNull();
    expect(directionFor("ArrowUpLeft")).toBeNull();
  });

  it("names 2048's moves from the same four words", () => {
    expect(tile2048MoveFor("ArrowUp")).toBe("up");
    expect(tile2048MoveFor("a")).toBe("left");
    expect(tile2048MoveFor("q")).toBeNull();
  });

  it("recognises only u as the step of undo", () => {
    expect(isUndoKey("u")).toBe(true);
    expect(isUndoKey("U")).toBe(true);
    expect(isUndoKey("z")).toBe(false);
  });
});

describe("paddleFor", () => {
  it("reads the keys currently down, and both at once is no direction at all", () => {
    expect(paddleFor(new Set())).toBe(0);
    expect(paddleFor(new Set(["ArrowLeft"]))).toBe(-1);
    expect(paddleFor(new Set(["d"]))).toBe(1);
    expect(paddleFor(new Set(["ArrowLeft", "a"]))).toBe(-1);
    expect(paddleFor(new Set(["ArrowLeft", "ArrowRight"]))).toBe(0);
    expect(paddleFor(new Set(["ArrowLeft", " "]))).toBe(-1);
  });
});

describe("the Minesweeper cursor", () => {
  it("steps one cell in the four directions", () => {
    expect(minesweeperStepFor("ArrowUp")).toEqual({ dx: 0, dy: -1 });
    expect(minesweeperStepFor("ArrowDown")).toEqual({ dx: 0, dy: 1 });
    expect(minesweeperStepFor("ArrowLeft")).toEqual({ dx: -1, dy: 0 });
    expect(minesweeperStepFor("ArrowRight")).toEqual({ dx: 1, dy: 0 });
    expect(minesweeperStepFor("q")).toBeNull();
  });

  it("opens on Space and Enter, marks on F, chords on C", () => {
    expect(isRevealKey(" ")).toBe(true);
    expect(isRevealKey("Enter")).toBe(true);
    expect(isRevealKey("f")).toBe(false);
    expect(isMarkKey("F")).toBe(true);
    expect(isMarkKey(" ")).toBe(false);
    expect(isChordKey("c")).toBe(true);
    expect(isChordKey("C")).toBe(true);
    expect(isChordKey("f")).toBe(false);
  });
});

describe("the repeat rates", () => {
  it("is stated in whole ticks of the engine's own clock", () => {
    expect(BLOCKS_DAS_MS % BLOCKS_TICK_MS).toBe(0);
    expect(BLOCKS_ARR_MS % BLOCKS_TICK_MS).toBe(0);
    expect(BLOCKS_SOFT_DROP_MS % BLOCKS_TICK_MS).toBe(0);
    // Eight ticks of delay, two per repeat: the values the map's own comment
    // states, pinned here so a change to the tick cannot move them silently.
    expect(BLOCKS_DAS_MS).toBe(8 * BLOCKS_TICK_MS);
    expect(BLOCKS_ARR_MS).toBe(2 * BLOCKS_TICK_MS);
    expect(BLOCKS_SOFT_DROP_MS).toBe(2 * BLOCKS_TICK_MS);
  });

  it("repeats a held sideways key at that rate: nothing for the delay, then one per interval", () => {
    expect(repeatCount(BLOCKS_DAS_MS - 1, BLOCKS_DAS_MS, BLOCKS_ARR_MS)).toBe(0);
    expect(repeatCount(BLOCKS_DAS_MS, BLOCKS_DAS_MS, BLOCKS_ARR_MS)).toBe(1);
    expect(repeatCount(BLOCKS_DAS_MS + BLOCKS_ARR_MS - 1, BLOCKS_DAS_MS, BLOCKS_ARR_MS)).toBe(1);
    expect(repeatCount(BLOCKS_DAS_MS + BLOCKS_ARR_MS, BLOCKS_DAS_MS, BLOCKS_ARR_MS)).toBe(2);
    // A whole second of holding at 128/32: 1 + floor((1000 - 128) / 32) = 1 + 27.
    expect(repeatCount(1_000, BLOCKS_DAS_MS, BLOCKS_ARR_MS)).toBe(28);
  });

  it("soft-drops from the first millisecond, at the same interval", () => {
    expect(repeatCount(0, 0, BLOCKS_SOFT_DROP_MS)).toBe(1);
    expect(repeatCount(BLOCKS_SOFT_DROP_MS - 1, 0, BLOCKS_SOFT_DROP_MS)).toBe(1);
    expect(repeatCount(BLOCKS_SOFT_DROP_MS, 0, BLOCKS_SOFT_DROP_MS)).toBe(2);
  });
});
