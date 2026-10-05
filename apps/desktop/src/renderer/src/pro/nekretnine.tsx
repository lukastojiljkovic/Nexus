import {
  areaShareFraction,
  cashflowNpvIrr,
  costAllocation,
  latePaymentInterest,
  leaseTermDates,
  loanAmortization,
  ownershipShares,
  parcelPolygonArea,
  plotDensityIndex,
  proRataDays,
  rentEscalation,
  rentGrossNet,
  rentalYield,
  roomQuadArea,
  wallCeilingArea,
  weightedArea,
  type CalendarDate,
  type LateInterestBasis,
  type LateInterestMethod,
  type NoticeUnit,
  type ProRataBasis,
} from "@nexus/core/pro/nekretnine";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proRatio, proUnit } from "./format.js";
import {
  CopyButton,
  ResultRow,
  ToolAgainstLimit,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "./shared.js";

/**
 * „Nekretnine" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/nekretnine.ts`'s. Nothing here divides,
 * rounds or compares; this file shapes fields, hands the numbers over, and
 * reads the answers onto the page. None of these tools is `life-safety` or
 * `food-safety`, but the same discipline is kept anyway: a regulated figure
 * (a rate, an index, a notice period, a coefficient) is always an input the
 * user typed, never a default, and a comparison against the user's own limit
 * is a bare ratio — never a sentence about what it means.
 *
 * **Lists have no dedicated widget in the kit, so they are one line of text
 * per row.** A cash flow, a cost-allocation row, an ownership share, a parcel
 * vertex and a wall opening are all typed into a `ToolTextArea`, one entry per
 * line, in the shape the field's hint spells out. That is a presentational
 * choice, not a computation: `splitRows` only trims and drops blank lines, and
 * every number inside a row still goes through `proParse`.
 *
 * **Dates have no dedicated widget either.** `parseCalendarDate` reads
 * „dd.mm.gggg" into the three integers `@nexus/core` wants and nothing more —
 * whether the date actually exists (a 31st of April, a 30th of February) is
 * left to the core function's own `isCalendarDate`, exactly like every other
 * validation in this file. `formatDate` is its inverse for the read side; it
 * does not go through `proNum`, because a year is not a quantity and the
 * locale's grouping would print „2.027" or „2,027".
 */

/** One non-empty trimmed line per entry — the drawer's one way to type a list. */
function splitRows(text: string): readonly string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** „dd.mm.gggg" into the three integers `CalendarDate` wants. No validation here. */
function parseCalendarDate(text: string): CalendarDate | undefined {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{3,4})$/.exec(text.trim());
  if (match === null) return undefined;
  return {
    day: Number(match[1] ?? ""),
    month: Number(match[2] ?? ""),
    year: Number(match[3] ?? ""),
  };
}

/** The inverse of `parseCalendarDate`. Padded digits, not `proNum` — a year is not a quantity. */
function formatDate(date: CalendarDate): string {
  const dd = String(date.day).padStart(2, "0");
  const mm = String(date.month).padStart(2, "0");
  const yyyy = String(date.year).padStart(4, "0");
  return `${dd}.${mm}.${yyyy}`;
}

/* ------------------------------------------------------------ cashflow-npv-irr */

type PeriodLabel = "year" | "month" | "quarter";

