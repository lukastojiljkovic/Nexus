/**
 * The everyday drawer's tools („Alatke") for the assistant: the seven converters,
 * the percentage tool, PDV, the loan and the unit-price comparison.
 *
 * Each runner calls the `@nexus/core` function its surface in `toolSurfaces.tsx`
 * calls, with the same argument order, so the figures agree by construction.
 * `pdv`, `kredit` and the converters name their inputs as the surface's own fields
 * are keyed (`principal`, `rate`, `months`, `value`, `from`, `to`, …), which is
 * what lets `drawer.open` prefill those fields. The percentage tool has four rows
 * and the unit-price tool a list, so those are run only, not prefilled.
 */

import {
  PDV_RATES,
  addVat,
  annuityPlan,
  applyPercentChange,
  compareUnitPrices,
  convertUnit,
  extractVat,
  percentChange,
  percentOf,
  unitsOfKind,
  whatPercent,
  type AssistantText,
  type UnitKind,
} from "@nexus/core";
import { asNumber } from "../args.js";
import { text } from "../support.js";
import { figure, money, quantity, type ToolRunner } from "./shared.js";

/** The largest magnitude an input may have: a bound on what the model may send, not a policy on the answer. */
const MAX_INPUT = 1e12;

const RESULT: AssistantText = { sr: "Rezultat", en: "Result" };

/** The seven converters: the registration id and the unit kind it converts. */
const CONVERTERS: readonly { readonly id: string; readonly kind: UnitKind }[] = [
  { id: "duzina", kind: "length" },
  { id: "masa", kind: "mass" },
  { id: "zapremina", kind: "volume" },
  { id: "temperatura", kind: "temperature" },
  { id: "povrsina", kind: "area" },
  { id: "brzina", kind: "speed" },
  { id: "podaci", kind: "data" },
];

function converter(kind: UnitKind): ToolRunner {
  const units = unitsOfKind(kind).map((unit) => unit.id);
  return {
    prefills: true,
    params: {
      type: "object",
      properties: {
        value: { type: "number", minimum: -MAX_INPUT, maximum: MAX_INPUT },
        from: { type: "string", enum: units },
        to: { type: "string", enum: units },
      },
      required: ["value", "from", "to"],
      additionalProperties: false,
    },
    run: (values, locale) => {
      const value = asNumber(values["value"], "value", -MAX_INPUT, MAX_INPUT);
      const to = String(values["to"]);
      const result = convertUnit(value, String(values["from"]), to);
      return result === null ? null : [figure(locale, RESULT, `${quantity(locale, result)} ${to}`)];
    },
  };
}

/**
 * The percentage tool's four rows. `first` and `second` are the two fields of the
 * row, in the order the row draws them; `unit` says whether the answer is a share.
 */
const PERCENT_OPERATIONS = {
  of: {
    label: { sr: "Procenat od vrednosti", en: "Percent of a value" },
    compute: percentOf,
    unit: false,
  },
  what: {
    label: { sr: "Koliko je procenata", en: "What percentage" },
    compute: whatPercent,
    unit: true,
  },
  apply: {
    label: { sr: "Vrednost posle promene", en: "Value after the change" },
    compute: applyPercentChange,
    unit: false,
  },
  change: {
    label: { sr: "Promena u procentima", en: "Percentage change" },
    compute: percentChange,
    unit: true,
  },
} as const;

type PercentOperation = keyof typeof PERCENT_OPERATIONS;

const percent: ToolRunner = {
  params: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: Object.keys(PERCENT_OPERATIONS),
        description:
          "of: first is the percent, second the value. what: first is the part, second the whole. apply: first is the value, second the percent. change: first is the starting value, second the new one.",
      },
      first: { type: "number", minimum: -MAX_INPUT, maximum: MAX_INPUT },
      second: { type: "number", minimum: -MAX_INPUT, maximum: MAX_INPUT },
    },
    required: ["operation", "first", "second"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const operation = PERCENT_OPERATIONS[String(values["operation"]) as PercentOperation];
    const result = operation.compute(
      asNumber(values["first"], "first", -MAX_INPUT, MAX_INPUT),
      asNumber(values["second"], "second", -MAX_INPUT, MAX_INPUT),
    );
    if (result === null) return null;
    const shown = operation.unit ? `${quantity(locale, result)} %` : quantity(locale, result);
    return [figure(locale, operation.label, shown)];
  },
};

const PDV_LABELS = {
  net: { sr: "Neto", en: "Net" },
  vat: { sr: "PDV", en: "VAT" },
  gross: { sr: "Bruto", en: "Gross" },
} as const;

