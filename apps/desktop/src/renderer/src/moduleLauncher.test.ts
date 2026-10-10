import { describe, expect, it } from "vitest";

import { resolveEnabled } from "@nexus/core";

import { createModuleRegistry } from "../../shared/modules.js";
import {
  filterLauncherGroups,
  launcherGroups,
  launcherTileIds,
  nextLauncherIndex,
  type LauncherGroup,
} from "./moduleLauncher.js";
import { lookup, strings } from "./strings.js";

/**
 * The launcher's index and search (ADR-093 §4). What is pinned here is what the
 * overlay offers and what a query does to it — and that the overlay and the rail
 * cannot disagree about which modules exist, since both read the same registry
 * and the same enabled set.
 */

const registry = createModuleRegistry();

/**
 * The real copy, exactly as the component hands it in — the search runs over
 * what is DRAWN. Named `copyFor` and not `describe`: a local helper called
 * `describe` shadows Vitest's, and the suite then registers no tests at all
 * while the run reports a file it could not read a suite out of.
 */
function copyFor(moduleId: string): { name: string; description: string } {
  return {
    name: lookup(strings.modules, moduleId) ?? moduleId,
    description: lookup(strings.settings.moduleDescriptions, moduleId) ?? "",
  };
}

/**
 * The set the app actually draws: the registry resolved against no flags, which
 * is the SAME call `App` makes for the rail — PRIV and „Stručne alatke" are
 * absent here because they are absent there.
 */
function enabledNow(): Set<string> {
  return new Set(resolveEnabled(registry, {}));
}

/** Everything on except what a test names — the shape that proves a flag is honoured. */
function allEnabled(...off: string[]): Set<string> {
  return new Set(
    registry
      .all()
      .map((manifest) => manifest.id)
      .filter((id) => !off.includes(id)),
  );
}

function groups(enabled = enabledNow()): LauncherGroup[] {
  return launcherGroups(registry, enabled, copyFor);
}

describe("launcherGroups", () => {
  it("lists every enabled module by group, in registry order", () => {
    expect(groups().map((group) => group.key)).toEqual([
      "plan",
      "knowledge",
      "life",
      "culture",
      "make",
      "play",
    ]);
    expect(groups()[0]?.tiles.map((tile) => tile.id)).toEqual([
      "tasks",
      "calendar",
      "habits",
      "focus",
      "timers",
    ]);
    // Kultura is a group of its own (ADR-093), and it draws the shelf and the
    // culture corner beside it.
    expect(groups()[3]?.tiles.map((tile) => tile.id)).toEqual(["library", "culture"]);
    // Play closes the list; the arcade ships off by default, so its three
    // on-by-default games are what this group draws.
    expect(groups().at(-1)?.tiles.map((tile) => tile.id)).toEqual([
      "puzzles",
      "boards",
      "chess",
    ]);
    // Make holds the tool drawers and the makers' modules; `pro` is absent
    // because it ships off.
    expect(groups()[4]?.tiles.map((tile) => tile.id)).toEqual([
      "tools",
      "canvas",
      "electronics",
      "calculator",
      "signals",
      "miniapps",
      "scanner",
      "workshop",
      "drawings",
      "lab",
    ]);
  });

  /**
   * The shell group is left out on purpose: „Kontrolna tabla" and
   * „Podešavanja" are the rail's two permanent ends, they cannot be switched
   * off, and an overlay of modules you cannot lose would be offering a shortcut
   * to something already on screen.
   */
  it("leaves the shell's own two rows out", () => {
    const drawn = groups().flatMap((group) => group.tiles.map((tile) => tile.id));
    expect(drawn).not.toContain("dashboard");
    expect(drawn).not.toContain("settings");
  });

  it("leaves a disabled module out, and drops a group that the flag emptied", () => {
    // One module fewer is a shorter group; the whole group gone is a heading
    // that stops being drawn, and that is what the second half asserts.
    expect(groups(allEnabled("habits"))[0]?.tiles.map((tile) => tile.id)).toEqual([
      "tasks",
      "calendar",
      "focus",
      "timers",
    ]);
    const withoutPlan = groups(allEnabled("tasks", "calendar", "habits", "focus", "timers"));
    expect(withoutPlan.map((group) => group.key)).toEqual([
      "knowledge",
      "life",
      "culture",
      "make",
      "play",
    ]);
    // PRIV is off by default, so it is absent until its flag says otherwise —
    // the same `resolveEnabled` set the rail is filtered through.
    const drawn = groups().flatMap((group) => group.tiles.map((tile) => tile.id));
    expect(drawn).not.toContain("priv");
    expect(groups(allEnabled()).flatMap((group) => group.tiles.map((tile) => tile.id))).toContain(
      "priv",
    );
  });

  it("draws a tile's name and its one-line description from the gallery's own copy", () => {
    const calendar = groups()[0]?.tiles.find((tile) => tile.id === "calendar");
    expect(calendar?.name).toBe(strings.modules.calendar);
    expect(calendar?.description).toBe(strings.settings.moduleDescriptions.calendar);
  });

  it("names every tile's module id exactly once, in draw order", () => {
    const ids = launcherTileIds(groups());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      groups().flatMap((group) => group.tiles.map((tile) => tile.id)),
    );
  });
});

