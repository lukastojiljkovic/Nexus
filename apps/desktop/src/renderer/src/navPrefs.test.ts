import { afterEach, describe, expect, it, vi } from "vitest";

import { createModuleRegistry, LOCKED_MODULE_IDS } from "../../shared/modules.js";
import {
  MAX_PINNED_MODULES,
  movePinned,
  navGroupOpen,
  persistCollapsedGroups,
  persistPinnedModules,
  pinModule,
  PINNED_GROUP_KEY,
  readCollapsedGroups,
  readPinnedModules,
  sidebarGroups,
  toggleCollapsedGroups,
  unpinModule,
  type NavGroup,
} from "./navPrefs.js";
import { memoryStorage } from "./testStorage.js";

/**
 * The rail's own state (ADR-086, ADR-093). Three kinds of thing are under test
 * and they are different kinds: the two stored preferences (per-profile keys
 * with a safe fallback, the `accent.ts` recipe), the pure list arithmetic the
 * pin toggle and the drag both call, and `sidebarGroups`, which is the ONE place
 * the sidebar's draw order is decided â€” `App` both renders it and counts
 * Alt+1â€¦Alt+9 along it.
 */

const registry = createModuleRegistry();

/** Everything the profile has on: the real registry's ids, minus what a test wants off. */
function allEnabled(...off: string[]): Set<string> {
  return new Set(
    registry
      .all()
      .map((manifest) => manifest.id)
      .filter((id) => !off.includes(id)),
  );
}

function flatten(groups: ReturnType<typeof sidebarGroups>): string[] {
  return groups.flatMap((group) => group.moduleIds);
}

/** The block at one index, failing loudly rather than answering `undefined` into an assertion. */
function blockAt(groups: readonly NavGroup[], index: number): NavGroup {
  const block = groups[index];
  if (block === undefined) throw new Error(`the rail has no block at ${index}`);
  return block;
}

/** The rail every profile draws with nothing pinned and nothing folded: shell head, groups, shell tail. */
function defaultOrder(): string[] {
  const byGroup = registry.byGroup();
  const shell = (byGroup.get("shell") ?? []).map((manifest) => manifest.id);
  const [head, ...tail] = shell;
  return [
    ...(head === undefined ? [] : [head]),
    ...[...byGroup]
      .filter(([group]) => group !== "shell")
      .flatMap(([, members]) => members.map((manifest) => manifest.id)),
    ...tail,
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the stored preferences", () => {
  it("reads back what was written, per profile and per preference", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    persistPinnedModules("p1", ["study", "calendar"]);
    persistPinnedModules("p2", ["finance"]);
    persistCollapsedGroups("p1", ["knowledge"]);
    expect(readPinnedModules("p1")).toEqual(["study", "calendar"]);
    expect(readPinnedModules("p2")).toEqual(["finance"]);
    expect(readCollapsedGroups("p1")).toEqual(["knowledge"]);
    expect(readCollapsedGroups("p2")).toEqual([]);
  });

  /**
   * â€žNothing here" has exactly ONE representation, and it is the absent key: a
   * stored `[]` would be a second one, and the two would then have to be kept
   * meaning the same thing by everybody who reads them. That matters twice over
   * for the folded groups, because the fallback is what makes a module arriving
   * in a group nobody has folded appear expanded.
   */
  it("removes the key rather than storing an empty list", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    persistPinnedModules("p1", ["study"]);
    persistPinnedModules("p1", []);
    persistCollapsedGroups("p1", ["life"]);
    persistCollapsedGroups("p1", []);
    expect(storage.getItem("nexus.nav.pinned.p1")).toBeNull();
    expect(storage.getItem("nexus.nav.collapsed.p1")).toBeNull();
    expect(readPinnedModules("p1")).toEqual([]);
    expect(readCollapsedGroups("p1")).toEqual([]);
  });

  it("falls back to nothing for anything unreadable", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({
        "nexus.nav.pinned.broken": "{",
        "nexus.nav.pinned.object": '{"study":true}',
        "nexus.nav.pinned.mixed": '["study",7,null]',
        "nexus.nav.collapsed.mixed": '["life",7]',
      }),
    );
    expect(readPinnedModules("broken")).toEqual([]);
    expect(readPinnedModules("object")).toEqual([]);
    expect(readPinnedModules("absent")).toEqual([]);
    // A half-valid list keeps its strings: the ids are filtered against the
    // live registry downstream anyway, so throwing the good ones away would
    // lose information without buying any safety.
    expect(readPinnedModules("mixed")).toEqual(["study"]);
    expect(readCollapsedGroups("mixed")).toEqual(["life"]);
  });

  /**
   * The way back from the plan, and it is the ordinary write rather than a
   * function of its own: a rerun that answers nothing has an empty `navPrimary`,
   * and this is what `applyLook` then does with it.
   */
  it("forgets one profile's pins on an empty write, and leaves the other's", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    persistPinnedModules("p1", ["study"]);
    persistPinnedModules("p2", ["finance"]);
    persistPinnedModules("p1", []);
    expect(readPinnedModules("p1")).toEqual([]);
    expect(readPinnedModules("p2")).toEqual(["finance"]);
  });
});

