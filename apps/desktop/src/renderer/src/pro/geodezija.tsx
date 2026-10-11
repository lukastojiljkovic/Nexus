import {
  decimalToDms,
  dmsToDecimal,
  geodesicDirect,
  geodesicInverse,
  gridGroundRatio,
  mgrsFromGeo,
  mgrsToUtm,
  utmForward,
  utmInverse,
  type MgrsPrecision,
} from "@nexus/core/pro/geodezija";
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
 * „Geodezija i GIS" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/geodezija.ts`'s. Nothing here divides,
 * rounds or compares a coordinate; this file shapes fields, hands the numbers
 * over and reads the answers onto the page.
 *
 * **Every tool that answers with a coordinate says WGS84 beside it.** A
 * latitude without its ellipsoid is ambiguous by about a hundred metres in
 * Serbia, and that is the one sentence a surveyor has to be able to read off
 * the screen rather than trust. The national grid (MGI 1901 / EPSG:31277) is
 * deliberately absent: the transformation parameters are a published
 * authority's to state, and a half-remembered set would look exactly like a
 * correct answer.
 *
 * **Both readings of a truncated MGRS square are drawn.** A bare 100 km
 * reference names a square and not a place, so the corner and the centre are
 * printed side by side and the copy says which is which.
 */

/** Whether any of the given raw fields has something typed into it. */
function anyTyped(...values: readonly string[]): boolean {
  return values.some((value) => value.trim() !== "");
}

/** A typed field as a number, or `NaN` when it is empty — the core refuses it by name. */
function num(text: string): number {
  return proParse(text) ?? Number.NaN;
}

/** A coordinate pair in degrees, for the echo under a tool. */
function degrees(value: number): string {
  return proUnit(proNum(value, 6), "°");
}

/** Degrees, minutes and seconds as one line: 44° 48′ 00,0000″. */
function dmsText(degreesValue: number, minutes: number, seconds: number, unit: string): string {
  const sign = degreesValue < 0 ? "−" : "";
  return `${sign}${proNum(Math.abs(degreesValue), 0)}${unit} ${proNum(minutes, 0)}′ ${proNum(seconds, 4)}″`;
}

/** The select's options and the number behind each, so the mapping lives in one place. */
const PRECISION_OPTIONS = [
  { id: "p5", digits: 5 },
  { id: "p4", digits: 4 },
  { id: "p3", digits: 3 },
  { id: "p2", digits: 2 },
  { id: "p1", digits: 1 },
  { id: "p0", digits: 0 },
] as const;

type PrecisionId = (typeof PRECISION_OPTIONS)[number]["id"];

