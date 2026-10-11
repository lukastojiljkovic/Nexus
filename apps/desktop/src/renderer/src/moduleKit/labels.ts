import type { LabelText } from "@nexus/core";
import type { SearchKind } from "@nexus/core";
import { lookupString } from "../dashboardLayout.js";
import { activeLocale, strings } from "../strings.js";
import { kitManifest, kitManifests } from "../../../shared/modules.js";

/**
 * The one reader of a declared label, whichever of `LabelText`'s two forms the
 * declaration used.
 *
 * **Why this exists.** Every label the shell draws - a widget's title, a settings
 * control's name, a module's own name in the rail - used to be a dotted path
 * into `strings`, so the call site was `lookupString(strings, key) ?? fallback`.
 * A kit module carries its words instead, because its page copy must not be in
 * the startup chunk and the shell needs its name before any page loads. Both
 * forms answer the same question, so both go through one function; the fallback
 * stays at the call site, where the caller still knows what to print when there
 * is nothing.
 *
 * **The answer is total, and the fallback is the path itself.** `lookupString`
 * answers `null` for a dotted path that resolves to nothing, and every call site
 * used to pair it with a fallback of its own — the module id, the option id, the
 * key again. Those arms are dead in the shipping tree (`modules.test.ts` pins
 * that every declared title and label resolves) and they were three spellings of
 * one thing, which is exactly the cost this kit is removing. A dangling path now
 * renders AS the path: a visible `settings.foo.title` is legible as a missing
 * translation in a way that a module's name in its place is not.
 */
export function resolveLabel(label: LabelText): string {
  if (typeof label !== "string") return label[activeLocale()];
  return lookupString(strings, label) ?? label;
}

/**
 * One `{ sr, en }` pair, in the language being read: what a DISCOVERED module
 * renders for a word it declared in its own manifest.
 *
 * **Why the pair cannot simply be read like copy.** A module's copy table is
 * rewritten in place by `applyLocale` (`defineModuleCopy`), so `copy.page.title`
 * is always the current language. A manifest is not: it is registered once, at
 * startup, and lives in `@nexus/core`'s registry — so a module that draws one of
 * its own declared words has to ask which language is being read, which is what
 * this does. `undefined` answers the empty string: a module that declares no
 * copy has no word to draw, and a blank is the honest result rather than the
 * word "undefined" on screen.
 */
export function declaredText(label: LabelText | undefined): string {
  if (label === undefined) return "";
  // A dotted path is returned AS WRITTEN rather than looked up: this function
  // reads what a DISCOVERED module declared in its own manifest, and a module
  // that declared a shell path would be naming a table it does not own. The
  // shell's own `resolveLabel` is the function for that question.
  return typeof label === "string" ? label : label[activeLocale()];
}

/**
 * A discovered module's declared word - its name, its one-line description, the
 * title of its settings card, the label of one of its settings controls - or
 * `null` when this build has no such declaration.
 *
 * The manifest is read fresh on every call rather than captured: a component
 * that took a leaf at module scope would freeze whatever language was active when
 * its chunk loaded, which is the exact defect `check-string-capture` exists to
 * catch in the `strings` table.
 */
export function moduleCopyText(id: string, key: "name" | "description"): string | null {
  const declared = kitManifest(id)?.copy;
  if (declared === undefined) return null;
  return declared[key][activeLocale()];
}

/**
 * A search kind's label, in one of its two numbers, for a kind a kit module
 * owns. `null` when no discovered module declares the kind, which leaves the
 * caller with the shell's own `strings.search` table - the answer for every kind
 * a compiled-in module owns.
 */
export function moduleKindLabel(kind: string, plural: boolean): string | null {
  for (const manifest of kitManifests()) {
    const declared = manifest.copy?.kinds?.find((entry) => entry.kind === kind);
    if (declared !== undefined) return (plural ? declared.plural : declared.singular)[activeLocale()];
  }
  return null;
}

/**
 * A search kind's label in one of its two numbers, from whichever side declares
 * it: a discovered module's own `copy.kinds`, else the shell's
 * `strings.search.kindSingular`/`kindPlural` table.
 *
 * One function rather than a branch at each of the eight call sites (two cards,
 * the palette and the search page), because a kind's wording has exactly one
 * source and eight places that could each pick a different one.
 */
export function searchKindLabel(kind: SearchKind, plural: boolean): string {
  return (
    moduleKindLabel(kind, plural) ??
    (plural ? strings.search.kindPlural[kind] : strings.search.kindSingular[kind])
  );
}
