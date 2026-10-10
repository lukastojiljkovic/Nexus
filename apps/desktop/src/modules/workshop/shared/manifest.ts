import type { ModuleManifest, SettingsPanel } from "@nexus/core";

/**
 * The WORKSHOP module's manifest - the whole of what the shell knows about this
 * module before its page loads (ADR-090).
 *
 * **What it is for.** The files a maker opens every day - a model to look at
 * before printing it, the toolpath a slicer produced, the layers of a board
 * about to be ordered - viewable offline, without three more programs installed
 * beside the one that manages a life. The three viewers are one module because
 * they are one errand: a file arrives from a machine or a fabricator, and the
 * question is always "what is in this, actually".
 *
 * **Nothing here is stored.** The module has no migration and no table, and that
 * is a decision rather than an omission: what a viewer reads is somebody else's
 * file. The only thing it remembers is the LIST of paths it last opened, and
 * that list belongs to this machine (`renderer/recentFiles.ts`, `localStorage`),
 * never to the profile - which is also why this module puts nothing in an
 * archive and declares no `imex`.
 *
 * **Why the prefix is `WS`.** A prefix is traceability to a PRD entry, and the
 * PRD set this repository carries has no section for a maker's file viewers: it
 * is a module of its own rather than a second reading of somebody else's
 * section, which is `CANV`'s and `ELEC`'s reasoning one group over. `WS` is the
 * module's own name, two letters like `CAL` and `FIT`.
 */

/**
 * The module's one settings card.
 *
 * Its single control is a `fact`, and the kind is the honest one: the card's
 * body draws the list of recently opened paths and offers to forget it, and
 * there is nothing to SET. It is not a `device` control either, because a
 * `device` control is a value a person chooses and this list is a record of what
 * they did - so the shell offers no "Vrati na podrazumevano" here, and the
 * card's own body carries the one button that matters.
 */
const WORKSHOP_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Radionica", en: "Workshop" },
  controls: [
    {
      kind: "fact",
      key: "recent-files",
      labelKey: {
        sr: "Nedavno otvorene datoteke",
        en: "Recently opened files",
      },
      // Folded search keys, and only the words somebody would really type: the
      // three formats by name, and what the list is.
      keywords: ["radionica", "stl", "g-kod", "gerber", "datoteke", "nedavno"],
    },
  ],
};

/**
 * No `widgets`, and the refusal is the same one the tools drawer makes: a
 * dashboard card draws a fact about the PROFILE, and this module holds none.
 * "The files you opened on this machine yesterday" is a fact about the machine,
 * and it would be a card that means nothing on a second computer.
 *
 * No `searchIndexers` either, for a sharper version of that reason: the palette
 * finds things the profile holds and can open. A viewer holds nothing, so an
 * indexer here would have to index the paths of files it cannot show from a
 * search result.
 */
export const manifest: ModuleManifest = {
  id: "workshop",
  prefix: "WS",
  group: "make",
  defaultEnabled: true,
  // After the first kit module (TIMERS, 100) and clear of the round numbers the
  // modules beside it will take: the order is ascending, ties broken by id, so a
  // gap here costs nothing and a collision costs a diff.
  order: 310,
  copy: {
    name: { sr: "Radionica", en: "Workshop" },
    description: {
      sr: "Pregled STL modela, G-koda i Gerber ploča — bez dodatnih programa.",
      en: "View STL models, G-code toolpaths and Gerber boards — with nothing else installed.",
    },
  },
  settings: WORKSHOP_SETTINGS,
};
