import { sr } from "./copy.sr.js";

/**
 * READER in English - the same shape as `copy.sr.ts`, checked by the compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error each.
 * The register is the app's own English: sentence case, informative, no
 * exclamation marks.
 */
export const en: typeof sr = {
  page: {
    subtitle: "A shelf of every installed book.",
    loading: "Loading…",
  },
  library: {
    title: "Shelf",
    emptyTitle: "No books yet",
    emptyBody:
      "The Reader reads content packs, and those are installed in Settings, on the Content packs card.",
    open: "Open",
    resume: "Continue",
    safety: "Safety notice",
    bookmarks: "Bookmarks",
    articles: "Articles",
    version: "Version",
  },
  toc: {
    title: "Contents",
    chapter: "Chapter",
  },
  reading: {
    back: "Shelf",
    previous: "Previous",
    next: "Next",
    bookmark: "Bookmark this article",
    removeBookmark: "Remove the bookmark",
    note: "Note beside the bookmark",
    saveNote: "Save the note",
    source: "Source",
    textSize: "Text size",
    sizeSmall: "Small",
    sizeMedium: "Medium",
    sizeLarge: "Large",
  },
  search: {
    label: "Search",
    inPack: "This book only",
    everywhere: "Every book",
    empty: "No hits.",
    hint: "Searches article titles and article text.",
    titles: "Titles",
    building: "Building the index",
    truncated: "Only the first hits are listed; add a word to narrow the search.",
  },
  print: {
    action: "Print",
    article: "This article",
    chapter: "This chapter",
    pack: "The whole book",
    paper: "Paper",
    cancelled: "The print job was cancelled.",
    refused: "This cannot be printed: one of the articles uses markup the Reader does not render.",
    failed: "The print job failed.",
  },
  notice: {
    title: "Before you start",
    accept: "I understand",
    close: "Close",
  },
  index: {
    building: "Preparing the book",
    failed: "This book's index was not built, so search cannot see it.",
  },
  errors: {
    load: "The library could not be loaded.",
    open: "This book could not be opened. Check that the pack is still installed.",
    article: "This article could not be shown.",
    mutate: "The change was not saved.",
  },
  widget: {
    empty: "No book is open.",
    loading: "Loading…",
    loadError: "The books could not be loaded.",
  },
};
