import { afterEach, describe, expect, it } from "vitest";
import { createModuleRegistry, kitManifest, kitManifests } from "../../../shared/modules.js";
import { dashboardWidgetRenderer } from "../../../renderer/src/dashboardWidgets.js";
import { applyLocale, activeLocale } from "../../../renderer/src/strings.js";
import { kitIconIds } from "../../../renderer/src/moduleKit/icons.js";
import { hasModulePage, modulePage, modulePageIds } from "../../../renderer/src/moduleKit/pages.js";
import { kitWidgetIds } from "../../../renderer/src/moduleKit/widgets.js";
import { copy } from "./copy.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * BIBLIOTEKA as the SHELL discovers it: the manifest the registry holds, the
 * page, the mark, the card and the copy table.
 *
 * The kit's own `moduleKit/discovery.test.ts` pins the discovery MECHANISM
 * against the reference module, which is the right subject for that file. What
 * it cannot say is whether THIS module was discovered - a folder named wrong, a
 * manifest that fails to register or a widget id the manifest and the renderer
 * spell differently are all invisible there and silent in the app. Each
 * assertion below therefore asks about this module by name.
 */

const LIBRARY = "library";

afterEach(() => {
  applyLocale("sr");
});

describe("the manifest the registry discovers", () => {
  it("registers after every compiled-in module and after Tajmeri, in the culture group", () => {
    const ids = createModuleRegistry()
      .all()
      .map((manifest) => manifest.id);
    expect(ids).toContain(LIBRARY);
    expect(ids.indexOf(LIBRARY)).toBeGreaterThan(ids.indexOf("timers"));

    const manifest = kitManifest(LIBRARY);
    expect(manifest?.group).toBe("culture");
    expect(manifest?.order).toBe(110);
    expect(manifest?.prefix).toBe("LIB");
    expect(manifest?.defaultEnabled).toBe(true);
    // No settings card, and that is a decision the manifest's own comment
    // argues: the module has no preference worth keeping.
    expect(manifest?.settings).toBeUndefined();
  });

  it("carries the words the shell needs before the page can load, in both languages", () => {
    const manifest = kitManifest(LIBRARY);
    expect(manifest?.copy?.name.sr).toBe("Biblioteka");
    expect(manifest?.copy?.name.en).toBe("Library");
    expect(manifest?.copy?.description.sr).not.toBe("");
    expect(manifest?.copy?.description.en).not.toBe("");
    expect(kitManifests().map((each) => each.id)).toContain(LIBRARY);
  });
});

describe("the page, the mark and the card", () => {
  it("finds this module's page, lazily", () => {
    expect(hasModulePage(LIBRARY)).toBe(true);
    expect(modulePageIds()).toContain(LIBRARY);
    expect(modulePage(LIBRARY)).not.toBeNull();
  });

  it("finds this module's own mark", () => {
    expect(kitIconIds()).toContain(LIBRARY);
  });

  it("publishes its card under the id its manifest declares, and follows its own flag", () => {
    const declared = kitManifest(LIBRARY)?.widgets?.map((widget) => widget.id) ?? [];
    expect(declared).toEqual(["trenutno"]);
    expect(kitWidgetIds()).toContain(`${LIBRARY}:trenutno`);
    const renderer = dashboardWidgetRenderer(`${LIBRARY}:trenutno`);
    expect(renderer).toBeDefined();
    expect(renderer?.visible(new Set([LIBRARY]))).toBe(true);
    expect(renderer?.visible(new Set())).toBe(false);
  });
});

describe("this module's copy", () => {
  it("joins the locale machinery, keeping the table's identity across a switch", () => {
    const table = copy;
    expect(copy.page.subtitle).toBe(sr.page.subtitle);

    applyLocale("en");
    // The same object, rewritten in place: a component that took a subtree
    // alias keeps reading the section being rewritten.
    expect(copy).toBe(table);
    expect(copy.page.subtitle).toBe(en.page.subtitle);
    expect(activeLocale()).toBe("en");

    applyLocale("sr");
    expect(copy.page.subtitle).toBe(sr.page.subtitle);
  });

  it("has exactly the shape of the Serbian table", () => {
    // The compiler already refuses a missing or invented key (`en: typeof sr`);
    // this is the runtime half, so a nested table that somehow diverged by
    // mutation is caught too.
    const paths = (value: unknown, prefix = ""): string[] => {
      if (typeof value !== "object" || value === null) return [prefix];
      return Object.entries(value).flatMap(([key, child]) =>
        paths(child, prefix === "" ? key : `${prefix}.${key}`),
      );
    };
    expect(paths(en).sort()).toEqual(paths(sr).sort());
  });
});
