/**
 * Natural-language due dates for the TASK quick-add line (ADR-027). Pure and
 * platform-free: `parseQuickAddDate` takes the title the user is typing and the
 * day "today" is, and reports the LAST date phrase it recognises together with
 * the title stripped of that phrase. Tasks carry bare `YYYY-MM-DD` due dates,
 * so this parser resolves DATES ONLY — it never reads or invents a time.
 *
 * The grammar is deliberately CLOSED. A bounded grammar that either matches or
 * says nothing beats a clever one that silently guesses wrong: everything the
 * parser accepts is listed here, and anything else leaves the title alone.
 *
 * Serbian (case-insensitive, diacritic-insensitive — `sledeci`/`cetvrtak`
 * match, and Cyrillic folds onto the same forms):
 *   - `danas`, `sutra`, `prekosutra`
 *   - `u <weekday-accusative>` — u ponedeljak / u utorak / u sredu /
 *     u četvrtak / u petak / u subotu / u nedelju
 *   - `sledeći <weekday-accusative>` — also `sledećeg` / `sledeću` /
 *     `sledeće` (the feminine weekdays take `sledeću`, so restricting the
 *     adjective to one form would only match ungrammatical Serbian), and with
 *     an optional leading `u`, since "u sledeći petak" is how people write it
 *     and the bare form would otherwise leave a dangling "u" in the title
 *   - `za N dana` (N a 1…3650 integer) and `za nedelju dana` (= 7)
 *   - `D.M`, `D.M.`, `D.M.YYYY` — day-first, the trailing-dot form being
 *     standard Serbian date writing
 *   - `D. <month-genitive>` (dot optional) — januara / februara / marta /
 *     aprila / maja / juna / jula / avgusta / septembra / oktobra / novembra /
 *     decembra
 *
 * English:
 *   - `today`, `tomorrow`
 *   - a bare weekday and `on <weekday>` — monday…sunday, or the 3-letter
 *     mon/tue/wed/thu/fri/sat/sun
 *   - `next <weekday>`
 *   - `in N days` / `in N day` (N a 1…3650 integer)
 *   - `<month> D` and `D <month>` — jan…dec (3-letter) or the full month name,
 *     D 1–31, with an optional st/nd/rd/th suffix
 *
 * Two rules keep the numeric forms from firing inside things that merely look
 * like dates. Every phrase must sit on word boundaries, so `sutra` inside
 * `sutrašnji` is not a match; and the pure-numeric form additionally refuses a
 * neighbouring `.`, which is what excludes `v1.2` and `1.2.3` while leaving
 * `1.2` to mean 1 February — day-first, as Serbian writes it.
 */

import { dayKeyToUtcMs, isValidDayKey, shiftDayKey } from "../calendar/calendarGrid.js";
import type { DayKey } from "../calendar/calendarGrid.js";
import { foldWithOffsets } from "../search/searchText.js";

export interface QuickAddDateMatch {
  /** The resolved bare date. */
  readonly date: DayKey;
  /** The matched phrase exactly as it appears in the input. */
  readonly phrase: string;
  /** The phrase's `[start, end)` span in the input. */
  readonly start: number;
  readonly end: number;
  /** The input with the phrase (and the whitespace it rode on) removed, trimmed and whitespace-collapsed at the seam. */
  readonly strippedTitle: string;
}

/** Furthest `za N dana` / `in N days` may reach — beyond it the phrase simply does not match, rather than overflowing into a nonsense year. */
export const MAX_RELATIVE_DAYS = 3650;

/** Explicit years are accepted only inside this range; anything else is a typo or a version number, not a date. */
const MIN_EXPLICIT_YEAR = 2000;
const MAX_EXPLICIT_YEAR = 2100;

/**
 * How many years forward a year-less date may look for its next real
 * occurrence. One would do for every day but 29 February, which needs to reach
 * the next leap year — and across a skipped century leap (2100) that gap runs
 * to seven years, so eight is the smallest span that never fails.
 */
const YEAR_SEARCH_SPAN = 8;

/** Longest real day per month, taken across all years — so 29 February survives to the leap-year search below while 30 February never does. */
const MAX_DAY_IN_MONTH: readonly number[] = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const RELATIVE_WORDS: Readonly<Record<string, number>> = {
  danas: 0,
  sutra: 1,
  prekosutra: 2,
  today: 0,
  tomorrow: 1,
};

