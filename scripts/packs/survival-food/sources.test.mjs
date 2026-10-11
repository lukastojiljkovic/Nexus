import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkMeta } from "../../pack-sign.mjs";
import { FURTHER_READING, LICENCES, LINK_LICENCES, SOURCES } from "./lib/sources.mjs";

/**
 * The record the pack ships beside its builder, checked against the table it was
 * generated from.
 *
 * `sources.json` is the answer to "where did this come from and what permits
 * it", so the tests here are about the two ways such a file goes wrong: it stops
 * describing the sources the builder actually fetches, or a licence claim loses
 * the evidence beside it. Both are checked without the network — the evidence
 * pages were fetched and their sentences verified by the build run.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(readFileSync(join(HERE, "sources.json"), "utf8"));

describe("sources.json", () => {
  it("lists exactly the sources the builder reads, in the same order", () => {
    expect(sources.sources.map((source) => source.id)).toEqual(SOURCES.map((source) => source.id));
    expect(sources.sources.map((source) => source.url)).toEqual(SOURCES.map((source) => source.url));
  });

  it("gives every source a date, a SHA-256 and the size of what was fetched", () => {
    for (const source of sources.sources) {
      expect(source.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.bytes).toBeGreaterThan(0);
      expect(source.finalUrl).toMatch(/^https:\/\//);
    }
  });

  it("carries the licence's own sentence and the page that states it", () => {
    for (const source of sources.sources) {
      const licence = LICENCES[source.licence] ?? Object.values(LICENCES).find((entry) => entry.name === source.licence);
      expect(licence, `no licence named for ${source.id}`).toBeDefined();
      expect(source.licenceEvidence.url).toBe(licence.url);
      expect(source.licenceEvidence.quotes).toEqual(licence.quotes);
      expect(source.licenceEvidence.quotes.length).toBeGreaterThan(0);
      for (const quote of source.licenceEvidence.quotes) expect(quote.length).toBeGreaterThan(20);
    }
  });

  it("records the dataset's own source under the same hash as the guide it comes from", () => {
    const guide = sources.sources.find((source) => source.id === "usda-guide-6");
    expect(sources.datasets[0].sha256).toBe(guide.sha256);
    expect(sources.datasets[0].url).toBe(guide.url);
  });

  it("names what it links to and does not ship, with the licence that says so", () => {
    expect(sources.notShipped.map((entry) => entry.key).sort()).toEqual(Object.keys(LINK_LICENCES).sort());
    for (const entry of sources.notShipped) {
      expect(entry.licence).toMatch(/not shipped/);
      expect(entry.licenceEvidence.quotes.length).toBeGreaterThan(0);
    }
    expect(new Set(FURTHER_READING).size).toBe(FURTHER_READING.length);
    for (const key of FURTHER_READING) expect(LINK_LICENCES[key]).toBeDefined();
  });
});

describe("the pack metadata", () => {
  const metas = [
    ["pack.survival-food.meta.json", "survival-food", "content"],
    ["pack.recipes-preserving.meta.json", "recipes-preserving", "dataset"],
  ];

  for (const [file, id, kind] of metas) {
    it(`${file} is a manifest the signing tool would accept`, () => {
      const meta = JSON.parse(readFileSync(join(HERE, file), "utf8"));
      // The signing tool's own rule, imported rather than restated: a metadata
      // file this passes is one the maintainer can sign, and one that fails
      // would have been refused AFTER the release key was used.
      expect(() => checkMeta(meta)).not.toThrow();
      expect(meta.id).toBe(id);
      expect(meta.kind).toBe(kind);
      expect(meta.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(meta.title.sr.length).toBeGreaterThan(0);
      expect(meta.title.en.length).toBeGreaterThan(0);
      expect(meta.description.sr.length).toBeGreaterThan(0);
      expect(meta.description.en.length).toBeGreaterThan(0);
      // ADR-091: the attribution is required and is always shown, so every pack
      // carries one.
      expect(meta.licence.attribution.length).toBeGreaterThan(40);
      expect(meta.minAppVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });
  }
});

