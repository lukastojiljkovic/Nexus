import {
  allocateWithoutRemainder,
  type AllocationItem,
  type AllocationMode,
  amountInWords,
  type AmountWordsMode,
  type CurrencyNoun,
  type LetterCase,
  type NumberGender,
  type ParaStyle,
  domesticAccountCheck,
  ibanCheck,
  benfordDigits,
  type BenfordDigitTest,
  type DecimalSeparator,
  type NegativeHandling,
  breakevenPoint,
  identifierCheckDigit,
  type IdentifierKind,
  depreciationSchedule,
  type CivilDate,
  type DepreciationMethod,
  type FirstYearProration,
  financialRatios,
  type DaysBasis,
  fxDifference,
  crossRate,
  type BalanceSide,
  type CrossDirection,
  type FxRateUnit,
  grossFromNet,
  type GrossUpModel,
  interestByPeriods,
  type DayCount,
  type InterestMethod,
  type InterestPeriod,
  inventoryCosting,
  type AverageMode,
  type InventoryMethodResult,
  type InventoryMovement,
  type MovementType,
  loanSchedule,
  type LoanFrequency,
  type LoanPlan,
  type PeriodicRateMethod,
  rateConversion,
  type RateKind,
  type TargetPeriod,
  priceMargin,
  rebateChain,
  type PricePair,
  trialBalance,
  trialBalanceDiagnostics,
  tvmSolve,
  type PaymentTiming,
  type TvmUnknown,
} from "@nexus/core/pro/racunovodstvo";
import { minorUnits } from "@nexus/core/pro/result";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import {
  CopyButton,
  proRows,
  reasonField,
  ResultRow,
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
 * „Računovodstvo i finansije" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/racunovodstvo.ts`'s. This file shapes
 * fields, converts a typed row of text into the shape a core function takes,
 * and prints the answer — it never divides, rounds or compares two computed
 * quantities against each other.
 *
 * **Every tool in this pack is `riskClass: "financial"`** (bar the Benford
 * test, which is `"none"`), never `life-safety` or `food-safety`, so nothing
 * here is bound by `toolForbidsVerdict` — and none of these seventeen tools
 * has a regulated LIMIT the assignment calls out as a user input, so
 * `ToolAgainstLimit` does not appear in this file. What is still owed on every
 * tool is the other three: the formula, the inputs echoed back, and a copy
 * button carrying both.
 */

/**
 * A flat pasted list of amounts, one per line (or split on `;`/tab) — the
 * shape `trialBalance`'s two columns and `rebateChain`'s rebate list both
 * take. An unparsable line becomes `NaN`, which the core function's own
 * `Number.isFinite` guard then refuses by name; this function never decides
 * what counts as a valid amount, it only splits text apart.
 */
function proAmountList(text: string): readonly number[] {
  return text
    .split(/[\n\r;\t]/)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "")
    .map((cell) => proParse(cell) ?? Number.NaN);
}

/**
 * A date typed as `DD.MM.GGGG` (a trailing dot, as Serbian dates are usually
 * written, is tolerated). Three `proParse` calls and a split — the inverse of
 * no formatter in this file, since nothing here ever PRINTS a `CivilDate` in
 * this notation; `ToolInputEcho` shows the day/month/year cells `proNum`
 * already knows how to format instead.
 */
function proDate(text: string): CivilDate | undefined {
  const cleaned = text.trim().replace(/\.$/, "");
  const cells = cleaned.split(".");
  if (cells.length !== 3) return undefined;
  const day = proParse(cells[0] ?? "");
  const month = proParse(cells[1] ?? "");
  const year = proParse(cells[2] ?? "");
  if (day === undefined || month === undefined || year === undefined) return undefined;
  return { day, month, year };
}

/** A value the user may not have typed yet, formatted or shown as an em dash. */
function proMaybe(value: number | undefined, digits = 2): string {
  return value === undefined ? "—" : proNum(value, digits);
}

/**
 * A sum split by a key, or into n equal parts, so the shares always add back
 * up to exactly the whole — the largest-remainder method, worked in whole
 * minor units by `allocateWithoutRemainder`. Which rows took the leftover
 * minor unit is named, not just counted, because that is what makes the split
 * checkable a second time.
 */
