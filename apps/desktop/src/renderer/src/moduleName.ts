import { lookup, strings } from "./strings.js";
import { moduleCopyText } from "./moduleKit/labels.js";

/**
 * A module's display name — the one the sidebar renders, and therefore the one
 * every page title must render too.
 *
 * It lives in its own module rather than in `App.tsx` for a boring reason with a
 * real consequence: `App.tsx` imports every page, so a page importing it back
 * would be a cycle. Before this file existed the answer was a private copy of
 * these three lines in each page, and a copy is how „Predmeti" ended up as the
 * heading of the page the rail calls „Učenje".
 *
 * The fallback is the raw id rather than a placeholder: a module with no
 * translated name is a bug, and printing its id makes that bug legible instead
 * of hiding it behind an em dash.
 */
export function moduleName(id: string): string {
  // A discovered module carries its own words (ADR-090): the rail draws its
  // name before any of its chunks load, so the manifest is where it has to live.
  // The lookup comes first so a compiled-in module's copy stays in `strings`.
  return lookup(strings.modules, id) ?? moduleCopyText(id, "name") ?? id;
}

/**
 * A module's one-line description - the settings gallery's caption under its
 * name, and the keywords its gallery row answers to in the settings filter.
 *
 * Its own function because the fallback is not a placeholder: a compiled-in
 * module that has no description renders an empty line, and the gallery has
 * always drawn it that way.
 */
export function moduleDescription(id: string): string {
  return lookup(strings.settings.moduleDescriptions, id) ?? moduleCopyText(id, "description") ?? "";
}
