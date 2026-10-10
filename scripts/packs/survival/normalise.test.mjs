import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertFurnitureOnly,
  collapse,
  foldBulletGlyph,
  foldControlCharacters,
  foldLetterSpacing,
  foldLigatures,
  isFurniture,
  joinHyphenated,
  normalisePage,
  slugify,
} from "./normalise.mjs";

/**
 * The normaliser, tested rule by rule.
 *
 * Every expectation here is a HAND CALCULATION from what the sources print or
 * from what the extraction is documented to hand over â€” never "a string came
 * back". The page fixture is a real page of ATP 3-50.21 (see
 * `fixtures/README.md`), so the marginal cases are the source's own.
 */

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const page = JSON.parse(readFileSync(`${FIXTURES}/atp-3-50-21-p24.json`, "utf8"));
const VOCABULARY = ["ATP 3-50.21", "SEPTEMBER 2018", "6HSWHPEHU", "2018"];

const normalised = normalisePage(
  { index: page.page, width: page.width, height: page.height, items: page.items },
  { vocabulary: VOCABULARY },
);

describe("R1 glyphs that are not the characters a reader sees", () => {
  it("expands the ligature glyphs to the letters they draw", () => {
    // U+FB01 is the `fi` ligature, U+FB02 `fl`, U+FB00 `ff`, U+FB05 `st`.
    expect(foldLigatures("\uFB01nished \uFB02ow o\uFB03ce \uFB06itch")).toBe("finished flow office stitch");
    // A non-breaking space is whitespace and not a character of its own.
    expect(foldLigatures("10\u00A0minutes")).toBe("10 minutes");
    // Ordinary punctuation is what the source PRINTS and stays as it is.
    expect(foldLigatures("man\u2019s â€” 1\u20132")).toBe("man\u2019s â€” 1\u20132");
  });

  it("reads the Symbol font's bullet, which comes back as a lone `z`", () => {
    expect(foldBulletGlyph("z Look for the chest to rise and fall.")).toEqual({
      text: "Look for the chest to rise and fall.",
      bullet: true,
    });
    expect(foldBulletGlyph("zebra crossing")).toEqual({ text: "zebra crossing", bullet: false });
    expect(foldBulletGlyph("Position the tube")).toEqual({ text: "Position the tube", bullet: false });
  });

  it("takes the control characters of a broken font for the spaces they are", () => {
    // Measured on page 2-6: the footer's spacer glyphs arrive as U+0003, U+0014
    // and U+001B, which no reader sees and no rule can match.
    expect(foldControlCharacters("2-6 ATP 3-50.21 \u0014\u001B\u00036HSWHPEHU")).toBe("2-6 ATP 3-50.21    6HSWHPEHU");
  });
});

describe("R2 letter-spaced headings", () => {
  it("collapses a heading the source sets with tracking", () => {
    expect(foldLetterSpacing("F O O D  P R O C U R E M E N T")).toBe("FOOD PROCUREMENT");
    expect(foldLetterSpacing("T H E  C A U S E")).toBe("THE CAUSE");
    expect(foldLetterSpacing("S U R V I V A L")).toBe("SURVIVAL");
  });

  it("leaves a word and a sentence alone", () => {
    expect(foldLetterSpacing("Description: The spring growth of this plant")).toBe(
      "Description: The spring growth of this plant",
    );
    expect(foldLetterSpacing("Asparagus officinalis")).toBe("Asparagus officinalis");
    // Two single letters are not a spaced-out heading: they are a sentence the
    // compositor stretched to justify a line.
    expect(foldLetterSpacing("I n the spring")).toBe("I n the spring");
  });
});

describe("R3 running heads and page numbers", () => {
  it("reads a footer as the composition it is, not as one token", () => {
    // The page's own footer: label, publication number, and the cover date as
    // the broken font extracts it.
    expect(isFurniture("2-6 ATP 3-50.21    6HSWHPEHU", VOCABULARY)).toBe(true);
    expect(isFurniture("ATP 3-50.21", VOCABULARY)).toBe(true);
    expect(isFurniture("2-6", VOCABULARY)).toBe(true);
    expect(isFurniture("Glossary-1", VOCABULARY)).toBe(true);
    // Prose is not furniture, whatever it contains.
    expect(isFurniture("2-6 miles of coast and a way to the north", VOCABULARY)).toBe(false);
  });

  it("reads FEMA's running head from the title at either end", () => {
    const title = "Are You Ready?";
    expect(isFurniture("Are You Ready? Floods", [], title)).toBe(true);
    expect(isFurniture("1.3 Assemble a Disaster Supplies Kit Are You Ready?", [], title)).toBe(true);
    expect(isFurniture("Are You Ready?", [], title)).toBe(true);
    expect(isFurniture("Floods are one of the most common hazards in the United States.", [], title)).toBe(false);
  });

  it("drops exactly the furniture of the fixture page and keeps the text", () => {
    expect(normalised.dropped.map((line) => line.text)).toEqual(["Chapter 2", "2-6 ATP 3-50.21 6HSWHPEHU"]);
    expect(normalised.label).toBe("2-6");
    // The first line a reader meets on the page is the figure's caption.
    expect(normalised.lines[0].text).toBe("Figure 2-1. Jaw Thrust Method");
    expect(normalised.lines[0].size).toBeCloseTo(11.04, 1);
    // Eight bullets of the two lists on that page came back as bullets.
    expect(normalised.lines.filter((line) => line.bullet).length).toBe(8);
    expect(normalised.lines.find((line) => line.bullet).text).toBe("Look for the chest to rise and fall.");
  });

  it("refuses to drop a line that reads like prose unless the source names it", () => {
    const prose = [{ text: "There is danger of the victim vomiting during mouth-to-mouth resuscitation.", rule: "running-head" }];
    expect(() => assertFurnitureOnly(prose, "atp-4-02-11")).toThrow(/reads like prose/);
    const named = [{ text: "First Aid Case and Kits, Authorized Medical Allowance List", rule: "running-head" }];
    expect(() =>
      assertFurnitureOnly(named, "atp-4-02-11", ["First Aid Case and Kits, Authorized Medical Allowance List"]),
    ).not.toThrow();
  });
});

describe("R4 a word broken at a line end", () => {
  it("puts the word back together", () => {
    expect(joinHyphenated("contamina- tion and promote healing")).toBe("contamination and promote healing");
    expect(joinHyphenated("ground- water")).toBe("groundwater");
  });

  it("leaves a real hyphen alone", () => {
    // A capital after the hyphen is a compound the source prints (`Mid-Atlantic`),
    // and a digit is a range (`3-12`).
    expect(joinHyphenated("Mid- Atlantic")).toBe("Mid- Atlantic");
    expect(joinHyphenated("page 3- 12")).toBe("page 3- 12");
  });
});

describe("ids and whitespace", () => {
  it("makes a kebab-case id out of a heading", () => {
    expect(slugify("Asparagus officinalis")).toBe("asparagus-officinalis");
    expect(slugify("Mole viper or burrowing viper")).toBe("mole-viper-or-burrowing-viper");
    expect(slugify("Russell's viper")).toBe("russells-viper");
    expect(slugify("Gila monster (Heloderma suspectum)")).toBe("gila-monster-heloderma-suspectum");
  });

  it("collapses whitespace the one way both sides of the fidelity test use it", () => {
    expect(collapse("  a\n\nb \t c  ")).toBe("a b c");
  });
});
