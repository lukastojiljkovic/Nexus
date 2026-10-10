import { TOOL_PACKS, buildNoteUpdate, packFlagKey, parseMarkdownNote } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { NOTE_UPDATE_MAX_BYTES } from "../../shared/ipc.js";
import { createModuleRegistry, LOCKED_MODULE_IDS } from "../../shared/modules.js";
import {
  ESSENTIALS_MODULE_PRESET,
  applyPackSelection,
  moduleFlagWrites,
  packFlagWrites,
  packInventory,
  resolveModuleSelection,
  resolvePackSelection,
  selectableModuleIds,
} from "../../shared/onboardingPresets.js";
import { strings } from "./strings.js";

/**
 * ADR-065's declarative data: „Osnovno", the pack inventory the questionnaire's
 * „Tvoja nedelja" screen offers, and the copy of the one starter row the flow
 * writes. Lives beside `modules.test.ts` (and not in `src/shared/`) because
 * that is where the desktop package's Vitest looks — the same reason the
 * module registry's own test lives here.
 *
 * The load-bearing suite is the first one: every expectation derives the id set
 * from the LIVE registry rather than from a hardcoded copy, so registering a
 * module without deciding its „Osnovno“ place fails here rather than silently
 * inheriting `defaultEnabled` on somebody's first run.
 */

const registry = createModuleRegistry();
const SELECTABLE = selectableModuleIds(registry).sort();
const DECLARED_TOOLS = registry.all().flatMap((manifest) => manifest.tools ?? []);

describe("the questionnaire's module tables cover exactly the registry", () => {
  it("offers every registered module except the locked pair", () => {
    expect(selectableModuleIds(registry)).toEqual(
      registry.all().map((manifest) => manifest.id).filter((id) => !LOCKED_MODULE_IDS.has(id)),
    );
    for (const id of LOCKED_MODULE_IDS) {
      expect(selectableModuleIds(registry), id).not.toContain(id);
    }
  });

  it("decides every selectable module in „Osnovno“ — a new module cannot inherit a silent default", () => {
    expect(Object.keys(ESSENTIALS_MODULE_PRESET).sort()).toEqual(SELECTABLE);
  });
});

describe("ESSENTIALS_MODULE_PRESET", () => {
  it("equals the live manifests' defaultEnabled for every selectable module — „Osnovno“ IS the shipped defaults", () => {
    // Built independently of `resolveModuleSelection` (which this same preset
    // feeds elsewhere): every selectable manifest's own `defaultEnabled`, walked
    // straight off the registry, with no other reader in between.
    const expected: Record<string, boolean> = {};
    for (const manifest of registry.all()) {
      if (LOCKED_MODULE_IDS.has(manifest.id)) continue;
      expected[manifest.id] = manifest.defaultEnabled;
    }
    expect(ESSENTIALS_MODULE_PRESET).toEqual(expected);
  });

  it("leaves PRIV off — the opt-in section is never pre-chosen (ADR-057)", () => {
    expect(ESSENTIALS_MODULE_PRESET["priv"]).toBe(false);
  });

  it("leaves PRO off — a drawer whose every tool needs a pack is empty until one is granted", () => {
    expect(ESSENTIALS_MODULE_PRESET["pro"]).toBe(false);
  });
});

