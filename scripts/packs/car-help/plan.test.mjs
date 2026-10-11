// The pack's own shape: what it says it contains, and what it may not.
//
// These are the rules the brief fixes for a signed folder — kebab-case ids
// unique inside the pack, a Source line at the end of every article, both
// languages in the manifest, a provenance article per section — checked here
// rather than at the merge, where a duplicate id is a Reader that shows two
// chapters and no way to tell which one a link meant.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { appVersion, assertSources, buildContent, buildMetadata, buildToc } from "./build.mjs";
import { OMITTED, SECTIONS, sourceLine } from "./plan.mjs";

const HERE = import.meta.dirname;
const SOURCES = assertSources(JSON.parse(readFileSync(join(HERE, "sources.json"), "utf8")));

/** The articles as the plan declares them, keyed by id, for the TOC builder. */
const PLAN_ARTICLES = new Map(SECTIONS.flatMap((section) => section.articles.map((article) => [article.id, article])));

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("the plan", () => {
  it("is the five sections the brief names, in that order", () => {
    expect(SECTIONS.map((section) => section.id)).toEqual(["stranded", "tyre", "battery", "overheating", "lights"]);
    expect(SECTIONS.map((section) => section.title)).toEqual([
      "I am stranded",
      "Tyre",
      "Battery",
      "Overheating",
      "Lights on the dashboard",
    ]);
  });

  it("gives every section and article a kebab-case id, unique in the pack", () => {
    const ids = [...SECTIONS.map((section) => section.id), ...SECTIONS.flatMap((section) => section.articles.map((a) => a.id))];
    for (const id of ids) expect(id).toMatch(KEBAB);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names a source of this pack for every article, and a page that source has for every OCR span", () => {
    for (const section of SECTIONS) {
      for (const article of section.articles) {
        const source = SOURCES.byId.get(article.source);
        expect(source, `${article.id} names ${article.source}`).toBeDefined();
        expect(article.title.length).toBeGreaterThan(3);
        expect(article.spans.length).toBeGreaterThan(0);
        for (const span of article.spans) {
          expect(typeof span.from).toBe("string");
          if (source.kind !== "ocr") continue;
          expect(span.page, `${article.id} is an OCR span without a page`).toBeDefined();
          expect(source.pages, `${article.source} lists the pages it is read on`).toContain(span.page);
        }
      }
    }
  });

  it("covers no article twice and every article in exactly one section", () => {
    const ids = SECTIONS.flatMap((section) => section.articles.map((article) => article.id));
    expect(ids).toHaveLength(PLAN_ARTICLES.size);
  });

  it("says what it leaves out, and names the two the brief names", () => {
    const text = OMITTED.map((item) => `${item.what} ${item.why}`).join(" ");
    expect(text).toMatch(/high-voltage/i);
    expect(text).toMatch(/Serbian and EU breakdown law/i);
    for (const item of OMITTED) expect(item.why.length).toBeGreaterThan(30);
  });
});

describe("sources.json", () => {
  it("pins every source with a digest, a size and licence evidence", () => {
    expect(SOURCES.byId.size).toBe(6);
    for (const source of SOURCES.byId.values()) {
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.bytes).toBeGreaterThan(0);
      expect(source.licenceQuote.length).toBeGreaterThan(40);
      expect(source.evidence.length).toBeGreaterThan(0);
    }
  });

  it("states every licence on a page this pack pins, and gives the scans a URL", () => {
    const urls = new Set([...SOURCES.byId.values()].map((source) => source.url));
    for (const source of SOURCES.byId.values()) {
      expect(urls, `${source.id} states its licence at ${source.licenceUrl}`).toContain(source.licenceUrl);
      if (source.kind !== "ocr") continue;
      expect(source.scanUrl).toMatch(/^https:\/\/archive\.org\/download\//);
      expect(source.vocabulary.length).toBeGreaterThan(0);
    }
  });
});

