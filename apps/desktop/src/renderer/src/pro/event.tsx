import {
  beamSpot,
  eventBudget,
  type CostLine,
  type CostLineType,
  type TaxBaseMode,
  cateringPerGuest,
  type CateringLine,
  type CateringUnit,
  type CateringPackUnit,
  type PackRounding,
  generatorSizing,
  type GeneratorConsumer,
  iceChilling,
  ledWallLayout,
  parkingCloakroom,
  projectorThrowScreen,
  type ProjectorKnown,
  slingForce,
  type SlingAngleMode,
  type WllUnit,
  runOfShow,
  type RunOfShowItem,
  type RunOfShowDirection,
  seatingTables,
  type SeatingTable,
  stageDeckLayout,
  type SkirtSides,
  tentBayLayout,
  type TentSides,
  threePhaseLoadBalance,
  type ThreePhaseConsumer,
  type PhaseConnection,
  trussHoistReactions,
  type TrussPointLoad,
  venueOccupancyArea,
  type VenueLayoutRow,
  type LayoutBasis,
  voltageDrop,
  type VoltageDropSystem,
  type ConductorMaterial,
} from "@nexus/core/pro/event";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proRatio, proUnit } from "./format.js";
import {
  CopyButton,
  proRows,
  reasonField,
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
 * „Event i produkcija" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/event.ts`'s. Nothing here divides,
 * rounds or compares; this file shapes fields, hands the numbers over, and
 * reads the answers onto the page.
 *
 * **`generator-sizing`, `led-wall-pitch-viewing`, `rigging-sling-angle-force`,
 * `stage-deck-layout`, `three-phase-load-balance`, `truss-hoist-reactions`,
 * `voltage-drop` and `venue-occupancy-area` are `life-safety`; `ice-and-chilling`
 * is `food-safety`.** The host draws the notice from the registration and the
 * copy button appends the travelling line from the same place, so what is left
 * for a surface is the discipline the contract cannot enforce: show the
 * formula, echo the inputs, and put the user's own limit beside the computed
 * value with nothing but a ratio between them — never a word, a colour or an
 * icon that judges the two together.
 */

/** Distance is either the perpendicular throw (normal incidence) or a fixture height + horizontal offset (oblique). */
type BeamDistanceMode = "normal" | "oblique";

/**
 * Spot/field diameter, illuminance and fixture spacing for a beam angle —
 * normal or oblique incidence. All arithmetic is `beamSpot`'s; this only
 * shapes the two mutually exclusive distance inputs and reads the answer.
 */
export function BeamSpotTool() {
  const s = strings.pro.event["beam-spot-diameter"];
  const [beamAngle, setBeamAngle] = useState("");
  const [fieldAngle, setFieldAngle] = useState("");
  const [mode, setMode] = useState<BeamDistanceMode>("normal");
  const [distance, setDistance] = useState("");
  const [height, setHeight] = useState("");
  const [offset, setOffset] = useState("");
  const [intensity, setIntensity] = useState("");
  const [overlap, setOverlap] = useState("");
  const [coverage, setCoverage] = useState("");

  const typed =
    proParse(beamAngle) !== undefined || proParse(distance) !== undefined || proParse(height) !== undefined;

  const result = beamSpot({
    beamAngleDeg: proParse(beamAngle) ?? Number.NaN,
    fieldAngleDeg: proParse(fieldAngle),
    distanceM: mode === "normal" ? (proParse(distance) ?? Number.NaN) : undefined,
    heightM: mode === "oblique" ? (proParse(height) ?? Number.NaN) : undefined,
    horizontalOffsetM: mode === "oblique" ? proParse(offset) : undefined,
    intensityCd: proParse(intensity),
    overlapPct: proParse(overlap),
    coverageLengthM: proParse(coverage),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "beamAngleDeg"
        ? s.errorBeamAngle
        : field === "fieldAngleDeg"
          ? s.errorFieldAngle
          : field === "ambiguousDistance"
            ? s.errorAmbiguousDistance
            : field === "heightM"
              ? s.errorHeight
              : field === "horizontalOffsetM"
                ? s.errorOffset
                : field === "intensityCd"
                  ? s.errorIntensity
                  : field === "overlapPct"
                    ? s.errorOverlap
                    : field === "coverageLengthM"
                      ? s.errorCoverage
                      : field === "grazing"
                        ? s.errorGrazing
                        : s.errorDistance;

  const copyText = !result.ok
    ? ""
    : [
        result.spot.kind === "normal"
          ? `${s.beamDiameter}: ${proUnit(proNum(result.spot.beamDiameterM, 3), s.unitM)}`
          : undefined,
        result.spot.kind === "normal" && result.spot.fieldDiameterM !== undefined
          ? `${s.fieldDiameter}: ${proUnit(proNum(result.spot.fieldDiameterM, 3), s.unitM)}`
          : undefined,
        `${s.slantDistance}: ${proUnit(proNum(result.slantDistanceM, 3), s.unitM)}`,
        result.spot.kind === "oblique"
          ? `${s.minorAxis}: ${proUnit(proNum(result.spot.minorAxisM, 3), s.unitM)}`
          : undefined,
        result.spot.kind === "oblique"
          ? `${s.majorAxis}: ${proUnit(proNum(result.spot.majorAxisM, 3), s.unitM)}`
          : undefined,
        result.spot.kind === "oblique" ? `${s.tilt}: ${proNum(result.spot.tiltDeg, 2)}${s.unitDeg}` : undefined,
        result.spot.kind === "oblique"
          ? `${s.nearEdge}: ${proUnit(proNum(result.spot.nearEdgeM, 3), s.unitM)}`
          : undefined,
        result.spot.kind === "oblique"
          ? `${s.farEdge}: ${proUnit(proNum(result.spot.farEdgeM, 3), s.unitM)}`
          : undefined,
        result.illuminanceAtAimPointLx === undefined
          ? undefined
          : `${s.illuminance}: ${proUnit(proNum(result.illuminanceAtAimPointLx, 1), s.unitLx)}`,
        result.array === undefined
          ? undefined
          : `${s.spacing}: ${proUnit(proNum(result.array.spacingM, 3), s.unitM)}`,
        result.array === undefined ? undefined : `${s.fixtureCount}: ${result.array.fixtureCount}`,
        result.array === undefined
          ? undefined
          : `${s.coveredLength}: ${proUnit(proNum(result.array.coveredLengthM, 3), s.unitM)}`,
        "",
        `${s.beamAngle}: ${proNum(proParse(beamAngle) ?? 0, 1)}${s.unitDeg}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.beamAngle} hint={s.beamAngleHint} value={beamAngle} onChange={setBeamAngle} />
      <ToolInput label={s.fieldAngle} hint={s.fieldAngleHint} value={fieldAngle} onChange={setFieldAngle} />
      <ToolSelect<BeamDistanceMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "normal", label: s.modeNormal },
          { id: "oblique", label: s.modeOblique },
        ]}
      />
      {mode === "normal" ? (
        <ToolInput label={s.distance} value={distance} onChange={setDistance} />
      ) : (
        <>
          <ToolInput label={s.height} value={height} onChange={setHeight} />
          <ToolInput label={s.offset} hint={s.offsetHint} value={offset} onChange={setOffset} />
        </>
      )}
      <ToolInput label={s.intensity} hint={s.intensityHint} value={intensity} onChange={setIntensity} />
      <ToolInput label={s.overlap} value={overlap} onChange={setOverlap} />
      <ToolInput label={s.coverage} value={coverage} onChange={setCoverage} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {result.spot.kind === "normal" && (
            <>
              <ResultRow
                label={s.beamDiameter}
                value={proUnit(proNum(result.spot.beamDiameterM, 3), s.unitM)}
              />
              {result.spot.fieldDiameterM !== undefined && (
                <ResultRow
                  label={s.fieldDiameter}
                  value={proUnit(proNum(result.spot.fieldDiameterM, 3), s.unitM)}
                />
              )}
            </>
          )}
          <ResultRow label={s.slantDistance} value={proUnit(proNum(result.slantDistanceM, 3), s.unitM)} />
          {result.spot.kind === "oblique" && (
            <>
              <ResultRow label={s.minorAxis} value={proUnit(proNum(result.spot.minorAxisM, 3), s.unitM)} />
              <ResultRow label={s.majorAxis} value={proUnit(proNum(result.spot.majorAxisM, 3), s.unitM)} />
              <ResultRow label={s.tilt} value={`${proNum(result.spot.tiltDeg, 2)}${s.unitDeg}`} />
              <ResultRow label={s.nearEdge} value={proUnit(proNum(result.spot.nearEdgeM, 3), s.unitM)} />
              <ResultRow label={s.farEdge} value={proUnit(proNum(result.spot.farEdgeM, 3), s.unitM)} />
            </>
          )}
          {result.illuminanceAtAimPointLx !== undefined && (
            <ResultRow
              label={s.illuminance}
              value={proUnit(proNum(result.illuminanceAtAimPointLx, 1), s.unitLx)}
            />
          )}
          {result.array !== undefined && (
            <>
              <ResultRow label={s.spacing} value={proUnit(proNum(result.array.spacingM, 3), s.unitM)} />
              <ResultRow label={s.fixtureCount} value={result.array.fixtureCount} />
              <ResultRow
                label={s.coveredLength}
                value={proUnit(proNum(result.array.coveredLengthM, 3), s.unitM)}
              />
              <p className="tool__note">{s.axisNote}</p>
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.beamAngle, value: `${proNum(proParse(beamAngle) ?? 0, 1)}${s.unitDeg}` },
              { label: s.mode, value: mode === "normal" ? s.modeNormal : s.modeOblique },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

function mapCateringUnit(cell: string | undefined): CateringUnit | undefined {
  const t = (cell ?? "").trim().toLowerCase();
  return t === "g" || t === "ml" || t === "kom" ? t : undefined;
}

function mapCateringPackUnit(cell: string | undefined): CateringPackUnit | undefined {
  const t = (cell ?? "").trim().toLowerCase();
  return t === "g" || t === "kg" || t === "ml" || t === "l" || t === "kom" ? t : undefined;
}

/**
 * Purchase quantity, packs and cost for each catering line. Uptake and
 * reserve are the tool's own fields, never combined by the surface — the
 * compounding happens once, in `cateringPerGuest`.
 */
export function CateringPerGuestTool() {
  const s = strings.pro.event["catering-per-guest"];
  const [guests, setGuests] = useState("");
  const [linesText, setLinesText] = useState("");
  const [packRounding, setPackRounding] = useState<PackRounding>("up");

  const rows = proRows(linesText);
  const typed = proParse(guests) !== undefined || rows.length > 0;

  let unitError = false;
  const lines: CateringLine[] = rows.map((row) => {
    const unit = mapCateringUnit(row[1]);
    const packUnit = mapCateringPackUnit(row[6]);
    if (unit === undefined || packUnit === undefined) unitError = true;
    return {
      unit: unit ?? "g",
      quantityPerGuest: proParse(row[2] ?? "") ?? Number.NaN,
      uptakePct: proParse(row[3] ?? "") ?? Number.NaN,
      reservePct: proParse(row[4] ?? "") ?? Number.NaN,
      packSize: proParse(row[5] ?? "") ?? Number.NaN,
      packUnit: packUnit ?? "g",
      pricePerPack: proParse(row[7] ?? ""),
      pourSizeMl: proParse(row[8] ?? ""),
    };
  });

  const result = cateringPerGuest({ guests: proParse(guests) ?? Number.NaN, lines, packRounding });

  const field = result.ok ? undefined : reasonField(result.reason);
  const idx = result.ok ? undefined : rowNumber(result.reason);
  const failure = !typed
    ? undefined
    : unitError
      ? s.errorUnitToken
      : result.ok
        ? undefined
        : field === "guests"
          ? s.errorGuests
          : field === "lines"
            ? s.errorLines
            : field === "quantityPerGuest"
              ? `${s.errorQuantity} (${s.rowLabel} ${idx ?? "?"})`
              : field === "uptakePct"
                ? `${s.errorUptake} (${s.rowLabel} ${idx ?? "?"})`
                : field === "reservePct"
                  ? `${s.errorReserve} (${s.rowLabel} ${idx ?? "?"})`
                  : field === "packSize"
                    ? `${s.errorPackSize} (${s.rowLabel} ${idx ?? "?"})`
                    : field === "packUnit"
                      ? `${s.errorPackUnit} (${s.rowLabel} ${idx ?? "?"})`
                      : field === "pourSizeMl"
                        ? `${s.errorPourSize} (${s.rowLabel} ${idx ?? "?"})`
                        : `${s.errorPrice} (${s.rowLabel} ${idx ?? "?"})`;
  const showResults = typed && !unitError && result.ok;

  const copyText = !showResults || !result.ok
    ? ""
    : [
        ...result.lines.map(
          (lr, i) =>
            `${rows[i]?.[0] ?? "—"}: ${proNum(lr.grossQuantity, 1)} ${lines[i]?.unit ?? ""} · ${s.packs} ${lr.packs} · ${s.surplus} ${proNum(lr.surplus, 3)}`,
        ),
        result.cost === undefined ? undefined : `${s.totalCost}: ${proNum(result.cost.totalCost, 2)}`,
        result.cost === undefined
          ? undefined
          : `${s.totalCostPerGuest}: ${proNum(result.cost.totalCostPerGuest, 2)}`,
        "",
        `${s.guests}: ${guests.trim()}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.guests} value={guests} onChange={setGuests} />
      <ToolTextArea label={s.lines} hint={s.linesHint} value={linesText} onChange={setLinesText} rows={10} />
      <ToolSelect<PackRounding>
        label={s.packRounding}
        value={packRounding}
        onChange={setPackRounding}
        options={[
          { id: "up", label: s.packRoundingUp },
          { id: "exact", label: s.packRoundingExact },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {showResults && result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[
              s.colName,
              s.colGross,
              s.colGrossBig,
              s.colPacks,
              s.colSurplus,
              s.colPoursNeed,
              s.colPoursPurchased,
              s.colCost,
              s.colCostPerGuest,
              s.colCostPerTaking,
              s.colActualReserve,
            ]}
            rows={result.lines.map((lr, i) => [
              rows[i]?.[0] ?? "—",
              `${proNum(lr.grossQuantity, 1)} ${lines[i]?.unit ?? ""}`,
              lr.grossQuantityBig === undefined ? "—" : proNum(lr.grossQuantityBig, 3),
              lr.packs,
              proNum(lr.surplus, 3),
              lr.poursFromNeed === undefined ? "—" : lr.poursFromNeed,
              lr.poursFromPurchased === undefined ? "—" : lr.poursFromPurchased,
              lr.cost === undefined ? "—" : proNum(lr.cost, 2),
              lr.costPerGuest === undefined ? "—" : proNum(lr.costPerGuest, 2),
              lr.costPerTakingGuest === undefined ? "—" : proNum(lr.costPerTakingGuest, 2),
              lr.actualReservePct === undefined ? "—" : `${proNum(lr.actualReservePct, 1)}%`,
            ])}
            prose={[0]}
          />
          {result.cost !== undefined && (
            <>
              <ResultRow label={s.totalCost} value={proNum(result.cost.totalCost, 2)} />
              <ResultRow
                label={s.totalCostPerGuest}
                value={proNum(result.cost.totalCostPerGuest, 2)}
              />
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.guests, value: guests.trim() },
              {
                label: s.packRounding,
                value: packRounding === "up" ? s.packRoundingUp : s.packRoundingExact,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** One row's type token, as typed in the list — mapped to the core's `CostLineType`. */
function mapCostType(cell: string | undefined): CostLineType | undefined {
  const t = (cell ?? "").trim().toLowerCase();
  if (t === "fiksno") return "fixed";
  if (t === "gost") return "perGuest";
  if (t === "sto") return "perTable";
  if (t === "procenat") return "percent";
  return undefined;
}

/** The 1-based row number a core refusal's `:index` suffix names, for a message like „(red 3)". */
function rowNumber(reason: string): number | undefined {
  const at = reason.indexOf(":");
  if (at === -1) return undefined;
  const n = Number(reason.slice(at + 1));
  return Number.isInteger(n) ? n + 1 : undefined;
}

/**
 * Line-by-line budget roll-up, reserve, tax and the break-even ticket price.
 *
 * **A row's type token is parsed here, not in the core** — this is text
 * shaping, the same job `proRows` already does, and an unrecognised token
 * fails the tool outright rather than silently defaulting to „fiksno", which
 * would compute a wrong total under a right-looking type column.
 */
export function BudgetPerGuestTool() {
  const s = strings.pro.event["budget-per-guest"];
  const [guests, setGuests] = useState("");
  const [tables, setTables] = useState("");
  const [linesText, setLinesText] = useState("");
  const [reserve, setReserve] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [taxBaseMode, setTaxBaseMode] = useState<TaxBaseMode>("total");
  const [revenueText, setRevenueText] = useState("");
  const [payingGuests, setPayingGuests] = useState("");
  const [ticketPrice, setTicketPrice] = useState("");

  const rows = proRows(linesText);
  const typed = proParse(guests) !== undefined || rows.length > 0;

  let typeError = false;
  const lines: CostLine[] = rows.map((row) => {
    const type = mapCostType(row[1]);
    if (type === undefined) typeError = true;
    const baseCell = (row[3] ?? "").trim();
    const percentOfLines =
      type === "percent" && baseCell !== ""
        ? baseCell
            .split(",")
            .map((cell) => proParse(cell.trim()))
            .filter((n): n is number => n !== undefined)
            .map((n) => n - 1)
        : undefined;
    const taxableCell = (row[4] ?? "").trim().toLowerCase();
    return {
      type: type ?? "fixed",
      amount: proParse(row[2] ?? "") ?? Number.NaN,
      percentOfLines,
      taxable: taxableCell === "da" ? true : taxableCell === "ne" ? false : undefined,
    };
  });

  const revenueRows = proRows(revenueText);
  /**
   * „No table-based costing at all", which is what `eventBudget` documents 0 to
   * mean. `tables` is REQUIRED there, so this default is the surface's own —
   * which is exactly why it is written once and read three times rather than
   * restated beside the echo. It also fixes what the echo printed: the raw text
   * of the field, so „1.200" stayed „1.200" while the arithmetic used 1200.
   */
  const tablesUsed = proParse(tables) ?? 0;
  const result = eventBudget({
    guests: proParse(guests) ?? Number.NaN,
    tables: tablesUsed,
    lines,
    reservePct: proParse(reserve) ?? Number.NaN,
    taxRatePct: proParse(taxRate) ?? Number.NaN,
    taxBaseMode,
    revenueLines:
      revenueRows.length > 0
        ? revenueRows.map((row) => ({ amount: proParse(row[1] ?? "") ?? Number.NaN }))
        : undefined,
    payingGuests: proParse(payingGuests),
    ticketPrice: proParse(ticketPrice),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const idx = result.ok ? undefined : rowNumber(result.reason);
  const failure = !typed
    ? undefined
    : typeError
      ? s.errorLineType
      : result.ok
        ? undefined
        : field === "guests"
          ? s.errorGuests
          : field === "tables"
            ? s.errorTables
            : field === "lines"
              ? s.errorLines
              : field === "reservePct"
                ? s.errorReserve
                : field === "taxRatePct"
                  ? s.errorTaxRate
                  : field === "amount"
                    ? `${s.errorLineAmount} (${s.rowLabel} ${idx ?? "?"})`
                    : `${s.errorPercentOfLines} (${s.rowLabel} ${idx ?? "?"})`;
  const showResults = typed && !typeError && result.ok;

  const typeLabel = (t: CostLineType): string =>
    t === "fixed" ? s.typeFixed : t === "perGuest" ? s.typePerGuest : t === "perTable" ? s.typePerTable : s.typePercent;

  const copyText = !showResults || !result.ok
    ? ""
    : [
        `${s.base}: ${proNum(result.base, 2)}`,
        `${s.percentSum}: ${proNum(result.percentSum, 2)}`,
        `${s.subtotal}: ${proNum(result.subtotal, 2)}`,
        `${s.reserve}: ${proNum(result.reserve, 2)}`,
        `${s.preTaxTotal}: ${proNum(result.preTaxTotal, 2)}`,
        `${s.taxBaseAmount}: ${proNum(result.taxBaseAmount, 2)}`,
        `${s.tax}: ${proNum(result.tax, 2)}`,
        `${s.grandTotal}: ${proNum(result.grandTotal, 2)}`,
        `${s.costPerGuestWithTax}: ${proNum(result.costPerGuestWithTax, 2)}`,
        `${s.costPerGuestWithoutTax}: ${proNum(result.costPerGuestWithoutTax, 2)}`,
        result.perTable === undefined
          ? undefined
          : `${s.costPerTableWithTax}: ${proNum(result.perTable.costPerTableWithTax, 2)}`,
        result.revenue === undefined
          ? undefined
          : `${s.revenueTotal}: ${proNum(result.revenue.revenueTotal, 2)}`,
        result.revenue === undefined
          ? undefined
          : `${s.revenueDifference}: ${proNum(result.revenue.revenueDifference, 2)}`,
        result.breakEvenTicketPriceCeil === undefined
          ? undefined
          : `${s.breakEvenTicketPrice}: ${proNum(result.breakEvenTicketPriceCeil, 2)}`,
        "",
        `${s.guests}: ${proNum(proParse(guests) ?? 0, 0)}`,
        `${s.tables}: ${proNum(tablesUsed, 0)}`,
        `${s.taxRate}: ${proNum(proParse(taxRate) ?? 0, 2)}%`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.guests} value={guests} onChange={setGuests} />
      <ToolInput label={s.tables} hint={s.tablesHint} value={tables} onChange={setTables} />
      <ToolTextArea label={s.lines} hint={s.linesHint} value={linesText} onChange={setLinesText} />
      <ToolInput label={s.reserve} value={reserve} onChange={setReserve} />
      <ToolInput label={s.taxRate} hint={s.taxRateHint} value={taxRate} onChange={setTaxRate} />
      <ToolSelect<TaxBaseMode>
        label={s.taxBaseMode}
        value={taxBaseMode}
        onChange={setTaxBaseMode}
        hint={s.taxBaseModeHint}
        options={[
          { id: "total", label: s.taxBaseModeTotal },
          { id: "marked", label: s.taxBaseModeMarked },
        ]}
      />
      <ToolTextArea label={s.revenueLines} hint={s.revenueLinesHint} value={revenueText} onChange={setRevenueText} />
      <ToolInput label={s.payingGuests} value={payingGuests} onChange={setPayingGuests} />
      <ToolInput label={s.ticketPrice} value={ticketPrice} onChange={setTicketPrice} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {showResults && result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colName, s.colType, s.colAmount, s.colShare, s.colPercentBase]}
            rows={result.lines.map((lr, i) => [
              rows[i]?.[0] ?? "—",
              typeLabel(lines[i]?.type ?? "fixed"),
              proNum(lr.amount, 2),
              lr.sharePct === undefined ? "—" : `${proNum(lr.sharePct, 1)}%`,
              lr.percentBaseAmount === undefined ? "—" : proNum(lr.percentBaseAmount, 2),
            ])}
            prose={[0]}
          />
          <ResultRow label={s.base} value={proNum(result.base, 2)} />
          <ResultRow label={s.percentSum} value={proNum(result.percentSum, 2)} />
          <ResultRow label={s.subtotal} value={proNum(result.subtotal, 2)} />
          <ResultRow label={s.reserve} value={proNum(result.reserve, 2)} />
          <ResultRow label={s.preTaxTotal} value={proNum(result.preTaxTotal, 2)} />
          <ResultRow label={s.taxBaseAmount} value={proNum(result.taxBaseAmount, 2)} />
          <ResultRow label={s.tax} value={proNum(result.tax, 2)} />
          <ResultRow label={s.grandTotal} value={proNum(result.grandTotal, 2)} />
          <ResultRow label={s.costPerGuestWithTax} value={proNum(result.costPerGuestWithTax, 2)} />
          <ResultRow label={s.costPerGuestWithoutTax} value={proNum(result.costPerGuestWithoutTax, 2)} />
          {result.perTable !== undefined && (
            <>
              <ResultRow
                label={s.costPerTableWithTax}
                value={proNum(result.perTable.costPerTableWithTax, 2)}
              />
              <ResultRow
                label={s.costPerTableWithoutTax}
                value={proNum(result.perTable.costPerTableWithoutTax, 2)}
              />
            </>
          )}
          {result.revenue !== undefined && (
            <>
              <ResultRow label={s.revenueTotal} value={proNum(result.revenue.revenueTotal, 2)} />
              <ResultRow
                label={s.revenueDifference}
                value={proNum(result.revenue.revenueDifference, 2)}
              />
            </>
          )}
          {result.breakEvenTicketPriceCeil !== undefined && (
            <ResultRow label={s.breakEvenTicketPrice} value={proNum(result.breakEvenTicketPriceCeil, 2)} />
          )}
          {result.ticketRevenue !== undefined && (
            <ResultRow label={s.ticketRevenue} value={proNum(result.ticketRevenue, 2)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.guests, value: proNum(proParse(guests) ?? 0, 0) },
              { label: s.tables, value: proNum(tablesUsed, 0) },
              { label: s.reserve, value: `${proNum(proParse(reserve) ?? 0, 1)}%` },
              { label: s.taxRate, value: `${proNum(proParse(taxRate) ?? 0, 1)}%` },
              {
                label: s.taxBaseMode,
                value: taxBaseMode === "total" ? s.taxBaseModeTotal : s.taxBaseModeMarked,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Running load, the worst motor-starting peak, and the resulting design kVA.
 * Every consumer's starting figures live on its OWN row — the peak is picked
 * by the computed starting kVA, never by the largest nameplate kW.
 */
export function GeneratorSizingTool() {
  const s = strings.pro.event["generator-sizing"];
  const [consumersText, setConsumersText] = useState("");
  const [reserve, setReserve] = useState("");
  const [derate, setDerate] = useState("");
  const [ratedPowerFactor, setRatedPowerFactor] = useState("");
  const [fuelRate, setFuelRate] = useState("");
  const [hours, setHours] = useState("");
  const [ratedPowerKw, setRatedPowerKw] = useState("");

  const rows = proRows(consumersText);
  const typed = rows.length > 0;

  const consumers: GeneratorConsumer[] = rows.map((row) => ({
    kw: proParse(row[1] ?? "") ?? Number.NaN,
    cosPhi: proParse(row[2] ?? "") ?? Number.NaN,
    simultaneityPct: proParse(row[3] ?? ""),
    isMotor: (row[4] ?? "").trim().toLowerCase() === "da",
    startingKvaPerKw: proParse(row[5] ?? ""),
    startingCosPhi: proParse(row[6] ?? ""),
  }));

  const result = generatorSizing({
    consumers,
    reservePct: proParse(reserve) ?? Number.NaN,
    deratePct: proParse(derate) ?? Number.NaN,
    ratedPowerFactor: proParse(ratedPowerFactor) ?? Number.NaN,
    specificFuelConsumptionLPerKwh: proParse(fuelRate),
    hours: proParse(hours),
    ratedPowerKw: proParse(ratedPowerKw),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const idx = result.ok ? undefined : rowNumber(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "consumers"
        ? s.errorConsumers
        : field === "reservePct"
          ? s.errorReserve
          : field === "deratePct"
            ? s.errorDerate
            : field === "ratedPowerFactor"
              ? s.errorRatedPowerFactor
              : field === "ratedPowerKw"
                ? s.errorRatedPowerKw
                : field === "specificFuelConsumptionLPerKwh"
                  ? s.errorFuelRate
                  : field === "hours"
                    ? s.errorHours
                    : field === "kw"
                      ? `${s.errorKw} (${s.rowLabel} ${idx ?? "?"})`
                      : field === "cosPhi"
                        ? `${s.errorCosPhi} (${s.rowLabel} ${idx ?? "?"})`
                        : field === "simultaneityPct"
                          ? `${s.errorSimultaneity} (${s.rowLabel} ${idx ?? "?"})`
                          : field === "startingKvaPerKw"
                            ? `${s.errorStartingKva} (${s.rowLabel} ${idx ?? "?"})`
                            : `${s.errorStartingCosPhi} (${s.rowLabel} ${idx ?? "?"})`;

  const copyText = !result.ok
    ? ""
    : [
        `${s.runningActive}: ${proUnit(proNum(result.runningActiveKw, 3), s.unitKw)}`,
        `${s.runningReactive}: ${proUnit(proNum(result.runningReactiveKvar, 3), s.unitKvar)}`,
        `${s.runningApparent}: ${proUnit(proNum(result.runningApparentKva, 3), s.unitKva)}`,
        result.runningPowerFactor === undefined
          ? undefined
          : `${s.runningPowerFactor}: ${proNum(result.runningPowerFactor, 4)}`,
        result.peakMotorIndex === undefined
          ? undefined
          : `${s.peakApparent}: ${proUnit(proNum(result.peakApparentKva, 3), s.unitKva)}`,
        `${s.designApparent}: ${proUnit(proNum(result.designApparentKva, 3), s.unitKva)}`,
        `${s.designActive}: ${proUnit(proNum(result.designActiveKw, 3), s.unitKw)}`,
        result.fuelLitresPerHour === undefined
          ? undefined
          : `${s.fuelPerHour}: ${proUnit(proNum(result.fuelLitresPerHour, 2), s.unitLh)}`,
        result.fuelLitresTotal === undefined
          ? undefined
          : `${s.fuelTotal}: ${proUnit(proNum(result.fuelLitresTotal, 1), s.unitL)}`,
        result.loadPct === undefined ? undefined : `${s.loadPct}: ${proNum(result.loadPct, 1)}%`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolTextArea
        label={s.consumers}
        hint={s.consumersHint}
        value={consumersText}
        onChange={setConsumersText}
        rows={10}
      />
      <ToolInput label={s.reserve} value={reserve} onChange={setReserve} />
      <ToolInput label={s.derate} hint={s.derateHint} value={derate} onChange={setDerate} />
      <ToolInput
        label={s.ratedPowerFactor}
        hint={s.ratedPowerFactorHint}
        value={ratedPowerFactor}
        onChange={setRatedPowerFactor}
      />
      <ToolInput label={s.ratedPowerKw} hint={s.ratedPowerKwHint} value={ratedPowerKw} onChange={setRatedPowerKw} />
      <ToolInput label={s.fuelRate} hint={s.fuelRateHint} value={fuelRate} onChange={setFuelRate} />
      <ToolInput label={s.hours} value={hours} onChange={setHours} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.runningActive} value={proUnit(proNum(result.runningActiveKw, 3), s.unitKw)} />
          <ResultRow label={s.runningReactive} value={proUnit(proNum(result.runningReactiveKvar, 3), s.unitKvar)} />
          <ResultRow label={s.runningApparent} value={proUnit(proNum(result.runningApparentKva, 3), s.unitKva)} />
          {result.runningPowerFactor !== undefined && (
            <ResultRow label={s.runningPowerFactor} value={proNum(result.runningPowerFactor, 4)} />
          )}
          {result.peakMotorIndex !== undefined && (
            <>
              <ResultRow label={s.peakActive} value={proUnit(proNum(result.peakActiveKw, 3), s.unitKw)} />
              <ResultRow label={s.peakReactive} value={proUnit(proNum(result.peakReactiveKvar, 3), s.unitKvar)} />
              <ResultRow label={s.peakApparent} value={proUnit(proNum(result.peakApparentKva, 3), s.unitKva)} />
            </>
          )}
          <ResultRow label={s.designApparent} value={proUnit(proNum(result.designApparentKva, 3), s.unitKva)} />
          <ResultRow label={s.designActive} value={proUnit(proNum(result.designActiveKw, 3), s.unitKw)} />
          {result.fuelLitresPerHour !== undefined && (
            <ResultRow label={s.fuelPerHour} value={proUnit(proNum(result.fuelLitresPerHour, 2), s.unitLh)} />
          )}
          {result.fuelLitresTotal !== undefined && (
            <ResultRow label={s.fuelTotal} value={proUnit(proNum(result.fuelLitresTotal, 1), s.unitL)} />
          )}
          {result.loadPct !== undefined && <ResultRow label={s.loadPct} value={`${proNum(result.loadPct, 1)}%`} />}
          <p className="tool__note">{s.fuelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.reserve, value: `${proNum(proParse(reserve) ?? 0, 1)}%` },
              { label: s.derate, value: `${proNum(proParse(derate) ?? 0, 1)}%` },
              { label: s.ratedPowerFactor, value: proNum(proParse(ratedPowerFactor) ?? 0, 2) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Whether the drink quantity was typed as a mass or as a volume (× the user's own density). */
type IceQuantityMode = "mass" | "volume";
/** Which of the two mutually exclusive holding-loss paths is in use, or neither. */
type IceHoldMode = "none" | "watt" | "ua";

/**
 * Ice needed to pull a drink down to a target temperature, plus holding melt.
 * `icePulldownKg` is the ideal LOWER bound (complete melt); `iceHoldingMeltKg`
 * is the latent-only UPPER bound — this is a quantity tool and prints both
 * without ever saying whether the amount is „enough".
 */
export function IceChillingTool() {
  const s = strings.pro.event["ice-and-chilling"];
  const [quantityMode, setQuantityMode] = useState<IceQuantityMode>("mass");
  const [drinkMass, setDrinkMass] = useState("");
  const [drinkVolume, setDrinkVolume] = useState("");
  const [drinkDensity, setDrinkDensity] = useState("");
  const [drinkSpecificHeat, setDrinkSpecificHeat] = useState("");
  const [packagingMass, setPackagingMass] = useState("");
  const [packagingSpecificHeat, setPackagingSpecificHeat] = useState("");
  const [startTemp, setStartTemp] = useState("");
  const [targetTemp, setTargetTemp] = useState("");
  const [iceTemp, setIceTemp] = useState("");
  const [holdMode, setHoldMode] = useState<IceHoldMode>("none");
  const [ambientWatt, setAmbientWatt] = useState("");
  const [holdUa, setHoldUa] = useState("");
  const [ambientTemp, setAmbientTemp] = useState("");
  const [holdHours, setHoldHours] = useState("");
  const [bagMass, setBagMass] = useState("");
  const [bulkFraction, setBulkFraction] = useState("");
  const [meltsIntoDrink, setMeltsIntoDrink] = useState<"da" | "ne">("ne");

  const typed =
    proParse(drinkMass) !== undefined ||
    proParse(drinkVolume) !== undefined ||
    proParse(startTemp) !== undefined ||
    proParse(targetTemp) !== undefined;

  const result = iceChilling({
    drinkMassKg: quantityMode === "mass" ? proParse(drinkMass) : undefined,
    drinkVolumeL: quantityMode === "volume" ? proParse(drinkVolume) : undefined,
    drinkDensityKgPerL: quantityMode === "volume" ? proParse(drinkDensity) : undefined,
    drinkSpecificHeat: proParse(drinkSpecificHeat),
    packagingMassKg: proParse(packagingMass),
    packagingSpecificHeat: proParse(packagingSpecificHeat),
    startTempC: proParse(startTemp) ?? Number.NaN,
    targetTempC: proParse(targetTemp) ?? Number.NaN,
    iceTempC: proParse(iceTemp),
    ambientHeatIngressW: holdMode === "watt" ? proParse(ambientWatt) : undefined,
    holdUaWPerK: holdMode === "ua" ? proParse(holdUa) : undefined,
    ambientTempC: holdMode === "ua" ? proParse(ambientTemp) : undefined,
    holdHours: holdMode === "none" ? undefined : proParse(holdHours),
    bagMassKg: proParse(bagMass),
    bulkSolidFraction: proParse(bulkFraction),
    meltsIntoDrink: meltsIntoDrink === "da",
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "drinkMassKg"
        ? s.errorDrinkMass
        : field === "drinkVolumeL"
          ? s.errorDrinkVolume
          : field === "drinkDensityKgPerL"
            ? s.errorDrinkDensity
            : field === "drinkSpecificHeat"
              ? s.errorDrinkSpecificHeat
              : field === "packagingMassKg"
                ? s.errorPackagingMass
                : field === "packagingSpecificHeat"
                  ? s.errorPackagingSpecificHeat
                  : field === "startTempC"
                    ? s.errorStartTemp
                    : field === "targetTempC"
                      ? s.errorTargetTemp
                      : field === "iceTempC"
                        ? s.errorIceTemp
                        : field === "bagMassKg"
                          ? s.errorBagMass
                          : field === "bulkSolidFraction"
                            ? s.errorBulkFraction
                            : field === "ambiguousHoldPath"
                              ? s.errorAmbiguousHold
                              : field === "holdHours"
                                ? s.errorHoldHours
                                : field === "ambientHeatIngressW"
                                  ? s.errorAmbientWatt
                                  : s.errorHoldUa;

  const copyText = !result.ok
    ? ""
    : [
        `${s.heatToRemove}: ${proUnit(proNum(result.heatToRemoveKj, 1), s.unitKj)}`,
        result.noCoolingNeeded ? s.noCoolingNeededNote : undefined,
        `${s.icePulldown}: ${proUnit(proNum(result.icePulldownKg, 3), s.unitKg)}`,
        result.iceHoldingMeltKg === undefined
          ? undefined
          : `${s.iceHoldingMelt}: ${proUnit(proNum(result.iceHoldingMeltKg, 3), s.unitKg)}`,
        `${s.totalIce}: ${proUnit(proNum(result.totalIceKg, 2), s.unitKg)}`,
        `${s.solidVolume}: ${proUnit(proNum(result.solidVolumeL, 1), s.unitL)}`,
        result.bulkVolumeL === undefined
          ? undefined
          : `${s.bulkVolume}: ${proUnit(proNum(result.bulkVolumeL, 1), s.unitL)}`,
        `${s.bags}: ${result.bags}`,
        `${s.meltwaterMass}: ${proUnit(proNum(result.meltwaterMassKg, 2), s.unitKg)}`,
        result.dilutionPct === undefined ? undefined : `${s.dilution}: ${proNum(result.dilutionPct, 1)}%`,
        `${s.iceToDrinkRatio}: ${proNum(result.iceToDrinkRatio, 3)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<IceQuantityMode>
        label={s.quantityMode}
        value={quantityMode}
        onChange={setQuantityMode}
        options={[
          { id: "mass", label: s.quantityModeMass },
          { id: "volume", label: s.quantityModeVolume },
        ]}
      />
      {quantityMode === "mass" ? (
        <ToolInput label={s.drinkMass} value={drinkMass} onChange={setDrinkMass} />
      ) : (
        <>
          <ToolInput label={s.drinkVolume} value={drinkVolume} onChange={setDrinkVolume} />
          <ToolInput label={s.drinkDensity} value={drinkDensity} onChange={setDrinkDensity} />
        </>
      )}
      <ToolInput
        label={s.drinkSpecificHeat}
        hint={s.drinkSpecificHeatHint}
        value={drinkSpecificHeat}
        onChange={setDrinkSpecificHeat}
      />
      <ToolInput label={s.packagingMass} hint={s.packagingMassHint} value={packagingMass} onChange={setPackagingMass} />
      <ToolInput
        label={s.packagingSpecificHeat}
        hint={s.packagingSpecificHeatHint}
        value={packagingSpecificHeat}
        onChange={setPackagingSpecificHeat}
      />
      <ToolInput label={s.startTemp} value={startTemp} onChange={setStartTemp} />
      <ToolInput label={s.targetTemp} hint={s.targetTempHint} value={targetTemp} onChange={setTargetTemp} />
      <ToolInput label={s.iceTemp} hint={s.iceTempHint} value={iceTemp} onChange={setIceTemp} />
      <ToolSelect<IceHoldMode>
        label={s.holdMode}
        value={holdMode}
        onChange={setHoldMode}
        options={[
          { id: "none", label: s.holdModeNone },
          { id: "watt", label: s.holdModeWatt },
          { id: "ua", label: s.holdModeUa },
        ]}
      />
      {holdMode === "watt" && <ToolInput label={s.ambientWatt} value={ambientWatt} onChange={setAmbientWatt} />}
      {holdMode === "ua" && (
        <>
          <ToolInput label={s.holdUa} hint={s.holdUaHint} value={holdUa} onChange={setHoldUa} />
          <ToolInput label={s.ambientTemp} value={ambientTemp} onChange={setAmbientTemp} />
        </>
      )}
      {holdMode !== "none" && <ToolInput label={s.holdHours} value={holdHours} onChange={setHoldHours} />}
      <ToolInput label={s.bagMass} hint={s.bagMassHint} value={bagMass} onChange={setBagMass} />
      <ToolInput label={s.bulkFraction} hint={s.bulkFractionHint} value={bulkFraction} onChange={setBulkFraction} />
      <ToolSelect<"da" | "ne">
        label={s.meltsIntoDrink}
        value={meltsIntoDrink}
        onChange={setMeltsIntoDrink}
        hint={s.meltsIntoDrinkHint}
        options={[
          { id: "ne", label: s.no },
          { id: "da", label: s.yes },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.heatToRemove} value={proUnit(proNum(result.heatToRemoveKj, 1), s.unitKj)} />
          <ResultRow label={s.icePulldown} value={proUnit(proNum(result.icePulldownKg, 3), s.unitKg)} />
          {result.noCoolingNeeded && <p className="tool__note">{s.noCoolingNeededNote}</p>}
          {result.iceHoldingMeltKg !== undefined && (
            <ResultRow label={s.iceHoldingMelt} value={proUnit(proNum(result.iceHoldingMeltKg, 3), s.unitKg)} />
          )}
          <ResultRow label={s.totalIce} value={proUnit(proNum(result.totalIceKg, 2), s.unitKg)} />
          <ResultRow label={s.solidVolume} value={proUnit(proNum(result.solidVolumeL, 1), s.unitL)} />
          {result.bulkVolumeL !== undefined && (
            <ResultRow label={s.bulkVolume} value={proUnit(proNum(result.bulkVolumeL, 1), s.unitL)} />
          )}
          <ResultRow label={s.bags} value={result.bags} />
          <ResultRow label={s.meltwaterMass} value={proUnit(proNum(result.meltwaterMassKg, 2), s.unitKg)} />
          {result.dilutionPct !== undefined && (
            <ResultRow label={s.dilution} value={`${proNum(result.dilutionPct, 1)}%`} />
          )}
          <ResultRow label={s.iceToDrinkRatio} value={proNum(result.iceToDrinkRatio, 3)} />
          <p className="tool__note">{s.boundsNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.startTemp, value: `${proNum(proParse(startTemp) ?? 0, 1)}${s.unitC}` },
              { label: s.targetTemp, value: `${proNum(proParse(targetTemp) ?? 0, 1)}${s.unitC}` },
              { label: s.iceTemp, value: `${proNum(proParse(iceTemp) ?? 0, 1)}${s.unitC}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** Panel counts typed directly, or a target wall size the tool derives them from. */
type LedWallSizeMode = "panels" | "target";

/**
 * Panel resolution, wall size, viewing distance and power for an LED wall.
 * Ports are counted by whole panels, never sliced across two ports — that
 * arithmetic is `ledWallLayout`'s; this only shapes the two ways to size the
 * wall and the optional power block.
 */
export function LedWallTool() {
  const s = strings.pro.event["led-wall-pitch-viewing"];
  const [pitch, setPitch] = useState("");
  const [panelWidth, setPanelWidth] = useState("");
  const [panelHeight, setPanelHeight] = useState("");
  const [sizeMode, setSizeMode] = useState<LedWallSizeMode>("panels");
  const [panelsWide, setPanelsWide] = useState("");
  const [panelsHigh, setPanelsHigh] = useState("");
  const [targetWidth, setTargetWidth] = useState("");
  const [targetHeight, setTargetHeight] = useState("");
  const [acuity, setAcuity] = useState("");
  const [portCapacity, setPortCapacity] = useState("");
  const [panelMaxW, setPanelMaxW] = useState("");
  const [panelAvgW, setPanelAvgW] = useState("");
  const [voltage, setVoltage] = useState("");
  const [powerFactor, setPowerFactor] = useState("");

  const typed = proParse(pitch) !== undefined;

  const result = ledWallLayout({
    pitchMm: proParse(pitch) ?? Number.NaN,
    panelWidthMm: proParse(panelWidth),
    panelHeightMm: proParse(panelHeight),
    panelsWide: sizeMode === "panels" ? proParse(panelsWide) : undefined,
    panelsHigh: sizeMode === "panels" ? proParse(panelsHigh) : undefined,
    targetWidthM: sizeMode === "target" ? proParse(targetWidth) : undefined,
    targetHeightM: sizeMode === "target" ? proParse(targetHeight) : undefined,
    acuityArcmin: proParse(acuity) ?? Number.NaN,
    portCapacityPx: proParse(portCapacity),
    panelMaxW: proParse(panelMaxW),
    panelAvgW: proParse(panelAvgW),
    voltage: proParse(voltage),
    powerFactor: proParse(powerFactor),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "pitchMm"
        ? s.errorPitch
        : field === "panelWidthMm"
          ? s.errorPanelWidth
          : field === "panelHeightMm"
            ? s.errorPanelHeight
            : field === "acuityArcmin"
              ? s.errorAcuity
              : field === "panelsWide"
                ? s.errorPanelsWide
                : field === "panelsHigh"
                  ? s.errorPanelsHigh
                  : field === "targetWidthM"
                    ? s.errorTargetWidth
                    : field === "targetHeightM"
                      ? s.errorTargetHeight
                      : field === "portCapacityPx"
                        ? s.errorPortCapacity
                        : field === "panelMaxW"
                          ? s.errorPanelMaxW
                          : field === "panelAvgW"
                            ? s.errorPanelAvgW
                            : field === "voltage"
                              ? s.errorVoltage
                              : s.errorPowerFactor;

  const copyText = !result.ok
    ? ""
    : [
        `${s.panelResolution}: ${result.panelPixelsWide} × ${result.panelPixelsHigh} px`,
        `${s.wallResolution}: ${result.resolutionWide} × ${result.resolutionHigh} px (${result.totalPixels} px)`,
        `${s.wallSize}: ${proUnit(proNum(result.wallWidthM, 3), s.unitM)} × ${proUnit(proNum(result.wallHeightM, 3), s.unitM)}`,
        `${s.aspect}: ${result.aspectReducedWide}:${result.aspectReducedHigh} (${proNum(result.aspectDecimal, 3)})`,
        `${s.pixelDensity}: ${proUnit(proNum(result.pixelDensityPxPerM, 1), s.unitPxM)}`,
        `${s.viewingAtAcuity}: ${proUnit(proNum(result.viewingDistanceAtAcuityM, 2), s.unitM)}`,
        `${s.viewingAt1}: ${proUnit(proNum(result.viewingDistanceAt1ArcminM, 2), s.unitM)}`,
        `${s.viewingAt2}: ${proUnit(proNum(result.viewingDistanceAt2ArcminM, 2), s.unitM)}`,
        result.ports === undefined ? undefined : `${s.ports}: ${result.ports}`,
        result.powerMaxKw === undefined ? undefined : `${s.powerMax}: ${proUnit(proNum(result.powerMaxKw, 3), s.unitKw)}`,
        result.powerAvgKw === undefined ? undefined : `${s.powerAvg}: ${proUnit(proNum(result.powerAvgKw, 3), s.unitKw)}`,
        result.apparentMaxKva === undefined
          ? undefined
          : `${s.apparentMax}: ${proUnit(proNum(result.apparentMaxKva, 3), s.unitKva)}`,
        result.apparentAvgKva === undefined
          ? undefined
          : `${s.apparentAvg}: ${proUnit(proNum(result.apparentAvgKva, 3), s.unitKva)}`,
        result.currentMaxA === undefined
          ? undefined
          : `${s.currentMax}: ${proUnit(proNum(result.currentMaxA, 2), s.unitA)}`,
        result.currentAvgA === undefined
          ? undefined
          : `${s.currentAvg}: ${proUnit(proNum(result.currentAvgA, 2), s.unitA)}`,
        "",
        `${s.pitch}: ${proUnit(proNum(proParse(pitch) ?? 0, 2), s.unitMm)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.pitch} hint={s.pitchHint} value={pitch} onChange={setPitch} />
      <ToolInput label={s.panelWidth} hint={s.panelDimHint} value={panelWidth} onChange={setPanelWidth} />
      <ToolInput label={s.panelHeight} value={panelHeight} onChange={setPanelHeight} />
      <ToolSelect<LedWallSizeMode>
        label={s.sizeMode}
        value={sizeMode}
        onChange={setSizeMode}
        options={[
          { id: "panels", label: s.sizeModePanels },
          { id: "target", label: s.sizeModeTarget },
        ]}
      />
      {sizeMode === "panels" ? (
        <>
          <ToolInput label={s.panelsWide} value={panelsWide} onChange={setPanelsWide} />
          <ToolInput label={s.panelsHigh} value={panelsHigh} onChange={setPanelsHigh} />
        </>
      ) : (
        <>
          <ToolInput label={s.targetWidth} value={targetWidth} onChange={setTargetWidth} />
          <ToolInput label={s.targetHeight} value={targetHeight} onChange={setTargetHeight} />
        </>
      )}
      <ToolInput label={s.acuity} hint={s.acuityHint} value={acuity} onChange={setAcuity} />
      <ToolInput label={s.portCapacity} hint={s.portCapacityHint} value={portCapacity} onChange={setPortCapacity} />
      <ToolInput label={s.panelMaxW} hint={s.panelPowerHint} value={panelMaxW} onChange={setPanelMaxW} />
      <ToolInput label={s.panelAvgW} value={panelAvgW} onChange={setPanelAvgW} />
      <ToolInput label={s.voltage} hint={s.voltageHint} value={voltage} onChange={setVoltage} />
      <ToolInput label={s.powerFactor} hint={s.powerFactorHint} value={powerFactor} onChange={setPowerFactor} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.panelResolution} value={`${result.panelPixelsWide} × ${result.panelPixelsHigh} px`} />
          <ResultRow
            label={s.wallResolution}
            value={`${result.resolutionWide} × ${result.resolutionHigh} px (${result.totalPixels} px)`}
          />
          <ResultRow
            label={s.wallSize}
            value={`${proUnit(proNum(result.wallWidthM, 3), s.unitM)} × ${proUnit(proNum(result.wallHeightM, 3), s.unitM)}`}
          />
          <ResultRow
            label={s.aspect}
            value={`${result.aspectReducedWide}:${result.aspectReducedHigh} (${proNum(result.aspectDecimal, 3)})`}
          />
          <ResultRow label={s.pixelDensity} value={proUnit(proNum(result.pixelDensityPxPerM, 1), s.unitPxM)} />
          <ResultRow label={s.viewingAtAcuity} value={proUnit(proNum(result.viewingDistanceAtAcuityM, 2), s.unitM)} />
          <ResultRow label={s.viewingAt1} value={proUnit(proNum(result.viewingDistanceAt1ArcminM, 2), s.unitM)} />
          <ResultRow label={s.viewingAt2} value={proUnit(proNum(result.viewingDistanceAt2ArcminM, 2), s.unitM)} />
          {result.ports !== undefined && <ResultRow label={s.ports} value={result.ports} />}
          {result.powerMaxKw !== undefined && (
            <ResultRow label={s.powerMax} value={proUnit(proNum(result.powerMaxKw, 3), s.unitKw)} />
          )}
          {result.powerAvgKw !== undefined && (
            <ResultRow label={s.powerAvg} value={proUnit(proNum(result.powerAvgKw, 3), s.unitKw)} />
          )}
          {result.apparentMaxKva !== undefined && (
            <ResultRow label={s.apparentMax} value={proUnit(proNum(result.apparentMaxKva, 3), s.unitKva)} />
          )}
          {result.apparentAvgKva !== undefined && (
            <ResultRow label={s.apparentAvg} value={proUnit(proNum(result.apparentAvgKva, 3), s.unitKva)} />
          )}
          {result.currentMaxA !== undefined && (
            <ResultRow label={s.currentMax} value={proUnit(proNum(result.currentMaxA, 2), s.unitA)} />
          )}
          {result.currentAvgA !== undefined && (
            <ResultRow label={s.currentAvg} value={proUnit(proNum(result.currentAvgA, 2), s.unitA)} />
          )}
          <p className="tool__note">{s.inrushNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.pitch, value: proUnit(proNum(proParse(pitch) ?? 0, 2), s.unitMm) },
              {
                label: s.sizeMode,
                value: sizeMode === "panels" ? s.sizeModePanels : s.sizeModeTarget,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Cars, parking area and cloakroom rail length from the guest count and the
 * user's own modal split and service rates. The service rate is per PIECE,
 * not per guest; rail capacity is computed per physical segment and summed,
 * never on the total length — both are `parkingCloakroom`'s arithmetic.
 */
export function ParkingCloakroomTool() {
  const s = strings.pro.event["parking-cloakroom"];
  const [guests, setGuests] = useState("");
  const [carShare, setCarShare] = useState("");
  const [occupancyPerCar, setOccupancyPerCar] = useState("");
  const [busShare, setBusShare] = useState("");
  const [seatsPerBus, setSeatsPerBus] = useState("");
  const [areaPerStall, setAreaPerStall] = useState("");
  const [availableStalls, setAvailableStalls] = useState("");
  const [coatShare, setCoatShare] = useState("");
  const [itemsPerGuest, setItemsPerGuest] = useState("");
  const [hangerPitch, setHangerPitch] = useState("");
  const [railSegmentsText, setRailSegmentsText] = useState("");
  const [checkInWindow, setCheckInWindow] = useState("");
  const [checkInRate, setCheckInRate] = useState("");
  const [checkInAttendants, setCheckInAttendants] = useState("");
  const [hasCheckOut, setHasCheckOut] = useState<"da" | "ne">("ne");
  const [checkOutWindow, setCheckOutWindow] = useState("");
  const [checkOutRate, setCheckOutRate] = useState("");
  const [checkOutAttendants, setCheckOutAttendants] = useState("");

  const typed = proParse(guests) !== undefined;
  const railRows = railSegmentsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => proParse(line) ?? Number.NaN);

  const result = parkingCloakroom({
    guests: proParse(guests) ?? Number.NaN,
    carSharePct: proParse(carShare) ?? Number.NaN,
    occupancyPerCar: proParse(occupancyPerCar) ?? Number.NaN,
    busSharePct: proParse(busShare),
    seatsPerBus: proParse(seatsPerBus),
    areaPerStallM2: proParse(areaPerStall) ?? Number.NaN,
    availableStalls: proParse(availableStalls),
    coatSharePct: proParse(coatShare) ?? Number.NaN,
    itemsPerGuest: proParse(itemsPerGuest) ?? Number.NaN,
    hangerPitchM: proParse(hangerPitch) ?? Number.NaN,
    availableRailSegmentsM: railRows.length > 0 ? railRows : undefined,
    checkInWindowMinutes: proParse(checkInWindow) ?? Number.NaN,
    checkInRatePiecesPerMinute: proParse(checkInRate) ?? Number.NaN,
    checkInAttendants: proParse(checkInAttendants),
    checkOutWindowMinutes: hasCheckOut === "da" ? proParse(checkOutWindow) : undefined,
    checkOutRatePiecesPerMinute: hasCheckOut === "da" ? proParse(checkOutRate) : undefined,
    checkOutAttendants: hasCheckOut === "da" ? proParse(checkOutAttendants) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "guests"
        ? s.errorGuests
        : field === "carSharePct"
          ? s.errorCarShare
          : field === "occupancyPerCar"
            ? s.errorOccupancy
            : field === "busSharePct"
              ? s.errorBusShare
              : field === "shareSum"
                ? s.errorShareSum
                : field === "areaPerStallM2"
                  ? s.errorAreaPerStall
                  : field === "coatSharePct"
                    ? s.errorCoatShare
                    : field === "itemsPerGuest"
                      ? s.errorItemsPerGuest
                      : field === "hangerPitchM"
                        ? s.errorHangerPitch
                        : field === "seatsPerBus"
                          ? s.errorSeatsPerBus
                          : field === "availableStalls"
                            ? s.errorAvailableStalls
                            : field === "availableRailSegmentsM"
                              ? s.errorRailSegments
                              : field === "checkInWindowMinutes" || field === "window"
                                ? s.errorWindow
                                : field === "checkInRatePiecesPerMinute" || field === "rate"
                                  ? s.errorRate
                                  : s.errorAttendants;

  const copyText = !result.ok
    ? ""
    : [
        `${s.carGuests}: ${result.carGuests}`,
        `${s.cars}: ${result.cars}`,
        `${s.parkingArea}: ${proUnit(proNum(result.parkingAreaM2, 1), s.unitM2)}`,
        result.buses === undefined
          ? undefined
          : `${s.buses}: ${result.buses.buses} (${s.busGuests} ${result.buses.busGuests})`,
        `${s.coatGuests}: ${result.coatGuests}`,
        `${s.items}: ${result.items}`,
        `${s.railLengthNeeded}: ${proUnit(proNum(result.railLengthNeededM, 2), s.unitM)}`,
        `${s.checkInAttendantsNeeded}: ${result.checkIn.attendantsNeeded}`,
        result.checkIn.clear === undefined
          ? undefined
          : `${s.checkInClearTime}: ${proUnit(proNum(result.checkIn.clear.clearTimeMinutes, 1), s.unitMin)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.guests} value={guests} onChange={setGuests} />
      <ToolInput label={s.carShare} value={carShare} onChange={setCarShare} />
      <ToolInput label={s.occupancyPerCar} value={occupancyPerCar} onChange={setOccupancyPerCar} />
      <ToolInput label={s.busShare} value={busShare} onChange={setBusShare} />
      <ToolInput label={s.seatsPerBus} value={seatsPerBus} onChange={setSeatsPerBus} />
      <ToolInput label={s.areaPerStall} hint={s.areaPerStallHint} value={areaPerStall} onChange={setAreaPerStall} />
      <ToolInput label={s.availableStalls} value={availableStalls} onChange={setAvailableStalls} />
      <ToolInput label={s.coatShare} value={coatShare} onChange={setCoatShare} />
      <ToolInput label={s.itemsPerGuest} value={itemsPerGuest} onChange={setItemsPerGuest} />
      <ToolInput label={s.hangerPitch} value={hangerPitch} onChange={setHangerPitch} />
      <ToolTextArea
        label={s.railSegments}
        hint={s.railSegmentsHint}
        value={railSegmentsText}
        onChange={setRailSegmentsText}
        rows={4}
      />
      <ToolInput label={s.checkInWindow} value={checkInWindow} onChange={setCheckInWindow} />
      <ToolInput label={s.checkInRate} hint={s.rateHint} value={checkInRate} onChange={setCheckInRate} />
      <ToolInput label={s.checkInAttendants} value={checkInAttendants} onChange={setCheckInAttendants} />
      <ToolSelect<"da" | "ne">
        label={s.hasCheckOut}
        value={hasCheckOut}
        onChange={setHasCheckOut}
        options={[
          { id: "ne", label: s.no },
          { id: "da", label: s.yes },
        ]}
      />
      {hasCheckOut === "da" && (
        <>
          <ToolInput label={s.checkOutWindow} value={checkOutWindow} onChange={setCheckOutWindow} />
          <ToolInput label={s.checkOutRate} hint={s.rateHint} value={checkOutRate} onChange={setCheckOutRate} />
          <ToolInput label={s.checkOutAttendants} value={checkOutAttendants} onChange={setCheckOutAttendants} />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.carGuests} value={result.carGuests} />
          <ResultRow label={s.cars} value={result.cars} />
          <ResultRow label={s.parkingArea} value={proUnit(proNum(result.parkingAreaM2, 1), s.unitM2)} />
          {result.stalls !== undefined && (
            <ToolAgainstLimit
              label={s.cars}
              value={result.cars}
              limitLabel={s.availableStalls}
              limit={proParse(availableStalls) === undefined ? undefined : proNum(proParse(availableStalls) ?? 0, 0)}
              ratioLabel={s.stallRatio}
              ratio={proRatio(result.stalls.stallRatio)}
            />
          )}
          {result.buses !== undefined && (
            <>
              <ResultRow label={s.busGuests} value={result.buses.busGuests} />
              <ResultRow label={s.buses} value={result.buses.buses} />
            </>
          )}
          <ResultRow label={s.coatGuests} value={result.coatGuests} />
          <ResultRow label={s.items} value={result.items} />
          <ToolAgainstLimit
            label={s.railLengthNeeded}
            value={proUnit(proNum(result.railLengthNeededM, 2), s.unitM)}
            limitLabel={s.railCapacity}
            limit={result.rail === undefined ? undefined : `${result.rail.railCapacityItems} ${s.pieces}`}
            ratioLabel={s.railRatio}
            ratio={proRatio(result.rail?.railRatio)}
          />
          <ToolSection title={s.checkInSection}>
            <ResultRow label={s.checkInAttendantsNeeded} value={result.checkIn.attendantsNeeded} />
            {result.checkIn.clear !== undefined && (
              <>
                <ResultRow
                  label={s.checkInClearTime}
                  value={proUnit(proNum(result.checkIn.clear.clearTimeMinutes, 1), s.unitMin)}
                />
                <ResultRow
                  label={s.checkInClearDiff}
                  value={proUnit(proNum(result.checkIn.clear.clearTimeDiffMinutes, 1), s.unitMin)}
                />
              </>
            )}
          </ToolSection>
          {result.checkOut !== undefined && (
            <ToolSection title={s.checkOutSection}>
              <ResultRow label={s.checkOutAttendantsNeeded} value={result.checkOut.attendantsNeeded} />
              {result.checkOut.clear !== undefined && (
                <>
                  <ResultRow
                    label={s.checkOutClearTime}
                    value={proUnit(proNum(result.checkOut.clear.clearTimeMinutes, 1), s.unitMin)}
                  />
                  <ResultRow
                    label={s.checkOutClearDiff}
                    value={proUnit(proNum(result.checkOut.clear.clearTimeDiffMinutes, 1), s.unitMin)}
                  />
                </>
              )}
            </ToolSection>
          )}
          <p className="tool__note">{s.throughputNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.guests, value: guests.trim() },
              { label: s.carShare, value: `${proNum(proParse(carShare) ?? 0, 1)}%` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

type ProjectorLensMode = "single" | "zoom";
type AspectPreset = "16:9" | "16:10" | "4:3" | "2.39:1" | "custom";
const ASPECT_PRESET_VALUES: Readonly<Record<Exclude<AspectPreset, "custom">, number>> = {
  "16:9": 16 / 9,
  "16:10": 16 / 10,
  "4:3": 4 / 3,
  "2.39:1": 2.39,
};

/**
 * Image geometry, on-axis illuminance/luminance and on-screen contrast — a
 * single fixed lens or a zoom range, solved from distance, width or diagonal.
 * All arithmetic is `projectorThrowScreen`'s.
 */
export function ProjectorThrowScreenTool() {
  const s = strings.pro.event["projector-throw-screen"];
  const [lensMode, setLensMode] = useState<ProjectorLensMode>("single");
  const [throwRatio, setThrowRatio] = useState("");
  const [throwRatioMin, setThrowRatioMin] = useState("");
  const [throwRatioMax, setThrowRatioMax] = useState("");
  const [known, setKnown] = useState<ProjectorKnown>("distance");
  const [knownValue, setKnownValue] = useState("");
  const [aspectPreset, setAspectPreset] = useState<AspectPreset>("16:9");
  const [aspectCustom, setAspectCustom] = useState("");
  const [lumens, setLumens] = useState("");
  const [gain, setGain] = useState("");
  const [contrastRatio, setContrastRatio] = useState("");
  const [ambientLux, setAmbientLux] = useState("");
  const [diffuseReflectance, setDiffuseReflectance] = useState("");
  const [seatingDistance, setSeatingDistance] = useState("");
  const [targetLuminanceFl, setTargetLuminanceFl] = useState("");

  const typed = proParse(knownValue) !== undefined;
  const aspectRatio =
    aspectPreset === "custom" ? (proParse(aspectCustom) ?? Number.NaN) : ASPECT_PRESET_VALUES[aspectPreset];

  const result = projectorThrowScreen({
    throwRatio: lensMode === "single" ? proParse(throwRatio) : undefined,
    throwRatioMin: lensMode === "zoom" ? proParse(throwRatioMin) : undefined,
    throwRatioMax: lensMode === "zoom" ? proParse(throwRatioMax) : undefined,
    known,
    knownValueM: proParse(knownValue) ?? Number.NaN,
    aspectRatio,
    lumens: proParse(lumens),
    gain: proParse(gain),
    contrastRatio: proParse(contrastRatio),
    ambientLux: proParse(ambientLux),
    diffuseReflectance: proParse(diffuseReflectance),
    seatingDistanceM: proParse(seatingDistance),
    targetLuminanceFl: proParse(targetLuminanceFl),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "gain"
        ? s.errorGain
        : field === "aspectRatio"
          ? s.errorAspectRatio
          : field === "knownValueM"
            ? s.errorKnownValue
            : field === "throwRatio"
              ? s.errorThrowRatio
              : field === "throwRatioMin"
                ? s.errorThrowRatioZoom
                : field === "ambiguousZoom"
                  ? s.errorAmbiguousZoom
                  : field === "lumens"
                    ? s.errorLumens
                    : field === "contrastRatio"
                      ? s.errorContrastRatio
                      : field === "ambientLux"
                        ? s.errorAmbientLux
                        : field === "diffuseReflectance"
                          ? s.errorDiffuseReflectance
                          : field === "seatingDistanceM"
                            ? s.errorSeatingDistance
                            : s.errorTargetLuminance;

  const copyText = !result.ok
    ? ""
    : [
        `${s.width}: ${proUnit(proNum(result.widthM, 3), s.unitM)}`,
        `${s.height}: ${proUnit(proNum(result.heightM, 3), s.unitM)}`,
        `${s.diagonal}: ${proUnit(proNum(result.diagonalM, 3), s.unitM)} (${proNum(result.diagonalIn, 1)} ${s.unitIn})`,
        `${s.area}: ${proUnit(proNum(result.areaM2, 3), s.unitM2)}`,
        result.lens.kind === "fixed"
          ? `${s.distance}: ${proUnit(proNum(result.lens.distanceM, 2), s.unitM)}`
          : `${s.zoomRange}: ${proUnit(proNum(result.lens.zoomDistanceMinM, 2), s.unitM)} – ` +
            `${proUnit(proNum(result.lens.zoomDistanceMaxM, 2), s.unitM)}`,
        result.brightness === undefined
          ? undefined
          : `${s.avgIlluminance}: ${proUnit(proNum(result.brightness.avgIlluminanceLx, 1), s.unitLx)}`,
        result.brightness === undefined
          ? undefined
          : `${s.avgLuminance}: ${proUnit(proNum(result.brightness.avgLuminanceCdM2, 2), s.unitCdm2)} ` +
            `(${proNum(result.brightness.avgLuminanceFl, 2)} ${s.unitFl})`,
        result.onScreenContrast === undefined
          ? undefined
          : `${s.onScreenContrast}: ${proNum(result.onScreenContrast, 2)}:1`,
        result.requiredLumensForTarget === undefined
          ? undefined
          : `${s.requiredLumens}: ${proUnit(proNum(result.requiredLumensForTarget, 0), s.unitLm)}`,
        result.viewingAngleDeg === undefined
          ? undefined
          : `${s.viewingAngle}: ${proNum(result.viewingAngleDeg, 2)}${s.unitDeg}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<ProjectorLensMode>
        label={s.lensMode}
        value={lensMode}
        onChange={setLensMode}
        options={[
          { id: "single", label: s.lensModeSingle },
          { id: "zoom", label: s.lensModeZoom },
        ]}
      />
      {lensMode === "single" ? (
        <ToolInput label={s.throwRatio} hint={s.throwRatioHint} value={throwRatio} onChange={setThrowRatio} />
      ) : (
        <>
          <ToolInput label={s.throwRatioMin} value={throwRatioMin} onChange={setThrowRatioMin} />
          <ToolInput label={s.throwRatioMax} value={throwRatioMax} onChange={setThrowRatioMax} />
        </>
      )}
      <ToolSelect<ProjectorKnown>
        label={s.known}
        value={known}
        onChange={setKnown}
        hint={lensMode === "zoom" ? s.knownZoomHint : undefined}
        options={[
          { id: "distance", label: s.knownDistance },
          { id: "width", label: s.knownWidth },
          { id: "diagonal", label: s.knownDiagonal },
        ]}
      />
      <ToolInput label={s.knownValue} value={knownValue} onChange={setKnownValue} />
      <ToolSelect<AspectPreset>
        label={s.aspect}
        value={aspectPreset}
        onChange={setAspectPreset}
        options={[
          { id: "16:9", label: "16:9" },
          { id: "16:10", label: "16:10" },
          { id: "4:3", label: "4:3" },
          { id: "2.39:1", label: "2,39:1" },
          { id: "custom", label: s.aspectCustom },
        ]}
      />
      {aspectPreset === "custom" && (
        <ToolInput label={s.aspectCustomValue} hint={s.aspectCustomHint} value={aspectCustom} onChange={setAspectCustom} />
      )}
      <ToolInput label={s.lumens} hint={s.lumensHint} value={lumens} onChange={setLumens} />
      <ToolInput label={s.gain} hint={s.gainHint} value={gain} onChange={setGain} />
      <ToolInput label={s.contrastRatio} value={contrastRatio} onChange={setContrastRatio} />
      <ToolInput label={s.ambientLux} value={ambientLux} onChange={setAmbientLux} />
      <ToolInput
        label={s.diffuseReflectance}
        hint={s.diffuseReflectanceHint}
        value={diffuseReflectance}
        onChange={setDiffuseReflectance}
      />
      <ToolInput label={s.seatingDistance} value={seatingDistance} onChange={setSeatingDistance} />
      <ToolInput label={s.targetLuminanceFl} hint={s.targetLuminanceHint} value={targetLuminanceFl} onChange={setTargetLuminanceFl} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.width} value={proUnit(proNum(result.widthM, 3), s.unitM)} />
          <ResultRow label={s.height} value={proUnit(proNum(result.heightM, 3), s.unitM)} />
          <ResultRow
            label={s.diagonal}
            value={`${proUnit(proNum(result.diagonalM, 3), s.unitM)} (${proNum(result.diagonalIn, 1)} ${s.unitIn})`}
          />
          <ResultRow label={s.area} value={proUnit(proNum(result.areaM2, 3), s.unitM2)} />
          {result.lens.kind === "fixed" ? (
            <ResultRow label={s.distance} value={proUnit(proNum(result.lens.distanceM, 2), s.unitM)} />
          ) : (
            <ResultRow
              label={s.zoomRange}
              value={
                `${proUnit(proNum(result.lens.zoomDistanceMinM, 2), s.unitM)} – ` +
                `${proUnit(proNum(result.lens.zoomDistanceMaxM, 2), s.unitM)}`
              }
            />
          )}
          {result.brightness !== undefined && (
            <>
              <ResultRow
                label={s.avgIlluminance}
                value={proUnit(proNum(result.brightness.avgIlluminanceLx, 1), s.unitLx)}
              />
              <ResultRow
                label={s.avgLuminance}
                value={
                  `${proUnit(proNum(result.brightness.avgLuminanceCdM2, 2), s.unitCdm2)} ` +
                  `(${proNum(result.brightness.avgLuminanceFl, 2)} ${s.unitFl})`
                }
              />
            </>
          )}
          {result.onScreenContrast !== undefined && (
            <>
              <ResultRow label={s.onScreenContrast} value={`${proNum(result.onScreenContrast, 2)}:1`} />
              {result.ambientUsesGainApproximation && <p className="tool__note">{s.gainApproxNote}</p>}
            </>
          )}
          {result.requiredLumensForTarget !== undefined && (
            <ResultRow label={s.requiredLumens} value={proUnit(proNum(result.requiredLumensForTarget, 0), s.unitLm)} />
          )}
          {result.viewingAngleDeg !== undefined && (
            <ResultRow label={s.viewingAngle} value={`${proNum(result.viewingAngleDeg, 2)}${s.unitDeg}`} />
          )}
          <p className="tool__note">{s.axisNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.known, value: known === "distance" ? s.knownDistance : known === "width" ? s.knownWidth : s.knownDiagonal },
              { label: s.knownValue, value: proUnit(proNum(proParse(knownValue) ?? 0, 3), s.unitM) },
              { label: s.aspect, value: aspectPreset === "custom" ? s.aspectCustom : aspectPreset },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** A single hang at a shared angle, or a two-point pick to one hook — the two shapes `slingForce` solves. */
type RiggingMode = "single" | "twoPoint";

/**
 * Sling force per leg, from the mass, the number of legs and the hang angle
 * — or, for a two-point pick, from the hook height above the two pick
 * points, since the two angles then follow from that height and are not a
 * free choice. All arithmetic is `slingForce`'s.
 */
export function SlingForceTool() {
  const s = strings.pro.event["rigging-sling-angle-force"];
  const [mode, setMode] = useState<RiggingMode>("single");
  const [mass, setMass] = useState("");
  const [legs, setLegs] = useState("2");
  const [angleMode, setAngleMode] = useState<SlingAngleMode>("fromVertical");
  const [angleValue, setAngleValue] = useState("");
  const [height, setHeight] = useState("");
  const [radius, setRadius] = useState("");
  const [span, setSpan] = useState("");
  const [cogFromA, setCogFromA] = useState("");
  const [hookHeight, setHookHeight] = useState("");
  const [dynamicFactor, setDynamicFactor] = useState("");
  const [wllPerLeg, setWllPerLeg] = useState("");
  const [wllUnit, setWllUnit] = useState<WllUnit>("kg");

  const typed = proParse(mass) !== undefined;

  const result = slingForce({
    massKg: proParse(mass) ?? Number.NaN,
    legs: mode === "twoPoint" ? 2 : (proParse(legs) ?? Number.NaN),
    angleMode: mode === "twoPoint" ? "fromVertical" : angleMode,
    angleValueDeg: mode === "single" && angleMode !== "heightRadius" ? proParse(angleValue) : undefined,
    heightM: mode === "single" && angleMode === "heightRadius" ? proParse(height) : undefined,
    radiusM: mode === "single" && angleMode === "heightRadius" ? proParse(radius) : undefined,
    twoPoint:
      mode === "twoPoint"
        ? {
            spanM: proParse(span) ?? Number.NaN,
            cogFromAM: proParse(cogFromA) ?? Number.NaN,
            hookHeightM: proParse(hookHeight) ?? Number.NaN,
          }
        : undefined,
    dynamicFactor: proParse(dynamicFactor),
    wllPerLeg: proParse(wllPerLeg),
    wllUnit,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "massKg"
        ? s.errorMass
        : field === "legs"
          ? s.errorLegs
          : field === "dynamicFactor"
            ? s.errorDynamicFactor
            : field === "spanM"
              ? s.errorSpan
              : field === "cogFromAM"
                ? s.errorCogFromA
                : field === "hookHeightM"
                  ? s.errorHookHeight
                  : field === "wllPerLeg"
                    ? s.errorWllPerLeg
                    : field === "angleValueDeg"
                      ? s.errorAngleValue
                      : field === "heightM"
                        ? s.errorHeight
                        : field === "radiusM"
                          ? s.errorRadius
                          : s.errorAngle;

  // Every figure below reads `result.hang.kind` directly. That used to be a
  // derived boolean — „a two-point force came back, so it must have been a
  // two-point pick" — which narrowed nothing, so every figure under it needed
  // a `?? 0` that would have printed a zero force had the guess ever been wrong.
  const copyText = !result.ok
    ? ""
    : [
        `${s.weight}: ${proUnit(proNum(result.weightKn, 4), s.unitKn)} (${proNum(result.weightKgf, 2)} ${s.unitKgf})`,
        result.dynamicFactor === undefined
          ? undefined
          : `${s.weightFactored}: ${proUnit(proNum(result.weightKnFactored, 4), s.unitKn)}`,
        result.hang.kind === "twoPoint"
          ? `${s.twoPointForceA}: ${proNum(result.hang.forceAKgf, 2)} ${s.unitKgf}`
          : `${s.forceLeg}: ${proUnit(proNum(result.hang.forceLegKn, 4), s.unitKn)} ` +
            `(${proNum(result.hang.forceLegKgf, 2)} ${s.unitKgf})`,
        result.hang.kind === "twoPoint"
          ? `${s.twoPointForceB}: ${proNum(result.hang.forceBKgf, 2)} ${s.unitKgf}`
          : undefined,
        `${s.horizontal}: ${proNum(result.horizontalKgf, 2)} ${s.unitKgf}`,
        result.wllRatio === undefined ? undefined : `${s.wllRatio}: ${proRatio(result.wllRatio)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.mass} value={mass} onChange={setMass} />
      <ToolSelect<RiggingMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "single", label: s.modeSingle },
          { id: "twoPoint", label: s.modeTwoPoint },
        ]}
      />
      {mode === "single" ? (
        <>
          <ToolInput label={s.legs} value={legs} onChange={setLegs} />
          <ToolSelect<SlingAngleMode>
            label={s.angleMode}
            value={angleMode}
            onChange={setAngleMode}
            options={[
              { id: "fromVertical", label: s.angleModeFromVertical },
              { id: "fromHorizontal", label: s.angleModeFromHorizontal },
              { id: "included", label: s.angleModeIncluded },
              { id: "heightRadius", label: s.angleModeHeightRadius },
            ]}
          />
          {angleMode === "heightRadius" ? (
            <>
              <ToolInput label={s.height} value={height} onChange={setHeight} />
              <ToolInput label={s.radius} value={radius} onChange={setRadius} />
            </>
          ) : (
            <ToolInput label={s.angleValue} value={angleValue} onChange={setAngleValue} />
          )}
        </>
      ) : (
        <>
          <ToolInput label={s.span} value={span} onChange={setSpan} />
          <ToolInput label={s.cogFromA} value={cogFromA} onChange={setCogFromA} />
          <ToolInput label={s.hookHeight} hint={s.hookHeightHint} value={hookHeight} onChange={setHookHeight} />
        </>
      )}
      <ToolInput label={s.dynamicFactor} hint={s.dynamicFactorHint} value={dynamicFactor} onChange={setDynamicFactor} />
      <ToolInput label={s.wllPerLeg} hint={s.wllHint} value={wllPerLeg} onChange={setWllPerLeg} />
      <ToolSelect<WllUnit>
        label={s.wllUnit}
        value={wllUnit}
        onChange={setWllUnit}
        options={[
          { id: "kg", label: "kg" },
          { id: "kN", label: "kN" },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.weight}
            value={`${proUnit(proNum(result.weightKn, 4), s.unitKn)} (${proNum(result.weightKgf, 2)} ${s.unitKgf})`}
          />
          {result.hang.kind === "single" && (
            <>
              <ResultRow label={s.beta} value={`${proNum(result.hang.betaDeg, 2)}${s.unitDeg}`} />
              <ResultRow
                label={s.forceLeg}
                value={
                  `${proUnit(proNum(result.hang.forceLegKn, 4), s.unitKn)} ` +
                  `(${proNum(result.hang.forceLegKgf, 2)} ${s.unitKgf})`
                }
              />
              <ResultRow label={s.vertical} value={`${proNum(result.hang.verticalKgf, 2)} ${s.unitKgf}`} />
              <ResultRow label={s.angleFactor} value={proNum(result.hang.angleFactor, 4)} />
              {result.hang.fourLeg !== undefined && (
                <>
                  <ResultRow
                    label={s.fourLegShare}
                    value={`${proNum(result.hang.fourLeg.fourLegShareKgf, 2)} ${s.unitKgf}`}
                  />
                  <ResultRow
                    label={s.twoLegShare}
                    value={`${proNum(result.hang.fourLeg.twoLegShareKgf, 2)} ${s.unitKgf}`}
                  />
                  <p className="tool__note">{s.fourLegNote}</p>
                </>
              )}
            </>
          )}
          {result.hang.kind === "twoPoint" && (
            <>
              <ResultRow label={s.twoPointBetaA} value={`${proNum(result.hang.betaADeg, 2)}${s.unitDeg}`} />
              <ResultRow label={s.twoPointBetaB} value={`${proNum(result.hang.betaBDeg, 2)}${s.unitDeg}`} />
              <ResultRow label={s.twoPointForceA} value={`${proNum(result.hang.forceAKgf, 2)} ${s.unitKgf}`} />
              <ResultRow label={s.twoPointForceB} value={`${proNum(result.hang.forceBKgf, 2)} ${s.unitKgf}`} />
              <ResultRow
                label={s.twoPointLegLengthA}
                value={proUnit(proNum(result.hang.legLengthAM, 3), s.unitM)}
              />
              <ResultRow
                label={s.twoPointLegLengthB}
                value={proUnit(proNum(result.hang.legLengthBM, 3), s.unitM)}
              />
            </>
          )}
          <ResultRow label={s.horizontal} value={`${proNum(result.horizontalKgf, 2)} ${s.unitKgf}`} />
          <p className="tool__note">{s.horizontalNote}</p>
          {result.hang.kind === "single" && result.hang.legLengthM !== undefined && (
            <ResultRow label={s.legLength} value={proUnit(proNum(result.hang.legLengthM, 3), s.unitM)} />
          )}
          {proParse(wllPerLeg) !== undefined ? (
            <ToolAgainstLimit
              label={s.forceLegFactored}
              value={
                result.hang.kind === "twoPoint"
                  ? `${proNum(Math.max(result.hang.forceAKgfFactored, result.hang.forceBKgfFactored), 2)} ` +
                    `${s.unitKgf}`
                  : `${proNum(result.hang.forceLegKgfFactored, 2)} ${s.unitKgf}`
              }
              limitLabel={s.wllPerLeg}
              limit={proParse(wllPerLeg) === undefined ? undefined : `${proNum(proParse(wllPerLeg) ?? 0, 2)} ${wllUnit}`}
              ratioLabel={s.wllRatio}
              ratio={proRatio(result.wllRatio)}
            />
          ) : null}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mass, value: `${proNum(proParse(mass) ?? 0, 1)} kg` },
              { label: s.mode, value: mode === "single" ? s.modeSingle : s.modeTwoPoint },
              result.dynamicFactor === undefined
                ? { label: s.dynamicFactor, value: s.dynamicFactorNone }
                : { label: s.dynamicFactor, value: proNum(result.dynamicFactor, 2) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------
 * run-of-show
 * --------------------------------------------------------------------- */

/**
 * `runOfShow`'s own doc comment disclaims all HH:MM formatting as the
 * renderer's job ("this package carries no locale and no clock"). These
 * three helpers are exactly that hand-off, never a substitute for anything
 * the core function decides: they read back or print a minute count the
 * core already produced or the user already typed, they never derive a new
 * fact about the schedule.
 */
function parseHHMM(text: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (match === null) return undefined;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59) return undefined;
  return h * 60 + m;
}

/** The assignment's row format: "1:30" is 90 minutes, a bare number is minutes. */
function parseDurationMin(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed.includes(":") ? parseHHMM(trimmed) : proParse(trimmed);
}

/** A point in time, minutes since the run's start-day midnight — MAY exceed 1440. */
function formatHHMM(totalMin: number): string {
  const days = (totalMin - (totalMin % 1440)) / 1440;
  const minOfDay = totalMin - days * 1440;
  const h = (minOfDay - (minOfDay % 60)) / 60;
  const m = minOfDay % 60;
  const hh = h < 10 ? `0${h}` : `${h}`;
  const mm = m < 10 ? `0${m}` : `${m}`;
  const suffix = days <= 0 ? "" : days === 1 ? " +1 dan" : ` +${days} dana`;
  return `${hh}:${mm}${suffix}`;
}

/** A LENGTH of time, never a clock reading — no "+N dana", and negative prints with a sign. */
function formatDurationHM(totalMin: number): string {
  const sign = totalMin < 0 ? "-" : "";
  const abs = totalMin < 0 ? -totalMin : totalMin;
  const h = (abs - (abs % 60)) / 60;
  const m = abs % 60;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${sign}${h}:${mm}`;
}

type RunOfShowDisplayMode = "absolute" | "relative";

/**
 * One arithmetic engine, two directions: forward from a start time, or
 * backward solved from a service anchor on the last item. A fixed time that
 * arrives before the previous item can finish prints as a named COLLISION,
 * in minutes — the schedule is never quietly compressed to make it fit.
 */
export function RunOfShowTool() {
  const s = strings.pro.event["run-of-show"];
  const [startTime, setStartTime] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [changeover, setChangeover] = useState("");
  const [curfewText, setCurfewText] = useState("");
  const [direction, setDirection] = useState<RunOfShowDirection>("forward");
  const [buffer, setBuffer] = useState("");
  const [displayMode, setDisplayMode] = useState<RunOfShowDisplayMode>("absolute");

  const rows = proRows(itemsText);
  const typed = parseHHMM(startTime) !== undefined || rows.length > 0;
  const names = rows.map((cells) => cells[0] ?? "");

  // A malformed (not merely absent) anchor is a typo the core cannot see —
  // in "forward" direction it never range-checks a non-last item's anchor,
  // it only walks the clock with whatever number it is handed. Caught here,
  // before the value ever reaches the core, and reported by row.
  const badAnchorIndex = rows.findIndex((cells) => {
    const raw = (cells[2] ?? "").trim();
    if (raw === "") return false;
    const v = parseHHMM(raw);
    return v === undefined || v > 1439;
  });

  const items: RunOfShowItem[] = rows.map((cells) => {
    const raw = (cells[2] ?? "").trim();
    return {
      durationMin: parseDurationMin(cells[1] ?? "") ?? Number.NaN,
      anchorMin: raw === "" ? undefined : parseHHMM(raw),
    };
  });

  const curfewMin = curfewText.trim() === "" ? undefined : (parseHHMM(curfewText) ?? Number.NaN);

  const result = runOfShow({
    startMin: parseHHMM(startTime) ?? Number.NaN,
    items,
    changeoverMin: proParse(changeover) ?? Number.NaN,
    curfewMin,
    direction,
    bufferBeforeServiceMin: direction === "backward" ? proParse(buffer) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const idx = result.ok ? undefined : rowNumber(result.reason);
  const failure =
    badAnchorIndex !== -1
      ? `${s.errorAnchorFormat} (${s.rowLabel} ${badAnchorIndex + 1})`
      : result.ok || !typed
        ? undefined
        : field === "items"
          ? s.errorItems
          : field === "startMin"
            ? s.errorStart
            : field === "changeoverMin"
              ? s.errorChangeover
              : field === "curfewMin"
                ? s.errorCurfew
                : field === "bufferBeforeServiceMin"
                  ? s.errorBuffer
                  : field === "durationMin"
                    ? `${s.errorDuration} (${s.rowLabel} ${idx ?? "?"})`
                    : field === "anchorMin"
                      ? idx === undefined
                        ? s.errorAnchorMissing
                        : `${s.errorAnchorNotLast} (${s.rowLabel} ${idx})`
                      : s.errorItems;

  const copyText = !result.ok
    ? ""
    : [
        ...result.rows.map((row, i) => {
          const overlap =
            row.collisionMin > 0
              ? ` — ${s.collision} ${proNum(row.collisionMin, 0)} ${s.unitMin}`
              : row.gapBeforeMin > 0
                ? ` — ${s.gap} ${proNum(row.gapBeforeMin, 0)} ${s.unitMin}`
                : "";
          return `${names[i] ?? ""}: ${formatHHMM(row.startMin)}–${formatHHMM(row.endMin)} (${proNum(row.durationMin, 0)} ${s.unitMin}, ${proNum(row.sharePct, 1)}%)${overlap}`;
        }),
        `${s.totalDuration}: ${formatDurationHM(result.totalDurationMin)}`,
        `${s.totalChangeover}: ${formatDurationHM(result.totalChangeoverMin)}`,
        `${s.totalGap}: ${formatDurationHM(result.totalGapMin)}`,
        `${s.totalCollision}: ${formatDurationHM(result.totalCollisionMin)}`,
        `${s.span}: ${formatDurationHM(result.spanMin)} (${formatHHMM(result.startMin)}–${formatHHMM(result.endMin)})`,
        result.curfewRemainingMin === undefined
          ? undefined
          : `${s.curfewRemaining}: ${formatDurationHM(result.curfewRemainingMin)}`,
        result.requiredStartMin === undefined
          ? undefined
          : `${s.requiredStart}: ${formatHHMM(result.requiredStartMin)}`,
        result.slackMin === undefined ? undefined : `${s.slack}: ${formatDurationHM(result.slackMin)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.start} hint={s.startHint} value={startTime} onChange={setStartTime} placeholder="18:00" />
      <ToolTextArea label={s.items} hint={s.itemsHint} value={itemsText} onChange={setItemsText} rows={8} />
      <ToolInput label={s.changeover} hint={s.changeoverHint} value={changeover} onChange={setChangeover} />
      <ToolSelect<RunOfShowDirection>
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "forward", label: s.directionForward },
          { id: "backward", label: s.directionBackward },
        ]}
      />
      {direction === "backward" && (
        <ToolInput label={s.buffer} hint={s.bufferHint} value={buffer} onChange={setBuffer} />
      )}
      <ToolInput
        label={s.curfew}
        hint={s.curfewHint}
        value={curfewText}
        onChange={setCurfewText}
        placeholder="01:00"
      />
      <ToolSelect<RunOfShowDisplayMode>
        label={s.display}
        value={displayMode}
        onChange={setDisplayMode}
        options={[
          { id: "absolute", label: s.displayAbsolute },
          { id: "relative", label: s.displayRelative },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colName, s.colStart, s.colEnd, s.colDuration, s.colShare, s.colGapCollision]}
            rows={result.rows.map((row, i) => [
              names[i] ?? "",
              displayMode === "absolute"
                ? formatHHMM(row.startMin)
                : formatDurationHM(row.startMin - result.startMin),
              displayMode === "absolute" ? formatHHMM(row.endMin) : formatDurationHM(row.endMin - result.startMin),
              `${proNum(row.durationMin, 0)} ${s.unitMin}`,
              `${proNum(row.sharePct, 1)}%`,
              row.collisionMin > 0
                ? `${s.collision} ${proNum(row.collisionMin, 0)} ${s.unitMin}`
                : row.gapBeforeMin > 0
                  ? `${s.gap} ${proNum(row.gapBeforeMin, 0)} ${s.unitMin}`
                  : "—",
            ])}
          />
          <ResultRow label={s.totalDuration} value={formatDurationHM(result.totalDurationMin)} />
          <ResultRow label={s.totalChangeover} value={formatDurationHM(result.totalChangeoverMin)} />
          <ResultRow label={s.totalGap} value={formatDurationHM(result.totalGapMin)} />
          <ResultRow label={s.totalCollision} value={formatDurationHM(result.totalCollisionMin)} />
          <ResultRow
            label={s.span}
            value={`${formatDurationHM(result.spanMin)} (${formatHHMM(result.startMin)}–${formatHHMM(result.endMin)})`}
          />
          {result.curfewRemainingMin !== undefined && (
            <ResultRow label={s.curfewRemaining} value={formatDurationHM(result.curfewRemainingMin)} />
          )}
          {result.requiredStartMin !== undefined && (
            <ResultRow label={s.requiredStart} value={formatHHMM(result.requiredStartMin)} />
          )}
          {result.slackMin !== undefined && <ResultRow label={s.slack} value={formatDurationHM(result.slackMin)} />}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.start, value: formatHHMM(parseHHMM(startTime) ?? 0) },
              { label: s.changeover, value: `${proNum(proParse(changeover) ?? 0, 0)} ${s.unitMin}` },
              { label: s.direction, value: direction === "forward" ? s.directionForward : s.directionBackward },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * "5000 W" or "5 kW" (assignment's own row format) — a unit suffix read
 * off, never a business conversion invented: the ÷1000 here is the same
 * class of exception the brief tolerates for showing metres beside
 * millimetres, applied to power instead of length.
 */
function parseKw(text: string): number | undefined {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (lower.endsWith("kw")) return proParse(trimmed.slice(0, -2));
  if (lower.endsWith("w")) {
    const watts = proParse(trimmed.slice(0, -1));
    return watts === undefined ? undefined : watts / 1000;
  }
  return proParse(trimmed);
}

/** The row's phase-connection cell, in Serbian or in the core's own token spelling. */
function mapPhaseConnection(token: string): PhaseConnection | undefined {
  const t = token.trim().toUpperCase().replace(/[\s-]/g, "");
  switch (t) {
    case "L1":
      return "L1";
    case "L2":
      return "L2";
    case "L3":
      return "L3";
    case "L1L2":
      return "L1L2";
    case "L2L3":
      return "L2L3";
    case "L3L1":
      return "L3L1";
    case "TROFAZNI":
    case "TROFAZNO":
    case "THREEPHASE":
      return "three-phase";
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------------
 * three-phase-load-balance — life-safety: the breaker rating is the
 * user's own figure copied off the distribution board, never a Nexus
 * default, and the ratio beside it carries no verdict.
 * --------------------------------------------------------------------- */

/**
 * Per-phase active/reactive/apparent power and current, neutral current
 * and imbalance for a mixed set of single-, three-phase and phase-to-phase
 * loads. Every load becomes a current phasor first; P/Q/S/imbalance are
 * all read off the three per-phase phasor sums afterwards — one engine,
 * not a formula per connection type that has to be kept in agreement.
 */
export function ThreePhaseLoadBalanceTool() {
  const s = strings.pro.event["three-phase-load-balance"];
  const [lineVoltage, setLineVoltage] = useState("");
  const [phaseVoltage, setPhaseVoltage] = useState("");
  const [consumersText, setConsumersText] = useState("");
  const [ratedBreaker, setRatedBreaker] = useState("");

  const rows = proRows(consumersText);
  const typed = rows.length > 0;
  const names = rows.map((cells) => cells[0] ?? "");
  const connectionErrorIndex = rows.findIndex((cells) => mapPhaseConnection(cells[2] ?? "") === undefined);

  /**
   * How a refused row is named back to the user: by the name they gave the
   * load, falling back to „red N" for a row typed without one. „red 7" is a
   * position in a text box the user has to count down to; „rashladna vitrina"
   * is the thing on the floor that is wrong.
   */
  const rowRef = (oneBased: number | undefined): string => {
    const name = oneBased === undefined ? "" : (names[oneBased - 1] ?? "").trim();
    return name !== "" ? name : `${s.rowLabel} ${oneBased ?? "?"}`;
  };

  const consumers: ThreePhaseConsumer[] = rows.map((cells) => ({
    kw: parseKw(cells[1] ?? "") ?? Number.NaN,
    connection: mapPhaseConnection(cells[2] ?? "") ?? "L1",
    cosPhi: proParse(cells[3] ?? "") ?? Number.NaN,
    simultaneityPct: proParse(cells[4] ?? ""),
  }));

  const result = threePhaseLoadBalance({
    lineVoltage: proParse(lineVoltage),
    phaseVoltage: proParse(phaseVoltage),
    consumers,
    ratedBreakerA: proParse(ratedBreaker),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const idx = result.ok ? undefined : rowNumber(result.reason);
  const failure =
    connectionErrorIndex !== -1
      ? `${s.errorConnectionFormat} (${rowRef(connectionErrorIndex + 1)})`
      : result.ok || !typed
        ? undefined
        : field === "consumers"
          ? s.errorConsumers
          : field === "lineVoltage"
            ? s.errorLineVoltage
            : field === "phaseVoltage"
              ? s.errorPhaseVoltage
              : field === "ratedBreakerA"
                ? s.errorRatedBreaker
                : field === "kw"
                  ? `${s.errorKw} (${rowRef(idx)})`
                  : field === "cosPhi"
                    ? `${s.errorCosPhi} (${rowRef(idx)})`
                    : field === "simultaneityPct"
                      ? `${s.errorSimultaneity} (${rowRef(idx)})`
                      : field === "connection"
                        ? `${s.errorConnectionRange} (${rowRef(idx)})`
                        : field === "phases"
                          ? s.errorConsumers
                          : s.errorConsumers;

  const phaseNames = [s.phaseL1, s.phaseL2, s.phaseL3] as const;

  const copyText = !result.ok
    ? ""
    : [
        ...result.phases.map(
          (p, i) =>
            `${phaseNames[i]}: P=${proNum(p.activeKw, 3)} ${s.unitKw}, Q=${proNum(p.reactiveKvar, 3)} ${s.unitKvar}, ` +
            `S=${proNum(p.apparentKva, 3)} ${s.unitKva}, I=${proNum(p.currentA, 2)} ${s.unitA}` +
            (p.breakerRatio === undefined ? "" : `, ${s.breakerRatio}=${proRatio(p.breakerRatio)}`),
        ),
        `${s.totalActive}: ${proNum(result.totalActiveKw, 3)} ${s.unitKw}`,
        `${s.totalReactive}: ${proNum(result.totalReactiveKvar, 3)} ${s.unitKvar}`,
        `${s.totalApparent}: ${proNum(result.totalApparentKva, 3)} ${s.unitKva}`,
        `${s.sumPhaseApparent}: ${proNum(result.sumPhaseApparentKva, 3)} ${s.unitKva}`,
        `${s.threeTimesMaxPhase}: ${proNum(result.threeTimesMaxPhaseKva, 3)} ${s.unitKva}`,
        result.powerFactor === undefined ? undefined : `${s.powerFactor}: ${proNum(result.powerFactor, 4)}`,
        `${s.neutralCurrent}: ${proNum(result.neutralCurrentA, 2)} ${s.unitA}`,
        `${s.avgCurrent}: ${proNum(result.avgCurrentA, 2)} ${s.unitA}`,
        result.imbalancePct === undefined ? undefined : `${s.imbalance}: ${proNum(result.imbalancePct, 2)}%`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.lineVoltage} hint={s.lineVoltageHint} value={lineVoltage} onChange={setLineVoltage} />
      <ToolInput label={s.phaseVoltage} hint={s.phaseVoltageHint} value={phaseVoltage} onChange={setPhaseVoltage} />
      <ToolTextArea label={s.consumers} hint={s.consumersHint} value={consumersText} onChange={setConsumersText} rows={10} />
      <ToolInput label={s.ratedBreaker} hint={s.regulatedHint} value={ratedBreaker} onChange={setRatedBreaker} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colPhase, s.colActive, s.colReactive, s.colApparent, s.colCurrent]}
            rows={result.phases.map((p, i) => [
              phaseNames[i] ?? "",
              proUnit(proNum(p.activeKw, 3), s.unitKw),
              proUnit(proNum(p.reactiveKvar, 3), s.unitKvar),
              proUnit(proNum(p.apparentKva, 3), s.unitKva),
              proUnit(proNum(p.currentA, 2), s.unitA),
            ])}
          />
          {ratedBreaker.trim() !== "" &&
            result.phases.map((p, i) => (
              <ToolAgainstLimit
                key={phaseNames[i]}
                label={`${phaseNames[i]} — ${s.colCurrent}`}
                value={proUnit(proNum(p.currentA, 2), s.unitA)}
                limitLabel={s.ratedBreaker}
                limit={proUnit(proNum(proParse(ratedBreaker) ?? 0, 0), s.unitA)}
                ratioLabel={s.breakerRatio}
                ratio={p.breakerRatio === undefined ? undefined : proRatio(p.breakerRatio)}
              />
            ))}
          <ResultRow label={s.totalActive} value={proUnit(proNum(result.totalActiveKw, 3), s.unitKw)} />
          <ResultRow label={s.totalReactive} value={proUnit(proNum(result.totalReactiveKvar, 3), s.unitKvar)} />
          <ResultRow label={s.totalApparent} value={proUnit(proNum(result.totalApparentKva, 3), s.unitKva)} />
          <ResultRow label={s.sumPhaseApparent} value={proUnit(proNum(result.sumPhaseApparentKva, 3), s.unitKva)} />
          <ResultRow label={s.threeTimesMaxPhase} value={proUnit(proNum(result.threeTimesMaxPhaseKva, 3), s.unitKva)} />
          {result.powerFactor !== undefined && <ResultRow label={s.powerFactor} value={proNum(result.powerFactor, 4)} />}
          <ResultRow label={s.neutralCurrent} value={proUnit(proNum(result.neutralCurrentA, 2), s.unitA)} />
          <ResultRow label={s.avgCurrent} value={proUnit(proNum(result.avgCurrentA, 2), s.unitA)} />
          {result.imbalancePct !== undefined && (
            <ResultRow label={s.imbalance} value={`${proNum(result.imbalancePct, 2)}%`} />
          )}
          <p className="tool__note">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.lineVoltage, value: proUnit(proNum(result.lineVoltageUsed, 0), s.unitV) },
              { label: s.consumers, value: `${proNum(consumers.length, 0)}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------
 * tent-bay-layout
 * --------------------------------------------------------------------- */

type TentSizeMode = "area" | "length";

/**
 * Bay count, footprint and sheeting area for a gable tent, sized from
 * either a required area or a required length — the two are NOT symmetric:
 * an area sizing reports waste, a length sizing reports the length
 * difference instead, because there is no area to divide by in that mode.
 */
export function TentBayLayoutTool() {
  const s = strings.pro.event["tent-bay-layout"];
  const [sizeMode, setSizeMode] = useState<TentSizeMode>("area");
  const [requiredArea, setRequiredArea] = useState("");
  const [requiredLength, setRequiredLength] = useState("");
  const [width, setWidth] = useState("");
  const [bayLength, setBayLength] = useState("");
  const [eaveHeight, setEaveHeight] = useState("");
  const [roofPitch, setRoofPitch] = useState("");
  const [margin, setMargin] = useState("");
  const [sides, setSides] = useState<TentSides>("all");
  const [requiredHeadHeight, setRequiredHeadHeight] = useState("");

  const typed = proParse(width) !== undefined || proParse(bayLength) !== undefined;

  const result = tentBayLayout({
    requiredAreaM2: sizeMode === "area" ? (proParse(requiredArea) ?? Number.NaN) : undefined,
    requiredLengthM: sizeMode === "length" ? (proParse(requiredLength) ?? Number.NaN) : undefined,
    widthM: proParse(width) ?? Number.NaN,
    bayLengthM: proParse(bayLength) ?? Number.NaN,
    eaveHeightM: proParse(eaveHeight) ?? Number.NaN,
    roofPitchDeg: proParse(roofPitch) ?? Number.NaN,
    marginM: proParse(margin) ?? Number.NaN,
    sides,
    requiredHeadHeightM: proParse(requiredHeadHeight),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "requiredAreaM2"
        ? s.errorRequiredArea
        : field === "requiredLengthM"
          ? s.errorRequiredLength
          : field === "widthM"
            ? s.errorWidth
            : field === "bayLengthM"
              ? s.errorBayLength
              : field === "eaveHeightM"
                ? s.errorEaveHeight
                : field === "roofPitchDeg"
                  ? s.errorRoofPitch
                  : field === "marginM"
                    ? s.errorMargin
                    : s.errorRequiredHeadHeight;

  const copyText = !result.ok
    ? ""
    : [
        `${s.bays}: ${proNum(result.bays, 0)}`,
        `${s.length}: ${proUnit(proNum(result.lengthM, 2), s.unitM)}`,
        `${s.area}: ${proUnit(proNum(result.areaM2, 2), s.unitM2)}`,
        result.sizedFrom.kind === "area"
          ? `${s.waste}: ${proUnit(proNum(result.sizedFrom.wasteM2, 2), s.unitM2)} ` +
            `(${proNum(result.sizedFrom.wastePct, 1)}%)`
          : `${s.lengthDiff}: ${proUnit(proNum(result.sizedFrom.lengthDiffM, 2), s.unitM)}`,
        `${s.footprint}: ${proUnit(proNum(result.footprintWidthM, 2), s.unitM)} × ${proUnit(proNum(result.footprintLengthM, 2), s.unitM)} (${proUnit(proNum(result.footprintAreaM2, 2), s.unitM2)})`,
        `${s.tentPerimeter}: ${proUnit(proNum(result.tentPerimeterM, 1), s.unitM)}`,
        `${s.footprintPerimeter}: ${proUnit(proNum(result.footprintPerimeterM, 1), s.unitM)}`,
        `${s.ridgeHeight}: ${proUnit(proNum(result.ridgeHeightM, 3), s.unitM)}`,
        `${s.roofArea}: ${proUnit(proNum(result.roofAreaM2, 2), s.unitM2)}`,
        `${s.sideWallArea}: ${proUnit(proNum(result.sideWallAreaM2, 2), s.unitM2)}`,
        `${s.gableEndsArea}: ${proUnit(proNum(result.gableEndsAreaM2, 2), s.unitM2)}`,
        `${s.totalSheeting}: ${proUnit(proNum(result.totalSheetingM2, 2), s.unitM2)}`,
        `${s.legs}: ${proNum(result.legs, 0)}`,
        result.usableWidthAtHeadHeightM === undefined
          ? undefined
          : `${s.usableWidth}: ${proUnit(proNum(result.usableWidthAtHeadHeightM, 2), s.unitM)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<TentSizeMode>
        label={s.sizeMode}
        value={sizeMode}
        onChange={setSizeMode}
        options={[
          { id: "area", label: s.sizeModeArea },
          { id: "length", label: s.sizeModeLength },
        ]}
      />
      {sizeMode === "area" ? (
        <ToolInput label={s.requiredArea} value={requiredArea} onChange={setRequiredArea} />
      ) : (
        <ToolInput label={s.requiredLength} value={requiredLength} onChange={setRequiredLength} />
      )}
      <ToolInput label={s.width} value={width} onChange={setWidth} />
      <ToolInput label={s.bayLength} hint={s.bayLengthHint} value={bayLength} onChange={setBayLength} />
      <ToolInput label={s.eaveHeight} value={eaveHeight} onChange={setEaveHeight} />
      <ToolInput label={s.roofPitch} value={roofPitch} onChange={setRoofPitch} />
      <ToolInput label={s.margin} hint={s.marginHint} value={margin} onChange={setMargin} />
      <ToolSelect<TentSides>
        label={s.sides}
        value={sides}
        onChange={setSides}
        options={[
          { id: "all", label: s.sidesAll },
          { id: "noEnds", label: s.sidesNoEnds },
          { id: "none", label: s.sidesNone },
        ]}
      />
      <ToolInput label={s.requiredHeadHeight} hint={s.requiredHeadHeightHint} value={requiredHeadHeight} onChange={setRequiredHeadHeight} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.bays} value={proNum(result.bays, 0)} />
          <ResultRow label={s.length} value={proUnit(proNum(result.lengthM, 2), s.unitM)} />
          <ResultRow label={s.area} value={proUnit(proNum(result.areaM2, 2), s.unitM2)} />
          {result.sizedFrom.kind === "area" ? (
            <ResultRow
              label={s.waste}
              value={
                `${proUnit(proNum(result.sizedFrom.wasteM2, 2), s.unitM2)} ` +
                `(${proNum(result.sizedFrom.wastePct, 1)}%)`
              }
            />
          ) : (
            <ResultRow
              label={s.lengthDiff}
              value={proUnit(proNum(result.sizedFrom.lengthDiffM, 2), s.unitM)}
            />
          )}
          <ResultRow
            label={s.footprint}
            value={`${proUnit(proNum(result.footprintWidthM, 2), s.unitM)} × ${proUnit(proNum(result.footprintLengthM, 2), s.unitM)} (${proUnit(proNum(result.footprintAreaM2, 2), s.unitM2)})`}
          />
          <ResultRow label={s.tentPerimeter} value={proUnit(proNum(result.tentPerimeterM, 1), s.unitM)} />
          <ResultRow label={s.footprintPerimeter} value={proUnit(proNum(result.footprintPerimeterM, 1), s.unitM)} />
          <ResultRow label={s.ridgeHeight} value={proUnit(proNum(result.ridgeHeightM, 3), s.unitM)} />
          <ResultRow label={s.roofArea} value={proUnit(proNum(result.roofAreaM2, 2), s.unitM2)} />
          <ResultRow label={s.sideWallArea} value={proUnit(proNum(result.sideWallAreaM2, 2), s.unitM2)} />
          <ResultRow label={s.gableEndsArea} value={proUnit(proNum(result.gableEndsAreaM2, 2), s.unitM2)} />
          <ResultRow label={s.totalSheeting} value={proUnit(proNum(result.totalSheetingM2, 2), s.unitM2)} />
          <p className="tool__note">{s.sheetingNote}</p>
          <ResultRow label={s.legs} value={proNum(result.legs, 0)} />
          {result.usableWidthAtHeadHeightM !== undefined && (
            <ResultRow label={s.usableWidth} value={proUnit(proNum(result.usableWidthAtHeadHeightM, 2), s.unitM)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.width, value: proUnit(proNum(proParse(width) ?? 0, 2), s.unitM) },
              { label: s.bayLength, value: proUnit(proNum(proParse(bayLength) ?? 0, 2), s.unitM) },
              { label: s.roofPitch, value: proUnit(proNum(proParse(roofPitch) ?? 0, 1), s.unitDeg) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------
 * stage-deck-layout — life-safety: no verdict, the UDL limit and the
 * occupancy density are the user's own regulated figures, typed, never a
 * default.
 * --------------------------------------------------------------------- */

/** The handful of copy strings `StageOrientationRows` needs — spelled out locally so it never depends on the pack's own not-yet-wired strings type. */
interface StageDeckOrientationCopy {
  readonly decksWide: string;
  readonly decksDeep: string;
  readonly decks: string;
  readonly coveredArea: string;
  readonly waste: string;
  readonly legs: string;
  readonly massPerLeg: string;
  readonly unitM2: string;
  readonly unitKg: string;
}

/** One module orientation's row of numbers, printed for BOTH "A" and "B" — never a winner picked for the user. */
function StageOrientationRows({
  s,
  label,
  o,
}: {
  readonly s: StageDeckOrientationCopy;
  readonly label: string;
  readonly o: {
    readonly decksWide: number;
    readonly decksDeep: number;
    readonly decks: number;
    readonly coveredAreaM2: number;
    readonly wasteM2: number;
    readonly wastePct: number;
    readonly legs: number;
    readonly massPerLegKg: number | undefined;
  };
}) {
  return (
    <>
      <ResultRow label={`${label} — ${s.decksWide} × ${s.decksDeep}`} value={`${proNum(o.decksWide, 0)} × ${proNum(o.decksDeep, 0)}`} />
      <ResultRow label={`${label} — ${s.decks}`} value={proNum(o.decks, 0)} />
      <ResultRow label={`${label} — ${s.coveredArea}`} value={proUnit(proNum(o.coveredAreaM2, 2), s.unitM2)} />
      <ResultRow
        label={`${label} — ${s.waste}`}
        value={`${proUnit(proNum(o.wasteM2, 2), s.unitM2)} (${proNum(o.wastePct, 1)}%)`}
      />
      <ResultRow label={`${label} — ${s.legs}`} value={proNum(o.legs, 0)} />
      {o.massPerLegKg !== undefined && (
        <ResultRow label={`${label} — ${s.massPerLeg}`} value={proUnit(proNum(o.massPerLegKg, 2), s.unitKg)} />
      )}
    </>
  );
}

/**
 * Both module orientations, printed side by side and named "A" and "B" —
 * never "the better one". A mixed layout can beat either pure orientation
 * and this tool does not evaluate it.
 */
export function StageDeckLayoutTool() {
  const s = strings.pro.event["stage-deck-layout"];
  const [width, setWidth] = useState("");
  const [depth, setDepth] = useState("");
  const [moduleLength, setModuleLength] = useState("");
  const [moduleWidth, setModuleWidth] = useState("");
  const [stageHeight, setStageHeight] = useState("");
  const [skirtSides, setSkirtSides] = useState<SkirtSides>("three");
  const [totalMass, setTotalMass] = useState("");
  const [udlLimit, setUdlLimit] = useState("");
  const [occupancyDensity, setOccupancyDensity] = useState("");

  const typed = proParse(width) !== undefined || proParse(depth) !== undefined;

  const result = stageDeckLayout({
    widthM: proParse(width) ?? Number.NaN,
    depthM: proParse(depth) ?? Number.NaN,
    moduleLengthM: proParse(moduleLength) ?? Number.NaN,
    moduleWidthM: proParse(moduleWidth) ?? Number.NaN,
    stageHeightM: proParse(stageHeight) ?? Number.NaN,
    skirtSides,
    totalMassKg: proParse(totalMass),
    deckUdlLimitKgM2: proParse(udlLimit),
    occupancyDensityM2PerPerson: proParse(occupancyDensity),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "widthM"
        ? s.errorWidth
        : field === "depthM"
          ? s.errorDepth
          : field === "moduleLengthM"
            ? s.errorModuleLength
            : field === "moduleWidthM"
              ? s.errorModuleWidth
              : field === "stageHeightM"
                ? s.errorStageHeight
                : field === "totalMassKg"
                  ? s.errorTotalMass
                  : field === "deckUdlLimitKgM2"
                    ? s.errorUdlLimit
                    : s.errorOccupancyDensity;

  const copyText = !result.ok
    ? ""
    : [
        `${s.requiredArea}: ${proUnit(proNum(result.requiredAreaM2, 2), s.unitM2)}`,
        `${s.perimeter}: ${proUnit(proNum(result.perimeterM, 1), s.unitM)}`,
        `${s.skirtArea}: ${proUnit(proNum(result.skirtAreaM2, 2), s.unitM2)}`,
        `${s.positionA}: ${proNum(result.positionA.decks, 0)} ${s.decksUnit}`,
        `${s.positionB}: ${proNum(result.positionB.decks, 0)} ${s.decksUnit}`,
        `${s.fewerDecks}: ${result.fewerDecksPosition === "equal" ? s.fewerDecksEqual : result.fewerDecksPosition}`,
        result.udlKgM2 === undefined ? undefined : `${s.udl}: ${proUnit(proNum(result.udlKgM2, 2), s.unitKgM2)}`,
        result.udlRatio === undefined ? undefined : `${s.udlRatio}: ${proRatio(result.udlRatio)}`,
        result.occupancyPersons === undefined
          ? undefined
          : `${s.occupancyPersons}: ${proNum(result.occupancyPersons, 0)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.width} value={width} onChange={setWidth} />
      <ToolInput label={s.depth} value={depth} onChange={setDepth} />
      <ToolInput label={s.moduleLength} hint={s.moduleLengthHint} value={moduleLength} onChange={setModuleLength} />
      <ToolInput label={s.moduleWidth} hint={s.moduleWidthHint} value={moduleWidth} onChange={setModuleWidth} />
      <ToolInput label={s.stageHeight} value={stageHeight} onChange={setStageHeight} />
      <ToolSelect<SkirtSides>
        label={s.skirtSides}
        value={skirtSides}
        onChange={setSkirtSides}
        options={[
          { id: "all", label: s.skirtAll },
          { id: "three", label: s.skirtThree },
          { id: "two", label: s.skirtTwo },
          { id: "none", label: s.skirtNone },
        ]}
      />
      <ToolInput label={s.totalMass} hint={s.totalMassHint} value={totalMass} onChange={setTotalMass} />
      <ToolInput label={s.udlLimit} hint={s.regulatedHint} value={udlLimit} onChange={setUdlLimit} />
      <ToolInput label={s.occupancyDensity} hint={s.regulatedHint} value={occupancyDensity} onChange={setOccupancyDensity} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.requiredArea} value={proUnit(proNum(result.requiredAreaM2, 2), s.unitM2)} />
          <ResultRow label={s.perimeter} value={proUnit(proNum(result.perimeterM, 1), s.unitM)} />
          <ResultRow label={s.skirtArea} value={proUnit(proNum(result.skirtAreaM2, 2), s.unitM2)} />
          <p className="tool__note">{s.mixedNote}</p>
          <StageOrientationRows s={s} label={s.positionA} o={result.positionA} />
          <StageOrientationRows s={s} label={s.positionB} o={result.positionB} />
          <ResultRow
            label={s.fewerDecks}
            value={result.fewerDecksPosition === "equal" ? s.fewerDecksEqual : result.fewerDecksPosition}
          />
          {result.udlKgM2 !== undefined && (
            <>
              <p className="tool__note">{s.udlAreaNote}</p>
              {udlLimit.trim() === "" ? (
                <ResultRow label={s.udl} value={proUnit(proNum(result.udlKgM2, 2), s.unitKgM2)} />
              ) : (
                <ToolAgainstLimit
                  label={s.udl}
                  value={proUnit(proNum(result.udlKgM2, 2), s.unitKgM2)}
                  limitLabel={s.udlLimit}
                  limit={proUnit(proNum(proParse(udlLimit) ?? 0, 2), s.unitKgM2)}
                  ratioLabel={s.udlRatio}
                  ratio={result.udlRatio === undefined ? undefined : proRatio(result.udlRatio)}
                />
              )}
            </>
          )}
          {result.occupancyPersons !== undefined && (
            <ResultRow label={s.occupancyPersons} value={proNum(result.occupancyPersons, 0)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.width, value: proUnit(proNum(proParse(width) ?? 0, 2), s.unitM) },
              { label: s.depth, value: proUnit(proNum(proParse(depth) ?? 0, 2), s.unitM) },
              {
                label: s.moduleLength,
                value: `${proNum(proParse(moduleLength) ?? 0, 2)} × ${proNum(proParse(moduleWidth) ?? 0, 2)} ${s.unitM}`,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------
 * truss-hoist-reactions — life-safety: hoist capacities are the user's own
 * nameplate figures, never a Nexus default. A negative reaction is UPLIFT,
 * printed as a negative number and named, never smoothed to zero.
 * --------------------------------------------------------------------- */

/**
 * Support reactions, centre of gravity and the bending-moment envelope for
 * a truss hung at two points. Only two hang points are ever solved — a
 * third is statically indeterminate and this tool refuses it rather than
 * approximating.
 */
export function TrussHoistReactionsTool() {
  const s = strings.pro.event["truss-hoist-reactions"];
  const [length, setLength] = useState("");
  const [selfWeight, setSelfWeight] = useState("");
  const [pointA, setPointA] = useState("");
  const [pointB, setPointB] = useState("");
  const [loadsText, setLoadsText] = useState("");
  const [extraDistributed, setExtraDistributed] = useState("");
  const [hoistCapacityA, setHoistCapacityA] = useState("");
  const [hoistCapacityB, setHoistCapacityB] = useState("");
  const [slingAngle, setSlingAngle] = useState("");

  const rows = proRows(loadsText);
  const typed = proParse(length) !== undefined || rows.length > 0;

  const loads: TrussPointLoad[] = rows.map((cells) => ({
    massKg: proParse(cells[1] ?? "") ?? Number.NaN,
    positionM: proParse(cells[2] ?? "") ?? Number.NaN,
  }));

  const result = trussHoistReactions({
    lengthM: proParse(length) ?? Number.NaN,
    selfWeightKgPerM: proParse(selfWeight) ?? Number.NaN,
    pointAM: proParse(pointA) ?? Number.NaN,
    pointBM: proParse(pointB) ?? Number.NaN,
    loads,
    extraDistributedKgPerM: proParse(extraDistributed),
    hoistCapacityAKg: proParse(hoistCapacityA),
    hoistCapacityBKg: proParse(hoistCapacityB),
    slingAngleDeg: proParse(slingAngle),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const idx = result.ok ? undefined : rowNumber(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "lengthM"
        ? s.errorLength
        : field === "selfWeightKgPerM"
          ? s.errorSelfWeight
          : field === "pointAM"
            ? s.errorPointA
            : field === "pointBM"
              ? s.errorPointB
              : field === "extraDistributedKgPerM"
                ? s.errorExtraDistributed
                : field === "noLoad"
                  ? s.errorNoLoad
                  : field === "hoistCapacityAKg"
                    ? s.errorHoistCapacityA
                    : field === "hoistCapacityBKg"
                      ? s.errorHoistCapacityB
                      : field === "slingAngleDeg"
                        ? s.errorSlingAngle
                        : field === "massKg"
                          ? `${s.errorMass} (${s.rowLabel} ${idx ?? "?"})`
                          : `${s.errorPosition} (${s.rowLabel} ${idx ?? "?"})`;

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalMass}: ${proUnit(proNum(result.totalMassKg, 2), s.unitKg)}`,
        `${s.pointMass}: ${proUnit(proNum(result.pointMassKg, 2), s.unitKg)}`,
        `${s.distributedMass}: ${proUnit(proNum(result.distributedMassKg, 2), s.unitKg)}`,
        `${s.reactionA}: ${proUnit(proNum(result.reactionAKg, 2), s.unitKg)} (${proUnit(proNum(result.reactionAKn, 4), s.unitKn)})${result.reactionAKg < 0 ? ` — ${s.uplift}` : ""}`,
        `${s.reactionB}: ${proUnit(proNum(result.reactionBKg, 2), s.unitKg)} (${proUnit(proNum(result.reactionBKn, 4), s.unitKn)})${result.reactionBKg < 0 ? ` — ${s.uplift}` : ""}`,
        `${s.cogPosition}: ${proUnit(proNum(result.cogPositionM, 3), s.unitM)}`,
        `${s.checkResidual}: ${proUnit(proNum(result.checkResidual, 4), s.unitKgm)}`,
        `${s.maxMoment}: ${proUnit(proNum(result.maxMomentKgM, 2), s.unitKgm)} @ ${proUnit(proNum(result.maxMomentPositionM, 3), s.unitM)}`,
        `${s.shearA}: ${proUnit(proNum(result.shearAtAKg, 2), s.unitKg)}`,
        `${s.shearB}: ${proUnit(proNum(result.shearAtBKg, 2), s.unitKg)}`,
        `${s.equivalentUdl}: ${proUnit(proNum(result.equivalentUdlKgM, 2), s.unitKgPerM)}`,
        result.ratioA === undefined ? undefined : `${s.ratioA}: ${proRatio(result.ratioA)}`,
        result.ratioB === undefined ? undefined : `${s.ratioB}: ${proRatio(result.ratioB)}`,
        result.legTension === undefined
          ? undefined
          : `${s.legTensionA}: ${proUnit(proNum(result.legTension.legTensionAKg, 2), s.unitKg)}`,
        result.legTension === undefined
          ? undefined
          : `${s.legTensionB}: ${proUnit(proNum(result.legTension.legTensionBKg, 2), s.unitKg)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.length} value={length} onChange={setLength} />
      <ToolInput label={s.selfWeight} hint={s.selfWeightHint} value={selfWeight} onChange={setSelfWeight} />
      <ToolInput label={s.pointA} value={pointA} onChange={setPointA} />
      <ToolInput label={s.pointB} value={pointB} onChange={setPointB} />
      <ToolTextArea label={s.loads} hint={s.loadsHint} value={loadsText} onChange={setLoadsText} rows={8} />
      <ToolInput label={s.extraDistributed} hint={s.extraDistributedHint} value={extraDistributed} onChange={setExtraDistributed} />
      <ToolInput label={s.hoistCapacityA} hint={s.regulatedHint} value={hoistCapacityA} onChange={setHoistCapacityA} />
      <ToolInput label={s.hoistCapacityB} hint={s.regulatedHint} value={hoistCapacityB} onChange={setHoistCapacityB} />
      <ToolInput label={s.slingAngle} hint={s.slingAngleHint} value={slingAngle} onChange={setSlingAngle} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.totalMass} value={proUnit(proNum(result.totalMassKg, 2), s.unitKg)} />
          <ResultRow label={s.pointMass} value={proUnit(proNum(result.pointMassKg, 2), s.unitKg)} />
          <ResultRow label={s.distributedMass} value={proUnit(proNum(result.distributedMassKg, 2), s.unitKg)} />
          {result.swappedSupports && <p className="tool__note">{s.swappedNote}</p>}
          <ResultRow
            label={s.reactionA}
            value={`${proUnit(proNum(result.reactionAKg, 2), s.unitKg)} (${proUnit(proNum(result.reactionAKn, 4), s.unitKn)})${result.reactionAKg < 0 ? ` — ${s.uplift}` : ""}`}
          />
          <ResultRow
            label={s.reactionB}
            value={`${proUnit(proNum(result.reactionBKg, 2), s.unitKg)} (${proUnit(proNum(result.reactionBKn, 4), s.unitKn)})${result.reactionBKg < 0 ? ` — ${s.uplift}` : ""}`}
          />
          <ResultRow label={s.cogPosition} value={proUnit(proNum(result.cogPositionM, 3), s.unitM)} />
          <ResultRow label={s.checkResidual} value={proUnit(proNum(result.checkResidual, 4), s.unitKgm)} />
          <ResultRow
            label={s.maxMoment}
            value={`${proUnit(proNum(result.maxMomentKgM, 2), s.unitKgm)} @ ${proUnit(proNum(result.maxMomentPositionM, 3), s.unitM)}`}
          />
          <ResultRow label={s.shearA} value={proUnit(proNum(result.shearAtAKg, 2), s.unitKg)} />
          <ResultRow label={s.shearB} value={proUnit(proNum(result.shearAtBKg, 2), s.unitKg)} />
          <ResultRow label={s.equivalentUdl} value={proUnit(proNum(result.equivalentUdlKgM, 2), s.unitKgPerM)} />
          {hoistCapacityA.trim() !== "" && (
            <ToolAgainstLimit
              label={s.reactionA}
              value={proUnit(proNum(result.reactionAKg, 2), s.unitKg)}
              limitLabel={s.hoistCapacityA}
              limit={proUnit(proNum(proParse(hoistCapacityA) ?? 0, 0), s.unitKg)}
              ratioLabel={s.ratioA}
              ratio={result.ratioA === undefined ? undefined : proRatio(result.ratioA)}
            />
          )}
          {hoistCapacityB.trim() !== "" && (
            <ToolAgainstLimit
              label={s.reactionB}
              value={proUnit(proNum(result.reactionBKg, 2), s.unitKg)}
              limitLabel={s.hoistCapacityB}
              limit={proUnit(proNum(proParse(hoistCapacityB) ?? 0, 0), s.unitKg)}
              ratioLabel={s.ratioB}
              ratio={result.ratioB === undefined ? undefined : proRatio(result.ratioB)}
            />
          )}
          {result.legTension !== undefined && (
            <>
              <p className="tool__note">{s.legTensionNote}</p>
              <ResultRow
                label={s.legTensionA}
                value={proUnit(proNum(result.legTension.legTensionAKg, 2), s.unitKg)}
              />
              <ResultRow
                label={s.legTensionB}
                value={proUnit(proNum(result.legTension.legTensionBKg, 2), s.unitKg)}
              />
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.length, value: proUnit(proNum(proParse(length) ?? 0, 2), s.unitM) },
              { label: s.pointA, value: proUnit(proNum(proParse(pointA) ?? 0, 2), s.unitM) },
              { label: s.pointB, value: proUnit(proNum(proParse(pointB) ?? 0, 2), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/** A layout row's basis cell, Serbian or the core's own token. */
function mapLayoutBasis(token: string): LayoutBasis | undefined {
  const t = token.trim().toLowerCase();
  if (t === "bruto" || t === "gross") return "gross";
  if (t === "neto" || t === "net") return "net";
  return undefined;
}

/* ------------------------------------------------------------------------
 * venue-occupancy-area — life-safety: every density is the user's own
 * regulated figure. The result field is named "broj osoba pri unetoj
 * gustini", never "kapacitet" or "dozvoljeno" — the name is already a
 * verdict if it borrows either word.
 * --------------------------------------------------------------------- */

/**
 * Net area and, per named layout at its OWN density, how many persons that
 * density allows. The tool never sums densities and never picks a layout —
 * every row is the user's own name and own number, applied exactly as
 * entered.
 */
export function VenueOccupancyAreaTool() {
  const s = strings.pro.event["venue-occupancy-area"];
  const [grossArea, setGrossArea] = useState("");
  const [zonesText, setZonesText] = useState("");
  const [deductPct, setDeductPct] = useState("");
  const [layoutsText, setLayoutsText] = useState("");
  const [guests, setGuests] = useState("");

  const zoneRows = proRows(zonesText);
  const hasZones = zoneRows.length > 0;
  const hasPct = deductPct.trim() !== "";
  const zoneAreas = zoneRows.map((cells) => proParse(cells[1] ?? "") ?? Number.NaN);

  const layoutRows = proRows(layoutsText);
  const layoutNames = layoutRows.map((cells) => cells[0] ?? "");
  const basisErrorIndex = layoutRows.findIndex((cells) => mapLayoutBasis(cells[2] ?? "") === undefined);
  const layouts: VenueLayoutRow[] = layoutRows.map((cells) => ({
    densityM2PerPerson: proParse(cells[1] ?? "") ?? Number.NaN,
    basis: mapLayoutBasis(cells[2] ?? "") ?? "net",
    documentedCount: proParse(cells[3] ?? ""),
  }));

  const typed = proParse(grossArea) !== undefined || layoutRows.length > 0;

  const result = venueOccupancyArea({
    grossAreaM2: proParse(grossArea) ?? Number.NaN,
    deductedZonesM2: hasZones ? zoneAreas : undefined,
    deductPct: hasPct ? (proParse(deductPct) ?? Number.NaN) : undefined,
    layouts,
    guests: proParse(guests),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const idx = result.ok ? undefined : rowNumber(result.reason);
  const failure =
    basisErrorIndex !== -1
      ? `${s.errorBasisFormat} (${s.rowLabel} ${basisErrorIndex + 1})`
      : result.ok || !typed
        ? undefined
        : field === "grossAreaM2"
          ? s.errorGrossArea
          : field === "deduction"
            ? s.errorDeduction
            : field === "netAreaM2"
              ? s.errorNetArea
              : field === "layouts"
                ? s.errorLayouts
                : field === "guests"
                  ? s.errorGuests
                  : field === "deductPct"
                    ? s.errorDeductPct
                    : field === "deductedZonesM2"
                      ? `${s.errorZoneArea} (${s.rowLabel} ${idx ?? "?"})`
                      : field === "densityM2PerPerson"
                        ? `${s.errorDensity} (${s.rowLabel} ${idx ?? "?"})`
                        : `${s.errorDocumentedCount} (${s.rowLabel} ${idx ?? "?"})`;

  const copyText = !result.ok
    ? ""
    : [
        `${s.netArea}: ${proUnit(proNum(result.netAreaM2, 2), s.unitM2)}`,
        `${s.deductedArea}: ${proUnit(proNum(result.deductedAreaM2, 2), s.unitM2)}`,
        result.areaPerGuestM2 === undefined
          ? undefined
          : `${s.areaPerGuest}: ${proUnit(proNum(result.areaPerGuestM2, 3), s.unitM2PerPerson)}`,
        ...result.layouts.map((row, i) => {
          const doc =
            row.documentedRatio === undefined
              ? ""
              : ` — ${s.documented} ${proNum(layoutRows[i]?.[3] === undefined ? 0 : (proParse(layoutRows[i]?.[3] ?? "") ?? 0), 0)}, ${s.ratio} ${proRatio(row.documentedRatio)}`;
          const diff =
            row.requiredAreaDiffM2 === undefined
              ? ""
              : `, ${s.requiredAreaDiff} ${proUnit(proNum(row.requiredAreaDiffM2, 2), s.unitM2)}`;
          return `${layoutNames[i] ?? ""}: ${proNum(row.persons, 0)} ${s.personsUnit}${doc}${diff}`;
        }),
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.grossArea} value={grossArea} onChange={setGrossArea} />
      <ToolTextArea label={s.zones} hint={s.zonesHint} value={zonesText} onChange={setZonesText} rows={5} />
      <ToolInput label={s.deductPct} hint={s.deductPctHint} value={deductPct} onChange={setDeductPct} />
      <ToolTextArea label={s.layouts} hint={s.layoutsHint} value={layoutsText} onChange={setLayoutsText} rows={6} />
      <ToolInput label={s.guests} hint={s.guestsHint} value={guests} onChange={setGuests} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.netArea} value={proUnit(proNum(result.netAreaM2, 2), s.unitM2)} />
          <ResultRow label={s.deductedArea} value={proUnit(proNum(result.deductedAreaM2, 2), s.unitM2)} />
          {result.areaPerGuestM2 !== undefined && (
            <ResultRow label={s.areaPerGuest} value={proUnit(proNum(result.areaPerGuestM2, 3), s.unitM2PerPerson)} />
          )}
          {result.layouts.map((row, i) => (
            <ToolSection key={layoutNames[i] ?? i} title={layoutNames[i] ?? s.layoutFallback}>
              <ResultRow label={s.basisUsed} value={layouts[i]?.basis === "gross" ? s.basisGross : s.basisNet} />
              <ResultRow label={s.personsAtDensity} value={proNum(row.persons, 0)} />
              {row.requiredAreaDiffM2 !== undefined && (
                <ResultRow label={s.requiredAreaDiff} value={proUnit(proNum(row.requiredAreaDiffM2, 2), s.unitM2)} />
              )}
              {row.documentedRatio !== undefined && (
                <ToolAgainstLimit
                  label={s.personsAtDensity}
                  value={proNum(row.persons, 0)}
                  limitLabel={s.documented}
                  limit={proNum(proParse(layoutRows[i]?.[3] ?? "") ?? 0, 0)}
                  ratioLabel={s.ratio}
                  ratio={proRatio(row.documentedRatio)}
                />
              )}
            </ToolSection>
          ))}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.grossArea, value: proUnit(proNum(proParse(grossArea) ?? 0, 2), s.unitM2) },
              { label: s.layouts, value: proNum(layouts.length, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------
 * voltage-drop — life-safety: the drop limit is the user's own installation
 * rule, never a Nexus default, in either direction of the calculation.
 * --------------------------------------------------------------------- */

type VoltageDropMode = "forward" | "reverse";

/**
 * Conductor resistance and drop forward from a cross-section, or solved
 * backward from a target drop percentage against a catalogued IEC 60228
 * size. Three-phase drop is LINE-TO-LINE — the per-phase figure (÷√3) is
 * always printed beside it, labelled, because reading the wrong one is the
 * most common mistake with this formula.
 */
export function VoltageDropTool() {
  const s = strings.pro.event["voltage-drop"];
  const [system, setSystem] = useState<VoltageDropSystem>("single-phase");
  const [material, setMaterial] = useState<ConductorMaterial>("copper");
  const [mode, setMode] = useState<VoltageDropMode>("forward");
  const [crossSection, setCrossSection] = useState("");
  const [customResistance, setCustomResistance] = useState("");
  const [length, setLength] = useState("");
  const [current, setCurrent] = useState("");
  const [nominalVoltage, setNominalVoltage] = useState("");
  const [conductorTemp, setConductorTemp] = useState("");
  const [dropLimit, setDropLimit] = useState("");

  const isReverse = mode === "reverse";
  const typed = proParse(length) !== undefined || proParse(current) !== undefined;

  const result = voltageDrop({
    system,
    material,
    crossSectionMm2: isReverse ? undefined : proParse(crossSection),
    lengthM: proParse(length) ?? Number.NaN,
    currentA: proParse(current) ?? Number.NaN,
    nominalVoltage: proParse(nominalVoltage),
    conductorTempC: proParse(conductorTemp),
    dropLimitPct: proParse(dropLimit),
    customResistanceOhmPerKm: isReverse ? undefined : proParse(customResistance),
    solveForSection: isReverse,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "lengthM"
        ? s.errorLength
        : field === "currentA"
          ? s.errorCurrent
          : field === "conductorTempC"
            ? s.errorConductorTemp
            : field === "nominalVoltage"
              ? s.errorNominalVoltage
              : field === "dropLimitPct"
                ? s.errorDropLimit
                : field === "crossSectionMm2"
                  ? s.errorCrossSection
                  : field === "customResistanceOhmPerKm"
                    ? s.errorCustomResistance
                    : s.errorCrossSection;

  const copyText = !result.ok
    ? ""
    : [
        `${s.resistance}: ${proUnit(proNum(result.resistanceOhm, 5), s.unitOhm)}`,
        `${s.dropVolts}: ${proUnit(proNum(result.dropVolts, 4), s.unitV)}`,
        result.dropVoltsPerPhase === undefined
          ? undefined
          : `${s.dropVoltsPerPhase}: ${proUnit(proNum(result.dropVoltsPerPhase, 4), s.unitV)}`,
        result.dropPct === undefined ? undefined : `${s.dropPct}: ${proNum(result.dropPct, 3)}%`,
        result.farEndVoltage === undefined
          ? undefined
          : `${s.farEndVoltage}: ${proUnit(proNum(result.farEndVoltage, 2), s.unitV)}`,
        `${s.powerLoss}: ${proUnit(proNum(result.powerLossW, 2), s.unitW)}`,
        result.dropRatio === undefined ? undefined : `${s.dropRatio}: ${proRatio(result.dropRatio)}`,
        result.requiredSectionMm2 === undefined
          ? undefined
          : `${s.requiredSection}: ${proUnit(proNum(result.requiredSectionMm2, 3), s.unitMm2)}`,
        result.requiredSectionMm2 === undefined
          ? undefined
          : result.selectedStandardSectionMm2 === undefined
            ? `${s.selectedSection}: ${s.noStandardSection}`
            : `${s.selectedSection}: ${proUnit(proNum(result.selectedStandardSectionMm2, 1), s.unitMm2)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<VoltageDropSystem>
        label={s.system}
        value={system}
        onChange={setSystem}
        options={[
          { id: "dc", label: s.systemDc },
          { id: "single-phase", label: s.systemSinglePhase },
          { id: "three-phase", label: s.systemThreePhase },
        ]}
      />
      <ToolSelect<ConductorMaterial>
        label={s.material}
        value={material}
        onChange={setMaterial}
        options={[
          { id: "copper", label: s.materialCopper },
          { id: "aluminium", label: s.materialAluminium },
        ]}
      />
      <ToolSelect<VoltageDropMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "forward", label: s.modeForward },
          { id: "reverse", label: s.modeReverse },
        ]}
      />
      {!isReverse && (
        <>
          <ToolInput label={s.crossSection} hint={s.crossSectionHint} value={crossSection} onChange={setCrossSection} />
          <ToolInput
            label={s.customResistance}
            hint={s.customResistanceHint}
            value={customResistance}
            onChange={setCustomResistance}
          />
        </>
      )}
      <ToolInput label={s.length} value={length} onChange={setLength} />
      <ToolInput label={s.current} value={current} onChange={setCurrent} />
      <ToolInput label={s.nominalVoltage} hint={s.nominalVoltageHint} value={nominalVoltage} onChange={setNominalVoltage} />
      <ToolInput label={s.conductorTemp} hint={s.conductorTempHint} value={conductorTemp} onChange={setConductorTemp} />
      <ToolInput label={s.dropLimit} hint={s.regulatedHint} value={dropLimit} onChange={setDropLimit} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.resistance} value={proUnit(proNum(result.resistanceOhm, 5), s.unitOhm)} />
          <ResultRow label={s.dropVolts} value={proUnit(proNum(result.dropVolts, 4), s.unitV)} />
          {result.dropVoltsPerPhase !== undefined && (
            <>
              <p className="tool__note">{s.perPhaseNote}</p>
              <ResultRow label={s.dropVoltsPerPhase} value={proUnit(proNum(result.dropVoltsPerPhase, 4), s.unitV)} />
            </>
          )}
          {result.farEndVoltage !== undefined && (
            <ResultRow label={s.farEndVoltage} value={proUnit(proNum(result.farEndVoltage, 2), s.unitV)} />
          )}
          <ResultRow label={s.powerLoss} value={proUnit(proNum(result.powerLossW, 2), s.unitW)} />
          {result.dropPct !== undefined &&
            (dropLimit.trim() === "" ? (
              <ResultRow label={s.dropPct} value={`${proNum(result.dropPct, 3)}%`} />
            ) : (
              <ToolAgainstLimit
                label={s.dropPct}
                value={`${proNum(result.dropPct, 3)}%`}
                limitLabel={s.dropLimit}
                limit={`${proNum(proParse(dropLimit) ?? 0, 1)}%`}
                ratioLabel={s.dropRatio}
                ratio={result.dropRatio === undefined ? undefined : proRatio(result.dropRatio)}
              />
            ))}
          {result.requiredSectionMm2 !== undefined && (
            <>
              <ResultRow label={s.requiredSection} value={proUnit(proNum(result.requiredSectionMm2, 3), s.unitMm2)} />
              <ResultRow
                label={s.selectedSection}
                value={
                  result.selectedStandardSectionMm2 === undefined
                    ? s.noStandardSection
                    : proUnit(proNum(result.selectedStandardSectionMm2, 1), s.unitMm2)
                }
              />
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.length, value: proUnit(proNum(proParse(length) ?? 0, 1), s.unitM) },
              { label: s.current, value: proUnit(proNum(proParse(current) ?? 0, 2), s.unitA) },
              {
                label: s.material,
                value: material === "copper" ? s.materialCopper : s.materialAluminium,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------
 * seating-tables
 * --------------------------------------------------------------------- */

type SeatingTableKind = "round" | "long";

/**
 * Seats per table, table count and footprint. `clearanceM` is the user's
 * OWN planning dimension for chairs and circulation — the tool ships no
 * default and never calls it an escape-route or aisle width.
 */
export function SeatingTablesTool() {
  const s = strings.pro.event["seating-tables"];
  const [guests, setGuests] = useState("");
  const [kind, setKind] = useState<SeatingTableKind>("round");
  const [diameter, setDiameter] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [ends, setEnds] = useState<"da" | "ne">("ne");
  const [seatWidth, setSeatWidth] = useState("");
  const [clearance, setClearance] = useState("");
  const [availableArea, setAvailableArea] = useState("");
  const [availableWidth, setAvailableWidth] = useState("");
  const [availableDepth, setAvailableDepth] = useState("");

  const typed = proParse(guests) !== undefined || proParse(seatWidth) !== undefined;

  const table: SeatingTable =
    kind === "round"
      ? { kind: "round", diameterM: proParse(diameter) ?? Number.NaN }
      : { kind: "long", lengthM: proParse(length) ?? Number.NaN, widthM: proParse(width) ?? Number.NaN, ends: ends === "da" };

  const hasSpace = availableWidth.trim() !== "" || availableDepth.trim() !== "";
  const result = seatingTables({
    guests: proParse(guests) ?? Number.NaN,
    table,
    seatWidthM: proParse(seatWidth) ?? Number.NaN,
    clearanceM: proParse(clearance) ?? Number.NaN,
    availableAreaM2: proParse(availableArea),
    availableSpace: hasSpace
      ? { widthM: proParse(availableWidth) ?? Number.NaN, depthM: proParse(availableDepth) ?? Number.NaN }
      : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "guests"
        ? s.errorGuests
        : field === "seatWidthM"
          ? s.errorSeatWidth
          : field === "clearanceM"
            ? s.errorClearance
            : field === "diameterM"
              ? s.errorDiameter
              : field === "lengthM"
                ? s.errorLength
                : field === "widthM"
                  ? s.errorWidth
                  : field === "tooFewSeats"
                    ? s.errorTooFewSeats
                    : field === "availableAreaM2"
                      ? s.errorAvailableArea
                      : s.errorAvailableSpace;

  const copyText = !result.ok
    ? ""
    : [
        `${s.seatsPerTable}: ${proNum(result.seatsPerTable, 0)}`,
        `${s.tables}: ${proNum(result.tables, 0)}`,
        `${s.lastTableGuests}: ${proNum(result.lastTableGuests, 0)}`,
        `${s.cellArea}: ${proUnit(proNum(result.cellAreaM2, 2), s.unitM2)}`,
        `${s.totalCellArea}: ${proUnit(proNum(result.totalCellAreaM2, 2), s.unitM2)}`,
        result.shape.kind === "round"
          ? `${s.totalCircularFootprint}: ` +
            `${proUnit(proNum(result.shape.totalCircularFootprintM2, 2), s.unitM2)}`
          : `${s.continuous}: ${proNum(result.shape.continuousSegments, 0)} × ` +
            `${proUnit(proNum(result.shape.continuousLengthM, 2), s.unitM)}, ` +
            `${proNum(result.shape.continuousCapacity, 0)} ${s.guestsUnit}`,
        result.areaRatio === undefined ? undefined : `${s.areaRatio}: ${proRatio(result.areaRatio)}`,
        result.gridFitTables === undefined ? undefined : `${s.gridFitTables}: ${proNum(result.gridFitTables, 0)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolInput label={s.guests} value={guests} onChange={setGuests} />
      <ToolSelect<SeatingTableKind>
        label={s.kind}
        value={kind}
        onChange={setKind}
        options={[
          { id: "round", label: s.kindRound },
          { id: "long", label: s.kindLong },
        ]}
      />
      {kind === "round" ? (
        <ToolInput label={s.diameter} value={diameter} onChange={setDiameter} />
      ) : (
        <>
          <ToolInput label={s.length} value={length} onChange={setLength} />
          <ToolInput label={s.width} value={width} onChange={setWidth} />
          <ToolSelect<"da" | "ne">
            label={s.ends}
            value={ends}
            onChange={setEnds}
            options={[
              { id: "ne", label: s.no },
              { id: "da", label: s.yes },
            ]}
          />
        </>
      )}
      <ToolInput label={s.seatWidth} value={seatWidth} onChange={setSeatWidth} />
      <ToolInput label={s.clearance} hint={s.clearanceHint} value={clearance} onChange={setClearance} />
      <ToolInput
        label={s.availableArea}
        hint={s.availableAreaHint}
        value={availableArea}
        onChange={setAvailableArea}
      />
      <ToolInput label={s.availableWidth} hint={s.availableSpaceHint} value={availableWidth} onChange={setAvailableWidth} />
      <ToolInput label={s.availableDepth} value={availableDepth} onChange={setAvailableDepth} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.seatsPerTable} value={proNum(result.seatsPerTable, 0)} />
          <ResultRow label={s.tables} value={proNum(result.tables, 0)} />
          <ResultRow label={s.lastTableGuests} value={proNum(result.lastTableGuests, 0)} />
          <ResultRow label={s.cellArea} value={proUnit(proNum(result.cellAreaM2, 2), s.unitM2)} />
          <ResultRow label={s.totalCellArea} value={proUnit(proNum(result.totalCellAreaM2, 2), s.unitM2)} />
          {result.shape.kind === "round" && (
            <ResultRow
              label={s.totalCircularFootprint}
              value={proUnit(proNum(result.shape.totalCircularFootprintM2, 2), s.unitM2)}
            />
          )}
          {result.shape.kind === "long" && (
            <>
              <ResultRow
                label={s.continuousSegments}
                value={proNum(result.shape.continuousSegments, 0)}
              />
              <ResultRow
                label={s.continuousLength}
                value={proUnit(proNum(result.shape.continuousLengthM, 2), s.unitM)}
              />
              <ResultRow
                label={s.continuousCapacity}
                value={proNum(result.shape.continuousCapacity, 0)}
              />
            </>
          )}
          {result.areaRatio !== undefined && (
            <ToolAgainstLimit
              label={s.totalCellArea}
              value={proUnit(proNum(result.totalCellAreaM2, 2), s.unitM2)}
              limitLabel={s.availableArea}
              limit={proUnit(proNum(proParse(availableArea) ?? 0, 2), s.unitM2)}
              ratioLabel={s.areaRatio}
              ratio={proRatio(result.areaRatio)}
            />
          )}
          {result.gridFitTables !== undefined && (
            <ResultRow label={s.gridFitTables} value={proNum(result.gridFitTables, 0)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.guests, value: proNum(proParse(guests) ?? 0, 0) },
              { label: s.seatWidth, value: proUnit(proNum(proParse(seatWidth) ?? 0, 2), s.unitM) },
              { label: s.clearance, value: proUnit(proNum(proParse(clearance) ?? 0, 2), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * Every tool id the "event" assignment names, spelled exactly as it spells
 * them — a missing or misspelled id makes that tool unreachable.
 */
export const EVENT_SURFACES: Readonly<Record<string, ComponentType>> = {
  "beam-spot-diameter": BeamSpotTool,
  "budget-per-guest": BudgetPerGuestTool,
  "catering-per-guest": CateringPerGuestTool,
  "generator-sizing": GeneratorSizingTool,
  "ice-and-chilling": IceChillingTool,
  "led-wall-pitch-viewing": LedWallTool,
  "parking-cloakroom": ParkingCloakroomTool,
  "projector-throw-screen": ProjectorThrowScreenTool,
  "rigging-sling-angle-force": SlingForceTool,
  "run-of-show": RunOfShowTool,
  "seating-tables": SeatingTablesTool,
  "stage-deck-layout": StageDeckLayoutTool,
  "tent-bay-layout": TentBayLayoutTool,
  "three-phase-load-balance": ThreePhaseLoadBalanceTool,
  "truss-hoist-reactions": TrussHoistReactionsTool,
  "venue-occupancy-area": VenueOccupancyAreaTool,
  "voltage-drop": VoltageDropTool,
};
