/**
 * Which language the main process writes ITS own copy in.
 *
 * The main process cannot read the renderer's locale preference: it is a
 * separate bundle and the storage belongs to the renderer. So the answer is
 * reported over IPC (`locale:set`, see `shared/ipc.ts`) and kept here, in one
 * variable, for the two modules that compose copy - `shellStrings.ts` and
 * `notificationStrings.ts`.
 *
 * The initial value is Serbian, which is what an automated run (`--shots`,
 * `--demo`) gets: those never report a locale, and their output is pinned to
 * the language the existing snapshots were taken in. A real launch replaces it
 * before the first dialog opens - `index.ts` seeds it from the OS locale, and
 * the renderer reports the stored choice as soon as it serves it.
 */

export type MainLocale = "sr" | "en";

let current: MainLocale = "sr";

export function setMainLocale(locale: MainLocale): void {
  current = locale;
}

export function mainLocale(): MainLocale {
  return current;
}
