/**
 * The parts every tool in this registry is assembled from: the bilingual
 * fragments, the locale-aware formatters, and the two result shapes.
 *
 * **A tool result is written in the user's language.** The model reads a result
 * and then answers a person in the language that person wrote in, so everything
 * this folder says is a `{ sr, en }` pair: what a write did, why a read matched
 * nothing, what went wrong, and the confirmation summary a user is shown before
 * anything changes. The two exceptions are named where they are defined — the
 * refusal sentence the brief fixes in English, and the reasons a STORE reports,
 * which are the app's own internal messages and are the same ones the IPC wire
 * carries.
 *
 * **An interpolated sentence still has to be a bilingual record.** A Serbian
 * sentence assembled in a template literal is not a `{ sr, en }` pair, and
 * `check:english` judges such a literal on its letters — so „Označi … kao
 * završen" outside a record would be a finding while „Napravi zadatak" would
 * not. That asymmetry is a trap, and `phrase`/`AssistantPhrase` below is the way
 * out of it: parameterised copy is declared as one record with an `sr` and an
 * `en` function, so the gate reads it as the bilingual declaration it is and
 * nothing here depends on which letters a sentence happens to use.
 *
 * **Punctuation belongs to the sentence, not to the value.** A Serbian date
 * already ends in a period („10. oktobar 2026."), so a sentence that appended
 * one would end „2026.." — which is why every result sentence is a phrase
 * record that owns its own final mark rather than a template with a `+ "."`.
 *
 * **Why a formatter of our own.** Main has no `intl.ts` — the renderer's is
 * part of the renderer's bundle and unreachable from here — so the two tags that
 * decide how October is spelled live in `INTL_TAGS` just below, and the handful
 * of shapes a tool result needs are built on them. Memoising per locale AND
 * options, and asking for a formatter at use time rather than at import, is
 * `intl.ts`'s arrangement restated in miniature: a language switch must not
 * leave a formatter built for the previous one.
 */

import type Database from "better-sqlite3-multiple-ciphers";
import type {
  AppLocation,
  AssistantLocale,
  AssistantText,
  Citation,
  ToolContext,
  ToolEffect,
  ToolResult,
} from "@nexus/core";

/**
 * How a tool reaches a profile's database: the same shape `main/index.ts` hands
 * every store (`new TaskStore(db.raw, profileId)`) and the same one the module
 * kit's `ModuleCall.profileDb` exposes.
 *
 * The handle is the session's own open connection, never a second one — a tool
 * is not a place that may open a database of its own, and a store built on this
 * handle sees exactly the profile rows the rest of main sees.
 */
export interface ProfileDb {
  <T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
}

/**
 * The BCP-47 tags each locale is served under, most preferred first — the same
 * two lists `strings.ts`'s `INTL_TAGS` holds for the renderer.
 *
 * `sr-Latn` leads deliberately: plain `"sr"` resolves to the Cyrillic tailoring,
 * so a formatter built on it would print „12. октобар 2026." over a Latin
 * interface. This app's Serbian is Latin, with the diacritics that distinguish
 * it from Croatian.
 */
const INTL_TAGS: Record<AssistantLocale, readonly string[]> = {
  sr: ["sr-Latn", "sr"],
  en: ["en-GB", "en"],
};

