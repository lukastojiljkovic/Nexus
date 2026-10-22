/**
 * The TRANSLATOR module through the assistant's eyes: the dictionary's words and
 * phrases, and the translation of a whole text, which the Translate tab shows.
 *
 * **Who answers what.** A word and a phrase are reads of the installed dictionary
 * pack, which main already holds (`modules/translator/main/dictionary.ts`), so
 * these tools call the same reader the page's channels call. A sentence is
 * translated by an NLLB model in main, for the page. `translator.translate` opens
 * the page with the text and the two languages, because the result is shown there
 * and the page owns the choices (model, script, recent languages); the assistant
 * cannot read the result.
 *
 * **Why a missing pack is an answer, not a failure.** The dictionary is an
 * optional pack, and "not installed yet" is a state the user can fix, so the word
 * and phrase tools say so and name where packs are installed.
 */

import { foldSearchText, type Tool } from "@nexus/core";
import type { DictionaryReader } from "../../../modules/translator/main/dictionary.js";
import {
  NLLB_PACK_IDS,
  TRANSLATOR_TEXT_MAX_CHARS,
  type TranslatorEntryView,
  type TranslatorTopicView,
} from "../../../modules/translator/shared/ipc.js";
import { languageFromTag } from "../../../modules/translator/shared/languages.js";
import { asArgs, asEnum, asOptionalCount, asOptionalText, asText } from "./args.js";
import type { PacksLookup } from "./packs.js";
import {
  assertLive,
  failResult,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
} from "./support.js";

export interface TranslatorToolDeps {
  readonly dictionary: DictionaryReader;
  readonly packs: PacksLookup;
}

/** The longest word or phrase a tool takes. A policy cap on a model's argument, far past any headword. */
const MAX_TERM_CHARS = 80;

/** How many entries or phrases a lookup answers with by default, and the most it may ask for. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const DIRECTION_CHOICES = ["auto", "en-sr", "sr-en"] as const;
/** The longest language a tool takes, as an NLLB code (eight characters) or a tag. A policy cap, like `MAX_TERM_CHARS`. */
const MAX_LANGUAGE_CHARS = 16;

const NOT_INSTALLED: { sr: string; en: string } = {
  sr: "Rečnik nije instaliran. Instaliraj paket dictionary-sr-en na kartici „Paketi sadržaja“ u Podešavanjima.",
  en: "The dictionary is not installed. Install the dictionary-sr-en pack on the “Content packs” card in Settings.",
};

const ENTRIES_HEADING: AssistantPhrase<[direction: string, count: number]> = {
  sr: (direction, count) => `Rečnik ${direction} (${count}):`,
  en: (direction, count) => `Dictionary ${direction} (${count}):`,
};

const NO_ENTRY: AssistantPhrase<[word: string]> = {
  sr: (word) => `Nema unosa za „${word}“.`,
  en: (word) => `No entry for “${word}”.`,
};

const ENTRIES_MORE: AssistantPhrase<[shown: number]> = {
  sr: (shown) => `Prikazano je prvih ${shown} unosa; ima ih još.`,
  en: (shown) => `Showing the first ${shown} entries; there are more.`,
};

const TOPICS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Teme fraza (${count}):`,
  en: (count) => `Phrase topics (${count}):`,
};

const NO_TOPICS: { sr: string; en: string } = {
  sr: "Rečnik nema tema fraza.",
  en: "The dictionary has no phrase topics.",
};

const TOPIC_NOT_FOUND: AssistantPhrase<[topic: string, known: string]> = {
  sr: (topic, known) => `Nema teme „${topic}“. Teme: ${known}.`,
  en: (topic, known) => `No topic “${topic}”. Topics: ${known}.`,
};

const NO_PHRASE: AssistantPhrase<[what: string]> = {
  sr: (what) => `Nema fraza za „${what}“.`,
  en: (what) => `No phrases for “${what}”.`,
};

const PHRASES_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Fraze (${count}):`,
  en: (count) => `Phrases (${count}):`,
};

const PHRASES_MORE: AssistantPhrase<[shown: number]> = {
  sr: (shown) => `Prikazano je prvih ${shown} fraza.`,
  en: (shown) => `Showing only the first ${shown} phrases.`,
};

