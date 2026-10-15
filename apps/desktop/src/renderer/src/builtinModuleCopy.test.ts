import { describe, expect, it } from "vitest";
import { BUILTIN_MODULE_COPY } from "../../shared/builtinModuleCopy.js";
import { createModuleRegistry } from "../../shared/modules.js";
import { en } from "./strings.en.js";
import { sr } from "./strings.sr.js";

describe("BUILTIN_MODULE_COPY", () => {
  it("holds the renderer's own words for every compiled-in module, in both locales", () => {
    const builtIn = createModuleRegistry()
      .all()
      .filter((manifest) => manifest.copy === undefined)
      .map((manifest) => manifest.id);
    expect(Object.keys(BUILTIN_MODULE_COPY).sort()).toEqual([...builtIn].sort());
    for (const [locale, strings] of [["sr", sr], ["en", en]] as const) {
      const names: Record<string, string> = strings.modules;
      const descriptions: Record<string, string> = strings.settings.moduleDescriptions;
      for (const id of builtIn) {
        expect(BUILTIN_MODULE_COPY[id]?.name[locale], `${id} ${locale}`).toBe(names[id]);
        expect(BUILTIN_MODULE_COPY[id]?.description[locale], `${id} ${locale}`).toBe(descriptions[id]);
      }
    }
  });
});
