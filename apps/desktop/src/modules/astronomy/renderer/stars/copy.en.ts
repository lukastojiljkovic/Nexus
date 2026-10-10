import { sr } from "./copy.sr.js";

/**
 * The star map in English - the same shape as `copy.sr.ts`, checked by the
 * compiler: a sentence left untranslated, a key invented here or a table that
 * does not match is one compile error each.
 *
 * The register is the app's own English: sentence case, informative, no
 * exclamation marks. Only the four cardinal points are abbreviations, because
 * that is what they are on a chart in any language.
 */
export const en: typeof sr = {
  canvas: {
    label: "A star chart for the chosen place and instant.",
    hint: "Drag to pan, use the wheel to zoom. The arrow keys pan, plus and minus zoom.",
  },
  search: {
    label: "Find a star or constellation",
    noResults: "No such name on the chart.",
    belowHorizon: "below the horizon",
    star: "star",
    constellation: "constellation",
    reset: "Centre on the zenith",
  },
  body: {
    sun: "Sun",
    moon: "Moon",
    mercury: "Mercury",
    venus: "Venus",
    earth: "Earth",
    mars: "Mars",
    jupiter: "Jupiter",
    saturn: "Saturn",
    uranus: "Uranus",
    neptune: "Neptune",
    pluto: "Pluto",
  },
  cardinal: {
    north: "N",
    east: "E",
    south: "S",
    west: "W",
  },
};
