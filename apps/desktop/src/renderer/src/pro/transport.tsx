import {
  chargeableWeight,
  costPerKm,
  drivingSchedule,
  etaWithBreaks,
  fuelConsumption,
  gearRoadSpeed,
  grossMassAndPayload,
  lashingForce,
  loadingSpaceUtilisation,
  palletLoadPlan,
  reeferFuelUse,
  rigidAxleLoads,
  rigidAxleTargetDistance,
  serviceInterval,
  tankVolumeByLevel,
  tractorSemitrailerLoads,
  tractorSemitrailerTargetDistance,
  tripCostQuote,
  tyreChangeDeviation,
  cargoCentreOfGravity,
  DIESEL_DENSITY_15C,
  AUS32_DENSITY_20C,
  PALLET_FOOTPRINTS,
  type CivilDate,
  type DrivingBlockKind,
  type LashingDirection,
  type MassAtDistance,
  type PalletLayout,
  type MassMode,
  type LashingMethod,
  type MarginMethod,
  type TankShape,
} from "@nexus/core/pro/transport";
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
 * „Transport i logistika" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/transport.ts`'s. This file parses fields
 * with `proParse`, splits list inputs into rows, hands both to the core
 * functions, and prints what comes back — it never divides, rounds or compares.
 *
 * **Half of this pack is `life-safety`.** Every limit in it — axle limits,
 * gross-mass limits, the securing standard's coefficients, the driving-hours
 * limits — is a field the user types, with no default and no fallback. What a
 * `life-safety` tool here shows beside such a field is a computed quantity and
 * a ratio (`ToolAgainstLimit`), never a word about what the pair means.
 */

/** One comma-separated row, parsed cell by cell with `proParse`. */
function parseRowN(line: string, fields: number): readonly (number | undefined)[] {
  const cells = line.split(",");
  const out: (number | undefined)[] = [];
  for (let i = 0; i < fields; i += 1) out.push(proParse(cells[i] ?? ""));
  return out;
}

/** One line of „masa kg, rastojanje m" — or any other two-number row. */
function parseRow2(line: string): readonly [number | undefined, number | undefined] {
  const [a, b] = parseRowN(line, 2);
  return [a, b];
}

/** A percentage field read as the decimal fraction the core functions take. */
function pct(text: string): number | undefined {
  const value = proParse(text);
  return value === undefined ? undefined : value / 100;
}

/** „h:mm" read as whole minutes — the drawer's one clock-field parse. */
function parseHm(text: string): number | undefined {
  const parts = text.trim().split(":");
  if (parts.length !== 2) return undefined;
  const hours = proParse(parts[0] ?? "");
  const minutes = proParse(parts[1] ?? "");
  if (hours === undefined || minutes === undefined) return undefined;
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return undefined;
  }
  return hours * 60 + minutes;
}

/** The inverse of `parseHm`, for a printed clock or a duration — never a computed answer. */
function fmtHm(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return "—";
  const sign = totalMinutes < 0 ? "−" : "";
  const abs = Math.round(Math.abs(totalMinutes));
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `${sign}${hours}:${minutes.toString().padStart(2, "0")}`;
}

/** A minute count from departure-day midnight, shown as a clock plus a day offset. */
function clockLabel(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return "—";
  const dayOffset = Math.floor(totalMinutes / MIN_PER_DAY_UI);
  const minuteOfDay = totalMinutes - dayOffset * MIN_PER_DAY_UI;
  return dayOffset === 0 ? fmtHm(minuteOfDay) : `${fmtHm(minuteOfDay)} (+${dayOffset} d.)`;
}

const MIN_PER_DAY_UI = 1440;

/** „DD.MM.GGGG" read as a `CivilDate` — the drawer's one calendar-field parse. */
function parseDate(text: string): CivilDate | undefined {
  const parts = text.trim().split(".");
  if (parts.length < 3) return undefined;
  const day = proParse(parts[0] ?? "");
  const month = proParse(parts[1] ?? "");
  const year = proParse(parts[2] ?? "");
  if (day === undefined || month === undefined || year === undefined) return undefined;
  if (![day, month, year].every((value) => Number.isInteger(value))) return undefined;
  return { day, month, year };
}

