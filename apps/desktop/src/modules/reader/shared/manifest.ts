import type { ModuleManifest, WidgetContract } from "@nexus/core";

/**
 * The READER module's manifest (ADR-090): everything the shell knows about this
 * module before its page loads, and nothing else.
 *
 * **Why there is no settings card.** The module's one preference - the reading
 * size - is set where it is USED, on the page, beside the text it resizes; a card
 * in "Pode\u0161avanja" would be the same number in a second place, one screen away
 * from the sentence it makes readable. So the manifest declares no `settings`,
 * which is a decision this file records rather than an omission: a reader who
 * wants larger type does not have to guess that it is a preference.
 *
 * **Why the words live here rather than in `strings.ts`.** The rail draws a
 * module's name, and the launcher its one-line description, before any chunk of
 * the module has loaded; copy that arrives with the page cannot name the row that
 * opens the page. So the few strings the shell needs are `{ sr, en }` pairs
 * (`ModuleCopyDeclaration`), and everything the page itself draws lives in
 * `renderer/copy.sr.ts`/`copy.en.ts`.
 */

/**
 * The continue-reading card: where each pack was left, as a dashboard row.
 *
 * ONE card, and it is a list of packs with the article each was left on, because
 * that is the one fact about the Reader that belongs on a home screen: a person
 * who closed the app halfway through a chapter wants the way back in, not a
 * catalogue. The library itself is NOT a card - it is a shelf, and a shelf on a
 * dashboard would be the module drawn twice.
 *
 * No `configFields`, on the countdown card's terms: a knob on a card narrows a LIST,
 * and a cap here would hide the book somebody was reading.
 *
 * `title` is a `{ sr, en }` pair rather than a `strings` path, for the reason
 * the manifest's own header gives: the dashboard can be reached without ever
 * having opened this module's page.
 */
const READER_WIDGETS: WidgetContract[] = [
  {
    id: "nastavi",
    title: { sr: "Nastavi sa \u010ditanjem", en: "Continue reading" },
    sizes: ["S", "M"],
    deepLink: "reader",
  },
];

export const manifest: ModuleManifest = {
  id: "reader",
  // PRD 26 (Read Later & Bookmarks) is the entry this module implements: its
  // bookmark half, against the packs on this machine rather than against a web
  // page. The prefix is that PRD entry and not a new spelling, because a prefix
  // is traceability to a PRD section and a module that invented one would be
  // traceable to nothing.
  prefix: "READ",
  group: "knowledge",
  defaultEnabled: true,
  // After every compiled-in module and after the first kit module (Timers, 100).
  // A round number, so the next kit module can sort above or below it without
  // renumbering this one.
  order: 200,
  copy: {
    name: { sr: "\u010cita\u010d", en: "Reader" },
    description: {
      sr: "Knjige iz paketa sadr\u017eaja - \u010ditaj, pretra\u017euj i \u0161tampaj.",
      en: "Books from content packs - read, search and print them.",
    },
  },
  widgets: READER_WIDGETS,
};
