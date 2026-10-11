import { sr } from "./copy.sr.js";

/**
 * The same table in English, typed by the Serbian one: one compile error per
 * sentence left untranslated and one per key invented, which is how the two stay
 * the same shape without anything checking them by hand.
 *
 * The register is the app's own English: sentence case, informative, no
 * exclamation marks, and the pack named the way its id spells it.
 */
export const en: typeof sr = {
  page: {
    subtitle:
      "The solar system, day and night on Earth, tonight's sky, and the Sun and Moon for one place — all at the same instant.",
  },
  tabs: {
    solar: "Solar system",
    earth: "Day and night",
    stars: "Tonight's sky",
    sunmoon: "Sun and Moon",
  },
  clock: {
    label: "Moment shown",
    now: "Now",
    hint: "The Now button always brings the view back to the present moment.",
    bad: "The moment must be a date and a time, such as 2026-10-10T20:30.",
  },
  solar: {
    scaleLabel: "Scale",
    scaleTrue: "True",
    scaleReadable: "Readable",
    scaleTrueHint:
      "True scale: the bodies sit where they really are, at their real sizes, so the Earth here is smaller than a pixel.",
    scaleReadableHint:
      "Readable scale: distances are compressed and the bodies enlarged. The order and the direction stay exact.",
    selectHint: "Pick a body by clicking it or its name.",
    selected: "{body} — {distance} au from the Earth",
  },
  textures: {
    credits: "Textures:",
    missing:
      "The planet photographs come from the „planet-textures“ pack — install it in Settings, on the „Content packs“ card.",
  },
  stars: {
    normal: "Normal",
    nightLabel: "Red light",
    nightHint:
      "The chart is drawn in one red on the darkest surface, so eyes adapted to the dark stay that way.",
    needPlace: "Choose a place and the sky chart will be drawn.",
  },
  settings: {
    caption: "The place the sky chart and the Sun and Moon are drawn for.",
    hint: "With no place chosen, the city of this computer's zone is used.",
    reset: "Back to the computer's zone",
  },
};
