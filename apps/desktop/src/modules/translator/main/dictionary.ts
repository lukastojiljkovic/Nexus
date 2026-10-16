import { looksSerbian, matchDictionaryKeys, serbianLatin } from "@nexus/core";

import {
  type TranslatorDirection,
  type TranslatorDirectionChoice,
  type TranslatorEntryView,
  type TranslatorPhrasesView,
  type TranslatorSearchView,
  type TranslatorStatusView,
} from "../shared/ipc.js";
import {
  findInstalledPack,
  openPack,
  readPhrases,
  searchPack,
  type OpenDictionaryPack,
  type PackRecord,
} from "./pack.js";

/**
 * The dictionary's three reads, for the module's own IPC handlers and for the
 * assistant's tools: one reader, so a word looked up in the page and a word
 * looked up in a conversation are the same answer.
 */
export interface DictionaryReader {
  /** What is installed, without opening its indexes: what a status line needs. */
  status(): TranslatorStatusView;
  /** One lookup. A machine with no pack answers an empty search rather than failing. */
  search(choice: TranslatorDirectionChoice, query: string, limit: number): TranslatorSearchView;
  /** The phrasebook's topics, bounded; empty when no pack is installed. */
  phrases(): TranslatorPhrasesView;
}

/** Bounds on the phrasebook read out of the pack: a list longer than this is not one anybody reads. */
const MAX_TOPICS = 200;
const MAX_PHRASES_PER_TOPIC = 1000;

/**
 * A reader over the installed dictionary pack. `packsRoot` is asked on every
 * call, so an install made while the app runs is found by the next call.
 *
 * **Why the pack is opened once and held.** `keys.txt` and the two offset tables
 * are loaded when a direction is first searched (a few hundred kilobytes) and
 * the entry file stays open, so a keystroke is a binary search plus one `read`
 * per hit. An install renames a folder into place, so the version this reader
 * opened keeps working; a NEW launch reads whatever is installed then. The one
 * exception is a reader that found nothing: a missing pack is re-located on
 * every call, because "install the pack, come back to this page" must work
 * without restarting the app.
 *
 * Each caller builds its own reader, so two readers hold two open packs; the
 * cost is a pair of file handles, and it keeps this file free of any shared
 * module state.
 */
export function createDictionaryReader(packsRoot: () => string): DictionaryReader {
  /**
   * The pack this reader has opened, once.
   *
   * `undefined` means "not looked yet" and `null` means "there is none", and the
   * difference is what makes an install-in-the-background work: a negative
   * answer is looked for again on the next call, while a positive one is kept.
   */
  let open: OpenDictionaryPack | null | undefined;

  function pack(): OpenDictionaryPack | null {
    if (open !== undefined && open !== null) return open;
    const installed = findInstalledPack(packsRoot());
    if (installed === null) {
      open = null;
      return null;
    }
    open = openPack(installed);
    return open;
  }

  return {
    status() {
      const installed = findInstalledPack(packsRoot());
      if (installed === null) {
        return { installed: false, version: null, counts: null, attribution: "", licence: "" };
      }
      const counts = installed.about.counts;
      return {
        installed: true,
        version: installed.version,
        counts: {
          enKeys: counts.enKeys,
          enEntries: counts.enEntries,
          srKeys: counts.srKeys,
          srEntries: counts.srEntries,
          phrases: counts.phrases,
          topics: counts.topics,
        },
        attribution: installed.about.attribution,
        licence: installed.about.licence,
      };
    },

    search(requested, query, limit) {
      const dictionary = pack();
      if (dictionary === null) return emptySearch(requested);

      const direction = resolveDirection(dictionary, requested, query);
      const found = searchPack(dictionary, direction, query, limit);
      return {
        direction,
        requested,
        key: found.key,
        exact: found.entries.slice(0, found.exactCount).map(viewOf),
        prefix: found.entries.slice(found.exactCount).map(viewOf),
        truncated: found.truncated,
      };
    },

    phrases() {
      const dictionary = pack();
      if (dictionary === null) return { topics: [] };
      const topics = readPhrases(dictionary.dir)
        .slice(0, MAX_TOPICS)
        .map((topic) => ({
          id: topic.id,
          title: topic.title,
          phrases: topic.phrases.slice(0, MAX_PHRASES_PER_TOPIC),
        }));
      return { topics };
    },
  };
}

/** An answer for a machine with no pack: a well-formed empty view rather than an exception, because "not installed" is a state, not a failure. */
function emptySearch(requested: TranslatorDirectionChoice): TranslatorSearchView {
  return {
    direction: requested === "sr-en" ? "sr-en" : "en-sr",
    requested,
    key: "",
    exact: [],
    prefix: [],
    truncated: false,
  };
}

/**
 * Which way a query is looked up, when the switch says `auto`.
 *
 * Two questions, in this order, and the order is the whole rule:
 *
 * 1. **Is the query written in a script Serbian uses and English does not?** If
 *    it carries one of those letters the answer is Serbian, and no English
 *    headword could match anyway.
 * 2. **Otherwise, which index has it?** Most Serbian words typed on a Latin
 *    keyboard (`kafa`, `zdravo`, `hvala`) carry no Serbian letter, so the script
 *    cannot answer and the index does. English is tried first because the pack's
 *    first direction is en→sr and an English word is the ambiguous case a
 *    Serbian reader types most often; a word that exists in neither index falls
 *    to en→sr, which is the direction whose "not found" reads as the honest one.
 */
function resolveDirection(
  pack: OpenDictionaryPack,
  requested: TranslatorDirectionChoice,
  query: string,
): TranslatorDirection {
  if (requested !== "auto") return requested;
  if (looksSerbian(query)) return "sr-en";
  if (hasHits(pack.en.keys, query)) return "en-sr";
  if (hasHits(pack.sr.keys, query)) return "sr-en";
  return "en-sr";
}

/** Whether one index answers anything at all for a query — the cheapest question `matchDictionaryKeys` can be asked. */
function hasHits(keys: readonly string[], query: string): boolean {
  const match = matchDictionaryKeys(keys, query, 1);
  return match.exact !== -1 || match.prefixed.length > 0;
}

/**
 * One record as the page reads it.
 *
 * The Latin spelling is DERIVED rather than stored: `serbianLatin` transliterates
 * Cyrillic and leaves Latin text alone, so "the transliteration differs from the
 * word" is exactly "the word is written in Cyrillic" — one comparison instead of
 * a second field in every record and a second way for the pack's writer and the
 * reader to disagree.
 */
function viewOf(record: PackRecord): TranslatorEntryView {
  const latin = serbianLatin(record.word);
  return {
    word: record.word,
    latin: latin === record.word ? null : latin,
    pos: record.pos ?? "",
    glosses: record.glosses,
    translations: record.translations ?? [],
    url: record.url,
  };
}
