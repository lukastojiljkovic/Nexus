/**
 * The unit table behind UTIL's converters — pure arithmetic, no formatting and
 * no clock.
 *
 * **A unit is a FUNCTION PAIR, never a scale factor.** The obvious model for a
 * converter is a table of „multiply by this to reach the base", and it is wrong
 * for one of the seven kinds here: temperature scales have an OFFSET, so 0 °C is
 * 32 °F rather than 0 °F, and no factor can say that. A factor table would not
 * fail loudly on it either — it would quietly answer 0, which is the worst way
 * for a converter to be wrong. So every unit carries `toBase`/`fromBase`, and
 * `ratio` builds that pair from a factor for the six kinds where one is enough.
 * The awkward case sets the shape of the model; it does not get an exception
 * bolted onto the side of it.
 *
 * **Base units, one per kind:** metre, kilogram, litre, degree Celsius, square
 * metre, metre per second, byte. Celsius rather than Kelvin because it is what
 * this app's users type; the pair makes the choice free either way.
 *
 * **Nothing here rounds.** `convertUnit` returns the exact double the arithmetic
 * produced, and `roundForDisplay` is a separate, explicit step — a model that
 * rounded on the way through would lose value on every hop of a round trip.
 *
 * **There is no currency here, and there is not going to be.** Converting money
 * between currencies is something this product deliberately does not do
 * (founder decision): multi-currency in Nexus means each currency is tracked on
 * its own terms, never reduced to one. An exchange rate an offline app cannot
 * verify is a number that silently misstates money, which is the most damaging
 * kind of fabricated data a life-management app could ship — so FIN holds no
 * rate at all (migration 051), refuses a cross-currency transfer, makes the
 * question unaskable on the wire, and says so to the user in as many words
 * („Nexus nema kurs"). What this table converts are PHYSICAL quantities, where
 * a metre is a metre in every country and on every day. Money is not one of
 * those, and that is the whole distinction. Nothing here is awaiting a currency
 * kind: there is no seam for one because there is no plan for one.
 *
 * **Ambiguous units are offered twice, never resolved by guessing.** kB and KiB
 * are different quantities (1000 vs 1024 bytes), and picking one silently makes
 * the converter wrong for whoever meant the other, on exactly the figure — a
 * disk size — where people notice. Both conventions are here, each tagged with
 * `convention` so the surface can label which is which. The US-only volume units
 * carry „(SAD)" in their Serbian names for the same reason: a US gallon is not
 * an imperial one.
 */

/** The seven kinds a converter tool is offered for. One base unit each; conversion never crosses a kind. */
export const UNIT_KINDS = [
  "length",
  "mass",
  "volume",
  "temperature",
  "area",
  "speed",
  "data",
] as const;

export type UnitKind = (typeof UNIT_KINDS)[number];

/** The two ways a „kilobyte" is counted. Only `data` units carry one. */
export const DATA_CONVENTIONS = ["decimal", "binary"] as const;

export type DataConvention = (typeof DATA_CONVENTIONS)[number];

export interface UnitDef {
  /** Stable ASCII id — a strings lookup key and a stored preference, never a label. */
  readonly id: string;
  readonly kind: UnitKind;
  /** This unit's value expressed in the kind's base unit. */
  readonly toBase: (value: number) => number;
  /** A base-unit value expressed in this unit. The exact inverse of `toBase`. */
  readonly fromBase: (value: number) => number;
  /** Which counting convention a `data` unit follows; absent everywhere else, where nothing is ambiguous this way. */
  readonly convention?: DataConvention;
}

/**
 * A unit that is `factor` base units — the pair every kind but temperature
 * needs. Written as a helper rather than as a `factor` field so the table has
 * ONE shape: a reader never has to check which of two mechanisms a given row
 * uses, and temperature is not a special case in the type.
 */
function ratio(id: string, kind: UnitKind, factor: number): UnitDef {
  return {
    id,
    kind,
    toBase: (value) => value * factor,
    fromBase: (value) => value / factor,
  };
}