describe("packInventory", () => {
  it("counts each pack straight off the live registry", () => {
    const inventory = packInventory(registry);
    for (const { pack, toolCount } of inventory) {
      expect(
        toolCount,
        pack,
      ).toBe(DECLARED_TOOLS.filter((tool) => tool.packs?.includes(pack)).length);
      // A pack with nothing to build a card out of has no business being
      // offered — see the function's own comment — so every row here must be
      // strictly positive, never merely non-negative.
      expect(toolCount, pack).toBeGreaterThan(0);
    }
  });

  it("lists only packs that actually have a tool, in TOOL_PACKS order", () => {
    const inventory = packInventory(registry);
    const packsWithTools = TOOL_PACKS.filter((pack) =>
      DECLARED_TOOLS.some((tool) => tool.packs?.includes(pack)),
    );
    expect(inventory.map((entry) => entry.pack)).toEqual(packsWithTools);
  });

  it("carries „softver“ with its real, live-counted total", () => {
    const softver = packInventory(registry).find((entry) => entry.pack === "softver");
    expect(softver?.toolCount).toBe(
      DECLARED_TOOLS.filter((tool) => tool.packs?.includes("softver")).length,
    );

    // The anchor is the DEVELOPER TOOLKIT, not the pack's total, and the two
    // stopped being the same number the moment other toolkits started sharing
    // into it — a CSS unit converter is a designer's and a front-end
    // developer's, a mojibake repair is a translator's and a programmer's, and
    // `packs` exists precisely so each of those is one tool rather than two.
    // Asserting the pack total would therefore fail every time sharing worked
    // as designed. `devtools.name.*` is the developer toolkit's own key
    // namespace (the professional toolkits all use `pro.name.*`), so this
    // counts the forty-eight the drawer shipped with and nothing else.
    const developerToolkit = DECLARED_TOOLS.filter((tool) =>
      tool.titleKey.startsWith("devtools.name."),
    );
    expect(developerToolkit).toHaveLength(48);
    // …and every one of them is in the pack, which is the half a count cannot see.
    for (const tool of developerToolkit) {
      expect(tool.packs, tool.id).toContain("softver");
    }
  });

  it("omits every pack nothing has claimed", () => {
    // Derived, and deliberately NOT „gradnja is absent": naming a pack that is
    // merely unstocked TODAY writes today's build order into a permanent
    // assertion, and the test would then fail on the day that pack ships its
    // first tool — reporting progress as a regression. What is permanent is the
    // rule.
    const unstocked = TOOL_PACKS.filter(
      (pack) => !DECLARED_TOOLS.some((tool) => tool.packs?.includes(pack)),
    );
    const offered = packInventory(registry).map((entry) => entry.pack);
    for (const pack of unstocked) expect(offered, pack).not.toContain(pack);
  });
});

describe("applyPackSelection", () => {
  it("turns PRO on with any pack chosen, off with none, and changes no other key", () => {
    const base: Record<string, boolean> = { ...ESSENTIALS_MODULE_PRESET, pro: false };

    const withPacks = applyPackSelection(base, new Set(["softver"]));
    expect(withPacks["pro"]).toBe(true);
    // Not merely „pro is right" — every OTHER key must still be the base's,
    // which `pro: false` here restores before the whole-object comparison.
    expect({ ...withPacks, pro: false }).toEqual(base);

    expect(applyPackSelection(base, new Set())).toEqual(base);
  });
});

describe("resolvePackSelection", () => {
  it("reads pack:<id> keys only, off wherever the flag is absent or false", () => {
    expect(resolvePackSelection({})).toEqual(new Set());
    expect(resolvePackSelection({ [packFlagKey("softver")]: true, [packFlagKey("dizajn")]: false })).toEqual(
      new Set(["softver"]),
    );
  });

  it("ignores a key naming no real pack, and a bare unprefixed pack name", () => {
    // An id this build does not know: not the same failure as a false flag,
    // but the same result — it must not be admitted to the set.
    expect(resolvePackSelection({ "pack:nepostojeci": true })).toEqual(new Set());
    // `packFlagKey` always qualifies with "pack:" — a bare "softver" key is
    // not the shape the writer ever produces, so it must not be read as one.
    expect(resolvePackSelection({ softver: true })).toEqual(new Set());
  });
});

describe("packFlagWrites", () => {
  it("writes one row per TOOL_PACKS member on a first run, in TOOL_PACKS order", () => {
    const chosen = new Set(["softver", "dizajn"]);
    const writes = packFlagWrites(chosen, null);
    expect(writes).toEqual(
      TOOL_PACKS.map((pack) => ({ moduleId: packFlagKey(pack), enabled: chosen.has(pack) })),
    );
  });

  it("writes only the packs whose value actually changed on a rerun", () => {
    const current = new Set(["softver", "dizajn"]);
    // „dizajn" turns off, „biznis" turns on, „softver" is untouched — and
    // untouched must mean ABSENT from the writes, not merely correct in them.
    const next = new Set(["softver", "biznis"]);
    expect(packFlagWrites(next, current)).toEqual([
      { moduleId: packFlagKey("dizajn"), enabled: false },
      { moduleId: packFlagKey("biznis"), enabled: true },
    ]);
  });
});

