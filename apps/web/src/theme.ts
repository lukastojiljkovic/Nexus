/**
 * Dan and Noć on the web — the desktop renderer's own theme module, IMPORTED
 * and not copied.
 *
 * It is thirty lines of logic (read the stored preference, resolve „system"
 * against `prefers-color-scheme`, write `<html data-theme>`, subscribe to OS
 * changes) and every line of it is browser API, so there is nothing about it
 * that is Electron's. Copying it here would have created a second answer to
 * „which theme is the app in" that drifts the first time one side gains a third
 * theme or changes the storage key — the same class of defect this codebase
 * keeps finding, in the one place where it was avoidable for free.
 *
 * The reach into another app's source is the same reach `api.ts` makes and is
 * as temporary: `theme.ts` and `shared/ipc.ts` both belong in a package that
 * neither app owns. Keeping the reach to exactly these two files is what makes
 * that move small.
 */
export * from "../../desktop/src/renderer/src/theme.js";
