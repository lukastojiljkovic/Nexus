import type { ModuleManifest } from "@nexus/core";

/**
 * The MAPS module's manifest — the whole of what the shell knows about it
 * before its page loads (ADR-090).
 *
 * **Knowledge, not Life.** The map of the country you live in is one of the
 * reference libraries ADR-093 sent to `knowledge` — "Učenje", "Beleške" and
 * "Datoteke" hold what a person studies and keeps, and a map is the same kind
 * of thing: a body of reference data the app ships as a pack and reads offline.
 *
 * **Why there is no settings card and no dashboard widget.** A settings card
 * earns its place by naming a preference somebody has, and this module has
 * none: which pack is installed is Podešavanja's own "Paketi sadržaja" card,
 * and where the map was last looking is not a preference — it is the map, and
 * "stop remembering where I was" is a control that exists to have a control.
 * The widget half is `timers`' reasoning read the other way round: a card earns
 * its place by drawing a fact somebody wants on the home screen, and a map
 * cannot be a card. Both omissions are decisions with a comment rather than
 * gaps, which is what `modules.test.ts` asks a module to be able to say.
 *
 * **`order: 210`** places it after the reference libraries that shipped first
 * (Timers is 100) and leaves 200 and 220 free for the packs that follow it, so
 * the rail does not have to be renumbered when the survival packs arrive.
 */
export const manifest: ModuleManifest = {
  id: "maps",
  // PRD 00's module registry has no entry for a map, and the reference
  // libraries' grouping has none either: MAP is this module's own prefix, on
  // ELEC's terms (a module that implements its own section takes its own
  // prefix rather than borrowing one).
  prefix: "MAP",
  group: "knowledge",
  defaultEnabled: true,
  order: 210,
  copy: {
    name: { sr: "Mape", en: "Maps" },
    description: {
      sr: "Karta Srbije koja radi bez interneta — pretraga mesta, tačke i merenje razdaljine.",
      en: "A map of Serbia that works offline — search places, drop pins and measure a distance.",
    },
  },
};
