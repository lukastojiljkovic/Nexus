import {
  MAX_ID_LENGTH,
  type ModuleGroup,
  type ModuleManifest,
  type ModuleRegistry,
} from "@nexus/core";

import { LOCKED_MODULE_IDS } from "./modules.js";

/**
 * THE ONE SETTING THAT DECIDES WHAT THIS DEVICE SHOWS (ADR-101).
 *
 * Nexus is growing to roughly forty modules, and the answer is not another
 * taxonomy: the user hides the modules they do not use, orders the groups, and
 * orders the modules inside each group. ONE setting for the whole app, not one
 * per profile — a device with two profiles is still one person's app, and the
 * per-profile switch this replaces was the reason a module could be on in the
 * sidebar and off in the launcher of the profile next door.
 *
 * **What lives here and what does not.** This module is the pure half: the
 * shape, the parser, the predicate every consumer filters through, and the four
 * writes a gesture makes (show/hide, move a group, move a module, reset the
 * order). The FILE — its path, its atomic write and the one-time union of the
 * old per-profile switches — is `main/visibility.ts`, because it touches
 * `userData` and only main may.
 *
 * **The two lists, and why there are two.** `hidden` is the brief's own shape:
 * the module ids the user switched off. `shown` is its other direction, and it
 * is not decoration — `ModuleManifest.defaultEnabled` is the shipped answer
 * (PRIV and PRO ship OFF, deliberately), so a setting that could only HIDE
 * could not record the union the migration produces when a profile had already
 * switched an opt-in module on. One list for a boolean preference needs a
 * default; two lists keep the default the manifest declares, so a module added
 * by a later build is on when it says it is, and off when it says it is,
 * without the file having to mention it.
 *
 * visible = `hidden` names it ? false
 *         : `shown` names it ? true
 *         : the manifest's own `defaultEnabled`.
 *
 * **Unknown ids are KEPT, never dropped.** A module that leaves the build keeps
 * its place in these lists, so it comes back hidden (or shown) if it ever
 * returns, and a file written by a build that had it is not silently rewritten
 * by one that does not. The predicate ignores an id no manifest answers to,
 * which is what makes „a module that left the build" a no-op in every consumer
 * rather than a special case in each.
 */

/** The one version this build writes and understands. A future version is a future parser. */
export const SHELL_VISIBILITY_VERSION = 1;

/** One module id, or one group key, as these lists spell one. Bounded, and never `__proto__`. */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Caps a hand-edited or hostile payload may not pass. Both lists hold module ids; the order maps hold groups. */
const MAX_LIST_ENTRIES = 512;
const MAX_ORDER_GROUPS = 64;

/**
 * The device's module arrangement.
 *
 * `groupOrder` and `moduleOrder` are OVERRIDES: empty means "the order the
 * registry declares", which is the state of every device that has never
 * reordered anything, and it is also what the card's reset writes back. A group
 * or module the stored order does not name keeps its registry place, after the
 * ones the order does name — the rule that lets a module added by a later build
 * appear without anybody editing this file.
 */
export interface ShellVisibility {
  readonly version: number;
  /** Module ids the user switched OFF. Ignored for the two locked modules. */
  readonly hidden: readonly string[];
  /** Module ids the user switched ON although their manifest ships them off. */
  readonly shown: readonly string[];
  /** Group keys in the order the rail (and the launcher) draw them. Empty is `MODULE_GROUPS` order. */
  readonly groupOrder: readonly string[];
  /** Per group key, the module ids in the order that group draws them. Empty is registration order. */
  readonly moduleOrder: Readonly<Record<string, readonly string[]>>;
}

/**
 * What a device that has never touched this setting runs on: nothing hidden,
 * nothing shown, no order of its own — i.e. exactly the app the manifests
 * describe. It is also the fail-safe answer a bad or future file reads as, and
 * the reason is the opposite of `readCloudSwitch`'s: this is a preference, not
 * a boundary. Reading a corrupt file as "hide everything" would leave a user
 * with a rail they cannot explain and a Settings page that is still there only
 * because the two locked modules cannot be hidden.
 */
