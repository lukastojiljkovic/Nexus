import {
  ALTIMETER_UNITS,
  altimeterUnits,
  fuelReserve,
  isaAtmosphere,
  pressureAltitude,
  trueAirspeed,
  windComponents,
  windTriangle,
  type AltimeterUnit,
} from "@nexus/core/pro/vazduhoplovstvo";
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
} from "./shared.js";

/**
 * „Vazduhoplovstvo" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/vazduhoplovstvo.ts`'s. Nothing here
 * divides, rounds or compares a flying figure; this file shapes fields, hands
 * the numbers over and reads the answers onto the page.
 *
 * **Every tool opens with `notForFlightPlanning`.** The pack is `life-safety`,
 * so the host already draws the general notice — and that one is about licensed
 * professionals in general, which is not the sentence a pilot needs. What a
 * pilot needs to read first is narrower: this is arithmetic on the standard
 * atmosphere, and the flight manual, the charts, the forecast and the NOTAMs
 * are what a flight is planned on.
 *
 * **Where the standard atmosphere is behind a number, the tool says so.** The
 * ISA is a definition, not a measurement of today: the surface names it, and
 * the temperature, the pressure and the wind are the user's own figures with no
 * default.
 */

/** Whether any of the given raw fields has something typed into it. */
function anyTyped(...values: readonly string[]): boolean {
  return values.some((value) => value.trim() !== "");
}

/** A typed field as a number, or `NaN` when it is empty — the core refuses it by name. */
function num(text: string): number {
  return proParse(text) ?? Number.NaN;
}

/** A quantity with its unit, or the em dash `proNum` prints for anything not finite. */
function amount(value: number, digits: number, unit: string): string {
  return proUnit(proNum(value, digits), unit);
}

