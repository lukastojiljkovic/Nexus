import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkMeta } from "../../pack-sign.mjs";
import {
  PACK_ID,
  appVersion,
  assertSources,
  bodySizeOf,
  buildMetadata,
  buildToc,
  findHeading,
  flattenPlan,
  forbiddenMatch,
  gaps,
  outputPaths,
  resolveSpans,
  sourceLine,
  uniqueId,
} from "./build.mjs";
import { FORBIDDEN, PLAN } from "./plan.mjs";
import { POPPLER, TOOLS } from "./poppler.mjs";

/**
 * The builder's own contract: the plan names sources that exist, every source
 * carries licence evidence, the manifest is one `pack-sign.mjs` will sign, the
 * headings the plan names are found in the reading order the plan expects, and
 * the pack is written where the brief says it is.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const sources = JSON.parse(readFileSync(`${HERE}/sources.json`, "utf8"));

describe("sources.json", () => {
  const parsed = assertSources(sources);

  it("carries a licence, an attribution and quoted evidence for every source", () => {
    for (const source of parsed.byId.values()) {
      expect(source.licence.length).toBeGreaterThan(20);
      expect(source.credit.length).toBeGreaterThan(20);
      expect(source.evidence.url).toMatch(/^https?:\/\//);
      // A quote has to be a sentence somebody can find on that page: the
      // shortest here is FM 21-76's distribution statement, at 57 characters.
      expect(source.evidence.quote.length).toBeGreaterThan(40);
    }
  });

  it("pins a digest and a size for every document it ships", () => {
    for (const source of parsed.byId.values()) {
      if (source.kind === "pdf") {
        expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(source.bytes).toBeGreaterThan(1_000_000);
        // A PDF source needs its running-head vocabulary, and FEMA's also needs
        // the title its pages repeat.
        expect(Array.isArray(source.vocabulary)).toBe(true);
      } else {
        expect(source.documents.length).toBeGreaterThan(0);
        for (const page of source.documents) {
          expect(page.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(page.bytes).toBeGreaterThan(1_000);
        }
      }
    }
    // The seven sources the research's section 3 names, and no others.
    expect([...parsed.byId.keys()].sort()).toEqual([
      "atp-3-50-21",
      "atp-4-02-11",
      "fema-is-22",
      "fm-21-76",
      "foodsafety-gov",
      "nws-jetstream",
      "ready-gov",
    ]);
  });

  it("names the source the research says not to ship, and says why not", () => {
    // FM 3-05.70 (2002) is a US Government work but its distribution statement
    // restricts it to government agencies and their contractors; wikiHow grants
    // no reuse outside the site; the Red Cross of Serbia reserves all rights.
    // None of the three is a source of this pack.
    const urls = [...parsed.byId.values()].map((source) => source.url).join(" ");
    expect(urls).not.toContain("3-05.70");
    expect(urls).not.toContain("wikihow");
    expect(urls).not.toContain("redcross");
    expect(parsed.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the plan", () => {
  const jobs = flattenPlan();

  it("names only sources the evidence file has", () => {
    const known = new Set(sources.sources.map((source) => source.id));
    for (const job of jobs) expect(known.has(job.source)).toBe(true);
  });

  it("gives every article a unique id and a group path", () => {
    const ids = jobs.map((job) => job.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const job of jobs) {
      expect(job.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(job.title.length).toBeGreaterThan(0);
      expect(job.groups.length).toBeGreaterThan(0);
    }
  });

  it("ships every topic the research's section 3 lists, in its order", () => {
    const groups = PLAN.map((group) => group.id);
    expect(groups).toEqual([
      "survival",
      "water",
      "fire",
      "shelter",
      "food-plants",
      "food-animals",
      "meat-safety",
      "weather-clouds",
      "tools-and-craft",
      "first-aid",
      "disasters",
    ]);
    // `signalling-morse` and `region-serbia` are the two topics that are NOT
    // built, and `docs/packs/survival.md` says why: the Signals module carries
    // Morse, and no Serbia-specific source with licence evidence was found.
    expect(groups).not.toContain("signalling-morse");
    expect(groups).not.toContain("region-serbia");
  });

  it("leaves out weapon and evasion doctrine by not naming it", () => {
    // FM 21-76's chapter 12 sections Clubs, Edged Weapons and Other Expedient
    // Weapons; its chapters 20 to 23; ATP 3-50.21's own SERE-adjacent material.
    const named = jobs.map((job) => `${job.start} ${job.title}`).join(" | ").toLowerCase();
    for (const term of ["clubs", "edged weapons", "expedient weapons", "camouflage", "stalking", "hostile areas", "terrorism"]) {
      expect(named).not.toContain(term);
    }
  });
});

describe("headings and spans", () => {
  /** Three headings, one of them printed over two lines, one a chapter title. */
  const lines = [
    { page: 1, y: 700, x: 72, size: 12, text: "Contents" },
    { page: 1, y: 690, x: 90, size: 9.96, text: "Water" },
    { page: 1, y: 680, x: 90, size: 9.96, text: "3-1. Water is the first requirement." },
    { page: 1, y: 670, x: 90, size: 9.96, text: "3-2. A person needs two litres a day." },
    { page: 1, y: 660, x: 90, size: 9.96, text: "3-3. Purify what you find." },
    { page: 1, y: 650, x: 90, size: 9.96, text: "3-4. Boiling is the surest method." },
    { page: 2, y: 700, x: 72, size: 12, text: "WATER" },
    { page: 2, y: 690, x: 90, size: 15.96, text: "Water" },
    { page: 2, y: 680, x: 90, size: 9.96, text: "3-1. Fresh rainwater needs no purification." },
    { page: 3, y: 700, x: 72, size: 12, text: "FOOD" },
    { page: 3, y: 690, x: 90, size: 15.96, text: "Food" },
  ];

  it("finds the heading where the source SETS one, not where its contents names it", () => {
    // The contents page prints "Water" at body size; the chapter sets it at
    // 15.96, which is the heading.
    expect(findHeading(lines, "Water")).toBe(7);
    expect(bodySizeOf(lines)).toBe(9.96);
  });

  it("matches a heading the source prints over more than one line", () => {
    const split = [
      { page: 1, y: 750, x: 90, size: 7.9, text: "Description: A plant of the temperate world." },
      { page: 1, y: 740, x: 90, size: 7.9, text: "Habitat and Distribution: Fields and fencerows." },
      { page: 1, y: 730, x: 90, size: 7.9, text: "Edible Parts: The young stems." },
      { page: 1, y: 700, x: 72, size: 17.7, text: "EDIBLEAND" },
      { page: 1, y: 690, x: 72, size: 17.7, text: "MEDICINALPLANTS" },
      { page: 1, y: 650, x: 90, size: 7.9, text: "Asparagus" },
      { page: 2, y: 700, x: 72, size: 17.7, text: "POISONOUSPLANTS" },
    ];
    expect(findHeading(split, "Edible and Medicinal Plants")).toBe(3);
    expect(findHeading(split, "Poisonous Plants")).toBe(6);
  });

  it("resolves a span from its start to the next start in reading order", () => {
    const documents = new Map([
      ["atp-3-50-21", { kind: "pdf", source: { id: "atp-3-50-21" }, lines, figures: [] }],
    ]);
    const jobs = [
      { id: "water", source: "atp-3-50-21", start: "Water", title: "Water", groups: [] },
      { id: "food", source: "atp-3-50-21", start: "Food", title: "Food", groups: [] },
    ];
    const spans = resolveSpans(documents, jobs);
    expect(spans.get("water")).toEqual({ from: 7, to: 10, next: 10 });
    expect(spans.get("food").from).toBe(10);
    // The contents page and the front matter are not inside any span.
    expect(gaps(documents.get("atp-3-50-21"), spans, jobs).map((gap) => [gap.from, gap.to])).toEqual([[0, 7]]);
  });

  it("stops the build rather than moving every article to the wrong text", () => {
    const documents = new Map([
      ["atp-3-50-21", { kind: "pdf", source: { id: "atp-3-50-21" }, lines, figures: [] }],
    ]);
    expect(() =>
      resolveSpans(documents, [{ id: "x", source: "atp-3-50-21", start: "Nowhere", title: "x", groups: [] }]),
    ).toThrow(/has no heading/);
  });
});