export const DEFAULT_SHELL_VISIBILITY: ShellVisibility = {
  version: SHELL_VISIBILITY_VERSION,
  hidden: [],
  shown: [],
  groupOrder: [],
  moduleOrder: {},
};

/** True for a well-formed id or group key: non-empty, no whitespace, bounded, and never a prototype key. */
function isKey(value: string): boolean {
  return value.length <= MAX_ID_LENGTH && KEY_PATTERN.test(value);
}

/** A list of keys off the wire or out of the file, or `null` when any entry is not one. */
function asKeyList(value: unknown, limit: number): readonly string[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isKey(entry)) return null;
    out.push(entry);
  }
  return out;
}

/**
 * The stored value, or `null` when it is not one this build understands.
 *
 * `null` covers every kind of doubt for `readNetworkChoice`'s reason: a
 * malformed object, a field of the wrong type, an oversized list, a missing
 * field, and — the acceptance's own case — a version that is not literally `1`.
 * A future version is refused rather than best-effort read, because the fields
 * a future build adds are ones this one would silently drop on the next write.
 */
export function parseShellVisibility(value: unknown): ShellVisibility | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record["version"] !== SHELL_VISIBILITY_VERSION) return null;
  const hidden = asKeyList(record["hidden"], MAX_LIST_ENTRIES);
  const shown = asKeyList(record["shown"], MAX_LIST_ENTRIES);
  const groupOrder = asKeyList(record["groupOrder"], MAX_ORDER_GROUPS);
  if (hidden === null || shown === null || groupOrder === null) return null;
  const rawOrder = record["moduleOrder"];
  if (typeof rawOrder !== "object" || rawOrder === null || Array.isArray(rawOrder)) return null;
  const entries = Object.entries(rawOrder as Record<string, unknown>);
  if (entries.length > MAX_ORDER_GROUPS) return null;
  const moduleOrder: Record<string, readonly string[]> = {};
  for (const [group, ids] of entries) {
    if (!isKey(group)) return null;
    const list = asKeyList(ids, MAX_LIST_ENTRIES);
    if (list === null) return null;
    moduleOrder[group] = list;
  }
  return { version: SHELL_VISIBILITY_VERSION, hidden, shown, groupOrder, moduleOrder };
}

/**
 * The value in its canonical form, against the LIVE registry.
 *
 * Three cleanups, and each is a statement about what these two lists mean:
 *
 *   - the two locked modules („Kontrolna tabla", „Podešavanja") are removed from
 *     both lists. They cannot be hidden, so a file that names one is claiming
 *     something false, and a hand-edited file is exactly how that claim would
 *     arrive;
 *   - an id in both lists reads as HIDDEN. Hiding is the state the user asked
 *     for, and the alternative — whichever list happened to be read first —
 *     would make one file mean two things;
 *   - an entry that merely restates the manifest is dropped (a `shown` for a
 *     module that ships on, a `hidden` for one that ships off). The file then
 *     says only what the user decided, which is what makes it small and what
 *     makes its diff readable.
 *
 * An UNKNOWN id is left exactly where it was found: this build cannot know
 * which default it restates, and dropping it would lose the arrangement the day
 * the module returns.
 */
