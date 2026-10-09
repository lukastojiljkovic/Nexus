import { foldSearchText, type ModuleGroup, type ModuleRegistry } from "@nexus/core";

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
 * Every enabled module, grouped, in `MODULE_GROUPS` order; a group with no
 * enabled member is omitted rather than drawn empty — Culture and Play are
 * empty in this build and their names would be headings over nothing.
 *
 * `describe` is the caller's, because the two lines are COPY and `@nexus/core`
 * must not learn any: the component hands in `moduleName` and the gallery's own
 * one-line description, which is the table the Settings page and the onboarding
 * chooser already draw — the house rule that a module has one name and one
 * sentence everywhere.
 */
export function launcherGroups(
  registry: ModuleRegistry,
  enabled: ReadonlySet<string>,
  describe: (moduleId: string) => { name: string; description: string },
): LauncherGroup[] {
  const groups: LauncherGroup[] = [];
  for (const [group, members] of registry.byGroup()) {
    if (group === "shell") continue;
    const tiles = members
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
