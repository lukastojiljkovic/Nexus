import {
  angleOfView,
  circleOfConfusionFromDiagonal,
  cropFactor,
  depthOfField,
  diffractionLimit,
  exposureSolve,
  flashAperture,
  frameRateConform,
  GREEN_WAVELENGTH_NM,
  illuminanceToAperture,
  miredShift,
  motionBlurPixels,
  motionBlurShutter,
  ndFilterExposure,
  parseShutterTime,
  pqFromLuminance,
  pqFromSignal,
  pqSignalFromCode,
  RASTER_BIT_DEPTHS,
  rasterImageSize,
  timecodeDrift,
  timecodeOperation,
  timecodeSeconds,
  timecodeToFrames,
  timelapsePlan,
  videoStorage,
  type CapacityUnit,
  type IlluminanceUnit,
  type LengthUnit,
  type PqBitDepth,
  type PqRange,
  type SpeedUnit,
  type TimecodeFormat,
} from "@nexus/core/pro/foto";
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
 * „Fotografija i video" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/foto.ts`'s. Nothing here divides, rounds
 * or converts a physical quantity — the surface shapes fields, hands the
 * typed numbers to the core function, and prints what comes back.
 *
 * **Every tool in this file is `riskClass: "none"`.** None of the sixteen
 * takes a regulated maximum as an input, so `ToolAgainstLimit` never appears
 * here — there is no limit for a value to sit beside. What the shared kit
 * still enforces is the other three: the formula the tool evaluated, the
 * inputs echoed back beside the answer, and a copy button that carries both.
 *
 * **A duration is shown in seconds, never as `h:mm:ss`.** Several tools'
 * catalogue entries ask for that format, but turning a seconds count into
 * hours/minutes/seconds is arithmetic — floor, modulo — that belongs in
 * `@nexus/core`, and no such formatter exists there today. Printing seconds
 * to three decimals is the honest alternative to inventing one on this side
 * of the boundary; it is recorded as a known gap, not hidden.
 */

/**
 * A signed magnitude prints its own „+"; `Intl.NumberFormat` already supplies
 * the „−" for a negative one, so this is the other half a locale formatter
 * does not add by itself. Presentational only — it compares a sign, it does
 * not compute one.
 */
function signed(value: number, text: string): string {
  return value >= 0 ? `+${text}` : text;
}

/** `parseShutterTime`'s seconds, or `NaN` for an empty or malformed field. */
function shutterOf(text: string): number {
  const parsed = parseShutterTime(text);
  return parsed.ok ? parsed.seconds : Number.NaN;
}

/* ------------------------------------------------------------ angle of view -- */

