// The fidelity check, on the three fixtures and on itself.
//
// THE RULE THE WHOLE PACK RESTS ON. A pack's text is the source's own text:
// conversion changes markup and nothing else. `fidelityDifference` states that
// as one comparison — the article's Markdown with its markup stripped and its
// whitespace normalised, against the source section's text normalised the same
// way — and `build.mjs` runs it over every article it writes.
//
// WHY A NEGATIVE CONTROL IS IN HERE. A check that cannot fail is a check that
// certifies nothing. Three of these tests damage the article on purpose and
// require the check to notice: a dropped sentence, a swapped pair of words, and
// an inserted word. The last one matters most, because it is what an AI-written
// "improvement" to a law looks like.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertFidelity, blocksToText, convertDocument, fidelityDifference, toMarkdown } from "./lib/convert.mjs";
import { PACKS } from "./sources.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => readFileSync(join(FIXTURES, name));

function convert(spec, name) {
  const { sections } = convertDocument(spec, fixture(name), { linesOfPdf: null });
  return sections.map((section) => ({
    title: section.title,
    markdown: toMarkdown(section.blocks),
    sourceText: blocksToText(section.blocks),
  }));
}

const cases = () => {
  const charter = { ...PACKS["reference-en"].documents.find((entry) => entry.id === "un-charter") };
  delete charter.endAt;
  return [
    ["the UN Charter fixture", convert(charter, "un-charter.html")],
    ["the Official Journal fixture", convert(PACKS["reference-en"].documents.find((entry) => entry.id === "eu-teu"), "oj-c202-teu.xhtml")],
    ["the gazette fixture", convert({ id: "gazette", kind: "text", title: "Zakon" }, "gazette-socijalna-zastita.txt")],
  ];
};

describe("every fixture's converted text is its source's text", () => {
  for (const [label, sections] of cases()) {
    it(`${label}: ${String(sections.length)} section(s), no difference`, () => {
      expect(sections.length).toBeGreaterThan(0);
      for (const section of sections) {
        expect({ section: section.title, difference: fidelityDifference(section.sourceText, section.markdown) }).toEqual({
          section: section.title,
          difference: null,
        });
        // The assertion above is the same one the build makes; this one is here
        // so the file would fail even if `assertFidelity` were stubbed out.
        expect(() => assertFidelity(label, section.sourceText, section.markdown)).not.toThrow();
      }
    });
  }
});

describe("the check refuses a text that is not the source's", () => {
  it("notices a dropped sentence", () => {
    const [first] = convert({ id: "gazette", kind: "text", title: "Zakon" }, "gazette-socijalna-zastita.txt");
    const damaged = first.markdown.replace("\u0421\u0432\u0438 \u043f\u043e\u0458\u043c\u043e\u0432\u0438 \u0443 \u043e\u0432\u043e\u043c \u0437\u0430\u043a\u043e\u043d\u0443", "");
    const difference = fidelityDifference(first.sourceText, damaged);
    expect(difference).not.toBeNull();
    expect(difference.at).toBeGreaterThan(0);
  });

  it("notices two clauses in the wrong order", () => {
    const [first] = convert({ id: "gazette", kind: "text", title: "Zakon" }, "gazette-socijalna-zastita.txt");
    const swapped = first.markdown.replace("\u043c\u0443\u0448\u043a\u0438 \u0438 \u0436\u0435\u043d\u0441\u043a\u0438 \u043f\u0440\u0438\u0440\u043e\u0434\u043d\u0438 \u0440\u043e\u0434", "\u0436\u0435\u043d\u0441\u043a\u0438 \u0438 \u043c\u0443\u0448\u043a\u0438 \u043f\u0440\u0438\u0440\u043e\u0434\u043d\u0438 \u0440\u043e\u0434");
    expect(swapped).not.toBe(first.markdown);
    expect(fidelityDifference(first.sourceText, swapped)).not.toBeNull();
  });

  it("notices a word inserted by somebody trying to help", () => {
    const [first] = convert({ id: "gazette", kind: "text", title: "Zakon" }, "gazette-socijalna-zastita.txt");
    const improved = first.markdown.replace("\u041e\u0432\u0438\u043c \u0437\u0430\u043a\u043e\u043d\u043e\u043c \u0443\u0440\u0435\u0452\u0443\u0458\u0435 \u0441\u0435", "\u041e\u0432\u0438\u043c \u0437\u0430\u043a\u043e\u043d\u043e\u043c \u0434\u0435\u0442\u0430\u0459\u043d\u043e \u0443\u0440\u0435\u0452\u0443\u0458\u0435 \u0441\u0435");
    expect(fidelityDifference(first.sourceText, improved)).not.toBeNull();
  });

  it("reports where the two texts part company, not just that they did", () => {
    const difference = fidelityDifference("alpha beta gamma", "alpha BETA gamma");
    expect(difference.at).toBe("alpha ".length);
    expect(difference.source).toBe("alpha beta gamma");
    expect(difference.markdown).toBe("alpha BETA gamma");
  });
});

describe("the selector guards", () => {
  it("refuses a document whose container is not on the page", () => {
    const spec = { ...PACKS["reference-en"].documents.find((entry) => entry.id === "un-charter"), container: { class: "not-this-page" } };
    expect(() => convertDocument(spec, fixture("un-charter.html"), { linesOfPdf: null })).toThrow(/container not found/);
  });

  it("refuses a document whose furniture selectors match nothing", () => {
    const spec = { ...PACKS["reference-en"].documents.find((entry) => entry.id === "un-charter"), prune: [{ class: "no-such-class" }] };
    delete spec.endAt;
    expect(() => convertDocument(spec, fixture("un-charter.html"), { linesOfPdf: null })).toThrow(/prune selectors matched/);
  });

  it("refuses a marker that is not in the text, because a page that changed shape must not build", () => {
    const spec = { ...PACKS["reference-en"].documents.find((entry) => entry.id === "un-charter"), startAt: "A sentence this page does not contain" };
    delete spec.endAt;
    expect(() => convertDocument(spec, fixture("un-charter.html"), { linesOfPdf: null })).toThrow(/startAt .* not found/);
  });
});
