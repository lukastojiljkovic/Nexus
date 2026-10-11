import { describe, expect, it } from "vitest";

import { splitParagraphs, splitSentences } from "./split.js";

/**
 * The sentence splitter's exact splits, for the two languages this module
 * translates between. Every case below is a shape the reader of a Serbian or
 * English text will meet: an ordinary pair of sentences, an abbreviation with a
 * dot inside it, an initial, a decimal, a quotation, a numbered list and a
 * paragraph break. The expected arrays are written out rather than counted, so a
 * rule that starts cutting in the wrong place fails here by name.
 */

describe("splitSentences", () => {
  it("splits two plain sentences and keeps each mark with its own sentence", () => {
    expect(splitSentences("Dobar dan. Kako ste?")).toEqual(["Dobar dan.", "Kako ste?"]);
    expect(splitSentences("The train left at seven. It arrived on time!")).toEqual([
      "The train left at seven.",
      "It arrived on time!",
    ]);
  });

  it("keeps a Serbian abbreviation with the sentence it belongs to", () => {
    expect(splitSentences("To je, npr. rekao juče. Sutra ide dalje.")).toEqual([
      "To je, npr. rekao juče.",
      "Sutra ide dalje.",
    ]);
    expect(splitSentences("Vidi str. 12 za detalje. Tamo piše sve.")).toEqual([
      "Vidi str. 12 za detalje.",
      "Tamo piše sve.",
    ]);
  });

  it("keeps an English abbreviation with the sentence it belongs to", () => {
    expect(splitSentences("Bring water, food, etc. for the trip. We leave early.")).toEqual([
      "Bring water, food, etc. for the trip.",
      "We leave early.",
    ]);
    expect(splitSentences("Mr. Smith arrived. He left at noon.")).toEqual([
      "Mr. Smith arrived.",
      "He left at noon.",
    ]);
    expect(splitSentences("Use e.g. a ruler. Then measure again.")).toEqual([
      "Use e.g. a ruler.",
      "Then measure again.",
    ]);
  });

  it("keeps an initial with the following surname", () => {
    expect(splitSentences("Pisao je J. Petroviću. Odgovor nije stigao.")).toEqual([
      "Pisao je J. Petroviću.",
      "Odgovor nije stigao.",
    ]);
  });

  it("does not cut a decimal or a date", () => {
    expect(splitSentences("Uzeo je 3.14 kao vrednost. Zatim je otišao.")).toEqual([
      "Uzeo je 3.14 kao vrednost.",
      "Zatim je otišao.",
    ]);
    expect(splitSentences("Datum je 1.5.2026. i to je sve.")).toEqual([
      "Datum je 1.5.2026. i to je sve.",
    ]);
  });

  it("does not cut when the mark introduces a lower-case continuation", () => {
    expect(splitSentences("Govorio je o 15. veku i stao.")).toEqual([
      "Govorio je o 15. veku i stao.",
    ]);
  });

  it("closes a quotation with the sentence it ends", () => {
    expect(splitSentences("Rekao je: „Idem kući.“ Zatim je otišao.")).toEqual([
      "Rekao je: „Idem kući.“",
      "Zatim je otišao.",
    ]);
    expect(splitSentences('She said "Leave now." He did.')).toEqual([
      'She said "Leave now."',
      "He did.",
    ]);
  });

  it("splits a numbered list at each item", () => {
    expect(splitSentences("1. Prva stavka. 2. Druga stavka.")).toEqual([
      "1. Prva stavka.",
      "2. Druga stavka.",
    ]);
  });

  it("treats a paragraph break as a boundary even without a mark", () => {
    expect(splitSentences("Prva rečenica.\nDruga rečenica.")).toEqual([
      "Prva rečenica.",
      "Druga rečenica.",
    ]);
  });

  it("answers one sentence for text with no terminator, and nothing for empty text", () => {
    expect(splitSentences("Samo jedna rečenica bez tačke")).toEqual([
      "Samo jedna rečenica bez tačke",
    ]);
    expect(splitSentences("   \n  ")).toEqual([]);
    expect(splitSentences("")).toEqual([]);
  });

  it("splits on an ellipsis and on a repeated mark", () => {
    expect(splitSentences("Ne znam… Možda kasnije. Ostalo je jasno.")).toEqual([
      "Ne znam…",
      "Možda kasnije.",
      "Ostalo je jasno.",
    ]);
    expect(splitSentences("Stvarno?! Nisam znao.")).toEqual(["Stvarno?!", "Nisam znao."]);
  });
});

describe("splitParagraphs", () => {
  it("keeps the paragraph break between sentence groups", () => {
    expect(splitParagraphs("Prva. Druga.\n\nTreća. Četvrta.")).toEqual([
      ["Prva.", "Druga."],
      ["Treća.", "Četvrta."],
    ]);
  });

  it("drops blank runs and paragraphs that hold no sentence", () => {
    expect(splitParagraphs("\n\nSamo jedna.\n\n\n\n  \n\nI druga.")).toEqual([
      ["Samo jedna."],
      ["I druga."],
    ]);
    expect(splitParagraphs("   \n \n  ")).toEqual([]);
  });
});
