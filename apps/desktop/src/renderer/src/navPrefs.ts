import type { ModuleCategory, ModuleRegistry } from "@nexus/core";

import { LOCKED_MODULE_IDS } from "../../shared/modules.js";

/**
 * ADR-086: which modules this profile keeps at the top of its sidebar.
 *
 * A PER-PROFILE device preference on `accent.ts`'s recipe — `nexus.nav.pinned.
 * <profileId>` — and per-profile is not a detail: two people share a machine
 * and the whole point of the questionnaire is that their apps differ. The
 * device-wide keys in this directory (`nexus.files.view`, `nexus.notes.
 * rootView`) are the shape this deliberately is not; writing one of those from
 * a plan would silently re-decorate the FIRST profile when the second is set up.
 *
 * **The plan pins; it never reorders.** The sidebar's categories carry real
 * information — fourteen modules read as one flat list without them — so a
 * promoted module moves into a „Za tebe" group above them and everything else
 * stays exactly where the registry puts it. Nothing pinned means the sidebar is
 * the one the app has always drawn, which is law 1 of `ProfilePlan` one level
 * down — and is what a rerun that answers nothing writes back, since it is the
 * one plan output with no chooser of its own.
 */

const PINNED_KEY_PREFIX = "nexus.nav.pinned.";

/**
 * The group key the pinned rows render under. Not a `ModuleCategory`: the
 * categories are a fact about the product (a manifest declares its own), and
 * this is a fact about one person, so it deliberately cannot be declared by a
 * manifest.
 */
export const PINNED_GROUP_KEY = "pinned";

/** One rendered block of the sidebar: a heading and the modules under it, in draw order. */
export interface NavGroup {
  /** `PINNED_GROUP_KEY`, or a `ModuleCategory`. */
  readonly key: string;
  readonly moduleIds: readonly string[];
}

/**
 * A profile's pinned modules, or an empty list.
 *
 * Anything unreadable — absent, not JSON, not an array of strings — reads as
 * „nothing pinned", which is the sidebar the app has always had. There is no
 * validation against the registry here on purpose: `sidebarGroups` filters
 * against the LIVE registry and the LIVE flags, so a module that has since been
 * switched off or retired simply stops being drawn without the stored list
 * having to be rewritten to say so.
 */
export function readPinnedModules(profileId: string): string[] {
  const raw = localStorage.getItem(PINNED_KEY_PREFIX + profileId);
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
 * Writes a profile's pinned modules. An empty list REMOVES the key, so
 * „nothing pinned" has one representation.
 *
 * THIS IS ALSO THE WAY BACK, and there is deliberately no `clearPinnedModules`
 * beside it. A plan with nothing in it has an empty `navPrimary`, so „Ponovo
 * pokreni upitnik" followed by „Preskoči" writes the empty list here and the
 * sidebar is the one the app has always drawn — the same call, through the
 * same path, redrawn by the same `navEpoch` bump every other run gets. A second
 * function that only ever removed the key would be a second way to reach one
 * state, and the one nothing in the app would call.
 */
export function persistPinnedModules(profileId: string, moduleIds: readonly string[]): void {
  const key = PINNED_KEY_PREFIX + profileId;
  if (moduleIds.length === 0) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify([...moduleIds]));
}

/**
 * The sidebar, as the blocks it draws.
 *
 * THE ONE PLACE THE ORDER IS DECIDED. `App` renders this and also counts
 * Ctrl+1…Ctrl+9 along it; before this function the two were separate walks over
 * `registry.byCategory()` that happened to agree, which is the shape a
 * shortcut-numbering defect hides in — a pinned group would have renumbered the
 * visible rows and left the shortcuts pointing at the old ones.
 *
 * A pinned id is drawn once: it appears in the „Za tebe" block and is removed
 * from its own category, because the same row twice is a list, not a shortlist.
 * Locked modules („Početna", „Podešavanja") are never pinnable — they are the
 * two rows a user cannot switch off, so promoting them says nothing.
 */
export function sidebarGroups(
  registry: ModuleRegistry,
  enabled: ReadonlySet<string>,
  pinned: readonly string[],
): NavGroup[] {
  const categories = registry.byCategory();
  const known = new Set<string>();
  for (const members of categories.values()) for (const m of members) known.add(m.id);

  const promoted: string[] = [];
  for (const moduleId of pinned) {
    if (promoted.includes(moduleId)) continue;
    if (!known.has(moduleId) || LOCKED_MODULE_IDS.has(moduleId)) continue;
    if (!enabled.has(moduleId)) continue;
    promoted.push(moduleId);
  }

  const groups: NavGroup[] = [];
  if (promoted.length > 0) groups.push({ key: PINNED_GROUP_KEY, moduleIds: promoted });
  for (const [category, members] of categories) {
    const moduleIds = members
      .map((manifest) => manifest.id)
      .filter((id) => enabled.has(id) && !promoted.includes(id));
    if (moduleIds.length > 0) groups.push({ key: category satisfies ModuleCategory, moduleIds });
  }
  return groups;
}
