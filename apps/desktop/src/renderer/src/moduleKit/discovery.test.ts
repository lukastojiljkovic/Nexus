import { afterEach, describe, expect, it } from "vitest";
import { createModuleRegistry, kitManifest, kitManifests } from "../../../shared/modules.js";
import { copy as timersCopy } from "../../../modules/timers/renderer/copy.js";
import { sr as timersSr } from "../../../modules/timers/renderer/copy.sr.js";
import { en as timersEn } from "../../../modules/timers/renderer/copy.en.js";
import { dashboardWidgetRenderer } from "../dashboardWidgets.js";
import { settingsPanelRenderer } from "../moduleSettingsPanels.js";
import { applyLocale, activeLocale } from "../strings.js";
import { kitIconIds } from "./icons.js";
import { resolveLabel } from "./labels.js";
import { hasModulePage, modulePageIds, modulePage } from "./pages.js";
import { kitSettingsPanel } from "./settings.js";
import { kitWidgetIds } from "./widgets.js";

/**
 * The kit's discovery, seen from the renderer (ADR-090).
 *
 * Every one of these is a property a file ADDING itself has to have, and none is
 * a list anybody maintains: the manifest, the page, the icon, the settings body
 * and the widget body are each found by a glob. "Found nothing" and "looked at
 * nothing" must not be the same green line, so each test also asks whether the
 * discovery saw the module at all.
 */

/** The one kit module this branch ships; a second one is a second line here, deliberately. */
const TIMERS = "timers";

describe("the manifests the registry discovers", () => {
  it("registers a kit module after every compiled-in one, in its declared order", () => {
    const ids = createModuleRegistry()
      .all()
      .map((manifest) => manifest.id);

    expect(ids).toContain(TIMERS);
    // The compiled-in sixteen keep the order they were written in, and the
    // discovered ones follow — which is what `ModuleManifest.order` is for.
    expect(ids.indexOf(TIMERS)).toBeGreaterThan(ids.indexOf("pro"));
  });

  it("carries the words the shell needs before the page can load", () => {
    const manifest = kitManifest(TIMERS);
    expect(manifest).toBeDefined();
    // A pair for both locales, resolved through the locale the shell is reading:
    // this is what the rail, the settings gallery and the onboarding row draw.
    expect(manifest?.copy?.name.sr).not.toBe("");
    expect(manifest?.copy?.name.en).not.toBe("");
    expect(manifest?.copy?.description.sr).not.toBe("");
    expect(manifest?.copy?.description.en).not.toBe("");
    expect(kitManifests().map((each) => each.id)).toContain(TIMERS);
  });
});

describe("the page, the icon, the settings body and the widget body", () => {
  it("finds the module's page, lazily", () => {
    expect(hasModulePage(TIMERS)).toBe(true);
    expect(modulePageIds()).toContain(TIMERS);
    expect(modulePage(TIMERS)).not.toBeNull();
    // A module this build does not ship has no page — and answering `null`
    // rather than somebody else's is what keeps the shell honest about it.
    expect(hasModulePage("ghost")).toBe(false);
    expect(modulePage("ghost")).toBeNull();
  });

  it("finds the module's own mark, and resolves it through the shell's icon lookup", () => {
    expect(kitIconIds()).toContain(TIMERS);
  });

  it("finds the module's settings card body, and pairs it with the declared control", () => {
    expect(kitSettingsPanel(TIMERS)).toBeDefined();
    expect(settingsPanelRenderer(TIMERS)).toBeDefined();
    const declared = kitManifest(TIMERS)?.settings;
    expect(declared?.controls.map((control) => control.key)).toEqual(["sound-on-end"]);
    // The label the filter indexes and the label the card draws are one value,
    // so `resolveLabel` has to answer it — a declared pair, not a `strings` path.
    expect(resolveLabel(declared?.controls[0]?.labelKey ?? "")).not.toBe("");
  });

  it("finds the module's widget body, under the id the manifest declares", () => {
    const declared = kitManifest(TIMERS)?.widgets?.map((widget) => widget.id) ?? [];
    expect(declared).toEqual(["odbrojavanja"]);
    expect(kitWidgetIds()).toContain(`${TIMERS}:odbrojavanja`);
    const renderer = dashboardWidgetRenderer(`${TIMERS}:odbrojavanja`);
    expect(renderer).toBeDefined();
    // The card follows its own module's flag, which is the whole of what
    // `visible` is asked.
    expect(renderer?.visible(new Set([TIMERS]))).toBe(true);
    expect(renderer?.visible(new Set())).toBe(false);
  });
});

describe("a kit module's copy", () => {
  afterEach(() => {
    applyLocale("sr");
  });

  it("joins the locale machinery, keeping the table's identity across a switch", () => {
    const table = timersCopy;
    expect(timersCopy.page.subtitle).toBe(timersSr.page.subtitle);

    applyLocale("en");
    // The same object, rewritten in place: a component that took a subtree alias
    // keeps reading the section being rewritten, which is the property
    // `strings.ts`'s header explains and `check:string-capture` guards.
    expect(timersCopy).toBe(table);
    expect(timersCopy.page.subtitle).toBe(timersEn.page.subtitle);
    expect(activeLocale()).toBe("en");

    applyLocale("sr");
    expect(timersCopy.page.subtitle).toBe(timersSr.page.subtitle);
  });

  it("has exactly the shape of the Serbian table — at compile time and here", () => {
    // The compiler already refuses a missing or invented key (`en: typeof sr`);
    // this is the runtime half, so a nested table that somehow diverged by
    // mutation is caught too.
    const paths = (value: unknown, prefix = ""): string[] => {
      if (typeof value !== "object" || value === null) return [prefix];
      return Object.entries(value).flatMap(([key, child]) =>
        paths(child, prefix === "" ? key : `${prefix}.${key}`),
      );
    };
    expect(paths(timersEn).sort()).toEqual(paths(timersSr).sort());
  });
});
