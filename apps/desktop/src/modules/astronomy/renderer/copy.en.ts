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
    selectHint:
      "Drag to turn the view, right-drag or Shift-drag to move it, scroll to zoom toward the pointer. Click a body or its name for its card.",
    overview: "Whole system",
  },
  textures: {
    credits: "Textures:",
    failed: "The „planet-textures“ pack could not be read, so the bodies stay without photographs.",
    retry: "Try again",
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
  card: {
    close: "Close the card",
    kinds: {
      star: "Star",
      planet: "Planet",
      dwarf: "Dwarf planet",
      moon: "The Earth's natural satellite",
    },
    now: "Now",
    fromSun: "From the Sun",
    fromEarth: "From the Earth",
    light: "Light from the Earth takes",
    nearest: "Nearest body",
    others: "Distances to the other bodies",
    facts: "Facts",
    diameter: "Diameter",
    mass: "Mass",
    gravity: "Surface gravity",
    day: "Length of day",
    rotation: "Rotation period",
    orbit: "Orbit around the Sun",
    orbitMoon: "Orbit around the Earth",
    temperature: "Mean temperature",
    moons: "Moons",
    rings: "Rings",
    yes: "Yes",
    no: "No",
    source: "Source: NASA planetary fact sheets, retrieved {date}.",
    units: {
      km: "km",
      au: "au",
      millionKm: "million km",
      mass: "× 10²⁴ kg",
      gravity: "m/s²",
      hours: "h",
      days: "days",
      celsius: "°C",
      seconds: "s",
      minutes: "min",
    },
  },
};
