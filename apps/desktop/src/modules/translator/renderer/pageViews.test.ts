import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { applyLocale, DEFAULT_LOCALE } from "../../../renderer/src/strings.js";
import { copy } from "./copy.js";

/**
 * The page's two tabs, wired to what they draw.
 *
 * **Why this reads the source rather than rendering it.** This package has no
 * DOM library (vitest.config.ts says so at length), so a component cannot be
 * mounted here — and the properties that matter are wiring facts anyway: the
 * Translate tab is the default and draws `TranslateTab`, the assistant's request
 * reaches it through `translateRequestOf`, and the pack list it reads comes from
 * THIS module's ops rather than from a shell-wide call. Both are statements about
 * the files, and `labels.test.ts` in the astronomy module reads its own stylesheet
 * for the same reason.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

afterEach(() => {
  applyLocale(DEFAULT_LOCALE);
});

describe("the page's tabs", () => {
  it("opens on the Translate tab, which draws the translator and is handed the assistant's request", () => {
    const page = readFileSync(join(HERE, "Page.tsx"), "utf8");
    expect(page).toContain('useState<TranslatorTab>("translate")');
    expect(page).toContain("<TranslateTab request={translateRequest}");
    expect(page).toContain("translateRequestOf(intent)");
    expect(page).not.toContain("sentences");
  });

  it("reads the installed models through the module's own ops", () => {
    const tab = readFileSync(join(HERE, "translate", "TranslateTab.tsx"), "utf8");
    expect(tab).toContain("window.nexus.modules.translator.packs({})");
    expect(tab).toContain("new TranslationSession(window.nexus.modules.translator, setView)");
  });

  it("leaves no marker asking for wiring the page already has", () => {
    for (const file of readdirSync(HERE, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".tsx")) continue;
      const source = readFileSync(join(HERE, file.name), "utf8");
      expect(source, file.name).not.toContain("TODO(sentences)");
      expect(source, file.name).not.toContain("TODO(external-links)");
    }
  });

  it("names both tabs in both languages, because a tab with no word is invisible", () => {
    const serbian = copy.translate.tab;
    expect(serbian.trim()).not.toBe("");
    applyLocale("en");
    expect(copy.translate.tab.trim()).not.toBe("");
    expect(copy.translate.tab).not.toBe(serbian);
  });
});