describe("the pinned list", () => {
  it("adds at the END, so a new pin never displaces an arrangement", () => {
    expect(pinModule(["study", "calendar"], "notes")).toEqual(["study", "calendar", "notes"]);
  });

  it("is a no-op for a module already pinned, and for one that is not pinned at all", () => {
    expect(pinModule(["study"], "study")).toEqual(["study"]);
    expect(unpinModule(["study"], "tasks")).toEqual(["study"]);
  });

  /**
   * The cap is one number for the plan and for the user (ADR-086 Â§4), so a
   * sixth pin is REFUSED rather than replacing one: a shortlist that quietly
   * dropped the module somebody pinned first would undo their arrangement to
   * honour their newest click.
   */
  it("refuses a pin past the cap, and keeps the five already there", () => {
    const full = ["a", "b", "c", "d", "e"];
    expect(full).toHaveLength(MAX_PINNED_MODULES);
    expect(pinModule(full, "f")).toEqual(full);
  });

  it("moves a module one place up or down, and clamps at both ends", () => {
    expect(movePinned(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(movePinned(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(movePinned(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(movePinned(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("ignores an unknown id and a delta of zero, so no caller needs bounds arithmetic", () => {
    expect(movePinned(["a", "b"], "zzz", 1)).toEqual(["a", "b"]);
    expect(movePinned(["a", "b"], "a", 0)).toEqual(["a", "b"]);
  });
});

describe("the folded groups", () => {
  it("toggles one key on and off, leaving the others alone", () => {
    expect(toggleCollapsedGroups([], "life")).toEqual(["life"]);
    expect(toggleCollapsedGroups(["life", "make"], "life")).toEqual(["make"]);
    expect(toggleCollapsedGroups(["life"], "make")).toEqual(["life", "make"]);
  });

  it("keeps a heading-less shell row open, since it has nothing to fold", () => {
    const head = blockAt(sidebarGroups(registry, allEnabled(), []), 0);
    expect(head.key).toBeNull();
    expect(navGroupOpen(head, [], "tasks")).toBe(true);
  });

  it("opens a folded group when the module on screen is inside it", () => {
    const groups = sidebarGroups(registry, allEnabled(), []);
    const plan = groups.find((group) => group.key === "plan");
    if (plan === undefined) throw new Error("the rail must draw the plan group");
    expect(plan.moduleIds).toContain("tasks");
    expect(navGroupOpen(plan, ["plan"], "tasks")).toBe(true);
    // ...and the stored state is NOT rewritten: a group folded, visited and left
    // is folded again, which is why this is a read-side rule.
    expect(navGroupOpen(plan, ["plan"], "notes")).toBe(false);
  });
});

describe("sidebarGroups", () => {
  it("draws exactly today's sidebar when nothing is pinned", () => {
    const groups = sidebarGroups(registry, allEnabled(), []);
    expect(groups.some((group) => group.key === PINNED_GROUP_KEY)).toBe(false);
    expect(flatten(groups)).toEqual(defaultOrder());
  });

  /**
   * The shell group is SPLIT, and this is the assertion that keeps the rail's two
   * ends where ADR-093 puts them: the home surface heads the list, the settings
   * page closes it, and neither wears a heading.
   */
  it("heads the rail with the shell's first row and closes it with the rest", () => {
    const groups = sidebarGroups(registry, allEnabled(), []);
    expect(groups[0]).toEqual({ key: null, moduleIds: ["dashboard"] });
    expect(groups[groups.length - 1]).toEqual({ key: null, moduleIds: ["settings"] });
    // Every heading-less block is a shell row, and the shell is exactly the two
    // modules nothing may switch off.
    const loose = groups.filter((group) => group.key === null).flatMap((g) => g.moduleIds);
    expect([...loose].sort()).toEqual([...LOCKED_MODULE_IDS].sort());
    expect(groups.filter((group) => group.key !== null).map((group) => group.key)).toEqual([
      "plan",
      "knowledge",
      "life",
      "make",
      "play",
    ]);
  });

  it("puts the pinned modules first, in the order given", () => {
    const groups = sidebarGroups(registry, allEnabled(), ["finance", "study"]);
    expect(groups[1]).toEqual({ key: PINNED_GROUP_KEY, moduleIds: ["finance", "study"] });
  });

  /** The same row twice is a list, not a shortlist â€” so a promoted module leaves its group. */
  it("draws every module exactly once", () => {
    const drawn = flatten(sidebarGroups(registry, allEnabled(), ["finance", "study", "notes"]));
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn).toHaveLength(registry.all().length);
  });

  /**
   * The stored list is never validated on read, so every way it can be stale has
   * to die here: a module switched off in â€žNapredno", a module this build no
   * longer registers, a duplicate, and the two rows a user cannot switch off â€”
   * promoting â€žPodeÅ¡avanja" says nothing about anybody.
   */
  it("ignores a pin that is disabled, unknown, locked or repeated", () => {
    const locked = [...LOCKED_MODULE_IDS][0] ?? "settings";
    const groups = sidebarGroups(registry, allEnabled("finance"), [
      "finance",
      "modul-koji-ne-postoji",
      locked,
      "study",
      "study",
    ]);
    expect(groups[1]).toEqual({ key: PINNED_GROUP_KEY, moduleIds: ["study"] });
    expect(flatten(groups)).not.toContain("finance");
    expect(flatten(groups)).toContain(locked);
  });

  /** A stored list longer than the cap â€” an old build's, or a hand-edited one â€” draws at most `MAX_PINNED_MODULES`. */
  it("draws at most the cap when the stored list is longer than one", () => {
    const stored = ["study", "notes", "finance", "habits", "fitness", "canvas", "tools"];
    const groups = sidebarGroups(registry, allEnabled(), stored);
    const pinned = groups.find((group) => group.key === PINNED_GROUP_KEY);
    expect(pinned?.moduleIds).toEqual(stored.slice(0, MAX_PINNED_MODULES));
  });

  it("drops a group the pins emptied rather than drawing an empty heading", () => {
    // Every member of one group, pinned: the group has nothing left to draw.
    const members =
      [...registry.byGroup()]
        .filter(([group]) => group !== "shell")
        .map(([, manifests]) => manifests.map((manifest) => manifest.id))
        .find((ids) => ids.length <= MAX_PINNED_MODULES) ?? [];
    expect(members.length).toBeGreaterThan(0);
    const groups = sidebarGroups(registry, allEnabled(), members);
    const remaining = groups.filter((group) => group.key !== null && group.key !== PINNED_GROUP_KEY);
    expect(remaining.flatMap((group) => group.moduleIds)).not.toContain(members[0]);
  });

  it("hides a group with no enabled module, and draws nothing at all for a profile with nothing on", () => {
    const groups = sidebarGroups(registry, new Set(["dashboard", "settings", "tasks"]), []);
    expect(groups.map((group) => group.key)).toEqual([null, "plan", null]);
    expect(sidebarGroups(registry, new Set(), ["study"])).toEqual([]);
  });
});
