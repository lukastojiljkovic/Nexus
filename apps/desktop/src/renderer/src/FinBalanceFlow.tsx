import { SeriesPlot } from "@nexus/ui";
import type { FinAccount, FinTransaction } from "../../shared/ipc.js";
import { localTodayKey, shiftDayKey } from "./examDates.js";
import { monthPeriod } from "./financeReport.js";
import { formatMoney, formatMoneyPlain } from "./money.js";
import { strings } from "./strings.js";

/**
 * „Tok stanja" — FIN's signature graphic (FIN report, ADR-081's sibling
 * arc): the running balance of every account in ONE currency, day by day,
 * across the month the report is showing.
 *
 * **ONE CHART PER CURRENCY, NEVER A COMBINED ONE.** Nothing in this product
 * converts between currencies — there is no rate anywhere and there
 * deliberately will not be one — so a single line summing dinars and euros
 * would be the one fabricated number FIN's whole design refuses. The caller
 * (`FinancePage`) already sections its month report per currency and mounts
 * one of these inside each section; this component draws exactly one.
 *
 * **The balance formula replicates `DERIVED_BALANCE`
 * (`@nexus/db/finance/accountStore.ts`) by hand**, because the store answers
 * only TODAY's total, never a day-by-day walk. For one account, at the close
 * of day D: `openingBalance + SUM(amount WHERE accountId = account, date <=
 * D) − SUM(amount WHERE counterAccountId = account, date <= D)`. A transfer
 * is ONE row naming both accounts, never a pair — replicating BOTH legs is
 * the whole correctness of this chart: miss the second and every transfer
 * looks like money appearing from nowhere. The currency's total is that sum
 * over every LIVE (non-archived) account sharing the currency; an archived
 * account is money the user has already closed the book on.
 *
 * The walk itself: the balance at the close of the day BEFORE the month
 * opens (every account's opening balance plus every earlier transaction),
 * then one point per day forward, accumulating that day's own net. Only days
 * that have actually happened are drawn — a future day has no balance yet,
 * and a flat line drawn through it would be a prediction this module refuses
 * to make.
 */

export interface FinBalanceFlowProps {
  /** The section's own currency — every account and transaction here is filtered to it. */
  currency: string;
  /** The report's chosen month, `YYYY-MM`. */
  monthKey: string;
  /** Every account this profile holds, live and archived alike; filtered to the live ones in `currency`. */
  accounts: readonly FinAccount[];
  /** Every live transaction, unfiltered by date — `listFinTransactions`' own answer. */
  transactions: readonly FinTransaction[];
}

export function FinBalanceFlow({ currency, monthKey, accounts, transactions }: FinBalanceFlowProps) {
  const s = strings.finance.chart;
  const period = monthPeriod(monthKey);
  const today = localTodayKey();
  // The honest right edge: a month in progress draws only up to today, never
  // the days still to come. A month wholly in the future draws nothing at all.
  const effectiveEnd = today < period.to ? today : period.to;

  const liveAccounts = accounts.filter((account) => !account.archived && account.currency === currency);
  const liveIds = new Set(liveAccounts.map((account) => account.id));

  // Both legs of every transaction touching a live account of this currency,
  // bucketed by day — the exact two sums `DERIVED_BALANCE` takes, one row at
  // a time rather than one indexed SQL SUM. `sawActivity` is scoped to the
  // drawn window alone: a month with real rows in it is real data even when
  // they net to a flat line, but a month with NONE has nothing to plot.
  const deltaByDate = new Map<string, number>();
  let sawActivity = false;
  for (const transaction of transactions) {
    const onAccount = liveIds.has(transaction.accountId);
    const onCounter =
      transaction.counterAccountId !== null && liveIds.has(transaction.counterAccountId);
    if (!onAccount && !onCounter) continue;
    const delta = (onAccount ? transaction.amount : 0) - (onCounter ? transaction.amount : 0);
    deltaByDate.set(transaction.date, (deltaByDate.get(transaction.date) ?? 0) + delta);
    if (transaction.date >= period.from && transaction.date <= effectiveEnd) sawActivity = true;
  }

  if (!sawActivity) {
    return (
      <SeriesPlot
        title={s.heading}
        description={s.emptyReason}
        empty={{ reason: s.emptyReason }}
        series={[]}
        x={{ domain: [1, 1] }}
        width={720}
      />
    );
  }

  // The close of the day before the month opens: every opening balance, plus
  // every transaction dated strictly earlier.
  let running = liveAccounts.reduce((sum, account) => sum + account.openingBalance, 0);
  for (const [date, delta] of deltaByDate) {
    if (date < period.from) running += delta;
  }

  const points: { x: number; y: number }[] = [];
  for (let day = period.from; day <= effectiveEnd; day = shiftDayKey(day, 1)) {
    running += deltaByDate.get(day) ?? 0;
    // The month never spans two calendar months in this string, so its own
    // last two characters ARE the day-of-month — no separate date parse.
    points.push({ x: Number(day.slice(-2)), y: running });
  }

  const opening = points[0];
  const closing = points[points.length - 1];
  if (opening === undefined || closing === undefined) {
    // Unreachable: `sawActivity` guarantees `period.from <= effectiveEnd`, so
    // the walk above always produces at least one point. Kept so the read
    // below never has to trust that without the type system's help.
    return (
      <SeriesPlot
        title={s.heading}
        description={s.emptyReason}
        empty={{ reason: s.emptyReason }}
        series={[]}
        x={{ domain: [1, 1] }}
        width={720}
      />
    );
  }

  const daysInMonth = Number(period.to.slice(-2));
  const description =
    `${s.descriptionLead} ${currency}: ${s.descriptionFrom} ${formatMoney(opening.y, currency)} ` +
    `${s.descriptionTo} ${formatMoney(closing.y, currency)}.`;

  return (
    <SeriesPlot
      title={s.heading}
      description={description}
      caption={s.caption}
      empty={null}
      x={{ domain: [1, daysInMonth] }}
      y={{ format: (value) => formatMoneyPlain(Math.round(value), currency) }}
      series={[{ key: "balance", tone: "data", shape: "area", points }]}
      width={720}
    />
  );
}