export function normalizeShellVisibility(
  visibility: ShellVisibility,
  registry: ModuleRegistry,
): ShellVisibility {
  const hidden = new Set<string>();
  const shown = new Set<string>();
  for (const id of visibility.hidden) {
    if (!LOCKED_MODULE_IDS.has(id)) hidden.add(id);
  }
  for (const id of visibility.shown) {
    if (LOCKED_MODULE_IDS.has(id)) continue;
    if (registry.get(id)?.defaultEnabled === true) continue;
    shown.add(id);
  }
  // `hidden` wins a contradiction, so the entry that states it survives the write
  // and the one that disputes it is the one dropped.
  for (const id of hidden) shown.delete(id);
  for (const id of [...hidden]) {
    if (registry.get(id)?.defaultEnabled === false) hidden.delete(id);
  }
  const moduleOrder: Record<string, readonly string[]> = {};
  for (const [group, ids] of Object.entries(visibility.moduleOrder)) {
    moduleOrder[group] = [...new Set(ids)];
  }
  return {
    version: SHELL_VISIBILITY_VERSION,
    hidden: [...hidden],
    shown: [...shown],
    groupOrder: [...new Set(visibility.groupOrder)],
    moduleOrder,
  };
}

/**
 * THE PREDICATE. Every consumer that draws, offers or suggests a module asks
 * this one question — the rail, the launcher, the settings filter, the
 * dashboard's picker and its placed widgets, the palette's „Idi na" commands,
 * and main's notification scheduler and search gate.
 *
 * The two locked modules answer `true` always, and that is the rule rather than
 * a guard at each call site: „Kontrolna tabla" and „Podešavanja" are the two
 * rows a user cannot switch off (SET-007), because somebody has to render the
 * switches.
 */
export function isModuleVisible(manifest: ModuleManifest, visibility: ShellVisibility): boolean {
  if (LOCKED_MODULE_IDS.has(manifest.id)) return true;
  if (visibility.hidden.includes(manifest.id)) return false;
  if (visibility.shown.includes(manifest.id)) return true;
  return manifest.defaultEnabled;
}

/**
 * The visible modules, in REGISTRATION order — the order the palette's commands
 * have always been built in, and deliberately not the rail's own: the two
 * differ the moment a user reorders anything, and a command list that reordered
 * itself under a typing user would be a list moving while being read.
 */
export function visibleModuleIds(registry: ModuleRegistry, visibility: ShellVisibility): string[] {
  return registry
    .all()
    .filter((manifest) => isModuleVisible(manifest, visibility))
    .map((manifest) => manifest.id);
}

/** `visibleModuleIds` as a set, for the several consumers that ask per id rather than per list. */
export function visibleModuleSet(
  registry: ModuleRegistry,
  visibility: ShellVisibility,
): ReadonlySet<string> {
  return new Set(visibleModuleIds(registry, visibility));
}

/**
 * The same setting with one module switched on or off.
 *
 * The two lists move together so the file never holds a contradiction: turning
 * a module OFF removes its `shown` entry and adds a `hidden` one only when the
 * manifest ships it on, and turning one ON does the mirror image. A locked
 * module answers the value unchanged — the predicate would ignore the entry
 * anyway, and writing one would put a claim in the file that nothing honours.
 */
export function setModuleVisible(
  visibility: ShellVisibility,
  manifest: ModuleManifest,
  visible: boolean,
  registry: ModuleRegistry,
): ShellVisibility {
  if (LOCKED_MODULE_IDS.has(manifest.id)) return visibility;
  const hidden = new Set(visibility.hidden);
  const shown = new Set(visibility.shown);
  if (visible) {
    hidden.delete(manifest.id);
    if (manifest.defaultEnabled) shown.delete(manifest.id);
    else shown.add(manifest.id);
  } else {
    shown.delete(manifest.id);
    if (manifest.defaultEnabled) hidden.add(manifest.id);
    else hidden.delete(manifest.id);
  }
  return normalizeShellVisibility(
    { ...visibility, hidden: [...hidden], shown: [...shown] },
    registry,
  );
}

/**
 * The arrangement a set of visible ids means, from scratch (ADR-101 §3).
 *
 * This is the migration's write, and it is a SEED rather than a toggle: the
 * union of what the profiles had on decides every module of this build, in both
 * directions. A module no profile had on is recorded hidden even though its
 * manifest ships it on — that is what "the setting starts as the union" means,
 * and a helper that could only show would leave such a module visible and lose
 * the very decision the migration exists to carry over.
 *
 * The build's own defaults are the baseline it starts from, because the only
 * launch that ever calls this is the one that found no file at all.
 */
