import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_GLOSSES,
  buildIndex,
  englishEntry,
  entriesFile,
  keysFile,
  parsePhrasebook,
  serbianEntry,
  uint32File,
} from "./convert.mjs";
import { filesUnder, fixtureInputs } from "./write-fixtures.mjs";
import { writePack } from "./build.mjs";
import { dictionaryKey } from "./fold.mjs";

/**
 * The converter, over the real slices in `fixtures/`.
 *
 * Two kinds of test, and both are needed. The FILTER tests state exactly what a
 * record keeps and what it loses, on values taken from the fixtures — the words,
 * the parts of speech and the English glosses are the source's own, so the
 * expectations can be read against the file beside them. The GOLDEN test states
 * the format itself: the pack those fixtures convert to is committed byte for
 * byte, so a change to any index file, to `about.json` or to the notice fails
 * here and has to be looked at rather than absorbed.
 */

const FIXTURES = new URL("./fixtures/", import.meta.url);
const EXPECTED = new URL("./fixtures/expected/", import.meta.url);

function fixtureRecords(name) {
  return readFileSync(new URL(name, FIXTURES), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

/** The four English records, as objects. */
const ENGLISH = fixtureRecords("en.jsonl");
/** The four Serbo-Croatian records. */
const SERBIAN = fixtureRecords("sh.jsonl");

/** The record with a given headword, with the part of speech when one headword has several. */
function record(records, word, pos) {
  const found = records.find((each) => each.word === word && (pos === undefined || each.pos === pos));
  if (found === undefined) throw new Error(`the fixtures have no "${word}" (${String(pos)}) record`);
  return found;
}

describe("englishEntry", () => {
  it("keeps an English record that has a Serbo-Croatian translation", () => {
    const entry = englishEntry(record(ENGLISH, "free", "verb"));
    expect(entry).toEqual({
      word: "free",
      pos: "verb",
      glosses: ["To make free; set at liberty; release."],
      translations: ["ослобађати", "ослободити"],
      url: "https://en.wiktionary.org/wiki/free",
    });
  });

  it("keeps only the Serbo-Croatian translation items, in the source's order", () => {
    const source = record(ENGLISH, "dictionary");
    const nonserbian = source.translations.filter((item) => item.lang_code !== "sh");
    const entry = englishEntry(source);
    expect(entry).not.toBeNull();
    // Three words, and the folded keys prove which ones: the Cyrillic and the
    // Latin spellings of one word are two ITEMS in the source and are kept as
    // two translations here, because they are two spellings a reader may meet.
    expect(entry.translations.map(dictionaryKey)).toEqual(["recnik", "rjecnik", "slovnik"]);
    // And the record's translation into Abaza and into Abkhaz is NOT among them.
    for (const item of nonserbian) {
      expect(entry.translations, item.word).not.toContain(item.word);
    }
  });

  it("merges two translation items that fold to one key", () => {
    const entry = englishEntry({
      word: "house",
      lang_code: "en",
      pos: "noun",
      senses: [{ glosses: ["A building."] }],
      translations: [
        { lang_code: "sh", word: "КУЦА" },
        { lang_code: "sh", word: "kuća" },
      ],
    });
    expect(entry.translations).toEqual(["КУЦА"]);
  });

  it("drops a record this index does not carry, and says so with null", () => {
    // A Serbo-Croatian record is not English.
    expect(englishEntry(record(SERBIAN, "august"))).toBeNull();
    // An English record nobody translated into Serbo-Croatian.
    expect(
      englishEntry({
        word: "untranslated",
        lang_code: "en",
        pos: "noun",
        senses: [{ glosses: ["Nothing."] }],
        translations: [{ lang_code: "de", word: "unubersetzt" }],
      }),
    ).toBeNull();
    // An empty word on the translation side is not a translation.
    expect(
      englishEntry({
        word: "empty",
        lang_code: "en",
        pos: "noun",
        senses: [{ glosses: ["Nothing."] }],
        translations: [{ lang_code: "sh", word: " " }],
      }),
    ).toBeNull();
    // An English word with no definition: a Serbian word with nothing to explain it.
    expect(englishEntry({ word: "glossless", lang_code: "en", translations: [{ lang_code: "sh", word: "x" }] })).toBeNull();
    // And a record with no headword at all.
    expect(englishEntry({ word: "", lang_code: "en", senses: [{ glosses: ["x"] }], translations: [{ lang_code: "sh", word: "x" }] })).toBeNull();
  });
});

describe("serbianEntry", () => {
  it("keeps a Serbo-Croatian record's own English definitions, capped and deduplicated", () => {
    const entry = serbianEntry(record(SERBIAN, "f", "prep"));
    expect(entry).toEqual({
      word: "f",
      pos: "prep",
      // The record has four senses; the fourth ("in, during (time)") is past the
      // cap, and the cap is what keeps an entry readable.
      glosses: ["in, at (location)", "to, into (direction)", "on, in, at, during (time)"],
      url: "https://en.wiktionary.org/wiki/f",
    });
    expect(MAX_GLOSSES).toBe(3);
  });

  it("drops a record with nothing said about it", () => {
    expect(serbianEntry({ word: "g", lang_code: "sh", pos: "noun", senses: [] })).toBeNull();
    expect(serbianEntry({ word: "g", lang_code: "sh", senses: [{ glosses: ["  "] }] })).toBeNull();
    expect(serbianEntry({ word: "", lang_code: "sh", senses: [{ glosses: ["x"] }] })).toBeNull();
    // And an English record is not this index's business.
    expect(serbianEntry(record(ENGLISH, "free", "verb"))).toBeNull();
  });
});

describe("buildIndex", () => {
  it("groups the fixture's English entries under sorted keys", () => {
    const entries = ENGLISH.map(englishEntry).filter((entry) => entry !== null);
    const index = buildIndex(entries);
    expect(index.keys).toEqual(["dictionary", "free", "thesaurus"]);
    // One entry under "dictionary", two under "free" (noun and verb), one under
    // "thesaurus" — and the sentinel at the end.
    expect([...index.group]).toEqual([0, 1, 3, 4]);
    expect(index.entries.map((entry) => entry.word)).toEqual(["dictionary", "free", "free", "thesaurus"]);
    expect(index.dropped).toBe(0);
  });

  it("caps one key's entries and counts what the cap dropped rather than hiding it", () => {
    const many = Array.from({ length: 20 }, (_unused, index) => ({
      word: "biti",
      pos: `sense-${String(index)}`,
      glosses: ["to be"],
      url: "https://en.wiktionary.org/wiki/biti",
    }));
    const index = buildIndex(many);
    expect(index.keys).toEqual(["biti"]);
    expect(index.entries).toHaveLength(12);
    expect(index.dropped).toBe(8);
  });
});

describe("the index files", () => {
  it("writes the keys as sorted lines and the entries as one JSON record per line", () => {
    const entries = [
      { word: "kafa", pos: "noun", glosses: ["coffee"], url: "https://en.wiktionary.org/wiki/kafa" },
      { word: "kuća", pos: "noun", glosses: ["house"], url: "https://en.wiktionary.org/wiki/kuća" },
    ];
    // The keys are the FOLDED words, which is the whole point of the format.
    expect(keysFile(["kafa", "kuca"])).toEqual(Buffer.from("kafa\nkuca\n", "utf8"));

    const { jsonl, lines } = entriesFile(entries);
    const expectedLines = [
      '{"word":"kafa","pos":"noun","glosses":["coffee"],"url":"https://en.wiktionary.org/wiki/kafa"}',
      '{"word":"kuća","pos":"noun","glosses":["house"],"url":"https://en.wiktionary.org/wiki/kuća"}',
    ];
    expect(jsonl).toEqual(Buffer.from(`${expectedLines.join("\n")}\n`, "utf8"));
    // The offsets are the byte positions of those two lines, so the reader can
    // seek to one entry instead of reading the file.
    // Little-endian uint32: four padding bytes, then the first line's length
    // plus its newline — the byte the second record starts at.
    expect(lines).toEqual(Buffer.from([0, 0, 0, 0, expectedLines[0].length + 1, 0, 0, 0]));
  });

  it("writes uint32 offsets little-endian", () => {
    // The byte order is the whole assertion: 258 is 0x102, which is
    // 02 01 00 00 and not 00 00 01 02.
    expect(uint32File([0, 258])).toEqual(Buffer.from([0, 0, 0, 0, 2, 1, 0, 0]));
  });
});

describe("parsePhrasebook", () => {
  const topics = parsePhrasebook(readFileSync(new URL("phrasebook.wiki", FIXTURES), "utf8"));

  it("reads the source's headings as topics", () => {
    // "Pronunciation guide" and "Stress" are headings with no phrases of their
    // own — one holds only sub-headings and the other only prose — so they are
    // not topics, which is the difference between a heading and a topic.
    expect(topics.map((topic) => topic.id)).toEqual([
      "vowels",
      "consonants",
      "common-diphthongs",
      "basics",
    ]);
    expect(topics[0].title).toBe("Vowels");
    expect(topics[topics.length - 1].title).toBe("Basics");
  });

  it("strips the wikitext a phrase is written in", () => {
    const vowels = topics.find((topic) => topic.id === "vowels");
    expect(vowels.phrases[0]).toEqual({ en: "a", sr: 'the \'a\' in "article"' });
    const basics = topics.find((topic) => topic.id === "basics");
    // The pronunciation in italics is stripped, and the Serbian side keeps both
    // scripts the page gives it.
    expect(basics.phrases[0]).toEqual({
      en: "Hello.",
      sr: "Здраво. Zdravo. (ZDRAH-voh)",
    });
    expect(basics.phrases.some((phrase) => phrase.en === "Thank you.")).toBe(true);
    expect(basics.phrases.some((phrase) => phrase.en === "Help!")).toBe(true);
  });

  it("does not read inside a template, where a colon is not the phrase separator", () => {
    const all = topics.flatMap((topic) => topic.phrases);
    // The page's "Common signs" infobox holds rows like "PUSH : guraj"; they are
    // signs rather than phrases, and the block is skipped whole.
    expect(all.some((phrase) => phrase.en === "PUSH")).toBe(false);
    expect(all.some((phrase) => phrase.en === "ENTRANCE")).toBe(false);
  });
});

describe("the pack the fixtures convert to", () => {
  let dir = "";

  afterEach(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("is byte for byte the committed golden pack", () => {
    dir = mkdtempSync(join(tmpdir(), "nexus-dictionary-fixtures-"));
    writePack(dir, fixtureInputs());

    const expected = filesUnder(fileURLToPath(EXPECTED));
    const actual = filesUnder(dir);
    expect(actual).toEqual(expected);
    for (const file of expected) {
      expect(readFileSync(join(dir, file)), file).toEqual(
        readFileSync(new URL(file, EXPECTED)),
      );
    }
  });
});
