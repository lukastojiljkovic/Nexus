import {
  anchorRode,
  courseToSteer,
  fuelRange,
  greatCircle,
  hullSpeed,
  ruleOfTwelfths,
  speedRun,
  vmg,
} from "@nexus/core/pro/nautika";
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
  ToolTable,
} from "./shared.js";

/**
 * „Nautika i jedrenje" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/nautika.ts`'s. Nothing here divides,
 * rounds or compares a nautical figure; this file shapes fields, hands the
 * numbers over and reads the answers onto the page.
 *
 * **Every tool opens with `notForNavigation`.** The pack is `life-safety` in
 * class, so the host already draws the general notice above the tool — and that
 * line says the calculation does not replace a licensed professional, which is
 * the wrong sentence for a wheelhouse. What a navigator needs to read first is
 * the narrower one: this drawer is arithmetic, and a chart, a pilot book and a
 * tide table are the publications a passage is planned on.
 *
 * **The two places a value can be absent are drawn as absent.** A bearing for a
 * pair of identical coordinates is `undefined` in the core rather than zero, and
 * `bearingNone` is what it prints — a zero would read as due north, which is a
 * direction the boat could actually steer.
 */

/** Whether any of the given raw fields has something typed into it. */
function anyTyped(...values: readonly string[]): boolean {
  return values.some((value) => value.trim() !== "");
}

/**
 * A typed field as a number, or `NaN` when it is empty.
 *
 * `NaN` and not `undefined`, because every core function here takes a required
 * `number` and refuses a non-finite one by name — so the refusal comes from the
 * module that owns the range, and this file owns no range at all.
 */
function num(text: string): number {
  return proParse(text) ?? Number.NaN;
}

/** The optional half of the same idea: a blank field is `undefined`, not zero. */
function optionalNum(text: string): number | undefined {
  return text.trim() === "" ? undefined : num(text);
}

/** A quantity in its unit, or the em dash `proNum` prints for anything not finite. */
function amount(value: number | undefined, digits: number, unit: string): string {
  return value === undefined ? "—" : proUnit(proNum(value, digits), unit);
}

