import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BUILT_IN_PAGES,
  MANUAL_DIR,
  REPO_ROOT,
  compiledInModuleIds,
  kitModuleId,
  knownVocabulary,
  parseManualPage,
  readManual,
  scanRepo,
  settingsCategoryIds,
  validateManual,
} from "./check-manual.mjs";

/**
 * `check:manual` makes the assistant's knowledge of the app a property of the
 * tree rather than of whoever last read a page.
 *
 * The three things a wrong manual does are all silent. A page written for one
 * language and not the other ships as a manual half the users cannot read. A
 * `location` naming a module that no manifest declares makes the assistant offer
 * to open a place that does not exist — and the app is where the user finds out.
 * A `related` id that no page carries turns "where do I go next" into a dead end
 * in the one surface built to answer it. So this suite's first job is to show
 * the gate goes red on each of those, and its second is to show it stays quiet on
 * a well-formed pair, because a gate that fires on a correct page is one
 * somebody switches off.
 */

/** One well-formed Serbian page, as the knowledge run reads it. */
const GOOD_SR = `---
id: tasks-recurring
title: Ponavljajući zadaci
location: { module: tasks }
keywords: [ponavljanje, recurring, svaki dan]
---
Ponavljanje se postavlja na zadatku, u polju „Ponavljanje“.

1. Otvori zadatak i proširi „Detalji“.
2. Izaberi „Učestalost“ i „Završetak“.

Povezano: tasks-recurring
`;

/** The same page in English: the same id, its own words. */
const GOOD_EN = `---
id: tasks-recurring
title: Recurring tasks
location: { module: tasks }
keywords: [recurring, repeat, every day]
---
Repetition is set on the task itself, in the "Ponavljanje" field.

1. Open the task and expand "Details".
2. Choose "Frequency" and "End".

Related: tasks-recurring
`;

const page = (locale, source) => parseManualPage(locale, source).page;

