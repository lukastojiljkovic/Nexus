import { describe, expect, it } from "vitest";

import {
  articlesForScope,
  buildReaderToc,
  neighbouringArticles,
  readerDisplayName,
  readerReadingOrder,
  type ReaderArticleEntry,
} from "./toc.js";

/**
 * The Reader's table of contents (ADR-100).
 *
 * The entries below are deliberately handed in SHUFFLED: the tree sorts, so the
 * expected values are the order a reader sees rather than the order the pack's
 * files happened to be listed in. `10-dodatak.md` against `2-...` is the case
 * that catches a string sort (where "10" precedes "2"), and the unprefixed
 * article is the case that says what happens to a pack that numbered only part
 * of itself.
 */

const ENTRIES: readonly ReaderArticleEntry[] = [
  { path: "10-dodatak.md", title: "Dodatak" },
  { path: "2-prva-pomoc/opekotine.md", title: "Opekotine" },
  { path: "2-prva-pomoc/krvarenje.md", title: "Krvarenje" },
  { path: "uvod.md", title: "Uvod" },
  { path: "1-zakoni/ustav.md", title: "Ustav" },
];

/**
 * "Suma" with the Serbian S on the front, written as an escape because this file
 * is otherwise plain ASCII and the character is the point: the collator's
 * tailoring is what puts it after "Sneg", and a test that typed a mojibake S
 * instead would pass while proving nothing about the collator.
 */
const SUMA = "\u0160uma";

describe("buildReaderToc", () => {
  it("builds chapters from the folders and articles from the files, numbering first", () => {
    expect(buildReaderToc(ENTRIES)).toEqual([
      {
        kind: "chapter",
        id: "1-zakoni/",
        title: "Zakoni",
        children: [{ kind: "article", id: "1-zakoni/ustav.md", title: "Ustav", children: [] }],
      },
      {
        kind: "chapter",
        id: "2-prva-pomoc/",
        title: "Prva pomoc",
        children: [
          { kind: "article", id: "2-prva-pomoc/krvarenje.md", title: "Krvarenje", children: [] },
          { kind: "article", id: "2-prva-pomoc/opekotine.md", title: "Opekotine", children: [] },
        ],
      },
      { kind: "article", id: "10-dodatak.md", title: "Dodatak", children: [] },
      { kind: "article", id: "uvod.md", title: "Uvod", children: [] },
    ]);
  });

  it("sorts unnumbered articles after every numbered one, by the Serbian collator", () => {
    const toc = buildReaderToc([
      { path: "suma.md", title: SUMA },
      { path: "sneg.md", title: "Sneg" },
      { path: "cvet.md", title: "Cvet" },
    ]);
    // SUMA after "Sneg" is the collator's own answer (`sr-Latn`, not `sr`), and
    // it is why this module does not sort by code unit.
    expect(toc.map((node) => node.title)).toEqual(["Cvet", "Sneg", SUMA]);
  });

  it("keeps a chapter and an article of the same name apart", () => {
    const toc = buildReaderToc([
      { path: "temA/uvod.md", title: "Uvod" },
      { path: "temA.md", title: "Tema" },
    ]);
    expect(toc.map((node) => node.id).sort()).toEqual(["temA.md", "temA/"]);
  });

  it("answers an empty tree for no articles rather than a nameless chapter", () => {
    expect(buildReaderToc([])).toEqual([]);
  });
});

describe("readerDisplayName", () => {
  it("reads the order prefix, strips it, and turns separators into spaces", () => {
    expect(readerDisplayName("03-prva_pomoc")).toEqual({
      order: 3,
      collated: "03-prva_pomoc",
      name: "Prva pomoc",
    });
    expect(readerDisplayName("uvod")).toEqual({ order: Number.POSITIVE_INFINITY, collated: "uvod", name: "Uvod" });
  });
});

describe("the reading order and its neighbours", () => {
  const order = readerReadingOrder(buildReaderToc(ENTRIES));

  it("walks the tree depth first, so a chapter's pages come before the next chapter", () => {
    expect(order).toEqual([
      "1-zakoni/ustav.md",
      "2-prva-pomoc/krvarenje.md",
      "2-prva-pomoc/opekotine.md",
      "10-dodatak.md",
      "uvod.md",
    ]);
  });

  it("answers the article either side, and null at the ends", () => {
    expect(neighbouringArticles(order, "2-prva-pomoc/krvarenje.md")).toEqual({
      previous: "1-zakoni/ustav.md",
      next: "2-prva-pomoc/opekotine.md",
    });
    expect(neighbouringArticles(order, "1-zakoni/ustav.md").previous).toBeNull();
    expect(neighbouringArticles(order, "uvod.md").next).toBeNull();
    expect(neighbouringArticles(order, "nema.md")).toEqual({ previous: null, next: null });
  });
});

describe("articlesForScope", () => {
  const toc = buildReaderToc(ENTRIES);

  it("answers the whole pack for no scope, a chapter for a chapter and one article for a leaf", () => {
    expect(articlesForScope(toc, null)).toEqual(readerReadingOrder(toc));
    expect(articlesForScope(toc, "2-prva-pomoc/")).toEqual([
      "2-prva-pomoc/krvarenje.md",
      "2-prva-pomoc/opekotine.md",
    ]);
    expect(articlesForScope(toc, "uvod.md")).toEqual(["uvod.md"]);
  });

  it("answers nothing for a node the pack does not have", () => {
    expect(articlesForScope(toc, "nema/")).toEqual([]);
  });
});
