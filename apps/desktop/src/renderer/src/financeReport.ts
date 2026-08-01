import { shiftDayKey, shiftMonthKey } from "@nexus/core";
import type {
  FinBudget,
  FinCategory,
  FinCategorySpend,
  FinCurrencyTotal,
  FinPeriod,
} from "../../shared/ipc.js";

/**
 * „Izveštaj" — the month report's arithmetic (FIN slice c), on the
 * `studyPlanView.ts` / `dashboardStrip.ts` idiom: FinancePage decides what to
 * fetch and when, this module decides only what a fetched month READS as. Every
 * rule below is therefore a table of cases in `financeReport.test.ts` rather
 * than logic buried in JSX.
 *
 * **The report is a LIST of per-currency sections, and that is the design.**
 * An account carries a currency, nothing converts between two of them (there is
 * no honest offline exchange rate), so a profile holding RSD and EUR accounts
 * gets two sections rather than one wrong number. Every figure this module
 * produces — a month's income, its expense, a category's spending, its
 * allowance — lives INSIDE a section that names the money it is in. There is no
 * wrapper object with a total on it, and no function here returns a
 * currency-free number, so there is nothing to read a cross-currency sum from;
 * and since `money.ts` cannot format an amount without being told which
 * currency it is in, a sum across two of them could only be drawn by naming one
 * of them for money that is not all in it — a lie somebody would have to write
 * on purpose.
 *
 * **Nothing here is a projection.** A category with no allowance reports its
 * spending and says there is no allowance; it does not infer one from history,
 * does not extrapolate the month's pace, and does not average anything. Every
 * number below is a sum of numbers the store returned.
 *
 * Spending arrives from `FinTransactionStore.spendByCategory`, which reads
 * `fin_flows` — the view transfers are absent from — so money the user moved
 * between their own accounts can never reach this module as spending. Income
 * arrives from its exact mirror. The two partition the month between them.
 */

/** Serbian Latin ordering for the report's category lines — plain `"sr"` mis-tailors š/č/ć. */
const REPORT_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** What the report is built from — four reads of the same month, none of them a transaction. */
export interface FinMonthReportInput {
  /** `spendByCategory`'s answer: one row per (expense category, currency), plus the uncategorized line. */
  spend: readonly FinCategorySpend[];
  /** `incomeByCurrency`'s answer: one row per currency. */
  income: readonly FinCurrencyTotal[];
  /** Every standing allowance this profile holds — the report picks the ones its sections can use. */
  budgets: readonly Pick<FinBudget, "categoryId" | "currency" | "amount">[];
  categories: readonly Pick<FinCategory, "id" | "name">[];
}

/** One category's line inside ONE currency's section. Its amounts are minor units of that section's currency. */
export interface FinReportLine {
  /** Null is the uncategorized line — real spending the user has not labelled, reported rather than folded in. */
  categoryId: string | null;
  /** Null exactly when `categoryId` is: the page supplies its own Serbian copy for that line. */
  name: string | null;
  /** Positive for ordinary spending; NEGATIVE when the month's refunds outweighed its purchases, never clamped. */
  spent: number;
  /** The stored allowance, or null when there is none. Never inferred from what was spent before. */
  budget: number | null;
  over: boolean;
  /** `spent` as a fraction of the section's shared scale, 0..1; zero for a line that netted out negative. */
  spentRatio: number;
  /** Where the allowance sits on that same scale, 0..1 — null when there is no allowance to mark. */
  budgetRatio: number | null;
}

/** One currency's whole month. Every figure the report holds is reached through one of these. */
export interface FinReportSection {
  currency: string;
  /** Minor units that arrived under an income category this month. */
  income: number;
  /** Minor units that left, EXACTLY the sum of `lines` — a total that disagreed with the rows above it would be a bug. */
  expense: number;
  lines: FinReportLine[];
  /**
   * The minor-unit value every bar in this section is drawn against — the
   * largest of its spends and its allowances. ONE scale per section, so two
   * bars of the same length mean the same amount; a per-line scale would make
   * the column unreadable while looking like a chart.
   */
  scale: number;
  /** True when some line netted out negative, so the page can say what a minus means before it is mistaken for a bug. */
  hasRefundLine: boolean;
}

/** A month key's own inclusive day span — the shape both report reads are asked over. */
export function monthPeriod(monthKey: string): FinPeriod {
  return {
    from: `${monthKey}-01`,
    // Day 0 of the month after, which is the only definition of "last day" that
    // needs to know nothing about month lengths or leap years (`monthsRange`'s
    // own trick, one module over).
    to: shiftDayKey(`${shiftMonthKey(monthKey, 1)}-01`, -1),
  };
}

