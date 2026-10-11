import type { ModuleManifest, SettingsPanel } from "@nexus/core";

/**
 * The TRANSLATOR module's manifest (ADR-090) — the whole of what the shell knows
 * about this module before its page chunk loads.
 *
 * **What the module is.** A Serbian–English dictionary that reads the
 * `dictionary-sr-en` content pack: English words with their Serbian
 * translations, Serbian words with their English meanings, and the Wikivoyage
 * phrasebook by topic. Nothing it shows is computed here — the words come from
 * a signed pack (ADR-091), which is what keeps 25 megabytes of somebody else's
 * dictionary out of the installer and out of the profile's encrypted database.
 *
 * **Two preferences, both about this machine.** The direction the page opens
 * on, and how many recent lookups it keeps — both `storage: "device"`, because
 * both are `localStorage` and neither changes a stored row. There is no
 * migration for this module and no table: a lookup leaves no trace in the
 * profile, and the recent list is a convenience that a machine can forget
 * without losing anything that exists.
 *
 * **No `widgets`, and the absence is a decision.** A dashboard card is a fact
 * about a profile that somebody glances at; a dictionary has no facts, and a
 * card showing "your last word was …" would be a row the user can neither act
 * on nor read without opening the page it came from. „Alatke" and „Tabla"
 * refuse a card on the same ground.
 *
 * **No `searchIndexers`.** The pack is not the user's data, so indexing it
 * would put sixty thousand words nobody wrote into the palette — the argument
 * „Ishrana" makes about its own catalogue. The module's own search box is the
 * surface for this question.
 */

/**
 * The module's settings card, composed by the settings page from this
 * declaration exactly as every other module's is.
 *
 * Both controls are `device`, and that is what earns the card the „Vrati na
 * podrazumevano" link a profile-stored card is denied — the two control bodies
 * read and write one `localStorage` key each (`renderer/prefs.ts`), and
 * forgetting them changes nothing that already exists.
 *
 * `direction` is a `choice` because the domain really is closed: auto, this
 * way, that way. `recent` is a `value` because the domain is a count — the
 * panel owns its bounds (0…20), and restating a range in a declaration that
 * nothing enforces is the drift `SettingsValueControl` warns about.
 */
const TRANSLATOR_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Prevodilac", en: "Translator" },
  controls: [
    {
      kind: "choice",
      key: "direction",
      labelKey: { sr: "Smer na otvaranju", en: "Direction on open" },
      storage: "device",
      options: [
        { id: "auto", labelKey: { sr: "Automatski", en: "Automatic" } },
        { id: "en-sr", labelKey: { sr: "Engleski → srpski", en: "English → Serbian" } },
        { id: "sr-en", labelKey: { sr: "Srpski → engleski", en: "Serbian → English" } },
      ],
      keywords: ["prevodilac", "recnik", "smer", "jezik", "translator", "direction"],
    },
    {
      kind: "value",
      key: "recent",
      labelKey: { sr: "Koliko se skorašnjih reči pamti", en: "How many recent lookups are kept" },
      storage: "device",
      keywords: ["prevodilac", "recnik", "skorasnje", "istorija", "recent", "history"],
    },
  ],
};

export const manifest: ModuleManifest = {
  id: "translator",
  // LANG is this module's own entry rather than a borrowed one: the dictionary
  // is the app's language reference, and no other module implements that PRD
  // section. `modules.test.ts`'s prefix map states the one sharing this build
  // has (UTIL), so a collision here would fail that test rather than slip past.
  prefix: "LANG",
  group: "knowledge",
  defaultEnabled: true,
  // After every compiled-in module and after Timers (order 100), which is where
  // the second discovered module belongs. A round number, so a third module can
  // sort above or below it without renumbering this one.
  order: 230,
  copy: {
    name: { sr: "Prevodilac", en: "Translator" },
    description: {
      sr: "Rečnik srpskog i engleskog i fraze za put — rade bez mreže.",
      en: "A Serbian–English dictionary and travel phrases — they work offline.",
    },
  },
  settings: TRANSLATOR_SETTINGS,
};
