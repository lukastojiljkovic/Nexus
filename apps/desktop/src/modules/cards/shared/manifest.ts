import type { ModuleManifest, WidgetContract } from "@nexus/core";

/**
 * The CARDS module's manifest (ADR-090) — the whole of what the shell knows about
 * this module before its page loads.
 *
 * **The group and the order are the task's, not this file's choice.** `play` is
 * the navigation group the games arrive in (ADR-093), and `order: 350` places
 * this module among the discovered ones. `cards` and `chess` share 350 on
 * purpose — the registry breaks a tie by id, as it does for `reader`/`signals`
 * and `maps`/`miniapps` — and `cards` sorts first, so the card table opens ahead
 * of the board one without moving either number.
 *
 * **Why no settings card.** The module's one preference would be the opponent
 * level a computer game opens at, and the compiled-in store (`CardGameStore`,
 * migration 081) has no row to hold it: its two tables are the record and the
 * games in progress, and the brief forbids this run a migration. So the level is
 * a field on the page's new-game panel, where it is chosen per game, and nothing
 * pretends to remember it between sessions — a settings card whose value lived
 * only until the next launch would be a lie about what it stores.
 */

/**
 * „Partije u toku" — the card games somebody is in the middle of, on the
 * dashboard.
 *
 * ONE card, and it is the LIST of saved games by name: that is the fact a user
 * leaves the page to keep an eye on, and it is the same shape „Partije u toku"
 * has one module over. The card opens the module (DASH-005's deep link), which is
 * where a game is resumed.
 *
 * No `configFields`, on „Navike danas"'s terms: a knob here would narrow a list of
 * at most fourteen saved games (one per game and variant), and the one you want is
 * the one you did not finish.
 */
const CARDS_WIDGETS: WidgetContract[] = [
  {
    id: "u-toku",
    title: { sr: "Partije u toku", en: "Games in progress" },
    sizes: ["S", "M"],
    deepLink: "cards",
  },
];

export const manifest: ModuleManifest = {
  id: "cards",
  prefix: "FUN",
  group: "play",
  defaultEnabled: true,
  order: 350,
  copy: {
    name: { sr: "Karte", en: "Cards" },
    description: {
      sr: "Devet igara kartama — šest pasijansa i tri protiv računara.",
      en: "Nine card games — six solitaires and three against the computer.",
    },
  },
  widgets: CARDS_WIDGETS,
};