describe("the front matter", () => {
  it("parses a well-formed page into its fields", () => {
    const parsed = parseManualPage("sr", GOOD_SR, "x.md");
    expect(parsed.findings).toEqual([]);
    expect(parsed.page).toMatchObject({
      id: "tasks-recurring",
      title: "Ponavljajući zadaci",
      location: { module: "tasks", settings: null },
      keywords: ["ponavljanje", "recurring", "svaki dan"],
      related: ["tasks-recurring"],
    });
  });

  it("reads a Settings-card location, where the page sits two levels deep", () => {
    const source = GOOD_SR.replace(
      "location: { module: tasks }",
      "location: { module: settings, settings: data }",
    );
    expect(parseManualPage("sr", source, "x.md").page?.location).toEqual({
      module: "settings",
      settings: "data",
    });
  });

  it("accepts a page with no location — a screen the assistant cannot open", () => {
    const source = GOOD_SR.replace("location: { module: tasks }\n", "");
    const parsed = parseManualPage("sr", source, "x.md");
    expect(parsed.findings).toEqual([]);
    expect(parsed.page?.location).toBeNull();
  });

  it("refuses a page with no front matter", () => {
    const parsed = parseManualPage("sr", "Samo tekst.\n\nPovezano: tasks\n", "x.md");
    expect(parsed.page).toBeNull();
    expect(parsed.findings[0]?.message).toContain("first line");
  });

  it("refuses front matter that is never closed", () => {
    const parsed = parseManualPage("sr", "---\nid: tasks\ntitle: Zadaci\n", "x.md");
    expect(parsed.page).toBeNull();
    expect(parsed.findings[0]?.message).toContain("never closed");
  });

  it("refuses an unknown key, a missing id and a non-kebab id", () => {
    expect(parseManualPage("sr", GOOD_SR.replace("keywords:", "tags:"), "x.md").findings).toContainEqual(
      expect.objectContaining({ message: "unknown front-matter key `tags`" }),
    );
    expect(parseManualPage("sr", GOOD_SR.replace("id: tasks-recurring\n", ""), "x.md").findings).toContainEqual(
      expect.objectContaining({ message: "no `id`" }),
    );
    expect(
      parseManualPage("sr", GOOD_SR.replace("id: tasks-recurring", "id: Tasks_Recurring"), "x.md").findings,
    ).toContainEqual(expect.objectContaining({ message: "id `Tasks_Recurring` is not kebab-case" }));
  });

  it("refuses a missing title", () => {
    expect(parseManualPage("sr", GOOD_SR.replace("title: Ponavljajući zadaci\n", ""), "x.md").findings).toContainEqual(
      expect.objectContaining({ message: "no `title`" }),
    );
  });

  it("refuses keywords that are not an inline list, and a list with nothing in it", () => {
    expect(parseManualPage("sr", GOOD_SR.replace("keywords: [ponavljanje, recurring, svaki dan]", "keywords: ponavljanje"), "x.md").findings)
      .toContainEqual(expect.objectContaining({ message: expect.stringContaining("inline list") }));
    expect(parseManualPage("sr", GOOD_SR.replace("keywords: [ponavljanje, recurring, svaki dan]", "keywords: []"), "x.md").findings)
      .toContainEqual(expect.objectContaining({ message: "`keywords` is empty" }));
  });

  it("refuses a settings value with no module, and a stray location key", () => {
    expect(
      parseManualPage("sr", GOOD_SR.replace("location: { module: tasks }", "location: { settings: data }"), "x.md").findings,
    ).toContainEqual(expect.objectContaining({ message: "location has no `module`" }));
    expect(
      parseManualPage("sr", GOOD_SR.replace("location: { module: tasks }", "location: { modul: tasks }"), "x.md").findings,
    ).toContainEqual(expect.objectContaining({ message: expect.stringContaining("neither `module` nor `settings`") }));
  });

  it("refuses a body with no related line, and one whose heading is the other language's", () => {
    expect(parseManualPage("sr", GOOD_SR.replace("Povezano: tasks-recurring", "Sve najbolje."), "x.md").findings)
      .toContainEqual(expect.objectContaining({ message: expect.stringContaining("`Povezano: <id>, <id>`") }));
    expect(parseManualPage("sr", GOOD_SR.replace("Povezano:", "Related:"), "x.md").findings)
      .toContainEqual(expect.objectContaining({ message: expect.stringContaining("`Povezano: <id>, <id>`") }));
    expect(parseManualPage("en", GOOD_EN.replace("Related:", "Povezano:"), "x.md").findings)
      .toContainEqual(expect.objectContaining({ message: expect.stringContaining("`Related: <id>, <id>`") }));
  });

  it("refuses a related line that lists nothing, and accepts a trailing full stop", () => {
    expect(parseManualPage("sr", GOOD_SR.replace("Povezano: tasks-recurring", "Povezano:"), "x.md").findings)
      .toContainEqual(expect.objectContaining({ message: "`Povezano:` lists no id" }));
    expect(parseManualPage("sr", GOOD_SR.replace("Povezano: tasks-recurring", "Povezano: tasks-recurring."), "x.md").page?.related)
      .toEqual(["tasks-recurring"]);
  });

  it("refuses an empty body", () => {
    const parsed = parseManualPage("sr", "---\nid: tasks\ntitle: Zadaci\nkeywords: [zadaci]\n---\n", "x.md");
    expect(parsed.findings).toContainEqual(expect.objectContaining({ message: "the body is empty" }));
  });
});

describe("the cross-page rules", () => {
  const vocabulary = knownVocabulary();
  const pair = () => [page("sr", GOOD_SR), page("en", GOOD_EN)];

  it("passes a paired, well-located page", () => {
    expect(validateManual(pair(), vocabulary)).toEqual([]);
  });

  it("refuses an id that appears twice in one language", () => {
    const findings = validateManual([...pair(), page("sr", GOOD_SR)], vocabulary);
    expect(findings).toContainEqual(expect.objectContaining({ message: "id `tasks-recurring` appears twice in `sr`" }));
  });

  it("refuses an id with no other-language half, in both directions", () => {
    expect(validateManual([page("sr", GOOD_SR)], vocabulary)).toContainEqual(
      expect.objectContaining({ locale: "sr", message: "`tasks-recurring` has no `en` page" }),
    );
    expect(validateManual([page("en", GOOD_EN)], vocabulary)).toContainEqual(
      expect.objectContaining({ locale: "en", message: "`tasks-recurring` has no `sr` page" }),
    );
  });

  it("refuses a module id no manifest declares", () => {
    const source = GOOD_SR.replace("location: { module: tasks }", "location: { module: zadaci }");
    expect(validateManual([page("sr", source), page("en", GOOD_EN)], vocabulary)).toContainEqual(
      expect.objectContaining({ message: "location.module `zadaci` is not a module id or built-in page" }),
    );
  });

  it("allows the shell's own built-in page as a module value", () => {
    const source = GOOD_SR.replace("location: { module: tasks }", `location: { module: ${BUILT_IN_PAGES[0]} }`);
    expect(validateManual([page("sr", source), page("en", GOOD_EN)], vocabulary)).toEqual([]);
  });

  it("refuses a Settings value that is not one of the eight categories", () => {
    const source = GOOD_SR.replace("location: { module: tasks }", "location: { module: settings, settings: sync }");
    expect(validateManual([page("sr", source), page("en", GOOD_EN)], vocabulary)).toContainEqual(
      expect.objectContaining({ message: "location.settings `sync` is not a Settings category" }),
    );
  });

  it("refuses a related id that is not a page, and accepts one that is", () => {
    const broken = GOOD_SR.replace("Povezano: tasks-recurring", "Povezano: tasks-recurring, mape");
    expect(validateManual([page("sr", broken), page("en", GOOD_EN)], vocabulary)).toContainEqual(
      expect.objectContaining({ message: "related id `mape` is not a page" }),
    );
    expect(validateManual(pair(), vocabulary)).toEqual([]);
  });
});

