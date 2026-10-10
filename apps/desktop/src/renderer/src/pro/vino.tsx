import {
  abvGravity,
  mustSugar,
  spiritDilution,
  sugarAddition,
  sulfite,
  type StrengthDirection,
  type SulfiteMode,
} from "@nexus/core/pro/vino";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proParse, proUnit } from "./format.js";
import {
  reasonField,
  ResultRow,
  ToolFailure,
  ToolFormula,
  ToolInput,
  ToolInputEcho,
  ToolSection,
  ToolSelect,
} from "./shared.js";

/**
 * „Vino i rakija" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/vino.ts`'s. Every surface here prints a
 * mass, a concentration or a strength and nothing about drinking; the two
 * conversions the brief asked about and this repository cannot cite — Brix to
 * specific gravity, and the OIML R 22 temperature correction — are absent
 * rather than approximated, and their notes say so.
 */

/* -------------------------------------------------------------------------- */
/* must-sugar                                                                 */
/* -------------------------------------------------------------------------- */

export function MustSugarTool() {
  const s = strings.pro.vino["must-sugar"];
  const [brixText, setBrixText] = useState("");
  const [sgText, setSgText] = useState("");
  const [volumeText, setVolumeText] = useState("");
  const [yieldText, setYieldText] = useState("");

  const result = mustSugar({
    brix: proParse(brixText),
    specificGravity: proParse(sgText),
    volumeL: proParse(volumeText),
    yieldFactor: proParse(yieldText),
  });

  const typed = [brixText, sgText, volumeText, yieldText].some((text) => text.trim() !== "");
  const errors: Readonly<Record<string, string>> = {
    brix: s.errorBrix,
    specificGravity: s.errorSg,
    volume: s.errorVolume,
    yieldFactor: s.errorYield,
  };
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "brix" && brixText.trim() === "" && sgText.trim() === ""
        ? s.errorEmpty
        : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput label={s.brix} hint={s.brixHint} value={brixText} onChange={setBrixText} />
      <ToolInput label={s.sg} hint={s.sgHint} value={sgText} onChange={setSgText} />
      <ToolInput label={s.volume} hint={s.volumeHint} value={volumeText} onChange={setVolumeText} />
      <ToolInput label={s.yieldFactor} hint={s.yieldFactorHint} value={yieldText} onChange={setYieldText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            {result.sugarGPer100g !== undefined && (
              <ResultRow
                label={s.sugarPer100g}
                value={proUnit(proNum(result.sugarGPer100g, 2), s.unitGPer100g)}
              />
            )}
            {result.oechsle !== undefined && (
              <ResultRow label={s.oechsle} value={proUnit(proNum(result.oechsle, 1), s.unitOe)} />
            )}
            {result.sugarGPerL !== undefined && (
              <ResultRow label={s.sugarPerL} value={proUnit(proNum(result.sugarGPerL, 2), s.unitGPerL)} />
            )}
            {result.sugarKg !== undefined && (
              <ResultRow label={s.sugarKg} value={proUnit(proNum(result.sugarKg, 3), s.unitKg)} />
            )}
            {result.potentialAbv !== undefined && (
              <ResultRow label={s.potentialAbv} value={proUnit(proNum(result.potentialAbv, 2), s.unitPercent)} />
            )}
            <ResultRow
              label={s.perPercent}
              value={proUnit(proNum(result.sugarPerPercentPerL, 2), s.unitGPerL)}
            />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              {
                label: s.yieldUsed,
                value: `${proNum(result.yieldUsed, 4)} (${result.yieldIsTheoretical ? s.yieldTheoretical : s.yieldGiven})`,
              },
            ]}
          />
          <p className="nx-hint nx-hint--prose">{s.note}</p>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* sugar-addition                                                             */
/* -------------------------------------------------------------------------- */

