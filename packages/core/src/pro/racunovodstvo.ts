/**
 * „Računovodstvo i finansije" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains:
 * a maintainer asks „where does the gross-up live", and `pro/racunovodstvo.ts`
 * answers it where `pro/tax.ts` would not. A tool several packs share lives in
 * the file of the pack that owns it in the catalogue, so nobody relitigates
 * ownership per tool.
 *
 * **These are pure functions and they refuse rather than repair.** No dates from
 * the clock, no randomness, no locale, no I/O — a date is a parameter
 * (`CivilDate`), never `new Date()`. A surface owns its own state, formats
 * nothing here, and asks here for every number it prints.
 *
 * **Nothing here decides anything.** Not one rate, threshold, tax-depreciation
 * group or statutory interest rate is embedded, and none is offered as a
 * default: every one of them is a number a rule-maker sets and revises, so it is
 * an input and the answer is the user's own number. What is embedded is either
 * arithmetic (Benford's log10 expression, the divisibility-by-9 signature of a
 * transposition) or the shape of a thing rather than its value (18-digit account
 * layout, MOD 97-10, the Serbian numeral words) — and each of those carries its
 * source in the comment above it.
 *
 * **Money is counted in minor units wherever a sum has to close.** Allocation
 * and the trial balance add integers, not doubles, because „the parts must sum
 * to the whole" is the entire point of those two tools and 0.1 + 0.2 is not 0.3.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isKeyOf,
  isNonNegative,
  isPositive,
  quotient,
  roundHalfUp,
  type ProResult,
} from "./result.js";

import { annuityPlan } from "../tools/calculators.js";

/* ------------------------------------------------------------------ shared */

/** A date as three numbers, because a pure function may not read a clock. */
export interface CivilDate {
  readonly year: number;
  /** 1..12. January is 1, not 0 — this is not a `Date`. */
  readonly month: number;
  readonly day: number;
}

/** Gregorian leap year: divisible by 4, except centuries not divisible by 400. */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isValidDate(date: CivilDate): boolean {
  const { year, month, day } = date;
  if (!isIntegerIn(year, 1, 9999)) return false;
  if (!isIntegerIn(month, 1, 12)) return false;
  return isIntegerIn(day, 1, daysInMonth(year, month));
}

/**
 * Days since 1970-01-01, by the civil-from-days algorithm (Howard Hinnant).
 *
 * Written out rather than delegated to `Date` because `Date` is a clock and a
 * timezone: `new Date(2025, 0, 1)` is local midnight, and a period that spans a
 * DST boundary then differs by an hour, which after division by 24 is a day
 * count that changes with where the user lives.
 */