describe("the vocabulary the tree declares", () => {
  const modulesSource = readFileSync(join(REPO_ROOT, "apps", "desktop", "src", "shared", "modules.ts"), "utf8");

  it("reads the compiled-in module ids and no widget id", () => {
    const ids = compiledInModuleIds(modulesSource);
    expect(ids).toContain("tasks");
    expect(ids).toContain("electronics");
    // A widget id is an `id:` in the same file, and the scan is bracketed to
    // `V0_MODULES` precisely so that these two are not read as modules.
    expect(ids).not.toContain("danas");
    expect(ids).not.toContain("naplate");
    expect(ids).toHaveLength(16);
  });

  it("reads a discovered module's id out of its manifest", () => {
    const discovered = readFileSync(
      join(REPO_ROOT, "apps", "desktop", "src", "modules", "timers", "shared", "manifest.ts"),
      "utf8",
    );
    expect(kitModuleId(discovered)).toBe("timers");
  });

  it("reads the eight Settings categories off the union they are typed by", () => {
    const sections = readFileSync(
      join(REPO_ROOT, "apps", "desktop", "src", "shared", "settingsSections.ts"),
      "utf8",
    );
    expect(settingsCategoryIds(sections)).toEqual([
      "profile",
      "appearance",
      "keyboard",
      "modules",
      "notifications",
      "data",
      "privacy",
      "about",
    ]);
  });

  it("counts sixteen compiled-in modules plus the discovered ones", () => {
    const vocabulary = knownVocabulary();
    // 16 + 23 kit modules with a manifest (`modules/*/manifest.ts`).
    expect(vocabulary.moduleIds.size).toBe(39);
    expect(vocabulary.moduleIds.has("timers")).toBe(true);
    expect(vocabulary.settingsCategories.size).toBe(8);
  });

  it("keeps BUILT_IN_PAGES pinned to the shell constant it stands for", () => {
    const app = readFileSync(join(REPO_ROOT, "apps", "desktop", "src", "renderer", "src", "App.tsx"), "utf8");
    const searchPageId = /const SEARCH_PAGE_ID = "([a-z-]+)";/.exec(app)?.[1];
    expect(searchPageId).toBeDefined();
    expect(BUILT_IN_PAGES).toEqual([searchPageId]);
  });
});

describe("the pages in this tree", () => {
  it("are green, and are a tree rather than an empty folder", () => {
    const { findings, census } = scanRepo();
    expect(findings).toEqual([]);
    // Guards the guard: a walk that found nothing would pass the line above.
    expect(census.pages[0]).toBeGreaterThan(30);
    expect(census.pages[0]).toBe(census.pages[1]);
    expect(census.ids).toBe(census.pages[0]);
    expect(census.relatedEdges).toBeGreaterThan(census.pages[0]);
    expect(census.moduleIds).toBeGreaterThanOrEqual(17);
    expect(census.settingsCategories).toBe(8);
  });
});

describe("a fixture tree on disk", () => {
  const withPages = (sr, en) => {
    const root = mkdtempSync(join(tmpdir(), "check-manual-"));
    for (const [locale, source] of [["sr", sr], ["en", en]]) {
      const dir = join(root, ...MANUAL_DIR.split("/"), locale);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tasks-recurring.md"), source, "utf8");
    }
    return root;
  };

  it("reads a fixture pair and passes it against the real vocabulary", () => {
    const root = withPages(GOOD_SR, GOOD_EN);
    try {
      const read = readManual(root);
      expect(read.findings).toEqual([]);
      expect(read.pages).toHaveLength(2);
      expect(validateManual(read.pages, knownVocabulary())).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads a fixture folder that holds nothing, which is a finding and not a green run", () => {
    const root = mkdtempSync(join(tmpdir(), "check-manual-"));
    try {
      const read = readManual(root);
      expect(read.pages).toEqual([]);
      expect(read.findings).toHaveLength(2);
      expect(read.findings[0]?.message).toBe("no pages");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
