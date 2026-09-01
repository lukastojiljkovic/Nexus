/**
 * Serbian copy for the main process's NATIVE OS CHROME and PERSISTED DEFAULTS —
 * the main-side counterpart to `notificationStrings.ts` for everything that
 * module does not cover. The main process cannot import the renderer's
 * `strings.ts` (see that module's own header) — a separate bundle,
 * browser-only build — so these two files together are main's complete answer
 * to a locale switch.
 *
 * The split from `notificationStrings.ts` is by KIND, not by topic:
 * `notificationStrings.ts` COMPOSES a sentence per event from data (a title, a
 * date, a count), while this file holds CONSTANTS — text handed to Electron
 * as-is, with nothing built around it. Two different kinds of constant live
 * here, and they behave differently under a locale switch:
 *
 * - **File-dialog chrome** — filter names and dialog titles passed to
 *   Electron's native `dialog.showOpenDialog` / `showSaveDialog`. These are
 *   read fresh every time a dialog opens, so a locale switch changes what the
 *   NEXT dialog shows, exactly like a notification's text changes for the
 *   NEXT event.
 * - **Persisted defaults** — text WRITTEN INTO DATA: a newly created account's
 *   label, a duplicated note's title suffix, a backup file's fallback slug
 *   token. These have a property the dialog chrome does not: once written,
 *   they are PERSISTED. A later locale switch does NOT retranslate an account
 *   already named "Moj nalog" or a note already suffixed " (kopija)" — and
 *   that is correct, not a defect. Renaming a user's saved data because they
 *   changed the UI language would be a worse surprise than leaving it exactly
 *   as it was written; the locale controls what gets written NEXT, never what
 *   is already on disk.
 */

// ---------------------------------------------------------------------------
// File-dialog chrome
// ---------------------------------------------------------------------------

/** Save-dialog filter for an encrypted whole-profile export (`imex.ts`'s `handleExport`, passphrase branch). */
export const ENCRYPTED_ARCHIVE_FILTER_NAME = "Nexus šifrovana arhiva";

/**
 * Filter for a whole-profile `.nexus`/`.nexus.zip` archive — the plaintext
 * save filter (`imex.ts`'s `handleExport`, no-passphrase branch) and the open
 * filter (`index.ts`'s `pickArchiveFile`) are the SAME string, one constant.
 */
export const ARCHIVE_FILTER_NAME = "Nexus arhiva";

/**
 * The word inside the suggested filename for a calendar-only export
 * (`imex.ts`'s `handleIcsExport`): `nexus-kalendar-<date>.ics`.
 */
export const CALENDAR_FILENAME_TOKEN = "kalendar";

/**
 * Filter for an `.ics` calendar file — the export save filter (`imex.ts`'s
 * `handleIcsExport`) and the import open filter (`index.ts`'s `pickIcsFile`)
 * are the SAME string, one constant: it is the same kind of file going the
 * other way.
 */
export const CALENDAR_FILTER_NAME = "Kalendar (iCalendar)";

/**
 * Save-dialog filter for a generated Arduino sketch (`index.ts`'s
 * `elec:export-code`, ADR-085 E4). „Skica" is what the Arduino IDE's own
 * Serbian-speaking users call a sketch, and the extension is what the IDE
 * insists on: a `.ino` must sit in a folder of the same name, which is why the
 * suggested filename is the circuit's slug and not a date.
 */
export const SKETCH_FILTER_NAME = "Arduino skica";

/**
 * The directory picker for a generated ROS 2 package (`index.ts`'s
 * `elec:export-code`, ADR-085 E4b). The user points at a colcon workspace's
 * `src/` and Nexus makes the package folder inside it, so the title asks for
 * the PARENT — „izaberi paket" would be asking for a thing that does not exist
 * yet.
 */
export const ROS_WORKSPACE_DIALOG_TITLE = "Gde da se napravi ROS 2 paket";

/** The picker's confirm button. Native default is „Open", which says nothing here. */
export const ROS_WORKSPACE_DIALOG_BUTTON = "Napravi ovde";

/** Open-dialog filter for an Anki deck (`index.ts`'s `pickApkgFile`, ADR-052). */
export const ANKI_DECK_FILTER_NAME = "Anki špil";

/** Open-dialog filter for a hand-kept task table (`index.ts`'s `pickCsvFile`, ADR-062). */
export const CSV_TABLE_FILTER_NAME = "CSV tabela";

/**
 * Open-dialog title for a bank statement import (`index.ts`'s
 * `pickFinCsvFile`, FIN slice e) — named separately from
 * `CSV_TABLE_FILTER_NAME` because a statement is a different thing to pick
 * than a task table, even sharing an extension.
 */
export const STATEMENT_DIALOG_TITLE = "Izaberi izvod (.csv)";

/** Open-dialog filter for a bank statement import (`index.ts`'s `pickFinCsvFile`, FIN slice e). */
export const STATEMENT_FILTER_NAME = "Izvod (CSV)";

/**
 * Open-dialog filter for a picked image — the dashboard background picker
 * (`index.ts`'s `handleDashboardPick`, ADR-041) and the profile-picture picker
 * (`profilePicture.ts`'s `pickProfilePicture`) are the SAME string, one
 * constant.
 */
export const IMAGE_FILTER_NAME = "Slika";

// ---------------------------------------------------------------------------
// Persisted defaults
// ---------------------------------------------------------------------------
//
// See the header above: these are written into data, not read fresh per call,
// so a locale switch deliberately leaves already-written rows alone.

/**
 * The label given to an account nobody named (`accounts.ts`'s
 * `DEFAULT_ACCOUNT_LABEL`, ADR-044 section 3) — renameable from the picker,
 * so a generic name costs the user one rename and never costs them their
 * data.
 */
export const DEFAULT_ACCOUNT_LABEL = "Moj nalog";

/** The mark a duplicated note carries, in its document and its title (`noteDuplicate.ts`'s `NOTE_COPY_SUFFIX`, NOTE-010). */
export const NOTE_COPY_SUFFIX = " (kopija)";

/**
 * The filename token a scheduled backup falls back to when a profile's name
 * sanitizes to nothing (`backup.ts`'s `backupProfileSlug`, SET-011).
 */
export const BACKUP_PROFILE_SLUG_FALLBACK = "profil";
