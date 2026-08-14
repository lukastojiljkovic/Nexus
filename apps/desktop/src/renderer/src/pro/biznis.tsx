import {
  billableHours,
  breakEven,
  chainedDiscount,
  depositInstalments,
  hourlyRateTarget,
  ibanCheck,
  ibanCompose,
  marginMarkup,
  maxDiscountForMargin,
  paymentDueDate,
  paymentReferenceCompute,
  paymentReferenceVerify,
  shareAllocation,
  simpleInterestDays,
  taxIdCompute,
  taxIdVerify,
  tieredCommission,
  type CalendarDate,
  type CommissionMode,
  type CommissionTier,
  type DayCountBasis,
  type DepositKind,
  type DueDateMode,
  type MarginMarkupInput,
  type RoundingPlace,
  type RoundingRule,
} from "@nexus/core/pro/biznis";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import {
  CopyButton,
  ResultRow,
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
 * „Biznis i kancelarija" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/biznis.ts`'s. Nothing here divides, rounds
 * or compares a business quantity; this file shapes fields, hands the numbers
 * over, and reads the answers onto the page.
 *
 * **None of this pack's tools is `life-safety` or `food-safety`**, so nothing
 * here is bound by `toolForbidsVerdict` in the absolute sense that class is. The
 * discipline is kept anyway, by choice: every result is a quantity, echoed
 * inputs and a formula, never a sentence about whether the number is good.
 *
 * **A handful of small, purely mechanical helpers live below** — splitting a
 * textarea into lines, building a `CalendarDate` from three typed fields. None
 * of them divides, rounds or compares a business figure; an unparsable piece
 * becomes `NaN`, and it is always `@nexus/core`'s own validation — `isValidDate`,
 * `isPositive`, and the rest — that turns that into a refusal. The kit has no
 * date picker and no list widget, and these are the plumbing that stands in
 * for one without duplicating anything the core module already decides.
 */

/** Whether any of the given raw fields has something typed into it. */
function anyTyped(...values: readonly string[]): boolean {
  return values.some((value) => value.trim() !== "");
}

/** A calendar date from three typed fields. An unparsable piece is `NaN`, and
 *  `isValidDate` inside `@nexus/core` is what refuses it — never this file. */
function dmyToDate(day: string, month: string, year: string): CalendarDate {
  return {
    day: proParse(day) ?? Number.NaN,
    month: proParse(month) ?? Number.NaN,
    year: proParse(year) ?? Number.NaN,
  };
}

/** Zero-padded to two digits, for DATES only — `proNum` is for quantities. */
const pad2 = (value: number): string => (value < 10 ? `0${value}` : String(value));

/** DD.MM.GGGG, the format every date in this pack's copy uses. */
function formatDate(date: CalendarDate): string {
  return `${pad2(date.day)}.${pad2(date.month)}.${date.year}`;
}

/** Every line of a textarea, blank lines kept — for `billable-hours`, whose
 *  core function refuses a blank ENTRY rather than skipping it. An untouched
 *  field is zero entries, not one empty one. */
function linesKeepingBlanks(text: string): readonly string[] {
  return text.trim() === "" ? [] : text.split("\n");
}

/** One number per non-blank line or comma-separated item; an unparsable piece
 *  is `NaN`, which the core function's own guard turns into a refusal. */
function parseNumberList(text: string): readonly number[] {
  return text
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => proParse(line) ?? Number.NaN);
}

/** One `donja granica; stopa %` per line, for `tiered-commission`'s scale. */
function parseTierList(text: string): readonly CommissionTier[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [fromText, rateText] = line.split(";");
      return {
        from: proParse(fromText ?? "") ?? Number.NaN,
        ratePercent: proParse(rateText ?? "") ?? Number.NaN,
      };
    });
}

/** One DD.MM.GGGG per line, for a user's own holiday list. */
function parseDateList(text: string): readonly CalendarDate[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [d, m, y] = line.split(".");
      return dmyToDate(d ?? "", m ?? "", y ?? "");
    });
}

