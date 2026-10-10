import { sr } from "./copy.sr.js";

/**
 * RADIONICA in English - the same shape as `copy.sr.ts`, checked by the
 * compiler: a sentence left untranslated, a key invented here, or a nested table
 * that does not match is one compile error each, so this file cannot drift from
 * the Serbian table the way a second hand-kept table would.
 */
export const en: typeof sr = {
  page: {
    subtitle: "A model, a toolpath and a board - viewed with nothing else installed.",
    loading: "Loading…",
  },
  targets: {
    model: "Model",
    toolpath: "G-code",
    board: "Gerber",
  },
  open: {
    model: "Open an STL",
    toolpath: "Open G-code",
    board: "Open Gerber",
    again: "Open again",
    busy: "Open another file",
  },
  empty: {
    modelTitle: "No model is open",
    modelBody: "Open an STL file to see its shape, its bounds in millimetres, its volume and its area.",
    toolpathTitle: "No toolpath is open",
    toolpathBody: "Open a G-code file to see its layers, path length, filament and estimated time.",
    boardTitle: "No board is open",
    boardBody:
      "Open the Gerber and Excellon files of one circuit - the layers stack onto the same board, and you choose which are shown.",
  },
  model: {
    format: "Encoding",
    formatBinary: "binary",
    formatAscii: "ASCII",
    triangles: "Triangles",
    bounds: "Bounds",
    volume: "Volume",
    area: "Surface area",
    wireframe: "Wireframe",
    closedNote: "The mesh is closed, so the volume is exact for this model.",
    openNote: "The mesh is not closed - the volume is then a rough indication, not a measurement.",
    unitsNote: "An STL carries no unit; every figure here is read as millimetres.",
    reading: "Reading the model…",
    readError: "The file was opened, but it is not an STL this viewer can read. Check that it is an STL.",
  },
  toolpath: {
    layers: "Layers",
    layer: "Layer",
    zHeight: "Layer height",
    extruding: "Printing",
    travel: "Travel",
    filament: "Filament",
    time: "Estimated time",
    timeNote:
      "The estimate is the path travelled divided by the commanded feed rates (F). A slicer shows a longer time because it also counts acceleration, deceleration and short moves that never reach the commanded rate.",
    showingAll: "every layer",
    units: "Units",
    unitsInch: "inches (G20)",
    reading: "Reading the toolpath…",
    readError:
      "The file was opened, but it holds no toolpath this viewer draws. Check that it is G-code.",
    warnings: {
      title: "Notes about the file",
      "missing-feed": "Some moves have no feed rate (F), so their time is not counted.",
      "arc-without-centre": "An arc without a centre (I/J or R) is drawn straight to its end point.",
      "arc-radius-too-small": "An arc's radius cannot reach from its start to its end, so it is drawn straight.",
      "segments-capped": "The toolpath holds more than two million segments; the beginning is drawn.",
    },
  },
  board: {
    layers: "Layers",
    size: "Board size",
    fromOutline: "from the outline",
    fromLayers: "from the opened layers",
    flip: "Flip the board",
    flipOn: "From below",
    flipOff: "From above",
  },
  layers: {
    "copper-top": "Copper, top",
    "copper-bottom": "Copper, bottom",
    "copper-inner": "Inner copper",
    "mask-top": "Solder mask, top",
    "mask-bottom": "Solder mask, bottom",
    "silk-top": "Silkscreen, top",
    "silk-bottom": "Silkscreen, bottom",
    "paste-top": "Paste, top",
    "paste-bottom": "Paste, bottom",
    outline: "Board outline",
    drill: "Drill",
    other: "Other",
  },
  problems: {
    unreadable: "The file cannot be read.",
    "not-a-file": "That entry is not a file.",
    "too-large": "The file is larger than this viewer reads (32 MB for STL and G-code, 8 MB for a board layer).",
    "not-gerber": "This is not a Gerber or Excellon file that can be shown.",
    "not-in-this-session": "The file is from an earlier session; open it through the dialog.",
    "too-many-files": "More layers were chosen at once than one board holds (16).",
  },
  errors: {
    load: "The file was not opened. Try again.",
    read: "Reading the file failed. Open it again.",
  },
  view: {
    fit: "Fit to view",
  },
  recent: {
    title: "Recently opened files",
    empty: "No files opened yet.",
    caption: "Paths only, never the contents. The list is on this computer.",
    forget: "Forget the list",
  },
  settings: {
    caption: "The workshop keeps nothing of the files you open.",
  },
  units: {
    hour: "h",
    minute: "min",
    second: "s",
  },
};