/** A `data` unit, which is a ratio unit that also declares WHICH kilobyte it means. */
function dataUnit(id: string, factor: number, convention: DataConvention): UnitDef {
  return { ...ratio(id, "data", factor), convention };
}

const KIB = 1024;

/**
 * Every unit, grouped by kind. Order inside a kind is the order the surface
 * offers them in: metric ascending, then the non-metric ones a Serbian reader
 * still meets on packaging, in manuals and on the web.
 */
const UNITS: Readonly<Record<UnitKind, readonly UnitDef[]>> = {
  // Base: metre.
  length: [
    ratio("mm", "length", 0.001),
    ratio("cm", "length", 0.01),
    ratio("dm", "length", 0.1),
    ratio("m", "length", 1),
    ratio("km", "length", 1000),
    // Exact by definition (international yard and pound agreement, 1959).
    ratio("in", "length", 0.0254),
    ratio("ft", "length", 0.3048),
    ratio("yd", "length", 0.9144),
    ratio("mi", "length", 1609.344),
    ratio("nmi", "length", 1852),
  ],
  // Base: kilogram.
  mass: [
    ratio("mg", "mass", 0.000001),
    ratio("g", "mass", 0.001),
    ratio("dag", "mass", 0.01),
    ratio("kg", "mass", 1),
    ratio("t", "mass", 1000),
    // Exact by the same 1959 agreement: 1 lb = 0.453 592 37 kg.
    ratio("oz", "mass", 0.45359237 / 16),
    ratio("lb", "mass", 0.45359237),
  ],
  // Base: litre.
  volume: [
    ratio("ml", "volume", 0.001),
    ratio("cl", "volume", 0.01),
    ratio("dl", "volume", 0.1),
    ratio("l", "volume", 1),
    ratio("hl", "volume", 100),
    ratio("m3", "volume", 1000),
    // US liquid measures, named as such in Serbian: an imperial gallon is a
    // different quantity, and this converter does not guess which was meant.
    ratio("floz-us", "volume", 3.785411784 / 128),
    ratio("gal-us", "volume", 3.785411784),
  ],
  // Base: degree Celsius. The kind the function pair exists for.
  temperature: [
    { id: "degc", kind: "temperature", toBase: (v) => v, fromBase: (v) => v },
    {
      id: "degf",
      kind: "temperature",
      toBase: (v) => ((v - 32) * 5) / 9,
      fromBase: (v) => (v * 9) / 5 + 32,
    },
    {
      id: "k",
      kind: "temperature",
      toBase: (v) => v - 273.15,
      fromBase: (v) => v + 273.15,
    },
  ],
  // Base: square metre.
  area: [
    ratio("mm2", "area", 0.000001),
    ratio("cm2", "area", 0.0001),
    ratio("m2", "area", 1),
    ratio("ar", "area", 100),
    ratio("ha", "area", 10_000),
    ratio("km2", "area", 1_000_000),
    ratio("ft2", "area", 0.3048 * 0.3048),
    ratio("ac", "area", 4046.8564224),
  ],
  // Base: metre per second.
  speed: [
    ratio("ms", "speed", 1),
    ratio("kmh", "speed", 1000 / 3600),
    ratio("mph", "speed", 1609.344 / 3600),
    ratio("kn", "speed", 1852 / 3600),
  ],
  // Base: byte. Both conventions, each said out loud.
  data: [
    ratio("bit", "data", 1 / 8),
    ratio("byte", "data", 1),
    dataUnit("kb-dec", 1000, "decimal"),
    dataUnit("mb-dec", 1000 ** 2, "decimal"),
    dataUnit("gb-dec", 1000 ** 3, "decimal"),
    dataUnit("tb-dec", 1000 ** 4, "decimal"),
    dataUnit("kib", KIB, "binary"),
    dataUnit("mib", KIB ** 2, "binary"),
    dataUnit("gib", KIB ** 3, "binary"),
    dataUnit("tib", KIB ** 4, "binary"),
  ],
};

