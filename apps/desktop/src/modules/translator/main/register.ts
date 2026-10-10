import { looksSerbian, matchDictionaryKeys, serbianLatin } from "@nexus/core";

import type { ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  TRANSLATOR_DIRECTION_CHOICES,
  contract,
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
import { installedPacksRoot } from "./packDir.js";

/**
 * TRANSLATOR in the main process (ADR-090): three reads over a content pack.
 *
 * **Why there is no store here.** The dictionary is not the user's data — it is
 * a signed pack on the machine (ADR-091), the same for every profile — and a
 * lookup writes nothing. So this module has no migration, no table and no
 * archive section: `exportData` is never registered, because a module with
 * nothing to say is omitted from `data/modules.ndjson` rather than written as an
 * empty object. The two things a profile owns (the direction the page opens on,
 * the recents list) are device preferences in the renderer's `localStorage`,
 * which is where a preference that changes no stored row belongs.
 *
 * **Why the pack is opened once and held.** `keys.txt` and the two offset tables
 * are loaded when a direction is first searched (a few hundred kilobytes) and
 * the entry file stays open, so a keystroke is a binary search plus one `read`
 * per hit. An install renames a folder into place, so the version this process
 * opened keeps working; a NEW launch reads whatever is installed then. The one
 * exception is a process that found nothing: a missing pack is re-located on
 * every call, because "install the pack, come back to this page" must work
 * without restarting the app.
 *
 * **Why `auto` is decided here.** "Which language is this query in" is a
 * judgement about the pack's two indexes, and the page would have to hold the
 * same indexes to make it. So the switch sends `auto` and main answers with the
 * direction it used, which the page shows — one implementation of one rule.
 */

/** How long a query may be. A cap on untrusted input, far past the longest headword in either language. */
const MAX_QUERY_CHARS = 80;

/** How many prefix neighbours one search answers with, and the ceiling a caller may ask for. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Bounds on the phrasebook read out of the pack: a list longer than this is not one anybody reads. */
const MAX_TOPICS = 200;
const MAX_PHRASES_PER_TOPIC = 1000;

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  /**
   * The pack this process has opened, once.
   *
   * `undefined` means "not looked yet" and `null` means "there is none", and the
   * difference is what makes an install-in-the-background work: a negative
   * answer is looked for again on the next call, while a positive one is kept
   * for the session.
   */
  let open: OpenDictionaryPack | null | undefined;

  function pack(): OpenDictionaryPack | null {
    if (open !== undefined && open !== null) return open;
    const installed = findInstalledPack(installedPacksRoot());
    if (installed === null) {
      open = null;
      return null;
    }
    open = openPack(installed);
    return open;
  }

  /** The installed pack without opening its indexes — what a status line needs. */
  function status(): TranslatorStatusView {
    const installed = findInstalledPack(installedPacksRoot());
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
  }

  ctx.handle("status", (payload, call) => {
    // The payload is empty by contract, and it is still validated: a channel
    // that accepted anything would accept a renderer's idea of a shape it was
    // never promised, which is the thing SEC-EL-02 asks every handler to refuse.
    call.as.asRecord(payload);
    return status();
  });

  ctx.handle("search", (payload, call) => {
    const record = call.as.asRecord(payload);
    const requested = directionChoice(record["direction"]);
    const query = call.as.asCappedChars(call.as.asString(record["query"], "query"), "query", MAX_QUERY_CHARS);
    const limit =
      record["limit"] === undefined
        ? DEFAULT_LIMIT
        : call.as.asBoundedInteger(record["limit"], "limit", 1, MAX_LIMIT);

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
    } satisfies TranslatorSearchView;
  });

  ctx.handle("phrases", (payload, call) => {
    call.as.asRecord(payload);
    const dictionary = pack();
    if (dictionary === null) return { topics: [] } satisfies TranslatorPhrasesView;
    const topics = readPhrases(dictionary.dir)
      .slice(0, MAX_TOPICS)
      .map((topic) => ({
        id: topic.id,
        title: topic.title,
        phrases: topic.phrases.slice(0, MAX_PHRASES_PER_TOPIC),
      }));
    return { topics } satisfies TranslatorPhrasesView;
  });
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

/** The switch's closed vocabulary, refused by name rather than defaulted. */
function directionChoice(value: unknown): TranslatorDirectionChoice {
  if (typeof value === "string" && (TRANSLATOR_DIRECTION_CHOICES as readonly string[]).includes(value)) {
    return value as TranslatorDirectionChoice;
  }
  throw new Error(
    `Invalid IPC payload: "direction" must be one of ${TRANSLATOR_DIRECTION_CHOICES.join(", ")}.`,
  );
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
