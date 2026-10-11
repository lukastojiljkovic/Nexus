import { describe, expect, it } from "vitest";
import { BLOCKS_PIECE_IDS, pieceCells, pieceFrame } from "./pieces.js";
import type { BlockPieceId } from "./pieces.js";

/** A cell set as a sorted string, so two shapes compare by what they cover rather than by the order the array happens to hold. */
function shape(id: BlockPieceId, rotation: number): string[] {
  return pieceCells(id, rotation)
    .map((cell) => `${cell.x},${cell.y}`)
    .sort();
}

describe("the seven pieces", () => {
  it("is seven, all different", () => {
    expect(BLOCKS_PIECE_IDS).toHaveLength(7);
    expect(new Set(BLOCKS_PIECE_IDS).size).toBe(7);
  });

  it.each(BLOCKS_PIECE_IDS)("%s is four distinct cells in every rotation", (id) => {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const cells = pieceCells(id, rotation);
      expect({ id, rotation, count: cells.length }).toEqual({ id, rotation, count: 4 });
      expect({ id, rotation, distinct: new Set(shape(id, rotation)).size }).toEqual({
        id,
        rotation,
        distinct: 4,
      });
    }
  });

  it.each(BLOCKS_PIECE_IDS)("%s rotates inside its own frame, on whole cells", (id) => {
    const side = pieceFrame(id);
    for (let rotation = 0; rotation < 4; rotation += 1) {
      for (const cell of pieceCells(id, rotation)) {
        expect(Number.isInteger(cell.x) && Number.isInteger(cell.y)).toBe(true);
        expect({ cell, inside: cell.x >= 0 && cell.x < side && cell.y >= 0 && cell.y < side }).toEqual(
          { cell, inside: true },
        );
      }
    }
  });

  it.each(BLOCKS_PIECE_IDS)("%s comes back to itself after four turns", (id) => {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      expect(shape(id, rotation + 4)).toEqual(shape(id, rotation));
    }
    // And a turn backwards is three turns forwards, so a caller counting down
    // cannot fall off the end of the list.
    expect(shape(id, -1)).toEqual(shape(id, 3));
  });

  it("has exactly one rotation-invariant piece: the square", () => {
    const fixed = BLOCKS_PIECE_IDS.filter((id) =>
      [1, 2, 3].every((rotation) => JSON.stringify(shape(id, rotation)) === JSON.stringify(shape(id, 0))),
    );
    expect(fixed).toEqual(["square"]);
  });

  it("frames three pieces of side four, two and three", () => {
    expect(BLOCKS_PIECE_IDS.map((id) => [id, pieceFrame(id)])).toEqual([
      ["bar", 4],
      ["square", 2],
      ["tee", 3],
      ["ell", 3],
      ["jay", 3],
      ["ess", 3],
      ["zee", 3],
    ]);
  });

  it("turns the bar a quarter clockwise: a row becomes a column", () => {
    // Spawn: row 1, columns 0–3. One quarter turn about the centre of its 4-wide
    // frame — (x, y) → (3 − y, x) — puts it at column 2, rows 0–3; a second turn
    // puts it at row 2, and a third at column 1.
    expect(shape("bar", 0)).toEqual(["0,1", "1,1", "2,1", "3,1"]);
    expect(shape("bar", 1)).toEqual(["2,0", "2,1", "2,2", "2,3"]);
    expect(shape("bar", 2)).toEqual(["0,2", "1,2", "2,2", "3,2"]);
    expect(shape("bar", 3)).toEqual(["1,0", "1,1", "1,2", "1,3"]);
  });

  it("turns the tee's nose from up to right", () => {
    expect(shape("tee", 0)).toEqual(["0,1", "1,0", "1,1", "2,1"]);
    expect(shape("tee", 1)).toEqual(["1,0", "1,1", "1,2", "2,1"]);
  });

  it("mirrors the two corners rather than turning one into the other", () => {
    // An ell and a jay are reflections; a rotation alone can never exchange them,
    // which is why both are in the bag as separate pieces.
    const ell = JSON.stringify(shape("ell", 0));
    const jay = JSON.stringify(shape("jay", 0));
    const mirroredJay = JSON.stringify(
      pieceCells("jay", 0)
        .map((cell) => ({ x: 2 - cell.x, y: cell.y }))
        .map((cell) => `${cell.x},${cell.y}`)
        .sort(),
    );
    expect(ell).toBe(mirroredJay);
    expect(ell).not.toBe(jay);
  });
});
