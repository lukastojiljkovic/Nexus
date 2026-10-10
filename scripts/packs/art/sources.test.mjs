// The source table's tests: the licence evidence is real, the request plans are
// the ones this build means to send, and `sources.json` — the record of the
// build that was actually run — carries a licence sentence for every source.

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { quotePresent, normaliseQuote } from "./evidence.mjs";
import { PACK_ID } from "./build.mjs";
import {
  commonsPaintingsQuery,
  commonsFileTitle,
  commonsImageInfoUrl,
  EVIDENCE_PAGES,
  MET_DEPARTMENTS,
  metObjectUrl,
  metSearchUrl,
  PD_DEATH_YEAR,
  REGIONAL_PAINTERS_QUERY,
  rijksSearchUrl,
  smithsonianSearchUrl,
  SOURCES,
} from "./sources.mjs";

const sourcesJsonPath = new URL("./sources.json", import.meta.url);

function readFixture(path) {
  return readFileSync(new URL(`./${path}`, import.meta.url), "utf8");
}

describe("the licence evidence", () => {
  it("quotes a sentence that is verbatim on each source's own page", () => {
    for (const page of EVIDENCE_PAGES) {
      const fixture = readFixture(page.fixture);
      expect(quotePresent(fixture, page.quote), `${page.id}: ${page.quote}`).toBe(true);
    }
  });

  it("has a page, a quote and a fixture for all five documents", () => {
    expect(EVIDENCE_PAGES.map((page) => page.id)).toEqual(["met", "smithsonian", "rijksmuseum", "commons", "wikidata"]);
    for (const page of EVIDENCE_PAGES) {
      expect(page.url.startsWith("https://")).toBe(true);
      expect(page.quote.length).toBeGreaterThan(20);
    }
  });

  it("normalises markup whitespace and nothing else", () => {
    expect(normaliseQuote('is that " a b " ; done .')).toBe('is that"a b"; done.');
    expect(normaliseQuote("two   words")).toBe("two words");
    // A difference of one letter still fails, which is the property the
    // comparison exists for.
    expect(quotePresent("a public domain work", "a public-domain work")).toBe(false);
  });
});

describe("the request plans", () => {
  it("asks the Met's paginated search for public-domain objects with images", () => {
    expect(metSearchUrl(11, { medium: "Paintings", limit: 100, offset: 0 })).toBe(
      "https://collectionapi.metmuseum.org/public/collection/v1.1/search?departmentId=11&isPublicDomain=true&hasImages=true&medium=Paintings&limit=100&offset=0",
    );
    expect(metObjectUrl(45434)).toBe("https://collectionapi.metmuseum.org/public/collection/v1/objects/45434");
    // Every department names the medium it is drawn for, or the search would
    // answer with the department's decorative objects as well (see the module).
    expect(MET_DEPARTMENTS.length).toBeGreaterThanOrEqual(5);
    for (const department of MET_DEPARTMENTS) {
      expect(["Paintings", "Drawings", "Prints"]).toContain(department.medium);
    }
  });

  it("asks the Smithsonian for CC0 images by unit and object type", () => {
    expect(smithsonianSearchUrl({ unit: "SAAM", objectType: "Paintings" }, "DEMO_KEY", { rows: 30, start: 0 })).toBe(
      "https://api.si.edu/openaccess/api/v1.0/search?q=unit_code%3ASAAM+AND+media_usage%3ACC0+AND+object_type%3APaintings&api_key=DEMO_KEY&rows=30&start=0",
    );
  });

  it("asks the Rijksmuseum for paintings with an image, one query per century", () => {
    expect(rijksSearchUrl("17??")).toBe("https://data.rijksmuseum.nl/search/collection?type=painting&imageAvailable=true&creationDate=17%3F%3F");
  });

  it("asks Commons for the file's licence, its size and a 2048 px rendition", () => {
    expect(commonsImageInfoUrl(["File:A.jpg", "File:B.jpg"])).toBe(
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata&iiurlwidth=2048&titles=File%3AA.jpg%7CFile%3AB.jpg",
    );
  });

  it("turns a Wikidata image URL into the Commons file title the API wants", () => {
    expect(
      commonsFileTitle(
        "http://commons.wikimedia.org/wiki/Special:FilePath/Ferencz%20Eisenhut%20%281857-1903%29%20-%20An%20Oriental%20School.jpg",
      ),
    ).toBe("File:Ferencz Eisenhut (1857-1903) - An Oriental School.jpg");
    expect(commonsFileTitle("https://example.com/nothing")).toBeNull();
  });
});

