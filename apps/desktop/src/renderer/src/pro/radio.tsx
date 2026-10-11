import {
  MATCH_QUANTITIES,
  antennaLengths,
  coaxLoss,
  frequencyWavelength,
  fresnelRadius,
  linkBudget,
  pathLoss,
  swrMatch,
  type MatchEntry,
  type MatchQuantity,
} from "@nexus/core/pro/radio";
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
 * „Radio-amaterizam" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/radio.ts`'s. Nothing here divides, rounds
 * or compares a radio figure; this file shapes fields, hands the numbers over
 * and reads the answers onto the page.
 *
 * **No band plan, no licence class and no power limit appears on any of these
 * screens.** Those are the regulator's table and the operator's business, and
 * the tools print quantities — an SWR, a loss, a received power — with nothing
 * coloured and nothing called good. That restraint is the same one the whole
 * professional drawer keeps, applied to a trade whose limits live in a licence
 * document rather than in a standard.
 *
 * **The figures that belong to the user's own hardware are fields.** The
 * velocity factor, the datasheet's dB/100 m and the path loss are all typed in,
 * because a table of cables or a sky-wave model embedded here would be a claim
 * about equipment nobody in this room has seen.
 */

/** Whether any of the given raw fields has something typed into it. */
function anyTyped(...values: readonly string[]): boolean {
  return values.some((value) => value.trim() !== "");
}

/** A typed field as a number, or `NaN` when it is empty — the core refuses it by name. */
function num(text: string): number {
  return proParse(text) ?? Number.NaN;
}

/** A quantity with its unit, spaced the way SI spaces it. */
function amount(value: number, digits: number, unit: string): string {
  return proUnit(proNum(value, digits), unit);
}