/** Weekday accusatives, in `Date.getUTCDay()` terms (0 = Sunday). */
const SR_WEEKDAYS: Readonly<Record<string, number>> = {
  ponedeljak: 1,
  utorak: 2,
  sredu: 3,
  cetvrtak: 4,
  petak: 5,
  subotu: 6,
  nedelju: 0,
};

const EN_WEEKDAYS_FULL: Readonly<Record<string, number>> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

/**
 * The 3-letter forms are ONLY matched after an explicit `on `/`next ` — never
 * bare. Bare, several of them are ordinary words in the very languages this
 * parser serves: `sat` is Serbian for *hour* ("za sat vremena") and the
 * English past tense of *sit*, `sun` is the star, `wed` a verb. A quick-add
 * that turns "kupi sat" into a Saturday task is worse than one that asks for
 * three more letters.
 */
const EN_WEEKDAY_ABBR: Readonly<Record<string, number>> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 0,
};

const EN_WEEKDAYS: Readonly<Record<string, number>> = {
  ...EN_WEEKDAYS_FULL,
  ...EN_WEEKDAY_ABBR,
};

const SR_MONTHS: Readonly<Record<string, number>> = {
  januara: 1,
  februara: 2,
  marta: 3,
  aprila: 4,
  maja: 5,
  juna: 6,
  jula: 7,
  avgusta: 8,
  septembra: 9,
  oktobra: 10,
  novembra: 11,
  decembra: 12,
};

const EN_MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

// Boundary assertions live inside the patterns rather than being checked
// afterwards, so the regex engine BACKTRACKS through them: in "monday" the
// alternative `mon` is rejected by the trailing assertion and `monday` is tried
// in its place, instead of the whole candidate being thrown away.
const WORD_CLASS = "\\p{L}\\p{N}";
/** Word boundary — no letter or digit immediately before/after the phrase. */
const WORD_BEFORE = `(?<![${WORD_CLASS}])`;
const WORD_AFTER = `(?![${WORD_CLASS}])`;
/** Stricter boundary for phrases that begin/end in a bare number: a neighbouring `.` disqualifies them, which is what keeps `v1.2` and `1.2.3` out. */
const NUMBER_BEFORE = `(?<![${WORD_CLASS}.])`;
const NUMBER_AFTER = `(?![${WORD_CLASS}.])`;

/** Longest alternative first, so a shared prefix (`mon` in `monday`, `sep` in `september`) never shadows the longer word. */
function alternation(words: readonly string[]): string {
  return [...words].sort((a, b) => b.length - a.length).join("|");
}

const SR_WEEKDAY_ALT = alternation(Object.keys(SR_WEEKDAYS));
const EN_WEEKDAY_ALT = alternation(Object.keys(EN_WEEKDAYS));
const EN_WEEKDAY_FULL_ALT = alternation(Object.keys(EN_WEEKDAYS_FULL));
const SR_MONTH_ALT = alternation(Object.keys(SR_MONTHS));
const EN_MONTH_ALT = alternation(Object.keys(EN_MONTHS));

function lookup(table: Readonly<Record<string, number>>, key: string | undefined): number | null {
  if (key === undefined) return null;
  return table[key] ?? null;
}

function toInteger(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

/** The next occurrence of `dow`, counting today itself as occurrence zero; `weeksAhead` pushes it whole weeks further (`sledeći` / `next`). */
function resolveWeekday(today: DayKey, dow: number | null, weeksAhead: number): DayKey | null {
  if (dow === null) return null;
  const todayDow = new Date(dayKeyToUtcMs(today)).getUTCDay();
  return shiftDayKey(today, ((dow - todayDow + 7) % 7) + weeksAhead * 7);
}

function resolveOffset(today: DayKey, days: number | null): DayKey | null {
  if (days === null || days < 1 || days > MAX_RELATIVE_DAYS) return null;
  return shiftDayKey(today, days);
}

/**
 * A day/month pair, optionally with an explicit year. Without a year it means
 * the next time that day comes round: this year, or a later one once this
 * year's is already past (or, for 29 February, not a real day at all). An
 * impossible day is never coerced into a nearby real one — it just does not
 * match, and an earlier phrase in the input may still win.
 */
function resolveCalendarDate(
  today: DayKey,
  day: number | null,
  month: number | null,
  year: number | null,
): DayKey | null {
  if (day === null || month === null) return null;
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > (MAX_DAY_IN_MONTH[month - 1] ?? 0)) return null;

  const monthPart = String(month).padStart(2, "0");
  const dayPart = String(day).padStart(2, "0");

  if (year !== null) {
    if (year < MIN_EXPLICIT_YEAR || year > MAX_EXPLICIT_YEAR) return null;
    // A date the user dated themselves stands even if it is in the past.
    const key = `${year}-${monthPart}-${dayPart}`;
    return isValidDayKey(key) ? key : null;
  }

  const startYear = Number(today.slice(0, 4));
  for (let candidateYear = startYear; candidateYear <= startYear + YEAR_SEARCH_SPAN; candidateYear++) {
    const key = `${candidateYear}-${monthPart}-${dayPart}`;
    // Day keys are zero-padded ISO, so a lexical compare IS a date compare.
    if (isValidDayKey(key) && key >= today) return key;
  }
  return null;
}

