import {
  averageToTarget,
  childAge,
  combinatorics,
  decimalToFraction,
  fractionArithmetic,
  gradeScalePoints,
  gradeStatistics,
  guessingCorrection,
  itemAnalysis,
  lessonCountPeriod,
  lessonTimeline,
  parseValueList,
  splitIntoGroups,
  standardScore,
  testPrinting,
  topicHourAllocation,
  weightedGrade,
  type AverageOutcome,
  type CalendarDate,
  type DecimalExpansion,
  type DecimalToFractionInput,
  type DeviationKind,
  type FractionOperation,
  type ClockTime,
  type GradeScaleBand,
  type GradeTally,
  type GroupSplit,
  type ItemGroup,
  type MakeupDay,
  type PendingComponent,
  type TargetOutcome,
  type WeekdayLessons,
  type WeightedComponent,
} from "@nexus/core/pro/prosveta";
import { useState, type ComponentType } from "react";

import { fill, strings } from "../strings.js";
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
 * „Prosveta i nastava" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/prosveta.ts`'s. This file shapes fields
 * (including the small amount of TEXT shaping — splitting a date typed as
 * „13.08.2026" into three numbers, a table typed one row per line into its
 * columns), hands the numbers to the core function, and prints what comes
 * back. None of that text splitting computes an answer; every number that
 * feeds the arithmetic still goes through `proParse`, exactly once each.
 *
 * None of this pack's tools is `life-safety` or `food-safety` — every risk
 * class here is „none" or, for `test-printing`, „financial". The host still
 * draws the notice and appends the copy line from the registration; nothing
 * below decides a grade or a price is „fine".
 */

/* --------------------------------------------------------- local helpers -- */

/** Splits non-empty, trimmed lines out of a textarea — the drawer's one table shape. */
function splitLines(text: string): readonly string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Splits one row into its `;`-separated columns, trimmed. */
function splitFields(line: string): readonly string[] {
  return line.split(";").map((field) => field.trim());
}

/** „13.08.2026" → a `CalendarDate`, via `proParse` on each of its three parts. */
function parseDate(text: string): CalendarDate | undefined {
  const parts = text.split(".");
  if (parts.length !== 3) return undefined;
  const day = proParse(parts[0] ?? "");
  const month = proParse(parts[1] ?? "");
  const year = proParse(parts[2] ?? "");
  if (day === undefined || month === undefined || year === undefined) return undefined;
  return { day, month, year };
}

