import {
  resolveEnabled,
  type FlagState,
  type ModuleRegistry,
  type SettingsPanel,
} from "@nexus/core";

import { lookupString } from "./dashboardLayout.js";
import { strings } from "./strings.js";

/**
 * The renderer's reader for the per-module settings contract (`SettingsPanel`)
 * — the sibling of `dashboardLayout.ts`/`dashboardWidgets.tsx` for the settings
 * page, and deliberately the same shape: the REGISTRY holds the catalogue, this
 * file turns it into the ordered list of cards the page draws, and
 * `moduleSettingsPanels.tsx` maps a module id to the component that draws one.
 *
 * Everything here is pure — a registry and a flag map in, plain data out — so
 * the composition the page performs is testable without a DOM, which is the
 * whole reason the page itself is left with nothing to decide.
 */

/**
 * The settings filter's entry id for one declared control (SET-014), qualified
 * exactly as a stored widget id is: `moduleId:key`. A panel highlights its own
 * labels by these, and `settingsSearch.ts` derives its entries under the same
 * ids — one spelling, so a hit and a highlight can never disagree.
 */
export function settingsEntryId(moduleId: string, key: string): string {
  return `${moduleId}:${key}`;
}

/** One module's declaration, paired with the module it belongs to. */
export interface ModuleSettingsDeclaration {
  readonly moduleId: string;
  readonly panel: SettingsPanel;
}

/**
 * Every module that publishes a settings card, in REGISTRY order and
 * regardless of flags. This is what the search index is built from: a hit for a
 * switched-off module still steers to its card, exactly as a disabled module's
 * gallery row still names it.
 */
export function moduleSettingsDeclarations(registry: ModuleRegistry): ModuleSettingsDeclaration[] {
  return registry
    .all()
    .flatMap((manifest) =>
      manifest.settings ? [{ moduleId: manifest.id, panel: manifest.settings }] : [],
    );
}

/** A card the settings page draws for one module: its section id, its resolved title, and the declaration behind both. */
export interface ModuleSettingsCard extends ModuleSettingsDeclaration {
  /** The card's Serbian title, resolved from `panel.titleKey`. */
  readonly title: string;
}

/**
 * The module cards the page renders, in registry order — nothing at all for a
 * module the profile has switched off (SET-007), on the rule the dashboard's
 * own placements already follow: a card for a module the sidebar does not show
 * is a dangling control.
 */
export function moduleSettingsCards(
  registry: ModuleRegistry,
  flags: FlagState,
): ModuleSettingsCard[] {
  const enabled = new Set(resolveEnabled(registry, flags));
  return moduleSettingsDeclarations(registry)
    .filter((declaration) => enabled.has(declaration.moduleId))
    .map((declaration) => ({
      ...declaration,
      title: lookupString(strings, declaration.panel.titleKey) ?? declaration.moduleId,
    }));
}

/**
 * Whether a card may offer „Vrati na podrazumevano" (SET §5): it holds at least
 * one value, and every one of them lives on THIS device. A profile-stored
 * setting is excluded on purpose — resetting one would be a write about the
 * user's data rather than about this machine, a different act with a different
 * blast radius, and the reset dialog promises the opposite in as many words.
 */
export function isDeviceOnlyPanel(panel: SettingsPanel): boolean {
  const stored = panel.controls.filter((control) => control.kind !== "fact");
  return stored.length > 0 && stored.every((control) => control.storage === "device");
}
