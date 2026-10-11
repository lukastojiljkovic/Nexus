import type { ModuleText } from "@nexus/core";
import { mainLocale } from "../../../main/locale.js";

/**
 * The two words the ASSISTANT gives the operating system: the title of the
 * "import a model" dialog and the name of its file filter.
 *
 * **Why a module carries copy at all.** A dialog is drawn by the OS, from the
 * main process, before any page exists - so it cannot read the module's own copy
 * table (`renderer/copy.sr.ts`), which arrives with the page's chunk. It is
 * `main/shellStrings.ts`'s reason and the workshop module's own shape.
 *
 * The filter name is a FILE FORMAT rather than a sentence: `.gguf` is what the
 * format is called in every language, and a translated one would name a kind of
 * file that does not exist.
 */
const COPY: {
  readonly title: ModuleText;
  readonly filter: ModuleText;
} = {
  title: { sr: "Izaberi model (.gguf)", en: "Choose a model (.gguf)" },
  filter: { sr: "GGUF model", en: "GGUF model" },
};

/** The dialog's title, in the language main is writing in. */
export function importDialogTitle(locale: "sr" | "en" = mainLocale()): string {
  return COPY.title[locale];
}

/** The file filter's name, in the language main is writing in. */
export function importDialogFilterName(locale: "sr" | "en" = mainLocale()): string {
  return COPY.filter[locale];
}
