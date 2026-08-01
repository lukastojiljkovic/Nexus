/**
 * The everyday calculators behind UTIL's tool drawer — percentage, Serbian PDV,
 * a loan annuity and a unit-price comparison. Pure arithmetic: no clock, no
 * storage, no formatting, and nothing here rounds (`roundForDisplay` is the
 * surface's separate step).
 *
 * **Every function answers `null` rather than a number it cannot stand behind.**
 * The divisions in here all have a real zero case — „koliko procenata od nule",
 * a package with no quantity, an interest-free annuity — and each one is a
 * question with no answer rather than a number to invent. `Infinity` and `NaN`
 * never leave this module, so a surface never has to decide what they meant.
 */

/** The general PDV rate — Serbian VAT, Zakon o PDV-u. */
export const PDV_RATE_STANDARD = 20;

/** The special (reduced) PDV rate, on the goods the law lists — bread, milk, medicines, books and the rest. */
export const PDV_RATE_REDUCED = 10;

/**
 * The two rates that exist, in the order a form offers them. There is no third:
 * a „custom rate" field would invite a number the law does not have, and this
 * app does not ship invented data.
 */
export const PDV_RATES: readonly number[] = [PDV_RATE_STANDARD, PDV_RATE_REDUCED];

/** Whether every one of these is a real, finite number — the guard in front of every division below. */
function allFinite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

/** `percent`% of `value` — „koliko je 20% od 250". */
export function percentOf(percent: number, value: number): number | null {
  if (!allFinite(percent, value)) return null;
  return (value * percent) / 100;
}

/**
 * What percentage `part` is of `whole` — „50 je koliko % od 250".
 *
 * A zero `whole` has no answer: every number is „0% of nothing" and none of
 * them is, so the tool says it has none rather than rendering an infinity.
 */
export function whatPercent(part: number, whole: number): number | null {
  if (!allFinite(part, whole) || whole === 0) return null;
  return (part / whole) * 100;
}

/**
 * `value` raised (or lowered, for a negative `percent`) by `percent`% — the
 * „+20% / −20%" question.
 *
 * Written as „add the part to the whole" rather than as `value * (1 + p/100)`,
 * because the factor form builds an inexact multiplier first: 1 + 10/100 is
 * 1,100000000000000089 as a double, so 200 raised by 10% comes back
 * 220,00000000000003. Adding the part keeps the everyday cases exact.
 */
export function applyPercentChange(value: number, percent: number): number | null {
  if (!allFinite(value, percent)) return null;
  return value + (value * percent) / 100;
}

/**
 * The percentage change from `from` to `to` — „za koliko procenata je poraslo".
 *
 * Deliberately distinct from `whatPercent`, which the two are constantly
 * confused for: 200 → 220 is a 10% CHANGE, while 220 is 110% OF 200. Both
 * questions get asked of the same pair of numbers and they have different
 * answers, so the drawer offers them as two named things rather than one.
 *
 * A change measured from zero has no percentage — there is nothing for the
 * difference to be a proportion of.
 */
