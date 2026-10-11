// The pack's shape: the source table, the table of contents, the article text
// this builder wraps around a document, and the two metadata files.
//
// WHAT THESE TESTS CAN SEE THAT THE BUILD CANNOT. The build proves that the
// documents it fetched were converted faithfully; it says nothing about whether
// a source entry has lost its licence evidence, whether two documents ended up
// with one id, or whether the metadata it writes is the metadata the signing
// tool accepts. All four are properties of a table, and all four are checked
// here — the metadata one by calling `pack-sign.mjs`'s own `checkMeta`, so a
// field this builder invents is refused by the tool that will sign it rather
// than by the app after the release key has been used.

import { describe, expect, it } from "vitest";

import {
  AUTHENTICITY_NOTE,
  articleId,
  contentJson,
  formatSerbianDate,
  packMetadata,
  provenanceBlock,
  renderArticle,
  sourceLine,
  sourcesJson,
  uniqueArticleId,
} from "./lib/pack.mjs";
import { PACKS } from "./sources.mjs";
// The signing tool's own completeness check: this pack's metadata must be a
// metadata that tool is willing to sign.
import { checkMeta } from "../../pack-sign.mjs";

const PACK_IDS = Object.keys(PACKS);

describe("the source table", () => {
  it("describes two packs, English and Serbian", () => {
    expect(PACK_IDS).toEqual(["reference-en", "reference-sr"]);
    expect(PACKS["reference-en"].language).toBe("en");
    expect(PACKS["reference-sr"].language).toBe("sr");
  });

  for (const id of PACK_IDS) {
    const pack = PACKS[id];

    it(`${id}: every document has a unique kebab-case id and a licence with evidence`, () => {
      const ids = pack.documents.map((document) => document.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const document of pack.documents) {
        expect(document.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(document.url).toMatch(/^https:\/\//);
        expect(typeof document.title).toBe("string");
        expect(document.title.length).toBeGreaterThan(0);
        expect(document.licence.evidence.length).toBeGreaterThan(0);
        for (const evidence of document.licence.evidence) {
          expect(evidence.url).toMatch(/^https:\/\//);
          // The quote is the evidence: an empty or one-word quote names a
          // licence without showing it.
          expect(evidence.quote.trim().length).toBeGreaterThan(30);
        }
      }
    });

    it(`${id}: carries both languages of copy, and metadata the signing tool accepts`, () => {
      expect(pack.title.sr.length).toBeGreaterThan(0);
      expect(pack.title.en.length).toBeGreaterThan(0);
      expect(pack.description.sr.length).toBeGreaterThan(0);
      expect(pack.description.en.length).toBeGreaterThan(0);
      expect(pack.title.sr.length).toBeLessThanOrEqual(200);
      expect(pack.description.sr.length).toBeLessThanOrEqual(4000);
      const metadata = packMetadata(pack);
      expect(Object.keys(metadata)).toEqual([
        "format", "id", "version", "kind", "title", "description", "licence", "source", "minAppVersion",
      ]);
      expect(metadata.kind).toBe("content");
      expect(() => checkMeta(metadata)).not.toThrow();
    });
  }
});

describe("article ids", () => {
  it("numbers a document by its place in the reading order", () => {
    const pack = PACKS["reference-en"];
    expect(articleId(0, pack.documents[0], "anything", 1)).toBe("01-us-declaration-of-independence");
    expect(articleId(5, pack.documents[5], "anything", 1)).toBe("06-iccpr");
  });

  it("adds the section's slug when a document is printed in parts", () => {
    const pack = PACKS["reference-en"];
    const teu = pack.documents.findIndex((document) => document.id === "eu-teu");
    expect(articleId(teu, pack.documents[teu], "TITLE I COMMON PROVISIONS", 49))
      .toBe("11-eu-teu-title-i-common-provisions");
  });

  it("gives two sections of the same name two ids", () => {
    const used = new Set();
    expect(uniqueArticleId("12-eu-tfeu-chapter-1-general-provisions", used)).toBe("12-eu-tfeu-chapter-1-general-provisions");
    expect(uniqueArticleId("12-eu-tfeu-chapter-1-general-provisions", used)).toBe("12-eu-tfeu-chapter-1-general-provisions-2");
    expect(uniqueArticleId("12-eu-tfeu-chapter-1-general-provisions", used)).toBe("12-eu-tfeu-chapter-1-general-provisions-3");
    expect(used.size).toBe(3);
  });
});

describe("the text a pack wraps around a document", () => {
  const law = {
    id: "zakon",
    title: "\u0417\u0430\u043a\u043e\u043d \u043e \u0440\u0430\u0434\u0443",
    section: "\u0421\u043b. \u0433\u043b\u0430\u0441\u043d\u0438\u043a \u0420\u0421 24/2005",
    url: "https://example.invalid/zakon-o-radu.pdf",
    licence: { spdx: "x", name: "x", url: "https://example.invalid/", evidence: [{ url: "https://example.invalid/", quote: "x".repeat(40) }] },
    gazette: { numbers: ["\u201e\u0421\u043b. \u0433\u043b\u0430\u0441\u043d\u0438\u043a \u0420\u0421\u201d \u0431\u0440. 24/2005"] },
  };

  it("puts the three lines a Serbian official text must carry at the top", () => {
    expect(provenanceBlock(law, "2026-10-10")).toBe([
      "> Proveri izmene i dopune u Slu\u017ebenom glasniku.",
      "> Stanje na dan 10. 10. 2026.",
      "> Obuhva\u0107eni brojevi: \u201e\u0421\u043b. \u0433\u043b\u0430\u0441\u043d\u0438\u043a \u0420\u0421\u201d \u0431\u0440. 24/2005.",
    ].join("\n"));
  });

  it("writes a date the way Serbian does", () => {
    expect(formatSerbianDate("2026-10-10")).toBe("10. 10. 2026");
    expect(formatSerbianDate("2011-04-04")).toBe("4. 4. 2011");
  });

  it("states the source, and states the EU caveat only for EU documents", () => {
    const pack = PACKS["reference-sr"];
    expect(sourceLine(pack, law, law.section)).toBe(`*Izvor: ${law.title} \u2014 ${law.section}. ${law.url}*`);
    const eu = PACKS["reference-en"].documents.find((document) => document.id === "eu-tfeu");
    const english = PACKS["reference-en"];
    expect(sourceLine(english, eu, "PART ONE PRINCIPLES").startsWith("*Source: Consolidated version")).toBe(true);
    expect(sourceLine(english, eu, "PART ONE PRINCIPLES")).toContain("https://eur-lex.europa.eu");
    expect(AUTHENTICITY_NOTE.startsWith("> Only the Official Journal of the European Union is authentic.")).toBe(true);
  });

  it("keeps the generated lines out of the body the fidelity check compares", () => {
    const pack = PACKS["reference-sr"];
    const article = renderArticle(pack, law, { title: "Deo prvi", markdown: "Prva re\u010denica." }, "2026-10-10");
    expect(article.body).toBe("Prva re\u010denica.");
    expect(article.text.startsWith("> Proveri izmene i dopune u Slu\u017ebenom glasniku.\n> Stanje na dan")).toBe(true);
    expect(article.text.endsWith(`${article.source}\n`)).toBe(true);
    expect(article.text).toContain(`\n\n${article.body}\n\n`);
  });

  it("leaves the caveat out of a document that is not EU law", () => {
    const pack = PACKS["reference-en"];
    const plain = { ...law, gazette: undefined, authenticity: undefined };
    const article = renderArticle(pack, plain, { title: "Article 1", markdown: "Text." }, "2026-10-10");
    expect(article.text).not.toContain("Only the Official Journal");
    expect(article.text.split("\n\n")[0]).toBe("Text.");
  });
});

describe("the files a build writes", () => {
  it("contents.json carries the layout, the language and the tree, and nothing else", () => {
    const toc = [{ id: "01-x", title: "X", file: "articles/01-x.md", source: { title: "X", url: "https://example.invalid/" } }];
    const content = contentJson(PACKS["reference-en"], toc);
    expect(Object.keys(content)).toEqual(["layout", "language", "toc"]);
    expect(content.layout).toBe(1);
    expect(content.language).toBe("en");
    expect(content.toc).toEqual(toc);
  });

  it("sources.json names the bytes, the day, the digest and the evidence", () => {
    const pack = PACKS["reference-en"];
    const fetches = new Map(pack.documents.map((document, index) => [document.id, {
      bytes: Buffer.from(`body ${String(index)}`),
      sha256: `${String(index)}`.padStart(64, "0"),
      fetched: "2026-10-10",
      url: document.url,
    }]));
    const sources = sourcesJson(pack, fetches);
    expect(sources.documents).toHaveLength(pack.documents.length);
    const charter = sources.documents.find((entry) => entry.id === "un-charter");
    expect(charter.url).toBe("https://www.un.org/en/about-us/un-charter/full-text");
    expect(charter.fetched).toBe("2026-10-10");
    // un-charter is the fourth document in the table, so the digest the map
    // handed the writer is the one that comes back out.
    expect(charter.sha256).toBe("0".repeat(63) + "3");
    expect(charter.bytes).toBe("body 3".length);
    expect(charter.licence.evidence[0].quote).toContain("left in the public domain");
    // The caveat and the re-use basis for an EU document travel with it.
    const tfeu = sources.documents.find((entry) => entry.id === "eu-tfeu");
    expect(tfeu.canonical).toBe("https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:12016E/TXT");
    expect(tfeu.licence.spdx).toBe("CC-BY-4.0");
  });
});
