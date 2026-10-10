import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * TRANSLATOR's contract (ADR-090): the channels it answers on, the payload each
 * one takes, and the API its page calls.
 *
 * **Why these three ops take no `profileId`.** Every other kit module's ops name
 * the profile whose rows they read, because its data is that profile's. This
 * module's data is a signed content pack on the machine (ADR-091) — the same
 * dictionary for every profile — and a lookup writes nothing anywhere, so a
 * profile id would be a field main validated and never used. The two things a
 * profile DOES own here are device preferences (the direction it opens on, the
 * recents list), and those live in the renderer's `localStorage` where they
 * belong, not on the wire.
 *
 * **Why a read answers with the direction it actually searched.** The switch has
 * an `auto` position, and "auto" is main's judgement — the script the query is
 * written in, and which index has a hit. A page that guessed the same thing
 * would be a second implementation of one rule, so the answer carries the
 * direction that was used and the page says so out loud.
 */

/** Which way a query is looked up. The wire's vocabulary, spelled once. */
export const TRANSLATOR_DIRECTIONS = ["en-sr", "sr-en"] as const;
export type TranslatorDirection = (typeof TRANSLATOR_DIRECTIONS)[number];

/** What the switch can be set to: one of the two directions, or let the dictionary decide. */
export const TRANSLATOR_DIRECTION_CHOICES = ["auto", "en-sr", "sr-en"] as const;
export type TranslatorDirectionChoice = (typeof TRANSLATOR_DIRECTION_CHOICES)[number];

/** One dictionary entry as it crosses the wire. */
export interface TranslatorEntryView {
  /** The headword as the source spelled it — Cyrillic stays Cyrillic, because that is what the source says. */
  readonly word: string;
  /** The Latin spelling when the headword is written in Cyrillic, else `null`. Serbian is digraphic, and the app's interface is Latin. */
  readonly latin: string | null;
  /** The part of speech the source gave it, verbatim (`noun`, `verb`, …), or `""` when it gave none. */
  readonly pos: string;
  /** The meanings: the English definitions for the sr-to-en direction, the one English gloss for en-to-sr. */
  readonly glosses: readonly string[];
  /** The Serbian words an English headword translates to; empty for the sr-to-en direction, where the glosses are the answer. */
  readonly translations: readonly string[];
  /** The Wiktionary page this entry came from — the attribution the CC BY-SA licence asks for. */
  readonly url: string;
}

/** What the pack on this machine is, or that there is none. */
export interface TranslatorStatusView {
  readonly installed: boolean;
  readonly version: string | null;
  readonly counts: TranslatorCountsView | null;
  readonly attribution: string;
  readonly licence: string;
}

/** The pack's own record of its size, shown so a reader knows what they installed. */
export interface TranslatorCountsView {
  readonly enKeys: number;
  readonly enEntries: number;
  readonly srKeys: number;
  readonly srEntries: number;
  readonly phrases: number;
  readonly topics: number;
}

/** One read of the dictionary. */
export interface TranslatorSearchView {
  /** The direction that was searched — what `auto` resolved to. */
  readonly direction: TranslatorDirection;
  /** What the caller asked for, so the page can show „Automatski (srpski → engleski)". */
  readonly requested: TranslatorDirectionChoice;
  /** The folded key that was looked up: what the index was actually asked for. */
  readonly key: string;
  /** Entries whose key IS the query — the word itself, shown first. */
  readonly exact: readonly TranslatorEntryView[];
  /** Entries whose keys start with the query, in key order, capped at the caller's limit. */
  readonly prefix: readonly TranslatorEntryView[];
  /** True when more prefix hits existed than the cap allowed. */
  readonly truncated: boolean;
}

/** One phrasebook topic, with the source's own heading as its title. */
export interface TranslatorTopicView {
  readonly id: string;
  readonly title: string;
  readonly phrases: readonly { readonly en: string; readonly sr: string }[];
}

export interface TranslatorPhrasesView {
  readonly topics: readonly TranslatorTopicView[];
}

/** One search: which way, what to look up, and how many neighbours to answer with. */
interface SearchPayload {
  direction: TranslatorDirectionChoice;
  query: string;
  limit: number;
}

type TranslatorOps = {
  status: { request: Record<string, never>; response: TranslatorStatusView };
  search: { request: SearchPayload; response: TranslatorSearchView };
  phrases: { request: Record<string, never>; response: TranslatorPhrasesView };
};

/** This module's renderer API: one method per op, named after the op. */
export type TranslatorApi = ModuleApiOf<TranslatorOps>;

/**
 * The contract the preload builds its bridge from and main refuses foreign ops
 * against. `contract` is the one name the kit's globs agree on.
 */
export const contract = defineModuleContract<"translator", TranslatorOps>("translator", [
  "status",
  "search",
  "phrases",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here, so
 * `window.nexus.modules.translator.search(…)` is typed in the page and in the
 * settings card without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    translator: TranslatorApi;
  }
}