export function CashflowNpvIrrTool() {
  const s = strings.pro.nekretnine["cashflow-npv-irr"];
  const [flowsText, setFlowsText] = useState("");
  const [discountRate, setDiscountRate] = useState("");
  const [periodLabel, setPeriodLabel] = useState<PeriodLabel>("year");

  const lines = splitRows(flowsText);
  const cashflows = lines.map((line) => proParse(line) ?? Number.NaN);
  const typed = lines.length > 0 || proParse(discountRate) !== undefined;
  const result = cashflowNpvIrr({
    cashflows,
    discountRate: proParse(discountRate) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "cashflows"
        ? s.errorCashflows
        : s.errorDiscountRate;

  const periodLabelText =
    periodLabel === "year" ? s.periodYear : periodLabel === "month" ? s.periodMonth : s.periodQuarter;

  const irrText = !result.ok
    ? ""
    : result.irr.outcome === "found"
      ? `${proNum(result.irr.percentPerPeriod, 4)}${s.unitPercent}`
      : result.irr.outcome === "noSignChange"
        ? s.irrNoSignChange
        : result.irr.outcome === "notUnique"
          ? s.irrNotUnique
          : s.irrOutsideRange;

  const paybackPlainText = !result.ok
    ? ""
    : result.paybackPlain === undefined
      ? s.paybackNone
      : `${proNum(result.paybackPlain, 2)} ${s.unitPeriods}`;
  const paybackDiscountedText = !result.ok
    ? ""
    : result.paybackDiscounted === undefined
      ? s.paybackNone
      : `${proNum(result.paybackDiscounted, 2)} ${s.unitPeriods}`;

  const copyText = !result.ok
    ? ""
    : [
        `${s.npv}: ${proNum(result.npv, 2)}`,
        `${s.undiscountedTotal}: ${proNum(result.undiscountedTotal, 2)}`,
        `${s.paybackPlain}: ${paybackPlainText}`,
        `${s.paybackDiscounted}: ${paybackDiscountedText}`,
        `${s.irr}: ${irrText}`,
        `${s.signChanges}: ${result.signChanges}`,
        "",
        `${s.discountRate}: ${proNum(proParse(discountRate) ?? 0, 2)}${s.unitPercent}`,
        `${s.periodLabel}: ${periodLabelText}`,
        `${s.flows}:`,
        ...lines.map((line, t) => `  t=${t} ${line}`),
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.flows} hint={s.flowsHint} value={flowsText} onChange={setFlowsText} />
      <ToolInput
        label={s.discountRate}
        hint={s.discountRateHint}
        value={discountRate}
        onChange={setDiscountRate}
      />
      <ToolSelect<PeriodLabel>
        label={s.periodLabel}
        hint={s.periodLabelHint}
        value={periodLabel}
        onChange={setPeriodLabel}
        options={[
          { id: "year", label: s.periodYear },
          { id: "month", label: s.periodMonth },
          { id: "quarter", label: s.periodQuarter },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[`${s.colPeriod} (${periodLabelText})`, s.colCashflow, s.colDiscounted]}
            rows={result.discounted.map((value, t) => [
              String(t),
              proNum(cashflows[t] ?? 0, 2),
              proNum(value, 2),
            ])}
          />
          <ResultRow label={s.npv} value={proNum(result.npv, 2)} />
          <ResultRow label={s.undiscountedTotal} value={proNum(result.undiscountedTotal, 2)} />
          <ResultRow label={s.paybackPlain} value={paybackPlainText} />
          <ResultRow label={s.paybackDiscounted} value={paybackDiscountedText} />
          <ResultRow label={s.irr} value={irrText} />
          <ResultRow label={s.signChanges} value={String(result.signChanges)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.discountRate,
                value: `${proNum(proParse(discountRate) ?? 0, 2)}${s.unitPercent}`,
              },
              { label: s.periodLabel, value: periodLabelText },
              { label: s.flows, value: String(lines.length) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------- late-payment-interest */

export function LatePaymentInterestTool() {
  const s = strings.pro.nekretnine["late-payment-interest"];
  const [debt, setDebt] = useState("");
  const [annualRate, setAnnualRate] = useState("");
  const [dueDateText, setDueDateText] = useState("");
  const [paymentDateText, setPaymentDateText] = useState("");
  const [daysText, setDaysText] = useState("");
  const [basis, setBasis] = useState<LateInterestBasis>("d365");
  const [method, setMethod] = useState<LateInterestMethod>("proportional");

  const dueDate = parseCalendarDate(dueDateText);
  const paymentDate = parseCalendarDate(paymentDateText);
  const days = proParse(daysText);
  const typed =
    proParse(debt) !== undefined ||
    proParse(annualRate) !== undefined ||
    dueDateText.trim() !== "" ||
    paymentDateText.trim() !== "" ||
    days !== undefined;

  const result = latePaymentInterest({
    debt: proParse(debt) ?? Number.NaN,
    annualRate: proParse(annualRate) ?? Number.NaN,
    dueDate,
    paymentDate,
    days,
    basis,
    method,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "debt"
        ? s.errorDebt
        : result.reason === "annualRate"
          ? s.errorAnnualRate
          : result.reason === "dueDate"
            ? s.errorDueDate
            : result.reason === "paymentDate"
              ? s.errorPaymentDate
              : s.errorDays;

  const basisLabel = basis === "d365" ? s.basis365 : basis === "d360" ? s.basis360 : s.basisActual;
  const methodLabel = method === "proportional" ? s.methodProportional : s.methodConformal;

  const copyText = !result.ok
    ? ""
    : [
        `${s.days2}: ${result.days}`,
        `${s.interest}: ${proNum(result.interest, 2)}`,
        `${s.total}: ${proNum(result.total, 2)}`,
        `${s.ratioToDebt}: ${proNum(result.ratioToDebt, 4)}${s.unitPercent}`,
        `${s.interestPerDay}: ${result.interestPerDay === undefined ? s.interestPerDayNone : proNum(result.interestPerDay, 2)}`,
        result.impliedPaymentDate === undefined
          ? undefined
          : `${s.impliedPaymentDate}: ${formatDate(result.impliedPaymentDate)}`,
        "",
        `${s.debt}: ${proNum(proParse(debt) ?? 0, 2)}`,
        `${s.annualRate}: ${proNum(proParse(annualRate) ?? 0, 2)}${s.unitPercent}`,
        `${s.basis}: ${basisLabel}`,
        `${s.method}: ${methodLabel}`,
      ]
        .filter((line) => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.debt} value={debt} onChange={setDebt} />
      <ToolInput label={s.annualRate} hint={s.annualRateHint} value={annualRate} onChange={setAnnualRate} />
      <ToolInput label={s.dueDate} hint={s.dateHint} value={dueDateText} onChange={setDueDateText} />
      <ToolInput label={s.paymentDate} value={paymentDateText} onChange={setPaymentDateText} />
      <ToolInput label={s.days} hint={s.daysHint} value={daysText} onChange={setDaysText} />
      <ToolSelect<LateInterestBasis>
        label={s.basis}
        value={basis}
        onChange={setBasis}
        options={[
          { id: "d365", label: s.basis365 },
          { id: "d360", label: s.basis360 },
          { id: "actual", label: s.basisActual },
        ]}
      />
      <ToolSelect<LateInterestMethod>
        label={s.method}
        value={method}
        onChange={setMethod}
        options={[
          { id: "proportional", label: s.methodProportional },
          { id: "conformal", label: s.methodConformal },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <p className="nx-hint nx-hint--prose">{s.countingRuleNote}</p>
          <ResultRow label={s.days2} value={String(result.days)} />
          <ResultRow label={s.yearFraction} value={proNum(result.yearFraction, 6)} />
          <ResultRow label={s.interest} value={proNum(result.interest, 2)} />
          <ResultRow label={s.total} value={proNum(result.total, 2)} />
          <ResultRow label={s.ratioToDebt} value={`${proNum(result.ratioToDebt, 4)}${s.unitPercent}`} />
          <ResultRow
            label={s.interestPerDay}
            value={result.interestPerDay === undefined ? s.interestPerDayNone : proNum(result.interestPerDay, 2)}
          />
          {method === "conformal" && result.compoundsAnnually && (
            <p className="nx-hint nx-hint--prose">{s.compoundsAnnuallyNote}</p>
          )}
          {result.impliedPaymentDate !== undefined && (
            <ResultRow label={s.impliedPaymentDate} value={formatDate(result.impliedPaymentDate)} />
          )}
          {result.segments !== undefined && (
            <ToolTable
              head={[s.colYear, s.colDaysInYear, s.colYearLength]}
              rows={result.segments.map((segment) => [
                String(segment.year),
                String(segment.days),
                String(segment.yearLength),
              ])}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.debt, value: proNum(proParse(debt) ?? 0, 2) },
              { label: s.annualRate, value: `${proNum(proParse(annualRate) ?? 0, 2)}${s.unitPercent}` },
              { label: s.basis, value: basisLabel },
              { label: s.method, value: methodLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------- lease-term-dates */

export function LeaseTermDatesTool() {
  const s = strings.pro.nekretnine["lease-term-dates"];
  const [startText, setStartText] = useState("");
  const [months, setMonths] = useState("");
  const [noticeAmount, setNoticeAmount] = useState("");
  const [noticeUnit, setNoticeUnit] = useState<NoticeUnit>("days");
  const [installmentDay, setInstallmentDay] = useState("");

  const start = parseCalendarDate(startText);
  const noticeAmountValue = proParse(noticeAmount);
  const installmentDayValue = proParse(installmentDay);
  const typed = startText.trim() !== "" || proParse(months) !== undefined;

  const result = leaseTermDates({
    start: start ?? { year: Number.NaN, month: Number.NaN, day: Number.NaN },
    months: proParse(months) ?? Number.NaN,
    noticeAmount: noticeAmountValue,
    noticeUnit: noticeAmountValue === undefined ? undefined : noticeUnit,
    installmentDay: installmentDayValue,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "start"
        ? s.errorStart
        : result.reason === "months"
          ? s.errorMonths
          : result.reason === "noticeAmount"
            ? s.errorNoticeAmount
            : result.reason === "installmentDay"
              ? s.errorInstallmentDay
              : s.errorNoticeUnit;

  const noticeUnitLabel = noticeUnit === "days" ? s.noticeUnitDays : s.noticeUnitMonths;

  const copyText = !result.ok
    ? ""
    : [
        `${s.expiry}: ${formatDate(result.expiry)}${result.expiryDayClamped ? ` (${s.clamped})` : ""}`,
        `${s.lastValidDay}: ${formatDate(result.lastValidDay)}`,
        result.noticeDeadline === undefined
          ? undefined
          : `${s.noticeDeadline}: ${formatDate(result.noticeDeadline)}${result.noticeBeforeStart === true ? ` (${s.beforeStart})` : ""}`,
        `${s.totalDays}: ${result.totalDays}`,
        "",
        `${s.start}: ${startText.trim()}`,
        `${s.months}: ${months.trim()}`,
        noticeAmountValue === undefined ? undefined : `${s.noticeAmount}: ${noticeAmount.trim()} (${noticeUnitLabel})`,
        installmentDayValue === undefined ? undefined : `${s.installmentDay}: ${installmentDay.trim()}`,
        ...result.installments.map((date, i) => `${i + 1}. ${formatDate(date)}`),
      ]
        .filter((line) => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.start} hint={s.dateHint} value={startText} onChange={setStartText} />
      <ToolInput label={s.months} value={months} onChange={setMonths} />
      <ToolInput label={s.noticeAmount} hint={s.noticeHint} value={noticeAmount} onChange={setNoticeAmount} />
      <ToolSelect<NoticeUnit>
        label={s.noticeUnit}
        value={noticeUnit}
        onChange={setNoticeUnit}
        options={[
          { id: "days", label: s.noticeUnitDays },
          { id: "months", label: s.noticeUnitMonths },
        ]}
      />
      <ToolInput
        label={s.installmentDay}
        hint={s.installmentDayHint}
        value={installmentDay}
        onChange={setInstallmentDay}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.expiry} value={formatDate(result.expiry)} />
          {result.expiryDayClamped && <p className="nx-hint nx-hint--prose">{s.expiryClampedNote}</p>}
          <ResultRow label={s.lastValidDay} value={formatDate(result.lastValidDay)} />
          {result.noticeDeadline !== undefined && (
            <ResultRow label={s.noticeDeadline} value={formatDate(result.noticeDeadline)} />
          )}
          {result.noticeBeforeStart === true && <p className="nx-hint nx-hint--prose">{s.noticeBeforeStartNote}</p>}
          <ResultRow label={s.totalDays} value={String(result.totalDays)} />
          {result.installments.length > 0 && (
            <>
              <ToolTable
                head={[s.colInstallmentNo, s.colInstallmentDate]}
                rows={result.installments.map((date, i) => [String(i + 1), formatDate(date)])}
              />
              <p className="nx-hint nx-hint--prose">{s.installmentsAdvanceNote}</p>
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.start, value: startText.trim() },
              { label: s.months, value: months.trim() },
              noticeAmountValue === undefined
                ? undefined
                : { label: s.noticeAmount, value: `${noticeAmount.trim()} (${noticeUnitLabel})` },
              installmentDayValue === undefined
                ? undefined
                : { label: s.installmentDay, value: installmentDay.trim() },
            ].filter((entry) => entry !== undefined)}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* --------------------------------------------------------------- loan-amortization */

export function LoanAmortizationTool() {
  const s = strings.pro.nekretnine["loan-amortization"];
  const [principal, setPrincipal] = useState("");
  const [annualRate, setAnnualRate] = useState("");
  const [months, setMonths] = useState("");
  const [balanceMonth, setBalanceMonth] = useState("");
  const [prepayment, setPrepayment] = useState("");
  const [prepaymentMonth, setPrepaymentMonth] = useState("");

  const typed =
    proParse(principal) !== undefined ||
    proParse(annualRate) !== undefined ||
    proParse(months) !== undefined;
  const result = loanAmortization({
    principal: proParse(principal) ?? Number.NaN,
    annualRate: proParse(annualRate) ?? Number.NaN,
    months: proParse(months) ?? Number.NaN,
    balanceMonth: proParse(balanceMonth),
    prepayment: proParse(prepayment),
    prepaymentMonth: proParse(prepaymentMonth),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "principal"
        ? s.errorPrincipal
        : result.reason === "annualRate"
          ? s.errorAnnualRate
          : result.reason === "months"
            ? s.errorMonths
            : result.reason === "balanceMonth"
              ? s.errorBalanceMonth
              : result.reason === "prepayment"
                ? s.errorPrepayment
                : s.errorPrepaymentMonth;

  const effect = result.ok ? result.prepaymentEffect : undefined;

  const copyText = !result.ok
    ? ""
    : [
        `${s.payment}: ${proNum(result.payment, 2)}`,
        `${s.totalPaid}: ${proNum(result.totalPaid, 2)}`,
        `${s.totalInterest}: ${proNum(result.totalInterest, 2)}`,
        `${s.principalSum}: ${proNum(result.principalSum, 2)}`,
        result.balanceAt === undefined ? undefined : `${s.balanceAt}: ${proNum(result.balanceAt, 2)}`,
        effect?.kind === "closes" ? `${s.payoff}: ${proNum(effect.payoff, 2)}` : undefined,
        effect?.kind === "options"
          ? [
              `${s.balanceAfter}: ${proNum(effect.balanceAfter, 2)}`,
              `${s.shorterTerm} — ${s.instalments}: ${effect.shorterTerm.instalments}, ${s.finalPayment}: ${proNum(effect.shorterTerm.finalPayment, 2)}, ${s.interestSavings}: ${proNum(effect.shorterTerm.interestSavings, 2)}`,
              `${s.lowerPayment} — ${s.payment}: ${proNum(effect.lowerPayment.payment, 2)}, ${s.interestSavings}: ${proNum(effect.lowerPayment.interestSavings, 2)}`,
            ].join("\n")
          : undefined,
        "",
        `${s.principal}: ${proNum(proParse(principal) ?? 0, 2)}`,
        `${s.annualRate}: ${proNum(proParse(annualRate) ?? 0, 2)}${s.unitPercent}`,
        `${s.months}: ${months.trim()}`,
      ]
        .filter((line) => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.principal} value={principal} onChange={setPrincipal} />
      <ToolInput label={s.annualRate} hint={s.annualRateHint} value={annualRate} onChange={setAnnualRate} />
      <ToolInput label={s.months} value={months} onChange={setMonths} />
      <ToolInput label={s.balanceMonth} hint={s.balanceMonthHint} value={balanceMonth} onChange={setBalanceMonth} />
      <ToolInput label={s.prepayment} value={prepayment} onChange={setPrepayment} />
      <ToolInput
        label={s.prepaymentMonth}
        hint={s.prepaymentMonthHint}
        value={prepaymentMonth}
        onChange={setPrepaymentMonth}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <p className="nx-hint nx-hint--prose">{s.conventionNote}</p>
          <ResultRow label={s.payment} value={proNum(result.payment, 2)} />
          <ResultRow label={s.totalPaid} value={proNum(result.totalPaid, 2)} />
          <ResultRow label={s.totalInterest} value={proNum(result.totalInterest, 2)} />
          <ResultRow label={s.principalSum} value={proNum(result.principalSum, 2)} />
          {result.balanceAt !== undefined && (
            <ResultRow label={s.balanceAt} value={proNum(result.balanceAt, 2)} />
          )}
          <ToolTable
            head={[s.colMonth, s.colPayment, s.colInterest, s.colPrincipal, s.colBalance]}
            rows={result.schedule.map((row) => [
              String(row.month),
              proNum(row.payment, 2),
              proNum(row.interest, 2),
              proNum(row.principal, 2),
              proNum(row.balance, 2),
            ])}
          />
          {effect?.kind === "closes" && (
            <>
              <ResultRow label={s.payoff} value={proNum(effect.payoff, 2)} />
              <p className="nx-hint nx-hint--prose">{s.closesNote}</p>
            </>
          )}
          {effect?.kind === "options" && (
            <>
              <ResultRow label={s.balanceBefore} value={proNum(effect.balanceBefore, 2)} />
              <ResultRow label={s.balanceAfter} value={proNum(effect.balanceAfter, 2)} />
              <ToolSection title={s.shorterTerm}>
                <ResultRow label={s.instalments} value={String(effect.shorterTerm.instalments)} />
                <ResultRow label={s.payment} value={proNum(effect.shorterTerm.payment, 2)} />
                <ResultRow label={s.finalPayment} value={proNum(effect.shorterTerm.finalPayment, 2)} />
                <ResultRow label={s.totalInterest} value={proNum(effect.shorterTerm.totalInterest, 2)} />
                <ResultRow label={s.totalPaid} value={proNum(effect.shorterTerm.totalPaid, 2)} />
                <ResultRow label={s.interestSavings} value={proNum(effect.shorterTerm.interestSavings, 2)} />
              </ToolSection>
              <ToolSection title={s.lowerPayment}>
                <ResultRow label={s.payment} value={proNum(effect.lowerPayment.payment, 2)} />
                <ResultRow label={s.instalments} value={String(effect.lowerPayment.instalments)} />
                <ResultRow label={s.totalInterest} value={proNum(effect.lowerPayment.totalInterest, 2)} />
                <ResultRow label={s.totalPaid} value={proNum(effect.lowerPayment.totalPaid, 2)} />
                <ResultRow label={s.interestSavings} value={proNum(effect.lowerPayment.interestSavings, 2)} />
              </ToolSection>
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.principal, value: proNum(proParse(principal) ?? 0, 2) },
              { label: s.annualRate, value: `${proNum(proParse(annualRate) ?? 0, 2)}${s.unitPercent}` },
              { label: s.months, value: months.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------- ownership-shares */

export function OwnershipSharesTool() {
  const s = strings.pro.nekretnine["ownership-shares"];
  const [rowsText, setRowsText] = useState("");
  const [totalArea, setTotalArea] = useState("");
  const [partArea, setPartArea] = useState("");
  const [wholeArea, setWholeArea] = useState("");

  const rows = splitRows(rowsText).map((line) => {
    const [numText = "", denText = ""] = line.split("/");
    return { numerator: proParse(numText), denominator: proParse(denText) };
  });
  const typedForward = rows.length > 0;
  const forward = ownershipShares({
    rows: rows.map((row) => ({
      numerator: row.numerator ?? Number.NaN,
      denominator: row.denominator ?? Number.NaN,
    })),
    totalArea: proParse(totalArea),
  });
  const forwardFailure =
    forward.ok || !typedForward
      ? undefined
      : forward.reason === "rows"
        ? s.errorRows
        : forward.reason === "numerator"
          ? s.errorNumerator
          : forward.reason === "denominator"
            ? s.errorDenominator
            : s.errorTotalArea;

  const comparisonText = !forward.ok
    ? ""
    : forward.comparison === "exact"
      ? s.comparisonExact
      : forward.comparison === "short"
        ? `${s.comparisonShort} ${forward.difference.numerator}/${forward.difference.denominator}`
        : `${s.comparisonOver} ${forward.difference.numerator}/${forward.difference.denominator}`;

  const forwardCopyText = !forward.ok
    ? ""
    : [
        ...forward.rows.map(
          (row, i) => `${i + 1}. ${row.numerator}/${row.denominator} = ${proNum(row.percent, 4)}%${row.area === undefined ? "" : `  ${proNum(row.area, 2)} m²`}`,
        ),
        `${s.sum}: ${forward.sum.numerator}/${forward.sum.denominator} (${comparisonText})`,
        `${s.commonDenominator}: ${forward.commonDenominator}`,
        forward.areaCheckSum === undefined ? undefined : `${s.areaCheckSum}: ${proNum(forward.areaCheckSum, 2)} m²`,
        "",
        `${s.rows}: ${rows.length}`,
        totalArea.trim() === "" ? undefined : `${s.totalArea}: ${proNum(proParse(totalArea) ?? 0, 2)} m²`,
      ]
        .filter((line) => line !== undefined)
        .join("\n");

  const typedReverse = proParse(partArea) !== undefined || proParse(wholeArea) !== undefined;
  const reverse = areaShareFraction({
    partArea: proParse(partArea) ?? Number.NaN,
    wholeArea: proParse(wholeArea) ?? Number.NaN,
  });
  const reverseFailure =
    reverse.ok || !typedReverse
      ? undefined
      : reverse.reason === "partArea"
        ? s.errorPartArea
        : s.errorWholeArea;
  const reverseCopyText = !reverse.ok
    ? ""
    : [
        `${s.reverseFraction}: ${reverse.numerator}/${reverse.denominator}`,
        `${s.reversePercent}: ${proNum(reverse.percent, 4)}%`,
        "",
        `${s.partArea}: ${proNum(proParse(partArea) ?? 0, 2)} m²`,
        `${s.wholeArea}: ${proNum(proParse(wholeArea) ?? 0, 2)} m²`,
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.rows} hint={s.rowsHint} value={rowsText} onChange={setRowsText} />
      <ToolInput label={s.totalArea} hint={s.totalAreaHint} value={totalArea} onChange={setTotalArea} />

      {forwardFailure !== undefined && <ToolFailure>{forwardFailure}</ToolFailure>}

      {forward.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colRow, s.colFraction, s.colPercent, s.colAtCommonDenominator, s.colArea]}
            rows={forward.rows.map((row, i) => [
              String(i + 1),
              `${row.numerator}/${row.denominator}`,
              `${proNum(row.percent, 4)}%`,
              `${row.numeratorAtCommonDenominator}/${forward.commonDenominator}`,
              row.area === undefined ? "—" : proUnit(proNum(row.area, 2), s.unitM2),
            ])}
          />
          <ResultRow label={s.sum} value={`${forward.sum.numerator}/${forward.sum.denominator}`} />
          <ResultRow label={s.comparison} value={comparisonText} />
          <ResultRow label={s.commonDenominator} value={forward.commonDenominator} />
          {forward.areaCheckSum !== undefined && (
            <ResultRow label={s.areaCheckSum} value={proUnit(proNum(forward.areaCheckSum, 2), s.unitM2)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.rows, value: String(rows.length) },
              totalArea.trim() === ""
                ? undefined
                : { label: s.totalArea, value: proUnit(proNum(proParse(totalArea) ?? 0, 2), s.unitM2) },
            ].filter((entry) => entry !== undefined)}
          />
          <CopyButton value={forwardCopyText} />
        </ToolSection>
      )}

      <ToolSection title={s.reverseTitle}>
        <ToolInput label={s.partArea} value={partArea} onChange={setPartArea} />
        <ToolInput label={s.wholeArea} value={wholeArea} onChange={setWholeArea} />
        {reverseFailure !== undefined && <ToolFailure>{reverseFailure}</ToolFailure>}
        {reverse.ok && (
          <>
            <ResultRow label={s.reverseFraction} value={`${reverse.numerator}/${reverse.denominator}`} />
            <ResultRow label={s.reversePercent} value={`${proNum(reverse.percent, 4)}%`} />
            <ToolInputEcho
              entries={[
                { label: s.partArea, value: proUnit(proNum(proParse(partArea) ?? 0, 2), s.unitM2) },
                { label: s.wholeArea, value: proUnit(proNum(proParse(wholeArea) ?? 0, 2), s.unitM2) },
              ]}
            />
            <CopyButton value={reverseCopyText} />
          </>
        )}
      </ToolSection>
    </>
  );
}

/* -------------------------------------------------------------- parcel-polygon-area */

export function ParcelPolygonAreaTool() {
  const s = strings.pro.nekretnine["parcel-polygon-area"];
  const [pointsText, setPointsText] = useState("");

  const lines = splitRows(pointsText);
  const points = lines.map((line) => {
    const [xText = "", yText = ""] = line.split(";");
    return { x: proParse(xText) ?? Number.NaN, y: proParse(yText) ?? Number.NaN };
  });
  const typed = lines.length > 0;
  const result = parcelPolygonArea(points);

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "points"
        ? s.errorPoints
        : result.reason === "selfIntersecting"
          ? s.errorSelfIntersecting
          : s.errorCollinear;

  const orientationText = !result.ok ? "" : result.orientation === "ccw" ? s.orientationCcw : s.orientationCw;

  const copyText = !result.ok
    ? ""
    : [
        `${s.area}: ${proNum(result.area, 2)} m²`,
        `${s.ares}: ${proNum(result.ares, 4)} a`,
        `${s.hectares}: ${proNum(result.hectares, 6)} ha`,
        `${s.perimeter}: ${proNum(result.perimeter, 2)} m`,
        `${s.orientation}: ${orientationText}`,
        "",
        `${s.points}: ${lines.length}`,
        ...lines.map((line, i) => `P${i + 1}: ${line}`),
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.points} hint={s.pointsHint} value={pointsText} onChange={setPointsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.area} value={proUnit(proNum(result.area, 2), s.unitM2)} />
          <ResultRow label={s.ares} value={proUnit(proNum(result.ares, 4), s.unitAre)} />
          <ResultRow label={s.hectares} value={proUnit(proNum(result.hectares, 6), s.unitHa)} />
          <ResultRow label={s.perimeter} value={proUnit(proNum(result.perimeter, 2), s.unitM)} />
          <ResultRow label={s.orientation} value={orientationText} />
          <p className="nx-hint nx-hint--prose">{s.orientationNote}</p>
          <ToolTable
            head={[s.colEdge, s.colLength]}
            rows={result.edges.map((edge) => [
              `P${edge.from}→P${edge.to}`,
              proUnit(proNum(edge.length, 2), s.unitM),
            ])}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.points, value: String(lines.length) }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------- plot-density-index */

export function PlotDensityIndexTool() {
  const s = strings.pro.nekretnine["plot-density-index"];
  const [plotArea, setPlotArea] = useState("");
  const [grossFloorArea, setGrossFloorArea] = useState("");
  const [footprint, setFootprint] = useState("");
  const [planRatio, setPlanRatio] = useState("");
  const [planCoverage, setPlanCoverage] = useState("");

  const typed = proParse(plotArea) !== undefined;
  const result = plotDensityIndex({
    plotArea: proParse(plotArea) ?? Number.NaN,
    grossFloorArea: proParse(grossFloorArea),
    footprint: proParse(footprint),
    planRatio: proParse(planRatio),
    planCoverage: proParse(planCoverage),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "plotArea"
        ? s.errorPlotArea
        : result.reason === "grossFloorArea"
          ? s.errorGrossFloorArea
          : result.reason === "footprint"
            ? s.errorFootprint
            : result.reason === "planRatio"
              ? s.errorPlanRatio
              : s.errorPlanCoverage;

  const copyText = !result.ok
    ? ""
    : [
        result.ratio === undefined ? undefined : `${s.ratio}: ${proNum(result.ratio, 2)}`,
        result.coverage === undefined ? undefined : `${s.coverage}: ${proNum(result.coverage, 2)}%`,
        result.freeArea === undefined ? undefined : `${s.freeArea}: ${proNum(result.freeArea, 2)} m²`,
        result.freeAreaPercent === undefined
          ? undefined
          : `${s.freeAreaPercent}: ${proNum(result.freeAreaPercent, 2)}%`,
        result.floorAreaToFootprintRatio === undefined
          ? undefined
          : `${s.floorAreaToFootprintRatio}: ${proNum(result.floorAreaToFootprintRatio, 2)}`,
        result.grossFloorAreaAtPlanRatio === undefined
          ? undefined
          : `${s.grossFloorAreaAtPlanRatio}: ${proNum(result.grossFloorAreaAtPlanRatio, 2)} m²`,
        result.grossFloorAreaDifference === undefined
          ? undefined
          : `${s.grossFloorAreaDifference}: ${proNum(result.grossFloorAreaDifference, 2)} m²`,
        result.ratioAgainstPlan === undefined
          ? undefined
          : `${s.ratioAgainstPlan}: ${proRatio(result.ratioAgainstPlan)}`,
        result.footprintAtPlanCoverage === undefined
          ? undefined
          : `${s.footprintAtPlanCoverage}: ${proNum(result.footprintAtPlanCoverage, 2)} m²`,
        result.footprintDifference === undefined
          ? undefined
          : `${s.footprintDifference}: ${proNum(result.footprintDifference, 2)} m²`,
        result.coverageAgainstPlan === undefined
          ? undefined
          : `${s.coverageAgainstPlan}: ${proRatio(result.coverageAgainstPlan)}`,
        "",
        `${s.plotArea}: ${proNum(proParse(plotArea) ?? 0, 2)} m²`,
        grossFloorArea.trim() === "" ? undefined : `${s.grossFloorArea}: ${proNum(proParse(grossFloorArea) ?? 0, 2)} m²`,
        footprint.trim() === "" ? undefined : `${s.footprint}: ${proNum(proParse(footprint) ?? 0, 2)} m²`,
        planRatio.trim() === "" ? undefined : `${s.planRatio}: ${proNum(proParse(planRatio) ?? 0, 2)}`,
        planCoverage.trim() === "" ? undefined : `${s.planCoverage}: ${proNum(proParse(planCoverage) ?? 0, 2)}%`,
      ]
        .filter((line) => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.plotArea} value={plotArea} onChange={setPlotArea} />
      <ToolInput label={s.grossFloorArea} value={grossFloorArea} onChange={setGrossFloorArea} />
      <ToolInput label={s.footprint} value={footprint} onChange={setFootprint} />
      <ToolInput label={s.planRatio} hint={s.planLimitHint} value={planRatio} onChange={setPlanRatio} />
      <ToolInput label={s.planCoverage} value={planCoverage} onChange={setPlanCoverage} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <p className="nx-hint nx-hint--prose">{s.brgpScopeNote}</p>
          {result.ratio !== undefined && <ResultRow label={s.ratio} value={proNum(result.ratio, 2)} />}
          {result.coverage !== undefined && (
            <ResultRow label={s.coverage} value={`${proNum(result.coverage, 2)}%`} />
          )}
          {result.freeArea !== undefined && (
            <ResultRow label={s.freeArea} value={proUnit(proNum(result.freeArea, 2), s.unitM2)} />
          )}
          {result.freeAreaPercent !== undefined && (
            <ResultRow label={s.freeAreaPercent} value={`${proNum(result.freeAreaPercent, 2)}%`} />
          )}
          {result.floorAreaToFootprintRatio !== undefined && (
            <ResultRow label={s.floorAreaToFootprintRatio} value={proNum(result.floorAreaToFootprintRatio, 2)} />
          )}

          {result.grossFloorAreaAtPlanRatio !== undefined && (
            <>
              <ToolAgainstLimit
                label={s.ratio}
                value={result.ratio === undefined ? "—" : proNum(result.ratio, 2)}
                limitLabel={s.planRatio}
                limit={proParse(planRatio) === undefined ? undefined : proNum(proParse(planRatio) ?? 0, 2)}
                ratioLabel={s.ratioAgainstPlan}
                ratio={proRatio(result.ratioAgainstPlan)}
              />
              <ResultRow
                label={s.grossFloorAreaAtPlanRatio}
                value={proUnit(proNum(result.grossFloorAreaAtPlanRatio, 2), s.unitM2)}
              />
              {result.grossFloorAreaDifference !== undefined && (
                <ResultRow
                  label={s.grossFloorAreaDifference}
                  value={proUnit(proNum(result.grossFloorAreaDifference, 2), s.unitM2)}
                />
              )}
            </>
          )}

          {result.footprintAtPlanCoverage !== undefined && (
            <>
              <ToolAgainstLimit
                label={s.coverage}
                value={result.coverage === undefined ? "—" : `${proNum(result.coverage, 2)}%`}
                limitLabel={s.planCoverage}
                limit={
                  proParse(planCoverage) === undefined ? undefined : `${proNum(proParse(planCoverage) ?? 0, 2)}%`
                }
                ratioLabel={s.coverageAgainstPlan}
                ratio={proRatio(result.coverageAgainstPlan)}
              />
              <ResultRow
                label={s.footprintAtPlanCoverage}
                value={proUnit(proNum(result.footprintAtPlanCoverage, 2), s.unitM2)}
              />
              {result.footprintDifference !== undefined && (
                <ResultRow
                  label={s.footprintDifference}
                  value={proUnit(proNum(result.footprintDifference, 2), s.unitM2)}
                />
              )}
            </>
          )}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.plotArea, value: proUnit(proNum(proParse(plotArea) ?? 0, 2), s.unitM2) },
              grossFloorArea.trim() === ""
                ? undefined
                : { label: s.grossFloorArea, value: proUnit(proNum(proParse(grossFloorArea) ?? 0, 2), s.unitM2) },
              footprint.trim() === ""
                ? undefined
                : { label: s.footprint, value: proUnit(proNum(proParse(footprint) ?? 0, 2), s.unitM2) },
              planRatio.trim() === "" ? undefined : { label: s.planRatio, value: proNum(proParse(planRatio) ?? 0, 2) },
              planCoverage.trim() === ""
                ? undefined
                : { label: s.planCoverage, value: `${proNum(proParse(planCoverage) ?? 0, 2)}%` },
            ].filter((entry) => entry !== undefined)}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------- pro-rata-days */

export function ProRataDaysTool() {
  const s = strings.pro.nekretnine["pro-rata-days"];
  const [total, setTotal] = useState("");
  const [periodStartText, setPeriodStartText] = useState("");
  const [periodEndText, setPeriodEndText] = useState("");
  const [handoverText, setHandoverText] = useState("");
  const [basis, setBasis] = useState<ProRataBasis>("act");

  const periodStart = parseCalendarDate(periodStartText);
  const periodEnd = parseCalendarDate(periodEndText);
  const handover = parseCalendarDate(handoverText);
  const typed =
    proParse(total) !== undefined ||
    periodStartText.trim() !== "" ||
    periodEndText.trim() !== "" ||
    handoverText.trim() !== "";
  const missing: CalendarDate = { year: Number.NaN, month: Number.NaN, day: Number.NaN };
  const result = proRataDays({
    total: proParse(total) ?? Number.NaN,
    periodStart: periodStart ?? missing,
    periodEnd: periodEnd ?? missing,
    handover: handover ?? missing,
    basis,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "total"
        ? s.errorTotal
        : result.reason === "periodStart"
          ? s.errorPeriodStart
          : result.reason === "periodEnd"
            ? s.errorPeriodEnd
            : s.errorHandover;

  const basisLabel = basis === "act" ? s.basisAct : s.basisE30360;

  const copyText = !result.ok
    ? ""
    : [
        `${s.daysFirst}: ${result.daysFirst}`,
        `${s.daysSecond}: ${result.daysSecond}`,
        `${s.totalDays}: ${result.totalDays}`,
        `${s.amountFirst}: ${proNum(result.amountFirst, 2)}`,
        `${s.amountSecond}: ${proNum(result.amountSecond, 2)}`,
        `${s.checkSum}: ${proNum(result.checkSum, 2)}`,
        "",
        `${s.total}: ${proNum(proParse(total) ?? 0, 2)}`,
        `${s.periodStart}: ${periodStartText.trim()}`,
        `${s.periodEnd}: ${periodEndText.trim()}`,
        `${s.handover}: ${handoverText.trim()}`,
        `${s.basis}: ${basisLabel}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.total} value={total} onChange={setTotal} />
      <ToolInput label={s.periodStart} hint={s.dateHint} value={periodStartText} onChange={setPeriodStartText} />
      <ToolInput label={s.periodEnd} value={periodEndText} onChange={setPeriodEndText} />
      <ToolInput label={s.handover} hint={s.handoverHint} value={handoverText} onChange={setHandoverText} />
      <ToolSelect<ProRataBasis>
        label={s.basis}
        value={basis}
        onChange={setBasis}
        options={[
          { id: "act", label: s.basisAct },
          { id: "e30360", label: s.basisE30360 },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.daysFirst} value={String(result.daysFirst)} />
          <ResultRow label={s.daysSecond} value={String(result.daysSecond)} />
          <ResultRow label={s.totalDays} value={String(result.totalDays)} />
          <ResultRow label={s.amountFirst} value={proNum(result.amountFirst, 2)} />
          <ResultRow label={s.amountSecond} value={proNum(result.amountSecond, 2)} />
          <ResultRow label={s.checkSum} value={proNum(result.checkSum, 2)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.total, value: proNum(proParse(total) ?? 0, 2) },
              { label: s.periodStart, value: periodStartText.trim() },
              { label: s.periodEnd, value: periodEndText.trim() },
              { label: s.handover, value: handoverText.trim() },
              { label: s.basis, value: basisLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- rent-escalation */

type IndexMode = "fixed" | "list";

/** Reads `periods` newline-separated percentages; the first is a placeholder (period 1 is not indexed). */
function parseIndexList(lines: readonly string[], periods: number): readonly number[] | undefined {
  if (!Number.isInteger(periods) || lines.length < periods) return undefined;
  const values: number[] = [];
  for (let t = 0; t < periods; t += 1) {
    if (t === 0) {
      values.push(0);
      continue;
    }
    const parsed = proParse(lines[t] ?? "");
    if (parsed === undefined) return undefined;
    values.push(parsed);
  }
  return values;
}

export function RentEscalationTool() {
  const s = strings.pro.nekretnine["rent-escalation"];
  const [baseRent, setBaseRent] = useState("");
  const [periods, setPeriods] = useState("");
  const [mode, setMode] = useState<IndexMode>("fixed");
  const [fixedIndex, setFixedIndex] = useState("");
  const [listText, setListText] = useState("");
  const [discountRate, setDiscountRate] = useState("");

  const periodsValue = proParse(periods);
  const listLines = splitRows(listText);
  const list = periodsValue === undefined ? undefined : parseIndexList(listLines, periodsValue);
  const typed = proParse(baseRent) !== undefined || periodsValue !== undefined;

  const result = rentEscalation({
    baseRent: proParse(baseRent) ?? Number.NaN,
    periods: periodsValue ?? Number.NaN,
    index: mode === "fixed" ? (proParse(fixedIndex) ?? Number.NaN) : (list ?? []),
    discountRate: proParse(discountRate),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "baseRent"
        ? s.errorBaseRent
        : result.reason === "periods"
          ? s.errorPeriods
          : result.reason === "index"
            ? s.errorIndex
            : s.errorDiscountRate;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rents.map((rent, t) => `t=${t + 1}: ${proNum(rent, 2)}`),
        `${s.total}: ${proNum(result.total, 2)}`,
        `${s.average}: ${proNum(result.average, 2)}`,
        result.closedFormTotal === undefined ? undefined : `${s.closedFormTotal}: ${proNum(result.closedFormTotal, 2)}`,
        result.presentValue === undefined ? undefined : `${s.presentValue}: ${proNum(result.presentValue, 2)}`,
        "",
        `${s.baseRent}: ${proNum(proParse(baseRent) ?? 0, 2)}`,
        `${s.periods}: ${periods.trim()}`,
        mode === "fixed"
          ? `${s.fixedIndex}: ${proNum(proParse(fixedIndex) ?? 0, 2)}${s.unitPercent}`
          : `${s.listMode}: ${listLines.length} ${s.unitLines}`,
        discountRate.trim() === "" ? undefined : `${s.discountRate}: ${proNum(proParse(discountRate) ?? 0, 2)}${s.unitPercent}`,
      ]
        .filter((line) => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.baseRent} value={baseRent} onChange={setBaseRent} />
      <ToolInput label={s.periods} value={periods} onChange={setPeriods} />
      <ToolSelect<IndexMode>
        label={s.indexMode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "fixed", label: s.modeFixed },
          { id: "list", label: s.modeList },
        ]}
      />
      {mode === "fixed" ? (
        <ToolInput label={s.fixedIndex} hint={s.indexHint} value={fixedIndex} onChange={setFixedIndex} />
      ) : (
        <ToolTextArea label={s.listMode} hint={s.listHint} value={listText} onChange={setListText} />
      )}
      <ToolInput label={s.discountRate} value={discountRate} onChange={setDiscountRate} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <p className="nx-hint nx-hint--prose">{s.conventionNote}</p>
          <ToolTable
            head={[s.colPeriod, s.colRent]}
            rows={result.rents.map((rent, t) => [String(t + 1), proNum(rent, 2)])}
          />
          <ResultRow label={s.total} value={proNum(result.total, 2)} />
          <ResultRow label={s.average} value={proNum(result.average, 2)} />
          {result.closedFormTotal !== undefined && (
            <ResultRow label={s.closedFormTotal} value={proNum(result.closedFormTotal, 2)} />
          )}
          {result.presentValue !== undefined && (
            <ResultRow label={s.presentValue} value={proNum(result.presentValue, 2)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.baseRent, value: proNum(proParse(baseRent) ?? 0, 2) },
              { label: s.periods, value: periods.trim() },
              mode === "fixed"
                ? { label: s.fixedIndex, value: `${proNum(proParse(fixedIndex) ?? 0, 2)}${s.unitPercent}` }
                : { label: s.listMode, value: `${listLines.length} ${s.unitLines}` },
              discountRate.trim() === ""
                ? undefined
                : { label: s.discountRate, value: `${proNum(proParse(discountRate) ?? 0, 2)}${s.unitPercent}` },
            ].filter((entry) => entry !== undefined)}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* --------------------------------------------------------------------- rent-gross-net */

export function RentGrossNetTool() {
  const s = strings.pro.nekretnine["rent-gross-net"];
  const [gross, setGross] = useState("");
  const [net, setNet] = useState("");
  const [costPercent, setCostPercent] = useState("");
  const [taxRate, setTaxRate] = useState("");

  const typed = proParse(gross) !== undefined || proParse(net) !== undefined;
  const result = rentGrossNet({
    gross: proParse(gross),
    net: proParse(net),
    costPercent: proParse(costPercent) ?? Number.NaN,
    taxRate: proParse(taxRate) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "gross"
        ? s.errorGross
        : result.reason === "net"
          ? s.errorNet
          : result.reason === "costPercent"
            ? s.errorCostPercent
            : s.errorTaxRate;

  const computedFromLabel = !result.ok ? "" : result.computedFrom === "gross" ? s.fromGross : s.fromNet;

  const copyText = !result.ok
    ? ""
    : [
        `${s.base}: ${proNum(result.base, 2)}`,
        `${s.taxAmount}: ${proNum(result.taxAmount, 2)}`,
        `${s.net}: ${proNum(result.net, 2)}`,
        `${s.gross}: ${proNum(result.gross, 2)}`,
        `${s.netRoundingResidual}: ${proNum(result.netRoundingResidual, 2)}`,
        `${s.effectiveShare}: ${proNum(result.effectiveShare, 4)}%`,
        result.impliedEffectiveShare === undefined
          ? undefined
          : `${s.impliedEffectiveShare}: ${proNum(result.impliedEffectiveShare, 4)}%`,
        `${s.computedFrom}: ${computedFromLabel}`,
        "",
        `${s.taxRate}: ${proNum(result.taxRate, 2)}%`,
        `${s.costPercent}: ${proNum(result.costPercent, 2)}%`,
      ]
        .filter((line) => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.gross} hint={s.grossHint} value={gross} onChange={setGross} />
      <ToolInput label={s.net} value={net} onChange={setNet} />
      <ToolInput label={s.costPercent} hint={s.costPercentHint} value={costPercent} onChange={setCostPercent} />
      <ToolInput label={s.taxRate} hint={s.taxRateHint} value={taxRate} onChange={setTaxRate} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.base} value={proNum(result.base, 2)} />
          <ResultRow label={s.taxAmount} value={proNum(result.taxAmount, 2)} />
          <ResultRow label={s.net} value={proNum(result.net, 2)} />
          <ResultRow label={s.gross} value={proNum(result.gross, 2)} />
          <ResultRow label={s.netRoundingResidual} value={proNum(result.netRoundingResidual, 2)} />
          <ResultRow label={s.effectiveShare} value={`${proNum(result.effectiveShare, 4)}%`} />
          {result.impliedEffectiveShare !== undefined && (
            <ResultRow label={s.impliedEffectiveShare} value={`${proNum(result.impliedEffectiveShare, 4)}%`} />
          )}
          <ResultRow label={s.computedFrom} value={computedFromLabel} />
          <ResultRow label={s.taxRate} value={`${proNum(result.taxRate, 2)}%`} />
          <ResultRow label={s.costPercent} value={`${proNum(result.costPercent, 2)}%`} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              gross.trim() === "" ? undefined : { label: s.gross, value: proNum(proParse(gross) ?? 0, 2) },
              net.trim() === "" ? undefined : { label: s.net, value: proNum(proParse(net) ?? 0, 2) },
              { label: s.costPercent, value: `${proNum(result.costPercent, 2)}%` },
              { label: s.taxRate, value: `${proNum(result.taxRate, 2)}%` },
            ].filter((entry) => entry !== undefined)}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------ rental-yield */

export function RentalYieldTool() {
  const s = strings.pro.nekretnine["rental-yield"];
  const [price, setPrice] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [monthlyCosts, setMonthlyCosts] = useState("");
  const [annualCosts, setAnnualCosts] = useState("");
  const [capRate, setCapRate] = useState("");

  const typed = proParse(price) !== undefined || proParse(monthlyRent) !== undefined;
  const result = rentalYield({
    price: proParse(price),
    monthlyRent: proParse(monthlyRent) ?? Number.NaN,
    occupancy: proParse(occupancy),
    monthlyCosts: proParse(monthlyCosts),
    annualCosts: proParse(annualCosts),
    capRate: proParse(capRate),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "price"
        ? s.errorPrice
        : result.reason === "monthlyRent"
          ? s.errorMonthlyRent
          : result.reason === "occupancy"
            ? s.errorOccupancy
            : result.reason === "monthlyCosts"
              ? s.errorMonthlyCosts
              : result.reason === "annualCosts"
                ? s.errorAnnualCosts
                : s.errorCapRate;

  const copyText = !result.ok
    ? ""
    : [
        `${s.grossPotentialIncome}: ${proNum(result.grossPotentialIncome, 2)}`,
        `${s.effectiveGrossIncome}: ${proNum(result.effectiveGrossIncome, 2)}`,
        `${s.netOperatingIncome}: ${proNum(result.netOperatingIncome, 2)}`,
        result.grossYield === undefined ? undefined : `${s.grossYield}: ${proNum(result.grossYield, 4)}%`,
        result.netYield === undefined ? undefined : `${s.netYield}: ${proNum(result.netYield, 4)}%`,
        result.grossRentMultiplier === undefined
          ? undefined
          : `${s.grossRentMultiplier}: ${proNum(result.grossRentMultiplier, 2)}`,
        result.paybackYears === undefined ? undefined : `${s.paybackYears}: ${proNum(result.paybackYears, 2)}`,
        result.valueAtCapRate === undefined ? undefined : `${s.valueAtCapRate}: ${proNum(result.valueAtCapRate, 2)}`,
        "",
        price.trim() === "" ? undefined : `${s.price}: ${proNum(proParse(price) ?? 0, 2)}`,
        `${s.monthlyRent}: ${proNum(proParse(monthlyRent) ?? 0, 2)}`,
        `${s.occupancy}: ${proNum(result.occupancyUsed, 2)}%`,
        `${s.monthlyCosts}: ${proNum(proParse(monthlyCosts) ?? 0, 2)}`,
        `${s.annualCosts}: ${proNum(proParse(annualCosts) ?? 0, 2)}`,
        capRate.trim() === "" ? undefined : `${s.capRate}: ${proNum(proParse(capRate) ?? 0, 2)}%`,
      ]
        .filter((line) => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.price} hint={s.priceHint} value={price} onChange={setPrice} />
      <ToolInput label={s.monthlyRent} value={monthlyRent} onChange={setMonthlyRent} />
      <ToolInput label={s.occupancy} hint={s.occupancyHint} value={occupancy} onChange={setOccupancy} />
      <ToolInput label={s.monthlyCosts} hint={s.costsHint} value={monthlyCosts} onChange={setMonthlyCosts} />
      <ToolInput label={s.annualCosts} value={annualCosts} onChange={setAnnualCosts} />
      <ToolInput label={s.capRate} hint={s.capRateHint} value={capRate} onChange={setCapRate} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.grossPotentialIncome} value={proNum(result.grossPotentialIncome, 2)} />
          <ResultRow label={s.effectiveGrossIncome} value={proNum(result.effectiveGrossIncome, 2)} />
          <ResultRow label={s.netOperatingIncome} value={proNum(result.netOperatingIncome, 2)} />
          {result.grossYield !== undefined && (
            <ResultRow label={s.grossYield} value={`${proNum(result.grossYield, 4)}%`} />
          )}
          {result.netYield !== undefined && (
            <ResultRow label={s.netYield} value={`${proNum(result.netYield, 4)}%`} />
          )}
          {result.grossRentMultiplier !== undefined && (
            <ResultRow label={s.grossRentMultiplier} value={proNum(result.grossRentMultiplier, 2)} />
          )}
          {result.paybackYears !== undefined && (
            <ResultRow label={s.paybackYears} value={proNum(result.paybackYears, 2)} />
          )}
          {result.paybackYears === undefined && result.netOperatingIncome <= 0 && (
            <p className="nx-hint nx-hint--prose">{s.negativeNoiNote}</p>
          )}
          {result.valueAtCapRate !== undefined && (
            <ResultRow label={s.valueAtCapRate} value={proNum(result.valueAtCapRate, 2)} />
          )}
          <p className="nx-hint nx-hint--prose">{s.costsAreYoursNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              price.trim() === "" ? undefined : { label: s.price, value: proNum(proParse(price) ?? 0, 2) },
              { label: s.monthlyRent, value: proNum(proParse(monthlyRent) ?? 0, 2) },
              { label: s.occupancy, value: `${proNum(result.occupancyUsed, 2)}%` },
              { label: s.monthlyCosts, value: proNum(proParse(monthlyCosts) ?? 0, 2) },
              { label: s.annualCosts, value: proNum(proParse(annualCosts) ?? 0, 2) },
              capRate.trim() === "" ? undefined : { label: s.capRate, value: `${proNum(proParse(capRate) ?? 0, 2)}%` },
            ].filter((entry) => entry !== undefined)}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- room-quad-area */

export function RoomQuadAreaTool() {
  const s = strings.pro.nekretnine["room-quad-area"];
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  const [d, setD] = useState("");
  const [e, setE] = useState("");

  const typed =
    proParse(a) !== undefined ||
    proParse(b) !== undefined ||
    proParse(c) !== undefined ||
    proParse(d) !== undefined ||
    proParse(e) !== undefined;
  const result = roomQuadArea({
    a: proParse(a) ?? Number.NaN,
    b: proParse(b) ?? Number.NaN,
    c: proParse(c) ?? Number.NaN,
    d: proParse(d) ?? Number.NaN,
    e: proParse(e) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "a"
        ? s.errorA
        : result.reason === "b"
          ? s.errorB
          : result.reason === "c"
            ? s.errorC
            : result.reason === "d"
              ? s.errorD
              : result.reason === "e"
                ? s.errorE
                : result.reason === "diagonalTooLongAB"
                  ? s.errorDiagonalTooLongAB
                  : result.reason === "diagonalTooShortAB"
                    ? s.errorDiagonalTooShortAB
                    : result.reason === "diagonalTooLongCD"
                      ? s.errorDiagonalTooLongCD
                      : result.reason === "diagonalTooShortCD"
                        ? s.errorDiagonalTooShortCD
                        : result.reason === "collinearABC"
                          ? s.errorCollinearABC
                          : s.errorCollinearACD;

  const copyText = !result.ok
    ? ""
    : [
        `${s.area}: ${proUnit(proNum(result.area, 2), s.unitM2)}`,
        `${s.triangleAbc}: ${proUnit(proNum(result.triangleAbc, 2), s.unitM2)}`,
        `${s.triangleAcd}: ${proUnit(proNum(result.triangleAcd, 2), s.unitM2)}`,
        `${s.angleB}: ${proNum(result.angleB, 2)}${s.unitDeg}`,
        `${s.deviationFrom90}: ${proNum(result.deviationFrom90, 2)}${s.unitDeg}`,
        `${s.angleD}: ${proNum(result.angleD, 2)}${s.unitDeg}`,
        `${s.deviationFrom90AtD}: ${proNum(result.deviationFrom90AtD, 2)}${s.unitDeg}`,
        "",
        `a: ${proUnit(proNum(proParse(a) ?? 0, 3), s.unitM)}`,
        `b: ${proUnit(proNum(proParse(b) ?? 0, 3), s.unitM)}`,
        `c: ${proUnit(proNum(proParse(c) ?? 0, 3), s.unitM)}`,
        `d: ${proUnit(proNum(proParse(d) ?? 0, 3), s.unitM)}`,
        `e: ${proUnit(proNum(proParse(e) ?? 0, 3), s.unitM)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.a} value={a} onChange={setA} />
      <ToolInput label={s.b} value={b} onChange={setB} />
      <ToolInput label={s.c} value={c} onChange={setC} />
      <ToolInput label={s.d} value={d} onChange={setD} />
      <ToolInput label={s.e} hint={s.eHint} value={e} onChange={setE} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.area} value={proUnit(proNum(result.area, 2), s.unitM2)} />
          <ResultRow label={s.triangleAbc} value={proUnit(proNum(result.triangleAbc, 2), s.unitM2)} />
          <ResultRow label={s.triangleAcd} value={proUnit(proNum(result.triangleAcd, 2), s.unitM2)} />
          <ResultRow label={s.angleB} value={`${proNum(result.angleB, 2)}${s.unitDeg}`} />
          <ResultRow label={s.deviationFrom90} value={`${proNum(result.deviationFrom90, 2)}${s.unitDeg}`} />
          <ResultRow label={s.angleD} value={`${proNum(result.angleD, 2)}${s.unitDeg}`} />
          <ResultRow label={s.deviationFrom90AtD} value={`${proNum(result.deviationFrom90AtD, 2)}${s.unitDeg}`} />
          <p className="nx-hint nx-hint--prose">{s.reentrantNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.a, value: proUnit(proNum(proParse(a) ?? 0, 3), s.unitM) },
              { label: s.b, value: proUnit(proNum(proParse(b) ?? 0, 3), s.unitM) },
              { label: s.c, value: proUnit(proNum(proParse(c) ?? 0, 3), s.unitM) },
              { label: s.d, value: proUnit(proNum(proParse(d) ?? 0, 3), s.unitM) },
              { label: s.e, value: proUnit(proNum(proParse(e) ?? 0, 3), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ wall-ceiling-area */

type YesNo = "yes" | "no";

export function WallCeilingAreaTool() {
  const s = strings.pro.nekretnine["wall-ceiling-area"];
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [openingsText, setOpeningsText] = useState("");
  const [includeCeiling, setIncludeCeiling] = useState<YesNo>("no");
  const [coverage, setCoverage] = useState("");
  const [coats, setCoats] = useState("");
  const [packageSize, setPackageSize] = useState("");
  const [perimeterOverride, setPerimeterOverride] = useState("");
  const [revealDepth, setRevealDepth] = useState("");

  const openingLines = splitRows(openingsText);
  const openings = openingLines.map((line) => {
    const [widthText = "", heightText = "", countText = ""] = line.split(";");
    return {
      width: proParse(widthText) ?? Number.NaN,
      height: proParse(heightText) ?? Number.NaN,
      count: proParse(countText) ?? Number.NaN,
    };
  });
  const typed = proParse(length) !== undefined || proParse(width) !== undefined || proParse(height) !== undefined;
  const result = wallCeilingArea({
    length: proParse(length) ?? Number.NaN,
    width: proParse(width) ?? Number.NaN,
    height: proParse(height) ?? Number.NaN,
    openings,
    includeCeiling: includeCeiling === "yes",
    coverage: proParse(coverage),
    coats: proParse(coats),
    packageSize: proParse(packageSize),
    perimeterOverride: proParse(perimeterOverride),
    revealDepth: proParse(revealDepth),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "length"
        ? s.errorLength
        : result.reason === "width"
          ? s.errorWidth
          : result.reason === "height"
            ? s.errorHeight
            : result.reason === "coats"
              ? s.errorCoats
              : result.reason === "coverage"
                ? s.errorCoverage
                : result.reason === "perimeterOverride"
                  ? s.errorPerimeterOverride
                  : result.reason === "revealDepth"
                    ? s.errorRevealDepth
                    : result.reason === "packageSize"
                      ? s.errorPackageSize
                      : result.reason === "openingWidth"
                        ? s.errorOpeningWidth
                        : result.reason === "openingHeight"
                          ? s.errorOpeningHeight
                          : result.reason === "openingCount"
                            ? s.errorOpeningCount
                            : s.errorOpenings;

  const copyText = !result.ok
    ? ""
    : [
        `${s.perimeter}: ${proNum(result.perimeter, 2)} m`,
        `${s.wallsGross}: ${proNum(result.wallsGross, 2)} m²`,
        `${s.openingsArea}: ${proNum(result.openingsArea, 2)} m²`,
        `${s.wallsNet}: ${proNum(result.wallsNet, 2)} m²`,
        `${s.wallsNetRoundingGap}: ${proNum(result.wallsNetRoundingGap, 2)} m²`,
        `${s.ceiling}: ${proNum(result.ceiling, 2)} m² ${result.ceilingIncluded ? "" : `(${s.notIncluded})`}`,
        `${s.total}: ${proNum(result.total, 2)} m²`,
        result.material === undefined ? undefined : `${s.material}: ${proNum(result.material, 2)}`,
        result.packageCount === undefined ? undefined : `${s.packageCount}: ${result.packageCount}`,
        result.revealArea === undefined ? undefined : `${s.revealArea}: ${proNum(result.revealArea, 2)} m²`,
        "",
        `${s.length}: ${proNum(proParse(length) ?? 0, 2)} m`,
        `${s.width}: ${proNum(proParse(width) ?? 0, 2)} m`,
        `${s.height}: ${proNum(proParse(height) ?? 0, 2)} m`,
        `${s.openings}: ${openingLines.length}`,
        `${s.includeCeiling}: ${includeCeiling === "yes" ? s.yes : s.no}`,
      ]
        .filter((line) => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.length} value={length} onChange={setLength} />
      <ToolInput label={s.width} value={width} onChange={setWidth} />
      <ToolInput label={s.height} value={height} onChange={setHeight} />
      <ToolTextArea label={s.openings} hint={s.openingsHint} value={openingsText} onChange={setOpeningsText} />
      <ToolSelect<YesNo>
        label={s.includeCeiling}
        value={includeCeiling}
        onChange={setIncludeCeiling}
        options={[
          { id: "no", label: s.no },
          { id: "yes", label: s.yes },
        ]}
      />
      <ToolInput label={s.coverage} hint={s.coverageHint} value={coverage} onChange={setCoverage} />
      <ToolInput label={s.coats} hint={s.coatsHint} value={coats} onChange={setCoats} />
      <ToolInput label={s.packageSize} hint={s.packageSizeHint} value={packageSize} onChange={setPackageSize} />
      <ToolInput
        label={s.perimeterOverride}
        hint={s.perimeterOverrideHint}
        value={perimeterOverride}
        onChange={setPerimeterOverride}
      />
      <ToolInput label={s.revealDepth} value={revealDepth} onChange={setRevealDepth} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.perimeter} value={proUnit(proNum(result.perimeter, 2), s.unitM)} />
          <ResultRow label={s.wallsGross} value={proUnit(proNum(result.wallsGross, 2), s.unitM2)} />
          <ResultRow label={s.openingsArea} value={proUnit(proNum(result.openingsArea, 2), s.unitM2)} />
          <ResultRow label={s.wallsNet} value={proUnit(proNum(result.wallsNet, 2), s.unitM2)} />
          <ResultRow label={s.wallsNetRoundingGap} value={proUnit(proNum(result.wallsNetRoundingGap, 2), s.unitM2)} />
          <ResultRow label={s.ceiling} value={proUnit(proNum(result.ceiling, 2), s.unitM2)} />
          {!result.ceilingIncluded && <p className="nx-hint nx-hint--prose">{s.ceilingNotIncludedNote}</p>}
          <ResultRow label={s.total} value={proUnit(proNum(result.total, 2), s.unitM2)} />
          {result.material !== undefined && (
            <>
              <ResultRow label={s.material} value={proNum(result.material, 2)} />
              <p className="nx-hint nx-hint--prose">{s.materialNote}</p>
            </>
          )}
          {result.packageCount !== undefined && (
            <ResultRow label={s.packageCount} value={String(result.packageCount)} />
          )}
          {result.revealArea !== undefined && (
            <ResultRow label={s.revealArea} value={proUnit(proNum(result.revealArea, 2), s.unitM2)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.length, value: proUnit(proNum(proParse(length) ?? 0, 2), s.unitM) },
              { label: s.width, value: proUnit(proNum(proParse(width) ?? 0, 2), s.unitM) },
              { label: s.height, value: proUnit(proNum(proParse(height) ?? 0, 2), s.unitM) },
              { label: s.openings, value: String(openingLines.length) },
              { label: s.includeCeiling, value: includeCeiling === "yes" ? s.yes : s.no },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------- weighted-area */

interface WeightedRowInput {
  readonly name: string;
  readonly area: number | undefined;
  readonly length: number | undefined;
  readonly width: number | undefined;
  readonly coefficient: number | undefined;
}

/** „naziv;površina;koeficijent" or, with a fourth field, „naziv;dužina;širina;koeficijent". */
function parseWeightedRows(text: string): readonly WeightedRowInput[] {
  return splitRows(text).map((line) => {
    const parts = line.split(";").map((part) => part.trim());
    const name = parts[0] ?? "";
    if (parts.length >= 4) {
      return {
        name,
        area: undefined,
        length: proParse(parts[1] ?? ""),
        width: proParse(parts[2] ?? ""),
        coefficient: proParse(parts[3] ?? ""),
      };
    }
    return {
      name,
      area: proParse(parts[1] ?? ""),
      length: undefined,
      width: undefined,
      coefficient: proParse(parts[2] ?? ""),
    };
  });
}

export function WeightedAreaTool() {
  const s = strings.pro.nekretnine["weighted-area"];
  const [rowsText, setRowsText] = useState("");
  const [pricePerSquareMetre, setPricePerSquareMetre] = useState("");

  const rows = parseWeightedRows(rowsText);
  const typed = rows.length > 0;
  const result = weightedArea({
    rows: rows.map((row) =>
      row.area !== undefined
        ? { area: row.area, coefficient: row.coefficient ?? Number.NaN }
        : { length: row.length ?? Number.NaN, width: row.width ?? Number.NaN, coefficient: row.coefficient ?? Number.NaN },
    ),
    pricePerSquareMetre: proParse(pricePerSquareMetre),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "rows"
        ? s.errorRows
        : result.reason === "coefficient"
          ? s.errorCoefficient
          : result.reason === "area"
            ? s.errorArea
            : result.reason === "length"
              ? s.errorLength
              : result.reason === "width"
                ? s.errorWidth
                : s.errorPrice;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row, i) =>
            `${rows[i]?.name ?? ""}: ${proUnit(proNum(row.area, 2), s.unitM2)} × ${proNum(row.coefficient, 2)}` +
            ` = ${proUnit(proNum(row.contribution, 2), s.unitM2)}`,
        ),
        `${s.netArea}: ${proUnit(proNum(result.netArea, 2), s.unitM2)}`,
        `${s.weightedArea}: ${proUnit(proNum(result.weightedArea, 2), s.unitM2)}`,
        result.totalPrice === undefined ? undefined : `${s.totalPrice}: ${proNum(result.totalPrice, 2)}`,
        result.pricePerNetSquareMetre === undefined
          ? undefined
          : `${s.pricePerNetSquareMetre}: ${proNum(result.pricePerNetSquareMetre, 2)}`,
        "",
        pricePerSquareMetre.trim() === ""
          ? undefined
          : `${s.pricePerSquareMetre}: ${proNum(proParse(pricePerSquareMetre) ?? 0, 2)}`,
      ]
        .filter((line) => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolTextArea label={s.rows} hint={s.rowsHint} value={rowsText} onChange={setRowsText} />
      <ToolInput
        label={s.pricePerSquareMetre}
        hint={s.priceHint}
        value={pricePerSquareMetre}
        onChange={setPricePerSquareMetre}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <p className="nx-hint nx-hint--prose">{s.coefficientNote}</p>
          <ToolTable
            head={[s.colName, s.colArea, s.colCoefficient, s.colContribution]}
            rows={result.rows.map((row, i) => [
              rows[i]?.name ?? "",
              proUnit(proNum(row.area, 2), s.unitM2),
              proNum(row.coefficient, 2),
              proUnit(proNum(row.contribution, 2), s.unitM2),
            ])}
          />
          <ResultRow label={s.netArea} value={proUnit(proNum(result.netArea, 2), s.unitM2)} />
          <ResultRow label={s.weightedArea} value={proUnit(proNum(result.weightedArea, 2), s.unitM2)} />
          {result.totalPrice !== undefined && (
            <ResultRow label={s.totalPrice} value={proNum(result.totalPrice, 2)} />
          )}
          {result.pricePerNetSquareMetre !== undefined && (
            <ResultRow label={s.pricePerNetSquareMetre} value={proNum(result.pricePerNetSquareMetre, 2)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.rows, value: String(rows.length) },
              pricePerSquareMetre.trim() === ""
                ? undefined
                : { label: s.pricePerSquareMetre, value: proNum(proParse(pricePerSquareMetre) ?? 0, 2) },
            ].filter((entry) => entry !== undefined)}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- map */

export const NEKRETNINE_SURFACES: Readonly<Record<string, ComponentType>> = {
  "cashflow-npv-irr": CashflowNpvIrrTool,
  "cost-allocation": CostAllocationTool,
  "late-payment-interest": LatePaymentInterestTool,
  "lease-term-dates": LeaseTermDatesTool,
  "loan-amortization": LoanAmortizationTool,
  "ownership-shares": OwnershipSharesTool,
  "parcel-polygon-area": ParcelPolygonAreaTool,
  "plot-density-index": PlotDensityIndexTool,
  "pro-rata-days": ProRataDaysTool,
  "rent-escalation": RentEscalationTool,
  "rent-gross-net": RentGrossNetTool,
  "rental-yield": RentalYieldTool,
  "room-quad-area": RoomQuadAreaTool,
  "wall-ceiling-area": WallCeilingAreaTool,
  "weighted-area": WeightedAreaTool,
};

/* ------------------------------------------------------------- cost-allocation */

export function CostAllocationTool() {
  const s = strings.pro.nekretnine["cost-allocation"];
  const [total, setTotal] = useState("");
  const [rowsText, setRowsText] = useState("");
  const [step, setStep] = useState("");

  const rows = splitRows(rowsText).map((line) => {
    const [name = "", weightText = ""] = line.split(";");
    return { name: name.trim(), weight: proParse(weightText) };
  });
  const typed = proParse(total) !== undefined || rows.length > 0;
  const result = costAllocation({
    total: proParse(total) ?? Number.NaN,
    weights: rows.map((row) => row.weight ?? Number.NaN),
    step: proParse(step),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "total"
        ? s.errorTotal
        : result.reason === "step"
          ? s.errorStep
          : s.errorWeights;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row, i) =>
            `${rows[i]?.name ?? ""}: ${proNum(row.share, 4)}%  ${proNum(row.exact, 2)}  ${proNum(row.amount, 2)}`,
        ),
        `${s.checkSum}: ${proNum(result.checkSum, 2)}`,
        `${s.remainderUnits}: ${result.remainderUnits}`,
        "",
        `${s.total}: ${proNum(proParse(total) ?? 0, 2)}`,
        `${s.step}: ${proNum(proParse(step) ?? 0.01, 2)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.total} hint={s.totalHint} value={total} onChange={setTotal} />
      <ToolTextArea label={s.rows} hint={s.rowsHint} value={rowsText} onChange={setRowsText} />
      <ToolInput label={s.step} hint={s.stepHint} value={step} onChange={setStep} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colName, s.colShare, s.colExact, s.colUnits, s.colAmount, s.colRemainder]}
            rows={result.rows.map((row, i) => [
              rows[i]?.name ?? "",
              `${proNum(row.share, 4)}%`,
              proNum(row.exact, 2),
              String(row.units),
              proNum(row.amount, 2),
              row.gotRemainderUnit ? s.yes : s.no,
            ])}
          />
          <ResultRow label={s.checkSum} value={proNum(result.checkSum, 2)} />
          <ResultRow label={s.remainderUnits} value={String(result.remainderUnits)} />
          <p className="nx-hint nx-hint--prose">{s.remainderRuleNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.total, value: proNum(proParse(total) ?? 0, 2) },
              { label: s.step, value: proNum(proParse(step) ?? 0.01, 2) },
              { label: s.rows, value: String(rows.length) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}