export function SugarAdditionTool() {
  const s = strings.pro.vino["sugar-addition"];
  const [volumeText, setVolumeText] = useState("");
  const [currentText, setCurrentText] = useState("");
  const [targetText, setTargetText] = useState("");
  const [yieldText, setYieldText] = useState("");

  const result = sugarAddition({
    volumeL: proParse(volumeText) ?? Number.NaN,
    currentSugarGPerL: proParse(currentText) ?? 0,
    targetAbv: proParse(targetText) ?? Number.NaN,
    yieldFactor: proParse(yieldText),
  });
  const typed = proParse(volumeText) !== undefined || proParse(targetText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    volume: s.errorVolume,
    currentSugar: s.errorCurrent,
    targetAbv: s.errorTarget,
    yieldFactor: s.errorYield,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput label={s.volume} hint={s.volumeHint} value={volumeText} onChange={setVolumeText} />
      <ToolInput label={s.current} hint={s.currentHint} value={currentText} onChange={setCurrentText} />
      <ToolInput label={s.target} hint={s.targetHint} value={targetText} onChange={setTargetText} />
      <ToolInput label={s.yieldFactor} hint={s.yieldFactorHint} value={yieldText} onChange={setYieldText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.required} value={proUnit(proNum(result.requiredSugarGPerL, 2), s.unitGPerL)} />
            <ResultRow label={s.additionPerL} value={proUnit(proNum(result.additionGPerL, 2), s.unitGPerL)} />
            <ResultRow label={s.additionKg} value={proUnit(proNum(result.additionKg, 4), s.unitKg)} />
            <ResultRow label={s.totalKg} value={proUnit(proNum(result.totalSugarKg, 4), s.unitKg)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          {result.additionKg < 0 && <p className="nx-hint nx-hint--prose">{s.negativeNote}</p>}
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* abv-gravity                                                                */
/* -------------------------------------------------------------------------- */

export function AbvGravityTool() {
  const s = strings.pro.vino["abv-gravity"];
  const [ogText, setOgText] = useState("");
  const [fgText, setFgText] = useState("");

  const result = abvGravity({
    originalGravity: proParse(ogText) ?? Number.NaN,
    finalGravity: proParse(fgText) ?? Number.NaN,
  });
  const typed = proParse(ogText) !== undefined || proParse(fgText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    originalGravity: s.errorOg,
    finalGravity: s.errorFg,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolInput label={s.og} hint={s.ogHint} value={ogText} onChange={setOgText} />
      <ToolInput label={s.fg} hint={s.fgHint} value={fgText} onChange={setFgText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.drop} value={proNum(result.gravityDrop, 4)} />
            <ResultRow label={s.abv} value={proUnit(proNum(result.abv, 3), s.unitPercent)} />
            <ResultRow label={s.abw} value={proUnit(proNum(result.abw, 3), s.unitPercentW)} />
            <ResultRow
              label={s.attenuation}
              value={proUnit(proNum(result.apparentAttenuationPercent, 2), s.unitPercentAtten)}
            />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <p className="nx-hint nx-hint--prose">{s.note}</p>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* spirit-dilution                                                            */
/* -------------------------------------------------------------------------- */

export function SpiritDilutionTool() {
  const s = strings.pro.vino["spirit-dilution"];
  const [direction, setDirection] = useState<StrengthDirection>("dilute");
  const [currentText, setCurrentText] = useState("");
  const [targetText, setTargetText] = useState("");
  const [volumeText, setVolumeText] = useState("");
  const [addedText, setAddedText] = useState("");

  const result = spiritDilution({
    direction,
    currentStrength: proParse(currentText) ?? Number.NaN,
    targetStrength: proParse(targetText) ?? Number.NaN,
    volumeL: proParse(volumeText) ?? Number.NaN,
    addedStrength: proParse(addedText),
  });
  const typed = proParse(currentText) !== undefined || proParse(targetText) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    direction: s.errorDirection,
    currentStrength: s.errorCurrent,
    targetStrength: direction === "dilute" ? s.errorTargetDilute : s.errorTargetFortify,
    volume: s.errorVolume,
    addedStrength:
      direction === "dilute" ? s.errorAddedBelowTarget : s.errorAddedAboveTarget,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolSelect<StrengthDirection>
        label={s.direction}
        value={direction}
        onChange={setDirection}
        options={[
          { id: "dilute", label: s.directionDilute },
          { id: "fortify", label: s.directionFortify },
        ]}
      />
      <ToolInput label={s.current} hint={s.currentHint} value={currentText} onChange={setCurrentText} />
      <ToolInput label={s.target} hint={s.targetHint} value={targetText} onChange={setTargetText} />
      <ToolInput label={s.volume} hint={s.volumeHint} value={volumeText} onChange={setVolumeText} />
      <ToolInput
        label={s.addedStrength}
        hint={s.addedStrengthHint}
        value={addedText}
        onChange={setAddedText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.addedVolume} value={proUnit(proNum(result.addedVolumeL, 3), s.unitL)} />
            <ResultRow label={s.finalVolume} value={proUnit(proNum(result.finalVolumeL, 3), s.unitL)} />
            <ResultRow label={s.alcohol} value={proUnit(proNum(result.alcoholL, 3), s.unitL)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <p className="nx-hint nx-hint--prose">{s.note}</p>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* sulfite                                                                    */
/* -------------------------------------------------------------------------- */

export function SulfiteTool() {
  const s = strings.pro.vino["sulfite"];
  const [mode, setMode] = useState<SulfiteMode>("fromMetabisulfite");
  const [metabisulfiteText, setMetabisulfiteText] = useState("");
  const [so2Text, setSo2Text] = useState("");
  const [volumeText, setVolumeText] = useState("");

  const result = sulfite({
    mode,
    metabisulfiteG: mode === "fromMetabisulfite" ? proParse(metabisulfiteText) : undefined,
    so2G: mode === "fromSo2" ? proParse(so2Text) : undefined,
    volumeL: proParse(volumeText),
  });
  const typed = proParse(metabisulfiteText) !== undefined || proParse(so2Text) !== undefined;
  const errors: Readonly<Record<string, string>> = {
    mode: s.errorMode,
    metabisulfite: s.errorMetabisulfite,
    so2: s.errorSo2,
    volume: s.errorVolume,
    known: s.errorKnown,
  };
  const failure = result.ok || !typed ? undefined : errors[reasonField(result.reason)];

  return (
    <>
      <ToolSelect<SulfiteMode>
        label={s.mode}
        value={mode}
        onChange={setMode}
        options={[
          { id: "fromMetabisulfite", label: s.modeFromMetabisulfite },
          { id: "fromSo2", label: s.modeFromSo2 },
        ]}
      />
      {mode === "fromMetabisulfite" ? (
        <ToolInput
          label={s.metabisulfite}
          hint={s.metabisulfiteHint}
          value={metabisulfiteText}
          onChange={setMetabisulfiteText}
        />
      ) : (
        <ToolInput label={s.so2} hint={s.so2Hint} value={so2Text} onChange={setSo2Text} />
      )}
      <ToolInput label={s.volume} hint={s.volumeHint} value={volumeText} onChange={setVolumeText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <>
          <ToolSection title={s.results}>
            <ResultRow label={s.metabisulfiteMass} value={proUnit(proNum(result.metabisulfiteG, 4), s.unitG)} />
            <ResultRow label={s.so2Mass} value={proUnit(proNum(result.so2G, 4), s.unitG)} />
            {result.so2MgPerL !== undefined && (
              <ResultRow label={s.so2PerL} value={proUnit(proNum(result.so2MgPerL, 2), s.unitMgPerL)} />
            )}
            {result.metabisulfiteMgPerL !== undefined && (
              <ResultRow
                label={s.metabisulfitePerL}
                value={proUnit(proNum(result.metabisulfiteMgPerL, 2), s.unitMgPerL)}
              />
            )}
            <ResultRow label={s.fraction} value={proNum(result.so2Fraction, 4)} />
          </ToolSection>
          <ToolFormula>{s.formula}</ToolFormula>
          <p className="nx-hint nx-hint--prose">{s.note}</p>
        </>
      )}
    </>
  );
}

/** Every surface this file holds, by tool id — held to the registrations by `proToolSurfaces.test.ts`. */
export const VINO_SURFACES: Readonly<Record<string, ComponentType>> = {
  "must-sugar": MustSugarTool,
  "sugar-addition": SugarAdditionTool,
  "abv-gravity": AbvGravityTool,
  "spirit-dilution": SpiritDilutionTool,
  "sulfite": SulfiteTool,
};