describe("content.json and pack.json", () => {
  const toc = buildToc(PLAN_ARTICLES, SOURCES.byId);

  it("is layout 1, one language, and the safety notice", () => {
    expect(buildContent(toc)).toEqual({ layout: 1, language: "en", notice: "safety", toc });
  });

  it("draws one chapter per section, with the provenance block last", () => {
    expect(toc.map((chapter) => chapter.id)).toEqual(SECTIONS.map((section) => section.id));
    for (const chapter of toc) {
      const last = chapter.children[chapter.children.length - 1];
      expect(last.id).toBe(`${chapter.id}-sources`);
      expect(last.file).toBe(`articles/${chapter.id}-sources.md`);
      expect(last.source).toBeUndefined();
      // The plan's own articles come first, in plan order, each with the source
      // a reader can go and read.
      const planned = SECTIONS.find((section) => section.id === chapter.id).articles;
      expect(chapter.children.slice(0, -1).map((entry) => entry.id)).toEqual(planned.map((article) => article.id));
      for (const entry of chapter.children.slice(0, -1)) {
        expect(entry.file).toBe(`articles/${entry.id}.md`);
        expect(entry.source.url).toMatch(/^https:\/\//);
        expect(entry.source.title.length).toBeGreaterThan(10);
      }
    }
  });

  it("gives every file in the pack one unique path, articles and provenance alike", () => {
    const files = toc.flatMap((chapter) => chapter.children.map((entry) => entry.file));
    expect(new Set(files).size).toBe(files.length);
    for (const file of files) expect(file).toMatch(/^articles\/[a-z0-9-]+\.md$/);
  });

  it("declares a content pack in two languages, under one licence, at this app's version", () => {
    const meta = buildMetadata("1.2.3");
    expect(meta).toMatchObject({ format: 1, kind: "content", minAppVersion: "1.2.3" });
    expect(meta.id).toMatch(KEBAB);
    expect(meta.version).toMatch(/^\d{4}\.\d{2}\.\d+$/);
    expect(meta.title.sr.length).toBeGreaterThan(0);
    expect(meta.title.en.length).toBeGreaterThan(0);
    expect(meta.description.sr.length).toBeGreaterThan(0);
    expect(meta.description.en.length).toBeGreaterThan(0);
    expect(meta.licence.spdx).toBe("LicenseRef-PD-USGov");
    expect(meta.licence.attribution).toContain("17 U.S.C. 105(a)");
    expect(meta.licence.url).toBe(SOURCES.byId.get("us-code-105").url);
    expect(meta.source.url).toMatch(/^https:\/\//);
    expect(appVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    // The manifest's key set is closed: the app refuses a field the format does
    // not define, so a typo or an extra key has to fail here rather than at
    // install time, after the release key has already signed it.
    expect(Object.keys(meta)).toEqual([
      "format",
      "id",
      "version",
      "kind",
      "title",
      "description",
      "licence",
      "source",
      "minAppVersion",
    ]);
    expect(Object.keys(meta.licence)).toEqual(["spdx", "attribution", "url"]);
    expect(Object.keys(meta.title)).toEqual(["sr", "en"]);
    expect(Object.keys(meta.description)).toEqual(["sr", "en"]);
  });
});

describe("the Source line", () => {
  it("names the work, the section and the URL, and sits outside the fidelity test", () => {
    const article = PLAN_ARTICLES.get("battery-jump-starting");
    const source = SOURCES.byId.get(article.source);
    const line = sourceLine(source, article);
    expect(line.startsWith("*Source: ")).toBe(true);
    expect(line.endsWith("*")).toBe(true);
    expect(line).toContain(`Section: ${article.title}.`);
    expect(line).toContain(source.url);
    // The URL is plain text, not a Markdown link: the pack is read offline and
    // the shell has no vetted external-link wrapper yet.
    expect(line).not.toContain("](");
  });
});
