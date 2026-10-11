import type { sr } from "./copy.sr.js";

/**
 * The wiki page's English copy. Typed by `copy.sr.ts`, so a missing key, an
 * invented one or a nested table that does not match is one compile error each —
 * and `check:english` refuses a Serbian word left behind in this table.
 */
export const en: typeof sr = {
  page: {
    subtitle: "Wikipedia, dictionaries and reference works from this computer, without the internet.",
    loading: "Loading libraries…",
  },
  errors: {
    load: "The libraries cannot be read right now. Try again.",
    mutate: "The change was not saved. Try again.",
    search: "Search is not available right now.",
  },
  library: {
    title: "Libraries",
    emptyTitle: "No libraries yet",
    emptyBody:
      "Add a ZIM file that is already on this computer, or download an edition from the Kiwix catalogue.",
    add: "Add a ZIM file",
    open: "Open",
    remove: "Remove",
    checksum: "Verified download",
    unverified: "Unverified file",
    missing: "The file is not where it was",
    missingHint: "The file was deleted or moved. Remove the library from the list.",
  },
  catalogue: {
    title: "Kiwix catalogue",
    caption:
      "A download starts only when you start it, one file at a time. What arrives is verified and stays on this computer.",
    load: "Load the catalogue",
    loading: "Loading the catalogue…",
    download: "Download",
    cancel: "Cancel",
    size: "Size",
    published: "Published",
    running: "Downloading",
    paused: "The download is paused",
    done: "Downloaded",
    failed: "The download did not finish",
    empty: "The catalogue offers none of the editions in this list.",
    licence: "Licence",
  },
  article: {
    title: "Page",
    bookmark: "Keep",
    bookmarked: "Kept",
    close: "Close",
    unverifiedHint:
      "This file did not come through Nexus, so it is shown as unverified and only ever read.",
    notHtml: "This address is not a page Nexus renders in the frame.",
  },
  search: {
    title: "Title search",
    label: "Beginning of the title",
    hint: "The search runs over the titles inside the chosen library, as you type.",
    noLibrary: "Choose a library (the Open button) so that the search has somewhere to look.",
    empty: "No titles begin with those letters.",
    fullText: "Full-text search is not available: the index in the pack needs Xapian.",
  },
  history: {
    title: "Reading history",
    empty: "No pages read yet.",
    clear: "Clear the history",
  },
  bookmarks: {
    title: "Kept pages",
    empty: "No pages kept yet.",
    remove: "Remove",
  },
  problem: {
    mode: "Downloading works only in the Downloads network mode. Change the mode in Settings.",
    network: "Kiwix cannot be reached. Check the connection and try again.",
    catalogue: "The catalogue does not have this edition.",
    "no-space": "There is not enough space on the disk for this edition.",
    download: "The download did not finish. Try again.",
    import: "This file is not a ZIM that Nexus can open.",
    busy: "This edition is already downloading.",
    "not-found": "That page was not found in the library.",
    cancelled: "The download was cancelled.",
  },
  widget: {
    empty: "No pages read yet.",
    loading: "Loading…",
    loadError: "The history cannot be read right now.",
  },
};