/** The inverse of `parseDate` — presentation only, never a computed answer. */
function fmtDate(date: CivilDate): string {
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return `${pad(date.day)}.${pad(date.month)}.${date.year}.`;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getDate().toString().padStart(2, "0")}.${(now.getMonth() + 1).toString().padStart(2, "0")}.${now.getFullYear()}`;
}

/** Cargo rows for the two axle-load modes: mass and distance, one per line. */
function parseMassDistanceRows(text: string): readonly MassAtDistance[] {
  const rows: MassAtDistance[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const [mass, distance] = parseRow2(trimmed);
    if (mass === undefined || distance === undefined) continue;
    rows.push({ mass, distance });
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Osovinsko opterećenje — axle load distribution (life-safety)                */
/* -------------------------------------------------------------------------- */

type AxleMode = "rigid" | "tractor";

export function AxleLoadDistributionTool() {
  const s = strings.pro.transport["axle-load-distribution"];
  const [mode, setMode] = useState<AxleMode>("rigid");
  const [wheelbase, setWheelbase] = useState("");
  const [emptyFront, setEmptyFront] = useState("");
  const [emptyRear, setEmptyRear] = useState("");
  const [items, setItems] = useState("");
  const [fifthWheel, setFifthWheel] = useState("3,20");
  const [kingpinToBogie, setKingpinToBogie] = useState("7,60");
  const [trailerTare, setTrailerTare] = useState("");
  const [trailerTareCentre, setTrailerTareCentre] = useState("");
  const [frontLimit, setFrontLimit] = useState("");
  const [rearLimit, setRearLimit] = useState("");
  const [bogieLimit, setBogieLimit] = useState("");
  const [totalLimit, setTotalLimit] = useState("");
  const [itemIndex, setItemIndex] = useState("");
  const [targetRear, setTargetRear] = useState("");

  const rows = parseMassDistanceRows(items);
  const typed =
    proParse(wheelbase) !== undefined ||
    proParse(emptyFront) !== undefined ||
    proParse(emptyRear) !== undefined ||
    rows.length > 0;

  const rigid = rigidAxleLoads({
    wheelbase: proParse(wheelbase) ?? Number.NaN,
    emptyFront: proParse(emptyFront) ?? Number.NaN,
    emptyRear: proParse(emptyRear) ?? Number.NaN,
    items: rows,
    frontLimit: proParse(frontLimit),
    rearLimit: proParse(rearLimit),
    totalLimit: proParse(totalLimit),
  });
  const tractor = tractorSemitrailerLoads({
    tractorWheelbase: proParse(wheelbase) ?? Number.NaN,
    fifthWheelFromFrontAxle: proParse(fifthWheel) ?? Number.NaN,
    emptyFront: proParse(emptyFront) ?? Number.NaN,
    emptyDrive: proParse(emptyRear) ?? Number.NaN,
    kingpinToBogie: proParse(kingpinToBogie) ?? Number.NaN,
    trailerTare: proParse(trailerTare) ?? Number.NaN,
    trailerTareCentre: proParse(trailerTareCentre) ?? Number.NaN,
    items: rows,
    frontLimit: proParse(frontLimit),
    driveLimit: proParse(rearLimit),
    bogieLimit: proParse(bogieLimit),
    totalLimit: proParse(totalLimit),
  });
  const result = mode === "rigid" ? rigid : tractor;

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "wheelbase"
        ? s.errorWheelbase
        : result.reason === "emptyFront"
          ? s.errorEmptyFront
          : result.reason === "emptyRear" || result.reason === "emptyDrive"
            ? s.errorEmptyRear
            : result.reason === "items"
              ? s.errorItems
              : result.reason === "kingpinToBogie"
                ? s.errorKingpinToBogie
                : result.reason === "trailerTare"
                  ? s.errorTrailerTare
                  : result.reason === "trailerTareCentre"
                    ? s.errorTrailerTareCentre
                    : s.errorFifthWheel;

  // The reverse solve: at which distance would the chosen row give the
  // rear/bogie load the user is aiming at. Only attempted once an item index
  // and a target are typed — it is an extra question, not the main answer.
  const targetIndex = (proParse(itemIndex) ?? 0) - 1;
  const targetTyped = proParse(itemIndex) !== undefined && proParse(targetRear) !== undefined;
  const rigidTarget = rigidAxleTargetDistance({
    wheelbase: proParse(wheelbase) ?? Number.NaN,
    emptyFront: proParse(emptyFront) ?? Number.NaN,
    emptyRear: proParse(emptyRear) ?? Number.NaN,
    items: rows,
    itemIndex: targetIndex,
    targetRear: proParse(targetRear) ?? Number.NaN,
  });
  const tractorTarget = tractorSemitrailerTargetDistance({
    kingpinToBogie: proParse(kingpinToBogie) ?? Number.NaN,
    trailerTare: proParse(trailerTare) ?? Number.NaN,
    trailerTareCentre: proParse(trailerTareCentre) ?? Number.NaN,
    items: rows,
    itemIndex: targetIndex,
    targetBogie: proParse(targetRear) ?? Number.NaN,
    tractorWheelbase: proParse(wheelbase) ?? Number.NaN,
    fifthWheelFromFrontAxle: proParse(fifthWheel) ?? Number.NaN,
    emptyFront: proParse(emptyFront) ?? Number.NaN,
    emptyDrive: proParse(emptyRear) ?? Number.NaN,
  });
  const target = mode === "rigid" ? rigidTarget : tractorTarget;

  const kg = (value: number): string => proUnit(proNum(value, 1), s.unitKg);
  const m = (value: number): string => proUnit(proNum(value, 3), s.unitM);

  const copyLines: string[] = [];
  if (result.ok) {
    if (mode === "rigid" && "rear" in result) {
      copyLines.push(`${s.front}: ${kg(result.front.value)}`);
      copyLines.push(`${s.rear}: ${kg(result.rear.value)}`);
      copyLines.push(`${s.total}: ${kg(result.total.value)}`);
    } else if ("drive" in result) {
      copyLines.push(`${s.front}: ${kg(result.front.value)}`);
      copyLines.push(`${s.drive}: ${kg(result.drive.value)}`);
      copyLines.push(`${s.bogie}: ${kg(result.bogie.value)}`);
      copyLines.push(`${s.total}: ${kg(result.total.value)}`);
      copyLines.push(`${s.fifthWheelLoad}: ${kg(result.fifthWheel)}`);
    }
    copyLines.push("", `${s.wheelbase}: ${m(proParse(wheelbase) ?? 0)}`);
    copyLines.push(`${s.emptyFront}: ${kg(proParse(emptyFront) ?? 0)}`);
    copyLines.push(`${s.emptyRear}: ${kg(proParse(emptyRear) ?? 0)}`);
    copyLines.push(`${s.items}: ${rows.length}`);
  }
  if (target.ok) {
    copyLines.push(
      "",
      `${s.targetDistance}: ${m(target.distance)}`,
      `${s.targetShift}: ${m(target.shift)}`,
    );
  }

  return (
    <>
      <ToolSelect<AxleMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "rigid", label: s.modeRigid },
          { id: "tractor", label: s.modeTractor },
        ]}
      />
      <ToolInput
        label={mode === "rigid" ? s.wheelbase : s.tractorWheelbase}
        hint={s.wheelbaseHint}
        value={wheelbase}
        onChange={setWheelbase}
      />
      <ToolInput
        label={mode === "rigid" ? s.emptyFront : s.emptyFrontTractor}
        hint={s.emptyFrontHint}
        value={emptyFront}
        onChange={setEmptyFront}
      />
      <ToolInput
        label={mode === "rigid" ? s.emptyRear : s.emptyDrive}
        hint={s.emptyRearHint}
        value={emptyRear}
        onChange={setEmptyRear}
      />
      <ToolTextArea label={s.items} hint={s.itemsHint} value={items} onChange={setItems} />
      {mode === "tractor" && (
        <>
          <ToolInput label={s.fifthWheel} value={fifthWheel} onChange={setFifthWheel} />
          <ToolInput label={s.kingpinToBogie} value={kingpinToBogie} onChange={setKingpinToBogie} />
          <ToolInput label={s.trailerTare} value={trailerTare} onChange={setTrailerTare} />
          <ToolInput
            label={s.trailerTareCentre}
            value={trailerTareCentre}
            onChange={setTrailerTareCentre}
          />
        </>
      )}
      <ToolInput label={s.frontLimit} hint={s.limitHint} value={frontLimit} onChange={setFrontLimit} />
      <ToolInput
        label={mode === "rigid" ? s.rearLimit : s.driveLimit}
        value={rearLimit}
        onChange={setRearLimit}
      />
      {mode === "tractor" && (
        <ToolInput label={s.bogieLimit} value={bogieLimit} onChange={setBogieLimit} />
      )}
      <ToolInput label={s.totalLimit} value={totalLimit} onChange={setTotalLimit} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          {mode === "rigid" && "rear" in result && (
            <>
              <ToolAgainstLimit
                label={s.front}
                value={kg(result.front.value)}
                limitLabel={s.frontLimit}
                limit={result.front.limit === undefined ? undefined : kg(result.front.limit)}
                ratioLabel={s.ratio}
                ratio={proRatio(result.front.ratio)}
              />
              {result.front.minusLimit !== undefined && (
                <ResultRow label={s.diff} value={kg(result.front.minusLimit)} />
              )}
              <ToolAgainstLimit
                label={s.rear}
                value={kg(result.rear.value)}
                limitLabel={s.rearLimit}
                limit={result.rear.limit === undefined ? undefined : kg(result.rear.limit)}
                ratioLabel={s.ratio}
                ratio={proRatio(result.rear.ratio)}
              />
              {result.rear.minusLimit !== undefined && (
                <ResultRow label={s.diff} value={kg(result.rear.minusLimit)} />
              )}
            </>
          )}
          {mode === "tractor" && "drive" in result && (
            <>
              <ToolAgainstLimit
                label={s.front}
                value={kg(result.front.value)}
                limitLabel={s.frontLimit}
                limit={result.front.limit === undefined ? undefined : kg(result.front.limit)}
                ratioLabel={s.ratio}
                ratio={proRatio(result.front.ratio)}
              />
              <ToolAgainstLimit
                label={s.drive}
                value={kg(result.drive.value)}
                limitLabel={s.driveLimit}
                limit={result.drive.limit === undefined ? undefined : kg(result.drive.limit)}
                ratioLabel={s.ratio}
                ratio={proRatio(result.drive.ratio)}
              />
              <ToolAgainstLimit
                label={s.bogie}
                value={kg(result.bogie.value)}
                limitLabel={s.bogieLimit}
                limit={result.bogie.limit === undefined ? undefined : kg(result.bogie.limit)}
                ratioLabel={s.ratio}
                ratio={proRatio(result.bogie.ratio)}
              />
              <ResultRow label={s.fifthWheelLoad} value={kg(result.fifthWheel)} />
            </>
          )}
          <ToolAgainstLimit
            label={s.total}
            value={kg(result.total.value)}
            limitLabel={s.totalLimit}
            limit={result.total.limit === undefined ? undefined : kg(result.total.limit)}
            ratioLabel={s.ratio}
            ratio={proRatio(result.total.ratio)}
          />
          {result.total.minusLimit !== undefined && (
            <ResultRow label={s.diff} value={kg(result.total.minusLimit)} />
          )}
          <ResultRow label={s.payload} value={kg(result.payload)} />
          <ResultRow label={s.totalByMasses} value={kg(result.totalByMasses)} />

          {rows.length > 0 && mode === "rigid" && "rear" in result && (
            <ToolTable
              head={[s.colMass, s.colDistance, s.colToFront, s.colToRear]}
              rows={result.shares.map((row) => [kg(row.mass), m(row.distance), kg(row.toFront), kg(row.toRear)])}
            />
          )}
          {rows.length > 0 && mode === "tractor" && "drive" in result && (
            <ToolTable
              head={[s.colMass, s.colDistance, s.colToBogie, s.colToDrive]}
              rows={result.shares.map((row) => [kg(row.mass), m(row.distance), kg(row.toBogie), kg(row.toDrive)])}
            />
          )}

          <ToolFormula>{mode === "rigid" ? s.formulaRigid : s.formulaTractor}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mode, value: mode === "rigid" ? s.modeRigid : s.modeTractor },
              { label: s.wheelbase, value: m(proParse(wheelbase) ?? 0) },
              { label: s.emptyFront, value: kg(proParse(emptyFront) ?? 0) },
              { label: s.emptyRear, value: kg(proParse(emptyRear) ?? 0) },
              { label: s.items, value: String(rows.length) },
            ]}
          />
          <CopyButton value={copyLines.join("\n")} />
        </ToolSection>
      )}

      <ToolSection title={s.targetTitle}>
        <p className="tool__note">{s.targetHint}</p>
        <ToolInput label={s.itemIndex} hint={s.itemIndexHint} value={itemIndex} onChange={setItemIndex} />
        <ToolInput
          label={mode === "rigid" ? s.targetRear : s.targetBogie}
          value={targetRear}
          onChange={setTargetRear}
        />
        {target.ok ? (
          <>
            <ResultRow label={s.targetDistance} value={m(target.distance)} />
            <ResultRow label={s.targetShift} value={m(target.shift)} />
            {target.distanceOutOfBounds && <p className="tool__note">{s.targetOutOfBounds}</p>}
            {"newFront" in target && (
              <ResultRow label={s.newFront} value={kg(target.newFront)} />
            )}
            {"newRear" in target && <ResultRow label={s.newRear} value={kg(target.newRear)} />}
            {"newDrive" in target && <ResultRow label={s.newDrive} value={kg(target.newDrive)} />}
            {"newBogie" in target && <ResultRow label={s.newBogie} value={kg(target.newBogie)} />}
            <ResultRow label={s.newTotal} value={kg(target.newTotal)} />
            <ToolFormula>{s.targetFormula}</ToolFormula>
          </>
        ) : (
          targetTyped && <ToolFailure>{s.errorTarget}</ToolFailure>
        )}
      </ToolSection>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Težište tereta — cargo centre of gravity (life-safety)                      */
/* -------------------------------------------------------------------------- */

export function CargoCentreOfGravityTool() {
  const s = strings.pro.transport["cargo-centre-of-gravity"];
  const [items, setItems] = useState("");
  const [zeroChoice, setZeroChoice] = useState<"front" | "wall" | "kingpin">("wall");
  const [useDims, setUseDims] = useState<"yes" | "no">("no");
  const [vehicleMass, setVehicleMass] = useState("");
  const [vehicleCentre, setVehicleCentre] = useState("");
  const [floorHeight, setFloorHeight] = useState("1,15");
  const [track, setTrack] = useState("2,04");
  const [innerWidth, setInnerWidth] = useState("2,48");
  const [momentRef, setMomentRef] = useState("0");

  const rowTexts = items.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const fields = useDims === "yes" ? 7 : 4;
  const parsedRows = rowTexts.map((line) => parseRowN(line, fields));
  const cargoItems = parsedRows.flatMap((cells) => {
    const [mass, x, y, z, l, w, h] = cells;
    if (mass === undefined || x === undefined || y === undefined || z === undefined) return [];
    if (useDims === "yes") {
      if (l === undefined || w === undefined || h === undefined) return [];
      return [{ mass, x, y, z, length: l, width: w, height: h }];
    }
    return [{ mass, x, y, z }];
  });

  const vc = parseRowN(vehicleCentre, 3);
  const typed = cargoItems.length > 0;
  const result = cargoCentreOfGravity({
    items: cargoItems,
    useItemDimensions: useDims === "yes",
    floorHeight: proParse(floorHeight) ?? Number.NaN,
    track: proParse(track) ?? Number.NaN,
    innerWidth: proParse(innerWidth) ?? Number.NaN,
    momentReference: proParse(momentRef) ?? Number.NaN,
    vehicleMass: proParse(vehicleMass),
    vehicleCentre:
      vc[0] === undefined || vc[1] === undefined || vc[2] === undefined
        ? undefined
        : { x: vc[0], y: vc[1], z: vc[2] },
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "floorHeight"
        ? s.errorFloorHeight
        : result.reason === "track"
          ? s.errorTrack
          : result.reason === "innerWidth"
            ? s.errorInnerWidth
            : result.reason === "vehicleMass"
              ? s.errorVehicleMass
              : result.reason === "vehicleCentre"
                ? s.errorVehicleCentre
                : result.reason === "itemDimensions"
                  ? s.errorItemDimensions
                  : s.errorItems;

  const kg = (value: number): string => proUnit(proNum(value, 1), s.unitKg);
  const mm = (value: number): string => proUnit(proNum(value, 3), s.unitM);
  const kgm = (value: number): string => proUnit(proNum(value, 1), s.unitKgm);
  const zeroLabel = zeroChoice === "front" ? s.zeroFront : zeroChoice === "wall" ? s.zeroWall : s.zeroKingpin;

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalMass}: ${kg(result.totalMass)}`,
        `${s.x}: ${mm(result.x)}`,
        `${s.y}: ${mm(result.y)}`,
        `${s.z}: ${mm(result.z)}`,
        `${s.heightAboveGround}: ${mm(result.heightAboveGround)}`,
        `${s.lateralOffset}: ${mm(result.lateralOffset)}`,
        result.lateralShare !== undefined
          ? `${s.lateralShare}: ${proNum(result.lateralShare * 100, 2)} %`
          : "",
        result.halfTrackOverHeight !== undefined
          ? `${s.geometricRatio}: ${proNum(result.halfTrackOverHeight, 4)}`
          : "",
        "",
        `${s.items}: ${cargoItems.length}`,
        `${s.zeroChoice}: ${zeroLabel}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolTextArea label={s.items} hint={s.itemsHint} value={items} onChange={setItems} />
      <ToolSelect<"front" | "wall" | "kingpin">
        label={s.zeroChoice}
        value={zeroChoice}
        onChange={setZeroChoice}
        options={[
          { id: "front", label: s.zeroFront },
          { id: "wall", label: s.zeroWall },
          { id: "kingpin", label: s.zeroKingpin },
        ]}
      />
      <ToolSelect<"yes" | "no">
        label={s.useDims}
        value={useDims}
        onChange={setUseDims}
        hint={s.useDimsHint}
        options={[
          { id: "no", label: s.no },
          { id: "yes", label: s.yes },
        ]}
      />
      <ToolInput label={s.floorHeight} value={floorHeight} onChange={setFloorHeight} />
      <ToolInput label={s.track} value={track} onChange={setTrack} />
      <ToolInput label={s.innerWidth} value={innerWidth} onChange={setInnerWidth} />
      <ToolInput label={s.momentRef} value={momentRef} onChange={setMomentRef} />
      <ToolInput label={s.vehicleMass} hint={s.vehicleMassHint} value={vehicleMass} onChange={setVehicleMass} />
      <ToolInput label={s.vehicleCentre} hint={s.vehicleCentreHint} value={vehicleCentre} onChange={setVehicleCentre} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.totalMass} value={kg(result.totalMass)} />
          <ResultRow label={s.x} value={mm(result.x)} />
          <ResultRow label={s.y} value={mm(result.y)} />
          <ResultRow label={s.z} value={mm(result.z)} />
          <ResultRow label={s.heightAboveGround} value={mm(result.heightAboveGround)} />
          <ResultRow label={s.lateralOffset} value={mm(result.lateralOffset)} />
          {result.lateralShare !== undefined && (
            <ResultRow label={s.lateralShare} value={`${proNum(result.lateralShare * 100, 2)} %`} />
          )}
          <ResultRow label={s.momentAboutReference} value={kgm(result.momentAboutReference)} />
          {result.halfTrackOverHeight !== undefined && (
            <>
              <ResultRow label={s.geometricRatio} value={proNum(result.halfTrackOverHeight, 4)} />
              <p className="tool__note">{s.geometricRatioNote}</p>
            </>
          )}
          {result.combined !== undefined && (
            <ToolSection title={s.combinedTitle}>
              <ResultRow label={s.totalMass} value={kg(result.combined.mass)} />
              <ResultRow label={s.heightAboveGround} value={mm(result.combined.heightAboveGround)} />
              <ResultRow label={s.lateralOffset} value={mm(result.combined.lateralOffset)} />
              {result.combined.lateralShare !== undefined && (
                <ResultRow
                  label={s.lateralShare}
                  value={`${proNum(result.combined.lateralShare * 100, 2)} %`}
                />
              )}
              {result.combined.halfTrackOverHeight !== undefined && (
                <ResultRow label={s.geometricRatio} value={proNum(result.combined.halfTrackOverHeight, 4)} />
              )}
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.items, value: String(cargoItems.length) },
              { label: s.zeroChoice, value: zeroLabel },
              { label: s.floorHeight, value: mm(proParse(floorHeight) ?? 0) },
              { label: s.track, value: mm(proParse(track) ?? 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Obračunska masa — chargeable weight (financial)                            */
/* -------------------------------------------------------------------------- */

type ChargeableRounding = "perItem" | "perShipment";

export function ChargeableWeightTool() {
  const s = strings.pro.transport["chargeable-weight"];
  const [items, setItems] = useState("");
  const [divisor, setDivisor] = useState("");
  const [densityDivisor, setDensityDivisor] = useState("");
  const [ldmWidth, setLdmWidth] = useState("2,40");
  const [massPerLdm, setMassPerLdm] = useState("");
  const [massPerPalletSpace, setMassPerPalletSpace] = useState("");
  const [palletSpaces, setPalletSpaces] = useState("0");
  const [roundingStep, setRoundingStep] = useState("0,5");
  const [rounding, setRounding] = useState<ChargeableRounding>("perShipment");
  const [pricePerKg, setPricePerKg] = useState("");

  const rowTexts = items.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const parsedItems = rowTexts.flatMap((line) => {
    const [length, width, height, quantity, massPerPiece, layers] = parseRowN(line, 6);
    if (
      length === undefined ||
      width === undefined ||
      height === undefined ||
      quantity === undefined ||
      massPerPiece === undefined
    ) {
      return [];
    }
    return [{ length, width, height, quantity, massPerPiece, layers }];
  });

  const typed = parsedItems.length > 0;
  const result = chargeableWeight({
    items: parsedItems,
    divisor: proParse(divisor),
    densityDivisor: proParse(densityDivisor),
    ldmWidth: proParse(ldmWidth) ?? Number.NaN,
    massPerLdm: proParse(massPerLdm),
    massPerPalletSpace: proParse(massPerPalletSpace),
    palletSpaces: proParse(palletSpaces),
    roundingStep: proParse(roundingStep) ?? Number.NaN,
    rounding,
    pricePerKg: proParse(pricePerKg),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "ldmWidth"
        ? s.errorLdmWidth
        : result.reason === "roundingStep"
          ? s.errorRoundingStep
          : result.reason === "itemDimensions"
            ? s.errorItemDimensions
            : result.reason === "itemQuantity"
              ? s.errorItemQuantity
              : result.reason === "itemMass"
                ? s.errorItemMass
                : s.errorItems;

  const kg = (value: number): string => proUnit(proNum(value, 2), s.unitKg);
  const basisLabel = (basis: string): string =>
    basis === "actual"
      ? s.basisActual
      : basis === "volumetric"
        ? s.basisVolumetric
        : basis === "loadingMetre"
          ? s.basisLoadingMetre
          : s.basisPalletSpace;

  const copyText = !result.ok
    ? ""
    : [
        `${s.chargeableMass}: ${kg(result.chargeableMass)} (${basisLabel(result.basis)})`,
        `${s.billedMass}: ${kg(result.billedMass)}`,
        `${s.roundedPerShipment}: ${kg(result.roundedPerShipment)}`,
        `${s.roundedPerItem}: ${kg(result.roundedPerItem)}`,
        result.amount !== undefined ? `${s.amount}: ${proNum(result.amount, 2)} ${s.currency}` : "",
        "",
        `${s.actualMass}: ${kg(result.actualMass)}`,
        result.volumetricMass !== undefined ? `${s.volumetricMass}: ${kg(result.volumetricMass)}` : "",
        result.loadingMetreMass !== undefined
          ? `${s.loadingMetreMass}: ${kg(result.loadingMetreMass)}`
          : "",
        `${s.volume}: ${proNum(result.volume, 3)} ${s.unitM3}`,
        `${s.loadingMetres}: ${proNum(result.loadingMetres, 3)} ${s.unitLdm}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolTextArea label={s.items} hint={s.itemsHint} value={items} onChange={setItems} />
      <ToolInput label={s.divisor} hint={s.divisorHint} value={divisor} onChange={setDivisor} />
      <ToolInput label={s.densityDivisor} hint={s.densityDivisorHint} value={densityDivisor} onChange={setDensityDivisor} />
      <ToolInput label={s.ldmWidth} value={ldmWidth} onChange={setLdmWidth} />
      <ToolInput label={s.massPerLdm} hint={s.massPerLdmHint} value={massPerLdm} onChange={setMassPerLdm} />
      <ToolInput label={s.massPerPalletSpace} value={massPerPalletSpace} onChange={setMassPerPalletSpace} />
      <ToolInput label={s.palletSpaces} value={palletSpaces} onChange={setPalletSpaces} />
      <ToolInput label={s.roundingStep} value={roundingStep} onChange={setRoundingStep} />
      <ToolSelect<ChargeableRounding>
        label={s.rounding}
        value={rounding}
        onChange={setRounding}
        options={[
          { id: "perShipment", label: s.roundingPerShipment },
          { id: "perItem", label: s.roundingPerItem },
        ]}
      />
      <ToolInput label={s.pricePerKg} value={pricePerKg} onChange={setPricePerKg} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.actualMass} value={kg(result.actualMass)} />
          {result.volumetricMass !== undefined && (
            <ResultRow label={s.volumetricMass} value={kg(result.volumetricMass)} />
          )}
          {result.loadingMetreMass !== undefined && (
            <ResultRow label={s.loadingMetreMass} value={kg(result.loadingMetreMass)} />
          )}
          {result.palletSpaceMass !== undefined && (
            <ResultRow label={s.palletSpaceMass} value={kg(result.palletSpaceMass)} />
          )}
          <ResultRow label={s.chargeableMass} value={`${kg(result.chargeableMass)} — ${basisLabel(result.basis)}`} />
          <ResultRow label={s.roundedPerShipment} value={kg(result.roundedPerShipment)} />
          <ResultRow label={s.roundedPerItem} value={kg(result.roundedPerItem)} />
          <ResultRow label={s.billedMass} value={kg(result.billedMass)} />
          {result.amount !== undefined && (
            <ResultRow label={s.amount} value={`${proNum(result.amount, 2)} ${s.currency}`} />
          )}
          <ToolTable
            head={[s.colVolume, s.colActual, s.colVolumetric, s.colLdm, s.colChargeable]}
            rows={result.lines.map((line) => [
              `${proNum(line.volume, 3)} ${s.unitM3}`,
              kg(line.actualMass),
              line.volumetricMass === undefined ? "—" : kg(line.volumetricMass),
              `${proNum(line.loadingMetres, 3)} ${s.unitLdm}`,
              kg(line.chargeableMass),
            ])}
          />
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.items, value: String(parsedItems.length) },
              { label: s.divisor, value: divisor.trim() === "" ? "—" : divisor.trim() },
              { label: s.ldmWidth, value: proUnit(proNum(proParse(ldmWidth) ?? 0, 2), s.unitM) },
              { label: s.rounding, value: rounding === "perShipment" ? s.roundingPerShipment : s.roundingPerItem },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Trošak po kilometru — cost per kilometre (financial)                       */
/* -------------------------------------------------------------------------- */