const pdv: ToolRunner = {
  prefills: true,
  params: {
    type: "object",
    properties: {
      amount: { type: "number", minimum: 0, maximum: MAX_INPUT, description: "The amount the user typed." },
      rate: { type: "number", enum: [...PDV_RATES], description: "The PDV rate, in percent." },
      direction: {
        type: "string",
        enum: ["add", "extract"],
        description: "add: the amount is net and PDV is added. extract: the amount is gross and PDV is taken out.",
      },
    },
    required: ["amount", "rate", "direction"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const amount = asNumber(values["amount"], "amount", 0, MAX_INPUT);
    const rate = asNumber(values["rate"], "rate", 0, MAX_INPUT);
    const breakdown = values["direction"] === "extract" ? extractVat(amount, rate) : addVat(amount, rate);
    if (breakdown === null) return null;
    return [
      figure(locale, PDV_LABELS.net, money(locale, breakdown.net)),
      figure(locale, PDV_LABELS.vat, money(locale, breakdown.vat)),
      figure(locale, PDV_LABELS.gross, money(locale, breakdown.gross)),
    ];
  },
};

const LOAN_LABELS = {
  payment: { sr: "Mesečna rata", en: "Monthly payment" },
  total: { sr: "Ukupno plaćeno", en: "Total paid" },
  interest: { sr: "Ukupna kamata", en: "Total interest" },
} as const;

const kredit: ToolRunner = {
  prefills: true,
  params: {
    type: "object",
    properties: {
      principal: { type: "number", minimum: 0, maximum: MAX_INPUT, description: "The amount borrowed." },
      rate: { type: "number", minimum: 0, maximum: 100, description: "The nominal annual rate, in percent." },
      months: { type: "integer", minimum: 1, maximum: 600, description: "The number of monthly instalments." },
    },
    required: ["principal", "rate", "months"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const plan = annuityPlan({
      principal: asNumber(values["principal"], "principal", 0, MAX_INPUT),
      annualRatePercent: asNumber(values["rate"], "rate", 0, 100),
      months: asNumber(values["months"], "months", 1, 600),
    });
    if (plan === null) return null;
    return [
      figure(locale, LOAN_LABELS.payment, money(locale, plan.monthlyPayment)),
      figure(locale, LOAN_LABELS.total, money(locale, plan.totalPaid)),
      figure(locale, LOAN_LABELS.interest, money(locale, plan.totalInterest)),
    ];
  },
};

const UNIT_PRICE_LABELS = {
  package: { sr: "Pakovanje", en: "Package" },
  cheapest: { sr: "najjeftinije", en: "cheapest" },
  premium: { sr: "skuplje", en: "dearer" },
} as const;

const unitPrice: ToolRunner = {
  params: {
    type: "object",
    properties: {
      offers: {
        type: "array",
        minItems: 2,
        maxItems: 10,
        description: "The packages to compare, each with its price and its quantity.",
        items: {
          type: "object",
          properties: {
            price: { type: "number", minimum: 0, maximum: MAX_INPUT },
            quantity: { type: "number", minimum: 0, maximum: MAX_INPUT },
          },
          required: ["price", "quantity"],
          additionalProperties: false,
        },
      },
    },
    required: ["offers"],
    additionalProperties: false,
  },
  run: (values, locale) => {
    const offers = values["offers"];
    if (!Array.isArray(offers)) return null;
    const rows = compareUnitPrices(
      offers.map((offer: Record<string, unknown>, index) => ({
        id: String(index + 1),
        price: asNumber(offer["price"], "price", 0, MAX_INPUT),
        quantity: asNumber(offer["quantity"], "quantity", 0, MAX_INPUT),
      })),
    );
    if (rows === null) return null;
    return rows.map((row) => {
      const label = {
        sr: `${UNIT_PRICE_LABELS.package.sr} ${row.id}`,
        en: `${UNIT_PRICE_LABELS.package.en} ${row.id}`,
      };
      const shown = row.cheapest
        ? `${money(locale, row.unitPrice)} (${text(locale, UNIT_PRICE_LABELS.cheapest)})`
        : `${money(locale, row.unitPrice)} (+${quantity(locale, row.premiumPercent)} % ${text(locale, UNIT_PRICE_LABELS.premium)})`;
      return figure(locale, label, shown);
    });
  },
};

export const EVERYDAY_RUNNERS: Readonly<Record<string, ToolRunner>> = {
  ...Object.fromEntries(CONVERTERS.map((spec) => [spec.id, converter(spec.kind)])),
  procenat: percent,
  pdv,
  kredit,
  "jedinicna-cena": unitPrice,
};
