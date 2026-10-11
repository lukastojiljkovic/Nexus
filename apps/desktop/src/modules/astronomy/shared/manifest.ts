import type { ModuleManifest, SettingsPanel } from "@nexus/core";

/**
 * THE ASTRONOMY module's manifest (ADR-090): the four parts wave 1 built as
 * components — the 3D solar system, the day-and-night map, the star map and the
 * Sun-and-Moon panel — assembled around one page and one clock.
 *
 * **Why the four are one module.** They are one subject read four ways, and
 * they share the two facts that make a corner of one: a place and an instant. A
 * rail row per part would be four rows, four toggles and four settings cards
 * for the same sky, and — the reason that actually decides it — the views could
 * then disagree about what "now" and "here" mean.
 *
 * **The words live here rather than in `strings.ts`** for the reason the kit's
 * header gives: the rail draws a module's name and the settings gallery its
 * one-line description before any chunk of the module has loaded, so those few
 * strings ride in the manifest as `{ sr, en }` pairs and everything the page
 * itself draws stays in `renderer/copy.sr.ts`/`copy.en.ts`.
 */

/**
 * The module's one preference (SET): the place the sky is drawn for.
 *
 * **`storage: "device"` for the reason `signals`' header gives at length.** The
 * module has no store and no migration: the place comes from the computer's own
 * time zone by default (ADR: `zoneLocation.ts`), so it is a fact about THIS
 * machine before it is a fact about the person, and the page and the settings
 * card both read and write it in `localStorage` through `renderer/prefs.ts`.
 * That also earns the card the shell's own „Vrati na podrazumevano", which is
 * exactly the act this setting wants: forget the picked place and fall back to
 * the zone's city.
 *
 * `kind: "value"` rather than `choice`, honestly: the domain is everywhere on
 * Earth and the shipped city table (`cities.ts`, 6 280 rows) is the picker, so
 * there is no closed list for a declaration to enumerate.
 */
const ASTRONOMY_SETTINGS: SettingsPanel = {
  titleKey: { sr: "Astronomija", en: "Astronomy" },
  controls: [
    {
      kind: "value",
      key: "place",
      labelKey: { sr: "Mesto za nebo", en: "Place for the sky" },
      // Folded, and only the words somebody would really type — a Serbian
      // speaker searching this card types „mesto" or „grad", an English one
      // „place" or „city".
      keywords: ["mesto", "grad", "koordinate", "place", "city", "location"],
      storage: "device",
    },
  ],
};

export const manifest: ModuleManifest = {
  id: "astronomy",
  // ASTR is this module's own prefix: the PRD registry has no row for an
  // astronomy corner, exactly as it has none for a map (MAP) or a voice diary
  // (REC), so the module declares its own rather than borrowing a tool
  // drawer's. `modules.test.ts`'s prefix→ids map states it, so a duplicate
  // still fails.
  prefix: "ASTR",
  // Knowledge, on ADR-093's own reading of the group: this is material somebody
  // consults — where a planet is, where it is night, what is overhead tonight —
  // which is what the group holds (the reference libraries, the map, the
  // translator sit with it).
  group: "knowledge",
  // ON by default, like every built module except PRIV and PRO: the module
  // writes nothing and is complete the moment it is open — the planet textures
  // are an optional pack, and without it the page draws plain coloured bodies
  // and says which pack adds them.
  defaultEnabled: true,
  // After the modules wave 1 registered (the last is `chess` at 350), and on a
  // number of its own so a tie with another wave-2 module is resolved by id
  // rather than by luck.
  order: 400,
  copy: {
    name: { sr: "Astronomija", en: "Astronomy" },
    description: {
      sr: "Sunčev sistem u 3D, dan i noć na Zemlji, nebo večeras i Sunce i Mesec za izabrano mesto.",
      en: "The solar system in 3D, day and night on Earth, tonight's sky, and the Sun and Moon for a chosen place.",
    },
  },
  settings: ASTRONOMY_SETTINGS,
  // No `widgets`: a dashboard card draws a FACT about the profile (DASH-003),
  // and this module stores nothing — every figure it could publish is a live
  // reading of the sky at an instant the card cannot keep. „Tajmeri" refuses
  // its stopwatch on the same grounds, and „Signali" refuses all four of its.
};
