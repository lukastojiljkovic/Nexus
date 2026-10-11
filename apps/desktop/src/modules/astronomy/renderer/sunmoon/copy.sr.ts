/**
 * The Sun-and-Moon panel's own copy, in Serbian.
 *
 * A component of a module carries its own table and registers it under its own
 * name (`copy.ts`), for the reason the map's table beside this one states: the
 * astronomy corner is assembled by a later run, whose page table will be
 * registered under `astronomy`.
 *
 * TWO THINGS EVERY SENTENCE HERE IS CAREFUL ABOUT.
 *
 * The `{limit}`, `{degrees}`, `{percent}`, `{zone}` and `{place}` slots are the
 * ones `fill` writes into, and a slot is a whole value the translator may move:
 * a sentence with a number in it is composed at the call site, from this table,
 * rather than assembled out of two half-sentences there.
 *
 * And every sentence that stands where a TIME would have gone states the fact
 * that made the time impossible — the Sun below a limit, the Moon on one side of
 * the horizon all day — because that is the whole reason the slot is words: a
 * dash, or an empty row, would leave the reader to guess whether the number was
 * missing or the event was.
 */
export const sr = {
  panel: {
    placeTitle: "Mesto",
    placeNone: "Mesto još nije izabrano — izaberi grad ili unesi koordinate u kartici Mesto.",
    zoneNote: "Vremena su u zoni ovog računara ({zone}).",
    zoneNoteUnknown: "Vremena su u zoni ovog računara.",
    coordinates: { degrees: "°", north: "S", south: "J", east: "I", west: "Z" },
    sunTitle: "Sunce",
    sunrise: "Izlazak",
    solarNoon: "Sunčevo podne",
    sunset: "Zalazak",
    dayLength: "Dužina dana",
    polarDay: "Polarni dan",
    polarNight: "Polarna noć",
    noEvent: "Nema u ovom danu",
    twilightTitle: "Sumraci",
    bands: { civil: "Građanski", nautical: "Nautički", astronomical: "Astronomski" },
    twilightNeverBelow: "Sunce ne zalazi ispod {limit}° — sumraka nema",
    twilightNeverAbove: "Sunce ne izlazi iznad {limit}° — sumraka nema",
    moonTitle: "Mesec",
    moonrise: "Izlazak",
    moonset: "Zalazak",
    moonAlwaysAbove: "Ne zalazi u ovom danu",
    moonAlwaysBelow: "Ne izlazi u ovom danu",
    illuminated: "Osvetljeno {percent}",
    phaseNames: {
      new: "Mlad mesec",
      "waxing-crescent": "Rastući srp",
      "first-quarter": "Prva četvrt",
      "waxing-gibbous": "Rastući Mesec",
      full: "Pun mesec",
      "waning-gibbous": "Opadajući Mesec",
      "last-quarter": "Poslednja četvrt",
      "waning-crescent": "Opadajući srp",
    },
    phasesTitle: "Sledeće četiri faze",
    orientationTitle: "Orijentacija",
    roseLabel: "Kompas",
    facing: "Gledaš ovamo",
    sightings: {
      ahead: "Sunce mi je ispred",
      right: "Sunce mi je s desne strane",
      behind: "Sunce mi je iza mene",
      left: "Sunce mi je s leve strane",
    },
    northReading: "Sever ti je {degrees}° udesno od pravca u kojem gledaš.",
    sunBelowHorizon:
      "Sunce je ispod horizonta, pa nema šta da se meri — pogledaj ponovo dok je dan.",
  },
  place: {
    search: "Traži grad",
    searchHint: "Kucaj ime grada i izaberi ga sa liste, ili unesi koordinate ispod.",
    noResults: "Nema grada s tim imenom u tabeli.",
    latitude: "Širina",
    longitude: "Dužina",
    apply: "Primeni koordinate",
    reset: "Vrati na zonu računara",
    badLatitude: "Širina mora biti broj između −90 i 90.",
    badLongitude: "Dužina mora biti broj između −180 i 180.",
    current: "Izabrano mesto: {place}",
    none: "Mesto nije izabrano.",
    defaultPlace: "Podrazumevano mesto je grad iz zone ovog računara.",
  },
};
