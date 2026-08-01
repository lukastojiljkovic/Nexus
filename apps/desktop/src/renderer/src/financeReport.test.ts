import { describe, expect, it } from "vitest";
import { buildFinMonthReport, formatFinMonthLabel, monthPeriod } from "./financeReport.js";
import type { FinMonthReportInput } from "./financeReport.js";

const CATEGORIES = [
  { id: "c-hrana", name: "Hrana", kind: "expense" as const },
  { id: "c-prevoz", name: "Prevoz", kind: "expense" as const },
  { id: "c-soping", name: "Šoping", kind: "expense" as const },
  { id: "c-auto", name: "Auto", kind: "expense" as const },
  { id: "c-plata", name: "Plata", kind: "income" as const },
];

function input(partial: Partial<FinMonthReportInput> = {}): FinMonthReportInput {
  return {
    spend: partial.spend ?? [],
    income: partial.income ?? [],
    budgets: partial.budgets ?? [],
    categories: partial.categories ?? CATEGORIES,
  };
}

describe("monthPeriod", () => {
  it("spans the whole month, whatever its length", () => {
    expect(monthPeriod("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthPeriod("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthPeriod("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("formatFinMonthLabel", () => {
  it("names the month in Serbian, without shifting it across a timezone", () => {
    // The trailing period is the LOCALE's, exactly as the calendar's own month
    // nav renders it — not this module's to add or to strip.
    expect(formatFinMonthLabel("2026-07")).toBe("jul 2026.");
    expect(formatFinMonthLabel("2026-01")).toBe("januar 2026.");
    // Read at UTC midnight, so a negative-offset device never reads December.
    expect(formatFinMonthLabel("2027-01")).toBe("januar 2027.");
  });

  it("degrades to the key rather than throwing on a malformed one", () => {
    expect(formatFinMonthLabel("nije-mesec")).toBe("nije-mesec");
  });
});

describe("buildFinMonthReport — the per-currency split", () => {
  it("answers with one section per currency and never merges two", () => {
    const report = buildFinMonthReport(
      input({
        spend: [
          { categoryId: "c-hrana", currency: "RSD", minorUnits: 240_00 },
          { categoryId: "c-hrana", currency: "EUR", minorUnits: 30_00 },
        ],
        income: [
          { currency: "RSD", minorUnits: 1200_00 },
          { currency: "EUR", minorUnits: 100_00 },
        ],
      }),
    );

    expect(report.map((section) => section.currency)).toEqual(["EUR", "RSD"]);
    expect(report.map((section) => [section.income, section.expense])).toEqual([
      [10000, 3000],
      [120000, 24000],
    ]);
  });

  /**
   * The structural guard, stated as a test: every figure the report holds sits
   * inside a record that names its currency, and the report itself is a LIST.
   * There is no wrapper object with a total on it and no exported function that
   * returns a currency-free number — so a cross-currency sum is not merely
   * discouraged, there is nothing in the shape to read one from.
   */
  it("puts every figure inside a currency-bearing section", () => {
    const report = buildFinMonthReport(
      input({
        spend: [
          { categoryId: "c-hrana", currency: "RSD", minorUnits: 100_00 },
          { categoryId: "c-hrana", currency: "EUR", minorUnits: 5_00 },
        ],
      }),
    );

    expect(Array.isArray(report)).toBe(true);
    for (const section of report) {
      expect(Object.keys(section)).toContain("currency");
      for (const line of section.lines) {
        // A line's amounts are only ever read through the section that names
        // the money they are in.
        expect(Object.keys(line)).not.toContain("currency");
      }
    }
  });

  it("keeps one currency's spending out of another's totals entirely", () => {
    const report = buildFinMonthReport(
      input({
        spend: [
          { categoryId: "c-hrana", currency: "RSD", minorUnits: 300_00 },
          { categoryId: "c-prevoz", currency: "EUR", minorUnits: 40_00 },
        ],
        budgets: [{ categoryId: "c-hrana", currency: "RSD", amount: 500_00 }],
      }),
    );

    const [eur, rsd] = report;
    expect(eur?.lines.map((line) => line.categoryId)).toEqual(["c-prevoz"]);
    expect(rsd?.lines.map((line) => line.categoryId)).toEqual(["c-hrana"]);
    // The EUR section knows nothing of the RSD budget, and vice versa.
    expect(eur?.lines[0]?.budget).toBeNull();
    expect(rsd?.lines[0]?.budget).toBe(50000);
  });

  it("gives a budget in one currency no say over the same category in another", () => {
    const report = buildFinMonthReport(
      input({
        spend: [
          { categoryId: "c-hrana", currency: "RSD", minorUnits: 900_00 },
          { categoryId: "c-hrana", currency: "EUR", minorUnits: 900_00 },
        ],
        budgets: [{ categoryId: "c-hrana", currency: "RSD", amount: 1000_00 }],
      }),
    );

    expect(report.map((section) => [section.currency, section.lines[0]?.over])).toEqual([
      ["EUR", false],
      ["RSD", false],
    ]);
    expect(report[0]?.lines[0]?.budget).toBeNull();
  });
});

describe("buildFinMonthReport — spending against budgets", () => {
  it("pairs a category's spending with its own allowance and flags going over", () => {
    const report = buildFinMonthReport(
      input({
        spend: [
          { categoryId: "c-hrana", currency: "RSD", minorUnits: 340_00 },
          { categoryId: "c-prevoz", currency: "RSD", minorUnits: 60_00 },
        ],
        budgets: [
          { categoryId: "c-hrana", currency: "RSD", amount: 300_00 },
          { categoryId: "c-prevoz", currency: "RSD", amount: 100_00 },
        ],
      }),
    );

    expect(report[0]?.lines).toEqual([
      {
        categoryId: "c-hrana",
        name: "Hrana",
        spent: 34000,
        budget: 30000,
        over: true,
        spentRatio: 1,
        budgetRatio: 30000 / 34000,
      },
      {
        categoryId: "c-prevoz",
        name: "Prevoz",
        spent: 6000,
        budget: 10000,
        over: false,
        spentRatio: 6000 / 34000,
        budgetRatio: 10000 / 34000,
      },
    ]);
  });

  it("treats spending exactly at the limit as within it", () => {
    const report = buildFinMonthReport(
      input({
        spend: [{ categoryId: "c-hrana", currency: "RSD", minorUnits: 300_00 }],
        budgets: [{ categoryId: "c-hrana", currency: "RSD", amount: 300_00 }],
      }),
    );

    expect(report[0]?.lines[0]).toMatchObject({ over: false, spentRatio: 1, budgetRatio: 1 });
  });

  /** The honesty rule: a category with no allowance reports its spending and NOTHING about a limit. */
  it("invents no budget for a category that has none", () => {
    const report = buildFinMonthReport(
      input({ spend: [{ categoryId: "c-hrana", currency: "RSD", minorUnits: 340_00 }] }),
    );

    expect(report[0]?.lines[0]).toMatchObject({
      spent: 34000,
      budget: null,
      budgetRatio: null,
      over: false,
    });
  });

  it("draws every bar in a section against ONE scale, so two of them can be compared", () => {
    const report = buildFinMonthReport(
      input({
        spend: [
          { categoryId: "c-hrana", currency: "RSD", minorUnits: 100_00 },
          { categoryId: "c-prevoz", currency: "RSD", minorUnits: 50_00 },
        ],
        // The largest figure in the section is a BUDGET, not a spend — the
        // scale has to take it, or a bar could overflow its own track.
        budgets: [{ categoryId: "c-prevoz", currency: "RSD", amount: 400_00 }],
      }),
    );

    expect(report[0]?.scale).toBe(40000);
    expect(report[0]?.lines.map((line) => line.spentRatio)).toEqual([10000 / 40000, 5000 / 40000]);
  });

  it("shows a budget that was not spent against at all, at zero", () => {
    const report = buildFinMonthReport(
      input({ budgets: [{ categoryId: "c-hrana", currency: "RSD", amount: 300_00 }] }),
    );

    expect(report[0]).toMatchObject({ currency: "RSD", income: 0, expense: 0 });
    expect(report[0]?.lines[0]).toMatchObject({ spent: 0, budget: 30000, spentRatio: 0, over: false });
  });

  it("drops an allowance whose category is gone rather than drawing a nameless limit", () => {
    const report = buildFinMonthReport(
      input({ budgets: [{ categoryId: "c-obrisana", currency: "RSD", amount: 300_00 }] }),
    );

    expect(report).toEqual([]);
  });
});

describe("buildFinMonthReport — refunds and the uncategorized line", () => {
  it("lets a line go negative when refunds outweighed purchases, and says the section has one", () => {
    const report = buildFinMonthReport(
      input({
        spend: [
          { categoryId: "c-hrana", currency: "RSD", minorUnits: -20_00 },
          { categoryId: "c-prevoz", currency: "RSD", minorUnits: 80_00 },
        ],
      }),
    );

    expect(report[0]?.hasRefundLine).toBe(true);
    // Never clamped into a lie, and never drawn as a bar pointing backwards.
    expect(report[0]?.lines).toMatchObject([
      { name: "Hrana", spent: -2000, spentRatio: 0 },
      { name: "Prevoz", spent: 8000 },
    ]);
    expect(report[0]?.expense).toBe(6000);
  });

  it("says a section has no refund line when none of them is negative", () => {
    const report = buildFinMonthReport(
      input({ spend: [{ categoryId: "c-hrana", currency: "RSD", minorUnits: 80_00 }] }),
    );

    expect(report[0]?.hasRefundLine).toBe(false);
  });

  it("keeps the uncategorized spending as its own line, last, rather than folding it in", () => {
    const report = buildFinMonthReport(
      input({
        spend: [
          { categoryId: null, currency: "RSD", minorUnits: 32_00 },
          { categoryId: "c-hrana", currency: "RSD", minorUnits: 100_00 },
        ],
      }),
    );

    expect(report[0]?.lines).toMatchObject([
      { categoryId: "c-hrana", name: "Hrana" },
      { categoryId: null, name: null, spent: 3200, budget: null },
    ]);
    expect(report[0]?.expense).toBe(13200);
  });

  it("orders the named lines the way Serbian orders them", () => {
    const report = buildFinMonthReport(
      input({
        spend: [
          { categoryId: "c-soping", currency: "RSD", minorUnits: 1_00 },
          { categoryId: "c-auto", currency: "RSD", minorUnits: 1_00 },
          { categoryId: null, currency: "RSD", minorUnits: 1_00 },
          { categoryId: "c-hrana", currency: "RSD", minorUnits: 1_00 },
        ],
      }),
    );

    // sr-Latn: š sorts after s and before z; the uncategorized leftover last.
    expect(report[0]?.lines.map((line) => line.name)).toEqual(["Auto", "Hrana", "Šoping", null]);
  });

  it("counts money whose category no longer resolves as uncategorized rather than dropping it", () => {
    const report = buildFinMonthReport(
      input({
        spend: [
          { categoryId: "c-obrisana", currency: "RSD", minorUnits: 40_00 },
          { categoryId: null, currency: "RSD", minorUnits: 2_00 },
        ],
      }),
    );

    expect(report[0]?.lines).toMatchObject([{ categoryId: null, name: null, spent: 4200 }]);
  });

  it("reports an expense total that is exactly the sum of the lines it drew", () => {
    const report = buildFinMonthReport(
      input({
        spend: [
          { categoryId: "c-hrana", currency: "RSD", minorUnits: 111_11 },
          { categoryId: "c-prevoz", currency: "RSD", minorUnits: -22_22 },
          { categoryId: null, currency: "RSD", minorUnits: 33_33 },
        ],
      }),
    );

    const section = report[0];
    expect(section?.expense).toBe(section?.lines.reduce((sum, line) => sum + line.spent, 0));
  });
});

describe("buildFinMonthReport — a month with nothing in it", () => {
  /**
   * The end of the chain the store starts: `spendByCategory` reads the
   * transfer-free view, so a month whose only movement was a transfer between
   * the user's own accounts arrives here EMPTY — and an empty report is what
   * the page draws its `EmptyState` from, never a section reading „0 potrošeno"
   * over money that did move.
   */
  it("is empty when the month held nothing but a transfer", () => {
    expect(buildFinMonthReport(input())).toEqual([]);
  });

  it("still opens a section for a currency that only saw income", () => {
    const report = buildFinMonthReport(
      input({ income: [{ currency: "RSD", minorUnits: 1200_00 }] }),
    );

    expect(report).toEqual([
      { currency: "RSD", income: 120000, expense: 0, lines: [], scale: 1, hasRefundLine: false },
    ]);
  });
});
