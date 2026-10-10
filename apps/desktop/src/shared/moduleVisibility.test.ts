import { describe, expect, it } from "vitest";
import { ModuleRegistry, type ModuleGroup, type ModuleManifest } from "@nexus/core";

import type { ModuleVisibility } from "./ipc.js";
import {
  DEFAULT_SHELL_VISIBILITY,
  isModuleVisible,
  moveGroup,
  moveInOrder,
  moveModule,
  normalizeShellVisibility,
  orderedGroupKeys,
  orderedGroupMembers,
  parseShellVisibility,
  resetShellOrder,
  seedVisibleModules,
  setModuleVisible,
  SHELL_VISIBILITY_VERSION,
  visibleModuleIds,
  visibleModuleSet,
  type ShellVisibility,
} from "./moduleVisibility.js";

/**
 * The setting's own rules, pinned where they can be read without a database, a
 * window or a file: the parser's refusals, the predicate every consumer filters
 * through, the two lists' bookkeeping, and the ordering.
 *
 * The registries below are hand-made rather than the shipping one, because the
 * expected values are then literals in this file rather than a second
 * computation of the same rule — and because two of the cases (a module that
 * left the build, and the two locked modules) are about manifests the shipping
 * registry deliberately does not have.
 */

function mod(id: string, group: ModuleGroup, defaultEnabled: boolean): ModuleManifest {
  return { id, prefix: id.toUpperCase(), group, defaultEnabled };
}

/**
 * A six-module registry with the two locked rows in it, so `LOCKED_MODULE_IDS`
 * — which is the shipping set, imported by the code under test — answers as it
 * does in the app. `ghost` is added by the tests that need a module the build no
 * longer has.
 */
function registry(withGhost = false): ModuleRegistry {
  const reg = new ModuleRegistry();
  reg.register(mod("dashboard", "shell", true));
  reg.register(mod("settings", "shell", true));
  reg.register(mod("tasks", "plan", true));
  reg.register(mod("habits", "plan", true));
  reg.register(mod("finance", "life", true));
  reg.register(mod("priv", "life", false));
  if (withGhost) reg.register(mod("ghost", "make", false));
  return reg;
}

function visibility(overrides: Partial<ShellVisibility> = {}): ShellVisibility {
  return { ...DEFAULT_SHELL_VISIBILITY, ...overrides };
}

describe("visibleModuleIds", () => {
  it("answers the manifests' own defaults when nothing is recorded", () => {
    expect(visibleModuleIds(registry(), DEFAULT_SHELL_VISIBILITY)).toEqual([
      "dashboard",
      "settings",
      "tasks",
      "habits",
      "finance",
    ]);
  });

  it("is the same set as a set, for the consumers that ask per id", () => {
    expect([...visibleModuleSet(registry(), DEFAULT_SHELL_VISIBILITY)]).toEqual(
      visibleModuleIds(registry(), DEFAULT_SHELL_VISIBILITY),
    );
  });

  it("hides a module the user switched off, and keeps registration order", () => {
    expect(visibleModuleIds(registry(), visibility({ hidden: ["tasks"] }))).toEqual([
      "dashboard",
      "settings",
      "habits",
      "finance",
    ]);
  });

  it("shows a module that ships off when the user switched it on", () => {
    expect(visibleModuleIds(registry(), visibility({ shown: ["priv"] }))).toContain("priv");
  });

  it("never hides the two modules nothing may switch off", () => {
    const hiddenShell = visibility({ hidden: ["dashboard", "settings", "tasks"] });
    expect(visibleModuleIds(registry(), hiddenShell)).toEqual([
      "dashboard",
      "settings",
      "habits",
      "finance",
    ]);
  });

  it("ignores an id no manifest answers to, whatever list it sits in", () => {
    expect(visibleModuleIds(registry(), visibility({ hidden: ["gone"], shown: ["also-gone"] }))).toEqual(
      visibleModuleIds(registry(), DEFAULT_SHELL_VISIBILITY),
    );
  });
});

