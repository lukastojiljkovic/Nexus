import type { ModuleManifest, SettingsPanel, WidgetContract } from "@nexus/core";

/**
 * The CULTURE module's manifest (ADR-090).
 *
 * `copy` lives here rather than in the page's own table because the rail, the
 * settings gallery, the onboarding row and the settings FILTER all draw these
 * words before any chunk of the module has loaded.
 */

/**
 * The module's one preference (SET).
 *
 * `storage: "profile"`, and the reason is the row it reads: the programme asks
 * about plans whose date has passed, and whether that asking is on is a fact
 * about the profile's own programme - so it is written in the database, read by
 * main, and travels in the profile's archive, exactly as `timers_settings`
 * does. It is also why this card offers no Vrati na podrazumevano: that link
 * clears a machine's keys, and this is a write about the user's data.
 */
const CULTURE_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Kultura", en: "Culture" },
  controls: [
    {
      kind: "toggle",
      key: "prompt-past-plans",
      labelKey: {
        sr: "Pitaj me za prošle planove",
        en: "Ask me about plans whose date has passed",
      },
      // The words somebody would actually type into the settings filter.
      keywords: ["kultura", "plan", "program", "podsetnik", "pitanje", "proslo", "culture", "ask"],
      storage: "profile",
    },
  ],
};

/**
 * „Program" - the plans that are still ahead, on the dashboard.
 *
 * ONE card, and it is a LIST of named plans with their dates: the one fact here
 * worth a home-screen row is what is coming. `deepLink` is this module's own
 * page, which is the screen that can answer the card's question ("did you go").
 */
const CULTURE_WIDGETS: WidgetContract[] = [
  {
    id: "program",
    title: { sr: "Program", en: "Programme" },
    sizes: ["S", "M"],
    deepLink: "culture",
    // A programme can run to dozens of rows, so the cap is ROW_CAP's existing
    // vocabulary rather than a second declaration of the same three numbers.
    configFields: [{ kind: "count", key: "count", min: 3, max: 10, default: 5 }],
  },
];

export const manifest: ModuleManifest = {
  id: "culture",
  // CULT is its own PRD entry, so it takes its own prefix rather than borrowing
  // UTIL (which PRD 29's three modules share).
  prefix: "CULT",
  group: "culture",
  defaultEnabled: true,
  // ADR-090's ordering: this sorts after every compiled-in module and after
  // `timers` (100); ties are broken by id, so a sibling run may pick 120 too.
  order: 120,
  copy: {
    name: { sr: "Kultura", en: "Culture" },
    description: {
      sr: "Muzeji, predstave, koncerti i bioskop - uz program, likovni vodič i muziku.",
      en: "Museums, theatre, concerts and cinema - with a programme, an arts guide and music.",
    },
  },
  widgets: CULTURE_WIDGETS,
  settings: CULTURE_SETTINGS,
};
