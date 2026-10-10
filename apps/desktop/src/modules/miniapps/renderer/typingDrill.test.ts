import { describe, expect, it } from "vitest";
import type { RandomBelow } from "@nexus/core";
import { DRILL_WORDS, drillText, keystrokesFromChange } from "./typingDrill.js";

/**
 * The typing tutor's drill text and keystroke bookkeeping (mini-apps).
 *
 * The random source is scripted rather than sampled, on `@nexus/core`'s own
 * terms: with a source that always answers 0 the drill is fully determined, so
 * the exact text can be asserted instead of "it looks like words".
 */

/** A source that answers the same value every time. */
function constant(value: number): RandomBelow {
  return () => value;
}

describe("drillText", () => {
  it("builds the shortest word when the source answers the bottom of every bound", () => {
    // 3-key words, every key the first of the lesson's two, 12 words joined.
    const text = drillText(["f", "j"], constant(0));

    expect(text).toBe(Array.from({ length: DRILL_WORDS }, () => "fff").join(" "));
  });

  it("takes the longest word and the last key when the source answers the top", () => {
    // The word length is 3 + 2 and each key is the lesson's second one: the
    // source answers the highest value its bound allows, which is what a
    // well-behaved `RandomBelow` may do.
    const text = drillText(["f", "j"], (bound) => bound - 1);

    expect(text).toBe(Array.from({ length: DRILL_WORDS }, () => "jjjjj").join(" "));
  });

  it("draws every key from the lesson it was given, and never from another", () => {
    // A three-key lesson with a source that walks the alphabet's indexes in
    // order: the text can only be made of these three characters.
    const keys = ["a", "s", "d"];
    let next = 0;
    const text = drillText(keys, () => (next++ % 3), 4);

    expect(new Set([...text.replaceAll(" ", "")])).toEqual(new Set(keys));
    expect(text.split(" ")).toHaveLength(4);
  });

  it("answers nothing for a lesson with no keys rather than throwing", () => {
    expect(drillText([], constant(0))).toBe("");
  });
});

describe("keystrokesFromChange", () => {
  it("stamps a newly added character with the moment it landed", () => {
    const typed = keystrokesFromChange([{ atMs: 10, typed: "f" }], "fj", 250);

    expect(typed).toEqual([
      { atMs: 10, typed: "f" },
      { atMs: 250, typed: "j" },
    ]);
  });

  it("drops the instant of a character that was deleted", () => {
    const typed = keystrokesFromChange(
      [
        { atMs: 10, typed: "f" },
        { atMs: 250, typed: "x" },
      ],
      "fs",
      500,
    );

    // The backspace costs nothing and is not counted as a mistake: the list
    // describes what the field holds NOW, so the next character is stamped with
    // the time it was typed rather than the deleted one's.
    expect(typed).toEqual([
      { atMs: 10, typed: "f" },
      { atMs: 250, typed: "s" },
    ]);
  });

  it("stamps a pasted block with one instant, keeping the characters before it", () => {
    const typed = keystrokesFromChange([{ atMs: 10, typed: "f" }], "fjjj", 900);

    expect(typed).toEqual([
      { atMs: 10, typed: "f" },
      { atMs: 900, typed: "j" },
      { atMs: 900, typed: "j" },
      { atMs: 900, typed: "j" },
    ]);
  });

  it("empties the list when the field is emptied", () => {
    expect(keystrokesFromChange([{ atMs: 10, typed: "f" }], "", 300)).toEqual([]);
  });
});
