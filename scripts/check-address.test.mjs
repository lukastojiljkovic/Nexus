import { describe, expect, it } from "vitest";

import {
  NOT_PARTICIPLES,
  isParticiple,
  literalsOf,
  offendingWord,
  scanFiles,
  scanRepo,
  scanSource,
} from "./check-address.mjs";

/**
 * `check:address` makes „the app must not address the reader as a man" a rule
 * the tree enforces rather than a sentence in a style guide.
 *
 * The suite's job is to show the gate goes RED on the thing it forbids and
 * stays GREEN on the four rewrites that fix it — because a copy rule that
 * cannot fail is the style guide again with extra steps, and one that fires on
 * correct Serbian gets switched off by the person it protects (DC-15).
 */

const FILE = "apps/desktop/src/renderer/src/strings/pro.gradnja.ts";

const wrap = (literal) => `export const X = { a: ${JSON.stringify(literal)} };`;

describe("offendingWord", () => {
  it("names the participle in a second-person past sentence", () => {
    expect(offendingWord("Granica koju si uneo")).toBe("uneo");
    expect(offendingWord("Nisi ništa izabrao, pa Nexus kreće standardno.")).toBe("izabrao");
    expect(offendingWord("Rekao si")).toBe("Rekao");
  });

  it("catches every ending the l-participle takes", () => {
    for (const sentence of [
      "vrednost koju si uneo", // -eo
      "pravilo koje si izabrao", // -ao
      "tabelu koju si ukucao", // -ao
      "redove koje si označio", // -io
      "koliko si još mogao", // -ao, with a word between
    ]) {
      expect(offendingWord(sentence)).not.toBeNull();
    }
  });

  it("says nothing about a sentence with no second person in it", () => {
    // The participle agrees with the NOUN here, and the noun's gender is a
    // fact about Serbian rather than a claim about the reader.
    expect(offendingWord("Fajl nije mogao da se pročita. Pokušaj ponovo.")).toBeNull();
    expect(offendingWord("Nexus se složio prema tvojim odgovorima.")).toBeNull();
  });

  it("passes each of the four rewrites the gate's own message recommends", () => {
    expect(offendingWord("Tvoja granica")).toBeNull(); // possessive
    expect(offendingWord("Račun iz vrednosti koje uneseš.")).toBeNull(); // present
    expect(offendingWord("Bez odgovora Nexus kreće standardno.")).toBeNull(); // impersonal
    expect(offendingWord("Proveri da li je nalepljen ceo odgovor.")).toBeNull(); // passive
  });

  it("does not fire on words that merely end the way a participle does", () => {
    // „kao" is the commonest word in Serbian ending in -ao, and „ceo",
    // „posao" and „video" all sit in this product's copy beside a „si".
    expect(offendingWord("Unesi masu kao što si videla u tabeli — ne, kao u tabeli")).toBeNull();
    expect(offendingWord("Ako ti je ovo posao, uključi alatke — ali samo ako si za to")).toBeNull();
    expect(offendingWord("Slika, zvuk i video su ono što si tu")).toBeNull();
  });

  /**
   * THE OTHER HALF OF THE CLASS, and the gate shipped without it. „proveri ako
   * nisi siguran" was live in `pro.trening.ts` — in a sentence about women's
   * barbells — while this suite asserted a sentence containing those very words
   * was clean, because `siguran` is an adjective and the rule only knew
   * participles.
   */
  it("names a predicative adjective, which agrees with the reader exactly as a participle does", () => {
    expect(offendingWord("Muške šipke su 20 kg, ženske 15 — proveri ako nisi siguran.")).toBe(
      "siguran",
    );
    expect(offendingWord("Nastavi kada si spreman")).toBe("spreman");
  });

  it("leaves the same adjectives alone where they agree with a NOUN", () => {
    // Two dozen honest lines in this tree look like this. It is the „si“ beside
    // the word that makes it a claim about the reader.
    expect(offendingWord("Naziv je obavezan.")).toBeNull();
    expect(offendingWord("Slobodan prostor oko stola")).toBeNull();
    expect(offendingWord("Prvi podsetnik je spreman.")).toBeNull();
  });
});

