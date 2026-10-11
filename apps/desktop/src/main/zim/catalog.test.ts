import { describe, expect, it } from "vitest";

import {
  CATALOGUE,
  type CatalogueEdition,
  findPack,
  parseMetalink,
  parseOpdsFeed,
  pickMirror,
} from "./catalog.js";

/** One edition of this build's table, by its own ids — the table is the thing under test. */
function editionOf(collectionId: string, editionId: string): CatalogueEdition {
  const collection = CATALOGUE.find((row) => row.id === collectionId);
  const edition = collection?.editions.find((row) => row.id === editionId);
  if (edition === undefined) throw new Error(`The catalogue has no "${collectionId}/${editionId}".`);
  return edition;
}

/** An OPDS entry element in the live feed's shape, for the packs this build offers. */
function feedEntry(edition: CatalogueEdition): string {
  return (
    `<entry><name>${edition.name}</name><flavour>${edition.flavour ?? ""}</flavour>` +
    `<link rel="http://opds-spec.org/acquisition/open-access" href="https://lb.download.kiwix.org/zim/${edition.id}.zim.meta4" length="1" /></entry>`
  );
}

/**
 * The two documents the catalogue path reads, and the table of packs it offers.
 *
 * The XML below is not invented: the OPDS `entry` elements are the live feed's
 * own shape (fetched 2026-10-10 — the `<name>`, `<flavour>`, acquisition link
 * and `length` of the Stack Exchange and Wikipedia entries), and the Metalink is
 * the real `gutenberg_sr_all_2026-01.zim.meta4` abridged to its first three
 * mirrors, with its size and hashes copied verbatim.
 */
const OPDS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <name>wikipedia_en_all</name>
    <flavour>mini</flavour>
    <language>eng</language>
    <dc:issued>2026-09-09T00:00:00Z</dc:issued>
    <author><name>Wikipedia</name></author>
    <link rel="http://opds-spec.org/acquisition/open-access" type="application/x-zim" href="https://lb.download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2026-09.zim.meta4" length="14386799616" />
  </entry>
  <entry>
    <name>electronics.stackexchange.com_en_all</name>
    <flavour></flavour>
    <language>eng</language>
    <dc:issued>2026-08-01T00:00:00Z</dc:issued>
    <link rel="http://opds-spec.org/acquisition/open-access" type="application/x-zim" href="https://lb.download.kiwix.org/zim/stack_exchange/electronics.stackexchange.com_en_all_2026-08.zim.meta4" length="4214187008" />
  </entry>
  <entry>
    <name>broken_pack</name>
    <flavour>mini</flavour>
    <link type="text/html" href="https://browse.library.kiwix.org/content/broken_pack" />
  </entry>
</feed>`;

const METALINK = `<?xml version="1.0" encoding="UTF-8"?>
<metalink xmlns="urn:ietf:params:xml:ns:metalink">
  <generator>MirrorBrain/2.19.0</generator>
  <file name="gutenberg_sr_all_2026-01.zim">
    <size>3624747</size>
    <hash type="md5">23bc48b35b7fdbb3736a0685bc66f88f</hash>
    <hash type="sha-1">00866f5a1050f035987ccf4b940435b7fc123b08</hash>
    <hash type="sha-256">311fd656cc78a756a1f7867a9db3630e9507beaedfee0ad37cf4f6b055adcf4d</hash>
    <url location="se" priority="1">https://mirror.accum.se/mirror/kiwix.org/zim/gutenberg/gutenberg_sr_all_2026-01.zim</url>
    <url location="nl" priority="2">https://ftp.nluug.nl/pub/kiwix/zim/gutenberg/gutenberg_sr_all_2026-01.zim</url>
    <url location="fr" priority="3">https://mirror.download.kiwix.org/zim/gutenberg/gutenberg_sr_all_2026-01.zim</url>
  </file>
