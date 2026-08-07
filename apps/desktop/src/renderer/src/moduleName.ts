import { strings } from "./strings.js";

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
  return strings.modules[id] ?? id;
}