describe("filterLauncherGroups", () => {
  it("keeps everything for an empty or whitespace-only query", () => {
    expect(filterLauncherGroups(groups(), "")).toEqual(groups());
    expect(filterLauncherGroups(groups(), "   ")).toEqual(groups());
  });

  /**
   * Diacritic-insensitivity is `foldSearchText`'s, and it is the property the
   * index itself rests on: „ucenje" finds „UČenje", „beleske" finds
   * „Beleške", „djordje" would find „Äorđe", and a Cyrillic query finds the
   * Latin copy. Both locales go through it, so an English name is matched by an
   * English query and a Serbian one by a Serbian query, with the diacritics
   * optional in either.
   */
  it("matches a name without its diacritics, in either locale's spelling", () => {
    expect(tileIds(filterLauncherGroups(groups(), "ucenje"))).toEqual(["study"]);
    // A hit in the DESCRIPTION counts, and it brings along every module whose
    // sentence names the same thing — „beleške" is the word FILES and PRIV
    // both use for what they carry, which is the search working rather than
    // over-matching.
    expect(tileIds(filterLauncherGroups(groups(), "beleske"))).toContain("notes");
    expect(tileIds(filterLauncherGroups(groups(), "priv"))).toEqual([]);
    expect(tileIds(filterLauncherGroups(groups(allEnabled()), "privatno"))).toEqual(["priv"]);
    // The description is searched too — that is what makes a half-remembered
    // sentence enough to find a module by.
    expect(tileIds(filterLauncherGroups(groups(), "pomodoro"))).toEqual(["focus"]);
  });

  it("narrows a group away once its last tile stops matching, so nothing draws a heading over nothing", () => {
    const narrowed = filterLauncherGroups(groups(), "finansije");
    expect(narrowed.map((group) => group.key)).toEqual(["life"]);
    expect(tileIds(narrowed)).toEqual(["finance"]);
  });

  it("requires every typed term, so a second word narrows rather than widens", () => {
    expect(tileIds(filterLauncherGroups(groups(), "zadaci"))).toEqual(["tasks"]);
    expect(tileIds(filterLauncherGroups(groups(), "zadaci fitnes"))).toEqual([]);
  });

  it("answers an empty list when nothing matches, rather than the whole catalogue", () => {
    expect(filterLauncherGroups(groups(), "nema-ovoga")).toEqual([]);
  });
});

describe("nextLauncherIndex", () => {
  it("steps one place and wraps at both ends, so no press is a dead end", () => {
    expect(nextLauncherIndex(0, 3, 1)).toBe(1);
    expect(nextLauncherIndex(2, 3, 1)).toBe(0);
    expect(nextLauncherIndex(0, 3, -1)).toBe(2);
  });

  it("answers 0 for an empty list, which the component never draws", () => {
    expect(nextLauncherIndex(4, 0, 1)).toBe(0);
  });
});

/** Every tile id a narrowed result still holds — the list the arrows walk. */
function tileIds(narrowed: readonly LauncherGroup[]): string[] {
  return launcherTileIds(narrowed);
}