/** A key for one locale + one options object, with the keys sorted so the same options written in another order share one formatter. */
function cacheKey(locale: AssistantLocale, options: Intl.DateTimeFormatOptions): string {
  const record = options as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `${locale}|${keys.map((key) => `${key}=${String(record[key])}`).join(",")}`;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function dateTimeFormat(
  locale: AssistantLocale,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = cacheKey(locale, options);
  const cached = dateFormats.get(key);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat([...INTL_TAGS[locale]], options);
  dateFormats.set(key, created);
  return created;
}

function numberFormat(
  locale: AssistantLocale,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = cacheKey(locale, options);
  const cached = numberFormats.get(key);
  if (cached !== undefined) return cached;
  const created = new Intl.NumberFormat([...INTL_TAGS[locale]], options);
  numberFormats.set(key, created);
  return created;
}

/**
 * A bare calendar day (`YYYY-MM-DD`) as the app writes one — „12. oktobar
 * 2026." / "12 October 2026" — formatted in UTC, because `new Date("YYYY-MM-DD")`
 * is UTC midnight and formatting it in a negative-offset zone would name the day
 * before. The identical reading to the renderer's `formatDocumentDate`, since a
 * tool result and a document row must not disagree about a date.
 */
export function formatDay(locale: AssistantLocale, day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return dateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** The short form the confirmation summaries name a deadline with — „12. okt" / "12 Oct" — for a sentence that already says what the date IS. */
export function formatDayShort(locale: AssistantLocale, day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return dateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

/**
 * A bare day INSIDE a sentence, where the sentence supplies its own full stop.
 *
 * `Intl`'s Serbian pattern ends a standalone date with its own period („10.
 * oktobar 2026."), which is right on a row of its own and wrong the moment a
 * sentence continues: „…za 10. oktobar 2026.." is two full stops, and the copy
 * is hand-written here rather than generated, so nothing would catch it but a
 * reader. English has no such mark, so this only ever removes one.
 */
export function formatDayInSentence(locale: AssistantLocale, day: string): string {
  return formatDay(locale, day).replace(/\.$/, "");
}

/** The local wall-clock day of an epoch-millisecond instant — main's clock, read the way `clock.ts`'s `localToday()` reads it, from the local getters rather than from a UTC shift that misdates the last hours of a Belgrade evening. */
export function localDay(atMs: number): string {
  const now = new Date(atMs);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** A wall-clock time in the machine's own zone — „09:30" in both locales, which is what a clock face reads as. */
export function formatClock(locale: AssistantLocale, atMs: number): string {
  return dateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(atMs));
}

/**
 * A duration as a person says it: „10 min", „1 min 30 s", „45 s".
 *
 * Minutes and seconds only — this app's timers are bounded by
 * `MAX_TIMER_DURATION_SECONDS` (a day), where an hour field would be precision
 * nobody asked for. The units are the two international symbols both locales
 * already write, and the NUMBER goes through `Intl` so a Serbian sentence reads
 * „1.5" as „1,5".
 */
export function formatDuration(locale: AssistantLocale, seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${numberFormat(locale, {}).format(minutes)} min`);
  if (rest > 0 || parts.length === 0) {
    parts.push(`${numberFormat(locale, {}).format(rest)} s`);
  }
  return parts.join(" ");
}

/** A file size as the packs card writes one — „12,3 MB" / "12.3 MB", from `Intl` so the decimal mark is the locale's own. */
export function formatBytes(locale: AssistantLocale, bytes: number): string {
  return numberFormat(locale, {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: 1,
  }).format(bytes / 1_000_000);
}

/** The locale's half of a constant bilingual fragment. */
export function text(locale: AssistantLocale, copy: AssistantText): string {
  return copy[locale];
}

/**
 * Copy that needs arguments: the same sentence, in both languages, as a pair of
 * functions.
 *
 * The shape exists so parameterised copy can be a bilingual RECORD rather than a
 * ternary over two template literals — see this file's header for the trap that
 * avoids. `T` is the argument list both halves must share, so the two languages
 * cannot drift apart on how many things the sentence names.
 */
export interface AssistantPhrase<T extends readonly unknown[]> {
  readonly sr: (...args: T) => string;
  readonly en: (...args: T) => string;
}

/** Builds one phrase in the active locale. */
export function phrase<T extends readonly unknown[]>(
  locale: AssistantLocale,
  copy: AssistantPhrase<T>,
  ...args: T
): string {
  return copy[locale](...args);
}

/** Cuts a long body to `maxChars`, saying so rather than ending mid-sentence as if that were the end. */
export function clampText(body: string, maxChars: number): { text: string; truncated: boolean } {
  if (body.length <= maxChars) return { text: body, truncated: false };
  return { text: body.slice(0, maxChars), truncated: true };
}

/** A successful result. `citations` and `navigateTo` are attached only when a tool has them, so no result carries an explicit `undefined` field. */
export function okResult(
  content: string,
  extra: {
    readonly citations?: readonly Citation[];
    readonly navigateTo?: AppLocation;
  } = {},
): ToolResult {
  const result: {
    ok: boolean;
    content: string;
    citations?: readonly Citation[];
    navigateTo?: AppLocation;
  } = { ok: true, content };
  if (extra.citations !== undefined) result.citations = extra.citations;
  if (extra.navigateTo !== undefined) result.navigateTo = extra.navigateTo;
  return result;
}

/** What a refusal or a bad argument is prefixed with, in both languages. */
const FAILED: AssistantPhrase<[reason: string]> = {
  sr: (reason) => `Neuspešno: ${reason}`,
  en: (reason) => `Failed: ${reason}`,
};

/** A failure the model reads: not an error the loop has to catch, just an answer saying nothing happened. */
export function failResult(locale: AssistantLocale, reason: string): ToolResult {
  return { ok: false, content: phrase(locale, FAILED, reason) };
}

/**
 * What the model reads when the user said no.
 *
 * The sentence is the one the assistant's own brief fixes for a refusal, and it
 * is deliberately not localized: one spelling is what makes a refusal
 * recognisable to every part that reads tool output, and a second one buys
 * nothing a model cannot already read.
 */
export const USER_DECLINED = "The user declined.";

/**
 * The refusal path every `write` and `network` tool shares: ask, and treat "no"
 * as an ordinary answer.
 *
 * The other half of the rule — that a refusal must change nothing — is why this
 * is called BEFORE any store is touched, and why every caller returns the
 * declined result immediately rather than continuing with a flag.
 */
export async function confirmOrDecline(
  context: ToolContext,
  tool: string,
  effect: Exclude<ToolEffect, "read">,
  summary: string,
): Promise<ToolResult | null> {
  const allowed = await context.confirm({ tool, summary, effect });
  return allowed ? null : { ok: false, content: USER_DECLINED };
}

/** The refusal of `check:zeroize`'s shape in reverse: a tool that ran after its turn was aborted would be a write nobody asked for any more. */
export function assertLive(context: ToolContext): void {
  if (context.signal.aborted) throw new Error("The turn was aborted.");
}

/** `main/ipcValidators.ts`'s refusals are worded for the IPC wire; a tool result repeats the reason without that context. */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Invalid IPC payload: /, "");
}

/**
 * Wraps one tool's body.
 *
 * A tool's `run` never throws: a bad argument (this folder's own readers, or
 * one of the shared validators) and a store's refusal both become `ok: false`
 * with the reason, which is what lets the model correct itself instead of
 * ending the turn with `tool-failed`. Everything the model is told here is data
 * it may act on; nothing in it is an instruction that came from user text.
 */
export function guard(
  context: ToolContext,
  run: () => ToolResult | Promise<ToolResult>,
): Promise<ToolResult> {
  return Promise.resolve()
    .then(run)
    .catch((error: unknown) => failResult(context.locale, reasonOf(error)));
}

