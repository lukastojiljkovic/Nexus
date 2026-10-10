import type { ModuleManifest, WidgetContract } from "@nexus/core";

/**
 * BIBLIOTEKA's manifest (ADR-090): what the shell knows about this module
 * before a line of its page has loaded.
 *
 * **`copy` is not optional here**, and the reason is the manifest's own contract
 * (`ModuleCopyDeclaration`): the rail draws the module's name, the settings
 * gallery its one-line description and the onboarding list its row, and all
 * three exist before any chunk of this module is in the process. So the few
 * words the shell needs live here as `{ sr, en }` pairs, and everything the
 * module's own screens draw lives in `renderer/copy.sr.ts`/`copy.en.ts`, where
 * it stays out of the startup chunk.
 *
 * **`group: "culture"` is the first module in that group.** ADR-093 names six
 * feature groups, and `culture` is the one that had no member yet - the shell
 * draws a group only when something is in it. What this module is about is
 * exactly that group's subject: the books, films and series somebody reads and
 * watches, which is neither an area of life in the sense `life` means (Privatno,
 * Finansije, Ishrana) nor knowledge somebody studies toward an exam.
 *
 * **`order: 110`** sorts it after every compiled-in module and after Tajmeri
 * (100), the kit's worked example; ties are broken by id, so a round number with
 * room on both sides is all this needs to be.
 *
 * **One dashboard card, and no settings card.** The card is the module's own
 * promise to the home screen - what is being read or watched right now, with its
 * progress - and the module has no preference worth keeping (sort and filter are
 * this page's own view state, and a "default sort" stored in the profile would
 * be a row nothing else reads). `SET-006`'s warning about a card with one
 * checkbox for the sake of having a card is why the settings slot is empty here
 * rather than filled.
 */

/**
 * „Trenutno čitam i gledam" - the works in progress, on the dashboard.
 *
 * ONE card, and it is a list of the works whose status is `in-progress` with
 * each one's own progress: that is the fact a person wants on a home screen,
 * because it is the fact the page is opened FOR. The wish list and the finished
 * works are deliberately NOT cards - a card full of things you have already
 * finished answers nothing, and the shelf of what is next is a thing you browse,
 * not a thing you glance at.
 *
 * `sizes` stops at M: a row is a title, one progress line and one chip, the
 * shape „Nedavne beleške" has. No `configFields`, on the module's own terms: a
 * cap here would hide a work somebody is in the middle of, which is the one
 * thing this card exists to show.
 */
const LIBRARY_WIDGETS: WidgetContract[] = [
  {
    id: "trenutno",
    title: { sr: "Trenutno čitam i gledam", en: "Reading and watching now" },
    sizes: ["S", "M"],
    deepLink: "library",
  },
];

export const manifest: ModuleManifest = {
  id: "library",
  // PRD 27 („Library"), whose own prefix this is: `LIB` is traceability to that
  // entry, shared with nobody, so `modules.test.ts`'s prefix map lists it alone.
  prefix: "LIB",
  group: "culture",
  defaultEnabled: true,
  order: 110,
  copy: {
    name: { sr: "Biblioteka", en: "Library" },
    description: {
      sr: "Knjige, filmovi i serije koje čitaš i gledaš: šta je na listi želja, šta je u toku i šta je završeno.",
      en: "The books, films and series you read and watch: what is on the wish list, what is in progress, and what is finished.",
    },
  },
  widgets: LIBRARY_WIDGETS,
};
