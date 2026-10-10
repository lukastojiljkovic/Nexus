import type { ModuleRegistry } from "@nexus/core";

import { LOCKED_MODULE_IDS } from "../../shared/modules.js";

/**
 * The sidebar's own state: which modules this profile keeps at the top of it
 * (ADR-086), which groups it has folded away (ADR-093), and the ONE function
 * that decides the order the rail draws (ADR-093).
 *
 * Both preferences are PER-PROFILE device rows on `accent.ts`'s recipe —
 * `nexus.nav.pinned.<profileId>` and `nexus.nav.collapsed.<profileId>` — and
 * per-profile is not a detail: two people share a machine and the whole point
 * of the questionnaire is that their apps differ. The device-wide keys in this
 * directory (`nexus.files.view`, `nexus.notes.rootView`) are the shape this
 * deliberately is not; writing one of those from a plan would silently
 * re-decorate the FIRST profile when the second is set up.
 *
 * **The plan pins; it never reorders** (ADR-086 §6). The rail's groups carry
 * real information — thirty-five modules read as one flat list without them —
 * so a promoted module moves into a „Za tebe" block above them and everything
 * else stays exactly where the registry puts it. Nothing pinned means the
 * sidebar is the one the app has always drawn, which is law 1 of `ProfilePlan`
 * one level down — and is what a rerun that answers nothing writes back, since
 * it is the one plan output with no chooser of its own.
 *
 * Where the plan leaves off, the USER begins: every module row carries a pin
 * toggle (`pinModule` / `unpinModule`), and a pinned row can be reordered by
 * dragging it or by moving it with the keyboard (`movePinned`). Both gestures
 * write through those same three helpers, so a drag and a keystroke cannot
 * disagree about what the order means — the parity the dashboard's edit mode
 * reaches with a menu.
 */

const PINNED_KEY_PREFIX = "nexus.nav.pinned.";
const COLLAPSED_KEY_PREFIX = "nexus.nav.collapsed.";

/**
 * The group key the pinned rows render under. Not a `ModuleGroup`: the groups
 * are a fact about the product (a manifest declares its own), and this is a
 * fact about one person, so it deliberately cannot be declared by a manifest.
 */
export const PINNED_GROUP_KEY = "pinned";

/**
 * How many modules the shortlist may hold, whether the plan composed it or the
 * user pinned them by hand.
 *
 * The plan's own cap (ADR-086 §4) and the user's are ONE number on purpose: a
 * shortlist that reached seven would be half the sidebar restated above the
 * sidebar — the „Alatke" mistake, a directory of the same rows beside those
 * rows — in a different room. Five is short enough to read as a selection, and
 * at 35 modules a rail that quietly grew a second copy of itself is the failure
 * the launcher exists to avoid.
 */
export const MAX_PINNED_MODULES = 5;

/** One rendered block of the sidebar: a heading and the modules under it, in draw order. */
export interface NavGroup {
  /** `PINNED_GROUP_KEY`, a `ModuleGroup`, or `null` for one of the shell's two heading-less rows. */
  readonly key: string | null;
  readonly moduleIds: readonly string[];
}

/**
 * Reads a per-profile list out of `localStorage`, or an empty one.
 *
 * Anything unreadable — absent, not JSON, not an array of strings — reads as an
 * empty list, which is the rail the app has always had. There is no validation
 * against the registry here on purpose: `sidebarGroups` filters against the LIVE
 * registry and the LIVE flags, so a module that has since been switched off or
 * retired simply stops being drawn without the stored list having to be
 * rewritten to say so.
 */
function readList(key: string): string[] {
  const raw = localStorage.getItem(key);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/**
 * Writes one of those lists. An empty list REMOVES the key, so „nothing here"
 * has exactly one representation — a stored `[]` would be a second one, and the
 * two would then have to be kept meaning the same thing by everybody who reads
 * them.
 */
function persistList(key: string, values: readonly string[]): void {
  if (values.length === 0) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify([...values]));
}

/**
 * A profile's pinned modules, or an empty list.
 *
 * THIS IS ALSO THE WAY BACK FROM THE PLAN, and there is deliberately no
 * `clearPinnedModules` beside it. A plan with nothing in it has an empty
 * `navPrimary`, so „Ponovo pokreni upitnik" followed by „Preskoči" writes the
 * empty list here and the sidebar is the one the app has always drawn — the same
 * call, through the same path, redrawn by the same `navEpoch` bump every other
 * run gets. A second function that only ever removed the key would be a second
 * way to reach one state, and the one nothing in the app would call.
 */
export function readPinnedModules(profileId: string): string[] {
  return readList(PINNED_KEY_PREFIX + profileId);
}

/** Writes a profile's pinned modules. Empty removes the key — see `readPinnedModules`. */
export function persistPinnedModules(profileId: string, moduleIds: readonly string[]): void {
  persistList(PINNED_KEY_PREFIX + profileId, moduleIds);
}

/**
 * The group keys this profile has folded away — empty for the rail the app has
 * always drawn, since „expanded" is the state a user who has never touched a
 * heading is in.
 *
 * Stored as the SET of collapsed keys rather than as the set of expanded ones,
 * and that direction is what lets the group list grow: a module arriving in a
 * group nobody has ever folded is expanded, which is the behaviour every new
 * module has had.
 */
export function readCollapsedGroups(profileId: string): string[] {
  return readList(COLLAPSED_KEY_PREFIX + profileId);
}

/** Writes a profile's folded groups. Empty removes the key — see `readPinnedModules`. */
export function persistCollapsedGroups(profileId: string, keys: readonly string[]): void {
  persistList(COLLAPSED_KEY_PREFIX + profileId, keys);
}

