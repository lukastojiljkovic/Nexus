import { sr } from "./copy.sr.js";

/**
 * DRAWINGS in English - the same shape as `copy.sr.ts`, checked by the compiler.
 *
 * `typeof sr` is the whole mechanism: a key left untranslated, one invented
 * here, or a nested table that does not match is one compile error each. The
 * register is the app's own English: sentence case, informative, no exclamation
 * marks.
 *
 * Three of the unit symbols are deliberately NOT the Serbian ones - an
 * astronomical unit, a light year and an angstrom are written the way the
 * language being read writes them, and the file itself says so.
 */
export const en: typeof sr = {
  page: {
    subtitle: "An AutoCAD drawing: layers, measurements and print to PDF.",
    loading: "Loading...",
  },
  open: {
    button: "Open a drawing",
  },
  empty: {
    title: "No drawing is open",
    body: "Open a DXF file and read it. Everything stays on this computer - no drawing ever leaves it.",
  },
  phases: {
    fetch: "Reading the file...",
    parse: "Parsing the drawing...",
    prepare: "Preparing the view...",
  },
  viewer: {
    file: "File",
    background: "Background",
    light: "Light",
    dark: "Dark",
    fit: "Fit the drawing",
    zoomWindow: "Zoom to a window",
    cancelPick: "Cancel picking",
    cursor: "Cursor",
  },
  zoom: {
    first: "Click the first corner of the window.",
    second: "Click the opposite corner.",
  },
  measure: {
    start: "Measure",
    title: "Measurement",
    first: "First point",
    second: "Second point",
    distance: "Length",
    angle: "Angle",
    dx: "Delta X",
    dy: "Delta Y",
    clear: "Clear",
    hint: "Click two points on the drawing; Escape cancels the pick.",
    unitless: "This drawing names no unit, so the measurements are in its own units.",
  },
  layers: {
    title: "Layers",
    empty: "This drawing names no layers.",
    showAll: "Show all",
    hideAll: "Hide all",
  },
  dwg: {
    body: "DWG needs the LibreDWG pack - a separate tool that converts DWG to DXF.",
    catalogue: "The pack is installed in Settings, on the Packs card.",
  },
  print: {
    button: "Print to PDF",
    saved: "The PDF is saved:",
    cancelled: "The print was cancelled.",
    failed: "The PDF was not saved.",
  },
  errors: {
    openFailed: "The file was not opened.",
    parseFailed: "The drawing could not be read - the file is probably damaged, or is not a DXF.",
    timedOut: "Parsing took too long, so it was stopped.",
  },
  refusals: {
    "too-large": "The file is larger than 32 MB.",
    unreadable: "The file cannot be read.",
    "not-a-file": "The item chosen is not a file.",
    "unknown-format": "Nexus opens .dxf and .dwg files.",
    empty: "The file is empty.",
  },
  units: {
    unitless: "no unit",
    inches: "in",
    feet: "ft",
    miles: "mi",
    millimeters: "mm",
    centimeters: "cm",
    meters: "m",
    kilometers: "km",
    microinches: "microin",
    mils: "mil",
    yards: "yd",
    angstroms: "angstrom",
    nanometers: "nm",
    microns: "micron",
    decimeters: "dm",
    dekameters: "dam",
    hectometers: "hm",
    gigameters: "Gm",
    astronomicalUnits: "AU",
    lightYears: "ly",
    parsecs: "pc",
    usSurveyFeet: "US ft",
    usSurveyInches: "US in",
    usSurveyYards: "US yd",
    usSurveyMiles: "US mi",
  },
};
