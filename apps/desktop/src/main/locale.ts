/**
 * Which language the main process writes ITS own copy in.
 *
 * The main process cannot read the renderer's locale preference: it is a
 * separate bundle and the storage belongs to the renderer. So the answer is
 * reported over IPC (`locale:set`, see `shared/ipc.ts`) and kept here, in one
 * variable, for the two modules that compose copy - `shellStrings.ts` and
 * `notificationStrings.ts`.
 *
 * The initial value is Serbian. `index.ts` replaces it before the first dialog
 * opens: an automated run (`--shots`, `--demo`) with the language it was pinned
 * to (Serbian, or English under `--locale=en`), a real launch with the OS
 * locale. The renderer then reports the stored choice as soon as it serves it.
 */

export type MainLocale = "sr" | "en";

let current: MainLocale = "sr";

export function setMainLocale(locale: MainLocale): void {
  current = locale;
}

export function mainLocale(): MainLocale {
  return current;
}
