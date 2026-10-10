import type { ModuleText } from "@nexus/core";
import { mainLocale } from "../../../main/locale.js";
import type { WorkshopTarget } from "../shared/ipc.js";

/**
 * The one word this module gives the operating system: the name of a file
 * filter in the open dialog.
 *
 * **Why a module carries copy at all.** A dialog is drawn by the OS, from the
 * main process, before any page exists - so it cannot read the module's own copy
 * table (`renderer/copy.sr.ts`), which arrives with the page's chunk and is
 * rewritten in place by the renderer's locale machinery. It is the same reason
 * `main/shellStrings.ts` keeps both languages in one file, and the shape here is
 * the same one a manifest uses.
 *
 * The filter name is a FILE KIND rather than a sentence, so it is short and it
 * is what the trade calls the format; Serbian keeps the English word for STL and
 * Gerber, which is what a Serbian maker says out loud, and writes G-code the way
 * the rest of the app does ("G-kod").
 */
const FILTER_NAMES: Readonly<Record<WorkshopTarget, ModuleText>> = {
  model: { sr: "STL model", en: "STL model" },
  toolpath: { sr: "G-kod", en: "G-code" },
  board: { sr: "Gerber i Excellon", en: "Gerber and Excellon" },
};

/**
 * The filter's name, in the language main is writing in. `locale` is a parameter
 * with `mainLocale()` as its default so the pairing can be asserted in a test
 * without touching the process's own locale state.
 */
export function dialogFilterName(
  target: WorkshopTarget,
  locale: "sr" | "en" = mainLocale(),
): string {
  return FILTER_NAMES[target][locale];
}