/** Every unit of one kind, in the order a surface should offer them. */
export function unitsOfKind(kind: UnitKind): readonly UnitDef[] {
  return UNITS[kind];
}

const BY_ID = new Map<string, UnitDef>(
  UNIT_KINDS.flatMap((kind) => UNITS[kind].map((unit) => [unit.id, unit] as const)),
);

/** The unit an id names, or `undefined` — ids are unique across the whole table, so a kind is never needed to resolve one. */
export function findUnit(id: string): UnitDef | undefined {
  return BY_ID.get(id);
}

/** The one kind measured on an INTERVAL scale rather than a ratio scale — see `isRatioUnit`. */
const INTERVAL_KINDS: ReadonlySet<UnitKind> = new Set<UnitKind>(["temperature"]);

/**
 * Whether a unit measures on a RATIO scale — one with a true zero, where
 * doubling the number doubles the quantity. True for everything here but
 * temperature, and a caller that wants to scale, sum or average a figure needs
 * to know it: „twice 10 °C" is not 20 °C in any physical sense, so the tools
 * that do proportional arithmetic (unit price, percentage) must refuse those
 * units rather than produce a number that reads fine and means nothing.
 *
 * **This is a fact about the KIND, not about the unit's own pair.** The
 * tempting implementation is `unit.toBase(0) === 0` — „on a ratio scale zero
 * maps to zero" — and it is wrong here for the one unit it matters most for:
 * Celsius IS this kind's base, so its pair is the identity and it would report
 * itself a ratio unit, which is exactly the claim that makes „20 °C is twice as
 * warm as 10 °C" sound true. What that test actually detects is whether a unit
 * is offset from the base we happened to choose, and had the base been Kelvin
 * it would have labelled a different member of the same scale. Ratio-ness is a
 * property of what is being measured, so it is read off the kind.
 */
export function isRatioUnit(unit: UnitDef): boolean {
  return !INTERVAL_KINDS.has(unit.kind);
}

/**
 * `value` expressed in another unit, or `null` when the question has no answer:
 * an unknown id, two units of DIFFERENT kinds, or a value that is not a finite
 * number. Refusing is the whole point — a single shared base with one factor
 * table would gladly turn kilograms into metres.
 *
 * The result is exact rather than rounded; `roundForDisplay` is the caller's
 * separate, deliberate step.
 */
export function convertUnit(value: number, fromId: string, toId: string): number | null {
  if (!Number.isFinite(value)) return null;
  const from = BY_ID.get(fromId);
  const to = BY_ID.get(toId);
  if (from === undefined || to === undefined || from.kind !== to.kind) return null;
  if (from === to) return value;
  return to.fromBase(from.toBase(value));
}

/** Significant digits a converted figure is shown to — see `roundForDisplay`. */
export const TOOL_DISPLAY_PRECISION = 12;

/**
 * A figure rounded for DISPLAY, at `precision` significant digits.
 *
 * Significant digits rather than decimal places, because one converter spans
 * both 0,000001 (a milligram in kilograms) and 1 073 741 824 (a gibibyte in
 * bytes), and any fixed number of decimals is wrong at one end or the other.
 *
 * Twelve by default: enough that a round trip through a distant unit comes back
 * to what was typed — 1,234 567 89 km → mm → km is exact to well past the
 * digits anyone entered — and few enough to clear the float noise that makes a
 * correct conversion look broken (0,1 + 0,2 printing as 0,300 000 000 000 000 04).
 * A double carries about 15–17 significant digits, so twelve throws away only
 * the part that is already an artefact of binary floating point.
 *
 * Non-finite values pass through untouched: `NaN` is not a figure to round, and
 * a caller that has one has a refusal to render, not a number.
 */
export function roundForDisplay(value: number, precision = TOOL_DISPLAY_PRECISION): number {
  if (!Number.isFinite(value) || value === 0) return value;
  return Number(value.toPrecision(precision));
}
