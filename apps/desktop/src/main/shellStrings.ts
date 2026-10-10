/**
 * Main's copy for NATIVE OS CHROME and PERSISTED DEFAULTS - the counterpart to
 * `notificationStrings.ts` for everything that module does not cover. The main
 * process cannot import the renderer's `strings.ts` (a separate bundle,
 * browser-only build), so these two files together are main's complete answer
 * to a locale switch.
 *
 * The split from `notificationStrings.ts` is by KIND, not by topic:
 * `notificationStrings.ts` COMPOSES a sentence per event from data (a title, a
 * date, a count), while this file holds CONSTANTS - text handed to Electron
 * as-is, with nothing built around it. Two different kinds of constant live
 * here, and they behave differently under a locale switch:
 *
 * - **File-dialog chrome** - filter names and dialog titles passed to
 *   Electron's native `dialog.showOpenDialog` / `showSaveDialog`. These are
 *   read fresh every time a dialog opens, so a locale switch changes what the
 *   NEXT dialog shows, exactly like a notification's text changes for the
 *   NEXT event.
 * - **Persisted defaults** - text WRITTEN INTO DATA: a newly created account's
 *   label, a duplicated note's title suffix, a backup file's fallback slug
 *   token. These have a property the dialog chrome does not: once written, they
 *   are PERSISTED. A later locale switch does NOT retranslate an account
 *   already named "Moj nalog" or a note already suffixed " (kopija)" - and that
 *   is correct, not a defect. Renaming a user's saved data because they changed
 *   the UI language would be a worse surprise than leaving it exactly as it was
 *   written; the locale controls what gets written NEXT, never what is already
 *   on disk.
 *
 * Every constant therefore moved into a per-locale table and is read through
 * `shellStrings()` at the moment it is used. A constant captured at module
 * scope would freeze whichever language was active when this module loaded,
 * which is the same defect `check-string-capture` guards against in the
 * renderer.
 */
import { mainLocale, type MainLocale } from "./locale.js";

/** One locale's worth of this file's text. */
export interface ShellStrings {
  encryptedArchiveFilterName: string;
  archiveFilterName: string;
  calendarFilenameToken: string;
  calendarFilterName: string;
  sketchFilterName: string;
  rosWorkspaceDialogTitle: string;
  rosWorkspaceDialogButton: string;
  ankiDeckFilterName: string;
  csvTableFilterName: string;
  statementDialogTitle: string;
  statementFilterName: string;
  imageFilterName: string;
  packDialogTitle: string;
  packDialogButton: string;
  portableRefusedTitle: string;
  portableRefusedBody: string;
  defaultAccountLabel: string;
  noteCopySuffix: string;
  backupProfileSlugFallback: string;
}

