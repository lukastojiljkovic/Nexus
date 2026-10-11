import type { ModuleManifest, SettingsPanel, WidgetContract } from "@nexus/core";

/**
 * The CALCULATOR module's manifest (ADR-090) - everything the shell knows about
 * this module before its page loads.
 *
 * **Why the words live here rather than in `strings.ts`.** The rail draws a
 * module's name, and the settings gallery its one-line description, before any
 * chunk of the module has loaded; copy that arrives with the page cannot name
 * the row that opens the page. So the few strings the shell needs travel as
 * `{ sr, en }` pairs and everything the page draws lives in
 * `renderer/copy.sr.ts`/`copy.en.ts`, where it stays out of the startup chunk
 * (`timers/shared/manifest.ts` is the worked example).
 *
 * **`CALC`, and its own prefix rather than `UTIL`.** A prefix is traceability to
 * a PRD entry, and the two sharing it (`focus`, `tools`, and `timers` with them)
 * do so because ONE entry - „Utility Belt" - is implemented twice. This module
 * is not that second reading: the calculator is a calculator, not a converter
 * drawer, and it is the only module here whose whole subject is the expression
 * engine in `@nexus/core`'s `calculator/`.
 *
 * **`make`, beside „Alatke" and „Tabla" (ADR-093).** A calculator is a bench you
 * work something out on, which is what the group says; the school-calculator
 * errand belongs with the converters and the canvas rather than with a subject
 * somebody keeps („life") or a thing somebody knows („knowledge").
 *
 * **`order: 190`** places it after „Tajmeri" (100) among the discovered modules.
 * A round number, so the next kit module can sort above or below it without
 * renumbering this one.
 */

/**
 * The module's two preferences (SET), declared the way every other module
 * declares a card so the settings page composes it from the registry.
 *
 * Both are `storage: "profile"`, and the reason is the rule the kit's
 * `moduleKit/settings.ts` states for every discovered module: a kit module's card
 * is REPLACED by a restore, so its settings have to be rows that an archive can
 * carry. They are (`calc_settings`, migration 079's third table) and they travel
 * with the profile, which is also the honest reading of the two: an angle unit
 * and a number mode are how this PERSON does arithmetic, not how this monitor
 * draws it.
 *
 * The card therefore offers no „Vrati na podrazumevano" - that link is for a
 * machine's keys, and `isDeviceOnlyPanel` is what decides it - and both controls
 * are changed from the page as well, because the page's switches write the very
 * same two rows.
 */
const CALCULATOR_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Kalkulator", en: "Calculator" },
  controls: [
    {
      kind: "choice",
      key: "angle-mode",
      labelKey: { sr: "Ugao", en: "Angle unit" },
      storage: "profile",
      options: [
        { id: "deg", labelKey: { sr: "Stepeni", en: "Degrees" } },
        { id: "rad", labelKey: { sr: "Radijani", en: "Radians" } },
        { id: "grad", labelKey: { sr: "Gradijani", en: "Gradians" } },
      ],
      // Folded and without diacritics: a keyword is a search key, never a label
      // (`check:english`'s rule, and `modules.test.ts` pins it).
      keywords: ["kalkulator", "ugao", "stepeni", "radijani", "gradijani", "sinus", "kosinus"],
    },
    {
      kind: "choice",
      key: "number-mode",
      labelKey: { sr: "Režim brojeva", en: "Number mode" },
      storage: "profile",
      options: [
        { id: "float", labelKey: { sr: "Decimalni", en: "Decimal" } },
        {
          id: "bignumber",
          labelKey: { sr: "Tačni, veliki brojevi", en: "Exact, big numbers" },
        },
      ],
      keywords: ["kalkulator", "brojevi", "preciznost", "veliki", "decimalni", "rezultat"],
    },
  ],
};

/**
 * „Poslednji rezultati" - the most recent results, on the dashboard.
 *
 * ONE card, and it is the fact this module holds: a result the user computed,
 * which is what somebody coming back to the home screen wants to see again
 * (ADR-086's rule - „the boards by NAME", „the circuits by NAME"; here, the
 * results by VALUE). It is deliberately not a count of calculations, and not a
 * picture of a keypad.
 *
 * No `configFields`: a cap would narrow a list the card already bounds at three
 * rows by its own size, and the card is at `S` and `M` for „nedavno"'s reason -
 * a row is an expression and a value.
 */
const CALCULATOR_WIDGETS: WidgetContract[] = [
  {
    id: "poslednji",
    title: { sr: "Poslednji rezultati", en: "Recent results" },
    sizes: ["S", "M"],
    deepLink: "calculator",
  },
];

export const manifest: ModuleManifest = {
  id: "calculator",
  prefix: "CALC",
  group: "make",
  defaultEnabled: true,
  order: 190,
  copy: {
    name: { sr: "Kalkulator", en: "Calculator" },
    description: {
      sr: "Računanje jednom linijom: promenljive, jedinice, istorija i naučna tastatura.",
      en: "One-line calculation: variables, units, history and a scientific keypad.",
    },
  },
  widgets: CALCULATOR_WIDGETS,
  settings: CALCULATOR_SETTINGS,
};
