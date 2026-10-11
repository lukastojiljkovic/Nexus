import { mainLocale } from "../../../main/locale.js";
import type { ModuleText } from "@nexus/core";

/**
 * The LAB's native-dialog copy, in both languages, in one file.
 *
 * **Why main holds its own copy here rather than reaching for the renderer's
 * table.** The port picker and the two save dialogs are opened by MAIN, and
 * main cannot read the renderer's locale preference or its copy — it is a
 * separate bundle, and a dialog is composed before any page is involved. So this
 * file carries `{ sr, en }` pairs and `mainLocale()` picks one, exactly as
 * `shellStrings.ts` and `notificationStrings.ts` do for the shell's own dialogs
 * and notifications. The pairs are `ModuleText`, the same shape a module's
 * manifest uses, so the two surfaces cannot disagree about what a pair IS.
 *
 * **A port's own name is not in here.** `COM3` is data the device reports, and
 * translating it would be inventing a name for somebody's hardware.
 */
export const LAB_DIALOG_COPY: {
  readonly portTitle: ModuleText;
  readonly portMessage: ModuleText;
  readonly portDetail: ModuleText;
  readonly cancel: ModuleText;
  readonly saveLogTitle: ModuleText;
  readonly saveCsvTitle: ModuleText;
  readonly fileFilter: ModuleText;
} = {
  portTitle: { sr: "Izbor serijskog porta", en: "Choose a serial port" },
  portMessage: {
    sr: "Izaberi port na koji je uređaj povezan.",
    en: "Pick the port the device is connected to.",
  },
  portDetail: {
    sr: "Nexus pamti izbor dok je pokrenut — pri sledećem pokretanju pitaće ponovo.",
    en: "Nexus remembers the choice while it is running — the next launch asks again.",
  },
  cancel: { sr: "Otkaži", en: "Cancel" },
  saveLogTitle: {
    sr: "Sačuvaj log terminala",
    en: "Save the terminal log",
  },
  saveCsvTitle: {
    sr: "Izvezi očitavanja kao CSV",
    en: "Export the readings as CSV",
  },
  fileFilter: { sr: "Tekstualne datoteke", en: "Text files" },
};

/** One of the pairs above, in the language main is writing in. */
export function dialogText(text: ModuleText): string {
  return text[mainLocale()];
}
