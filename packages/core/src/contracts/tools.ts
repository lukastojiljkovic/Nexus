/**
 * A tool a module registers with the utilities host (PRD 29 UTIL) — „Alatke",
 * the drawer. This is the „resolved when the UTIL tool host lands" the previous
 * shape of this file promised.
 *
 * **The host has no privileged path.** „Alatke"'s own converters and
 * calculators are declared through this very contract, exactly as any other
 * module's would be, so a future module contributes a tool by publishing a
 * declaration rather than by editing the drawer. The drawer collects
 * `manifest.tools` across the registry and renders what it finds; its chrome
 * carries no `switch` and no list of ids.
 *
 * **Identity here, render in the renderer.** This package is framework-free and
 * is loaded by the Electron MAIN process too, so a React element cannot live on
 * this type. The pairing is the one the app already uses twice — `WidgetContract`
 * against `DASHBOARD_WIDGETS`, `SettingsPanel` against `MODULE_SETTINGS_PANELS`
 * — a declaration here, a component in the renderer's own map, and a test that
 * pins the two together so neither can drift.
 */

/**
 * What a tool DOES, which is the only grouping the drawer draws. Two values,
 * because there are honestly two: one says the same quantity a different way,
 * the other works something out from numbers the user supplies. A finer
 * taxonomy would be shelving for its own sake.
 */
export const TOOL_CATEGORIES = ["conversion", "calculation"] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export interface ToolRegistration {
  /** Stable tool id, unique across the UTIL registry. ASCII slug: it is a key, never a label. */
  id: string;
  /** i18n key for the tool's display name — a path into `strings`, not Serbian copy. */
  titleKey: string;
  /** Which half of the drawer this tool belongs under. */
  category: ToolCategory;
  /**
   * Extra words the drawer's search matches besides the name — „inč", „stopa",
   * „funta" for the length converter. Lowercase and diacritic-free, the
   * `SettingsControl.keywords` convention exactly, because a drawer of a dozen
   * tools is only searchable if „kilo" finds the mass converter.
   */
  keywords?: readonly string[];
}
