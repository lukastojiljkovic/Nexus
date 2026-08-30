import { afterEach, describe, expect, it, vi } from "vitest";

import { createModuleRegistry, LOCKED_MODULE_IDS } from "../../shared/modules.js";
import {
  persistPinnedModules,
  PINNED_GROUP_KEY,
  readPinnedModules,
  sidebarGroups,
} from "./navPrefs.js";
import { memoryStorage } from "./testStorage.js";

/**
 * ADR-086's sidebar half. Two things are under test and they are different
 * kinds of thing: the stored preference (a per-profile key with a safe
 * fallback, the `accent.ts` recipe) and `sidebarGroups`, which is the ONE place
 * the sidebar's draw order is decided — `App` both renders it and counts
 * Ctrl+1…Ctrl+9 along it.
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the stored preference", () => {
  it("reads back what was written, per profile", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    persistPinnedModules("p1", ["study", "calendar"]);
    persistPinnedModules("p2", ["finance"]);
    expect(readPinnedModules("p1")).toEqual(["study", "calendar"]);
    expect(readPinnedModules("p2")).toEqual(["finance"]);
  });

  /**
   * „Nothing pinned" has exactly ONE representation, and it is the absent key.
   * A stored `[]` would be a second one, and the two would then have to be kept
   * meaning the same thing by everybody who reads them.
   */
  it("removes the key rather than storing an empty list", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    persistPinnedModules("p1", ["study"]);
    persistPinnedModules("p1", []);
    expect(storage.getItem("nexus.nav.pinned.p1")).toBeNull();
    expect(readPinnedModules("p1")).toEqual([]);
  });

  it("falls back to nothing pinned for anything unreadable", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({
        "nexus.nav.pinned.broken": "{",
        "nexus.nav.pinned.object": '{"study":true}',
        "nexus.nav.pinned.mixed": '["study",7,null]',
      }),
    );
    expect(readPinnedModules("broken")).toEqual([]);
    expect(readPinnedModules("object")).toEqual([]);
    expect(readPinnedModules("absent")).toEqual([]);
    // A half-valid list keeps its strings: the ids are filtered against the
    // live registry downstream anyway, so throwing the good ones away would
    // lose information without buying any safety.
    expect(readPinnedModules("mixed")).toEqual(["study"]);
  });

  /**
   * The way back, and it is the ordinary write rather than a function of its
   * own: a rerun that answers nothing has an empty `navPrimary`, and this is
   * what `applyLook` then does with it.
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

describe("sidebarGroups", () => {
  it("draws exactly today's sidebar when nothing is pinned", () => {
    const groups = sidebarGroups(registry, allEnabled(), []);
    expect(groups.some((group) => group.key === PINNED_GROUP_KEY)).toBe(false);
    expect(flatten(groups)).toEqual(
      [...registry.byCategory()].flatMap(([, members]) => members.map((m) => m.id)),
    );
  });

  it("puts the pinned modules first, in the order given", () => {
    const groups = sidebarGroups(registry, allEnabled(), ["finance", "study"]);
    expect(groups[0]).toEqual({ key: PINNED_GROUP_KEY, moduleIds: ["finance", "study"] });
  });

  /** The same row twice is a list, not a shortlist — so a promoted module leaves its category. */
  it("draws every module exactly once", () => {
    const drawn = flatten(sidebarGroups(registry, allEnabled(), ["finance", "study", "notes"]));
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn).toHaveLength(registry.all().length);
  });

  /**
   * The stored list is never validated on read, so every way it can be stale
   * has to die here: a module switched off in „Napredno", a module this build
   * no longer registers, a duplicate, and the two rows a user cannot switch off
   * — promoting „Podešavanja" says nothing about anybody.
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
    expect(groups[0]).toEqual({ key: PINNED_GROUP_KEY, moduleIds: ["study"] });
    expect(flatten(groups)).not.toContain("finance");
    expect(flatten(groups)).toContain(locked);
  });

  it("drops a category the pins emptied rather than drawing an empty heading", () => {
    // A category with a LOCKED member can never be emptied by pinning, which
    // is the whole reason „Core experience" is not the one picked here.
    const category = [...registry.byCategory()].find(([, members]) =>
      members.every((manifest) => !LOCKED_MODULE_IDS.has(manifest.id)),
    );
    const members = (category?.[1] ?? []).map((manifest) => manifest.id);
    expect(members.length).toBeGreaterThan(0);
    const groups = sidebarGroups(registry, allEnabled(), members);
    expect(groups.map((group) => group.key)).not.toContain(category?.[0]);
  });

  it("draws no group at all for a profile with nothing enabled", () => {
    expect(sidebarGroups(registry, new Set(), ["study"])).toEqual([]);
  });
});
