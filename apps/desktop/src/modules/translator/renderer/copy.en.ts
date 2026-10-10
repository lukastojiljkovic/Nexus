import { sr } from "./copy.sr.js";

/**
 * TRANSLATOR in English — the same shape as `copy.sr.ts`, checked by the
 * compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error
 * each, so this file cannot drift from the Serbian table the way a second
 * hand-kept table would.
 *
 * The placeholder is typed in English (`coffee, kafa, hvala`) rather than with
 * Serbian letters: the example is a word somebody might look up, and the English
 * half of this module's copy is checked for Serbian script by `check:english` —
 * an example word with a `ć` in it would be a finding nobody could act on.
 */
export const en: typeof sr = {
  page: {
    subtitle: "A Serbian–English dictionary and travel phrases — they work offline.",
    loading: "Loading…",
  },
  search: {
    label: "Look up a word",
    placeholder: "coffee, kafa, hvala…",
    hint: "Type as you go. The word itself comes first, then the words that start the same way.",
    directionLabel: "Direction",
    directions: {
      auto: "Automatic",
      "en-sr": "English → Serbian",
      "sr-en": "Serbian → English",
    },
    autoResolved: "The direction chosen automatically was",
    hits: "{count} results",
    hitOne: "1 result",
    noHits: "No word in the dictionary answers “{query}”.",
    noHitsHint: "Check the spelling, or switch the direction.",
    truncated: "The first results are shown. A more precise query gives fewer of them.",
    exactTitle: "Exact match",
    prefixTitle: "Words that start the same way",
  },
  entry: {
    translations: "Translations",
    meanings: "Meanings",
    source: "Source",
    copyWord: "Copy the entry",
    copyUrl: "Copy the address",
    copied: "Copied.",
    copyFailed: "The copy did not go through.",
  },
  recent: {
    title: "Recent",
    empty: "No recent lookups yet.",
    clear: "Clear the list",
    again: "Look it up again",
  },
  phrases: {
    title: "Travel phrases",
    caption: "From Wikivoyage — phrases by topic, in Serbian and English.",
    loading: "Loading the phrases…",
    empty: "This pack carries no phrases.",
    topicHits: "{count} phrases",
  },
  sentences: {
    title: "Sentences",
  },
  notInstalled: {
    title: "The dictionary is not installed yet",
    body: "This module reads a dictionary pack from this computer. Install it in Settings, on the “Content packs” card, and come back to this page.",
  },
  errors: {
    load: "The pack's state could not be read.",
    search: "The search did not go through.",
    phrases: "The phrases could not be read.",
  },
  pack: {
    title: "Pack",
    words: "{count} words in the pack",
    phrases: "{count} phrases",
    version: "version {version}",
  },
  settings: {
    caption: "The direction the dictionary opens on, and how many recent words it keeps — on this computer.",
    directionHint: "Automatic reads the query's letters, and then looks in whichever index has a result.",
    recentHint: "How many of the last lookups are kept on this computer, from 0 to 20.",
    recentInvalid: "Type a number from 0 to 20.",
    saved: "Saved.",
    reset: "Restore defaults",
  },
};
