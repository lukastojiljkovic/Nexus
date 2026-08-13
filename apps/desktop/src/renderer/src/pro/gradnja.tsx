import { stairFlight, type StairTop } from "@nexus/core/pro/gradnja";
import { useState, type ComponentType } from "react";

import { strings } from "../strings.js";
import { proNum, proRatio, proUnit } from "./format.js";
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
} from "./shared.js";

/**
 * „Gradnja i projektovanje" — this toolkit's surfaces.
 *
 * All arithmetic is `@nexus/core/pro/gradnja.ts`'s. Nothing here divides,
 * rounds or compares; this file shapes fields, hands the numbers over, and
 * reads the answers onto the page. That separation is what lets the maths be
 * tested against hand-worked vectors rather than against a screenshot.
 *
 * **Every surface in this file is `life-safety` or is not, and it never decides
 * which.** The host draws the notice from the registration and the copy button
 * appends the travelling line from the same place (`toolRisk.tsx`), so what is
 * left for a surface is the discipline the contract cannot enforce: show the
 * formula, echo the inputs, and put the user's own limit beside the computed
 * value with nothing but a ratio between them.
 */

/** A field that is a number or is empty — the drawer's one parse, written once. */
function num(text: string): number | undefined {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

export function StairGeometryTool() {
  const s = strings.pro.gradnja["stair-geometry"];
  const [rise, setRise] = useState("");
  const [risers, setRisers] = useState("");
  const [going, setGoing] = useState("");
  const [top, setTop] = useState<StairTop>("flush");
  const [riserLimit, setRiserLimit] = useState("");
  const [goingLimit, setGoingLimit] = useState("");

  const typed = num(rise) !== undefined || num(risers) !== undefined || num(going) !== undefined;
  const flight = stairFlight({
    rise: num(rise) ?? Number.NaN,
    risers: num(risers) ?? Number.NaN,
    going: num(going) ?? Number.NaN,
    top,
    riserLimit: num(riserLimit),
    goingLimit: num(goingLimit),
  });

  const failure =
    flight.ok || !typed
      ? undefined
      : flight.reason === "rise"
        ? s.errorRise
        : flight.reason === "risers"
          ? s.errorRisers
          : s.errorGoing;

  const copyText = !flight.ok
    ? ""
    : [
        `${s.riser}: ${proUnit(proNum(flight.riser, 3), s.unitMm)}`,
        `${s.goings}: ${flight.goings}`,
        `${s.run}: ${proUnit(proNum(flight.run, 1), s.unitMm)}`,
        `${s.pitch}: ${proNum(flight.pitch, 4)}${s.unitDeg}`,
        `${s.blondel}: ${proUnit(proNum(flight.blondel, 3), s.unitMm)}`,
        "",
        `${s.rise}: ${proUnit(proNum(num(rise) ?? 0, 1), s.unitMm)}`,
        `${s.risers}: ${risers.trim()}`,
        `${s.going}: ${proUnit(proNum(num(going) ?? 0, 1), s.unitMm)}`,
      ].join("\n");

  return (
    <>
      <ToolInput label={s.rise} hint={s.riseHint} value={rise} onChange={setRise} />
      <ToolInput label={s.risers} hint={s.risersHint} value={risers} onChange={setRisers} />
      <ToolInput label={s.going} hint={s.goingHint} value={going} onChange={setGoing} />
      <ToolSelect<StairTop>
        label={s.top}
        value={top}
        onChange={setTop}
        options={[
          { id: "flush", label: s.topFlush },
          { id: "landing", label: s.topLanding },
        ]}
      />
      {/* The two regulated figures, side by side with everything else and with
          no default in either. Which maximum applies depends on the building,
          its use and the rule in force — none of which this app has been told. */}
      <ToolInput
        label={s.riserLimit}
        hint={s.limitHint}
        value={riserLimit}
        onChange={setRiserLimit}
      />
      <ToolInput label={s.goingLimit} value={goingLimit} onChange={setGoingLimit} />

      {failure !== undefined && <ToolFailure>{failure}</ToolFailure>}

      {flight.ok && (
        <ToolSection title={s.results}>
          {/* Three decimals of a millimetre, and the reason is in the core
              module: the riser is H/n exactly, and rounding it is what leaves
              one step at the top a different height from the other sixteen. */}
          <ResultRow label={s.riser} value={proUnit(proNum(flight.riser, 3), s.unitMm)} />
          <ResultRow label={s.goings} value={flight.goings} />
          <ResultRow
            label={s.run}
            value={`${proUnit(proNum(flight.run, 1), s.unitMm)} · ${proUnit(proNum(flight.run / 1000, 3), s.unitM)}`}
          />
          <ResultRow label={s.pitch} value={`${proNum(flight.pitch, 4)}${s.unitDeg}`} />
          <ResultRow label={s.blondel} value={proUnit(proNum(flight.blondel, 3), s.unitMm)} />
          <p className="tool__note">{s.blondelNote}</p>

          {/* The computed value, the limit the user typed, and the quotient.
              No word, no colour, no icon — whether 0,96 is acceptable is a
              question for the person who chose the rule. */}
          <ToolAgainstLimit
            label={s.riser}
            value={proUnit(proNum(flight.riser, 3), s.unitMm)}
            limitLabel={s.riserLimit}
            limit={
              num(riserLimit) === undefined
                ? undefined
                : proUnit(proNum(num(riserLimit) ?? 0, 1), s.unitMm)
            }
            ratioLabel={s.riserRatio}
            ratio={proRatio(flight.riserRatio)}
          />
          <ToolAgainstLimit
            label={s.going}
            value={proUnit(proNum(num(going) ?? 0, 1), s.unitMm)}
            limitLabel={s.goingLimit}
            limit={
              num(goingLimit) === undefined
                ? undefined
                : proUnit(proNum(num(goingLimit) ?? 0, 1), s.unitMm)
            }
            ratioLabel={s.goingRatio}
            ratio={proRatio(flight.goingRatio)}
          />

          <ToolFormula>{s.formula}</ToolFormula>
          <ToolInputEcho
            title={s.inputs}
            entries={[
              { label: s.rise, value: proUnit(proNum(num(rise) ?? 0, 1), s.unitMm) },
              { label: s.risers, value: risers.trim() },
              { label: s.going, value: proUnit(proNum(num(going) ?? 0, 1), s.unitMm) },
              { label: s.top, value: top === "flush" ? s.topFlush : s.topLanding },
            ]}
          />
          <CopyButton value={copyText} />
        </ToolSection>
      )}
    </>
  );
}

export const GRADNJA_SURFACES: Readonly<Record<string, ComponentType>> = {
  "stair-geometry": StairGeometryTool,
};