const UNKNOWN_LANGUAGE: AssistantPhrase<[value: string]> = {
  sr: (value) =>
    `Jezik „${value}“ nije u tabeli jezika. Navedi NLLB kod (na primer srp_Cyrl) ili oznaku jezika (na primer sr).`,
  en: (value) =>
    `The language “${value}” is not in the language table. Give an NLLB code (for example srp_Cyrl) or a language tag (for example sr).`,
};

const SAME_LANGUAGE: AssistantPhrase<[code: string]> = {
  sr: (code) => `Izvorni i ciljni jezik su isti („${code}“).`,
  en: (code) => `The source and the target language are the same (“${code}”).`,
};

const NO_MODEL: { sr: string; en: string } = {
  sr: "Nijedan NLLB model nije instaliran. Instaliraj nllb-600m na kartici „Paketi sadržaja“.",
  en: "No NLLB model is installed. Install nllb-600m on the “Content packs” card.",
};

const OPENED: { sr: string; en: string } = {
  sr: "Otvoren je Prevodilac sa tim tekstom. Prevod se prikazuje na toj stranici i ne mogu da ga pročitam, pa ga ne prevodi sam.",
  en: "Opened the Translator page with that text. The translation appears on that page and I cannot read it, so do not translate the text yourself.",
};

