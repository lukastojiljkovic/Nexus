import type { ModuleManifest, SettingsPanel, WidgetContract } from "@nexus/core";

/**
 * The COOKBOOK module's manifest (ADR-090): the whole of what the shell knows
 * about this module before its page loads.
 *
 * The words live here rather than in `renderer/copy.sr.ts` because the rail,
 * the settings gallery and the onboarding row draw a module's name BEFORE any
 * chunk of it has loaded — see `modules/timers/shared/manifest.ts`, the kit's
 * worked example, for the full argument.
 */

/**
 * The module's one preference, declared as a card so the settings page composes
 * it from the registry (SET).
 *
 * `storage: "profile"` rather than `"device"`: main reads this row when it
 * renders a recipe and the value travels in the profile's own archive, which is
 * the same reason Timers' one preference is a profile row. It is a presentation
 * default — which unit a scaled quantity is rounded and written in — and not a
 * fact about this machine, so it belongs to the profile that holds the recipes.
 */
const COOKBOOK_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Kuvarica", en: "Cookbook" },
  controls: [
    {
      kind: "choice",
      key: "unit-system",
      labelKey: { sr: "Jedinice u receptima", en: "Units in recipes" },
      // The two answers are the module's own two readings of a quantity: metric
      // (g, kg, ml, l) and the kitchen measures a Serbian and an English recipe
      // both write (kašičica/kašika/šolja, tsp/tbsp/cup). Neither is „the modern
      // one": a cook who measures in cups needs the cups.
      options: [
        { id: "metric", labelKey: { sr: "Metričke (g, ml)", en: "Metric (g, ml)" } },
        { id: "kitchen", labelKey: { sr: "Kuhinjske (kašika, šolja)", en: "Kitchen (spoons, cups)" } },
      ],
      keywords: ["jedinice", "grami", "mililitri", "units", "grams", "metric"],
      storage: "profile",
    },
  ],
};

/**
 * „Šta je skoro dodato" — the newest recipes, on the dashboard.
 *
 * ONE card, and it is the list of recipes this profile wrote, newest first: the
 * one fact here worth a home-screen row. There is no „what can I cook now" card
 * on purpose — that answer depends on a pantry this module does not read, and a
 * card that guessed at it would be the app inventing a kitchen.
 *
 * No `configFields`, on Timers' terms: a knob on a card narrows a LIST, and a cap
 * here would hide recipes the user wrote.
 */
const COOKBOOK_WIDGETS: WidgetContract[] = [
  {
    id: "recepti",
    title: { sr: "Recepti", en: "Recipes" },
    sizes: ["S", "M"],
    deepLink: "cookbook",
  },
];

export const manifest: ModuleManifest = {
  id: "cookbook",
  // PRD 33's prefix: the cookbook is its own section of the product rather than a
  // second reading of an existing one, so it takes its own prefix rather than
  // borrowing UTIL's.
  prefix: "COOK",
  group: "life",
  defaultEnabled: true,
  // After Timers (100): the discovered modules sort by this number, so the two
  // kit modules this branch ships have a stated order and the next one can take
  // a round number between them.
  order: 160,
  copy: {
    name: { sr: "Kuvarica", en: "Cookbook" },
    description: {
      sr: "Tvoji recepti i kuhinje sveta iz paketa — sastojci, koraci i hranljive vrednosti.",
      en: "Your recipes and the world's cuisines from packs — ingredients, steps and nutrition.",
    },
  },
  widgets: COOKBOOK_WIDGETS,
  settings: COOKBOOK_SETTINGS,
};
