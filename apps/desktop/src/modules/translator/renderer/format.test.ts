import { describe, expect, it } from "vitest";

import type { TranslatorEntryView } from "../shared/ipc.js";
import { entryText, sourceLine } from "./format.js";

/**
 * The page's two pure formatters, against exact values.
 *
 * `entryText` is what a copy button writes, which is the one thing on this page
 * a reader can take away with them — so its shape is stated here rather than
 * inferred from the row that happens to render it today.
 */

const LABELS = { translations: "Prevodi", meanings: "Značenja" };

function entry(overrides: Partial<TranslatorEntryView> = {}): TranslatorEntryView {
  return {
    word: "kafa",
    latin: null,
    pos: "noun",
    glosses: ["coffee"],
    translations: [],
    url: "https://en.wiktionary.org/wiki/kafa",
    ...overrides,
  };
}

describe("sourceLine", () => {
  it("shows the host and the path, without the scheme", () => {
    expect(sourceLine("https://en.wiktionary.org/wiki/kafa")).toBe("en.wiktionary.org/wiki/kafa");
    expect(sourceLine("http://example.org/a/b")).toBe("example.org/a/b");
  });

  it("shows an address it cannot parse as it came, rather than inventing one", () => {
    expect(sourceLine("not a url")).toBe("not a url");
    expect(sourceLine("")).toBe("");
  });
});

describe("entryText", () => {
  it("writes the headword, the part of speech, the meanings and the address", () => {
    expect(entryText(entry(), LABELS)).toBe(
      ["kafa · noun", "Značenja: coffee", "https://en.wiktionary.org/wiki/kafa"].join("\n"),
    );
  });

  it("writes the Latin spelling of a Cyrillic headword under it, and the translations", () => {
    expect(
      entryText(
        entry({
          word: "КУЦА",
          latin: "kuća",
          glosses: ["house", "home"],
          translations: [],
        }),
        LABELS,
      ),
    ).toBe(
      [
        "КУЦА · noun",
        "kuća",
        "Značenja: house; home",
        "https://en.wiktionary.org/wiki/kafa",
      ].join("\n"),
    );
    expect(
      entryText(entry({ translations: ["kafa", "КАФА"] }), LABELS),
    ).toContain("Prevodi: kafa, КАФА");
  });

  it("leaves out a part of speech the source did not give", () => {
    expect(entryText(entry({ pos: "" }), LABELS).split("\n")[0]).toBe("kafa");
  });
});
