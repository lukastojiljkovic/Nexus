import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type {
  SettingsPanelProps,
  SettingsPanelRenderer,
} from "../moduleSettingsPanels.js";

/**
 * A kit module's settings card BODY: `modules/<id>/renderer/Settings.tsx`,
 * loaded the first time the card is drawn.
 *
 * **Why the module brings a component rather than the shell drawing its
 * declaration.** The declaration (`SettingsPanel`) says what the card is CALLED
 * and makes it searchable before anything loads; it deliberately says nothing
 * about storage - `SettingsStorage` names "this machine" or "the profile", not
 * which key, which store or which refusal message. A shell that drew a toggle
 * from the declaration alone would have to invent that, and the first card
 * needing two settings would want a second invention. So the body is the
 * module's, exactly as `dashboardWidgets.tsx` is for a compiled-in widget, and
 * it is reached the same lazy way its page is.
 *
 * **`resetDevice` is never offered here**, and that is a decision rather than an
 * omission: a kit module's settings travel in an archive, so they are PROFILE
 * rows, and "Vrati na podrazumevano" promises a forgetting about this machine
 * that would be a write about the user's data. A module that stores something
 * device-local can add its own reset to its own body.
 */
const PANEL_LOADERS: Record<
  string,
  () => Promise<{ default: ComponentType<SettingsPanelProps> }>
> = import.meta.glob("../../../modules/*/renderer/Settings.tsx") as Record<
  string,
  () => Promise<{ default: ComponentType<SettingsPanelProps> }>
>;

const cache = new Map<string, LazyExoticComponent<ComponentType<SettingsPanelProps>>>();

/** The renderer for one discovered module's settings card, or `undefined` when this build has none. */
export function kitSettingsPanel(moduleId: string): SettingsPanelRenderer | undefined {
  const loader = PANEL_LOADERS[`../../../modules/${moduleId}/renderer/Settings.tsx`];
  if (loader === undefined) return undefined;
  const cached = cache.get(moduleId);
  if (cached !== undefined) return { Body: cached };
  const body = lazy(loader);
  cache.set(moduleId, body);
  return { Body: body };
}