export function SpeedRunTool() {
  const s = strings.pro.nautika["speed-run"];
  const [speedText, setSpeedText] = useState("");
  const [distanceText, setDistanceText] = useState("");
  const [timeText, setTimeText] = useState("");

  const typed = anyTyped(speedText, distanceText, timeText);
  const result = speedRun({
    speedKnots: optionalNum(speedText),
    distanceNm: optionalNum(distanceText),
    timeHours: optionalNum(timeText),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "pair"
        ? s.errorPair
        : result.reason === "speed"
          ? s.errorSpeed
          : result.reason === "distance"
            ? s.errorDistance
            : s.errorTime;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outSpeed}: ${proUnit(proNum(result.speedKnots, 3), s.unitKn)}`,
        `${s.outSpeedKmh}: ${proUnit(proNum(result.speedKmh, 3), s.unitKm)}`,
        `${s.outSpeedMs}: ${proUnit(proNum(result.speedMs, 4), s.unitMs)}`,
        `${s.outDistance}: ${proUnit(proNum(result.distanceNm, 3), s.unitNm)}`,
        `${s.outDistanceKm}: ${proUnit(proNum(result.distanceKm, 3), s.unitKm)}`,
        `${s.outTime}: ${proUnit(proNum(result.timeHours, 4), s.unitH)}`,
        `${s.outTimeMinutes}: ${proUnit(proNum(result.timeMinutes, 1), s.unitMinutes)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForNavigation}</p>

      <ToolInput
        label={s.speed}
        hint={s.speedHint}
        value={speedText}
        onChange={setSpeedText}
      />
      <ToolInput
        label={s.distance}
        hint={s.distanceHint}
        value={distanceText}
        onChange={setDistanceText}
      />
      <ToolInput label={s.time} hint={s.timeHint} value={timeText} onChange={setTimeText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outSpeed} value={proUnit(proNum(result.speedKnots, 3), s.unitKn)} />
          <ResultRow label={s.outSpeedKmh} value={proUnit(proNum(result.speedKmh, 3), s.unitKm)} />
          <ResultRow label={s.outSpeedMs} value={proUnit(proNum(result.speedMs, 4), s.unitMs)} />
          <ResultRow label={s.outDistance} value={proUnit(proNum(result.distanceNm, 3), s.unitNm)} />
          <ResultRow label={s.outDistanceKm} value={proUnit(proNum(result.distanceKm, 3), s.unitKm)} />
          <ResultRow label={s.outTime} value={proUnit(proNum(result.timeHours, 4), s.unitH)} />
          <ResultRow
            label={s.outTimeMinutes}
            value={proUnit(proNum(result.timeMinutes, 1), s.unitMinutes)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.speed, value: proUnit(proNum(num(speedText), 3), s.unitKn) },
              { label: s.distance, value: proUnit(proNum(num(distanceText), 3), s.unitNm) },
              { label: s.time, value: proUnit(proNum(num(timeText), 4), s.unitH) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function GreatCircleTool() {
  const s = strings.pro.nautika["great-circle"];
  const [fromLatText, setFromLatText] = useState("");
  const [fromLonText, setFromLonText] = useState("");
  const [toLatText, setToLatText] = useState("");
  const [toLonText, setToLonText] = useState("");

  const typed = anyTyped(fromLatText, fromLonText, toLatText, toLonText);
  const result = greatCircle({
    from: { lat: num(fromLatText), lon: num(fromLonText) },
    to: { lat: num(toLatText), lon: num(toLonText) },
  });

  const failure =
    result.ok || !typed ? undefined : result.reason === "from" ? s.errorFrom : s.errorTo;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outDistanceNm}: ${proUnit(proNum(result.distanceNm, 3), s.unitNm)}`,
        `${s.outDistanceKm}: ${proUnit(proNum(result.distanceKm, 3), s.unitKm)}`,
        `${s.outCentralAngle}: ${proUnit(proNum(result.centralAngleDeg, 4), s.unitDeg)}`,
        `${s.outInitialBearing}: ${amount(result.initialBearingDeg, 3, s.unitDeg)}`,
        `${s.outFinalBearing}: ${amount(result.finalBearingDeg, 3, s.unitDeg)}`,
        `${s.outRhumbDistance}: ${proUnit(proNum(result.rhumbDistanceNm, 3), s.unitNm)}`,
        `${s.outRhumbBearing}: ${amount(result.rhumbBearingDeg, 3, s.unitDeg)}`,
        `${s.outRhumbExcess}: ${proUnit(proNum(result.rhumbExcess * 100, 4), s.unitPercent)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForNavigation}</p>

      <ToolInput
        label={s.fromLat}
        hint={s.latHint}
        value={fromLatText}
        onChange={setFromLatText}
      />
      <ToolInput
        label={s.fromLon}
        hint={s.lonHint}
        value={fromLonText}
        onChange={setFromLonText}
      />
      <ToolInput label={s.toLat} value={toLatText} onChange={setToLatText} />
      <ToolInput label={s.toLon} value={toLonText} onChange={setToLonText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outDistanceNm} value={proUnit(proNum(result.distanceNm, 3), s.unitNm)} />
          <ResultRow label={s.outDistanceKm} value={proUnit(proNum(result.distanceKm, 3), s.unitKm)} />
          <ResultRow
            label={s.outCentralAngle}
            value={proUnit(proNum(result.centralAngleDeg, 4), s.unitDeg)}
          />
          <ResultRow
            label={s.outInitialBearing}
            value={
              result.initialBearingDeg === undefined
                ? s.bearingNone
                : proUnit(proNum(result.initialBearingDeg, 3), s.unitDeg)
            }
          />
          <ResultRow
            label={s.outFinalBearing}
            value={
              result.finalBearingDeg === undefined
                ? s.bearingNone
                : proUnit(proNum(result.finalBearingDeg, 3), s.unitDeg)
            }
          />
          <ResultRow
            label={s.outRhumbDistance}
            value={proUnit(proNum(result.rhumbDistanceNm, 3), s.unitNm)}
          />
          <ResultRow
            label={s.outRhumbBearing}
            value={
              result.rhumbBearingDeg === undefined
                ? s.bearingNone
                : proUnit(proNum(result.rhumbBearingDeg, 3), s.unitDeg)
            }
          />
          <ResultRow
            label={s.outRhumbExcess}
            value={proUnit(proNum(result.rhumbExcess * 100, 4), s.unitPercent)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.fromLat, value: proUnit(proNum(num(fromLatText), 4), s.unitDeg) },
              { label: s.fromLon, value: proUnit(proNum(num(fromLonText), 4), s.unitDeg) },
              { label: s.toLat, value: proUnit(proNum(num(toLatText), 4), s.unitDeg) },
              { label: s.toLon, value: proUnit(proNum(num(toLonText), 4), s.unitDeg) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function AnchorRodeTool() {
  const s = strings.pro.nautika["anchor-rode"];
  const [depthText, setDepthText] = useState("");
  const [bowText, setBowText] = useState("");
  const [scopeText, setScopeText] = useState("");

  const typed = anyTyped(depthText, scopeText);
  const result = anchorRode({
    depthM: num(depthText),
    bowHeightM: optionalNum(bowText),
    scope: num(scopeText),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "depth"
        ? s.errorDepth
        : result.reason === "bowHeight"
          ? s.errorBowHeight
          : s.errorScope;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outDepthUsed}: ${proUnit(proNum(result.depthUsedM, 2), s.unitM)}`,
        `${s.outRode}: ${proUnit(proNum(result.rodeM, 2), s.unitM)}`,
        `${s.outRodeFt}: ${proUnit(proNum(result.rodeFt, 1), s.unitFt)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForNavigation}</p>

      <ToolInput label={s.depth} hint={s.depthHint} value={depthText} onChange={setDepthText} />
      <ToolInput
        label={s.bowHeight}
        hint={s.bowHeightHint}
        value={bowText}
        onChange={setBowText}
      />
      <ToolInput label={s.scope} hint={s.scopeHint} value={scopeText} onChange={setScopeText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.outDepthUsed}
            value={proUnit(proNum(result.depthUsedM, 2), s.unitM)}
          />
          <ResultRow label={s.outRode} value={proUnit(proNum(result.rodeM, 2), s.unitM)} />
          <ResultRow label={s.outRodeFt} value={proUnit(proNum(result.rodeFt, 1), s.unitFt)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.depth, value: proUnit(proNum(num(depthText), 2), s.unitM) },
              { label: s.bowHeight, value: proUnit(proNum(num(bowText), 2), s.unitM) },
              { label: s.scope, value: proNum(num(scopeText), 2) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function FuelRangeTool() {
  const s = strings.pro.nautika["fuel-range"];
  const [tankText, setTankText] = useState("");
  const [usableText, setUsableText] = useState("");
  const [burnText, setBurnText] = useState("");
  const [speedText, setSpeedText] = useState("");
  const [reserveText, setReserveText] = useState("");

  const typed = anyTyped(tankText, usableText, burnText, speedText, reserveText);
  const result = fuelRange({
    tankLitres: num(tankText),
    usablePercent: num(usableText),
    burnLitresPerHour: num(burnText),
    speedKnots: num(speedText),
    reservePercent: num(reserveText),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "tank"
        ? s.errorTank
        : result.reason === "usable"
          ? s.errorUsable
          : result.reason === "burn"
            ? s.errorBurn
            : result.reason === "speed"
              ? s.errorSpeed
              : s.errorReserve;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outUsable}: ${proUnit(proNum(result.usableLitres, 2), s.unitL)}`,
        `${s.outReserve}: ${proUnit(proNum(result.reserveLitres, 2), s.unitL)}`,
        `${s.outBurnable}: ${proUnit(proNum(result.burnableLitres, 2), s.unitL)}`,
        `${s.outHours}: ${proUnit(proNum(result.hours, 2), s.unitH)}`,
        `${s.outHoursWithoutReserve}: ${proUnit(proNum(result.hoursWithoutReserve, 2), s.unitH)}`,
        `${s.outRange}: ${proUnit(proNum(result.rangeNm, 2), s.unitNm)}`,
        `${s.outRangeKm}: ${proUnit(proNum(result.rangeKm, 2), s.unitKm)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForNavigation}</p>

      <ToolInput label={s.tank} hint={s.tankHint} value={tankText} onChange={setTankText} />
      <ToolInput label={s.usable} hint={s.usableHint} value={usableText} onChange={setUsableText} />
      <ToolInput label={s.burn} hint={s.burnHint} value={burnText} onChange={setBurnText} />
      <ToolInput label={s.speed} hint={s.speedHint} value={speedText} onChange={setSpeedText} />
      <ToolInput label={s.reserve} hint={s.reserveHint} value={reserveText} onChange={setReserveText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outUsable} value={proUnit(proNum(result.usableLitres, 2), s.unitL)} />
          <ResultRow label={s.outReserve} value={proUnit(proNum(result.reserveLitres, 2), s.unitL)} />
          <ResultRow
            label={s.outBurnable}
            value={proUnit(proNum(result.burnableLitres, 2), s.unitL)}
          />
          <ResultRow label={s.outHours} value={proUnit(proNum(result.hours, 2), s.unitH)} />
          <ResultRow
            label={s.outHoursWithoutReserve}
            value={proUnit(proNum(result.hoursWithoutReserve, 2), s.unitH)}
          />
          <ResultRow label={s.outRange} value={proUnit(proNum(result.rangeNm, 2), s.unitNm)} />
          <ResultRow label={s.outRangeKm} value={proUnit(proNum(result.rangeKm, 2), s.unitKm)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.tank, value: proUnit(proNum(num(tankText), 2), s.unitL) },
              { label: s.usable, value: proUnit(proNum(num(usableText), 1), s.unitPercent) },
              { label: s.burn, value: proUnit(proNum(num(burnText), 2), `${s.unitL}/${s.unitH}`) },
              { label: s.speed, value: proUnit(proNum(num(speedText), 2), s.unitKn) },
              { label: s.reserve, value: proUnit(proNum(num(reserveText), 1), s.unitPercent) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function HullSpeedTool() {
  const s = strings.pro.nautika["hull-speed"];
  const [lengthText, setLengthText] = useState("");
  const [froudeText, setFroudeText] = useState("");

  const typed = anyTyped(lengthText, froudeText);
  const result = hullSpeed({
    lengthWaterlineM: num(lengthText),
    froude: optionalNum(froudeText),
  });

  const failure =
    result.ok || !typed ? undefined : result.reason === "length" ? s.errorLength : s.errorFroude;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outHullSpeed}: ${proUnit(proNum(result.hullSpeedKnots, 2), s.unitKn)}`,
        `${s.outHullSpeedKmh}: ${proUnit(proNum(result.hullSpeedKmh, 2), s.unitKmh)}`,
        `${s.outHullSpeedMs}: ${proUnit(proNum(result.hullSpeedMs, 3), s.unitMs)}`,
        `${s.outLengthFt}: ${proUnit(proNum(result.lengthWaterlineFt, 2), s.unitFt)}`,
        `${s.outFroude}: ${proNum(result.froudeUsed, 3)}`,
        `${s.outSpeedLength}: ${proNum(result.speedLengthRatio, 4)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForNavigation}</p>

      <ToolInput label={s.length} hint={s.lengthHint} value={lengthText} onChange={setLengthText} />
      <ToolInput label={s.froude} hint={s.froudeHint} value={froudeText} onChange={setFroudeText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.outHullSpeed}
            value={proUnit(proNum(result.hullSpeedKnots, 2), s.unitKn)}
          />
          <ResultRow
            label={s.outHullSpeedKmh}
            value={proUnit(proNum(result.hullSpeedKmh, 2), s.unitKmh)}
          />
          <ResultRow
            label={s.outHullSpeedMs}
            value={proUnit(proNum(result.hullSpeedMs, 3), s.unitMs)}
          />
          <ResultRow
            label={s.outLengthFt}
            value={proUnit(proNum(result.lengthWaterlineFt, 2), s.unitFt)}
          />
          <ResultRow label={s.outFroude} value={proNum(result.froudeUsed, 3)} />
          <ResultRow label={s.outSpeedLength} value={proNum(result.speedLengthRatio, 4)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.length, value: proUnit(proNum(num(lengthText), 2), s.unitM) },
              {
                label: s.froude,
                value: proNum(result.froudeUsed, 3),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function RuleOfTwelfthsTool() {
  const s = strings.pro.nautika["rule-of-twelfths"];
  const [rangeText, setRangeText] = useState("");
  const [hoursText, setHoursText] = useState("");
  const [durationText, setDurationText] = useState("");

  const typed = anyTyped(rangeText, hoursText, durationText);
  const result = ruleOfTwelfths({
    rangeM: num(rangeText),
    hoursFromTurn: num(hoursText),
    durationHours: num(durationText),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "range"
        ? s.errorRange
        : result.reason === "duration"
          ? s.errorDuration
          : s.errorHours;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outFraction}: ${proUnit(proNum(result.fraction * 100, 2), s.unitPercent)}`,
        `${s.outMoved}: ${proUnit(proNum(result.movedM, 2), s.unitM)}`,
        `${s.outHeightAboveLow}: ${proUnit(proNum(result.heightAboveLowM, 2), s.unitM)}`,
        `${s.tableHour} 1–${result.table.length}:`,
        ...result.table.map(
          (row) =>
            `${row.hour}. ${row.twelfths}/12 → ${proUnit(proNum(row.fraction * 100, 2), s.unitPercent)}` +
            ` = ${proUnit(proNum(row.movedM, 2), s.unitM)}`,
        ),
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForNavigation}</p>

      <ToolInput label={s.range} hint={s.rangeHint} value={rangeText} onChange={setRangeText} />
      <ToolInput label={s.hours} hint={s.hoursHint} value={hoursText} onChange={setHoursText} />
      <ToolInput
        label={s.duration}
        hint={s.durationHint}
        value={durationText}
        onChange={setDurationText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.outFraction}
            value={proUnit(proNum(result.fraction * 100, 2), s.unitPercent)}
          />
          <ResultRow label={s.outMoved} value={proUnit(proNum(result.movedM, 2), s.unitM)} />
          <ResultRow
            label={s.outHeightAboveLow}
            value={proUnit(proNum(result.heightAboveLowM, 2), s.unitM)}
          />
          <ToolTable
            head={[s.tableHour, s.tableTwelfths, s.tableFraction, s.tableMoved]}
            rows={result.table.map((row) => [
              String(row.hour),
              `${row.twelfths}/12`,
              proUnit(proNum(row.fraction * 100, 1), s.unitPercent),
              proUnit(proNum(row.movedM, 2), s.unitM),
            ])}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.range, value: proUnit(proNum(num(rangeText), 2), s.unitM) },
              { label: s.hours, value: proUnit(proNum(num(hoursText), 2), s.unitH) },
              { label: s.duration, value: proUnit(proNum(num(durationText), 2), s.unitH) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function VmgTool() {
  const s = strings.pro.nautika.vmg;
  const [speedText, setSpeedText] = useState("");
  const [angleText, setAngleText] = useState("");

  const typed = anyTyped(speedText, angleText);
  const result = vmg({ boatSpeedKnots: num(speedText), windAngleDeg: num(angleText) });

  const failure =
    result.ok || !typed ? undefined : result.reason === "speed" ? s.errorSpeed : s.errorAngle;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outVmg}: ${proUnit(proNum(result.vmgKnots, 3), s.unitKn)}`,
        `${s.outVmgKmh}: ${proUnit(proNum(result.vmgKmh, 3), s.unitKmh)}`,
        `${s.outFraction}: ${proUnit(proNum(result.vmgFraction * 100, 2), s.unitPercent)}`,
        `${s.outDirection}: ${result.upwind ? s.upwind : s.downwind}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForNavigation}</p>

      <ToolInput label={s.boatSpeed} hint={s.boatSpeedHint} value={speedText} onChange={setSpeedText} />
      <ToolInput label={s.windAngle} hint={s.windAngleHint} value={angleText} onChange={setAngleText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outVmg} value={proUnit(proNum(result.vmgKnots, 3), s.unitKn)} />
          <ResultRow label={s.outVmgKmh} value={proUnit(proNum(result.vmgKmh, 3), s.unitKmh)} />
          <ResultRow
            label={s.outFraction}
            value={proUnit(proNum(result.vmgFraction * 100, 2), s.unitPercent)}
          />
          <ResultRow label={s.outDirection} value={result.upwind ? s.upwind : s.downwind} mono={false} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.boatSpeed, value: proUnit(proNum(num(speedText), 2), s.unitKn) },
              { label: s.windAngle, value: proUnit(proNum(num(angleText), 1), s.unitDeg) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function CourseToSteerTool() {
  const s = strings.pro.nautika["course-to-steer"];
  const [trackText, setTrackText] = useState("");
  const [speedText, setSpeedText] = useState("");
  const [setText, setSetText] = useState("");
  const [driftText, setDriftText] = useState("");

  const typed = anyTyped(trackText, speedText, setText, driftText);
  const result = courseToSteer({
    trackDeg: num(trackText),
    boatSpeedKnots: num(speedText),
    currentSetDeg: num(setText),
    currentDriftKnots: num(driftText),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "track"
        ? s.errorTrack
        : result.reason === "set"
          ? s.errorSet
          : result.reason === "speed"
            ? s.errorSpeed
            : result.reason === "drift"
              ? s.errorDrift
              : s.errorCurrent;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outHeading}: ${proUnit(proNum(result.headingDeg, 1), s.unitDeg)}`,
        `${s.outDriftAngle}: ${proUnit(proNum(result.driftAngleDeg, 2), s.unitDeg)}`,
        `${s.outGroundSpeed}: ${proUnit(proNum(result.groundSpeedKnots, 2), s.unitKn)}`,
        `${s.outGroundSpeedKmh}: ${proUnit(proNum(result.groundSpeedKmh, 2), s.unitKmh)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForNavigation}</p>

      <ToolInput label={s.track} hint={s.trackHint} value={trackText} onChange={setTrackText} />
      <ToolInput label={s.boatSpeed} hint={s.boatSpeedHint} value={speedText} onChange={setSpeedText} />
      <ToolInput label={s.set} hint={s.setHint} value={setText} onChange={setSetText} />
      <ToolInput label={s.drift} hint={s.driftHint} value={driftText} onChange={setDriftText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outHeading} value={proUnit(proNum(result.headingDeg, 1), s.unitDeg)} />
          <ResultRow
            label={s.outDriftAngle}
            value={proUnit(proNum(result.driftAngleDeg, 2), s.unitDeg)}
          />
          <ResultRow
            label={s.outGroundSpeed}
            value={proUnit(proNum(result.groundSpeedKnots, 2), s.unitKn)}
          />
          <ResultRow
            label={s.outGroundSpeedKmh}
            value={proUnit(proNum(result.groundSpeedKmh, 2), s.unitKmh)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.track, value: proUnit(proNum(num(trackText), 1), s.unitDeg) },
              { label: s.boatSpeed, value: proUnit(proNum(num(speedText), 2), s.unitKn) },
              { label: s.set, value: proUnit(proNum(num(setText), 1), s.unitDeg) },
              { label: s.drift, value: proUnit(proNum(num(driftText), 2), s.unitKn) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const NAUTIKA_SURFACES: Readonly<Record<string, ComponentType>> = {
  "anchor-rode": AnchorRodeTool,
  "course-to-steer": CourseToSteerTool,
  "fuel-range": FuelRangeTool,
  "great-circle": GreatCircleTool,
  "hull-speed": HullSpeedTool,
  "rule-of-twelfths": RuleOfTwelfthsTool,
  "speed-run": SpeedRunTool,
  vmg: VmgTool,
};
