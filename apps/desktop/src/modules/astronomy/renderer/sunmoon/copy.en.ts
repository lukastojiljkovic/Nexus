import { sr } from "./copy.sr.js";

/**
 * The same table in English, typed by the Serbian one: one compile error per
 * sentence left untranslated and one per key invented, which is how the two stay
 * the same shape without anything checking them by hand.
 */
export const en: typeof sr = {
  panel: {
    placeTitle: "Place",
    placeNone: "No place chosen yet — pick a city or type coordinates in the Place card.",
    zoneNote: "Times are in this computer's zone ({zone}).",
    zoneNoteUnknown: "Times are in this computer's zone.",
    coordinates: { degrees: "°", north: "N", south: "S", east: "E", west: "W" },
    sunTitle: "Sun",
    sunrise: "Sunrise",
    solarNoon: "Solar noon",
    sunset: "Sunset",
    dayLength: "Day length",
    polarDay: "Polar day",
    polarNight: "Polar night",
    noEvent: "Not on this day",
    twilightTitle: "Twilight",
    bands: { civil: "Civil", nautical: "Nautical", astronomical: "Astronomical" },
    twilightNeverBelow: "The Sun does not set below {limit}° — there is no twilight",
    twilightNeverAbove: "The Sun does not rise above {limit}° — there is no twilight",
    moonTitle: "Moon",
    moonrise: "Moonrise",
    moonset: "Moonset",
    moonAlwaysAbove: "Does not set on this day",
    moonAlwaysBelow: "Does not rise on this day",
    illuminated: "Lit {percent}",
    phaseNames: {
      new: "New moon",
      "waxing-crescent": "Waxing crescent",
      "first-quarter": "First quarter",
      "waxing-gibbous": "Waxing gibbous",
      full: "Full moon",
      "waning-gibbous": "Waning gibbous",
      "last-quarter": "Last quarter",
      "waning-crescent": "Waning crescent",
    },
    phasesTitle: "The next four phases",
    orientationTitle: "Orientation",
    roseLabel: "Compass",
    facing: "You are facing this way",
    sightings: {
      ahead: "The Sun is ahead of me",
      right: "The Sun is to my right",
      behind: "The Sun is behind me",
      left: "The Sun is to my left",
    },
    northReading: "North is {degrees}° clockwise from the way you are facing.",
    sunBelowHorizon:
      "The Sun is below the horizon, so there is nothing to measure — look again in daylight.",
  },
  place: {
    search: "Search for a city",
    searchHint: "Type a city's name and pick it from the list, or type coordinates below.",
    noResults: "No city with that name in the table.",
    latitude: "Latitude",
    longitude: "Longitude",
    apply: "Apply coordinates",
    reset: "Back to the computer's zone",
    badLatitude: "Latitude must be a number between −90 and 90.",
    badLongitude: "Longitude must be a number between −180 and 180.",
    current: "Chosen place: {place}",
    none: "No place chosen.",
    defaultPlace: "The default place is the city of this computer's zone.",
  },
};
