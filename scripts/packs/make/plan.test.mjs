import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PACK_ID, appVersion, articlePath, assertSources, buildMetadata, flattenPlan } from "./build.mjs";
import { FORBIDDEN, OMISSIONS, PLAN } from "./lib/plan.mjs";

/**
 * The plan, the evidence file and the manifest, checked as data.
 *
 * A pack is a signed folder whose manifest the app refuses field by field, and
 * the two failures this file exists to catch are the quiet ones: two articles
 * that resolve to one file, and an article that names a source `sources.json`
 * does not have. Both build a pack that installs and reads as though something
 * were missing from it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const sources = assertSources(JSON.parse(readFileSync(join(HERE, "sources.json"), "utf8")));
const jobs = flattenPlan();

describe("the plan", () => {
  it("names a real source for every article, and a heading where its kind needs one", () => {
    for (const job of jobs) {
      const source = sources.byId.get(job.source);
      expect(source, job.id).toBeDefined();
      if (source.kind === "gutenberg-html") expect(typeof job.at, job.id).toBe("string");
      else expect(job.at, job.id).toBeUndefined();
    }
    expect(jobs).toHaveLength(31);
  });

  it("gives every article an id that is kebab-case and unique", () => {
    const ids = jobs.map((job) => job.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("resolves every article to its own file", () => {
    const counts = new Map();
    const paths = jobs.map((job) => {
      const chapter = job.groups[0]?.id ?? "articles";
      const index = counts.get(chapter) ?? 0;
      counts.set(chapter, index + 1);
      return articlePath(job, index);
    });
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^articles\/[a-z0-9-]+\/\d\d-[a-z0-9-]+\.md$/);
  });

  it("keeps the Wikibooks pages in one chapter of their own", () => {
    // The share-alike boundary is a folder: the CC BY-SA text must not sit in
    // the same chapter as the public-domain text.
    for (const job of jobs) {
      const shareAlike = sources.byId.get(job.source).kind === "wikibooks";
      expect(job.groups[0].id === "05-wikibooks", job.id).toBe(shareAlike);
    }
  });
});

describe("the safety rules", () => {
  const matches = (text) => FORBIDDEN.find((rule) => rule.pattern.test(text))?.id ?? null;

  it("refuses the materials an old manual reaches for", () => {
    expect(matches("Apply a lead glaze and fire again.")).toBe("lead");
    expect(matches("Line the pipe with asbestos.")).toBe("asbestos");
    expect(matches("A little arsenic hardens the alloy.")).toBe("arsenic");
    expect(matches("Rub in mercury with a cloth.")).toBe("mercury");
    expect(matches("Etch the glass in hydrofluoric acid.")).toBe("hydrofluoric-acid");
    expect(matches("Give 500 mg of it.")).toBe("drug-dose");
  });

  it("does not fire on the words these subjects are made of", () => {
    // `leads to` on every page of a pottery chapter, and `lead` as a verb, are
    // why the rule names lead's compounds instead of the word.
    expect(matches("A blunt edge leads to poor work, which led to his habit.")).toBeNull();
    expect(matches("The reader's leader sets the type.")).toBeNull();
    expect(matches("Fire the kiln to 1,200 degrees.")).toBeNull();
  });

  it("names, for every omission, a heading its source really prints", () => {
    for (const omission of OMISSIONS) expect(sources.byId.get(omission.source), omission.id).toBeDefined();
    expect(OMISSIONS.map((omission) => omission.id)).toContain("lead-glazes");
  });
});

describe("the sources and the manifest", () => {
  it("refuses a sources file whose licence evidence is missing", () => {
    const base = JSON.parse(readFileSync(join(HERE, "sources.json"), "utf8"));
    const withoutEvidence = structuredClone(base);
    delete withoutEvidence.sources[0].evidence;
    expect(() => assertSources(withoutEvidence)).toThrow(/licence evidence/);
    const withoutDigest = structuredClone(base);
    withoutDigest.sources[0].sha256 = "not a digest";
    expect(() => assertSources(withoutDigest)).toThrow(/no SHA-256/);
    expect(() => assertSources({ ...base, layout: 2 })).toThrow(/layout/);
  });

  it("writes a manifest the app can read, in both languages", () => {
    const meta = buildMetadata(appVersion());
    expect(meta.id).toBe(PACK_ID);
    expect(meta.kind).toBe("content");
    expect(meta.notice).toBe("safety");
    for (const field of ["title", "description"]) {
      expect(typeof meta[field].sr, field).toBe("string");
      expect(meta[field].sr.length, field).toBeGreaterThan(0);
      expect(meta[field].en.length, field).toBeGreaterThan(0);
    }
    // English copy carries no Serbian letter (the app's own rule), and the
    // Serbian copy is Serbian.
    expect(meta.title.en).not.toMatch(/[\u010d\u0107\u0161\u017e\u0111]/i);
    expect(meta.title.sr).toMatch(/[a-z]/);
    expect(meta.licence.attribution.length).toBeGreaterThan(40);
    expect(meta.minAppVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("keeps every pack id, chapter id and source id a folder name", () => {
    expect(PACK_ID).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const entry of PLAN) expect(entry.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const id of sources.byId.keys()) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
