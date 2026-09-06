import {
  annuitySchedule,
  amountInWords,
  cadastralArea,
  contractPenalty,
  coOwnershipShares,
  deadlineBackward,
  deadlineForward,
  domesticAccount,
  ibanRecord,
  interestAccrual,
  jmbgRecord,
  mod97CheckDigits,
  proportionalCosts,
  rateConversion,
  sentenceTerm,
  splitAmount,
  sumOfPeriods,
  textPages,
  workingDays,
  type CivilDate,
  type DatePeriod,
  type DayBasis,
  type DeadlineShift,
  type DeadlineUnit,
  type InterestMethod,
  type NounGender,
  type NounForms,
  type PageRounding,
  type PaymentFrequency,
  type PaymentTiming,
  type RateConversionMethod,
  type RateDirection,
  type RatePeriod,
  type ShareFraction,
  type SplitUnit,
  type SplitWeight,
  type TermFraction,
  type Weekday,
} from "@nexus/core/pro/pravo";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import {
  CopyButton,
  ResultRow,
  ToolAgainstLimit,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolOutput,
  ToolSection,
  ToolSelect,
  ToolTable,
  ToolTextArea,
} from "./shared.js";

/**
 * „Pravo i pravna praksa" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/pravo.ts`'s. This file shapes fields,
 * hands typed values to the core function and reads the answer onto the page —
 * nothing here divides, rounds, compares or sums.
 *
 * **Dates are the one shape `format.js` does not cover.** Every date field in
 * this pack is typed as „GGGG-MM-DD" and read by `parseDate` below: three
 * digit groups pulled apart with a regular expression and handed to `Number`,
 * never combined, compared or arithmetically touched — exactly the same job
 * `proParse` does for a decimal quantity, just for the three integers a date
 * is made of. Whether the result is a date that EXISTS (leap years, 31 days in
 * April, …) is answered inside the core module, never here: an unparseable
 * string becomes a candidate no valid calendar date could be, which the core
 * module refuses the same way it refuses any other impossible date.
 *
 * None of this pack's tools are `life-safety` or `food-safety`, so none of
 * them is bound by the absolute „never a verdict" rule — but several are
 * `legal-procedure`, and their own output specification is explicit that the
 * tool reports days and dates and never what a party is entitled to. That
 * discipline is kept here even where the contract does not force it.
 */

/** „GGGG-MM-DD" → a date candidate. Digits only ever reach `Number()`; whether
 * the date exists is answered inside the core module. */
function parseDate(text: string): CivilDate {
  const match = /^\s*(\d{1,4})-(\d{1,2})-(\d{1,2})\s*$/.exec(text);
  if (match === null) return { year: Number.NaN, month: Number.NaN, day: Number.NaN };
  const y = match[1] ?? "";
  const m = match[2] ?? "";
  const d = match[3] ?? "";
  return { year: Number(y), month: Number(m), day: Number(d) };
}

/** One „GGGG-MM-DD" per line → a list of date candidates, blank lines dropped. */
function parseDateLines(text: string): readonly CivilDate[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => parseDate(line));
}