export function CostPerKmTransportTool() {
  const s = strings.pro.transport["cost-per-km-transport"];
  const [fixedAnnual, setFixedAnnual] = useState("");
  const [annualKm, setAnnualKm] = useState("100000");
  const [emptyShare, setEmptyShare] = useState("15");
  const [consumption, setConsumption] = useState("");
  const [fuelPrice, setFuelPrice] = useState("");
  const [tyreSetPrice, setTyreSetPrice] = useState("0");
  const [tyreLifeKm, setTyreLifeKm] = useState("");
  const [servicePrice, setServicePrice] = useState("0");
  const [serviceIntervalKm, setServiceIntervalKm] = useState("");
  const [repairsPerKm, setRepairsPerKm] = useState("0");
  const [adBlueShare, setAdBlueShare] = useState("");
  const [adBluePrice, setAdBluePrice] = useState("");
  const [marginOnPrice, setMarginOnPrice] = useState("15");
  const [markupOnCost, setMarkupOnCost] = useState("");
  const [workingDays, setWorkingDays] = useState("220");

  const typed = proParse(fixedAnnual) !== undefined || proParse(annualKm) !== undefined;
  const result = costPerKm({
    fixedAnnual: proParse(fixedAnnual) ?? Number.NaN,
    annualKm: proParse(annualKm) ?? Number.NaN,
    emptyShare: pct(emptyShare) ?? Number.NaN,
    consumptionPer100Km: proParse(consumption),
    fuelPrice: proParse(fuelPrice),
    tyreSetPrice: proParse(tyreSetPrice),
    tyreLifeKm: proParse(tyreLifeKm),
    servicePrice: proParse(servicePrice),
    serviceIntervalKm: proParse(serviceIntervalKm),
    repairsPerKm: proParse(repairsPerKm) ?? Number.NaN,
    adBlueShare: pct(adBlueShare),
    adBluePrice: proParse(adBluePrice),
    marginOnPrice: pct(marginOnPrice),
    markupOnCost: pct(markupOnCost),
    workingDays: proParse(workingDays) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "fixedAnnual"
        ? s.errorFixedAnnual
        : result.reason === "annualKm"
          ? s.errorAnnualKm
          : result.reason === "emptyShare"
            ? s.errorEmptyShare
            : result.reason === "workingDays"
              ? s.errorWorkingDays
              : s.errorGeneric;

  const rsd = (value: number): string => `${proNum(value, 2)} ${s.currencyPerKm}`;

  const copyText = !result.ok
    ? ""
    : [
        `${s.fixedPerKm}: ${rsd(result.fixedPerKm)}`,
        `${s.variablePerKm}: ${rsd(result.variablePerKm)}`,
        `${s.totalPerKm}: ${rsd(result.totalPerKm)}`,
        result.perLadenKm !== undefined ? `${s.perLadenKm}: ${rsd(result.perLadenKm)}` : "",
        `${s.annualCost}: ${proNum(result.annualCost, 2)} ${s.currency}`,
        result.priceAtMargin !== undefined ? `${s.priceAtMargin}: ${rsd(result.priceAtMargin)}` : "",
        result.priceAtMarkup !== undefined ? `${s.priceAtMarkup}: ${rsd(result.priceAtMarkup)}` : "",
        "",
        `${s.fixedAnnual}: ${proNum(proParse(fixedAnnual) ?? 0, 2)} ${s.currency}`,
        `${s.annualKm}: ${proNum(proParse(annualKm) ?? 0, 0)} ${s.unitKm}`,
        `${s.emptyShare}: ${emptyShare.trim()} %`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.fixedAnnual} hint={s.fixedAnnualHint} value={fixedAnnual} onChange={setFixedAnnual} />
      <ToolInput label={s.annualKm} hint={s.annualKmHint} value={annualKm} onChange={setAnnualKm} />
      <ToolInput label={s.emptyShare} hint={s.emptyShareHint} value={emptyShare} onChange={setEmptyShare} />
      <ToolInput label={s.consumption} value={consumption} onChange={setConsumption} />
      <ToolInput label={s.fuelPrice} hint={s.fuelPriceHint} value={fuelPrice} onChange={setFuelPrice} />
      <ToolInput label={s.tyreSetPrice} value={tyreSetPrice} onChange={setTyreSetPrice} />
      <ToolInput label={s.tyreLifeKm} value={tyreLifeKm} onChange={setTyreLifeKm} />
      <ToolInput label={s.servicePrice} value={servicePrice} onChange={setServicePrice} />
      <ToolInput label={s.serviceIntervalKm} hint={s.serviceIntervalKmHint} value={serviceIntervalKm} onChange={setServiceIntervalKm} />
      <ToolInput label={s.repairsPerKm} value={repairsPerKm} onChange={setRepairsPerKm} />
      <ToolInput label={s.adBlueShare} value={adBlueShare} onChange={setAdBlueShare} />
      <ToolInput label={s.adBluePrice} hint={s.adBluePriceHint} value={adBluePrice} onChange={setAdBluePrice} />
      <ToolInput label={s.marginOnPrice} value={marginOnPrice} onChange={setMarginOnPrice} />
      <ToolInput label={s.markupOnCost} value={markupOnCost} onChange={setMarkupOnCost} />
      <ToolInput label={s.workingDays} value={workingDays} onChange={setWorkingDays} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.fixedPerKm} value={rsd(result.fixedPerKm)} />
          {result.fuelPerKm !== undefined && <ResultRow label={s.fuelPerKm} value={rsd(result.fuelPerKm)} />}
          {result.tyresPerKm !== undefined && <ResultRow label={s.tyresPerKm} value={rsd(result.tyresPerKm)} />}
          {result.servicePerKm !== undefined && <ResultRow label={s.servicePerKm} value={rsd(result.servicePerKm)} />}
          <ResultRow label={s.repairsPerKm} value={rsd(result.repairsPerKm)} />
          {result.adBluePerKm !== undefined && <ResultRow label={s.adBluePerKm} value={rsd(result.adBluePerKm)} />}
          <ResultRow label={s.variablePerKm} value={rsd(result.variablePerKm)} />
          <ResultRow label={s.totalPerKm} value={rsd(result.totalPerKm)} />
          {result.perLadenKm !== undefined && <ResultRow label={s.perLadenKm} value={rsd(result.perLadenKm)} />}
          <ResultRow label={s.annualCost} value={`${proNum(result.annualCost, 2)} ${s.currency}`} />
          {result.perWorkingDay !== undefined && (
            <ResultRow label={s.perWorkingDay} value={`${proNum(result.perWorkingDay, 2)} ${s.currency}`} />
          )}
          {result.priceAtMargin !== undefined && (
            <ResultRow label={s.priceAtMargin} value={rsd(result.priceAtMargin)} />
          )}
          {result.priceAtMarkup !== undefined && (
            <ResultRow label={s.priceAtMarkup} value={rsd(result.priceAtMarkup)} />
          )}
          {result.markupEquivalent !== undefined && (
            <ResultRow label={s.markupEquivalent} value={proNum(result.markupEquivalent * 100, 2)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.fixedAnnual, value: `${proNum(proParse(fixedAnnual) ?? 0, 2)} ${s.currency}` },
              { label: s.annualKm, value: `${proNum(proParse(annualKm) ?? 0, 0)} ${s.unitKm}` },
              { label: s.emptyShare, value: `${emptyShare.trim()} %` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Vožnja i pauze — driving hours planner (life-safety)                       */
/* -------------------------------------------------------------------------- */

const BLOCK_KIND_KEY = {
  drive: "kindDrive",
  break: "kindBreak",
  dailyRest: "kindDailyRest",
  otherWork: "kindOtherWork",
} as const;

export function DrivingHoursPlannerTool() {
  const s = strings.pro.transport["driving-hours-planner"];
  const [departure, setDeparture] = useState("06:00");
  const [plannedDriving, setPlannedDriving] = useState("");
  const [distance, setDistance] = useState("0");
  const [averageSpeed, setAverageSpeed] = useState("68");
  const [continuousLimit, setContinuousLimit] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("");
  const [splitBreak, setSplitBreak] = useState<"yes" | "no">("no");
  const [firstBreakPart, setFirstBreakPart] = useState("");
  const [drivingBeforeFirstPart, setDrivingBeforeFirstPart] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [dailyRestMinutes, setDailyRestMinutes] = useState("");
  const [drivenSinceBreak, setDrivenSinceBreak] = useState("0:00");
  const [drivenToday, setDrivenToday] = useState("0:00");
  const [otherWork, setOtherWork] = useState("");

  const otherWorkRows = otherWork
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .flatMap((line) => {
      const cells = line.split(",");
      const minutes = proParse(cells[0] ?? "");
      const after = parseHm(cells[1] ?? "");
      return minutes === undefined || after === undefined
        ? []
        : [{ minutes, afterDrivingMinutes: after }];
    });

  const typed = parseHm(departure) !== undefined && parseHm(continuousLimit) !== undefined;
  const result = drivingSchedule({
    departureMinuteOfDay: parseHm(departure) ?? Number.NaN,
    plannedDrivingMinutes: parseHm(plannedDriving),
    distance: proParse(distance),
    averageSpeed: proParse(averageSpeed),
    continuousLimit: parseHm(continuousLimit) ?? Number.NaN,
    breakMinutes: proParse(breakMinutes) ?? Number.NaN,
    dailyLimit: parseHm(dailyLimit) ?? Number.NaN,
    dailyRestMinutes: parseHm(dailyRestMinutes) ?? Number.NaN,
    splitBreak: splitBreak === "yes",
    firstBreakPart: proParse(firstBreakPart),
    drivingBeforeFirstPart: parseHm(drivingBeforeFirstPart),
    drivenSinceBreak: parseHm(drivenSinceBreak) ?? Number.NaN,
    drivenToday: parseHm(drivenToday) ?? Number.NaN,
    otherWork: otherWorkRows,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "departure"
        ? s.errorDeparture
        : result.reason === "continuousLimit"
          ? s.errorContinuousLimit
          : result.reason === "breakMinutes"
            ? s.errorBreakMinutes
            : result.reason === "dailyLimit"
              ? s.errorDailyLimit
              : result.reason === "dailyRestMinutes"
                ? s.errorDailyRestMinutes
                : result.reason === "plannedDriving"
                  ? s.errorPlannedDriving
                  : result.reason === "averageSpeed"
                    ? s.errorAverageSpeed
                    : result.reason === "firstBreakPart"
                      ? s.errorFirstBreakPart
                      : result.reason === "drivingBeforeFirstPart"
                        ? s.errorDrivingBeforeFirstPart
                        : s.errorGeneric;

  const kindLabel = (kind: DrivingBlockKind): string => s[BLOCK_KIND_KEY[kind]];

  const copyText = !result.ok
    ? ""
    : [
        `${s.arrival}: ${clockLabel(result.arrival)}`,
        `${s.elapsedMinutes}: ${fmtHm(result.elapsedMinutes)}`,
        `${s.drivingMinutes}: ${fmtHm(result.drivingMinutes)}`,
        `${s.breakMinutesTotal}: ${fmtHm(result.breakMinutes)}`,
        `${s.restMinutes}: ${fmtHm(result.restMinutes)}`,
        `${s.otherWorkMinutes}: ${fmtHm(result.otherWorkMinutes)}`,
        `${s.sinceBreak}: ${fmtHm(result.sinceBreak.value)}`,
        `${s.today}: ${fmtHm(result.today.value)}`,
        "",
        `${s.departure}: ${departure.trim()}`,
        `${s.continuousLimit}: ${continuousLimit.trim()}`,
        `${s.dailyLimit}: ${dailyLimit.trim()}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.departure} value={departure} onChange={setDeparture} />
      <ToolInput label={s.plannedDriving} hint={s.plannedDrivingHint} value={plannedDriving} onChange={setPlannedDriving} />
      <ToolInput label={s.distance} value={distance} onChange={setDistance} />
      <ToolInput label={s.averageSpeed} value={averageSpeed} onChange={setAverageSpeed} />
      <ToolInput label={s.continuousLimit} hint={s.limitHint} value={continuousLimit} onChange={setContinuousLimit} />
      <ToolInput label={s.breakMinutes} value={breakMinutes} onChange={setBreakMinutes} />
      <ToolSelect<"yes" | "no">
        label={s.splitBreak}
        value={splitBreak}
        onChange={setSplitBreak}
        options={[
          { id: "no", label: s.no },
          { id: "yes", label: s.yes },
        ]}
      />
      {splitBreak === "yes" && (
        <>
          <ToolInput label={s.firstBreakPart} value={firstBreakPart} onChange={setFirstBreakPart} />
          <ToolInput label={s.drivingBeforeFirstPart} value={drivingBeforeFirstPart} onChange={setDrivingBeforeFirstPart} />
        </>
      )}
      <ToolInput label={s.dailyLimit} value={dailyLimit} onChange={setDailyLimit} />
      <ToolInput label={s.dailyRestMinutes} value={dailyRestMinutes} onChange={setDailyRestMinutes} />
      <ToolInput label={s.drivenSinceBreak} value={drivenSinceBreak} onChange={setDrivenSinceBreak} />
      <ToolInput label={s.drivenToday} value={drivenToday} onChange={setDrivenToday} />
      <ToolTextArea label={s.otherWork} hint={s.otherWorkHint} value={otherWork} onChange={setOtherWork} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ToolTable
            head={[s.colKind, s.colStart, s.colEnd, s.colMinutes, s.colSinceBreak, s.colToday]}
            rows={result.blocks.map((block) => [
              kindLabel(block.kind),
              clockLabel(block.start),
              clockLabel(block.end),
              fmtHm(block.minutes),
              fmtHm(block.sinceBreakAfter),
              fmtHm(block.todayAfter),
            ])}
          />
          <ResultRow label={s.arrival} value={clockLabel(result.arrival)} />
          <ResultRow label={s.elapsedMinutes} value={fmtHm(result.elapsedMinutes)} />
          <ResultRow label={s.drivingMinutes} value={fmtHm(result.drivingMinutes)} />
          <ResultRow label={s.breakMinutesTotal} value={fmtHm(result.breakMinutes)} />
          <ResultRow label={s.restMinutes} value={fmtHm(result.restMinutes)} />
          <ResultRow label={s.otherWorkMinutes} value={fmtHm(result.otherWorkMinutes)} />
          <ToolAgainstLimit
            label={s.sinceBreak}
            value={fmtHm(result.sinceBreak.value)}
            limitLabel={s.continuousLimit}
            limit={result.sinceBreak.limit === undefined ? undefined : fmtHm(result.sinceBreak.limit)}
            ratioLabel={s.ratio}
            ratio={proRatio(result.sinceBreak.ratio)}
          />
          <ToolAgainstLimit
            label={s.today}
            value={fmtHm(result.today.value)}
            limitLabel={s.dailyLimit}
            limit={result.today.limit === undefined ? undefined : fmtHm(result.today.limit)}
            ratioLabel={s.ratio}
            ratio={proRatio(result.today.ratio)}
          />
          <ResultRow label={s.continuousLimitReachedAt} value={clockLabel(result.continuousLimitReachedAt)} />
          <ResultRow label={s.dailyLimitReachedAt} value={clockLabel(result.dailyLimitReachedAt)} />
          {result.truncated && <p className="tool__note">{s.truncatedNote}</p>}
          {result.unplacedOtherWork.length > 0 && (
            <p className="tool__note">{s.unplacedNote}</p>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.departure, value: departure.trim() },
              { label: s.continuousLimit, value: continuousLimit.trim() },
              { label: s.breakMinutes, value: breakMinutes.trim() },
              { label: s.dailyLimit, value: dailyLimit.trim() },
              { label: s.dailyRestMinutes, value: dailyRestMinutes.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Procena dolaska — ETA with breaks (none)                                    */
/* -------------------------------------------------------------------------- */

export function EtaWithBreaksTool() {
  const s = strings.pro.transport["eta-with-breaks"];
  const [distance, setDistance] = useState("500");
  const [averageSpeed, setAverageSpeed] = useState("68");
  const [departure, setDeparture] = useState("07:00");
  const [breaks, setBreaks] = useState("0");
  const [waiting, setWaiting] = useState("0");
  const [loading, setLoading] = useState("0");
  const [reserve, setReserve] = useState("5");
  const [targetTime, setTargetTime] = useState("");
  const [targetDayOffset, setTargetDayOffset] = useState("0");

  const stopMinutes = [proParse(breaks), proParse(waiting), proParse(loading)].filter(
    (value): value is number => value !== undefined,
  );
  const typed = proParse(distance) !== undefined && proParse(averageSpeed) !== undefined;
  const result = etaWithBreaks({
    distance: proParse(distance) ?? Number.NaN,
    averageSpeed: proParse(averageSpeed) ?? Number.NaN,
    departureMinuteOfDay: parseHm(departure) ?? Number.NaN,
    stopMinutes,
    reserve: pct(reserve) ?? Number.NaN,
    targetMinuteOfDay: parseHm(targetTime),
    targetDayOffset: proParse(targetDayOffset),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "distance"
        ? s.errorDistance
        : result.reason === "averageSpeed"
          ? s.errorAverageSpeed
          : result.reason === "departure"
            ? s.errorDeparture
            : result.reason === "reserve"
              ? s.errorReserve
              : result.reason === "targetTime"
                ? s.errorTargetTime
                : s.errorGeneric;

  const kmh = (value: number): string => proUnit(proNum(value, 2), s.unitKmh);

  const copyText = !result.ok
    ? ""
    : [
        `${s.arrival}: ${clockLabel(result.arrivalDayOffset * 1440 + result.arrivalMinuteOfDay)}`,
        `${s.totalWithReserve}: ${fmtHm(result.totalWithReserve)}`,
        `${s.drivingMinutes}: ${fmtHm(result.drivingMinutes)}`,
        `${s.stopMinutes}: ${fmtHm(result.stopMinutes)}`,
        result.doorToDoorSpeed !== undefined ? `${s.doorToDoorSpeed}: ${kmh(result.doorToDoorSpeed)}` : "",
        result.target !== undefined
          ? `${s.latestDeparture}: ${clockLabel(result.target.latestDeparture)}`
          : "",
        result.target?.requiredSpeed !== undefined
          ? `${s.requiredSpeed}: ${kmh(result.target.requiredSpeed)}`
          : "",
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.distance} value={distance} onChange={setDistance} />
      <ToolInput label={s.averageSpeed} hint={s.averageSpeedHint} value={averageSpeed} onChange={setAverageSpeed} />
      <ToolInput label={s.departure} value={departure} onChange={setDeparture} />
      <ToolInput label={s.breaks} value={breaks} onChange={setBreaks} />
      <ToolInput label={s.waiting} value={waiting} onChange={setWaiting} />
      <ToolInput label={s.loading} value={loading} onChange={setLoading} />
      <ToolInput label={s.reserve} value={reserve} onChange={setReserve} />
      <ToolInput label={s.targetTime} value={targetTime} onChange={setTargetTime} />
      <ToolInput label={s.targetDayOffset} hint={s.targetDayOffsetHint} value={targetDayOffset} onChange={setTargetDayOffset} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.drivingMinutes} value={fmtHm(result.drivingMinutes)} />
          <ResultRow label={s.stopMinutes} value={fmtHm(result.stopMinutes)} />
          <ResultRow label={s.totalMinutes} value={fmtHm(result.totalMinutes)} />
          <ResultRow label={s.totalWithReserve} value={fmtHm(result.totalWithReserve)} />
          <ResultRow
            label={s.arrival}
            value={clockLabel(result.arrivalDayOffset * 1440 + result.arrivalMinuteOfDay)}
          />
          {result.doorToDoorSpeed !== undefined && (
            <ResultRow label={s.doorToDoorSpeed} value={kmh(result.doorToDoorSpeed)} />
          )}
          {result.doorToDoorSpeedNoReserve !== undefined && (
            <ResultRow label={s.doorToDoorSpeedNoReserve} value={kmh(result.doorToDoorSpeedNoReserve)} />
          )}
          {result.target !== undefined && (
            <ToolSection title={s.targetTitle}>
              <ResultRow label={s.latestDeparture} value={clockLabel(result.target.latestDeparture)} />
              <ResultRow label={s.available} value={fmtHm(result.target.available)} />
              <ResultRow
                label={s.minutesAvailableForDriving}
                value={fmtHm(result.target.minutesAvailableForDriving)}
              />
              {result.target.requiredSpeed !== undefined ? (
                <ResultRow label={s.requiredSpeed} value={kmh(result.target.requiredSpeed)} />
              ) : (
                <p className="tool__note">{s.noRequiredSpeed}</p>
              )}
            </ToolSection>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.distance, value: proUnit(proNum(proParse(distance) ?? 0, 1), s.unitKm) },
              { label: s.averageSpeed, value: kmh(proParse(averageSpeed) ?? 0) },
              { label: s.departure, value: departure.trim() },
              { label: s.reserve, value: `${reserve.trim()} %` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Potrošnja i cena goriva — fuel consumption and cost (none)                  */
/* -------------------------------------------------------------------------- */

export function FuelConsumptionCostTool() {
  const s = strings.pro.transport["fuel-consumption-cost"];
  const [distance, setDistance] = useState("100");
  const [odometerStart, setOdometerStart] = useState("");
  const [odometerEnd, setOdometerEnd] = useState("");
  const [litres, setLitres] = useState("");
  const [pricePerLitre, setPricePerLitre] = useState("");
  const [cargoTonnes, setCargoTonnes] = useState("0");
  const [ladenDistance, setLadenDistance] = useState("");
  const [fuelRemaining, setFuelRemaining] = useState("0");

  const typed = proParse(litres) !== undefined;
  const result = fuelConsumption({
    distance: proParse(distance) ?? Number.NaN,
    odometerStart: proParse(odometerStart),
    odometerEnd: proParse(odometerEnd),
    litres: proParse(litres) ?? Number.NaN,
    pricePerLitre: proParse(pricePerLitre) ?? Number.NaN,
    cargoTonnes: proParse(cargoTonnes) ?? Number.NaN,
    ladenDistance: proParse(ladenDistance),
    fuelRemaining: proParse(fuelRemaining) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "odometer"
        ? s.errorOdometer
        : result.reason === "distance"
          ? s.errorDistance
          : result.reason === "litres"
            ? s.errorLitres
            : result.reason === "pricePerLitre"
              ? s.errorPricePerLitre
              : result.reason === "cargoTonnes"
                ? s.errorCargoTonnes
                : result.reason === "fuelRemaining"
                  ? s.errorFuelRemaining
                  : s.errorGeneric;

  const copyText = !result.ok
    ? ""
    : [
        `${s.per100Km}: ${proNum(result.per100Km, 2)} ${s.unitL100km}`,
        `${s.kmPerLitre}: ${proNum(result.kmPerLitre, 2)} ${s.unitKmL}`,
        `${s.totalCost}: ${proNum(result.totalCost, 2)} ${s.currency}`,
        `${s.costPerKm}: ${proNum(result.costPerKm, 2)} ${s.currencyPerKm}`,
        result.tonneKm?.rates !== undefined
          ? `${s.costPerTonneKm}: ${proNum(result.tonneKm.rates.cost, 2)} ${s.currencyPerTkm}`
          : "",
        result.range !== undefined ? `${s.range}: ${proNum(result.range, 0)} ${s.unitKm}` : "",
        "",
        `${s.distance}: ${proUnit(proNum(result.distance, 1), s.unitKm)}`,
        `${s.litres}: ${proUnit(proNum(proParse(litres) ?? 0, 2), s.unitL)}`,
        `${s.pricePerLitre}: ${proNum(proParse(pricePerLitre) ?? 0, 2)} ${s.currencyPerL}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.distance} hint={s.distanceHint} value={distance} onChange={setDistance} />
      <ToolInput label={s.odometerStart} value={odometerStart} onChange={setOdometerStart} />
      <ToolInput label={s.odometerEnd} value={odometerEnd} onChange={setOdometerEnd} />
      <ToolInput label={s.litres} value={litres} onChange={setLitres} />
      <ToolInput label={s.pricePerLitre} hint={s.pricePerLitreHint} value={pricePerLitre} onChange={setPricePerLitre} />
      <ToolInput label={s.cargoTonnes} value={cargoTonnes} onChange={setCargoTonnes} />
      <ToolInput label={s.ladenDistance} hint={s.ladenDistanceHint} value={ladenDistance} onChange={setLadenDistance} />
      <ToolInput label={s.fuelRemaining} value={fuelRemaining} onChange={setFuelRemaining} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.per100Km} value={proUnit(proNum(result.per100Km, 2), s.unitL100km)} />
          <ResultRow label={s.kmPerLitre} value={proUnit(proNum(result.kmPerLitre, 2), s.unitKmL)} />
          <ResultRow label={s.mpgUs} value={proNum(result.mpgUs, 2)} />
          <ResultRow label={s.mpgImperial} value={proNum(result.mpgImperial, 2)} />
          <ResultRow label={s.totalCost} value={`${proNum(result.totalCost, 2)} ${s.currency}`} />
          <ResultRow label={s.costPerKm} value={`${proNum(result.costPerKm, 2)} ${s.currencyPerKm}`} />
          {result.tonneKm !== undefined && (
            <>
              <ResultRow
                label={s.tonneKmDistance}
                value={proUnit(proNum(result.tonneKm.distance, 1), s.unitKm)}
              />
              <ResultRow label={s.tonneKm} value={proUnit(proNum(result.tonneKm.total, 1), s.unitTkm)} />
              {result.tonneKm.rates !== undefined && (
                <>
                  <ResultRow
                    label={s.litresPer100TonneKm}
                    value={proUnit(proNum(result.tonneKm.rates.litres, 4), s.unitL100tkm)}
                  />
                  <ResultRow
                    label={s.costPerTonneKm}
                    value={`${proNum(result.tonneKm.rates.cost, 4)} ${s.currencyPerTkm}`}
                  />
                </>
              )}
            </>
          )}
          {result.range !== undefined && (
            <ResultRow label={s.range} value={proUnit(proNum(result.range, 0), s.unitKm)} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.distance, value: proUnit(proNum(result.distance, 1), s.unitKm) },
              { label: s.litres, value: proUnit(proNum(proParse(litres) ?? 0, 2), s.unitL) },
              { label: s.pricePerLitre, value: `${proNum(proParse(pricePerLitre) ?? 0, 2)} ${s.currencyPerL}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Prenosni odnos i brzina — gear ratio and road speed (none)                  */
/* -------------------------------------------------------------------------- */

export function GearRatioRoadSpeedTool() {
  const s = strings.pro.transport["gear-ratio-road-speed"];
  const [engineRpm, setEngineRpm] = useState("1400");
  const [gearRatio, setGearRatio] = useState("1,000");
  const [finalDrive, setFinalDrive] = useState("2,64");
  const [transferRatio, setTransferRatio] = useState("1,000");
  const [circumference, setCircumference] = useState("3178");
  const [gears, setGears] = useState("");
  const [shiftRpm, setShiftRpm] = useState("");
  const [desiredSpeed, setDesiredSpeed] = useState("");

  const gearRows = gears
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .flatMap((line) => {
      const value = proParse(line);
      return value === undefined ? [] : [value];
    });

  const typed = proParse(engineRpm) !== undefined && proParse(circumference) !== undefined;
  const result = gearRoadSpeed({
    engineRpm: proParse(engineRpm) ?? Number.NaN,
    gearRatio: proParse(gearRatio) ?? Number.NaN,
    finalDrive: proParse(finalDrive) ?? Number.NaN,
    transferRatio: proParse(transferRatio) ?? Number.NaN,
    rollingCircumference: proParse(circumference) ?? Number.NaN,
    gears: gearRows.length > 0 ? gearRows : undefined,
    shiftRpm: proParse(shiftRpm),
    desiredSpeed: proParse(desiredSpeed),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "engineRpm"
        ? s.errorEngineRpm
        : result.reason === "gearRatio"
          ? s.errorGearRatio
          : result.reason === "finalDrive"
            ? s.errorFinalDrive
            : result.reason === "transferRatio"
              ? s.errorTransferRatio
              : result.reason === "rollingCircumference"
                ? s.errorCircumference
                : result.reason === "gears"
                  ? s.errorGears
                  : result.reason === "shiftRpm"
                    ? s.errorShiftRpm
                    : s.errorGeneric;

  const kmh = (value: number): string => proUnit(proNum(value, 3), s.unitKmh);
  const rpm = (value: number): string => proUnit(proNum(value, 1), s.unitRpm);

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalRatio}: ${proNum(result.totalRatio, 4)}`,
        `${s.speed}: ${kmh(result.speed)}`,
        `${s.speedPer1000Rpm}: ${kmh(result.speedPer1000Rpm)}`,
        result.rpmAtDesiredSpeed !== undefined ? `${s.rpmAtDesiredSpeed}: ${rpm(result.rpmAtDesiredSpeed)}` : "",
        "",
        `${s.engineRpm}: ${rpm(proParse(engineRpm) ?? 0)}`,
        `${s.circumference}: ${proUnit(proNum(proParse(circumference) ?? 0, 0), s.unitMm)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.engineRpm} value={engineRpm} onChange={setEngineRpm} />
      <ToolInput label={s.gearRatio} value={gearRatio} onChange={setGearRatio} />
      <ToolInput label={s.finalDrive} value={finalDrive} onChange={setFinalDrive} />
      <ToolInput label={s.transferRatio} value={transferRatio} onChange={setTransferRatio} />
      <ToolInput label={s.circumference} hint={s.circumferenceHint} value={circumference} onChange={setCircumference} />
      <ToolTextArea label={s.gears} hint={s.gearsHint} value={gears} onChange={setGears} />
      <ToolInput label={s.shiftRpm} value={shiftRpm} onChange={setShiftRpm} />
      <ToolInput label={s.desiredSpeed} value={desiredSpeed} onChange={setDesiredSpeed} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.totalRatio} value={proNum(result.totalRatio, 4)} />
          <ResultRow label={s.wheelRpm} value={rpm(result.wheelRpm)} />
          <ResultRow label={s.speed} value={kmh(result.speed)} />
          <p className="tool__note">{s.speedNote}</p>
          <ResultRow label={s.speedPer1000Rpm} value={kmh(result.speedPer1000Rpm)} />
          {result.rpmAtDesiredSpeed !== undefined && (
            <ResultRow label={s.rpmAtDesiredSpeed} value={rpm(result.rpmAtDesiredSpeed)} />
          )}
          {result.gearLines.length > 0 && (
            <ToolTable
              head={[s.colRatio, s.colTotalRatio, s.colSpeed, s.colSpeedAtShift, s.colRpmDrop]}
              rows={result.gearLines.map((line) => [
                proNum(line.ratio, 3),
                proNum(line.totalRatio, 3),
                kmh(line.speed),
                kmh(line.speedAtShiftRpm),
                line.rpmDrop === undefined ? "—" : rpm(line.rpmDrop),
              ])}
            />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.engineRpm, value: rpm(proParse(engineRpm) ?? 0) },
              { label: s.circumference, value: proUnit(proNum(proParse(circumference) ?? 0, 0), s.unitMm) },
              { label: s.gears, value: String(gearRows.length) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Ukupna masa i nosivost — gross mass and payload (life-safety)               */
/* -------------------------------------------------------------------------- */

export function GvwPayloadTool() {
  const s = strings.pro.transport["gvw-payload"];
  const [mode, setMode] = useState<MassMode>("single");
  const [vehicleTare, setVehicleTare] = useState("");
  const [tareIncludes, setTareIncludes] = useState<"yes" | "no">("no");
  const [trailerTare, setTrailerTare] = useState("0");
  const [fuelLitres, setFuelLitres] = useState("0");
  const [fuelDensity, setFuelDensity] = useState(proNum(DIESEL_DENSITY_15C, 3));
  const [adBlueLitres, setAdBlueLitres] = useState("0");
  const [adBlueDensity, setAdBlueDensity] = useState(proNum(AUS32_DENSITY_20C, 2));
  const [crew, setCrew] = useState("");
  const [equipment, setEquipment] = useState("0");
  const [packaging, setPackaging] = useState("0");
  const [cargo, setCargo] = useState("0");
  const [vehicleLimit, setVehicleLimit] = useState("");
  const [trailerLimit, setTrailerLimit] = useState("");
  const [combinationLimit, setCombinationLimit] = useState("");

  const typed = proParse(vehicleTare) !== undefined;
  const result = grossMassAndPayload({
    mode,
    vehicleTare: proParse(vehicleTare) ?? Number.NaN,
    tareIncludesFuelAndCrew: tareIncludes === "yes",
    trailerTare: proParse(trailerTare),
    fuelLitres: proParse(fuelLitres) ?? Number.NaN,
    fuelDensity: proParse(fuelDensity),
    adBlueLitres: proParse(adBlueLitres) ?? Number.NaN,
    adBlueDensity: proParse(adBlueDensity),
    crew: proParse(crew) ?? Number.NaN,
    equipment: proParse(equipment) ?? Number.NaN,
    packaging: proParse(packaging) ?? Number.NaN,
    cargo: proParse(cargo) ?? Number.NaN,
    vehicleLimit: proParse(vehicleLimit),
    trailerLimit: proParse(trailerLimit),
    combinationLimit: proParse(combinationLimit),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "vehicleTare"
        ? s.errorVehicleTare
        : result.reason === "fuelLitres"
          ? s.errorFuelLitres
          : result.reason === "fuelDensity"
            ? s.errorFuelDensity
            : result.reason === "adBlueLitres"
              ? s.errorAdBlueLitres
              : result.reason === "adBlueDensity"
                ? s.errorAdBlueDensity
                : result.reason === "crew"
                  ? s.errorCrew
                  : result.reason === "equipment"
                    ? s.errorEquipment
                    : result.reason === "packaging"
                      ? s.errorPackaging
                      : result.reason === "cargo"
                        ? s.errorCargo
                        : result.reason === "trailerTare"
                          ? s.errorTrailerTare
                          : s.errorGeneric;

  const kg = (value: number): string => proUnit(proNum(value, 1), s.unitKg);

  const copyText = !result.ok
    ? ""
    : [
        `${s.runningMass}: ${kg(result.runningMass)}`,
        `${s.payloadMass}: ${kg(result.payloadMass)}`,
        `${s.totalMass}: ${kg(result.totalMass)}`,
        // The same label the row on screen carries: which limit applies is a
        // fact about the mode, and a copy naming the other one is a wrong number
        // in somebody's email.
        result.total.limit !== undefined
          ? `${mode === "single" ? s.vehicleLimit : s.combinationLimit}: ${kg(result.total.limit)}`
          : "",
        result.total.ratio !== undefined ? `${s.ratio}: ${proRatio(result.total.ratio)}` : "",
        result.minCargoHeadroom !== undefined ? `${s.minCargoHeadroom}: ${kg(result.minCargoHeadroom)}` : "",
        "",
        `${s.vehicleTare}: ${kg(proParse(vehicleTare) ?? 0)}`,
        `${s.mode}: ${mode === "single" ? s.modeSingle : s.modeCombination}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolSelect<MassMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "single", label: s.modeSingle },
          { id: "combination", label: s.modeCombination },
        ]}
      />
      <ToolInput label={s.vehicleTare} value={vehicleTare} onChange={setVehicleTare} />
      <ToolSelect<"yes" | "no">
        label={s.tareIncludes}
        value={tareIncludes}
        onChange={setTareIncludes}
        hint={s.tareIncludesHint}
        options={[
          { id: "no", label: s.no },
          { id: "yes", label: s.yes },
        ]}
      />
      {mode === "combination" && (
        <ToolInput label={s.trailerTare} value={trailerTare} onChange={setTrailerTare} />
      )}
      <ToolInput label={s.fuelLitres} value={fuelLitres} onChange={setFuelLitres} />
      <ToolInput label={s.fuelDensity} hint={s.fuelDensityHint} value={fuelDensity} onChange={setFuelDensity} />
      <ToolInput label={s.adBlueLitres} value={adBlueLitres} onChange={setAdBlueLitres} />
      <ToolInput label={s.adBlueDensity} hint={s.adBlueDensityHint} value={adBlueDensity} onChange={setAdBlueDensity} />
      <ToolInput label={s.crew} hint={s.crewHint} value={crew} onChange={setCrew} />
      <ToolInput label={s.equipment} value={equipment} onChange={setEquipment} />
      <ToolInput label={s.packaging} value={packaging} onChange={setPackaging} />
      <ToolInput label={s.cargo} value={cargo} onChange={setCargo} />
      <ToolInput label={s.vehicleLimit} hint={s.limitHint} value={vehicleLimit} onChange={setVehicleLimit} />
      {mode === "combination" && (
        <>
          <ToolInput label={s.trailerLimit} value={trailerLimit} onChange={setTrailerLimit} />
          <ToolInput label={s.combinationLimit} value={combinationLimit} onChange={setCombinationLimit} />
        </>
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.runningMass} value={kg(result.runningMass)} />
          {result.combinationEmptyMass !== undefined && (
            <ResultRow label={s.combinationEmptyMass} value={kg(result.combinationEmptyMass)} />
          )}
          <ResultRow label={s.payloadMass} value={kg(result.payloadMass)} />
          <ToolAgainstLimit
            label={s.totalMass}
            value={kg(result.totalMass)}
            limitLabel={mode === "single" ? s.vehicleLimit : s.combinationLimit}
            limit={result.total.limit === undefined ? undefined : kg(result.total.limit)}
            ratioLabel={s.ratio}
            ratio={proRatio(result.total.ratio)}
          />
          {result.total.minusLimit !== undefined && (
            <ResultRow label={s.diff} value={kg(result.total.minusLimit)} />
          )}
          {result.vehicleWithoutCargo !== undefined && (
            <ToolAgainstLimit
              label={s.vehicleWithoutCargo}
              value={kg(result.vehicleWithoutCargo.value)}
              limitLabel={s.vehicleLimit}
              limit={result.vehicleWithoutCargo.limit === undefined ? undefined : kg(result.vehicleWithoutCargo.limit)}
              ratioLabel={s.ratio}
              ratio={proRatio(result.vehicleWithoutCargo.ratio)}
            />
          )}
          {result.trailerWithoutCargo !== undefined && (
            <ToolAgainstLimit
              label={s.trailerWithoutCargo}
              value={kg(result.trailerWithoutCargo.value)}
              limitLabel={s.trailerLimit}
              limit={result.trailerWithoutCargo.limit === undefined ? undefined : kg(result.trailerWithoutCargo.limit)}
              ratioLabel={s.ratio}
              ratio={proRatio(result.trailerWithoutCargo.ratio)}
            />
          )}
          {result.payloadHeadroom !== undefined && (
            <ResultRow label={s.payloadHeadroom} value={kg(result.payloadHeadroom)} />
          )}
          {result.headroomUsed !== undefined && (
            <ResultRow label={s.headroomUsed} value={`${proNum(result.headroomUsed * 100, 2)} %`} />
          )}
          {result.minCargoHeadroom !== undefined && (
            <ResultRow label={s.minCargoHeadroom} value={kg(result.minCargoHeadroom)} />
          )}
          <p className="tool__note">{s.densityNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mode, value: mode === "single" ? s.modeSingle : s.modeCombination },
              { label: s.vehicleTare, value: kg(proParse(vehicleTare) ?? 0) },
              { label: s.cargo, value: kg(proParse(cargo) ?? 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Sila u vezicama — load lashing force (life-safety)                          */
/* -------------------------------------------------------------------------- */

export function LoadLashingForceTool() {
  const s = strings.pro.transport["load-lashing-force"];
  const [method, setMethod] = useState<LashingMethod>("topOver");
  const [mass, setMass] = useState("");
  const [forwardC, setForwardC] = useState("");
  const [backwardC, setBackwardC] = useState("");
  const [lateralC, setLateralC] = useState("");
  const [friction, setFriction] = useState("");
  const [verticalAngle, setVerticalAngle] = useState("");
  const [horizontalAngle, setHorizontalAngle] = useState("");
  const [transferFactor, setTransferFactor] = useState("");
  const [stf, setStf] = useState("");
  const [lc, setLc] = useState("");
  const [lashings, setLashings] = useState("0");

  const typed = proParse(mass) !== undefined;
  const result = lashingForce({
    method,
    mass: proParse(mass) ?? Number.NaN,
    forwardCoefficient: proParse(forwardC) ?? Number.NaN,
    backwardCoefficient: proParse(backwardC) ?? Number.NaN,
    lateralCoefficient: proParse(lateralC) ?? Number.NaN,
    friction: proParse(friction) ?? Number.NaN,
    verticalAngle: proParse(verticalAngle),
    horizontalAngle: proParse(horizontalAngle),
    transferFactor: proParse(transferFactor),
    stf: proParse(stf),
    lc: proParse(lc),
    lashings: proParse(lashings) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "mass"
        ? s.errorMass
        : result.reason === "forwardCoefficient" || result.reason === "backwardCoefficient" || result.reason === "lateralCoefficient"
          ? s.errorCoefficient
          : result.reason === "friction"
            ? s.errorFriction
            : result.reason === "lashings"
              ? s.errorLashings
              : result.reason === "verticalAngle"
                ? s.errorVerticalAngle
                : result.reason === "transferFactor"
                  ? s.errorTransferFactor
                  : result.reason === "stf"
                    ? s.errorStf
                    : result.reason === "horizontalAngle"
                      ? s.errorHorizontalAngle
                      : result.reason === "lc"
                        ? s.errorLc
                        : s.errorGeneric;

  const daN = (value: number): string => proUnit(proNum(value, 2), s.unitDaN);
  const kN = (value: number): string => proUnit(proNum(value, 3), s.unitKn);

  const direction = (label: string, dir: LashingDirection) => (
    <ToolSection title={label} key={label}>
      <ResultRow label={s.drivingForce} value={daN(dir.drivingForce)} />
      <ResultRow label={s.remainingForce} value={`${daN(dir.remainingForce)} / ${kN(dir.remainingForceKn)}`} />
      {dir.remainingForce <= 0 && <p className="tool__note">{s.noRemainingForce}</p>}
      {dir.quotient !== undefined && <ResultRow label={s.quotient} value={proNum(dir.quotient, 3)} />}
      {dir.setRatio !== undefined && <ResultRow label={s.setRatio} value={proNum(dir.setRatio, 3)} />}
    </ToolSection>
  );

  const copyText = !result.ok
    ? ""
    : [
        `${s.weight}: ${daN(result.weight)}`,
        result.arrangement !== undefined ? `${s.perLashing}: ${daN(result.arrangement.perLashing)}` : "",
        result.arrangement !== undefined ? `${s.setForce}: ${daN(result.arrangement.setForce)}` : "",
        `${s.forward} — ${s.remainingForce}: ${daN(result.forward.remainingForce)}`,
        `${s.backward} — ${s.remainingForce}: ${daN(result.backward.remainingForce)}`,
        `${s.lateral} — ${s.remainingForce}: ${daN(result.lateral.remainingForce)}`,
        "",
        `${s.mass}: ${proUnit(proNum(proParse(mass) ?? 0, 0), s.unitKg)}`,
        `${s.method}: ${method === "topOver" ? s.methodTopOver : method === "direct" ? s.methodDirect : s.methodBlocking}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolSelect<LashingMethod>
        label={s.method}
        value={method}
        onChange={setMethod}
        options={[
          { id: "topOver", label: s.methodTopOver },
          { id: "direct", label: s.methodDirect },
          { id: "blocking", label: s.methodBlocking },
        ]}
      />
      <ToolInput label={s.mass} value={mass} onChange={setMass} />
      <ToolInput label={s.forwardC} hint={s.coefficientHint} value={forwardC} onChange={setForwardC} />
      <ToolInput label={s.backwardC} value={backwardC} onChange={setBackwardC} />
      <ToolInput label={s.lateralC} value={lateralC} onChange={setLateralC} />
      <ToolInput label={s.friction} hint={s.coefficientHint} value={friction} onChange={setFriction} />
      {method !== "blocking" && (
        <ToolInput label={s.verticalAngle} hint={s.angleHint} value={verticalAngle} onChange={setVerticalAngle} />
      )}
      {method === "direct" && (
        <ToolInput label={s.horizontalAngle} hint={s.angleHint} value={horizontalAngle} onChange={setHorizontalAngle} />
      )}
      {method === "topOver" && (
        <>
          <ToolInput label={s.transferFactor} value={transferFactor} onChange={setTransferFactor} />
          <ToolInput label={s.stf} value={stf} onChange={setStf} />
        </>
      )}
      {method === "direct" && <ToolInput label={s.lc} value={lc} onChange={setLc} />}
      {method !== "blocking" && <ToolInput label={s.lashings} value={lashings} onChange={setLashings} />}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.weight} value={daN(result.weight)} />
          <ResultRow label={s.frictionForce} value={daN(result.frictionForce)} />
          {result.verticalForce !== undefined && (
            <ResultRow label={s.verticalForce} value={daN(result.verticalForce)} />
          )}
          {result.arrangement !== undefined && (
            <>
              <ResultRow
                label={s.perLashing}
                value={`${daN(result.arrangement.perLashing)} / ${kN(result.arrangement.perLashingKn)}`}
              />
              <ResultRow
                label={s.setForce}
                value={`${daN(result.arrangement.setForce)} / ${kN(result.arrangement.setForceKn)}`}
              />
            </>
          )}
          {direction(s.forward, result.forward)}
          {direction(s.backward, result.backward)}
          {direction(s.lateral, result.lateral)}
          <p className="tool__note">{s.slidingOnlyNote}</p>
          <ToolFormula>{method === "topOver" ? s.formulaTopOver : method === "direct" ? s.formulaDirect : s.formulaBlocking}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.method, value: method === "topOver" ? s.methodTopOver : method === "direct" ? s.methodDirect : s.methodBlocking },
              { label: s.mass, value: proUnit(proNum(proParse(mass) ?? 0, 0), s.unitKg) },
              { label: s.friction, value: friction.trim() },
              { label: s.lashings, value: lashings.trim() },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Iskorišćenje tovarnog prostora — loading space utilisation (none)           */
/* -------------------------------------------------------------------------- */

export function LoadingSpaceUtilisationTool() {
  const s = strings.pro.transport["loading-space-utilisation"];
  const [innerLength, setInnerLength] = useState("13,62");
  const [innerWidth, setInnerWidth] = useState("2,48");
  const [innerHeight, setInnerHeight] = useState("2,70");
  const [items, setItems] = useState("");
  const [ldmWidth, setLdmWidth] = useState("2,40");

  const rowTexts = items.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const parsedItems = rowTexts.flatMap((line) => {
    const [length, width, height, quantity, layers] = parseRowN(line, 5);
    if (length === undefined || width === undefined || height === undefined || quantity === undefined) {
      return [];
    }
    return [{ length, width, height, quantity, layers }];
  });

  const typed = parsedItems.length > 0;
  const result = loadingSpaceUtilisation({
    innerLength: proParse(innerLength) ?? Number.NaN,
    innerWidth: proParse(innerWidth) ?? Number.NaN,
    innerHeight: proParse(innerHeight) ?? Number.NaN,
    items: parsedItems,
    ldmWidth: proParse(ldmWidth) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "innerLength"
        ? s.errorInnerLength
        : result.reason === "innerWidth"
          ? s.errorInnerWidth
          : result.reason === "innerHeight"
            ? s.errorInnerHeight
            : result.reason === "ldmWidth"
              ? s.errorLdmWidth
              : result.reason === "itemDimensions"
                ? s.errorItemDimensions
                : s.errorItems;

  const m3 = (value: number): string => proUnit(proNum(value, 3), s.unitM3);
  const m2 = (value: number): string => proUnit(proNum(value, 3), s.unitM2);
  const ldm = (value: number): string => proUnit(proNum(value, 3), s.unitLdm);
  const pctLabel = (value: number): string => `${proNum(value * 100, 2)} %`;
  const basisLabel = (basis: string): string =>
    basis === "volume" ? s.basisVolume : basis === "floor" ? s.basisFloor : s.basisLoadingMetre;

  const copyText = !result.ok
    ? ""
    : [
        `${s.volumeShare}: ${pctLabel(result.volumeShare)}`,
        `${s.floorShare}: ${pctLabel(result.floorShare)}`,
        `${s.loadingMetreShare}: ${pctLabel(result.loadingMetreShare)}`,
        `${s.largestBasis}: ${basisLabel(result.largestBasis)}`,
        "",
        `${s.innerLength}: ${proUnit(proNum(proParse(innerLength) ?? 0, 2), s.unitM)}`,
        `${s.items}: ${parsedItems.length}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.innerLength} value={innerLength} onChange={setInnerLength} />
      <ToolInput label={s.innerWidth} value={innerWidth} onChange={setInnerWidth} />
      <ToolInput label={s.innerHeight} value={innerHeight} onChange={setInnerHeight} />
      <ToolTextArea label={s.items} hint={s.itemsHint} value={items} onChange={setItems} />
      <ToolInput label={s.ldmWidth} hint={s.ldmWidthHint} value={ldmWidth} onChange={setLdmWidth} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.availableVolume} value={m3(result.availableVolume)} />
          <ResultRow label={s.availableFloorArea} value={m2(result.availableFloorArea)} />
          <ResultRow label={s.availableLoadingMetres} value={ldm(result.availableLoadingMetres)} />
          <ResultRow label={s.usedVolume} value={m3(result.usedVolume)} />
          <ResultRow label={s.usedFloorArea} value={m2(result.usedFloorArea)} />
          <ResultRow label={s.usedLoadingMetres} value={ldm(result.usedLoadingMetres)} />
          <ResultRow label={s.volumeShare} value={pctLabel(result.volumeShare)} />
          <ResultRow label={s.floorShare} value={pctLabel(result.floorShare)} />
          <ResultRow label={s.loadingMetreShare} value={pctLabel(result.loadingMetreShare)} />
          <ResultRow label={s.remainingVolume} value={m3(result.remainingVolume)} />
          <ResultRow label={s.remainingFloorArea} value={m2(result.remainingFloorArea)} />
          <ResultRow label={s.remainingLoadingMetres} value={ldm(result.remainingLoadingMetres)} />
          {result.averageStackHeight !== undefined && (
            <ResultRow label={s.averageStackHeight} value={proUnit(proNum(result.averageStackHeight, 3), s.unitM)} />
          )}
          {result.stackHeightShare !== undefined && (
            <ResultRow label={s.stackHeightShare} value={pctLabel(result.stackHeightShare)} />
          )}
          <ResultRow label={s.largestBasis} value={basisLabel(result.largestBasis)} />
          {result.lines.some((line) => line.widerThanSpace) && (
            <p className="tool__note">{s.widerNote}</p>
          )}
          {result.lines.some((line) => line.tallerThanSpace) && (
            <p className="tool__note">{s.tallerNote}</p>
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.innerLength, value: proUnit(proNum(proParse(innerLength) ?? 0, 2), s.unitM) },
              { label: s.innerWidth, value: proUnit(proNum(proParse(innerWidth) ?? 0, 2), s.unitM) },
              { label: s.items, value: String(parsedItems.length) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Raspored paleta — pallet load plan (none)                                   */
/* -------------------------------------------------------------------------- */

type PalletType = "eur" | "industrial" | "custom";

export function PalletLoadPlanTool() {
  const s = strings.pro.transport["pallet-load-plan"];
  const [innerLength, setInnerLength] = useState("13,62");
  const [innerWidth, setInnerWidth] = useState("2,48");
  const [innerHeight, setInnerHeight] = useState("2,70");
  const [palletType, setPalletType] = useState<PalletType>("eur");
  const [customLength, setCustomLength] = useState("1200");
  const [customWidth, setCustomWidth] = useState("800");
  const [loadedHeight, setLoadedHeight] = useState("1050");
  const [stacking, setStacking] = useState<"yes" | "no">("no");
  const [maxLayers, setMaxLayers] = useState("2");
  const [rotationAllowed, setRotationAllowed] = useState<"yes" | "no">("yes");

  const footprint =
    palletType === "eur"
      ? PALLET_FOOTPRINTS.eur
      : palletType === "industrial"
        ? PALLET_FOOTPRINTS.industrial
        : { length: proParse(customLength) ?? Number.NaN, width: proParse(customWidth) ?? Number.NaN };

  const typed = proParse(innerLength) !== undefined;
  const result = palletLoadPlan({
    innerLength: proParse(innerLength) ?? Number.NaN,
    innerWidth: proParse(innerWidth) ?? Number.NaN,
    innerHeight: proParse(innerHeight) ?? Number.NaN,
    palletLength: footprint.length,
    palletWidth: footprint.width,
    loadedHeight: proParse(loadedHeight) ?? Number.NaN,
    stacking: stacking === "yes",
    maxLayers: proParse(maxLayers) ?? Number.NaN,
    rotationAllowed: rotationAllowed === "yes",
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "innerLength"
        ? s.errorInnerLength
        : result.reason === "innerWidth"
          ? s.errorInnerWidth
          : result.reason === "innerHeight"
            ? s.errorInnerHeight
            : result.reason === "palletLength"
              ? s.errorPalletLength
              : result.reason === "palletWidth"
                ? s.errorPalletWidth
                : result.reason === "loadedHeight"
                  ? s.errorLoadedHeight
                  : result.reason === "maxLayers"
                    ? s.errorMaxLayers
                    : s.errorGeneric;

  const m2 = (value: number): string => proUnit(proNum(value, 3), s.unitM2);
  const layout = (label: string, l: PalletLayout | undefined) =>
    l === undefined ? null : (
      <ToolSection title={label} key={label}>
        <ResultRow label={s.perFloor} value={String(l.perFloor)} />
        <ResultRow label={s.usedLength} value={proUnit(proNum(l.usedLength, 0), s.unitMm)} />
        <ResultRow label={s.remainingLength} value={proUnit(proNum(l.remainingLength, 0), s.unitMm)} />
        <ResultRow label={s.places} value={String(l.places)} />
        <ResultRow label={s.floorArea} value={m2(l.floorArea)} />
        <ResultRow label={s.freeFloorArea} value={m2(l.freeFloorArea)} />
      </ToolSection>
    );

  const copyText = !result.ok
    ? ""
    : [
        `${s.lengthwise} — ${s.places}: ${result.lengthwise.places}`,
        result.crosswise !== undefined ? `${s.crosswise} — ${s.places}: ${result.crosswise.places}` : "",
        result.combined !== undefined ? `${s.combined} — ${s.places}: ${result.combined.places}` : "",
        `${s.layers}: ${result.layers}`,
        "",
        `${s.innerLength}: ${proUnit(proNum(proParse(innerLength) ?? 0, 2), s.unitM)}`,
        `${s.palletType}: ${palletType === "eur" ? s.palletEur : palletType === "industrial" ? s.palletIndustrial : s.palletCustom}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.innerLength} value={innerLength} onChange={setInnerLength} />
      <ToolInput label={s.innerWidth} value={innerWidth} onChange={setInnerWidth} />
      <ToolInput label={s.innerHeight} value={innerHeight} onChange={setInnerHeight} />
      <ToolSelect<PalletType>
        label={s.palletType}
        value={palletType}
        onChange={setPalletType}
        options={[
          { id: "eur", label: s.palletEur },
          { id: "industrial", label: s.palletIndustrial },
          { id: "custom", label: s.palletCustom },
        ]}
      />
      {palletType === "custom" && (
        <>
          <ToolInput label={s.customLength} value={customLength} onChange={setCustomLength} />
          <ToolInput label={s.customWidth} value={customWidth} onChange={setCustomWidth} />
        </>
      )}
      <ToolInput label={s.loadedHeight} hint={s.loadedHeightHint} value={loadedHeight} onChange={setLoadedHeight} />
      <ToolSelect<"yes" | "no">
        label={s.stacking}
        value={stacking}
        onChange={setStacking}
        options={[
          { id: "no", label: s.no },
          { id: "yes", label: s.yes },
        ]}
      />
      {stacking === "yes" && <ToolInput label={s.maxLayers} value={maxLayers} onChange={setMaxLayers} />}
      <ToolSelect<"yes" | "no">
        label={s.rotationAllowed}
        value={rotationAllowed}
        onChange={setRotationAllowed}
        options={[
          { id: "yes", label: s.yes },
          { id: "no", label: s.no },
        ]}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <p className="tool__note">{s.geometryOnlyNote}</p>
          {layout(s.lengthwise, result.lengthwise)}
          {layout(s.crosswise, result.crosswise)}
          {result.combined !== undefined && (
            <>
              {layout(s.combined, result.combined)}
              <ResultRow label={s.combinedBands} value={`${result.combinedLengthwiseBands} + ${result.combinedCrosswiseBands}`} />
              <p className="tool__note">{s.combinedNote}</p>
            </>
          )}
          <ResultRow label={s.layers} value={String(result.layers)} />
          {result.layers === 0 && <p className="tool__note">{s.zeroLayersNote}</p>}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.innerLength, value: proUnit(proNum(proParse(innerLength) ?? 0, 2), s.unitM) },
              { label: s.palletType, value: palletType === "eur" ? s.palletEur : palletType === "industrial" ? s.palletIndustrial : s.palletCustom },
              { label: s.stacking, value: stacking === "yes" ? s.yes : s.no },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Potrošnja hladnjače — reefer fuel consumption (none)                        */
/* -------------------------------------------------------------------------- */

export function ReeferFuelConsumptionTool() {
  const s = strings.pro.transport["reefer-fuel-consumption"];
  const [continuousHours, setContinuousHours] = useState("0");
  const [continuousRate, setContinuousRate] = useState("");
  const [startStopHours, setStartStopHours] = useState("0");
  const [startStopRate, setStartStopRate] = useState("");
  const [pullDownHours, setPullDownHours] = useState("0");
  const [pullDownRate, setPullDownRate] = useState("");
  const [pricePerLitre, setPricePerLitre] = useState("");
  const [tankLitres, setTankLitres] = useState("0");
  const [tractionLitres, setTractionLitres] = useState("0");
  const [pallets, setPallets] = useState("0");
  const [days, setDays] = useState("0");

  const typed = proParse(continuousHours) !== undefined || proParse(startStopHours) !== undefined;
  const result = reeferFuelUse({
    continuousHours: proParse(continuousHours) ?? Number.NaN,
    continuousRate: proParse(continuousRate),
    startStopHours: proParse(startStopHours) ?? Number.NaN,
    startStopRate: proParse(startStopRate),
    pullDownHours: proParse(pullDownHours) ?? Number.NaN,
    pullDownRate: proParse(pullDownRate),
    pricePerLitre: proParse(pricePerLitre) ?? Number.NaN,
    tankLitres: proParse(tankLitres) ?? Number.NaN,
    tractionLitres: proParse(tractionLitres) ?? Number.NaN,
    pallets: proParse(pallets) ?? Number.NaN,
    days: proParse(days) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "continuousHours"
        ? s.errorHours
        : result.reason === "startStopHours"
          ? s.errorHours
          : result.reason === "pullDownHours"
            ? s.errorHours
            : result.reason === "pricePerLitre"
              ? s.errorPricePerLitre
              : result.reason === "tankLitres"
                ? s.errorTankLitres
                : result.reason === "tractionLitres"
                  ? s.errorTractionLitres
                  : result.reason === "pallets"
                    ? s.errorPallets
                    : result.reason === "days"
                      ? s.errorDays
                      : s.errorGeneric;

  const l = (value: number): string => proUnit(proNum(value, 2), s.unitL);
  const modeLabel = (mode: string): string =>
    mode === "continuous" ? s.modeContinuous : mode === "startStop" ? s.modeStartStop : s.modePullDown;

  const copyText = !result.ok
    ? ""
    : [
        `${s.litres}: ${l(result.litres)}`,
        `${s.cost}: ${proNum(result.cost, 2)} ${s.currency}`,
        result.litresPerDay !== undefined ? `${s.litresPerDay}: ${l(result.litresPerDay)}` : "",
        result.autonomyHours !== undefined ? `${s.autonomyHours}: ${proNum(result.autonomyHours, 2)} ${s.unitH}` : "",
        result.autonomyDays !== undefined ? `${s.autonomyDays}: ${proNum(result.autonomyDays, 2)} ${s.unitDays}` : "",
        "",
        `${s.continuousHours}: ${continuousHours.trim()} ${s.unitH}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.continuousHours} value={continuousHours} onChange={setContinuousHours} />
      <ToolInput label={s.continuousRate} hint={s.rateHint} value={continuousRate} onChange={setContinuousRate} />
      <ToolInput label={s.startStopHours} value={startStopHours} onChange={setStartStopHours} />
      <ToolInput label={s.startStopRate} value={startStopRate} onChange={setStartStopRate} />
      <ToolInput label={s.pullDownHours} value={pullDownHours} onChange={setPullDownHours} />
      <ToolInput label={s.pullDownRate} value={pullDownRate} onChange={setPullDownRate} />
      <ToolInput label={s.pricePerLitre} hint={s.pricePerLitreHint} value={pricePerLitre} onChange={setPricePerLitre} />
      <ToolInput label={s.tankLitres} value={tankLitres} onChange={setTankLitres} />
      <ToolInput label={s.tractionLitres} value={tractionLitres} onChange={setTractionLitres} />
      <ToolInput label={s.pallets} value={pallets} onChange={setPallets} />
      <ToolInput label={s.days} value={days} onChange={setDays} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.litres} value={l(result.litres)} />
          <ResultRow label={s.hours} value={`${proNum(result.hours, 1)} ${s.unitH}`} />
          {result.omittedModes.length > 0 && (
            <p className="tool__note">
              {s.omittedNote} {result.omittedModes.map((m) => `${modeLabel(m.mode)} (${proNum(m.hours, 1)} ${s.unitH})`).join(", ")}
            </p>
          )}
          {result.averageRate !== undefined && (
            <ResultRow label={s.averageRate} value={proUnit(proNum(result.averageRate, 3), s.unitLh)} />
          )}
          <ResultRow label={s.cost} value={`${proNum(result.cost, 2)} ${s.currency}`} />
          {result.litresPerDay !== undefined && <ResultRow label={s.litresPerDay} value={l(result.litresPerDay)} />}
          {result.costPerDay !== undefined && (
            <ResultRow label={s.costPerDay} value={`${proNum(result.costPerDay, 2)} ${s.currency}`} />
          )}
          {result.litresPerPallet !== undefined && (
            <ResultRow label={s.litresPerPallet} value={l(result.litresPerPallet)} />
          )}
          {result.costPerPallet !== undefined && (
            <ResultRow label={s.costPerPallet} value={`${proNum(result.costPerPallet, 2)} ${s.currency}`} />
          )}
          {result.litresPerPalletDay !== undefined && (
            <ResultRow label={s.litresPerPalletDay} value={l(result.litresPerPalletDay)} />
          )}
          {result.costPerPalletDay !== undefined && (
            <ResultRow label={s.costPerPalletDay} value={`${proNum(result.costPerPalletDay, 2)} ${s.currency}`} />
          )}
          {result.autonomyHours !== undefined && (
            <ResultRow label={s.autonomyHours} value={`${proNum(result.autonomyHours, 2)} ${s.unitH}`} />
          )}
          {result.autonomyDays !== undefined && (
            <ResultRow label={s.autonomyDays} value={`${proNum(result.autonomyDays, 2)} ${s.unitDays}`} />
          )}
          {result.autonomyDaysAtTripRate !== undefined && (
            <ResultRow label={s.autonomyDaysAtTripRate} value={`${proNum(result.autonomyDaysAtTripRate, 2)} ${s.unitDays}`} />
          )}
          {result.autonomyContinuousHours !== undefined && (
            <ResultRow label={s.autonomyContinuousHours} value={`${proNum(result.autonomyContinuousHours, 2)} ${s.unitH}`} />
          )}
          {result.autonomyStartStopHours !== undefined && (
            <ResultRow label={s.autonomyStartStopHours} value={`${proNum(result.autonomyStartStopHours, 2)} ${s.unitH}`} />
          )}
          {result.autonomyPullDownHours !== undefined && (
            <ResultRow label={s.autonomyPullDownHours} value={`${proNum(result.autonomyPullDownHours, 2)} ${s.unitH}`} />
          )}
          {result.shareOfTripFuel !== undefined && (
            <ResultRow label={s.shareOfTripFuel} value={`${proNum(result.shareOfTripFuel * 100, 2)} %`} />
          )}
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.continuousHours, value: `${continuousHours.trim()} ${s.unitH}` },
              { label: s.startStopHours, value: `${startStopHours.trim()} ${s.unitH}` },
              { label: s.pullDownHours, value: `${pullDownHours.trim()} ${s.unitH}` },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Servisni interval — service interval by km, hours and months (none)         */
/* -------------------------------------------------------------------------- */

export function ServiceIntervalKmHoursTool() {
  const s = strings.pro.transport["service-interval-km-hours"];
  const [currentKm, setCurrentKm] = useState("");
  const [lastServiceKm, setLastServiceKm] = useState("");
  const [distanceInterval, setDistanceInterval] = useState("");
  const [currentHours, setCurrentHours] = useState("0");
  const [lastServiceHours, setLastServiceHours] = useState("0");
  const [hoursInterval, setHoursInterval] = useState("");
  const [lastServiceDate, setLastServiceDate] = useState("");
  const [monthsInterval, setMonthsInterval] = useState("");
  const [kmPerDay, setKmPerDay] = useState("300");
  const [hoursPerDay, setHoursPerDay] = useState("8");
  const [today] = useState(todayIso());

  const typed = proParse(currentKm) !== undefined && proParse(lastServiceKm) !== undefined;
  const result = serviceInterval({
    currentKm: proParse(currentKm) ?? Number.NaN,
    lastServiceKm: proParse(lastServiceKm) ?? Number.NaN,
    distanceInterval: proParse(distanceInterval),
    currentHours: proParse(currentHours) ?? Number.NaN,
    lastServiceHours: proParse(lastServiceHours) ?? Number.NaN,
    hoursInterval: proParse(hoursInterval),
    lastServiceDate: parseDate(lastServiceDate),
    monthsInterval: proParse(monthsInterval),
    kmPerDay: proParse(kmPerDay) ?? Number.NaN,
    hoursPerDay: proParse(hoursPerDay) ?? Number.NaN,
    today: parseDate(today) ?? { year: 2000, month: 1, day: 1 },
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "currentKm"
        ? s.errorCurrentKm
        : result.reason === "lastServiceKm"
          ? s.errorLastServiceKm
          : result.reason === "currentHours"
            ? s.errorCurrentHours
            : result.reason === "kmPerDay"
              ? s.errorKmPerDay
              : result.reason === "hoursPerDay"
                ? s.errorHoursPerDay
                : result.reason === "lastServiceDate"
                  ? s.errorLastServiceDate
                  : result.reason === "monthsInterval"
                    ? s.errorMonthsInterval
                    : s.errorGeneric;

  const basisName = (name: string): string =>
    name === "distance" ? s.basisDistance : name === "hours" ? s.basisHours : s.basisMonths;

  const copyText = !result.ok
    ? ""
    : [
        `${s.travelledKm}: ${proNum(result.travelledKm, 0)} ${s.unitKm}`,
        `${s.travelledHours}: ${proNum(result.travelledHours, 0)} ${s.unitH}`,
        result.distance?.date !== undefined ? `${s.basisDistance}: ${fmtDate(result.distance.date)}` : "",
        result.hours?.date !== undefined ? `${s.basisHours}: ${fmtDate(result.hours.date)}` : "",
        result.months?.date !== undefined ? `${s.basisMonths}: ${fmtDate(result.months.date)}` : "",
        result.first !== undefined ? `${s.first}: ${basisName(result.first)}` : "",
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.currentKm} value={currentKm} onChange={setCurrentKm} />
      <ToolInput label={s.lastServiceKm} value={lastServiceKm} onChange={setLastServiceKm} />
      <ToolInput label={s.distanceInterval} hint={s.intervalHint} value={distanceInterval} onChange={setDistanceInterval} />
      <ToolInput label={s.currentHours} value={currentHours} onChange={setCurrentHours} />
      <ToolInput label={s.lastServiceHours} value={lastServiceHours} onChange={setLastServiceHours} />
      <ToolInput label={s.hoursInterval} hint={s.intervalHint} value={hoursInterval} onChange={setHoursInterval} />
      <ToolInput label={s.lastServiceDate} hint={s.dateHint} value={lastServiceDate} onChange={setLastServiceDate} />
      <ToolInput label={s.monthsInterval} hint={s.intervalHint} value={monthsInterval} onChange={setMonthsInterval} />
      <ToolInput label={s.kmPerDay} value={kmPerDay} onChange={setKmPerDay} />
      <ToolInput label={s.hoursPerDay} value={hoursPerDay} onChange={setHoursPerDay} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.travelledKm} value={proUnit(proNum(result.travelledKm, 0), s.unitKm)} />
          <ResultRow label={s.travelledHours} value={proUnit(proNum(result.travelledHours, 0), s.unitH)} />
          {result.distance !== undefined && (
            <ToolSection title={s.basisDistance}>
              <ResultRow label={s.remaining} value={proUnit(proNum(result.distance.remaining, 0), s.unitKm)} />
              {result.distance.dueAt !== undefined && (
                <ResultRow label={s.dueAt} value={proUnit(proNum(result.distance.dueAt, 0), s.unitKm)} />
              )}
              {result.distance.date !== undefined && <ResultRow label={s.date} value={fmtDate(result.distance.date)} />}
            </ToolSection>
          )}
          {result.hours !== undefined && (
            <ToolSection title={s.basisHours}>
              <ResultRow label={s.remaining} value={proUnit(proNum(result.hours.remaining, 0), s.unitH)} />
              {result.hours.dueAt !== undefined && (
                <ResultRow label={s.dueAt} value={proUnit(proNum(result.hours.dueAt, 0), s.unitH)} />
              )}
              {result.hours.date !== undefined && <ResultRow label={s.date} value={fmtDate(result.hours.date)} />}
            </ToolSection>
          )}
          {result.months !== undefined && (
            <ToolSection title={s.basisMonths}>
              <ResultRow label={s.remaining} value={proUnit(proNum(result.months.remaining, 0), s.unitDays)} />
              {result.months.date !== undefined && <ResultRow label={s.date} value={fmtDate(result.months.date)} />}
            </ToolSection>
          )}
          {result.first !== undefined && <ResultRow label={s.first} value={basisName(result.first)} />}
          {result.daysToNext !== undefined && (
            <ResultRow label={s.daysToNext} value={proUnit(proNum(result.daysToNext, 0), s.unitDays)} />
          )}
          {result.kmPerEngineHour !== undefined && (
            <ResultRow label={s.kmPerEngineHour} value={proUnit(proNum(result.kmPerEngineHour, 3), s.unitKmh)} />
          )}
          {result.distanceIntervalInHours !== undefined && (
            <ResultRow label={s.distanceIntervalInHours} value={proUnit(proNum(result.distanceIntervalInHours, 1), s.unitH)} />
          )}
          {result.hoursIntervalInKm !== undefined && (
            <ResultRow label={s.hoursIntervalInKm} value={proUnit(proNum(result.hoursIntervalInKm, 1), s.unitKm)} />
          )}
          <p className="tool__note">{s.averagesNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.currentKm, value: proUnit(proNum(proParse(currentKm) ?? 0, 0), s.unitKm) },
              { label: s.lastServiceKm, value: proUnit(proNum(proParse(lastServiceKm) ?? 0, 0), s.unitKm) },
              { label: s.today, value: today },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Odstupanje brzinomera — speedometer / tyre-size deviation (none)            */
/* -------------------------------------------------------------------------- */

export function SpeedometerTyreDeviationTool() {
  const s = strings.pro.transport["speedometer-tyre-deviation"];
  const [currentWidth, setCurrentWidth] = useState("315");
  const [currentProfile, setCurrentProfile] = useState("70");
  const [currentRim, setCurrentRim] = useState("22,5");
  const [replacementWidth, setReplacementWidth] = useState("315");
  const [replacementProfile, setReplacementProfile] = useState("80");
  const [replacementRim, setReplacementRim] = useState("22,5");
  const [measuredCurrent, setMeasuredCurrent] = useState("0");
  const [measuredReplacement, setMeasuredReplacement] = useState("0");
  const [deflection, setDeflection] = useState("1,000");
  const [indicatedSpeed, setIndicatedSpeed] = useState("90");
  const [indicatedDistance, setIndicatedDistance] = useState("100");
  const [desiredTrueSpeed, setDesiredTrueSpeed] = useState("");
  const [characteristicCoefficient, setCharacteristicCoefficient] = useState("");

  const typed = proParse(currentWidth) !== undefined && proParse(replacementWidth) !== undefined;
  const result = tyreChangeDeviation({
    current: {
      width: proParse(currentWidth) ?? Number.NaN,
      profile: proParse(currentProfile) ?? Number.NaN,
      rim: proParse(currentRim) ?? Number.NaN,
    },
    replacement: {
      width: proParse(replacementWidth) ?? Number.NaN,
      profile: proParse(replacementProfile) ?? Number.NaN,
      rim: proParse(replacementRim) ?? Number.NaN,
    },
    measuredCurrent: proParse(measuredCurrent) ?? Number.NaN,
    measuredReplacement: proParse(measuredReplacement) ?? Number.NaN,
    deflection: proParse(deflection) ?? Number.NaN,
    indicatedSpeed: proParse(indicatedSpeed) ?? Number.NaN,
    indicatedDistance: proParse(indicatedDistance) ?? Number.NaN,
    desiredTrueSpeed: proParse(desiredTrueSpeed),
    characteristicCoefficient: proParse(characteristicCoefficient),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "tyreWidth"
        ? s.errorTyreWidth
        : result.reason === "tyreProfile"
          ? s.errorTyreProfile
          : result.reason === "tyreRim"
            ? s.errorTyreRim
            : result.reason === "deflection"
              ? s.errorDeflection
              : result.reason === "indicatedSpeed"
                ? s.errorIndicatedSpeed
                : s.errorGeneric;

  const mm = (value: number): string => proUnit(proNum(value, 1), s.unitMm);
  const kmh = (value: number): string => proUnit(proNum(value, 2), s.unitKmh);

  const copyText = !result.ok
    ? ""
    : [
        `${s.circumferenceRatio}: ${proNum(result.circumferenceRatio, 6)}`,
        `${s.trueSpeed}: ${kmh(result.trueSpeed)}`,
        `${s.trueDistance}: ${proUnit(proNum(result.trueDistance, 2), s.unitKm)}`,
        `${s.errorPer100Km}: ${proUnit(proNum(result.errorPer100Km, 2), s.unitKm)}`,
        `${s.diameterChange}: ${mm(result.diameterChange)} (${proNum(result.diameterChangeShare * 100, 2)} %)`,
        `${s.axleHeightChange}: ${mm(result.axleHeightChange)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.currentWidth} value={currentWidth} onChange={setCurrentWidth} />
      <ToolInput label={s.currentProfile} value={currentProfile} onChange={setCurrentProfile} />
      <ToolInput label={s.currentRim} value={currentRim} onChange={setCurrentRim} />
      <ToolInput label={s.replacementWidth} value={replacementWidth} onChange={setReplacementWidth} />
      <ToolInput label={s.replacementProfile} value={replacementProfile} onChange={setReplacementProfile} />
      <ToolInput label={s.replacementRim} value={replacementRim} onChange={setReplacementRim} />
      <ToolInput label={s.measuredCurrent} hint={s.measuredHint} value={measuredCurrent} onChange={setMeasuredCurrent} />
      <ToolInput label={s.measuredReplacement} value={measuredReplacement} onChange={setMeasuredReplacement} />
      <ToolInput label={s.deflection} hint={s.deflectionHint} value={deflection} onChange={setDeflection} />
      <ToolInput label={s.indicatedSpeed} value={indicatedSpeed} onChange={setIndicatedSpeed} />
      <ToolInput label={s.indicatedDistance} value={indicatedDistance} onChange={setIndicatedDistance} />
      <ToolInput label={s.desiredTrueSpeed} value={desiredTrueSpeed} onChange={setDesiredTrueSpeed} />
      <ToolInput label={s.characteristicCoefficient} hint={s.characteristicCoefficientHint} value={characteristicCoefficient} onChange={setCharacteristicCoefficient} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.currentDiameter} value={mm(result.currentDiameter)} />
          <ResultRow label={s.replacementDiameter} value={mm(result.replacementDiameter)} />
          <ResultRow
            label={s.currentCircumference}
            value={`${mm(result.currentCircumference)} (${result.currentFromMeasurement ? s.sourceMeasured : s.sourceGeometry})`}
          />
          <ResultRow
            label={s.replacementCircumference}
            value={`${mm(result.replacementCircumference)} (${result.replacementFromMeasurement ? s.sourceMeasured : s.sourceGeometry})`}
          />
          {result.mixedSource && <p className="tool__note">{s.mixedSourceNote}</p>}
          <ResultRow label={s.currentRevsPerKm} value={proNum(result.currentRevsPerKm, 2)} />
          <ResultRow label={s.replacementRevsPerKm} value={proNum(result.replacementRevsPerKm, 2)} />
          <ResultRow label={s.circumferenceRatio} value={proNum(result.circumferenceRatio, 6)} />
          <ResultRow label={s.diameterChange} value={`${mm(result.diameterChange)} (${proNum(result.diameterChangeShare * 100, 2)} %)`} />
          <ResultRow label={s.axleHeightChange} value={mm(result.axleHeightChange)} />
          <p className="tool__note">{s.axleHeightNote}</p>
          <ResultRow label={s.trueSpeed} value={kmh(result.trueSpeed)} />
          {result.indicatedForDesired !== undefined && (
            <ResultRow label={s.indicatedForDesired} value={kmh(result.indicatedForDesired)} />
          )}
          <ResultRow label={s.trueDistance} value={proUnit(proNum(result.trueDistance, 2), s.unitKm)} />
          <ResultRow label={s.errorPer100Km} value={proUnit(proNum(result.errorPer100Km, 2), s.unitKm)} />
          {result.wOverRatio !== undefined && (
            <ResultRow label={s.wOverRatio} value={proNum(result.wOverRatio, 4)} />
          )}
          <p className="tool__note">{s.calibrationNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.currentWidth, value: `${currentWidth.trim()}/${currentProfile.trim()} R${currentRim.trim()}` },
              { label: s.replacementWidth, value: `${replacementWidth.trim()}/${replacementProfile.trim()} R${replacementRim.trim()}` },
              { label: s.indicatedSpeed, value: kmh(proParse(indicatedSpeed) ?? 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Zapremina rezervoara — tank volume by dipstick level (none)                 */
/* -------------------------------------------------------------------------- */

type TankShapeKind = "lying-cylinder" | "standing-cylinder" | "box";

export function TankVolumeByLevelTool() {
  const s = strings.pro.transport["tank-volume-by-level"];
  const [kind, setKind] = useState<TankShapeKind>("lying-cylinder");
  const [diameter, setDiameter] = useState("2000");
  const [length, setLength] = useState("6000");
  const [width, setWidth] = useState("2000");
  const [height, setHeight] = useState("1500");
  const [domeDepth, setDomeDepth] = useState("0");
  const [level, setLevel] = useState("700");
  const [density, setDensity] = useState(proNum(DIESEL_DENSITY_15C, 3));
  const [pricePerLitre, setPricePerLitre] = useState("0");
  const [targetVolume, setTargetVolume] = useState("");

  const shape: TankShape =
    kind === "lying-cylinder"
      ? {
          kind,
          diameter: proParse(diameter) ?? Number.NaN,
          length: proParse(length) ?? Number.NaN,
          domeDepth: proParse(domeDepth) ?? Number.NaN,
        }
      : kind === "standing-cylinder"
        ? { kind, diameter: proParse(diameter) ?? Number.NaN, height: proParse(height) ?? Number.NaN }
        : {
            kind,
            length: proParse(length) ?? Number.NaN,
            width: proParse(width) ?? Number.NaN,
            height: proParse(height) ?? Number.NaN,
          };

  const typed = proParse(level) !== undefined;
  const result = tankVolumeByLevel({
    shape,
    level: proParse(level) ?? Number.NaN,
    density: proParse(density),
    pricePerLitre: proParse(pricePerLitre),
    targetVolume: proParse(targetVolume),
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "level"
        ? s.errorLevel
        : result.reason === "diameter"
          ? s.errorDiameter
          : result.reason === "length"
            ? s.errorLength
            : result.reason === "domeDepth"
              ? s.errorDomeDepth
              : result.reason === "height"
                ? s.errorHeight
                : result.reason === "width"
                  ? s.errorWidth
                  : result.reason === "density"
                    ? s.errorDensity
                    : result.reason === "pricePerLitre"
                      ? s.errorPricePerLitre
                      : result.reason === "targetVolume"
                        ? s.errorTargetVolume
                        : s.errorGeneric;

  const litres = (value: number): string => proUnit(proNum(value, 2), s.unitL);

  const copyText = !result.ok
    ? ""
    : [
        `${s.volume}: ${litres(result.volume)}`,
        `${s.fullVolume}: ${litres(result.fullVolume)}`,
        `${s.fillShare}: ${proNum(result.fillShare * 100, 2)} %`,
        `${s.emptySpace}: ${litres(result.emptySpace)}`,
        result.mass !== undefined ? `${s.mass}: ${proNum(result.mass, 2)} ${s.unitKg}` : "",
        result.value !== undefined ? `${s.value}: ${proNum(result.value, 2)} ${s.currency}` : "",
        result.levelForTarget !== undefined
          ? `${s.levelForTarget}: ${proUnit(proNum(result.levelForTarget, 0), s.unitMm)}`
          : "",
        "",
        `${s.level}: ${proUnit(proNum(proParse(level) ?? 0, 0), s.unitMm)}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolSelect<TankShapeKind>
        label={s.shape}
        value={kind}
        onChange={setKind}
        options={[
          { id: "lying-cylinder", label: s.shapeLying },
          { id: "standing-cylinder", label: s.shapeStanding },
          { id: "box", label: s.shapeBox },
        ]}
      />
      {(kind === "lying-cylinder" || kind === "standing-cylinder") && (
        <ToolInput label={s.diameter} value={diameter} onChange={setDiameter} />
      )}
      {(kind === "lying-cylinder" || kind === "box") && (
        <ToolInput label={s.length} hint={kind === "lying-cylinder" ? s.lengthHint : undefined} value={length} onChange={setLength} />
      )}
      {kind === "box" && <ToolInput label={s.width} value={width} onChange={setWidth} />}
      {(kind === "standing-cylinder" || kind === "box") && (
        <ToolInput label={s.height} value={height} onChange={setHeight} />
      )}
      {kind === "lying-cylinder" && (
        <ToolInput label={s.domeDepth} hint={s.domeDepthHint} value={domeDepth} onChange={setDomeDepth} />
      )}
      <ToolInput label={s.level} value={level} onChange={setLevel} />
      <ToolInput label={s.density} hint={s.densityHint} value={density} onChange={setDensity} />
      <ToolInput label={s.pricePerLitre} value={pricePerLitre} onChange={setPricePerLitre} />
      <ToolInput label={s.targetVolume} value={targetVolume} onChange={setTargetVolume} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.volume} value={litres(result.volume)} />
          <ResultRow label={s.volumeM3} value={`${proNum(result.volumeM3, 3)} ${s.unitM3}`} />
          <ResultRow label={s.fullVolume} value={litres(result.fullVolume)} />
          <ResultRow label={s.fillShare} value={`${proNum(result.fillShare * 100, 2)} %`} />
          <ResultRow label={s.emptySpace} value={litres(result.emptySpace)} />
          {result.mass !== undefined && <ResultRow label={s.mass} value={`${proNum(result.mass, 2)} ${s.unitKg}`} />}
          {result.value !== undefined && <ResultRow label={s.value} value={`${proNum(result.value, 2)} ${s.currency}`} />}
          <ResultRow label={s.sensitivity} value={proUnit(proNum(result.sensitivityLPerMm, 3), s.unitLmm)} />
          {result.levelAboveCapacity && <p className="tool__note">{s.levelAboveCapacityNote}</p>}
          {result.levelForTarget !== undefined && (
            <ResultRow label={s.levelForTarget} value={proUnit(proNum(result.levelForTarget, 0), s.unitMm)} />
          )}
          <p className="tool__note">{s.calibrationNote}</p>
          <ToolFormula>{kind === "lying-cylinder" ? s.formulaLying : s.formulaOther}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.shape, value: kind === "lying-cylinder" ? s.shapeLying : kind === "standing-cylinder" ? s.shapeStanding : s.shapeBox },
              { label: s.level, value: proUnit(proNum(proParse(level) ?? 0, 0), s.unitMm) },
              { label: s.density, value: proUnit(proNum(proParse(density) ?? 0, 3), s.unitKgL) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Cena ture — trip cost and quote (financial)                                 */
/* -------------------------------------------------------------------------- */

type CostPerKmKind = "perTotalKm" | "perLadenKm";

/** The `costPerKmKind` selector is purely descriptive — it changes no arithmetic,
 * only which sentence names the rate that was typed, per the review's demand
 * that double-counted empty running be visible rather than silent. */
export function TripCostQuoteTool() {
  const s = strings.pro.transport["trip-cost-quote"];
  const [ladenKm, setLadenKm] = useState("1240");
  const [emptyKm, setEmptyKm] = useState("160");
  const [costPerKmKind, setCostPerKmKind] = useState<CostPerKmKind>("perTotalKm");
  const [costPerKm, setCostPerKm] = useState("106,35");
  const [tolls, setTolls] = useState("0");
  const [ferriesAndVignettes, setFerriesAndVignettes] = useState("0");
  const [terminalCharges, setTerminalCharges] = useState("0");
  const [waitingHours, setWaitingHours] = useState("0");
  const [waitingRate, setWaitingRate] = useState("0");
  const [days, setDays] = useState("0");
  const [perDiem, setPerDiem] = useState("");
  const [nights, setNights] = useState("0");
  const [nightRate, setNightRate] = useState("0");
  const [otherCosts, setOtherCosts] = useState("0");
  const [marginMethod, setMarginMethod] = useState<MarginMethod>("onPrice");
  const [marginOnPrice, setMarginOnPrice] = useState("15");
  const [markupOnCost, setMarkupOnCost] = useState("");
  const [vatRate, setVatRate] = useState("");
  const [cargoTonnes, setCargoTonnes] = useState("0");

  const typed = proParse(ladenKm) !== undefined || proParse(costPerKm) !== undefined;
  const result = tripCostQuote({
    ladenKm: proParse(ladenKm) ?? Number.NaN,
    emptyKm: proParse(emptyKm) ?? Number.NaN,
    costPerKm: proParse(costPerKm) ?? Number.NaN,
    tolls: proParse(tolls) ?? Number.NaN,
    ferriesAndVignettes: proParse(ferriesAndVignettes) ?? Number.NaN,
    terminalCharges: proParse(terminalCharges) ?? Number.NaN,
    waitingHours: proParse(waitingHours) ?? Number.NaN,
    waitingRate: proParse(waitingRate) ?? Number.NaN,
    days: proParse(days) ?? Number.NaN,
    perDiem: proParse(perDiem) ?? Number.NaN,
    nights: proParse(nights) ?? Number.NaN,
    nightRate: proParse(nightRate) ?? Number.NaN,
    otherCosts: proParse(otherCosts) ?? Number.NaN,
    marginMethod,
    marginOnPrice: pct(marginOnPrice),
    markupOnCost: pct(markupOnCost),
    vatRate: pct(vatRate),
    cargoTonnes: proParse(cargoTonnes) ?? Number.NaN,
  });

  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "ladenKm"
        ? s.errorLadenKm
        : result.reason === "emptyKm"
          ? s.errorEmptyKm
          : result.reason === "costPerKm"
            ? s.errorCostPerKm
            : result.reason === "tolls"
              ? s.errorTolls
              : result.reason === "ferriesAndVignettes"
                ? s.errorFerriesAndVignettes
                : result.reason === "terminalCharges"
                  ? s.errorTerminalCharges
                  : result.reason === "waitingHours"
                    ? s.errorWaitingHours
                    : result.reason === "waitingRate"
                      ? s.errorWaitingRate
                      : result.reason === "days"
                        ? s.errorDays
                        : result.reason === "perDiem"
                          ? s.errorPerDiem
                          : result.reason === "nights"
                            ? s.errorNights
                            : result.reason === "nightRate"
                              ? s.errorNightRate
                              : result.reason === "otherCosts"
                                ? s.errorOtherCosts
                                : result.reason === "cargoTonnes"
                                  ? s.errorCargoTonnes
                                  : result.reason === "marginOnPrice"
                                    ? s.errorMarginOnPrice
                                    : result.reason === "markupOnCost"
                                      ? s.errorMarkupOnCost
                                      : result.reason === "vatRate"
                                        ? s.errorVatRate
                                        : s.errorGeneric;

  const rsd = (value: number): string => `${proNum(value, 2)} ${s.currency}`;

  const copyText = !result.ok
    ? ""
    : [
        `${s.totalKm}: ${proUnit(proNum(result.totalKm, 0), s.unitKm)}`,
        `${s.drivingCost}: ${rsd(result.drivingCost)}`,
        `${s.roadCost}: ${rsd(result.roadCost)}`,
        `${s.driverCost}: ${rsd(result.driverCost)}`,
        `${s.totalCost}: ${rsd(result.totalCost)}`,
        `${s.priceBeforeVat}: ${rsd(result.priceBeforeVat)}`,
        result.priceAtMargin !== undefined ? `${s.priceAtMargin}: ${rsd(result.priceAtMargin)}` : "",
        result.priceAtMarkup !== undefined ? `${s.priceAtMarkup}: ${rsd(result.priceAtMarkup)}` : "",
        `${s.breakEvenPrice}: ${rsd(result.breakEvenPrice)}`,
        result.vat !== undefined ? `${s.vat}: ${rsd(result.vat)}` : "",
        result.priceWithVat !== undefined ? `${s.priceWithVat}: ${rsd(result.priceWithVat)}` : "",
        `${s.profit}: ${rsd(result.profit)}`,
        "",
        `${s.costPerKmKind}: ${costPerKmKind === "perTotalKm" ? s.costPerKmKindTotal : s.costPerKmKindLaden}`,
        `${s.costPerKm}: ${proNum(proParse(costPerKm) ?? 0, 3)} ${s.unitRsdKm}`,
      ]
        .filter((line) => line !== "")
        .join("\n");

  return (
    <>
      <ToolInput label={s.ladenKm} value={ladenKm} onChange={setLadenKm} />
      <ToolInput label={s.emptyKm} value={emptyKm} onChange={setEmptyKm} />
      <ToolSelect<CostPerKmKind>
        label={s.costPerKmKind}
        hint={s.costPerKmKindHint}
        value={costPerKmKind}
        onChange={setCostPerKmKind}
        options={[
          { id: "perTotalKm", label: s.costPerKmKindTotal },
          { id: "perLadenKm", label: s.costPerKmKindLaden },
        ]}
      />
      <ToolInput label={s.costPerKm} hint={s.costPerKmHint} value={costPerKm} onChange={setCostPerKm} />
      <ToolInput label={s.tolls} value={tolls} onChange={setTolls} />
      <ToolInput label={s.ferriesAndVignettes} value={ferriesAndVignettes} onChange={setFerriesAndVignettes} />
      <ToolInput label={s.terminalCharges} value={terminalCharges} onChange={setTerminalCharges} />
      <ToolInput label={s.waitingHours} value={waitingHours} onChange={setWaitingHours} />
      <ToolInput label={s.waitingRate} value={waitingRate} onChange={setWaitingRate} />
      <ToolInput label={s.days} value={days} onChange={setDays} />
      <ToolInput label={s.perDiem} hint={s.perDiemHint} value={perDiem} onChange={setPerDiem} />
      <ToolInput label={s.nights} value={nights} onChange={setNights} />
      <ToolInput label={s.nightRate} value={nightRate} onChange={setNightRate} />
      <ToolInput label={s.otherCosts} value={otherCosts} onChange={setOtherCosts} />
      <ToolSelect<MarginMethod>
        label={s.marginMethod}
        value={marginMethod}
        onChange={setMarginMethod}
        options={[
          { id: "onPrice", label: s.marginMethodOnPrice },
          { id: "onCost", label: s.marginMethodOnCost },
        ]}
      />
      <ToolInput label={s.marginOnPrice} value={marginOnPrice} onChange={setMarginOnPrice} />
      <ToolInput label={s.markupOnCost} value={markupOnCost} onChange={setMarkupOnCost} />
      <ToolInput label={s.vatRate} hint={s.vatRateHint} value={vatRate} onChange={setVatRate} />
      <ToolInput label={s.cargoTonnes} value={cargoTonnes} onChange={setCargoTonnes} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <p className="tool__note">{s.doubleCountingNote}</p>
          <ResultRow label={s.totalKm} value={proUnit(proNum(result.totalKm, 0), s.unitKm)} />
          <ToolTable
            head={[s.colGroup, s.colAmount]}
            rows={[
              [s.drivingCost, rsd(result.drivingCost)],
              [s.roadCost, rsd(result.roadCost)],
              [s.driverCost, rsd(result.driverCost)],
              [s.totalCost, rsd(result.totalCost)],
            ]}
          />
          <ToolTable
            head={[s.colMarginMethod, s.colPrice]}
            rows={[
              [s.priceAtMargin, result.priceAtMargin === undefined ? "—" : rsd(result.priceAtMargin)],
              [s.priceAtMarkup, result.priceAtMarkup === undefined ? "—" : rsd(result.priceAtMarkup)],
            ]}
          />
          <p className="tool__note">{s.marginEquivalenceNote}</p>
          <ResultRow label={s.priceBeforeVat} value={rsd(result.priceBeforeVat)} mono />
          {result.vat !== undefined && <ResultRow label={s.vat} value={rsd(result.vat)} />}
          {result.priceWithVat !== undefined && (
            <ResultRow label={s.priceWithVat} value={rsd(result.priceWithVat)} />
          )}
          <ResultRow label={s.breakEvenPrice} value={rsd(result.breakEvenPrice)} />
          {result.breakEvenPricePerKm !== undefined && (
            <ResultRow label={s.breakEvenPricePerKm} value={`${proNum(result.breakEvenPricePerKm, 3)} ${s.unitRsdKm}`} />
          )}
          <ResultRow label={s.profit} value={rsd(result.profit)} />
          {result.profitPerDay !== undefined && <ResultRow label={s.profitPerDay} value={rsd(result.profitPerDay)} />}
          {result.profitShareOfPrice !== undefined && (
            <ResultRow label={s.profitShareOfPrice} value={`${proNum(result.profitShareOfPrice * 100, 2)} %`} />
          )}
          {result.profitShareOfCost !== undefined && (
            <ResultRow label={s.profitShareOfCost} value={`${proNum(result.profitShareOfCost * 100, 2)} %`} />
          )}
          {result.pricePerKm !== undefined && (
            <ResultRow label={s.pricePerKm} value={`${proNum(result.pricePerKm, 3)} ${s.unitRsdKm}`} />
          )}
          {result.pricePerLadenKm !== undefined && (
            <ResultRow label={s.pricePerLadenKm} value={`${proNum(result.pricePerLadenKm, 3)} ${s.unitRsdKm}`} />
          )}
          {result.pricePerTonne !== undefined && (
            <ResultRow label={s.pricePerTonne} value={rsd(result.pricePerTonne)} />
          )}
          <p className="tool__note">{s.regulatedFiguresNote}</p>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.ladenKm, value: proUnit(proNum(proParse(ladenKm) ?? 0, 0), s.unitKm) },
              { label: s.emptyKm, value: proUnit(proNum(proParse(emptyKm) ?? 0, 0), s.unitKm) },
              {
                label: s.costPerKmKind,
                value: costPerKmKind === "perTotalKm" ? s.costPerKmKindTotal : s.costPerKmKindLaden,
              },
              { label: s.costPerKm, value: `${proNum(proParse(costPerKm) ?? 0, 3)} ${s.unitRsdKm}` },
              {
                label: s.marginMethod,
                value: marginMethod === "onPrice" ? s.marginMethodOnPrice : s.marginMethodOnCost,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const TRANSPORT_SURFACES: Readonly<Record<string, ComponentType>> = {
  "axle-load-distribution": AxleLoadDistributionTool,
  "cargo-centre-of-gravity": CargoCentreOfGravityTool,
  "chargeable-weight": ChargeableWeightTool,
  "cost-per-km-transport": CostPerKmTransportTool,
  "driving-hours-planner": DrivingHoursPlannerTool,
  "eta-with-breaks": EtaWithBreaksTool,
  "fuel-consumption-cost": FuelConsumptionCostTool,
  "gear-ratio-road-speed": GearRatioRoadSpeedTool,
  "gvw-payload": GvwPayloadTool,
  "load-lashing-force": LoadLashingForceTool,
  "loading-space-utilisation": LoadingSpaceUtilisationTool,
  "pallet-load-plan": PalletLoadPlanTool,
  "reefer-fuel-consumption": ReeferFuelConsumptionTool,
  "service-interval-km-hours": ServiceIntervalKmHoursTool,
  "speedometer-tyre-deviation": SpeedometerTyreDeviationTool,
  "tank-volume-by-level": TankVolumeByLevelTool,
  "trip-cost-quote": TripCostQuoteTool,
};
