import type { ModuleManifest, SettingsPanel, WidgetContract } from "@nexus/core";

/**
 * The PANTRY module's manifest - what the shell knows about this module before
 * its page loads (ADR-090).
 *
 * **This file is the discovery contract.** `shared/modules.ts` globs
 * `modules/<id>/shared/manifest.ts` eagerly, so a manifest that exists is a
 * manifest the registry has - in the rail, in the settings gallery, in the
 * onboarding list, in `resolveEnabled` and in the shots harness's per-module
 * scenes - with no list anywhere to add it to.
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
 * `SettingsStorage` asks for: MAIN is what fires this module's expiry reminder
 * and main reads this number while no page is open, so the value is a fact about
 * the profile's own shelves rather than about this machine - and it therefore
 * travels in the profile's own archive. It is also why this card offers no
 * "Vrati na podrazumevano": that link clears a machine's keys, and this is a
 * write about the profile's data.
 *
 * `kind: "value"` rather than a set of choices, on STUDY's retention reasoning:
 * the domain is a whole number of days, and enumerating a handful of "sensible"
 * windows would be inventing a curated list. Seven days is what it opens on,
 * because that is what the store answers with no row at all.
 */
const PANTRY_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Ostava", en: "Pantry" },
  controls: [
    {
      kind: "value",
      key: "expiry-window",
      labelKey: {
        sr: "Koliko dana unapred se prijavljuje „ističe uskoro“",
        en: "How many days ahead an expiry warning starts",
      },
      // Folded, and only the words somebody would really type - a Serbian
      // speaker searching this card types „rok" or „namirnice", an English one
      // „expiry" or „pantry".
      keywords: ["ostava", "namirnice", "rok", "isticanje", "expiry", "pantry"],
      storage: "profile",
    },
  ],
};

/**
 * "Ističe ove nedelje" - what is about to go off, on the dashboard.
 *
 * ONE card, and it is a LIST of the items the module's own window calls expired
 * or expiring, each with the day it stops being good: that is the one fact here
 * worth a home-screen row, because it is the fact a user leaves the page to keep
 * an eye on.
 *
 * **No `configFields`, on "Navike danas"'s reasoning rather than for want of a
 * field.** The obvious knob is a row cap, and a cap is exactly the wrong thing
 * here: every capped card picks the front of a queue that can run to hundreds,
 * while this card draws what is about to be WASTED - so a cap would hide a
 * warning, which is the one thing the card exists to state. The window itself is
 * already the bound, and the settings card is where it is set.
 *
 * `title` is a `{ sr, en }` pair rather than a `strings` path, for the reason the
 * manifest's own header gives: the dashboard can be reached without ever having
 * opened this module's page, so its chunk - and its copy table with it - may not
 * have loaded.
 */
const PANTRY_WIDGETS: WidgetContract[] = [
  {
    id: "isticanje",
    title: { sr: "Ističe ove nedelje", en: "Expires this week" },
    sizes: ["S", "M"],
    deepLink: "pantry",
  },
];

export const manifest: ModuleManifest = {
  id: "pantry",
  // PANT is its own PRD prefix rather than a share of somebody else's, on
  // "Tabla"'s terms: "what is in the house" is a subject somebody HAS, which is
  // what "Život" holds, and no other PRD entry already implements it.
  prefix: "PANT",
  group: "life",
  // ON by default, like every built module except PRIV and "Stručne alatke":
  // the module writes nothing at all until the user records a first item, and a
  // life-management app whose pantry had to be switched on first would be
  // hiding one of the things it is for.
  defaultEnabled: true,
  // After TIMERS' 100, and a round number so the next kit module can sort above
  // or below it without renumbering this one.
  order: 150,
  copy: {
    name: { sr: "Ostava", en: "Pantry" },
    description: {
      sr: "Šta je u kući, šta se troši i šta ističe.",
      en: "What is in the house, what runs out, and what expires.",
    },
  },
  widgets: PANTRY_WIDGETS,
  settings: PANTRY_SETTINGS,
};