export function translatorTools(deps: TranslatorToolDeps): readonly Tool[] {
  const lookup: Tool = {
    name: "translator.lookup",
    description: {
      sr: "Traži reč u srpsko-engleskom rečniku: značenje, vrsta reči i prevodi. Koristi kad korisnik pita šta znači reč ili kako se kaže na engleskom ili srpskom.",
      en: "Looks a word up in the Serbian–English dictionary: meaning, part of speech and translations. Use it when the user asks what a word means or how to say it in English or Serbian.",
    },
    parameters: {
      type: "object",
      properties: {
        word: { type: "string", minLength: 1, maxLength: MAX_TERM_CHARS },
        direction: { type: "string", enum: [...DIRECTION_CHOICES] },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["word"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const word = asText(args["word"], "word", MAX_TERM_CHARS);
        const direction = asEnum(args["direction"] ?? "auto", "direction", DIRECTION_CHOICES);
        const limit = asOptionalCount(args["limit"], "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
        if (!deps.dictionary.status().installed) return okResult(text(context.locale, NOT_INSTALLED));

        const found = deps.dictionary.search(direction, word, limit);
        const total = found.exact.length + found.prefix.length;
        if (total === 0) return okResult(phrase(context.locale, NO_ENTRY, word));
        const entries = [...found.exact, ...found.prefix];
        return okResult(
          [
            phrase(context.locale, ENTRIES_HEADING, found.direction, total),
            ...entries.map((entry) => entryLine(entry)),
            ...(found.truncated ? [phrase(context.locale, ENTRIES_MORE, total)] : []),
          ].join("\n"),
        );
      }),
  };

  const phrases: Tool = {
    name: "translator.phrases",
    description: {
      sr: "Čita gotove fraze iz rečnika: izlistava teme, fraze jedne teme ili fraze koje sadrže reč. Koristi kad korisnik traži gotov izraz za neku situaciju.",
      en: "Reads the phrasebook: lists its topics, the phrases of one topic, or the phrases that contain a word. Use it when the user wants a ready phrase for a situation.",
    },
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", minLength: 1, maxLength: MAX_TERM_CHARS },
        query: { type: "string", minLength: 1, maxLength: MAX_TERM_CHARS },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const topic = asOptionalText(args["topic"], "topic", MAX_TERM_CHARS);
        const query = asOptionalText(args["query"], "query", MAX_TERM_CHARS);
        const limit = asOptionalCount(args["limit"], "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
        if (!deps.dictionary.status().installed) return okResult(text(context.locale, NOT_INSTALLED));

        const topics = deps.dictionary.phrases().topics;
        if (topics.length === 0) return okResult(text(context.locale, NO_TOPICS));
        if (topic === undefined && query === undefined) {
          return okResult(
            [
              phrase(context.locale, TOPICS_HEADING, topics.length),
              ...topics.map((each) => `- ${each.id} ${each.title} (${each.phrases.length})`),
            ].join("\n"),
          );
        }
        const scope = topic === undefined ? topics : topicsNamed(topics, topic);
        if (scope.length === 0) {
          return failResult(
            context.locale,
            phrase(
              context.locale,
              TOPIC_NOT_FOUND,
              topic ?? "",
              topics.map((each) => each.title).join(", "),
            ),
          );
        }

        const folded = query === undefined ? null : foldSearchText(query);
        const found = scope.flatMap((each) =>
          each.phrases
            .filter((line) => folded === null || foldSearchText(`${line.en} ${line.sr}`).includes(folded))
            .map((line) => ({ title: each.title, en: line.en, sr: line.sr })),
        );
        if (found.length === 0) {
          return okResult(phrase(context.locale, NO_PHRASE, query ?? topic ?? ""));
        }
        const shown = found.slice(0, limit);
        return okResult(
          [
            phrase(context.locale, PHRASES_HEADING, found.length),
            ...shown.map((line) => `- ${line.title}: ${line.en} — ${line.sr}`),
            ...(found.length > shown.length ? [phrase(context.locale, PHRASES_MORE, shown.length)] : []),
          ].join("\n"),
        );
      }),
  };

  const translate: Tool = {
    name: "translator.translate",
    description: {
      sr: "Prevodi rečenice i pasuse, ne pojedinačne reči. Otvara Prevodilac sa tekstom; prevod se prikazuje na toj stranici, a asistent ga ne vidi. Koristi kad korisnik traži prevod celog teksta. Jezik je NLLB kod (na primer srp_Cyrl) ili oznaka jezika (na primer sr, zh-Hant); from može biti i auto.",
      en: "Translates sentences and paragraphs, not single words. Opens the Translator page with the text; the translation appears there and the assistant cannot read it. Use it when the user asks to translate a whole text. A language is an NLLB code (for example srp_Cyrl) or a language tag (for example sr, zh-Hant); from may also be auto.",
    },
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1, maxLength: TRANSLATOR_TEXT_MAX_CHARS },
        from: { type: "string", minLength: 1, maxLength: MAX_LANGUAGE_CHARS },
        to: { type: "string", minLength: 1, maxLength: MAX_LANGUAGE_CHARS },
      },
      required: ["text", "to"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const body = asText(args["text"], "text", TRANSLATOR_TEXT_MAX_CHARS);
        const from = asOptionalText(args["from"], "from", MAX_LANGUAGE_CHARS) ?? "auto";
        const to = asText(args["to"], "to", MAX_LANGUAGE_CHARS);

        // `null` is detection; `undefined` is a language the table does not carry.
        const source = from === "auto" ? null : languageFromTag(from);
        if (source === undefined) return failResult(context.locale, phrase(context.locale, UNKNOWN_LANGUAGE, from));
        const target = languageFromTag(to);
        if (target === undefined) return failResult(context.locale, phrase(context.locale, UNKNOWN_LANGUAGE, to));
        if (source?.code === target.code) {
          return failResult(context.locale, phrase(context.locale, SAME_LANGUAGE, target.code));
        }

        const installed = new Set((await deps.packs.list()).map((pack) => pack.id));
        if (!NLLB_PACK_IDS.some((id) => installed.has(id))) {
          return failResult(context.locale, text(context.locale, NO_MODEL));
        }
        return okResult(text(context.locale, OPENED), {
          navigateTo: {
            module: "translator",
            action: {
              name: "translate",
              payload: { text: body, from: source?.code ?? "auto", to: target.code },
            },
          },
        });
      }),
  };

  return [lookup, phrases, translate];
}

/** The topics a name refers to: an id or a title, compared ignoring case and diacritics. */
function topicsNamed(topics: readonly TranslatorTopicView[], name: string): readonly TranslatorTopicView[] {
  const folded = foldSearchText(name);
  return topics.filter((each) => each.id === name || foldSearchText(each.title) === folded);
}

/** One entry as a line the model reads: the headword, its part of speech, its meanings and translations, and where it came from. */
function entryLine(entry: TranslatorEntryView): string {
  const word = entry.latin === null ? entry.word : `${entry.word} (${entry.latin})`;
  const pos = entry.pos === "" ? "" : ` [${entry.pos}]`;
  const translations = entry.translations.length === 0 ? "" : ` → ${entry.translations.join(", ")}`;
  return `- ${word}${pos}: ${entry.glosses.join("; ")}${translations} (${entry.url})`;
}
