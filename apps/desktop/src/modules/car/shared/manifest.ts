import type { ModuleManifest, SettingsPanel, WidgetContract } from "@nexus/core";

/**
 * The CAR module's manifest (ADR-090): everything the shell knows about this
 * module before its page chunk loads.
 *
 * A service book for people who are not mechanics. The module's own rule is the
 * one the product states and the store enforces: **it never presents
 * maintenance advice of its own.** An interval is what the owner typed (or the
 * manufacturer's schedule they copied in), "due" is arithmetic over their own
 * history, and the app has no opinion about what a car needs.
 *
 * The two strings the shell needs before the page exists live here as `{ sr,
 * en }` pairs (`ModuleCopyDeclaration`); everything the page draws lives in
 * `renderer/copy.sr.ts`/`copy.en.ts`, which arrive with the chunk.
 */

/**
 * The module's one settings card: the two numbers `whatIsDue` judges "due soon"
 * against.
 *
 * **Why these are preferences at all.** `DueThresholds` is passed into the
 * engine rather than fixed inside it, because "soon" is the owner's appetite:
 * somebody who drives 30 000 km a year reads "the oil is due in 1 200 km" very
 * differently from somebody who drives 6 000. The card therefore holds the
 * appetite and nothing else -- there is no switch here that turns a reminder on
 * or off, because the reminder is the feature and a module that could be
 * silently inert is the padding SET-006 warns about.
 *
 * `storage: "profile"`, for `timers_settings`' own reason: main reads these to
 * decide when to remind, and they are a fact about the vehicle's owner rather
 * than about this machine, so they travel in the profile's archive.
 */
const CAR_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Automobil", en: "Car" },
  controls: [
    {
      kind: "value",
      key: "due-soon-days",
      labelKey: {
        sr: "„Uskoro“ znači u narednih (dana)",
        en: "“Due soon” means within (days)",
      },
      // Folded, and only the words somebody would really type.
      keywords: ["auto", "automobil", "servis", "interval", "podsetnik", "dani", "due", "soon"],
      storage: "profile",
    },
    {
      kind: "value",
      key: "due-soon-distance",
      labelKey: {
        sr: "„Uskoro“ znači na još (km)",
        en: "“Due soon” means within (km)",
      },
      keywords: ["auto", "automobil", "servis", "interval", "kilometri", "km", "due", "soon"],
      storage: "profile",
    },
  ],
};

/**
 * „Sledeći servis" -- the one thing due soonest, on the dashboard.
 *
 * ONE card, and it is the next thing due across the whole garage rather than a
 * list: that is the fact a person leaves this page to keep an eye on, and a card
 * that drew every outstanding interval would be the page's own due list, one
 * screen over. The card's own frame opens the module (DASH-005's deep link), so
 * there is no second control on it.
 *
 * **No `configFields`, deliberately.** Every knob the other small cards carry
 * narrows a LIST (`ROW_CAP`, a period). This card draws ONE row: a cap would
 * choose nothing, and a horizon choice would only decide whether the answer is
 * allowed to exist. „Tajmeri"'s card made the same call for the same reason.
 *
 * Capped at M for „hitno-kasni"'s reason: a row here is a name, a category and
 * one figure, and a full-width card would be mostly empty space.
 */
const CAR_WIDGETS: WidgetContract[] = [
  {
    id: "sledece",
    title: { sr: "Sledeći servis", en: "Next service" },
    sizes: ["S", "M"],
    deepLink: "car",
  },
];

export const manifest: ModuleManifest = {
  id: "car",
  // Its own prefix, and PRD 22 is its own entry rather than a second reading of
  // another module's: a car is a subject somebody HAS (its own page, its own
  // stores, its own reminder), not a tool that computes something.
  prefix: "CAR",
  group: "life",
  // ON by default, like every built module except PRIV and „Stručne alatke":
  // the module writes nothing until somebody adds a vehicle, so there is nothing
  // to opt into, and a person who owns a car is exactly who this is for.
  defaultEnabled: true,
  // ADR-093 puts CAR in „Život"; the order places it after the compiled-in life
  // modules and after „Tajmeri" (100), leaving room below for the next kit
  // module without renumbering this one.
  order: 140,
  copy: {
    name: { sr: "Automobil", en: "Car" },
    description: {
      sr: "Servisna knjiga: vozila, servisi, intervali, gorivo i kvarovi. Bez tuđih saveta.",
      en: "A service book: vehicles, services, intervals, fuel and faults. No advice of its own.",
    },
  },
  widgets: CAR_WIDGETS,
  settings: CAR_SETTINGS,
};