/** „jul 2026." — the locale's own month name, year and trailing period, as the calendar's month nav spells it too. */
const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("sr-Latn", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** The report nav's month label. Degrades to the key itself rather than throwing on a malformed one. */
export function formatFinMonthLabel(monthKey: string): string {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? monthKey : MONTH_LABEL_FORMATTER.format(date);
}

/** A section under construction: the two figures a line is assembled from, before the ratios are known. */
interface LineDraft {
  categoryId: string | null;
  name: string | null;
  spent: number;
  budget: number | null;
}

/**
 * The month, as sections ordered by currency code. A currency earns a section
 * by having any of the three: spending, income, or an allowance — an allowance
 * nothing was spent against is a real fact about the month and shows at zero,
 * rather than appearing only once it has been broken.
 */
export function buildFinMonthReport(input: FinMonthReportInput): FinReportSection[] {
  const nameOf = new Map(input.categories.map((category) => [category.id, category.name]));
  const incomeOf = new Map(input.income.map((total) => [total.currency, total.minorUnits]));
  const drafts = new Map<string, Map<string | null, LineDraft>>();

  for (const row of input.spend) {
    const name = row.categoryId === null ? undefined : nameOf.get(row.categoryId);
    // Money whose category no longer resolves is money with no usable label,
    // which is what the uncategorized line is FOR — dropping it would be
    // dropping money. (Migration 051's `ON DELETE SET NULL` makes this
    // unreachable in practice; it costs one branch to be certain.)
    const line =
      name === undefined
        ? draftFor(drafts, row.currency, null, null)
        : draftFor(drafts, row.currency, row.categoryId, name);
    line.spent += row.minorUnits;
  }

  for (const budget of input.budgets) {
    const name = nameOf.get(budget.categoryId);
    // A limit on a category that is gone is nothing — and unlike spending it is
    // not money, so there is nothing to preserve by drawing it nameless.
    if (name === undefined) continue;
    draftFor(drafts, budget.currency, budget.categoryId, name).budget = budget.amount;
  }

  // A currency that only saw income still had a month.
  for (const total of input.income) {
    if (!drafts.has(total.currency)) drafts.set(total.currency, new Map());
  }

  return [...drafts.entries()]
    .map(([currency, lines]) =>
      buildSection(currency, [...lines.values()], incomeOf.get(currency) ?? 0),
    )
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** The draft for one `(currency, category)` pair, created on first mention — spend and budget both reach for it. */
function draftFor(
  drafts: Map<string, Map<string | null, LineDraft>>,
  currency: string,
  categoryId: string | null,
  name: string | null,
): LineDraft {
  let lines = drafts.get(currency);
  if (lines === undefined) {
    lines = new Map<string | null, LineDraft>();
    drafts.set(currency, lines);
  }
  const existing = lines.get(categoryId);
  if (existing !== undefined) return existing;

  const created: LineDraft = { categoryId, name, spent: 0, budget: null };
  lines.set(categoryId, created);
  return created;
}

function buildSection(currency: string, drafts: LineDraft[], income: number): FinReportSection {
  // Seeded with 1 so a section of nothing but zeroes still divides; the `max`
  // takes allowances as well as spends, or a bar could run past its own track.
  const scale = Math.max(1, ...drafts.map((line) => Math.max(line.spent, line.budget ?? 0)));
  const lines = drafts
    .map((line) => ({
      categoryId: line.categoryId,
      name: line.name,
      spent: line.spent,
      budget: line.budget,
      over: line.budget !== null && line.spent > line.budget,
      // A line that netted out negative draws no bar: a fill pointing backwards
      // would read as a quantity, and the amount beside it already says it.
      spentRatio: line.spent <= 0 ? 0 : Math.min(1, line.spent / scale),
      budgetRatio: line.budget === null ? null : Math.min(1, line.budget / scale),
    }))
    .sort(compareLines);

  return {
    currency,
    income,
    expense: lines.reduce((sum, line) => sum + line.spent, 0),
    lines,
    scale,
    hasRefundLine: lines.some((line) => line.spent < 0),
  };
}

/** Named lines sr-Latn alphabetical, the uncategorized leftover last — `spendByCategory`'s own order. */
function compareLines(a: FinReportLine, b: FinReportLine): number {
  return (
    Number(a.categoryId === null) - Number(b.categoryId === null) ||
    REPORT_COLLATOR.compare(a.name ?? "", b.name ?? "") ||
    (a.categoryId ?? "").localeCompare(b.categoryId ?? "")
  );
}
