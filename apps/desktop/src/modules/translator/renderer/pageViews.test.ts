import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { applyLocale, DEFAULT_LOCALE } from "../../../renderer/src/strings.js";
import { copy } from "./copy.js";

/**
 * The page's second tab, wired to the sentence translator.
 *
 * **Why this reads the source rather than rendering it.** This package has no
 * DOM library (vitest.config.ts says so at length), so a component cannot be
 * mounted here — and the property that matters is a wiring fact anyway: the tab
 * draws `SentenceTranslator` instead of the placeholder that asked for it, and
 * the pack list it hands over comes from THIS module's ops rather than from a
 * shell-wide call. Both are statements about the file, and `labels.test.ts` in
 * the astronomy module reads its own stylesheet for the same reason.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

afterEach(() => {
  applyLocale(DEFAULT_LOCALE);
});

describe("the sentences view", () => {
  it("renders the sentence translator, with its packs loaded from the module's own ops", () => {
    const page = readFileSync(join(HERE, "Page.tsx"), "utf8");
    expect(page).toContain("<SentenceTranslator");
    expect(page).toContain("window.nexus.modules.translator.packs({})");
    // The placeholder's two sentences are gone from the page; the copy leaves
    // they used went with them (check:copy would have named them).
    expect(page).not.toContain("needsPack");
  });

  it("leaves no marker asking for the wiring it now has", () => {
    for (const file of readdirSync(HERE, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".tsx")) continue;
      const source = readFileSync(join(HERE, file.name), "utf8");
      expect(source, file.name).not.toContain("TODO(sentences)");
      expect(source, file.name).not.toContain("TODO(external-links)");
    }
  });

  it("names the tab in both languages, because a segment with no word is invisible", () => {
    expect(copy.sentences.title.trim()).not.toBe("");
    const serbian = copy.sentences.title;
    applyLocale("en");
    expect(copy.sentences.title.trim()).not.toBe("");
    expect(copy.sentences.title).not.toBe(serbian);
  });
});
