import type { ModuleManifest, SettingsPanel, WidgetContract } from "@nexus/core";

/**
 * The TIMERS module's manifest - the ADR-090 worked example, and the whole of
 * what the shell knows about this module before its page loads.
 *
 * **This file is the discovery contract.** `shared/modules.ts` globs
 * `modules/<id>/shared/manifest.ts` eagerly, so a manifest that exists is a
 * manifest the registry has - in the rail, in the settings gallery, in the
 * onboarding list, in `resolveEnabled` and in the shots harness's per-module
 * settings scenes - with no list anywhere to add it to.
 *
 * **Why the words live here rather than in `strings.ts`.** The rail draws a
 * module's name, and the settings gallery its one-line description, before any
 * chunk of the module has loaded; copy that arrives with the page cannot name
 * the row that opens the page. So this module carries the few strings the shell
 * needs as `{ sr, en }` pairs (`ModuleCopyDeclaration`), and everything its own
 * page draws lives in `renderer/copy.sr.ts`/`copy.en.ts`, where it stays out of
 * the startup chunk.
 */

/**
 * The module's one preference (SET), declared the way every other module
 * declares a card so the settings page composes it from the registry.
 *
 * `storage: "profile"` rather than `"device"`, and the reason is the one
 * `SettingsStorage` asks for: main is what shows the toast, main reads this row,
 * and the setting therefore travels in the profile's own archive - unlike the
 * device preferences a machine uses to render a module. It is also why this card
 * offers no „Vrati na podrazumevano": that link clears a machine's keys, and
 * this is a write about the profile's data.
 */
const TIMERS_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Tajmeri", en: "Timers" },
  controls: [
    {
      kind: "toggle",
      key: "sound-on-end",
      labelKey: {
        sr: "Pusti zvuk kada odbrojavanje istekne",
        en: "Play a sound when a countdown ends",
      },
      // Folded, and only the words somebody would really type - a Serbian
      // speaker searching this card types „zvuk" or „odbrojavanje", an English
      // one „sound" or „timer".
      keywords: ["zvuk", "zvucni", "signal", "sound", "timer", "alarm"],
      storage: "profile",
    },
  ],
};

/**
 * „Odbrojavanja" - the running countdowns, on the dashboard.
 *
 * ONE card, and it is a LIST of named countdowns with the time each has left:
 * that is the one fact here worth a home-screen row, because it is the fact a
 * user leaves the page to keep an eye on. The stopwatch is deliberately NOT a
 * card: it measures a span that lives in the page the user is looking at, so a
 * card for it would show a clock that stops the moment its own page is closed,
 * and a figure that freezes when you look away is worse than no figure.
 *
 * No `configFields`, on „Fokus"'s terms (`shared/modules.ts`): a knob on a card
 * narrows a LIST, and a cap here would hide a countdown the user is running.
 *
 * `title` is a `{ sr, en }` pair rather than a `strings` path, for the reason the
 * manifest's own header gives: the dashboard can be reached without ever having
 * opened this module's page, so its chunk - and its copy table with it - may not
 * have loaded.
 */
const TIMERS_WIDGETS: WidgetContract[] = [
  {
    id: "odbrojavanja",
    title: { sr: "Odbrojavanja", en: "Countdowns" },
    sizes: ["S", "M"],
    deepLink: "timers",
  },
];

export const manifest: ModuleManifest = {
  id: "timers",
  // UTIL is shared with „Fokus" and „Alatke" (PRD 29, „Utility Belt"), and this
  // module joins that sharing on purpose rather than taking a prefix of its own:
  // a stopwatch and a countdown are the same errand a timer and a tool drawer
  // are - separate things to reach for - and PRD 29 is the section they all
  // implement. `modules.test.ts`'s prefix→ids map states the sharing explicitly,
  // so any OTHER duplicate still fails.
  prefix: "UTIL",
  group: "plan",
  defaultEnabled: true,
  // The first slot after every compiled-in module (see `ModuleManifest.order`).
  // A round number, so the next kit module can sort above or below it without
  // renumbering this one.
  order: 100,
  copy: {
    name: { sr: "Tajmeri", en: "Timers" },
    description: {
      sr: "Štoperica i imenovana odbrojavanja koja rade i kad je stranica zatvorena.",
      en: "A stopwatch and named countdowns that keep running with the page closed.",
    },
  },
  widgets: TIMERS_WIDGETS,
  settings: TIMERS_SETTINGS,
};
