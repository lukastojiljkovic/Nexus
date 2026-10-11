import { describe, expect, it } from "vitest";

import {
  SERBIAN_COLLATOR,
  assertFidelity,
  bySerbianTitle,
  decodeEntities,
  escapeText,
  foldToAscii,
  normalise,
  slug,
  stripMarkup,
  uniqueId,
} from "./markdown.mjs";

/**
 * The text half of the pack builder.
 *
 * The pairs below are the ones the two converters actually produce, taken from
 * the corpora rather than from the CommonMark specification: the escape set is
 * only correct if `stripMarkup(escapeText(x)) === x` for the characters the
 * books print, and the failure that motivated the parking trick — a row of
 * asterisks losing its asterisks — is a case here.
 */

describe("the escape/strip pair", () => {
  const cases = [
    "- Море, шта си ти огласио народу?",
    "  1. HOW THEY WENT TO THE MOUNTAINS TO EAT NUTS",
    "      *      *      *      *      *",
    "151* The Twelve Idle Servants",
    "Dummling,[*] and was despised",
    "a < b > c | d",
    "_my_ partner, sir",
    "\\a backslash",
    "# not a heading",
  ];

  for (const text of cases) {
    it(`survives ${JSON.stringify(text.slice(0, 24))}`, () => {
      expect(stripMarkup(escapeText(text))).toBe(text);
    });
  }

  it("keeps a line's leading hyphen as text, not as a list marker", () => {
    // 11339 prints dialogue as `- Море, шта си…`; a `-` that opened a markdown
    // list would render as a bullet and lose the character.
    expect(escapeText("- Море")).toBe("\\- Море");
  });

  it("turns markdown emphasis back into words", () => {
    expect(stripMarkup("*much* bigger")).toBe("much bigger");
    expect(stripMarkup("**1\\. Авизан на пола скапулан.**")).toBe("1. Авизан на пола скапулан.");
  });
});

describe("the comparison the fidelity test makes", () => {
  it("collapses the line breaks of a hard-wrapped book", () => {
    expect(normalise("a\n  b\r\n\nc")).toBe("a b c");
  });

  it("passes when the article is the source's text", () => {
    expect(() => assertFidelity("# T\n\none two\n", "T\n\none   two\n", "ok")).not.toThrow();
  });

  it("fails when a sentence is dropped, doubled or reworded", () => {
    const source = "T\n\none two three\n";
    expect(() => assertFidelity("# T\n\none two\n", source, "dropped")).toThrow(/fidelity check failed/);
    expect(() => assertFidelity("# T\n\none two two three\n", source, "doubled")).toThrow(/fidelity check failed/);
    expect(() => assertFidelity("# T\n\none too three\n", source, "reworded")).toThrow(/fidelity check failed/);
  });
});

describe("entities", () => {
  it("decodes the named and numeric forms the parser emits", () => {
    expect(decodeEntities("a &amp; b &#1055; &#x43E; &nbsp;c")).toBe("a & b П о \u00a0c");
  });

  it("leaves an unknown entity as written rather than inventing a character", () => {
    expect(decodeEntities("&nosuch; &;")).toBe("&nosuch; &;");
  });
});

describe("ids", () => {
  it("transliterates Serbian Cyrillic and folds the diacritics", () => {
    expect(slug("Међедовић")).toBe("medjedovic");
    expect(slug("Ђаво и његов шегрт")).toBe("djavo-i-njegov-segrt");
    expect(slug("У цара Тројана козје уши")).toBe("u-cara-trojana-kozje-usi");
    expect(slug("Чардак ни на небу ни на земљи")).toBe("cardak-ni-na-nebu-ni-na-zemlji");
  });

  it("folds Latin diacritics the way Gutenberg's titles need", () => {
    expect(foldToAscii("Žabljak")).toBe("zabljak");
    expect(slug("THE EMPEROR'S NEW CLOTHES")).toBe("the-emperor-s-new-clothes");
  });

  it("refuses a title with nothing an id can be built from", () => {
    expect(() => slug("??? — !")).toThrow(/no characters/);
  });

  it("makes a repeated id unique instead of letting it collide", () => {
    const taken = new Set();
    expect(uniqueId("pesma", taken)).toBe("pesma");
    expect(uniqueId("pesma", taken)).toBe("pesma-2");
    expect(uniqueId("pesma", taken)).toBe("pesma-3");
  });
});

describe("Serbian ordering", () => {
  it("sorts by the two scripts the packs arrive in", () => {
    const sorted = bySerbianTitle([{ title: "Аждаја и царев син" }, { title: "Баш-Челик" }, { title: "Аждаја" }]);
    expect(sorted.map((entry) => entry.title)).toEqual(["Аждаја", "Аждаја и царев син", "Баш-Челик"]);
    expect(SERBIAN_COLLATOR.compare("Čardak", "Ćuprija")).toBeLessThan(0);
  });
});
