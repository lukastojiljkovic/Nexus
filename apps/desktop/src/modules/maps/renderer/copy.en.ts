import type { sr } from "./copy.sr.js";

/**
 * MAPS' copy in English: the same shape as `copy.sr.ts`, which is the source of
 * truth for it (ADR-090). A sentence left untranslated or a key invented is one
 * compile error each, and `check:english` fails on a Serbian word that survived
 * the translation.
 *
 * The place names on the map are not copy and are not here: they come from the
 * pack's own index, which carries each place in both scripts plus the `name:en`
 * the OpenStreetMap node states.
 */
export const en: typeof sr = {
  page: {
    subtitle: "A map of Serbia that works offline — search places, drop pins and measure a distance.",
    loading: "Loading the map…",
  },
  pack: {
    title: "The map pack is not installed yet",
    body: "Install the “map-serbia” pack on the “Content packs” card in Settings, then come back to this page.",
    styleTitle: "The map's style could not be read",
    styleBody: "The style file inside the pack cannot be read. Install the pack again from its folder.",
    networkBody: "The style inside the pack asks for an address on the internet, so the map was not drawn. The pack has been changed and should not be trusted.",
    placesBody: "The pack's place index could not be read, so search and place labels do not work.",
  },
  search: {
    label: "Search places",
    // English examples, and no Serbian letters among them: the mirror of the
    // Serbian table's own line. The English search still finds these places,
    // through each one's `name:en`.
    placeholder: "e.g. Belgrade, Subotica…",
    empty: "No place matches.",
    results: "Search results",
    loading: "Preparing the place index…",
  },
  tools: {
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    newPin: "New pin",
    here: "I am here",
    clearLocation: "Remove my position",
    measure: "Measure",
    stopMeasure: "Stop measuring",
    clearMeasure: "Clear the measurement",
    copy: "Copy coordinates",
    copied: "Copied.",
    copyFailed: "The copy failed.",
    pins: "Pin list",
    scale: "Scale",
  },
  pins: {
    title: "Pins",
    emptyTitle: "No pins",
    emptyBody: "A pin keeps a title, a note and a colour, and stays on the map. Drop the first one with “New pin”.",
    edit: "Edit",
    remove: "Remove",
    hide: "Hide the list",
    noteEmpty: "No note",
    measureHint: "Click the map to add a point to the measurement.",
    distance: "Distance",
  },
  dialog: {
    createTitle: "New pin",
    editTitle: "Edit pin",
    title: "Title",
    note: "Note",
    noteHint: "Optional, at most 2,000 characters.",
    color: "Colour",
    coordinates: "Coordinates",
    dms: "Degrees, minutes, seconds",
    atCentre: "The pin is placed at the centre of the map — move the map to the spot first.",
    save: "Save",
    cancel: "Cancel",
    titleRequired: "A title is required and may be at most 120 characters.",
    noteTooLong: "A note may be at most 2,000 characters.",
  },
  colors: {
    zlato: "Gold",
    bronza: "Bronze",
    maslina: "Olive",
    suma: "Forest",
    zad: "Jade",
    ruza: "Rose",
    bordo: "Bordeaux",
    grafit: "Graphite",
  },
  attribution: {
    credit: "© OpenStreetMap contributors",
    licence: "Data under the ODbL — https://www.openstreetmap.org/copyright",
    label: "Data source",
  },
  errors: {
    load: "The pins could not be loaded.",
    mutate: "The change was not saved.",
  },
};