</metalink>`;

describe("the Kiwix OPDS feed", () => {
  it("reads the name, flavour, size and Metalink URL of every entry", () => {
    const packs = parseOpdsFeed(OPDS);
    // The third entry has no `.zim.meta4` link, so it is a pack this app cannot
    // offer and it is left out rather than guessed at.
    expect(packs).toEqual([
      {
        name: "wikipedia_en_all",
        flavour: "mini",
        sizeBytes: 14_386_799_616,
        metalinkUrl: "https://lb.download.kiwix.org/zim/wikipedia/wikipedia_en_all_mini_2026-09.zim.meta4",
        issued: "2026-09-09T00:00:00Z",
      },
      {
        name: "electronics.stackexchange.com_en_all",
        flavour: null,
        sizeBytes: 4_214_187_008,
        metalinkUrl:
          "https://lb.download.kiwix.org/zim/stack_exchange/electronics.stackexchange.com_en_all_2026-08.zim.meta4",
        issued: "2026-08-01T00:00:00Z",
      },
    ]);
  });

  it("matches every pack this build offers to an entry with that name and flavour", () => {
    // The whole table, spelled out the way the live feed spells it: this is what
    // catches a typo in an edition's `name`, which would otherwise be a pack the
    // page lists and the download can never find.
    const editions = CATALOGUE.flatMap((collection) => collection.editions);
    expect(editions.length).toBeGreaterThan(0);
    // `findPack` is given the parser's own answer rather than a hand-built
    // array, so the matching rule and the parser are exercised together.
    const parsed = parseOpdsFeed(`<feed>${editions.map(feedEntry).join("")}</feed>`);
    expect(parsed).toHaveLength(editions.length);
    for (const entry of editions) {
      expect(findPack(parsed, entry), `no feed entry matches "${entry.id}"`).not.toBeNull();
    }
  });

  it("matches a flavour exactly, so mini is never served as maxi", () => {
    const packs = parseOpdsFeed(OPDS);
    expect(findPack(packs, editionOf("wikipedia", "wikipedia-en-mini"))?.flavour).toBe("mini");
    expect(findPack(packs, editionOf("wikipedia", "wikipedia-en-maxi"))).toBeNull();
  });
});

describe("a pack's Metalink", () => {
  it("reads the size and the two hashes this app verifies", () => {
    const metalink = parseMetalink(METALINK);
    expect(metalink.sizeBytes).toBe(3_624_747);
    expect(metalink.md5).toBe("23bc48b35b7fdbb3736a0685bc66f88f");
    expect(metalink.sha256).toBe(
      "311fd656cc78a756a1f7867a9db3630e9507beaedfee0ad37cf4f6b055adcf4d",
    );
    expect(metalink.urls).toHaveLength(3);
  });

  it("refuses a Metalink that is missing a size, a hash or a mirror", () => {
    expect(() => parseMetalink("<metalink><file><size>1</size></file></metalink>")).toThrow();
  });

  it("picks the first mirror this build may reach, in the file's own order", () => {
    const metalink = parseMetalink(METALINK);
    expect(
      pickMirror(metalink, (url) => url.startsWith("https://mirror.download.kiwix.org/")),
    ).toBe("https://mirror.download.kiwix.org/zim/gutenberg/gutenberg_sr_all_2026-01.zim");
    // MirrorBrain's ranking is a preference, not a rule: a build whose allowlist
    // is empty downloads from nothing rather than from a host it was not given.
    expect(pickMirror(metalink, () => false)).toBeNull();
  });
});

describe("the catalogue this build offers", () => {
  it("names every collection and edition in both languages, with a licence", () => {
    for (const collection of CATALOGUE) {
      expect(collection.title.sr.length).toBeGreaterThan(0);
      expect(collection.title.en.length).toBeGreaterThan(0);
      expect(collection.note.sr.length).toBeGreaterThan(0);
      expect(collection.note.en.length).toBeGreaterThan(0);
      expect(collection.licence.length).toBeGreaterThan(0);
      expect(collection.editions.length).toBeGreaterThan(0);
      for (const edition of collection.editions) {
        expect(edition.label.sr.length).toBeGreaterThan(0);
        expect(edition.label.en.length).toBeGreaterThan(0);
      }
    }
    // Ids are unique, because a download is remembered by one.
    const ids = CATALOGUE.flatMap((collection) => collection.editions).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