describe("the safety sweep", () => {
  const article = (text) => ({ id: "x", blocks: [{ kind: "paragraph", text }] });

  it("refuses a dose of a drug", () => {
    expect(forbiddenMatch(article("Give 500 mg of the antibiotic."))).toMatchObject({ rule: "drug-dose" });
    expect(forbiddenMatch(article("Draw up 0.15 milligrams."))).toMatchObject({ rule: "drug-dose" });
    // Mass in grams and volume in millilitres are not doses in these sources:
    // FM 21-76 describes plants by their starch content, ATP 3-50.21 describes
    // how much blood an adult has.
    expect(forbiddenMatch(article("A good source of starch, 28 grams of it."))).toBeNull();
    expect(forbiddenMatch(article("An adult has about 4,500cc of blood."))).toBeNull();
  });

  it("refuses weapons doctrine, and only when a section is really about it", () => {
    expect(
      forbiddenMatch(article("Bayonets, grenades and antipersonnel mines are the subject of this chapter.")),
    ).toMatchObject({ rule: "combat" });
    // A sentence that mentions one military object in passing is the source's
    // voice: these chapters are written for soldiers, and the brief does not
    // ask for a text this pack edits.
    expect(forbiddenMatch(article("Ammunition cans can be used to cook food in."))).toBeNull();
    expect(forbiddenMatch(article("A rifle can be used to open a shellfish."))).toBeNull();
  });

  it("names the rules it runs, with the reason each one is written the way it is", () => {
    expect(FORBIDDEN.map((rule) => rule.id)).toEqual(["drug-dose", "combat"]);
    expect(FORBIDDEN.find((rule) => rule.id === "combat").minimum).toBe(3);
  });
});