describe("TOOL_PACKS has Serbian copy for every pack (strings.pro.packs)", () => {
  it("names a non-empty subject and a non-empty audience for every pack, and nothing extra", () => {
    // A pack added without Serbian copy would render a blank picker row rather
    // than fail a build — this is the gate that catches it instead.
    expect(Object.keys(strings.pro.packs).sort()).toEqual([...TOOL_PACKS].sort());
    for (const pack of TOOL_PACKS) {
      const copy = strings.pro.packs[pack];
      expect(copy.name.trim().length, pack).toBeGreaterThan(0);
      expect(copy.who.trim().length, pack).toBeGreaterThan(0);
    }
  });
});

describe("resolveModuleSelection", () => {
  it("reads a stored row where there is one and the manifest default where there is not", () => {
    expect(resolveModuleSelection(registry, { priv: true, study: false })).toEqual({
      tasks: true,
      calendar: true,
      notes: true,
      priv: true,
      files: true,
      study: false,
      finance: true,
      habits: true,
      fitness: true,
      focus: true,
      tools: true,
      canvas: true,
      electronics: true,
      // The first discovered module (ADR-090): the questionnaire decides it like
      // any other selectable module, from its own manifest default.
      timers: true,
      reader: true,
      culture: true,
      pantry: true,
      // And the second, on the same terms.
      cookbook: true,
      recorder: true,
      emergency: true,
      // The calculator joined the kit after „Tajmeri" (order 190), so it is
      // decided here in the same way and drawn after it.
      calculator: true,
      signals: true,
      // The second discovered module (ADR-090), decided the same way.
      miniapps: true,
      // And the second discovered module, on for the same reason.
      boards: true,
      // ...and the second, whose board writes nothing until a game is played.
      chess: true,
      // And the second, last because a kit module registers after every
      // compiled-in one and the discovered ones order themselves.
      scanner: true,
      // And the second: a viewer stores nothing, so its manifest default is the
      // whole decision.
      workshop: true,
      translator: true,
      pro: false,
      // The second discovered module, in registry order after Tajmeri.
      library: true,
      // And the arcade (ADR-090, PRD 31): selectable, and off in „Osnovno"
      // because the entertainment section is never suggested on the way in.
      arcade: false,
      // The second discovered module, decided the same way and read from its own
      // manifest default.
      drawings: true,
      // The map (ADR-099) is decided here like every other selectable module,
      // from its own manifest default.
      maps: true,
      // The reference library, on the same terms: installed data, so its default
      // is the whole decision.
      wiki: true,
      // The Lab stores nothing until a reading is taken, so `defaultEnabled` is
      // the decision here too.
      lab: true,
      // And the puzzles, whose board stores nothing until a game is started.
      puzzles: true,
      // And the car service book, which writes nothing until a vehicle is added.
      car: true,
    });
  });

  it("never carries a locked module, however the flags read", () => {
    const selection = resolveModuleSelection(registry, { dashboard: false, settings: false });
    for (const id of LOCKED_MODULE_IDS) {
      expect(selection, id).not.toHaveProperty(id);
    }
  });

  it("walks the registry in registration order", () => {
    expect(Object.keys(resolveModuleSelection(registry, {}))).toEqual(selectableModuleIds(registry));
  });
});

