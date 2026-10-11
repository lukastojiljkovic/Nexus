import type { ModuleManifest, WidgetContract } from "@nexus/core";

/**
 * The WIKI module's manifest — an offline reference library, on the module kit
 * (ADR-090).
 *
 * **Why the id is `wiki` and the name is „Reference".** The id is the folder, the
 * channel prefix and the `nx-zim://` handler's owner, so it is the format's word;
 * the name is what a person reads in the rail, and it says what the module
 * actually is: Wikipedia, Wiktionary, Wikibooks, iFixit, Gutenberg and Stack
 * Exchange, read offline, through one reader this app wrote itself (ADR-098).
 *
 * **Why `knowledge`.** ADR-093 puts the reference libraries in „Znanje" beside
 * Beleške, Datoteke and Učenje, and the group is the honest one: this is material
 * somebody consults, not an area of a life and not a tool.
 *
 * **Why the words live here rather than in `copy.sr.ts`.** The rail draws the
 * module's name and the settings gallery its one-line description before any
 * chunk of the module has loaded, so the shell has to be able to read them
 * without the page (`ModuleCopyDeclaration`). Everything the page itself draws
 * lives in `renderer/copy.sr.ts`/`copy.en.ts`.
 */

/**
 * The module's one dashboard card: the pages last read, newest first.
 *
 * ONE card, and it is a list rather than a count. „You have 4 libraries" is a
 * number nobody acts on; „where was I" is the question a reference library
 * answers, and the history table already holds it. No `configFields`: a cap on
 * the card would hide the row somebody came back for, and the list is already
 * bounded by what the page shows.
 *
 * `title` is a `{ sr, en }` pair rather than a strings path, for the manifest
 * header's reason: the dashboard can be reached without this module's page, so
 * its chunk — and its copy table with it — may not have loaded.
 */
const WIKI_WIDGETS: WidgetContract[] = [
  {
    id: "skorije",
    title: { sr: "Skorije čitano", en: "Recently read" },
    sizes: ["S", "M"],
    deepLink: "wiki",
  },
];

export const manifest: ModuleManifest = {
  id: "wiki",
  // Its own prefix: „Reference" is its own PRD entry rather than a second reading
  // of somebody else's, so it takes a prefix rather than borrowing one
  // (`shared/modules.ts` records the same decision for „Stručne alatke").
  prefix: "WIKI",
  group: "knowledge",
  defaultEnabled: true,
  // The order this run was given. A kit module's `order` is what the registry
  // sorts discovered modules by, so the number is this module's slot in the rail
  // and not a rank among the compiled-in sixteen.
  order: 220,
  copy: {
    name: { sr: "Reference", en: "Reference" },
    description: {
      sr: "Vikipedija, rečnici i priručnici koje čitaš bez interneta.",
      en: "Wikipedia, dictionaries and manuals you read without the internet.",
    },
  },
  widgets: WIKI_WIDGETS,
};
