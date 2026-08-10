/**
 * A tool a module registers with a tool host (PRD 29 UTIL) — „Alatke", the
 * everyday drawer, and „Programerske alatke", the developer one.
 *
 * **The host has no privileged path.** „Alatke"'s own converters and
 * calculators are declared through this very contract, exactly as any other
 * module's would be, so a future module contributes a tool by publishing a
 * declaration rather than by editing the drawer. A drawer collects
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
 * Which drawer a tool lands in.
 *
 * Two drawers rather than one because the audiences do not overlap: a person
 * converting a recipe from cups does not want a RISC-V assembler in the same
 * list, and a developer looking for one does not want to scroll past VAT. The
 * developer drawer's module ships switched OFF and is turned on by answering
 * the opening questionnaire, so a user who is not a programmer never sees that
 * it exists.
 */
export const TOOL_DRAWERS = ["utilities", "developer"] as const;

export type ToolDrawer = (typeof TOOL_DRAWERS)[number];

/**
 * What a tool DOES, which is the only grouping a drawer draws — in the order
 * the rail draws them.
 *
 * The utilities half stayed at two values, because there are honestly two: one
 * says the same quantity a different way, the other works something out from
 * numbers the user supplies. The developer half is finer because its tools are
 * genuinely about different subjects rather than different verbs — a colour
 * space and a cron expression have nothing in common except who opens them.
 */
export const TOOL_CATEGORIES = [
  // utilities
  "conversion",
  "calculation",
  // developer
  "numbers",
  "riscv",
  "encoding",
  "data",
  "text",
  "design",
  "crypto",
  "system",
  "time",
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/**
 * The drawer each category belongs to.
 *
 * This is what keeps the contract's promise that a host has no privileged path.
 * A drawer could have been „the tools of MY module", which would have been one
 * line shorter and would have quietly retired the property that any module may
 * publish a tool — the NOTE module contributing a Markdown table builder would
 * have had nowhere to put it. Routing by CATEGORY keeps that open: a module
 * says what its tool is about, and where it is shelved follows.
 *
 * Typed as a total `Record`, so a category added above without a drawer here is
 * a compile error rather than a tool that silently appears in neither list.
 */
export const TOOL_CATEGORY_DRAWER: Readonly<Record<ToolCategory, ToolDrawer>> = {
  conversion: "utilities",
  calculation: "utilities",
  numbers: "developer",
  riscv: "developer",
  encoding: "developer",
  data: "developer",
  text: "developer",
  design: "developer",
  crypto: "developer",
  system: "developer",
  time: "developer",
};

/** The categories of one drawer, in `TOOL_CATEGORIES` order — the order its rail draws them in. */
export function toolCategoriesIn(drawer: ToolDrawer): readonly ToolCategory[] {
  return TOOL_CATEGORIES.filter((category) => TOOL_CATEGORY_DRAWER[category] === drawer);
}

export interface ToolRegistration {
  /** Stable tool id, unique across the UTIL registry. ASCII slug: it is a key, never a label. */
  id: string;
  /** i18n key for the tool's display name — a path into `strings`, not Serbian copy. */
  titleKey: string;
  /**
   * i18n key for the one line under the name, same rules. Optional because the
   * utilities drawer has none and needs none: „Dužina" in a list of eleven
   * converters explains itself, and a sentence under each would be noise. At
   * forty-eight tools it stops explaining itself, which is why the developer
   * drawer carries one everywhere.
   */
  blurbKey?: string;
  /** Which group of the drawer this tool belongs under — and, through `TOOL_CATEGORY_DRAWER`, which drawer. */
  category: ToolCategory;
  /**
   * Extra words the drawer's search matches besides the name — „inč", „stopa",
   * „funta" for the length converter. Lowercase and diacritic-free, the
   * `SettingsControl.keywords` convention exactly, because a drawer of a dozen
   * tools is only searchable if „kilo" finds the mass converter — and a drawer
   * of forty-eight is not usable without it.
   */
  keywords?: readonly string[];
}