const SR: ShellStrings = {
  /** Save-dialog filter for an encrypted whole-profile export (`imex.ts`'s `handleExport`, passphrase branch). */
  encryptedArchiveFilterName: "Nexus šifrovana arhiva",
  /**
   * Filter for a whole-profile `.nexus`/`.nexus.zip` archive - the plaintext
   * save filter (`imex.ts`'s `handleExport`, no-passphrase branch) and the open
   * filter (`index.ts`'s `pickArchiveFile`) are the SAME string, one constant.
   */
  archiveFilterName: "Nexus arhiva",
  /**
   * The word inside the suggested filename for a calendar-only export
   * (`imex.ts`'s `handleIcsExport`): `nexus-kalendar-<date>.ics`.
   */
  calendarFilenameToken: "kalendar",
  /**
   * Filter for an `.ics` calendar file - the export save filter (`imex.ts`'s
   * `handleIcsExport`) and the import open filter (`index.ts`'s `pickIcsFile`)
   * are the SAME string, one constant: it is the same kind of file going the
   * other way.
   */
  calendarFilterName: "Kalendar (iCalendar)",
  /**
   * Save-dialog filter for a generated Arduino sketch (`index.ts`'s
   * `elec:export-code`, ADR-085 E4). The extension is what the Arduino IDE
   * insists on: a `.ino` must sit in a folder of the same name, which is why
   * the suggested filename is the circuit's slug and not a date.
   */
  sketchFilterName: "Arduino skica",
  /**
   * The directory picker for a generated ROS 2 package (`index.ts`'s
   * `elec:export-code`, ADR-085 E4b). The user points at a colcon workspace's
   * `src/` and Nexus makes the package folder inside it, so the title asks for
   * the PARENT - "izaberi paket" would be asking for a thing that does not
   * exist yet.
   */
  rosWorkspaceDialogTitle: "Gde da se napravi ROS 2 paket",
  /** The picker's confirm button. Native default is "Open", which says nothing here. */
  rosWorkspaceDialogButton: "Napravi ovde",
  /** Open-dialog filter for an Anki deck (`index.ts`'s `pickApkgFile`, ADR-052). */
  ankiDeckFilterName: "Anki špil",
  /** Open-dialog filter for a hand-kept task table (`index.ts`'s `pickCsvFile`, ADR-062). */
  csvTableFilterName: "CSV tabela",
  /**
   * Open-dialog title for a bank statement import (`index.ts`'s
   * `pickFinCsvFile`, FIN slice e) - named separately from
   * `csvTableFilterName` because a statement is a different thing to pick than
   * a task table, even sharing an extension.
   */
  statementDialogTitle: "Izaberi izvod (.csv)",
  /** Open-dialog filter for a bank statement import (`index.ts`'s `pickFinCsvFile`, FIN slice e). */
  statementFilterName: "Izvod (CSV)",
  /**
   * Open-dialog filter for a picked image - the dashboard background picker
   * (`index.ts`'s `handleDashboardPick`, ADR-041) and the profile-picture
   * picker (`profilePicture.ts`'s `pickProfilePicture`) are the SAME string,
   * one constant.
   */
  imageFilterName: "Slika",
  /**
   * The folder picker for a content pack (ADR-091, `index.ts`'s `packs:inspect`).
   * A folder and not a file, because that is what a pack IS: `pack.json`, its
   * signature and the content beside them. The title says which thing is being
   * chosen, and the button says that the folder named is the pack — Electron's
   * own default is „Select Folder", which reads as a step rather than an answer.
   */
  packDialogTitle: "Izaberi fasciklu paketa",
  packDialogButton: "Izaberi ovu fasciklu",
  /**
   * The early-startup dialog a portable launch shows when the stick refuses to
   * be written to (ADR-102, `index.ts`). The title names the stick, the body
   * says why nothing can continue and what to do instead; `index.ts` adds the
   * OS's own words for the failed write on a second paragraph, untranslated,
   * because a diagnostic is not copy.
   */
  portableRefusedTitle: "Nexus ne može da piše na ovaj USB",
  portableRefusedBody:
    "Fascikla NexusData pored programa je samo za čitanje, pa Nexus ne sme da čuva tvoje podatke na ovom računaru. Kopiraj Nexus na disk ili na USB na koji može da se piše, pa ga pokreni ponovo.",
  /**
   * The label given to an account nobody named (`accounts.ts`'s
   * `defaultAccountLabel`, ADR-044 section 3) - renameable from the picker, so
   * a generic name costs the user one rename and never costs them their data.
   */
  defaultAccountLabel: "Moj nalog",
  /** The mark a duplicated note carries, in its document and its title (`noteDuplicate.ts`'s `noteCopySuffix`, NOTE-010). */
  noteCopySuffix: " (kopija)",
  /**
   * The filename token a scheduled backup falls back to when a profile's name
   * sanitizes to nothing (`backup.ts`'s `backupProfileSlug`, SET-011).
   */
  backupProfileSlugFallback: "profil",
};

const EN: ShellStrings = {
  encryptedArchiveFilterName: "Nexus encrypted archive",
  archiveFilterName: "Nexus archive",
  calendarFilenameToken: "calendar",
  calendarFilterName: "Calendar (iCalendar)",
  sketchFilterName: "Arduino sketch",
  rosWorkspaceDialogTitle: "Where to create the ROS 2 package",
  rosWorkspaceDialogButton: "Create here",
  ankiDeckFilterName: "Anki deck",
  csvTableFilterName: "CSV table",
  statementDialogTitle: "Choose a statement (.csv)",
  statementFilterName: "Statement (CSV)",
  imageFilterName: "Image",
  packDialogTitle: "Choose a pack folder",
  packDialogButton: "Choose this folder",
  portableRefusedTitle: "Nexus cannot write to this USB stick",
  portableRefusedBody:
    "The NexusData folder beside the program is read-only, so Nexus cannot keep your data on this computer. Copy Nexus to a disk or a USB stick that can be written to, then start it again.",
  defaultAccountLabel: "My account",
  noteCopySuffix: " (copy)",
  backupProfileSlugFallback: "profile",
};

const SHELL_STRINGS: Record<MainLocale, ShellStrings> = { sr: SR, en: EN };

/**
 * This file's text for the locale main is currently serving.
 *
 * A function and not a record of live getters, so every call site reads the
 * language at the moment it draws or writes rather than at import.
 */
export function shellStrings(): ShellStrings {
  return SHELL_STRINGS[mainLocale()];
}
