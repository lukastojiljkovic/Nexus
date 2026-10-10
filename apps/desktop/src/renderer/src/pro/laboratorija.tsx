import {
  bufferPh,
  concentrationUnits,
  dilution,
  molarity,
  molarMass,
  strongAcidPh,
  type AcidBaseMode,
  type BufferMode,
  type ConcentrationUnit,
  type DilutionMode,
  type MolarityMode,
} from "@nexus/core/pro/laboratorija";
import { useState, type ComponentType } from "react";

import { fill, strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import {
  CopyButton,
  reasonField,
  ResultRow,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolSection,
  ToolSelect,
  ToolTable,
} from "./shared.js";

/**
 * „Laboratorija" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/laboratorija.ts`'s. This file parses fields
 * with `proParse`, hands the numbers to the core function and prints what comes
 * back — nothing here divides, rounds or compares.
 *
 * **Four of the six tools carry an absolute discipline this file cannot relax.**
 * `MolarityToMassTool`, `DilutionTool` and the two pH tools are `life-safety`:
 * the host draws the notice, and what is left here is to never grow an opinion in
 * the copy — a mass, a volume, a pH and a ratio of the user's own numbers, and
 * nothing about whether a preparation is appropriate or safe.
 */

/* -------------------------------------------------------------------------- */
/* molar-mass                                                                   */
/* -------------------------------------------------------------------------- */

export function MolarMassTool() {
  const s = strings.pro.laboratorija["molar-mass"];
  const [formula, setFormula] = useState("");

  const typed = formula.trim() !== "";
  const result = molarMass({ formula });
  const unknownElement = result.ok ? undefined : result.reason.startsWith("element:") ? result.reason.slice("element:".length) : undefined;
  const failure = !result.ok && typed ? (unknownElement === undefined ? s.errorFormula : fill(s.errorElement, { symbol: unknownElement })) : undefined;

  const copyText = !result.ok
    ? ""
    : [
        `${s.molarMass}: ${proUnit(proNum(result.molarMass, 3), s.unitGPerMol)}`,
        ...result.elements.map(
          (element) =>
            `${element.symbol}: ${proNum(element.count, 0)} × ${proUnit(proNum(element.mass, 3), s.unitGPerMol)}`,
        ),
      ].join("\n");

  return (
    <>
      <ToolInput label={s.formula} hint={s.formulaHint} value={formula} onChange={setFormula} mono />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.molarMass} value={proUnit(proNum(result.molarMass, 3), s.unitGPerMol)} />
          <ResultRow label={s.totalAtoms} value={proNum(result.totalAtoms, 0)} />
          <ToolTable
            head={[s.colElement, s.colCount, s.colMass, s.colShare]}
            rows={result.elements.map((element) => [
              element.symbol,
              proNum(element.count, 0),
              proUnit(proNum(element.mass, 3), s.unitGPerMol),
              `${proNum(element.sharePercent, 3)}%`,
            ])}
          />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho title={s.inputs} entries={[{ label: s.formula, value: formula.trim() }]} />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* molarity-to-mass — LIFE SAFETY: quantities only, never a verdict             */
/* -------------------------------------------------------------------------- */

const MOLARITY_MODES: readonly MolarityMode[] = ["massForSolution", "concentrationFromMass"];

/**
 * Moles and the mass to weigh, from a wanted concentration and volume.
 * **Life safety: this prints a mass and never a word about whether a preparation
 * is appropriate, permitted or safe.**
 */
export function MolarityToMassTool() {
  const s = strings.pro.laboratorija["molarity-to-mass"];
  const [mode, setMode] = useState<MolarityMode>("massForSolution");
  const [concentrationText, setConcentrationText] = useState("");
  const [volumeText, setVolumeText] = useState("");
  const [molarMassText, setMolarMassText] = useState("");
  const [massText, setMassText] = useState("");

  const typed = [concentrationText, volumeText, molarMassText, massText].some(
    (text) => proParse(text) !== undefined,
  );
  const result = molarity({
    mode,
    concentrationMolL: mode === "massForSolution" ? proParse(concentrationText) : undefined,
    volumeMl: proParse(volumeText) ?? Number.NaN,
    molarMassGmol: proParse(molarMassText) ?? Number.NaN,
    massG: mode === "concentrationFromMass" ? proParse(massText) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "volume"
        ? s.errorVolume
        : field === "molarMass"
          ? s.errorMolarMass
          : field === "concentration"
            ? s.errorConcentration
            : s.errorMass;

  const modeLabel = (m: MolarityMode): string =>
    m === "massForSolution" ? s.modeMassForSolution : s.modeConcentrationFromMass;

  const copyText = !result.ok
    ? ""
    : [
        `${s.moles}: ${proUnit(proNum(result.moles, 6), s.unitMol)}`,
        `${s.mass}: ${proUnit(proNum(result.massG, 4), s.unitG)}`,
        `${s.concentration}: ${proUnit(proNum(result.concentrationMolL, 6), s.unitMolPerL)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<MolarityMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={MOLARITY_MODES.map((id) => ({ id, label: modeLabel(id) }))}
      />
      {mode === "massForSolution" && (
        <ToolInput label={s.concentration} value={concentrationText} onChange={setConcentrationText} />
      )}
      <ToolInput label={s.volume} value={volumeText} onChange={setVolumeText} />
      <ToolInput label={s.molarMass} hint={s.molarMassHint} value={molarMassText} onChange={setMolarMassText} />
      {mode === "concentrationFromMass" && (
        <ToolInput label={s.mass} value={massText} onChange={setMassText} />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.volumeL} value={proUnit(proNum(result.volumeL, 6), s.unitL)} />
          <ResultRow label={s.moles} value={proUnit(proNum(result.moles, 6), s.unitMol)} />
          <ResultRow label={s.mass} value={proUnit(proNum(result.massG, 4), s.unitG)} />
          <ResultRow
            label={s.concentration}
            value={proUnit(proNum(result.concentrationMolL, 6), s.unitMolPerL)}
          />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mode, value: modeLabel(mode) },
              { label: s.volume, value: proUnit(proNum(proParse(volumeText) ?? 0, 3), s.unitMl) },
              { label: s.molarMass, value: proUnit(proNum(proParse(molarMassText) ?? 0, 3), s.unitGPerMol) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* dilution — LIFE SAFETY: quantities only, never a verdict                     */
/* -------------------------------------------------------------------------- */

const DILUTION_MODES: readonly DilutionMode[] = ["solveForVolume", "solveForStockVolume"];

export function DilutionTool() {
  const s = strings.pro.laboratorija.dilution;
  const [mode, setMode] = useState<DilutionMode>("solveForVolume");
  const [stockConcentrationText, setStockConcentrationText] = useState("");
  const [stockVolumeText, setStockVolumeText] = useState("");
  const [targetConcentrationText, setTargetConcentrationText] = useState("");
  const [targetVolumeText, setTargetVolumeText] = useState("");

  const typed = [
    stockConcentrationText,
    stockVolumeText,
    targetConcentrationText,
    targetVolumeText,
  ].some((text) => proParse(text) !== undefined);
  const result = dilution({
    mode,
    stockConcentration: proParse(stockConcentrationText) ?? Number.NaN,
    stockVolumeMl: mode === "solveForVolume" ? proParse(stockVolumeText) : undefined,
    targetConcentration: proParse(targetConcentrationText) ?? Number.NaN,
    targetVolumeMl: mode === "solveForStockVolume" ? proParse(targetVolumeText) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "stockConcentration"
        ? s.errorStockConcentration
        : field === "stockVolume"
          ? s.errorStockVolume
          : field === "targetOutOfRange"
            ? s.errorTargetOutOfRange
            : field === "targetVolume"
              ? s.errorTargetVolume
              : s.errorTargetConcentration;

  const modeLabel = (m: DilutionMode): string =>
    m === "solveForVolume" ? s.modeSolveForVolume : s.modeSolveForStockVolume;

  const copyText = !result.ok
    ? ""
    : [
        `${s.stockVolume}: ${proUnit(proNum(result.stockVolumeMl, 3), s.unitMl)}`,
        `${s.targetVolume}: ${proUnit(proNum(result.targetVolumeMl, 3), s.unitMl)}`,
        `${s.solventToAdd}: ${proUnit(proNum(result.solventToAddMl, 3), s.unitMl)}`,
        `${s.dilutionFactor}: ${proNum(result.dilutionFactor, 3)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<DilutionMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={DILUTION_MODES.map((id) => ({ id, label: modeLabel(id) }))}
      />
      <ToolInput label={s.stockConcentration} value={stockConcentrationText} onChange={setStockConcentrationText} />
      {mode === "solveForVolume" && (
        <ToolInput label={s.stockVolume} value={stockVolumeText} onChange={setStockVolumeText} />
      )}
      <ToolInput label={s.targetConcentration} value={targetConcentrationText} onChange={setTargetConcentrationText} />
      {mode === "solveForStockVolume" && (
        <ToolInput label={s.targetVolume} value={targetVolumeText} onChange={setTargetVolumeText} />
      )}
      <p className="nx-hint nx-hint--prose">{s.conventionNote}</p>

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.stockVolume} value={proUnit(proNum(result.stockVolumeMl, 3), s.unitMl)} />
          <ResultRow label={s.targetVolume} value={proUnit(proNum(result.targetVolumeMl, 3), s.unitMl)} />
          <ResultRow label={s.solventToAdd} value={proUnit(proNum(result.solventToAddMl, 3), s.unitMl)} />
          <ResultRow label={s.dilutionFactor} value={proNum(result.dilutionFactor, 3)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mode, value: modeLabel(mode) },
              { label: s.stockConcentration, value: proNum(proParse(stockConcentrationText) ?? 0, 6) },
              { label: s.targetConcentration, value: proNum(proParse(targetConcentrationText) ?? 0, 6) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* concentration-units                                                          */
/* -------------------------------------------------------------------------- */

const CONCENTRATION_UNIT_IDS: readonly ConcentrationUnit[] = [
  "molPerL",
  "millimolPerL",
  "gramPerL",
  "milligramPerMl",
  "percentWV",
  "ppm",
  "ppb",
];

export function ConcentrationUnitsTool() {
  const s = strings.pro.laboratorija["concentration-units"];
  const [valueText, setValueText] = useState("");
  const [unit, setUnit] = useState<ConcentrationUnit>("molPerL");
  const [molarMassText, setMolarMassText] = useState("");

  const typed = valueText.trim() !== "";
  const result = concentrationUnits({
    value: proParse(valueText) ?? Number.NaN,
    unit,
    molarMassGmol: proParse(molarMassText),
  });

  const unitLabel = (id: ConcentrationUnit): string =>
    id === "molPerL"
      ? s.unitMolPerL
      : id === "millimolPerL"
        ? s.unitMillimolPerL
        : id === "gramPerL"
          ? s.unitGramPerL
          : id === "milligramPerMl"
            ? s.unitMilligramPerMl
            : id === "percentWV"
              ? s.unitPercent
              : id === "ppm"
                ? s.unitPpm
                : s.unitPpb;

  const rows = result.ok
    ? CONCENTRATION_UNIT_IDS.map((id) => {
        const value =
          id === "molPerL"
            ? result.molPerL
            : id === "millimolPerL"
              ? result.millimolPerL
              : id === "gramPerL"
                ? result.gramPerL
                : id === "milligramPerMl"
                  ? result.milligramPerMl
                  : id === "percentWV"
                    ? result.percentWV
                    : id === "ppm"
                      ? result.ppm
                      : result.ppb;
        return [unitLabel(id), value === undefined ? s.notAvailable : proNum(value, 6)] as const;
      })
    : [];

  const failure =
    result.ok || !typed
      ? undefined
      : reasonField(result.reason) === "molarMass"
        ? s.errorMolarMass
        : s.errorValue;

  return (
    <>
      <ToolInput label={s.value} value={valueText} onChange={setValueText} />
      <ToolSelect<ConcentrationUnit>
        label={s.unit}
        value={unit}
        onChange={setUnit}
        options={CONCENTRATION_UNIT_IDS.map((id) => ({ id, label: unitLabel(id) }))}
      />
      <ToolInput label={s.molarMass} hint={s.molarMassHint} value={molarMassText} onChange={setMolarMassText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ToolTable head={[s.colUnit, s.colValue]} rows={rows} prose={[0]} />
          <p className="nx-hint nx-hint--prose">{s.basisNote}</p>
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.unit, value: unitLabel(unit) },
              { label: s.molarMass, value: proNum(proParse(molarMassText) ?? 0, 4) },
            ]}
          />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* ph-strong-acid-base — LIFE SAFETY: quantities only, never a verdict          */
/* -------------------------------------------------------------------------- */

const ACID_BASE_MODES: readonly AcidBaseMode[] = ["acid", "base"];

export function StrongAcidPhTool() {
  const s = strings.pro.laboratorija["ph-strong-acid-base"];
  const [mode, setMode] = useState<AcidBaseMode>("acid");
  const [concentrationText, setConcentrationText] = useState("");
  const [groupsText, setGroupsText] = useState("");

  const typed = proParse(concentrationText) !== undefined;
  const result = strongAcidPh({
    mode,
    concentrationMolL: proParse(concentrationText) ?? Number.NaN,
    ionisableGroups: proParse(groupsText) ?? Number.NaN,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "ionisableGroups"
        ? s.errorGroups
        : s.errorConcentration;

  const modeLabel = (m: AcidBaseMode): string => (m === "acid" ? s.modeAcid : s.modeBase);

  const copyText = !result.ok
    ? ""
    : [
        `pH: ${proNum(result.ph, 3)}`,
        `${s.poh}: ${proNum(result.poh, 3)}`,
        `${s.ionConcentration}: ${proUnit(proNum(result.ionConcentration, 8), s.unitMolPerL)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<AcidBaseMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={ACID_BASE_MODES.map((id) => ({ id, label: modeLabel(id) }))}
      />
      <ToolInput label={s.concentration} value={concentrationText} onChange={setConcentrationText} />
      <ToolInput label={s.groups} hint={s.groupsHint} value={groupsText} onChange={setGroupsText} />
      <p className="nx-hint nx-hint--prose">{s.idealisationNote}</p>

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          <ResultRow label={s.ph} value={proNum(result.ph, 3)} />
          <ResultRow label={s.poh} value={proNum(result.poh, 3)} />
          <ResultRow
            label={s.ionConcentration}
            value={proUnit(proNum(result.ionConcentration, 8), s.unitMolPerL)}
          />
          <ResultRow label={s.pIon} value={proNum(result.pIonConcentration, 6)} />
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.mode, value: modeLabel(mode) },
              { label: s.concentration, value: proUnit(proNum(proParse(concentrationText) ?? 0, 6), s.unitMolPerL) },
              { label: s.groups, value: proNum(proParse(groupsText) ?? 0, 0) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* buffer-ph — LIFE SAFETY: quantities only, never a verdict                    */
/* -------------------------------------------------------------------------- */

const BUFFER_MODES: readonly BufferMode[] = ["phFromRatio", "ratioForPh"];

export function BufferPhTool() {
  const s = strings.pro.laboratorija["buffer-ph"];
  const [mode, setMode] = useState<BufferMode>("phFromRatio");
  const [pkaText, setPkaText] = useState("");
  const [acidText, setAcidText] = useState("");
  const [baseText, setBaseText] = useState("");
  const [targetText, setTargetText] = useState("");

  const typed = [pkaText, acidText, baseText, targetText].some(
    (text) => proParse(text) !== undefined,
  );
  const result = bufferPh({
    mode,
    pka: proParse(pkaText) ?? Number.NaN,
    acidConcentration: mode === "phFromRatio" ? proParse(acidText) : undefined,
    baseConcentration: mode === "phFromRatio" ? proParse(baseText) : undefined,
    targetPh: mode === "ratioForPh" ? proParse(targetText) : undefined,
  });

  const field = result.ok ? undefined : reasonField(result.reason);
  const failure =
    result.ok || !typed
      ? undefined
      : field === "pka"
        ? s.errorPka
        : field === "targetPh"
          ? s.errorTargetPh
          : field === "acidConcentration"
            ? s.errorAcid
            : s.errorBase;

  const modeLabel = (m: BufferMode): string =>
    m === "phFromRatio" ? s.modePhFromRatio : s.modeRatioForPh;

  const copyText = !result.ok
    ? ""
    : [
        result.ph === undefined ? undefined : `pH: ${proNum(result.ph, 3)}`,
        result.ratio === undefined ? undefined : `${s.ratio}: ${proNum(result.ratio, 6)}`,
        result.logRatio === undefined ? undefined : `${s.logRatio}: ${proNum(result.logRatio, 6)}`,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");

  return (
    <>
      <ToolSelect<BufferMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={BUFFER_MODES.map((id) => ({ id, label: modeLabel(id) }))}
      />
      <ToolInput label={s.pka} hint={s.pkaHint} value={pkaText} onChange={setPkaText} />
      {mode === "phFromRatio" && (
        <>
          <ToolInput label={s.acidConcentration} value={acidText} onChange={setAcidText} />
          <ToolInput label={s.baseConcentration} value={baseText} onChange={setBaseText} />
        </>
      )}
      {mode === "ratioForPh" && (
        <ToolInput label={s.targetPh} value={targetText} onChange={setTargetText} />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && typed && (
        <ToolSection title={s.results}>
          {result.ph !== undefined && <ResultRow label={s.ph} value={proNum(result.ph, 3)} />}
          {result.ratio !== undefined && <ResultRow label={s.ratio} value={proNum(result.ratio, 6)} />}
          {result.logRatio !== undefined && (
            <ResultRow label={s.logRatio} value={proNum(result.logRatio, 6)} />
          )}
          <ToolFormula>{s.formulaLine}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[{ label: s.pka, value: proNum(proParse(pkaText) ?? 0, 3) }]}
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
export const LABORATORIJA_SURFACES: Readonly<Record<string, ComponentType>> = {
  "molar-mass": MolarMassTool,
  "molarity-to-mass": MolarityToMassTool,
  dilution: DilutionTool,
  "concentration-units": ConcentrationUnitsTool,
  "ph-strong-acid-base": StrongAcidPhTool,
  "buffer-ph": BufferPhTool,
};