describe("isModuleVisible", () => {
  const reg = registry();
  const tasks = reg.get("tasks") as ModuleManifest;
  const priv = reg.get("priv") as ModuleManifest;

  it("reads the manifest's default when neither list names the module", () => {
    expect(isModuleVisible(tasks, DEFAULT_SHELL_VISIBILITY)).toBe(true);
    expect(isModuleVisible(priv, DEFAULT_SHELL_VISIBILITY)).toBe(false);
  });

  it("reads hidden as hidden even when the manifest ships the module on", () => {
    expect(isModuleVisible(tasks, visibility({ hidden: ["tasks"] }))).toBe(false);
  });

  it("reads a module in both lists as HIDDEN", () => {
    expect(isModuleVisible(tasks, visibility({ hidden: ["tasks"], shown: ["tasks"] }))).toBe(false);
    // The same file, after a write: normalization states it once, as hidden.
    const normalized = normalizeShellVisibility(
      visibility({ hidden: ["tasks"], shown: ["tasks"] }),
      reg,
    );
    expect(normalized.hidden).toEqual(["tasks"]);
    expect(normalized.shown).toEqual([]);
  });
});

describe("parseShellVisibility", () => {
  const value = visibility({ hidden: ["tasks"], shown: ["priv"], groupOrder: ["life", "plan"] });

  it("round-trips a value through JSON unchanged", () => {
    expect(parseShellVisibility(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  it("refuses a version that is not this build's, whichever way it is spelled", () => {
    expect(parseShellVisibility({ ...value, version: 0 })).toBeNull();
    expect(parseShellVisibility({ ...value, version: 2 })).toBeNull();
    expect(parseShellVisibility({ ...value, version: "1" })).toBeNull();
    expect(parseShellVisibility({ ...value, version: undefined })).toBeNull();
  });

  it("refuses a shape that is not the one this build writes", () => {
    expect(parseShellVisibility(null)).toBeNull();
    expect(parseShellVisibility([])).toBeNull();
    expect(parseShellVisibility("visibility")).toBeNull();
    expect(parseShellVisibility({ version: SHELL_VISIBILITY_VERSION })).toBeNull();
    expect(parseShellVisibility({ ...value, hidden: "tasks" })).toBeNull();
    expect(parseShellVisibility({ ...value, hidden: [7] })).toBeNull();
    expect(parseShellVisibility({ ...value, groupOrder: [""] })).toBeNull();
    expect(parseShellVisibility({ ...value, moduleOrder: [] })).toBeNull();
    expect(parseShellVisibility({ ...value, moduleOrder: { plan: [null] } })).toBeNull();
  });

  it("refuses an id with whitespace in it, which nothing in this app mints", () => {
    expect(parseShellVisibility({ ...value, hidden: [" tasks "] })).toBeNull();
    expect(parseShellVisibility({ ...value, hidden: ["ta sks"] })).toBeNull();
  });

  it("refuses a prototype key in the module order, so a file cannot reach Object.prototype", () => {
    expect(
      parseShellVisibility({ ...value, moduleOrder: JSON.parse('{"__proto__": ["tasks"]}') }),
    ).toBeNull();
  });

  it("refuses a list longer than the setting may hold", () => {
    const ids = Array.from({ length: 513 }, (_, index) => `m${index}`);
    expect(parseShellVisibility({ ...value, hidden: ids })).toBeNull();
  });
});

describe("normalizeShellVisibility", () => {
  const reg = registry();

  it("drops the two locked modules out of both lists", () => {
    const normalized = normalizeShellVisibility(
      visibility({ hidden: ["dashboard", "settings", "tasks"], shown: ["dashboard"] }),
      reg,
    );
    expect(normalized.hidden).toEqual(["tasks"]);
    expect(normalized.shown).toEqual([]);
  });

  it("drops an entry that only restates the manifest", () => {
    const normalized = normalizeShellVisibility(
      visibility({ hidden: ["priv"], shown: ["tasks"] }),
      reg,
    );
    expect(normalized).toEqual(DEFAULT_SHELL_VISIBILITY);
  });

  it("keeps the entries that are a decision, including over a module that is gone", () => {
    const normalized = normalizeShellVisibility(
      visibility({ hidden: ["tasks", "gone"], shown: ["priv", "away"] }),
      reg,
    );
    expect(normalized.hidden).toEqual(["tasks", "gone"]);
    expect(normalized.shown).toEqual(["priv", "away"]);
  });

  it("leaves a module that left the build in the list, so the day it returns it comes back hidden", () => {
    const before = normalizeShellVisibility(visibility({ hidden: ["ghost"] }), registry());
    expect(before.hidden).toEqual(["ghost"]);
    // The build that has it again reads the same entry, and the predicate honours it.
    const withGhost = registry(true);
    const ghost = withGhost.get("ghost") as ModuleManifest;
    expect(isModuleVisible(ghost, before)).toBe(false);
    expect(visibleModuleIds(withGhost, before)).not.toContain("ghost");
  });
});

describe("setModuleVisible", () => {
  const reg = registry();
  const tasks = reg.get("tasks") as ModuleManifest;
  const priv = reg.get("priv") as ModuleManifest;

  it("writes a default-on module's OFF as a hidden entry and nothing else", () => {
    expect(setModuleVisible(DEFAULT_SHELL_VISIBILITY, tasks, false, reg)).toEqual(
      visibility({ hidden: ["tasks"] }),
    );
  });

  it("writes a default-off module's ON as a shown entry and nothing else", () => {
    expect(setModuleVisible(DEFAULT_SHELL_VISIBILITY, priv, true, reg)).toEqual(
      visibility({ shown: ["priv"] }),
    );
  });

  it("is its own inverse: switching back restates the manifest and empties the file", () => {
    const off = setModuleVisible(DEFAULT_SHELL_VISIBILITY, tasks, false, reg);
    expect(setModuleVisible(off, tasks, true, reg)).toEqual(DEFAULT_SHELL_VISIBILITY);
    const on = setModuleVisible(DEFAULT_SHELL_VISIBILITY, priv, true, reg);
    expect(setModuleVisible(on, priv, false, reg)).toEqual(DEFAULT_SHELL_VISIBILITY);
  });

  it("refuses to hide a locked module", () => {
    const dashboard = reg.get("dashboard") as ModuleManifest;
    expect(setModuleVisible(DEFAULT_SHELL_VISIBILITY, dashboard, false, reg)).toEqual(
      DEFAULT_SHELL_VISIBILITY,
    );
  });

  it("keeps an arrangement that is already stored", () => {
    const stored = visibility({ groupOrder: ["life"], moduleOrder: { life: ["priv"] } });
    expect(setModuleVisible(stored, tasks, false, reg)).toEqual(
      visibility({ hidden: ["tasks"], groupOrder: ["life"], moduleOrder: { life: ["priv"] } }),
    );
  });
});

describe("seedVisibleModules", () => {
  it("decides every module of the build, in both directions", () => {
    // The union of what the profiles had on, which is what the migration
    // writes: TASKS off everywhere is recorded hidden, PRIV on somewhere joins
    // `shown` because its manifest ships it off.
    expect(
      seedVisibleModules(registry(), new Set(["dashboard", "settings", "finance", "priv"])),
    ).toEqual(visibility({ hidden: ["tasks", "habits"], shown: ["priv"] }));
  });

  it("is the manifests' own arrangement when the union is the defaults", () => {
    expect(
      seedVisibleModules(registry(), new Set(["dashboard", "settings", "tasks", "habits", "finance"])),
    ).toEqual(DEFAULT_SHELL_VISIBILITY);
  });

  it("is idempotent, so a second profile that adds nothing changes nothing", () => {
    const enabled = new Set(["dashboard", "settings", "finance"]);
    const once = seedVisibleModules(registry(), enabled);
    expect(seedVisibleModules(registry(), enabled)).toEqual(once);
  });

  it("ignores ids this build does not have", () => {
    expect(seedVisibleModules(registry(), new Set(["gone", "dashboard", "settings"]))).toEqual(
      visibility({ hidden: ["tasks", "habits", "finance"] }),
    );
  });

  it("never hides a locked module, whatever the union says", () => {
    expect(seedVisibleModules(registry(), new Set()).hidden).toEqual(["tasks", "habits", "finance"]);
  });
});

describe("the order", () => {
  const reg = registry();
  const tasks = reg.get("tasks") as ModuleManifest;
  const finance = reg.get("finance") as ModuleManifest;

  it("is the registry's own when nothing is stored", () => {
    expect(orderedGroupKeys(reg, DEFAULT_SHELL_VISIBILITY)).toEqual(["plan", "life", "shell"]);
    expect(
      orderedGroupMembers(reg.byGroup().get("plan") ?? [], DEFAULT_SHELL_VISIBILITY, "plan").map(
        (manifest) => manifest.id,
      ),
    ).toEqual(["tasks", "habits"]);
  });

  it("draws the stored groups first, in their stored order, and a group it does not name after them", () => {
    expect(orderedGroupKeys(reg, visibility({ groupOrder: ["life", "plan"] }))).toEqual([
      "life",
      "plan",
      "shell",
    ]);
  });

  it("ignores a stored group key this build has no group for", () => {
    expect(orderedGroupKeys(reg, visibility({ groupOrder: ["gone", "life"] }))).toEqual([
      "life",
      "plan",
      "shell",
    ]);
  });

  it("draws the stored members first and a module it does not name after them", () => {
    const members = reg.byGroup().get("life") ?? [];
    expect(
      orderedGroupMembers(members, visibility({ moduleOrder: { life: ["priv"] } }), "life").map(
        (manifest) => manifest.id,
      ),
    ).toEqual(["priv", "finance"]);
  });

  it("ignores a stored member this group does not have", () => {
    const members = reg.byGroup().get("plan") ?? [];
    expect(
      orderedGroupMembers(
        members,
        visibility({ moduleOrder: { plan: ["gone", "habits"] } }),
        "plan",
      ).map((manifest) => manifest.id),
    ).toEqual(["habits", "tasks"]);
  });

  it("moves one entry by a distance and clamps at both ends", () => {
    expect(moveInOrder(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveInOrder(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveInOrder(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveInOrder(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(moveInOrder(["a", "b", "c"], "a", 0)).toEqual(["a", "b", "c"]);
    expect(moveInOrder(["a", "b", "c"], "z", 1)).toEqual(["a", "b", "c"]);
  });

  it("writes the WHOLE order back when a group moves, so the next gesture reads what the user sees", () => {
    const moved = moveGroup(
      DEFAULT_SHELL_VISIBILITY,
      orderedGroupKeys(reg, DEFAULT_SHELL_VISIBILITY),
      "life",
      -1,
    );
    expect(moved.groupOrder).toEqual(["life", "plan", "shell"]);
    expect(orderedGroupKeys(reg, moved)).toEqual(["life", "plan", "shell"]);
  });

  it("writes one group's members when a module moves, and leaves every other group alone", () => {
    const stored = visibility({ moduleOrder: { life: ["priv", "finance"] } });
    const moved = moveModule(stored, "plan", ["tasks", "habits"], "habits", -1);
    expect(moved.moduleOrder).toEqual({ life: ["priv", "finance"], plan: ["habits", "tasks"] });
  });

  it("resets the arrangement to the registry's, and keeps what is hidden", () => {
    const arranged = visibility({
      hidden: ["tasks"],
      groupOrder: ["life"],
      moduleOrder: { life: ["priv"] },
    });
    const reset = resetShellOrder(arranged);
    expect(reset).toEqual(visibility({ hidden: ["tasks"] }));
    expect(orderedGroupKeys(reg, reset)).toEqual(["plan", "life", "shell"]);
  });

  it("moves a module and a group without disturbing the other list", () => {
    const moved = moveModule(
      moveGroup(DEFAULT_SHELL_VISIBILITY, ["plan", "life", "shell"], "shell", -2),
      "plan",
      ["tasks", "habits"],
      "tasks",
      1,
    );
    expect(moved.groupOrder).toEqual(["shell", "plan", "life"]);
    expect(moved.moduleOrder).toEqual({ plan: ["habits", "tasks"] });
    expect(moved.hidden).toEqual([]);
  });

  it("leaves an unrelated manifest alone, so the two lists cannot disagree about a module", () => {
    expect(isModuleVisible(tasks, resetShellOrder(visibility({ moduleOrder: {} })))).toBe(true);
    expect(isModuleVisible(finance, resetShellOrder(visibility({ moduleOrder: {} })))).toBe(true);
  });
});

describe("the wire shape", () => {
  it("is the store's shape, in both directions, so the two cannot drift", () => {
    // A compile-time pin: `ModuleVisibility` (`shared/ipc.ts`, the payload) and
    // `ShellVisibility` (this file, the store) must stay assignable to each
    // other. The runtime assertion only exists because a test needs one.
    const wire: ModuleVisibility = DEFAULT_SHELL_VISIBILITY;
    const stored: ShellVisibility = wire;
    const back: ModuleVisibility = stored;
    expect(back).toEqual(DEFAULT_SHELL_VISIBILITY);
  });
});
