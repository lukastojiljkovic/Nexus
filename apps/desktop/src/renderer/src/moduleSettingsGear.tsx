import { createContext, useContext, type ReactNode } from "react";
import { Icon } from "@nexus/ui";

import { moduleName } from "./moduleName.js";
import { fill, lookup, strings } from "./strings.js";

/**
 * The gear a module page wears beside its title: that page's way into its OWN
 * card in „Podešavanja", which SET-015 keeps two levels deep — a category, then
 * the card (ADR-088). Without it the only road to a module's settings is the
 * sidebar, then „Moduli", then the „Podešavanja modula" list, then the row.
 *
 * WHY THIS IS ONE COMPONENT AND NOT TWELVE COPIES. The pages share their header
 * (`PageHeader` in @nexus/ui) but not their header's ACTIONS: every page passes
 * its own — TASK's four shape buttons, DOC's view switcher, PRIV's search field
 * — and `@nexus/ui` is a design system that knows nothing about this
 * shell's navigation. So the shared place is this file: every page renders ONE
 * line in its `actions` slot, and the size, the ink, the focus ring, the
 * accessible name and the wiring live here rather than in each of them.
 *
 * WHICH PAGES RENDER IT IS NOT A LIST HERE. A module has a card when its
 * manifest declares one (`SettingsPanel`), which is the registry's answer and
 * is handed in below (`withSettings`); a module that declares none renders
 * nothing even if a page asks. Adding a module's settings is therefore a
 * declaration and a panel component, exactly as it already was, and a page
 * cannot grow a gear over a card that does not exist.
 *
 * THE GLYPH IS `settings`, NOT A GEAR, and that is the icon set's decision
 * rather than a slip: `Icon`'s own comment records it — „Sliders, not a gear:
 * settings are things you set, not machinery" — and this is the same mark the
 * sidebar row, the app menu's row and the Settings page's own sigil wear. A
 * cog here would be the one place in the product where the settings mark is a
 * different shape.
 */

/** What the shell offers a module page's header: which modules have a card, and how to open one. */
export interface ModuleSettingsNav {
  /**
   * The module ids whose manifests declare a settings card
   * (`moduleSettingsCardIds`). Deliberately the ids rather than a callback the
   * gear calls: the question is asked per header render, and a set is the whole
   * answer.
   */
  readonly withSettings: ReadonlySet<string>;
  /** Opens „Podešavanja" at that module's card. The shell owns where a page is. */
  readonly open: (moduleId: string) => void;
}

/**
 * Held in context rather than passed to each page as props, on `NoteLinkContext`
 * and `ToolRiskContext`'s precedent: it is one shell facility that a dozen
 * leaves reach, and threading it through twelve page prop interfaces would be
 * twelve more places to keep in step for one button.
 *
 * `null` outside the shell — a page mounted on its own, as the gallery and the
 * component tests do — and the gear then draws nothing, because there is
 * nowhere for it to go.
 */
const ModuleSettingsNavContext = createContext<ModuleSettingsNav | null>(null);

export function ModuleSettingsNavProvider({
  value,
  children,
}: {
  readonly value: ModuleSettingsNav;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <ModuleSettingsNavContext.Provider value={value}>{children}</ModuleSettingsNavContext.Provider>
  );
}

/**
 * One module page's settings button. A real `<button>`, so Tab reaches it and
 * Enter and Space both activate it; the tooltip repeats the accessible name
 * rather than adding a second wording, which is what the shell's own
 * icon-only buttons do.
 */
export function ModuleSettingsGear({ moduleId }: { readonly moduleId: string }): ReactNode {
  const nav = useContext(ModuleSettingsNavContext);
  if (nav === null || !nav.withSettings.has(moduleId)) return null;

  // The phrase table first: Serbian needs the module in the accusative, which
  // is why the label is written per module rather than composed. A module the
  // table does not know yet is named by `moduleName` in a phrasing that needs
  // no case at all, so a gear can never appear nameless.
  const label =
    lookup(strings.settings.moduleSettingsButton, moduleId) ??
    fill(strings.settings.moduleSettingsButtonFallback, { name: moduleName(moduleId) });

  return (
    <button
      type="button"
      className="app__page-gear"
      aria-label={label}
      title={label}
      onClick={() => nav.open(moduleId)}
    >
      <Icon name="settings" size={16} />
    </button>
  );
}
