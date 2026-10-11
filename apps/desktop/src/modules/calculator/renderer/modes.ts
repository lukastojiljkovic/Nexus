import type { ModuleManifest } from "@nexus/core";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";

/**
 * The two declared settings controls, and the one reader of their option labels.
 *
 * **Why this file exists.** The page's switches and the settings card draw the
 * SAME two rows, and `moduleSurface.ts`'s rule is that a module renders what its
 * manifest declares rather than repeating it: the declaration is what the settings
 * filter indexes, so a second copy of a label is how a card comes to search under
 * one name and render another (`timers/renderer/Settings.tsx` states the same for
 * its one row). Two files draw these rows, so the lookup lives in one of them and
 * not in both.
 *
 * `declaredText` is the reader for a `{ sr, en }` pair, because a manifest's pair
 * is NOT rewritten in place by `applyLocale` the way a copy table is - so the pair
 * has to be resolved against the language being read at the moment it is drawn.
 */

type DeclaredControls = NonNullable<ModuleManifest["settings"]>["controls"];
type DeclaredControl = DeclaredControls[number] | undefined;

/** „Ugao": the row the page's angle switch and the settings card both draw. */
export const ANGLE_CONTROL: DeclaredControl = manifest.settings?.controls.find(
  (control) => control.key === "angle-mode",
);

/** „Režim brojeva": the same, one row down. */
export const NUMBER_CONTROL: DeclaredControl = manifest.settings?.controls.find(
  (control) => control.key === "number-mode",
);

/**
 * The declared label of one option, by its id.
 *
 * The fallbacks are deliberate and both are dead in the shipping tree: an
 * unresolved option id renders the id itself (visible as a missing translation
 * rather than as a blank button), and a control that is not a `choice` - which
 * `modules.test.ts` would refuse - renders nothing but the id. A page that threw
 * here would take the calculator down over a manifest typo.
 */
export function optionLabel(control: DeclaredControl, id: string): string {
  if (control === undefined || control.kind !== "choice") return id;
  const option = control.options.find((candidate) => candidate.id === id);
  return option === undefined ? id : declaredText(option.labelKey);
}