export function AngleOfViewTool() {
  const s = strings.pro.foto["angle-of-view"];
  const [sensorWidth, setSensorWidth] = useState("");
  const [sensorHeight, setSensorHeight] = useState("");
  const [focalLength, setFocalLength] = useState("");
  const [subjectDistance, setSubjectDistance] = useState("");

  const typed =
    proParse(sensorWidth) !== undefined ||
    proParse(sensorHeight) !== undefined ||
    proParse(focalLength) !== undefined;
  const view = angleOfView({
    sensorWidth: proParse(sensorWidth) ?? Number.NaN,
    sensorHeight: proParse(sensorHeight) ?? Number.NaN,
    focalLength: proParse(focalLength) ?? Number.NaN,
    subjectDistance: proParse(subjectDistance),
  });

  const failure =
    view.ok || !typed
      ? undefined
      : view.reason === "sensorWidth"
        ? s.errorSensorWidth
        : view.reason === "sensorHeight"
          ? s.errorSensorHeight
          : view.reason === "focalLength"
            ? s.errorFocalLength
            : s.errorSubjectDistance;

  const copyText = !view.ok
    ? ""
    : [
        `${s.horizontal}: ${proNum(view.horizontal, 2)}${s.unitDeg}`,
        `${s.vertical}: ${proNum(view.vertical, 2)}${s.unitDeg}`,
        `${s.diagonal}: ${proNum(view.diagonal, 2)}${s.unitDeg}`,
        `${s.sensorDiagonal}: ${proUnit(proNum(view.sensorDiagonal, 4), s.unitMm)}`,
        ...(view.field === undefined
          ? []
          : [
              `${s.fieldWidth}: ${proUnit(proNum(view.field.width, 3), s.unitM)}`,
              `${s.fieldHeight}: ${proUnit(proNum(view.field.height, 3), s.unitM)}`,
              `${s.fieldDiagonal}: ${proUnit(proNum(view.field.diagonal, 3), s.unitM)}`,
            ]),
        "",
        `${s.sensorWidth}: ${proUnit(proNum(proParse(sensorWidth) ?? 0, 1), s.unitMm)}`,
        `${s.sensorHeight}: ${proUnit(proNum(proParse(sensorHeight) ?? 0, 1), s.unitMm)}`,
        `${s.focalLength}: ${proUnit(proNum(proParse(focalLength) ?? 0, 1), s.unitMm)}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.sensorWidth}
        hint={s.sensorWidthHint}
        value={sensorWidth}
        onChange={setSensorWidth}
      />
      <ToolInput label={s.sensorHeight} value={sensorHeight} onChange={setSensorHeight} />
      <ToolInput label={s.focalLength} value={focalLength} onChange={setFocalLength} />
      <ToolInput
        label={s.subjectDistance}
        hint={s.subjectDistanceHint}
        value={subjectDistance}
        onChange={setSubjectDistance}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {view.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.horizontal} value={`${proNum(view.horizontal, 2)}${s.unitDeg}`} />
          <ResultRow label={s.vertical} value={`${proNum(view.vertical, 2)}${s.unitDeg}`} />
          <ResultRow label={s.diagonal} value={`${proNum(view.diagonal, 2)}${s.unitDeg}`} />
          <ResultRow
            label={s.sensorDiagonal}
            value={proUnit(proNum(view.sensorDiagonal, 4), s.unitMm)}
          />
          {view.field !== undefined && (
            <>
              <ResultRow
                label={s.fieldWidth}
                value={proUnit(proNum(view.field.width, 3), s.unitM)}
              />
              <ResultRow
                label={s.fieldHeight}
                value={proUnit(proNum(view.field.height, 3), s.unitM)}
              />
              <ResultRow
                label={s.fieldDiagonal}
                value={proUnit(proNum(view.field.diagonal, 3), s.unitM)}
              />
            </>
          )}
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.sensorWidth,
                value: proUnit(proNum(proParse(sensorWidth) ?? 0, 1), s.unitMm),
              },
              {
                label: s.sensorHeight,
                value: proUnit(proNum(proParse(sensorHeight) ?? 0, 1), s.unitMm),
              },
              {
                label: s.focalLength,
                value: proUnit(proNum(proParse(focalLength) ?? 0, 1), s.unitMm),
              },
              ...(proParse(subjectDistance) === undefined
                ? []
                : [
                    {
                      label: s.subjectDistance,
                      value: proUnit(proNum(proParse(subjectDistance) ?? 0, 2), s.unitM),
                    },
                  ]),
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------- flash guide number -- */

export function FlashGuideNumberTool() {
  const s = strings.pro.foto["flash-guide-number"];
  const [guideNumber, setGuideNumber] = useState("");
  const [guideNumberUnit, setGuideNumberUnit] = useState<LengthUnit>("m");
  const [distance, setDistance] = useState("");
  const [iso, setIso] = useState("");
  const [secondDistance, setSecondDistance] = useState("");

  const typed =
    proParse(guideNumber) !== undefined ||
    proParse(distance) !== undefined ||
    proParse(iso) !== undefined;
  const flash = flashAperture({
    guideNumber: proParse(guideNumber) ?? Number.NaN,
    guideNumberUnit,
    distance: proParse(distance) ?? Number.NaN,
    iso: proParse(iso) ?? Number.NaN,
    secondDistance: proParse(secondDistance),
  });

  const failure =
    flash.ok || !typed
      ? undefined
      : flash.reason === "guideNumber"
        ? s.errorGuideNumber
        : flash.reason === "distance"
          ? s.errorDistance
          : flash.reason === "iso"
            ? s.errorIso
            : s.errorSecondDistance;

  const copyText = !flash.ok
    ? ""
    : [
        `${s.guideNumberAtIso}: ${proUnit(proNum(flash.guideNumberAtIso, 2), s.unitM)}`,
        `${s.fNumber}: f/${proNum(flash.fNumber, 2)}`,
        ...(flash.secondFNumber === undefined
          ? []
          : [`${s.secondFNumber}: f/${proNum(flash.secondFNumber, 2)}`]),
        ...(flash.distanceStops === undefined
          ? []
          : [
              `${s.distanceStops}: ${signed(flash.distanceStops, proNum(flash.distanceStops, 3))}`,
            ]),
        "",
        `${s.guideNumber}: ${proUnit(proNum(proParse(guideNumber) ?? 0, 2), guideNumberUnit === "ft" ? s.unitFt : s.unitM)}`,
        `${s.distance}: ${proUnit(proNum(proParse(distance) ?? 0, 2), s.unitM)}`,
        `${s.iso}: ${proNum(proParse(iso) ?? 0, 0)}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.guideNumber}
        hint={s.guideNumberHint}
        value={guideNumber}
        onChange={setGuideNumber}
      />
      <ToolSelect<LengthUnit>
        label={s.guideNumberUnit}
        value={guideNumberUnit}
        onChange={setGuideNumberUnit}
        options={[
          { id: "m", label: s.unitM },
          { id: "ft", label: s.unitFt },
        ]}
      />
      <ToolInput label={s.distance} value={distance} onChange={setDistance} />
      <ToolInput label={s.iso} value={iso} onChange={setIso} />
      <ToolInput
        label={s.secondDistance}
        hint={s.secondDistanceHint}
        value={secondDistance}
        onChange={setSecondDistance}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {flash.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.guideNumberAtIso}
            value={proUnit(proNum(flash.guideNumberAtIso, 2), s.unitM)}
          />
          <ResultRow label={s.fNumber} value={`f/${proNum(flash.fNumber, 2)}`} />
          {flash.secondFNumber !== undefined && (
            <ResultRow label={s.secondFNumber} value={`f/${proNum(flash.secondFNumber, 2)}`} />
          )}
          {flash.distanceStops !== undefined && (
            <ResultRow
              label={s.distanceStops}
              value={signed(flash.distanceStops, proNum(flash.distanceStops, 3))}
            />
          )}
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.guideNumber,
                value: proUnit(
                  proNum(proParse(guideNumber) ?? 0, 2),
                  guideNumberUnit === "ft" ? s.unitFt : s.unitM,
                ),
              },
              { label: s.distance, value: proUnit(proNum(proParse(distance) ?? 0, 2), s.unitM) },
              { label: s.iso, value: proNum(proParse(iso) ?? 0, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ----------------------------------------------------- frame rate conform -- */

export function FrameRateConformTool() {
  const s = strings.pro.foto["frame-rate-conform"];
  const [captureFps, setCaptureFps] = useState("");
  const [timelineFps, setTimelineFps] = useState("");
  const [sourceDuration, setSourceDuration] = useState("");
  const [frameCount, setFrameCount] = useState("");
  const [slowMotionFactor, setSlowMotionFactor] = useState("");

  const typed =
    proParse(captureFps) !== undefined ||
    proParse(timelineFps) !== undefined ||
    proParse(sourceDuration) !== undefined ||
    proParse(frameCount) !== undefined;
  const conform = frameRateConform({
    captureFps: proParse(captureFps) ?? Number.NaN,
    timelineFps: proParse(timelineFps) ?? Number.NaN,
    sourceDuration: proParse(sourceDuration),
    frameCount: proParse(frameCount),
    slowMotionFactor: proParse(slowMotionFactor),
  });

  const failure =
    conform.ok || !typed
      ? undefined
      : conform.reason === "captureFps"
        ? s.errorCaptureFps
        : conform.reason === "timelineFps"
          ? s.errorTimelineFps
          : conform.reason === "sourceDuration"
            ? s.errorSourceDuration
            : conform.reason === "frameCount"
              ? s.errorFrameCount
              : conform.reason === "slowMotionFactor"
                ? s.errorSlowMotionFactor
                : s.errorClipLength;

  const copyText = !conform.ok
    ? ""
    : [
        `${s.speedPercent}: ${proNum(conform.speedPercent, 4)} %`,
        `${s.speedFactor}: ${proNum(conform.speedFactor, 4)}×`,
        `${s.frameCount}: ${proNum(conform.frameCount, 0)}`,
        `${s.conformedDuration}: ${proUnit(proNum(conform.conformedDuration, 3), s.unitS)}`,
        `${s.drift}: ${signed(conform.drift, proUnit(proNum(conform.drift, 3), s.unitS))}`,
        ...(conform.requiredCaptureFps === undefined
          ? []
          : [`${s.requiredCaptureFps}: ${proUnit(proNum(conform.requiredCaptureFps, 3), s.unitFps)}`]),
        "",
        `${s.captureFps}: ${proUnit(proNum(conform.captureFps, 3), s.unitFps)}`,
        `${s.timelineFps}: ${proUnit(proNum(conform.timelineFps, 3), s.unitFps)}`,
        `${s.sourceDuration}: ${proUnit(proNum(conform.sourceDuration, 3), s.unitS)}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.captureFps}
        hint={s.fpsHint}
        value={captureFps}
        onChange={setCaptureFps}
      />
      <ToolInput
        label={s.timelineFps}
        hint={s.fpsHint}
        value={timelineFps}
        onChange={setTimelineFps}
      />
      <ToolInput
        label={s.sourceDuration}
        hint={s.clipLengthHint}
        value={sourceDuration}
        onChange={setSourceDuration}
      />
      <ToolInput label={s.frameCount} value={frameCount} onChange={setFrameCount} />
      <ToolInput
        label={s.slowMotionFactor}
        hint={s.slowMotionFactorHint}
        value={slowMotionFactor}
        onChange={setSlowMotionFactor}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {conform.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.speedPercent} value={`${proNum(conform.speedPercent, 4)} %`} />
          <ResultRow label={s.speedFactor} value={`${proNum(conform.speedFactor, 4)}×`} />
          <ResultRow label={s.frameCount} value={proNum(conform.frameCount, 0)} />
          <ResultRow
            label={s.conformedDuration}
            value={proUnit(proNum(conform.conformedDuration, 3), s.unitS)}
          />
          <ResultRow
            label={s.drift}
            value={signed(conform.drift, proUnit(proNum(conform.drift, 3), s.unitS))}
          />
          {conform.requiredCaptureFps !== undefined && (
            <ResultRow
              label={s.requiredCaptureFps}
              value={proUnit(proNum(conform.requiredCaptureFps, 3), s.unitFps)}
            />
          )}
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.captureFps, value: proUnit(proNum(conform.captureFps, 3), s.unitFps) },
              { label: s.timelineFps, value: proUnit(proNum(conform.timelineFps, 3), s.unitFps) },
              {
                label: s.sourceDuration,
                value: proUnit(proNum(conform.sourceDuration, 3), s.unitS),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------------ illuminance to aperture -- */

export function IlluminanceToApertureTool() {
  const s = strings.pro.foto["illuminance-to-aperture"];
  const [illuminance, setIlluminance] = useState("");
  const [unit, setUnit] = useState<IlluminanceUnit>("lx");
  const [iso, setIso] = useState("");
  const [shutter, setShutter] = useState("");
  const [calibrationConstant, setCalibrationConstant] = useState("");

  const typed = proParse(illuminance) !== undefined;
  const result = illuminanceToAperture({
    illuminance: proParse(illuminance) ?? Number.NaN,
    unit,
    iso: proParse(iso),
    shutter: shutter.trim() === "" ? undefined : shutterOf(shutter),
    calibrationConstant: proParse(calibrationConstant),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "illuminance"
        ? s.errorIlluminance
        : result.reason === "calibrationConstant"
          ? s.errorCalibrationConstant
          : result.reason === "iso"
            ? s.errorIso
            : s.errorShutter;

  const copyText = !result.ok
    ? ""
    : [
        `${s.lux}: ${proUnit(proNum(result.lux, 3), s.unitLx)}`,
        `${s.footCandles}: ${proUnit(proNum(result.footCandles, 3), s.unitFc)}`,
        ...(result.aperture === undefined
          ? []
          : [
              `${s.fNumber}: f/${proNum(result.aperture.fNumber, 2)}`,
              `${s.nearestThirdStop}: f/${proNum(result.aperture.nearestThirdStop, 2)} (k=${proNum(result.aperture.thirdStopIndex, 0)})`,
            ]),
        "",
        `${s.illuminance}: ${proUnit(proNum(proParse(illuminance) ?? 0, 3), unit === "fc" ? s.unitFc : s.unitLx)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.illuminance} value={illuminance} onChange={setIlluminance} />
      <ToolSelect<IlluminanceUnit>
        label={s.unit}
        value={unit}
        onChange={setUnit}
        options={[
          { id: "lx", label: s.unitLx },
          { id: "fc", label: s.unitFc },
        ]}
      />
      <ToolInput label={s.iso} hint={s.isoShutterHint} value={iso} onChange={setIso} />
      <ToolInput label={s.shutter} value={shutter} onChange={setShutter} />
      <ToolInput
        label={s.calibrationConstant}
        hint={s.calibrationConstantHint}
        value={calibrationConstant}
        onChange={setCalibrationConstant}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.lux} value={proUnit(proNum(result.lux, 3), s.unitLx)} />
          <ResultRow
            label={s.footCandles}
            value={proUnit(proNum(result.footCandles, 3), s.unitFc)}
          />
          {result.aperture !== undefined && (
            <>
              <ResultRow label={s.fNumber} value={`f/${proNum(result.aperture.fNumber, 2)}`} />
              <ResultRow
                label={s.nearestThirdStop}
                value={`f/${proNum(result.aperture.nearestThirdStop, 2)} (k=${proNum(result.aperture.thirdStopIndex, 0)})`}
              />
            </>
          )}
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.illuminance,
                value: proUnit(
                  proNum(proParse(illuminance) ?? 0, 3),
                  unit === "fc" ? s.unitFc : s.unitLx,
                ),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------- mired shift -- */

export function MiredShiftTool() {
  const s = strings.pro.foto["mired-shift"];
  const [sourceTemperature, setSourceTemperature] = useState("");
  const [targetTemperature, setTargetTemperature] = useState("");
  const [shift, setShift] = useState("");

  const typed =
    proParse(sourceTemperature) !== undefined ||
    proParse(targetTemperature) !== undefined ||
    proParse(shift) !== undefined;
  const result = miredShift({
    sourceTemperature: proParse(sourceTemperature) ?? Number.NaN,
    targetTemperature: proParse(targetTemperature),
    shift: proParse(shift),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "sourceTemperature"
        ? s.errorSourceTemperature
        : result.reason === "targetTemperature"
          ? s.errorTargetTemperature
          : result.reason === "shift"
            ? s.errorShift
            : s.errorTarget;

  const copyText = !result.ok
    ? ""
    : [
        `${s.sourceMired}: ${proNum(result.sourceMired, 3)} ${s.unitMired}`,
        `${s.resultMired}: ${proNum(result.resultMired, 3)} ${s.unitMired}`,
        `${s.shift}: ${signed(result.shift, `${proNum(result.shift, 3)} ${s.unitMired}`)}`,
        `${s.resultTemperature}: ${proUnit(proNum(result.resultTemperature, 1), s.unitK)}`,
        "",
        `${s.sourceTemperature}: ${proUnit(proNum(proParse(sourceTemperature) ?? 0, 0), s.unitK)}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.sourceTemperature}
        value={sourceTemperature}
        onChange={setSourceTemperature}
      />
      <ToolInput
        label={s.targetTemperature}
        hint={s.targetTemperatureHint}
        value={targetTemperature}
        onChange={setTargetTemperature}
      />
      <ToolInput label={s.shift} hint={s.shiftHint} value={shift} onChange={setShift} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.sourceMired} value={`${proNum(result.sourceMired, 3)} ${s.unitMired}`} />
          <ResultRow label={s.resultMired} value={`${proNum(result.resultMired, 3)} ${s.unitMired}`} />
          <ResultRow
            label={s.shift}
            value={signed(result.shift, `${proNum(result.shift, 3)} ${s.unitMired}`)}
          />
          <ResultRow
            label={s.resultTemperature}
            value={proUnit(proNum(result.resultTemperature, 1), s.unitK)}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.sourceTemperature,
                value: proUnit(proNum(proParse(sourceTemperature) ?? 0, 0), s.unitK),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------- motion blur -- */

export function MotionBlurTool() {
  const s = strings.pro.foto["motion-blur"];
  const [speed, setSpeed] = useState("");
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>("m/s");
  const [subjectDistance, setSubjectDistance] = useState("");
  const [focalLength, setFocalLength] = useState("");
  const [shutter, setShutter] = useState("");
  const [sensorWidth, setSensorWidth] = useState("");
  const [pixelCount, setPixelCount] = useState("");
  const [acceptableBlurPixels, setAcceptableBlurPixels] = useState("");

  const geometry = {
    speed: proParse(speed) ?? Number.NaN,
    speedUnit,
    subjectDistance: proParse(subjectDistance) ?? Number.NaN,
    focalLength: proParse(focalLength) ?? Number.NaN,
    sensorWidth: proParse(sensorWidth) ?? Number.NaN,
    pixelCount: proParse(pixelCount) ?? Number.NaN,
  };
  const geometryTyped =
    proParse(speed) !== undefined ||
    proParse(subjectDistance) !== undefined ||
    proParse(focalLength) !== undefined ||
    proParse(sensorWidth) !== undefined ||
    proParse(pixelCount) !== undefined;
  const shutterTyped = shutter.trim() !== "";
  const blurTyped = acceptableBlurPixels.trim() !== "";
  const typed = geometryTyped || shutterTyped || blurTyped;

  // Exactly one direction runs: either the blur a given shutter produces, or
  // the shutter a given acceptable blur allows. Neither typed, with the
  // geometry filled in, is its own refusal — there is nothing to solve for.
  const blurResult = shutterTyped
    ? motionBlurPixels({ ...geometry, shutter: shutterOf(shutter) })
    : undefined;
  const shutterResult =
    !shutterTyped && blurTyped
      ? motionBlurShutter({
          ...geometry,
          acceptableBlurPixels: proParse(acceptableBlurPixels) ?? Number.NaN,
        })
      : undefined;
  const active = blurResult ?? shutterResult;

  const failure =
    active === undefined
      ? geometryTyped && !shutterTyped && !blurTyped
        ? s.errorMode
        : undefined
      : active.ok || !typed
        ? undefined
        : active.reason === "focalLength"
          ? s.errorFocalLength
          : active.reason === "sensorWidth"
            ? s.errorSensorWidth
            : active.reason === "pixelCount"
              ? s.errorPixelCount
              : active.reason === "subjectDistance"
                ? s.errorSubjectDistance
                : active.reason === "speed"
                  ? s.errorSpeed
                  : active.reason === "shutter"
                    ? s.errorShutter
                    : s.errorAcceptableBlurPixels;

  const inputEntries = [
    {
      label: s.speed,
      value: proUnit(proNum(proParse(speed) ?? 0, 3), speedUnit === "km/h" ? s.unitKmh : s.unitMs),
    },
    { label: s.subjectDistance, value: proUnit(proNum(proParse(subjectDistance) ?? 0, 2), s.unitM) },
    { label: s.focalLength, value: proUnit(proNum(proParse(focalLength) ?? 0, 1), s.unitMm) },
    { label: s.sensorWidth, value: proUnit(proNum(proParse(sensorWidth) ?? 0, 1), s.unitMm) },
    { label: s.pixelCount, value: proNum(proParse(pixelCount) ?? 0, 0) },
  ];

  const copyText =
    blurResult?.ok === true
      ? [
          `${s.blurMillimetres}: ${proUnit(proNum(blurResult.blurMillimetres, 4), s.unitMm)}`,
          `${s.blurPixels}: ${proNum(blurResult.blurPixels, 2)} px`,
          "",
          `${s.shutter}: ${shutter.trim()}`,
          ...inputEntries.map((entry) => `${entry.label}: ${entry.value}`),
        ].join("\n")
      : shutterResult?.ok === true
        ? [
            `${s.solvedShutter}: ${proNum(shutterResult.shutter, 6)} ${s.unitS} (1/${proNum(shutterResult.shutterDenominator, 0)})`,
            "",
            `${s.acceptableBlurPixels}: ${proNum(proParse(acceptableBlurPixels) ?? 0, 2)} px`,
            ...inputEntries.map((entry) => `${entry.label}: ${entry.value}`),
          ].join("\n")
        : "";

  return (
    <>
      <ToolInput label={s.speed} value={speed} onChange={setSpeed} />
      <ToolSelect<SpeedUnit>
        label={s.speedUnit}
        value={speedUnit}
        onChange={setSpeedUnit}
        options={[
          { id: "m/s", label: s.unitMs },
          { id: "km/h", label: s.unitKmh },
        ]}
      />
      <ToolInput label={s.subjectDistance} value={subjectDistance} onChange={setSubjectDistance} />
      <ToolInput label={s.focalLength} value={focalLength} onChange={setFocalLength} />
      <ToolInput
        label={s.shutter}
        hint={s.shutterHint}
        value={shutter}
        onChange={setShutter}
      />
      <ToolInput label={s.sensorWidth} value={sensorWidth} onChange={setSensorWidth} />
      <ToolInput label={s.pixelCount} value={pixelCount} onChange={setPixelCount} />
      <ToolInput
        label={s.acceptableBlurPixels}
        hint={s.acceptableBlurPixelsHint}
        value={acceptableBlurPixels}
        onChange={setAcceptableBlurPixels}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {blurResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.blurMillimetres}
            value={proUnit(proNum(blurResult.blurMillimetres, 4), s.unitMm)}
          />
          <ResultRow label={s.blurPixels} value={`${proNum(blurResult.blurPixels, 2)} px`} />
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[...inputEntries, { label: s.shutter, value: shutter.trim() }]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      {shutterResult?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.solvedShutter}
            value={`${proNum(shutterResult.shutter, 6)} ${s.unitS} (1/${proNum(shutterResult.shutterDenominator, 0)})`}
          />
          <p className="nx-hint nx-hint--prose">{s.roundingNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              ...inputEntries,
              { label: s.acceptableBlurPixels, value: `${proNum(proParse(acceptableBlurPixels) ?? 0, 2)} px` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- ND filter -- */

/**
 * Four fixed filter slots rather than an add/remove list: the shared kit has
 * no button primitive for growing a list, and a stack of more than four ND
 * filters on one lens is not a case this drawer needs to carry. An empty
 * slot (all three of its fields blank) simply does not join the stack — see
 * `activeFilters` below — and the state lives only in this component, so it
 * is gone the moment the drawer closes, exactly as the review asked.
 */
const ND_FILTER_SLOTS = 4;

export function NdFilterExposureTool() {
  const s = strings.pro.foto["nd-filter-exposure"];
  const [baseShutter, setBaseShutter] = useState("");
  const [slotStops, setSlotStops] = useState<string[]>(Array(ND_FILTER_SLOTS).fill(""));
  const [slotDensity, setSlotDensity] = useState<string[]>(Array(ND_FILTER_SLOTS).fill(""));
  const [slotFactor, setSlotFactor] = useState<string[]>(Array(ND_FILTER_SLOTS).fill(""));

  const setSlotField =
    (list: string[], setList: (next: string[]) => void, index: number) => (value: string) => {
      setList(list.map((entry, i) => (i === index ? value : entry)));
    };

  const slotTyped = (index: number): boolean =>
    (slotStops[index]?.trim() ?? "") !== "" ||
    (slotDensity[index]?.trim() ?? "") !== "" ||
    (slotFactor[index]?.trim() ?? "") !== "";

  const activeFilters = Array.from({ length: ND_FILTER_SLOTS }, (_, index) => index)
    .filter(slotTyped)
    .map((index) => ({
      stops: proParse(slotStops[index] ?? ""),
      density: proParse(slotDensity[index] ?? ""),
      factor: proParse(slotFactor[index] ?? ""),
    }));

  const typed = baseShutter.trim() !== "" || activeFilters.length > 0;
  const result = ndFilterExposure({
    baseShutter: shutterOf(baseShutter),
    filters: activeFilters,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "baseShutter"
        ? s.errorBaseShutter
        : result.reason === "filters"
          ? s.errorFilters
          : result.reason === "filterForm"
            ? s.errorFilterForm
            : result.reason === "stops"
              ? s.errorStops
              : result.reason === "density"
                ? s.errorDensity
                : s.errorFactor;

  const copyText = !result.ok
    ? ""
    : [
        `${s.stops}: ${proNum(result.stops, 3)}`,
        `${s.density}: ${proNum(result.density, 3)}`,
        `${s.factor}: ${proNum(result.factor, 3)}×`,
        `${s.shutter}: ${proUnit(proNum(result.shutter, 3), s.unitS)}`,
        "",
        `${s.baseShutter}: ${baseShutter.trim()}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.baseShutter}
        hint={s.shutterHint}
        value={baseShutter}
        onChange={setBaseShutter}
      />
      {Array.from({ length: ND_FILTER_SLOTS }, (_, index) => index).map((index) => (
        <ToolSection key={index} title={`${s.filterSlot} ${index + 1}`}>
          {index === 0 && <p className="nx-hint nx-hint--prose">{s.slotHint}</p>}
          <ToolInput
            label={s.stops}
            value={slotStops[index] ?? ""}
            onChange={setSlotField(slotStops, setSlotStops, index)}
          />
          <ToolInput
            label={s.density}
            value={slotDensity[index] ?? ""}
            onChange={setSlotField(slotDensity, setSlotDensity, index)}
          />
          <ToolInput
            label={s.factor}
            value={slotFactor[index] ?? ""}
            onChange={setSlotField(slotFactor, setSlotFactor, index)}
          />
        </ToolSection>
      ))}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.stops} value={proNum(result.stops, 3)} />
          <ResultRow label={s.density} value={proNum(result.density, 3)} />
          <ResultRow label={s.factor} value={`${proNum(result.factor, 3)}×`} />
          <ResultRow label={s.shutter} value={proUnit(proNum(result.shutter, 3), s.unitS)} />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.baseShutter, value: baseShutter.trim() }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* --------------------------------------------------------------- PQ / nits -- */

const PQ_BIT_DEPTHS: Readonly<Record<"10" | "12", PqBitDepth>> = { "10": 10, "12": 12 };

export function PqNitsTool() {
  const s = strings.pro.foto["pq-nits"];
  const [signal, setSignal] = useState("");
  const [code, setCode] = useState("");
  const [luminance, setLuminance] = useState("");
  const [range, setRange] = useState<PqRange>("narrow");
  const [bitDepthId, setBitDepthId] = useState<"10" | "12">("10");
  const bitDepth = PQ_BIT_DEPTHS[bitDepthId];

  const signalTyped = proParse(signal) !== undefined;
  const codeTyped = proParse(code) !== undefined;
  const luminanceTyped = proParse(luminance) !== undefined;
  const filledCount = [signalTyped, codeTyped, luminanceTyped].filter(Boolean).length;
  const typed = filledCount > 0;

  // Exactly one of the three entry points may be filled — each reaches the
  // curve through a different core function, so the branch is chosen here
  // rather than left to one function with optional fields.
  const point =
    filledCount !== 1
      ? undefined
      : signalTyped
        ? pqFromSignal(proParse(signal) ?? Number.NaN, bitDepth)
        : luminanceTyped
          ? pqFromLuminance(proParse(luminance) ?? Number.NaN, bitDepth)
          : (() => {
              const fromCode = pqSignalFromCode(proParse(code) ?? Number.NaN, bitDepth, range);
              return fromCode.ok ? pqFromSignal(fromCode.signal, bitDepth) : fromCode;
            })();

  const failure =
    point === undefined
      ? typed && filledCount !== 1
        ? s.errorTarget
        : undefined
      : point.ok
        ? undefined
        : point.reason === "signal"
          ? s.errorSignal
          : point.reason === "luminance"
            ? s.errorLuminance
            : s.errorCode;

  const copyText =
    point === undefined || !point.ok
      ? ""
      : [
          `${s.signal}: ${proNum(point.signal, 6)}`,
          `${s.luminance}: ${proUnit(proNum(point.luminance, 3), s.unitNits)}`,
          `${s.codeNarrow}: ${proNum(point.code.narrow, 0)}`,
          `${s.codeFull}: ${proNum(point.code.full, 0)}`,
          "",
          `${s.range}: ${range === "narrow" ? s.rangeNarrow : s.rangeFull}`,
          `${s.bitDepth}: ${bitDepthId}`,
        ].join("\n");

  return (
    <>
      <ToolInput label={s.signal} hint={s.targetHint} value={signal} onChange={setSignal} />
      <ToolInput label={s.code} value={code} onChange={setCode} />
      <ToolInput label={s.luminance} value={luminance} onChange={setLuminance} />
      <ToolSelect<PqRange>
        label={s.range}
        value={range}
        onChange={setRange}
        options={[
          { id: "narrow", label: s.rangeNarrow },
          { id: "full", label: s.rangeFull },
        ]}
      />
      <ToolSelect<"10" | "12">
        label={s.bitDepth}
        value={bitDepthId}
        onChange={setBitDepthId}
        options={[
          { id: "10", label: "10" },
          { id: "12", label: "12" },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {point?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.signal} value={proNum(point.signal, 6)} />
          <ResultRow label={s.luminance} value={proUnit(proNum(point.luminance, 3), s.unitNits)} />
          <ResultRow label={s.codeNarrow} value={proNum(point.code.narrow, 0)} />
          <ResultRow label={s.codeFull} value={proNum(point.code.full, 0)} />
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.range, value: range === "narrow" ? s.rangeNarrow : s.rangeFull },
              { label: s.bitDepth, value: bitDepthId },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------- raster image size -- */

const RASTER_BIT_DEPTH_OPTIONS = RASTER_BIT_DEPTHS.map((depth) => ({
  id: String(depth),
  label: String(depth),
}));

export function RasterImageSizeTool() {
  const s = strings.pro.foto["raster-image-size"];
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [channels, setChannels] = useState("3");
  const [bitDepthId, setBitDepthId] = useState("8");
  const [layers, setLayers] = useState("1");
  const [capacityValue, setCapacityValue] = useState("");
  const [capacityUnit, setCapacityUnit] = useState<CapacityUnit>("GB");
  const [averageFileSizeMb, setAverageFileSizeMb] = useState("");

  const typed = proParse(width) !== undefined || proParse(height) !== undefined;
  const capacity =
    proParse(capacityValue) === undefined
      ? undefined
      : { value: proParse(capacityValue) ?? 0, unit: capacityUnit };
  const result = rasterImageSize({
    width: proParse(width) ?? Number.NaN,
    height: proParse(height) ?? Number.NaN,
    channels: proParse(channels) ?? Number.NaN,
    bitDepth: Number(bitDepthId),
    layers: proParse(layers) ?? Number.NaN,
    capacity,
    averageFileSizeMb: proParse(averageFileSizeMb),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "width"
        ? s.errorWidth
        : result.reason === "height"
          ? s.errorHeight
          : result.reason === "channels"
            ? s.errorChannels
            : result.reason === "bitDepth"
              ? s.errorBitDepth
              : result.reason === "layers"
                ? s.errorLayers
                : result.reason === "capacity"
                  ? s.errorCapacity
                  : s.errorAverageFileSizeMb;

  const copyText = !result.ok
    ? ""
    : [
        `${s.bytes}: ${proNum(result.bytes, 0)} B`,
        `${s.megabytes}: ${proUnit(proNum(result.megabytes, 3), s.unitMb)}`,
        `${s.mebibytes}: ${proUnit(proNum(result.mebibytes, 3), s.unitMib)}`,
        `${s.gigabytes}: ${proUnit(proNum(result.gigabytes, 3), s.unitGb)}`,
        `${s.gibibytes}: ${proUnit(proNum(result.gibibytes, 3), s.unitGib)}`,
        ...(result.filesThatFit === undefined
          ? []
          : [`${s.filesThatFit}: ${proNum(result.filesThatFit, 0)}`]),
        "",
        `${s.width}: ${proNum(proParse(width) ?? 0, 0)} px`,
        `${s.height}: ${proNum(proParse(height) ?? 0, 0)} px`,
        `${s.channels}: ${proNum(proParse(channels) ?? 0, 0)}`,
        `${s.bitDepth}: ${bitDepthId} bit`,
        `${s.layers}: ${proNum(proParse(layers) ?? 0, 0)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.width} value={width} onChange={setWidth} />
      <ToolInput label={s.height} value={height} onChange={setHeight} />
      <ToolInput label={s.channels} hint={s.channelsHint} value={channels} onChange={setChannels} />
      <ToolSelect
        label={s.bitDepth}
        value={bitDepthId}
        onChange={setBitDepthId}
        options={RASTER_BIT_DEPTH_OPTIONS}
      />
      <ToolInput label={s.layers} value={layers} onChange={setLayers} />
      <ToolInput
        label={s.capacityValue}
        hint={s.capacityHint}
        value={capacityValue}
        onChange={setCapacityValue}
      />
      <ToolSelect<CapacityUnit>
        label={s.capacityUnit}
        value={capacityUnit}
        onChange={setCapacityUnit}
        options={[
          { id: "GB", label: s.unitGb },
          { id: "GiB", label: s.unitGib },
        ]}
      />
      <ToolInput
        label={s.averageFileSizeMb}
        hint={s.averageFileSizeMbHint}
        value={averageFileSizeMb}
        onChange={setAverageFileSizeMb}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.bytes} value={`${proNum(result.bytes, 0)} B`} />
          <ResultRow label={s.megabytes} value={proUnit(proNum(result.megabytes, 3), s.unitMb)} />
          <ResultRow label={s.mebibytes} value={proUnit(proNum(result.mebibytes, 3), s.unitMib)} />
          <ResultRow label={s.gigabytes} value={proUnit(proNum(result.gigabytes, 3), s.unitGb)} />
          <ResultRow label={s.gibibytes} value={proUnit(proNum(result.gibibytes, 3), s.unitGib)} />
          {result.filesThatFit !== undefined && (
            <ResultRow label={s.filesThatFit} value={proNum(result.filesThatFit, 0)} />
          )}
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.width, value: `${proNum(proParse(width) ?? 0, 0)} px` },
              { label: s.height, value: `${proNum(proParse(height) ?? 0, 0)} px` },
              { label: s.channels, value: proNum(proParse(channels) ?? 0, 0) },
              { label: s.bitDepth, value: `${bitDepthId} bit` },
              { label: s.layers, value: proNum(proParse(layers) ?? 0, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ----------------------------------------------------------- SMPTE timecode -- */

/**
 * The nine selectable rates, each carrying its own `TimecodeFormat` — a
 * lookup, not a computation. Drop-frame is one of the ten choices rather than
 * a separate toggle, which is also how the assignment states it: „29,97 NDF"
 * and „29,97 DF" are different formats, not the same format with a flag.
 */
const SMPTE_RATE_IDS = [
  "23.976",
  "24",
  "25",
  "29.97-ndf",
  "29.97-df",
  "30",
  "50",
  "59.94-ndf",
  "59.94-df",
  "60",
] as const;
type SmpteRateId = (typeof SMPTE_RATE_IDS)[number];

const SMPTE_RATE_FORMATS: Readonly<Record<SmpteRateId, TimecodeFormat>> = {
  "23.976": { nominalRate: 24, ntscPullDown: true, dropFrame: false },
  "24": { nominalRate: 24, ntscPullDown: false, dropFrame: false },
  "25": { nominalRate: 25, ntscPullDown: false, dropFrame: false },
  "29.97-ndf": { nominalRate: 30, ntscPullDown: true, dropFrame: false },
  "29.97-df": { nominalRate: 30, ntscPullDown: true, dropFrame: true },
  "30": { nominalRate: 30, ntscPullDown: false, dropFrame: false },
  "50": { nominalRate: 50, ntscPullDown: false, dropFrame: false },
  "59.94-ndf": { nominalRate: 60, ntscPullDown: true, dropFrame: false },
  "59.94-df": { nominalRate: 60, ntscPullDown: true, dropFrame: true },
  "60": { nominalRate: 60, ntscPullDown: false, dropFrame: false },
};

export function SmpteTimecodeTool() {
  const s = strings.pro.foto["smpte-timecode"];
  const [rateId, setRateId] = useState<SmpteRateId>("25");
  const [operation, setOperation] = useState<"add" | "subtract">("add");
  const [hoursA, setHoursA] = useState("");
  const [minutesA, setMinutesA] = useState("");
  const [secondsA, setSecondsA] = useState("");
  const [framesA, setFramesA] = useState("");
  const [hoursB, setHoursB] = useState("");
  const [minutesB, setMinutesB] = useState("");
  const [secondsB, setSecondsB] = useState("");
  const [framesB, setFramesB] = useState("");
  const [frameCountB, setFrameCountB] = useState("");

  const format = SMPTE_RATE_FORMATS[rateId];
  const partsA = {
    hours: proParse(hoursA) ?? Number.NaN,
    minutes: proParse(minutesA) ?? Number.NaN,
    seconds: proParse(secondsA) ?? Number.NaN,
    frames: proParse(framesA) ?? Number.NaN,
  };
  const typed = [hoursA, minutesA, secondsA, framesA].some((field) => field.trim() !== "");

  const bTimecodeTyped = [hoursB, minutesB, secondsB, framesB].some((field) => field.trim() !== "");
  const bFrameCountTyped = frameCountB.trim() !== "";
  const hasB = bTimecodeTyped || bFrameCountTyped;
  const partsB = {
    hours: proParse(hoursB) ?? Number.NaN,
    minutes: proParse(minutesB) ?? Number.NaN,
    seconds: proParse(secondsB) ?? Number.NaN,
    frames: proParse(framesB) ?? Number.NaN,
  };

  // Filling both B-as-label and B-as-frame-count at once is not refused — the
  // label wins and the frame count field is simply not read — because there
  // is no reason typed in either field to prefer one over the other.
  const operation_ = hasB
    ? timecodeOperation({
        a: partsA,
        format,
        operandTimecode: bTimecodeTyped ? partsB : undefined,
        operandFrames: bTimecodeTyped ? undefined : proParse(frameCountB),
        operation,
      })
    : undefined;
  const plainFrames = !hasB ? timecodeToFrames(partsA, format) : undefined;
  const plainSeconds = plainFrames?.ok === true ? timecodeSeconds(plainFrames.frames, format) : undefined;
  const drift = !hasB ? timecodeDrift(partsA, format) : undefined;
  const active = operation_ ?? plainFrames;

  const failure =
    active === undefined || active.ok || !typed
      ? undefined
      : active.reason === "hours"
        ? s.errorHours
        : active.reason === "minutes"
          ? s.errorMinutes
          : active.reason === "seconds"
            ? s.errorSeconds
            : active.reason === "frames"
              ? s.errorFrames
              : active.reason === "droppedLabel"
                ? s.errorDroppedLabel
                : active.reason === "operand"
                  ? s.errorOperand
                  : s.errorOperandFrames;

  const rateLabel =
    rateId === "23.976"
      ? s.rate23976
      : rateId === "24"
        ? s.rate24
        : rateId === "25"
          ? s.rate25
          : rateId === "29.97-ndf"
            ? s.rate2997Ndf
            : rateId === "29.97-df"
              ? s.rate2997Df
              : rateId === "30"
                ? s.rate30
                : rateId === "50"
                  ? s.rate50
                  : rateId === "59.94-ndf"
                    ? s.rate5994Ndf
                    : rateId === "59.94-df"
                      ? s.rate5994Df
                      : s.rate60;

  const inputEntries = [
    { label: s.rate, value: rateLabel },
    { label: s.operation, value: operation === "add" ? s.operationAdd : s.operationSubtract },
    {
      label: s.timecodeA,
      value: `${proNum(partsA.hours, 0)}:${proNum(partsA.minutes, 0)}:${proNum(partsA.seconds, 0)}:${proNum(partsA.frames, 0)}`,
    },
  ];

  const copyText =
    hasB && operation_?.ok === true
      ? [
          `${s.frames}: ${signed(operation_.frames, proNum(operation_.frames, 0))}`,
          `${s.timecodeHours}: ${proNum(operation_.timecode.hours, 0)}`,
          `${s.timecodeMinutes}: ${proNum(operation_.timecode.minutes, 0)}`,
          `${s.timecodeSeconds}: ${proNum(operation_.timecode.seconds, 0)}`,
          `${s.timecodeFrames}: ${proNum(operation_.timecode.frames, 0)}`,
          `${s.elapsedSeconds}: ${signed(operation_.elapsedSeconds, proUnit(proNum(operation_.elapsedSeconds, 4), s.unitS))}`,
          "",
          ...inputEntries.map((entry) => `${entry.label}: ${entry.value}`),
        ].join("\n")
      : !hasB && plainFrames?.ok === true
        ? [
            `${s.frames}: ${proNum(plainFrames.frames, 0)}`,
            ...(plainSeconds?.ok === true
              ? [`${s.realSeconds}: ${proUnit(proNum(plainSeconds.seconds, 4), s.unitS)}`]
              : []),
            ...(drift?.ok === true
              ? [
                  `${s.nominalSeconds}: ${proUnit(proNum(drift.nominalSeconds, 4), s.unitS)}`,
                  `${s.driftSeconds}: ${signed(drift.driftSeconds, proUnit(proNum(drift.driftSeconds, 4), s.unitS))}`,
                ]
              : []),
            "",
            ...inputEntries.map((entry) => `${entry.label}: ${entry.value}`),
          ].join("\n")
        : "";

  return (
    <>
      <ToolSelect<SmpteRateId>
        label={s.rate}
        value={rateId}
        onChange={setRateId}
        options={SMPTE_RATE_IDS.map((id) => ({
          id,
          label:
            id === "23.976"
              ? s.rate23976
              : id === "24"
                ? s.rate24
                : id === "25"
                  ? s.rate25
                  : id === "29.97-ndf"
                    ? s.rate2997Ndf
                    : id === "29.97-df"
                      ? s.rate2997Df
                      : id === "30"
                        ? s.rate30
                        : id === "50"
                          ? s.rate50
                          : id === "59.94-ndf"
                            ? s.rate5994Ndf
                            : id === "59.94-df"
                              ? s.rate5994Df
                              : s.rate60,
        }))}
      />
      <ToolSelect<"add" | "subtract">
        label={s.operation}
        value={operation}
        onChange={setOperation}
        options={[
          { id: "add", label: s.operationAdd },
          { id: "subtract", label: s.operationSubtract },
        ]}
      />

      <ToolSection title={s.timecodeA}>
        <ToolInput label={s.hours} value={hoursA} onChange={setHoursA} />
        <ToolInput label={s.minutes} value={minutesA} onChange={setMinutesA} />
        <ToolInput label={s.seconds} value={secondsA} onChange={setSecondsA} />
        <ToolInput label={s.frames} value={framesA} onChange={setFramesA} />
      </ToolSection>

      <ToolSection title={s.timecodeB}>
        <p className="nx-hint nx-hint--prose">{s.timecodeBHint}</p>
        <ToolInput label={s.hours} value={hoursB} onChange={setHoursB} />
        <ToolInput label={s.minutes} value={minutesB} onChange={setMinutesB} />
        <ToolInput label={s.seconds} value={secondsB} onChange={setSecondsB} />
        <ToolInput label={s.frames} value={framesB} onChange={setFramesB} />
        <ToolInput label={s.frameCountB} value={frameCountB} onChange={setFrameCountB} />
      </ToolSection>

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {hasB && operation_?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.frames} value={signed(operation_.frames, proNum(operation_.frames, 0))} />
          <ResultRow label={s.timecodeHours} value={proNum(operation_.timecode.hours, 0)} />
          <ResultRow label={s.timecodeMinutes} value={proNum(operation_.timecode.minutes, 0)} />
          <ResultRow label={s.timecodeSeconds} value={proNum(operation_.timecode.seconds, 0)} />
          <ResultRow label={s.timecodeFrames} value={proNum(operation_.timecode.frames, 0)} />
          <ResultRow
            label={s.elapsedSeconds}
            value={signed(
              operation_.elapsedSeconds,
              proUnit(proNum(operation_.elapsedSeconds, 4), s.unitS),
            )}
          />
          <p className="nx-hint nx-hint--prose">{s.wrapNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={inputEntries} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      {!hasB && plainFrames?.ok === true && (
        <ToolSection title={s.results}>
          <ResultRow label={s.frames} value={proNum(plainFrames.frames, 0)} />
          {plainSeconds?.ok === true && (
            <ResultRow
              label={s.realSeconds}
              value={proUnit(proNum(plainSeconds.seconds, 4), s.unitS)}
            />
          )}
          {drift?.ok === true && (
            <>
              <ResultRow
                label={s.nominalSeconds}
                value={proUnit(proNum(drift.nominalSeconds, 4), s.unitS)}
              />
              <ResultRow
                label={s.driftSeconds}
                value={signed(
                  drift.driftSeconds,
                  proUnit(proNum(drift.driftSeconds, 4), s.unitS),
                )}
              />
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={inputEntries} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* --------------------------------------------------------- timelapse planner -- */

const TIMELAPSE_FPS_IDS = ["23.976", "24", "25", "29.97", "30", "50", "59.94", "60"] as const;
type TimelapseFpsId = (typeof TIMELAPSE_FPS_IDS)[number];

export function TimelapsePlannerTool() {
  const s = strings.pro.foto["timelapse-planner"];
  const [interval, setInterval_] = useState("");
  const [fpsId, setFpsId] = useState<TimelapseFpsId>("25");
  const [clipLength, setClipLength] = useState("");
  const [shootingDuration, setShootingDuration] = useState("");
  const [frameCount, setFrameCount] = useState("");
  const [shutter, setShutter] = useState("");

  const typed =
    proParse(interval) !== undefined ||
    proParse(clipLength) !== undefined ||
    proParse(shootingDuration) !== undefined ||
    proParse(frameCount) !== undefined;
  const plan = timelapsePlan({
    interval: proParse(interval) ?? Number.NaN,
    timelineFps: Number(fpsId),
    clipLength: proParse(clipLength),
    shootingDuration: proParse(shootingDuration),
    frameCount: proParse(frameCount),
    shutter: shutter.trim() === "" ? undefined : shutterOf(shutter),
  });

  const failure =
    plan.ok || !typed
      ? undefined
      : plan.reason === "interval"
        ? s.errorInterval
        : plan.reason === "clipLength"
          ? s.errorClipLength
          : plan.reason === "shootingDuration"
            ? s.errorShootingDuration
            : plan.reason === "frameCount"
              ? s.errorFrameCount
              : plan.reason === "shutter"
                ? s.errorShutter
                : s.errorTarget;

  const copyText = !plan.ok
    ? ""
    : [
        `${s.frameCount}: ${proNum(plan.frameCount, 0)}`,
        `${s.shootingDuration}: ${proUnit(proNum(plan.shootingDuration, 3), s.unitS)}`,
        `${s.clipLength}: ${proUnit(proNum(plan.clipLength, 3), s.unitS)}`,
        `${s.speedUpFactor}: ${proNum(plan.speedUpFactor, 1)}×`,
        ...(plan.shutterOverIntervalRatio === undefined
          ? []
          : [`${s.shutterOverIntervalRatio}: ${proNum(plan.shutterOverIntervalRatio, 3)}`]),
        "",
        `${s.interval}: ${proUnit(proNum(proParse(interval) ?? 0, 3), s.unitS)}`,
        `${s.fps}: ${fpsId}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.interval} value={interval} onChange={setInterval_} />
      <ToolSelect<TimelapseFpsId>
        label={s.fps}
        value={fpsId}
        onChange={setFpsId}
        options={TIMELAPSE_FPS_IDS.map((id) => ({ id, label: id }))}
      />
      <ToolInput
        label={s.clipLength}
        hint={s.targetHint}
        value={clipLength}
        onChange={setClipLength}
      />
      <ToolInput label={s.shootingDuration} value={shootingDuration} onChange={setShootingDuration} />
      <ToolInput label={s.frameCount} value={frameCount} onChange={setFrameCount} />
      <ToolInput label={s.shutter} hint={s.shutterHint} value={shutter} onChange={setShutter} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {plan.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.frameCount} value={proNum(plan.frameCount, 0)} />
          <ResultRow
            label={s.shootingDuration}
            value={proUnit(proNum(plan.shootingDuration, 3), s.unitS)}
          />
          <ResultRow label={s.clipLength} value={proUnit(proNum(plan.clipLength, 3), s.unitS)} />
          <ResultRow label={s.speedUpFactor} value={`${proNum(plan.speedUpFactor, 1)}×`} />
          {plan.shutterOverIntervalRatio !== undefined && (
            <ResultRow
              label={s.shutterOverIntervalRatio}
              value={proNum(plan.shutterOverIntervalRatio, 3)}
            />
          )}
          <p className="nx-hint nx-hint--prose">{s.fencepostNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.interval, value: proUnit(proNum(proParse(interval) ?? 0, 3), s.unitS) },
              { label: s.fps, value: fpsId },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ------------------------------------------------- video bitrate and storage -- */

export function VideoBitrateStorageTool() {
  const s = strings.pro.foto["video-bitrate-storage"];
  const [videoBitrateMbps, setVideoBitrateMbps] = useState("");
  const [audioBitrateMbps, setAudioBitrateMbps] = useState("0");
  const [duration, setDuration] = useState("");
  const [sizeValue, setSizeValue] = useState("");
  const [sizeUnit, setSizeUnit] = useState<CapacityUnit>("GB");
  const [capacityGb, setCapacityGb] = useState("");
  const [cardCount, setCardCount] = useState("1");

  const typed =
    proParse(videoBitrateMbps) !== undefined ||
    proParse(duration) !== undefined ||
    proParse(sizeValue) !== undefined ||
    proParse(capacityGb) !== undefined;
  const size =
    proParse(sizeValue) === undefined ? undefined : { value: proParse(sizeValue) ?? 0, unit: sizeUnit };
  const storage = videoStorage({
    videoBitrateMbps: proParse(videoBitrateMbps) ?? Number.NaN,
    audioBitrateMbps: proParse(audioBitrateMbps),
    duration: proParse(duration),
    size,
    capacityGb: proParse(capacityGb),
    cardCount: proParse(cardCount),
  });

  const failure =
    storage.ok || !typed
      ? undefined
      : storage.reason === "videoBitrateMbps"
        ? s.errorVideoBitrateMbps
        : storage.reason === "audioBitrateMbps"
          ? s.errorAudioBitrateMbps
          : storage.reason === "cardCount"
            ? s.errorCardCount
            : storage.reason === "duration"
              ? s.errorDuration
              : storage.reason === "size"
                ? s.errorSize
                : storage.reason === "capacityGb"
                  ? s.errorCapacityGb
                  : s.errorTarget;

  const copyText = !storage.ok
    ? ""
    : [
        `${s.totalBitrateMbps}: ${proUnit(proNum(storage.totalBitrateMbps, 3), s.unitMbps)}`,
        `${s.duration}: ${proUnit(proNum(storage.duration, 3), s.unitS)}`,
        `${s.gigabytes}: ${proUnit(proNum(storage.gigabytes, 3), s.unitGb)}`,
        `${s.gibibytes}: ${proUnit(proNum(storage.gibibytes, 3), s.unitGib)}`,
        ...(storage.recordable === undefined
          ? []
          : [
              `${s.recordableSecondsPerCard}: ${proUnit(proNum(storage.recordable.perCardSeconds, 3), s.unitS)}`,
              `${s.recordableSecondsTotal}: ${proUnit(proNum(storage.recordable.totalSeconds, 3), s.unitS)}`,
            ]),
        "",
        `${s.videoBitrateMbps}: ${proUnit(proNum(proParse(videoBitrateMbps) ?? 0, 2), s.unitMbps)}`,
        `${s.audioBitrateMbps}: ${proUnit(proNum(proParse(audioBitrateMbps) ?? 0, 2), s.unitMbps)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.videoBitrateMbps} value={videoBitrateMbps} onChange={setVideoBitrateMbps} />
      <ToolInput label={s.audioBitrateMbps} value={audioBitrateMbps} onChange={setAudioBitrateMbps} />
      <ToolInput label={s.duration} hint={s.targetHint} value={duration} onChange={setDuration} />
      <ToolInput label={s.sizeValue} value={sizeValue} onChange={setSizeValue} />
      <ToolSelect<CapacityUnit>
        label={s.sizeUnit}
        value={sizeUnit}
        onChange={setSizeUnit}
        options={[
          { id: "GB", label: s.unitGb },
          { id: "GiB", label: s.unitGib },
        ]}
      />
      <ToolInput label={s.capacityGb} value={capacityGb} onChange={setCapacityGb} />
      <ToolInput label={s.cardCount} value={cardCount} onChange={setCardCount} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {storage.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.totalBitrateMbps}
            value={proUnit(proNum(storage.totalBitrateMbps, 3), s.unitMbps)}
          />
          <ResultRow label={s.duration} value={proUnit(proNum(storage.duration, 3), s.unitS)} />
          <ResultRow label={s.gigabytes} value={proUnit(proNum(storage.gigabytes, 3), s.unitGb)} />
          <ResultRow label={s.gibibytes} value={proUnit(proNum(storage.gibibytes, 3), s.unitGib)} />
          {storage.recordable !== undefined && (
            <>
              <ResultRow
                label={s.recordableSecondsPerCard}
                value={proUnit(proNum(storage.recordable.perCardSeconds, 3), s.unitS)}
              />
              <ResultRow
                label={s.recordableSecondsTotal}
                value={proUnit(proNum(storage.recordable.totalSeconds, 3), s.unitS)}
              />
            </>
          )}
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.videoBitrateMbps,
                value: proUnit(proNum(proParse(videoBitrateMbps) ?? 0, 2), s.unitMbps),
              },
              {
                label: s.audioBitrateMbps,
                value: proUnit(proNum(proParse(audioBitrateMbps) ?? 0, 2), s.unitMbps),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* ---------------------------------------------------------- depth of field -- */

export function DepthOfFieldTool() {
  const s = strings.pro.foto["depth-of-field"];
  const [focalLength, setFocalLength] = useState("");
  const [fNumber, setFNumber] = useState("");
  const [focusDistance, setFocusDistance] = useState("");
  const [circleOfConfusion, setCircleOfConfusion] = useState("");
  const [helperDiagonal, setHelperDiagonal] = useState("");
  const [helperDivisor, setHelperDivisor] = useState("");

  const typed =
    proParse(focalLength) !== undefined ||
    proParse(fNumber) !== undefined ||
    proParse(focusDistance) !== undefined ||
    proParse(circleOfConfusion) !== undefined;
  const dof = depthOfField({
    focalLength: proParse(focalLength) ?? Number.NaN,
    fNumber: proParse(fNumber) ?? Number.NaN,
    focusDistance: proParse(focusDistance) ?? Number.NaN,
    circleOfConfusion: proParse(circleOfConfusion) ?? Number.NaN,
  });

  const failure =
    dof.ok || !typed
      ? undefined
      : dof.reason === "focalLength"
        ? s.errorFocalLength
        : dof.reason === "fNumber"
          ? s.errorFNumber
          : dof.reason === "circleOfConfusion"
            ? s.errorCircleOfConfusion
            : s.errorFocusDistance;

  // The helper is independent of the main answer: it only ever SUGGESTS a
  // circle of confusion for the field above, which stays typed by hand — see
  // `circleOfConfusionFromDiagonal`'s own doc comment for why it is not wired
  // in automatically.
  const helperTyped = proParse(helperDiagonal) !== undefined && proParse(helperDivisor) !== undefined;
  const helperResult = helperTyped
    ? circleOfConfusionFromDiagonal(
        proParse(helperDiagonal) ?? Number.NaN,
        proParse(helperDivisor) ?? Number.NaN,
      )
    : undefined;
  const helperFailure =
    helperResult === undefined || helperResult.ok
      ? undefined
      : helperResult.reason === "sensorDiagonal"
        ? s.errorHelperDiagonal
        : s.errorHelperDivisor;

  const copyText = !dof.ok
    ? ""
    : [
        `${s.hyperfocal}: ${proUnit(proNum(dof.hyperfocal, 3), s.unitM)}`,
        `${s.nearLimit}: ${proUnit(proNum(dof.nearLimit, 3), s.unitM)}`,
        `${s.farLimit}: ${dof.farLimit === undefined ? s.infinite : proUnit(proNum(dof.farLimit, 3), s.unitM)}`,
        `${s.totalDepth}: ${dof.totalDepth === undefined ? s.infinite : proUnit(proNum(dof.totalDepth, 3), s.unitM)}`,
        "",
        `${s.focalLength}: ${proUnit(proNum(proParse(focalLength) ?? 0, 1), s.unitMm)}`,
        `${s.fNumber}: f/${proNum(proParse(fNumber) ?? 0, 2)}`,
        `${s.focusDistance}: ${proUnit(proNum(proParse(focusDistance) ?? 0, 3), s.unitM)}`,
        `${s.circleOfConfusion}: ${proUnit(proNum(proParse(circleOfConfusion) ?? 0, 4), s.unitMm)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.focalLength} value={focalLength} onChange={setFocalLength} />
      <ToolInput label={s.fNumber} value={fNumber} onChange={setFNumber} />
      <ToolInput label={s.focusDistance} value={focusDistance} onChange={setFocusDistance} />
      <ToolInput
        label={s.circleOfConfusion}
        hint={s.circleOfConfusionHint}
        value={circleOfConfusion}
        onChange={setCircleOfConfusion}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {dof.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.hyperfocal} value={proUnit(proNum(dof.hyperfocal, 3), s.unitM)} />
          <ResultRow label={s.nearLimit} value={proUnit(proNum(dof.nearLimit, 3), s.unitM)} />
          <ResultRow
            label={s.farLimit}
            value={dof.farLimit === undefined ? s.infinite : proUnit(proNum(dof.farLimit, 3), s.unitM)}
          />
          <ResultRow
            label={s.totalDepth}
            value={
              dof.totalDepth === undefined ? s.infinite : proUnit(proNum(dof.totalDepth, 3), s.unitM)
            }
          />
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.focalLength, value: proUnit(proNum(proParse(focalLength) ?? 0, 1), s.unitMm) },
              { label: s.fNumber, value: `f/${proNum(proParse(fNumber) ?? 0, 2)}` },
              {
                label: s.focusDistance,
                value: proUnit(proNum(proParse(focusDistance) ?? 0, 3), s.unitM),
              },
              {
                label: s.circleOfConfusion,
                value: proUnit(proNum(proParse(circleOfConfusion) ?? 0, 4), s.unitMm),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}

      <ToolSection title={s.helperTitle}>
        <p className="nx-hint nx-hint--prose">{s.helperHint}</p>
        <ToolInput label={s.helperDiagonal} value={helperDiagonal} onChange={setHelperDiagonal} />
        <ToolInput label={s.helperDivisor} value={helperDivisor} onChange={setHelperDivisor} />
        {helperFailure !== undefined && <ToolFailure>{helperFailure}</ToolFailure>}
        {helperResult?.ok === true && (
          <ResultRow
            label={s.helperResult}
            value={proUnit(proNum(helperResult.circleOfConfusion, 4), s.unitMm)}
          />
        )}
      </ToolSection>
    </>
  );
}

/* ------------------------------------------------------- diffraction limit -- */

export function DiffractionLimitTool() {
  const s = strings.pro.foto["diffraction-limit"];
  const [fNumber, setFNumber] = useState("");
  const [wavelengthNm, setWavelengthNm] = useState(proNum(GREEN_WAVELENGTH_NM, 0));
  const [sensorWidth, setSensorWidth] = useState("");
  const [pixelCount, setPixelCount] = useState("");

  const typed =
    proParse(fNumber) !== undefined ||
    proParse(sensorWidth) !== undefined ||
    proParse(pixelCount) !== undefined;
  const diffraction = diffractionLimit({
    fNumber: proParse(fNumber) ?? Number.NaN,
    wavelengthNm: proParse(wavelengthNm) ?? Number.NaN,
    sensorWidth: proParse(sensorWidth) ?? Number.NaN,
    pixelCount: proParse(pixelCount) ?? Number.NaN,
  });

  const failure =
    diffraction.ok || !typed
      ? undefined
      : diffraction.reason === "fNumber"
        ? s.errorFNumber
        : diffraction.reason === "wavelengthNm"
          ? s.errorWavelengthNm
          : diffraction.reason === "sensorWidth"
            ? s.errorSensorWidth
            : s.errorPixelCount;

  const copyText = !diffraction.ok
    ? ""
    : [
        `${s.pixelPitch}: ${proUnit(proNum(diffraction.pixelPitch, 3), s.unitUm)}`,
        `${s.airyDiameter}: ${proUnit(proNum(diffraction.airyDiameter, 3), s.unitUm)}`,
        `${s.ratio}: ${proNum(diffraction.ratio, 2)}`,
        `${s.fNumberAtOnePitch}: f/${proNum(diffraction.fNumberAtOnePitch, 2)}`,
        "",
        `${s.fNumber}: f/${proNum(proParse(fNumber) ?? 0, 1)}`,
        `${s.wavelengthNm}: ${proUnit(proNum(proParse(wavelengthNm) ?? 0, 0), s.unitNm)}`,
        `${s.sensorWidth}: ${proUnit(proNum(proParse(sensorWidth) ?? 0, 1), s.unitMm)}`,
        `${s.pixelCount}: ${proNum(proParse(pixelCount) ?? 0, 0)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.fNumber} value={fNumber} onChange={setFNumber} />
      <ToolInput
        label={s.wavelengthNm}
        hint={s.wavelengthNmHint}
        value={wavelengthNm}
        onChange={setWavelengthNm}
      />
      <ToolInput label={s.sensorWidth} value={sensorWidth} onChange={setSensorWidth} />
      <ToolInput label={s.pixelCount} value={pixelCount} onChange={setPixelCount} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {diffraction.ok && (
        <ToolSection title={s.results}>
          <ResultRow
            label={s.pixelPitch}
            value={proUnit(proNum(diffraction.pixelPitch, 3), s.unitUm)}
          />
          <ResultRow
            label={s.airyDiameter}
            value={proUnit(proNum(diffraction.airyDiameter, 3), s.unitUm)}
          />
          <ResultRow label={s.ratio} value={proNum(diffraction.ratio, 2)} />
          <ResultRow
            label={s.fNumberAtOnePitch}
            value={`f/${proNum(diffraction.fNumberAtOnePitch, 2)}`}
          />
          <p className="nx-hint nx-hint--prose">{s.modelNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.fNumber, value: `f/${proNum(proParse(fNumber) ?? 0, 1)}` },
              {
                label: s.wavelengthNm,
                value: proUnit(proNum(proParse(wavelengthNm) ?? 0, 0), s.unitNm),
              },
              {
                label: s.sensorWidth,
                value: proUnit(proNum(proParse(sensorWidth) ?? 0, 1), s.unitMm),
              },
              { label: s.pixelCount, value: proNum(proParse(pixelCount) ?? 0, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------- crop factor -- */

export function CropFactorTool() {
  const s = strings.pro.foto["crop-factor"];
  const [sensorWidth, setSensorWidth] = useState("");
  const [sensorHeight, setSensorHeight] = useState("");
  const [focalLength, setFocalLength] = useState("");
  const [fNumber, setFNumber] = useState("");

  const typed = proParse(sensorWidth) !== undefined || proParse(sensorHeight) !== undefined;
  const crop = cropFactor({
    sensorWidth: proParse(sensorWidth) ?? Number.NaN,
    sensorHeight: proParse(sensorHeight) ?? Number.NaN,
    focalLength: proParse(focalLength),
    fNumber: proParse(fNumber),
  });

  const failure =
    crop.ok || !typed
      ? undefined
      : crop.reason === "sensorWidth"
        ? s.errorSensorWidth
        : crop.reason === "sensorHeight"
          ? s.errorSensorHeight
          : crop.reason === "focalLength"
            ? s.errorFocalLength
            : s.errorFNumber;

  const copyText = !crop.ok
    ? ""
    : [
        `${s.cropFactor}: ${proNum(crop.cropFactor, 4)}`,
        `${s.sensorDiagonal}: ${proUnit(proNum(crop.sensorDiagonal, 4), s.unitMm)}`,
        ...(crop.equivalentFocalLength === undefined
          ? []
          : [
              `${s.equivalentFocalLength}: ${proUnit(proNum(crop.equivalentFocalLength, 2), s.unitMm)}`,
            ]),
        ...(crop.equivalentAperture === undefined
          ? []
          : [`${s.equivalentAperture}: f/${proNum(crop.equivalentAperture, 2)}`]),
        "",
        `${s.sensorWidth}: ${proUnit(proNum(proParse(sensorWidth) ?? 0, 1), s.unitMm)}`,
        `${s.sensorHeight}: ${proUnit(proNum(proParse(sensorHeight) ?? 0, 1), s.unitMm)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.sensorWidth} value={sensorWidth} onChange={setSensorWidth} />
      <ToolInput label={s.sensorHeight} value={sensorHeight} onChange={setSensorHeight} />
      <ToolInput
        label={s.focalLength}
        hint={s.focalLengthHint}
        value={focalLength}
        onChange={setFocalLength}
      />
      <ToolInput
        label={s.fNumber}
        hint={s.fNumberHint}
        value={fNumber}
        onChange={setFNumber}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {crop.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.cropFactor} value={proNum(crop.cropFactor, 4)} />
          <ResultRow
            label={s.sensorDiagonal}
            value={proUnit(proNum(crop.sensorDiagonal, 4), s.unitMm)}
          />
          {crop.equivalentFocalLength !== undefined && (
            <ResultRow
              label={s.equivalentFocalLength}
              value={proUnit(proNum(crop.equivalentFocalLength, 2), s.unitMm)}
            />
          )}
          {crop.equivalentAperture !== undefined && (
            <>
              <ResultRow
                label={s.equivalentAperture}
                value={`f/${proNum(crop.equivalentAperture, 2)}`}
              />
              <p className="nx-hint nx-hint--prose">{s.apertureNote}</p>
            </>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.sensorWidth,
                value: proUnit(proNum(proParse(sensorWidth) ?? 0, 1), s.unitMm),
              },
              {
                label: s.sensorHeight,
                value: proUnit(proNum(proParse(sensorHeight) ?? 0, 1), s.unitMm),
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------- equivalent exposure -- */

export function ExposureEquivalentTool() {
  const s = strings.pro.foto["exposure-equivalent"];
  const [n1, setN1] = useState("");
  const [t1, setT1] = useState("");
  const [s1, setS1] = useState("");
  const [n2, setN2] = useState("");
  const [t2, setT2] = useState("");
  const [s2, setS2] = useState("");

  const typed = [n1, t1, s1, n2, t2, s2].some((field) => field.trim() !== "");
  const solved = exposureSolve({
    reference: {
      fNumber: proParse(n1) ?? Number.NaN,
      shutter: shutterOf(t1),
      iso: proParse(s1) ?? Number.NaN,
    },
    targetFNumber: proParse(n2),
    targetShutter: t2.trim() === "" ? undefined : shutterOf(t2),
    targetIso: proParse(s2),
  });

  const failure =
    solved.ok || !typed
      ? undefined
      : solved.reason === "referenceFNumber"
        ? s.errorReferenceFNumber
        : solved.reason === "referenceShutter"
          ? s.errorReferenceShutter
          : solved.reason === "referenceIso"
            ? s.errorReferenceIso
            : solved.reason === "targetFNumber"
              ? s.errorTargetFNumber
              : solved.reason === "targetShutter"
                ? s.errorTargetShutter
                : solved.reason === "targetIso"
                  ? s.errorTargetIso
                  : s.errorTargets;

  const solvedFieldLabel = !solved.ok
    ? ""
    : solved.solvedField === "fNumber"
      ? s.n2
      : solved.solvedField === "shutter"
        ? s.t2
        : s.s2;

  const copyText = !solved.ok
    ? ""
    : [
        `${s.solvedField}: ${solvedFieldLabel}`,
        `${s.n2}: f/${proNum(solved.target.fNumber, 2)}`,
        `${s.t2}: ${proNum(solved.target.shutter, 6)} ${s.unitS} (1/${proNum(solved.targetShutterDenominator, 2)})`,
        `${s.s2}: ${proNum(solved.target.iso, 0)}`,
        `${s.referenceEv100}: ${proNum(solved.referenceEv100, 3)}`,
        `${s.targetEv100}: ${proNum(solved.targetEv100, 3)}`,
        `${s.givenShiftStops}: ${signed(solved.givenShiftStops, proNum(solved.givenShiftStops, 3))}`,
        "",
        `${s.n1}: f/${proNum(proParse(n1) ?? 0, 2)}`,
        `${s.t1}: ${t1.trim()}`,
        `${s.s1}: ${proNum(proParse(s1) ?? 0, 0)}`,
        `${s.n2}: ${n2.trim() === "" ? s.solvedMarker : `f/${proNum(proParse(n2) ?? 0, 2)}`}`,
        `${s.t2}: ${t2.trim() === "" ? s.solvedMarker : t2.trim()}`,
        `${s.s2}: ${s2.trim() === "" ? s.solvedMarker : proNum(proParse(s2) ?? 0, 0)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.n1} value={n1} onChange={setN1} />
      <ToolInput label={s.t1} hint={s.shutterHint} value={t1} onChange={setT1} />
      <ToolInput label={s.s1} value={s1} onChange={setS1} />
      <ToolInput label={s.n2} hint={s.targetHint} value={n2} onChange={setN2} />
      <ToolInput label={s.t2} value={t2} onChange={setT2} />
      <ToolInput label={s.s2} value={s2} onChange={setS2} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {solved.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.solvedField} value={solvedFieldLabel} />
          <ResultRow label={s.n2} value={`f/${proNum(solved.target.fNumber, 2)}`} />
          <ResultRow
            label={s.t2}
            value={`${proNum(solved.target.shutter, 6)} ${s.unitS} (1/${proNum(solved.targetShutterDenominator, 2)})`}
          />
          <ResultRow label={s.s2} value={proNum(solved.target.iso, 0)} />
          <ResultRow label={s.referenceEv100} value={proNum(solved.referenceEv100, 3)} />
          <ResultRow label={s.targetEv100} value={proNum(solved.targetEv100, 3)} />
          <ResultRow
            label={s.givenShiftStops}
            value={signed(solved.givenShiftStops, proNum(solved.givenShiftStops, 3))}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.n1, value: `f/${proNum(proParse(n1) ?? 0, 2)}` },
              { label: s.t1, value: t1.trim() },
              { label: s.s1, value: proNum(proParse(s1) ?? 0, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const FOTO_SURFACES: Readonly<Record<string, ComponentType>> = {
  "angle-of-view": AngleOfViewTool,
  "crop-factor": CropFactorTool,
  "depth-of-field": DepthOfFieldTool,
  "diffraction-limit": DiffractionLimitTool,
  "exposure-equivalent": ExposureEquivalentTool,
  "flash-guide-number": FlashGuideNumberTool,
  "frame-rate-conform": FrameRateConformTool,
  "illuminance-to-aperture": IlluminanceToApertureTool,
  "mired-shift": MiredShiftTool,
  "motion-blur": MotionBlurTool,
  "nd-filter-exposure": NdFilterExposureTool,
  "pq-nits": PqNitsTool,
  "raster-image-size": RasterImageSizeTool,
  "smpte-timecode": SmpteTimecodeTool,
  "timelapse-planner": TimelapsePlannerTool,
  "video-bitrate-storage": VideoBitrateStorageTool,
};
