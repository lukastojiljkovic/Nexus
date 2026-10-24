import { dictionaryKey } from "@nexus/core";

import { NLLB_PACK_IDS, TRANSLATOR_DIRECTION_CHOICES, type NllbPackId, type TranslatorDirectionChoice } from "../shared/ipc.js";
import { languageByCode } from "../shared/languages.js";

/**
 * TRANSLATOR's device preferences, on the `focusPrefs.ts` recipe: one
 * `localStorage` key each, a safe fallback for anything unrecognized, and no
 * IPC.
 *
 * **Why these are the machine's and not the profile's.** The module has no
 * migration and no table, and that is a decision rather than an omission: a
 * dictionary lookup writes nothing about anybody, the direction the page opens
 * on is how THIS machine is used, and the recent list is a convenience that
 * costs nothing when it is forgotten — which is the honest test `focusPrefs.ts`
 * states for a device preference. The list is keyed by profile anyway, because
 * two people sharing one computer should not read each other's last words, and
 * that costs one string.
 *
 * **What is validated here and what is not.** The stored values are read back
 * through the module's own closed vocabulary — the direction is one of the three
 * the contract declares, and the limit is a whole number in the panel's range —
 * so a hand-edited key, a half-written value or a value from a future build
 * lands on the default rather than reaching a control.
 */

/** How many recent lookups are kept by default, and the range the settings card offers. */
export const DEFAULT_RECENT_LIMIT = 8;
export const MIN_RECENT_LIMIT = 0;
export const MAX_RECENT_LIMIT = 20;

const DIRECTION_KEY = "nexus.translator.direction";
const RECENT_LIMIT_KEY = "nexus.translator.recent-limit";
const TRANSLATE_SOURCE_KEY = "nexus.translator.translate.source";
const TRANSLATE_TARGET_KEY = "nexus.translator.translate.target";
const TRANSLATE_MODEL_KEY = "nexus.translator.translate.model";
const TRANSLATE_SCRIPT_KEY = "nexus.translator.translate.script";

/** How many recently used languages each side of the translate page remembers. */
export const TRANSLATE_RECENT_LIMIT = 4;

/** The script the page shows Serbian output in, when the target is Serbian. */
export type SerbianScript = "latin" | "cyrillic";

/** One of the two language pickers on the translate page. */
export type LanguageSide = "source" | "target";

/** A stored NLLB code the table still carries, or `null` for anything else. */
function languageCodeOrNull(value: unknown): string | null {
  return typeof value === "string" && languageByCode(value) !== undefined ? value : null;
}

/** The source the translate page opens on: `auto`, or one NLLB code. */
export function readStoredTranslateSource(): string {
  const stored = localStorage.getItem(TRANSLATE_SOURCE_KEY);
  return stored === "auto" ? "auto" : (languageCodeOrNull(stored) ?? "auto");
}

export function persistTranslateSource(code: string): void {
  localStorage.setItem(TRANSLATE_SOURCE_KEY, code);
}

/** The target the page opens on; `fallback` is the page's own choice for the interface language. */
export function readStoredTranslateTarget(fallback: string): string {
  return languageCodeOrNull(localStorage.getItem(TRANSLATE_TARGET_KEY)) ?? fallback;
}

export function persistTranslateTarget(code: string): void {
  localStorage.setItem(TRANSLATE_TARGET_KEY, code);
}

/** The model the user last chose, or `null` when none was chosen (the page then takes the smallest installed). */
export function readStoredTranslateModel(): NllbPackId | null {
  const stored = localStorage.getItem(TRANSLATE_MODEL_KEY);
  return (NLLB_PACK_IDS as readonly string[]).includes(stored ?? "") ? (stored as NllbPackId) : null;
}

export function persistTranslateModel(id: NllbPackId): void {
  localStorage.setItem(TRANSLATE_MODEL_KEY, id);
}

export function readStoredSerbianScript(): SerbianScript {
  return localStorage.getItem(TRANSLATE_SCRIPT_KEY) === "cyrillic" ? "cyrillic" : "latin";
}

export function persistSerbianScript(script: SerbianScript): void {
  localStorage.setItem(TRANSLATE_SCRIPT_KEY, script);
}

/**
 * The languages one side of the translate page used last, newest first. Only
 * codes the table carries survive a read, each once.
 */
