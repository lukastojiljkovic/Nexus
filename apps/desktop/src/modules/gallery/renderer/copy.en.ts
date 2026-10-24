import { sr } from "./copy.sr.js";

export const en: typeof sr = {
  page: {
    loading: "Loading the gallery…",
    subtitle: "Art from packs, images from references and your own pictures.",
  },
  actions: {
    import: "Add your images",
    scan: "Load images from Reference",
    cancel: "Cancel",
    close: "Close",
    delete: "Delete",
    edit: "Edit",
    save: "Save",
    scanMore: "Load more images",
    cancelScan: "Stop scanning",
  },
  filters: {
    search: "Search the gallery",
    source: "Source",
    all: "Every source",
    personal: "My images",
    art: "Art packs",
    zim: "References",
    tag: "Tag",
    allTags: "Every tag",
  },
  sources: {
    personal: "My image",
    art: "Art pack",
    zim: "Reference",
  },
  import: {
    title: "Title",
    notes: "Notes",
    tags: "Tags, separated by commas",
    failed: "The image was not imported.",
  },
  viewer: {
    credit: "Credit",
    licence: "Licence",
    dimensions: "Dimensions",
    notes: "Notes",
  },
  empty: {
    title: "The gallery is empty",
    body: "Add your own images, install an art pack or load images from a downloaded Reference library.",
    noResults: "No image matches the search and filters.",
  },
  errors: {
    load: "The gallery could not be loaded.",
    mutate: "The gallery change was not saved.",
    scan: "Images from the Reference library were not loaded.",
  },
  scan: {
    progress: "Scanning… {count} loaded",
    complete: "Every available image in this Reference library is loaded.",
    partial: "The first {count} are loaded. Choose “Load more images” to continue.",
  },
};
