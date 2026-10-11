import {
  conduitFill,
  energyCost,
  lightingCount,
  luminaireSpacing,
  motorStartingCurrent,
  transformerCurrent,
  type StartMethod,
  type SupplyPhases,
} from "@nexus/core/pro/elektro";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proRatio, proUnit } from "./format.js";
import {
  CopyButton,
  reasonField,
  ResultRow,
  ToolAgainstLimit,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolSection,
  ToolSelect,
} from "./shared.js";

/**
 * „Elektro" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/elektro.ts`'s. This file parses fields with
 * `proParse`, hands the numbers to the core function and prints what comes back —
 * nothing here divides, rounds or compares.
 *
 * **Three tools are `life-safety` and print a quantity against the user's own
 * limit and nothing else.** The host draws the notice; what is left here is to
 * never grow an opinion in the copy — no word about whether an installation, a
 * conduit fill or a starting current is acceptable.
 */

/* -------------------------------------------------------------------------- */
/* energy-cost                                                                  */
/* -------------------------------------------------------------------------- */

export function EnergyCostTool() {
  const s = strings.pro.elektro["energy-cost"];
  const [powerText, setPowerText] = useState("");
  const [hoursText, setHoursText] = useState("");
  const [daysText, setDaysText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [dutyText, setDutyText] = useState("");

  const typed = [powerText, hoursText, daysText].some((text) => proParse(text) !== undefined);
  const result = energyCost({
    powerW: proParse(powerText) ?? Number.NaN,
    hoursPerDay: proParse(hoursText) ?? Number.NaN,
    days: proParse(daysText) ?? Number.NaN,
    pricePerKwh: proParse(priceText) ?? Number.NaN,
    dutyPercent: proParse(dutyText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "power"
        ? s.errorPower
        : field === "hoursPerDay"
          ? s.errorHours
          : field === "days"
            ? s.errorDays
            : field === "duty"
              ? s.errorDuty
              : s.errorPrice;

  const copyText = !result.ok
    ? ""
    : [
        `${s.energy}: ${proUnit(proNum(result.energyKwh, 3), s.unitKwh)}`,
        `${s.cost}: ${proUnit(proNum(result.cost, 2), s.unitCurrency)}`,
        `${s.costPerDay}: ${proUnit(proNum(result.costPerDay, 2), s.unitCurrency)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.power} value={powerText} onChange={setPowerText} />
      <ToolInput label={s.hoursPerDay} value={hoursText} onChange={setHoursText} />
      <ToolInput label={s.days} value={daysText} onChange={setDaysText} />
      <ToolInput label={s.price} hint={s.priceHint} value={priceText} onChange={setPriceText} />
      <ToolInput label={s.duty} hint={s.dutyHint} value={dutyText} onChange={setDutyText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.effectivePower} value={proUnit(proNum(result.effectivePowerW, 1), s.unitW)} />
          <ResultRow label={s.hoursTotal} value={proUnit(proNum(result.hoursTotal, 1), s.unitH)} />
          <ResultRow
            label={s.energyPerDay}
            value={proUnit(proNum(result.energyPerDayKwh, 3), s.unitKwh)}
          />
          <ResultRow label={s.energy} value={proUnit(proNum(result.energyKwh, 3), s.unitKwh)} />
          <ResultRow label={s.cost} value={proUnit(proNum(result.cost, 2), s.unitCurrency)} />
          <ResultRow label={s.costPerDay} value={proUnit(proNum(result.costPerDay, 2), s.unitCurrency)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.power, value: proUnit(proNum(proParse(powerText) ?? 0, 1), s.unitW) },
              { label: s.duty, value: `${proNum(result.dutyPercentUsed, 1)}%` },
              { label: s.price, value: proUnit(proNum(proParse(priceText) ?? 0, 4), s.unitCurrency) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* lighting-count                                                               */
/* -------------------------------------------------------------------------- */

export function LightingCountTool() {
  const s = strings.pro.elektro["lighting-count"];
  const [areaText, setAreaText] = useState("");
  const [luxText, setLuxText] = useState("");
  const [lumensText, setLumensText] = useState("");
  const [utilisationText, setUtilisationText] = useState("");
  const [maintenanceText, setMaintenanceText] = useState("");

  const typed = [areaText, luxText, lumensText].some((text) => proParse(text) !== undefined);
  const result = lightingCount({
    areaM2: proParse(areaText) ?? Number.NaN,
    targetLux: proParse(luxText) ?? Number.NaN,
    luminaireLumens: proParse(lumensText) ?? Number.NaN,
    utilisationFactor: proParse(utilisationText) ?? Number.NaN,
    maintenanceFactor: proParse(maintenanceText) ?? Number.NaN,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "area"
        ? s.errorArea
        : field === "targetLux"
          ? s.errorLux
          : field === "luminaireLumens"
            ? s.errorLumens
            : field === "utilisationFactor"
              ? s.errorUtilisation
              : s.errorMaintenance;

  const luxLimit = proParse(luxText);
  const copyText = !result.ok
    ? ""
    : [
        `${s.requiredLumens}: ${proUnit(proNum(result.requiredLumens, 0), s.unitLm)}`,
        `${s.luminaireCount}: ${proNum(result.luminaireCount, 0)}`,
        `${s.achievedLux}: ${proUnit(proNum(result.achievedLux, 1), s.unitLx)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.area} value={areaText} onChange={setAreaText} />
      <ToolInput label={s.targetLux} hint={s.targetLuxHint} value={luxText} onChange={setLuxText} />
      <ToolInput label={s.luminaireLumens} hint={s.luminaireLumensHint} value={lumensText} onChange={setLumensText} />
      <ToolInput label={s.utilisationFactor} hint={s.utilisationHint} value={utilisationText} onChange={setUtilisationText} />
      <ToolInput label={s.maintenanceFactor} hint={s.maintenanceHint} value={maintenanceText} onChange={setMaintenanceText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.requiredLumens} value={proUnit(proNum(result.requiredLumens, 0), s.unitLm)} />
          <ResultRow label={s.luminaireCount} value={proNum(result.luminaireCount, 0)} />
          <ResultRow label={s.installedLumens} value={proUnit(proNum(result.installedLumens, 0), s.unitLm)} />
          <ToolAgainstLimit
            label={s.achievedLux}
            value={proUnit(proNum(result.achievedLux, 1), s.unitLx)}
            limitLabel={s.targetLux}
            limit={luxLimit === undefined ? undefined : proUnit(proNum(luxLimit, 1), s.unitLx)}
            ratioLabel={s.luxRatio}
            ratio={proRatio(result.luxRatio)}
          />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.area, value: proUnit(proNum(proParse(areaText) ?? 0, 2), s.unitM2) },
              { label: s.luminaireLumens, value: proUnit(proNum(proParse(lumensText) ?? 0, 0), s.unitLm) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* luminaire-spacing                                                            */
/* -------------------------------------------------------------------------- */

export function LuminaireSpacingTool() {
  const s = strings.pro.elektro["luminaire-spacing"];
  const [ratioText, setRatioText] = useState("");
  const [mountingText, setMountingText] = useState("");
  const [workPlaneText, setWorkPlaneText] = useState("");
  const [lengthText, setLengthText] = useState("");
  const [widthText, setWidthText] = useState("");

  const typed = [ratioText, mountingText, lengthText, widthText].some(
    (text) => proParse(text) !== undefined,
  );
  const result = luminaireSpacing({
    spacingToHeightRatio: proParse(ratioText) ?? Number.NaN,
    mountingHeightM: proParse(mountingText) ?? Number.NaN,
    workPlaneHeightM: proParse(workPlaneText) ?? Number.NaN,
    roomLengthM: proParse(lengthText) ?? Number.NaN,
    roomWidthM: proParse(widthText) ?? Number.NaN,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "spacingToHeightRatio"
        ? s.errorRatio
        : field === "roomLength"
          ? s.errorLength
          : field === "roomWidth"
            ? s.errorWidth
            : s.errorHeight;

  const copyText = !result.ok
    ? ""
    : [
        `${s.maxSpacing}: ${proUnit(proNum(result.maxSpacingM, 3), s.unitM)}`,
        `${s.countAlong}: ${proNum(result.countAlong, 0)}`,
        `${s.countAcross}: ${proNum(result.countAcross, 0)}`,
        `${s.totalCount}: ${proNum(result.totalCount, 0)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.spacingToHeightRatio} hint={s.ratioHint} value={ratioText} onChange={setRatioText} />
      <ToolInput label={s.mountingHeight} value={mountingText} onChange={setMountingText} />
      <ToolInput label={s.workPlaneHeight} hint={s.workPlaneHint} value={workPlaneText} onChange={setWorkPlaneText} />
      <ToolInput label={s.roomLength} value={lengthText} onChange={setLengthText} />
      <ToolInput label={s.roomWidth} value={widthText} onChange={setWidthText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.heightAboveWorkPlane} value={proUnit(proNum(result.heightAboveWorkPlaneM, 3), s.unitM)} />
          <ResultRow label={s.maxSpacing} value={proUnit(proNum(result.maxSpacingM, 3), s.unitM)} />
          <ResultRow label={s.countAlong} value={proNum(result.countAlong, 0)} />
          <ResultRow label={s.countAcross} value={proNum(result.countAcross, 0)} />
          <ResultRow label={s.totalCount} value={proNum(result.totalCount, 0)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.spacingToHeightRatio, value: proNum(proParse(ratioText) ?? 0, 3) },
              { label: s.mountingHeight, value: proUnit(proNum(proParse(mountingText) ?? 0, 3), s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* transformer-current — LIFE SAFETY: quantities only, never a verdict          */
/* -------------------------------------------------------------------------- */

const SUPPLY_PHASES: readonly SupplyPhases[] = ["single", "three"];

export function TransformerCurrentTool() {
  const s = strings.pro.elektro["transformer-current"];
  const [powerText, setPowerText] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [secondaryText, setSecondaryText] = useState("");
  const [phases, setPhases] = useState<SupplyPhases>("three");

  const typed = [powerText, primaryText, secondaryText].some(
    (text) => proParse(text) !== undefined,
  );
  const result = transformerCurrent({
    apparentPowerKva: proParse(powerText) ?? Number.NaN,
    primaryVoltageV: proParse(primaryText) ?? Number.NaN,
    secondaryVoltageV: proParse(secondaryText) ?? Number.NaN,
    phases,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "apparentPower"
        ? s.errorPower
        : field === "primaryVoltage"
          ? s.errorPrimary
          : s.errorSecondary;

  const phaseLabel = (p: SupplyPhases): string => (p === "single" ? s.phaseSingle : s.phaseThree);

  const copyText = !result.ok
    ? ""
    : [
        `${s.primaryCurrent}: ${proUnit(proNum(result.primaryCurrentA, 3), s.unitA)}`,
        `${s.secondaryCurrent}: ${proUnit(proNum(result.secondaryCurrentA, 3), s.unitA)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.apparentPower} value={powerText} onChange={setPowerText} />
      <ToolSelect<SupplyPhases>
        label={s.phases}
        value={phases}
        onChange={setPhases}
        options={SUPPLY_PHASES.map((id) => ({ id, label: phaseLabel(id) }))}
      />
      <ToolInput label={s.primaryVoltage} value={primaryText} onChange={setPrimaryText} />
      <ToolInput label={s.secondaryVoltage} value={secondaryText} onChange={setSecondaryText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.primaryCurrent} value={proUnit(proNum(result.primaryCurrentA, 3), s.unitA)} />
          <ResultRow label={s.secondaryCurrent} value={proUnit(proNum(result.secondaryCurrentA, 3), s.unitA)} />
          <ResultRow label={s.phaseFactor} value={proNum(result.phaseFactor, 6)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.apparentPower, value: proUnit(proNum(proParse(powerText) ?? 0, 3), s.unitKva) },
              { label: s.phases, value: phaseLabel(phases) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* conduit-fill — LIFE SAFETY: quantities only, never a verdict                 */
/* -------------------------------------------------------------------------- */

export function ConduitFillTool() {
  const s = strings.pro.elektro["conduit-fill"];
  const [conduitText, setConduitText] = useState("");
  const [conductorText, setConductorText] = useState("");
  const [countText, setCountText] = useState("");
  const [limitText, setLimitText] = useState("");

  const typed = [conduitText, conductorText, countText].some(
    (text) => proParse(text) !== undefined,
  );
  const result = conduitFill({
    conduitInnerDiameterMm: proParse(conduitText) ?? Number.NaN,
    conductorDiameterMm: proParse(conductorText) ?? Number.NaN,
    conductorCount: proParse(countText) ?? Number.NaN,
    fillLimitPercent: proParse(limitText),
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "conduitDiameter"
        ? s.errorConduit
        : field === "conductorDiameter"
          ? s.errorConductor
          : field === "conductorCount"
            ? s.errorCount
            : s.errorLimit;

  const limit = proParse(limitText);
  const copyText = !result.ok
    ? ""
    : [
        `${s.conduitArea}: ${proUnit(proNum(result.conduitAreaMm2, 2), s.unitMm2)}`,
        `${s.conductorsArea}: ${proUnit(proNum(result.conductorsAreaMm2, 2), s.unitMm2)}`,
        `${s.fillPercent}: ${proNum(result.fillPercent, 2)}%`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.conduitDiameter} hint={s.conduitDiameterHint} value={conduitText} onChange={setConduitText} />
      <ToolInput label={s.conductorDiameter} value={conductorText} onChange={setConductorText} />
      <ToolInput label={s.conductorCount} value={countText} onChange={setCountText} />
      <ToolInput label={s.fillLimit} hint={s.fillLimitHint} value={limitText} onChange={setLimitText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.conduitArea} value={proUnit(proNum(result.conduitAreaMm2, 2), s.unitMm2)} />
          <ResultRow label={s.conductorsArea} value={proUnit(proNum(result.conductorsAreaMm2, 2), s.unitMm2)} />
          <ToolAgainstLimit
            label={s.fillPercent}
            value={`${proNum(result.fillPercent, 2)}%`}
            limitLabel={s.fillLimit}
            limit={limit === undefined ? undefined : `${proNum(limit, 2)}%`}
            ratioLabel={s.fillRatio}
            ratio={proRatio(result.fillRatio)}
          />
          <ResultRow label={s.remainingArea} value={proUnit(proNum(result.remainingAreaMm2, 2), s.unitMm2)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.conduitDiameter, value: proUnit(proNum(proParse(conduitText) ?? 0, 2), s.unitMm) },
              { label: s.conductorCount, value: proNum(proParse(countText) ?? 0, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* motor-starting-current — LIFE SAFETY: quantities only, never a verdict       */
/* -------------------------------------------------------------------------- */

const START_METHOD_IDS: readonly StartMethod[] = ["dol", "starDelta", "soft"];

export function MotorStartingCurrentTool() {
  const s = strings.pro.elektro["motor-starting-current"];
  const [ratedText, setRatedText] = useState("");
  const [ratioText, setRatioText] = useState("");
  const [method, setMethod] = useState<StartMethod>("dol");
  const [softText, setSoftText] = useState("");

  const typed = [ratedText, ratioText].some((text) => proParse(text) !== undefined);
  const result = motorStartingCurrent({
    ratedCurrentA: proParse(ratedText) ?? Number.NaN,
    startingRatio: proParse(ratioText) ?? Number.NaN,
    method,
    softStartPercent: method === "soft" ? proParse(softText) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "ratedCurrent"
        ? s.errorRated
        : field === "startingRatio"
          ? s.errorRatio
          : s.errorSoft;

  const methodLabel = (m: StartMethod): string =>
    m === "dol" ? s.methodDol : m === "starDelta" ? s.methodStarDelta : s.methodSoft;

  const copyText = !result.ok
    ? ""
    : [
        `${s.lockedRotorCurrent}: ${proUnit(proNum(result.lockedRotorCurrentA, 3), s.unitA)}`,
        `${s.startingCurrent}: ${proUnit(proNum(result.startingCurrentA, 3), s.unitA)}`,
        `${s.startingRatioOut}: ${proNum(result.startingRatio, 3)}`,
        `${s.torqueShare}: ${proNum(result.torqueShare, 4)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.ratedCurrent} hint={s.ratedCurrentHint} value={ratedText} onChange={setRatedText} />
      <ToolInput label={s.startingRatio} hint={s.startingRatioHint} value={ratioText} onChange={setRatioText} />
      <ToolSelect<StartMethod>
        label={s.method}
        value={method}
        onChange={setMethod}
        options={START_METHOD_IDS.map((id) => ({ id, label: methodLabel(id) }))}
      />
      {method === "soft" && (
        <ToolInput label={s.softStartPercent} hint={s.softStartHint} value={softText} onChange={setSoftText} />
      )}
      <p className="nx-hint nx-hint--prose">{s.estimateNote}</p>

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.lockedRotorCurrent} value={proUnit(proNum(result.lockedRotorCurrentA, 3), s.unitA)} />
          <ResultRow label={s.startingCurrent} value={proUnit(proNum(result.startingCurrentA, 3), s.unitA)} />
          <ResultRow label={s.startingRatioOut} value={proNum(result.startingRatio, 3)} />
          <ResultRow label={s.torqueShare} value={proNum(result.torqueShare, 4)} />
          {result.softStartPercentUsed !== undefined && (
            <ResultRow label={s.softStartPercent} value={`${proNum(result.softStartPercentUsed, 1)}%`} />
          )}
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.method, value: methodLabel(method) },
              { label: s.ratedCurrent, value: proUnit(proNum(proParse(ratedText) ?? 0, 3), s.unitA) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/**
 * One entry per tool id, spelled exactly as the assignment spells it — a missing
 * or misspelled id makes the tool unreachable.
 */
export const ELEKTRO_SURFACES: Readonly<Record<string, ComponentType>> = {
  "energy-cost": EnergyCostTool,
  "lighting-count": LightingCountTool,
  "luminaire-spacing": LuminaireSpacingTool,
  "transformer-current": TransformerCurrentTool,
  "conduit-fill": ConduitFillTool,
  "motor-starting-current": MotorStartingCurrentTool,
};