export function readRecentLanguages(side: LanguageSide): string[] {
  const stored = localStorage.getItem(recentLanguagesKey(side));
  if (stored === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const codes = parsed.map(languageCodeOrNull).filter((code): code is string => code !== null);
  return [...new Set(codes)].slice(0, TRANSLATE_RECENT_LIMIT);
}

export function persistRecentLanguages(side: LanguageSide, codes: readonly string[]): void {
  localStorage.setItem(recentLanguagesKey(side), JSON.stringify(codes.slice(0, TRANSLATE_RECENT_LIMIT)));
}

/** The recent list after one language is chosen: it moves to the front, and the list keeps its limit. */
export function withRecentLanguage(current: readonly string[], code: string): string[] {
  return [code, ...current.filter((each) => each !== code)].slice(0, TRANSLATE_RECENT_LIMIT);
}

function recentLanguagesKey(side: LanguageSide): string {
  return `nexus.translator.translate.recent.${side}`;
}

/** One profile's recent list on this machine. */
function recentKey(profileId: string): string {
  return `nexus.translator.recent.${profileId}`;
}

/**
 * The limit a typed value means, or `null` when it means nothing.
 *
 * Pure and total, so the settings card can refuse a half-typed number by name
 * and the page can read a stored one without a second reading of the rule. A
 * decimal, a negative number and a number past the range are all `null`: the
 * caller shows the refusal rather than storing a rounded guess.
 */
export function parseRecentLimit(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (value < MIN_RECENT_LIMIT || value > MAX_RECENT_LIMIT) return null;
  return value;
}

export function readStoredRecentLimit(): number {
  const stored = localStorage.getItem(RECENT_LIMIT_KEY);
  if (stored === null) return DEFAULT_RECENT_LIMIT;
  return parseRecentLimit(stored) ?? DEFAULT_RECENT_LIMIT;
}

/** Writes a limit the caller has already validated — the card's job is to refuse, not to re-refuse here. */
export function persistRecentLimit(limit: number): void {
  localStorage.setItem(RECENT_LIMIT_KEY, String(limit));
}

/** Which direction the page opens on: one of the switch's three positions, or `auto`. */
export function readStoredDirection(): TranslatorDirectionChoice {
  const stored = localStorage.getItem(DIRECTION_KEY);
  if (stored !== null && (TRANSLATOR_DIRECTION_CHOICES as readonly string[]).includes(stored)) {
    return stored as TranslatorDirectionChoice;
  }
  return "auto";
}

export function persistDirection(choice: TranslatorDirectionChoice): void {
  localStorage.setItem(DIRECTION_KEY, choice);
}

/**
 * The list after one lookup: the new word first, an older spelling of the SAME
 * word removed, and nothing past the limit.
 *
 * Deduplication is on the dictionary's own folded key rather than on the raw
 * text, so looking up `Kafa` after `kafa` — or the Cyrillic spelling after the
 * Latin one — moves the entry instead of adding a second copy of it. A limit of
 * zero answers nothing at all, which is what "do not keep recent words" means.
 */
export function withLookup(current: readonly string[], query: string, limit: number): string[] {
  const word = query.trim();
  if (word === "" || limit <= 0) return [...current].slice(0, Math.max(0, limit));
  const key = dictionaryKey(word);
  return [word, ...current.filter((entry) => dictionaryKey(entry) !== key)].slice(0, limit);
}

export function readRecent(profileId: string): string[] {
  const stored = localStorage.getItem(recentKey(profileId));
  if (stored === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

export function persistRecent(profileId: string, list: readonly string[]): void {
  localStorage.setItem(recentKey(profileId), JSON.stringify(list.slice(0, MAX_RECENT_LIMIT)));
}

/** Forgets one profile's recent list — the page's „Obriši listu". */
export function clearRecent(profileId: string): void {
  localStorage.removeItem(recentKey(profileId));
}

/**
 * Forgets the two keys the settings card owns — the „Vrati na podrazumevano"
 * link, which does NOT touch the per-profile recent lists: the cap is a
 * preference and the lists are what the user looked up, and clearing one is not
 * the other's job.
 */
export function clearStoredTranslatorPreferences(): void {
  localStorage.removeItem(DIRECTION_KEY);
  localStorage.removeItem(RECENT_LIMIT_KEY);
}
