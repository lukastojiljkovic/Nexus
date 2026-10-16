/**
 * The Serbian numeral words both pro packs spell amounts with, and the rule that
 * picks a noun's form after a count. One copy, so the two packs cannot drift.
 *
 * Source: Pravopis srpskoga jezika, Matica srpska, izmenjeno i dopunjeno izdanje
 * (2010). This is the lexical table of the language, which no rule-maker revises,
 * which is why it is embedded where a rate never would be.
 *
 * The scale words (hiljada, milion, milijarda) stay with each pack: the packs
 * spell a group of one differently, and that is a convention of the pack, not of
 * the language.
 */

const UNIT_WORDS = [
  "nula", "jedan", "dva", "tri", "četiri", "pet", "šest", "sedam", "osam", "devet",
  "deset", "jedanaest", "dvanaest", "trinaest", "četrnaest", "petnaest", "šesnaest",
  "sedamnaest", "osamnaest", "devetnaest",
] as const;

const TEN_WORDS = [
  "", "", "dvadeset", "trideset", "četrdeset", "pedeset", "šezdeset", "sedamdeset",
  "osamdeset", "devedeset",
] as const;

const HUNDRED_WORDS = [
  "", "sto", "dvesta", "trista", "četiristo", "petsto", "šeststo", "sedamsto",
  "osamsto", "devetsto",
] as const;

/** Grammatical gender of the counted noun, as far as the units group needs it. */
export type NumeralGender = "masculine" | "feminine" | "neuter";

/**
 * The agreement class a count puts its noun in: singular, paucal (2–4) or plural.
 *
 * Decided by the last two digits, not the last one: 11 takes the plural like 5,
 * not the singular like 1, and 12–14 are excluded from the paucal however the last
 * digit reads.
 */
export function agreementOf(count: number): "singular" | "paucal" | "plural" {
  const unit = count % 10;
  const lastTwo = count % 100;
  if (unit === 1 && lastTwo !== 11) return "singular";
  if (unit >= 2 && unit <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return "paucal";
  return "plural";
}

/** 0–19 in words. Only 1 and 2 inflect for gender; 11 and 12 are single words that never do. */
export function unitWord(value: number, gender: NumeralGender): string {
  if (value === 1) {
    if (gender === "feminine") return "jedna";
    if (gender === "neuter") return "jedno";
  }
  if (gender === "feminine" && value === 2) return "dve";
  return UNIT_WORDS[value] ?? "";
}

/**
 * 0–999 as one word per element, so a caller joins them with spaces or with
 * nothing at all. The trailing unit takes `gender`.
 */
export function groupWords(value: number, gender: NumeralGender): string[] {
  const words: string[] = [];
  const hundreds = HUNDRED_WORDS[Math.floor(value / 100)] ?? "";
  if (hundreds !== "") words.push(hundreds);
  const rest = value % 100;
  if (rest > 0 && rest < 20) {
    words.push(unitWord(rest, gender));
    return words;
  }
  const tens = TEN_WORDS[Math.floor(rest / 10)] ?? "";
  if (tens !== "") words.push(tens);
  const unit = rest % 10;
  if (unit > 0) words.push(unitWord(unit, gender));
  return words;
}