describe("moduleFlagWrites", () => {
  it("writes every selectable module explicitly on a first run, defaults included", () => {
    expect(moduleFlagWrites(registry, ESSENTIALS_MODULE_PRESET, null)).toEqual([
      { moduleId: "tasks", enabled: true },
      { moduleId: "calendar", enabled: true },
      { moduleId: "notes", enabled: true },
      { moduleId: "priv", enabled: false },
      { moduleId: "files", enabled: true },
      { moduleId: "study", enabled: true },
      { moduleId: "finance", enabled: true },
      { moduleId: "habits", enabled: true },
      { moduleId: "fitness", enabled: true },
      { moduleId: "focus", enabled: true },
      { moduleId: "tools", enabled: true },
      { moduleId: "canvas", enabled: true },
      { moduleId: "electronics", enabled: true },
      // Written explicitly even though it matches the manifest default, which
      // is the whole point of a first run: what modules a profile has is a
      // stored fact of the profile, not an accident of this build's manifests.
      { moduleId: "pro", enabled: false },
      // And the DISCOVERED modules last, because a kit module registers after
      // every compiled-in one (ADR-090): ordered by `ModuleManifest.order`, ties
      // broken by id.
      { moduleId: "timers", enabled: true },
      { moduleId: "library", enabled: true },
      { moduleId: "culture", enabled: true },
      { moduleId: "car", enabled: true },
      { moduleId: "pantry", enabled: true },
      { moduleId: "cookbook", enabled: true },
      { moduleId: "recorder", enabled: true },
      { moduleId: "emergency", enabled: true },
      { moduleId: "calculator", enabled: true },
      // The Reader (ADR-100) and Signals share `order: 200`; the tie-break by
      // id puts the reader first.
      { moduleId: "reader", enabled: true },
      { moduleId: "signals", enabled: true },
      // `maps` and `miniapps` share `order: 210`, ordered here by id.
      { moduleId: "maps", enabled: true },
      { moduleId: "miniapps", enabled: true },
      { moduleId: "wiki", enabled: true },
      { moduleId: "translator", enabled: true },
      { moduleId: "scanner", enabled: true },
      { moduleId: "workshop", enabled: true },
      // The arcade is off in Osnovno: PRD 31 keeps the entertainment section
      // out of the questionnaire.
      { moduleId: "arcade", enabled: false },
      { moduleId: "drawings", enabled: true },
      { moduleId: "lab", enabled: true },
      { moduleId: "puzzles", enabled: true },
      { moduleId: "boards", enabled: true },
      { moduleId: "chess", enabled: true },
    ]);
  });

  it("writes only what changed on a rerun", () => {
    const current = resolveModuleSelection(registry, {});
    expect(moduleFlagWrites(registry, { ...current, priv: true, study: false }, current)).toEqual([
      { moduleId: "priv", enabled: true },
      { moduleId: "study", enabled: false },
    ]);
  });

  it("writes nothing at all when a rerun changes nothing", () => {
    const current = resolveModuleSelection(registry, { priv: true });
    expect(moduleFlagWrites(registry, current, current)).toEqual([]);
  });

  it("never writes a row for a locked module, even when one is handed in", () => {
    const writes = moduleFlagWrites(
      registry,
      { ...ESSENTIALS_MODULE_PRESET, dashboard: false, settings: false },
      null,
    );
    for (const id of LOCKED_MODULE_IDS) {
      expect(writes.map((write) => write.moduleId), id).not.toContain(id);
    }
  });

  it("skips a selectable module the selection says nothing about rather than guessing", () => {
    const partial = { ...ESSENTIALS_MODULE_PRESET } as Record<string, boolean>;
    delete partial["study"];
    expect(moduleFlagWrites(registry, partial, null).map((write) => write.moduleId)).not.toContain(
      "study",
    );
  });
});

describe("the welcome note's copy (ADR-065 §4)", () => {
  const welcome = strings.onboarding.welcomeNote;
  const parsed = parseMarkdownNote(welcome.body, welcome.title);

  it("parses to a real document filed under the title the note is named by", () => {
    expect(parsed.title).toBe(welcome.title);
    expect(parsed.blocks.length).toBeGreaterThan(1);
  });

  it("degrades nothing on the way in — it carries no image to land as bare text", () => {
    expect(parsed.imagesAsText).toBe(0);
  });

  it("fits in ONE update, the cap the real creation path enforces", () => {
    expect(buildNoteUpdate(parsed.blocks).byteLength).toBeLessThanOrEqual(NOTE_UPDATE_MAX_BYTES);
  });

  it("prints no keyboard chord — every one of them is remappable (ADR-040), so a printed one goes stale", () => {
    expect(welcome.body).not.toMatch(/ctrl|alt|shift/i);
  });
});