/** A `CalendarDate` back to „13.08.2026" — display only, never fed back into a parser. */
function formatDate(date: CalendarDate): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.day)}.${pad(date.month)}.${date.year}`;
}

/** The device's own local calendar date — never a UTC timestamp difference. */
function todayLocal(): CalendarDate {
  const now = new Date();
  return { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() };
}

/** „08:05" → an hour and a minute, via `proParse` on each half. */
function parseClock(text: string): { readonly hour: number; readonly minute: number } | undefined {
  const parts = text.split(":");
  if (parts.length !== 2) return undefined;
  const hour = proParse(parts[0] ?? "");
  const minute = proParse(parts[1] ?? "");
  if (hour === undefined || minute === undefined) return undefined;
  return { hour, minute };
}

/** A decimal expansion as „1,58(3)" — the period in parentheses, nothing rounded. */
function formatDecimal(decimal: DecimalExpansion): string {
  const sign = decimal.negative ? "-" : "";
  const rest =
    decimal.repeatingLength > 0
      ? `${decimal.nonRepeatingDigits}(${decimal.repeatingDigits})`
      : decimal.nonRepeatingDigits;
  return rest.length > 0
    ? `${sign}${decimal.integerDigits},${rest}`
    : `${sign}${decimal.integerDigits}`;
}

/** „08:05" or, past midnight, „00:10 (+1 dan)" — display only. */
function formatClockTime(time: ClockTime, dayUnit: string): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const base = `${pad(time.hour)}:${pad(time.minute)}`;
  return time.dayOffset > 0 ? `${base} (+${time.dayOffset} ${dayUnit})` : base;
}

/** An exact `bigint` with sr-Latn thousands grouping — too large for `proNum`'s `Number`. */
function formatBigInt(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return negative ? `-${grouped}` : grouped;
}

/** „0,1(6)" (or „3,75", or „0,(3)") → the four fields `decimalToFraction` wants. */
function parseDecimalNotation(text: string): DecimalToFractionInput | undefined {
  const match = /^(-)?(\d*)(?:,(\d*))?(?:\((\d+)\))?$/.exec(text.trim());
  if (match === null) return undefined;
  const [, sign, integerDigits, nonRepeatingDigits, repeatingDigits] = match;
  return {
    negative: sign === "-",
    integerDigits: integerDigits ?? "",
    nonRepeatingDigits: nonRepeatingDigits ?? "",
    repeatingDigits: repeatingDigits ?? "",
  };
}

/* ------------------------------------------------------- average to target -- */

const AVERAGE_OUTCOME_KEY: Readonly<Record<AverageOutcome, "outcomeNeeded" | "outcomeAnyCount" | "outcomeUnreachable" | "outcomeAlreadyBelow" | "outcomeTolerated">> = {
  needed: "outcomeNeeded",
  anyCount: "outcomeAnyCount",
  unreachable: "outcomeUnreachable",
  alreadyBelow: "outcomeAlreadyBelow",
  tolerated: "outcomeTolerated",
};

/** How many more marks of one value reach a target average, or how many weaker ones it can still take. */
export function AverageToTargetTool() {
  const s = strings.pro.prosveta["average-to-target"];
  const [mode, setMode] = useState<"grades" | "tally">("grades");
  const [gradesText, setGradesText] = useState("");
  const [tallyCount, setTallyCount] = useState("");
  const [tallySum, setTallySum] = useState("");
  const [target, setTarget] = useState("");
  const [extraGrade, setExtraGrade] = useState("");

  const gradeValues = splitLines(gradesText)
    .flatMap((line) => line.split(/[\s;]+/))
    .filter((token) => token.length > 0)
    .map((token) => proParse(token) ?? Number.NaN);

  const typed =
    (mode === "grades" ? gradesText.trim() !== "" : tallyCount.trim() !== "" || tallySum.trim() !== "") ||
    proParse(target) !== undefined ||
    proParse(extraGrade) !== undefined;

  const tally: GradeTally =
    mode === "grades"
      ? { kind: "grades", grades: gradeValues }
      : { kind: "tally", count: proParse(tallyCount) ?? Number.NaN, sum: proParse(tallySum) ?? Number.NaN };

  const result = averageToTarget({
    tally,
    target: proParse(target) ?? Number.NaN,
    extraGrade: proParse(extraGrade) ?? Number.NaN,
  });

  const errors: Readonly<Record<string, string>> = {
    grades: s.errorGrades,
    tooManyValues: s.errorTooManyValues,
    count: s.errorCount,
    sum: s.errorSum,
    target: s.errorTarget,
    extraGrade: s.errorExtraGrade,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorGrades;

  const copyText = !result.ok
    ? ""
    : [
        `${s.currentAverage}: ${proNum(result.currentAverage, 2)}`,
        `${s.outcome}: ${s[AVERAGE_OUTCOME_KEY[result.outcome]]}`,
        ...(result.extraGrades === undefined ? [] : [`${s.extraGrades}: ${proNum(result.extraGrades, 0)}`]),
        ...(result.resultingAverage === undefined
          ? []
          : [`${s.resultingAverage}: ${proNum(result.resultingAverage, 2)}`]),
        "",
        `${s.target}: ${proNum(proParse(target) ?? 0, 2)}`,
        `${s.extraGrade}: ${proNum(proParse(extraGrade) ?? 0, 2)}`,
        mode === "grades" ? `${s.grades}: ${gradesText.trim()}` : `${s.tallyCount}: ${tallyCount}, ${s.tallySum}: ${tallySum}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<"grades" | "tally">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "grades", label: s.modeGrades },
          { id: "tally", label: s.modeTally },
        ]}
      />
      {mode === "grades" ? (
        <ToolTextArea label={s.grades} hint={s.gradesHint} value={gradesText} onChange={setGradesText} rows={4} />
      ) : (
        <>
          <ToolInput label={s.tallyCount} value={tallyCount} onChange={setTallyCount} />
          <ToolInput label={s.tallySum} value={tallySum} onChange={setTallySum} />
        </>
      )}
      <ToolInput label={s.target} hint={s.targetHint} value={target} onChange={setTarget} />
      <ToolInput label={s.extraGrade} hint={s.extraGradeHint} value={extraGrade} onChange={setExtraGrade} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.currentAverage} value={proNum(result.currentAverage, 2)} />
          <ResultRow label={s.outcome} value={s[AVERAGE_OUTCOME_KEY[result.outcome]]} />
          {result.extraGrades !== undefined && (
            <ResultRow label={s.extraGrades} value={proNum(result.extraGrades, 0)} />
          )}
          {result.resultingAverage !== undefined && (
            <ResultRow label={s.resultingAverage} value={proNum(result.resultingAverage, 2)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.target, value: proNum(proParse(target) ?? 0, 2) },
              { label: s.extraGrade, value: proNum(proParse(extraGrade) ?? 0, 2) },
              mode === "grades"
                ? { label: s.grades, value: gradesText.trim() }
                : { label: s.tallyCount, value: `${tallyCount} / ${tallySum}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------- child age -- */

/** Age in years, months and days on a given day, and the date of a chosen birthday. */
export function ChildAgeTool() {
  const s = strings.pro.prosveta["child-age"];
  const [birthText, setBirthText] = useState("");
  const [onText, setOnText] = useState("");
  const [milestoneYears, setMilestoneYears] = useState("");

  const birth = parseDate(birthText);
  const on = onText.trim() === "" ? todayLocal() : parseDate(onText);
  const typed = birthText.trim() !== "";

  const result = childAge({
    birth: birth ?? { day: Number.NaN, month: Number.NaN, year: Number.NaN },
    on: on ?? { day: Number.NaN, month: Number.NaN, year: Number.NaN },
    milestoneYears: milestoneYears.trim() === "" ? undefined : proParse(milestoneYears),
  });

  const errors: Readonly<Record<string, string>> = {
    birth: s.errorBirth,
    on: s.errorOn,
    milestoneYears: s.errorMilestoneYears,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorBirth;

  const copyText = !result.ok
    ? ""
    : [
        `${s.age}: ${proNum(result.years, 0)} ${s.years}, ${proNum(result.months, 0)} ${s.months}, ${proNum(result.days, 0)} ${s.days}`,
        `${s.totalMonths}: ${proNum(result.totalMonths, 0)}`,
        `${s.totalDays}: ${proNum(result.totalDays, 0)}`,
        `${s.daysUntilNextBirthday}: ${proNum(result.daysUntilNextBirthday, 0)}`,
        ...(result.milestone === undefined
          ? []
          : [
              `${s.milestoneDate}: ${formatDate(result.milestone.date)}` +
                `${result.milestone.shifted ? ` (${s.milestoneShifted})` : ""}`,
            ]),
        ...(result.borrow === undefined
          ? []
          : [
              `${s.borrowNote}: ${s.borrowedMonth} ${proNum(result.borrow.fromMonth, 0)} ` +
                `(${proNum(result.borrow.fromMonthDays, 0)} ${s.daysUnit})`,
            ]),
        "",
        `${s.birth}: ${birth === undefined ? birthText : formatDate(birth)}`,
        `${s.on}: ${on === undefined ? onText : formatDate(on)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.birth} hint={s.dateHint} value={birthText} onChange={setBirthText} placeholder="13.08.2020" />
      <ToolInput label={s.on} hint={s.onHint} value={onText} onChange={setOnText} placeholder="13.08.2026" />
      <ToolInput label={s.milestoneYears} hint={s.milestoneYearsHint} value={milestoneYears} onChange={setMilestoneYears} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.age}
            value={`${proNum(result.years, 0)} ${s.years}, ${proNum(result.months, 0)} ${s.months}, ${proNum(result.days, 0)} ${s.days}`}
          />
          <ResultRow label={s.totalMonths} value={proNum(result.totalMonths, 0)} />
          <ResultRow label={s.totalDays} value={proNum(result.totalDays, 0)} />
          <ResultRow label={s.daysUntilNextBirthday} value={proNum(result.daysUntilNextBirthday, 0)} />
          {result.milestone !== undefined && (
            <ResultRow
              label={s.milestoneDate}
              value={
                `${formatDate(result.milestone.date)}` +
                `${result.milestone.shifted ? ` — ${s.milestoneShifted}` : ""}`
              }
            />
          )}
          {result.borrow !== undefined && (
            <p className="nx-hint nx-hint--prose">
              {s.borrowNote} {proNum(result.borrow.fromMonth, 0)} (
              {proNum(result.borrow.fromMonthDays, 0)} {s.daysUnit})
              {result.borrow.clamped ? ` — ${s.borrowClamped}` : ""}
            </p>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.birth, value: birth === undefined ? birthText : formatDate(birth) },
              { label: s.on, value: on === undefined ? onText : formatDate(on) },
              ...(milestoneYears.trim() === "" ? [] : [{ label: s.milestoneYears, value: milestoneYears.trim() }]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------ grade scale points -- */

/** Percent thresholds turned into whole marking steps on a paper of a given maximum. */
export function GradeScalePointsTool() {
  const s = strings.pro.prosveta["grade-scale-points"];
  // One band, formatted once. The table and the copy text each spelled the
  // „from – to" out in full, from two optionals guarded on only the first —
  // so the two ends could not go missing together even in principle, and the
  // second end carried a `?? 0` that would have printed „0,00 poena".
  const bandText = (band: GradeScaleBand): string =>
    `${proUnit(proNum(band.from, 2), s.unitPoints)} – ${proUnit(proNum(band.to, 2), s.unitPoints)}`;
  const [maxPointsText, setMaxPointsText] = useState("");
  const [stepText, setStepText] = useState("");
  const [thresholdsText, setThresholdsText] = useState("");
  const [scoredPointsText, setScoredPointsText] = useState("");

  const thresholdRows = splitLines(thresholdsText).map(splitFields);
  const labels = thresholdRows.map((fields) => fields[0] ?? "");
  const thresholds = thresholdRows.map((fields) => proParse(fields[1] ?? "") ?? Number.NaN);

  const typed = maxPointsText.trim() !== "" || thresholdsText.trim() !== "";
  const result = gradeScalePoints({
    maxPoints: proParse(maxPointsText) ?? Number.NaN,
    step: stepText.trim() === "" ? 1 : proParse(stepText) ?? Number.NaN,
    thresholds,
    scoredPoints: scoredPointsText.trim() === "" ? undefined : proParse(scoredPointsText) ?? Number.NaN,
  });

  const errors: Readonly<Record<string, string>> = {
    maxPoints: s.errorMaxPoints,
    step: s.errorStep,
    thresholds: s.errorThresholds,
    tooManyRows: s.errorTooManyRows,
    duplicateThreshold: s.errorDuplicateThreshold,
    scoredPoints: s.errorScoredPoints,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorThresholds;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${labels[row.index] ?? ""}: ${proNum(row.percent, 2)}% → ` +
            `${proUnit(proNum(row.minPoints, 2), s.unitPoints)} (${proNum(row.minPercent, 2)}%)` +
            (row.band === undefined ? ` — ${s.unreachableRow}` : ` [${bandText(row.band)}]`),
        ),
        ...(result.unlabelled === undefined
          ? []
          : [`${s.unlabelled}: ${bandText(result.unlabelled)}`]),
        ...(result.scored === undefined
          ? []
          : [
              `${s.scoredPercent}: ${proNum(result.scored.percent, 2)}%`,
              `${s.scoredLabel}: ` +
                `${result.scored.index === undefined ? s.noLabel : labels[result.scored.index] ?? ""}`,
            ]),
        "",
        `${s.maxPoints}: ${proUnit(proNum(proParse(maxPointsText) ?? 0, 2), s.unitPoints)}`,
        `${s.step}: ${proUnit(proNum(stepText.trim() === "" ? 1 : proParse(stepText) ?? 0, 2), s.unitPoints)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.maxPoints} value={maxPointsText} onChange={setMaxPointsText} />
      <ToolInput label={s.step} hint={s.stepHint} value={stepText} onChange={setStepText} />
      <ToolTextArea label={s.thresholds} hint={s.thresholdsHint} value={thresholdsText} onChange={setThresholdsText} rows={5} />
      <ToolInput label={s.scoredPoints} hint={s.scoredPointsHint} value={scoredPointsText} onChange={setScoredPointsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colLabel, s.colThreshold, s.colMinPoints, s.colMinPercent, s.colRange]}
            rows={result.rows.map((row) => [
              labels[row.index] ?? "",
              `${proNum(row.percent, 2)} %`,
              proUnit(proNum(row.minPoints, 2), s.unitPoints),
              `${proNum(row.minPercent, 2)} %`,
              row.band === undefined ? s.unreachableRow : bandText(row.band),
            ])}
          />
          {result.unlabelled !== undefined && (
            <ResultRow label={s.unlabelled} value={bandText(result.unlabelled)} />
          )}
          {result.scored !== undefined && (
            <>
              <ResultRow label={s.scoredPercent} value={`${proNum(result.scored.percent, 2)} %`} />
              <ResultRow
                label={s.scoredLabel}
                value={result.scored.index === undefined ? s.noLabel : labels[result.scored.index] ?? ""}
              />
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.maxPoints, value: proUnit(proNum(proParse(maxPointsText) ?? 0, 2), s.unitPoints) },
              {
                label: s.step,
                value: proUnit(proNum(stepText.trim() === "" ? 1 : proParse(stepText) ?? 0, 2), s.unitPoints),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------- grade statistics -- */

/** The whole descriptive summary of a list of marks or scores, plus a count against a threshold the user typed. */
export function GradeStatisticsTool() {
  const s = strings.pro.prosveta["grade-statistics"];
  const [valuesText, setValuesText] = useState("");
  const [passThresholdText, setPassThresholdText] = useState("");

  const typed = valuesText.trim() !== "";
  const parsed = parseValueList(valuesText);
  const result = parsed.ok
    ? gradeStatistics({
        values: parsed.values,
        passThreshold: passThresholdText.trim() === "" ? undefined : proParse(passThresholdText),
      })
    : parsed;

  const errors: Readonly<Record<string, string>> = {
    values: s.errorValues,
    tooManyValues: s.errorTooManyValues,
    passThreshold: s.errorPassThreshold,
  };
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason.startsWith("token:")
        ? fill(s.errorToken, { index: result.reason.slice(6) })
        : errors[result.reason] ?? s.errorValues;

  const copyText = !result.ok
    ? ""
    : [
        `${s.count}: ${proNum(result.count, 0)}`,
        `${s.sum}: ${proNum(result.sum, 2)}`,
        `${s.mean}: ${proNum(result.mean, 2)}`,
        `${s.min}: ${proNum(result.min, 2)} — ${s.max}: ${proNum(result.max, 2)} — ${s.range}: ${proNum(result.range, 2)}`,
        `${s.median}: ${proNum(result.median, 2)}`,
        ...(result.quartiles === undefined
          ? [s.quartilesAbsentNote]
          : [
              `Q1: ${proNum(result.quartiles.q1, 2)} — Q3: ${proNum(result.quartiles.q3, 2)} — ` +
                `IQR: ${proNum(result.quartiles.iqr, 2)}` +
                (result.quartiles.degenerate ? ` (${s.quartilesDegenerateNote})` : ""),
            ]),
        `${s.populationDeviation}: ${proNum(result.populationDeviation, 2)} (${s.populationVariance} ${proNum(result.populationVariance, 2)})`,
        ...(result.sample === undefined
          ? []
          : [
              `${s.sampleDeviation}: ${proNum(result.sample.deviation, 2)} ` +
                `(${s.sampleVariance} ${proNum(result.sample.variance, 2)})`,
            ]),
        `${s.modes}: ${result.modes.length === 0 ? s.noMode : result.modes.map((value) => proNum(value, 2)).join(", ")}`,
        ...(result.atOrAbove === undefined
          ? []
          : [
              `${s.atOrAbove}: ${proNum(result.atOrAbove.count, 0)} ` +
                `(${proNum(result.atOrAbove.percent, 2)}%)`,
            ]),
        "",
        `${s.values}: ${valuesText.trim()}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.values} hint={s.valuesHint} value={valuesText} onChange={setValuesText} rows={4} />
      <ToolInput label={s.passThreshold} hint={s.passThresholdHint} value={passThresholdText} onChange={setPassThresholdText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.count} value={proNum(result.count, 0)} />
          <ResultRow label={s.sum} value={proNum(result.sum, 2)} />
          <ResultRow label={s.mean} value={proNum(result.mean, 2)} />
          <ResultRow label={s.min} value={proNum(result.min, 2)} />
          <ResultRow label={s.max} value={proNum(result.max, 2)} />
          <ResultRow label={s.range} value={proNum(result.range, 2)} />
          <ResultRow label={s.median} value={proNum(result.median, 2)} />
          {result.quartiles === undefined ? (
            <p className="nx-hint nx-hint--prose">{s.quartilesAbsentNote}</p>
          ) : (
            <>
              <ResultRow label={s.q1} value={proNum(result.quartiles.q1, 2)} />
              <ResultRow label={s.q3} value={proNum(result.quartiles.q3, 2)} />
              <ResultRow label={s.iqr} value={proNum(result.quartiles.iqr, 2)} />
              {result.quartiles.degenerate && (
                <p className="nx-hint nx-hint--prose">{s.quartilesDegenerateNote}</p>
              )}
            </>
          )}
          <p className="nx-hint nx-hint--prose">{s.quartileMethodNote}</p>
          <ResultRow label={s.populationVariance} value={proNum(result.populationVariance, 2)} />
          <ResultRow label={s.populationDeviation} value={proNum(result.populationDeviation, 2)} />
          {result.sample !== undefined && (
            <>
              <ResultRow label={s.sampleVariance} value={proNum(result.sample.variance, 2)} />
              <ResultRow label={s.sampleDeviation} value={proNum(result.sample.deviation, 2)} />
            </>
          )}
          <ResultRow label={s.modes} value={result.modes.length === 0 ? s.noMode : result.modes.map((value) => proNum(value, 2)).join(", ")} />
          <ToolTable
            head={[s.colValue, s.colCount, s.colShare]}
            rows={result.frequencies.map((row) => [proNum(row.value, 2), proNum(row.count, 0), `${proNum(row.share, 2)} %`])}
          />
          <p className="nx-hint nx-hint--prose">{s.shareRoundingNote}</p>
          {result.atOrAbove !== undefined && (
            <ResultRow
              label={s.atOrAbove}
              value={`${proNum(result.atOrAbove.count, 0)} (${proNum(result.atOrAbove.percent, 2)} %)`}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.values, value: valuesText.trim() },
              ...(passThresholdText.trim() === "" ? [] : [{ label: s.passThreshold, value: passThresholdText.trim() }]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------ lessons in a period -- */

/** How many lessons of one subject a period holds, by weekday, minus what was excluded. */
export function LessonCountPeriodTool() {
  const s = strings.pro.prosveta["lesson-count-period"];
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [weekdaysText, setWeekdaysText] = useState("");
  const [excludedText, setExcludedText] = useState("");
  const [makeupText, setMakeupText] = useState("");
  const [lessonMinutesText, setLessonMinutesText] = useState("");
  const [prescribedHoursText, setPrescribedHoursText] = useState("");

  const invalidDate: CalendarDate = { day: Number.NaN, month: Number.NaN, year: Number.NaN };
  const start = parseDate(startText) ?? invalidDate;
  const end = parseDate(endText) ?? invalidDate;
  const weekdays: readonly WeekdayLessons[] = splitLines(weekdaysText)
    .map(splitFields)
    .map((fields) => ({
      weekday: proParse(fields[0] ?? "") ?? Number.NaN,
      lessons: proParse(fields[1] ?? "") ?? Number.NaN,
    }));
  const excludedDates: readonly CalendarDate[] = splitLines(excludedText).map(
    (line) => parseDate(line) ?? invalidDate,
  );
  const makeupDays: readonly MakeupDay[] = splitLines(makeupText)
    .map(splitFields)
    .map((fields) => ({
      date: parseDate(fields[0] ?? "") ?? invalidDate,
      followsWeekday: proParse(fields[1] ?? "") ?? Number.NaN,
    }));

  const typed = startText.trim() !== "" || endText.trim() !== "" || weekdaysText.trim() !== "";
  const result = lessonCountPeriod({
    start,
    end,
    weekdays,
    excludedDates,
    makeupDays,
    lessonMinutes: proParse(lessonMinutesText) ?? Number.NaN,
    prescribedHours: prescribedHoursText.trim() === "" ? undefined : proParse(prescribedHoursText) ?? Number.NaN,
  });

  const errors: Readonly<Record<string, string>> = {
    start: s.errorStart,
    end: s.errorEnd,
    lessonMinutes: s.errorLessonMinutes,
    weekdays: s.errorWeekdays,
    lessons: s.errorLessons,
    prescribedHours: s.errorPrescribedHours,
    tooManyRows: s.errorTooManyRows,
    excludedDates: s.errorExcludedDates,
    makeupDays: s.errorMakeupDays,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorStart;

  const weekdayName = (weekday: number): string => s.weekdayNames[weekday - 1] ?? String(weekday);
  const reasonLabel = { offPeriod: s.reasonOffPeriod, duplicate: s.reasonDuplicate, offWeekday: s.reasonOffWeekday } as const;

  const copyText = !result.ok
    ? ""
    : [
        ...result.days.map(
          (day) =>
            `${weekdayName(day.weekday)}: ${proNum(day.sessions, 0)} ${s.totalSessions.toLowerCase()} (${proNum(day.occurrences, 0)} − ${proNum(day.excluded, 0)} − ${proNum(day.makeupAway, 0)} + ${proNum(day.makeupInto, 0)})`,
        ),
        `${s.totalSessions}: ${proNum(result.totalSessions, 0)}`,
        `${s.totalLessons}: ${proNum(result.totalLessons, 0)}`,
        `${s.totalExcluded}: ${proNum(result.totalExcluded, 0)}`,
        `${s.totalTime}: ${proNum(result.hours, 0)} h ${proNum(result.minutes, 0)} min`,
        `${s.ignoredOffWeekday}: ${proNum(result.ignoredOffWeekday, 0)}`,
        `${s.ignoredOffPeriod}: ${proNum(result.ignoredOffPeriod, 0)}`,
        ...(result.prescribed === undefined
          ? []
          : [
              `${s.prescribedHoursLabel}: ${proNum(result.prescribed.hours, 0)}`,
              `${s.hoursDifferenceLabel}: ${proNum(result.prescribed.difference, 0)}`,
              `${s.hoursRatioLabel}: ${proRatio(result.prescribed.ratio) ?? "—"}`,
            ]),
        s.noHolidayNote,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.start} hint={s.dateHint} value={startText} onChange={setStartText} placeholder="01.09.2026" />
      <ToolInput label={s.end} hint={s.dateHint} value={endText} onChange={setEndText} placeholder="31.12.2026" />
      <ToolTextArea label={s.weekdays} hint={s.weekdaysHint} value={weekdaysText} onChange={setWeekdaysText} rows={4} />
      <ToolTextArea label={s.excludedDates} hint={s.excludedDatesHint} value={excludedText} onChange={setExcludedText} rows={4} />
      <ToolTextArea label={s.makeupDays} hint={s.makeupDaysHint} value={makeupText} onChange={setMakeupText} rows={3} />
      <ToolInput label={s.lessonMinutes} value={lessonMinutesText} onChange={setLessonMinutesText} />
      <ToolInput label={s.prescribedHours} hint={s.prescribedHoursHint} value={prescribedHoursText} onChange={setPrescribedHoursText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colWeekday, s.colLessons, s.colOccurrences, s.colExcluded, s.colMakeupAway, s.colMakeupInto, s.colSessions]}
            rows={result.days.map((day) => [
              weekdayName(day.weekday),
              proNum(day.lessons, 0),
              proNum(day.occurrences, 0),
              proNum(day.excluded, 0),
              proNum(day.makeupAway, 0),
              proNum(day.makeupInto, 0),
              proNum(day.sessions, 0),
            ])}
          />
          <ResultRow label={s.totalSessions} value={proNum(result.totalSessions, 0)} />
          <ResultRow label={s.totalLessons} value={proNum(result.totalLessons, 0)} />
          <ResultRow label={s.totalExcluded} value={proNum(result.totalExcluded, 0)} />
          <ResultRow label={s.totalTime} value={`${proNum(result.hours, 0)} h ${proNum(result.minutes, 0)} min`} />
          {result.appliedExclusions.length > 0 && (
            <ToolTable
              head={[s.colDate, s.colWeekdayName]}
              rows={result.appliedExclusions.map((entry) => [formatDate(entry.date), weekdayName(entry.weekday)])}
            />
          )}
          {result.ignoredExclusions.length > 0 && (
            <ToolTable
              head={[s.colDate, s.colReason]}
              rows={result.ignoredExclusions.map((entry) => [formatDate(entry.date), reasonLabel[entry.reason]])}
            />
          )}
          {result.prescribed !== undefined && (
            <>
              <ToolAgainstLimit
                label={s.totalLessons}
                value={proNum(result.totalLessons, 0)}
                limitLabel={s.prescribedHoursLabel}
                limit={proNum(result.prescribed.hours, 0)}
                ratioLabel={s.hoursRatioLabel}
                ratio={proRatio(result.prescribed.ratio)}
              />
              <ResultRow
                label={s.hoursDifferenceLabel}
                value={proNum(result.prescribed.difference, 0)}
              />
            </>
          )}
          <p className="nx-hint nx-hint--prose">{s.noHolidayNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.start, value: formatDate(start) },
              { label: s.end, value: formatDate(end) },
              { label: s.lessonMinutes, value: lessonMinutesText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* --------------------------------------------------------- lesson timeline -- */

/** A lesson plan laid out on the clock, with each activity's share of the total. */
export function LessonTimelineTool() {
  const s = strings.pro.prosveta["lesson-timeline"];
  const [startText, setStartText] = useState("");
  const [activitiesText, setActivitiesText] = useState("");
  const [lessonMinutesText, setLessonMinutesText] = useState("");

  const clock = parseClock(startText);
  const activityRows = splitLines(activitiesText).map(splitFields);
  const names = activityRows.map((fields) => fields[0] ?? "");
  const durations = activityRows.map((fields) => proParse(fields[1] ?? "") ?? Number.NaN);

  const typed = startText.trim() !== "" || activitiesText.trim() !== "";
  const result = lessonTimeline({
    startHour: clock?.hour ?? Number.NaN,
    startMinute: clock?.minute ?? Number.NaN,
    durations,
    lessonMinutes: lessonMinutesText.trim() === "" ? undefined : proParse(lessonMinutesText) ?? Number.NaN,
  });

  const errors: Readonly<Record<string, string>> = {
    startHour: s.errorStart,
    startMinute: s.errorStart,
    durations: s.errorDurations,
    tooManyRows: s.errorTooManyRows,
    lessonMinutes: s.errorLessonMinutes,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorStart;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${names[row.index] ?? ""}: ${formatClockTime(row.start, s.dayUnit)}–${formatClockTime(row.end, s.dayUnit)} (${proNum(row.duration, 0)} min, ${proNum(row.share, 2)} %)`,
        ),
        `${s.totalMinutes}: ${proNum(result.totalMinutes, 0)}`,
        `${s.end}: ${formatClockTime(result.end, s.dayUnit)}`,
        ...(result.slack === undefined ? [] : [`${s.slack}: ${proNum(result.slack, 0)}`]),
        s.shareRoundingNote,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.start} hint={s.startHint} value={startText} onChange={setStartText} placeholder="08:00" />
      <ToolTextArea label={s.activities} hint={s.activitiesHint} value={activitiesText} onChange={setActivitiesText} rows={5} />
      <ToolInput label={s.lessonMinutes} hint={s.lessonMinutesHint} value={lessonMinutesText} onChange={setLessonMinutesText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colName, s.colStart, s.colEnd, s.colDuration, s.colShare]}
            prose={[0]}
            rows={result.rows.map((row) => [
              names[row.index] ?? "",
              formatClockTime(row.start, s.dayUnit),
              formatClockTime(row.end, s.dayUnit),
              proNum(row.duration, 0),
              `${proNum(row.share, 2)} %`,
            ])}
          />
          <p className="nx-hint nx-hint--prose">{s.shareRoundingNote}</p>
          <ResultRow label={s.totalMinutes} value={proNum(result.totalMinutes, 0)} />
          <ResultRow label={s.end} value={formatClockTime(result.end, s.dayUnit)} />
          {result.slack !== undefined && <ResultRow label={s.slack} value={proNum(result.slack, 0)} />}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.start, value: startText.trim() },
              { label: s.activities, value: activitiesText.trim() },
              ...(lessonMinutesText.trim() === "" ? [] : [{ label: s.lessonMinutes, value: lessonMinutesText.trim() }]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* --------------------------------------------------------- split into groups -- */

/** A class split into groups, evened as much as possible, with the check that it adds up. */
export function SplitIntoGroupsTool() {
  const s = strings.pro.prosveta["split-into-groups"];
  const [studentsText, setStudentsText] = useState("");
  const [mode, setMode] = useState<"byGroups" | "bySize">("byGroups");
  const [value, setValue] = useState("");
  const [minGroupSizeText, setMinGroupSizeText] = useState("");

  const typed = studentsText.trim() !== "" || value.trim() !== "";
  const split: GroupSplit =
    mode === "byGroups"
      ? { kind: "byGroups", groups: proParse(value) ?? Number.NaN }
      : { kind: "bySize", size: proParse(value) ?? Number.NaN };

  const result = splitIntoGroups({
    students: proParse(studentsText) ?? Number.NaN,
    split,
    minGroupSize: minGroupSizeText.trim() === "" ? undefined : proParse(minGroupSizeText) ?? Number.NaN,
  });

  const errors: Readonly<Record<string, string>> = {
    students: s.errorStudents,
    groups: s.errorGroups,
    size: s.errorSize,
    minGroupSize: s.errorMinGroupSize,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorStudents;

  const copyText = !result.ok
    ? ""
    : [
        `${s.groups}: ${proNum(result.groups, 0)}`,
        ...result.tally.map((row) => `${proNum(row.count, 0)} × ${proNum(row.size, 0)}`),
        `${s.checkSum}: ${proNum(result.checkSum, 0)}`,
        `${s.emptyGroups}: ${proNum(result.emptyGroups, 0)} — ${s.groupsWithMembers}: ${proNum(result.groupsWithMembers, 0)}`,
        ...(result.bySize === undefined
          ? []
          : [
              `${s.fullGroups}: ${proNum(result.bySize.fullGroups, 0)} × ${value.trim()}, ` +
                `${s.remainder}: ${proNum(result.bySize.remainder, 0)}`,
              `${s.fullCheckSum}: ${proNum(result.bySize.fullCheckSum, 0)}`,
              `${s.largestGroupWithinSize}: ${result.bySize.largestGroupWithinSize ? s.yes : s.no}`,
            ]),
      ].join("\n");

  return (
    <>
      <ToolInput label={s.students} value={studentsText} onChange={setStudentsText} />
      <ToolSelect<"byGroups" | "bySize">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "byGroups", label: s.modeByGroups },
          { id: "bySize", label: s.modeBySize },
        ]}
      />
      <ToolInput label={mode === "byGroups" ? s.valueByGroups : s.valueBySize} value={value} onChange={setValue} />
      <ToolInput label={s.minGroupSize} hint={s.minGroupSizeHint} value={minGroupSizeText} onChange={setMinGroupSizeText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.groups} value={proNum(result.groups, 0)} />
          <ToolTable
            head={[s.colCount, s.colSize]}
            rows={result.tally.map((row) => [proNum(row.count, 0), proNum(row.size, 0)])}
          />
          <ResultRow label={s.checkSum} value={proNum(result.checkSum, 0)} />
          <ResultRow label={s.emptyGroups} value={proNum(result.emptyGroups, 0)} />
          <ResultRow label={s.groupsWithMembers} value={proNum(result.groupsWithMembers, 0)} />
          {result.bySize !== undefined && (
            <>
              <ResultRow label={s.fullGroups} value={proNum(result.bySize.fullGroups, 0)} />
              <ResultRow label={s.remainder} value={proNum(result.bySize.remainder, 0)} />
              <ResultRow label={s.fullCheckSum} value={proNum(result.bySize.fullCheckSum, 0)} />
              <ResultRow
                label={s.largestGroupWithinSize}
                value={result.bySize.largestGroupWithinSize ? s.yes : s.no}
              />
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.students, value: studentsText.trim() },
              { label: mode === "byGroups" ? s.valueByGroups : s.valueBySize, value: value.trim() },
              ...(minGroupSizeText.trim() === "" ? [] : [{ label: s.minGroupSize, value: minGroupSizeText.trim() }]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ----------------------------------------------------------- standard score -- */

/** A raw score as a z value and a T score, and the reverse from any of the three scales. */
export function StandardScoreTool() {
  const s = strings.pro.prosveta["standard-score"];
  const [raw, setRaw] = useState("");
  const [mean, setMean] = useState("");
  const [deviation, setDeviation] = useState("");
  const [deviationKind, setDeviationKind] = useState<DeviationKind>("population");
  const [targetMean, setTargetMean] = useState("");
  const [targetDeviation, setTargetDeviation] = useState("");
  const [zForRaw, setZForRaw] = useState("");
  const [tScoreForRaw, setTScoreForRaw] = useState("");
  const [targetScoreForRaw, setTargetScoreForRaw] = useState("");

  const typed = raw.trim() !== "" || mean.trim() !== "" || deviation.trim() !== "";
  const target =
    targetMean.trim() === "" && targetDeviation.trim() === ""
      ? undefined
      : { mean: proParse(targetMean) ?? Number.NaN, deviation: proParse(targetDeviation) ?? Number.NaN };

  const result = standardScore({
    raw: proParse(raw) ?? Number.NaN,
    mean: proParse(mean) ?? Number.NaN,
    deviation: proParse(deviation) ?? Number.NaN,
    deviationKind,
    target,
    zForRaw: zForRaw.trim() === "" ? undefined : proParse(zForRaw) ?? Number.NaN,
    tScoreForRaw: tScoreForRaw.trim() === "" ? undefined : proParse(tScoreForRaw) ?? Number.NaN,
    targetScoreForRaw: targetScoreForRaw.trim() === "" ? undefined : proParse(targetScoreForRaw) ?? Number.NaN,
  });

  const errors: Readonly<Record<string, string>> = {
    raw: s.errorRaw,
    mean: s.errorMean,
    deviation: s.errorDeviation,
    deviationKind: s.errorDeviationKind,
    targetMean: s.errorTargetMean,
    targetDeviation: s.errorTargetDeviation,
    zForRaw: s.errorZForRaw,
    tScoreForRaw: s.errorTScoreForRaw,
    targetScoreForRaw: s.errorTargetScoreForRaw,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorRaw;

  const copyText = !result.ok
    ? ""
    : [
        `z: ${proNum(result.z, 4)}`,
        `T: ${proNum(result.tScore, 2)}`,
        ...(result.targetScore === undefined ? [] : [`${s.targetScore}: ${proNum(result.targetScore, 2)}`]),
        ...(result.rawFromZ === undefined ? [] : [`${s.rawFromZ}: ${proNum(result.rawFromZ, 2)}`]),
        ...(result.rawFromTScore === undefined ? [] : [`${s.rawFromTScore}: ${proNum(result.rawFromTScore, 2)}`]),
        ...(result.rawFromTargetScore === undefined ? [] : [`${s.rawFromTargetScore}: ${proNum(result.rawFromTargetScore, 2)}`]),
        "",
        `${s.mean}: ${proNum(result.mean, 2)}, ${s.deviation}: ${proNum(result.deviation, 2)} (${result.deviationKind === "population" ? s.deviationPopulation : s.deviationSample})`,
        s.tScoreSource,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.raw} value={raw} onChange={setRaw} />
      <ToolInput label={s.mean} value={mean} onChange={setMean} />
      <ToolInput label={s.deviation} value={deviation} onChange={setDeviation} />
      <ToolSelect<DeviationKind>
        label={s.deviationKind}
        value={deviationKind}
        onChange={setDeviationKind}
        options={[
          { id: "population", label: s.deviationPopulation },
          { id: "sample", label: s.deviationSample },
        ]}
      />
      <ToolInput label={s.targetMean} hint={s.targetHint} value={targetMean} onChange={setTargetMean} />
      <ToolInput label={s.targetDeviation} value={targetDeviation} onChange={setTargetDeviation} />
      <ToolInput label={s.zForRaw} hint={s.reverseHint} value={zForRaw} onChange={setZForRaw} />
      <ToolInput label={s.tScoreForRaw} value={tScoreForRaw} onChange={setTScoreForRaw} />
      <ToolInput label={s.targetScoreForRaw} value={targetScoreForRaw} onChange={setTargetScoreForRaw} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.z} value={proNum(result.z, 4)} />
          <ResultRow label={s.tScore} value={proNum(result.tScore, 2)} />
          <p className="nx-hint nx-hint--prose">{s.tScoreSource}</p>
          {result.targetScore !== undefined && <ResultRow label={s.targetScore} value={proNum(result.targetScore, 2)} />}
          {result.rawFromZ !== undefined && <ResultRow label={s.rawFromZ} value={proNum(result.rawFromZ, 2)} />}
          {result.rawFromTScore !== undefined && <ResultRow label={s.rawFromTScore} value={proNum(result.rawFromTScore, 2)} />}
          {result.rawFromTargetScore !== undefined && (
            <ResultRow label={s.rawFromTargetScore} value={proNum(result.rawFromTargetScore, 2)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mean, value: proNum(result.mean, 2) },
              { label: s.deviation, value: proNum(result.deviation, 2) },
              {
                label: s.deviationKind,
                value: result.deviationKind === "population" ? s.deviationPopulation : s.deviationSample,
              },
              ...(target === undefined
                ? []
                : [{ label: s.targetMean, value: `${proNum(target.mean, 2)} / ${proNum(target.deviation, 2)}` }]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------- test printing -- */

/** Sheets and, when a price was typed, cost for a run of a test — a plain product, nothing else. */
export function TestPrintingTool() {
  const s = strings.pro.prosveta["test-printing"];
  const [pages, setPages] = useState("");
  const [copies, setCopies] = useState("");
  const [duplexChoice, setDuplexChoice] = useState<"yes" | "no">("no");
  const [sheetsPerPack, setSheetsPerPack] = useState("");
  const [priceText, setPriceText] = useState("");

  const typed = pages.trim() !== "" || copies.trim() !== "";
  const result = testPrinting({
    pages: proParse(pages) ?? Number.NaN,
    copies: proParse(copies) ?? Number.NaN,
    duplex: duplexChoice === "yes",
    sheetsPerPack: proParse(sheetsPerPack) ?? Number.NaN,
    pricePerSheet: priceText.trim() === "" ? undefined : proParse(priceText) ?? Number.NaN,
  });

  const errors: Readonly<Record<string, string>> = {
    pages: s.errorPages,
    copies: s.errorCopies,
    sheetsPerPack: s.errorSheetsPerPack,
    pricePerSheet: s.errorPrice,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorPages;

  const copyText = !result.ok
    ? ""
    : [
        `${s.sheetsPerCopy}: ${proNum(result.sheetsPerCopy, 0)}`,
        `${s.totalPages}: ${proNum(result.totalPages, 0)}`,
        `${s.totalSheets}: ${proNum(result.totalSheets, 0)}`,
        `${s.blankBacks}: ${proNum(result.blankBacks, 0)}`,
        `${s.packs}: ${proNum(result.packs, 0)}`,
        `${s.leftInLastPack}: ${proNum(result.leftInLastPack, 0)}`,
        ...(result.amount === undefined ? [] : [`${s.amount}: ${proNum(result.amount, 2)}`]),
        s.impositionNote,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.pages} value={pages} onChange={setPages} />
      <ToolInput label={s.copies} value={copies} onChange={setCopies} />
      <ToolSelect<"yes" | "no">
        label={s.duplex}
        value={duplexChoice}
        onChange={setDuplexChoice}
        options={[
          { id: "no", label: s.duplexNo },
          { id: "yes", label: s.duplexYes },
        ]}
      />
      <ToolInput label={s.sheetsPerPack} hint={s.sheetsPerPackHint} value={sheetsPerPack} onChange={setSheetsPerPack} />
      <ToolInput label={s.price} hint={s.priceHint} value={priceText} onChange={setPriceText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.sheetsPerCopy} value={proNum(result.sheetsPerCopy, 0)} />
          <ResultRow label={s.totalPages} value={proNum(result.totalPages, 0)} />
          <ResultRow label={s.totalSheets} value={proNum(result.totalSheets, 0)} />
          <ResultRow label={s.blankBacks} value={proNum(result.blankBacks, 0)} />
          <ResultRow label={s.packs} value={proNum(result.packs, 0)} />
          <ResultRow label={s.leftInLastPack} value={proNum(result.leftInLastPack, 0)} />
          {result.amount !== undefined && <ResultRow label={s.amount} value={proNum(result.amount, 2)} />}
          <p className="nx-hint nx-hint--prose">{s.impositionNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.pages, value: pages.trim() },
              { label: s.copies, value: copies.trim() },
              { label: s.duplex, value: duplexChoice === "yes" ? s.duplexYes : s.duplexNo },
              { label: s.sheetsPerPack, value: sheetsPerPack.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------ topic hour allocation -- */

/** A lesson allocation shared out over topics by weight, in whole hours that add up exactly. */
export function TopicHourAllocationTool() {
  const s = strings.pro.prosveta["topic-hour-allocation"];
  const [totalHoursText, setTotalHoursText] = useState("");
  const [topicsText, setTopicsText] = useState("");

  const topicRows = splitLines(topicsText).map(splitFields);
  const names = topicRows.map((fields) => fields[0] ?? "");
  const weights = topicRows.map((fields) => proParse(fields[1] ?? "") ?? Number.NaN);

  const typed = totalHoursText.trim() !== "" || topicsText.trim() !== "";
  const result = topicHourAllocation({ totalHours: proParse(totalHoursText) ?? Number.NaN, weights });

  const errors: Readonly<Record<string, string>> = {
    totalHours: s.errorTotalHours,
    weights: s.errorWeights,
    tooManyRows: s.errorTooManyRows,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorTotalHours;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${names[row.index] ?? ""}: ${proNum(row.quota, 2)} → ${proNum(row.hours, 0)} (${proNum(row.share, 2)} %)${row.extraHour ? ` [${s.extraHourMark}]` : ""}`,
        ),
        `${s.checkSum}: ${proNum(result.checkSum, 0)}`,
        `${s.extraHourCount}: ${proNum(result.extraHourCount, 0)}`,
        s.methodNote,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.totalHours} value={totalHoursText} onChange={setTotalHoursText} />
      <ToolTextArea label={s.topics} hint={s.topicsHint} value={topicsText} onChange={setTopicsText} rows={6} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colName, s.colQuota, s.colHours, s.colShare, s.colExtraHour]}
            prose={[0]}
            rows={result.rows.map((row) => [
              names[row.index] ?? "",
              proNum(row.quota, 2),
              proNum(row.hours, 0),
              `${proNum(row.share, 2)} %`,
              row.extraHour ? s.yes : s.no,
            ])}
          />
          <ResultRow label={s.checkSum} value={proNum(result.checkSum, 0)} />
          <ResultRow label={s.extraHourCount} value={proNum(result.extraHourCount, 0)} />
          <p className="nx-hint nx-hint--prose">{s.methodNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.totalHours, value: totalHoursText.trim() },
              { label: s.topics, value: topicsText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------ weighted grade -- */

/** Components with different maxima and weights folded into one percent, and what the last one needs. */
export function WeightedGradeTool() {
  const s = strings.pro.prosveta["weighted-grade"];
  const [componentsText, setComponentsText] = useState("");
  const [totalPointsText, setTotalPointsText] = useState("");
  const [targetPercentText, setTargetPercentText] = useState("");
  const [pendingName, setPendingName] = useState("");
  const [pendingMaxText, setPendingMaxText] = useState("");
  const [pendingWeightText, setPendingWeightText] = useState("");

  const componentRows = splitLines(componentsText).map(splitFields);
  const names = componentRows.map((fields) => fields[0] ?? "");
  const components: readonly WeightedComponent[] = componentRows.map((fields) => ({
    scored: proParse(fields[1] ?? "") ?? Number.NaN,
    max: proParse(fields[2] ?? "") ?? Number.NaN,
    weight: proParse(fields[3] ?? "") ?? Number.NaN,
  }));
  const pending: PendingComponent | undefined =
    pendingMaxText.trim() === "" && pendingWeightText.trim() === ""
      ? undefined
      : { max: proParse(pendingMaxText) ?? Number.NaN, weight: proParse(pendingWeightText) ?? Number.NaN };

  const typed = componentsText.trim() !== "";
  const result = weightedGrade({
    components,
    totalPoints: totalPointsText.trim() === "" ? undefined : proParse(totalPointsText) ?? Number.NaN,
    targetPercent: targetPercentText.trim() === "" ? undefined : proParse(targetPercentText) ?? Number.NaN,
    pending,
  });

  const errors: Readonly<Record<string, string>> = {
    components: s.errorComponents,
    tooManyRows: s.errorTooManyRows,
    componentMax: s.errorComponentMax,
    componentScored: s.errorComponentScored,
    componentWeight: s.errorComponentWeight,
    pendingMax: s.errorPendingMax,
    pendingWeight: s.errorPendingWeight,
    weights: s.errorWeights,
    totalPoints: s.errorTotalPoints,
    targetPercent: s.errorTargetPercent,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorComponents;

  const outcomeLabel: Readonly<Record<TargetOutcome, string>> = {
    reachable: s.outcomeReachable,
    alreadyMet: s.outcomeAlreadyMet,
    unreachable: s.outcomeUnreachable,
  };

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) => `${names[row.index] ?? ""}: ${proNum(row.percent, 2)} % (${s.weight} ${proNum(row.normalizedWeight, 2)} %)`,
        ),
        `${s.totalPercent}: ${proNum(result.totalPercent, 2)} %${pending !== undefined ? ` (${s.lowerBoundNote})` : ""}`,
        ...(result.mappedPoints === undefined ? [] : [`${s.mappedPoints}: ${proNum(result.mappedPoints, 2)}`]),
        ...(result.pending === undefined
          ? []
          : [`${s.pendingWeight}: ${proNum(result.pending.weightPercent, 2)} %`]),
        ...(result.pending?.target === undefined
          ? []
          : [
              `${s.targetOutcome}: ${outcomeLabel[result.pending.target.outcome]}`,
              `${s.requiredPoints}: ${proNum(result.pending.target.requiredPoints, 2)}`,
            ]),
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.components} hint={s.componentsHint} value={componentsText} onChange={setComponentsText} rows={6} />
      <ToolInput label={s.totalPoints} hint={s.totalPointsHint} value={totalPointsText} onChange={setTotalPointsText} />
      <ToolInput label={s.targetPercent} value={targetPercentText} onChange={setTargetPercentText} />
      <ToolInput label={s.pendingName} value={pendingName} onChange={setPendingName} />
      <ToolInput label={s.pendingMax} value={pendingMaxText} onChange={setPendingMaxText} />
      <ToolInput label={s.pendingWeight} value={pendingWeightText} onChange={setPendingWeightText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colName, s.colPercent, s.colWeight]}
            prose={[0]}
            rows={result.rows.map((row) => [names[row.index] ?? "", `${proNum(row.percent, 2)} %`, `${proNum(row.normalizedWeight, 2)} %`])}
          />
          <ResultRow label={s.totalPercent} value={`${proNum(result.totalPercent, 2)} %`} />
          {pending !== undefined && <p className="nx-hint nx-hint--prose">{s.lowerBoundNote}</p>}
          {result.mappedPoints !== undefined && <ResultRow label={s.mappedPoints} value={proNum(result.mappedPoints, 2)} />}
          {result.pending !== undefined && (
            <ResultRow label={s.pendingWeight} value={`${proNum(result.pending.weightPercent, 2)} %`} />
          )}
          {result.pending?.target !== undefined && (
            <>
              <ResultRow label={s.targetOutcome} value={outcomeLabel[result.pending.target.outcome]} />
              <ResultRow
                label={s.requiredPoints}
                value={proNum(result.pending.target.requiredPoints, 2)}
              />
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.components, value: componentsText.trim() },
              ...(pending === undefined
                ? []
                : [{ label: s.pendingName, value: `${pendingName.trim()} (${pendingMaxText.trim()}; ${pendingWeightText.trim()})` }]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ---------------------------------------------------------- combinatorics -- */

/** Factorial, variations and combinations, with and without repetition, in exact bigints. */
export function CombinatoricsTool() {
  const s = strings.pro.prosveta.combinatorics;
  const [n, setN] = useState("");
  const [k, setK] = useState("");
  const [repeatsText, setRepeatsText] = useState("");

  const typed = proParse(n) !== undefined || proParse(k) !== undefined;
  const repeats =
    repeatsText.trim() === ""
      ? undefined
      : repeatsText
          .split(/[\s,;]+/)
          .filter((token) => token.length > 0)
          .map((token) => proParse(token) ?? Number.NaN);

  const result = combinatorics({ n: proParse(n) ?? Number.NaN, k: proParse(k) ?? Number.NaN, repeats });

  const errors: Readonly<Record<string, string>> = {
    n: s.errorN,
    k: s.errorK,
    repeats: s.errorRepeats,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorN;

  const copyText = !result.ok
    ? ""
    : [
        `${s.factorial}: ${formatBigInt(result.factorial)}`,
        `${s.variations}: ${formatBigInt(result.variations)}`,
        `${s.combinations}: ${formatBigInt(result.combinations)}`,
        `${s.variationsWithRepetition}: ${formatBigInt(result.variationsWithRepetition)}`,
        `${s.combinationsWithRepetition}: ${formatBigInt(result.combinationsWithRepetition)}`,
        ...(result.permutationsWithRepetition === undefined
          ? []
          : [`${s.permutationsWithRepetition}: ${formatBigInt(result.permutationsWithRepetition)}`]),
        `${s.factorialDigits}: ${proNum(result.factorialDigits, 0)}`,
        "",
        `n = ${n.trim()}, k = ${k.trim()}`,
        ...(repeatsText.trim() === "" ? [] : [`${s.repeats}: ${repeatsText.trim()}`]),
      ].join("\n");

  return (
    <>
      <ToolInput label={s.n} hint={s.nHint} value={n} onChange={setN} />
      <ToolInput label={s.k} hint={s.kHint} value={k} onChange={setK} />
      <ToolInput label={s.repeats} hint={s.repeatsHint} value={repeatsText} onChange={setRepeatsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.factorial} value={formatBigInt(result.factorial)} />
          <ResultRow label={s.variations} value={formatBigInt(result.variations)} />
          <ResultRow label={s.combinations} value={formatBigInt(result.combinations)} />
          <ResultRow label={s.variationsWithRepetition} value={formatBigInt(result.variationsWithRepetition)} />
          <ResultRow label={s.combinationsWithRepetition} value={formatBigInt(result.combinationsWithRepetition)} />
          {result.permutationsWithRepetition !== undefined && (
            <ResultRow label={s.permutationsWithRepetition} value={formatBigInt(result.permutationsWithRepetition)} />
          )}
          <ResultRow label={s.factorialDigits} value={proNum(result.factorialDigits, 0)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.n, value: n.trim() },
              { label: s.k, value: k.trim() },
              ...(repeatsText.trim() === "" ? [] : [{ label: s.repeats, value: repeatsText.trim() }]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* --------------------------------------------------- fractions & decimals -- */

const FRACTION_OPERATIONS: readonly { readonly id: FractionOperation; readonly label: string }[] = [
  { id: "+", label: "+" },
  { id: "-", label: "−" },
  { id: "*", label: "×" },
  { id: "/", label: "÷" },
];

/** One operation on two fractions, or a periodic decimal converted back — reduced, exact, never rounded mid-way. */
export function FractionsDecimalsTool() {
  const s = strings.pro.prosveta["fractions-decimals"];
  const [mode, setMode] = useState<"compute" | "convert">("compute");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [operation, setOperation] = useState<FractionOperation>("+");
  const [c, setC] = useState("");
  const [d, setD] = useState("");
  const [decimalText, setDecimalText] = useState("");

  const typed =
    mode === "compute"
      ? proParse(a) !== undefined || proParse(b) !== undefined || proParse(c) !== undefined || proParse(d) !== undefined
      : decimalText.trim() !== "";

  const decimalNotation = parseDecimalNotation(decimalText);
  const result =
    mode === "compute"
      ? fractionArithmetic({
          a: proParse(a) ?? Number.NaN,
          b: proParse(b) ?? Number.NaN,
          operation,
          c: proParse(c) ?? Number.NaN,
          d: proParse(d) ?? Number.NaN,
        })
      : decimalToFraction(
          decimalNotation ?? { negative: false, integerDigits: "", nonRepeatingDigits: "", repeatingDigits: "" },
        );

  const errors: Readonly<Record<string, string>> = {
    a: s.errorA,
    b: s.errorB,
    c: s.errorC,
    d: s.errorD,
    operation: s.errorOperation,
    integerDigits: s.errorDecimalNotation,
    nonRepeatingDigits: s.errorDecimalNotation,
    repeatingDigits: s.errorDecimalNotation,
    digits: s.errorDecimalNotation,
  };
  const failure =
    result.ok || !typed
      ? undefined
      : mode === "convert" && decimalNotation === undefined
        ? s.errorDecimalNotation
        : errors[result.reason] ?? s.errorA;

  const mixedRow =
    result.ok && result.mixedWhole !== 0n
      ? `${formatBigInt(result.mixedWhole)} ${formatBigInt(result.mixedNumerator)}/${formatBigInt(result.denominator)}`
      : undefined;

  const copyText = !result.ok
    ? ""
    : [
        `${s.reducedFraction}: ${formatBigInt(result.numerator)}/${formatBigInt(result.denominator)}`,
        ...(mixedRow === undefined ? [] : [`${s.mixedNumber}: ${mixedRow}`]),
        result.decimal === undefined
          ? `${s.decimalResult}: ${s.decimalTooLong}`
          : `${s.decimalResult}: ${formatDecimal(result.decimal)} (${s.decimalLengths} ${proNum(result.decimal.nonRepeatingLength, 0)} / ${proNum(result.decimal.repeatingLength, 0)})`,
        result.percent === undefined
          ? `${s.percent}: —`
          : `${s.percent}: ${proNum(result.percent, 2)} %${result.percentIsApproximate ? ` (${s.percentApprox})` : ""}`,
        "",
        mode === "compute"
          ? `${a.trim()}/${b.trim()} ${operation} ${c.trim()}/${d.trim()}`
          : `${s.decimalInput}: ${decimalText.trim()}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<"compute" | "convert">
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "compute", label: s.modeCompute },
          { id: "convert", label: s.modeConvert },
        ]}
      />
      {mode === "compute" ? (
        <>
          <ToolInput label={s.a} value={a} onChange={setA} />
          <ToolInput label={s.b} value={b} onChange={setB} />
          <ToolSelect<FractionOperation> label={s.operation} value={operation} onChange={setOperation} options={FRACTION_OPERATIONS} />
          <ToolInput label={s.c} value={c} onChange={setC} />
          <ToolInput label={s.d} value={d} onChange={setD} />
        </>
      ) : (
        <ToolInput label={s.decimalInput} hint={s.decimalInputHint} value={decimalText} onChange={setDecimalText} placeholder="0,1(6)" />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.reducedFraction} value={`${formatBigInt(result.numerator)}/${formatBigInt(result.denominator)}`} />
          {mixedRow !== undefined && <ResultRow label={s.mixedNumber} value={mixedRow} />}
          <ResultRow
            label={s.decimalResult}
            value={result.decimal === undefined ? s.decimalTooLong : formatDecimal(result.decimal)}
          />
          {result.decimal !== undefined && (
            <ResultRow
              label={s.decimalLengths}
              value={`${proNum(result.decimal.nonRepeatingLength, 0)} / ${proNum(result.decimal.repeatingLength, 0)}`}
            />
          )}
          <ResultRow
            label={s.percent}
            value={result.percent === undefined ? "—" : `${proNum(result.percent, 2)} %`}
          />
          {result.percentIsApproximate && result.percent !== undefined && (
            <p className="nx-hint nx-hint--prose">{s.percentApprox}</p>
          )}
          <ToolFormula>{mode === "compute" ? s.formulaCompute : s.formulaConvert}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={
              mode === "compute"
                ? [
                    { label: s.a, value: a.trim() },
                    { label: s.b, value: b.trim() },
                    { label: s.operation, value: operation },
                    { label: s.c, value: c.trim() },
                    { label: s.d, value: d.trim() },
                  ]
                : [{ label: s.decimalInput, value: decimalText.trim() }]
            }
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ----------------------------------------------------- guessing correction -- */

/** The classical guessing correction `S = R − W/(k−1)`, and what pure guessing would score. */
export function GuessingCorrectionTool() {
  const s = strings.pro.prosveta["guessing-correction"];
  const [questions, setQuestions] = useState("");
  const [right, setRight] = useState("");
  const [wrong, setWrong] = useState("");
  const [unanswered, setUnanswered] = useState("");
  const [options, setOptions] = useState("");
  const [pointsText, setPointsText] = useState("");

  const typed =
    questions.trim() !== "" || right.trim() !== "" || wrong.trim() !== "" || unanswered.trim() !== "" || options.trim() !== "";
  const result = guessingCorrection({
    questions: proParse(questions) ?? Number.NaN,
    right: proParse(right) ?? Number.NaN,
    wrong: proParse(wrong) ?? Number.NaN,
    unanswered: proParse(unanswered) ?? Number.NaN,
    options: proParse(options) ?? Number.NaN,
    pointsPerQuestion: pointsText.trim() === "" ? 1 : proParse(pointsText) ?? Number.NaN,
  });

  const errors: Readonly<Record<string, string>> = {
    questions: s.errorQuestions,
    right: s.errorRight,
    wrong: s.errorWrong,
    unanswered: s.errorUnanswered,
    options: s.errorOptions,
    pointsPerQuestion: s.errorPoints,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorQuestions;

  const copyText = !result.ok
    ? ""
    : [
        `${s.corrected}: ${proNum(result.corrected, 2)}`,
        `${s.points}: ${proNum(result.points, 2)}`,
        `${s.percentOfMax}: ${proNum(result.percentOfMax, 2)} %`,
        `${s.expectedBefore}: ${proNum(result.expectedCorrectBeforeCorrection, 2)}`,
        `${s.expectedAfter}: ${proNum(result.expectedAfterCorrection, 2)}`,
        `${s.answeredMismatch}: ${proNum(result.answeredMismatch, 0)}`,
        "",
        `Q=${questions.trim()}, R=${right.trim()}, W=${wrong.trim()}, U=${unanswered.trim()}, k=${options.trim()}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.questions} value={questions} onChange={setQuestions} />
      <ToolInput label={s.right} value={right} onChange={setRight} />
      <ToolInput label={s.wrong} value={wrong} onChange={setWrong} />
      <ToolInput label={s.unanswered} value={unanswered} onChange={setUnanswered} />
      <ToolInput label={s.options} hint={s.optionsHint} value={options} onChange={setOptions} />
      <ToolInput label={s.points} hint={s.pointsHint} value={pointsText} onChange={setPointsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.corrected} value={proNum(result.corrected, 2)} />
          <ResultRow label={s.points} value={proNum(result.points, 2)} />
          <ResultRow label={s.percentOfMax} value={`${proNum(result.percentOfMax, 2)} %`} />
          <ResultRow label={s.expectedBefore} value={proNum(result.expectedCorrectBeforeCorrection, 2)} />
          <ResultRow label={s.expectedAfter} value={proNum(result.expectedAfterCorrection, 2)} />
          {result.answeredMismatch !== 0 && (
            <ResultRow label={s.answeredMismatch} value={proNum(result.answeredMismatch, 0)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.questions, value: questions.trim() },
              { label: s.right, value: right.trim() },
              { label: s.wrong, value: wrong.trim() },
              { label: s.unanswered, value: unanswered.trim() },
              { label: s.options, value: options.trim() },
              { label: s.points, value: proNum(pointsText.trim() === "" ? 1 : proParse(pointsText) ?? 0, 2) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ---------------------------------------------------------- item analysis -- */

/** Facility (higher = easier) and, for a user-drawn split, the discrimination between two groups. */
export function ItemAnalysisTool() {
  const s = strings.pro.prosveta["item-analysis"];
  const [correct, setCorrect] = useState("");
  const [students, setStudents] = useState("");
  const [unanswered, setUnanswered] = useState("");
  const [treatment, setTreatment] = useState<"asIncorrect" | "excluded">("excluded");
  const [upperCorrect, setUpperCorrect] = useState("");
  const [upperSize, setUpperSize] = useState("");
  const [lowerCorrect, setLowerCorrect] = useState("");
  const [lowerSize, setLowerSize] = useState("");

  const typed = correct.trim() !== "" || students.trim() !== "";
  const unansweredValue = unanswered.trim() === "" ? undefined : proParse(unanswered) ?? Number.NaN;
  const upper: ItemGroup | undefined =
    upperCorrect.trim() === "" && upperSize.trim() === ""
      ? undefined
      : { correct: proParse(upperCorrect) ?? Number.NaN, size: proParse(upperSize) ?? Number.NaN };
  const lower: ItemGroup | undefined =
    lowerCorrect.trim() === "" && lowerSize.trim() === ""
      ? undefined
      : { correct: proParse(lowerCorrect) ?? Number.NaN, size: proParse(lowerSize) ?? Number.NaN };

  const result = itemAnalysis({
    correct: proParse(correct) ?? Number.NaN,
    students: proParse(students) ?? Number.NaN,
    unanswered: unansweredValue,
    unansweredTreatment: unansweredValue === undefined ? undefined : treatment,
    upper,
    lower,
  });

  const errors: Readonly<Record<string, string>> = {
    students: s.errorStudents,
    correct: s.errorCorrect,
    unansweredTreatment: s.errorUnansweredTreatment,
    unanswered: s.errorUnanswered,
    upper: s.errorUpper,
    lower: s.errorLower,
    groups: s.errorGroups,
  };
  const failure = result.ok || !typed ? undefined : errors[result.reason] ?? s.errorStudents;

  const copyText = !result.ok
    ? ""
    : [
        `${s.facility}: ${proNum(result.facility, 3)} (${proNum(result.facilityPercent, 2)} %) — ${correct.trim()}/${students.trim()}`,
        `${s.n}: ${proNum(result.n, 0)}`,
        ...(result.upperRate === undefined ? [] : [`${s.upperRate}: ${proNum(result.upperRate, 3)}`]),
        ...(result.lowerRate === undefined ? [] : [`${s.lowerRate}: ${proNum(result.lowerRate, 3)}`]),
        ...(result.discrimination === undefined ? [] : [`${s.discrimination}: ${proNum(result.discrimination, 2)}`]),
        ...(result.groupCoveragePercent === undefined
          ? []
          : [`${s.groupCoverage}: ${proNum(result.groupCoveragePercent, 2)} %`]),
      ].join("\n");

  return (
    <>
      <ToolInput label={s.correct} value={correct} onChange={setCorrect} />
      <ToolInput label={s.students} hint={s.studentsHint} value={students} onChange={setStudents} />
      <ToolInput label={s.unanswered} hint={s.unansweredHint} value={unanswered} onChange={setUnanswered} />
      <ToolSelect<"asIncorrect" | "excluded">
        label={s.treatment}
        value={treatment}
        onChange={setTreatment}
        options={[
          { id: "asIncorrect", label: s.treatmentAsIncorrect },
          { id: "excluded", label: s.treatmentExcluded },
        ]}
      />
      <ToolInput label={s.upperCorrect} value={upperCorrect} onChange={setUpperCorrect} />
      <ToolInput label={s.upperSize} value={upperSize} onChange={setUpperSize} />
      <ToolInput label={s.lowerCorrect} value={lowerCorrect} onChange={setLowerCorrect} />
      <ToolInput label={s.lowerSize} value={lowerSize} onChange={setLowerSize} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.facility} value={`${proNum(result.facility, 3)} (${proNum(result.facilityPercent, 2)} %)`} />
          <ResultRow label={s.n} value={proNum(result.n, 0)} />
          {result.upperRate !== undefined && <ResultRow label={s.upperRate} value={proNum(result.upperRate, 3)} />}
          {result.lowerRate !== undefined && <ResultRow label={s.lowerRate} value={proNum(result.lowerRate, 3)} />}
          {result.discrimination !== undefined && (
            <ResultRow label={s.discrimination} value={proNum(result.discrimination, 2)} />
          )}
          {result.groupCoveragePercent !== undefined && (
            <ResultRow label={s.groupCoverage} value={`${proNum(result.groupCoveragePercent, 2)} %`} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.correct, value: correct.trim() },
              { label: s.students, value: students.trim() },
              ...(unansweredValue === undefined
                ? []
                : [{ label: s.treatment, value: treatment === "asIncorrect" ? s.treatmentAsIncorrect : s.treatmentExcluded }]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ surfaces -- */

export const PROSVETA_SURFACES: Readonly<Record<string, ComponentType>> = {
  "average-to-target": AverageToTargetTool,
  "child-age": ChildAgeTool,
  combinatorics: CombinatoricsTool,
  "fractions-decimals": FractionsDecimalsTool,
  "grade-scale-points": GradeScalePointsTool,
  "grade-statistics": GradeStatisticsTool,
  "guessing-correction": GuessingCorrectionTool,
  "item-analysis": ItemAnalysisTool,
  "lesson-count-period": LessonCountPeriodTool,
  "lesson-timeline": LessonTimelineTool,
  "split-into-groups": SplitIntoGroupsTool,
  "standard-score": StandardScoreTool,
  "test-printing": TestPrintingTool,
  "topic-hour-allocation": TopicHourAllocationTool,
  "weighted-grade": WeightedGradeTool,
};
