import { afterEach, describe, expect, it } from "vitest";
import { SERVICE_CATEGORIES } from "@nexus/core";
import { applyLocale } from "../../../renderer/src/strings.js";
import type { CarServiceView } from "../shared/ipc.js";
import { moneyPair, parseDecimal, serviceDraft } from "./carView.js";

/**
 * The CAR page's two pure rules, with the exact answers in both shipped locales.
 *
 * The locale matters to both: the interface language decides what a decimal mark
 * the user is looking at, and a service book is a page of numbers typed into
 * fields. `applyLocale` is the shell's own switch, so these tests ask the real
 * formatters rather than a tag chosen here.
 */

afterEach(() => {
  applyLocale("sr");
});

describe("parseDecimal", () => {
  it("reads a decimal in either shipped locale's mark", () => {
    applyLocale("sr");
    expect(parseDecimal("42,35")).toBe(42.35);
    applyLocale("en");
    expect(parseDecimal("42.35")).toBe(42.35);
    // Both marks are accepted in BOTH locales, deliberately: the field's text may
    // have been written before the language was switched, and the parser cannot
    // tell which language wrote it (money.ts's own grammar, one field over).
    expect(parseDecimal("42,35")).toBe(42.35);
  });

  it("reads a whole number, and a signed one", () => {
    expect(parseDecimal("12000")).toBe(12_000);
    expect(parseDecimal(" 12000 ")).toBe(12_000);
    expect(parseDecimal("-3")).toBe(-3);
    expect(parseDecimal("+7")).toBe(7);
    expect(parseDecimal("0")).toBe(0);
  });

  it("reads one separator as a decimal mark and refuses a second", () => {
    // „1.234" is the one string this cannot disambiguate: it is 1234 in Serbian
    // and 1.234 in English. It is read as the decimal, and the FIELD closes the
    // ambiguity -- an odometer or a month count is a whole number and the page
    // refuses a fractional one by name.
    expect(parseDecimal("1.234")).toBe(1.234);
    // Two separators are a string no single number writes.
    expect(parseDecimal("1,234,567")).toBeNull();
    expect(parseDecimal("1.234,5")).toBeNull();
    expect(parseDecimal("1 234")).toBeNull();
  });

  it("refuses anything that is not one number", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("   ")).toBeNull();
    expect(parseDecimal("12 km")).toBeNull();
    expect(parseDecimal("1,2,3")).toBeNull();
    expect(parseDecimal(",5")).toBeNull();
    expect(parseDecimal("12,")).toBeNull();
    expect(parseDecimal("1e3")).toBeNull();
  });
});

describe("moneyPair", () => {
  it("turns a typed amount into minor units beside its own code", () => {
    // 4 500 RSD is 450 000 para: two minor units to the dinar.
    expect(moneyPair("4500", "RSD")).toEqual({ costMinor: 450_000, currency: "RSD" });
    // 4 500,50 RSD is 450 050 para.
    expect(moneyPair("4500,50", "RSD")).toEqual({ costMinor: 450_050, currency: "RSD" });
    // The code is normalised, because the column stores upper case (migration 074).
    expect(moneyPair("4500", "rsd")).toEqual({ costMinor: 450_000, currency: "RSD" });
  });

  it("answers nothing-at-all when neither field was filled in", () => {
    expect(moneyPair("", "")).toEqual({ costMinor: null, currency: null });
  });

  it("refuses a half-filled pair, which the store would refuse anyway", () => {
    expect(moneyPair("4500", "")).toBeNull();
    expect(moneyPair("", "RSD")).toBeNull();
  });

  it("refuses a code that is not an ISO-4217 shape, and a non-positive amount", () => {
    expect(moneyPair("4500", "EURO")).toBeNull();
    expect(moneyPair("4500", "R1D")).toBeNull();
    expect(moneyPair("0", "RSD")).toBeNull();
    expect(moneyPair("-100", "RSD")).toBeNull();
    // A third fraction digit is more precision than the currency has: the store
    // would round it silently, and money.ts refuses it instead.
    expect(moneyPair("12,345", "RSD")).toBeNull();
  });

  it("reads the English decimal mark too", () => {
    expect(moneyPair("19.99", "EUR")).toEqual({ costMinor: 1_999, currency: "EUR" });
  });
});

describe("serviceDraft", () => {
  it("opens a new entry blank, in the first category", () => {
    expect(serviceDraft(null)).toEqual({
      date: "",
      category: SERVICE_CATEGORIES[0],
      description: "",
      odometer: "",
      cost: "",
      currency: "",
      workshop: "",
      parts: "",
    });
  });

  it("reads a stored row back, so saving it unchanged writes the same money", () => {
    const service = stored({ odometer: 120_500, costMinor: 450_050, currency: "RSD", parts: "filter" });
    applyLocale("sr");
    expect(serviceDraft(service).cost).toBe("4500,50");
    expect(moneyPair(serviceDraft(service).cost, serviceDraft(service).currency)).toEqual({
      costMinor: 450_050,
      currency: "RSD",
    });
    applyLocale("en");
    expect(serviceDraft(service).cost).toBe("4500.50");
    expect(moneyPair(serviceDraft(service).cost, "RSD")).toEqual({ costMinor: 450_050, currency: "RSD" });
  });

  it("keeps the reading as the whole number it was stored as, and an absent field absent", () => {
    const draft = serviceDraft(stored({ odometer: 120_500, workshop: null, parts: null }));
    expect(parseDecimal(draft.odometer)).toBe(120_500);
    expect(draft.workshop).toBe("");
    expect(draft.parts).toBe("");
  });

  it("leaves an unpriced, unread row unpriced", () => {
    const draft = serviceDraft(stored({ odometer: null, costMinor: null, currency: null }));
    expect(draft.odometer).toBe("");
    expect(moneyPair(draft.cost, draft.currency)).toEqual({ costMinor: null, currency: null });
  });
});

function stored(fields: Partial<CarServiceView>): CarServiceView {
  return {
    id: "service-1",
    date: "2026-03-14",
    odometer: null,
    category: SERVICE_CATEGORIES[0],
    description: "Oil and filter",
    costMinor: null,
    currency: null,
    workshop: null,
    parts: null,
    receipts: [],
    createdAt: "2026-03-14T10:00:00.000Z",
    updatedAt: "2026-03-14T10:00:00.000Z",
    ...fields,
  };
}
