import type { ModuleManifest, SettingsPanel } from "@nexus/core";

/**
 * The ASSISTANT module's manifest - the whole of what the shell knows about this
 * module before its page loads (ADR-090's discovery contract).
 *
 * **The words the shell needs live here.** The rail draws the module's name and
 * the settings gallery its one-line description before any chunk of the module
 * has loaded, so those two are `{ sr, en }` pairs; everything this module's own
 * page draws lives in `renderer/copy.sr.ts`/`copy.en.ts`, which arrive with the
 * page.
 */

/**
 * The card, in three controls - one per thing a person can actually decide.
 *
 * **The default tier is a PROFILE row.** Which of the three recommendations a
 * new turn loads is a fact about the assistant this profile wants, so it travels
 * in the profile's own archive (`assistant_settings`, migration 091).
 *
 * **The web-search consent is a DEVICE row**, and that is not a detail: ADR-097
 * puts the switch in `assistant-web.json` beside `cloud.json` and `network.json`
 * because the question "may the assistant fetch a page" has to be answerable
 * before any account is unlocked, and a consent that lived inside one profile's
 * encrypted database could not be. So this card declares the storage the value
 * really has rather than the one the page would find convenient.
 *
 * **The knowledge index is a fact**, not a control: passages indexed, sources
 * still pending and whether an embedding model is loaded are readings, and the
 * one thing a person can do about them - rebuild - is a button in the body.
 */
const ASSISTANT_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Asistent", en: "Assistant" },
  controls: [
    {
      kind: "choice",
      key: "tier",
      labelKey: { sr: "Podrazumevani nivo", en: "Default tier" },
      keywords: ["model", "nivo", "tier", "inteligencija", "ravnoteza", "brzina"],
      storage: "profile",
      options: [
        {
          id: "intelligence",
          labelKey: { sr: "Inteligencija", en: "Intelligence" },
        },
        { id: "balance", labelKey: { sr: "Ravnoteža", en: "Balance" } },
        { id: "speed", labelKey: { sr: "Brzina", en: "Speed" } },
      ],
    },
    {
      kind: "toggle",
      key: "web-search",
      labelKey: { sr: "Pretraga weba", en: "Web search" },
      keywords: ["web", "internet", "pretraga", "search", "privatnost"],
      storage: "device",
    },
    {
      kind: "fact",
      key: "knowledge",
      labelKey: { sr: "Građa koju asistent poznaje", en: "The material the assistant knows" },
      keywords: ["grada", "indeks", "znanje", "index", "knowledge"],
    },
  ],
};

export const manifest: ModuleManifest = {
  id: "assistant",
  // A prefix of its own: the assistant is not a second reading of any PRD section
  // the modules above implement, so it does not borrow a drawer's.
  prefix: "ASST",
  // Knowledge, on ADR-093's own reasoning: the recorder and Učenje sit there
  // because the group means "the handling of what somebody wrote down", and an
  // assistant that answers from the user's notes, tasks, events, files and the
  // app's own manual is exactly that - not an area of a life and not a thing you
  // make. Its `order` therefore places it after the translator and before the
  // maker's tools.
  group: "knowledge",
  defaultEnabled: true,
  // After the translator (230) and before the scanner (300): the reference kits
  // come first inside Knowledge, and the assistant closes them.
  order: 240,
  copy: {
    name: { sr: "Asistent", en: "Assistant" },
    description: {
      sr: "Razgovor sa lokalnim modelom koji poznaje aplikaciju i tvoje podatke, bez interneta.",
      en: "A conversation with a local model that knows the app and your own data, with no internet.",
    },
  },
  settings: ASSISTANT_SETTINGS,
};