export function FrequencyWavelengthTool() {
  const s = strings.pro.radio["frequency-wavelength"];
  const [known, setKnown] = useState<"frequency" | "wavelength">("frequency");
  const [frequencyText, setFrequencyText] = useState("");
  const [wavelengthText, setWavelengthText] = useState("");

  const typed = known === "frequency" ? anyTyped(frequencyText) : anyTyped(wavelengthText);
  const result = frequencyWavelength(
    known === "frequency"
      ? { frequencyHz: anyTyped(frequencyText) ? num(frequencyText) : undefined }
      : { wavelengthM: anyTyped(wavelengthText) ? num(wavelengthText) : undefined },
  );
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "pair"
        ? s.errorPair
        : result.reason === "frequency"
          ? s.errorFrequency
          : s.errorWavelength;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outFrequency}: ${amount(result.frequencyHz, 3, s.unitHz)}`,
        `${s.outFrequencyMhz}: ${amount(result.frequencyMhz, 6, s.unitMhz)}`,
        `${s.outWavelength}: ${amount(result.wavelengthM, 6, s.unitM)}`,
        `${s.outHalf}: ${amount(result.halfWavelengthM, 6, s.unitM)}`,
        `${s.outQuarter}: ${amount(result.quarterWavelengthM, 6, s.unitM)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<"frequency" | "wavelength">
        label={s.known}
        value={known}
        onChange={setKnown}
        options={[
          { id: "frequency", label: s.knownFrequency },
          { id: "wavelength", label: s.knownWavelength },
        ]}
      />

      {known === "frequency" ? (
        <ToolInput
          label={s.frequency}
          hint={s.frequencyHint}
          value={frequencyText}
          onChange={setFrequencyText}
        />
      ) : (
        <ToolInput
          label={s.wavelength}
          hint={s.wavelengthHint}
          value={wavelengthText}
          onChange={setWavelengthText}
        />
      )}

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outFrequency} value={amount(result.frequencyHz, 3, s.unitHz)} />
          <ResultRow label={s.outFrequencyKhz} value={amount(result.frequencyKhz, 3, s.unitKhz)} />
          <ResultRow label={s.outFrequencyMhz} value={amount(result.frequencyMhz, 6, s.unitMhz)} />
          <ResultRow label={s.outWavelength} value={amount(result.wavelengthM, 6, s.unitM)} />
          <ResultRow label={s.outHalf} value={amount(result.halfWavelengthM, 6, s.unitM)} />
          <ResultRow label={s.outQuarter} value={amount(result.quarterWavelengthM, 6, s.unitM)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              {
                label: s.known,
                value: known === "frequency" ? s.knownFrequency : s.knownWavelength,
              },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function AntennaLengthsTool() {
  const s = strings.pro.radio["antenna-lengths"];
  const [frequencyText, setFrequencyText] = useState("");
  const [velocityText, setVelocityText] = useState("");

  const typed = anyTyped(frequencyText, velocityText);
  const result = antennaLengths({
    frequencyHz: num(frequencyText),
    velocityFactor: num(velocityText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "frequency"
        ? s.errorFrequency
        : s.errorVelocityFactor;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outWavelength}: ${amount(result.wavelengthM, 6, s.unitM)}`,
        `${s.outConductor}: ${amount(result.conductorWavelengthM, 6, s.unitM)}`,
        `${s.outDipole}: ${amount(result.dipoleM, 4, s.unitM)}`,
        `${s.outQuarter}: ${amount(result.quarterWaveM, 4, s.unitM)}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.frequency}
        hint={s.frequencyHint}
        value={frequencyText}
        onChange={setFrequencyText}
      />
      <ToolInput
        label={s.velocityFactor}
        hint={s.velocityFactorHint}
        value={velocityText}
        onChange={setVelocityText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outWavelength} value={amount(result.wavelengthM, 6, s.unitM)} />
          <ResultRow
            label={s.outConductor}
            value={amount(result.conductorWavelengthM, 6, s.unitM)}
          />
          <ResultRow label={s.outDipole} value={amount(result.dipoleM, 4, s.unitM)} />
          <ResultRow label={s.outQuarter} value={amount(result.quarterWaveM, 4, s.unitM)} />
          <ResultRow label={s.outDipoleFt} value={amount(result.dipoleFt, 3, s.unitFt)} />
          <ResultRow label={s.outQuarterFt} value={amount(result.quarterWaveFt, 3, s.unitFt)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.frequency, value: amount(num(frequencyText), 3, s.unitHz) },
              { label: s.velocityFactor, value: proNum(num(velocityText), 3) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function SwrMatchTool() {
  const s = strings.pro.radio["swr-match"];
  const [kind, setKind] = useState<MatchQuantity>("swr");
  const [valueText, setValueText] = useState("");

  const typed = anyTyped(valueText);
  const value = num(valueText);
  // The entry is built as the union it is, rather than cast into it: a cast is
  // the one thing that would let a selector value name a branch the core does
  // not have, which is the failure `ToolSelect` itself was written to end.
  const entry: MatchEntry =
    kind === "swr"
      ? { kind: "swr", value }
      : kind === "returnLoss"
        ? { kind: "returnLoss", value }
        : kind === "reflection"
          ? { kind: "reflection", value }
          : { kind: "mismatchLoss", value };
  const result = swrMatch(entry);
  const failure = result.ok || !typed ? undefined : result.reason === "kind" ? s.errorKind : s.errorValue;

  const kindLabel =
    kind === "swr"
      ? s.knownSwr
      : kind === "returnLoss"
        ? s.knownReturnLoss
        : kind === "reflection"
          ? s.knownReflection
          : s.knownMismatchLoss;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outSwr}: ${proNum(result.swr, 6)}`,
        `${s.outReturnLoss}: ${result.returnLossDb === undefined ? s.returnLossNone : amount(result.returnLossDb, 4, s.unitDb)}`,
        `${s.outReflection}: ${proNum(result.reflectionCoefficient, 6)}`,
        `${s.outReflectedPercent}: ${amount(result.reflectedPercent, 4, s.unitPercent)}`,
        `${s.outPowerDelivered}: ${amount(result.powerDelivered * 100, 4, s.unitPercent)}`,
        `${s.outMismatchLoss}: ${amount(result.mismatchLossDb, 4, s.unitDb)}`,
      ].join("\n");

  return (
    <>
      <ToolSelect<MatchQuantity>
        label={s.known}
        value={kind}
        onChange={setKind}
        options={MATCH_QUANTITIES.map((id) => ({
          id,
          label:
            id === "swr"
              ? s.knownSwr
              : id === "returnLoss"
                ? s.knownReturnLoss
                : id === "reflection"
                  ? s.knownReflection
                  : s.knownMismatchLoss,
        }))}
      />
      <ToolInput label={s.value} hint={s.valueHint} value={valueText} onChange={setValueText} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outSwr} value={proNum(result.swr, 6)} />
          <ResultRow
            label={s.outReturnLoss}
            value={
              result.returnLossDb === undefined
                ? s.returnLossNone
                : amount(result.returnLossDb, 4, s.unitDb)
            }
            mono={result.returnLossDb !== undefined}
          />
          <ResultRow label={s.outReflection} value={proNum(result.reflectionCoefficient, 6)} />
          <ResultRow
            label={s.outReflectedPercent}
            value={amount(result.reflectedPercent, 4, s.unitPercent)}
          />
          <ResultRow
            label={s.outPowerDelivered}
            value={amount(result.powerDelivered * 100, 4, s.unitPercent)}
          />
          <ResultRow
            label={s.outMismatchLoss}
            value={amount(result.mismatchLossDb, 4, s.unitDb)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.known, value: kindLabel },
              { label: s.value, value: proNum(num(valueText), 6) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function PathLossTool() {
  const s = strings.pro.radio["path-loss"];
  const [distanceText, setDistanceText] = useState("");
  const [frequencyText, setFrequencyText] = useState("");

  const typed = anyTyped(distanceText, frequencyText);
  const result = pathLoss({ distanceKm: num(distanceText), frequencyHz: num(frequencyText) });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "distance"
        ? s.errorDistance
        : s.errorFrequency;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outLoss}: ${amount(result.lossDb, 4, s.unitDb)}`,
        `${s.outFraction}: ${amount(result.powerFraction * 100, 8, s.unitPercent)}`,
        `${s.outWavelength}: ${amount(result.wavelengthM, 6, s.unitM)}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.distance}
        hint={s.distanceHint}
        value={distanceText}
        onChange={setDistanceText}
      />
      <ToolInput
        label={s.frequency}
        hint={s.frequencyHint}
        value={frequencyText}
        onChange={setFrequencyText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outLoss} value={amount(result.lossDb, 4, s.unitDb)} />
          <ResultRow
            label={s.outFraction}
            value={amount(result.powerFraction * 100, 8, s.unitPercent)}
          />
          <ResultRow label={s.outWavelength} value={amount(result.wavelengthM, 6, s.unitM)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.distance, value: amount(num(distanceText), 4, s.unitKm) },
              { label: s.frequency, value: amount(num(frequencyText), 3, s.unitHz) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function FresnelZoneTool() {
  const s = strings.pro.radio["fresnel-zone"];
  const [pathText, setPathText] = useState("");
  const [fromEndText, setFromEndText] = useState("");
  const [frequencyText, setFrequencyText] = useState("");

  const typed = anyTyped(pathText, fromEndText, frequencyText);
  const result = fresnelRadius({
    pathKm: num(pathText),
    fromEndKm: num(fromEndText),
    frequencyHz: num(frequencyText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "path"
        ? s.errorPath
        : result.reason === "fromEnd"
          ? s.errorFromEnd
          : s.errorFrequency;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outRadius}: ${amount(result.radiusM, 4, s.unitM)}`,
        `${s.outClearance}: ${amount(result.clearance60M, 4, s.unitM)}`,
        `${s.outWavelength}: ${amount(result.wavelengthM, 6, s.unitM)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.path} hint={s.pathHint} value={pathText} onChange={setPathText} />
      <ToolInput
        label={s.fromEnd}
        hint={s.fromEndHint}
        value={fromEndText}
        onChange={setFromEndText}
      />
      <ToolInput
        label={s.frequency}
        hint={s.frequencyHint}
        value={frequencyText}
        onChange={setFrequencyText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outRadius} value={amount(result.radiusM, 4, s.unitM)} />
          <ResultRow label={s.outClearance} value={amount(result.clearance60M, 4, s.unitM)} />
          <ResultRow label={s.outWavelength} value={amount(result.wavelengthM, 6, s.unitM)} />
          <ResultRow label={s.outToEnd} value={amount(result.toEndKm, 4, s.unitKm)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.path, value: amount(num(pathText), 4, s.unitKm) },
              { label: s.fromEnd, value: amount(num(fromEndText), 4, s.unitKm) },
              { label: s.frequency, value: amount(num(frequencyText), 3, s.unitHz) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function CoaxLossTool() {
  const s = strings.pro.radio["coax-loss"];
  const [dbText, setDbText] = useState("");
  const [lengthText, setLengthText] = useState("");
  const [powerText, setPowerText] = useState("");

  const typed = anyTyped(dbText, lengthText, powerText);
  const result = coaxLoss({
    dbPer100m: num(dbText),
    lengthM: num(lengthText),
    inputWatts: anyTyped(powerText) ? num(powerText) : undefined,
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "dbPer100m"
        ? s.errorDbPer100m
        : result.reason === "length"
          ? s.errorLength
          : s.errorPower;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outLoss}: ${amount(result.lossDb, 4, s.unitDb)}`,
        `${s.outFraction}: ${amount(result.powerFraction * 100, 4, s.unitPercent)}`,
        `${s.outLossPercent}: ${amount(result.lossPercent, 4, s.unitPercent)}`,
        ...(result.outputWatts === undefined
          ? []
          : [`${s.outOutputWatts}: ${amount(result.outputWatts, 4, s.unitW)}`]),
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.dbPer100m}
        hint={s.dbPer100mHint}
        value={dbText}
        onChange={setDbText}
      />
      <ToolInput label={s.length} hint={s.lengthHint} value={lengthText} onChange={setLengthText} />
      <ToolInput
        label={s.inputWatts}
        hint={s.inputWattsHint}
        value={powerText}
        onChange={setPowerText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outLoss} value={amount(result.lossDb, 4, s.unitDb)} />
          <ResultRow
            label={s.outFraction}
            value={amount(result.powerFraction * 100, 4, s.unitPercent)}
          />
          <ResultRow label={s.outLossPercent} value={amount(result.lossPercent, 4, s.unitPercent)} />
          {result.outputWatts !== undefined && (
            <ResultRow label={s.outOutputWatts} value={amount(result.outputWatts, 4, s.unitW)} />
          )}

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.dbPer100m, value: amount(num(dbText), 4, s.unitDb) },
              { label: s.length, value: amount(num(lengthText), 3, s.unitM) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export function LinkBudgetTool() {
  const s = strings.pro.radio["link-budget"];
  const [txPowerText, setTxPowerText] = useState("");
  const [txLossText, setTxLossText] = useState("");
  const [txGainText, setTxGainText] = useState("");
  const [rxLossText, setRxLossText] = useState("");
  const [rxGainText, setRxGainText] = useState("");
  const [pathLossText, setPathLossText] = useState("");

  const typed = anyTyped(
    txPowerText,
    txLossText,
    txGainText,
    rxLossText,
    rxGainText,
    pathLossText,
  );
  const result = linkBudget({
    txPowerDbm: num(txPowerText),
    txLossDb: num(txLossText),
    txGainDbi: num(txGainText),
    rxLossDb: num(rxLossText),
    rxGainDbi: num(rxGainText),
    pathLossDb: num(pathLossText),
  });
  const failure =
    result.ok || !typed
      ? undefined
      : result.reason === "txPower"
        ? s.errorTxPower
        : result.reason === "txLoss" || result.reason === "rxLoss"
          ? s.errorLoss
          : result.reason === "txGain" || result.reason === "rxGain"
            ? s.errorGain
            : s.errorPathLoss;

  const copyText = !result.ok
    ? ""
    : [
        `${s.outEirp}: ${amount(result.eirpDbm, 2, s.unitDbm)}`,
        `${s.outReceived}: ${amount(result.receivedDbm, 2, s.unitDbm)}`,
        `${s.outReceivedW}: ${amount(result.receivedW, 12, s.unitW)}`,
        `${s.outReceivedUv}: ${amount(result.receivedMicrovolts, 3, s.unitUv)}`,
        `${s.outNetGain}: ${amount(result.netGainDb, 2, s.unitDb)}`,
      ].join("\n");

  return (
    <>
      <ToolInput
        label={s.txPower}
        hint={s.txPowerHint}
        value={txPowerText}
        onChange={setTxPowerText}
      />
      <ToolInput label={s.txLoss} hint={s.txLossHint} value={txLossText} onChange={setTxLossText} />
      <ToolInput label={s.txGain} hint={s.txGainHint} value={txGainText} onChange={setTxGainText} />
      <ToolInput label={s.rxLoss} hint={s.rxLossHint} value={rxLossText} onChange={setRxLossText} />
      <ToolInput label={s.rxGain} hint={s.rxGainHint} value={rxGainText} onChange={setRxGainText} />
      <ToolInput
        label={s.pathLoss}
        hint={s.pathLossHint}
        value={pathLossText}
        onChange={setPathLossText}
      />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {result.ok && (
        <ToolSection title={s.results}>
          <ResultRow label={s.outEirp} value={amount(result.eirpDbm, 2, s.unitDbm)} />
          <ResultRow label={s.outReceived} value={amount(result.receivedDbm, 2, s.unitDbm)} />
          <ResultRow label={s.outReceivedW} value={amount(result.receivedW, 12, s.unitW)} />
          <ResultRow
            label={s.outReceivedUv}
            value={amount(result.receivedMicrovolts, 3, s.unitUv)}
          />
          <ResultRow label={s.outNetGain} value={amount(result.netGainDb, 2, s.unitDb)} />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.results}
            entries={[
              { label: s.txPower, value: amount(num(txPowerText), 2, s.unitDbm) },
              { label: s.txGain, value: amount(num(txGainText), 2, s.unitDbi) },
              { label: s.rxGain, value: amount(num(rxGainText), 2, s.unitDbi) },
              { label: s.pathLoss, value: amount(num(pathLossText), 2, s.unitDb) },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const RADIO_SURFACES: Readonly<Record<string, ComponentType>> = {
  "antenna-lengths": AntennaLengthsTool,
  "coax-loss": CoaxLossTool,
  "frequency-wavelength": FrequencyWavelengthTool,
  "fresnel-zone": FresnelZoneTool,
  "link-budget": LinkBudgetTool,
  "path-loss": PathLossTool,
  "swr-match": SwrMatchTool,
};
