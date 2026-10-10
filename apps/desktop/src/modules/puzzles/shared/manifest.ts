import type { ModuleManifest, SettingsPanel, WidgetContract } from "@nexus/core";

/**
 * The PUZZLES module's manifest (ADR-090): what the shell knows about this
 * module before its page loads. `shared/modules.ts` globs
 * `modules/<id>/shared/manifest.ts` eagerly, so this file IS the registration —
 * there is no list to add the module to, and the rail, the settings gallery, the
 * onboarding list and the shots harness all find it from here.
 *
 * The words live here rather than in the page's copy table for the reason the
 * kit's worked example gives: the rail draws a module's name before any chunk of
 * the module has loaded, so the few strings the shell needs are `{ sr, en }`
 * pairs, and everything the page itself draws stays in `renderer/copy.*.ts`.
 */

/**
 * The module's one preference.
 *
 * **Why it exists at all.** The product asks for a sudoku's conflicts „only when
 * the user asks". The page therefore always has the ask — a „Prikaži greške"
 * toggle over the board — and this row is whether that toggle is already on when
 * the next board opens. It is a preference about how a person plays rather than
 * a rule the engine has an opinion about, which is exactly what a settings card
 * is for.
 *
 * `storage: "profile"`, on TIMERS' terms: main reads this row and it therefore
 * travels in the profile's own archive, unlike the device preferences a machine
 * uses to render a module. It is also why this card offers no „Vrati na
 * podrazumevano": that link clears a machine's keys, and this is a write about
 * the profile's data.
 */
const PUZZLES_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Slagalice", en: "Puzzles" },
  controls: [
    {
      kind: "toggle",
      key: "check-while-typing",
      labelKey: {
        sr: "Označavaj greške u sudokuu dok se igra",
        en: "Mark sudoku conflicts while the board is played",
      },
      // Folded, and only the words somebody would really type: a Serbian speaker
      // searching this card types „greška", „sudoku" or „pomoć", an English one
      // „conflict" or „hint".
      keywords: ["slagalice", "sudoku", "greska", "greske", "pomoc", "conflict", "puzzle"],
      storage: "profile",
    },
  ],
};

/**
 * „Započeto" — the puzzles somebody is in the middle of, on the dashboard.
 *
 * ONE card, and it is a LIST: a puzzle's whole promise is that it can be left
 * and come back to, so the fact worth a home-screen row is which games are open
 * and how far each has come. It is the same shape TIMERS' card has for the same
 * reason — a running countdown and a game in progress are both things the user
 * leaves the page to keep an eye on — and the same refusal of a second card: a
 * board drawn small enough for a dashboard tile is a picture nobody can play.
 *
 * No `configFields`, on „Fokus"'s terms (`shared/modules.ts`): a knob on a card
 * narrows a LIST, and a cap here would hide a game somebody left open.
 *
 * `title` is a `{ sr, en }` pair rather than a `strings` path because the
 * dashboard can be reached without ever having opened this module's page, so its
 * chunk — and its copy table with it — may not have loaded.
 */
const PUZZLES_WIDGETS: WidgetContract[] = [
  {
    id: "zapoceto",
    title: { sr: "Započeto", en: "In progress" },
    sizes: ["S", "M"],
    deepLink: "puzzles",
  },
];

export const manifest: ModuleManifest = {
  id: "puzzles",
  /**
   * Its own PRD prefix, on „Tabla"'s terms: the games area's modules are separate
   * entries rather than one section implemented twice, so this one borrows
   * nothing. `PUZ` is traceability to the puzzles entry, and
   * `modules.test.ts`'s prefix→ids map states it explicitly at merge.
   */
  prefix: "PUZ",
  // „Igra" (ADR-093) — beside the card games, the arcade and chess: a puzzle is
  // something a person does for its own sake, not an area of a life.
  group: "play",
  // ON by default, like every built module except PRIV and „Stručne alatke": a
  // puzzle writes nothing until somebody plays one, so there is nothing to opt
  // into.
  defaultEnabled: true,
  // Third in „Igra": the games area's modules order themselves, and a round
  // number leaves room for the two beside it without renumbering this one.
  order: 330,
  copy: {
    name: { sr: "Slagalice", en: "Puzzles" },
    description: {
      sr: "Sudoku, nonogrami, mahjong i Broj — partija se čuva i nastavlja tačno gde je prekinuta.",
      en: "Sudoku, nonograms, mahjong and Numbers — every game is saved and picks up where it stopped.",
    },
  },
  widgets: PUZZLES_WIDGETS,
  settings: PUZZLES_SETTINGS,
};