describe("the Wikidata queries", () => {
  it("requires a date of death rather than treating it as optional", () => {
    const paintings = commonsPaintingsQuery(["Q42"]);
    expect(paintings).toContain("?artist wdt:P570 ?death");
    expect(paintings).not.toContain("OPTIONAL { ?artist wdt:P570");
    expect(REGIONAL_PAINTERS_QUERY.query).toContain("wdt:P570 ?death");
  });

  it("filters on the life-plus-70-years year, computed rather than written down", () => {
    expect(PD_DEATH_YEAR).toBe(new Date().getUTCFullYear() - 71);
    expect(REGIONAL_PAINTERS_QUERY.query).toContain(`FILTER(YEAR(?death) <= ${String(PD_DEATH_YEAR)})`);
    expect(commonsPaintingsQuery(["Q42"])).toContain(`FILTER(YEAR(?death) <= ${String(PD_DEATH_YEAR)})`);
  });

  it("refuses an inception after the painter's death", () => {
    expect(commonsPaintingsQuery(["Q42"])).toContain("FILTER(YEAR(?inceptionDate) <= YEAR(?death))");
  });

  it("resolves the regional painters by citizenship and occupation, then asks for their paintings by name", () => {
    expect(REGIONAL_PAINTERS_QUERY.query).toContain("VALUES ?country { wd:Q403 wd:Q36704 }");
    expect(REGIONAL_PAINTERS_QUERY.query).toContain("wdt:P106 wd:Q1028181");
    expect(commonsPaintingsQuery(["Q116190930", "Q119140957"])).toContain(
      "VALUES ?artist { wd:Q116190930 wd:Q119140957 }",
    );
  });
});

describe("the source table", () => {
  it("names the four sources this pack is built from, each with its licence and page", () => {
    expect(SOURCES.map((source) => source.id)).toEqual(["met", "smithsonian", "rijksmuseum", "commons"]);
    for (const source of SOURCES) {
      expect(source.licence.length).toBeGreaterThan(0);
      expect(source.licenceUrl.startsWith("https://")).toBe(true);
      expect(source.dataUrl.startsWith("https://")).toBe(true);
    }
  });
});

describe("sources.json, the record of the build", () => {
  it("exists, because the pack it describes was built once by hand", () => {
    expect(existsSync(sourcesJsonPath), "run `node scripts/packs/art/build.mjs` first").toBe(true);
  });

  it("carries the licence evidence, the fetch record and the per-work licences", () => {
    const recorded = JSON.parse(readFileSync(sourcesJsonPath, "utf8"));
    expect(recorded.pack).toBe(PACK_ID);
    expect(recorded.target).toBe(300);
    expect(recorded.sources.length).toBeGreaterThanOrEqual(4);
    for (const source of recorded.sources) {
      expect(recorded.quality).toBeTypeOf("number");
      expect(source.licenceEvidence.url.startsWith("https://")).toBe(true);
      expect(source.licenceEvidence.quote.length).toBeGreaterThan(20);
      expect(source.licenceEvidence.fetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(source.licenceEvidence.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // Every work's licence is recorded per work, and the counts are the receipt
    // that the filtering ran: the Met and Smithsonian arms are CC0, the
    // Rijksmuseum is PDM or CC0, and the Commons works are PD-Art or CC0.
    const licences = new Set(
      recorded.sources.flatMap((source) => Object.keys(source.licenceCounts ?? {})),
    );
    for (const licence of licences) {
      expect(/^CC0-1\.0$|^PDM-1\.0$|^PD-Art \(artist died \d{4}\)$/.test(licence), licence).toBe(true);
    }
  });
});
