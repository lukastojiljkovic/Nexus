import type { ModuleManifest, ModuleText, WidgetContract } from "@nexus/core";

/**
 * The EMERGENCY card's manifest - the whole of what the shell knows about this
 * module before its page loads (ADR-090).
 *
 * **This file is the discovery contract.** `shared/modules.ts` globs
 * `modules/<id>/shared/manifest.ts` eagerly, so a manifest that exists is a
 * manifest the registry has - in the rail, in the settings gallery, in the
 * onboarding list, in `resolveEnabled` and in the shots harness - with no list
 * anywhere to add it to.
 *
 * **Why the words live here rather than in `strings.ts`.** The rail draws a
 * module's name before any chunk of the module has loaded, so this module
 * carries the few strings the shell needs as `{ sr, en }` pairs; everything its
 * own page draws lives in `renderer/copy.sr.ts`/`copy.en.ts`, where it stays out
 * of the startup chunk. The CARD's own headings are a third place
 * (`shared/cardText.ts`) for a third reason - they exist in both languages at
 * once, because the card prints in whichever languages the user chose.
 */

/**
 * The one dashboard card this module publishes (ADR-090 §widgets).
 *
 * **Why the card exists.** The module's whole reason to be is the moment
 * somebody else needs it: a stranger, a medic, an admissions desk. A card that
 * draws the holder's name, blood type, first emergency contact and the four
 * numbers to dial, and opens the module in one click, is the shortest path from
 * a home screen to that page.
 *
 * No `configFields`, on „Odbrojavanja"'s terms: a knob on a card narrows a LIST,
 * and there is nothing here to narrow - it is one card, one row of contacts and
 * one row of numbers.
 *
 * `title` is a `{ sr, en }` pair rather than a `strings` path, for the reason the
 * header gives: the dashboard can be reached without ever having opened this
 * module's page, so its copy table may not have loaded.
 */
const EMERGENCY_WIDGETS: WidgetContract[] = [
  {
    id: "karta",
    title: { sr: "Hitna karta", en: "Emergency card" },
    // S and M only, on „Nedavno"'s and „Odbrojavanja"'s terms: a row here is a
    // name and a number, so a full-width card would be mostly empty space.
    sizes: ["S", "M"],
    deepLink: "emergency",
  },
];

/**
 * The module's own name, in both languages, as ONE value.
 *
 * Exported because three surfaces need the same two words without any of them
 * owning the other two: the rail draws `manifest.copy.name`, the card's own page
 * header draws it through `declaredText`, and the PRINTED sheet carries it as the
 * document's title - which main reads from here rather than keeping a second
 * copy of the module's name that would agree until somebody reworded one of
 * them.
 */
export const MODULE_NAME: ModuleText = { sr: "Hitna karta", en: "Emergency card" };

export const manifest: ModuleManifest = {
  id: "emergency",
  // HLTH is PRD 21's prefix („Health"), and this card is that entry's first
  // implementation: it holds the medications, the allergies and the conditions
  // the PRD's own purpose line names. It is NOT a second reading of another
  // module's section, so it borrows no prefix - `modules.test.ts`'s prefix→ids
  // map states it, and any duplicate nobody wrote down still fails there.
  prefix: "HLTH",
  // „Život" (ADR-093), beside Privatno, Finansije and Ishrana - and the ADR's own
  // table lists „Emergency card" there by name. What the card holds is an area
  // of somebody's life, not a tool they use and not content they handle.
  group: "life",
  // ON by default, like every built module except PRIV and „Stručne alatke":
  // the card stores nothing at all until somebody fills one in, and a module
  // whose entire purpose is to be there in an emergency is the last one that
  // should have to be switched on first.
  defaultEnabled: true,
  // A round number with room on both sides, so the modules built beside this one
  // can sort above or below it without renumbering anything (ADR-090 §1).
  order: 180,
  copy: {
    name: MODULE_NAME,
    description: {
      sr: "Podaci koje stranac ili lekar može da pročita kada ne možeš da govoriš.",
      en: "The facts a stranger or a medic can read when you cannot speak.",
    },
  },
  widgets: EMERGENCY_WIDGETS,
  // No `settings`: the card's one preference (`printLanguage`) is a fact about
  // THIS card - which languages it prints in - and it belongs on the card's own
  // page beside the fields it governs, not on a settings page three clicks away.
  // A card whose every value is a `{ sr, en }` pair is also a card the shell
  // would have to be taught to draw for the sake of one control.
};