/** A date already known valid, „DD.MM.GGGG." — the drawer's one date format. */
function fmtDate(date: CivilDate): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.day)}.${pad(date.month)}.${date.year}.`;
}

function isWeekdayNumber(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

/** „1, 6, 7" → the weekdays it names (1 = ponedeljak … 7 = nedelja). */
function parseWeekdaySet(text: string): readonly Weekday[] {
  return text
    .split(",")
    .map((token) => proParse(token))
    .filter((value): value is number => value !== undefined)
    .filter(isWeekdayNumber);
}

type YesNo = "yes" | "no";
function yesNoOptions(yes: string, no: string): readonly { readonly id: YesNo; readonly label: string }[] {
  return [
    { id: "yes", label: yes },
    { id: "no", label: no },
  ];
}

/** One „GGGG-MM-DD; stopa" per line → a list of rate-period candidates. */
function parseRateLines(text: string): readonly RatePeriod[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const parts = line.split(";");
      const dateText = parts[0] ?? "";
      const rateText = parts[1] ?? "";
      return { from: parseDate(dateText), annualRatePercent: proParse(rateText) ?? Number.NaN };
    });
}

/**
 * One weight per line, in whichever of the three notations the tool accepts:
 * a plain number, „b/i" as a fraction, or „x%" as a percent. Every digit
 * group still passes through `proParse` — this only recognises WHICH shape a
 * line is in, never the value inside it.
 */
function parseWeightLine(line: string): SplitWeight {
  const trimmed = line.trim();
  const percent = /^([^/%]+)%$/.exec(trimmed);
  if (percent !== null) {
    return { kind: "percent", value: proParse(percent[1] ?? "") ?? Number.NaN };
  }
  const fraction = /^([^/%]+)\/([^/%]+)$/.exec(trimmed);
  if (fraction !== null) {
    return {
      kind: "fraction",
      numerator: proParse(fraction[1] ?? "") ?? Number.NaN,
      denominator: proParse(fraction[2] ?? "") ?? Number.NaN,
    };
  }
  return { kind: "number", value: proParse(trimmed) ?? Number.NaN };
}

function parseWeightLines(text: string): readonly SplitWeight[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(parseWeightLine);
}

/** One „b/i" fraction per line — the same shape `parseWeightLine` reads for a
 * fraction weight, reused for the co-ownership tool's ideal shares. */
function parseFractionLine(line: string): ShareFraction {
  const match = /^([^/]+)\/([^/]+)$/.exec(line.trim());
  return {
    numerator: proParse(match?.[1] ?? "") ?? Number.NaN,
    denominator: proParse(match?.[2] ?? "") ?? Number.NaN,
  };
}

function parseFractionLines(text: string): readonly ShareFraction[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(parseFractionLine);
}

/** One „GGGG-MM-DD do GGGG-MM-DD" per line — a list of period candidates. */
function parsePeriodLine(line: string): DatePeriod {
  const parts = line.split(" do ");
  return { from: parseDate(parts[0] ?? ""), to: parseDate(parts[1] ?? "") };
}

function parsePeriodLines(text: string): readonly DatePeriod[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(parsePeriodLine);
}

// ---------------------------------------------------------------------------
// Anuitet i otplatni plan
// ---------------------------------------------------------------------------

const PAYMENTS_PER_YEAR: Record<"12" | "4" | "2" | "1", PaymentFrequency> = {
  "12": 12,
  "4": 4,
  "2": 2,
  "1": 1,
};

export function AnnuityScheduleTool() {
  const s = strings.pro.pravo["anuitet-otplatni-plan"];
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [instalments, setInstalments] = useState("");
  const [paymentsPerYear, setPaymentsPerYear] = useState<"12" | "4" | "2" | "1">("12");
  const [conversion, setConversion] = useState<RateConversionMethod>("proportional");
  const [dueTiming, setDueTiming] = useState<PaymentTiming>("end");
  const [firstDate, setFirstDate] = useState("");

  const typed =
    proParse(principal) !== undefined ||
    proParse(rate) !== undefined ||
    proParse(instalments) !== undefined;
  const firstInstalmentDate = firstDate.trim() === "" ? undefined : parseDate(firstDate);
  const plan = annuitySchedule({
    principal: proParse(principal) ?? Number.NaN,
    annualRatePercent: proParse(rate) ?? Number.NaN,
    instalments: proParse(instalments) ?? Number.NaN,
    paymentsPerYear: PAYMENTS_PER_YEAR[paymentsPerYear],
    conversion,
    dueTiming,
    firstInstalmentDate,
  });

  const failure =
    plan.ok || !typed
      ? undefined
      : plan.reason === "principal"
        ? s.errorPrincipal
        : plan.reason === "annualRatePercent"
          ? s.errorRate
          : plan.reason === "instalments"
            ? s.errorInstalments
            : plan.reason === "firstInstalmentDate"
              ? s.errorFirstDate
              : s.errorGeneral;

  const copyText = !plan.ok
    ? ""
    : [
        `${s.instalment}: ${proNum(plan.instalment, 2)}`,
        `${s.totalPaid}: ${proNum(plan.totalPaid, 2)}`,
        `${s.totalInterest}: ${proNum(plan.totalInterest, 2)}`,
        `${s.lastAdjustment}: ${proNum(plan.lastInstalmentAdjustment, 2)}`,
        "",
        `${s.principal}: ${proNum(proParse(principal) ?? 0, 2)}`,
        `${s.rate}: ${proNum(proParse(rate) ?? 0, 4)}%`,
        `${s.instalments}: ${instalments.trim()}`,
        `${s.paymentsPerYear}: ${paymentsPerYear}`,
        `${s.conversion}: ${conversion === "proportional" ? s.conversionProportional : s.conversionConformal}`,
        `${s.dueTiming}: ${dueTiming === "end" ? s.dueEnd : s.dueStart}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.principal} value={principal} onChange={setPrincipal} />
      <ToolInput label={s.rate} hint={s.rateHint} value={rate} onChange={setRate} />
      <ToolInput label={s.instalments} value={instalments} onChange={setInstalments} />
      <ToolSelect<"12" | "4" | "2" | "1">
        label={s.paymentsPerYear}
        value={paymentsPerYear}
        onChange={setPaymentsPerYear}
        options={[
          { id: "12", label: s.freqMonthly },
          { id: "4", label: s.freqQuarterly },
          { id: "2", label: s.freqSemiannual },
          { id: "1", label: s.freqAnnual },
        ]}
      />
      <ToolSelect<RateConversionMethod>
        label={s.conversion}
        value={conversion}
        onChange={setConversion}
        options={[
          { id: "proportional", label: s.conversionProportional },
          { id: "conformal", label: s.conversionConformal },
        ]}
      />
      <ToolSelect<PaymentTiming>
        label={s.dueTiming}
        hint={s.dueTimingHint}
        value={dueTiming}
        onChange={setDueTiming}
        options={[
          { id: "end", label: s.dueEnd },
          { id: "start", label: s.dueStart },
        ]}
      />
      <ToolInput label={s.firstDate} hint={s.dateHint} value={firstDate} onChange={setFirstDate} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {plan.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.periodicRate} value={proNum(plan.periodicRate, 6)} />
          <ResultRow label={s.instalment} value={proNum(plan.instalment, 2)} />
          <ResultRow label={s.totalPaid} value={proNum(plan.totalPaid, 2)} />
          <ResultRow label={s.totalInterest} value={proNum(plan.totalInterest, 2)} />
          <ResultRow label={s.lastAdjustment} value={proNum(plan.lastInstalmentAdjustment, 2)} />

          {plan.amortisationNotice !== undefined && (
            <ToolSection title={s.notice}>
              <ResultRow label={s.noticeRow} value={String(plan.amortisationNotice.row)} />
              <ResultRow
                label={s.noticeExact}
                value={proNum(plan.amortisationNotice.exactInstalment, 6)}
              />
              <ResultRow
                label={s.noticeShortfall}
                value={proNum(plan.amortisationNotice.shortfall, 6)}
              />
              <p className="nx-hint nx-hint--prose">{s.noticeNote}</p>
            </ToolSection>
          )}

          <ToolTable
            head={[s.colIndex, s.colDate, s.colInterest, s.colPrincipal, s.colInstalment, s.colBalance]}
            rows={plan.rows.map((row) => [
              String(row.index),
              row.date === undefined ? "—" : fmtDate(row.date),
              proNum(row.interest, 2),
              proNum(row.principalPart, 2),
              proNum(row.instalment, 2),
              proNum(row.balance, 2),
            ])}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.principal, value: proNum(proParse(principal) ?? 0, 2) },
              { label: s.rate, value: `${proNum(proParse(rate) ?? 0, 4)}%` },
              { label: s.instalments, value: instalments.trim() },
              { label: s.paymentsPerYear, value: paymentsPerYear },
              {
                label: s.conversion,
                value: conversion === "proportional" ? s.conversionProportional : s.conversionConformal,
              },
              { label: s.dueTiming, value: dueTiming === "end" ? s.dueEnd : s.dueStart },
              {
                label: s.firstDate,
                value: firstInstalmentDate === undefined ? s.noDate : fmtDate(firstInstalmentDate),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Provera JMBG-a
// ---------------------------------------------------------------------------

export function JmbgTool() {
  const s = strings.pro.pravo["jmbg-provera"];
  const [digits, setDigits] = useState("");
  const [mode, setMode] = useState<"check" | "compute">("check");
  const weekdays = [s.weekday1, s.weekday2, s.weekday3, s.weekday4, s.weekday5, s.weekday6, s.weekday7];

  const typed = digits.trim() !== "";
  const record = jmbgRecord({ digits, mode });
  const failure = record.ok || !typed ? undefined : s.errorDigits;

  const copyText = !record.ok
    ? ""
    : [
        `${s.digits}: ${record.digits}`,
        `${s.checkDigit}: ${record.checkDigit}`,
        `${s.matches}: ${record.matches === undefined ? s.notApplicable : record.matches ? s.yes : s.no}`,
        `${s.date}: ${fmtDate(record.date)}`,
        `${s.dateExists}: ${record.dateExists ? s.yes : s.no}`,
        `${s.region}: ${record.region}`,
        `${s.sequence}: ${record.sequence}`,
        "",
        `${s.digitsInput}: ${digits.trim()}`,
        `${s.mode}: ${mode === "check" ? s.modeCheck : s.modeCompute}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.digitsInput} hint={s.digitsHint} value={digits} onChange={setDigits} mono />
      <ToolSelect<"check" | "compute">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "check", label: s.modeCheck },
          { id: "compute", label: s.modeCompute },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {record.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.weightedSum} value={String(record.weightedSum)} />
          <ResultRow label={s.remainder} value={String(record.remainder)} />
          <ResultRow label={s.m} value={String(record.m)} />
          <ResultRow label={s.checkDigit} value={String(record.checkDigit)} />
          {record.matches !== undefined && (
            <ResultRow label={s.matches} value={record.matches ? s.yes : s.no} />
          )}
          <ResultRow label={s.digits} value={record.digits} mono />
          <p className="nx-hint nx-hint--prose">{s.matchesNote}</p>

          <ToolSection title={s.dateTitle}>
            <ResultRow label={s.date} value={fmtDate(record.date)} />
            <ResultRow label={s.dateExists} value={record.dateExists ? s.yes : s.no} />
            {record.weekday !== undefined && (
              <ResultRow label={s.weekday} value={weekdays[record.weekday - 1] ?? ""} />
            )}
            <ResultRow
              label={s.centuryRule}
              value={record.centuryOffset === 1000 ? s.centuryPast : s.centuryPresent}
            />
            <p className="nx-hint nx-hint--prose">{s.centuryNote}</p>
          </ToolSection>

          <ToolSection title={s.otherTitle}>
            <ResultRow label={s.region} value={String(record.region)} />
            <ResultRow label={s.sequence} value={String(record.sequence)} />
            <ResultRow
              label={s.sexRange}
              value={record.sexRange === "male" ? s.sexRangeMale : s.sexRangeFemale}
            />
          </ToolSection>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.digitsInput, value: digits.trim() },
              { label: s.mode, value: mode === "check" ? s.modeCheck : s.modeCompute },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Katastarska površina
// ---------------------------------------------------------------------------

export function CadastralAreaTool() {
  const s = strings.pro.pravo["katastarska-povrsina"];
  const [direction, setDirection] = useState<"toParts" | "toSquareMetres">("toParts");
  const [squareMetres, setSquareMetres] = useState("");
  const [hectares, setHectares] = useState("");
  const [ares, setAres] = useState("");
  const [remainder, setRemainder] = useState("");

  const typed =
    direction === "toParts"
      ? proParse(squareMetres) !== undefined
      : proParse(hectares) !== undefined ||
        proParse(ares) !== undefined ||
        proParse(remainder) !== undefined;

  const area = cadastralArea({
    direction,
    squareMetres: direction === "toParts" ? (proParse(squareMetres) ?? Number.NaN) : undefined,
    hectares: direction === "toSquareMetres" ? (proParse(hectares) ?? Number.NaN) : undefined,
    ares: direction === "toSquareMetres" ? (proParse(ares) ?? Number.NaN) : undefined,
    remainderSquareMetres:
      direction === "toSquareMetres" ? (proParse(remainder) ?? Number.NaN) : undefined,
  });

  const failure =
    area.ok || !typed
      ? undefined
      : area.reason === "squareMetres"
        ? s.errorSquareMetres
        : area.reason === "hectares"
          ? s.errorHectares
          : area.reason === "ares"
            ? s.errorAres
            : s.errorRemainder;

  const composed = !area.ok
    ? ""
    : `${area.hectares} ${s.unitHa} ${area.ares} ${s.unitA} ${proNum(area.remainderSquareMetres, 4)} ${s.unitM2}`;

  const copyText = !area.ok
    ? ""
    : [
        `${s.composed}: ${composed}`,
        `${s.total}: ${proUnit(proNum(area.totalSquareMetres, 4), s.unitM2)}`,
        "",
        `${s.direction}: ${direction === "toParts" ? s.directionToParts : s.directionToSquareMetres}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<"toParts" | "toSquareMetres">
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "toParts", label: s.directionToParts },
          { id: "toSquareMetres", label: s.directionToSquareMetres },
        ]}
      />
      {direction === "toParts" ? (
        <ToolInput label={s.squareMetres} value={squareMetres} onChange={setSquareMetres} />
      ) : (
        <>
          <ToolInput label={s.hectares} value={hectares} onChange={setHectares} />
          <ToolInput label={s.ares} value={ares} onChange={setAres} />
          <ToolInput label={s.remainder} value={remainder} onChange={setRemainder} />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {area.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.composed} value={composed} />
          <ResultRow label={s.total} value={proUnit(proNum(area.totalSquareMetres, 4), s.unitM2)} />
          {area.wasNormalised && <p className="nx-hint nx-hint--prose">{s.wasNormalisedNote}</p>}
          {area.rounded && <p className="nx-hint nx-hint--prose">{s.roundedNote}</p>}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={
              direction === "toParts"
                ? [{ label: s.squareMetres, value: proUnit(proNum(proParse(squareMetres) ?? 0, 4), s.unitM2) }]
                : [
                    { label: s.hectares, value: hectares.trim() },
                    { label: s.ares, value: ares.trim() },
                    { label: s.remainder, value: proUnit(proNum(proParse(remainder) ?? 0, 4), s.unitM2) },
                  ]
            }
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const PRAVO_SURFACES: Readonly<Record<string, ComponentType>> = {
  "anuitet-otplatni-plan": AnnuityScheduleTool,
  "iznos-slovima": AmountInWordsTool,
  "jmbg-provera": JmbgTool,
  "katastarska-povrsina": CadastralAreaTool,
  "kazna-i-pritvor": SentenceTermTool,
  "nominalna-efektivna-stopa": RateConversionTool,
  "obracun-kamate": InterestAccrualTool,
  "podela-iznosa": SplitAmountTool,
  "racun-iban-provera": AccountCheckTool,
  "radni-dani": WorkingDaysTool,
  "rok-poslednji-dan": DeadlineTool,
  "strane-teksta": TextPagesTool,
  "suvlasnicki-udeli": CoOwnershipTool,
  "troskovi-srazmerno-uspehu": ProportionalCostsTool,
  "ugovorna-kazna": ContractPenaltyTool,
  "zbir-perioda": SumOfPeriodsTool,
};

// ---------------------------------------------------------------------------
// Zbir perioda
// ---------------------------------------------------------------------------

export function SumOfPeriodsTool() {
  const s = strings.pro.pravo["zbir-perioda"];
  const [periodsText, setPeriodsText] = useState("");
  const [includeLastDay, setIncludeLastDay] = useState<YesNo>("yes");
  const [convention, setConvention] = useState<"30/360" | "calendar">("30/360");

  const typed = periodsText.trim() !== "";
  const periods = parsePeriodLines(periodsText);
  const result = sumOfPeriods({
    periods,
    includeLastDay: includeLastDay === "yes",
    convention,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "periods"
        ? s.errorPeriods
        : s.errorConvention;

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalDays}: ${result.totalDays}`,
        `${s.decomposition}: ${result.years} ${s.unitYears}, ${result.months} ${s.unitMonths}, ${result.days} ${s.unitDays}`,
        `${s.convention}: ${result.convention === "30/360" ? s.convention30360 : s.conventionCalendar}`,
        "",
        `${s.periods}: ${periodsText.trim()}`,
        `${s.includeLastDay}: ${includeLastDay === "yes" ? s.yes : s.no}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.periods} hint={s.periodsHint} value={periodsText} onChange={setPeriodsText} />
      <ToolSelect<YesNo>
        label={s.includeLastDay}
        value={includeLastDay}
        onChange={setIncludeLastDay}
        options={yesNoOptions(s.yes, s.no)}
      />
      <ToolSelect<"30/360" | "calendar">
        label={s.convention}
        hint={s.conventionHint}
        value={convention}
        onChange={setConvention}
        options={[
          { id: "30/360", label: s.convention30360 },
          { id: "calendar", label: s.conventionCalendar },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.totalDays} value={String(result.totalDays)} />
          <ResultRow
            label={s.decomposition}
            value={`${result.years} ${s.unitYears}, ${result.months} ${s.unitMonths}, ${result.days} ${s.unitDays}`}
          />
          <ResultRow
            label={s.conventionApplied}
            value={result.convention === "30/360" ? s.convention30360 : s.conventionCalendar}
          />

          <ToolSection title={s.rowsTitle}>
            <ToolTable
              head={[s.colIndex, s.colDays, s.colReversed]}
              rows={result.rows.map((row) => [
                String(row.index + 1),
                String(row.days),
                row.reversed ? s.yes : s.no,
              ])}
            />
          </ToolSection>

          <ToolSection title={s.overlapsTitle}>
            {result.overlaps.length === 0 ? (
              <p className="nx-hint nx-hint--prose">{s.noOverlaps}</p>
            ) : (
              <ToolTable
                head={[s.colFirst, s.colSecond, s.colFrom, s.colTo, s.colOverlapDays]}
                rows={result.overlaps.map((overlap) => [
                  String(overlap.firstIndex + 1),
                  String(overlap.secondIndex + 1),
                  fmtDate(overlap.from),
                  fmtDate(overlap.to),
                  String(overlap.days),
                ])}
              />
            )}
            <p className="nx-hint nx-hint--prose">{s.overlapsNote}</p>
          </ToolSection>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.periods, value: periodsText.trim() },
              { label: s.includeLastDay, value: includeLastDay === "yes" ? s.yes : s.no },
              {
                label: s.convention,
                value: convention === "30/360" ? s.convention30360 : s.conventionCalendar,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Ugovorna kazna
// ---------------------------------------------------------------------------

export function ContractPenaltyTool() {
  const s = strings.pro.pravo["ugovorna-kazna"];
  const [base, setBase] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [dataSource, setDataSource] = useState<"days" | "dates">("days");
  const [delayDays, setDelayDays] = useState("");
  const [agreedDate, setAgreedDate] = useState("");
  const [actualDate, setActualDate] = useState("");
  const [capPercent, setCapPercent] = useState("");
  const [includeCompletionDay, setIncludeCompletionDay] = useState<YesNo>("no");

  const typed = proParse(base) !== undefined || proParse(dailyRate) !== undefined;
  const result = contractPenalty({
    base: proParse(base) ?? Number.NaN,
    dailyRatePercent: proParse(dailyRate) ?? Number.NaN,
    dataSource,
    delayDays: dataSource === "days" ? (proParse(delayDays) ?? Number.NaN) : undefined,
    agreedDate: dataSource === "dates" ? parseDate(agreedDate) : undefined,
    actualDate: dataSource === "dates" ? parseDate(actualDate) : undefined,
    capPercent: capPercent.trim() === "" ? undefined : (proParse(capPercent) ?? Number.NaN),
    includeCompletionDay: includeCompletionDay === "yes",
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "base"
        ? s.errorBase
        : result.reason === "dailyRatePercent"
          ? s.errorDailyRate
          : result.reason === "capPercent"
            ? s.errorCapPercent
            : result.reason === "agreedDate"
              ? s.errorAgreedDate
              : result.reason === "actualDate"
                ? s.errorActualDate
                : s.errorDataSource;

  const copyText = !result.ok
    ? ""
    : [
        `${s.delayDays}: ${result.delayDays}`,
        `${s.uncappedAmount}: ${proNum(result.uncappedAmount, 2)}`,
        result.capAmount === undefined ? "" : `${s.capAmount}: ${proNum(result.capAmount, 2)}`,
        `${s.amount}: ${proNum(result.amount, 2)}`,
        result.capDay === undefined ? "" : `${s.capDay}: ${result.capDay}`,
        "",
        `${s.base}: ${proNum(proParse(base) ?? 0, 2)}`,
        `${s.dailyRate}: ${proNum(proParse(dailyRate) ?? 0, 4)}%`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.base} value={base} onChange={setBase} />
      <ToolInput label={s.dailyRate} hint={s.dailyRateHint} value={dailyRate} onChange={setDailyRate} />
      <ToolSelect<"days" | "dates">
        label={s.dataSource}
        value={dataSource}
        onChange={setDataSource}
        options={[
          { id: "days", label: s.dataSourceDays },
          { id: "dates", label: s.dataSourceDates },
        ]}
      />
      {dataSource === "days" ? (
        <ToolInput label={s.delayDays} value={delayDays} onChange={setDelayDays} />
      ) : (
        <>
          <ToolInput label={s.agreedDate} hint={s.dateHint} value={agreedDate} onChange={setAgreedDate} />
          <ToolInput label={s.actualDate} hint={s.dateHint} value={actualDate} onChange={setActualDate} />
        </>
      )}
      <ToolInput label={s.capPercent} hint={s.capPercentHint} value={capPercent} onChange={setCapPercent} />
      <ToolSelect<YesNo>
        label={s.includeCompletionDay}
        value={includeCompletionDay}
        onChange={setIncludeCompletionDay}
        options={yesNoOptions(s.yes, s.no)}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.delayDays} value={String(result.delayDays)} />
          <ResultRow label={s.dailyAmount} value={proNum(result.dailyAmount, 2)} />
          <ResultRow label={s.amount} value={proNum(result.amount, 2)} />

          <ToolAgainstLimit
            label={s.uncappedAmount}
            value={proNum(result.uncappedAmount, 2)}
            limitLabel={s.capAmount}
            limit={result.capAmount === undefined ? undefined : proNum(result.capAmount, 2)}
            ratioLabel={s.capRatio}
            ratio={undefined}
          />
          {result.capDay !== undefined && (
            <ResultRow
              label={s.capDay}
              value={`${result.capDay}${result.capDate === undefined ? "" : ` (${fmtDate(result.capDate)})`}`}
            />
          )}
          {result.capDay === undefined && capPercent.trim() !== "" && (
            <p className="nx-hint nx-hint--prose">{s.noCapDayNote}</p>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.base, value: proNum(proParse(base) ?? 0, 2) },
              { label: s.dailyRate, value: `${proNum(proParse(dailyRate) ?? 0, 4)}%` },
              {
                label: s.dataSource,
                value: dataSource === "days" ? s.dataSourceDays : s.dataSourceDates,
              },
              { label: s.includeCompletionDay, value: includeCompletionDay === "yes" ? s.yes : s.no },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Troškovi srazmerno uspehu
// ---------------------------------------------------------------------------

export function ProportionalCostsTool() {
  const s = strings.pro.pravo["troskovi-srazmerno-uspehu"];
  const [source, setSource] = useState<"amounts" | "percent">("amounts");
  const [claimed, setClaimed] = useState("");
  const [awarded, setAwarded] = useState("");
  const [successPercentText, setSuccessPercentText] = useState("");
  const [firstCosts, setFirstCosts] = useState("");
  const [secondCosts, setSecondCosts] = useState("");

  const typed =
    proParse(firstCosts) !== undefined ||
    proParse(secondCosts) !== undefined ||
    (source === "amounts" ? proParse(claimed) !== undefined : proParse(successPercentText) !== undefined);

  const result = proportionalCosts({
    claimed: source === "amounts" ? (proParse(claimed) ?? Number.NaN) : undefined,
    awarded: source === "amounts" ? (proParse(awarded) ?? Number.NaN) : undefined,
    successPercent: source === "percent" ? (proParse(successPercentText) ?? Number.NaN) : undefined,
    firstPartyCosts: proParse(firstCosts) ?? Number.NaN,
    secondPartyCosts: proParse(secondCosts) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "claimed"
        ? s.errorClaimed
        : result.reason === "awarded"
          ? s.errorAwarded
          : result.reason === "successPercent"
            ? s.errorSuccessPercent
            : result.reason === "firstPartyCosts"
              ? s.errorFirstCosts
              : s.errorSecondCosts;

  const sideLabel = (side: "first" | "second" | "none") =>
    side === "first" ? s.sideFirst : side === "second" ? s.sideSecond : s.sideNone;

  const copyText = !result.ok
    ? ""
    : [
        `${s.successPercent}: ${proNum(result.successPercent, 4)}%`,
        `${s.firstShare}: ${proNum(result.firstPartyShare, 2)}`,
        `${s.secondShare}: ${proNum(result.secondPartyShare, 2)}`,
        `${s.difference}: ${proNum(result.differenceAmount, 2)} (${sideLabel(result.side)})`,
        "",
        `${s.firstCosts}: ${proNum(proParse(firstCosts) ?? 0, 2)}`,
        `${s.secondCosts}: ${proNum(proParse(secondCosts) ?? 0, 2)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<"amounts" | "percent">
        label={s.source}
        value={source}
        onChange={setSource}
        options={[
          { id: "amounts", label: s.sourceAmounts },
          { id: "percent", label: s.sourcePercent },
        ]}
      />
      {source === "amounts" ? (
        <>
          <ToolInput label={s.claimed} value={claimed} onChange={setClaimed} />
          <ToolInput label={s.awarded} value={awarded} onChange={setAwarded} />
        </>
      ) : (
        <ToolInput label={s.successPercentLabel} value={successPercentText} onChange={setSuccessPercentText} />
      )}
      <ToolInput label={s.firstCosts} value={firstCosts} onChange={setFirstCosts} />
      <ToolInput label={s.secondCosts} value={secondCosts} onChange={setSecondCosts} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.successPercent} value={`${proNum(result.successPercent, 4)}%`} />
          <ResultRow label={s.complementPercent} value={`${proNum(result.complementPercent, 4)}%`} />
          <ResultRow label={s.firstShare} value={proNum(result.firstPartyShare, 2)} />
          <ResultRow label={s.secondShare} value={proNum(result.secondPartyShare, 2)} />
          <ResultRow
            label={s.difference}
            value={`${proNum(result.differenceAmount, 2)} — ${sideLabel(result.side)}`}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.source, value: source === "amounts" ? s.sourceAmounts : s.sourcePercent },
              { label: s.firstCosts, value: proNum(proParse(firstCosts) ?? 0, 2) },
              { label: s.secondCosts, value: proNum(proParse(secondCosts) ?? 0, 2) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Udeli i ciljni imenilac
// ---------------------------------------------------------------------------

export function CoOwnershipTool() {
  const s = strings.pro.pravo["suvlasnicki-udeli"];
  const [sharesText, setSharesText] = useState("");
  const [totalArea, setTotalArea] = useState("");
  const [targetDenominator, setTargetDenominator] = useState("");

  const typed = sharesText.trim() !== "";
  const shares: readonly ShareFraction[] = parseFractionLines(sharesText);
  const result = coOwnershipShares({
    shares,
    totalArea: totalArea.trim() === "" ? undefined : (proParse(totalArea) ?? Number.NaN),
    targetDenominator:
      targetDenominator.trim() === "" ? undefined : (proParse(targetDenominator) ?? Number.NaN),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "shares"
        ? s.errorShares
        : result.reason === "totalArea"
          ? s.errorTotalArea
          : s.errorTargetDenominator;

  const copyText = !result.ok
    ? ""
    : [
        `${s.isWhole}: ${result.isWhole ? s.yes : s.no}`,
        `${s.commonDenominator}: ${result.commonDenominator}`,
        `${s.sumNumerator}: ${result.sumNumerator}`,
        // Spelled exactly as the row on screen spells it — a copy that reports
        // only the percentage would drop the fraction the screen leads with.
        `${s.difference}: ${result.differenceNumerator}/${result.differenceDenominator}` +
          ` (${proNum(result.differencePercent, 6)}%)`,
        "",
        `${s.shares}: ${sharesText.trim()}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.shares} hint={s.sharesHint} value={sharesText} onChange={setSharesText} />
      <ToolInput label={s.totalArea} hint={s.totalAreaHint} value={totalArea} onChange={setTotalArea} />
      <ToolInput
        label={s.targetDenominator}
        hint={s.targetDenominatorHint}
        value={targetDenominator}
        onChange={setTargetDenominator}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[
              s.colIndex,
              s.colFraction,
              s.colCommon,
              s.colPercent,
              ...(totalArea.trim() === "" ? [] : [s.colArea]),
              ...(targetDenominator.trim() === "" ? [] : [s.colTarget]),
            ]}
            rows={result.shares.map((share) => [
              String(share.index + 1),
              `${share.numerator}/${share.denominator}`,
              `${share.commonNumerator}/${result.commonDenominator}`,
              `${proNum(share.percent, 6)}%`,
              ...(totalArea.trim() === "" ? [] : [share.area === undefined ? "—" : proNum(share.area, 4)]),
              ...(targetDenominator.trim() === ""
                ? []
                : [
                    share.fitsTarget === true
                      ? `${share.targetNumerator}/${targetDenominator.trim()}`
                      : s.doesNotFit,
                  ]),
            ])}
          />
          <ResultRow label={s.isWhole} value={result.isWhole ? s.yes : s.no} />
          <ResultRow label={s.commonDenominator} value={String(result.commonDenominator)} />
          <ResultRow label={s.sumNumerator} value={String(result.sumNumerator)} />
          {!result.isWhole && (
            <ResultRow
              label={s.difference}
              value={`${result.differenceNumerator}/${result.differenceDenominator} (${proNum(result.differencePercent, 6)}%)`}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.shares, value: sharesText.trim() }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Obračun strana teksta
// ---------------------------------------------------------------------------

export function TextPagesTool() {
  const s = strings.pro.pravo["strane-teksta"];
  const [text, setText] = useState("");
  const [charactersPerPage, setCharactersPerPage] = useState("");
  const [countSpaces, setCountSpaces] = useState<YesNo>("yes");
  const [rounding, setRounding] = useState<PageRounding>("up");
  const [pricePerPage, setPricePerPage] = useState("");

  const typed = text !== "" || proParse(charactersPerPage) !== undefined;
  const result = textPages({
    text,
    charactersPerPage: proParse(charactersPerPage) ?? Number.NaN,
    countSpaces: countSpaces === "yes",
    rounding,
    pricePerPage: pricePerPage.trim() === "" ? undefined : (proParse(pricePerPage) ?? Number.NaN),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "text"
        ? s.errorText
        : result.reason === "charactersPerPage"
          ? s.errorCharactersPerPage
          : s.errorPrice;

  const roundingLabel = (value: PageRounding) =>
    value === "up" ? s.roundingUp : value === "half" ? s.roundingHalf : s.roundingExact;

  const copyText = !result.ok
    ? ""
    : [
        `${s.billedPages}: ${proNum(result.billedPages, 6)}`,
        `${s.exactPages}: ${proNum(result.exactPages, 6)}`,
        result.amount === undefined ? "" : `${s.amount}: ${proNum(result.amount, 2)}`,
        "",
        `${s.charactersPerPage}: ${charactersPerPage.trim()}`,
        `${s.countSpaces}: ${countSpaces === "yes" ? s.yes : s.no}`,
        `${s.rounding}: ${roundingLabel(rounding)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={10} />
      <ToolInput label={s.charactersPerPage} hint={s.charactersPerPageHint} value={charactersPerPage} onChange={setCharactersPerPage} />
      <ToolSelect<YesNo>
        label={s.countSpaces}
        hint={s.countSpacesHint}
        value={countSpaces}
        onChange={setCountSpaces}
        options={yesNoOptions(s.yes, s.no)}
      />
      <ToolSelect<PageRounding>
        label={s.rounding}
        value={rounding}
        onChange={setRounding}
        options={[
          { id: "up", label: s.roundingUp },
          { id: "half", label: s.roundingHalf },
          { id: "exact", label: s.roundingExact },
        ]}
      />
      <ToolInput label={s.pricePerPage} hint={s.priceHint} value={pricePerPage} onChange={setPricePerPage} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.charsBefore} value={String(result.charactersBeforeNormalization)} />
          <ResultRow label={s.charsWith} value={String(result.charactersWithSpaces)} />
          <ResultRow label={s.charsWithout} value={String(result.charactersWithoutSpaces)} />
          <ResultRow label={s.words} value={String(result.words)} />
          <ResultRow label={s.lines} value={String(result.lines)} />
          <ResultRow label={s.exactPages} value={proNum(result.exactPages, 6)} />
          <ResultRow label={s.pagesUp} value={String(result.pagesRoundedUp)} />
          <ResultRow label={s.pagesHalf} value={proNum(result.pagesToHalf, 1)} />
          <ResultRow label={s.billedPages} value={proNum(result.billedPages, 6)} />
          {result.amount !== undefined && <ResultRow label={s.amount} value={proNum(result.amount, 2)} />}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.charactersPerPage, value: charactersPerPage.trim() },
              { label: s.countSpaces, value: countSpaces === "yes" ? s.yes : s.no },
              { label: s.rounding, value: roundingLabel(rounding) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Rok i poslednji dan
// ---------------------------------------------------------------------------

export function DeadlineTool() {
  const s = strings.pro.pravo["rok-poslednji-dan"];
  const [smer, setSmer] = useState<"unapred" | "unazad">("unapred");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [length, setLength] = useState("");
  const [unit, setUnit] = useState<DeadlineUnit>("days");
  const [countStartDay, setCountStartDay] = useState<YesNo>("yes");
  const [weekdaysText, setWeekdaysText] = useState("");
  const [datesText, setDatesText] = useState("");
  const [shift, setShift] = useState<DeadlineShift>("none");
  const weekdays = [s.weekday1, s.weekday2, s.weekday3, s.weekday4, s.weekday5, s.weekday6, s.weekday7];

  const typed =
    (smer === "unapred" ? startDate.trim() !== "" : endDate.trim() !== "") || length.trim() !== "";
  const nonWorkingWeekdays = parseWeekdaySet(weekdaysText);
  const nonWorkingDates = parseDateLines(datesText);

  const forward =
    smer === "unapred"
      ? deadlineForward({
          startDate: parseDate(startDate),
          length: proParse(length) ?? Number.NaN,
          unit,
          countStartDay: countStartDay === "yes",
          nonWorkingWeekdays,
          nonWorkingDates,
          shift,
        })
      : undefined;
  const backward =
    smer === "unazad"
      ? deadlineBackward({
          endDate: parseDate(endDate),
          length: proParse(length) ?? Number.NaN,
          unit,
          countStartDay: countStartDay === "yes",
          nonWorkingWeekdays,
          nonWorkingDates,
          shift,
        })
      : undefined;

  const active = forward ?? backward;
  const failure =
    active === undefined || active.ok || !typed
      ? undefined
      : active.reason === "startDate" || active.reason === "endDate"
        ? s.errorDate
        : active.reason === "length"
          ? s.errorLength
          : active.reason === "nonWorkingWeekdays"
            ? s.errorWeekdays
            : s.errorDates;

  const unitLabel = (value: DeadlineUnit) =>
    value === "days" ? s.unitDays : value === "months" ? s.unitMonths : s.unitYears;
  const shiftLabel = (value: DeadlineShift) =>
    value === "none" ? s.shiftNone : value === "forward" ? s.shiftForward : s.shiftBackward;

  const copyText =
    forward?.ok === true
      ? [
          `${s.lastDay}: ${fmtDate(forward.lastDay)} (${weekdays[forward.weekday - 1] ?? ""})`,
          `${s.rawLastDay}: ${fmtDate(forward.rawLastDay)}`,
          `${s.shiftedByDays}: ${forward.shiftedByDays}`,
          `${s.totalDays}: ${forward.totalDays}`,
          "",
          `${s.startDate}: ${startDate.trim()}`,
          `${s.length}: ${length.trim()}`,
          `${s.unit}: ${unitLabel(unit)}`,
          `${s.shift}: ${shiftLabel(shift)}`,
        ].join("\n")
      : backward?.ok === true
        ? backward.candidates
            .map(
              (candidate) =>
                `${s.candidateStart}: ${fmtDate(candidate.startDate)} → ${s.lastDay}: ${fmtDate(candidate.lastDay)}`,
            )
            .join("\n")
        : "";

  return (
    <>
      <ToolSelect<"unapred" | "unazad">
        label={s.direction}
        value={smer}
        onChange={setSmer}
        options={[
          { id: "unapred", label: s.directionForward },
          { id: "unazad", label: s.directionBackward },
        ]}
      />
      {smer === "unapred" ? (
        <ToolInput label={s.startDate} hint={s.dateHint} value={startDate} onChange={setStartDate} />
      ) : (
        <ToolInput label={s.endDate} hint={s.dateHint} value={endDate} onChange={setEndDate} />
      )}
      <ToolInput label={s.length} value={length} onChange={setLength} />
      <ToolSelect<DeadlineUnit>
        label={s.unit}
        value={unit}
        onChange={setUnit}
        options={[
          { id: "days", label: s.unitDays },
          { id: "months", label: s.unitMonths },
          { id: "years", label: s.unitYears },
        ]}
      />
      <ToolSelect<YesNo>
        label={s.countStartDay}
        hint={s.countStartDayHint}
        value={countStartDay}
        onChange={setCountStartDay}
        options={yesNoOptions(s.yes, s.no)}
      />
      <ToolInput label={s.weekdays} hint={s.weekdaysHint} value={weekdaysText} onChange={setWeekdaysText} />
      <ToolTextArea label={s.dates} hint={s.datesHint} value={datesText} onChange={setDatesText} />
      <ToolSelect<DeadlineShift>
        label={s.shift}
        value={shift}
        onChange={setShift}
        options={[
          { id: "none", label: s.shiftNone },
          { id: "forward", label: s.shiftForward },
          { id: "backward", label: s.shiftBackward },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {forward?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.rawLastDay}
            value={`${fmtDate(forward.rawLastDay)} (${weekdays[forward.rawWeekday - 1] ?? ""})`}
          />
          <ResultRow
            label={s.lastDay}
            value={`${fmtDate(forward.lastDay)} (${weekdays[forward.weekday - 1] ?? ""})`}
          />
          <ResultRow label={s.shiftedByDays} value={String(forward.shiftedByDays)} />
          <ResultRow label={s.totalDays} value={String(forward.totalDays)} />
          <ResultRow label={s.totalDaysBeforeShift} value={String(forward.totalDaysBeforeShift)} />
          {forward.expiredBeforeStart && <p className="nx-hint nx-hint--prose">{s.expiredNote}</p>}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.startDate, value: startDate.trim() },
              { label: s.length, value: length.trim() },
              { label: s.unit, value: unitLabel(unit) },
              { label: s.countStartDay, value: countStartDay === "yes" ? s.yes : s.no },
              { label: s.shift, value: shiftLabel(shift) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      {backward?.ok === true && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colStart, s.colRawLast, s.colLast]}
            rows={backward.candidates.map((candidate) => [
              fmtDate(candidate.startDate),
              fmtDate(candidate.rawLastDay),
              fmtDate(candidate.lastDay),
            ])}
          />
          {backward.candidates.length === 0 && <p className="nx-hint nx-hint--prose">{s.noCandidates}</p>}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.endDate, value: endDate.trim() },
              { label: s.length, value: length.trim() },
              { label: s.unit, value: unitLabel(unit) },
              { label: s.countStartDay, value: countStartDay === "yes" ? s.yes : s.no },
              { label: s.shift, value: shiftLabel(shift) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Radni dani
// ---------------------------------------------------------------------------

export function WorkingDaysTool() {
  const s = strings.pro.pravo["radni-dani"];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeLastDay, setIncludeLastDay] = useState<YesNo>("yes");
  const [weekdaysText, setWeekdaysText] = useState("");
  const [datesText, setDatesText] = useState("");

  const typed = from.trim() !== "" || to.trim() !== "";
  const nonWorkingDates = parseDateLines(datesText);
  const result = workingDays({
    from: parseDate(from),
    to: parseDate(to),
    includeLastDay: includeLastDay === "yes",
    nonWorkingWeekdays: parseWeekdaySet(weekdaysText),
    nonWorkingDates,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "from"
        ? s.errorFrom
        : result.reason === "to"
          ? s.errorTo
          : result.reason === "nonWorkingWeekdays"
            ? s.errorWeekdays
            : s.errorDates;

  const copyText = !result.ok
    ? ""
    : [
        `${s.calendarDays}: ${result.calendarDays}`,
        `${s.workingDays}: ${result.workingDays}`,
        `${s.weekdayNonWorking}: ${result.weekdayNonWorkingDays}`,
        `${s.listedNonWorking}: ${result.listedNonWorkingDays}`,
        "",
        `${s.from}: ${from.trim()}`,
        `${s.to}: ${to.trim()}`,
        `${s.includeLastDay}: ${includeLastDay === "yes" ? s.yes : s.no}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.from} hint={s.dateHint} value={from} onChange={setFrom} />
      <ToolInput label={s.to} hint={s.dateHint} value={to} onChange={setTo} />
      <ToolSelect<YesNo>
        label={s.includeLastDay}
        value={includeLastDay}
        onChange={setIncludeLastDay}
        options={yesNoOptions(s.yes, s.no)}
      />
      <ToolInput label={s.weekdays} hint={s.weekdaysHint} value={weekdaysText} onChange={setWeekdaysText} />
      <ToolTextArea label={s.dates} hint={s.datesHint} value={datesText} onChange={setDatesText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.calendarDays} value={String(result.calendarDays)} />
          <ResultRow label={s.workingDays} value={String(result.workingDays)} />
          <ResultRow label={s.weekdayNonWorking} value={String(result.weekdayNonWorkingDays)} />
          <ResultRow label={s.listedNonWorking} value={String(result.listedNonWorkingDays)} />
          <ResultRow label={s.listedInRange} value={String(result.listedDatesInRange)} />
          <ResultRow label={s.fullWeeks} value={String(result.fullWeeks)} />
          <ResultRow label={s.remainderDays} value={String(result.remainderDays)} />
          {result.reversed && <p className="nx-hint nx-hint--prose">{s.reversedNote}</p>}
          <ResultRow label={s.effectiveLastDate} value={fmtDate(result.effectiveLastDate)} />
          {result.firstWorkingDay !== undefined && (
            <ResultRow label={s.firstWorkingDay} value={fmtDate(result.firstWorkingDay)} />
          )}
          {result.lastWorkingDay !== undefined && (
            <ResultRow label={s.lastWorkingDay} value={fmtDate(result.lastWorkingDay)} />
          )}
          {result.datesOutOfRange.length > 0 && (
            <ResultRow
              label={s.datesOutOfRange}
              value={result.datesOutOfRange.map(fmtDate).join(", ")}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.from, value: from.trim() },
              { label: s.to, value: to.trim() },
              { label: s.includeLastDay, value: includeLastDay === "yes" ? s.yes : s.no },
              { label: s.weekdays, value: weekdaysText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Račun, IBAN i modul 97 — ISO 7064 MOD 97-10
// ---------------------------------------------------------------------------

export function AccountCheckTool() {
  const s = strings.pro.pravo["racun-iban-provera"];
  const [rezim, setRezim] = useState<"domaci" | "iban" | "mod97">("domaci");
  const [radnja, setRadnja] = useState<"check" | "compute">("check");
  const [racun, setRacun] = useState("");
  const [ibanText, setIbanText] = useState("");
  const [bban, setBban] = useState("");
  const [drzava, setDrzava] = useState("");
  const [brojZaKontrolu, setBrojZaKontrolu] = useState("");

  const typed =
    racun.trim() !== "" || ibanText.trim() !== "" || bban.trim() !== "" || brojZaKontrolu.trim() !== "";

  const domaci = rezim === "domaci" ? domesticAccount({ account: racun, mode: radnja }) : undefined;
  const iban =
    rezim === "iban"
      ? ibanRecord({
          mode: radnja,
          iban: radnja === "check" ? ibanText : undefined,
          bban: radnja === "compute" ? bban : undefined,
          country: radnja === "compute" ? drzava : undefined,
        })
      : undefined;
  const mod97Result = rezim === "mod97" ? mod97CheckDigits({ digits: brojZaKontrolu, mode: radnja }) : undefined;

  const active = domaci ?? iban ?? mod97Result;
  const failure =
    active === undefined || active.ok || !typed
      ? undefined
      : rezim === "domaci"
        ? s.errorAccount
        : rezim === "iban"
          ? radnja === "check"
            ? s.errorIban
            : s.errorBban
          : s.errorDigits;

  const copyText =
    active === undefined || !active.ok
      ? ""
      : [
          `${s.checkDigits}: ${active.checkDigits}`,
          `${s.remainder}: ${active.remainder}`,
          `${s.matches}: ${active.matches === undefined ? s.notApplicable : active.matches ? s.yes : s.no}`,
          "",
          `${s.regime}: ${rezim === "domaci" ? s.regimeDomaci : rezim === "iban" ? s.regimeIban : s.regimeMod97}`,
          `${s.mode}: ${radnja === "check" ? s.modeCheck : s.modeCompute}`,
        ].join("\n");

  return (
    <>
      <ToolSelect<"domaci" | "iban" | "mod97">
        label={s.regime}
        value={rezim}
        onChange={setRezim}
        options={[
          { id: "domaci", label: s.regimeDomaci },
          { id: "iban", label: s.regimeIban },
          { id: "mod97", label: s.regimeMod97 },
        ]}
      />
      <ToolSelect<"check" | "compute">
        label={s.mode}
        value={radnja}
        onChange={setRadnja}
        options={[
          { id: "check", label: s.modeCheck },
          { id: "compute", label: s.modeCompute },
        ]}
      />
      {rezim === "domaci" && (
        <ToolInput label={s.account} hint={s.accountHint} value={racun} onChange={setRacun} mono />
      )}
      {rezim === "iban" && radnja === "check" && (
        <ToolInput label={s.iban} hint={s.ibanHint} value={ibanText} onChange={setIbanText} mono />
      )}
      {rezim === "iban" && radnja === "compute" && (
        <>
          <ToolInput label={s.bban} value={bban} onChange={setBban} mono />
          <ToolInput label={s.country} hint={s.countryHint} value={drzava} onChange={setDrzava} mono />
        </>
      )}
      {rezim === "mod97" && (
        <ToolInput label={s.digits} value={brojZaKontrolu} onChange={setBrojZaKontrolu} mono />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {active !== undefined && active.ok && (
        <ToolSection title={s.results}>
          {domaci?.ok === true && (
            <>
              <ResultRow label={s.grouped} value={domaci.grouped} mono />
              <ResultRow label={s.bank} value={domaci.bank} mono />
              <ResultRow label={s.accountNumber} value={domaci.account} mono />
            </>
          )}
          {iban?.ok === true && (
            <>
              <ResultRow label={s.grouped} value={iban.grouped} mono />
              <ResultRow label={s.country} value={iban.country} mono />
            </>
          )}
          {mod97Result?.ok === true && <ResultRow label={s.digitsFull} value={mod97Result.digits} mono />}
          <ResultRow label={s.checkDigits} value={active.checkDigits} mono />
          <ResultRow label={s.remainder} value={String(active.remainder)} />
          {active.matches !== undefined && (
            <ResultRow label={s.matches} value={active.matches ? s.yes : s.no} />
          )}
          <p className="nx-hint nx-hint--prose">{s.matchesNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.regime,
                value: rezim === "domaci" ? s.regimeDomaci : rezim === "iban" ? s.regimeIban : s.regimeMod97,
              },
              { label: s.mode, value: radnja === "check" ? s.modeCheck : s.modeCompute },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Podela iznosa
// ---------------------------------------------------------------------------

const SMALLEST_UNIT_OPTIONS: Record<"0.01" | "1" | "100", SplitUnit> = {
  "0.01": 0.01,
  "1": 1,
  "100": 100,
};

export function SplitAmountTool() {
  const s = strings.pro.pravo["podela-iznosa"];
  const [totalAmount, setTotalAmount] = useState("");
  const [weightsText, setWeightsText] = useState("");
  const [smallestUnit, setSmallestUnit] = useState<"0.01" | "1" | "100">("0.01");
  const [remainderRule, setRemainderRule] = useState<"largestRemainder" | "firstFirst">(
    "largestRemainder",
  );

  const typed = proParse(totalAmount) !== undefined || weightsText.trim() !== "";
  const weights = parseWeightLines(weightsText);
  const result = splitAmount({
    totalAmount: proParse(totalAmount) ?? Number.NaN,
    weights,
    smallestUnit: SMALLEST_UNIT_OPTIONS[smallestUnit],
    remainderRule,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "totalAmount"
        ? s.errorTotalAmount
        : result.reason === "weights"
          ? s.errorWeights
          : s.errorSmallestUnit;

  const copyText = !result.ok
    ? ""
    : [
        ...result.shares.map((share) => `${s.share} ${share.index + 1}: ${proNum(share.amount, 2)}`),
        `${s.checksum}: ${proNum(result.checksum, 2)}`,
        "",
        `${s.totalAmount}: ${proNum(proParse(totalAmount) ?? 0, 2)}`,
        `${s.smallestUnit}: ${smallestUnit}`,
        `${s.remainderRule}: ${remainderRule === "largestRemainder" ? s.ruleLargestRemainder : s.ruleFirstFirst}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.totalAmount} value={totalAmount} onChange={setTotalAmount} />
      <ToolTextArea label={s.weights} hint={s.weightsHint} value={weightsText} onChange={setWeightsText} />
      <ToolSelect<"0.01" | "1" | "100">
        label={s.smallestUnit}
        value={smallestUnit}
        onChange={setSmallestUnit}
        options={[
          { id: "0.01", label: s.unit001 },
          { id: "1", label: s.unit1 },
          { id: "100", label: s.unit100 },
        ]}
      />
      <ToolSelect<"largestRemainder" | "firstFirst">
        label={s.remainderRule}
        value={remainderRule}
        onChange={setRemainderRule}
        options={[
          { id: "largestRemainder", label: s.ruleLargestRemainder },
          { id: "firstFirst", label: s.ruleFirstFirst },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colIndex, s.colUnits, s.colAmount, s.colExact, s.colRemainder, s.colDeviation]}
            rows={result.shares.map((share) => [
              String(share.index + 1),
              String(share.units),
              proNum(share.amount, 2),
              proNum(share.exactAmount, 6),
              share.gotRemainderUnit ? s.yes : s.no,
              proNum(share.deviation, 6),
            ])}
          />
          <ResultRow label={s.checksum} value={proNum(result.checksum, 2)} />
          <ResultRow label={s.total} value={proNum(result.total, 2)} />
          <ResultRow label={s.totalAmountEntered} value={proNum(result.totalAmountEntered, 2)} />
          <ResultRow label={s.roundingDifference} value={proNum(result.roundingDifference, 2)} />
          <ResultRow label={s.remainderUnits} value={String(result.remainderUnits)} />
          <ResultRow
            label={s.ruleApplied}
            value={result.rule === "largestRemainder" ? s.ruleLargestRemainder : s.ruleFirstFirst}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.totalAmount, value: proNum(proParse(totalAmount) ?? 0, 2) },
              { label: s.smallestUnit, value: smallestUnit },
              {
                label: s.remainderRule,
                value: remainderRule === "largestRemainder" ? s.ruleLargestRemainder : s.ruleFirstFirst,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Obračun kamate
// ---------------------------------------------------------------------------

const DAY_BASIS_OPTIONS = ["365", "366", "actual"] as const;
type DayBasisOption = (typeof DAY_BASIS_OPTIONS)[number];
function dayBasisOf(option: DayBasisOption): DayBasis {
  return option === "actual" ? "actual" : option === "365" ? 365 : 366;
}

function dayBasisLabel(
  option: DayBasisOption,
  s: (typeof strings.pro.pravo)["obracun-kamate"],
): string {
  return option === "actual" ? s.dayBasisActual : option === "365" ? s.dayBasis365 : s.dayBasis366;
}

/** The select's options, so the three bases are listed once rather than beside every use. */
const dayBasisOptions = (s: (typeof strings.pro.pravo)["obracun-kamate"]) =>
  DAY_BASIS_OPTIONS.map((id) => ({ id, label: dayBasisLabel(id, s) }));

export function InterestAccrualTool() {
  const s = strings.pro.pravo["obracun-kamate"];
  const [principal, setPrincipal] = useState("");
  const [ratesText, setRatesText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [method, setMethod] = useState<InterestMethod>("conformal");
  const [dayBasis, setDayBasis] = useState<DayBasisOption>("365");
  const [capitalisation, setCapitalisation] = useState<"none" | "annual">("none");
  const [capBoundary, setCapBoundary] = useState<"calendarYear" | "anniversaryOfStart">("calendarYear");
  const [includeLastDay, setIncludeLastDay] = useState<YesNo>("no");

  const typed = proParse(principal) !== undefined || from.trim() !== "" || ratesText.trim() !== "";
  const rates = parseRateLines(ratesText);
  const result = interestAccrual({
    principal: proParse(principal) ?? Number.NaN,
    rates,
    from: parseDate(from),
    to: parseDate(to),
    method,
    dayBasis: dayBasisOf(dayBasis),
    capitalisation,
    capitalisationBoundary: capitalisation === "annual" ? capBoundary : undefined,
    includeLastDay: includeLastDay === "yes",
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "principal"
        ? s.errorPrincipal
        : result.reason === "from"
          ? s.errorFrom
          : result.reason === "to"
            ? s.errorTo
            : result.reason === "rates" || result.reason === "rate"
              ? s.errorRates
              : result.reason === "dayBasis"
                ? s.errorDayBasis
                : s.errorCapBoundary;

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalInterest}: ${proNum(result.totalInterest, 2)}`,
        `${s.principalPlusInterest}: ${proNum(result.principalPlusInterest, 2)}`,
        `${s.totalDays}: ${result.totalDays}`,
        `${s.ignoredRows}: ${result.ignoredRows}`,
        "",
        `${s.principal}: ${proNum(proParse(principal) ?? 0, 2)}`,
        `${s.from}: ${from.trim()}`,
        `${s.to}: ${to.trim()}`,
        `${s.method}: ${method === "conformal" ? s.methodConformal : s.methodProportional}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.principal} value={principal} onChange={setPrincipal} />
      <ToolTextArea
        label={s.rates}
        hint={s.ratesHint}
        value={ratesText}
        onChange={setRatesText}
      />
      <ToolInput label={s.from} hint={s.dateHint} value={from} onChange={setFrom} />
      <ToolInput label={s.to} hint={s.dateHint} value={to} onChange={setTo} />
      <ToolSelect<InterestMethod>
        label={s.method}
        value={method}
        onChange={setMethod}
        options={[
          { id: "conformal", label: s.methodConformal },
          { id: "proportional", label: s.methodProportional },
        ]}
      />
      <ToolSelect<DayBasisOption>
        label={s.dayBasis}
        value={dayBasis}
        onChange={setDayBasis}
        options={dayBasisOptions(s)}
      />
      <ToolSelect<"none" | "annual">
        label={s.capitalisation}
        value={capitalisation}
        onChange={setCapitalisation}
        options={[
          { id: "none", label: s.capitalisationNone },
          { id: "annual", label: s.capitalisationAnnual },
        ]}
      />
      {capitalisation === "annual" && (
        <ToolSelect<"calendarYear" | "anniversaryOfStart">
          label={s.capBoundary}
          value={capBoundary}
          onChange={setCapBoundary}
          options={[
            { id: "calendarYear", label: s.capBoundaryCalendar },
            { id: "anniversaryOfStart", label: s.capBoundaryAnniversary },
          ]}
        />
      )}
      <ToolSelect<YesNo>
        label={s.includeLastDay}
        value={includeLastDay}
        onChange={setIncludeLastDay}
        options={yesNoOptions(s.yes, s.no)}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.totalInterest} value={proNum(result.totalInterest, 2)} />
          <ResultRow label={s.principalPlusInterest} value={proNum(result.principalPlusInterest, 2)} />
          <ResultRow label={s.totalDays} value={String(result.totalDays)} />
          <ResultRow label={s.ignoredRows} value={String(result.ignoredRows)} />

          <ToolTable
            head={[s.colFrom, s.colTo, s.colDays, s.colRate, s.colBasis, s.colBalance, s.colInterest]}
            rows={result.segments.map((row) => [
              fmtDate(row.from),
              fmtDate(row.to),
              String(row.days),
              `${proNum(row.annualRatePercent, 4)}%`,
              String(row.basisDays),
              proNum(row.balance, 2),
              proNum(row.interest, 6),
            ])}
          />

          <ToolSection title={s.yearlyTitle}>
            <ToolTable
              head={[s.colYear, s.colDays, s.colInterest]}
              rows={result.yearlyBreakdown.map((row) => [
                String(row.year),
                String(row.days),
                proNum(row.interest, 6),
              ])}
            />
          </ToolSection>

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.principal, value: proNum(proParse(principal) ?? 0, 2) },
              { label: s.from, value: from.trim() },
              { label: s.to, value: to.trim() },
              { label: s.method, value: method === "conformal" ? s.methodConformal : s.methodProportional },
              {
                label: s.dayBasis,
                value: dayBasisLabel(dayBasis, s),
              },
              {
                label: s.capitalisation,
                value: capitalisation === "none" ? s.capitalisationNone : s.capitalisationAnnual,
              },
              { label: s.includeLastDay, value: includeLastDay === "yes" ? s.yes : s.no },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Nominalna i efektivna stopa
// ---------------------------------------------------------------------------

export function RateConversionTool() {
  const s = strings.pro.pravo["nominalna-efektivna-stopa"];
  const [direction, setDirection] = useState<RateDirection>("nominalToEffective");
  const [ratePercent, setRatePercent] = useState("");
  const [compoundings, setCompoundings] = useState("");
  const [targetCompoundings, setTargetCompoundings] = useState("");

  const typed = proParse(ratePercent) !== undefined || proParse(compoundings) !== undefined;
  const result = rateConversion({
    direction,
    ratePercent: proParse(ratePercent) ?? Number.NaN,
    compoundingsPerYear: proParse(compoundings) ?? Number.NaN,
    targetCompoundingsPerYear:
      direction === "nominalAtM1ToNominalAtM2" ? (proParse(targetCompoundings) ?? Number.NaN) : undefined,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "ratePercent"
        ? s.errorRate
        : result.reason === "compoundingsPerYear"
          ? s.errorCompoundings
          : s.errorTargetCompoundings;

  const directionLabel = (value: RateDirection) =>
    value === "nominalToEffective"
      ? s.directionNominalToEffective
      : value === "effectiveToNominal"
        ? s.directionEffectiveToNominal
        : value === "effectiveToPeriodic"
          ? s.directionEffectiveToPeriodic
          : s.directionNominalToNominal;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resultPercent}: ${proNum(result.resultPercent, 6)}%`,
        `${s.periodicPercent}: ${proNum(result.periodicPercent, 6)}%`,
        `${s.effectivePercent}: ${proNum(result.effectivePercent, 6)}%`,
        `${s.growthFactor}: ${proNum(result.growthFactor, 10)}`,
        `${s.continuousPercent}: ${proNum(result.continuousPercent, 6)}%`,
        "",
        `${s.direction}: ${directionLabel(direction)}`,
        `${s.ratePercent}: ${proNum(proParse(ratePercent) ?? 0, 4)}%`,
        `${s.compoundings}: ${compoundings.trim()}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<RateDirection>
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "nominalToEffective", label: s.directionNominalToEffective },
          { id: "effectiveToNominal", label: s.directionEffectiveToNominal },
          { id: "effectiveToPeriodic", label: s.directionEffectiveToPeriodic },
          { id: "nominalAtM1ToNominalAtM2", label: s.directionNominalToNominal },
        ]}
      />
      <ToolInput label={s.ratePercent} hint={s.rateHint} value={ratePercent} onChange={setRatePercent} />
      <ToolInput label={s.compoundings} value={compoundings} onChange={setCompoundings} />
      {direction === "nominalAtM1ToNominalAtM2" && (
        <ToolInput
          label={s.targetCompoundings}
          value={targetCompoundings}
          onChange={setTargetCompoundings}
        />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resultPercent} value={`${proNum(result.resultPercent, 6)}%`} />
          <ResultRow
            label={
              result.periodicKind === "proportional" ? s.periodicProportional : s.periodicConformal
            }
            value={`${proNum(result.periodicPercent, 6)}%`}
          />
          <ResultRow label={s.effectivePercent} value={`${proNum(result.effectivePercent, 6)}%`} />
          <ResultRow label={s.growthFactor} value={proNum(result.growthFactor, 10)} />
          <ResultRow label={s.continuousPercent} value={`${proNum(result.continuousPercent, 6)}%`} />
          <p className="nx-hint nx-hint--prose">{s.continuousNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.direction, value: directionLabel(direction) },
              { label: s.ratePercent, value: `${proNum(proParse(ratePercent) ?? 0, 4)}%` },
              { label: s.compoundings, value: compoundings.trim() },
              ...(direction === "nominalAtM1ToNominalAtM2"
                ? [{ label: s.targetCompoundings, value: targetCompoundings.trim() }]
                : []),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Kazna i uračunavanje
// ---------------------------------------------------------------------------

export function SentenceTermTool() {
  const s = strings.pro.pravo["kazna-i-pritvor"];
  const [startDate, setStartDate] = useState("");
  const [years, setYears] = useState("");
  const [months, setMonths] = useState("");
  const [days, setDays] = useState("");
  const [creditedDays, setCreditedDays] = useState("");
  const [creditRatio, setCreditRatio] = useState("");
  const [countFirstDay, setCountFirstDay] = useState<YesNo>("yes");
  const [fracNum, setFracNum] = useState("");
  const [fracDen, setFracDen] = useState("");
  const weekdays = [s.weekday1, s.weekday2, s.weekday3, s.weekday4, s.weekday5, s.weekday6, s.weekday7];

  const typed = startDate.trim() !== "" || proParse(years) !== undefined || proParse(days) !== undefined;
  const fractionTyped = fracNum.trim() !== "" || fracDen.trim() !== "";
  const fraction: TermFraction | undefined = fractionTyped
    ? { numerator: proParse(fracNum) ?? Number.NaN, denominator: proParse(fracDen) ?? Number.NaN }
    : undefined;

  const term = sentenceTerm({
    startDate: parseDate(startDate),
    years: proParse(years) ?? Number.NaN,
    months: proParse(months) ?? Number.NaN,
    days: proParse(days) ?? Number.NaN,
    creditedDays: proParse(creditedDays) ?? Number.NaN,
    creditRatio: proParse(creditRatio) ?? Number.NaN,
    countFirstDay: countFirstDay === "yes",
    fraction,
  });

  const failure =
    term.ok || !typed
      ? undefined
      : term.reason === "startDate"
        ? s.errorStartDate
        : term.reason === "years"
          ? s.errorYears
          : term.reason === "months"
            ? s.errorMonths
            : term.reason === "days"
              ? s.errorDays
              : term.reason === "creditedDays"
                ? s.errorCreditedDays
                : term.reason === "creditRatio"
                  ? s.errorCreditRatio
                  : s.errorFraction;

  const copyText = !term.ok
    ? ""
    : [
        `${s.lastDay}: ${fmtDate(term.lastDay)}`,
        `${s.totalDays}: ${term.totalDays}`,
        `${s.creditedDaysApplied}: ${term.creditedDaysApplied}`,
        term.coversWholeTerm
          ? s.coversWholeTerm
          : `${s.dateAfterCredit}: ${term.dateAfterCredit === undefined ? "" : fmtDate(term.dateAfterCredit)}`,
        "",
        `${s.startDate}: ${startDate.trim()}`,
        `${s.years}: ${years.trim()}`,
        `${s.months}: ${months.trim()}`,
        `${s.days}: ${days.trim()}`,
        `${s.creditedDays}: ${creditedDays.trim()}`,
        `${s.creditRatio}: ${creditRatio.trim()}`,
        `${s.countFirstDay}: ${countFirstDay === "yes" ? s.yes : s.no}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.startDate} hint={s.dateHint} value={startDate} onChange={setStartDate} />
      <ToolInput label={s.years} value={years} onChange={setYears} />
      <ToolInput label={s.months} value={months} onChange={setMonths} />
      <ToolInput label={s.days} value={days} onChange={setDays} />
      <ToolInput label={s.creditedDays} hint={s.creditedDaysHint} value={creditedDays} onChange={setCreditedDays} />
      <ToolInput label={s.creditRatio} hint={s.creditRatioHint} value={creditRatio} onChange={setCreditRatio} />
      <ToolSelect<YesNo>
        label={s.countFirstDay}
        hint={s.countFirstDayHint}
        value={countFirstDay}
        onChange={setCountFirstDay}
        options={yesNoOptions(s.yes, s.no)}
      />
      <ToolInput label={s.fracNum} hint={s.fractionHint} value={fracNum} onChange={setFracNum} />
      <ToolInput label={s.fracDen} value={fracDen} onChange={setFracDen} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {term.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.endDate} value={fmtDate(term.endDate)} />
          <ResultRow label={s.lastDay} value={`${fmtDate(term.lastDay)} (${weekdays[term.lastDayWeekday - 1] ?? ""})`} />
          <ResultRow label={s.totalDays} value={String(term.totalDays)} />
          <ResultRow label={s.exactCredit} value={proNum(term.exactCredit, 4)} />
          <ResultRow label={s.creditedDaysApplied} value={String(term.creditedDaysApplied)} />
          {term.coversWholeTerm ? (
            <p className="nx-hint nx-hint--prose">{s.coversWholeTerm}</p>
          ) : (
            <>
              {term.dateAfterCredit !== undefined && term.dateAfterCreditWeekday !== undefined && (
                <ResultRow
                  label={s.dateAfterCredit}
                  value={`${fmtDate(term.dateAfterCredit)} (${weekdays[term.dateAfterCreditWeekday - 1] ?? ""})`}
                />
              )}
              {term.fractionDays !== undefined && (
                <ToolSection title={s.fractionTitle}>
                  <ResultRow label={s.fractionDays} value={String(term.fractionDays)} />
                  {term.fractionDate !== undefined && term.fractionWeekday !== undefined && (
                    <ResultRow
                      label={s.fractionDate}
                      value={`${fmtDate(term.fractionDate)} (${weekdays[term.fractionWeekday - 1] ?? ""})`}
                    />
                  )}
                  {term.remainingDays !== undefined && (
                    <ResultRow label={s.remainingDays} value={String(term.remainingDays)} />
                  )}
                </ToolSection>
              )}
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.startDate, value: startDate.trim() },
              { label: s.years, value: years.trim() },
              { label: s.months, value: months.trim() },
              { label: s.days, value: days.trim() },
              { label: s.creditedDays, value: creditedDays.trim() },
              { label: s.creditRatio, value: creditRatio.trim() },
              { label: s.countFirstDay, value: countFirstDay === "yes" ? s.yes : s.no },
              {
                label: s.fraction,
                value: fraction === undefined ? s.noFraction : `${fracNum.trim()}/${fracDen.trim()}`,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Iznos slovima
// ---------------------------------------------------------------------------

function nounFormsFields(
  s: {
    readonly one: string;
    readonly few: string;
    readonly many: string;
    readonly gender: string;
    readonly genderM: string;
    readonly genderF: string;
  },
  one: string,
  setOne: (value: string) => void,
  few: string,
  setFew: (value: string) => void,
  many: string,
  setMany: (value: string) => void,
  gender: NounGender,
  setGender: (value: NounGender) => void,
) {
  return (
    <>
      <ToolInput label={s.one} value={one} onChange={setOne} />
      <ToolInput label={s.few} value={few} onChange={setFew} />
      <ToolInput label={s.many} value={many} onChange={setMany} />
      <ToolSelect<NounGender>
        label={s.gender}
        value={gender}
        onChange={setGender}
        options={[
          { id: "m", label: s.genderM },
          { id: "f", label: s.genderF },
        ]}
      />
    </>
  );
}

export function AmountInWordsTool() {
  const s = strings.pro.pravo["iznos-slovima"];
  const [amountText, setAmountText] = useState("");
  const [currency, setCurrency] = useState<"dinar" | "custom">("dinar");
  const [mainOne, setMainOne] = useState("");
  const [mainFew, setMainFew] = useState("");
  const [mainMany, setMainMany] = useState("");
  const [mainGender, setMainGender] = useState<NounGender>("m");
  const [subOne, setSubOne] = useState("");
  const [subFew, setSubFew] = useState("");
  const [subMany, setSubMany] = useState("");
  const [subGender, setSubGender] = useState<NounGender>("m");
  const [subUnitsPerUnit, setSubUnitsPerUnit] = useState("");
  const [style, setStyle] = useState<"spaced" | "joined">("spaced");
  const [capitalise, setCapitalise] = useState<YesNo>("no");

  const typed = amountText.trim() !== "";
  const mainUnit: NounForms | undefined =
    currency === "dinar"
      ? undefined
      : { one: mainOne, few: mainFew, many: mainMany, gender: mainGender };
  const subUnit: NounForms | undefined =
    currency === "dinar"
      ? undefined
      : { one: subOne, few: subFew, many: subMany, gender: subGender };
  const result = amountInWords({
    amountText: amountText.trim(),
    currency,
    mainUnit,
    subUnit,
    subUnitsPerUnit: currency === "custom" ? proParse(subUnitsPerUnit) : undefined,
    style,
    capitalise: capitalise === "yes",
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "amountText"
        ? s.errorAmount
        : result.reason === "mainUnit"
          ? s.errorMainUnit
          : result.reason === "subUnitsPerUnit"
            ? s.errorSubUnitsPerUnit
            : s.errorSubUnit;

  const copyText = !result.ok
    ? ""
    : [
        `${s.words}: ${result.words}`,
        `${s.typedAmount}: ${result.typedAmount}`,
        `${s.convertedAmount}: ${result.convertedAmount}`,
        `${s.rounded}: ${result.rounded ? s.yes : s.no}`,
        "",
        `${s.amount}: ${amountText.trim()}`,
        `${s.currency}: ${currency === "dinar" ? s.currencyDinar : s.currencyCustom}`,
        `${s.style}: ${style === "spaced" ? s.styleSpaced : s.styleJoined}`,
        `${s.capitalise}: ${capitalise === "yes" ? s.yes : s.no}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.amount} hint={s.amountHint} value={amountText} onChange={setAmountText} />
      <ToolSelect<"dinar" | "custom">
        label={s.currency}
        value={currency}
        onChange={setCurrency}
        options={[
          { id: "dinar", label: s.currencyDinar },
          { id: "custom", label: s.currencyCustom },
        ]}
      />
      {currency === "custom" && (
        <>
          <ToolSection title={s.mainUnitTitle}>
            {nounFormsFields(
              {
                one: s.unitOne,
                few: s.unitFew,
                many: s.unitMany,
                gender: s.unitGender,
                genderM: s.genderM,
                genderF: s.genderF,
              },
              mainOne,
              setMainOne,
              mainFew,
              setMainFew,
              mainMany,
              setMainMany,
              mainGender,
              setMainGender,
            )}
          </ToolSection>
          <ToolInput
            label={s.subUnitsPerUnit}
            hint={s.subUnitsPerUnitHint}
            value={subUnitsPerUnit}
            onChange={setSubUnitsPerUnit}
          />
          <ToolSection title={s.subUnitTitle}>
            {nounFormsFields(
              {
                one: s.unitOne,
                few: s.unitFew,
                many: s.unitMany,
                gender: s.unitGender,
                genderM: s.genderM,
                genderF: s.genderF,
              },
              subOne,
              setSubOne,
              subFew,
              setSubFew,
              subMany,
              setSubMany,
              subGender,
              setSubGender,
            )}
          </ToolSection>
        </>
      )}
      <ToolSelect<"spaced" | "joined">
        label={s.style}
        value={style}
        onChange={setStyle}
        options={[
          { id: "spaced", label: s.styleSpaced },
          { id: "joined", label: s.styleJoined },
        ]}
      />
      <ToolSelect<YesNo>
        label={s.capitalise}
        value={capitalise}
        onChange={setCapitalise}
        options={yesNoOptions(s.yes, s.no)}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolOutput label={s.words} value={result.words} multiline />
          <ResultRow label={s.wholeUnits} value={String(result.wholeUnits)} />
          <ResultRow label={s.subUnits} value={proNum(result.subUnits, 0)} />
          <ResultRow label={s.typedAmount} value={result.typedAmount} />
          <ResultRow label={s.convertedAmount} value={result.convertedAmount} />
          <ResultRow label={s.rounded} value={result.rounded ? s.yes : s.no} />
          {result.subUnitFraction !== undefined && (
            <ResultRow
              label={s.subUnitFraction}
              value={`${result.subUnitFraction.numerator}/${result.subUnitFraction.denominator}`}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.amount, value: amountText.trim() },
              {
                label: s.currency,
                value: currency === "dinar" ? s.currencyDinar : s.currencyCustom,
              },
              { label: s.style, value: style === "spaced" ? s.styleSpaced : s.styleJoined },
              { label: s.capitalise, value: capitalise === "yes" ? s.yes : s.no },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}
