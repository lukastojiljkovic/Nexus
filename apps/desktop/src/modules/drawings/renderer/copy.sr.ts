/**
 * DRAWINGS' own copy, in Serbian - the SHAPE every other locale of this module
 * is checked against (ADR-090).
 *
 * The unit symbols are the one table that DIFFERS between the two locales rather
 * than being translated: a drawing is annotated in the notation of the language
 * it is read in, and Serbian writes an astronomical unit as "AJ" where English
 * writes "AU".
 */
export const sr = {
  page: {
    subtitle: "AutoCAD crtež: slojevi, mere i štampa u PDF.",
    loading: "Učitavanje...",
  },
  open: {
    button: "Otvori crtež",
  },
  empty: {
    title: "Nijedan crtež nije otvoren",
    body: "Otvori DXF datoteku i pregledaj je. Sve ostaje na ovom računaru - crtež se nigde ne šalje.",
  },
  phases: {
    fetch: "Čitam datoteku...",
    parse: "Raščlanjujem crtež...",
    prepare: "Pripremam prikaz...",
  },
  viewer: {
    file: "Datoteka",
    background: "Pozadina",
    light: "Svetla",
    dark: "Tamna",
    fit: "Uklopi crtež",
    zoomWindow: "Zum na prozor",
    cancelPick: "Prekini biranje",
    cursor: "Kursor",
  },
  zoom: {
    first: "Klikni prvi ugao prozora.",
    second: "Klikni suprotni ugao.",
  },
  measure: {
    start: "Meri",
    title: "Merenje",
    first: "Prva tačka",
    second: "Druga tačka",
    distance: "Dužina",
    angle: "Ugao",
    dx: "Delta X",
    dy: "Delta Y",
    clear: "Očisti",
    hint: "Klikni dve tačke na crtežu; Escape poništava izbor.",
    unitless: "Crtež ne navodi jedinicu, pa su mere u njegovim sopstvenim jedinicama.",
  },
  layers: {
    title: "Slojevi",
    empty: "Crtež ne navodi nijedan sloj.",
    showAll: "Prikaži sve",
    hideAll: "Sakrij sve",
  },
  dwg: {
    body: "DWG se otvara uz LibreDWG paket - zaseban alat koji DWG prevodi u DXF.",
    catalogue: "Paket se uvozi u Podešavanjima, na kartici Paketi.",
  },
  print: {
    button: "Štampaj u PDF",
    saved: "PDF je sačuvan:",
    cancelled: "Štampanje je otkazano.",
    failed: "PDF nije sačuvan.",
  },
  errors: {
    openFailed: "Datoteka nije otvorena.",
    parseFailed: "Crtež nije moguće pročitati - datoteka je verovatno oštećena ili nije DXF.",
    timedOut: "Raščlanjivanje traje predugo, pa je prekinuto.",
  },
  refusals: {
    "too-large": "Datoteka je veća od 32 MB.",
    unreadable: "Datoteka se ne može pročitati.",
    "not-a-file": "Izabrana stavka nije datoteka.",
    "unknown-format": "Nexus otvara .dxf i .dwg datoteke.",
    empty: "Datoteka je prazna.",
  },
  units: {
    unitless: "bez jedinice",
    inches: "in",
    feet: "ft",
    miles: "mi",
    millimeters: "mm",
    centimeters: "cm",
    meters: "m",
    kilometers: "km",
    microinches: "mikroin",
    mils: "mil",
    yards: "yd",
    angstroms: "angstrem",
    nanometers: "nm",
    microns: "mikron",
    decimeters: "dm",
    dekameters: "dam",
    hectometers: "hm",
    gigameters: "Gm",
    astronomicalUnits: "AJ",
    lightYears: "sg",
    parsecs: "pc",
    usSurveyFeet: "US ft",
    usSurveyInches: "US in",
    usSurveyYards: "US yd",
    usSurveyMiles: "US mi",
  },
};
