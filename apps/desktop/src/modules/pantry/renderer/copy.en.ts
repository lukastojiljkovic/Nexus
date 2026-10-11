import { sr } from "./copy.sr.js";

/**
 * PANTRY in English — the same shape as `copy.sr.ts`, checked by the compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error
 * each, so this file cannot drift from the Serbian table the way a second
 * hand-kept table would. The register is the app's own English: sentence case,
 * informative, no exclamation marks.
 *
 * A counted sentence keeps its `{count} {unit}` slots and may MOVE them: the
 * "ago" in «Expired 2 days ago» has no Serbian counterpart to sit beside, which
 * is exactly why the template is filled rather than concatenated.
 */
export const en: typeof sr = {
  page: {
    subtitle: "What is in the house, what runs out, and what expires.",
    loading: "Loading…",
  },
  common: {
    day: "day",
    days: "days",
    save: "Save",
    cancel: "Cancel",
    remove: "Delete",
    edit: "Edit",
  },
  units: {
    pcs: "pcs",
    g: "g",
    kg: "kg",
    ml: "ml",
    l: "l",
    pack: "pack",
  },
  categories: {
    food: "Food",
    medicine: "Medicine",
    hygiene: "Hygiene",
    emergency: "Emergency",
    other: "Other",
  },
  expiring: {
    title: "Expiring",
    caption: "Within the next {count} {unit}.",
    empty: "Nothing expires soon.",
    today: "Expires today",
    soon: "Expires in {count} {unit}",
    past: "Expired {count} {unit} ago",
    ok: "In date",
    none: "No date",
    openedSource: "from opening",
  },
  stock: {
    title: "Stock",
    add: "Add an item",
    emptyTitle: "The pantry is empty",
    emptyBody:
      "Write down what is in the house — a name, a quantity and where it sits — and the pantry will track what runs out and what expires.",
    showArchived: "Show archived too",
    hideArchived: "Hide archived",
    archived: "Archived",
    archive: "Archive",
    unarchive: "Put back",
    unassigned: "No location",
    decrease: "Decrease by one",
    increase: "Increase by one",
    low: "Short by {count} {unit}",
    discard: "Thrown away",
  },
  form: {
    newTitle: "New item",
    editTitle: "Edit item",
    name: "Name",
    category: "Kind",
    quantity: "Quantity",
    unit: "Unit",
    location: "Location",
    locationNone: "No location",
    minQuantity: "Minimum quantity",
    minQuantityHint: "Below this the item goes onto the shopping list by itself.",
    expiry: "Expiry date",
    opened: "Opened on",
    useWithin: "Use within (days after opening)",
    notes: "Note",
    barcode: "Barcode",
    doseNote: "How it is taken",
    doseNoteHint: "Free text from the box — the pantry keeps it and computes nothing from it.",
  },
  locations: {
    title: "Locations",
    name: "Location name",
    add: "Add a location",
    rename: "Rename",
    up: "Move up",
    down: "Move down",
    empty: "No locations yet. Fridge, pantry, first-aid box — where things sit.",
  },
  shopping: {
    title: "Shopping list",
    auto: "These put themselves on the list — their quantity is below the minimum.",
    manual: "Added by hand",
    empty: "The list is empty — nothing is missing.",
    add: "Add to the list",
    name: "What to buy",
    quantity: "Quantity",
    unit: "Unit",
    link: "Link to an item",
    linkNone: "No link",
    tick: "Bought",
    tickHint: "Ticking a line linked to an item adds the quantity back into stock.",
    removeLine: "Take off the list",
    unassigned: "No location",
    needed: "Short by {count} {unit}",
  },
  settings: {
    caption: "The window for “expires soon” — for the page and for the reminder alike.",
    hint: "The reminder arrives at most once a day, and only when something really is expiring.",
    saved: "Saved.",
    loadError: "The setting could not be loaded.",
    saveError: "The setting was not saved.",
  },
  widget: {
    empty: "Nothing expires soon.",
    loading: "Loading…",
    loadError: "The pantry could not be loaded.",
  },
  errors: {
    load: "The pantry could not be loaded.",
    mutate: "The change was not saved.",
    name: "A name is required and may be at most 80 characters.",
    quantity: "A quantity must be a number above zero.",
    barcode: "A barcode is 8, 12, 13 or 14 digits, with nothing around them.",
    location: "A location name is required and may be at most 60 characters.",
    locationInUse: "This location still holds items — move them, then remove it.",
    days: "The number of days must be between 1 and 3650.",
  },
};
