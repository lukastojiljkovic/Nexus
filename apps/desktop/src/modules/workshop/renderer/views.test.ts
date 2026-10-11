import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { applyLocale, DEFAULT_LOCALE } from "../../../renderer/src/strings.js";
import { isViewer, viewLabel, WORKSHOP_VIEWS } from "./views.js";

/**
 * The workshop page's five views (ADR-107's wiring of the two tool sets).
 *
 * Two things are worth failing over, and neither is visible from the compiler:
 * the ORDER of the segments (the three viewers keep the order main's picker and
 * the recent list use, and the tools come after them), and that every view has
 * real words in BOTH languages — an empty label typechecks and photographs as a
 * blank segment.
 *
 * The last assertion is the wiring itself, read from the page's source: this
 * package has no DOM library, so a component cannot be rendered here, and "the
 * tools are views of the page" is exactly the kind of statement a source check
 * can make honestly (`labels.test.ts` in the astronomy module reads its
 * stylesheet the same way).
 */

afterEach(() => {
  applyLocale(DEFAULT_LOCALE);
});

describe("the page's views", () => {
  it("draws the three viewers first and the two tool sets after them", () => {
    expect(WORKSHOP_VIEWS).toEqual(["model", "toolpath", "board", "pdf", "images"]);
    expect(WORKSHOP_VIEWS.filter((view) => isViewer(view))).toEqual([
      "model",
      "toolpath",
      "board",
    ]);
  });

  it("labels every view in both languages, with the viewers' own words", () => {
    const serbian = WORKSHOP_VIEWS.map((view) => viewLabel(view));
    expect(serbian).toEqual(["Model", "G-kod", "Gerber", "PDF", "Slike"]);
    applyLocale("en");
    const english = WORKSHOP_VIEWS.map((view) => viewLabel(view));
    expect(english).toEqual(["Model", "G-code", "Gerber", "PDF", "Images"]);
    for (const label of [...serbian, ...english]) expect(label.trim()).not.toBe("");
  });

  it("hands each tool set its own file API in the page's JSX", () => {
    const page = readFileSync(new URL("./Page.tsx", import.meta.url), "utf8");
    expect(page).toContain("<PdfTools files={files} />");
    expect(page).toContain("<ImageTools files={files} />");
    // And the API is the module's own contract: a tool set reaching for a
    // shell-wide call would be a second door beside the contract's.
    expect(page).toContain("window.nexus.modules.workshop");
  });
});
