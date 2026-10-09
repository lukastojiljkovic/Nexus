/**
 * COOK's unit vocabulary and the arithmetic that is allowed across it.
 *
 * **Three families, and a conversion never crosses one.** Mass (grams and
 * kilograms), volume (millilitres, litres and the four US customary kitchen
 * measures) and COUNT (a clove, a pinch, a packet) are different kinds of
 * quantity, and the module refuses to turn one into another. Mass and volume
 * are the case that matters: the millilitre of flour and the gram of flour are
 * different amounts, the ratio between them is a DENSITY, and this module
 * carries no densities at all — see `nutrition.ts` for what that costs and why
 * paying it is cheaper than shipping a table of numbers nobody can re-check.
 *
 * **The US customary measures are defined EXACTLY, from NIST.** 1 in = 25.4 mm
 * exactly (the 1959 international yard and pound agreement), 1 US gallon =
 * 231 in³ exactly (NIST Handbook 44, Appendix C), so
 *
 *   1 gal = 231 × 25.4³ mm³ = 3.785 411 784 L exactly
 *   1 fl oz = 3.785 411 784 / 128 L = 29.573 529 5625 mL exactly
 *   1 tsp = 1/6 fl oz = 4.928 921 593 75 mL exactly
 *   1 tbsp = 1/2 fl oz = 14.786 764 781 25 mL exactly
 *   1 cup = 8 fl oz = 236.588 2365 mL exactly
 *
 * Those decimals are the whole reason the table below is written in ticks of
 * 10⁻¹¹ mL rather than as floating-point factors: every one of the numbers above
 * terminates within eleven decimal places, so each is an exact integer in
 * 10⁻¹¹ mL and a conversion between two of them is one integer division — exact
 * whenever the answer is representable. `tsp → tbsp` is therefore 1/3 correctly
 * rounded and `3 tsp → tbsp` is exactly 1, where multiplying by two
 * double-precision factors gives 0.33333333333333337 and 1 by luck. Mass is
 * counted the same way, in milligrams, where `g` and `kg` are the exact integers
 * 1000 and 1 000 000.
 *
 * The products stay exact for every quantity a recipe actually holds — a
 * quantity is bounded by the store, and the widest tick here (~2.4 × 10¹³, the
 * cup) keeps `value × tick` under 2⁵³ for any value below about 380, i.e. 90
 * litres. Past that the arithmetic is correctly rounded rather than exact, and
 * the input is not a recipe.
 *
 * Nothing here reads a clock, touches a DOM or imports `node:` anything.
 */

/** The metric mass units. The base is the gram. */
export const MASS_UNITS = ["g", "kg"] as const;

/**
 * Millilitres, litres, and the four US customary measures a Serbian kitchen
 * writes as kašičica/kašika/šolja. The litre is metric; the rest are the NIST
 * definitions in the file header.
 */
export const VOLUME_UNITS = ["ml", "l", "tsp", "tbsp", "cup", "fl_oz"] as const;

/**
 * The units that count THINGS. `pinch` and `clove` are here rather than in a
 * fourth family because there is nothing to convert between them at all: the
 * family exists to say which units may be SUMMED, and two counts are summable
 * only when they are the same count.
 *
 * Closed on purpose. An unknown unit is refused by the store rather than
 * carried, which is what stops a shopping list from growing a line it can never
 * merge or convert — the same argument `FOOD_CATEGORIES` makes.
 */
export const COUNT_UNITS = [
  "pinch",
  "dash",
  "clove",
  "piece",
  "slice",
  "sprig",
  "stalk",
  "head",
  "bunch",
  "handful",
  "stick",
  "sheet",
  "can",
  "packet",
  "cube",
] as const;

/** Every unit an ingredient line may carry. Closed; `units.ts`'s own test pins the three families against it. */
export const INGREDIENT_UNITS = [...MASS_UNITS, ...VOLUME_UNITS, ...COUNT_UNITS] as const;

export type MassUnit = (typeof MASS_UNITS)[number];
export type VolumeUnit = (typeof VOLUME_UNITS)[number];
export type CountUnit = (typeof COUNT_UNITS)[number];
export type IngredientUnit = (typeof INGREDIENT_UNITS)[number];

export type UnitFamily = "mass" | "volume" | "count";

/**
 * How many ticks one of each unit is, within its own family — milligrams for
 * mass, 10⁻¹¹ mL for volume. See the file header for the derivation.
 *
 * A count unit has no tick: it is not convertible with anything but itself, and
 * a number here would invite exactly the arithmetic the family exists to refuse.
 */
const TICKS: Readonly<Record<MassUnit | VolumeUnit, number>> = {
  g: 1_000,
  kg: 1_000_000,
  ml: 100_000_000_000,
  l: 100_000_000_000_000,
  tsp: 492_892_159_375,
  tbsp: 1_478_676_478_125,
  cup: 23_658_823_650_000,
  fl_oz: 2_957_352_956_250,
};

const FAMILY_BY_UNIT: Readonly<Record<IngredientUnit, UnitFamily>> = {
  g: "mass",
  kg: "mass",
  ml: "volume",
  l: "volume",
  tsp: "volume",
  tbsp: "volume",
  cup: "volume",
  fl_oz: "volume",
  pinch: "count",
  dash: "count",
  clove: "count",
  piece: "count",
  slice: "count",
  sprig: "count",
  stalk: "count",
  head: "count",
  bunch: "count",
  handful: "count",
  stick: "count",
  sheet: "count",
  can: "count",
  packet: "count",
  cube: "count",
};

/** Which family a unit belongs to — what decides whether two lines may be summed. */
export function unitFamily(unit: IngredientUnit): UnitFamily {
  return FAMILY_BY_UNIT[unit];
}

/** Whether an untrusted string is one of the units this module ships. */
export function isIngredientUnit(value: string): value is IngredientUnit {
  return Object.hasOwn(FAMILY_BY_UNIT, value);
}

/**
 * Whether two units may be merged into one line. A missing unit is a count of
 * pieces, and it merges only with another missing one: `2 eggs` and `3 eggs` are
 * five eggs, while `2 eggs` and `3 cloves` are not a quantity of anything.
 */
export function compatibleUnits(
  a: IngredientUnit | null,
  b: IngredientUnit | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const family = unitFamily(a);
  return family === unitFamily(b) && family !== "count";
}

/**
 * `value` expressed in `to`, or null when that is not a question this module
 * answers — different families, or either side a count.
 *
 * Throws on a value that is not a finite number rather than coercing it:
 * every caller validates its input first, so a bad quantity arriving here is a
 * programming error and quietly answering zero would hide it inside a sum.
 */
export function convertQuantity(
  value: number,
  from: IngredientUnit | null,
  to: IngredientUnit | null,
): number | null {
  if (!Number.isFinite(value)) {
    throw new RangeError(`"value" must be a finite number (got ${String(value)}).`);
  }
  if (from === to) return value;
  if (from === null || to === null) return null;
  const family = unitFamily(from);
  if (family !== unitFamily(to) || family === "count") return null;
  return (value * TICKS[from as MassUnit | VolumeUnit]) / TICKS[to as MassUnit | VolumeUnit];
}
