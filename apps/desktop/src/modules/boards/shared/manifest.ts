import type { ModuleManifest, SettingsPanel, WidgetContract } from "@nexus/core";

/**
 * The BOARD GAMES module's manifest (ADR-090) — the whole of what the shell
 * knows about this module before its page loads.
 *
 * **The group and the order are the task's, not this file's choice.** `play` is
 * the seventh navigation group (ADR-093) and this module is its first member: a
 * board game is neither planning nor making, and the group was declared before
 * anything lived in it. `order: 340` places it among the discovered modules, well
 * clear of the kit's worked example at 100 — a round number with room above and
 * below it, so neither module has to be renumbered when the next one arrives.
 */

/**
 * The module's one preference, declared the way every module declares a card so
 * the settings page composes it from the registry.
 *
 * **Three options, and they are read back by the page as well as drawn here.**
 * A level name is one word in one place: the settings card and the new-game
 * panel both resolve these `labelKey` pairs through `declaredText`, so the level
 * the card offers and the level the game starts at cannot be called different
 * things. The ids are the level numbers themselves, because that is what the
 * store holds (`boards_settings.default_level`).
 *
 * `storage: "profile"`, like the timers card and for its reason: main reads this
 * row (the page asks for a view, not for `localStorage`), and it therefore travels
 * in the profile's own archive — which is also why the card offers no
 * „Vrati na podrazumevano": that link clears a machine's keys, and this is a write
 * about the profile's data.
 */
const BOARDS_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Igre na tabli", en: "Board games" },
  controls: [
    {
      kind: "choice",
      key: "default-level",
      labelKey: {
        sr: "Nivo na kom se otvara nova partija protiv računara",
        en: "The level a new game against the computer opens at",
      },
      options: [
        { id: "1", labelKey: { sr: "Lako", en: "Easy" } },
        { id: "2", labelKey: { sr: "Srednje", en: "Medium" } },
        { id: "3", labelKey: { sr: "Teško", en: "Hard" } },
      ],
      // Folded, and only the words somebody would really type: a Serbian speaker
      // searching this card types „igra", „nivo" or „težina", an English one
      // „game", „level" or „difficulty".
      keywords: ["igra", "igre", "tabla", "nivo", "tezina", "racunar", "game", "level", "difficulty"],
      storage: "profile",
    },
  ],
};

/**
 * „Partije u toku" — the games somebody is in the middle of, on the dashboard.
 *
 * ONE card, and it is the LIST of saved games by name with how far each has come:
 * that is the fact a user leaves the page to keep an eye on, and it is the same
 * shape „Odbrojavanja" and „Nedavne beleške" have. The card opens the module
 * (DASH-005's deep link), which is where a game is actually resumed.
 *
 * No `configFields`, on „Navike danas"'s terms: a knob on this card would narrow a
 * list whose whole point is that nothing is hidden — six games at most, and the
 * one you are looking for is the one you did not finish.
 */
const BOARDS_WIDGETS: WidgetContract[] = [
  {
    id: "u-toku",
    title: { sr: "Partije u toku", en: "Games in progress" },
    sizes: ["S", "M"],
    deepLink: "boards",
  },
];

export const manifest: ModuleManifest = {
  id: "boards",
  prefix: "BOARD",
  group: "play",
  defaultEnabled: true,
  order: 340,
  copy: {
    name: { sr: "Igre na tabli", en: "Board games" },
    description: {
      sr: "Šest igara na tabli — protiv računara ili na istom računaru.",
      en: "Six board games — against the computer or on one machine.",
    },
  },
  widgets: BOARDS_WIDGETS,
  settings: BOARDS_SETTINGS,
};