export function percentChange(from: number, to: number): number | null {
  if (!allFinite(from, to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

/** A price split into its net, its PDV and its gross. `net + vat === gross` for both directions. */
export interface VatBreakdown {
  net: number;
  vat: number;
  gross: number;
  /** The rate this split was made at, carried so the surface can state it beside the figures. */
  rate: number;
}

/** Shared guard: a price is a non-negative finite amount, a rate a non-negative finite percentage. */
function validVatInput(amount: number, rate: number): boolean {
  return allFinite(amount, rate) && amount >= 0 && rate >= 0;
}

/** PDV ADDED to a net price — the invoice direction. */
export function addVat(net: number, rate: number): VatBreakdown | null {
  if (!validVatInput(net, rate)) return null;
  const vat = (net * rate) / 100;
  return { net, vat, gross: net + vat, rate };
}

/**
 * PDV taken OUT of a gross price — the direction a shopkeeper needs more often,
 * because the number they have is the one on the shelf.
 *
 * The reason this is a tool at all is that the everyday shortcut — taking 20%
 * OF the gross — is wrong: on a 1 200 din. label it gives 240 rather than the
 * true 200, because the 20% was charged on the net 1 000, not on the total.
 * Getting that backwards overstates the tax on every receipt it is used for.
 *
 * Divided as `gross · 100 / (100 + rate)` rather than by `1 + rate/100`, for
 * `applyPercentChange`'s reason: the latter builds an inexact 1,1 first and
 * turns a clean 1 100 din. gross into a net of 999,9999999999999.
 */
export function extractVat(gross: number, rate: number): VatBreakdown | null {
  if (!validVatInput(gross, rate)) return null;
  const net = (gross * 100) / (100 + rate);
  return { net, vat: gross - net, gross, rate };
}

/** What a loan calculation is asked. */
export interface LoanTerms {
  /** The amount borrowed, in whatever currency the caller is working in — this module never names one. */
  principal: number;
  /** The NOMINAL annual interest rate as a percentage (Serbian „nominalna kamatna stopa", NKS). */
  annualRatePercent: number;
  /** The number of monthly instalments; a whole number, because a loan does not run half a month. */
  months: number;
}

export interface LoanPlan {
  monthlyPayment: number;
  totalPaid: number;
  totalInterest: number;
  /** The monthly rate actually used — reported so a figure can be checked rather than trusted. */
  monthlyRate: number;
  months: number;
}

/**
 * The equal monthly instalment of an annuity loan, and what it costs in total.
 *
 * **The convention this assumes, stated because an annuity figure that does not
 * say what it assumed is a number nobody can verify:**
 *
 * - `annualRatePercent` is the NOMINAL annual rate (NKS). The monthly rate is
 *   that divided by twelve — `i = r / 100 / 12` — which is the proportional
 *   convention Serbian banks quote instalments under. It is NOT the effective
 *   monthly equivalent `(1 + r)^(1/12) − 1`; that convention gives a slightly
 *   smaller instalment, and mixing the two is the usual reason two calculators
 *   disagree about the same loan.
 * - Interest compounds MONTHLY, at the same frequency as the payments.
 * - Payments are made at the END of each period (an ordinary annuity, „u
 *   dospeću"), every one of them equal, with the loan fully repaid by the last.
 * - There are NO fees: no origination charge, no insurance, no account cost, no
 *   currency clause. This is therefore not the EKS (the effective rate a bank
 *   must advertise), and the total here will be lower than a real offer's.
 *   A user comparing the two should expect that difference and know why.
 *
 * The closed form is `A = P · i / (1 − (1 + i)^−n)`, with the `i = 0` case
 * handled separately — at a zero rate that denominator is itself zero, so the
 * formula would answer `NaN` on the interest-free loan somebody is most likely
 * to try first.
 */
export function annuityPlan(terms: LoanTerms): LoanPlan | null {
  const { principal, annualRatePercent, months } = terms;
  if (!allFinite(principal, annualRatePercent, months)) return null;
  if (principal <= 0 || annualRatePercent < 0) return null;
  if (!Number.isInteger(months) || months < 1) return null;

  const monthlyRate = annualRatePercent / 100 / 12;
  const monthlyPayment =
    monthlyRate === 0
      ? principal / months
      : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
  const totalPaid = monthlyPayment * months;

  return {
    monthlyPayment,
    totalPaid,
    totalInterest: totalPaid - principal,
    monthlyRate,
    months,
  };
}

/** One package in a „koje pakovanje je jeftinije" comparison. */
export interface PackageOffer {
  /** The caller's own handle for this row — this module neither reads nor orders by it. */
  id: string;
  price: number;
  /**
   * How much is in the package, in a unit the CALLER has already made common
   * across the comparison. This module does no unit conversion: 500 g against
   * 1 kg is `convertUnit`'s job, and doing it here would let two rows be
   * compared in units that were never reconciled.
   */
  quantity: number;
}

export interface UnitPriceRow extends PackageOffer {
  unitPrice: number;
  /** True for every row that ties for the lowest unit price, not just the first one found. */
  cheapest: boolean;
  /** How much dearer per unit this row is than the cheapest, as a percentage; 0 on the cheapest rows. */
  premiumPercent: number;
}

/**
 * The packages ranked by price per unit, cheapest first, each told how much
 * dearer it is than the cheapest.
 *
 * Returns `null` if ANY row is unusable rather than silently dropping it: a
 * comparison that quietly left out one of the three packages the user entered
 * would answer a question they did not ask. A quantity of zero has no unit
 * price, and a price of zero makes every comparison against it infinite — both
 * are refusals rather than rows.
 *
 * Ties keep their input order (the sort is stable) and every tied row is marked
 * cheapest, because „these two are the same value" is the honest answer and
 * picking one of them would be an invention.
 */
export function compareUnitPrices(offers: readonly PackageOffer[]): UnitPriceRow[] | null {
  if (offers.length === 0) return null;
  for (const offer of offers) {
    if (!allFinite(offer.price, offer.quantity)) return null;
    if (offer.quantity <= 0 || offer.price <= 0) return null;
  }

  const ranked = offers
    .map((offer) => ({ ...offer, unitPrice: offer.price / offer.quantity }))
    .sort((left, right) => left.unitPrice - right.unitPrice);

  // Non-null by construction: `ranked` has at least one row, and every unit
  // price above is a positive finite number.
  const cheapest = ranked[0]!.unitPrice;

  return ranked.map((row) => ({
    ...row,
    cheapest: row.unitPrice === cheapest,
    premiumPercent: (row.unitPrice / cheapest - 1) * 100,
  }));
}
