import type { ModuleManifest, SettingsPanel, WidgetContract } from "@nexus/core";

/**
 * The RECORDER module's manifest — a voice and camera diary, and the whole of
 * what the shell knows about it before its page loads (ADR-090).
 *
 * **The words live here rather than in `renderer/copy.sr.ts`.** The rail draws
 * the module's name and the settings gallery its one-line description before any
 * chunk of this module has arrived, so this file carries the few strings the
 * shell needs as `{ sr, en }` pairs; everything the page draws lives in the two
 * copy tables beside it, where it stays out of the startup chunk. That split is
 * the kit's, and `timers/shared/manifest.ts` is the worked example.
 */

/**
 * The module's one preference (SET), declared the way every module declares a
 * card so the settings page composes it from the registry.
 *
 * **`storage: "profile"`, which is the kit's own rule rather than a preference.**
 * `SettingsStorage` asks a module to say whether main reads the row: here main
 * does (`recorder_settings`, migration 077), the capture on any machine of this
 * profile obeys it, and it therefore travels in the profile's own archive —
 * which is also why this card offers no „Vrati na podrazumevano", since that
 * link belongs to the cards whose whole state is the DEVICE's (SET §5).
 */
const RECORDER_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Snimač", en: "Recorder" },
  controls: [
    {
      kind: "toggle",
      key: "countdown",
      labelKey: {
        sr: "Odbrojavanje pre početka snimanja",
        en: "A countdown before recording starts",
      },
      // The words somebody would really type, Serbian and English alike.
      keywords: ["odbrojavanje", "countdown", "snimanje", "recording", "tajmer"],
      storage: "profile",
    },
  ],
};

/**
 * „Poslednji snimci" — the newest recordings, on the dashboard.
 *
 * ONE card, and it is the newest few recordings with their lengths: that is the
 * fact a person leaves the page to keep an eye on. A capture in progress is
 * deliberately NOT a card — it can only exist while the recorder page is open,
 * so a card for it would draw a state that is already gone by the time the
 * dashboard is looked at.
 *
 * No `configFields`: every knob the other cards carry narrows a LIST, and this
 * card draws a glance rather than the list. How many rows that glance is
 * (`Widgets.tsx`'s own constant) belongs to the card's size, not to the user —
 * and a `count` field here would be a second, weaker copy of the page.
 */
const RECORDER_WIDGETS: WidgetContract[] = [
  {
    id: "snimci",
    title: { sr: "Poslednji snimci", en: "Latest recordings" },
    sizes: ["S", "M"],
    deepLink: "recorder",
  },
];

export const manifest: ModuleManifest = {
  id: "recorder",
  // The recorder is a diary of the user's own voice and camera, and the brief
  // names no PRD section it belongs to. So it takes its own prefix rather than
  // borrowing another section's — a prefix is traceability to one PRD entry,
  // and `modules.test.ts` states the sharing explicitly, which is what makes
  // „borrowed" and „deliberately shared" different answers here.
  prefix: "REC",
  group: "knowledge",
  defaultEnabled: true,
  order: 170,
  copy: {
    name: { sr: "Snimač", en: "Recorder" },
    description: {
      sr: "Glasovni i video dnevnik: snimi zvuk ili kameru i preslušaj kad ti treba.",
      en: "A voice and camera diary: record sound or video and play it back when you need it.",
    },
  },
  widgets: RECORDER_WIDGETS,
  settings: RECORDER_SETTINGS,
};
