import type { ModuleManifest, SettingsPanel } from "@nexus/core";

/**
 * THE SIGNALS module's manifest (ADR-090): the four instruments of the module -
 * Morse, the ASCII table, the tuner and the sound meter - as one folder the
 * shell discovers.
 *
 * **Why these four are one module.** They are one subject: each of them is a way
 * of reading a signal that is already in the room or on the page. Morse is a key
 * tapped and read back, ASCII is a character as a number, the tuner is a
 * frequency as a note, and the meter is a level in dBFS. A separate module for
 * each would be four rail rows, four toggles and four settings cards for one
 * thing somebody reaches for with the same hand.
 *
 * **The words live here rather than in `strings.ts` for the reason the kit's
 * header gives**: the rail draws a module's name and the settings gallery its
 * one-line description before any chunk of the module has loaded, so those few
 * strings ride in the manifest as `{ sr, en }` pairs and everything the page
 * itself draws stays in `renderer/copy.sr.ts`/`copy.en.ts`, out of the startup
 * chunk.
 */

/**
 * The module's settings card, declared the way every other module declares one
 * so the settings page composes it from the registry.
 *
 * **`storage: "device"` for all three, and that is the honest answer rather than
 * a shortcut.** This module has no store and no migration: every value on its
 * page is either an engine's output or one of these three knobs, and the three
 * are facts about THIS machine - which tone is comfortable on these speakers,
 * which speed this hand reads at, what this player's ensemble is tuned to. A
 * profile value would have to live in a table, and the kit's own rule is that a
 * device preference is what a module without a store keeps (`SettingsStorage`).
 * The two consequences are stated rather than hidden: the card offers no „Vrati
 * na podrazumevano" link (a kit card's reset is the shell's, and it only exists
 * for a body the shell owns), and none of the three travels in the archive.
 *
 * The card's body is `renderer/Settings.tsx`, which draws exactly the controls
 * declared here and is the module's own reader and writer of them.
 */
const SIGNALS_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Signali", en: "Signals" },
  controls: [
    {
      kind: "value",
      key: "morse-speed",
      labelKey: {
        sr: "Brzina Morsea (reči u minuti)",
        en: "Morse speed (words per minute)",
      },
      // Folded, and only the words somebody would really type - a Serbian
      // speaker searching this card types „brzina" or „morse", an English one
      // „speed" or „wpm".
      keywords: ["brzina", "morse", "wpm", "speed", "telegraf"],
      storage: "device",
    },
    {
      kind: "value",
      key: "morse-pitch",
      labelKey: {
        sr: "Visina tona Morsea",
        en: "Morse tone pitch",
      },
      keywords: ["ton", "visina", "pitch", "tone", "morse", "hz"],
      storage: "device",
    },
    {
      kind: "value",
      key: "tuner-a4",
      labelKey: {
        sr: "Referentni A4 za štimer",
        en: "Tuner reference A4",
      },
      keywords: ["stimer", "stimer", "a4", "referenca", "tuner", "reference"],
      storage: "device",
    },
  ],
};

export const manifest: ModuleManifest = {
  id: "signals",
  // SIG is this module's own prefix. It does NOT borrow UTIL: PRD 29 („Utility
  // Belt") is shared by „Fokus", „Alatke" and „Tajmeri" because those three
  // implement that one section, and Morse, the ASCII table, the tuner and the
  // meter are not a tool drawer - they are one instrument panel, and giving
  // them a second reading of a section they are not in is exactly the drift
  // the prefix map in `modules.test.ts` exists to catch.
  prefix: "SIG",
  group: "make",
  defaultEnabled: true,
  // After the first kit module („Tajmeri", order 100), with room between them
  // for the modules arriving beside this one. Ties are broken by id, so a
  // number another run also picked is a resolved order rather than a defect.
  order: 200,
  copy: {
    name: { sr: "Signali", en: "Signals" },
    description: {
      sr: "Morse, ASCII tabela, štimer i merač nivoa zvuka — sa mikrofonom samo kad ih pokreneš.",
      en: "Morse, an ASCII table, a tuner and a sound meter — the microphone opens only when one is started.",
    },
  },
  settings: SIGNALS_SETTINGS,
  // No `widgets`, and it is a decision rather than an omission. A dashboard card
  // draws a FACT about the profile (DASH-003); this module stores nothing, so
  // every card it could publish would be a live instrument - a level meter
  // reading a room, a tuner reading a string - and a home-screen card whose
  // needle stops the moment its own page closes is worse than no card. The
  // „Tajmeri" module refuses its stopwatch on the same grounds.
};
