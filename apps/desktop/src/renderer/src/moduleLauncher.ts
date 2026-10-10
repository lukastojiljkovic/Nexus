import { foldSearchText, type ModuleGroup, type ModuleRegistry } from "@nexus/core";

import {
  DEFAULT_SHELL_VISIBILITY,
  orderedGroupKeys,
  orderedGroupMembers,
  type ShellVisibility,
} from "../../shared/moduleVisibility.js";
import { moduleDescription, moduleName } from "./moduleName.js";

/**
 * The launcher's index and its search (ADR-093 §4): every ENABLED module, by
 * group, plus the two lines a tile draws.
 *
 * Kept out of the component for the reason `navPrefs.ts` keeps the rail's order
 * out of `App.tsx`: which modules the overlay offers, how the query narrows
 * them, and which tile the arrow keys are standing on are decisions, and a
 * decision inside JSX is one only the screenshot sweep can check.
 *
 * **The launcher and the rail answer one question and must not disagree.** Both
 * read `registry.byGroup()` and both filter through the SAME enabled set, so a
 * module switched off in „Podešavanja → Moduli" leaves the rail and the overlay
 * in the same write. `shell` is the one group left out, and deliberately:
 * „Kontrolna tabla" and „Podešavanja" are the rail's two permanent ends, they
 * cannot be switched off, and an overlay that listed them would offer a
 * shortcut to rows that are already on screen whichever page you are on.
 */

/** One tile: identity, and the two lines `settings.moduleDescriptions` already carries for the gallery. */
export interface LauncherTile {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** One section of the overlay: a group and its tiles, in registry order. */
export interface LauncherGroup {
  readonly key: ModuleGroup;
  readonly tiles: readonly LauncherTile[];
}

/**
 * The two lines a tile draws, for any module in the registry — the one resolver
 * the rail, the Settings gallery and the onboarding row already use
 * (`moduleName.ts`).
 *
 * **Why this is the default rather than a component's private copy.** It was a
 * private copy in `ModuleLauncherDialog.tsx`, and it read `strings.modules` and
 * `strings.settings.moduleDescriptions` directly — which only know the
 * COMPILED-IN modules, so a kit module's tile drew its raw id
 * (`workshop`, `timers`, `translator`) while its rail entry and its Settings row
 * drew the name its manifest declares. Two surfaces, one module, two names: the
 * exact drift `moduleName.ts` exists to prevent, in the one place that had
 * restated the lookup instead of calling it.
 */
export function launcherTileCopy(moduleId: string): { name: string; description: string } {
  return { name: moduleName(moduleId), description: moduleDescription(moduleId) };
}

/**
 * Every enabled module, grouped, in `MODULE_GROUPS` order; a group with no
 * enabled member is omitted rather than drawn empty — Culture and Play are
 * empty in this build and their names would be headings over nothing.
 *
 * The ORDER is the device's stored arrangement (ADR-101) rather than the
 * registry's: the rail and this overlay are two pictures of one app, so a group
 * or a module moved in „Prikaz" moves in both.
 *
 * `describe` is a parameter because the two lines are COPY and `@nexus/core`
 * must not learn any; it defaults to `launcherTileCopy`, which is the house rule
 * that a module has one name and one sentence everywhere.
 */
export function launcherGroups(
  registry: ModuleRegistry,
  enabled: ReadonlySet<string>,
  describe: (moduleId: string) => { name: string; description: string } = launcherTileCopy,
  visibility: ShellVisibility = DEFAULT_SHELL_VISIBILITY,
): LauncherGroup[] {
  const groups: LauncherGroup[] = [];
  const byGroup = registry.byGroup();
  for (const group of orderedGroupKeys(registry, visibility)) {
    if (group === "shell") continue;
    const tiles = orderedGroupMembers(byGroup.get(group) ?? [], visibility, group)
      .filter((manifest) => enabled.has(manifest.id))
      .map((manifest) => ({ id: manifest.id, ...describe(manifest.id) }));
    if (tiles.length > 0) groups.push({ key: group, tiles });
  }
  return groups;
}

/**
 * The groups, narrowed to the tiles a query matches; groups left with nothing
 * are dropped, so an empty result is an empty LIST and the component has one
 * state to draw.
 *
 * **The grammar is `matchCommands`'s, deliberately**: every folded term of the
 * query must be a PREFIX of some folded word in the tile's name or description.
 * The palette taught the user that grammar on their first search; a second
 * matcher that accepted substrings would find things the palette cannot and
 * make „why is this not in Ctrl+K" a question with no answer. Folding is
 * `foldSearchText`, so „ucenje" finds „Učenje", „djordje" finds „Đorđe" and a
 * Cyrillic query finds the Latin copy — the property the index itself rests on.
 *
 * An empty (or whitespace-only) query keeps every group: an untyped overlay is
 * a catalogue, which is what its title says it is.
 */
export function filterLauncherGroups(
  groups: readonly LauncherGroup[],
  query: string,
): LauncherGroup[] {
  const terms = foldSearchText(query)
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return [...groups];
  return groups
    .map((group) => ({
      key: group.key,
      tiles: group.tiles.filter((tile) => {
        const words = foldSearchText(`${tile.name} ${tile.description}`).split(/\s+/);
        return terms.every((term) => words.some((word) => word.startsWith(term)));
      }),
    }))
    .filter((group) => group.tiles.length > 0);
}

/**
 * Every tile's module id, in draw order — the list ↑/↓ walk and the DOM's own
 * order, which is the same list.
 */
export function launcherTileIds(groups: readonly LauncherGroup[]): string[] {
  return groups.flatMap((group) => group.tiles.map((tile) => tile.id));
}

/**
 * Where one arrow press lands, wrapping at both ends.
 *
 * **Only ±1, and the reason the four arrows are not a proper 2D walk is
 * physical:** the tiles are a responsive grid (`auto-fill`), so a column count
 * exists only after layout and this module has no DOM. Stepping one place along
 * the reading order is what the DOM order IS, so it can be tested here and the
 * keyboard can never point at a tile the layout has hidden. `count === 0` has no
 * landing place and answers 0, which the component never renders.
 */
export function nextLauncherIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}
