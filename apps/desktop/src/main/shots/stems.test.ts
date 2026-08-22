import { describe, expect, it } from "vitest";

import { duplicateStems, type ShotFrame, type ShotTheme } from "./index.js";

/**
 * The reconciliation the sweep could not do for itself.
 *
 * A frame's file name is its STEM, and a stem is folded from a rail row's
 * Serbian label — diacritics dropped, truncated at 32 characters. That makes it
 * a label, never an identity, so two frames can want one file: two rows with
 * the same name (which is how four duplicated professional tools were found —
 * 2 423 frames over 2 399 images, DC-75), or two different names folding to one
 * stem. The sweep now keeps both frames and reports the collision; these pin
 * what counts as one.
 */

function frame(size: string, theme: ShotTheme, scene: string): ShotFrame {
  return { file: `${size}/${theme}/${scene}.png`, scene, theme, size, findings: [] };
}

describe("duplicateStems", () => {
  it("says nothing about a sweep in which every frame had its own file", () => {
    expect(
      duplicateStems([
        frame("min", "noc", "pro--iznos-slovima"),
        frame("min", "noc", "pro--racun-i-iban"),
        frame("min", "dan", "pro--iznos-slovima"),
      ]),
    ).toEqual([]);
  });

  /**
   * THE PRECONDITION OF THE KEY, and the reason it is not the stem alone.
   *
   * Every stem legitimately recurs once per size and once per theme — that is
   * what a sweep IS. Keyed on the stem, a clean run of six sizes-by-themes
   * would report every frame in the app as a duplicate, and a report that
   * flags everything is switched off by the person it obstructs (DC-15).
   */
  it("does not mistake the same surface at another size or in the other theme for a collision", () => {
    expect(
      duplicateStems([
        frame("min", "noc", "tools--duzina"),
        frame("default", "noc", "tools--duzina"),
        frame("wide", "noc", "tools--duzina"),
        frame("min", "dan", "tools--duzina"),
      ]),
    ).toEqual([]);
  });

  it("names the collision by where it happened, once per colliding stem", () => {
    expect(
      duplicateStems([
        frame("wide", "dan", "pro--iznos-slovima"),
        frame("wide", "dan", "pro--iznos-slovima"),
      ]),
    ).toEqual(["wide/dan/pro--iznos-slovima"]);
  });

  /**
   * Three frames on one stem is ONE finding, not two. The reader is being told
   * that a stem is not unique; how many times over is the sweep's arithmetic,
   * and repeating the row would read as three separate defects.
   */
  it("reports a stem taken three times exactly once", () => {
    const stem = frame("default", "noc", "pro--racun-i-iban");
    expect(duplicateStems([stem, stem, stem])).toEqual(["default/noc/pro--racun-i-iban"]);
  });

  it("reports collisions in a stable order, whatever order the sweep took them in", () => {
    const frames = [
      frame("wide", "noc", "b-tool"),
      frame("wide", "noc", "b-tool"),
      frame("min", "dan", "a-tool"),
      frame("min", "dan", "a-tool"),
    ];
    expect(duplicateStems(frames)).toEqual(["min/dan/a-tool", "wide/noc/b-tool"]);
    expect(duplicateStems([...frames].reverse())).toEqual(duplicateStems(frames));
  });
});
