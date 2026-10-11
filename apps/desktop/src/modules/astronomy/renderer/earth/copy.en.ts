import { sr } from "./copy.sr.js";

/**
 * The same table in English, typed by the Serbian one: one compile error per
 * sentence left untranslated and one per key invented, which is how the two stay
 * the same shape without anything checking them by hand.
 */
export const en: typeof sr = {
  map: {
    caption:
      "Day and night right now: the day and night images of the world crossfaded across the civil, nautical and astronomical twilight bands.",
    terminator: "The terminator — the Sun on the horizon (0°)",
    civil: "Civil twilight (−6°)",
    nautical: "Nautical twilight (−12°)",
    astronomical: "Astronomical twilight (−18°)",
    sunOverhead: "The Sun overhead",
    moonOverhead: "The Moon overhead",
    observer: "Your place",
    noObserver:
      "No place chosen yet — pick a city or type coordinates and the pin will appear on the map.",
  },
};