interface PhraseMatcher {
  /** Matched against the FOLDED input, so every pattern is lower-case and diacritic-free. */
  readonly pattern: RegExp;
  /** Resolves one hit to a day, or null when the phrase is not a real date. */
  resolve(hit: RegExpMatchArray, today: DayKey): DayKey | null;
}

const MATCHERS: readonly PhraseMatcher[] = [
  {
    pattern: new RegExp(`${WORD_BEFORE}(${alternation(Object.keys(RELATIVE_WORDS))})${WORD_AFTER}`, "gu"),
    resolve: (hit, today) => {
      const days = lookup(RELATIVE_WORDS, hit[1]);
      return days === null ? null : shiftDayKey(today, days);
    },
  },
  {
    pattern: new RegExp(`${WORD_BEFORE}u\\s+(${SR_WEEKDAY_ALT})${WORD_AFTER}`, "gu"),
    resolve: (hit, today) => resolveWeekday(today, lookup(SR_WEEKDAYS, hit[1]), 0),
  },
  {
    pattern: new RegExp(
      `${WORD_BEFORE}(?:u\\s+)?sledec(?:eg|i|u|e)\\s+(${SR_WEEKDAY_ALT})${WORD_AFTER}`,
      "gu",
    ),
    resolve: (hit, today) => resolveWeekday(today, lookup(SR_WEEKDAYS, hit[1]), 1),
  },
  {
    // Bare (or `on`-prefixed) FULL names only; the 3-letter forms need the
    // explicit `on ` below — see `EN_WEEKDAY_ABBR`'s own comment for why.
    pattern: new RegExp(`${WORD_BEFORE}(?:on\\s+)?(${EN_WEEKDAY_FULL_ALT})${WORD_AFTER}`, "gu"),
    resolve: (hit, today) => resolveWeekday(today, lookup(EN_WEEKDAYS_FULL, hit[1]), 0),
  },
  {
    pattern: new RegExp(`${WORD_BEFORE}on\\s+(${EN_WEEKDAY_ALT})${WORD_AFTER}`, "gu"),
    resolve: (hit, today) => resolveWeekday(today, lookup(EN_WEEKDAYS, hit[1]), 0),
  },
  {
    pattern: new RegExp(`${WORD_BEFORE}next\\s+(${EN_WEEKDAY_ALT})${WORD_AFTER}`, "gu"),
    resolve: (hit, today) => resolveWeekday(today, lookup(EN_WEEKDAYS, hit[1]), 1),
  },
  {
    // `za nedelju dana` is the same phrase with the count spelled out — the
    // capture group is simply absent, which is what the 7 below stands for.
    pattern: new RegExp(`${WORD_BEFORE}za\\s+(?:(\\d{1,6})|nedelju)\\s+dana${WORD_AFTER}`, "gu"),
    resolve: (hit, today) => resolveOffset(today, hit[1] === undefined ? 7 : toInteger(hit[1])),
  },
  {
    pattern: new RegExp(`${WORD_BEFORE}in\\s+(\\d{1,6})\\s+days?${WORD_AFTER}`, "gu"),
    resolve: (hit, today) => resolveOffset(today, toInteger(hit[1])),
  },
  {
    // D.M / D.M. / D.M.YYYY, with an optional space after each dot.
    pattern: new RegExp(
      `${NUMBER_BEFORE}(\\d{1,2})\\. ?(\\d{1,2})(?:\\. ?(\\d{4})|\\.)?${NUMBER_AFTER}`,
      "gu",
    ),
    resolve: (hit, today) =>
      resolveCalendarDate(today, toInteger(hit[1]), toInteger(hit[2]), toInteger(hit[3])),
  },
  {
    pattern: new RegExp(
      `${NUMBER_BEFORE}(\\d{1,2})(?:\\. ?|\\s)(${SR_MONTH_ALT})${WORD_AFTER}`,
      "gu",
    ),
    resolve: (hit, today) =>
      resolveCalendarDate(today, toInteger(hit[1]), lookup(SR_MONTHS, hit[2]), null),
  },
  {
    pattern: new RegExp(
      `${WORD_BEFORE}(${EN_MONTH_ALT})\\.?\\s(\\d{1,2})(?:st|nd|rd|th)?${WORD_AFTER}`,
      "gu",
    ),
    resolve: (hit, today) =>
      resolveCalendarDate(today, toInteger(hit[2]), lookup(EN_MONTHS, hit[1]), null),
  },
  {
    pattern: new RegExp(
      `${NUMBER_BEFORE}(\\d{1,2})(?:st|nd|rd|th)?\\s(${EN_MONTH_ALT})${WORD_AFTER}`,
      "gu",
    ),
    resolve: (hit, today) =>
      resolveCalendarDate(today, toInteger(hit[1]), lookup(EN_MONTHS, hit[2]), null),
  },
];

interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly date: DayKey;
}

/**
 * The source index one past the character that produced `folded[foldedEnd - 1]`.
 * Folding can expand one character into several (đ → dj), so several folded
 * indices share a source offset; the end of the phrase is the first offset that
 * moves past that character.
 */
function sourceEndOf(offsets: readonly number[], foldedEnd: number, inputLength: number): number {
  const lastSource = offsets[foldedEnd - 1];
  for (let index = foldedEnd; index < offsets.length; index++) {
    const offset = offsets[index];
    if (offset !== undefined && offset !== lastSource) return offset;
  }
  return inputLength;
}

/** Drops the phrase together with the whitespace it rode on, leaving exactly one space at the seam. */
function stripPhrase(input: string, start: number, end: number): string {
  const before = input.slice(0, start).replace(/\s+$/u, "");
  const after = input.slice(end).replace(/^\s+/u, "");
  if (before.length === 0) return after.trim();
  if (after.length === 0) return before.trim();
  return `${before} ${after}`.trim();
}

/**
 * Scans `input` for the LAST date phrase (people append their date) and resolves
 * it against `today`. Null when nothing matches. Pure.
 *
 * Candidates from every form are collected first and the unreal ones dropped,
 * then a single left-to-right pass keeps the longest phrase at each position and
 * skips whatever overlaps it — so the surviving spans are disjoint and "the last
 * one wins" is unambiguous. That ordering is why `next monday` beats the bare
 * `monday` inside it, and why a rejected `30.2` cannot shadow a good phrase
 * beside it.
 *
 * @throws TypeError if `today` is not a real calendar day.
 */
export function parseQuickAddDate(input: string, today: DayKey): QuickAddDateMatch | null {
  if (!isValidDayKey(today)) throw new TypeError(`Invalid day key: "${today}"`);
  if (input.length === 0) return null;

  const { folded, offsets } = foldWithOffsets(input);
  const candidates: Candidate[] = [];
  for (const matcher of MATCHERS) {
    for (const hit of folded.matchAll(matcher.pattern)) {
      if (hit.index === undefined) continue;
      const date = matcher.resolve(hit, today);
      if (date === null) continue;
      candidates.push({ start: hit.index, end: hit.index + hit[0].length, date });
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  let winner: Candidate | null = null;
  let keptEnd = 0;
  for (const candidate of candidates) {
    if (candidate.start < keptEnd) continue;
    keptEnd = candidate.end;
    winner = candidate;
  }
  if (winner === null) return null;

  const start = offsets[winner.start] ?? 0;
  const end = sourceEndOf(offsets, winner.end, input.length);
  return {
    date: winner.date,
    phrase: input.slice(start, end),
    start,
    end,
    strippedTitle: stripPhrase(input, start, end),
  };
}