function daysFromCivil(date: CivilDate): number {
  const shifted = date.month <= 2 ? date.year - 1 : date.year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const marchMonth = (date.month + 9) % 12;
  const dayOfYear = Math.floor((153 * marchMonth + 2) / 5) + date.day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** 1 for 1 January, 365 (or 366) for 31 December. */
function dayOfYear(date: CivilDate): number {
  return daysFromCivil(date) - daysFromCivil({ year: date.year, month: 1, day: 1 }) + 1;
}

/**
 * a / b, or undefined when either side is MISSING — the one case `quotient`
 * itself does not take, since its two parameters are `number`, never
 * `number | undefined`. Once both are present, the actual guarded division —
 * refusing a non-finite or zero divisor, and a non-finite result — is
 * `quotient` itself, not a second copy of the same guard.
 */
function divide(numerator: number | undefined, divisor: number | undefined): number | undefined {
  if (numerator === undefined || divisor === undefined) return undefined;
  return quotient(numerator, divisor);
}

/* -------------------------------------------------- allocation-remainder */

/**
 * The most decimal places a typed key is scaled by before the Hamilton
 * arithmetic runs. Six covers every realistic key (a percentage, a share to
 * four decimals, a floor area to the square centimetre) while keeping the
 * scaled numerator well inside `Number.MAX_SAFE_INTEGER` for the totals this
 * tool is proven exact up to — see the note above `allocateWithoutRemainder`.
 */
const ALLOCATION_KEY_MAX_DECIMALS = 6;

/** By the keys the user typed, or into n equal parts (every key treated as 1). */
export type AllocationMode = "byKey" | "equal";

export interface AllocationItem {
  /** The item's own label, passed straight through — data, not copy. Needed so
   *  the +1 correction can be traced back to a named row rather than an index. */
  readonly name: string;
  /** Ignored in `"equal"` mode — see `AllocationInput.parts` for a split that
   *  needs no names at all. */
  readonly key: number;
}

export interface AllocationInput {
  /** The whole that must come back out. Any real number; a negative one allocates a credit. */
  readonly total: number;
  /**
   * One item per row, in input order — the order ties are broken by. Required
   * in `"byKey"` mode. In `"equal"` mode this is optional: give it named rows
   * to split, or omit it and give `parts` instead for an unnamed n-way split.
   */
  readonly items?: readonly AllocationItem[] | undefined;
  /**
   * `"equal"` mode only, and only when `items` is not given: split into
   * exactly this many equal, unnamed parts. Without this a surface offering
   * „split into n equal parts" had to fabricate n named rows just to call this
   * function. Ignored in `"byKey"` mode and ignored whenever `items` is given,
   * since the row count is then already the count the user typed.
   */
  readonly parts?: number | undefined;
  /** Minor units per unit: 2 for para, 0 for a whole-dinar allocation. */
  readonly decimals: number;
  readonly mode: AllocationMode;
}

export interface AllocationRow {
  readonly name: string;
  /** The weight actually used — the typed key, or 1 in equal mode. */
  readonly key: number;
  /** w_i/W — the KEY's share, before any money is touched. */
  readonly keySharePercent: number;
  /** The unrounded share, kept so the surface can show what the rounding cost. */
  readonly exact: number;
  readonly allocated: number;
  /**
   * allocated/T — a DIFFERENT number from `keySharePercent` once rounding
   * lands. Undefined when `total` is 0: every row's share is then a genuine
   * 0/0, not a computed zero, the same rule every other undefined ratio in
   * this file follows.
   */
  readonly allocatedSharePercent: number | undefined;
  /** allocated − exact: at most one minor unit, and it is where the cent went. */
  readonly rounding: number;
  /** Whether THIS row is one of the ones that took the +1 minor unit. */
  readonly bumped: boolean;
  /**
   * This row's rank in the remainder ordering (1 = took the leftover first),
   * among rows with a positive key. Undefined for a key of 0, which never
   * enters the remainder race at all.
   */
  readonly remainderRank: number | undefined;
}

export interface Allocation {
  readonly rows: readonly AllocationRow[];
  /** Equal to `total` ROUNDED to `decimals` first — see the note below on T_u. */
  readonly allocatedTotal: number;
  /** How many rows carry the +1 minor unit. */
  readonly adjustedCount: number;
}

/**
 * Split an amount by a key so the parts sum to the whole exactly — the largest
 * remainder (Hamilton) method, computed in whole minor units.
 *
 * **Rounding each share on its own is the bug this tool exists to prevent.**
 * 100.00 over seven equal keys is 14.285714…; seven times a rounded 14.29 is
 * 100.03, and the three cents are invented money. Here the floors are dealt
 * first and the leftover minor units go, one each, to the largest remainders —
 * so the sum is the input, always.
 *
 * **The base and the remainder are both integer arithmetic, never a fractional
 * part read off a float division.** `T_u·w_i` is computed once as an integer
 * numerator, and `div`/`mod` by `W` give the base and the remainder exactly;
 * ranking by that integer remainder is what makes a tie between equal keys a
 * property of the RULE rather than an artefact of which float happened to round
 * which way. Ties are then broken deterministically (larger key first, then
 * input order), because a tie is the normal case for equal parts.
 *
 * **`T_u = round(T·U)` can differ from what was typed**, when `total` carries
 * more precision than `decimals` allows — 100,005 at `decimals = 2` closes to
 * 100,01, not 100,005. `allocatedTotal` reports that closed figure explicitly
 * rather than silently allocating a sum nobody can reconcile against the raw
 * input, and every row's `allocated` sums to exactly it.
 *
 * **The keys are scaled to whole numbers FIRST, by one common power of ten**,
 * before any of the integer arithmetic above ever runs — a key of 33,33 is a
 * routine input (a floor share, a percentage, a square-metre count), and
 * `totalMinor · 33.33` is a PRODUCT OF A FLOAT, not the integer numerator the
 * method needs: in binary64 it lands a hair off a whole number (`100000 ×
 * 33.34` is `3334000.0000000005`) and the safe-integer guard below refused
 * every fractional key outright. Scaling every key by the smallest common
 * `10^d` (`d ≤ 6`) that turns them ALL into integers — the same `d` for every
 * key, or the ratio between them moves — makes `T_u·w_i` an exact product of
 * two safe integers, and the remainder that decides which rows take the
 * leftover minor unit an exact integer subtraction rather than a fractional
 * part read off a float. Keys that are already whole numbers (the common
 * case) need `d = 0`, so nothing about their arithmetic changes at all.
 */
export function allocateWithoutRemainder(input: AllocationInput): ProResult<Allocation> {
  const { total, decimals, mode } = input;
  if (!Number.isFinite(total)) return fail("total");
  if (!isIntegerIn(decimals, 0, 4)) return fail("decimals");

  // "byKey" always needs named rows with their own key. "equal" accepts named
  // rows too (their keys are ignored), or — with none given — a bare count.
  let items: readonly AllocationItem[];
  if (mode === "equal" && (input.items === undefined || input.items.length === 0)) {
    const parts = input.parts;
    if (parts === undefined || !isIntegerIn(parts, 1, 200)) return fail("parts");
    items = Array.from({ length: parts }, () => ({ name: "", key: 1 }));
  } else {
    if (input.items === undefined || !isIntegerIn(input.items.length, 1, 200)) {
      return fail("items");
    }
    items = input.items;
  }

  const weights = items.map((item) => (mode === "equal" ? 1 : item.key));
  if (weights.some((weight) => !isNonNegative(weight))) return fail("items");

  // The smallest d in 0..ALLOCATION_KEY_MAX_DECIMALS that turns THIS key into
  // an integer, found by trial rather than by reading `.toString()` apart —
  // robust to the exponential notation a very small key would print in.
  const decimalsNeededFor = (key: number): number => {
    for (let d = 0; d <= ALLOCATION_KEY_MAX_DECIMALS; d += 1) {
      const scaled = key * 10 ** d;
      const nudge = Math.max(Math.abs(scaled), 1) * 4 * Number.EPSILON;
      if (Math.abs(scaled - Math.round(scaled)) < nudge) return d;
    }
    return ALLOCATION_KEY_MAX_DECIMALS;
  };
  // ONE common scale for every key — scaling two keys by different powers of
  // ten would change the RATIO between them, which is the one thing this
  // method may never do. Integer keys (the common case, d = 0 for all of
  // them) get scale = 1 and this is a no-op: identical to every key this
  // function computed before fractional ones were accepted.
  const keyScale = 10 ** weights.reduce((max, weight) => Math.max(max, decimalsNeededFor(weight)), 0);
  const scaledWeights = weights.map((weight) => Math.round(weight * keyScale));
  if (scaledWeights.some((weight) => !Number.isSafeInteger(weight))) return fail("items");
  const weightSum = scaledWeights.reduce((sum, weight) => sum + weight, 0);
  if (!isPositive(weightSum)) return fail("items");

  const unit = 10 ** decimals;
  const sign = total < 0 ? -1 : 1;
  const totalMinor = roundHalfUp(Math.abs(total) * unit, 0);
  // Beyond 2^53 the integer arithmetic that makes the sum close stops being
  // exact, so the tool says so instead of quietly losing a minor unit.
  if (!Number.isSafeInteger(totalMinor)) return fail("total");

  const numerators = scaledWeights.map((weight) => totalMinor * weight);
  if (numerators.some((numerator) => !Number.isSafeInteger(numerator))) return fail("items");
  const bases = numerators.map((numerator) => Math.floor(numerator / weightSum));
  // rem_i = T_u·w_i − W·b_i, a subtraction of two safe integers — never the
  // fractional part of `numerator / weightSum`, which carries float rounding
  // that this method's fairness cannot afford.
  const remainders = numerators.map(
    (numerator, index) => numerator - weightSum * (bases[index] ?? 0),
  );
  const leftover = totalMinor - bases.reduce((sum, base) => sum + base, 0);

  const order = scaledWeights
    .map((weight, index) => ({ index, weight, remainder: remainders[index] ?? 0 }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index);
  const rankOf = new Map<number, number>();
  order.forEach((entry, rank) => rankOf.set(entry.index, rank + 1));
  const bumped = new Set<number>();
  for (let taken = 0; taken < leftover; taken += 1) {
    const entry = order[taken];
    if (entry === undefined) break;
    bumped.add(entry.index);
  }

  const rows = weights.map((weight, index) => {
    const isBumped = bumped.has(index);
    const scaledWeight = scaledWeights[index] ?? 0;
    const allocatedMinor = (bases[index] ?? 0) + (isBumped ? 1 : 0);
    const exact = (sign * (numerators[index] ?? 0)) / weightSum / unit;
    const allocated = (sign * allocatedMinor) / unit;
    return {
      name: items[index]?.name ?? "",
      key: weight,
      keySharePercent: (100 * scaledWeight) / weightSum,
      exact,
      allocated,
      allocatedSharePercent: totalMinor === 0 ? undefined : (100 * allocatedMinor) / totalMinor,
      rounding: allocated - exact,
      bumped: isBumped,
      remainderRank: scaledWeight > 0 ? rankOf.get(index) : undefined,
    };
  });

  return {
    ok: true,
    rows,
    allocatedTotal: (sign * totalMinor) / unit,
    adjustedCount: bumped.size,
  };
}

/* ------------------------------------------------------- amount-in-words */

/**
 * Serbian numeral words 0–19, the tens, and the hundreds.
 *
 * Source: Pravopis srpskoga jezika, Matica srpska, izmenjeno i dopunjeno izdanje
 * (2010). This is the lexical table of the language — 37 entries no rule-maker
 * revises — which is why it is embedded where a rate never would be.
 */
const UNIT_WORDS = [
  "nula",
  "jedan",
  "dva",
  "tri",
  "četiri",
  "pet",
  "šest",
  "sedam",
  "osam",
  "devet",
  "deset",
  "jedanaest",
  "dvanaest",
  "trinaest",
  "četrnaest",
  "petnaest",
  "šesnaest",
  "sedamnaest",
  "osamnaest",
  "devetnaest",
] as const;

const TEN_WORDS = [
  "",
  "",
  "dvadeset",
  "trideset",
  "četrdeset",
  "pedeset",
  "šezdeset",
  "sedamdeset",
  "osamdeset",
  "devedeset",
] as const;

const HUNDRED_WORDS = [
  "",
  "sto",
  "dvesta",
  "trista",
  "četiristo",
  "petsto",
  "šeststo",
  "sedamsto",
  "osamsto",
  "devetsto",
] as const;

/** 1 unit = 100 subunits — the subdivision every listed currency uses, like 1 m = 100 cm. */
const SUBUNITS_PER_UNIT = 100;

/**
 * 999.999.999.999,99 expressed in minor units: the largest amount `words` can
 * spell. The whole-unit table below stops at the milliard (10^9) group, but
 * 999 milliards + 999 millions + 999 thousands + 999 units is 999.999.999.999
 * exactly — the stated ceiling — so nothing above that is representable and
 * nothing needs a tenth (billion/bilion) group to reach it.
 */
const MAX_MINOR = 99_999_999_999_999;

export type NumberGender = "masculine" | "feminine" | "neuter";
type Gender = NumberGender;

/** Singular / paucal / plural, with the 11–14 exception that is the whole rule. */
type Agreement = "singular" | "paucal" | "plural";

function agreementOf(count: number): Agreement {
  const unit = count % 10;
  const lastTwo = count % 100;
  if (unit === 1 && lastTwo !== 11) return "singular";
  if (unit >= 2 && unit <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return "paucal";
  return "plural";
}

/** Only 1 and 2 inflect for gender; 11 and 12 are single words and do not. */
function unitWord(digit: number, gender: Gender): string {
  if (digit === 1) {
    if (gender === "feminine") return "jedna";
    if (gender === "neuter") return "jedno";
  }
  if (gender === "feminine" && digit === 2) return "dve";
  return UNIT_WORDS[digit] ?? "";
}

/** A group of 1..999 in words; the trailing unit takes `gender`. */
function groupWords(group: number, gender: Gender): string {
  const parts: string[] = [];
  const hundreds = Math.floor(group / 100);
  if (hundreds > 0) parts.push(HUNDRED_WORDS[hundreds] ?? "");
  const rest = group % 100;
  if (rest > 0 && rest < 20) {
    parts.push(unitWord(rest, gender));
  } else if (rest >= 20) {
    parts.push(TEN_WORDS[Math.floor(rest / 10)] ?? "");
    const unit = rest % 10;
    if (unit > 0) parts.push(unitWord(unit, gender));
  }
  return parts.join(" ");
}

/** „hiljada" is feminine; the nominative singular and the genitive plural coincide. */
function thousandWords(group: number): string {
  if (group === 1) return "hiljadu";
  const words = groupWords(group, "feminine");
  return agreementOf(group) === "paucal" ? `${words} hiljade` : `${words} hiljada`;
}

/** „milion" is masculine and has only two forms: singular and genitive. */
function millionWords(group: number): string {
  if (group === 1) return "milion";
  const noun = agreementOf(group) === "singular" ? "milion" : "miliona";
  return `${groupWords(group, "masculine")} ${noun}`;
}

function milliardWords(group: number): string {
  if (group === 1) return "milijarda";
  const words = groupWords(group, "feminine");
  const form = agreementOf(group);
  if (form === "singular") return `${words} milijarda`;
  if (form === "paucal") return `${words} milijarde`;
  return `${words} milijardi`;
}

/** A whole number below 10^12 in words; `gender` reaches only the units group. */
function numberWords(value: number, gender: Gender): string {
  if (value === 0) return "nula";
  const milliards = Math.floor(value / 1_000_000_000) % 1000;
  const millions = Math.floor(value / 1_000_000) % 1000;
  const thousands = Math.floor(value / 1000) % 1000;
  const units = value % 1000;
  const parts: string[] = [];
  if (milliards > 0) parts.push(milliardWords(milliards));
  if (millions > 0) parts.push(millionWords(millions));
  if (thousands > 0) parts.push(thousandWords(thousands));
  if (units > 0) parts.push(groupWords(units, gender));
  return parts.join(" ");
}

export type AmountWordsMode = "withCurrency" | "plain";
export type ParaStyle = "words" | "fraction";
export type LetterCase = "lower" | "upper" | "sentence";

/**
 * A noun's three agreement forms — singular, paucal (2–4, excluding 12–14) and
 * plural — because a currency is a parameter now and the tool can no longer
 * assume „dinar/dinara" (two distinct forms) any more than it can assume
 * „para/pare/para" (three): „evro/evra/evra" and „cent/centa/centi" both have to
 * come from the caller.
 */
export interface CurrencyNoun {
  readonly singular: string;
  readonly paucal: string;
  readonly plural: string;
}

export interface AmountWordsInput {
  /**
   * The amount in MINOR units, an integer that may be negative.
   *
   * Minor units and not a decimal number on purpose: „a third decimal is
   * refused" is a property of the text the user typed, and 1234.567 has already
   * lost it by the time it is a double. The surface does the lexical parse; this
   * function spells whatever whole number of minor units it is handed.
   */
  readonly cents: number;
  readonly mode: AmountWordsMode;
  /** Required when `mode` is `"withCurrency"`. Ignored in `"plain"` mode. */
  readonly currency?: CurrencyNoun | undefined;
  /** The grammatical gender of `currency`'s noun — „dinar" is masculine, „kruna" feminine. */
  readonly currencyGender?: NumberGender | undefined;
  /** Required when `mode` is `"withCurrency"` and `paraStyle` is `"words"`. */
  readonly subunit?: CurrencyNoun | undefined;
  readonly subunitGender?: NumberGender | undefined;
  /**
   * `"plain"` mode only, and only reaches the WHOLE number — there is no noun
   * in this mode for any digit of the spelled-out decimal tail to agree with
   * (see `digitsWords`). Defaults to masculine, the same convention as
   * reading a bare number or a document code aloud, when omitted.
   */
  readonly plainGender?: NumberGender | undefined;
  readonly paraStyle: ParaStyle;
  readonly letterCase: LetterCase;
}

/**
 * The amount as figures, so a reader can check the words against numerals.
 *
 * The sign travels WITH the two magnitudes because it cannot be recovered from
 * them: −0,50 has a whole part of zero, and a zero that has lost its minus
 * reads as +0,50. The three used to be flat siblings on the result, `negative`
 * beside a `whole` whose name did not admit it was unsigned — and the surface
 * printed the two magnitudes and never read the sign, so „minus jedna hiljada
 * dinara" appeared above the figure „1.000" on a payment order.
 */
export interface AmountFigures {
  /** True when the amount is below zero. `whole`/`subunits` are UNSIGNED. */
  readonly negative: boolean;
  /** Whole units, always at or above zero — `negative` carries the sign. */
  readonly whole: number;
  /** Minor units, 0..99, always at or above zero. */
  readonly subunits: number;
}

export interface AmountWords {
  readonly text: string;
  readonly figures: AmountFigures;
}

function applyCase(text: string, letterCase: LetterCase): string {
  if (letterCase === "upper") return text.toUpperCase();
  if (letterCase === "sentence") return text.charAt(0).toUpperCase() + text.slice(1);
  return text;
}

/**
 * `value` (0..99) read one decimal digit at a time — „cifre jednu po jednu" —
 * which is a DIFFERENT convention from `numberWords`: 56 read this way is
 * „pet šest" (five, six), never „pedeset šest" (fifty-six). Always both
 * digits, including a leading zero, since this is reading a two-place decimal
 * position by position and not a standalone count of anything. No gender:
 * a lone digit read out of a decimal expansion is not counting a noun, so
 * there is nothing here for `unitWord`'s 1/2 agreement to attach to.
 */
function digitsWords(value: number): string {
  return [...String(value).padStart(2, "0")].map((digit) => UNIT_WORDS[Number(digit)] ?? "").join(" ");
}

/** The form that agrees with `count`, out of the noun's three declared forms. */
function nounForm(count: number, noun: CurrencyNoun): string {
  const agreement = agreementOf(count);
  if (agreement === "singular") return noun.singular;
  if (agreement === "paucal") return noun.paucal;
  return noun.plural;
}

/**
 * An amount in Serbian words, with the noun agreeing with the number.
 *
 * **The 11–14 exception is the whole tool.** 12000 is „dvanaest hiljada" and not
 * „dvanaest hiljade", because the paucal is decided by the last TWO digits and
 * 12–14 are excluded from it however the last digit reads. The same rule, in the
 * other direction, is why 21000 is „dvadeset jedna hiljada" (feminine, singular)
 * while 21 dinar is „dvadeset jedan dinar" (masculine): one digit, two genders,
 * and the surface cannot guess which — which is exactly why `currencyGender` and
 * `subunitGender` are separate inputs rather than one shared field.
 *
 * **No currency is embedded.** „dinar"/„para" are not defaults here; the caller
 * supplies every noun's three forms and its gender, so the same function spells
 * a contract in evri and centi as readily as one in dinari and pare. A gross of
 * 1.001.000 reads as „milion hiljadu …" by this rule — the group-1 shorthand
 * „hiljadu" applies at every position, including immediately after „milion" —
 * and that reading is the tool's stated behaviour, not an unhandled case.
 */
export function amountInWords(input: AmountWordsInput): ProResult<AmountWords> {
  const { cents, mode, paraStyle, letterCase } = input;
  if (!Number.isInteger(cents) || Math.abs(cents) > MAX_MINOR) return fail("cents");

  const negative = cents < 0;
  const magnitude = Math.abs(cents);
  const whole = Math.floor(magnitude / SUBUNITS_PER_UNIT);
  const subunits = magnitude % SUBUNITS_PER_UNIT;
  const subunitFraction = `${String(subunits).padStart(2, "0")}/${SUBUNITS_PER_UNIT}`;

  let text: string;
  if (mode === "withCurrency") {
    const { currency, currencyGender, subunit, subunitGender } = input;
    if (currency === undefined) return fail("currency");
    if (currencyGender === undefined) return fail("currencyGender");
    const wholeWords = numberWords(whole, currencyGender);
    const currencyNoun = nounForm(whole, currency);
    let tail: string;
    if (paraStyle === "fraction") {
      tail = subunitFraction;
    } else {
      if (subunit === undefined) return fail("subunit");
      if (subunitGender === undefined) return fail("subunitGender");
      tail = `${numberWords(subunits, subunitGender)} ${nounForm(subunits, subunit)}`;
    }
    text = `${wholeWords} ${currencyNoun} i ${tail}`;
  } else {
    // Plain mode has no noun for the WHOLE number to agree with either, so a
    // gender is still needed and defaults to masculine — the same convention
    // as reading a bare number or a document code aloud — unless the caller
    // names a different one.
    const wholeWords = numberWords(whole, input.plainGender ?? "masculine");
    if (subunits === 0) {
      text = wholeWords;
    } else if (paraStyle === "fraction") {
      // Dropping the subunits in plain mode would be repairing the input, so
      // the fraction is spelled without a noun instead.
      text = `${wholeWords} i ${subunitFraction}`;
    } else {
      // „words" with no currency noun to carry a spelled subunit's own
      // agreement reads the decimal digits one at a time after „zarez"
      // instead — see `digitsWords` — rather than inventing a third
      // convention nobody asked for.
      text = `${wholeWords} zarez ${digitsWords(subunits)}`;
    }
  }

  return {
    ok: true,
    text: applyCase(negative ? `minus ${text}` : text, letterCase),
    figures: { negative, whole, subunits },
  };
}

/* ------------------------------------------------------ bank-account-iban */

/** Bank (3) + account (13) + check (2) = the 18-digit dinar account number. */
const DOMESTIC_ACCOUNT_DIGITS = 13;

/** ISO 13616-1:2020 fixes 34 as the upper bound for any IBAN. */
const IBAN_MAX_LENGTH = 34;
const IBAN_MIN_LENGTH = 5;

function stripSeparators(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/** ISO 7064 MOD 97-10 over a digit string, one digit at a time. */
function mod97Digits(digits: string): number {
  let remainder = 0;
  for (const character of digits) {
    remainder = (remainder * 10 + (character.charCodeAt(0) - 48)) % 97;
  }
  return remainder;
}

/**
 * The same modulus over letters and digits, A = 10 … Z = 35 (ISO 13616-1:2020).
 *
 * Incremental so no big-integer library is needed: a 34-character IBAN expands
 * past 2^53 as one number, and the remainder does not care.
 */
function mod97Alphanumeric(value: string): number {
  let remainder = 0;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      remainder = (remainder * 10 + (code - 48)) % 97;
    } else {
      // A letter contributes two decimal digits, hence ×100 and not ×10.
      remainder = (remainder * 100 + (code - 55)) % 97;
    }
  }
  return remainder;
}

/** K = 98 − (n mod 97), written with a leading zero (ISO 7064:2003). */
function checkDigitsFrom(remainder: number): string {
  return String(98 - remainder).padStart(2, "0");
}

export interface DomesticAccountInput {
  /** 3-digit bank code. Parsed as TEXT, never as a number, so a leading zero survives. */
  readonly bank: string;
  /**
   * The party/account number, 1 to 13 digits. Padded with leading zeros to 13
   * digits WITHIN THIS FIELD ALONE.
   *
   * **Never pad the 3+13 digits joined together.** `bank = "160"`, `partyNumber
   * = "123456"` padded as one 16-digit string gives `"0000000160123456"` — the
   * "160" has slid out of the bank position entirely — instead of the correct
   * `"1600000000123456"`. Keeping the two fields separate, each padded on its
   * own, is the only way the boundary between them cannot move.
   */
  readonly partyNumber: string;
  /** Required in `"verify"` mode: the two check digits already printed on the number. */
  readonly checkDigits?: string | undefined;
  readonly mode: "verify" | "compute";
}

export interface DomesticAccount {
  readonly bank: string;
  readonly account: string;
  /** The check digits the arithmetic implies. */
  readonly checkDigits: string;
  readonly givenCheckDigits: string | undefined;
  readonly matches: boolean | undefined;
  /** The whole 18-digit number mod 97; the arithmetic holds when it is 1. */
  readonly remainder: number;
  readonly formatted: string;
}

/**
 * The check digits of an 18-digit dinar account, by ISO 7064 MOD 97-10.
 *
 * **This is arithmetic about a number, not a fact about a bank.** A number whose
 * check digits agree may belong to nobody, to a closed account, or to a bank
 * that never existed — the tool says only that the two digits match the other
 * sixteen, which is what catches a mistyped account before it is printed.
 *
 * **The bank code and the party number are two fields, never one joined and
 * re-split string** — see the note on `partyNumber` for the padding bug that
 * merging them creates.
 */
export function domesticAccountCheck(input: DomesticAccountInput): ProResult<DomesticAccount> {
  const bank = stripSeparators(input.bank);
  if (!/^[0-9]{3}$/.test(bank)) return fail("bank");
  const rawParty = stripSeparators(input.partyNumber);
  if (!/^[0-9]{1,13}$/.test(rawParty)) return fail("partyNumber");
  const party = rawParty.padStart(DOMESTIC_ACCOUNT_DIGITS, "0");

  const base = bank + party;
  // K = 98 − ((N·100) mod 97): the two check digits sit two decimal places
  // below N, exactly as the two zeroes do in the IBAN construction.
  const checkDigits = checkDigitsFrom((mod97Digits(base) * 100) % 97);
  let given: string | undefined;
  if (input.mode === "verify") {
    const raw = input.checkDigits === undefined ? "" : stripSeparators(input.checkDigits);
    if (!/^[0-9]{2}$/.test(raw)) return fail("checkDigits");
    given = raw;
  }
  const whole = base + (given ?? checkDigits);

  return {
    ok: true,
    bank,
    account: party,
    checkDigits,
    givenCheckDigits: given,
    matches: given === undefined ? undefined : given === checkDigits,
    remainder: mod97Digits(whole),
    formatted: `${bank}-${party}-${given ?? checkDigits}`,
  };
}

export interface IbanInput {
  /**
   * Verify: the whole IBAN. Compute: the two-letter country code followed by
   * the BBAN, with NO check digits — the tool puts them there. A value that
   * ALREADY verifies as a complete IBAN is refused (`"alreadyIban"`) rather
   * than accepted and mis-sliced — see the function's own note.
   */
  readonly value: string;
  readonly mode: "verify" | "compute";
}

export interface Iban {
  readonly iban: string;
  readonly countryCode: string;
  readonly bban: string;
  readonly checkDigits: string;
  readonly givenCheckDigits: string | undefined;
  readonly matches: boolean | undefined;
  /** The rearranged number mod 97 as given; the arithmetic holds when it is 1. */
  readonly remainder: number;
  /** Groups of four, the printed form. */
  readonly formatted: string;
}

/**
 * IBAN check digits and the MOD 97-10 test, and deliberately nothing else.
 *
 * **The national length and BBAN structure are not checked, on purpose.** Doing
 * so needs a per-country registry that somebody has to maintain the day a
 * country joins or changes its layout, and a stale registry rejects a valid
 * account — which is worse than not answering the question. The only length rule
 * applied is the 5–34 that ISO 13616 itself fixes.
 *
 * **A Cyrillic look-alike is refused by a name that says so.** Uppercasing
 * does not touch SCRIPT — Cyrillic „Р" stays Cyrillic uppercased, and is
 * pixel-for-pixel the Latin „R" this format wants, same for „С"/C, „В"/B,
 * „А"/A and more. Either reads as a stray character to the generic check
 * below, but only one of them is the specific, confusing mistake of having
 * typed in the wrong keyboard layout — so that one gets its own reason.
 *
 * **`compute` mode never accepts a value that already verifies as a complete
 * IBAN.** The field's whole point is producing check digits the caller does
 * not have yet; a full IBAN pasted in by mistake would have its own check
 * digits read as two BBAN characters, silently sliding the true BBAN two
 * places and handing back a DIFFERENT, wrong-but-equally-plausible-looking
 * IBAN. Since this module also refuses to hardcode a national BBAN length
 * (see above), it has no way to tell that case apart from an ordinary
 * country+BBAN input by SHAPE alone — but a value whose own MOD 97-10 already
 * comes out to 1 is, for all but a 1-in-97 coincidence, not raw BBAN data at
 * all, and is refused by name instead of silently mis-sliced.
 */
export function ibanCheck(input: IbanInput): ProResult<Iban> {
  const value = stripSeparators(input.value).toUpperCase();
  // U+0400-04FF is the Cyrillic block — checked before the generic character
  // test below so this specific mistake gets its own reason.
  if (/[Ѐ-ӿ]/.test(value)) return fail("confusable");
  if (!/^[A-Z0-9]+$/.test(value)) return fail("iban");

  if (input.mode === "verify") {
    if (!isIntegerIn(value.length, IBAN_MIN_LENGTH, IBAN_MAX_LENGTH)) return fail("length");
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(value)) return fail("iban");
    const countryCode = value.slice(0, 2);
    const given = value.slice(2, 4);
    const bban = value.slice(4);
    const checkDigits = checkDigitsFrom(mod97Alphanumeric(`${bban}${countryCode}00`));
    return {
      ok: true,
      iban: value,
      countryCode,
      bban,
      checkDigits,
      givenCheckDigits: given,
      matches: mod97Alphanumeric(`${bban}${countryCode}${given}`) === 1,
      remainder: mod97Alphanumeric(`${bban}${countryCode}${given}`),
      formatted: (value.match(/.{1,4}/g) ?? []).join(" "),
    };
  }

  if (!/^[A-Z]{2}[A-Z0-9]+$/.test(value)) return fail("iban");
  if (!isIntegerIn(value.length + 2, IBAN_MIN_LENGTH, IBAN_MAX_LENGTH)) return fail("length");
  // See the note above: a value that ALREADY has the shape of a complete IBAN
  // (country + two digits + the rest) and already verifies as one is refused
  // rather than mis-sliced — this is the probe for that, discarded either way.
  if (/^[0-9]{2}/.test(value.slice(2, 4))) {
    const probeCountry = value.slice(0, 2);
    const probeGiven = value.slice(2, 4);
    const probeBban = value.slice(4);
    if (mod97Alphanumeric(`${probeBban}${probeCountry}${probeGiven}`) === 1) {
      return fail("alreadyIban");
    }
  }
  const countryCode = value.slice(0, 2);
  const bban = value.slice(2);
  const remainder = mod97Alphanumeric(`${bban}${countryCode}00`);
  const checkDigits = checkDigitsFrom(remainder);
  const iban = `${countryCode}${checkDigits}${bban}`;
  return {
    ok: true,
    iban,
    countryCode,
    bban,
    checkDigits,
    givenCheckDigits: undefined,
    matches: undefined,
    remainder,
    formatted: (iban.match(/.{1,4}/g) ?? []).join(" "),
  };
}

/* ----------------------------------------------------- benford-first-digit */

export type BenfordDigitTest = "first" | "firstTwo";
export type NegativeHandling = "absolute" | "skip";
export type DecimalSeparator = "comma" | "dot";

export interface BenfordInput {
  /** The pasted column, split on newline, semicolon or tab. */
  readonly text: string;
  readonly test: BenfordDigitTest;
  readonly negatives: NegativeHandling;
  readonly separator: DecimalSeparator;
}

export interface BenfordRow {
  readonly digit: number;
  readonly observed: number;
  readonly observedShare: number;
  readonly expectedShare: number;
  readonly expected: number;
  /** observedShare − expectedShare, signed. */
  readonly difference: number;
  readonly z: number;
  /**
   * The same three quantities as percentages.
   *
   * Here rather than in the surface, which had written `100 * row.observedShare`
   * at four places. The multiplication is trivial and that is the point: a
   * figure the arithmetic never produced is a figure no test covers, and
   * `allocateWithoutRemainder` in this same module already returns its shares
   * pre-suffixed — so the pack was inconsistent about who owns the ×100.
   */
  readonly observedSharePercent: number;
  readonly expectedSharePercent: number;
  readonly differencePercent: number;
}

export interface BenfordAnalysis {
  readonly rows: readonly BenfordRow[];
  readonly usable: number;
  /** Zeroes and rows that did not parse — counted, never silently dropped. */
  readonly skipped: number;
  readonly chiSquare: number;
  readonly degreesOfFreedom: number;
  readonly mad: number;
  /**
   * The smallest expected frequency. Printed because the chi-square
   * approximation is weak when it is small — a fact about the statistic, not a
   * judgement about the data.
   */
  readonly minExpected: number;
}

const BENFORD_MAX_ROWS = 100_000;

/**
 * The leading one or two digits, taken from the DECIMAL TEXT and not from a
 * logarithm.
 *
 * `Math.log10(999.9999)` is 2.9999999… and its floor is 2, which is right; but
 * for values a hair below a power of ten the double can round the other way and
 * the tool would report a leading 1 for a number starting with 9. The text
 * cannot lie about its own first digit.
 */
function leadingDigits(row: string, separator: DecimalSeparator, pair: boolean): number | undefined {
  const grouping = separator === "comma" ? "." : ",";
  let cleaned = "";
  for (const character of row) {
    if (character === grouping || character === " " || character === "'") continue;
    cleaned += character === (separator === "comma" ? "," : ".") ? "." : character;
  }
  const signless = cleaned.replace(/^[+-]/, "");
  if (!/^[0-9]*\.?[0-9]*$/.test(signless) || !/[0-9]/.test(signless)) return undefined;
  const digits = signless.replace(".", "");
  const first = digits.search(/[1-9]/);
  if (first < 0) return undefined; // every digit is a zero: the value is zero
  const lead = Number(digits[first] ?? "0");
  if (!pair) return lead;
  // A one-digit value like 9 is 9.0, whose first two digits are 90.
  return lead * 10 + Number(digits[first + 1] ?? "0");
}

/**
 * The observed distribution of leading digits against Newcomb–Benford, with
 * chi-square, MAD and a z per digit — and no threshold, no flag, no verdict.
 *
 * The expected proportions are computed, never stored: p_d = log10(1 + 1/d) is a
 * mathematical expression, and the nine values telescope to log10(10) = 1 by
 * construction, which a typed table of six-decimal constants would not.
 *
 * The continuity correction is applied only when it is smaller than the observed
 * deviation; subtracting more than the deviation would drive z negative, which
 * is not a smaller discrepancy but a meaningless one.
 */
export function benfordDigits(input: BenfordInput): ProResult<BenfordAnalysis> {
  const rows = input.text
    .split(/[\n\r;\t]/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  if (rows.length > BENFORD_MAX_ROWS) return fail("tooManyRows");

  const pair = input.test === "firstTwo";
  const lowest = pair ? 10 : 1;
  const highest = pair ? 99 : 9;
  const counts = new Map<number, number>();
  let usable = 0;
  let skipped = 0;
  for (const row of rows) {
    const negative = /^\s*[-]/.test(row);
    if (negative && input.negatives === "skip") {
      skipped += 1;
      continue;
    }
    const digits = leadingDigits(row, input.separator, pair);
    if (digits === undefined || digits < lowest || digits > highest) {
      skipped += 1;
      continue;
    }
    counts.set(digits, (counts.get(digits) ?? 0) + 1);
    usable += 1;
  }
  if (usable === 0) return fail("values");

  const correction = 1 / (2 * usable);
  const analysed: BenfordRow[] = [];
  let chiSquare = 0;
  let absoluteDeviation = 0;
  let minExpected = Number.POSITIVE_INFINITY;
  for (let digit = lowest; digit <= highest; digit += 1) {
    const observed = counts.get(digit) ?? 0;
    const expectedShare = Math.log10(1 + 1 / digit);
    const expected = usable * expectedShare;
    const observedShare = observed / usable;
    const deviation = Math.abs(observedShare - expectedShare);
    const applied = correction < deviation ? correction : 0;
    chiSquare += ((observed - expected) * (observed - expected)) / expected;
    absoluteDeviation += deviation;
    minExpected = Math.min(minExpected, expected);
    analysed.push({
      digit,
      observed,
      observedShare,
      expectedShare,
      expected,
      difference: observedShare - expectedShare,
      z: (deviation - applied) / Math.sqrt((expectedShare * (1 - expectedShare)) / usable),
      observedSharePercent: observedShare * 100,
      expectedSharePercent: expectedShare * 100,
      differencePercent: (observedShare - expectedShare) * 100,
    });
  }

  return {
    ok: true,
    rows: analysed,
    usable,
    skipped,
    chiSquare,
    degreesOfFreedom: analysed.length - 1,
    mad: absoluteDeviation / analysed.length,
    minExpected,
  };
}

/* ------------------------------------------------------------ breakeven-cvp */

export interface BreakevenInput {
  readonly fixedCost: number;
  readonly price: number;
  readonly variableCost: number;
  readonly targetProfit: number;
  /** Absent means no margin of safety and no operating leverage are computed. */
  readonly plannedVolume?: number | undefined;
}

export interface Breakeven {
  readonly contributionMargin: number;
  readonly contributionMarginPercent: number;
  /** The EXACT break-even volume, unrounded — this is what `breakevenRevenue` agrees with. */
  readonly breakevenUnits: number;
  /** `breakevenUnits` rounded UP to a whole, sellable unit. */
  readonly breakevenUnitsWhole: number;
  /** FT/mp — the exact revenue at the exact break-even volume. */
  readonly breakevenRevenue: number;
  /**
   * `breakevenUnitsWhole × price` — the revenue at the ROUNDED unit count.
   *
   * A different number from `breakevenRevenue`, and shown so the gap is visible
   * rather than implied: at 1.250,4 units the exact threshold is 1.250.400,80,
   * while 1.251 whole units sell for 1.251.000 — printing only one of the two
   * would let a reader silently reconcile numbers that do not actually agree.
   */
  readonly breakevenRevenueAtWholeUnits: number;
  readonly targetUnits: number;
  readonly targetRevenue: number;
  readonly marginOfSafetyPercent: number | undefined;
  /** Undefined AT the break-even point, where the denominator is zero. */
  readonly operatingLeverage: number | undefined;
  /**
   * Always `true` — a structural fact about this function, not a computed
   * result, present so a surface rendering `Breakeven` has something in the
   * TYPE to notice and hang its own caveat text on. This is a single-product
   * calculation; see the function's own note on why a sales mix needs a
   * different one.
   */
  readonly assumesSingleProduct: true;
}

/**
 * Break-even volume and revenue, the volume for a target profit, and the two
 * sensitivity figures.
 *
 * **A contribution margin of zero or less has no break-even at any volume**, and
 * the tool refuses instead of printing an infinite or negative one: selling more
 * of something that does not cover its own variable cost never reaches the
 * fixed cost, and „∞ komada" reads like a display bug rather than an answer.
 *
 * **This is a single product.** With more than one item on the shelf the
 * break-even volume depends on the SALES MIX — which item sells in what
 * proportion — and this function knows nothing about that; a multi-product
 * break-even needs a weighted contribution margin over the whole mix, which is
 * a different calculation with a different input shape, not a loop around
 * this one.
 */
export function breakevenPoint(input: BreakevenInput): ProResult<Breakeven> {
  const { fixedCost, price, variableCost, targetProfit, plannedVolume } = input;
  if (!isNonNegative(fixedCost)) return fail("fixedCost");
  if (!isPositive(price)) return fail("price");
  if (!isNonNegative(variableCost)) return fail("variableCost");
  if (!isNonNegative(targetProfit)) return fail("targetProfit");
  if (plannedVolume !== undefined && !isPositive(plannedVolume)) return fail("plannedVolume");

  const contribution = price - variableCost;
  if (contribution <= 0) return fail("contribution");
  const ratio = contribution / price;
  const breakevenUnits = fixedCost / contribution;
  const breakevenUnitsWhole = Math.ceil(breakevenUnits);
  const totalContribution =
    plannedVolume === undefined ? undefined : plannedVolume * contribution;

  return {
    ok: true,
    contributionMargin: contribution,
    contributionMarginPercent: 100 * ratio,
    breakevenUnits,
    breakevenUnitsWhole,
    breakevenRevenue: fixedCost / ratio,
    breakevenRevenueAtWholeUnits: breakevenUnitsWhole * price,
    targetUnits: (fixedCost + targetProfit) / contribution,
    targetRevenue: (fixedCost + targetProfit) / ratio,
    marginOfSafetyPercent:
      plannedVolume === undefined
        ? undefined
        : (100 * (plannedVolume - breakevenUnits)) / plannedVolume,
    operatingLeverage:
      totalContribution === undefined || totalContribution - fixedCost === 0
        ? undefined
        : totalContribution / (totalContribution - fixedCost),
    assumesSingleProduct: true,
  };
}

/* ---------------------------------------------------------- check-digits-id */

/**
 * PIB 9, matični broj 8, JMBG 13 — the shape of each identifier.
 *
 * The two 8-digit kinds the catalogue lists (pravno lice and radnja) are the
 * same length and the same arithmetic, so they are one kind here; a second
 * enum member that computes identically would only invite the reader to look for
 * a difference that does not exist.
 */
const IDENTIFIER_LENGTH = { pib: 9, maticni: 8, jmbg: 13 } as const;

/** JMBG weights over the digit pairs, modulus 11 — part of the number's structure. */
const JMBG_WEIGHTS = [7, 6, 5, 4, 3, 2] as const;

export type IdentifierKind = keyof typeof IDENTIFIER_LENGTH;

export interface IdentifierInput {
  /** Digits; spaces and hyphens are ignored. */
  readonly value: string;
  readonly kind: IdentifierKind;
  /** verify: the whole number. compute: the first n−1 digits. */
  readonly mode: "verify" | "compute";
}

export interface IdentifierCheck {
  readonly computed: number;
  readonly given: number | undefined;
  readonly matches: boolean | undefined;
  /** The base with the COMPUTED digit appended, so a correction can be copied. */
  readonly corrected: string;
  /**
   * JMBG only: the raw `m = 11 − (S mod 11)` before the `m > 9 → 0` rule folds
   * it. Undefined for a PIB or a matični broj, which have no such branch.
   *
   * Exposed on its own because `m == 10` and `m == 11` both fold to the SAME
   * check digit (0), and by one reading a JMBG whose raw `m` is exactly 10 was
   * never actually issued — a fact the folded digit alone erases. `jmbgTenBranch`
   * flags that specific case so the two are not silently merged.
   */
  readonly jmbgRawRemainder: number | undefined;
  readonly jmbgTenBranch: boolean;
}

/**
 * ISO 7064 MOD 11,10 — the hybrid system behind the PIB and the matični broj.
 *
 * The `s === 0 → s = 10` branch is the one a re-implementation drops, because
 * most test numbers never reach it; 100000008 does, which is why that vector
 * exists.
 */
function mod1110CheckDigit(base: string): number {
  let product = 10;
  for (const character of base) {
    const sum = (product + (character.charCodeAt(0) - 48)) % 10;
    product = (2 * (sum === 0 ? 10 : sum)) % 11;
  }
  return (11 - product) % 10;
}

/** The JMBG's own rule: m = 11 − (S mod 11), and m > 9 (i.e. 10 or 11) becomes 0. */
function jmbgCheckDigit(base: string): { readonly digit: number; readonly raw: number } {
  let sum = 0;
  for (let index = 0; index < 6; index += 1) {
    const weight = JMBG_WEIGHTS[index] ?? 0;
    const left = Number(base[index] ?? "0");
    const right = Number(base[index + 6] ?? "0");
    sum += weight * (left + right);
  }
  const raw = 11 - (sum % 11);
  return { digit: raw > 9 ? 0 : raw, raw };
}

/**
 * The check digit of a PIB, a matični broj or a JMBG, computed or compared.
 *
 * **It says the digits agree with each other and nothing more** — not that the
 * number is issued, not whose it is, not that it is active. The JMBG is not
 * decoded either: the date and the region would need a region table somebody has
 * to maintain, and a stale table mislabels a real person.
 *
 * **The JMBG has a blind spot this function cannot close.** Positions `i` and
 * `i+6` carry the SAME weight, so swapping the two digits there changes neither
 * `S` nor the check digit — `0101990710016` and `0701990110016` both compute to
 * 6. A matching check digit rules out most transcription errors; it does not
 * rule out that one.
 */
export function identifierCheckDigit(input: IdentifierInput): ProResult<IdentifierCheck> {
  const digits = stripSeparators(input.value);
  if (!/^[0-9]+$/.test(digits)) return fail("value");
  const full = IDENTIFIER_LENGTH[input.kind];
  if (digits.length !== (input.mode === "verify" ? full : full - 1)) return fail("length");

  const base = digits.slice(0, full - 1);
  const jmbg = input.kind === "jmbg" ? jmbgCheckDigit(base) : undefined;
  const computed = jmbg === undefined ? mod1110CheckDigit(base) : jmbg.digit;
  const given = input.mode === "verify" ? Number(digits[full - 1] ?? "0") : undefined;
  return {
    ok: true,
    computed,
    given,
    matches: given === undefined ? undefined : given === computed,
    corrected: `${base}${computed}`,
    jmbgRawRemainder: jmbg?.raw,
    jmbgTenBranch: jmbg?.raw === 10,
  };
}

/* ---------------------------------------------------- depreciation-schedule */

export type DepreciationMethod = "linear" | "declining" | "syd" | "units";
export type FirstYearProration = "none" | "months" | "days";

/** Money in the plan is carried to the para, which is where the plan is signed. */
const PLAN_DECIMALS = 2;

export interface DepreciationInput {
  readonly cost: number;
  /** Residual value; 0 to write the asset down to nothing. */
  readonly residual: number;
  /** Useful life in whole years. Not read by the `units` method. */
  readonly usefulLife: number;
  readonly method: DepreciationMethod;
  /** Declining coefficient f, > 1 to 5 — the user's accounting policy, not a rate. */
  readonly decliningFactor?: number | undefined;
  /**
   * How many years to print for the `declining` method, which by its own
   * formula never reaches zero on its own — the geometric series only stops
   * because of the residual cap, and if that cap never binds the row count is
   * otherwise undefined. Ignored by the other three methods, whose own charge
   * formula already fixes a natural length. Defaults to `usefulLife` when
   * omitted, matching this function's own prior behaviour.
   *
   * **Below `usefulLife` this is a genuine preview, not a shorter plan.** The
   * declining charges print exactly as the formula gives them and the
   * remainder is left undepreciated (`writtenOff` under `depreciableBase`) —
   * the last DISPLAYED row only absorbs the untaken tail once `displayYears`
   * reaches `usefulLife`, which is the only point at which "the last printed
   * row" and "the plan's own last row" are the same row.
   */
  readonly displayYears?: number | undefined;
  readonly activation?: CivilDate | undefined;
  readonly proration: FirstYearProration;
  /** Output per year, for the `units` method. */
  readonly usage?: readonly number[] | undefined;
  /** Total capacity over the whole life, for the `units` method. */
  readonly capacity?: number | undefined;
}

export interface DepreciationRow {
  readonly index: number;
  readonly calendarYear: number | undefined;
  /** The amount the year's charge was computed FROM: the opening book value for
   * declining balance, the depreciable base for every other method. */
  readonly basis: number;
  readonly openingBookValue: number;
  readonly charge: number;
  readonly accumulated: number;
  readonly closingBookValue: number;
}

export interface DepreciationPlan {
  readonly rows: readonly DepreciationRow[];
  readonly depreciableBase: number;
  /** The fraction of the first full year the asset was in use, or undefined. */
  readonly firstYearFactor: number | undefined;
  readonly writtenOff: number;
}

/**
 * A depreciation plan by one of four methods, with an optional first-year
 * proportion.
 *
 * **No tax depreciation group and no prescribed rate is embedded.** The life and
 * the declining coefficient are inputs, so the plan is the user's accounting
 * policy; a rate table here would be this app filing somebody's return.
 *
 * **The first-year proportion overlaps two consecutive annual charges** — year j
 * takes `f·A_j + (1 − f)·A_(j−1)` — which is the SYD rule the catalogue states,
 * and which reduces on the straight line to „the first year is short and an extra
 * year appears at the end". One rule, four methods, and the total is preserved
 * because the factors sum to one on every pair.
 *
 * **The last row carries the difference**, so the plan sums to cost − residual
 * exactly. On declining balance with a small residual that difference is not a
 * rounding crumb but the whole tail the geometric series never reaches, and it
 * lands in the final year. The `units` method is exempt: its charges are driven
 * by output, and an asset that used half its capacity is half depreciated —
 * forcing the residual there would contradict the method's own formula.
 */
export function depreciationSchedule(input: DepreciationInput): ProResult<DepreciationPlan> {
  const { cost, residual, usefulLife, method, proration, activation } = input;
  if (!isPositive(cost)) return fail("cost");
  if (!isNonNegative(residual) || residual > cost) return fail("residual");
  // Validated here, unconditionally: `activation` also feeds `calendarYear`
  // below when `proration` is `"none"`, so a check that only ran inside the
  // proration branch let an invalid date reach the output unrefused.
  if (activation !== undefined && !isValidDate(activation)) return fail("activation");

  const depreciable = cost - residual;
  let charges: number[];
  // Whether the LAST charge produced above is the plan's own natural end, and
  // so may legitimately absorb whatever rounding is left over. True for every
  // method except `declining` truncated below `usefulLife` — see the note set
  // inside that branch.
  let lastChargeClosesPlan = true;

  if (method === "units") {
    const usage = input.usage;
    const capacity = input.capacity;
    if (usage === undefined || !isIntegerIn(usage.length, 1, 100)) return fail("usage");
    if (usage.some((value) => !isNonNegative(value))) return fail("usage");
    if (capacity === undefined || !isPositive(capacity)) return fail("capacity");
    const used = usage.reduce((sum, value) => sum + value, 0);
    // More output than the asset was ever capable of is a typing error, and
    // scaling it back would silently rewrite the user's own numbers.
    if (used > capacity) return fail("usage");
    if (proration !== "none") return fail("proration");
    charges = usage.map((value) => (depreciable * value) / capacity);
  } else {
    if (!isIntegerIn(usefulLife, 1, 100)) return fail("usefulLife");
    if (method === "linear") {
      charges = Array.from({ length: usefulLife }, () => depreciable / usefulLife);
    } else if (method === "syd") {
      const sumOfYears = (usefulLife * (usefulLife + 1)) / 2;
      charges = Array.from(
        { length: usefulLife },
        (_unused, index) => (depreciable * (usefulLife - index)) / sumOfYears,
      );
    } else {
      const factor = input.decliningFactor;
      if (factor === undefined || !isInRange(factor, 1, 5) || factor <= 1) {
        return fail("decliningFactor");
      }
      const displayYears = input.displayYears ?? usefulLife;
      if (!isIntegerIn(displayYears, 1, 100)) return fail("displayYears");
      const rate = factor / usefulLife;
      let bookValue = cost;
      charges = [];
      for (let year = 0; year < displayYears; year += 1) {
        // The cap is what keeps the book value from falling through the
        // residual, which the geometric series on its own would do.
        const charge = Math.max(0, Math.min(bookValue * rate, bookValue - residual));
        charges.push(charge);
        bookValue -= charge;
      }
      // The declining series has no natural end of its own (see the note on
      // `displayYears`), so „the last displayed year is the plan's own last
      // year" only holds once at least `usefulLife` years have been printed —
      // exactly the years the OTHER three methods build their own length
      // from. Printing FEWER than that is a preview of a longer plan, and
      // forcing that shorter view to swallow the untaken tail would show a
      // charge that was never actually computed: at cost 1.200.000, residual
      // 0, usefulLife 5, f 1,5 (rate 30%) and displayYears 3, the pure
      // formula gives 360.000 / 252.000 / 176.400 with 411.600 still to
      // depreciate; forcing row 3 closed would print 588.000 instead of
      // 176.400 — 3,3× the real charge — and a book value of 0 on an asset
      // that is 34% written down.
      lastChargeClosesPlan = displayYears >= usefulLife;
    }
  }

  let firstYearFactor: number | undefined;
  if (proration !== "none") {
    // Validity was already checked above; proration additionally requires the
    // date to be PRESENT at all.
    if (activation === undefined) return fail("activation");
    if (proration === "months") {
      // The month of activation counts whole, hence 13 − month and not 12 − month.
      firstYearFactor = (13 - activation.month) / 12;
    } else {
      const yearLength = isLeapYear(activation.year) ? 366 : 365;
      // From the day of activation to 31 December, that day included.
      firstYearFactor = (yearLength - dayOfYear(activation) + 1) / yearLength;
    }
  }

  if (firstYearFactor !== undefined && firstYearFactor < 1) {
    const overlapped: number[] = [];
    for (let index = 0; index <= charges.length; index += 1) {
      const current = charges[index] ?? 0;
      const previous = charges[index - 1] ?? 0;
      overlapped.push(firstYearFactor * current + (1 - firstYearFactor) * previous);
    }
    charges = overlapped;
  }

  const rounded = charges.map((charge) => roundHalfUp(charge, PLAN_DECIMALS));
  if (method !== "units" && lastChargeClosesPlan) {
    const head = rounded.slice(0, -1).reduce((sum, charge) => sum + charge, 0);
    rounded[rounded.length - 1] = roundHalfUp(depreciable - head, PLAN_DECIMALS);
  }

  let bookValue = cost;
  let accumulated = 0;
  const rows = rounded.map((charge, index) => {
    const opening = bookValue;
    accumulated += charge;
    bookValue -= charge;
    return {
      index: index + 1,
      calendarYear: activation === undefined ? undefined : activation.year + index,
      basis: method === "declining" ? opening : depreciable,
      openingBookValue: opening,
      charge,
      accumulated: roundHalfUp(accumulated, PLAN_DECIMALS),
      closingBookValue: roundHalfUp(bookValue, PLAN_DECIMALS),
    };
  });

  return {
    ok: true,
    rows,
    depreciableBase: depreciable,
    firstYearFactor,
    writtenOff: roundHalfUp(accumulated, PLAN_DECIMALS),
  };
}

/* ------------------------------------------------------- financial-ratios */

export type DaysBasis = 365 | 360;

export interface FinancialRatiosInput {
  readonly currentAssets?: number | undefined;
  readonly inventory?: number | undefined;
  readonly cash?: number | undefined;
  readonly receivables?: number | undefined;
  readonly currentLiabilities?: number | undefined;
  readonly payables?: number | undefined;
  readonly totalLiabilities?: number | undefined;
  readonly totalAssets?: number | undefined;
  readonly equity?: number | undefined;
  readonly revenue?: number | undefined;
  /** Cost of goods sold. */
  readonly cogs?: number | undefined;
  readonly ebit?: number | undefined;
  readonly interestExpense?: number | undefined;
  readonly netProfit?: number | undefined;
  /** 365 by the calendar, or 360 by the banking convention (ISDA 2006, 4.16). */
  readonly days: DaysBasis;
}

export interface FinancialRatios {
  readonly currentRatio: number | undefined;
  readonly quickRatio: number | undefined;
  readonly cashRatio: number | undefined;
  readonly workingCapital: number | undefined;
  readonly debtRatio: number | undefined;
  readonly debtToEquity: number | undefined;
  readonly interestCoverage: number | undefined;
  readonly inventoryTurnover: number | undefined;
  /** Days inventory outstanding. */
  readonly dio: number | undefined;
  /** Days sales outstanding. */
  readonly dso: number | undefined;
  /** Days payables outstanding. */
  readonly dpo: number | undefined;
  readonly cashConversionCycle: number | undefined;
  readonly assetTurnover: number | undefined;
  readonly roaPercent: number | undefined;
  readonly roePercent: number | undefined;
  readonly netMarginPercent: number | undefined;
  readonly ebitMarginPercent: number | undefined;
}

function subtract(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined) return undefined;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return a - b;
}

function percent(value: number | undefined): number | undefined {
  return value === undefined ? undefined : 100 * value;
}

/**
 * The liquidity, leverage, turnover and return ratios, each computed only when
 * the positions it needs were typed.
 *
 * **An empty field leaves an empty ratio, and a zero denominator leaves an empty
 * ratio too.** Interest cover with no interest expense is not infinite cover, it
 * is a question that was not asked; printing ∞ there is how a spreadsheet lies.
 *
 * The tool takes the amounts as given and never averages an opening and closing
 * balance on the user's behalf — whether a turnover uses the closing stock or the
 * average of two is an accounting choice, and guessing it changes the answer
 * without saying so.
 */
export function financialRatios(input: FinancialRatiosInput): ProResult<FinancialRatios> {
  if (input.days !== 365 && input.days !== 360) return fail("days");
  const days = input.days;
  const {
    currentAssets,
    inventory,
    cash,
    receivables,
    currentLiabilities,
    payables,
    totalLiabilities,
    totalAssets,
    equity,
    revenue,
    cogs,
    ebit,
    interestExpense,
    netProfit,
  } = input;

  // DIO is days · inventory / COGS rather than days / turnover: the two are the
  // same expression, and this one survives an inventory of zero.
  const dio = divide(
    inventory === undefined ? undefined : days * inventory,
    cogs,
  );
  const dso = divide(receivables === undefined ? undefined : days * receivables, revenue);
  const dpo = divide(payables === undefined ? undefined : days * payables, cogs);

  return {
    ok: true,
    currentRatio: divide(currentAssets, currentLiabilities),
    quickRatio: divide(subtract(currentAssets, inventory), currentLiabilities),
    cashRatio: divide(cash, currentLiabilities),
    workingCapital: subtract(currentAssets, currentLiabilities),
    debtRatio: divide(totalLiabilities, totalAssets),
    debtToEquity: divide(totalLiabilities, equity),
    interestCoverage: divide(ebit, interestExpense),
    inventoryTurnover: divide(cogs, inventory),
    dio,
    dso,
    dpo,
    cashConversionCycle:
      dio === undefined || dso === undefined || dpo === undefined
        ? undefined
        : dio + dso - dpo,
    assetTurnover: divide(revenue, totalAssets),
    roaPercent: percent(divide(netProfit, totalAssets)),
    roePercent: percent(divide(netProfit, equity)),
    netMarginPercent: percent(divide(netProfit, revenue)),
    ebitMarginPercent: percent(divide(ebit, revenue)),
  };
}

/* ------------------------------------------------------------ fx-difference */

/** Which side of the balance sheet the item sits on — it flips the NAME, not the sum. */
export type BalanceSide = "receivable" | "payable";

/** How many units of the FOREIGN currency the quoted rate is per — a published rate list is often per 100 or per 1000. */
export type FxRateUnit = 1 | 100 | 1000;

export interface FxDifferenceInput {
  readonly amount: number;
  /** Domestic currency per `rateUnit` units of the foreign currency, on the day of origin. */
  readonly rateOrigin: number;
  readonly rateSettlement: number;
  readonly rateUnit: FxRateUnit;
  readonly side: BalanceSide;
  /** Decimals of the money figures, 0..4. */
  readonly amountDecimals: number;
  readonly dateOrigin: CivilDate;
  readonly dateSettlement: CivilDate;
}

export interface FxDifference {
  readonly valueOrigin: number;
  readonly valueSettlement: number;
  /**
   * `round(valueSettlement) − round(valueOrigin)` — the amount actually
   * POSTED. Not the same number as `exactDifference` in general: at 3 EUR and
   * rates 100,0010 → 100,0020 the values round to 300,00 and 300,01, so 0,01
   * is booked even though the unrounded difference itself rounds to 0,00.
   */
  readonly bookedDifference: number;
  /** `amount · (rate2 − rate1) / rateUnit`, ROUNDED once — shown for comparison, never what is booked. */
  readonly exactDifference: number;
  /**
   * The same quantity, genuinely UNROUNDED — what a name like „exact" ought to
   * promise on its own, and the one figure `exactDifference` above rounds
   * away: at 3 EUR and a 0,001 rate move this is 0,003, where
   * `exactDifference` is 0,00.
   */
  readonly exactDifferenceRaw: number;
  /** `|bookedDifference|` — the amount that is posted. */
  readonly magnitude: number;
  /** Which side of the profit and loss it lands on, given the balance side. `"none"` only when `bookedDifference` is exactly zero. */
  readonly effect: "income" | "expense" | "none";
  readonly rateChangePercent: number;
  readonly dateOrigin: CivilDate;
  readonly dateSettlement: CivilDate;
}

/**
 * The domestic value of a foreign amount at two rates, and the difference
 * between them.
 *
 * **The arithmetic is the same for both sides and only the name changes**, which
 * is the one thing this tool has to get right: a rate that rises increases a
 * receivable (a gain) and increases a liability (a loss), from the identical
 * `amount × (rate2 − rate1)`.
 *
 * **`rateUnit` exists because a published rate list is often quoted per 100 or
 * per 1000 units of the foreign currency.** Typing such a rate as though it were
 * per single unit multiplies every value by 100 or 1000 — the single most
 * common transcription error against a real rate list.
 *
 * No rate list is embedded, nothing is fetched, and no rate is „the official"
 * one — both are the user's numbers, for the days the user chose (which is why
 * both dates are inputs: a result with no date cannot be tied back to a
 * document).
 */
export function fxDifference(input: FxDifferenceInput): ProResult<FxDifference> {
  const { amount, rateOrigin, rateSettlement, rateUnit, side, amountDecimals, dateOrigin, dateSettlement } =
    input;
  if (!Number.isFinite(amount)) return fail("amount");
  if (!isPositive(rateOrigin)) return fail("rateOrigin");
  if (!isPositive(rateSettlement)) return fail("rateSettlement");
  if (rateUnit !== 1 && rateUnit !== 100 && rateUnit !== 1000) return fail("rateUnit");
  if (!isIntegerIn(amountDecimals, 0, 4)) return fail("amountDecimals");
  if (!isValidDate(dateOrigin)) return fail("dateOrigin");
  if (!isValidDate(dateSettlement)) return fail("dateSettlement");

  const unitRateOrigin = rateOrigin / rateUnit;
  const unitRateSettlement = rateSettlement / rateUnit;
  const valueOrigin = roundHalfUp(amount * unitRateOrigin, amountDecimals);
  const valueSettlement = roundHalfUp(amount * unitRateSettlement, amountDecimals);
  const bookedDifference = roundHalfUp(valueSettlement - valueOrigin, amountDecimals);
  const rawDifference = amount * (unitRateSettlement - unitRateOrigin);
  const exactDifference = roundHalfUp(rawDifference, amountDecimals);
  const gain = side === "receivable" ? bookedDifference > 0 : bookedDifference < 0;
  return {
    ok: true,
    valueOrigin,
    valueSettlement,
    bookedDifference,
    exactDifference,
    exactDifferenceRaw: rawDifference,
    magnitude: roundHalfUp(Math.abs(bookedDifference), amountDecimals),
    effect: bookedDifference === 0 ? "none" : gain ? "income" : "expense",
    rateChangePercent: (100 * (unitRateSettlement - unitRateOrigin)) / unitRateOrigin,
    dateOrigin,
    dateSettlement,
  };
}

/** Whether the second quote shares the first one's base, or is inverted. */
export type CrossDirection = "sameBase" | "inverse";

export interface CrossRateInput {
  /** A/B — units of B for one A. */
  readonly rateAB: number;
  /** C/B when `sameBase`, or B/C when `inverse`. */
  readonly rateSecond: number;
  readonly direction: CrossDirection;
  /** Decimals of the resulting rate, 0..6. */
  readonly rateDecimals: number;
}

/**
 * A cross rate from two quotes, which is a division or a multiplication
 * depending on which way the second one is written — the single place this is
 * got wrong, and by a factor of the rate squared.
 */
export function crossRate(input: CrossRateInput): ProResult<{ readonly rate: number }> {
  const { rateAB, rateSecond, direction, rateDecimals } = input;
  if (!isPositive(rateAB)) return fail("rateAB");
  if (!isPositive(rateSecond)) return fail("rateSecond");
  if (!isIntegerIn(rateDecimals, 0, 6)) return fail("rateDecimals");
  const rate = direction === "sameBase" ? rateAB / rateSecond : rateAB * rateSecond;
  return { ok: true, rate: roundHalfUp(rate, rateDecimals) };
}

/* ---------------------------------------------------------------- gross-up */

/** A: tax on the base less a non-taxable amount. B: tax on the base less standardised costs. */
export type GrossUpModel = "A" | "B";

export interface GrossUpInput {
  readonly net: number;
  readonly model: GrossUpModel;
  /** Tax rate in %, the user's own — no rate is embedded and none is defaulted. */
  readonly taxPercent: number;
  /** Contribution rate borne by the recipient, in %. */
  readonly contributionPercent: number;
  /** Non-taxable amount, model A. */
  readonly nonTaxable?: number | undefined;
  /** Standardised costs in %, model B. */
  readonly standardCostPercent?: number | undefined;
  /** Contribution rate borne by the payer, in %. Absent leaves the total cost unshown. */
  readonly employerPercent?: number | undefined;
}

export interface GrossUp {
  readonly gross: number;
  readonly taxBase: number;
  readonly tax: number;
  readonly contributions: number;
  /** Recomputed forwards from the gross; it must equal the net that was typed. */
  readonly netCheck: number;
  readonly totalCost: number | undefined;
}

/**
 * The gross an amount has to be for a given net, solved backwards.
 *
 * **Model A's equation has two branches and both must be solved.** The closed
 * formula assumes the tax base is positive; below the non-taxable amount there is
 * no tax at all, and the formula then returns a gross whose forward computation
 * does not give the net back. The tool solves both and keeps the one that is
 * consistent — which is exactly one of them, since the forward function is
 * continuous and increasing.
 *
 * Rates that sum to 100% or more make the denominator zero or negative and the
 * equation has no meaningful solution; the tool refuses rather than print a
 * negative gross.
 */
export function grossFromNet(input: GrossUpInput): ProResult<GrossUp> {
  const { net, model, taxPercent, contributionPercent } = input;
  if (!isPositive(net)) return fail("net");
  if (!isInRange(taxPercent, 0, 100)) return fail("taxPercent");
  if (!isInRange(contributionPercent, 0, 100)) return fail("contributionPercent");
  const employerPercent = input.employerPercent;
  if (employerPercent !== undefined && !isInRange(employerPercent, 0, 100)) {
    return fail("employerPercent");
  }

  const tax = taxPercent / 100;
  const contribution = contributionPercent / 100;
  let gross: number;
  let taxBase: number;

  if (model === "A") {
    const nonTaxable = input.nonTaxable;
    if (nonTaxable === undefined || !isNonNegative(nonTaxable)) return fail("nonTaxable");
    const untaxedDenominator = 1 - contribution;
    const untaxedGross = untaxedDenominator > 0 ? net / untaxedDenominator : Number.NaN;
    if (Number.isFinite(untaxedGross) && untaxedGross <= nonTaxable) {
      gross = untaxedGross;
      taxBase = 0;
    } else {
      const denominator = 1 - contribution - tax;
      if (denominator <= 0) return fail("rates");
      const taxedGross = (net - tax * nonTaxable) / denominator;
      if (!(taxedGross > nonTaxable)) return fail("net");
      gross = taxedGross;
      taxBase = gross - nonTaxable;
    }
  } else {
    const standardCostPercent = input.standardCostPercent;
    if (standardCostPercent === undefined || !isInRange(standardCostPercent, 0, 100)) {
      return fail("standardCostPercent");
    }
    const netOfCosts = 1 - standardCostPercent / 100;
    const denominator = 1 - (tax + contribution) * netOfCosts;
    if (denominator <= 0) return fail("rates");
    gross = net / denominator;
    taxBase = gross * netOfCosts;
  }

  const contributionsDue = model === "A" ? contribution * gross : contribution * taxBase;
  const taxDue = tax * taxBase;
  const employerBase = model === "A" ? gross : taxBase;

  return {
    ok: true,
    gross: roundHalfUp(gross, 2),
    taxBase: roundHalfUp(taxBase, 2),
    tax: roundHalfUp(taxDue, 2),
    contributions: roundHalfUp(contributionsDue, 2),
    netCheck: roundHalfUp(gross - contributionsDue - taxDue, 2),
    totalCost:
      employerPercent === undefined
        ? undefined
        : roundHalfUp(gross + (employerPercent / 100) * employerBase, 2),
  };
}

/* -------------------------------------------------------- interest-periods */

/** Day-count fractions of ISDA 2006 Definitions, Section 4.16. */
export type DayCount = "act365" | "act360" | "actActIsda" | "bond30360" | "euro30E360";
export type InterestMethod = "simple" | "compound";

export interface InterestPeriod {
  readonly from: CivilDate;
  readonly to: CivilDate;
  /** Annual rate in %, the user's own — no statutory or reference rate is embedded. */
  readonly ratePercent: number;
}

export interface InterestInput {
  readonly principal: number;
  readonly periods: readonly InterestPeriod[];
  readonly dayCount: DayCount;
  readonly method: InterestMethod;
  /**
   * Whether each period's interest joins the principal before the NEXT period
   * is computed.
   *
   * Off is the plain reading of „kamata po periodima": every row computed on
   * the same starting principal, which is what makes the rows independent of
   * how the whole span happens to have been cut into periods. On, the split
   * itself stops mattering — 100.000 at 10% ACT/365 compound is 10.000,00
   * whether it is one 365-day row or two rows of 182 and 183 days, because the
   * two conformal growth factors telescope back to the one-year factor exactly.
   * Without it, cutting the same year in two LOSES interest (9.761,73 instead
   * of 10.000,00), which is the whole reason this is an input and not silent.
   */
  readonly capitalize: boolean;
  /** Decimals of the money figures, 0..6. */
  readonly decimals: number;
}

export interface InterestRow {
  readonly days: number;
  /** The year fraction under the chosen basis. */
  readonly dcf: number;
  readonly ratePercent: number;
  /** The balance this row's interest was computed FROM — `principal` unless `capitalize` is on. */
  readonly basis: number;
  /** Unrounded, so the total can be summed before anything is rounded. */
  readonly interestExact: number;
  readonly interest: number;
}

export interface InterestResult {
  readonly rows: readonly InterestRow[];
  /**
   * Sum of `row.days` — days under the CHOSEN BASIS, not the calendar. A
   * 30/360 period counts 60 days where the calendar counts 59, unlike
   * `overlapDays`/`uncoveredDays` below, which are deliberately real calendar
   * days. Not a money figure.
   */
  readonly totalDays: number;
  /** Sum of the DISPLAYED (rounded) row amounts — what the printed column itself sums to. */
  readonly totalInterestRows: number;
  /** Sum of the unrounded row amounts, rounded once — may differ from `totalInterestRows` by a minor unit. */
  readonly totalInterestExact: number;
  /** `principal + totalInterestRows` — what the printed table itself closes to. */
  readonly totalDue: number;
  readonly earliestFrom: CivilDate;
  readonly latestTo: CivilDate;
  /** Real calendar days double-counted by overlapping periods. Zero for a clean schedule. */
  readonly overlapDays: number;
  /** Real calendar days between `earliestFrom` and `latestTo` that no period covers. */
  readonly uncoveredDays: number;
  /** The row-count ceiling this function enforces — informational, not a judgement on the input. */
  readonly maxPeriods: number;
}

const INTEREST_MAX_PERIODS = 200;

/** The union length of a set of [start, end) day-number intervals. */
function unionLength(intervals: readonly { readonly start: number; readonly end: number }[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let covered = 0;
  let currentStart: number | undefined;
  let currentEnd: number | undefined;
  for (const interval of sorted) {
    if (currentEnd === undefined || interval.start > currentEnd) {
      if (currentStart !== undefined && currentEnd !== undefined) covered += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    } else {
      currentEnd = Math.max(currentEnd, interval.end);
    }
  }
  if (currentStart !== undefined && currentEnd !== undefined) covered += currentEnd - currentStart;
  return covered;
}

/** ACT/ACT (ISDA): each calendar year's own days over its own denominator. */
function actActFraction(from: CivilDate, to: CivilDate): number {
  let fraction = 0;
  const end = daysFromCivil(to);
  let cursor = daysFromCivil(from);
  let year = from.year;
  while (cursor < end) {
    const nextYearStart = daysFromCivil({ year: year + 1, month: 1, day: 1 });
    const segmentEnd = Math.min(end, nextYearStart);
    fraction += (segmentEnd - cursor) / (isLeapYear(year) ? 366 : 365);
    cursor = segmentEnd;
    year += 1;
  }
  return fraction;
}

/** 30/360 (bond) and 30E/360 differ only in how the two day numbers are adjusted. */
function thirtyDayCount(from: CivilDate, to: CivilDate, european: boolean): number {
  let startDay = from.day;
  let endDay = to.day;
  if (european) {
    startDay = Math.min(startDay, 30);
    endDay = Math.min(endDay, 30);
  } else {
    if (startDay === 31) startDay = 30;
    if (endDay === 31 && startDay === 30) endDay = 30;
  }
  return 360 * (to.year - from.year) + 30 * (to.month - from.month) + (endDay - startDay);
}

/**
 * Interest over one or more periods, each with its own rate, on one basis.
 *
 * **Capitalisation is an input, not an assumption** — see the note on
 * `InterestInput.capitalize`. Gaps and overlaps between the rows are shown as
 * typed and never repaired — a gap is usually deliberate and closing it
 * invents a charge; `overlapDays`/`uncoveredDays` surface both as PLAIN
 * QUANTITIES, so a mistyped period is visible without the tool judging it.
 *
 * The end date is excluded (from inclusive, to exclusive), which is why
 * 01.01–01.04 is 90 days and not 91.
 */
export function interestByPeriods(input: InterestInput): ProResult<InterestResult> {
  const { principal, periods, dayCount, method, capitalize, decimals } = input;
  if (!isPositive(principal)) return fail("principal");
  if (!isIntegerIn(periods.length, 1, INTEREST_MAX_PERIODS)) return fail("periods");
  if (!isIntegerIn(decimals, 0, 6)) return fail("decimals");

  const rows: InterestRow[] = [];
  const realIntervals: { readonly start: number; readonly end: number }[] = [];
  let totalDays = 0;
  let totalExact = 0;
  let runningPrincipal = principal;
  let earliestFrom = periods[0]?.from;
  let earliestFromDays = Number.POSITIVE_INFINITY;
  let latestTo = periods[0]?.to;
  let latestToDays = Number.NEGATIVE_INFINITY;
  let realDaysSum = 0;

  for (const period of periods) {
    if (!isValidDate(period.from) || !isValidDate(period.to)) return fail("period");
    const fromDays = daysFromCivil(period.from);
    const toDays = daysFromCivil(period.to);
    const days = toDays - fromDays;
    if (days <= 0) return fail("period");
    // −100% makes 1 + r/100 zero, and the compound branch takes ln of it.
    if (!Number.isFinite(period.ratePercent) || period.ratePercent <= -100) return fail("ratePercent");
    if (period.ratePercent > 1000) return fail("ratePercent");

    if (fromDays < earliestFromDays) {
      earliestFromDays = fromDays;
      earliestFrom = period.from;
    }
    if (toDays > latestToDays) {
      latestToDays = toDays;
      latestTo = period.to;
    }
    realIntervals.push({ start: fromDays, end: toDays });
    realDaysSum += days;

    // The 30-day bases count their OWN days: 31.01–31.03 is 60 days to them and
    // 59 to the calendar, and reporting the calendar number beside a day-count
    // fraction built from the other one is how a schedule stops adding up.
    let countedDays: number;
    let dcf: number;
    if (dayCount === "bond30360") {
      countedDays = thirtyDayCount(period.from, period.to, false);
      dcf = countedDays / 360;
    } else if (dayCount === "euro30E360") {
      countedDays = thirtyDayCount(period.from, period.to, true);
      dcf = countedDays / 360;
    } else {
      countedDays = days;
      if (dayCount === "act365") dcf = days / 365;
      else if (dayCount === "act360") dcf = days / 360;
      else dcf = actActFraction(period.from, period.to);
    }

    const rate = period.ratePercent / 100;
    const basis = capitalize ? runningPrincipal : principal;
    const interestExact =
      method === "simple" ? basis * rate * dcf : basis * Math.expm1(dcf * Math.log1p(rate));
    rows.push({
      days: countedDays,
      dcf,
      ratePercent: period.ratePercent,
      basis,
      interestExact,
      interest: roundHalfUp(interestExact, decimals),
    });
    totalDays += countedDays;
    totalExact += interestExact;
    if (capitalize) runningPrincipal += interestExact;
  }

  const rowsSum = rows.reduce((sum, row) => sum + row.interest, 0);
  const unionDays = unionLength(realIntervals);
  return {
    ok: true,
    rows,
    totalDays,
    totalInterestRows: roundHalfUp(rowsSum, decimals),
    // Summed unrounded and rounded once: rounding each row first and adding the
    // rounded rows can differ from this by a minor unit per row.
    totalInterestExact: roundHalfUp(totalExact, decimals),
    totalDue: roundHalfUp(principal + rowsSum, decimals),
    earliestFrom: earliestFrom ?? { year: 1, month: 1, day: 1 },
    latestTo: latestTo ?? { year: 1, month: 1, day: 1 },
    overlapDays: realDaysSum - unionDays,
    uncoveredDays: latestToDays - earliestFromDays - unionDays,
    maxPeriods: INTEREST_MAX_PERIODS,
  };
}

/* -------------------------------------------------------- inventory-costing */

export type MovementType = "in" | "out";
export type AverageMode = "moving" | "periodic";

export interface InventoryMovement {
  readonly type: MovementType;
  readonly quantity: number;
  /** Unit cost, required for a receipt and ignored for an issue. */
  readonly unitCost?: number | undefined;
}

export interface InventoryInput {
  readonly openingQuantity: number;
  readonly openingUnitCost: number;
  readonly movements: readonly InventoryMovement[];
  readonly averageMode: AverageMode;
  /** Decimals of the money figures, 0..6. */
  readonly decimals: number;
}

export interface InventoryRow {
  readonly type: MovementType;
  readonly quantity: number;
  /** The unit cost the movement was valued at — the running average, for an issue. */
  readonly unitCost: number;
  readonly value: number;
  readonly balanceQuantity: number;
  readonly balanceValue: number;
}

export interface InventoryMethodResult {
  readonly rows: readonly InventoryRow[];
  readonly costOfGoodsSold: number;
  readonly closingQuantity: number;
  readonly closingValue: number;
}

export interface InventoryCosting {
  readonly fifo: InventoryMethodResult;
  readonly average: InventoryMethodResult;
  /** `fifo.costOfGoodsSold − average.costOfGoodsSold` — FIFO first, always. */
  readonly costDifference: number;
  /** `fifo.closingValue − average.closingValue` — the same FIFO-first order. */
  readonly closingDifference: number;
  /** Opening value + receipts, the total the two methods split differently. */
  readonly purchaseValue: number;
}

/**
 * The cost of goods sold and the closing stock, by FIFO and by weighted average
 * — both, side by side, and neither called the right one.
 *
 * **Which method applies is the user's accounting policy**, and the same
 * movements give three defensible answers (FIFO, moving average, periodic
 * average). Showing all of them with their difference is the honest output;
 * picking one would be this app writing somebody's accounting policy.
 *
 * **An issue larger than the stock is refused, not netted.** A negative stock is
 * never a result — it is a movement typed in the wrong order or in the wrong
 * quantity, and inventing a negative valuation hides it.
 */
export function inventoryCosting(input: InventoryInput): ProResult<InventoryCosting> {
  const { openingQuantity, openingUnitCost, movements, averageMode, decimals } = input;
  if (!isNonNegative(openingQuantity)) return fail("openingQuantity");
  if (!isNonNegative(openingUnitCost)) return fail("openingUnitCost");
  if (!isIntegerIn(movements.length, 0, 1000)) return fail("movements");
  if (!isIntegerIn(decimals, 0, 6)) return fail("decimals");
  for (const movement of movements) {
    if (!isPositive(movement.quantity)) return fail("movements");
    if (movement.type === "in" && !isNonNegative(movement.unitCost ?? Number.NaN)) {
      return fail("unitCost");
    }
  }

  const openingValue = openingQuantity * openingUnitCost;
  const receiptsValue = movements
    .filter((movement) => movement.type === "in")
    .reduce((sum, movement) => sum + movement.quantity * (movement.unitCost ?? 0), 0);
  const receiptsQuantity = movements
    .filter((movement) => movement.type === "in")
    .reduce((sum, movement) => sum + movement.quantity, 0);

  // The periodic average needs the whole period before it can value anything,
  // which is precisely the difference between the two average methods.
  const periodicQuantity = openingQuantity + receiptsQuantity;
  const periodicUnitCost =
    periodicQuantity > 0 ? (openingValue + receiptsValue) / periodicQuantity : 0;

  const layers: { quantity: number; unitCost: number }[] =
    openingQuantity > 0 ? [{ quantity: openingQuantity, unitCost: openingUnitCost }] : [];
  const fifoRows: InventoryRow[] = [];
  const averageRows: InventoryRow[] = [];
  let fifoCost = 0;
  let averageCost = 0;
  let averageQuantity = openingQuantity;
  let averageValue = openingValue;
  let fifoQuantity = openingQuantity;
  let fifoValue = openingValue;

  for (const movement of movements) {
    if (movement.type === "in") {
      const unitCost = movement.unitCost ?? 0;
      layers.push({ quantity: movement.quantity, unitCost });
      fifoQuantity += movement.quantity;
      fifoValue += movement.quantity * unitCost;
      averageQuantity += movement.quantity;
      averageValue += movement.quantity * unitCost;
      fifoRows.push({
        type: "in",
        quantity: movement.quantity,
        unitCost,
        value: movement.quantity * unitCost,
        balanceQuantity: fifoQuantity,
        balanceValue: fifoValue,
      });
      averageRows.push({
        type: "in",
        quantity: movement.quantity,
        unitCost,
        value: movement.quantity * unitCost,
        balanceQuantity: averageQuantity,
        balanceValue: averageValue,
      });
      continue;
    }

    if (movement.quantity > fifoQuantity + 1e-9) return fail("movements");

    let outstanding = movement.quantity;
    let taken = 0;
    while (outstanding > 1e-12) {
      const layer = layers[0];
      if (layer === undefined) break;
      const used = Math.min(outstanding, layer.quantity);
      taken += used * layer.unitCost;
      layer.quantity -= used;
      outstanding -= used;
      if (layer.quantity <= 1e-12) layers.shift();
    }
    // Rounded ONCE here, per issue — never per layer within it and never by
    // summing every issue unrounded and rounding the total. The two differ
    // whenever an issue lands on a half minor unit, and only the per-issue
    // rounding makes the printed rows sum to the printed total.
    const takenRounded = roundHalfUp(taken, decimals);
    fifoCost += takenRounded;
    fifoQuantity -= movement.quantity;
    // The running balance keeps the EXACT value, same reasoning as the loan
    // schedule: rounding it every row would compound drift into the next
    // issue's layers. Only the displayed row and the final total are rounded.
    fifoValue -= taken;
    fifoRows.push({
      type: "out",
      quantity: movement.quantity,
      unitCost: movement.quantity > 0 ? takenRounded / movement.quantity : 0,
      value: takenRounded,
      balanceQuantity: fifoQuantity,
      balanceValue: fifoValue,
    });

    const unitCost =
      averageMode === "periodic"
        ? periodicUnitCost
        : averageQuantity > 0
          ? averageValue / averageQuantity
          : 0;
    const cost = movement.quantity * unitCost;
    const costRounded = roundHalfUp(cost, decimals);
    averageCost += costRounded;
    averageQuantity -= movement.quantity;
    // Exact, not rounded — see the note on `fifoValue` above: the next issue's
    // moving average must be computed from the true remaining value, or the
    // rounding of one issue would leak into the unit cost of the next.
    averageValue -= cost;
    averageRows.push({
      type: "out",
      quantity: movement.quantity,
      unitCost,
      value: costRounded,
      balanceQuantity: averageQuantity,
      balanceValue: averageValue,
    });
  }

  const purchaseValue = openingValue + receiptsValue;
  // `fifoCost`/`averageCost` are already sums of PER-ISSUE rounded values, so
  // this rounds only the float residue a chain of additions of 2-decimal
  // numbers can leave (3.34 + 3.34 + 3.34 is not always exactly 10.02 in
  // binary64) — it is hygiene, not a second rounding of raw data.
  const fifoRounded = roundHalfUp(fifoCost, decimals);
  const averageRounded = roundHalfUp(averageCost, decimals);
  // Closing value as opening + receipts − issues, so the stock account closes to
  // the minor unit rather than to whatever two roundings happen to leave.
  const fifoClosing = roundHalfUp(purchaseValue - fifoRounded, decimals);
  const averageClosing = roundHalfUp(purchaseValue - averageRounded, decimals);

  return {
    ok: true,
    fifo: {
      rows: fifoRows,
      costOfGoodsSold: fifoRounded,
      closingQuantity: fifoQuantity,
      closingValue: fifoClosing,
    },
    average: {
      rows: averageRows,
      costOfGoodsSold: averageRounded,
      closingQuantity: averageQuantity,
      closingValue: averageClosing,
    },
    costDifference: roundHalfUp(fifoRounded - averageRounded, decimals),
    closingDifference: roundHalfUp(fifoClosing - averageClosing, decimals),
    purchaseValue: roundHalfUp(purchaseValue, decimals),
  };
}

/* ------------------------------------------------------------ loan-schedule */

export type LoanPlan = "annuity" | "equalPrincipal";
export type PeriodicRateMethod = "proportional" | "conformal";
/** Instalments per year. */
export type LoanFrequency = 12 | 4 | 2 | 1;

export interface LoanInput {
  readonly principal: number;
  /** Nominal annual rate in %, the user's own. */
  readonly annualRatePercent: number;
  readonly instalments: number;
  readonly frequency: LoanFrequency;
  readonly plan: LoanPlan;
  readonly rateMethod: PeriodicRateMethod;
  readonly decimals: number;
}

export interface LoanRow {
  readonly index: number;
  readonly openingBalance: number;
  readonly interest: number;
  readonly principal: number;
  readonly payment: number;
  readonly closingBalance: number;
}

export interface LoanSchedule {
  readonly rows: readonly LoanRow[];
  /** The level instalment, or undefined on an equal-principal plan. */
  readonly annuity: number | undefined;
  readonly periodicRate: number;
  /** The same rate as a percentage — see `BenfordRow` on why the ×100 lives here. */
  readonly periodicRatePercent: number;
  readonly totalPaid: number;
  readonly totalInterest: number;
}

/**
 * An amortisation schedule, level instalment or equal principal.
 *
 * **This is not an APR and the tool never calls it one.** There are no fees, no
 * grace period, no currency clause and no insurance here — a plain computation
 * on the terms typed, which is a different number from the one a bank must
 * disclose, and conflating the two is how a calculator misleads.
 *
 * **The instalment is rounded ONCE, up front, and that same figure is used in
 * every row** — recomputing it per row would let a floating-point wobble move
 * the payment mid-schedule, which is not a rounding difference a borrower could
 * ever be shown a reason for.
 *
 * **The running balance is carried UNROUNDED between rows and rounded only for
 * display.** Rounding it every row and then computing the next row's interest
 * off the rounded figure compounds a few para of drift into real money over a
 * long schedule; carrying the exact value and rounding at the boundary is the
 * only way `openingBalance` and `closingBalance` are honest about what they
 * show. The last instalment then carries whatever is left of that exact
 * balance, so the schedule closes to precisely zero rather than to the few
 * para that independent per-row rounding would leave behind.
 *
 * `annuityPlan` in `../tools/calculators.js` computes the same level instalment
 * for the one case where the two conventions coincide — monthly payments, the
 * proportional periodic rate. THIS function calls it for exactly that case
 * (verified to agree with the general formula below to the ninth decimal on
 * every vector this file tests), so the closed-form annuity formula lives in
 * one place for the combination where it can. It cannot be called for the
 * other seven frequency/rate-method combinations `LoanInput` allows —
 * `annuityPlan` hard-codes `/12` and takes neither `frequency` nor
 * `rateMethod` — which is what the general formula below still exists for.
 */
export function loanSchedule(input: LoanInput): ProResult<LoanSchedule> {
  const { principal, annualRatePercent, instalments, frequency, plan, rateMethod, decimals } =
    input;
  if (!isPositive(principal)) return fail("principal");
  if (!isInRange(annualRatePercent, 0, 1000)) return fail("annualRatePercent");
  if (!isIntegerIn(instalments, 1, 600)) return fail("instalments");
  if (frequency !== 12 && frequency !== 4 && frequency !== 2 && frequency !== 1) {
    return fail("frequency");
  }
  if (!isIntegerIn(decimals, 0, 4)) return fail("decimals");

  const rate = annualRatePercent / 100;
  const periodicRate =
    rateMethod === "proportional" ? rate / frequency : Math.expm1(Math.log1p(rate) / frequency);

  let annuity: number;
  if (plan === "annuity" && frequency === 12 && rateMethod === "proportional") {
    // The one case `annuityPlan` also assumes — see the note above the
    // function. `principal`, `annualRatePercent` (0..1000) and `instalments`
    // (1..600) were already validated by this function's OWN guards, well
    // inside what `annuityPlan` accepts, so `null` here would mean the two
    // validations have drifted apart, not that this input was bad.
    const shared = annuityPlan({ principal, annualRatePercent, months: instalments });
    if (shared === null) return fail("principal");
    annuity = shared.monthlyPayment;
  } else {
    // (1+i)^(−n) through exp/log rather than `**`, which loses digits for a
    // small i and a large n — a 600-instalment plan is exactly that case.
    const discount = Math.exp(-instalments * Math.log1p(periodicRate));
    annuity = periodicRate === 0 ? principal / instalments : (principal * periodicRate) / (1 - discount);
  }
  const roundedAnnuity = roundHalfUp(annuity, decimals);
  const roundedPrincipalShare = roundHalfUp(principal / instalments, decimals);

  const rows: LoanRow[] = [];
  let balance = principal; // UNROUNDED between rows — see the note above.
  let totalPaid = 0;
  let totalInterest = 0;
  for (let index = 1; index <= instalments; index += 1) {
    const opening = balance;
    const interest = roundHalfUp(opening * periodicRate, decimals);
    let repayment: number;
    if (index === instalments) {
      repayment = roundHalfUp(opening, decimals);
    } else if (plan === "annuity") {
      repayment = roundHalfUp(roundedAnnuity - interest, decimals);
    } else {
      repayment = roundedPrincipalShare;
    }
    const payment = roundHalfUp(repayment + interest, decimals);
    // The last row is forced to exactly zero rather than to whatever
    // `opening − repayment` leaves after two independent roundings.
    balance = index === instalments ? 0 : opening - repayment;
    totalPaid += payment;
    totalInterest += interest;
    rows.push({
      index,
      openingBalance: roundHalfUp(opening, decimals),
      interest,
      principal: repayment,
      payment,
      closingBalance: roundHalfUp(balance, decimals),
    });
  }

  return {
    ok: true,
    rows,
    annuity: plan === "annuity" ? roundedAnnuity : undefined,
    periodicRate,
    periodicRatePercent: periodicRate * 100,
    totalPaid: roundHalfUp(totalPaid, decimals),
    totalInterest: roundHalfUp(totalInterest, decimals),
  };
}

/* ---------------------------------------------------------- rate-conversion */

export type RateKind = "nominal" | "effective" | "periodic";
export type TargetPeriod = "year" | "half" | "quarter" | "month" | "day";

const PERIODS_PER_YEAR: Record<TargetPeriod, number> = {
  year: 1,
  half: 2,
  quarter: 4,
  month: 12,
  day: 365,
};

export interface RateConversionInput {
  /**
   * The rate to convert, in %. When `kind` is `"periodic"` this is read as
   * belonging to the TARGET period (`target`) — a monthly-compounding nominal
   * rate entered as a daily periodic figure is not this tool's reading of
   * `"periodic"`; use `kind: "nominal"` with `compoundingsPerYear` for that.
   */
  readonly ratePercent: number;
  readonly kind: RateKind;
  /** Compounding periods per year for the nominal rate, 1..365. */
  readonly compoundingsPerYear: number;
  readonly target: TargetPeriod;
}

export interface RateConversion {
  readonly effectivePercent: number;
  readonly nominalPercent: number;
  /** r / k — the periodic rate by simple division. */
  readonly proportionalPeriodicPercent: number;
  /** (1 + EAR)^(1/k) − 1 — the periodic rate that compounds back to the effective. */
  readonly conformalPeriodicPercent: number;
  /** The m → ∞ limit, e^(r/100) − 1: the ceiling the sequence never crosses. */
  readonly continuousEffectivePercent: number;
  readonly periodsPerYear: number;
}

/**
 * One rate expressed every way: effective annual, nominal at m compoundings,
 * and the periodic rate both proportionally and conformally.
 *
 * **The proportional and the conformal periodic rate are not the same number**,
 * and the gap between them is the entire reason this tool exists: 10% effective
 * is 0.797414% a month conformally and 0.833333% a month proportionally, and
 * which one a contract means is a term of the contract, not a default.
 *
 * Nothing here is an APR: this converts the rate that was typed and asserts
 * nothing about which figure any rule requires to be disclosed.
 */
export function rateConversion(input: RateConversionInput): ProResult<RateConversion> {
  const { ratePercent, kind, compoundingsPerYear, target } = input;
  if (!isInRange(ratePercent, -99, 1000)) return fail("ratePercent");
  if (!isIntegerIn(compoundingsPerYear, 1, 365)) return fail("compoundingsPerYear");
  // Unchecked, `periodsPerYear` is `undefined`, every rate derived from it is
  // `NaN`, and the field itself is returned as `undefined` despite being typed
  // `number` — three wrong answers from one missing row.
  if (!isKeyOf(target, PERIODS_PER_YEAR)) return fail("target");
  const periodsPerYear = PERIODS_PER_YEAR[target];

  const rate = ratePercent / 100;
  let effective: number;
  if (kind === "nominal") {
    effective = Math.expm1(compoundingsPerYear * Math.log1p(rate / compoundingsPerYear));
  } else if (kind === "effective") {
    effective = rate;
  } else {
    effective = Math.expm1(periodsPerYear * Math.log1p(rate));
  }
  if (!(effective > -1)) return fail("ratePercent");

  const nominal =
    compoundingsPerYear * Math.expm1(Math.log1p(effective) / compoundingsPerYear);
  return {
    ok: true,
    effectivePercent: 100 * effective,
    nominalPercent: 100 * nominal,
    proportionalPeriodicPercent: (100 * nominal) / periodsPerYear,
    conformalPeriodicPercent: 100 * Math.expm1(Math.log1p(effective) / periodsPerYear),
    continuousEffectivePercent: 100 * Math.expm1(nominal),
    periodsPerYear,
  };
}

/* ------------------------------------------------------------- rebate-chain */

export type PricePair =
  | "costAndPrice"
  | "costAndMarginOnPrice"
  | "costAndMarginOnCost"
  | "priceAndMarginOnPrice"
  | "priceAndMarginOnCost";

export interface PriceMarginInput {
  readonly purchasePrice: number;
  /** Landed costs — freight, duty, insurance — added to the purchase price. */
  readonly landedCosts: number;
  readonly pair: PricePair;
  readonly sellingPrice?: number | undefined;
  /** Margin as a % OF THE SELLING PRICE. */
  readonly marginOnPricePercent?: number | undefined;
  /** Mark-up as a % OF THE COST — used both as an input pair and, always, as an echoed output. */
  readonly marginOnCostPercent?: number | undefined;
}

export interface PriceMargin {
  readonly cost: number;
  readonly sellingPrice: number;
  readonly difference: number;
  readonly marginOnPricePercent: number | undefined;
  readonly marginOnCostPercent: number | undefined;
}

/**
 * The two margins and the price they imply, from whichever pair is known.
 *
 * **Margin on the price and mark-up on the cost are different numbers for the
 * same trade**: 20% of the selling price is 25% of the cost, and the two are
 * mixed up daily. Both are always reported, whichever one was typed.
 *
 * Prices here carry no tax: no rate is embedded and none is assumed.
 */
export function priceMargin(input: PriceMarginInput): ProResult<PriceMargin> {
  const { purchasePrice, landedCosts, pair } = input;
  if (!isNonNegative(purchasePrice)) return fail("purchasePrice");
  if (!isNonNegative(landedCosts)) return fail("landedCosts");
  const cost = purchasePrice + landedCosts;

  let sellingPrice: number;
  if (pair === "costAndPrice") {
    const given = input.sellingPrice;
    if (given === undefined || !isNonNegative(given)) return fail("sellingPrice");
    sellingPrice = given;
  } else if (pair === "costAndMarginOnPrice") {
    const margin = input.marginOnPricePercent;
    if (margin === undefined || !Number.isFinite(margin)) return fail("marginOnPricePercent");
    // At 100% the price would have to be infinite for the cost to be a share of it.
    if (margin >= 100) return fail("marginOnPricePercent");
    sellingPrice = (100 * cost) / (100 - margin);
  } else if (pair === "costAndMarginOnCost") {
    const markup = input.marginOnCostPercent;
    if (markup === undefined || !Number.isFinite(markup)) return fail("marginOnCostPercent");
    if (markup <= -100) return fail("marginOnCostPercent");
    sellingPrice = cost * (1 + markup / 100);
  } else if (pair === "priceAndMarginOnPrice") {
    const price = input.sellingPrice;
    const margin = input.marginOnPricePercent;
    if (price === undefined || !isNonNegative(price)) return fail("sellingPrice");
    if (margin === undefined || !Number.isFinite(margin)) return fail("marginOnPricePercent");
    if (margin >= 100) return fail("marginOnPricePercent");
    return {
      ok: true,
      cost: price * (1 - margin / 100),
      sellingPrice: price,
      difference: (price * margin) / 100,
      marginOnPricePercent: margin,
      marginOnCostPercent:
        price * (1 - margin / 100) === 0 ? undefined : (100 * margin) / (100 - margin),
    };
  } else {
    // priceAndMarginOnCost — the reverse of "costAndMarginOnCost", and the pair
    // this tool was missing: C = P/(1 + u/100).
    const price = input.sellingPrice;
    const markup = input.marginOnCostPercent;
    if (price === undefined || !isNonNegative(price)) return fail("sellingPrice");
    if (markup === undefined || !Number.isFinite(markup)) return fail("marginOnCostPercent");
    if (markup <= -100) return fail("marginOnCostPercent");
    const impliedCost = price / (1 + markup / 100);
    return {
      ok: true,
      cost: impliedCost,
      sellingPrice: price,
      difference: price - impliedCost,
      marginOnPricePercent: price === 0 ? undefined : (100 * (price - impliedCost)) / price,
      marginOnCostPercent: markup,
    };
  }

  const difference = sellingPrice - cost;
  return {
    ok: true,
    cost,
    sellingPrice,
    difference,
    marginOnPricePercent: sellingPrice === 0 ? undefined : (100 * difference) / sellingPrice,
    marginOnCostPercent: cost === 0 ? undefined : (100 * difference) / cost,
  };
}

export interface RebateChainInput {
  /** The gross price the chain of rebates is applied TO — before any of them. */
  readonly listPrice: number;
  /** The discounts in the order they are granted, each 0..100 %. */
  readonly rebatePercents: readonly number[];
}

export interface RebateChainStep {
  /** The price this step's rebate was granted ON — the previous step's `remaining`. */
  readonly basis: number;
  readonly rebatePercent: number;
  /** `basis · rebatePercent/100` — the money this one step took off. */
  readonly rebateAmount: number;
  /** `basis − rebateAmount` — what is left after this step, and the next step's `basis`. */
  readonly remaining: number;
}

export interface RebateChain {
  readonly netPrice: number;
  /** 100·(1 − Π(1 − d/100)) — NOT the sum of the rebates. */
  readonly effectiveRebatePercent: number;
  /** One row per rebate, each naming what it was granted on and what it took off. */
  readonly steps: readonly RebateChainStep[];
}

/**
 * A chain of successive rebates as one effective rebate.
 *
 * **The chain is a product and not a sum**: 10% then 5% is 14.5% and not 15%,
 * because the second rebate is granted on what the first one left. On a 1.000
 * list price the difference is 5,00 per piece, which is the error this tool
 * exists to prevent.
 *
 * **`netPrice` is `listPrice × Π(1 − d_i/100)` directly, never recomputed from
 * the rounded `effectiveRebatePercent`** — the two are printed side by side,
 * but only the product of the raw factors ever produces the net price.
 */
export function rebateChain(input: RebateChainInput): ProResult<RebateChain> {
  const { listPrice, rebatePercents } = input;
  if (!isNonNegative(listPrice)) return fail("listPrice");
  if (!isIntegerIn(rebatePercents.length, 0, 20)) return fail("rebatePercents");
  if (rebatePercents.some((rebate) => !isInRange(rebate, 0, 100))) return fail("rebatePercents");

  const steps: RebateChainStep[] = [];
  let factor = 1;
  let basis = listPrice;
  for (const rebate of rebatePercents) {
    const rebateAmount = basis * (rebate / 100);
    const remaining = basis - rebateAmount;
    steps.push({ basis, rebatePercent: rebate, rebateAmount, remaining });
    factor *= 1 - rebate / 100;
    basis = remaining;
  }
  return {
    ok: true,
    netPrice: listPrice * factor,
    effectiveRebatePercent: 100 * (1 - factor),
    steps,
  };
}

/* ------------------------------------------------------- trial-balance-check */

export interface DigitPair {
  /** The digit that ended up in the UPPER (more significant) of the two positions. */
  readonly larger: number;
  readonly smaller: number;
}

export interface TransposedDigits {
  /** Digit positions counted from the smallest minor unit: 0 is para at d = 2. */
  readonly lowerPosition: number;
  readonly upperPosition: number;
  /** The two digits differ by this much; swapping them moves exactly the difference. */
  readonly digitGap: number;
  /** The place-value distance the swap moves, in currency units. */
  readonly step: number;
  /**
   * Every concrete (larger, smaller) digit pair consistent with `digitGap` —
   * a bookkeeper reads „9 and 2", not „differ by 7", so both are given rather
   * than making the reader re-derive them.
   */
  readonly pairs: readonly DigitPair[];
}

export interface BalanceDiagnostics {
  readonly difference: number;
  readonly magnitude: number;
  /**
   * Whether the two sides came out equal — a field and not a comparison the
   * surface makes, because the surface used to branch on `magnitude === 0` to
   * decide between „strane su izjednačene" and the diagnostics block. That is
   * the one decision in this tool with a consequence, and a decision belongs
   * where the arithmetic is tested.
   */
  readonly balanced: boolean;
  /** An item of this amount posted on the wrong side gives exactly this difference. */
  readonly reversedItem: number | undefined;
  readonly transpositions: readonly TransposedDigits[];
  /** An amount entered ten times too large. */
  readonly shiftedByTen: number | undefined;
  /** An amount entered a hundred times too large. */
  readonly shiftedByHundred: number | undefined;
}

export interface TrialBalance {
  readonly debitTotal: number;
  readonly creditTotal: number;
  readonly debitCount: number;
  readonly creditCount: number;
  readonly diagnostics: BalanceDiagnostics;
}

const BALANCE_MAX_ROWS = 5000;
/** 10^15 is the last power of ten a double holds exactly; positions stop there. */
const MAX_DIGIT_POSITION = 15;

/**
 * Every arithmetic explanation of a given out-of-balance amount.
 *
 * **Divisibility by nine is why a transposition is findable at all.** Swapping
 * digits a and b between positions i and j changes the number by
 * (a − b)(10^j − 10^i), and 10 ≡ 1 (mod 9), so every one of those differences is
 * a multiple of nine. A difference that is not divisible by nine cannot be a
 * transposition and cannot be a misplaced decimal point either — which is a real
 * finding, because it rules two whole classes out.
 *
 * These are necessary conditions and not sufficient ones. The tool lists what
 * fits the arithmetic; it never says it has found the cause.
 */
export function trialBalanceDiagnostics(
  differenceMinor: number,
  decimals: number,
): ProResult<BalanceDiagnostics> {
  if (!isIntegerIn(decimals, 0, 4)) return fail("decimals");
  if (!Number.isSafeInteger(differenceMinor)) return fail("difference");
  // No item list in this entry point, so there is no largest-entered-item bound
  // to apply — the full representable range is searched, same as before.
  return { ok: true, ...diagnose(differenceMinor, 10 ** decimals, MAX_DIGIT_POSITION) };
}

/** Every (larger, smaller) digit pair whose difference is exactly `gap`. */
function digitPairsForGap(gap: number): DigitPair[] {
  const pairs: DigitPair[] = [];
  for (let smaller = 0; smaller <= 9 - gap; smaller += 1) {
    pairs.push({ larger: smaller + gap, smaller });
  }
  return pairs;
}

/**
 * @param maxPosition The highest digit position a swap may be proposed at,
 *   bounded by the largest amount actually entered — see `trialBalance`.
 *   Proposing a swap at a position no entered row could reach is not a finding.
 */
function diagnose(differenceMinor: number, unit: number, maxPosition: number): BalanceDiagnostics {
  const magnitude = Math.abs(differenceMinor);
  if (magnitude === 0) {
    return {
      difference: 0,
      magnitude: 0,
      balanced: true,
      reversedItem: undefined,
      transpositions: [],
      shiftedByTen: undefined,
      shiftedByHundred: undefined,
    };
  }

  const transpositions: TransposedDigits[] = [];
  for (let upper = 1; upper <= maxPosition; upper += 1) {
    const upperPlace = 10 ** upper;
    // The smallest step reachable at this position is the ADJACENT swap
    // (lower = upper − 1): 9 × 10^(upper−1). It only grows with `upper`, so
    // once even that step exceeds the magnitude nothing higher can match —
    // but the largest step at this position (lower = 0, `upperPlace − 1`) is
    // NOT that bound, and breaking on it stops the search one position too
    // early: 900 is reached only at upper = 3, lower = 2 (step 900), yet
    // upper = 3's largest step is 999 > 900, which used to abort the loop
    // before that smaller, valid step was ever tried.
    if (upperPlace - upperPlace / 10 > magnitude) break;
    for (let lower = 0; lower < upper; lower += 1) {
      const step = upperPlace - 10 ** lower;
      if (step > magnitude) continue;
      if (magnitude % step !== 0) continue;
      const gap = magnitude / step;
      // A digit gap outside 1..9 cannot be two decimal digits swapping places.
      if (gap < 1 || gap > 9) continue;
      transpositions.push({
        lowerPosition: lower,
        upperPosition: upper,
        digitGap: gap,
        step: step / unit,
        pairs: digitPairsForGap(gap),
      });
    }
  }

  return {
    difference: differenceMinor / unit,
    magnitude: magnitude / unit,
    balanced: false,
    reversedItem: magnitude % 2 === 0 ? magnitude / 2 / unit : undefined,
    transpositions,
    // 10x − x = 9x and 100x − x = 99x: the same divisibility, one place further.
    shiftedByTen: magnitude % 9 === 0 ? magnitude / 9 / unit : undefined,
    shiftedByHundred: magnitude % 99 === 0 ? magnitude / 99 / unit : undefined,
  };
}

export interface TrialBalanceInput {
  readonly debits: readonly number[];
  readonly credits: readonly number[];
  readonly decimals: number;
}

/**
 * Both sides added in whole minor units, their difference, and the diagnostics
 * that difference admits.
 *
 * Summed as integers because 0.1 + 0.2 is not 0.3: a control total that is out
 * by a hundredth of a para because of the addition itself would send someone
 * looking for a posting that does not exist.
 */
export function trialBalance(input: TrialBalanceInput): ProResult<TrialBalance> {
  const { debits, credits, decimals } = input;
  if (!isIntegerIn(decimals, 0, 4)) return fail("decimals");
  if (debits.length > BALANCE_MAX_ROWS || credits.length > BALANCE_MAX_ROWS) {
    return fail("tooManyRows");
  }
  if (debits.some((value) => !Number.isFinite(value))) return fail("debits");
  if (credits.some((value) => !Number.isFinite(value))) return fail("credits");

  const unit = 10 ** decimals;
  const toMinor = (values: readonly number[]): number =>
    values.reduce((sum, value) => sum + roundHalfUp(value * unit, 0), 0);
  const debitMinor = toMinor(debits);
  const creditMinor = toMinor(credits);
  if (!Number.isSafeInteger(debitMinor)) return fail("debits");
  if (!Number.isSafeInteger(creditMinor)) return fail("credits");

  // A swap can only be proposed at a digit position the LARGEST entered row
  // could actually reach — a schedule of amounts under 10.000 admits no
  // candidate at the hundred-thousands place, however the arithmetic works out.
  const largestItemMinor = [...debits, ...credits].reduce(
    (max, value) => Math.max(max, Math.abs(roundHalfUp(value * unit, 0))),
    0,
  );
  // A number with L digits occupies positions 0..L−1 (0 = its own last digit),
  // so the highest position a swap can use is L−1, not L.
  const maxPosition =
    largestItemMinor <= 0 ? 0 : Math.min(MAX_DIGIT_POSITION, String(largestItemMinor).length - 1);

  return {
    ok: true,
    debitTotal: debitMinor / unit,
    creditTotal: creditMinor / unit,
    debitCount: debits.length,
    creditCount: credits.length,
    diagnostics: diagnose(debitMinor - creditMinor, unit, maxPosition),
  };
}

/* --------------------------------------------------------------- tvm-solver */

export type TvmUnknown = "pv" | "fv" | "pmt" | "periods" | "rate";
/** Payment at the end of the period, or at its start (prenumerando). */
export type PaymentTiming = "end" | "begin";

export interface TvmInput {
  /** Sign convention throughout: an inflow is positive, an outflow negative. */
  readonly pv: number;
  readonly fv: number;
  readonly pmt: number;
  readonly periods: number;
  /** Periodic rate in % per period — not annual, unless the period is a year. */
  readonly ratePercent: number;
  readonly timing: PaymentTiming;
  readonly solveFor: TvmUnknown;
}

export interface TvmResult {
  readonly pv: number;
  readonly fv: number;
  readonly pmt: number;
  readonly periods: number;
  readonly ratePercent: number;
  /** The solved quantity, repeated so the surface need not switch on the choice. */
  readonly solved: number;
  /** The base equation at the answer; it must be zero to within 1e−9. */
  readonly residual: number;
}

/** The base equation: PV + PMT·k·(1 − (1+i)^(−n))/i + FV·(1+i)^(−n) = 0. */
function tvmResidual(
  pv: number,
  fv: number,
  pmt: number,
  periods: number,
  rate: number,
  timing: PaymentTiming,
): number {
  if (Math.abs(rate) < 1e-12) return pv + pmt * periods + fv;
  const due = timing === "begin" ? 1 + rate : 1;
  const discount = Math.exp(-periods * Math.log1p(rate));
  return pv + (pmt * due * (1 - discount)) / rate + fv * discount;
}

/** Sign changes in the cash-flow sequence, ignoring the zeroes. */
function signChanges(flows: readonly number[]): number {
  let changes = 0;
  let previous = 0;
  for (const flow of flows) {
    const sign = Math.sign(flow);
    if (sign === 0) continue;
    if (previous !== 0 && sign !== previous) changes += 1;
    previous = sign;
  }
  return changes;
}

/**
 * The fifth of PV, FV, PMT, n and i from the other four.
 *
 * **i = 0 is a separate branch, not a limit taken numerically.** The annuity
 * factor `(1 − (1+i)^(−n))/i` is 0/0 at zero, and an interest-free plan is an
 * ordinary thing to compute — so it is the plain `PV + PMT·n + FV = 0`.
 *
 * **The rate is found by bisection and only where a root must exist.** When the
 * cash flows change sign exactly once, Descartes' rule leaves at most one
 * positive root and the equation is monotone across it. When they do not, there
 * may be several roots or none, and the tool refuses rather than return whichever
 * one a search happened to land on — an answer that looks like a rate and means
 * nothing is worse than no answer.
 */
export function tvmSolve(input: TvmInput): ProResult<TvmResult> {
  const { pv, fv, pmt, periods, ratePercent, timing, solveFor } = input;
  const known = {
    pv: solveFor !== "pv",
    fv: solveFor !== "fv",
    pmt: solveFor !== "pmt",
    periods: solveFor !== "periods",
    rate: solveFor !== "rate",
  };
  if (known.pv && !Number.isFinite(pv)) return fail("pv");
  if (known.fv && !Number.isFinite(fv)) return fail("fv");
  if (known.pmt && !Number.isFinite(pmt)) return fail("pmt");
  if (known.periods && !isInRange(periods, 0, 1200)) return fail("periods");
  if (known.rate && !(Number.isFinite(ratePercent) && ratePercent > -100)) return fail("rate");

  const rate = ratePercent / 100;
  const due = timing === "begin" ? 1 + rate : 1;
  const zeroRate = known.rate && Math.abs(rate) < 1e-12;

  let solvedPv = pv;
  let solvedFv = fv;
  let solvedPmt = pmt;
  let solvedPeriods = periods;
  let solvedRate = rate;

  if (solveFor === "pv") {
    solvedPv = zeroRate
      ? -(pmt * periods + fv)
      : -((pmt * due * (1 - Math.exp(-periods * Math.log1p(rate)))) / rate +
          fv * Math.exp(-periods * Math.log1p(rate)));
  } else if (solveFor === "fv") {
    const growth = Math.exp(periods * Math.log1p(rate));
    solvedFv = zeroRate ? -(pv + pmt * periods) : -(pv * growth + (pmt * due * (growth - 1)) / rate);
  } else if (solveFor === "pmt") {
    if (zeroRate) {
      if (!isPositive(periods)) return fail("periods");
      solvedPmt = -(pv + fv) / periods;
    } else {
      const growth = Math.exp(periods * Math.log1p(rate));
      const factor = due * (growth - 1);
      if (factor === 0) return fail("periods");
      solvedPmt = (-(pv * growth + fv) * rate) / factor;
    }
  } else if (solveFor === "periods") {
    if (zeroRate) {
      if (pmt === 0) return fail("pmt");
      solvedPeriods = -(pv + fv) / pmt;
    } else if (pmt === 0) {
      const ratio = -fv / pv;
      if (!(ratio > 0)) return fail("cashflows");
      solvedPeriods = Math.log(ratio) / Math.log1p(rate);
    } else {
      const annuityValue = (pmt * due) / rate;
      const ratio = (annuityValue - fv) / (annuityValue + pv);
      if (!(ratio > 0)) return fail("cashflows");
      solvedPeriods = Math.log(ratio) / Math.log1p(rate);
    }
    if (!isInRange(solvedPeriods, 0, 1200)) return fail("periods");
  } else {
    if (!isPositive(periods)) return fail("periods");
    if (signChanges([pv, ...(pmt === 0 ? [] : [pmt]), fv]) !== 1) return fail("cashflows");
    let low = -0.999999;
    let high = 10;
    let atLow = tvmResidual(pv, fv, pmt, periods, low, timing);
    const atHigh = tvmResidual(pv, fv, pmt, periods, high, timing);
    if (!Number.isFinite(atLow) || !Number.isFinite(atHigh)) return fail("cashflows");
    // A root sitting exactly ON the search boundary (-99.9999% or +1000% per
    // period) is treated as OUT of the representable range rather than reported
    // as found: the search was never told the true root might be further out,
    // and returning the endpoint as an answer would hide that.
    if (atLow === 0 || atHigh === 0) return fail("rateOutOfRange");
    if (atLow * atHigh > 0) return fail("cashflows");
    // Descartes' rule of signs, applied to the polynomial in v = 1/(1+i): the
    // cash-flow sequence changes sign exactly once, so it has at most one
    // positive root in v, i.e. at most one root in i above -100%. Combined with
    // the opposite-sign check above, bisection converges to THE root, not to
    // whichever one it happened to land near.
    //
    // ~44 halvings already shrink (10 - (-0.999999)) below 1e-12, which is
    // beyond what a double can resolve further — the loop bound is a safety
    // margin over that, not the actual stopping rule; the width and residual
    // checks below are.
    for (let step = 0; step < 100 && high - low > 1e-12; step += 1) {
      const middle = (low + high) / 2;
      const atMiddle = tvmResidual(pv, fv, pmt, periods, middle, timing);
      if (!Number.isFinite(atMiddle)) return fail("cashflows");
      if (atMiddle === 0 || Math.abs(atMiddle) < 1e-12) {
        low = middle;
        high = middle;
        break;
      }
      if (atMiddle < 0 === atLow < 0) {
        low = middle;
        atLow = atMiddle;
      } else {
        high = middle;
      }
    }
    solvedRate = (low + high) / 2;
  }

  const solved =
    solveFor === "pv"
      ? solvedPv
      : solveFor === "fv"
        ? solvedFv
        : solveFor === "pmt"
          ? solvedPmt
          : solveFor === "periods"
            ? solvedPeriods
            : 100 * solvedRate;
  if (!Number.isFinite(solved)) return fail("cashflows");

  return {
    ok: true,
    pv: solvedPv,
    fv: solvedFv,
    pmt: solvedPmt,
    periods: solvedPeriods,
    ratePercent: 100 * solvedRate,
    solved,
    residual: tvmResidual(solvedPv, solvedFv, solvedPmt, solvedPeriods, solvedRate, timing),
  };
}
