import { useState } from "react";
import { Card, TextField } from "@nexus/ui";
import {
  MAX_DAYS,
  MAX_PEOPLE,
  MIN_DAYS,
  MIN_PEOPLE,
  isRationCount,
  rationPlan,
} from "@nexus/core";
import { numberFormat } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { copy } from "./copy.js";

/**
 * The water and food calculator: how many people, for how many days, against the
 * guidelines the copy names.
 *
 * **Nothing is pre-filled.** A household is a fact the user knows and the page
 * does not, so the two fields start empty and the figures wait for both. A typed
 * value is read as a whole number, and one outside the engine's bounds leaves the
 * figures blank with the range printed beside the fields, rather than showing a
 * number for an input the engine refuses.
 */

/** The text of a count field as a number, or NaN for a field that is empty or not a number. */
function countOf(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

export function RationCard() {
  const [people, setPeople] = useState("");
  const [days, setDays] = useState("");
  const plan = rationPlan(countOf(people), countOf(days));
  const litres = numberFormat({ maximumFractionDigits: 1 });
  const bounds = copy.prep.rangeHint
    .replace("{minPeople}", String(MIN_PEOPLE))
    .replace("{maxPeople}", String(MAX_PEOPLE))
    .replace("{minDays}", String(MIN_DAYS))
    .replace("{maxDays}", String(MAX_DAYS));
  const refused =
    (people !== "" && !isRationCount(countOf(people), MIN_PEOPLE, MAX_PEOPLE)) ||
    (days !== "" && !isRationCount(countOf(days), MIN_DAYS, MAX_DAYS));

  return (
    <Card className="emergency__card" title={copy.prep.rationTitle}>
      <p className="nx-hint">{copy.prep.rationHint}</p>
      <div className="emergency__fields">
        <TextField
          label={copy.prep.peopleLabel}
          type="number"
          inputMode="numeric"
          min={MIN_PEOPLE}
          max={MAX_PEOPLE}
          value={people}
          onChange={(event) => {
            setPeople(event.target.value);
          }}
        />
        <TextField
          label={copy.prep.daysLabel}
          type="number"
          inputMode="numeric"
          min={MIN_DAYS}
          max={MAX_DAYS}
          value={days}
          onChange={(event) => {
            setDays(event.target.value);
          }}
        />
      </div>
      {refused ? (
        <p className="emergency__error">{bounds}</p>
      ) : (
        <p className="nx-hint">{bounds}</p>
      )}
      {plan !== null && (
        <dl className="emergency__facts">
          <dt>{copy.prep.waterLabel}</dt>
          <dd>{copy.prep.litres.replace("{litres}", litres.format(plan.waterLitres))}</dd>
          <dt>{copy.prep.drinkingLabel}</dt>
          <dd>{copy.prep.litres.replace("{litres}", litres.format(plan.drinkingLitres))}</dd>
          <dt>{copy.prep.foodLabel}</dt>
          <dd>
            {plan.foodPersonDays} {copy.prep.personDays}
          </dd>
        </dl>
      )}
    </Card>
  );
}
