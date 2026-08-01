import { buildNoteUpdate, parseMarkdownNote, resolveEnabled } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { NOTE_UPDATE_MAX_BYTES } from "../../shared/ipc.js";
import { createModuleRegistry, LOCKED_MODULE_IDS } from "../../shared/modules.js";
import {
  ESSENTIALS_MODULE_PRESET,
  moduleFlagWrites,
  OCCUPATION_MODULE_PRESETS,
  ONBOARDING_OCCUPATIONS,
  resolveModuleSelection,
  selectableModuleIds,
} from "../../shared/onboardingPresets.js";
import { strings } from "./strings.js";

/**
 * ADR-065's declarative data: the two module tables, and the copy of the one
 * starter row the flow writes. Lives beside `modules.test.ts` (and not in
 * `src/shared/`) because that is where the desktop package's Vitest looks —
 * the same reason the module registry's own test lives here.
 *
 * The load-bearing suite is the first one: every expectation derives the id set
 * from the LIVE registry rather than from a hardcoded copy, so registering a
 * module without deciding its „Osnovno“ place and its place in each of the four
 * role suggestions fails here rather than silently inheriting `defaultEnabled`
 * on somebody's first run.
 */

const registry = createModuleRegistry();
const SELECTABLE = selectableModuleIds(registry).sort();

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

  it("decides every selectable module in every role suggestion", () => {
    expect(Object.keys(OCCUPATION_MODULE_PRESETS).sort()).toEqual([...ONBOARDING_OCCUPATIONS].sort());
    for (const occupation of ONBOARDING_OCCUPATIONS) {
      expect(Object.keys(OCCUPATION_MODULE_PRESETS[occupation]).sort(), occupation).toEqual(
        SELECTABLE,
      );
    }
  });

  it("names a Serbian label for every occupation", () => {
    for (const occupation of ONBOARDING_OCCUPATIONS) {
      expect(strings.onboarding.occupationOptions[occupation], occupation).toBeTruthy();
    }
  });
});

describe("ESSENTIALS_MODULE_PRESET", () => {
  it("IS today's personal defaults, written out — the skip path and a fresh profile agree by construction", () => {
    expect(ESSENTIALS_MODULE_PRESET).toEqual(resolveModuleSelection(registry, {}));
    const on = Object.entries(ESSENTIALS_MODULE_PRESET)
      .filter(([, enabled]) => enabled)
      .map(([moduleId]) => moduleId);
    expect(on.sort()).toEqual(
      resolveEnabled(registry, {})
        .filter((id) => !LOCKED_MODULE_IDS.has(id))
        .sort(),
    );
  });

  it("leaves PRIV off — the opt-in section is never pre-chosen (ADR-057)", () => {
    expect(ESSENTIALS_MODULE_PRESET["priv"]).toBe(false);
  });
});

describe("OCCUPATION_MODULE_PRESETS", () => {
  it("never pre-checks PRIV, whatever the answer", () => {
    for (const occupation of ONBOARDING_OCCUPATIONS) {
      expect(OCCUPATION_MODULE_PRESETS[occupation]["priv"], occupation).toBe(false);
    }
  });

  it("pre-checks the three everyday modules for every answer", () => {
    for (const occupation of ONBOARDING_OCCUPATIONS) {
      const preset = OCCUPATION_MODULE_PRESETS[occupation];
      expect(preset["tasks"], occupation).toBe(true);
      expect(preset["calendar"], occupation).toBe(true);
      expect(preset["notes"], occupation).toBe(true);
    }
  });

  it("keeps STUDY for the two answers whose day has it, and drops it for the two that do not", () => {
    expect(OCCUPATION_MODULE_PRESETS.student["study"]).toBe(true);
    expect(OCCUPATION_MODULE_PRESETS.drugo["study"]).toBe(true);
    expect(OCCUPATION_MODULE_PRESETS.zaposleni["study"]).toBe(false);
    expect(OCCUPATION_MODULE_PRESETS.preduzetnik["study"]).toBe(false);
  });

  it("pre-checks FIN for every answer — „Uloga“ asks about a day, and money is shaped the same in all four", () => {
    for (const occupation of ONBOARDING_OCCUPATIONS) {
      expect(OCCUPATION_MODULE_PRESETS[occupation]["finance"], occupation).toBe(true);
    }
  });

  it("pre-checks DOC for every answer — it holds nothing of its own, so switching it off spares nobody anything", () => {
    for (const occupation of ONBOARDING_OCCUPATIONS) {
      expect(OCCUPATION_MODULE_PRESETS[occupation]["files"], occupation).toBe(true);
    }
  });

  it("pre-checks HABIT for every answer — a day's habits are shaped the same whoever is having the day", () => {
    for (const occupation of ONBOARDING_OCCUPATIONS) {
      expect(OCCUPATION_MODULE_PRESETS[occupation]["habits"], occupation).toBe(true);
    }
  });

  // The strongest version of FIN's and HABIT's argument: „Fokus" is a TIMER.
  // Sitting down to concentrate for half an hour is not shaped differently for a
  // student and a founder, and the module holds nothing until somebody presses
  // start. It is also the one module no answer could sensibly drop without also
  // dropping STUDY, since the two share the timer.
  it("pre-checks UTIL for every answer — a timer is shaped the same for everybody", () => {
    for (const occupation of ONBOARDING_OCCUPATIONS) {
      expect(OCCUPATION_MODULE_PRESETS[occupation]["focus"], occupation).toBe(true);
    }
  });

  it("answers „Nešto drugo“ with the neutral preset rather than an invented one", () => {
    expect(OCCUPATION_MODULE_PRESETS.drugo).toEqual(ESSENTIALS_MODULE_PRESET);
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
      focus: true,
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
      { moduleId: "focus", enabled: true },
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
