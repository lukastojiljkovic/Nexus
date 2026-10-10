import { describe, expect, it } from "vitest";
import { normalizeLibraryTitle, titleMatchKey } from "./title.js";

describe("normalizeLibraryTitle", () => {
  /**
   * Every expectation below is the fold worked out by hand from the five steps
   * the module documents — not a value read off an implementation. The two
   * cases worth calling out: „Čačak" loses its mark (č IS a combining caron on
   * a `c` in NFD) while „Đak" loses nothing (đ has no decomposition, which is
   * why the module folds it explicitly), and „Ana" keeps its first token
   * because `ana` is a word rather than the article `a`.
   */
  const CASES: readonly (readonly [string, string])[] = [
    ["The Great Gatsby", "great gatsby"],
    ["A Clockwork Orange", "clockwork orange"],
    // Only the LEADING article goes: the second „a" is part of the title.
    ["An Officer and a Gentleman", "officer and a gentleman"],
    ["Na Drini ćuprija", "na drini cuprija"],
    ["Čiča Gorio", "cica gorio"],
    ["Šuma i žito", "suma i zito"],
    ["Đak iz Žitorađe", "dak iz zitorade"],
    ["Ana Karenjina", "ana karenjina"],
    ["DUNE: Part Two", "dune part two"],
    ["Solaris (1972)", "solaris 1972"],
    ["   Rat i mir   ", "rat i mir"],
    ["L'Étranger", "l etranger"],
    ["Tom & Jerry", "tom and jerry"],
    ["Ž", "z"],
    ["The", "the"],
    ["…", ""],
    ["Die Verwandlung", "die verwandlung"],
  ];

  for (const [title, expected] of CASES) {
    it(`folds ${JSON.stringify(title)} to ${JSON.stringify(expected)}`, () => {
      expect(normalizeLibraryTitle(title)).toBe(expected);
    });
  }

  it("is idempotent — folding a folded title changes nothing", () => {
    for (const [title] of CASES) {
      expect(normalizeLibraryTitle(normalizeLibraryTitle(title))).toBe(
        normalizeLibraryTitle(title),
      );
    }
  });

  it("folds two spellings of one Serbian title to the same key", () => {
    expect(normalizeLibraryTitle("Čiča Gorio")).toBe(normalizeLibraryTitle("Cica gorio"));
    expect(normalizeLibraryTitle("Na Drini Ćuprija")).toBe(
      normalizeLibraryTitle("na drini cuprija"),
    );
  });

  it("keeps a NON-leading article, which is part of the title", () => {
    // „S one strane" has no article to lose; „The The" loses one and keeps one.
    expect(normalizeLibraryTitle("The The")).toBe("the");
    expect(normalizeLibraryTitle("One Flew Over the Cuckoo's Nest")).toBe(
      "one flew over the cuckoo s nest",
    );
  });

  it("does not fold a letter that is not a diacritic", () => {
    // `ø`, `ß` and `ł` are distinct letters with no decomposition; a fold that
    // guessed otherwise would be right for one language and wrong for another.
    expect(normalizeLibraryTitle("Et dukkehjem")).toBe("et dukkehjem");
    expect(normalizeLibraryTitle("Straße")).toBe("straße");
  });
});

describe("titleMatchKey", () => {
  it("answers the same string as the normaliser when there is something left", () => {
    expect(titleMatchKey("The Great Gatsby")).toBe("great gatsby");
  });

  it("answers null — not the empty string — for a title of nothing but punctuation", () => {
    // Two such titles are two different works, and an empty key would quietly
    // make them one.
    expect(titleMatchKey("…")).toBeNull();
    expect(titleMatchKey("!!!")).toBeNull();
    expect(titleMatchKey("   ")).toBeNull();
  });
});