describe("the pack's metadata and layout", () => {
  it("is metadata pack-sign.mjs will sign", () => {
    const metadata = buildMetadata(appVersion());
    expect(() => checkMeta(metadata)).not.toThrow();
    expect(metadata.id).toBe(PACK_ID);
    expect(metadata.kind).toBe("content");
    expect(metadata.minAppVersion).toBe(appVersion());
    expect(metadata.licence.spdx).toBe("LicenseRef-PD-USGov");
    expect(metadata.licence.url).toMatch(/^https:\/\//);
    expect(metadata.licence.attribution).toContain("17 U.S.C. 105");
    // The world-wide warning the research asks for travels in the pack's own
    // description, in both languages, and in docs/packs/survival.md.
    expect(metadata.description.en).toContain("not a regional identification guide");
    expect(metadata.description.sr.length).toBeGreaterThan(0);
    expect(metadata.title.sr.length).toBeGreaterThan(0);
  });

  it("builds a toc entry per article, in the plan's group order", () => {
    const articles = [
      {
        id: "water-rain",
        title: "RAIN, SNOW, AND ICE",
        source: "atp-3-50-21",
        groups: [
          { id: "water", title: "Water" },
          { id: "water-nested", title: "Nested" },
        ],
      },
      { id: "floods", title: "Floods", source: "ready-gov", groups: [{ id: "disasters", title: "Disasters" }] },
    ];
    const sourcesById = new Map([
      ["atp-3-50-21", { credit: "credit", url: "https://example.invalid/a" }],
      ["ready-gov", { credit: "credit", url: "https://example.invalid/b" }],
    ]);
    const toc = buildToc(articles, sourcesById);
    expect(toc.map((group) => group.id)).toEqual(["water", "disasters"]);
    expect(toc[0].children[0].children[0]).toEqual({
      id: "water-rain",
      title: "RAIN, SNOW, AND ICE",
      file: "articles/water-rain.md",
      source: { title: "credit", url: "https://example.invalid/a" },
    });
    expect(toc[1].children[0].id).toBe("floods");
  });

  it("ends every article with the work, its section and its URL", () => {
    const line = sourceLine(
      { credit: "US Army ATP 3-50.21, Survival, 2018.", url: "https://example.invalid/a" },
      { id: "water", title: "Water" },
    );
    expect(line).toContain("Section: Water.");
    expect(line).toContain("https://example.invalid/a");
    expect(line.startsWith("*Source: ") && line.endsWith("*")).toBe(true);
  });

  it("writes the pack and its metadata under %TEMP%, metadata BESIDE the folder", () => {
    const paths = outputPaths();
    expect(paths.packDir).toContain("nexus-packs");
    expect(paths.cacheDir).toContain("nexus-pack-cache");
    // A metadata file inside the folder would be hashed into the manifest as
    // content by `pack-sign.mjs`, which is what this asserts against.
    expect(paths.metaPath.startsWith(`${paths.packDir}\\`)).toBe(false);
  });

  it("gives a second article with the same derived id a number, not the same file", () => {
    const used = new Set();
    expect(uniqueId("snake-vipera-lebetina", used)).toBe("snake-vipera-lebetina");
    expect(uniqueId("snake-vipera-lebetina", used)).toBe("snake-vipera-lebetina-2");
    expect(uniqueId("snake-vipera-lebetina", used)).toBe("snake-vipera-lebetina-3");
    expect(uniqueId("other", used)).toBe("other");
  });

  it("pins the GPL build tool it fetches, and never ships it", () => {
    expect(POPPLER.url).toMatch(/^https:\/\/github\.com\/oschwartz10612\/poppler-windows/);
    expect(POPPLER.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(POPPLER.licence).toContain("never shipped");
    expect(TOOLS).toEqual(["pdfimages", "pdftoppm"]);
  });
});

describe("the fixtures", () => {
  it("are the two PDF pages and the one HTML page the tests read", () => {
    for (const file of [
      "atp-3-50-21-p24.json",
      "atp-3-50-21-p24-figure.png",
      "fm-21-76-p372.json",
      "fm-21-76-p372-figure.png",
      "foodsafety-temperatures.html",
      "README.md",
    ]) {
      expect(existsSync(`${HERE}/fixtures/${file}`)).toBe(true);
    }
  });

  it("keeps each fixture small enough to be a quotation", () => {
    for (const file of ["atp-3-50-21-p24.json", "fm-21-76-p372.json", "foodsafety-temperatures.html"]) {
      expect(readFileSync(`${HERE}/fixtures/${file}`, "utf8").length).toBeLessThan(40_000);
    }
  });
});
