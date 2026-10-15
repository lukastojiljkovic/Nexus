/**
 * The water and food a household needs for a number of days, from two
 * guidelines and one unit conversion.
 *
 * **The per-person figures are guidelines, not measurements.** Ready.gov's
 * „Water" page says „Store at least one gallon of water per person per day for
 * several days, for drinking and sanitation", and that a normally active person
 * needs „about three quarters of a gallon of fluid daily, from water and other
 * beverages". Both are printed there and are the figures below. Neither is a
 * measurement of anybody's body, and the result says so in its name: the
 * guideline total and the drinking floor are two numbers the page shows side by
 * side, not one number it pronounces enough.
 *
 * **Food is counted in person-days, not calories.** Ready.gov's basic kit list asks
 * for „at least a several-day supply of non-perishable food" and gives no energy
 * figure, and no
 * kilocalorie value is typed in here from memory. A person-day is the unit a
 * stock list can be checked against.
 *
 * **The gallon is the US gallon, converted by its exact definition.** One US
 * gallon is 3.785411784 litres by definition (NIST SP 811), so the conversion is
 * not an estimate.
 *
 * The people and day bounds are this module's policy, not a published figure:
 * the calculator is for a household and for the period the guidelines name
 * („several days"), and the bounds keep a mistyped number from producing a
 * figure nobody would buy.
 */

/** Litres in one US gallon, by definition (NIST SP 811). */
export const LITRES_PER_US_GALLON = 3.785411784;

/** Ready.gov, „Water": one gallon per person per day, for drinking and sanitation, for several days. A guideline. */
export const WATER_GALLONS_PER_PERSON_DAY = 1;

/** Ready.gov, „Water": a normally active person needs about three quarters of a gallon of fluid a day. A guideline. */
export const DRINKING_GALLONS_PER_PERSON_DAY = 0.75;

/** Policy: the calculator's household size. */
export const MIN_PEOPLE = 1;
export const MAX_PEOPLE = 20;

/** Policy: the calculator's period, in days. */
export const MIN_DAYS = 1;
export const MAX_DAYS = 30;

/** What a household needs, for the people and the days it was asked for. */
export interface RationPlan {
  readonly people: number;
  readonly days: number;
  /** One gallon per person per day, for drinking and sanitation, in litres. */
  readonly waterLitres: number;
  /** Three quarters of a gallon per person per day, the drinking floor, in litres. */
  readonly drinkingLitres: number;
  /** Non-perishable food, in person-days. */
  readonly foodPersonDays: number;
}

/** True for a whole number within `[min, max]`. */
export function isRationCount(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** The plan for a household, or null when either count is outside its bounds. */
export function rationPlan(people: number, days: number): RationPlan | null {
  if (!isRationCount(people, MIN_PEOPLE, MAX_PEOPLE)) return null;
  if (!isRationCount(days, MIN_DAYS, MAX_DAYS)) return null;
  const personDays = people * days;
  return {
    people,
    days,
    waterLitres: personDays * WATER_GALLONS_PER_PERSON_DAY * LITRES_PER_US_GALLON,
    drinkingLitres: personDays * DRINKING_GALLONS_PER_PERSON_DAY * LITRES_PER_US_GALLON,
    foodPersonDays: personDays,
  };
}