export function seedVisibleModules(
  registry: ModuleRegistry,
  enabledModuleIds: ReadonlySet<string>,
): ShellVisibility {
  let next = DEFAULT_SHELL_VISIBILITY;
  for (const manifest of registry.all()) {
    next = setModuleVisible(next, manifest, enabledModuleIds.has(manifest.id), registry);
  }
  return next;
}

/**
 * One entry of a list moved `delta` places along it, clamped at both ends.
 *
 * A DISTANCE rather than a direction, `movePinned`'s rule and for its reason:
 * the keyboard asks for one place and a drop asks how far the row travelled,
 * and one function answers both rather than two that can disagree about what a
 * move off the end does. An unknown id, a delta of zero and a move off either
 * end all return the list unchanged, which is what lets „move up" be pressed
 * and held at the first row.
 */
export function moveInOrder(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0 || delta === 0) return [...ids];
  const to = Math.min(ids.length - 1, Math.max(0, from + delta));
  if (to === from) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * One group moved along the rail's own order.
 *
 * `keys` is the order CURRENTLY drawn (`orderedGroupKeys`), never the stored
 * list, and the whole list is written back: a move has to state the complete
 * arrangement or the next gesture would be applied to a list that no longer
 * matches what the user is looking at.
 */
export function moveGroup(
  visibility: ShellVisibility,
  keys: readonly string[],
  key: string,
  delta: number,
): ShellVisibility {
  return { ...visibility, groupOrder: moveInOrder(keys, key, delta) };
}

/** The same move one level down, for the modules inside one group's `members`. */
export function moveModule(
  visibility: ShellVisibility,
  group: string,
  members: readonly string[],
  moduleId: string,
  delta: number,
): ShellVisibility {
  return {
    ...visibility,
    moduleOrder: { ...visibility.moduleOrder, [group]: moveInOrder(members, moduleId, delta) },
  };
}

/** The stored order cleared, so the arrangement is the registry's again — what the card's reset writes. */
export function resetShellOrder(visibility: ShellVisibility): ShellVisibility {
  return { ...visibility, groupOrder: [], moduleOrder: {} };
}

/**
 * The groups to draw, in the stored order with the registry's order behind it.
 *
 * A group the stored order does not name keeps its `MODULE_GROUPS` place at the
 * END rather than being spliced into the middle: the arrangement the user made
 * is a statement about the groups it names, and a group a later build adds has
 * no place in it. Only groups that have a member right now are drawn, exactly
 * as the rail has always omitted an empty one (`Culture` and `Play` are empty
 * in this build).
 */
export function orderedGroupKeys(
  registry: ModuleRegistry,
  visibility: ShellVisibility,
): ModuleGroup[] {
  const live = [...registry.byGroup().keys()];
  const stored = visibility.groupOrder.filter((key): key is ModuleGroup =>
    live.includes(key as ModuleGroup),
  );
  return [...stored, ...live.filter((group) => !stored.includes(group))];
}

/**
 * One group's members in the stored order, on `orderedGroupKeys`' terms: the
 * ids the order names come first in that order, then everything it does not
 * name in registration order.
 */
export function orderedGroupMembers(
  members: readonly ModuleManifest[],
  visibility: ShellVisibility,
  group: string,
): ModuleManifest[] {
  const stored = visibility.moduleOrder[group] ?? [];
  const byId = new Map(members.map((manifest) => [manifest.id, manifest]));
  const ordered = stored.flatMap((id) => {
    const manifest = byId.get(id);
    return manifest === undefined ? [] : [manifest];
  });
  return [...ordered, ...members.filter((manifest) => !stored.includes(manifest.id))];
}