export function DecimalDmsTool() {
  const s = strings.pro.geodezija["decimal-dms"];
  const [known, setKnown] = useState<"decimal" | "dms">("decimal");
  const [decimalText, setDecimalText] = useState("");
  const [degreesText, setDegreesText] = useState("");
  const [minutesText, setMinutesText] = useState("");
  const [secondsText, setSecondsText] = useState("");

  const typed =
    known === "decimal" ? anyTyped(decimalText) : anyTyped(degreesText, minutesText, secondsText);
  const result =
    known === "decimal"
      ? decimalToDms(num(decimalText))
      : dmsToDecimal({
          degrees: num(degreesText),
          minutes: anyTyped(minutesText) ? num(minutesText) : 0,
          seconds: anyTyped(secondsText) ? num(secondsText) : 0,
        });
  const failure = result.ok || !typed ? undefined : known === "decimal" ? s.errorDecimal : s.errorDms;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outDecimal}: ${degrees(result.decimal)}`,
        `${s.outDms}: ${dmsText(result.dms.degrees, result.dms.minutes, result.dms.seconds, s.unitDeg)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<"decimal" | "dms">
        label={s.known}
        value={known}
        onChange={setKnown}
        options={[
          { id: "decimal", label: s.knownDecimal },
          { id: "dms", label: s.knownDms },
        ]}
      />

      {known === "decimal" ? (
        <ToolInput
          label={s.decimal}
          hint={s.decimalHint}
          value={decimalText}
          onChange={setDecimalText}
        />
      ) : (
        <>
          <ToolInput label={s.degrees} hint={s.dmsHint} value={degreesText} onChange={setDegreesText} />
          <ToolInput label={s.minutes} value={minutesText} onChange={setMinutesText} />
          <ToolInput label={s.seconds} value={secondsText} onChange={setSecondsText} />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outDecimal} value={degrees(result.decimal)} />
          <ResultRow
            label={s.outDms}
            value={dmsText(result.dms.degrees, result.dms.minutes, result.dms.seconds, s.unitDeg)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              {
                label: s.known,
                value: known === "decimal" ? s.knownDecimal : s.knownDms,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function Wgs84UtmTool() {
  const s = strings.pro.geodezija["wgs84-utm"];
  const [direction, setDirection] = useState<"toUtm" | "fromUtm">("toUtm");
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [zoneText, setZoneText] = useState("");
  const [hemisphere, setHemisphere] = useState<"N" | "S">("N");
  const [eastingText, setEastingText] = useState("");
  const [northingText, setNorthingText] = useState("");

  const typed =
    direction === "toUtm"
      ? anyTyped(latText, lonText)
      : anyTyped(zoneText, eastingText, northingText);
  const forward = utmForward({ lat: num(latText), lon: num(lonText) });
  const inverse = utmInverse({
    zone: num(zoneText),
    north: hemisphere === "N",
    easting: num(eastingText),
    northing: num(northingText),
  });
  const result = direction === "toUtm" ? forward : inverse;

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "point" || result.reason === "latitude"
        ? s.errorPoint
        : result.reason === "zone"
          ? s.errorZone
          : result.reason === "easting"
            ? s.errorEasting
            : s.errorNorthing;

  const copyLines: string[] =
    direction === "toUtm" && forward.ok
      ? [
          `${s.outZone}: ${forward.zone}`,
          `${s.outHemisphere}: ${forward.north ? s.hemisphereNorth : s.hemisphereSouth}`,
          `${s.outCentralMeridian}: ${degrees(forward.centralMeridianDeg)}`,
          `${s.outEasting}: ${proUnit(proNum(forward.easting, 3), s.unitM)}`,
          `${s.outNorthing}: ${proUnit(proNum(forward.northing, 3), s.unitM)}`,
          `${s.outScale}: ${proNum(forward.scaleFactor, 8)}`,
          `${s.outConvergence}: ${degrees(forward.convergenceDeg)}`,
        ]
      : inverse.ok
        ? [
            `${s.outZone}: ${inverse.zone}`,
            `${s.outCentralMeridian}: ${degrees(inverse.centralMeridianDeg)}`,
            `${s.outLat}: ${degrees(inverse.lat)}`,
            `${s.outLon}: ${degrees(inverse.lon)}`,
            `${s.outScale}: ${proNum(inverse.scaleFactor, 8)}`,
            `${s.outConvergence}: ${degrees(inverse.convergenceDeg)}`,
          ]
        : [];
  const copyText = result.ok ? copyLines.join("\n") : "";

  return (
    <>
      <ToolSelect<"toUtm" | "fromUtm">
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "toUtm", label: s.directionToUtm },
          { id: "fromUtm", label: s.directionFromUtm },
        ]}
      />

      {direction === "toUtm" ? (
        <>
          <ToolInput label={s.lat} hint={s.latHint} value={latText} onChange={setLatText} />
          <ToolInput label={s.lon} hint={s.lonHint} value={lonText} onChange={setLonText} />
        </>
      ) : (
        <>
          <ToolInput label={s.zone} hint={s.zoneHint} value={zoneText} onChange={setZoneText} />
          <ToolSelect<"N" | "S">
            label={s.hemisphere}
            value={hemisphere}
            onChange={setHemisphere}
            options={[
              { id: "N", label: s.hemisphereNorth },
              { id: "S", label: s.hemisphereSouth },
            ]}
          />
          <ToolInput
            label={s.easting}
            hint={s.eastingHint}
            value={eastingText}
            onChange={setEastingText}
          />
          <ToolInput
            label={s.northing}
            hint={s.northingHint}
            value={northingText}
            onChange={setNorthingText}
          />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {direction === "toUtm" && forward.ok && (
            <>
              <ResultRow label={s.outZone} value={String(forward.zone)} />
              <ResultRow
                label={s.outHemisphere}
                value={forward.north ? s.hemisphereNorth : s.hemisphereSouth}
                mono={false}
              />
              <ResultRow
                label={s.outCentralMeridian}
                value={degrees(forward.centralMeridianDeg)}
              />
              <ResultRow
                label={s.outEasting}
                value={proUnit(proNum(forward.easting, 3), s.unitM)}
              />
              <ResultRow
                label={s.outNorthing}
                value={proUnit(proNum(forward.northing, 3), s.unitM)}
              />
              <ResultRow label={s.outScale} value={proNum(forward.scaleFactor, 8)} />
              <ResultRow label={s.outConvergence} value={degrees(forward.convergenceDeg)} />
            </>
          )}
          {direction === "fromUtm" && inverse.ok && (
            <>
              <ResultRow label={s.outZone} value={String(inverse.zone)} />
              <ResultRow label={s.outLat} value={degrees(inverse.lat)} />
              <ResultRow label={s.outLon} value={degrees(inverse.lon)} />
              <ResultRow label={s.outScale} value={proNum(inverse.scaleFactor, 8)} />
              <ResultRow label={s.outConvergence} value={degrees(inverse.convergenceDeg)} />
            </>
          )}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={
              direction === "toUtm"
                ? [
                    { label: s.lat, value: degrees(num(latText)) },
                    { label: s.lon, value: degrees(num(lonText)) },
                  ]
                : [
                    { label: s.zone, value: proNum(num(zoneText), 0) },
                    {
                      label: s.hemisphere,
                      value: hemisphere === "N" ? s.hemisphereNorth : s.hemisphereSouth,
                    },
                    { label: s.easting, value: proUnit(proNum(num(eastingText), 3), s.unitM) },
                    { label: s.northing, value: proUnit(proNum(num(northingText), 3), s.unitM) },
                  ]
            }
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function UtmMgrsTool() {
  const s = strings.pro.geodezija["utm-mgrs"];
  const [direction, setDirection] = useState<"toMgrs" | "fromMgrs">("toMgrs");
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [precisionId, setPrecisionId] = useState<PrecisionId>("p5");
  const [mgrsText, setMgrsText] = useState("");

  const precision = (PRECISION_OPTIONS.find((option) => option.id === precisionId)?.digits ??
    5) as MgrsPrecision;
  const typed = direction === "toMgrs" ? anyTyped(latText, lonText) : anyTyped(mgrsText);
  const written = mgrsFromGeo({ point: { lat: num(latText), lon: num(lonText) }, precision });
  const read = mgrsToUtm(mgrsText);
  const result = direction === "toMgrs" ? written : read;

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "point" || result.reason === "latitude"
        ? s.errorPoint
        : result.reason === "square"
          ? s.errorSquare
          : s.errorMgrs;

  const precisionLabel = (digits: MgrsPrecision | number): string =>
    digits === 5
      ? s.precision1m
      : digits === 4
        ? s.precision10m
        : digits === 3
          ? s.precision100m
          : digits === 2
            ? s.precision1km
            : digits === 1
              ? s.precision10km
              : s.precision100km;

  const copyText = !result.ok
    ? ""
    : direction === "toMgrs" && written.ok
      ? [
          `${s.outMgrs}: ${written.mgrs}`,
          `${s.outZone}: ${written.zone}`,
          `${s.outBand}: ${written.band}`,
          `${s.outEasting}: ${proUnit(proNum(written.easting, 3), s.unitM)}`,
          `${s.outNorthing}: ${proUnit(proNum(written.northing, 3), s.unitM)}`,
          `${s.outPrecision}: ${precisionLabel(written.precision)}`,
        ].join("\n")
      : read.ok
        ? [
            `${s.outZone}: ${read.zone}`,
            `${s.outBand}: ${read.band}`,
            `${s.outEasting}: ${proUnit(proNum(read.easting, 3), s.unitM)}`,
            `${s.outNorthing}: ${proUnit(proNum(read.northing, 3), s.unitM)}`,
            `${s.outSouthWest}: ${degrees(read.southWest.lat)}, ${degrees(read.southWest.lon)}`,
            `${s.outCentre}: ${degrees(read.centre.lat)}, ${degrees(read.centre.lon)}`,
            `${s.outPrecision}: ${precisionLabel(read.precision)}`,
          ].join("\n")
        : "";

  return (
    <>
      <ToolSelect<"toMgrs" | "fromMgrs">
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "toMgrs", label: s.directionToMgrs },
          { id: "fromMgrs", label: s.directionFromMgrs },
        ]}
      />

      {direction === "toMgrs" ? (
        <>
          <ToolInput label={s.lat} hint={s.latHint} value={latText} onChange={setLatText} />
          <ToolInput label={s.lon} hint={s.lonHint} value={lonText} onChange={setLonText} />
          <ToolSelect<PrecisionId>
            label={s.precision}
            value={precisionId}
            onChange={setPrecisionId}
            options={PRECISION_OPTIONS.map((option) => ({
              id: option.id,
              label: precisionLabel(option.digits),
            }))}
          />
        </>
      ) : (
        <ToolInput label={s.mgrs} hint={s.mgrsHint} value={mgrsText} onChange={setMgrsText} mono />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {direction === "toMgrs" && written.ok && (
            <>
              <ResultRow label={s.outMgrs} value={written.mgrs} />
              <ResultRow label={s.outZone} value={String(written.zone)} />
              <ResultRow label={s.outBand} value={written.band} />
              <ResultRow
                label={s.outEasting}
                value={proUnit(proNum(written.easting, 3), s.unitM)}
              />
              <ResultRow
                label={s.outNorthing}
                value={proUnit(proNum(written.northing, 3), s.unitM)}
              />
              <ResultRow label={s.outPrecision} value={precisionLabel(written.precision)} mono={false} />
            </>
          )}
          {direction === "fromMgrs" && read.ok && (
            <>
              <ResultRow label={s.outZone} value={String(read.zone)} />
              <ResultRow label={s.outBand} value={read.band} />
              <ResultRow
                label={s.outEasting}
                value={proUnit(proNum(read.easting, 3), s.unitM)}
              />
              <ResultRow
                label={s.outNorthing}
                value={proUnit(proNum(read.northing, 3), s.unitM)}
              />
              <ResultRow
                label={s.outSouthWest}
                value={`${degrees(read.southWest.lat)}, ${degrees(read.southWest.lon)}`}
              />
              <ResultRow
                label={s.outCentre}
                value={`${degrees(read.centre.lat)}, ${degrees(read.centre.lon)}`}
              />
              <ResultRow label={s.outPrecision} value={precisionLabel(read.precision)} mono={false} />
            </>
          )}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={
              direction === "toMgrs"
                ? [
                    { label: s.lat, value: degrees(num(latText)) },
                    { label: s.lon, value: degrees(num(lonText)) },
                    { label: s.precision, value: precisionLabel(precision) },
                  ]
                : [{ label: s.mgrs, value: mgrsText.trim().toUpperCase() }]
            }
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function GeodesicInverseTool() {
  const s = strings.pro.geodezija["geodesic-inverse"];
  const [fromLatText, setFromLatText] = useState("");
  const [fromLonText, setFromLonText] = useState("");
  const [toLatText, setToLatText] = useState("");
  const [toLonText, setToLonText] = useState("");

  const typed = anyTyped(fromLatText, fromLonText, toLatText, toLonText);
  const result = geodesicInverse({
    from: { lat: num(fromLatText), lon: num(fromLonText) },
    to: { lat: num(toLatText), lon: num(toLonText) },
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "from"
        ? s.errorFrom
        : result.reason === "to"
          ? s.errorTo
          : s.errorCoincident;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outDistance}: ${proUnit(proNum(result.distanceM, 3), s.unitM)}`,
        `${s.outDistanceKm}: ${proUnit(proNum(result.distanceKm, 6), s.unitKm)}`,
        `${s.outInitialAzimuth}: ${proUnit(proNum(result.initialAzimuthDeg, 6), s.unitDeg)}`,
        `${s.outFinalAzimuth}: ${proUnit(proNum(result.finalAzimuthDeg, 6), s.unitDeg)}`,
      ].join("\n");

  return (
    <>
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
          <ResultRow label={s.outDistance} value={proUnit(proNum(result.distanceM, 3), s.unitM)} />
          <ResultRow
            label={s.outDistanceKm}
            value={proUnit(proNum(result.distanceKm, 6), s.unitKm)}
          />
          <ResultRow
            label={s.outInitialAzimuth}
            value={proUnit(proNum(result.initialAzimuthDeg, 6), s.unitDeg)}
          />
          <ResultRow
            label={s.outFinalAzimuth}
            value={proUnit(proNum(result.finalAzimuthDeg, 6), s.unitDeg)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.fromLat, value: degrees(num(fromLatText)) },
              { label: s.fromLon, value: degrees(num(fromLonText)) },
              { label: s.toLat, value: degrees(num(toLatText)) },
              { label: s.toLon, value: degrees(num(toLonText)) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function GeodesicDirectTool() {
  const s = strings.pro.geodezija["geodesic-direct"];
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [azimuthText, setAzimuthText] = useState("");
  const [distanceText, setDistanceText] = useState("");

  const typed = anyTyped(latText, lonText, azimuthText, distanceText);
  const result = geodesicDirect({
    from: { lat: num(latText), lon: num(lonText) },
    azimuthDeg: num(azimuthText),
    distanceM: num(distanceText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "from"
        ? s.errorFrom
        : result.reason === "azimuth"
          ? s.errorAzimuth
          : s.errorDistance;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outLat}: ${degrees(result.to.lat)}`,
        `${s.outLon}: ${degrees(result.to.lon)}`,
        `${s.outFinalAzimuth}: ${proUnit(proNum(result.finalAzimuthDeg, 6), s.unitDeg)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.fromLat} hint={s.latHint} value={latText} onChange={setLatText} />
      <ToolInput label={s.fromLon} hint={s.lonHint} value={lonText} onChange={setLonText} />
      <ToolInput label={s.azimuth} hint={s.azimuthHint} value={azimuthText} onChange={setAzimuthText} />
      <ToolInput
        label={s.distance}
        hint={s.distanceHint}
        value={distanceText}
        onChange={setDistanceText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outLat} value={degrees(result.to.lat)} />
          <ResultRow label={s.outLon} value={degrees(result.to.lon)} />
          <ResultRow
            label={s.outFinalAzimuth}
            value={proUnit(proNum(result.finalAzimuthDeg, 6), s.unitDeg)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.fromLat, value: degrees(num(latText)) },
              { label: s.fromLon, value: degrees(num(lonText)) },
              { label: s.azimuth, value: proUnit(proNum(num(azimuthText), 4), s.unitDeg) },
              { label: s.distance, value: proUnit(proNum(num(distanceText), 3), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function GridGroundRatioTool() {
  const s = strings.pro.geodezija["grid-ground-ratio"];
  const [fromLatText, setFromLatText] = useState("");
  const [fromLonText, setFromLonText] = useState("");
  const [toLatText, setToLatText] = useState("");
  const [toLonText, setToLonText] = useState("");

  const typed = anyTyped(fromLatText, fromLonText, toLatText, toLonText);
  const result = gridGroundRatio({
    from: { lat: num(fromLatText), lon: num(fromLonText) },
    to: { lat: num(toLatText), lon: num(toLonText) },
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "zone"
        ? s.errorZone
        : result.reason === "hemisphere"
          ? s.errorHemisphere
          : s.errorPoint;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outGround}: ${proUnit(proNum(result.groundDistanceM, 3), s.unitM)}`,
        `${s.outGrid}: ${proUnit(proNum(result.gridDistanceM, 3), s.unitM)}`,
        `${s.outRatio}: ${proNum(result.ratio, 9)}`,
        `${s.outScaleFrom}: ${proNum(result.fromUtm.scaleFactor, 9)}`,
        `${s.outScaleTo}: ${proNum(result.toUtm.scaleFactor, 9)}`,
      ].join("\n");

  return (
    <>
      <p className="nx-hint nx-hint--prose">{s.hint}</p>

      <ToolInput label={s.fromLat} value={fromLatText} onChange={setFromLatText} />
      <ToolInput label={s.fromLon} value={fromLonText} onChange={setFromLonText} />
      <ToolInput label={s.toLat} value={toLatText} onChange={setToLatText} />
      <ToolInput label={s.toLon} value={toLonText} onChange={setToLonText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.outGround}
            value={proUnit(proNum(result.groundDistanceM, 3), s.unitM)}
          />
          <ResultRow label={s.outGrid} value={proUnit(proNum(result.gridDistanceM, 3), s.unitM)} />
          <ResultRow label={s.outRatio} value={proNum(result.ratio, 9)} />
          <ResultRow label={s.outScaleFrom} value={proNum(result.fromUtm.scaleFactor, 9)} />
          <ResultRow label={s.outScaleTo} value={proNum(result.toUtm.scaleFactor, 9)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.fromLat, value: degrees(num(fromLatText)) },
              { label: s.fromLon, value: degrees(num(fromLonText)) },
              { label: s.toLat, value: degrees(num(toLatText)) },
              { label: s.toLon, value: degrees(num(toLonText)) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const GEODEZIJA_SURFACES: Readonly<Record<string, ComponentType>> = {
  "decimal-dms": DecimalDmsTool,
  "geodesic-direct": GeodesicDirectTool,
  "geodesic-inverse": GeodesicInverseTool,
  "grid-ground-ratio": GridGroundRatioTool,
  "utm-mgrs": UtmMgrsTool,
  "wgs84-utm": Wgs84UtmTool,
};
