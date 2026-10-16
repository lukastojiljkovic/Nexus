import { describe, expect, it } from "vitest";
import { annuityPlan } from "@nexus/core";
import { TOOL_RUNNERS } from "./index.js";
import { money } from "./shared.js";

/** Each everyday runner, run on fixed inputs, answers the figures its surface draws. */
describe("the everyday runners", () => {
  it("converts a length the way the converter does", () => {
    const lines = TOOL_RUNNERS.get("duzina")?.run({ value: 10, from: "km", to: "mi" }, "en");
    expect(lines).toEqual(["Result: 6.214 mi"]);
  });

  it("answers the percentage tool's four rows", () => {
    const run = TOOL_RUNNERS.get("procenat")?.run;
    expect(run?.({ operation: "of", first: 20, second: 150 }, "en")).toEqual(["Percent of a value: 30"]);
    expect(run?.({ operation: "what", first: 50, second: 250 }, "en")).toEqual(["What percentage: 20 %"]);
    expect(run?.({ operation: "apply", first: 200, second: 10 }, "en")).toEqual(["Value after the change: 220"]);
    expect(run?.({ operation: "change", first: 100, second: 125 }, "en")).toEqual(["Percentage change: 25 %"]);
  });

  it("adds and extracts PDV the way the PDV tool does", () => {
    const run = TOOL_RUNNERS.get("pdv")?.run;
    expect(run?.({ amount: 1000, rate: 20, direction: "add" }, "en")).toEqual([
      "Net: 1,000.00",
      "VAT: 200.00",
      "Gross: 1,200.00",
    ]);
    expect(run?.({ amount: 1200, rate: 20, direction: "extract" }, "en")).toEqual([
      "Net: 1,000.00",
      "VAT: 200.00",
      "Gross: 1,200.00",
    ]);
  });

  it("prints the loan's three figures from the same plan the loan tool draws", () => {
    const lines = TOOL_RUNNERS.get("kredit")?.run({ principal: 100000, rate: 12, months: 12 }, "en");
    const plan = annuityPlan({ principal: 100000, annualRatePercent: 12, months: 12 });
    if (plan === null) throw new Error("Test setup: the loan plan refused a valid loan.");
    expect(lines).toEqual([
      `Monthly payment: ${money("en", plan.monthlyPayment)}`,
      `Total paid: ${money("en", plan.totalPaid)}`,
      `Total interest: ${money("en", plan.totalInterest)}`,
    ]);
  });

  it("compares unit prices and names the cheapest package", () => {
    const lines = TOOL_RUNNERS.get("jedinicna-cena")?.run(
      {
        offers: [
          { price: 100, quantity: 1 },
          { price: 150, quantity: 2 },
        ],
      },
      "en",
    );
    expect(lines).toEqual(["Package 2: 75.00 (cheapest)", "Package 1: 100.00 (+33.333 % dearer)"]);
  });

  it("gives no figure where the arithmetic has none", () => {
    expect(TOOL_RUNNERS.get("kredit")?.run({ principal: 0, rate: 12, months: 12 }, "en")).toBeNull();
  });

  it("prefills only the tools whose page reads the prefill context", () => {
    const prefilled = [...TOOL_RUNNERS.entries()].filter(([, runner]) => runner.prefills === true).map(([id]) => id);
    expect(prefilled.sort()).toEqual(
      ["brzina", "duzina", "kredit", "masa", "pdv", "podaci", "povrsina", "temperatura", "zapremina"].sort(),
    );
  });
});
