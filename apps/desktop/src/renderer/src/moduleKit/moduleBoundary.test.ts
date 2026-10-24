import { describe, expect, it } from "vitest";

/**
 * The kit's one door, enforced (UXB-01).
 *
 * `moduleSurface.ts` says it is the one place a kit module reaches the shell,
 * and that is only a claim until something fails when a module reaches past it.
 * Every module file under `src/modules/` is read here, and an import of the
 * shell's `renderer/src/` that does not go through `moduleKit/` is a failure.
 *
 * The allowlist is the set of files that already reach past the kit when this
 * test was written. Each entry names why, and the list is meant to shrink: an
 * entry whose file no longer reaches past the kit fails the second test, so the
 * entry is removed rather than left to rot. A new entry is a regression of the
 * door, not a convenience.
 */

const sources = import.meta.glob("../../../modules/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const MODULES_PREFIX = "../../../modules/";

/** Every import, re-export and dynamic import specifier in a source file. */
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

/** The shell specifiers a source file reaches for outside `moduleKit/`. */
function shellReaches(source: string): string[] {
  return [...source.matchAll(SPECIFIER)]
    .map((match) => match[1] ?? "")
    .filter((specifier) => specifier.includes("renderer/src/") && !specifier.includes("renderer/src/moduleKit/"));
}

const REASONS = {
  strings:
    "reads the shell's string helpers (fill, countUnit) directly; moduleSurface does not re-export them yet (Locale is on it, so an import of Locale converts)",
  intl: "reads the shell's Intl helpers directly; the call site converts when the file is next touched",
  money: "formats money through the shell directly; formatMoney is on moduleSurface, so the call site converts",
  links: "opens links through the shell's helper directly; openExternal is on moduleSurface, so the call site converts",
  timeFormat: "reads the shell's time formatting directly; not on moduleSurface yet",
  fileRows: "reads the shell's file-row helpers directly; not on moduleSurface yet",
  safetyNotice: "draws the shell's safety notice directly; no kit component for it exists yet",
  confirmDialog: "imports the renderer's ConfirmDialog; moduleSurface exports the same component, so the import converts",
  focusTrap: "imports the renderer's focus trap; the kit Dialog replaces it when this dialog converts",
  dashboardWidgets: "the discovery test reads the shell's dashboard widget registry, which is what it checks",
  testStorage: "a test that stubs the shell's storage; test helpers are not part of the kit surface",
} as const;

type Reason = keyof typeof REASONS;

/** Files under `modules/` that reach past the kit, keyed by path under `modules/`. */
const ALLOWLIST: Record<string, Reason> = {
  "arcade/renderer/copy.ts": "strings",
  "arcade/renderer/format.test.ts": "strings",
  "arcade/renderer/format.ts": "intl",
  "arcade/renderer/labels.test.ts": "strings",
  "arcade/renderer/labels.ts": "timeFormat",
  "assistant/renderer/Page.tsx": "safetyNotice",
  "assistant/renderer/copy.ts": "strings",
  "assistant/renderer/thread.test.ts": "strings",
  "astronomy/renderer/bodyCard.test.ts": "strings",
  "astronomy/renderer/copy.ts": "strings",
  "astronomy/renderer/earth/EarthDayNightMap.tsx": "intl",
  "astronomy/renderer/earth/copy.ts": "strings",
  "astronomy/renderer/prefs.test.ts": "testStorage",
  "astronomy/renderer/solar/SolarSystemView.tsx": "strings",
  "astronomy/renderer/solar/bodies.ts": "strings",
  "astronomy/renderer/stars/copy.ts": "strings",
  "astronomy/renderer/sunmoon/PlacePicker.tsx": "intl",
  "astronomy/renderer/sunmoon/SunMoonPanel.tsx": "intl",
  "astronomy/renderer/sunmoon/copy.ts": "strings",
  "boards/renderer/Page.tsx": "intl",
  "boards/renderer/Widgets.tsx": "intl",
  "boards/renderer/copy.ts": "strings",
  "boards/renderer/panels.tsx": "intl",
  "calculator/renderer/copy.ts": "strings",
  "car/renderer/carView.test.ts": "strings",
  "car/renderer/carView.ts": "money",
  "car/renderer/copy.ts": "strings",
  "cards/renderer/Page.tsx": "intl",
  "cards/renderer/Widgets.tsx": "intl",
  "cards/renderer/copy.ts": "strings",
  "chess/renderer/Page.tsx": "confirmDialog",
  "chess/renderer/Widgets.tsx": "intl",
  "chess/renderer/clock.test.ts": "strings",
  "chess/renderer/clock.ts": "intl",
  "chess/renderer/copy.ts": "strings",
  "cookbook/renderer/Page.tsx": "focusTrap",
  "cookbook/renderer/cookbook.test.ts": "strings",
  "cookbook/renderer/cookbook.ts": "intl",
  "cookbook/renderer/copy.ts": "strings",
  "culture/renderer/Page.tsx": "intl",
  "culture/renderer/Widgets.tsx": "intl",
  "culture/renderer/copy.ts": "strings",
  "drawings/renderer/Page.tsx": "links",
  "drawings/renderer/copy.ts": "strings",
  "emergency/renderer/copy.ts": "strings",
  "gallery/renderer/copy.ts": "strings",
  "lab/renderer/BatteryCard.tsx": "strings",
  "lab/renderer/SerialCard.tsx": "strings",
  "lab/renderer/ToneCard.tsx": "strings",
  "lab/renderer/copy.ts": "strings",
  "library/renderer/copy.ts": "strings",
  "library/renderer/discovery.test.ts": "dashboardWidgets",
  "library/renderer/library.ts": "intl",
  "maps/renderer/PinDialog.tsx": "focusTrap",
  "maps/renderer/copy.ts": "strings",
  "miniapps/renderer/copy.ts": "strings",
  "miniapps/renderer/format.test.ts": "strings",
  "pantry/renderer/copy.ts": "strings",
  "pantry/renderer/pantryPage.test.ts": "strings",
  "pantry/renderer/pantryPage.ts": "intl",
  "puzzles/renderer/copy.ts": "strings",
  "puzzles/renderer/format.ts": "strings",
  "reader/renderer/Page.tsx": "focusTrap",
  "reader/renderer/copy.ts": "strings",
  "recorder/renderer/Page.tsx": "intl",
  "recorder/renderer/copy.ts": "strings",
  "recorder/renderer/entries.ts": "intl",
  "scanner/renderer/Page.tsx": "intl",
  "scanner/renderer/copy.ts": "strings",
  "signals/renderer/copy.ts": "strings",
  "timers/renderer/copy.ts": "strings",
  "translator/renderer/Page.tsx": "strings",
  "translator/renderer/copy.ts": "strings",
  "translator/renderer/pageViews.test.ts": "strings",
  "translator/renderer/translate/TranslateTab.tsx": "strings",
  "translator/renderer/prefs.test.ts": "testStorage",
  "wiki/renderer/copy.ts": "strings",
  "workshop/renderer/copy.ts": "strings",
  "workshop/renderer/format.test.ts": "strings",
  "workshop/renderer/format.ts": "intl",
  "workshop/renderer/images/ImageTools.tsx": "fileRows",
  "workshop/renderer/images/text.ts": "strings",
  "workshop/renderer/pdf/PdfTools.tsx": "fileRows",
  "workshop/renderer/pdf/text.ts": "strings",
  "workshop/renderer/recentFiles.test.ts": "testStorage",
  "workshop/renderer/views.test.ts": "strings",
};

/** Module files, keyed by their path under `modules/`, that reach past the kit. */
function reachingFiles(): Map<string, string[]> {
  const reaching = new Map<string, string[]>();
  for (const [path, source] of Object.entries(sources)) {
    const specifiers = shellReaches(source);
    if (specifiers.length > 0) reaching.set(path.slice(MODULES_PREFIX.length), specifiers);
  }
  return reaching;
}

describe("the kit is the one door a module reaches the shell through", () => {
  it("finds the module files, so the rule below is not checking nothing", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it("fails on any module file that reaches past moduleKit/ and is not allowlisted", () => {
    const offenders = [...reachingFiles().keys()].filter((path) => !(path in ALLOWLIST));
    expect(offenders).toEqual([]);
  });

  it("gives every allowlist entry a reason from the table above", () => {
    const unexplained = Object.entries<string>(ALLOWLIST).filter(([, reason]) => !(reason in REASONS));
    expect(unexplained.map(([path]) => path)).toEqual([]);
  });

  it("fails on an allowlist entry whose file no longer reaches past the kit, so the entry is removed", () => {
    const reaching = reachingFiles();
    const stale = Object.keys(ALLOWLIST).filter((path) => !reaching.has(path));
    expect(stale).toEqual([]);
  });
});
