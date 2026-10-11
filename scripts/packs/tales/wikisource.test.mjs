import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { normalise, stripMarkup } from "./markdown.mjs";
import {
  contentRegion,
  convertPage,
  licenceNotice,
  regionText,
  regionToMarkdown,
  sourceSection,
  textOf,
} from "./wikisource.mjs";

/**
 * The Wikisource half of the pack builder.
 *
 * Two fixtures, both cut from the pages this pack is built from and both
 * carrying their own licence: the whole parser output of the shortest tale in
 * Vuk's 1870 edition („Ко је то? – Никола!", 3 899 bytes), and a contiguous
 * slice of a longer one around the markup that broke the converter twice — an
 * `<i>` that ends after a space, and a `<br />` between two sentences.
 *
 * The oracle is the wiki's own rendering with the tags taken off, so these
 * tests ask the question the pack's fidelity test asks: is what the converter
 * wrote the page's text, and not something adjacent to it.
 */

const PAGE = readFileSync(new URL("./fixtures/wikisource-page.html", import.meta.url), "utf8");
const SLICE = readFileSync(new URL("./fixtures/wikisource-poem-slice.html", import.meta.url), "utf8");

describe("cutting the wiki's apparatus off a page", () => {
  it("stops at the Извор heading, so the licence box and the notes stay out", () => {
    const region = contentRegion(PAGE);
    expect(region).toContain("Једнога сељанина врло почне прогонити брат");
    expect(region).not.toContain("Извор");
    expect(region).not.toContain("боilerplate");
    expect(region).not.toContain("јавном власништву");
  });

  it("reads the printed source out of the Извор section", () => {
    expect(sourceSection(PAGE)).toBe(
      "Караџић, В. С. 1870. Српске народне приповијетке, друго умножено издање. Беч, у наклади Ане, удовице В.С. Караџића. стр. 278–279.",
    );
  });

  it("keeps the licence box's own words for sources.json", () => {
    expect(licenceNotice(PAGE)).toContain(
      "Овај текст је у јавном власништву у Србији, Сједињеним државама и свим осталим земљама са периодом заштите ауторских права од живота аутора плус 70 година јер је његов аутор, Вук Стефановић Караџић, умро 1864",
    );
  });

  it("takes tags off the oracle and leaves the words", () => {
    expect(textOf("<p>a &amp; b</p><br/><i>c</i>")).toBe("a & b c");
  });
});

describe("converting a page", () => {
  const page = convertPage({ html: PAGE, title: "Ко је то? – Никола!" });

  it("is the page's text, with the markup off, and nothing else", () => {
    expect(normalise(stripMarkup(page.markdown))).toBe(normalise(page.oracle));
    expect(page.markdown).not.toMatch(/<[a-zA-Z/]/);
  });

  it("keeps an italics span's trailing space, which two sentences depend on", () => {
    // The long tale's HTML has „…пита слугу: </i>Јесу ли долазиле?<i> А слуга…",
    // and trimming inside the wrapper ran the words together.
    const slice = convertPage({ html: SLICE, title: "slice" });
    expect(normalise(stripMarkup(slice.markdown))).toBe(normalise(slice.oracle));
    expect(slice.markdown).toContain("*Видиш овај мешчић; кад изиђете на језеро");
    // And a `<br />` becomes a markdown hard break, so the reader keeps the
    // line the wiki showed where the tale changes speaker.
    expect(slice.markdown).toContain("  \n");
  });

  it("refuses an element it does not know rather than dropping what is inside it", () => {
    const tampered = PAGE.replace("<div class=\"poem\">", "<marquee class=\"poem\">");
    expect(() => convertPage({ html: tampered, title: "x" })).toThrow(/<marquee>/);
  });

  it("refuses a page that converts to nothing at all", () => {
    expect(() => convertPage({ html: "<div></div>", title: "empty" })).toThrow(/converted to nothing/);
  });
});

describe("the oracle", () => {
  it("puts a space where a block ended, so a list and a paragraph compare", () => {
    const html = "<p>one</p><ul><li>two</li></ul>";
    expect(normalise(regionText(html))).toBe("one two");
    expect(normalise(stripMarkup(regionToMarkdown(html)))).toBe("one two");
  });
});
