import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertArticleFidelity,
  foldGutenbergMarkup,
  gutenbergSourceText,
  parseBook,
  readContents,
  splitBook,
  stripGutenbergWrapper,
  titleKey,
  toMarkdown,
} from "./gutenberg.mjs";
import { normalise, stripMarkup } from "./markdown.mjs";

/**
 * The Gutenberg half of the pack builder.
 *
 * The fixture is the first 240 lines of ebook #1597 as the mirror serves it,
 * with the ebook's own end marker appended so the wrapper is complete: two
 * tales of the eighteen, the second cut off by the slice, which is the point of
 * a fixture — every expected value below was read off this file, not chosen.
 *
 * The numbered-list and re-alignment rules are exercised on the SHAPE those
 * rules were written for, in miniature, because the real books that need them
 * (5314's 212 numbered entries, 27200's typo) are far too large to carry as
 * fixtures. The miniature keeps the measured property and nothing else: a
 * numbered list whose headings are worded differently, and a contents entry
 * whose title is mistyped where the heading is not.
 */

const FIXTURE = new URL("./fixtures/gutenberg-1597-slice.txt", import.meta.url);

describe("the Gutenberg wrapper", () => {
  it("cuts everything outside the two markers", () => {
    const body = stripGutenbergWrapper("*** START OF THE PROJECT GUTENBERG EBOOK 1 ***\ntext\n*** END OF THE PROJECT GUTENBERG EBOOK 1 ***\nlicence");
    // The cut is by LINES, so the markers take their own line endings with them.
    expect(body).toBe("text");
  });

  it("refuses a file it cannot find the markers in, rather than guessing", () => {
    expect(() => stripGutenbergWrapper("just a book")).toThrow(/no Gutenberg start marker/);
    expect(() => stripGutenbergWrapper("*** START OF THE PROJECT GUTENBERG EBOOK 1 ***\ntext")).toThrow(/no Gutenberg end marker/);
  });
});

describe("the emphasis convention", () => {
  it("marks an underscore pair for the converter and removes it for the oracle", () => {
    const text = "she spent _much_ more";
    expect(foldGutenbergMarkup(text)).toBe("she spent \u0001much\u0002 more");
    expect(gutenbergSourceText(text)).toBe("she spent much more");
  });

  it("leaves a lone underscore and the book's own asterisks alone", () => {
    expect(gutenbergSourceText("151* The Twelve Idle Servants")).toBe("151* The Twelve Idle Servants");
    expect(gutenbergSourceText("a_b")).toBe("a_b");
  });
});

describe("splitting the fixture", () => {
  const text = readFileSync(FIXTURE, "utf8");
  const parsed = parseBook(text, { id: "fixture" });

  it("finds the two tales the slice contains, in the book's order", () => {
    expect(parsed.articles.map((article) => article.title)).toEqual(["THE EMPEROR'S NEW CLOTHES", "THE SWINEHERD"]);
  });

  it("reports the sixteen entries whose tales the slice cuts off", () => {
    expect(parsed.unmatched).toEqual([
      "The Real Princess",
      "The Shoes of Fortune",
      "The Fir Tree",
      "The Snow Queen",
      "The Leap-Frog",
      "The Elderbush",
      "The Bell",
      "The Old House",
      "The Happy Family",
      "The Story of a Mother",
      "The False Collar",
      "The Shadow",
      "The Little Match Girl",
      "The Dream of Little Tuk",
      "The Naughty Boy",
      "The Red Shoes",
    ]);
  });

  it("opens every article with its title and carries no raw HTML", () => {
    for (const article of parsed.articles) {
      expect(article.markdown.startsWith(`# ${article.title}\n`)).toBe(true);
      expect(article.markdown).not.toMatch(/<[a-zA-Z/]/);
    }
  });

  it("read as the source's text, once the markup is off", () => {
    // The assertion `parseBook` makes for every article it produces, made here
    // again on the first one so the test says what the guarantee is.
    const body = parsed.articles[0].markdown;
    const source = text.slice(text.indexOf("THE EMPEROR'S NEW CLOTHES"), text.indexOf("THE SWINEHERD") - 1).trim();
    expect(normalise(stripMarkup(body))).toBe(normalise(gutenbergSourceText(source)));
  });

  it("fails the fidelity check if a word is dropped from an article", () => {
    const article = { title: "T", text: "T\n\none two three four\n" };
    expect(() => assertArticleFidelity(toMarkdown(article), article.text, "T")).not.toThrow();
    const tampered = toMarkdown(article).replace("three", "");
    expect(() => assertArticleFidelity(tampered, article.text, "T")).toThrow(/fidelity check failed/);
  });
});

describe("matching a contents list to the body", () => {
  it("prefers the edition's numbers when both sides have them", () => {
    // The shape of 5314: the list says „young kids", the heading says „little
    // kids", and only the numbers agree.
    const lines = [
      "CONTENTS",
      " 1 The Wolf and the Seven Young Kids (Der Wolf und die sieben jungen Geißlein)",
      "",
      "1 The Wolf and the Seven Little Kids",
      "",
      "In old times",
    ];
    const { entries, unmatched } = readContents(lines, 0);
    expect(unmatched).toEqual([]);
    expect(entries.map((entry) => entry.title)).toEqual(["1 The Wolf and the Seven Little Kids"]);
  });

  it("repairs one mistyped entry from the heading it must be", () => {
    // The shape of 27200, where „The Dumb Cook" is the list's typo for „THE
    // DUMB BOOK" and an internal title sits between the two neighbours.
    const lines = [
      "CONTENTS",
      " Jack the Dullard",
      " The Dumb Cook",
      " The Elf of the Rose",
      "",
      "JACK THE DULLARD",
      "",
      "Far in the interior of the country lay an old baronial hall.",
      "",
      "AN OLD STORY TOLD ANEW",
      "",
      "There was once a man.",
      "",
      "THE DUMB BOOK",
      "",
      "Far away in the country there lived an old man.",
      "",
      "THE ELF OF THE ROSE",
      "",
      "In the midst of a garden grew a rose-tree.",
    ];
    const { entries, unmatched } = readContents(lines, 0);
    expect(unmatched).toEqual([]);
    expect(entries.map((entry) => entry.title)).toEqual(["JACK THE DULLARD", "THE DUMB BOOK", "THE ELF OF THE ROSE"]);
  });

  it("refuses a book whose contents match nothing at all", () => {
    expect(() => splitBook("CONTENTS\n A Tale\n\nno headings here\n")).toThrow(/no contents entry matched/);
  });

  it("refuses to let a tale swallow the title of one that matched nothing", () => {
    // The failure this guard exists for: an entry that cannot be matched and a
    // list that is declared ended leave the rest of the book inside the last
    // article, and only the heading inside it gives that away.
    const lines = [
      "CONTENTS",
      " Alpha",
      " Beta",
      " Gamma",
      "",
      "ALPHA",
      "",
      "one.",
      "",
      "GAMMA",
      "",
      "two.",
      "",
      "BETA",
      "",
      "three.",
    ];
    expect(() => splitBook(lines.join("\n"))).toThrow(/the split is wrong/);
  });
});

describe("title keys", () => {
  it("fold case, punctuation, numbering and a bracketed German title", () => {
    expect(titleKey(" 8 The Strange Musician (Der wunderliche Spielmann)")).toBe("the strange musician");
    expect(titleKey("200 The Golden Key")).toBe("the golden key");
    expect(titleKey("Legend 3 The Rose (Die Rose)")).toBe("the rose");
  });
});
