import { describe, expect, it } from "vitest";

import { splitSentences } from "./sentences.js";

describe("splitSentences", () => {
  it("separates the sentences of a Serbian answer and keeps their terminators", () => {
    expect(
      splitSentences("Voda je klju\u010dna. Pij \u010desto, malo po malo! Da li ima\u0161 filter?"),
    ).toEqual(["Voda je klju\u010dna.", "Pij \u010desto, malo po malo!", "Da li ima\u0161 filter?"]);
  });

  it("separates the sentences of an English answer", () => {
    expect(splitSentences("Pack light. Take water. Stay on the trail.")).toEqual([
      "Pack light.",
      "Take water.",
      "Stay on the trail.",
    ]);
  });

  it("does not split a decimal number", () => {
    // 3.5 and 1.000 are one token each: a period between two digits is a
    // decimal separator in both languages this app speaks.
    expect(splitSentences("Nosi 3.5 litara. To je 1.000 dinara.")).toEqual([
      "Nosi 3.5 litara.",
      "To je 1.000 dinara.",
    ]);
  });

  it("does not split after a Serbian abbreviation", () => {
    expect(splitSentences("Uzmi lekove, npr. tablete. Odmori se.")).toEqual([
      "Uzmi lekove, npr. tablete.",
      "Odmori se.",
    ]);
    expect(splitSentences("Vidi str. 12 za detalje. Tu pi\u0161e sve.")).toEqual([
      "Vidi str. 12 za detalje.",
      "Tu pi\u0161e sve.",
    ]);
  });

  it("does not split after an English abbreviation or an initial", () => {
    expect(splitSentences("Bring water, e.g. two bottles. Then rest.")).toEqual([
      "Bring water, e.g. two bottles.",
      "Then rest.",
    ]);
    expect(splitSentences("J. Smith wrote it. Read it tonight.")).toEqual([
      "J. Smith wrote it.",
      "Read it tonight.",
    ]);
  });

  it("keeps a run of terminators with the sentence it ends", () => {
    expect(splitSentences("Stvarno?! Ne mogu da verujem\u2026 Idemo dalje.")).toEqual([
      "Stvarno?!",
      "Ne mogu da verujem\u2026",
      "Idemo dalje.",
    ]);
  });

  it("treats a newline as a break even with no terminator", () => {
    expect(splitSentences("Prva stavka\nDruga stavka\n\nTre\u0107a")).toEqual([
      "Prva stavka",
      "Druga stavka",
      "Tre\u0107a",
    ]);
  });

  it("collapses the whitespace inside one sentence", () => {
    // A newline is a break (the test below); SPACES and tabs inside a sentence
    // are not, because they are how a generated answer is wrapped for a screen.
    expect(splitSentences("Ovo je   jedna\tre\u010denica.")).toEqual(["Ovo je jedna re\u010denica."]);
  });

  it("does not split a token that merely contains a period", () => {
    expect(splitSentences("Otvori nexus.app pa probaj. Radi.")).toEqual([
      "Otvori nexus.app pa probaj.",
      "Radi.",
    ]);
  });

  it("cuts an over-long sentence at a comma or a space, never inside a word", () => {
    const text = `${"a".repeat(30)}, ${"b".repeat(30)} ${"c".repeat(30)}.`;
    const parts = splitSentences(text, 40);
    // The comma cut keeps the comma and drops the space after it; the space cut
    // then has to happen too, because 30 + 1 + 30 is 61 characters.
    expect(parts).toEqual([`${"a".repeat(30)},`, "b".repeat(30), `${"c".repeat(30)}.`]);
    expect(parts.every((part) => part.length <= 40)).toBe(true);
  });

  it("hard-cuts a run with no separator at all", () => {
    expect(splitSentences("x".repeat(5), 2)).toEqual(["xx", "xx", "x"]);
  });

  it("returns nothing for whitespace alone", () => {
    expect(splitSentences("  \n\t ")).toEqual([]);
  });

  it("refuses a budget that is not a positive whole number", () => {
    expect(() => splitSentences("a.", 0)).toThrow(RangeError);
    expect(() => splitSentences("a.", 1.5)).toThrow(RangeError);
  });
});