export function AllocationRemainderTool() {
  const s = strings.pro.racunovodstvo["allocation-remainder"];
  const [totalText, setTotalText] = useState("");
  const [mode, setMode] = useState<AllocationMode>("byKey");
  const [itemsText, setItemsText] = useState("");
  const [partsText, setPartsText] = useState("");
  const [decimalsText, setDecimalsText] = useState("2");

  const rows = proRows(itemsText);
  const items: AllocationItem[] = rows.map((row) => ({
    name: row[0] ?? "",
    key: proParse(row[1] ?? "") ?? Number.NaN,
  }));
  const typed = proParse(totalText) !== undefined || rows.length > 0 || proParse(partsText) !== undefined;

  const result = allocateWithoutRemainder({
    total: proParse(totalText) ?? Number.NaN,
    ...(items.length > 0 ? { items } : {}),
    parts: proParse(partsText),
    decimals: proParse(decimalsText) ?? 2,
    mode,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "total"
        ? s.errorTotal
        : field === "decimals"
          ? s.errorDecimals
          : field === "parts"
            ? s.errorParts
            : s.errorItems;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row, index) =>
            `${row.name === "" ? `#${index + 1}` : row.name}: ${s.key} ${proNum(row.key, 2)} · ${s.allocated} ${proNum(row.allocated, 2)}${row.bumped ? ` (${s.bumped})` : ""}`,
        ),
        "",
        `${s.allocatedTotal}: ${proNum(result.allocatedTotal, 2)}`,
        `${s.adjustedCount}: ${result.adjustedCount}`,
        "",
        `${s.total}: ${proNum(proParse(totalText) ?? 0, 2)}`,
        `${s.mode}: ${mode === "byKey" ? s.modeByKey : s.modeEqual}`,
        `${s.decimals}: ${decimalsText.trim()}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.total} value={totalText} onChange={setTotalText} />
      <ToolSelect<AllocationMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        hint={s.modeHint}
        options={[
          { id: "byKey", label: s.modeByKey },
          { id: "equal", label: s.modeEqual },
        ]}
      />
      <ToolTextArea
        label={s.items}
        hint={mode === "byKey" ? s.itemsHint : s.itemsHintEqual}
        value={itemsText}
        onChange={setItemsText}
        placeholder={s.itemsPlaceholder}
      />
      {mode === "equal" && (
        <ToolInput label={s.parts} hint={s.partsHint} value={partsText} onChange={setPartsText} />
      )}
      <ToolInput label={s.decimals} hint={s.decimalsHint} value={decimalsText} onChange={setDecimalsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colName, s.colKey, s.colKeyShare, s.colExact, s.colAllocated, s.colAllocatedShare, s.colRounding, s.colRank]}
            rows={result.rows.map((row, index) => [
              row.name === "" ? `#${index + 1}` : row.name,
              proNum(row.key, 2),
              `${proNum(row.keySharePercent, 4)} %`,
              proNum(row.exact, decimalsFromText(decimalsText)),
              proNum(row.allocated, decimalsFromText(decimalsText)),
              row.allocatedSharePercent === undefined ? "—" : `${proNum(row.allocatedSharePercent, 4)} %`,
              proNum(row.rounding, decimalsFromText(decimalsText)),
              row.remainderRank === undefined ? "—" : String(row.remainderRank),
            ])}
            prose={[0]}
          />
          <ResultRow label={s.allocatedTotal} value={proNum(result.allocatedTotal, decimalsFromText(decimalsText))} />
          <ResultRow label={s.adjustedCount} value={result.adjustedCount} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.total, value: proNum(proParse(totalText) ?? 0, 2) },
              { label: s.mode, value: mode === "byKey" ? s.modeByKey : s.modeEqual },
              { label: s.decimals, value: decimalsText.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** `decimalsText` read back as the digit count it names, defaulting to 2 like the core function does. */
function decimalsFromText(text: string): number {
  const parsed = proParse(text);
  return parsed === undefined ? 2 : parsed;
}

/**
 * An amount spelled out in Serbian, with a currency (and, in `"words"` mode,
 * a subunit) supplied as three agreement forms and a gender rather than
 * assumed to be dinars — see `amountInWords`'s own note on why „dinar/para"
 * cannot be a default once a currency is a parameter at all.
 *
 * **`cents` is bridged here, not computed.** `amountInWords` takes whole
 * minor units; the field takes a decimal amount. Turning „1.234,56" into
 * 123456 is unit bookkeeping, the same category as the exemplar's mm→m
 * division, not the tool's own arithmetic — but a THIRD decimal has to be
 * REFUSED rather than rounded away (the core module's own contract).
 *
 * The bridge is `minorUnits` from the shared kit and was briefly written here
 * by hand, as `Math.abs(amount*100 − Math.round(amount*100)) > 1e-6`. That
 * literal is an absolute tolerance on a value whose representation error grows
 * with its magnitude: above 2^27 it began refusing ordinary money, about one
 * legal two-decimal amount in eight past 10^8. The kit's tolerance scales.
 */
export function AmountInWordsTool() {
  const s = strings.pro.racunovodstvo["amount-in-words"];
  const [amountText, setAmountText] = useState("");
  const [mode, setMode] = useState<AmountWordsMode>("withCurrency");
  const [currencySingular, setCurrencySingular] = useState("");
  const [currencyPaucal, setCurrencyPaucal] = useState("");
  const [currencyPlural, setCurrencyPlural] = useState("");
  const [currencyGender, setCurrencyGender] = useState<NumberGender>("masculine");
  const [paraStyle, setParaStyle] = useState<ParaStyle>("words");
  const [subunitSingular, setSubunitSingular] = useState("");
  const [subunitPaucal, setSubunitPaucal] = useState("");
  const [subunitPlural, setSubunitPlural] = useState("");
  const [subunitGender, setSubunitGender] = useState<NumberGender>("feminine");
  const [plainGender, setPlainGender] = useState<NumberGender>("masculine");
  const [letterCase, setLetterCase] = useState<LetterCase>("lower");

  // Built here rather than at module scope: these are three words of Serbian,
  // and a module-scope literal is copy the strings table cannot reach and a
  // language switch cannot relabel.
  const genderOptions: readonly { readonly id: NumberGender; readonly label: string }[] = [
    { id: "masculine", label: s.genderMasculine },
    { id: "feminine", label: s.genderFeminine },
    { id: "neuter", label: s.genderNeuter },
  ];

  const parsedAmount = proParse(amountText);
  const typed = parsedAmount !== undefined;
  const parsedCents = parsedAmount === undefined ? undefined : minorUnits(parsedAmount, 2);
  const centsHasThirdDecimal = parsedAmount !== undefined && parsedCents === undefined;
  const cents = parsedCents ?? Number.NaN;

  const currency: CurrencyNoun = {
    singular: currencySingular.trim(),
    paucal: currencyPaucal.trim(),
    plural: currencyPlural.trim(),
  };
  const subunit: CurrencyNoun = {
    singular: subunitSingular.trim(),
    paucal: subunitPaucal.trim(),
    plural: subunitPlural.trim(),
  };

  const result = centsHasThirdDecimal
    ? undefined
    : amountInWords({
        cents,
        mode,
        ...(mode === "withCurrency" ? { currency, currencyGender } : {}),
        ...(mode === "withCurrency" && paraStyle === "words" ? { subunit, subunitGender } : {}),
        ...(mode === "plain" ? { plainGender } : {}),
        paraStyle,
        letterCase,
      });

  const field = result === undefined || result.ok ? undefined : reasonField(result.reason);
  const failure = centsHasThirdDecimal
    ? s.errorAmountDecimals
    : result === undefined || result.ok || !typed
      ? undefined
      : field === "currency"
        ? s.errorCurrency
        : field === "currencyGender"
          ? s.errorCurrencyGender
          : field === "subunit"
            ? s.errorSubunit
            : field === "subunitGender"
              ? s.errorSubunitGender
              : s.errorCents;

  const copyText = result === undefined || !result.ok
    ? ""
    : [
        `${s.resultText}: ${result.text}`,
        `${s.resultWhole}: ${proNum(result.whole, 0)}`,
        `${s.resultSubunits}: ${proNum(result.subunits, 0)}`,
        "",
        `${s.amount}: ${proNum(parsedAmount ?? 0, 2)}`,
        `${s.mode}: ${mode === "withCurrency" ? s.modeWithCurrency : s.modePlain}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.amount} hint={s.amountHint} value={amountText} onChange={setAmountText} />
      <ToolSelect<AmountWordsMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "withCurrency", label: s.modeWithCurrency },
          { id: "plain", label: s.modePlain },
        ]}
      />
      {mode === "withCurrency" ? (
        <>
          <ToolInput label={s.currencySingular} hint={s.currencySingularHint} value={currencySingular} onChange={setCurrencySingular} />
          <ToolInput label={s.currencyPaucal} value={currencyPaucal} onChange={setCurrencyPaucal} />
          <ToolInput label={s.currencyPlural} value={currencyPlural} onChange={setCurrencyPlural} />
          <ToolSelect<NumberGender>
            label={s.currencyGender}
            value={currencyGender}
            onChange={setCurrencyGender}
            options={genderOptions}
          />
          <ToolSelect<ParaStyle>
            label={s.paraStyle}
            value={paraStyle}
            onChange={setParaStyle}
            options={[
              { id: "words", label: s.paraStyleWords },
              { id: "fraction", label: s.paraStyleFraction },
            ]}
          />
          {paraStyle === "words" && (
            <>
              <ToolInput label={s.subunitSingular} hint={s.subunitSingularHint} value={subunitSingular} onChange={setSubunitSingular} />
              <ToolInput label={s.subunitPaucal} value={subunitPaucal} onChange={setSubunitPaucal} />
              <ToolInput label={s.subunitPlural} value={subunitPlural} onChange={setSubunitPlural} />
              <ToolSelect<NumberGender>
                label={s.subunitGender}
                value={subunitGender}
                onChange={setSubunitGender}
                options={genderOptions}
              />
            </>
          )}
        </>
      ) : (
        <ToolSelect<NumberGender>
          label={s.plainGender}
          hint={s.plainGenderHint}
          value={plainGender}
          onChange={setPlainGender}
          options={genderOptions}
        />
      )}
      <ToolSelect<LetterCase>
        label={s.letterCase}
        value={letterCase}
        onChange={setLetterCase}
        options={[
          { id: "lower", label: s.letterCaseLower },
          { id: "upper", label: s.letterCaseUpper },
          { id: "sentence", label: s.letterCaseSentence },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && result.ok && (
        <ToolSection title={s.results}>
          <ToolOutput label={s.resultText} value={result.text} multiline />
          <ResultRow label={s.resultWhole} value={proNum(result.whole, 0)} />
          <ResultRow label={s.resultSubunits} value={proNum(result.subunits, 0)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <p className="tool__note">{s.source}</p>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.amount, value: proNum(parsedAmount ?? 0, 2) },
              { label: s.mode, value: mode === "withCurrency" ? s.modeWithCurrency : s.modePlain },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Every position is optional and every ratio it feeds is left blank rather
 * than computed from a guess — no averaging of an opening and closing
 * balance, no division by a zero the user left empty. Grouped by the
 * statement it comes from, since fifteen unlabelled fields in one form is a
 * wall no reviewer can check.
 */
export function FinancialRatiosTool() {
  const s = strings.pro.racunovodstvo["financial-ratios"];
  const [currentAssetsText, setCurrentAssetsText] = useState("");
  const [inventoryText, setInventoryText] = useState("");
  const [cashText, setCashText] = useState("");
  const [receivablesText, setReceivablesText] = useState("");
  const [currentLiabilitiesText, setCurrentLiabilitiesText] = useState("");
  const [payablesText, setPayablesText] = useState("");
  const [totalLiabilitiesText, setTotalLiabilitiesText] = useState("");
  const [totalAssetsText, setTotalAssetsText] = useState("");
  const [equityText, setEquityText] = useState("");
  const [revenueText, setRevenueText] = useState("");
  const [cogsText, setCogsText] = useState("");
  const [ebitText, setEbitText] = useState("");
  const [interestExpenseText, setInterestExpenseText] = useState("");
  const [netProfitText, setNetProfitText] = useState("");
  // Held as a string id because `ToolSelect<T extends string>` cannot take the
  // core function's own `365 | 360` number union — translated at the edge.
  const [daysId, setDaysId] = useState<"365" | "360">("365");
  const days: DaysBasis = daysId === "365" ? 365 : 360;

  const values = [
    currentAssetsText, inventoryText, cashText, receivablesText, currentLiabilitiesText,
    payablesText, totalLiabilitiesText, totalAssetsText, equityText, revenueText,
    cogsText, ebitText, interestExpenseText, netProfitText,
  ];
  const typed = values.some((text) => proParse(text) !== undefined);

  const result = financialRatios({
    currentAssets: proParse(currentAssetsText),
    inventory: proParse(inventoryText),
    cash: proParse(cashText),
    receivables: proParse(receivablesText),
    currentLiabilities: proParse(currentLiabilitiesText),
    payables: proParse(payablesText),
    totalLiabilities: proParse(totalLiabilitiesText),
    totalAssets: proParse(totalAssetsText),
    equity: proParse(equityText),
    revenue: proParse(revenueText),
    cogs: proParse(cogsText),
    ebit: proParse(ebitText),
    interestExpense: proParse(interestExpenseText),
    netProfit: proParse(netProfitText),
    days,
  });

  const failure = result.ok || !typed ? undefined : s.errorDays;

  const ratioLine = (label: string, value: number | undefined, digits: number, suffix = ""): string | undefined =>
    value === undefined ? undefined : `${label}: ${proNum(value, digits)}${suffix}`;

  const copyText = !result.ok
    ? ""
    : [
        ratioLine(s.currentRatio, result.currentRatio, 4),
        ratioLine(s.quickRatio, result.quickRatio, 4),
        ratioLine(s.cashRatio, result.cashRatio, 4),
        ratioLine(s.workingCapital, result.workingCapital, 2),
        ratioLine(s.debtRatio, result.debtRatio, 4),
        ratioLine(s.debtToEquity, result.debtToEquity, 4),
        ratioLine(s.interestCoverage, result.interestCoverage, 4),
        ratioLine(s.inventoryTurnover, result.inventoryTurnover, 4),
        ratioLine(s.dio, result.dio, 1, ` ${s.unitDays}`),
        ratioLine(s.dso, result.dso, 1, ` ${s.unitDays}`),
        ratioLine(s.dpo, result.dpo, 1, ` ${s.unitDays}`),
        ratioLine(s.cashConversionCycle, result.cashConversionCycle, 1, ` ${s.unitDays}`),
        ratioLine(s.assetTurnover, result.assetTurnover, 4),
        ratioLine(s.roaPercent, result.roaPercent, 4, " %"),
        ratioLine(s.roePercent, result.roePercent, 4, " %"),
        ratioLine(s.netMarginPercent, result.netMarginPercent, 4, " %"),
        ratioLine(s.ebitMarginPercent, result.ebitMarginPercent, 4, " %"),
        "",
        `${s.days}: ${days}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSection title={s.groupBalance}>
        <ToolInput label={s.currentAssets} value={currentAssetsText} onChange={setCurrentAssetsText} />
        <ToolInput label={s.inventory} hint={s.inventoryHint} value={inventoryText} onChange={setInventoryText} />
        <ToolInput label={s.cash} value={cashText} onChange={setCashText} />
        <ToolInput label={s.receivables} value={receivablesText} onChange={setReceivablesText} />
        <ToolInput label={s.currentLiabilities} value={currentLiabilitiesText} onChange={setCurrentLiabilitiesText} />
        <ToolInput label={s.payables} value={payablesText} onChange={setPayablesText} />
        <ToolInput label={s.totalLiabilities} value={totalLiabilitiesText} onChange={setTotalLiabilitiesText} />
        <ToolInput label={s.totalAssets} value={totalAssetsText} onChange={setTotalAssetsText} />
        <ToolInput label={s.equity} value={equityText} onChange={setEquityText} />
      </ToolSection>
      <ToolSection title={s.groupIncome}>
        <ToolInput label={s.revenue} value={revenueText} onChange={setRevenueText} />
        <ToolInput label={s.cogs} value={cogsText} onChange={setCogsText} />
        <ToolInput label={s.ebit} value={ebitText} onChange={setEbitText} />
        <ToolInput label={s.interestExpense} value={interestExpenseText} onChange={setInterestExpenseText} />
        <ToolInput label={s.netProfit} value={netProfitText} onChange={setNetProfitText} />
      </ToolSection>
      <ToolSelect<"365" | "360">
        label={s.days}
        value={daysId}
        onChange={setDaysId}
        hint={s.daysHint}
        options={[
          { id: "365", label: s.days365 },
          { id: "360", label: s.days360 },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.currentRatio} value={proMaybe(result.currentRatio, 4)} />
          <ResultRow label={s.quickRatio} value={proMaybe(result.quickRatio, 4)} />
          <ResultRow label={s.cashRatio} value={proMaybe(result.cashRatio, 4)} />
          <ResultRow label={s.workingCapital} value={proMaybe(result.workingCapital, 2)} />
          <ResultRow label={s.debtRatio} value={proMaybe(result.debtRatio, 4)} />
          <ResultRow label={s.debtToEquity} value={proMaybe(result.debtToEquity, 4)} />
          <ResultRow label={s.interestCoverage} value={proMaybe(result.interestCoverage, 4)} />
          <ResultRow label={s.inventoryTurnover} value={proMaybe(result.inventoryTurnover, 4)} />
          <ResultRow label={s.dio} value={proMaybe(result.dio, 1)} />
          <ResultRow label={s.dso} value={proMaybe(result.dso, 1)} />
          <ResultRow label={s.dpo} value={proMaybe(result.dpo, 1)} />
          <ResultRow label={s.cashConversionCycle} value={proMaybe(result.cashConversionCycle, 1)} />
          <ResultRow label={s.assetTurnover} value={proMaybe(result.assetTurnover, 4)} />
          <ResultRow label={s.roaPercent} value={result.roaPercent === undefined ? "—" : `${proNum(result.roaPercent, 4)} %`} />
          <ResultRow label={s.roePercent} value={result.roePercent === undefined ? "—" : `${proNum(result.roePercent, 4)} %`} />
          <ResultRow label={s.netMarginPercent} value={result.netMarginPercent === undefined ? "—" : `${proNum(result.netMarginPercent, 4)} %`} />
          <ResultRow label={s.ebitMarginPercent} value={result.ebitMarginPercent === undefined ? "—" : `${proNum(result.ebitMarginPercent, 4)} %`} />
          <p className="tool__note">{s.averageNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.days, value: days === 365 ? s.days365 : s.days360 }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * The domestic value of a foreign amount at two rates, the difference
 * between them (booked and unrounded, side by side), and — a separate
 * section — a cross rate from two quoted rates. No rate list is embedded;
 * both quotes are the user's own numbers for the dates they name.
 */
export function FxDifferenceTool() {
  const s = strings.pro.racunovodstvo["fx-difference"];
  const [amountText, setAmountText] = useState("");
  const [rateOriginText, setRateOriginText] = useState("");
  const [rateSettlementText, setRateSettlementText] = useState("");
  // Held as a string id because `ToolSelect<T extends string>` cannot take the
  // core function's own `1 | 100 | 1000` number union — translated at the edge.
  const [rateUnitId, setRateUnitId] = useState<"1" | "100" | "1000">("1");
  const rateUnit: FxRateUnit = rateUnitId === "1" ? 1 : rateUnitId === "100" ? 100 : 1000;
  const [side, setSide] = useState<BalanceSide>("receivable");
  const [amountDecimalsText, setAmountDecimalsText] = useState("2");
  const [originDayText, setOriginDayText] = useState("");
  const [originMonthText, setOriginMonthText] = useState("");
  const [originYearText, setOriginYearText] = useState("");
  const [settlementDayText, setSettlementDayText] = useState("");
  const [settlementMonthText, setSettlementMonthText] = useState("");
  const [settlementYearText, setSettlementYearText] = useState("");
  const [rateABText, setRateABText] = useState("");
  const [rateSecondText, setRateSecondText] = useState("");
  const [crossDirection, setCrossDirection] = useState<CrossDirection>("sameBase");
  const [crossDecimalsText, setCrossDecimalsText] = useState("6");

  const typed = proParse(amountText) !== undefined || proParse(rateOriginText) !== undefined;
  const dateOrigin: CivilDate = {
    day: proParse(originDayText) ?? Number.NaN,
    month: proParse(originMonthText) ?? Number.NaN,
    year: proParse(originYearText) ?? Number.NaN,
  };
  const dateSettlement: CivilDate = {
    day: proParse(settlementDayText) ?? Number.NaN,
    month: proParse(settlementMonthText) ?? Number.NaN,
    year: proParse(settlementYearText) ?? Number.NaN,
  };

  const result = fxDifference({
    amount: proParse(amountText) ?? Number.NaN,
    rateOrigin: proParse(rateOriginText) ?? Number.NaN,
    rateSettlement: proParse(rateSettlementText) ?? Number.NaN,
    rateUnit,
    side,
    amountDecimals: proParse(amountDecimalsText) ?? 2,
    dateOrigin,
    dateSettlement,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "amount"
        ? s.errorAmount
        : field === "rateOrigin"
          ? s.errorRateOrigin
          : field === "rateSettlement"
            ? s.errorRateSettlement
            : field === "amountDecimals"
              ? s.errorAmountDecimals
              : field === "dateOrigin"
                ? s.errorDateOrigin
                : s.errorDateSettlement;

  const effectLabel = (effect: "income" | "expense" | "none"): string =>
    effect === "income" ? s.effectIncome : effect === "expense" ? s.effectExpense : s.effectNone;

  // The cross rate: a separate question from a separate pair of inputs,
  // folded into this component rather than given one of its own, because
  // the assignment lists it as part of THIS tool's own input set and not as
  // a seventeenth id.
  const crossTyped = proParse(rateABText) !== undefined || proParse(rateSecondText) !== undefined;
  const crossResult = crossRate({
    rateAB: proParse(rateABText) ?? Number.NaN,
    rateSecond: proParse(rateSecondText) ?? Number.NaN,
    direction: crossDirection,
    rateDecimals: proParse(crossDecimalsText) ?? 6,
  });
  const crossField = crossResult.ok ? undefined : reasonField(crossResult.reason);
  const crossFailure =
    crossResult.ok || !crossTyped
      ? undefined
      : crossField === "rateAB"
        ? s.errorRateAB
        : crossField === "rateSecond"
          ? s.errorRateSecond
          : s.errorRateDecimals;
  const crossCopyText = !crossResult.ok
    ? ""
    : [
        `${s.crossRate}: ${proNum(crossResult.rate, proParse(crossDecimalsText) ?? 6)}`,
        "",
        `${s.rateAB}: ${proNum(proParse(rateABText) ?? 0, 6)}`,
        `${s.rateSecond}: ${proNum(proParse(rateSecondText) ?? 0, 6)}`,
        `${s.crossDirection}: ${crossDirection === "sameBase" ? s.crossDirectionSameBase : s.crossDirectionInverse}`,
      ].join("\n");

  const copyText = !result.ok
    ? ""
    : [
        `${s.valueOrigin}: ${proNum(result.valueOrigin, 2)}`,
        `${s.valueSettlement}: ${proNum(result.valueSettlement, 2)}`,
        `${s.bookedDifference}: ${proNum(result.bookedDifference, 2)}`,
        `${s.exactDifference}: ${proNum(result.exactDifference, 2)}`,
        `${s.exactDifferenceRaw}: ${proNum(result.exactDifferenceRaw, 6)}`,
        `${s.magnitude}: ${proNum(result.magnitude, 2)}`,
        `${s.effect}: ${effectLabel(result.effect)}`,
        `${s.rateChangePercent}: ${proNum(result.rateChangePercent, 4)} %`,
        "",
        `${s.amount}: ${proNum(proParse(amountText) ?? 0, 2)}`,
        `${s.side}: ${side === "receivable" ? s.sideReceivable : s.sidePayable}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.amount} value={amountText} onChange={setAmountText} />
      <ToolInput label={s.rateOrigin} value={rateOriginText} onChange={setRateOriginText} />
      <ToolInput label={s.rateSettlement} value={rateSettlementText} onChange={setRateSettlementText} />
      <ToolSelect<"1" | "100" | "1000">
        label={s.rateUnit}
        value={rateUnitId}
        onChange={setRateUnitId}
        hint={s.rateUnitHint}
        options={[
          { id: "1", label: s.rateUnit1 },
          { id: "100", label: s.rateUnit100 },
          { id: "1000", label: s.rateUnit1000 },
        ]}
      />
      <ToolSelect<BalanceSide>
        label={s.side}
        value={side}
        onChange={setSide}
        options={[
          { id: "receivable", label: s.sideReceivable },
          { id: "payable", label: s.sidePayable },
        ]}
      />
      <ToolInput label={s.amountDecimals} value={amountDecimalsText} onChange={setAmountDecimalsText} />
      <ToolInput label={s.originDay} value={originDayText} onChange={setOriginDayText} />
      <ToolInput label={s.originMonth} value={originMonthText} onChange={setOriginMonthText} />
      <ToolInput label={s.originYear} value={originYearText} onChange={setOriginYearText} />
      <ToolInput label={s.settlementDay} value={settlementDayText} onChange={setSettlementDayText} />
      <ToolInput label={s.settlementMonth} value={settlementMonthText} onChange={setSettlementMonthText} />
      <ToolInput label={s.settlementYear} value={settlementYearText} onChange={setSettlementYearText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.valueOrigin} value={proNum(result.valueOrigin, 2)} />
          <ResultRow label={s.valueSettlement} value={proNum(result.valueSettlement, 2)} />
          <ResultRow label={s.bookedDifference} value={proNum(result.bookedDifference, 2)} />
          <ResultRow label={s.exactDifference} value={proNum(result.exactDifference, 2)} />
          <ResultRow label={s.exactDifferenceRaw} value={proNum(result.exactDifferenceRaw, 6)} />
          <p className="tool__note">{s.roundingNote}</p>
          <ResultRow label={s.magnitude} value={proNum(result.magnitude, 2)} />
          <ResultRow label={s.effect} value={effectLabel(result.effect)} />
          <ResultRow label={s.rateChangePercent} value={`${proNum(result.rateChangePercent, 4)} %`} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.amount, value: proNum(proParse(amountText) ?? 0, 2) },
              { label: s.side, value: side === "receivable" ? s.sideReceivable : s.sidePayable },
              { label: s.rateUnit, value: `${rateUnit}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      <ToolSection title={s.crossResults}>
        <ToolInput label={s.rateAB} hint={s.rateABHint} value={rateABText} onChange={setRateABText} />
        <ToolInput label={s.rateSecond} hint={s.rateSecondHint} value={rateSecondText} onChange={setRateSecondText} />
        <ToolSelect<CrossDirection>
          label={s.crossDirection}
          value={crossDirection}
          onChange={setCrossDirection}
          options={[
            { id: "sameBase", label: s.crossDirectionSameBase },
            { id: "inverse", label: s.crossDirectionInverse },
          ]}
        />
        <ToolInput label={s.crossDecimals} value={crossDecimalsText} onChange={setCrossDecimalsText} />
        {crossFailure !== undefined && <ToolFailure>{crossFailure}</ToolFailure>}
        {crossResult.ok && (
          <>
            <ResultRow label={s.crossRate} value={proNum(crossResult.rate, proParse(crossDecimalsText) ?? 6)} />
            <ToolFormula>{s.crossFormula}</ToolFormula>
            <ToolInputEcho
              entries={[
                { label: s.rateAB, value: proNum(proParse(rateABText) ?? 0, 6) },
                { label: s.rateSecond, value: proNum(proParse(rateSecondText) ?? 0, 6) },
                {
                  label: s.crossDirection,
                  value: crossDirection === "sameBase" ? s.crossDirectionSameBase : s.crossDirectionInverse,
                },
              ]}
            />
            <CopyButton value={crossCopyText} />
          </>
        )}
      </ToolSection>
    </>
  );
}

/**
 * The check digit of a PIB, a matični broj or a JMBG — verified or computed
 * by ISO 7064 MOD 11,10 (or the JMBG's own MOD 11 rule). It says the digits
 * agree with each other, nothing about who the number belongs to.
 */
export function CheckDigitsIdTool() {
  const s = strings.pro.racunovodstvo["check-digits-id"];
  const [kind, setKind] = useState<IdentifierKind>("pib");
  const [valueText, setValueText] = useState("");
  const [mode, setMode] = useState<"verify" | "compute">("verify");

  const typed = valueText.trim() !== "";
  const result = identifierCheckDigit({ value: valueText, kind, mode });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed ? undefined : field === "length" ? s.errorLength : s.errorValue;

  const kindLabel = kind === "pib" ? s.kindPib : kind === "maticni" ? s.kindMaticni : s.kindJmbg;

  const copyText = !result.ok
    ? ""
    : [
        `${s.computed}: ${result.computed}`,
        result.given === undefined ? undefined : `${s.given}: ${result.given}`,
        result.matches === undefined ? undefined : `${s.matches}: ${result.matches ? s.matchesYes : s.matchesNo}`,
        `${s.corrected}: ${result.corrected}`,
        result.jmbgRawRemainder === undefined ? undefined : `${s.jmbgRawRemainder}: ${result.jmbgRawRemainder}`,
        kind === "jmbg" ? `${s.jmbgTenBranch}: ${result.jmbgTenBranch ? s.matchesYes : s.matchesNo}` : undefined,
        "",
        `${s.kind}: ${kindLabel}`,
        `${s.mode}: ${mode === "verify" ? s.modeVerify : s.modeCompute}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<IdentifierKind>
        label={s.kind}
        value={kind}
        onChange={setKind}
        options={[
          { id: "pib", label: s.kindPib },
          { id: "maticni", label: s.kindMaticni },
          { id: "jmbg", label: s.kindJmbg },
        ]}
      />
      <ToolSelect<"verify" | "compute">
        label={s.mode}
        value={mode}
        onChange={setMode}
        hint={s.modeHint}
        options={[
          { id: "verify", label: s.modeVerify },
          { id: "compute", label: s.modeCompute },
        ]}
      />
      <ToolInput label={s.value} hint={s.valueHint} value={valueText} onChange={setValueText} mono />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.computed} value={result.computed} />
          {result.given !== undefined && <ResultRow label={s.given} value={result.given} />}
          {result.matches !== undefined && (
            <ResultRow label={s.matches} value={result.matches ? s.matchesYes : s.matchesNo} />
          )}
          <ResultRow label={s.corrected} value={result.corrected} />
          {result.jmbgRawRemainder !== undefined && (
            <ResultRow label={s.jmbgRawRemainder} value={result.jmbgRawRemainder} />
          )}
          {kind === "jmbg" && (
            <ResultRow label={s.jmbgTenBranch} value={result.jmbgTenBranch ? s.matchesYes : s.matchesNo} />
          )}
          <p className="tool__note">{s.jmbgNote}</p>
          <ToolFormula>{kind === "jmbg" ? s.formulaJmbg : s.formulaMod1110}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.kind, value: kindLabel },
              { label: s.mode, value: mode === "verify" ? s.modeVerify : s.modeCompute },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * A depreciation plan — linear, declining balance, sum-of-years or by output
 * — with an optional first-year proration. No tax depreciation group and no
 * prescribed rate is embedded: the useful life and the declining coefficient
 * are the user's own accounting policy.
 */
export function DepreciationScheduleTool() {
  const s = strings.pro.racunovodstvo["depreciation-schedule"];
  const [costText, setCostText] = useState("");
  const [residualText, setResidualText] = useState("0");
  const [usefulLifeText, setUsefulLifeText] = useState("");
  const [method, setMethod] = useState<DepreciationMethod>("linear");
  const [decliningFactorText, setDecliningFactorText] = useState("");
  const [displayYearsText, setDisplayYearsText] = useState("");
  const [activationDayText, setActivationDayText] = useState("");
  const [activationMonthText, setActivationMonthText] = useState("");
  const [activationYearText, setActivationYearText] = useState("");
  const [proration, setProration] = useState<FirstYearProration>("none");
  const [usageText, setUsageText] = useState("");
  const [capacityText, setCapacityText] = useState("");

  const typed = proParse(costText) !== undefined || proParse(usefulLifeText) !== undefined;
  const usage = proAmountList(usageText);
  const activationDay = proParse(activationDayText);
  const activationMonth = proParse(activationMonthText);
  const activationYear = proParse(activationYearText);
  const activation: CivilDate | undefined =
    activationDay === undefined || activationMonth === undefined || activationYear === undefined
      ? undefined
      : { day: activationDay, month: activationMonth, year: activationYear };

  const result = depreciationSchedule({
    cost: proParse(costText) ?? Number.NaN,
    residual: proParse(residualText) ?? 0,
    usefulLife: proParse(usefulLifeText) ?? Number.NaN,
    method,
    decliningFactor: proParse(decliningFactorText),
    displayYears: proParse(displayYearsText),
    activation,
    proration,
    ...(method === "units" ? { usage, capacity: proParse(capacityText) } : {}),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "cost"
        ? s.errorCost
        : field === "residual"
          ? s.errorResidual
          : field === "activation"
            ? s.errorActivation
            : field === "usefulLife"
              ? s.errorUsefulLife
              : field === "decliningFactor"
                ? s.errorDecliningFactor
                : field === "displayYears"
                  ? s.errorDisplayYears
                  : field === "usage"
                    ? s.errorUsage
                    : field === "capacity"
                      ? s.errorCapacity
                      : s.errorProration;

  const methodLabel =
    method === "linear"
      ? s.methodLinear
      : method === "declining"
        ? s.methodDeclining
        : method === "syd"
          ? s.methodSyd
          : s.methodUnits;
  const prorationLabel =
    proration === "none" ? s.prorationNone : proration === "months" ? s.prorationMonths : s.prorationDays;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${row.index}${row.calendarYear === undefined ? "" : ` (${row.calendarYear})`}: ${s.colCharge} ${proNum(row.charge, 2)} · ${s.colClosing} ${proNum(row.closingBookValue, 2)}`,
        ),
        "",
        `${s.depreciableBase}: ${proNum(result.depreciableBase, 2)}`,
        result.firstYearFactor === undefined ? undefined : `${s.firstYearFactor}: ${proNum(result.firstYearFactor, 4)}`,
        `${s.writtenOff}: ${proNum(result.writtenOff, 2)}`,
        "",
        `${s.cost}: ${proNum(proParse(costText) ?? 0, 2)}`,
        `${s.method}: ${methodLabel}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.cost} value={costText} onChange={setCostText} />
      <ToolInput label={s.residual} value={residualText} onChange={setResidualText} />
      {method !== "units" && (
        <ToolInput label={s.usefulLife} value={usefulLifeText} onChange={setUsefulLifeText} />
      )}
      <ToolSelect<DepreciationMethod>
        label={s.method}
        value={method}
        onChange={setMethod}
        options={[
          { id: "linear", label: s.methodLinear },
          { id: "declining", label: s.methodDeclining },
          { id: "syd", label: s.methodSyd },
          { id: "units", label: s.methodUnits },
        ]}
      />
      {method === "declining" && (
        <>
          <ToolInput label={s.decliningFactor} hint={s.decliningFactorHint} value={decliningFactorText} onChange={setDecliningFactorText} />
          <ToolInput label={s.displayYears} hint={s.displayYearsHint} value={displayYearsText} onChange={setDisplayYearsText} />
        </>
      )}
      {method === "units" && (
        <>
          <ToolTextArea label={s.usage} hint={s.usageHint} value={usageText} onChange={setUsageText} placeholder={s.usagePlaceholder} />
          <ToolInput label={s.capacity} value={capacityText} onChange={setCapacityText} />
        </>
      )}
      <ToolInput label={s.activationDay} value={activationDayText} onChange={setActivationDayText} />
      <ToolInput label={s.activationMonth} value={activationMonthText} onChange={setActivationMonthText} />
      <ToolInput label={s.activationYear} value={activationYearText} onChange={setActivationYearText} />
      <ToolSelect<FirstYearProration>
        label={s.proration}
        value={proration}
        onChange={setProration}
        hint={s.prorationHint}
        options={[
          { id: "none", label: s.prorationNone },
          { id: "months", label: s.prorationMonths },
          { id: "days", label: s.prorationDays },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colYear, s.colCalendarYear, s.colBasis, s.colOpening, s.colCharge, s.colAccumulated, s.colClosing]}
            rows={result.rows.map((row) => [
              row.index,
              row.calendarYear ?? "—",
              proNum(row.basis, 2),
              proNum(row.openingBookValue, 2),
              proNum(row.charge, 2),
              proNum(row.accumulated, 2),
              proNum(row.closingBookValue, 2),
            ])}
          />
          <ResultRow label={s.depreciableBase} value={proNum(result.depreciableBase, 2)} />
          {result.firstYearFactor !== undefined && (
            <ResultRow label={s.firstYearFactor} value={proNum(result.firstYearFactor, 4)} />
          )}
          <ResultRow label={s.writtenOff} value={proNum(result.writtenOff, 2)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <p className="tool__note">{s.noRateNote}</p>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.cost, value: proNum(proParse(costText) ?? 0, 2) },
              { label: s.method, value: methodLabel },
              { label: s.proration, value: prorationLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * The observed first (or first-two) digit distribution of a pasted column of
 * amounts, against Newcomb–Benford, with chi-square, MAD and a per-digit z —
 * and, per `riskClass: "none"`, still no threshold and no verdict of its
 * own: these are the only numbers the core function returns, and the tool
 * prints exactly them.
 */
export function BenfordFirstDigitTool() {
  const s = strings.pro.racunovodstvo["benford-first-digit"];
  const [text, setText] = useState("");
  const [test, setTest] = useState<BenfordDigitTest>("first");
  const [negatives, setNegatives] = useState<NegativeHandling>("absolute");
  const [separator, setSeparator] = useState<DecimalSeparator>("comma");

  const typed = text.trim() !== "";
  const result = benfordDigits({ text, test, negatives, separator });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "tooManyRows"
        ? s.errorTooManyRows
        : s.errorValues;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${row.digit}: ${s.colObserved} ${row.observed} (${proNum(row.observedSharePercent, 4)} %) · ${s.colExpected} ${proNum(row.expected, 2)} (${proNum(row.expectedSharePercent, 4)} %) · z ${proNum(row.z, 3)}`,
        ),
        "",
        `${s.usable}: ${result.usable}`,
        `${s.skipped}: ${result.skipped}`,
        `${s.chiSquare}: ${proNum(result.chiSquare, 4)} (df ${result.degreesOfFreedom})`,
        `${s.mad}: ${proNum(result.mad, 6)}`,
        `${s.minExpected}: ${proNum(result.minExpected, 4)}`,
        "",
        `${s.test}: ${test === "first" ? s.testFirst : s.testFirstTwo}`,
        `${s.negatives}: ${negatives === "absolute" ? s.negativesAbsolute : s.negativesSkip}`,
      ].join("\n");

  return (
    <>
      <ToolTextArea label={s.text} hint={s.textHint} value={text} onChange={setText} rows={10} />
      <ToolSelect<BenfordDigitTest>
        label={s.test}
        value={test}
        onChange={setTest}
        options={[
          { id: "first", label: s.testFirst },
          { id: "firstTwo", label: s.testFirstTwo },
        ]}
      />
      <ToolSelect<NegativeHandling>
        label={s.negatives}
        value={negatives}
        onChange={setNegatives}
        options={[
          { id: "absolute", label: s.negativesAbsolute },
          { id: "skip", label: s.negativesSkip },
        ]}
      />
      <ToolSelect<DecimalSeparator>
        label={s.separator}
        value={separator}
        onChange={setSeparator}
        options={[
          { id: "comma", label: s.separatorComma },
          { id: "dot", label: s.separatorDot },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colDigit, s.colObserved, s.colObservedShare, s.colExpectedShare, s.colExpected, s.colDifference, s.colZ]}
            rows={result.rows.map((row) => [
              row.digit,
              row.observed,
              `${proNum(row.observedSharePercent, 4)} %`,
              `${proNum(row.expectedSharePercent, 4)} %`,
              proNum(row.expected, 2),
              `${proNum(row.differencePercent, 4)} %`,
              proNum(row.z, 3),
            ])}
          />
          <ResultRow label={s.usable} value={result.usable} />
          <ResultRow label={s.skipped} value={result.skipped} />
          <ResultRow label={s.chiSquare} value={`${proNum(result.chiSquare, 4)} (df ${result.degreesOfFreedom})`} />
          <ResultRow label={s.mad} value={proNum(result.mad, 6)} />
          <ResultRow label={s.minExpected} value={proNum(result.minExpected, 4)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.test, value: test === "first" ? s.testFirst : s.testFirstTwo },
              { label: s.negatives, value: negatives === "absolute" ? s.negativesAbsolute : s.negativesSkip },
              { label: s.separator, value: separator === "comma" ? s.separatorComma : s.separatorDot },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Break-even volume and revenue for one product, the volume for a target
 * profit, and — only when a planned volume was typed — the margin of safety
 * and the operating leverage at it. A margin of zero or less has no
 * break-even at any volume, and the core function refuses rather than print
 * an infinite one.
 */
export function BreakevenCvpTool() {
  const s = strings.pro.racunovodstvo["breakeven-cvp"];
  const [fixedCostText, setFixedCostText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [variableCostText, setVariableCostText] = useState("");
  const [targetProfitText, setTargetProfitText] = useState("0");
  const [plannedVolumeText, setPlannedVolumeText] = useState("");

  const typed =
    proParse(fixedCostText) !== undefined ||
    proParse(priceText) !== undefined ||
    proParse(variableCostText) !== undefined;

  const result = breakevenPoint({
    fixedCost: proParse(fixedCostText) ?? Number.NaN,
    price: proParse(priceText) ?? Number.NaN,
    variableCost: proParse(variableCostText) ?? Number.NaN,
    targetProfit: proParse(targetProfitText) ?? 0,
    plannedVolume: proParse(plannedVolumeText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "fixedCost"
        ? s.errorFixedCost
        : field === "price"
          ? s.errorPrice
          : field === "variableCost"
            ? s.errorVariableCost
            : field === "targetProfit"
              ? s.errorTargetProfit
              : field === "plannedVolume"
                ? s.errorPlannedVolume
                : s.errorContribution;

  const copyText = !result.ok
    ? ""
    : [
        `${s.contributionMargin}: ${proNum(result.contributionMargin, 2)}`,
        `${s.contributionMarginPercent}: ${proNum(result.contributionMarginPercent, 4)} %`,
        `${s.breakevenUnits}: ${proNum(result.breakevenUnits, 4)}`,
        `${s.breakevenUnitsWhole}: ${result.breakevenUnitsWhole}`,
        `${s.breakevenRevenue}: ${proNum(result.breakevenRevenue, 2)}`,
        `${s.breakevenRevenueAtWholeUnits}: ${proNum(result.breakevenRevenueAtWholeUnits, 2)}`,
        `${s.targetUnits}: ${proNum(result.targetUnits, 4)}`,
        `${s.targetRevenue}: ${proNum(result.targetRevenue, 2)}`,
        result.marginOfSafetyPercent === undefined ? undefined : `${s.marginOfSafetyPercent}: ${proNum(result.marginOfSafetyPercent, 4)} %`,
        result.operatingLeverage === undefined ? undefined : `${s.operatingLeverage}: ${proNum(result.operatingLeverage, 4)}`,
        "",
        `${s.fixedCost}: ${proNum(proParse(fixedCostText) ?? 0, 2)}`,
        `${s.price}: ${proNum(proParse(priceText) ?? 0, 2)}`,
        `${s.variableCost}: ${proNum(proParse(variableCostText) ?? 0, 2)}`,
        `${s.targetProfit}: ${proNum(proParse(targetProfitText) ?? 0, 2)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.fixedCost} value={fixedCostText} onChange={setFixedCostText} />
      <ToolInput label={s.price} value={priceText} onChange={setPriceText} />
      <ToolInput label={s.variableCost} value={variableCostText} onChange={setVariableCostText} />
      <ToolInput label={s.targetProfit} value={targetProfitText} onChange={setTargetProfitText} />
      <ToolInput label={s.plannedVolume} hint={s.plannedVolumeHint} value={plannedVolumeText} onChange={setPlannedVolumeText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.contributionMargin} value={proNum(result.contributionMargin, 2)} />
          <ResultRow label={s.contributionMarginPercent} value={`${proNum(result.contributionMarginPercent, 4)} %`} />
          <ResultRow label={s.breakevenUnits} value={proNum(result.breakevenUnits, 4)} />
          <ResultRow label={s.breakevenUnitsWhole} value={result.breakevenUnitsWhole} />
          <ResultRow label={s.breakevenRevenue} value={proNum(result.breakevenRevenue, 2)} />
          <ResultRow label={s.breakevenRevenueAtWholeUnits} value={proNum(result.breakevenRevenueAtWholeUnits, 2)} />
          <p className="tool__note">{s.revenueNote}</p>
          <ResultRow label={s.targetUnits} value={proNum(result.targetUnits, 4)} />
          <ResultRow label={s.targetRevenue} value={proNum(result.targetRevenue, 2)} />
          {result.marginOfSafetyPercent !== undefined && (
            <ResultRow label={s.marginOfSafetyPercent} value={`${proNum(result.marginOfSafetyPercent, 4)} %`} />
          )}
          {result.operatingLeverage !== undefined && (
            <ResultRow label={s.operatingLeverage} value={proNum(result.operatingLeverage, 4)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <p className="tool__note">{s.singleProductNote}</p>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.fixedCost, value: proNum(proParse(fixedCostText) ?? 0, 2) },
              { label: s.price, value: proNum(proParse(priceText) ?? 0, 2) },
              { label: s.variableCost, value: proNum(proParse(variableCostText) ?? 0, 2) },
              { label: s.targetProfit, value: proNum(proParse(targetProfitText) ?? 0, 2) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}
type AccountKind = "domestic" | "iban";
type AccountSubMode = "verify" | "compute";

/**
 * The check digits of a domestic 18-digit dinar account or an IBAN, verified
 * or computed, by the ISO 7064 MOD 97-10 arithmetic both share. It says only
 * that the digits agree with each other — not that the account exists, whose
 * it is, or that it is open.
 */
export function BankAccountIbanTool() {
  const s = strings.pro.racunovodstvo["bank-account-iban"];
  const [kind, setKind] = useState<AccountKind>("domestic");
  const [subMode, setSubMode] = useState<AccountSubMode>("verify");
  const [bankText, setBankText] = useState("");
  const [partyText, setPartyText] = useState("");
  const [domesticCheckText, setDomesticCheckText] = useState("");
  const [ibanText, setIbanText] = useState("");

  const typed = kind === "domestic" ? bankText.trim() !== "" || partyText.trim() !== "" : ibanText.trim() !== "";

  const domesticResult =
    kind === "domestic"
      ? domesticAccountCheck({
          bank: bankText,
          partyNumber: partyText,
          ...(subMode === "verify" ? { checkDigits: domesticCheckText } : {}),
          mode: subMode,
        })
      : undefined;
  const ibanResult = kind === "iban" ? ibanCheck({ value: ibanText, mode: subMode }) : undefined;
  const result = domesticResult ?? ibanResult;

  const field = result === undefined || result.ok ? undefined : reasonField(result.reason);
  const failure =
    result === undefined || result.ok || !typed
      ? undefined
      : field === "bank"
        ? s.errorBank
        : field === "partyNumber"
          ? s.errorPartyNumber
          : field === "checkDigits"
            ? s.errorCheckDigits
            : field === "confusable"
              ? s.errorConfusable
              : field === "length"
                ? s.errorLength
                : field === "alreadyIban"
                  ? s.errorAlreadyIban
                  : s.errorIban;

  const copyText =
    result === undefined || !result.ok
      ? ""
      : domesticResult !== undefined && domesticResult.ok
        ? [
            `${s.formatted}: ${domesticResult.formatted}`,
            `${s.checkDigits}: ${domesticResult.checkDigits}`,
            domesticResult.matches === undefined ? undefined : `${s.matches}: ${domesticResult.matches ? s.matchesYes : s.matchesNo}`,
            `${s.remainder}: ${domesticResult.remainder}`,
          ]
            .filter((line): line is string => line !== undefined)
            .join("\n")
        : ibanResult !== undefined && ibanResult.ok
          ? [
              `${s.formatted}: ${ibanResult.formatted}`,
              `${s.checkDigits}: ${ibanResult.checkDigits}`,
              ibanResult.matches === undefined ? undefined : `${s.matches}: ${ibanResult.matches ? s.matchesYes : s.matchesNo}`,
              `${s.remainder}: ${ibanResult.remainder}`,
            ]
              .filter((line): line is string => line !== undefined)
              .join("\n")
          : "";

  return (
    <>
      <ToolSelect<AccountKind>
        label={s.kind}
        value={kind}
        onChange={setKind}
        options={[
          { id: "domestic", label: s.kindDomestic },
          { id: "iban", label: s.kindIban },
        ]}
      />
      <ToolSelect<AccountSubMode>
        label={s.subMode}
        value={subMode}
        onChange={setSubMode}
        hint={s.subModeHint}
        options={[
          { id: "verify", label: s.subModeVerify },
          { id: "compute", label: s.subModeCompute },
        ]}
      />
      {kind === "domestic" ? (
        <>
          <ToolInput label={s.bank} hint={s.bankHint} value={bankText} onChange={setBankText} mono />
          <ToolInput label={s.party} hint={s.partyHint} value={partyText} onChange={setPartyText} mono />
          {subMode === "verify" && (
            <ToolInput label={s.domesticCheck} value={domesticCheckText} onChange={setDomesticCheckText} mono />
          )}
        </>
      ) : (
        <ToolInput label={s.iban} hint={subMode === "verify" ? s.ibanHintVerify : s.ibanHintCompute} value={ibanText} onChange={setIbanText} mono />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && result.ok && (
        <ToolSection title={s.results}>
          <ToolOutput label={s.formatted} value={result.formatted} />
          <ResultRow label={s.checkDigits} value={result.checkDigits} mono />
          {result.matches !== undefined && (
            <ResultRow label={s.matches} value={result.matches ? s.matchesYes : s.matchesNo} />
          )}
          <ResultRow label={s.remainder} value={result.remainder} mono />
          <ToolFormula>{kind === "domestic" ? s.formulaDomestic : s.formulaIban}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.kind, value: kind === "domestic" ? s.kindDomestic : s.kindIban },
              { label: s.subMode, value: subMode === "verify" ? s.subModeVerify : s.subModeCompute },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * The gross an amount has to be for a given net, solved backwards, on model
 * A (non-taxable amount) or model B (standardised costs). No tax rate, no
 * contribution rate and no non-taxable amount is embedded — every one of
 * them is the user's own figure, and the control neto is recomputed forwards
 * so a wrong rate shows up as a mismatch rather than a silent answer.
 */
export function GrossUpTool() {
  const s = strings.pro.racunovodstvo["gross-up"];
  const [netText, setNetText] = useState("");
  const [model, setModel] = useState<GrossUpModel>("A");
  const [taxPercentText, setTaxPercentText] = useState("");
  const [contributionPercentText, setContributionPercentText] = useState("");
  const [nonTaxableText, setNonTaxableText] = useState("");
  const [standardCostPercentText, setStandardCostPercentText] = useState("");
  const [employerPercentText, setEmployerPercentText] = useState("");

  const typed = proParse(netText) !== undefined;
  const result = grossFromNet({
    net: proParse(netText) ?? Number.NaN,
    model,
    taxPercent: proParse(taxPercentText) ?? Number.NaN,
    contributionPercent: proParse(contributionPercentText) ?? Number.NaN,
    ...(model === "A" ? { nonTaxable: proParse(nonTaxableText) } : {}),
    ...(model === "B" ? { standardCostPercent: proParse(standardCostPercentText) } : {}),
    employerPercent: proParse(employerPercentText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "net"
        ? s.errorNet
        : field === "taxPercent"
          ? s.errorTaxPercent
          : field === "contributionPercent"
            ? s.errorContributionPercent
            : field === "employerPercent"
              ? s.errorEmployerPercent
              : field === "nonTaxable"
                ? s.errorNonTaxable
                : field === "standardCostPercent"
                  ? s.errorStandardCostPercent
                  : s.errorRates;

  const copyText = !result.ok
    ? ""
    : [
        `${s.gross}: ${proNum(result.gross, 2)}`,
        `${s.taxBase}: ${proNum(result.taxBase, 2)}`,
        `${s.tax}: ${proNum(result.tax, 2)}`,
        `${s.contributions}: ${proNum(result.contributions, 2)}`,
        `${s.netCheck}: ${proNum(result.netCheck, 2)}`,
        result.totalCost === undefined ? undefined : `${s.totalCost}: ${proNum(result.totalCost, 2)}`,
        "",
        `${s.net}: ${proNum(proParse(netText) ?? 0, 2)}`,
        `${s.model}: ${model === "A" ? s.modelA : s.modelB}`,
        `${s.taxPercent}: ${proNum(proParse(taxPercentText) ?? 0, 2)} %`,
        `${s.contributionPercent}: ${proNum(proParse(contributionPercentText) ?? 0, 2)} %`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.net} value={netText} onChange={setNetText} />
      <ToolSelect<GrossUpModel>
        label={s.model}
        value={model}
        onChange={setModel}
        hint={s.modelHint}
        options={[
          { id: "A", label: s.modelA },
          { id: "B", label: s.modelB },
        ]}
      />
      <ToolInput label={s.taxPercent} hint={s.rateHint} value={taxPercentText} onChange={setTaxPercentText} />
      <ToolInput label={s.contributionPercent} hint={s.rateHint} value={contributionPercentText} onChange={setContributionPercentText} />
      {model === "A" && (
        <ToolInput label={s.nonTaxable} hint={s.nonTaxableHint} value={nonTaxableText} onChange={setNonTaxableText} />
      )}
      {model === "B" && (
        <ToolInput label={s.standardCostPercent} hint={s.rateHint} value={standardCostPercentText} onChange={setStandardCostPercentText} />
      )}
      <ToolInput label={s.employerPercent} hint={s.employerPercentHint} value={employerPercentText} onChange={setEmployerPercentText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.gross} value={proNum(result.gross, 2)} />
          <ResultRow label={s.taxBase} value={proNum(result.taxBase, 2)} />
          <ResultRow label={s.tax} value={proNum(result.tax, 2)} />
          <ResultRow label={s.contributions} value={proNum(result.contributions, 2)} />
          <ResultRow label={s.netCheck} value={proNum(result.netCheck, 2)} />
          {result.totalCost !== undefined && <ResultRow label={s.totalCost} value={proNum(result.totalCost, 2)} />}
          <ToolFormula>{model === "A" ? s.formulaA : s.formulaB}</ToolFormula>
          <p className="tool__note">{s.rateNote}</p>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.net, value: proNum(proParse(netText) ?? 0, 2) },
              { label: s.model, value: model === "A" ? s.modelA : s.modelB },
              { label: s.taxPercent, value: `${proNum(proParse(taxPercentText) ?? 0, 2)} %` },
              { label: s.contributionPercent, value: `${proNum(proParse(contributionPercentText) ?? 0, 2)} %` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * One interest rate expressed every way — effective annual, nominal at m
 * compoundings, and the periodic rate both proportionally and conformally —
 * with the m → ∞ continuous-compounding ceiling alongside. Nothing here is
 * an APR: this converts the rate that was typed.
 */
export function RateConversionTool() {
  const s = strings.pro.racunovodstvo["rate-conversion"];
  const [ratePercentText, setRatePercentText] = useState("");
  const [kind, setKind] = useState<RateKind>("nominal");
  const [compoundingsPerYearText, setCompoundingsPerYearText] = useState("12");
  const [target, setTarget] = useState<TargetPeriod>("month");

  const typed = proParse(ratePercentText) !== undefined;
  const result = rateConversion({
    ratePercent: proParse(ratePercentText) ?? Number.NaN,
    kind,
    compoundingsPerYear: proParse(compoundingsPerYearText) ?? Number.NaN,
    target,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "ratePercent"
        ? s.errorRatePercent
        : field === "compoundingsPerYear"
          ? s.errorCompoundingsPerYear
          : s.errorTarget;

  const kindLabel = kind === "nominal" ? s.kindNominal : kind === "effective" ? s.kindEffective : s.kindPeriodic;
  const targetLabel =
    target === "year"
      ? s.targetYear
      : target === "half"
        ? s.targetHalf
        : target === "quarter"
          ? s.targetQuarter
          : target === "month"
            ? s.targetMonth
            : s.targetDay;

  const copyText = !result.ok
    ? ""
    : [
        `${s.effectivePercent}: ${proNum(result.effectivePercent, 6)} %`,
        `${s.nominalPercent}: ${proNum(result.nominalPercent, 6)} %`,
        `${s.proportionalPeriodicPercent}: ${proNum(result.proportionalPeriodicPercent, 6)} %`,
        `${s.conformalPeriodicPercent}: ${proNum(result.conformalPeriodicPercent, 6)} %`,
        `${s.continuousEffectivePercent}: ${proNum(result.continuousEffectivePercent, 6)} %`,
        `${s.periodsPerYear}: ${result.periodsPerYear}`,
        "",
        `${s.ratePercent}: ${proNum(proParse(ratePercentText) ?? 0, 6)} %`,
        `${s.kind}: ${kindLabel}`,
        `${s.target}: ${targetLabel}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.ratePercent} value={ratePercentText} onChange={setRatePercentText} />
      <ToolSelect<RateKind>
        label={s.kind}
        value={kind}
        onChange={setKind}
        hint={s.kindHint}
        options={[
          { id: "nominal", label: s.kindNominal },
          { id: "effective", label: s.kindEffective },
          { id: "periodic", label: s.kindPeriodic },
        ]}
      />
      <ToolInput label={s.compoundingsPerYear} hint={s.compoundingsPerYearHint} value={compoundingsPerYearText} onChange={setCompoundingsPerYearText} />
      <ToolSelect<TargetPeriod>
        label={s.target}
        value={target}
        onChange={setTarget}
        hint={s.targetHint}
        options={[
          { id: "year", label: s.targetYear },
          { id: "half", label: s.targetHalf },
          { id: "quarter", label: s.targetQuarter },
          { id: "month", label: s.targetMonth },
          { id: "day", label: s.targetDay },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.effectivePercent} value={`${proNum(result.effectivePercent, 6)} %`} />
          <ResultRow label={s.nominalPercent} value={`${proNum(result.nominalPercent, 6)} %`} />
          <ResultRow label={s.proportionalPeriodicPercent} value={`${proNum(result.proportionalPeriodicPercent, 6)} %`} />
          <ResultRow label={s.conformalPeriodicPercent} value={`${proNum(result.conformalPeriodicPercent, 6)} %`} />
          <p className="tool__note">{s.periodicNote}</p>
          <ResultRow label={s.continuousEffectivePercent} value={`${proNum(result.continuousEffectivePercent, 6)} %`} />
          <ResultRow label={s.periodsPerYear} value={result.periodsPerYear} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.ratePercent, value: `${proNum(proParse(ratePercentText) ?? 0, 6)} %` },
              { label: s.kind, value: kindLabel },
              { label: s.target, value: targetLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Interest over one or more periods, each with its own rate, on one
 * day-count basis. No statutory or reference rate is embedded — every row's
 * rate is typed. Capitalisation is an input rather than an assumption: the
 * same span cut into two periods gives a different total without it — see
 * `interestByPeriods`'s own note.
 */
export function InterestPeriodsTool() {
  const s = strings.pro.racunovodstvo["interest-periods"];
  const [principalText, setPrincipalText] = useState("");
  const [periodsText, setPeriodsText] = useState("");
  const [dayCount, setDayCount] = useState<DayCount>("act365");
  const [method, setMethod] = useState<InterestMethod>("simple");
  const [capitalize, setCapitalize] = useState<"yes" | "no">("no");
  const [decimalsText, setDecimalsText] = useState("2");

  const rows = proRows(periodsText);
  const periods: InterestPeriod[] = rows.map((row) => ({
    from: proDate(row[0] ?? "") ?? { day: Number.NaN, month: Number.NaN, year: Number.NaN },
    to: proDate(row[1] ?? "") ?? { day: Number.NaN, month: Number.NaN, year: Number.NaN },
    ratePercent: proParse(row[2] ?? "") ?? Number.NaN,
  }));
  const typed = proParse(principalText) !== undefined || rows.length > 0;

  const result = interestByPeriods({
    principal: proParse(principalText) ?? Number.NaN,
    periods,
    dayCount,
    method,
    capitalize: capitalize === "yes",
    decimals: proParse(decimalsText) ?? 2,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "principal"
        ? s.errorPrincipal
        : field === "decimals"
          ? s.errorDecimals
          : field === "period"
            ? s.errorPeriod
            : field === "ratePercent"
              ? s.errorRatePercent
              : s.errorPeriods;

  const dayCountLabel =
    dayCount === "act365"
      ? s.dayCountAct365
      : dayCount === "act360"
        ? s.dayCountAct360
        : dayCount === "actActIsda"
          ? s.dayCountActActIsda
          : dayCount === "bond30360"
            ? s.dayCountBond30360
            : s.dayCountEuro30E360;

  const dateLabel = (date: CivilDate): string =>
    `${proNum(date.day, 0)}.${proNum(date.month, 0)}.${proNum(date.year, 0)}.`;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row, index) =>
            `${index + 1}: ${s.colDays} ${row.days} · ${s.colDcf} ${proNum(row.dcf, 6)} · ${s.colRate} ${proNum(row.ratePercent, 2)} % · ${s.colInterest} ${proNum(row.interest, 2)}`,
        ),
        "",
        `${s.totalDays}: ${result.totalDays}`,
        `${s.totalInterestRows}: ${proNum(result.totalInterestRows, 2)}`,
        `${s.totalInterestExact}: ${proNum(result.totalInterestExact, 2)}`,
        `${s.totalDue}: ${proNum(result.totalDue, 2)}`,
        `${s.earliestFrom}: ${dateLabel(result.earliestFrom)}`,
        `${s.latestTo}: ${dateLabel(result.latestTo)}`,
        `${s.overlapDays}: ${result.overlapDays}`,
        `${s.uncoveredDays}: ${result.uncoveredDays}`,
        "",
        `${s.principal}: ${proNum(proParse(principalText) ?? 0, 2)}`,
        `${s.dayCount}: ${dayCountLabel}`,
        `${s.method}: ${method === "simple" ? s.methodSimple : s.methodCompound}`,
        `${s.capitalize}: ${capitalize === "yes" ? s.capitalizeYes : s.capitalizeNo}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.principal} value={principalText} onChange={setPrincipalText} />
      <ToolTextArea
        label={s.periods}
        hint={s.periodsHint}
        value={periodsText}
        onChange={setPeriodsText}
        placeholder={s.periodsPlaceholder}
      />
      <ToolSelect<DayCount>
        label={s.dayCount}
        value={dayCount}
        onChange={setDayCount}
        options={[
          { id: "act365", label: s.dayCountAct365 },
          { id: "act360", label: s.dayCountAct360 },
          { id: "actActIsda", label: s.dayCountActActIsda },
          { id: "bond30360", label: s.dayCountBond30360 },
          { id: "euro30E360", label: s.dayCountEuro30E360 },
        ]}
      />
      <ToolSelect<InterestMethod>
        label={s.method}
        value={method}
        onChange={setMethod}
        options={[
          { id: "simple", label: s.methodSimple },
          { id: "compound", label: s.methodCompound },
        ]}
      />
      <ToolSelect<"yes" | "no">
        label={s.capitalize}
        value={capitalize}
        onChange={setCapitalize}
        hint={s.capitalizeHint}
        options={[
          { id: "no", label: s.capitalizeNo },
          { id: "yes", label: s.capitalizeYes },
        ]}
      />
      <ToolInput label={s.decimals} value={decimalsText} onChange={setDecimalsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colIndex, s.colDays, s.colDcf, s.colRate, s.colInterest]}
            rows={result.rows.map((row, index) => [
              index + 1,
              row.days,
              proNum(row.dcf, 6),
              `${proNum(row.ratePercent, 2)} %`,
              proNum(row.interest, 2),
            ])}
          />
          <ResultRow label={s.totalDays} value={result.totalDays} />
          <ResultRow label={s.totalInterestRows} value={proNum(result.totalInterestRows, 2)} />
          <ResultRow label={s.totalInterestExact} value={proNum(result.totalInterestExact, 2)} />
          <p className="tool__note">{s.totalsNote}</p>
          <ResultRow label={s.totalDue} value={proNum(result.totalDue, 2)} />
          <ResultRow label={s.earliestFrom} value={dateLabel(result.earliestFrom)} />
          <ResultRow label={s.latestTo} value={dateLabel(result.latestTo)} />
          <ResultRow label={s.overlapDays} value={result.overlapDays} />
          <ResultRow label={s.uncoveredDays} value={result.uncoveredDays} />
          <p className="tool__note">{s.coverageNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.principal, value: proNum(proParse(principalText) ?? 0, 2) },
              { label: s.dayCount, value: dayCountLabel },
              { label: s.method, value: method === "simple" ? s.methodSimple : s.methodCompound },
              { label: s.capitalize, value: capitalize === "yes" ? s.capitalizeYes : s.capitalizeNo },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** A movements row's first cell, read as the Serbian word for the movement type. */
function movementTypeFromCell(cell: string): MovementType | undefined {
  const normalized = cell.trim().toLowerCase();
  if (normalized === "ulaz") return "in";
  if (normalized === "izlaz") return "out";
  return undefined;
}

/**
 * The cost of goods sold and the closing stock by BOTH FIFO and weighted
 * average, side by side with their difference — never one picked as „the"
 * method, since which one applies is the user's own accounting policy.
 */
export function InventoryCostingTool() {
  const s = strings.pro.racunovodstvo["inventory-costing"];
  const [openingQuantityText, setOpeningQuantityText] = useState("0");
  const [openingUnitCostText, setOpeningUnitCostText] = useState("0");
  const [movementsText, setMovementsText] = useState("");
  const [averageMode, setAverageMode] = useState<AverageMode>("moving");
  const [decimalsText, setDecimalsText] = useState("2");

  const rows = proRows(movementsText);
  const movements: InventoryMovement[] = rows.map((row) => {
    const type = movementTypeFromCell(row[0] ?? "") ?? "in";
    return {
      type,
      quantity: proParse(row[1] ?? "") ?? Number.NaN,
      ...(type === "in" ? { unitCost: proParse(row[2] ?? "") } : {}),
    };
  });
  const hasUnknownType = rows.some((row) => movementTypeFromCell(row[0] ?? "") === undefined);
  const typed = rows.length > 0;

  const result = hasUnknownType
    ? undefined
    : inventoryCosting({
        openingQuantity: proParse(openingQuantityText) ?? 0,
        openingUnitCost: proParse(openingUnitCostText) ?? 0,
        movements,
        averageMode,
        decimals: proParse(decimalsText) ?? 2,
      });

  const field = result === undefined || result.ok ? undefined : reasonField(result.reason);
  const failure = hasUnknownType
    ? s.errorMovementType
    : result === undefined || result.ok || !typed
      ? undefined
      : field === "openingQuantity"
        ? s.errorOpeningQuantity
        : field === "openingUnitCost"
          ? s.errorOpeningUnitCost
          : field === "unitCost"
            ? s.errorUnitCost
            : field === "decimals"
              ? s.errorDecimals
              : s.errorMovements;

  const movementRows = (method: InventoryMethodResult) =>
    method.rows.map((row) => [
      row.type === "in" ? s.typeIn : s.typeOut,
      proNum(row.quantity, 2),
      proNum(row.unitCost, 4),
      proNum(row.value, 2),
      proNum(row.balanceQuantity, 2),
      proNum(row.balanceValue, 2),
    ]);

  const copyText = result === undefined || !result.ok
    ? ""
    : [
        `${s.fifoCogs}: ${proNum(result.fifo.costOfGoodsSold, 2)}`,
        `${s.fifoClosingValue}: ${proNum(result.fifo.closingValue, 2)}`,
        `${s.averageCogs}: ${proNum(result.average.costOfGoodsSold, 2)}`,
        `${s.averageClosingValue}: ${proNum(result.average.closingValue, 2)}`,
        `${s.costDifference}: ${proNum(result.costDifference, 2)}`,
        `${s.closingDifference}: ${proNum(result.closingDifference, 2)}`,
        `${s.purchaseValue}: ${proNum(result.purchaseValue, 2)}`,
        "",
        `${s.openingQuantity}: ${proNum(proParse(openingQuantityText) ?? 0, 2)}`,
        `${s.averageMode}: ${averageMode === "moving" ? s.averageModeMoving : s.averageModePeriodic}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.openingQuantity} value={openingQuantityText} onChange={setOpeningQuantityText} />
      <ToolInput label={s.openingUnitCost} value={openingUnitCostText} onChange={setOpeningUnitCostText} />
      <ToolTextArea
        label={s.movements}
        hint={s.movementsHint}
        value={movementsText}
        onChange={setMovementsText}
        placeholder={s.movementsPlaceholder}
      />
      <ToolSelect<AverageMode>
        label={s.averageMode}
        value={averageMode}
        onChange={setAverageMode}
        hint={s.averageModeHint}
        options={[
          { id: "moving", label: s.averageModeMoving },
          { id: "periodic", label: s.averageModePeriodic },
        ]}
      />
      <ToolInput label={s.decimals} value={decimalsText} onChange={setDecimalsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result !== undefined && result.ok && (
        <ToolSection title={s.results}>
          <ToolSection title={s.groupFifo}>
            <ToolTable
              head={[s.colType, s.colQuantity, s.colUnitCost, s.colValue, s.colBalanceQuantity, s.colBalanceValue]}
              rows={movementRows(result.fifo)}
            />
            <ResultRow label={s.cogs} value={proNum(result.fifo.costOfGoodsSold, 2)} />
            <ResultRow label={s.closingQuantity} value={proNum(result.fifo.closingQuantity, 2)} />
            <ResultRow label={s.closingValue} value={proNum(result.fifo.closingValue, 2)} />
          </ToolSection>
          <ToolSection title={s.groupAverage}>
            <ToolTable
              head={[s.colType, s.colQuantity, s.colUnitCost, s.colValue, s.colBalanceQuantity, s.colBalanceValue]}
              rows={movementRows(result.average)}
            />
            <ResultRow label={s.cogs} value={proNum(result.average.costOfGoodsSold, 2)} />
            <ResultRow label={s.closingQuantity} value={proNum(result.average.closingQuantity, 2)} />
            <ResultRow label={s.closingValue} value={proNum(result.average.closingValue, 2)} />
          </ToolSection>
          <ResultRow label={s.costDifference} value={proNum(result.costDifference, 2)} />
          <ResultRow label={s.closingDifference} value={proNum(result.closingDifference, 2)} />
          <ResultRow label={s.purchaseValue} value={proNum(result.purchaseValue, 2)} />
          <p className="tool__note">{s.policyNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.openingQuantity, value: proNum(proParse(openingQuantityText) ?? 0, 2) },
              { label: s.openingUnitCost, value: proNum(proParse(openingUnitCostText) ?? 0, 2) },
              { label: s.averageMode, value: averageMode === "moving" ? s.averageModeMoving : s.averageModePeriodic },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * An amortisation schedule, level instalment or equal principal, with every
 * rate carried unrounded between rows — see `loanSchedule`'s own note on why
 * the last instalment absorbs whatever rounding is left rather than every
 * row carrying its own. This is a plain computation on the terms typed: no
 * fee, no grace period, no insurance, so it is never called an EKS.
 */
export function LoanScheduleTool() {
  const s = strings.pro.racunovodstvo["loan-schedule"];
  const [principalText, setPrincipalText] = useState("");
  const [annualRatePercentText, setAnnualRatePercentText] = useState("");
  const [instalmentsText, setInstalmentsText] = useState("");
  // Held as a string id because `ToolSelect<T extends string>` cannot take the
  // core function's own `12 | 4 | 2 | 1` number union — translated at the edge.
  const [frequencyId, setFrequencyId] = useState<"12" | "4" | "2" | "1">("12");
  const frequency: LoanFrequency =
    frequencyId === "12" ? 12 : frequencyId === "4" ? 4 : frequencyId === "2" ? 2 : 1;
  const [plan, setPlan] = useState<LoanPlan>("annuity");
  const [rateMethod, setRateMethod] = useState<PeriodicRateMethod>("proportional");
  const [decimalsText, setDecimalsText] = useState("2");

  const typed = proParse(principalText) !== undefined || proParse(instalmentsText) !== undefined;
  const result = loanSchedule({
    principal: proParse(principalText) ?? Number.NaN,
    annualRatePercent: proParse(annualRatePercentText) ?? Number.NaN,
    instalments: proParse(instalmentsText) ?? Number.NaN,
    frequency,
    plan,
    rateMethod,
    decimals: proParse(decimalsText) ?? 2,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "principal"
        ? s.errorPrincipal
        : field === "annualRatePercent"
          ? s.errorAnnualRatePercent
          : field === "instalments"
            ? s.errorInstalments
            : field === "frequency"
              ? s.errorFrequency
              : s.errorDecimals;

  const planLabel = plan === "annuity" ? s.planAnnuity : s.planEqualPrincipal;
  const rateMethodLabel = rateMethod === "proportional" ? s.rateMethodProportional : s.rateMethodConformal;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map(
          (row) =>
            `${row.index}: ${s.colInterest} ${proNum(row.interest, 2)} · ${s.colPrincipal} ${proNum(row.principal, 2)} · ${s.colPayment} ${proNum(row.payment, 2)} · ${s.colClosing} ${proNum(row.closingBalance, 2)}`,
        ),
        "",
        result.annuity === undefined ? undefined : `${s.annuity}: ${proNum(result.annuity, 2)}`,
        `${s.periodicRate}: ${proNum(result.periodicRatePercent, 6)} %`,
        `${s.totalPaid}: ${proNum(result.totalPaid, 2)}`,
        `${s.totalInterest}: ${proNum(result.totalInterest, 2)}`,
        "",
        `${s.principal}: ${proNum(proParse(principalText) ?? 0, 2)}`,
        `${s.plan}: ${planLabel}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.principal} value={principalText} onChange={setPrincipalText} />
      <ToolInput label={s.annualRatePercent} value={annualRatePercentText} onChange={setAnnualRatePercentText} />
      <ToolInput label={s.instalments} value={instalmentsText} onChange={setInstalmentsText} />
      <ToolSelect<"12" | "4" | "2" | "1">
        label={s.frequency}
        value={frequencyId}
        onChange={setFrequencyId}
        options={[
          { id: "12", label: s.frequency12 },
          { id: "4", label: s.frequency4 },
          { id: "2", label: s.frequency2 },
          { id: "1", label: s.frequency1 },
        ]}
      />
      <ToolSelect<LoanPlan>
        label={s.plan}
        value={plan}
        onChange={setPlan}
        options={[
          { id: "annuity", label: s.planAnnuity },
          { id: "equalPrincipal", label: s.planEqualPrincipal },
        ]}
      />
      <ToolSelect<PeriodicRateMethod>
        label={s.rateMethod}
        value={rateMethod}
        onChange={setRateMethod}
        hint={s.rateMethodHint}
        options={[
          { id: "proportional", label: s.rateMethodProportional },
          { id: "conformal", label: s.rateMethodConformal },
        ]}
      />
      <ToolInput label={s.decimals} value={decimalsText} onChange={setDecimalsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colIndex, s.colOpening, s.colInterest, s.colPrincipal, s.colPayment, s.colClosing]}
            rows={result.rows.map((row) => [
              row.index,
              proNum(row.openingBalance, 2),
              proNum(row.interest, 2),
              proNum(row.principal, 2),
              proNum(row.payment, 2),
              proNum(row.closingBalance, 2),
            ])}
          />
          {result.annuity !== undefined && <ResultRow label={s.annuity} value={proNum(result.annuity, 2)} />}
          <ResultRow label={s.periodicRate} value={`${proNum(result.periodicRatePercent, 6)} %`} />
          <ResultRow label={s.totalPaid} value={proNum(result.totalPaid, 2)} />
          <ResultRow label={s.totalInterest} value={proNum(result.totalInterest, 2)} />
          <p className="tool__note">{s.notAprNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.principal, value: proNum(proParse(principalText) ?? 0, 2) },
              { label: s.annualRatePercent, value: `${proNum(proParse(annualRatePercentText) ?? 0, 4)} %` },
              { label: s.instalments, value: instalmentsText.trim() },
              { label: s.plan, value: planLabel },
              { label: s.rateMethod, value: rateMethodLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Margin on the selling price versus mark-up on the cost — two different
 * numbers for the same trade, both always shown — and a chain of successive
 * rebates folded to one effective rebate, which is a PRODUCT and never a
 * sum: 10% then 5% is 14,5%, not 15%. No tax is embedded anywhere in either.
 */
export function RebateChainTool() {
  const s = strings.pro.racunovodstvo["rebate-chain"];
  const [purchasePriceText, setPurchasePriceText] = useState("");
  const [landedCostsText, setLandedCostsText] = useState("0");
  const [pair, setPair] = useState<PricePair>("costAndPrice");
  const [sellingPriceText, setSellingPriceText] = useState("");
  const [marginOnPricePercentText, setMarginOnPricePercentText] = useState("");
  const [marginOnCostPercentText, setMarginOnCostPercentText] = useState("");
  const [listPriceText, setListPriceText] = useState("");
  const [rebatesText, setRebatesText] = useState("");

  const needsSellingPrice = pair !== "costAndMarginOnPrice" && pair !== "costAndMarginOnCost";
  const needsMarginOnPrice = pair === "costAndMarginOnPrice" || pair === "priceAndMarginOnPrice";
  const needsMarginOnCost = pair === "costAndMarginOnCost" || pair === "priceAndMarginOnCost";

  const typedMargin = proParse(purchasePriceText) !== undefined;
  const marginResult = priceMargin({
    purchasePrice: proParse(purchasePriceText) ?? Number.NaN,
    landedCosts: proParse(landedCostsText) ?? 0,
    pair,
    ...(needsSellingPrice ? { sellingPrice: proParse(sellingPriceText) } : {}),
    ...(needsMarginOnPrice ? { marginOnPricePercent: proParse(marginOnPricePercentText) } : {}),
    ...(needsMarginOnCost ? { marginOnCostPercent: proParse(marginOnCostPercentText) } : {}),
  });
  const marginField = marginResult.ok ? undefined : reasonField(marginResult.reason);
  const marginFailure =
    marginResult.ok || !typedMargin
      ? undefined
      : marginField === "purchasePrice"
        ? s.errorPurchasePrice
        : marginField === "landedCosts"
          ? s.errorLandedCosts
          : marginField === "sellingPrice"
            ? s.errorSellingPrice
            : marginField === "marginOnPricePercent"
              ? s.errorMarginOnPricePercent
              : s.errorMarginOnCostPercent;

  const rebates = proAmountList(rebatesText);
  const typedChain = proParse(listPriceText) !== undefined || rebates.length > 0;
  const chainResult = rebateChain({
    listPrice: proParse(listPriceText) ?? Number.NaN,
    rebatePercents: rebates,
  });
  const chainField = chainResult.ok ? undefined : reasonField(chainResult.reason);
  const chainFailure =
    chainResult.ok || !typedChain
      ? undefined
      : chainField === "listPrice"
        ? s.errorListPrice
        : s.errorRebatePercents;

  const pairLabel =
    pair === "costAndPrice"
      ? s.pairCostAndPrice
      : pair === "costAndMarginOnPrice"
        ? s.pairCostAndMarginOnPrice
        : pair === "costAndMarginOnCost"
          ? s.pairCostAndMarginOnCost
          : pair === "priceAndMarginOnPrice"
            ? s.pairPriceAndMarginOnPrice
            : s.pairPriceAndMarginOnCost;

  const marginCopyText = !marginResult.ok
    ? ""
    : [
        `${s.cost}: ${proNum(marginResult.cost, 2)}`,
        `${s.sellingPrice}: ${proNum(marginResult.sellingPrice, 2)}`,
        `${s.difference}: ${proNum(marginResult.difference, 2)}`,
        marginResult.marginOnPricePercent === undefined ? undefined : `${s.marginOnPricePercent}: ${proNum(marginResult.marginOnPricePercent, 4)} %`,
        marginResult.marginOnCostPercent === undefined ? undefined : `${s.marginOnCostPercent}: ${proNum(marginResult.marginOnCostPercent, 4)} %`,
        "",
        `${s.pair}: ${pairLabel}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  const chainCopyText = !chainResult.ok
    ? ""
    : [
        ...chainResult.steps.map(
          (step, index) =>
            `${index + 1}: ${s.colBasis} ${proNum(step.basis, 2)} · ${s.colRebatePercent} ${proNum(step.rebatePercent, 2)} % · ${s.colRebateAmount} ${proNum(step.rebateAmount, 2)} · ${s.colRemaining} ${proNum(step.remaining, 2)}`,
        ),
        "",
        `${s.netPrice}: ${proNum(chainResult.netPrice, 2)}`,
        `${s.effectiveRebatePercent}: ${proNum(chainResult.effectiveRebatePercent, 4)} %`,
        "",
        `${s.listPrice}: ${proNum(proParse(listPriceText) ?? 0, 2)}`,
      ].join("\n");

  return (
    <>
      <ToolSection title={s.groupMargin}>
        <ToolInput label={s.purchasePrice} value={purchasePriceText} onChange={setPurchasePriceText} />
        <ToolInput label={s.landedCosts} value={landedCostsText} onChange={setLandedCostsText} />
        <ToolSelect<PricePair>
          label={s.pair}
          value={pair}
          onChange={setPair}
          options={[
            { id: "costAndPrice", label: s.pairCostAndPrice },
            { id: "costAndMarginOnPrice", label: s.pairCostAndMarginOnPrice },
            { id: "costAndMarginOnCost", label: s.pairCostAndMarginOnCost },
            { id: "priceAndMarginOnPrice", label: s.pairPriceAndMarginOnPrice },
            { id: "priceAndMarginOnCost", label: s.pairPriceAndMarginOnCost },
          ]}
        />
        {needsSellingPrice && (
          <ToolInput label={s.sellingPrice} value={sellingPriceText} onChange={setSellingPriceText} />
        )}
        {needsMarginOnPrice && (
          <ToolInput label={s.marginOnPricePercent} hint={s.marginOnPricePercentHint} value={marginOnPricePercentText} onChange={setMarginOnPricePercentText} />
        )}
        {needsMarginOnCost && (
          <ToolInput label={s.marginOnCostPercent} hint={s.marginOnCostPercentHint} value={marginOnCostPercentText} onChange={setMarginOnCostPercentText} />
        )}

        {marginFailure !== undefined && <ToolFailure>{marginFailure}</ToolFailure>}

        {marginResult.ok && typedMargin && (
          <>
            <ResultRow label={s.cost} value={proNum(marginResult.cost, 2)} />
            <ResultRow label={s.sellingPrice} value={proNum(marginResult.sellingPrice, 2)} />
            <ResultRow label={s.difference} value={proNum(marginResult.difference, 2)} />
            <ResultRow label={s.marginOnPricePercent} value={proMaybe(marginResult.marginOnPricePercent, 4)} />
            <ResultRow label={s.marginOnCostPercent} value={proMaybe(marginResult.marginOnCostPercent, 4)} />
            <ToolFormula>{s.formulaMargin}</ToolFormula>
            <ToolInputEcho entries={[{ label: s.pair, value: pairLabel }]} />
            <CopyButton value={marginCopyText} />
          </>
        )}
      </ToolSection>

      <ToolSection title={s.groupChain}>
        <ToolInput label={s.listPrice} value={listPriceText} onChange={setListPriceText} />
        <ToolTextArea label={s.rebates} hint={s.rebatesHint} value={rebatesText} onChange={setRebatesText} placeholder={s.rebatesPlaceholder} />

        {chainFailure !== undefined && <ToolFailure>{chainFailure}</ToolFailure>}

        {chainResult.ok && typedChain && (
          <>
            <ToolTable
              head={[s.colStep, s.colBasis, s.colRebatePercent, s.colRebateAmount, s.colRemaining]}
              rows={chainResult.steps.map((step, index) => [
                index + 1,
                proNum(step.basis, 2),
                `${proNum(step.rebatePercent, 2)} %`,
                proNum(step.rebateAmount, 2),
                proNum(step.remaining, 2),
              ])}
            />
            <ResultRow label={s.netPrice} value={proNum(chainResult.netPrice, 2)} />
            <ResultRow label={s.effectiveRebatePercent} value={`${proNum(chainResult.effectiveRebatePercent, 4)} %`} />
            <p className="tool__note">{s.effectiveNote}</p>
            <ToolFormula>{s.formulaChain}</ToolFormula>
            <ToolInputEcho title={s.inputs} entries={[{ label: s.listPrice, value: proNum(proParse(listPriceText) ?? 0, 2) }]} />
            <CopyButton value={chainCopyText} />
          </>
        )}
      </ToolSection>
    </>
  );
}

type BalanceMode = "columns" | "differenceOnly";

/**
 * Both sides of a trial balance added in whole minor units, their
 * difference, and every arithmetic explanation that difference admits — a
 * wrong-side entry, a digit transposition, a shifted decimal point. These are
 * NECESSARY conditions, never a finding: the tool lists what fits the
 * arithmetic and never says it has found the cause.
 */
export function TrialBalanceCheckTool() {
  const s = strings.pro.racunovodstvo["trial-balance-check"];
  const [mode, setMode] = useState<BalanceMode>("columns");
  const [debitsText, setDebitsText] = useState("");
  const [creditsText, setCreditsText] = useState("");
  const [differenceText, setDifferenceText] = useState("");
  const [decimalsText, setDecimalsText] = useState("2");

  const decimals = proParse(decimalsText) ?? 2;
  const debits = proAmountList(debitsText);
  const credits = proAmountList(creditsText);
  const differenceAmount = proParse(differenceText);
  // Bridging a typed decimal amount into the whole minor units
  // `trialBalanceDiagnostics` takes — the same `minorUnits` the amount-in-words
  // tool uses, and for the same reason. This used to be `Math.round(amount *
  // 10 ** decimals)`, which rounds half UP rather than away from zero: at zero
  // decimals a difference of −0,5 came back as `-0`, compared equal to zero,
  // and the tool reported „strane su izjednačene" on a book half a unit out.
  const differenceMinor =
    differenceAmount === undefined ? Number.NaN : (minorUnits(differenceAmount, decimals) ?? Number.NaN);

  const typed = mode === "columns" ? debits.length > 0 || credits.length > 0 : differenceAmount !== undefined;

  const columnsResult = mode === "columns" ? trialBalance({ debits, credits, decimals }) : undefined;
  const differenceResult =
    mode === "differenceOnly" ? trialBalanceDiagnostics(differenceMinor, decimals) : undefined;
  const result = columnsResult ?? differenceResult;

  const field = result === undefined || result.ok ? undefined : reasonField(result.reason);
  const failure =
    result === undefined || result.ok || !typed
      ? undefined
      : field === "decimals"
        ? s.errorDecimals
        : field === "difference"
          ? s.errorDifference
          : field === "debits"
            ? s.errorDebits
            : field === "credits"
              ? s.errorCredits
              : s.errorTooManyRows;

  const diagnostics = columnsResult?.ok ? columnsResult.diagnostics : differenceResult?.ok ? differenceResult : undefined;

  const pairsText = (pairs: readonly { readonly larger: number; readonly smaller: number }[]): string =>
    pairs.map((pair) => `${pair.larger}-${pair.smaller}`).join(", ");

  const copyText =
    diagnostics === undefined
      ? ""
      : [
          columnsResult?.ok ? `${s.debitTotal}: ${proNum(columnsResult.debitTotal, decimals)}` : undefined,
          columnsResult?.ok ? `${s.creditTotal}: ${proNum(columnsResult.creditTotal, decimals)}` : undefined,
          `${s.difference}: ${proNum(diagnostics.difference, decimals)}`,
          `${s.magnitude}: ${proNum(diagnostics.magnitude, decimals)}`,
          diagnostics.reversedItem === undefined ? undefined : `${s.reversedItem}: ${proNum(diagnostics.reversedItem, decimals)}`,
          diagnostics.shiftedByTen === undefined ? undefined : `${s.shiftedByTen}: ${proNum(diagnostics.shiftedByTen, decimals)}`,
          diagnostics.shiftedByHundred === undefined ? undefined : `${s.shiftedByHundred}: ${proNum(diagnostics.shiftedByHundred, decimals)}`,
          ...diagnostics.transpositions.map(
            (t) =>
              `${s.colLowerPosition} ${t.lowerPosition} / ${s.colUpperPosition} ${t.upperPosition}: ${s.colDigitGap} ${t.digitGap}, ${s.colStep} ${proNum(t.step, decimals)}, ${s.colPairs} ${pairsText(t.pairs)}`,
          ),
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n");

  return (
    <>
      <ToolSelect<BalanceMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        hint={s.modeHint}
        options={[
          { id: "columns", label: s.modeColumns },
          { id: "differenceOnly", label: s.modeDifferenceOnly },
        ]}
      />
      {mode === "columns" ? (
        <>
          <ToolTextArea label={s.debits} hint={s.listHint} value={debitsText} onChange={setDebitsText} />
          <ToolTextArea label={s.credits} hint={s.listHint} value={creditsText} onChange={setCreditsText} />
        </>
      ) : (
        <ToolInput label={s.differenceAmount} value={differenceText} onChange={setDifferenceText} />
      )}
      <ToolInput label={s.decimals} value={decimalsText} onChange={setDecimalsText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {diagnostics !== undefined && typed && (
        <ToolSection title={s.results}>
          {columnsResult?.ok && (
            <>
              <ResultRow label={s.debitTotal} value={proNum(columnsResult.debitTotal, decimals)} />
              <ResultRow label={s.creditTotal} value={proNum(columnsResult.creditTotal, decimals)} />
              <ResultRow label={s.debitCount} value={columnsResult.debitCount} />
              <ResultRow label={s.creditCount} value={columnsResult.creditCount} />
            </>
          )}
          <ResultRow label={s.difference} value={proNum(diagnostics.difference, decimals)} />
          <ResultRow label={s.magnitude} value={proNum(diagnostics.magnitude, decimals)} />
          {diagnostics.balanced ? (
            <p className="tool__note">{s.balancedNote}</p>
          ) : (
            <>
              {diagnostics.reversedItem !== undefined && (
                <ResultRow label={s.reversedItem} value={proNum(diagnostics.reversedItem, decimals)} />
              )}
              {diagnostics.shiftedByTen !== undefined && (
                <ResultRow label={s.shiftedByTen} value={proNum(diagnostics.shiftedByTen, decimals)} />
              )}
              {diagnostics.shiftedByHundred !== undefined && (
                <ResultRow label={s.shiftedByHundred} value={proNum(diagnostics.shiftedByHundred, decimals)} />
              )}
              {diagnostics.transpositions.length > 0 && (
                <ToolTable
                  head={[s.colLowerPosition, s.colUpperPosition, s.colDigitGap, s.colStep, s.colPairs]}
                  rows={diagnostics.transpositions.map((t) => [
                    t.lowerPosition,
                    t.upperPosition,
                    t.digitGap,
                    proNum(t.step, decimals),
                    pairsText(t.pairs),
                  ])}
                  prose={[4]}
                />
              )}
              <p className="tool__note">{s.necessaryNote}</p>
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.mode, value: mode === "columns" ? s.modeColumns : s.modeDifferenceOnly }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * The fifth of PV, FV, PMT, n and i from the other four — the one equation
 * behind every loan, annuity and investment schedule in the drawer.
 *
 * The field being solved for is not read from its own box: whatever is typed
 * there is ignored, and `Number.NaN` is passed instead, because the core
 * function only validates the four fields `solveFor` does not name.
 */
export function TvmSolverTool() {
  const s = strings.pro.racunovodstvo["tvm-solver"];
  const [pvText, setPvText] = useState("");
  const [fvText, setFvText] = useState("");
  const [pmtText, setPmtText] = useState("");
  const [periodsText, setPeriodsText] = useState("");
  const [rateText, setRateText] = useState("");
  const [timing, setTiming] = useState<PaymentTiming>("end");
  const [solveFor, setSolveFor] = useState<TvmUnknown>("pv");

  const unknownOptions: readonly { readonly id: TvmUnknown; readonly label: string }[] = [
    { id: "pv", label: s.unknownPv },
    { id: "fv", label: s.unknownFv },
    { id: "pmt", label: s.unknownPmt },
    { id: "periods", label: s.unknownPeriods },
    { id: "rate", label: s.unknownRate },
  ];
  const timingOptions: readonly { readonly id: PaymentTiming; readonly label: string }[] = [
    { id: "end", label: s.timingEnd },
    { id: "begin", label: s.timingBegin },
  ];

  const pv = solveFor === "pv" ? Number.NaN : (proParse(pvText) ?? Number.NaN);
  const fv = solveFor === "fv" ? Number.NaN : (proParse(fvText) ?? Number.NaN);
  const pmt = solveFor === "pmt" ? Number.NaN : (proParse(pmtText) ?? Number.NaN);
  const periods = solveFor === "periods" ? Number.NaN : (proParse(periodsText) ?? Number.NaN);
  const ratePercent = solveFor === "rate" ? Number.NaN : (proParse(rateText) ?? Number.NaN);

  const typed =
    (solveFor === "pv" || pvText !== "") &&
    (solveFor === "fv" || fvText !== "") &&
    (solveFor === "pmt" || pmtText !== "") &&
    (solveFor === "periods" || periodsText !== "") &&
    (solveFor === "rate" || rateText !== "");

  const result = tvmSolve({ pv, fv, pmt, periods, ratePercent, timing, solveFor });
  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "pv"
        ? s.errorPv
        : field === "fv"
          ? s.errorFv
          : field === "pmt"
            ? s.errorPmt
            : field === "periods"
              ? s.errorPeriods
              : field === "rate"
                ? s.errorRate
                : field === "rateOutOfRange"
                  ? s.errorRateOutOfRange
                  : s.errorCashflows;

  const solvedLabel = unknownOptions.find((option) => option.id === solveFor)?.label ?? "";
  const timingLabel = timingOptions.find((option) => option.id === timing)?.label ?? "";

  const copyText =
    result.ok && typed
      ? [
          `${s.solved} (${solvedLabel}): ${proNum(result.solved, 2)}`,
          `${s.unknownPv}: ${proNum(result.pv, 2)}`,
          `${s.unknownFv}: ${proNum(result.fv, 2)}`,
          `${s.unknownPmt}: ${proNum(result.pmt, 2)}`,
          `${s.unknownPeriods}: ${proNum(result.periods, 4)}`,
          `${s.unknownRate}: ${proUnit(proNum(result.ratePercent, 6), "%")}`,
          `${s.residual}: ${proNum(result.residual, 6)}`,
        ].join("\n")
      : "";

  return (
    <>
      <ToolSelect<TvmUnknown> label={s.solveFor} value={solveFor} onChange={setSolveFor} options={unknownOptions} />
      <ToolInput label={s.pv} hint={s.pvHint} value={pvText} onChange={setPvText} />
      <ToolInput label={s.fv} hint={s.fvHint} value={fvText} onChange={setFvText} />
      <ToolInput label={s.pmt} hint={s.pmtHint} value={pmtText} onChange={setPmtText} />
      <ToolInput label={s.periods} value={periodsText} onChange={setPeriodsText} />
      <ToolInput label={s.ratePercent} hint={s.ratePercentHint} value={rateText} onChange={setRateText} />
      <ToolSelect<PaymentTiming> label={s.timing} value={timing} onChange={setTiming} options={timingOptions} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={`${s.solved} (${solvedLabel})`} value={proNum(result.solved, 2)} />
          <ResultRow label={s.unknownPv} value={proNum(result.pv, 2)} />
          <ResultRow label={s.unknownFv} value={proNum(result.fv, 2)} />
          <ResultRow label={s.unknownPmt} value={proNum(result.pmt, 2)} />
          <ResultRow label={s.unknownPeriods} value={proNum(result.periods, 4)} />
          <ResultRow label={s.unknownRate} value={proUnit(proNum(result.ratePercent, 6), "%")} />
          <ResultRow label={s.residual} value={proNum(result.residual, 6)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.solveFor, value: solvedLabel },
              { label: s.timing, value: timingLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const RACUNOVODSTVO_SURFACES: Readonly<Record<string, ComponentType>> = {
  "allocation-remainder": AllocationRemainderTool,
  "amount-in-words": AmountInWordsTool,
  "bank-account-iban": BankAccountIbanTool,
  "benford-first-digit": BenfordFirstDigitTool,
  "breakeven-cvp": BreakevenCvpTool,
  "check-digits-id": CheckDigitsIdTool,
  "depreciation-schedule": DepreciationScheduleTool,
  "financial-ratios": FinancialRatiosTool,
  "fx-difference": FxDifferenceTool,
  "gross-up": GrossUpTool,
  "interest-periods": InterestPeriodsTool,
  "inventory-costing": InventoryCostingTool,
  "loan-schedule": LoanScheduleTool,
  "rate-conversion": RateConversionTool,
  "rebate-chain": RebateChainTool,
  "trial-balance-check": TrialBalanceCheckTool,
  "tvm-solver": TvmSolverTool,
};