export function BillableHoursTool() {
  const s = strings.pro.biznis["billable-hours"];
  const [entriesText, setEntriesText] = useState("");
  const [intervalText, setIntervalText] = useState("");
  const [rule, setRule] = useState<RoundingRule>("up");
  const [place, setPlace] = useState<RoundingPlace>("perItem");
  const [rateText, setRateText] = useState("");

  const typed = anyTyped(entriesText, rateText);
  const result = billableHours({
    entries: linesKeepingBlanks(entriesText),
    intervalMinutes: proParse(intervalText),
    rule,
    place,
    rate: proParse(rateText) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "intervalMinutes"
        ? s.errorInterval
        : result.reason === "rate"
          ? s.errorRate
          : s.errorEntries;

  const ruleLabel = rule === "up" ? s.ruleUp : rule === "nearest" ? s.ruleNearest : s.ruleDown;
  const placeLabel = place === "perItem" ? s.placePerItem : s.placeTotal;

  const copyText = !result.ok
    ? ""
    : [
        `${s.actualTotal}: ${result.actualHhmm}`,
        `${s.actualDecimal}: ${proUnit(proNum(result.actualHours, 4), s.unitH)}`,
        `${s.billedTotal}: ${result.billedHhmm}`,
        `${s.billedDecimal}: ${proUnit(proNum(result.billedHours, 4), s.unitH)}`,
        `${s.actualAmount}: ${proNum(result.actualAmount, 2)}`,
        `${s.amount}: ${proNum(result.amount, 2)}`,
        `${s.deltaMinutes}: ${proUnit(proNum(result.deltaMinutes, 0), s.unitMinutes)}`,
        `${s.deltaAmount}: ${proNum(result.deltaAmount, 2)}`,
        "",
        `${s.rate}: ${proNum(proParse(rateText) ?? 0, 2)}`,
        `${s.intervalMinutes}: ${proNum(result.intervalMinutesUsed, 0)}`,
        `${s.rule}: ${ruleLabel}`,
        `${s.place}: ${placeLabel}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea
        label={s.entries}
        hint={s.entriesHint}
        value={entriesText}
        onChange={setEntriesText}
      />
      <ToolInput
        label={s.intervalMinutes}
        hint={s.intervalHint}
        value={intervalText}
        onChange={setIntervalText}
      />
      <ToolSelect<RoundingRule>
        label={s.rule}
        value={rule}
        onChange={setRule}
        options={[
          { id: "up", label: s.ruleUp },
          { id: "nearest", label: s.ruleNearest },
          { id: "down", label: s.ruleDown },
        ]}
      />
      <ToolSelect<RoundingPlace>
        label={s.place}
        value={place}
        onChange={setPlace}
        options={[
          { id: "perItem", label: s.placePerItem },
          { id: "total", label: s.placeTotal },
        ]}
      />
      <ToolInput label={s.rate} hint={s.rateHint} value={rateText} onChange={setRateText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {result.entryMinutes.length > 0 && (
            <ToolTable
              head={[s.tableIndex, s.tableActual, s.tableBilled]}
              rows={result.entryMinutes.map((minutes, index) => [
                String(index + 1),
                proUnit(proNum(minutes, 0), s.unitMinutes),
                proUnit(proNum(result.entryBilledMinutes[index] ?? minutes, 0), s.unitMinutes),
              ])}
            />
          )}
          <ResultRow label={s.actualTotal} value={result.actualHhmm} />
          <ResultRow label={s.actualDecimal} value={proUnit(proNum(result.actualHours, 4), s.unitH)} />
          <ResultRow label={s.billedTotal} value={result.billedHhmm} />
          <ResultRow label={s.billedDecimal} value={proUnit(proNum(result.billedHours, 4), s.unitH)} />
          <ResultRow label={s.actualAmount} value={proNum(result.actualAmount, 2)} />
          <ResultRow label={s.amount} value={proNum(result.amount, 2)} />
          <ResultRow
            label={s.deltaMinutes}
            value={proUnit(proNum(result.deltaMinutes, 0), s.unitMinutes)}
          />
          <ResultRow label={s.deltaAmount} value={proNum(result.deltaAmount, 2)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.rate, value: proNum(proParse(rateText) ?? 0, 2) },
              {
                label: s.intervalMinutes,
                value: proNum(result.intervalMinutesUsed, 0),
              },
              { label: s.rule, value: ruleLabel },
              { label: s.place, value: placeLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function BreakEvenTool() {
  const s = strings.pro.biznis["break-even"];
  const [fixedCosts, setFixedCosts] = useState("");
  const [price, setPrice] = useState("");
  const [variableCost, setVariableCost] = useState("");
  const [targetProfit, setTargetProfit] = useState("");
  const [plannedUnits, setPlannedUnits] = useState("");

  const typed = anyTyped(fixedCosts, price, variableCost);
  const result = breakEven({
    fixedCosts: proParse(fixedCosts) ?? Number.NaN,
    price: proParse(price) ?? Number.NaN,
    variableCost: proParse(variableCost) ?? Number.NaN,
    targetProfit: proParse(targetProfit),
    plannedUnits: proParse(plannedUnits),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "fixedCosts"
        ? s.errorFixedCosts
        : result.reason === "price"
          ? s.errorPrice
          : result.reason === "variableCost"
            ? s.errorVariableCost
            : result.reason === "targetProfit"
              ? s.errorTargetProfit
              : result.reason === "plannedUnits"
                ? s.errorPlannedUnits
                : result.reason === "contributionMarginZero"
                  ? s.errorMarginZero
                  : s.errorMarginNegative;

  const copyText = !result.ok
    ? ""
    : [
        `${s.contributionMargin}: ${proNum(result.contributionMargin, 2)}`,
        `${s.contributionMarginPercent}: ${proUnit(proNum(result.contributionMarginPercent, 2), "%")}`,
        `${s.exactUnits}: ${proNum(result.exactUnits, 4)}`,
        `${s.units}: ${proUnit(proNum(result.units, 0), s.unitPieces)}`,
        `${s.breakEvenRevenue}: ${proNum(result.breakEvenRevenue, 2)}`,
        `${s.revenueAtUnits}: ${proNum(result.revenueAtUnits, 2)}`,
        `${s.surplusAtUnits}: ${proNum(result.surplusAtUnits, 2)}`,
        ...(result.unitsForProfit === undefined
          ? []
          : [
              `${s.exactUnitsForProfit}: ${proNum(result.exactUnitsForProfit ?? 0, 4)}`,
              `${s.unitsForProfit}: ${proUnit(proNum(result.unitsForProfit, 0), s.unitPieces)}`,
              `${s.revenueForProfit}: ${proNum(result.revenueForProfit ?? 0, 2)}`,
            ]),
        ...(result.marginOfSafetyPercent === undefined
          ? []
          : [
              `${s.marginOfSafetyPercent}: ${proUnit(proNum(result.marginOfSafetyPercent, 2), "%")}`,
              `${s.marginOfSafetyUnits}: ${proNum(result.marginOfSafetyUnits ?? 0, 2)}`,
              `${s.marginOfSafetyAmount}: ${proNum(result.marginOfSafetyAmount ?? 0, 2)}`,
            ]),
        "",
        `${s.fixedCosts}: ${proNum(proParse(fixedCosts) ?? 0, 2)}`,
        `${s.price}: ${proNum(proParse(price) ?? 0, 2)}`,
        `${s.variableCost}: ${proNum(proParse(variableCost) ?? 0, 2)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.fixedCosts} value={fixedCosts} onChange={setFixedCosts} />
      <ToolInput label={s.price} value={price} onChange={setPrice} />
      <ToolInput label={s.variableCost} value={variableCost} onChange={setVariableCost} />
      <ToolInput
        label={s.targetProfit}
        hint={s.targetProfitHint}
        value={targetProfit}
        onChange={setTargetProfit}
      />
      <ToolInput
        label={s.plannedUnits}
        hint={s.plannedUnitsHint}
        value={plannedUnits}
        onChange={setPlannedUnits}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.contributionMargin} value={proNum(result.contributionMargin, 2)} />
          <ResultRow
            label={s.contributionMarginPercent}
            value={proUnit(proNum(result.contributionMarginPercent, 2), "%")}
          />
          <ResultRow label={s.exactUnits} value={proNum(result.exactUnits, 4)} />
          <ResultRow label={s.units} value={proUnit(proNum(result.units, 0), s.unitPieces)} />
          <ResultRow label={s.breakEvenRevenue} value={proNum(result.breakEvenRevenue, 2)} />
          <ResultRow label={s.revenueAtUnits} value={proNum(result.revenueAtUnits, 2)} />
          <ResultRow label={s.surplusAtUnits} value={proNum(result.surplusAtUnits, 2)} />
          {result.unitsForProfit !== undefined && (
            <>
              <ResultRow
                label={s.exactUnitsForProfit}
                value={proNum(result.exactUnitsForProfit ?? 0, 4)}
              />
              <ResultRow
                label={s.unitsForProfit}
                value={proUnit(proNum(result.unitsForProfit, 0), s.unitPieces)}
              />
              <ResultRow label={s.revenueForProfit} value={proNum(result.revenueForProfit ?? 0, 2)} />
            </>
          )}
          {result.marginOfSafetyPercent !== undefined && (
            <>
              <ResultRow
                label={s.marginOfSafetyPercent}
                value={proUnit(proNum(result.marginOfSafetyPercent, 2), "%")}
              />
              <ResultRow
                label={s.marginOfSafetyUnits}
                value={proNum(result.marginOfSafetyUnits ?? 0, 2)}
              />
              <ResultRow
                label={s.marginOfSafetyAmount}
                value={proNum(result.marginOfSafetyAmount ?? 0, 2)}
              />
            </>
          )}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.fixedCosts, value: proNum(proParse(fixedCosts) ?? 0, 2) },
              { label: s.price, value: proNum(proParse(price) ?? 0, 2) },
              { label: s.variableCost, value: proNum(proParse(variableCost) ?? 0, 2) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function ChainedDiscountTool() {
  const s = strings.pro.biznis["chained-discount"];
  const [basePrice, setBasePrice] = useState("");
  const [stepsText, setStepsText] = useState("");

  const typed = anyTyped(basePrice, stepsText);
  const steps = parseNumberList(stepsText);
  const result = chainedDiscount({ basePrice: proParse(basePrice) ?? Number.NaN, steps });

  const failure =
    result.ok || !typed ? undefined : result.reason === "basePrice" ? s.errorBasePrice : s.errorSteps;

  // A factor above 1 means the chain nets to a SURCHARGE — `chainedDiscount`'s
  // own doc comment says the surface is the one that renames the field and
  // flips the sign for display; the signed figure core returns is correct and
  // untouched, this is presentation only.
  const isSurcharge = result.ok && result.factor > 1;
  const totalLabel = isSurcharge ? s.totalSurcharge : s.totalDiscount;
  const equivalentLabel = isSurcharge ? s.equivalentSurcharge : s.equivalent;
  const totalValue = result.ok
    ? proNum(isSurcharge ? -result.totalDiscount : result.totalDiscount, 2)
    : "";
  const equivalentValue = result.ok
    ? proUnit(
        proNum(isSurcharge ? -result.equivalentDiscountPercent : result.equivalentDiscountPercent, 4),
        s.unitPercent,
      )
    : "";

  const copyText = !result.ok
    ? ""
    : [
        `${s.finalPrice}: ${proNum(result.finalPrice, 2)}`,
        `${totalLabel}: ${totalValue}`,
        `${equivalentLabel}: ${equivalentValue}`,
        "",
        `${s.basePrice}: ${proNum(proParse(basePrice) ?? 0, 2)}`,
        `${s.steps}: ${steps.map((step) => proUnit(proNum(step, 2), s.unitPercent)).join(", ")}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.basePrice} value={basePrice} onChange={setBasePrice} />
      <ToolTextArea label={s.steps} hint={s.stepsHint} value={stepsText} onChange={setStepsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {result.stepPrices.length > 0 && (
            <ToolTable
              head={[s.tableStep, s.tablePrice, s.tableDelta]}
              rows={result.stepPrices.map((price, index) => [
                String(index + 1),
                proNum(price, 2),
                proNum(result.stepDeltas[index] ?? 0, 2),
              ])}
            />
          )}
          <ResultRow label={s.finalPrice} value={proNum(result.finalPrice, 2)} />
          <ResultRow label={totalLabel} value={totalValue} />
          <ResultRow label={equivalentLabel} value={equivalentValue} />
          <p className="tool__note">{s.orderNote}</p>
          {/* factor = 0 means a 100 % step zeroed the price — read off core's
              own computed factor rather than re-scanning the typed steps. */}
          {result.factor === 0 && <p className="tool__note">{s.fullStepNote}</p>}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.basePrice, value: proNum(proParse(basePrice) ?? 0, 2) },
              {
                label: s.steps,
                value: steps.map((step) => proUnit(proNum(step, 2), s.unitPercent)).join(", "),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function DepositInstalmentsTool() {
  const s = strings.pro.biznis["deposit-instalments"];
  const [contractValue, setContractValue] = useState("");
  const [depositKind, setDepositKind] = useState<DepositKind>("percent");
  const [deposit, setDeposit] = useState("");
  const [instalmentsText, setInstalmentsText] = useState("");
  const [firstDay, setFirstDay] = useState("");
  const [firstMonth, setFirstMonth] = useState("");
  const [firstYear, setFirstYear] = useState("");
  const [stepMonths, setStepMonths] = useState("");
  const [unitChoice, setUnitChoice] = useState<"0.01" | "1">("0.01");

  const typed = anyTyped(
    contractValue,
    deposit,
    instalmentsText,
    firstDay,
    firstMonth,
    firstYear,
    stepMonths,
  );

  const result = depositInstalments({
    contractValue: proParse(contractValue) ?? Number.NaN,
    depositKind,
    deposit: proParse(deposit) ?? Number.NaN,
    instalments: proParse(instalmentsText) ?? Number.NaN,
    firstDate: dmyToDate(firstDay, firstMonth, firstYear),
    stepMonths: proParse(stepMonths) ?? Number.NaN,
    unit: Number(unitChoice),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "contractValue"
        ? s.errorContractValue
        : result.reason === "unit"
          ? s.errorUnit
          : result.reason === "deposit"
            ? s.errorDeposit
            : result.reason === "instalments"
              ? s.errorInstalments
              : result.reason === "firstDate"
                ? s.errorFirstDate
                : result.reason === "stepMonths"
                  ? s.errorStepMonths
                  : s.errorSchedule;

  const depositEcho = `${proNum(proParse(deposit) ?? 0, 2)} (${
    depositKind === "percent" ? s.depositKindPercent : s.depositKindAmount
  })`;
  const firstDateEcho = formatDate(dmyToDate(firstDay, firstMonth, firstYear));

  const copyText = !result.ok
    ? ""
    : [
        `${s.depositAmount}: ${proNum(result.depositAmount, 2)}`,
        ...result.instalments.map(
          (row) => `${s.tableIndex} ${row.index}: ${formatDate(row.date)} — ${proNum(row.amount, 2)}`,
        ),
        `${s.checkSum}: ${proNum(result.checkSum, 2)}`,
        "",
        `${s.contractValue}: ${proNum(proParse(contractValue) ?? 0, 2)}`,
        `${s.deposit}: ${depositEcho}`,
        `${s.instalments}: ${instalmentsText.trim()}`,
        `${s.firstDateDay}: ${firstDateEcho}`,
        `${s.stepMonths}: ${stepMonths.trim()}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.contractValue} value={contractValue} onChange={setContractValue} />
      <ToolSelect<DepositKind>
        label={s.depositKind}
        value={depositKind}
        onChange={setDepositKind}
        options={[
          { id: "percent", label: s.depositKindPercent },
          { id: "amount", label: s.depositKindAmount },
        ]}
      />
      <ToolInput label={s.deposit} hint={s.depositHint} value={deposit} onChange={setDeposit} />
      <ToolInput label={s.instalments} value={instalmentsText} onChange={setInstalmentsText} />
      <ToolInput label={s.firstDateDay} value={firstDay} onChange={setFirstDay} />
      <ToolInput label={s.firstDateMonth} value={firstMonth} onChange={setFirstMonth} />
      <ToolInput label={s.firstDateYear} value={firstYear} onChange={setFirstYear} />
      <ToolInput
        label={s.stepMonths}
        hint={s.stepMonthsHint}
        value={stepMonths}
        onChange={setStepMonths}
      />
      <ToolSelect<"0.01" | "1">
        label={s.unit}
        value={unitChoice}
        onChange={setUnitChoice}
        options={[
          { id: "0.01", label: s.unit001 },
          { id: "1", label: s.unit1 },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.depositAmount} value={proNum(result.depositAmount, 2)} />
          <ToolTable
            head={[s.tableIndex, s.tableDate, s.tableAmount, s.tableRemaining]}
            rows={result.instalments.map((row) => [
              String(row.index),
              formatDate(row.date),
              proNum(row.amount, 2),
              proNum(row.remaining, 2),
            ])}
          />
          <ResultRow label={s.checkSum} value={proNum(result.checkSum, 2)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.contractValue, value: proNum(proParse(contractValue) ?? 0, 2) },
              { label: s.deposit, value: depositEcho },
              { label: s.instalments, value: instalmentsText.trim() },
              { label: s.firstDateDay, value: firstDateEcho },
              { label: s.stepMonths, value: stepMonths.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function HourlyRateTargetTool() {
  const s = strings.pro.biznis["hourly-rate-target"];
  const [targetEarnings, setTargetEarnings] = useState("");
  const [businessCosts, setBusinessCosts] = useState("");
  const [workWeeks, setWorkWeeks] = useState("");
  const [hoursPerWeek, setHoursPerWeek] = useState("");
  const [billablePercent, setBillablePercent] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState("");

  const typed = anyTyped(
    targetEarnings,
    businessCosts,
    workWeeks,
    hoursPerWeek,
    billablePercent,
    hoursPerDay,
  );
  const result = hourlyRateTarget({
    targetEarnings: proParse(targetEarnings) ?? Number.NaN,
    businessCosts: proParse(businessCosts) ?? Number.NaN,
    workWeeks: proParse(workWeeks) ?? Number.NaN,
    hoursPerWeek: proParse(hoursPerWeek) ?? Number.NaN,
    billablePercent: proParse(billablePercent) ?? Number.NaN,
    hoursPerDay: proParse(hoursPerDay) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "targetEarnings"
        ? s.errorTargetEarnings
        : result.reason === "businessCosts"
          ? s.errorBusinessCosts
          : result.reason === "workWeeks"
            ? s.errorWorkWeeks
            : result.reason === "hoursPerWeek"
              ? s.errorHoursPerWeek
              : result.reason === "billablePercent"
                ? s.errorBillablePercent
                : result.reason === "hoursPerDay"
                  ? s.errorHoursPerDay
                  : s.errorBillableHours;

  const copyText = !result.ok
    ? ""
    : [
        `${s.billableHoursPerYear}: ${proUnit(proNum(result.billableHoursPerYear, 2), s.unitH)}`,
        `${s.requiredRevenue}: ${proNum(result.requiredRevenue, 2)}`,
        `${s.hourlyRate}: ${proNum(result.hourlyRate, 2)}`,
        `${s.dayRate}: ${proNum(result.dayRate, 2)}`,
        `${s.monthlyRevenue}: ${proNum(result.monthlyRevenue, 2)}`,
        "",
        `${s.targetEarnings}: ${proNum(proParse(targetEarnings) ?? 0, 2)}`,
        `${s.businessCosts}: ${proNum(proParse(businessCosts) ?? 0, 2)}`,
        `${s.workWeeks}: ${proNum(proParse(workWeeks) ?? 0, 0)}`,
        `${s.hoursPerWeek}: ${proNum(proParse(hoursPerWeek) ?? 0, 2)}`,
        `${s.billablePercent}: ${proUnit(proNum(proParse(billablePercent) ?? 0, 2), "%")}`,
        `${s.hoursPerDay}: ${proNum(proParse(hoursPerDay) ?? 0, 2)}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.targetEarnings}
        hint={s.targetEarningsHint}
        value={targetEarnings}
        onChange={setTargetEarnings}
      />
      <ToolInput label={s.businessCosts} value={businessCosts} onChange={setBusinessCosts} />
      <ToolInput
        label={s.workWeeks}
        hint={s.workWeeksHint}
        value={workWeeks}
        onChange={setWorkWeeks}
      />
      <ToolInput label={s.hoursPerWeek} value={hoursPerWeek} onChange={setHoursPerWeek} />
      <ToolInput
        label={s.billablePercent}
        hint={s.billablePercentHint}
        value={billablePercent}
        onChange={setBillablePercent}
      />
      <ToolInput label={s.hoursPerDay} value={hoursPerDay} onChange={setHoursPerDay} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.billableHoursPerYear}
            value={proUnit(proNum(result.billableHoursPerYear, 2), s.unitH)}
          />
          <ResultRow label={s.requiredRevenue} value={proNum(result.requiredRevenue, 2)} />
          <ResultRow label={s.hourlyRate} value={proNum(result.hourlyRate, 2)} />
          <ResultRow label={s.dayRate} value={proNum(result.dayRate, 2)} />
          <ResultRow label={s.monthlyRevenue} value={proNum(result.monthlyRevenue, 2)} />
          <p className="tool__note">{s.revenueNote}</p>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.targetEarnings, value: proNum(proParse(targetEarnings) ?? 0, 2) },
              { label: s.businessCosts, value: proNum(proParse(businessCosts) ?? 0, 2) },
              { label: s.workWeeks, value: proNum(proParse(workWeeks) ?? 0, 0) },
              { label: s.hoursPerWeek, value: proNum(proParse(hoursPerWeek) ?? 0, 2) },
              {
                label: s.billablePercent,
                value: proUnit(proNum(proParse(billablePercent) ?? 0, 2), "%"),
              },
              { label: s.hoursPerDay, value: proNum(proParse(hoursPerDay) ?? 0, 2) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function IbanCheckTool() {
  const s = strings.pro.biznis["iban-check"];
  const [mode, setMode] = useState<"verify" | "compose">("verify");
  const [iban, setIban] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [bban, setBban] = useState("");

  const typed = mode === "verify" ? anyTyped(iban) : anyTyped(countryCode, bban);
  const verifyResult = mode === "verify" ? ibanCheck(iban) : undefined;
  const composeResult = mode === "compose" ? ibanCompose(countryCode, bban) : undefined;

  const failure = !typed
    ? undefined
    : mode === "verify"
      ? verifyResult !== undefined && !verifyResult.ok
        ? s.errorIban
        : undefined
      : composeResult !== undefined && !composeResult.ok
        ? composeResult.reason === "countryCode"
          ? s.errorCountryCode
          : s.errorBban
        : undefined;

  const copyText =
    mode === "verify"
      ? verifyResult?.ok === true
        ? [
            `${s.normalized}: ${verifyResult.normalized}`,
            `${s.length}: ${verifyResult.length} ${s.lengthChars}`,
            `${s.countryCode2}: ${verifyResult.countryCode}`,
            `${s.checkDigits}: ${verifyResult.checkDigits}`,
            `${s.remainder}: ${verifyResult.remainder}`,
            `${s.remainderIsOne}: ${verifyResult.remainderIsOne ? s.yes : s.no}`,
            `${s.expectedCheckDigits}: ${verifyResult.expectedCheckDigits}`,
            `${s.correctedIban}: ${verifyResult.correctedIban}`,
            `${s.correctedPaperFormat}: ${verifyResult.correctedPaperFormat}`,
          ].join("\n")
        : ""
      : composeResult?.ok === true
        ? [
            `${s.checkDigits}: ${composeResult.checkDigits}`,
            `${s.composedIban}: ${composeResult.iban}`,
            `${s.paperFormat}: ${composeResult.paperFormat}`,
            `${s.length}: ${composeResult.length} ${s.lengthChars}`,
          ].join("\n")
        : "";

  return (
    <>
      <ToolSelect<"verify" | "compose">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "verify", label: s.modeVerify },
          { id: "compose", label: s.modeCompose },
        ]}
      />
      {mode === "verify" ? (
        <ToolInput label={s.iban} hint={s.ibanHint} value={iban} onChange={setIban} mono />
      ) : (
        <>
          <ToolInput
            label={s.countryCode}
            hint={s.countryCodeHint}
            value={countryCode}
            onChange={setCountryCode}
            mono
          />
          <ToolInput label={s.bban} hint={s.bbanHint} value={bban} onChange={setBban} mono />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {mode === "verify" && verifyResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.normalized} value={verifyResult.normalized} />
          <ResultRow label={s.length} value={proUnit(String(verifyResult.length), s.lengthChars)} />
          <ResultRow label={s.countryCode2} value={verifyResult.countryCode} />
          <ResultRow label={s.checkDigits} value={verifyResult.checkDigits} />
          <ResultRow label={s.remainder} value={String(verifyResult.remainder)} />
          <ResultRow label={s.remainderIsOne} value={verifyResult.remainderIsOne ? s.yes : s.no} />
          <ResultRow label={s.expectedCheckDigits} value={verifyResult.expectedCheckDigits} />
          <ResultRow label={s.correctedIban} value={verifyResult.correctedIban} />
          <ResultRow label={s.correctedPaperFormat} value={verifyResult.correctedPaperFormat} />
          <ResultRow label={s.paperFormat} value={verifyResult.paperFormat} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.iban, value: iban.trim() }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      {mode === "compose" && composeResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.checkDigits} value={composeResult.checkDigits} />
          <ResultRow label={s.composedIban} value={composeResult.iban} />
          <ResultRow label={s.paperFormat} value={composeResult.paperFormat} />
          <ResultRow label={s.length} value={proUnit(String(composeResult.length), s.lengthChars)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.countryCode, value: countryCode.trim() },
              { label: s.bban, value: bban.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function MarginMarkupTool() {
  const s = strings.pro.biznis["margin-markup"];
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [marginPercent, setMarginPercent] = useState("");
  const [markupPercent, setMarkupPercent] = useState("");
  const [minMarginPercent, setMinMarginPercent] = useState("");

  const costFilled = proParse(cost) !== undefined;
  const priceFilled = proParse(price) !== undefined;
  const marginFilled = proParse(marginPercent) !== undefined;
  const markupFilled = proParse(markupPercent) !== undefined;
  const minMarginFilled = proParse(minMarginPercent) !== undefined;
  const typed = anyTyped(cost, price, marginPercent, markupPercent, minMarginPercent);
  const isMaxDiscountMode = minMarginFilled && costFilled && priceFilled;

  // The mode is DERIVED from which fields carry a value, never a selector next
  // to the fields — per the review, a separate "which two do you know" control
  // would be a second, independent source of truth for the same choice.
  const input: MarginMarkupInput | undefined = isMaxDiscountMode
    ? undefined
    : costFilled && markupFilled && !priceFilled && !marginFilled
      ? {
          mode: "costMarkup",
          cost: proParse(cost) ?? Number.NaN,
          markupPercent: proParse(markupPercent) ?? Number.NaN,
        }
      : costFilled && marginFilled && !priceFilled && !markupFilled
        ? {
            mode: "costMargin",
            cost: proParse(cost) ?? Number.NaN,
            marginPercent: proParse(marginPercent) ?? Number.NaN,
          }
        : costFilled && priceFilled && !marginFilled && !markupFilled
          ? {
              mode: "costPrice",
              cost: proParse(cost) ?? Number.NaN,
              price: proParse(price) ?? Number.NaN,
            }
          : priceFilled && marginFilled && !costFilled && !markupFilled
            ? {
                mode: "priceMargin",
                price: proParse(price) ?? Number.NaN,
                marginPercent: proParse(marginPercent) ?? Number.NaN,
              }
            : priceFilled && markupFilled && !costFilled && !marginFilled
              ? {
                  mode: "priceMarkup",
                  price: proParse(price) ?? Number.NaN,
                  markupPercent: proParse(markupPercent) ?? Number.NaN,
                }
              : undefined;

  const pricingResult = input === undefined ? undefined : marginMarkup(input);
  const discountResult = !isMaxDiscountMode
    ? undefined
    : maxDiscountForMargin({
        cost: proParse(cost) ?? Number.NaN,
        price: proParse(price) ?? Number.NaN,
        minMarginPercent: proParse(minMarginPercent) ?? Number.NaN,
      });

  const ambiguous = typed && pricingResult === undefined && discountResult === undefined;

  const pricingFailure =
    pricingResult === undefined || pricingResult.ok
      ? undefined
      : pricingResult.reason === "cost"
        ? s.errorCost
        : pricingResult.reason === "price"
          ? s.errorPrice
          : pricingResult.reason === "marginPercent"
            ? s.errorMarginPercent
            : s.errorMarkupPercent;

  const discountFailure =
    discountResult === undefined || discountResult.ok
      ? undefined
      : discountResult.reason === "cost"
        ? s.errorCost
        : discountResult.reason === "price"
          ? s.errorPrice
          : s.errorMinMarginPercent;

  const failure = ambiguous ? s.errorAmbiguous : (pricingFailure ?? discountFailure);

  const copyText =
    pricingResult?.ok === true
      ? [
          `${s.resultCost}: ${proNum(pricingResult.cost, 2)}`,
          `${s.resultPrice}: ${proNum(pricingResult.price, 2)}`,
          `${s.profit}: ${proNum(pricingResult.profit, 2)}`,
          `${s.resultMargin}: ${proUnit(proNum(pricingResult.marginPercent, 2), s.unitPercent)}`,
          `${s.resultMarkup}: ${proUnit(proNum(pricingResult.markupPercent, 2), s.unitPercent)}`,
        ].join("\n")
      : discountResult?.ok === true
        ? [
            `${s.maxDiscountPercent}: ${proUnit(proNum(discountResult.maxDiscountPercent, 2), s.unitPercent)}`,
            `${s.exactDiscountPercent}: ${proUnit(proNum(discountResult.exactDiscountPercent, 4), s.unitPercent)}`,
            `${s.priceAfterDiscount}: ${proNum(discountResult.priceAfterDiscount, 2)}`,
            ...(discountResult.marginAfterDiscountPercent === undefined
              ? []
              : [
                  `${s.marginAfterDiscountPercent}: ${proUnit(
                    proNum(discountResult.marginAfterDiscountPercent, 2),
                    s.unitPercent,
                  )}`,
                ]),
            "",
            `${s.cost}: ${proNum(proParse(cost) ?? 0, 2)}`,
            `${s.price}: ${proNum(proParse(price) ?? 0, 2)}`,
            `${s.minMarginPercent}: ${proUnit(proNum(proParse(minMarginPercent) ?? 0, 2), s.unitPercent)}`,
          ].join("\n")
        : "";

  return (
    <>
      <ToolInput label={s.cost} value={cost} onChange={setCost} />
      <ToolInput label={s.price} value={price} onChange={setPrice} />
      <ToolInput label={s.marginPercent} value={marginPercent} onChange={setMarginPercent} />
      <ToolInput label={s.markupPercent} value={markupPercent} onChange={setMarkupPercent} />
      <ToolInput
        label={s.minMarginPercent}
        hint={s.minMarginHint}
        value={minMarginPercent}
        onChange={setMinMarginPercent}
      />
      <p className="tool__note">{s.fieldsHint}</p>

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {pricingResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resultCost} value={proNum(pricingResult.cost, 2)} />
          <ResultRow label={s.resultPrice} value={proNum(pricingResult.price, 2)} />
          <ResultRow label={s.profit} value={proNum(pricingResult.profit, 2)} />
          <ResultRow
            label={s.resultMargin}
            value={proUnit(proNum(pricingResult.marginPercent, 2), s.unitPercent)}
          />
          <ResultRow
            label={s.resultMarkup}
            value={proUnit(proNum(pricingResult.markupPercent, 2), s.unitPercent)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.cost, value: costFilled ? proNum(proParse(cost) ?? 0, 2) : "—" },
              { label: s.price, value: priceFilled ? proNum(proParse(price) ?? 0, 2) : "—" },
              {
                label: s.marginPercent,
                value: marginFilled
                  ? proUnit(proNum(proParse(marginPercent) ?? 0, 2), s.unitPercent)
                  : "—",
              },
              {
                label: s.markupPercent,
                value: markupFilled
                  ? proUnit(proNum(proParse(markupPercent) ?? 0, 2), s.unitPercent)
                  : "—",
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      {discountResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.maxDiscountPercent}
            value={proUnit(proNum(discountResult.maxDiscountPercent, 2), s.unitPercent)}
          />
          <ResultRow
            label={s.exactDiscountPercent}
            value={proUnit(proNum(discountResult.exactDiscountPercent, 4), s.unitPercent)}
          />
          <ResultRow label={s.priceAfterDiscount} value={proNum(discountResult.priceAfterDiscount, 2)} />
          {discountResult.marginAfterDiscountPercent !== undefined && (
            <ResultRow
              label={s.marginAfterDiscountPercent}
              value={proUnit(proNum(discountResult.marginAfterDiscountPercent, 2), s.unitPercent)}
            />
          )}
          {discountResult.exactDiscountPercent <= 0 && <p className="tool__note">{s.belowNote}</p>}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.cost, value: proNum(proParse(cost) ?? 0, 2) },
              { label: s.price, value: proNum(proParse(price) ?? 0, 2) },
              {
                label: s.minMarginPercent,
                value: proUnit(proNum(proParse(minMarginPercent) ?? 0, 2), s.unitPercent),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function PaymentDueDateTool() {
  const s = strings.pro.biznis["payment-due-date"];
  const [issueDay, setIssueDay] = useState("");
  const [issueMonth, setIssueMonth] = useState("");
  const [issueYear, setIssueYear] = useState("");
  const [mode, setMode] = useState<DueDateMode>("daysFromDate");
  const [term, setTerm] = useState("");
  const [countIssueDate, setCountIssueDate] = useState<"yes" | "no">("no");
  const [shiftEnabled, setShiftEnabled] = useState<"on" | "off">("off");
  const [shiftDirection, setShiftDirection] = useState<"forward" | "backward">("forward");
  const [weekendDaysText, setWeekendDaysText] = useState("");
  const [nonWorkingDaysText, setNonWorkingDaysText] = useState("");
  const [referenceDay, setReferenceDay] = useState("");
  const [referenceMonth, setReferenceMonth] = useState("");
  const [referenceYear, setReferenceYear] = useState("");

  const typed = anyTyped(
    issueDay,
    issueMonth,
    issueYear,
    term,
    referenceDay,
    referenceMonth,
    referenceYear,
  );

  const weekendDays = parseNumberList(weekendDaysText);
  const nonWorkingDays = parseDateList(nonWorkingDaysText);
  const issueDate = dmyToDate(issueDay, issueMonth, issueYear);
  const referenceDate = dmyToDate(referenceDay, referenceMonth, referenceYear);

  const result = paymentDueDate({
    issueDate,
    mode,
    term: proParse(term) ?? Number.NaN,
    countIssueDate: countIssueDate === "yes",
    shiftOffNonWorkingDays: shiftEnabled === "on",
    weekendDays,
    nonWorkingDays,
    shiftDirection,
    referenceDate,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "issueDate"
        ? s.errorIssueDate
        : result.reason === "referenceDate"
          ? s.errorReferenceDate
          : result.reason === "term"
            ? s.errorTerm
            : result.reason === "weekendDays"
              ? s.errorWeekendDays
              : result.reason === "nonWorkingDays"
                ? s.errorNonWorkingDays
                : s.errorGeneric;

  const modeLabel =
    mode === "daysFromDate"
      ? s.modeDaysFromDate
      : mode === "daysFromEndOfMonth"
        ? s.modeDaysFromEndOfMonth
        : s.modeMonthsFromDate;
  const weekdayLabel = (weekday: number): string => s.weekdayNames[weekday] ?? String(weekday);

  const copyText = !result.ok
    ? ""
    : [
        `${s.dueDate}: ${formatDate(result.dueDate)}`,
        `${s.dueWeekday}: ${weekdayLabel(result.dueWeekday)}`,
        `${s.dueDateBeforeShift}: ${formatDate(result.dueDateBeforeShift)}`,
        `${s.shiftedDays}: ${result.shiftedDays}`,
        `${s.totalDays}: ${result.totalDays}`,
        `${s.daysLate}: ${result.daysLate}`,
        `${s.daysUntilDue}: ${result.daysUntilDue}`,
        "",
        `${s.issueDateDay}: ${formatDate(issueDate)}`,
        `${s.mode}: ${modeLabel}`,
        `${s.term}: ${term.trim()}`,
        `${s.referenceDateDay}: ${formatDate(referenceDate)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.issueDateDay} value={issueDay} onChange={setIssueDay} />
      <ToolInput label={s.issueDateMonth} value={issueMonth} onChange={setIssueMonth} />
      <ToolInput label={s.issueDateYear} value={issueYear} onChange={setIssueYear} />
      <ToolSelect<DueDateMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "daysFromDate", label: s.modeDaysFromDate },
          { id: "daysFromEndOfMonth", label: s.modeDaysFromEndOfMonth },
          { id: "monthsFromDate", label: s.modeMonthsFromDate },
        ]}
      />
      <ToolInput label={s.term} hint={s.termHint} value={term} onChange={setTerm} />
      <ToolSelect<"yes" | "no">
        label={s.countIssueDate}
        value={countIssueDate}
        onChange={setCountIssueDate}
        options={[
          { id: "no", label: s.countIssueDateNo },
          { id: "yes", label: s.countIssueDateYes },
        ]}
      />
      <ToolSelect<"on" | "off">
        label={s.shiftEnabled}
        value={shiftEnabled}
        onChange={setShiftEnabled}
        options={[
          { id: "off", label: s.shiftOff },
          { id: "on", label: s.shiftOn },
        ]}
      />
      <ToolSelect<"forward" | "backward">
        label={s.shiftDirection}
        value={shiftDirection}
        onChange={setShiftDirection}
        options={[
          { id: "forward", label: s.shiftForward },
          { id: "backward", label: s.shiftBackward },
        ]}
      />
      <ToolInput
        label={s.weekendDays}
        hint={s.weekendDaysHint}
        value={weekendDaysText}
        onChange={setWeekendDaysText}
      />
      <ToolTextArea
        label={s.nonWorkingDays}
        hint={s.nonWorkingDaysHint}
        value={nonWorkingDaysText}
        onChange={setNonWorkingDaysText}
      />
      <ToolInput
        label={s.referenceDateDay}
        hint={s.referenceDateHint}
        value={referenceDay}
        onChange={setReferenceDay}
      />
      <ToolInput label={s.referenceDateMonth} value={referenceMonth} onChange={setReferenceMonth} />
      <ToolInput label={s.referenceDateYear} value={referenceYear} onChange={setReferenceYear} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.dueDate} value={formatDate(result.dueDate)} />
          <ResultRow label={s.dueWeekday} value={weekdayLabel(result.dueWeekday)} />
          <ResultRow label={s.dueDateBeforeShift} value={formatDate(result.dueDateBeforeShift)} />
          <ResultRow label={s.shiftedDays} value={proNum(result.shiftedDays, 0)} />
          {result.capReached && <p className="tool__note">{s.capReachedNote}</p>}
          <ResultRow label={s.totalDays} value={proNum(result.totalDays, 0)} />
          <ResultRow label={s.daysLate} value={proNum(result.daysLate, 0)} />
          <ResultRow label={s.daysUntilDue} value={proNum(result.daysUntilDue, 0)} />
          <p className="tool__note">{s.note}</p>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.issueDateDay, value: formatDate(issueDate) },
              { label: s.mode, value: modeLabel },
              { label: s.term, value: term.trim() },
              { label: s.referenceDateDay, value: formatDate(referenceDate) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function PaymentReference97Tool() {
  const s = strings.pro.biznis["payment-reference-97"];
  const [mode, setMode] = useState<"compute" | "verify">("compute");
  const [reference, setReference] = useState("");
  const [value, setValue] = useState("");

  const typed = mode === "compute" ? anyTyped(reference) : anyTyped(value);
  const computeResult = mode === "compute" ? paymentReferenceCompute(reference) : undefined;
  const verifyResult = mode === "verify" ? paymentReferenceVerify(value) : undefined;

  const failure = !typed
    ? undefined
    : mode === "compute"
      ? computeResult !== undefined && !computeResult.ok
        ? s.errorReference
        : undefined
      : verifyResult !== undefined && !verifyResult.ok
        ? s.errorValue
        : undefined;

  const copyText =
    mode === "compute"
      ? computeResult?.ok === true
        ? [
            `${s.checkDigits}: ${computeResult.checkDigitsText}`,
            `${s.formatted}: ${computeResult.formatted}`,
          ].join("\n")
        : ""
      : verifyResult?.ok === true
        ? [
            `${s.enteredCheckDigits}: ${pad2(verifyResult.enteredCheckDigits)}`,
            `${s.computedCheckDigits}: ${pad2(verifyResult.computedCheckDigits)}`,
            `${s.matches}: ${verifyResult.matches ? s.yes : s.no}`,
          ].join("\n")
        : "";

  return (
    <>
      <ToolSelect<"compute" | "verify">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "compute", label: s.modeCompute },
          { id: "verify", label: s.modeVerify },
        ]}
      />
      {mode === "compute" ? (
        <ToolInput
          label={s.reference}
          hint={s.referenceHint}
          value={reference}
          onChange={setReference}
          mono
        />
      ) : (
        <ToolInput label={s.value} hint={s.valueHint} value={value} onChange={setValue} mono />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {mode === "compute" && computeResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.checkDigits} value={computeResult.checkDigitsText} />
          <ResultRow label={s.formatted} value={computeResult.formatted} />
          {computeResult.overTwentyDigits && <p className="tool__note">{s.overTwentyNote}</p>}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[{ label: s.reference, value: reference.trim() }]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      {mode === "verify" && verifyResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.enteredCheckDigits} value={pad2(verifyResult.enteredCheckDigits)} />
          <ResultRow label={s.computedCheckDigits} value={pad2(verifyResult.computedCheckDigits)} />
          <ResultRow label={s.matches} value={verifyResult.matches ? s.yes : s.no} />
          {verifyResult.overTwentyDigits && <p className="tool__note">{s.overTwentyNote}</p>}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.value, value: value.trim() }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function ShareAllocationTool() {
  const s = strings.pro.biznis["share-allocation"];
  const [total, setTotal] = useState("");
  const [sharesText, setSharesText] = useState("");
  const [unitChoice, setUnitChoice] = useState<"0.01" | "1" | "10">("0.01");

  const typed = anyTyped(total, sharesText);
  const shares = parseNumberList(sharesText);
  const result = shareAllocation({
    total: proParse(total) ?? Number.NaN,
    shares,
    unit: Number(unitChoice),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "total"
        ? s.errorTotal
        : result.reason === "unit"
          ? s.errorUnit
          : s.errorShares;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${s.tableIndex} ${row.index + 1}: ${proNum(row.amount, 2)} (${proUnit(
              proNum(row.percent, 2),
              "%",
            )})`,
        ),
        `${s.shareSum}: ${proNum(result.shareSum, 2)}`,
        `${s.checkSum}: ${proNum(result.checkSum, 2)}`,
        "",
        `${s.total}: ${proNum(proParse(total) ?? 0, 2)}`,
        `${s.shares}: ${shares.map((share) => proNum(share, 2)).join(", ")}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.total} value={total} onChange={setTotal} />
      <ToolTextArea label={s.shares} hint={s.sharesHint} value={sharesText} onChange={setSharesText} />
      <ToolSelect<"0.01" | "1" | "10">
        label={s.unit}
        value={unitChoice}
        onChange={setUnitChoice}
        options={[
          { id: "0.01", label: s.unit001 },
          { id: "1", label: s.unit1 },
          { id: "10", label: s.unit10 },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.tableIndex, s.tableShare, s.tablePercent, s.tableAmount, s.tableExtra]}
            rows={result.rows.map((row) => [
              String(row.index + 1),
              proNum(row.share, 2),
              proUnit(proNum(row.percent, 2), "%"),
              proNum(row.amount, 2),
              row.gotExtraUnit ? s.extraYes : s.extraNo,
            ])}
          />
          <ResultRow label={s.shareSum} value={proNum(result.shareSum, 2)} />
          <ResultRow label={s.checkSum} value={proNum(result.checkSum, 2)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.total, value: proNum(proParse(total) ?? 0, 2) },
              { label: s.shares, value: shares.map((share) => proNum(share, 2)).join(", ") },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function SimpleInterestDaysTool() {
  const s = strings.pro.biznis["simple-interest-days"];
  const [principal, setPrincipal] = useState("");
  const [annualRatePercent, setAnnualRatePercent] = useState("");
  const [fromDay, setFromDay] = useState("");
  const [fromMonth, setFromMonth] = useState("");
  const [fromYear, setFromYear] = useState("");
  const [toDay, setToDay] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [toYear, setToYear] = useState("");
  const [basis, setBasis] = useState<DayCountBasis>("act365");
  const [countBothEnds, setCountBothEnds] = useState<"no" | "yes">("no");

  const typed = anyTyped(
    principal,
    annualRatePercent,
    fromDay,
    fromMonth,
    fromYear,
    toDay,
    toMonth,
    toYear,
  );
  const from = dmyToDate(fromDay, fromMonth, fromYear);
  const to = dmyToDate(toDay, toMonth, toYear);

  const result = simpleInterestDays({
    principal: proParse(principal) ?? Number.NaN,
    annualRatePercent: proParse(annualRatePercent) ?? Number.NaN,
    from,
    to,
    basis,
    countBothEnds: countBothEnds === "yes",
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "principal"
        ? s.errorPrincipal
        : result.reason === "annualRatePercent"
          ? s.errorAnnualRatePercent
          : result.reason === "from"
            ? s.errorFrom
            : s.errorTo;

  const basisLabel =
    basis === "act365" ? s.basisAct365 : basis === "act360" ? s.basisAct360 : s.basisE30360;

  const copyText = !result.ok
    ? ""
    : [
        `${s.days}: ${proUnit(proNum(result.days, 0), s.unitDays)}`,
        `${s.calendarDays}: ${proUnit(proNum(result.calendarDays, 0), s.unitDays)}`,
        `${s.divisor}: ${proNum(result.divisor, 0)}`,
        `${s.interest}: ${proNum(result.interest, 2)}`,
        `${s.dailyInterest}: ${proNum(result.dailyInterest, 2)}`,
        `${s.total}: ${proNum(result.total, 2)}`,
        "",
        `${s.principal}: ${proNum(proParse(principal) ?? 0, 2)}`,
        `${s.annualRatePercent}: ${proUnit(proNum(proParse(annualRatePercent) ?? 0, 2), s.unitPercent)}`,
        `${s.fromDay}: ${formatDate(from)}`,
        `${s.toDay}: ${formatDate(to)}`,
        `${s.basis}: ${basisLabel}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.principal} value={principal} onChange={setPrincipal} />
      <ToolInput
        label={s.annualRatePercent}
        hint={s.annualRatePercentHint}
        value={annualRatePercent}
        onChange={setAnnualRatePercent}
      />
      <ToolInput label={s.fromDay} value={fromDay} onChange={setFromDay} />
      <ToolInput label={s.fromMonth} value={fromMonth} onChange={setFromMonth} />
      <ToolInput label={s.fromYear} value={fromYear} onChange={setFromYear} />
      <ToolInput label={s.toDay} value={toDay} onChange={setToDay} />
      <ToolInput label={s.toMonth} value={toMonth} onChange={setToMonth} />
      <ToolInput label={s.toYear} value={toYear} onChange={setToYear} />
      <ToolSelect<DayCountBasis>
        label={s.basis}
        value={basis}
        onChange={setBasis}
        options={[
          { id: "act365", label: s.basisAct365 },
          { id: "act360", label: s.basisAct360 },
          { id: "e30360", label: s.basisE30360 },
        ]}
      />
      <ToolSelect<"no" | "yes">
        label={s.countBothEnds}
        value={countBothEnds}
        onChange={setCountBothEnds}
        hint={s.countBothEndsHint}
        options={[
          { id: "no", label: s.countBothEndsNo },
          { id: "yes", label: s.countBothEndsYes },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.days} value={proUnit(proNum(result.days, 0), s.unitDays)} />
          <ResultRow
            label={s.calendarDays}
            value={proUnit(proNum(result.calendarDays, 0), s.unitDays)}
          />
          <ResultRow label={s.divisor} value={proNum(result.divisor, 0)} />
          <ResultRow label={s.interest} value={proNum(result.interest, 2)} />
          <ResultRow label={s.dailyInterest} value={proNum(result.dailyInterest, 2)} />
          <ResultRow label={s.total} value={proNum(result.total, 2)} />
          <p className="tool__note">{s.note}</p>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.principal, value: proNum(proParse(principal) ?? 0, 2) },
              {
                label: s.annualRatePercent,
                value: proUnit(proNum(proParse(annualRatePercent) ?? 0, 2), s.unitPercent),
              },
              { label: s.fromDay, value: formatDate(from) },
              { label: s.toDay, value: formatDate(to) },
              { label: s.basis, value: basisLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function TaxIdCheckTool() {
  const s = strings.pro.biznis["tax-id-check"];
  const [mode, setMode] = useState<"verify" | "compute">("verify");
  const [totalDigitsText, setTotalDigitsText] = useState("");
  const [value, setValue] = useState("");
  const [prefix, setPrefix] = useState("");

  const totalDigits = proParse(totalDigitsText) ?? Number.NaN;
  const typed =
    mode === "verify" ? anyTyped(totalDigitsText, value) : anyTyped(totalDigitsText, prefix);
  const verifyResult = mode === "verify" ? taxIdVerify(totalDigits, value) : undefined;
  const computeResult = mode === "compute" ? taxIdCompute(totalDigits, prefix) : undefined;

  const mapReason = (reason: string): string =>
    reason === "totalDigits"
      ? s.errorTotalDigits
      : reason === "number"
        ? s.errorNumber
        : reason === "prefix"
          ? s.errorPrefix
          : s.errorLength;

  const failure = !typed
    ? undefined
    : mode === "verify"
      ? verifyResult !== undefined && !verifyResult.ok
        ? mapReason(verifyResult.reason)
        : undefined
      : computeResult !== undefined && !computeResult.ok
        ? mapReason(computeResult.reason)
        : undefined;

  const copyText =
    mode === "verify"
      ? verifyResult?.ok === true
        ? [
            `${s.checkDigit}: ${verifyResult.checkDigit}`,
            `${s.enteredCheckDigit}: ${verifyResult.enteredCheckDigit}`,
            `${s.matches}: ${verifyResult.matches ? s.yes : s.no}`,
            `${s.correctedNumber}: ${verifyResult.correctedNumber}`,
          ].join("\n")
        : ""
      : computeResult?.ok === true
        ? [
            `${s.checkDigit}: ${computeResult.checkDigit}`,
            `${s.number}: ${computeResult.number}`,
          ].join("\n")
        : "";

  return (
    <>
      <ToolSelect<"verify" | "compute">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "verify", label: s.modeVerify },
          { id: "compute", label: s.modeCompute },
        ]}
      />
      <ToolInput
        label={s.totalDigits}
        hint={s.totalDigitsHint}
        value={totalDigitsText}
        onChange={setTotalDigitsText}
      />
      {mode === "verify" ? (
        <ToolInput label={s.value} hint={s.valueHint} value={value} onChange={setValue} mono />
      ) : (
        <ToolInput label={s.prefix} hint={s.prefixHint} value={prefix} onChange={setPrefix} mono />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {mode === "verify" && verifyResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.checkDigit} value={String(verifyResult.checkDigit)} />
          <ResultRow label={s.enteredCheckDigit} value={String(verifyResult.enteredCheckDigit)} />
          <ResultRow label={s.matches} value={verifyResult.matches ? s.yes : s.no} />
          <ResultRow label={s.correctedNumber} value={verifyResult.correctedNumber} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.totalDigits, value: totalDigitsText.trim() },
              { label: s.value, value: value.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      {mode === "compute" && computeResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.checkDigit} value={String(computeResult.checkDigit)} />
          <ResultRow label={s.number} value={computeResult.number} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.totalDigits, value: totalDigitsText.trim() },
              { label: s.prefix, value: prefix.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function TieredCommissionTool() {
  const s = strings.pro.biznis["tiered-commission"];
  const [base, setBase] = useState("");
  const [tiersText, setTiersText] = useState("");
  const [mode, setMode] = useState<CommissionMode>("marginal");
  const [minCommission, setMinCommission] = useState("");
  const [maxCommission, setMaxCommission] = useState("");

  const typed = anyTyped(base, tiersText);
  const tiers = parseTierList(tiersText);
  const result = tieredCommission({
    base: proParse(base) ?? Number.NaN,
    tiers,
    mode,
    minCommission: proParse(minCommission),
    maxCommission: proParse(maxCommission),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "base"
        ? s.errorBase
        : result.reason === "tiers"
          ? s.errorTiers
          : result.reason === "minCommission"
            ? s.errorMinCommission
            : s.errorMaxCommission;

  const modeLabel = mode === "marginal" ? s.modeMarginal : s.modeFlat;
  // A floor or a cap CHANGED the outcome — read directly off the two figures
  // core returns rather than re-deriving whether a limit was active.
  const limited = result.ok && result.commission !== result.commissionBeforeLimits;

  const copyText = !result.ok
    ? ""
    : [
        `${s.commission}: ${proNum(result.commission, 2)}`,
        ...(limited
          ? [`${s.commissionBeforeLimits}: ${proNum(result.commissionBeforeLimits, 2)}`]
          : []),
        ...(result.effectiveRatePercent === undefined
          ? []
          : [
              `${s.effectiveRatePercent}: ${proUnit(
                proNum(result.effectiveRatePercent, 2),
                s.unitPercent,
              )}`,
            ]),
        `${s.remainder}: ${proNum(result.remainder, 2)}`,
        "",
        `${s.base}: ${proNum(proParse(base) ?? 0, 2)}`,
        `${s.mode}: ${modeLabel}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.base} value={base} onChange={setBase} />
      <ToolTextArea label={s.tiers} hint={s.tiersHint} value={tiersText} onChange={setTiersText} />
      <ToolSelect<CommissionMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "marginal", label: s.modeMarginal },
          { id: "flat", label: s.modeFlat },
        ]}
      />
      <ToolInput label={s.minCommission} value={minCommission} onChange={setMinCommission} />
      <ToolInput label={s.maxCommission} value={maxCommission} onChange={setMaxCommission} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.tableFrom, s.tableTo, s.tableRate, s.tableAmount, s.tableCommission]}
            rows={result.slices.map((slice) => [
              proNum(slice.from, 2),
              slice.to === undefined ? s.tableOpenEnd : proNum(slice.to, 2),
              proUnit(proNum(slice.ratePercent, 2), s.unitPercent),
              proNum(slice.amount, 2),
              proNum(slice.commission, 2),
            ])}
          />
          {limited && (
            <ResultRow
              label={s.commissionBeforeLimits}
              value={proNum(result.commissionBeforeLimits, 2)}
            />
          )}
          <ResultRow label={s.commission} value={proNum(result.commission, 2)} />
          {result.appliedTierIndex !== undefined && (
            <ResultRow label={s.appliedTier} value={String(result.appliedTierIndex + 1)} />
          )}
          {result.effectiveRatePercent !== undefined && (
            <ResultRow
              label={s.effectiveRatePercent}
              value={proUnit(proNum(result.effectiveRatePercent, 2), s.unitPercent)}
            />
          )}
          <ResultRow label={s.remainder} value={proNum(result.remainder, 2)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.base, value: proNum(proParse(base) ?? 0, 2) },
              { label: s.mode, value: modeLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const BIZNIS_SURFACES: Readonly<Record<string, ComponentType>> = {
  "billable-hours": BillableHoursTool,
  "break-even": BreakEvenTool,
  "chained-discount": ChainedDiscountTool,
  "deposit-instalments": DepositInstalmentsTool,
  "hourly-rate-target": HourlyRateTargetTool,
  "iban-check": IbanCheckTool,
  "margin-markup": MarginMarkupTool,
  "payment-due-date": PaymentDueDateTool,
  "payment-reference-97": PaymentReference97Tool,
  "share-allocation": ShareAllocationTool,
  "simple-interest-days": SimpleInterestDaysTool,
  "tax-id-check": TaxIdCheckTool,
  "tiered-commission": TieredCommissionTool,
};