export function IsaAtmosphereTool() {
  const s = strings.pro.vazduhoplovstvo["isa-atmosphere"];
  const [altitudeText, setAltitudeText] = useState("");

  const typed = anyTyped(altitudeText);
  const result = isaAtmosphere({ altitudeFt: num(altitudeText) });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "altitude"
        ? s.errorAltitude
        : s.errorAltitude;

  const layerLabel = !result.ok
    ? ""
    : result.layer === "troposphere"
      ? s.layerTroposphere
      : s.layerIsothermal;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outAltitude}: ${amount(result.altitudeFt, 0, s.unitFt)} (${amount(result.altitudeM, 0, s.unitM)})`,
        `${s.outLayer}: ${layerLabel}`,
        `${s.outTemperature}: ${amount(result.temperatureC, 2, s.unitC)}`,
        `${s.outTemperatureK}: ${amount(result.temperatureK, 2, s.unitK)}`,
        `${s.outPressure}: ${amount(result.pressureHpa, 2, s.unitHpa)}`,
        `${s.outDensity}: ${amount(result.densityKgM3, 4, s.unitKgM3)}`,
        `${s.outSpeedOfSound}: ${amount(result.speedOfSoundMs, 2, s.unitMs)}`,
        `${s.outDensityRatio}: ${proNum(result.densityRatio, 4)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForFlightPlanning}</p>

      <ToolInput
        label={s.altitude}
        hint={s.altitudeHint}
        value={altitudeText}
        onChange={setAltitudeText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.outAltitude}
            value={`${amount(result.altitudeFt, 0, s.unitFt)} (${amount(result.altitudeM, 0, s.unitM)})`}
          />
          <ResultRow label={s.outLayer} value={layerLabel} mono={false} />
          <ResultRow label={s.outTemperature} value={amount(result.temperatureC, 2, s.unitC)} />
          <ResultRow label={s.outTemperatureK} value={amount(result.temperatureK, 2, s.unitK)} />
          <ResultRow label={s.outPressure} value={amount(result.pressureHpa, 2, s.unitHpa)} />
          <ResultRow label={s.outPressurePa} value={amount(result.pressurePa, 0, s.unitPa)} />
          <ResultRow label={s.outDensity} value={amount(result.densityKgM3, 4, s.unitKgM3)} />
          <ResultRow
            label={s.outSpeedOfSound}
            value={amount(result.speedOfSoundMs, 2, s.unitMs)}
          />
          <ResultRow
            label={s.outSpeedOfSoundKt}
            value={amount(result.speedOfSoundKt, 2, s.unitKt)}
          />
          <ResultRow label={s.outDensityRatio} value={proNum(result.densityRatio, 4)} />
          <ResultRow label={s.outPressureRatio} value={proNum(result.pressureRatio, 4)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              {
                label: s.altitude,
                value: `${amount(num(altitudeText), 0, s.unitFt)} (${amount(num(altitudeText) * 0.3048, 0, s.unitM)})`,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function PressureAltitudeTool() {
  const s = strings.pro.vazduhoplovstvo["pressure-altitude"];
  const [pressureText, setPressureText] = useState("");
  const [temperatureText, setTemperatureText] = useState("");

  const typed = anyTyped(pressureText, temperatureText);
  const result = pressureAltitude({
    pressureHpa: num(pressureText),
    temperatureC: num(temperatureText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "pressure"
        ? s.errorPressure
        : s.errorTemperature;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outPressureAltitude}: ${amount(result.pressureAltitudeFt, 0, s.unitFt)}`,
        `${s.outIsaTemperature}: ${amount(result.isaTemperatureC, 2, s.unitC)}`,
        `${s.outDeviation}: ${amount(result.isaDeviationK, 2, s.unitK)}`,
        `${s.outDensity}: ${amount(result.densityKgM3, 4, s.unitKgM3)}`,
        `${s.outDensityAltitude}: ${amount(result.densityAltitudeFt, 0, s.unitFt)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForFlightPlanning}</p>

      <ToolInput
        label={s.pressure}
        hint={s.pressureHint}
        value={pressureText}
        onChange={setPressureText}
      />
      <ToolInput
        label={s.temperature}
        hint={s.temperatureHint}
        value={temperatureText}
        onChange={setTemperatureText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.outPressureAltitude}
            value={`${amount(result.pressureAltitudeFt, 0, s.unitFt)} (${amount(result.pressureAltitudeM, 0, s.unitM)})`}
          />
          <ResultRow
            label={s.outIsaTemperature}
            value={amount(result.isaTemperatureC, 2, s.unitC)}
          />
          <ResultRow label={s.outDeviation} value={amount(result.isaDeviationK, 2, s.unitK)} />
          <ResultRow label={s.outDensity} value={amount(result.densityKgM3, 4, s.unitKgM3)} />
          <ResultRow
            label={s.outDensityAltitude}
            value={`${amount(result.densityAltitudeFt, 0, s.unitFt)} (${amount(result.densityAltitudeM, 0, s.unitM)})`}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.pressure, value: amount(num(pressureText), 2, s.unitHpa) },
              { label: s.temperature, value: amount(num(temperatureText), 2, s.unitC) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function TrueAirspeedTool() {
  const s = strings.pro.vazduhoplovstvo["true-airspeed"];
  const [casText, setCasText] = useState("");
  const [altitudeText, setAltitudeText] = useState("");
  const [temperatureText, setTemperatureText] = useState("");

  const typed = anyTyped(casText, altitudeText, temperatureText);
  const result = trueAirspeed({
    casKt: num(casText),
    pressureAltitudeFt: num(altitudeText),
    temperatureC: num(temperatureText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "cas"
        ? s.errorCas
        : result.reason === "altitude"
          ? s.errorAltitude
          : s.errorTemperature;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outTas}: ${amount(result.tasKt, 2, s.unitKt)}`,
        `${s.outTasKmh}: ${amount(result.tasKmh, 2, s.unitKmh)}`,
        `${s.outTasMs}: ${amount(result.tasMs, 3, s.unitMs)}`,
        `${s.outDensity}: ${amount(result.densityKgM3, 4, s.unitKgM3)}`,
        `${s.outDensityRatio}: ${proNum(result.densityRatio, 4)}`,
        `${s.outIsaTemperature}: ${amount(result.isaTemperatureC, 2, s.unitC)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForFlightPlanning}</p>

      <ToolInput label={s.cas} hint={s.casHint} value={casText} onChange={setCasText} />
      <ToolInput
        label={s.pressureAltitude}
        hint={s.pressureAltitudeHint}
        value={altitudeText}
        onChange={setAltitudeText}
      />
      <ToolInput
        label={s.temperature}
        hint={s.temperatureHint}
        value={temperatureText}
        onChange={setTemperatureText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outTas} value={amount(result.tasKt, 2, s.unitKt)} />
          <ResultRow label={s.outTasKmh} value={amount(result.tasKmh, 2, s.unitKmh)} />
          <ResultRow label={s.outTasMs} value={amount(result.tasMs, 3, s.unitMs)} />
          <ResultRow label={s.outDensity} value={amount(result.densityKgM3, 4, s.unitKgM3)} />
          <ResultRow label={s.outDensityRatio} value={proNum(result.densityRatio, 4)} />
          <ResultRow
            label={s.outIsaTemperature}
            value={amount(result.isaTemperatureC, 2, s.unitC)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.cas, value: amount(num(casText), 2, s.unitKt) },
              { label: s.pressureAltitude, value: amount(num(altitudeText), 0, s.unitFt) },
              { label: s.temperature, value: amount(num(temperatureText), 2, s.unitC) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function WindTriangleTool() {
  const s = strings.pro.vazduhoplovstvo["wind-triangle"];
  const [courseText, setCourseText] = useState("");
  const [tasText, setTasText] = useState("");
  const [windFromText, setWindFromText] = useState("");
  const [windText, setWindText] = useState("");

  const typed = anyTyped(courseText, tasText, windFromText, windText);
  const result = windTriangle({
    courseDeg: num(courseText),
    tasKt: num(tasText),
    windFromDeg: num(windFromText),
    windKt: num(windText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "course"
        ? s.errorCourse
        : result.reason === "windFrom"
          ? s.errorWindFrom
          : result.reason === "tas"
            ? s.errorTas
            : result.reason === "noSolution"
              ? s.errorNoSolution
              : s.errorWind;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outWca}: ${amount(result.windCorrectionAngleDeg, 2, s.unitDeg)}`,
        `${s.outHeading}: ${amount(result.headingDeg, 1, s.unitDeg)}`,
        `${s.outGroundSpeed}: ${amount(result.groundSpeedKt, 2, s.unitKt)}`,
        `${s.outGroundSpeedKmh}: ${amount(result.groundSpeedKmh, 2, s.unitKmh)}`,
        `${s.outHeadwind}: ${amount(result.headwindKt, 2, s.unitKt)}`,
        `${s.outCrosswind}: ${amount(result.crosswindKt, 2, s.unitKt)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForFlightPlanning}</p>

      <ToolInput label={s.course} hint={s.courseHint} value={courseText} onChange={setCourseText} />
      <ToolInput label={s.tas} hint={s.tasHint} value={tasText} onChange={setTasText} />
      <ToolInput
        label={s.windFrom}
        hint={s.windFromHint}
        value={windFromText}
        onChange={setWindFromText}
      />
      <ToolInput label={s.wind} hint={s.windHint} value={windText} onChange={setWindText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.outWca}
            value={amount(result.windCorrectionAngleDeg, 2, s.unitDeg)}
          />
          <ResultRow label={s.outHeading} value={amount(result.headingDeg, 1, s.unitDeg)} />
          <ResultRow label={s.outGroundSpeed} value={amount(result.groundSpeedKt, 2, s.unitKt)} />
          <ResultRow
            label={s.outGroundSpeedKmh}
            value={amount(result.groundSpeedKmh, 2, s.unitKmh)}
          />
          <ResultRow label={s.outHeadwind} value={amount(result.headwindKt, 2, s.unitKt)} />
          <ResultRow label={s.outCrosswind} value={amount(result.crosswindKt, 2, s.unitKt)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <p className="nx-hint nx-hint--prose">{s.signNote}</p>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.course, value: amount(num(courseText), 1, s.unitDeg) },
              { label: s.tas, value: amount(num(tasText), 2, s.unitKt) },
              { label: s.windFrom, value: amount(num(windFromText), 1, s.unitDeg) },
              { label: s.wind, value: amount(num(windText), 2, s.unitKt) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function WindComponentsTool() {
  const s = strings.pro.vazduhoplovstvo["wind-components"];
  const [windFromText, setWindFromText] = useState("");
  const [windText, setWindText] = useState("");
  const [runwayText, setRunwayText] = useState("");

  const typed = anyTyped(windFromText, windText, runwayText);
  const result = windComponents({
    windFromDeg: num(windFromText),
    windKt: num(windText),
    runwayDeg: num(runwayText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "windFrom"
        ? s.errorWindFrom
        : result.reason === "runway"
          ? s.errorRunway
          : s.errorWind;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outAngle}: ${amount(result.angleDeg, 1, s.unitDeg)}`,
        `${s.outHeadwind}: ${amount(result.headwindKt, 2, s.unitKt)}`,
        `${s.outCrosswind}: ${amount(result.crosswindKt, 2, s.unitKt)}`,
        `${s.outReciprocalHeadwind}: ${amount(result.reciprocalHeadwindKt, 2, s.unitKt)}`,
        `${s.outReciprocalCrosswind}: ${amount(result.reciprocalCrosswindKt, 2, s.unitKt)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForFlightPlanning}</p>

      <ToolInput
        label={s.windFrom}
        hint={s.windFromHint}
        value={windFromText}
        onChange={setWindFromText}
      />
      <ToolInput label={s.wind} hint={s.windHint} value={windText} onChange={setWindText} />
      <ToolInput label={s.runway} hint={s.runwayHint} value={runwayText} onChange={setRunwayText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outAngle} value={amount(result.angleDeg, 1, s.unitDeg)} />
          <ResultRow label={s.outHeadwind} value={amount(result.headwindKt, 2, s.unitKt)} />
          <ResultRow label={s.outCrosswind} value={amount(result.crosswindKt, 2, s.unitKt)} />
          <ResultRow
            label={s.outReciprocalHeadwind}
            value={amount(result.reciprocalHeadwindKt, 2, s.unitKt)}
          />
          <ResultRow
            label={s.outReciprocalCrosswind}
            value={amount(result.reciprocalCrosswindKt, 2, s.unitKt)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <p className="nx-hint nx-hint--prose">{s.signNote}</p>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.windFrom, value: amount(num(windFromText), 1, s.unitDeg) },
              { label: s.wind, value: amount(num(windText), 2, s.unitKt) },
              { label: s.runway, value: amount(num(runwayText), 1, s.unitDeg) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function FuelReserveTool() {
  const s = strings.pro.vazduhoplovstvo["fuel-reserve"];
  const [fuelText, setFuelText] = useState("");
  const [burnText, setBurnText] = useState("");
  const [speedText, setSpeedText] = useState("");
  const [reserveText, setReserveText] = useState("");

  const typed = anyTyped(fuelText, burnText, speedText, reserveText);
  const result = fuelReserve({
    fuelLitres: num(fuelText),
    burnLitresPerHour: num(burnText),
    speedKt: num(speedText),
    reserveMinutes: num(reserveText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "fuel"
        ? s.errorFuel
        : result.reason === "burn"
          ? s.errorBurn
          : result.reason === "speed"
            ? s.errorSpeed
            : s.errorReserve;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outReserve}: ${amount(result.reserveLitres, 2, s.unitL)}`,
        `${s.outBurnable}: ${amount(result.burnableLitres, 2, s.unitL)}`,
        `${s.outEndurance}: ${amount(result.enduranceHours, 2, s.unitH)}`,
        `${s.outEnduranceMinutes}: ${amount(result.enduranceMinutes, 1, s.unitMinutes)}`,
        `${s.outRange}: ${amount(result.rangeNm, 1, s.unitNm)}`,
        `${s.outRangeKm}: ${amount(result.rangeKm, 1, s.unitKm)}`,
        `${s.outHoursWithoutReserve}: ${amount(result.hoursWithoutReserve, 2, s.unitH)}`,
        `${s.outRangeWithoutReserve}: ${amount(result.rangeWithoutReserveNm, 1, s.unitNm)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForFlightPlanning}</p>

      <ToolInput label={s.fuel} hint={s.fuelHint} value={fuelText} onChange={setFuelText} />
      <ToolInput label={s.burn} hint={s.burnHint} value={burnText} onChange={setBurnText} />
      <ToolInput label={s.speed} hint={s.speedHint} value={speedText} onChange={setSpeedText} />
      <ToolInput label={s.reserve} hint={s.reserveHint} value={reserveText} onChange={setReserveText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outReserve} value={amount(result.reserveLitres, 2, s.unitL)} />
          <ResultRow label={s.outBurnable} value={amount(result.burnableLitres, 2, s.unitL)} />
          <ResultRow label={s.outEndurance} value={amount(result.enduranceHours, 2, s.unitH)} />
          <ResultRow
            label={s.outEnduranceMinutes}
            value={amount(result.enduranceMinutes, 1, s.unitMinutes)}
          />
          <ResultRow label={s.outRange} value={amount(result.rangeNm, 1, s.unitNm)} />
          <ResultRow label={s.outRangeKm} value={amount(result.rangeKm, 1, s.unitKm)} />
          <ResultRow
            label={s.outHoursWithoutReserve}
            value={amount(result.hoursWithoutReserve, 2, s.unitH)}
          />
          <ResultRow
            label={s.outRangeWithoutReserve}
            value={amount(result.rangeWithoutReserveNm, 1, s.unitNm)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.fuel, value: amount(num(fuelText), 2, s.unitL) },
              { label: s.burn, value: amount(num(burnText), 2, `${s.unitL}/${s.unitH}`) },
              { label: s.speed, value: amount(num(speedText), 2, s.unitKt) },
              { label: s.reserve, value: amount(num(reserveText), 0, s.unitMinutes) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function AltimeterUnitsTool() {
  const s = strings.pro.vazduhoplovstvo["altimeter-units"];
  const [valueText, setValueText] = useState("");
  const [unit, setUnit] = useState<AltimeterUnit>("inhg");

  const typed = anyTyped(valueText);
  const result = altimeterUnits({ value: num(valueText), unit });
  const failure =
    result.ok || !typed ? undefined : result.reason === "unit" ? s.errorUnit : s.errorValue;

  const unitLabel = unit === "inhg" ? s.unitInhg : unit === "hpa" ? s.unitHpa : s.unitMb;
  const copyText = !result.ok
    ? ""
    : [
        `${s.outInhg}: ${amount(result.inHg, 4, s.unitInhg)}`,
        `${s.outHpa}: ${amount(result.hpa, 2, s.unitHpa)}`,
        `${s.outMb}: ${amount(result.mb, 2, s.unitMb)}`,
        `${s.outPa}: ${amount(result.pa, 1, "Pa")}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.notForFlightPlanning}</p>

      <ToolInput label={s.value} hint={s.valueHint} value={valueText} onChange={setValueText} />
      <ToolSelect<AltimeterUnit>
        label={s.unit}
        value={unit}
        onChange={setUnit}
        options={ALTIMETER_UNITS.map((id) => ({
          id,
          label: id === "inhg" ? s.unitInhg : id === "hpa" ? s.unitHpa : s.unitMb,
        }))}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outInhg} value={amount(result.inHg, 4, s.unitInhg)} />
          <ResultRow label={s.outHpa} value={amount(result.hpa, 2, s.unitHpa)} />
          <ResultRow label={s.outMb} value={amount(result.mb, 2, s.unitMb)} />
          <ResultRow label={s.outPa} value={amount(result.pa, 1, "Pa")} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.value, value: proNum(num(valueText), 4) },
              { label: s.unit, value: unitLabel },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const VAZDUHOPLOVSTVO_SURFACES: Readonly<Record<string, ComponentType>> = {
  "altimeter-units": AltimeterUnitsTool,
  "fuel-reserve": FuelReserveTool,
  "isa-atmosphere": IsaAtmosphereTool,
  "pressure-altitude": PressureAltitudeTool,
  "true-airspeed": TrueAirspeedTool,
  "wind-components": WindComponentsTool,
  "wind-triangle": WindTriangleTool,
};