describe("isParticiple", () => {
  it("needs three letters, so a bare „ao“ or „io“ is not one", () => {
    expect(isParticiple("io")).toBe(false);
    expect(isParticiple("uneo")).toBe(true);
  });

  it("is case-insensitive, because a sentence can start with one", () => {
    expect(isParticiple("Rekao")).toBe(true);
  });

  it("consults the allowlist, and the allowlist is small", () => {
    for (const word of NOT_PARTICIPLES) expect(isParticiple(word)).toBe(false);
    // Every entry is a word the gate stops watching. Kept short deliberately —
    // a long allowlist is how a gate stops being one.
    expect(NOT_PARTICIPLES.size).toBeLessThanOrEqual(16);
    // „bio" is a participle („si bio"), never an allowlist entry.
    expect(NOT_PARTICIPLES.has("bio")).toBe(false);
  });
});

describe("literalsOf", () => {
  it("reads string literals and template spans, and no comments", () => {
    // The load-bearing one: the file headers that USED to teach the banned
    // phrasing now forbid it BY NAME, and a line-based gate would go red on
    // the sentence that fixes it.
    const source = [
      "/** Where a limit appears it is always „tvoja granica“, never „koju si uneo“. */",
      "export const X = { a: \"Tvoja granica\", b: `koje uneseš` };",
    ].join("\n");
    expect(literalsOf(FILE, source).map((entry) => entry.text)).toEqual([
      "Tvoja granica",
      "koje uneseš",
    ]);
    expect(scanSource(FILE, source)).toEqual([]);
  });

  it("carries the line number of the literal, not of the statement", () => {
    const source = ["export const X = {", "  a:", "    \"koju si uneo\",", "};"].join("\n");
    expect(scanSource(FILE, source)).toEqual([
      { file: FILE, line: 3, word: "uneo", text: "koju si uneo" },
    ]);
  });

  /**
   * A CONCATENATION IS ONE SENTENCE. The copy is hand-wrapped near 100 columns,
   * so where the `+` falls is an accident of length — and this exact split was
   * live in `pro.racunovodstvo.ts`, invisible to the gate for as long as it
   * read the pieces separately.
   */
  it("reads a hand-wrapped sentence as one, so „si“ and its participle can see each other", () => {
    const source = 'export const X = { a: "…one iznose koje si " + "uneo." };';
    expect(literalsOf(FILE, source).map((entry) => entry.text)).toEqual(["…one iznose koje si uneo."]);
    const findings = scanSource(FILE, source);
    // ONE finding, not one per piece: the chain replaces its own leaves.
    expect(findings).toHaveLength(1);
    expect(findings[0]?.word).toBe("uneo");
  });

  it("keeps an interpolated operand from fusing the words either side of it", () => {
    // „…si " + name + "uneo" is still gendered; „…broj" + n + "unet" is not two
    // words run together into one the rule cannot read.
    const source = 'export const X = (n) => "koje si " + n + " uneo.";';
    // Three spaces: the first literal's own trailing one, the space that stands
    // in for `n`, and the second literal's leading one. The count is an accident
    // of where the author put the quotes; what the rule needs is that it is
    // never zero, because a fused „siuneo“ is a word the gate cannot read.
    expect(literalsOf(FILE, source).map((entry) => entry.text)).toEqual(["koje si   uneo."]);
    expect(scanSource(FILE, source)[0]?.word).toBe("uneo");
  });

  it("still reports a clean chain as nothing at all", () => {
    const source = 'export const X = { a: "vrednosti " + "koje uneseš." };';
    expect(scanSource(FILE, source)).toEqual([]);
  });
});

describe("scanSource", () => {
  it("refuses the phrasing six file headers used to recommend", () => {
    const findings = scanSource(FILE, wrap("Granična visina stepenika koju si uneo"));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.word).toBe("uneo");
  });

  it("accepts the possessive that replaced it", () => {
    expect(scanSource(FILE, wrap("Tvoja granična visina stepenika"))).toEqual([]);
  });
});

describe("scanRepo", () => {
  it("covers the facade and every per-pack table", () => {
    const files = scanFiles().map((path) => path.split(/[\\/]/).pop());
    expect(files).toContain("strings.sr.ts");
    expect(files).toContain("pro.gradnja.ts");
    expect(files).toContain("electronics.ts");
    expect(files.length).toBeGreaterThan(20);
  });

  it("is green — the whole product addresses everybody", () => {
    expect(scanRepo()).toEqual([]);
  });
});