/**
 * The pinned list with one module added at the END, or the SAME list when the
 * module is already pinned or the shortlist is full.
 *
 * The end rather than the front: a new pin must not displace the arrangement the
 * user has already made, and the last place is the only one that adds without
 * moving anything else.
 */
export function pinModule(pinned: readonly string[], moduleId: string): string[] {
  if (pinned.includes(moduleId) || pinned.length >= MAX_PINNED_MODULES) return [...pinned];
  return [...pinned, moduleId];
}

/** The pinned list without one module. An absent module is a no-op, so a stale click cannot corrupt the order. */
export function unpinModule(pinned: readonly string[], moduleId: string): string[] {
  return pinned.filter((id) => id !== moduleId);
}

/**
 * The pinned list with one module moved `delta` places along it.
 *
 * `delta` is a DISTANCE rather than a direction, because the two callers ask two
 * different questions: the keyboard asks for one place (`Alt+↑` is -1) and a drop
 * asks how far the row travelled, which is the distance between the row picked
 * up and the row it was dropped on. One function answers both, so the drag
 * needed no index arithmetic of its own.
 *
 * An unknown id, a `delta` of zero, and a move off either end all return the
 * list UNCHANGED. Clamping rather than refusing keeps the keyboard's first and
 * last press harmless, which is what lets `Alt+↑` be held down without a
 * counter.
 */
export function movePinned(
  pinned: readonly string[],
  moduleId: string,
  delta: number,
): string[] {
  const from = pinned.indexOf(moduleId);
  if (from < 0 || delta === 0) return [...pinned];
  const to = Math.min(pinned.length - 1, Math.max(0, from + delta));
  if (to === from) return [...pinned];
  const next = [...pinned];
  next.splice(from, 1);
  next.splice(to, 0, moduleId);
  return next;
}

/**
 * Whether one block of the rail draws its rows.
 *
 * A heading-less shell row has nothing to fold. A folded group that CONTAINS the
 * module on screen opens anyway, and this is the rule that keeps a profile from
 * losing a page: a collapsed group whose module is opened from the launcher, the
 * palette, a dashboard card or `Alt+3` must show WHERE that module is, or the
 * rail says only that somewhere else is active. The stored state is not
 * rewritten when this happens — fold a group, visit one of its modules, walk
 * away, and the group is folded again.
 */
export function navGroupOpen(
  group: NavGroup,
  collapsed: readonly string[],
  activeId: string,
): boolean {
  if (group.key === null) return true;
  if (group.moduleIds.includes(activeId)) return true;
  return !collapsed.includes(group.key);
}

/**
 * Adds or removes one group key, the toggle the heading click and the keyboard
 * both go through.
 */
export function toggleCollapsedGroups(collapsed: readonly string[], key: string): string[] {
  return collapsed.includes(key) ? collapsed.filter((entry) => entry !== key) : [...collapsed, key];
}

/**
 * The sidebar, as the blocks it draws.
 *
 * THE ONE PLACE THE ORDER IS DECIDED. `App` renders this and also counts
 * Alt+1…Alt+9 along it; before this function the two were separate walks over
 * the registry's own grouping that happened to agree, which is the shape a
 * shortcut-numbering defect hides in — a pinned block would have renumbered the
 * visible rows and left the shortcuts pointing at the old ones.
 *
 * The order is: the shell's first row („Kontrolna tabla"), the „Za tebe" block
 * when anything is pinned, the six feature groups in `MODULE_GROUPS` order, and
 * the shell's remaining rows („Podešavanja") last. The shell group is the two
 * rows a user cannot switch off (ADR-093): it is not drawn as a heading, and it
 * is SPLIT rather than drawn in one place, because the home surface heads the
 * rail and the settings page closes it. Its first member is the head; the rest
 * close it.
 *
 * A pinned id is drawn once: it appears in the „Za tebe" block and is removed
 * from its own group, because the same row twice is a list, not a shortlist.
 * Locked modules („Kontrolna tabla", „Podešavanja") are never pinnable — they
 * are the two rows a user cannot switch off, so promoting them says nothing.
 */
export function sidebarGroups(
  registry: ModuleRegistry,
  enabled: ReadonlySet<string>,
  pinned: readonly string[],
): NavGroup[] {
  const groups = registry.byGroup();
  const known = new Set<string>();
  for (const members of groups.values()) for (const m of members) known.add(m.id);

  const promoted: string[] = [];
  for (const moduleId of pinned) {
    if (promoted.length >= MAX_PINNED_MODULES) break;
    if (promoted.includes(moduleId)) continue;
    if (!known.has(moduleId) || LOCKED_MODULE_IDS.has(moduleId)) continue;
    if (enabled.has(moduleId)) promoted.push(moduleId);
  }

  /** The shell's own rows, in registration order — the head is its first member. */
  const shell = (groups.get("shell") ?? [])
    .map((manifest) => manifest.id)
    .filter((id) => enabled.has(id));

  const blocks: NavGroup[] = [];
  const [head, ...tail] = shell;
  if (head !== undefined) blocks.push({ key: null, moduleIds: [head] });
  if (promoted.length > 0) blocks.push({ key: PINNED_GROUP_KEY, moduleIds: promoted });
  for (const [group, members] of groups) {
    if (group === "shell") continue;
    const moduleIds = members
      .map((manifest) => manifest.id)
      .filter((id) => enabled.has(id) && !promoted.includes(id));
    if (moduleIds.length > 0) blocks.push({ key: group, moduleIds });
  }
  if (tail.length > 0) blocks.push({ key: null, moduleIds: tail });
  return blocks;
}
