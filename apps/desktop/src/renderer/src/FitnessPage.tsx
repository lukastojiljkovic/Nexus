import { useState } from "react";
import { Button, PageHeader } from "@nexus/ui";
import { FitMeasurements } from "./FitMeasurements.js";
import { FitNutrition } from "./FitNutrition.js";
import { FitTraining } from "./FitTraining.js";
import { moduleName } from "./moduleName.js";
import { strings } from "./strings.js";

/**
 * „Fitnes" — the module's page, and nothing but its frame.
 *
 * **FIT is ONE hub with two halves** (ADR-081 §9), which is why „Trening" is a
 * section here rather than a thirteenth module in the rail: a person tracking
 * their body does not think of what they eat and what they lift as two
 * applications, and splitting them would put the same subject in two places and
 * make neither of them the answer to „kako mi ide".
 *
 * The switch is typographic — the app's one selection grammar
 * (`.nx-segmented__option`, keyed off `aria-pressed`) — so the accessible state
 * and the visible one cannot drift apart.
 *
 * **Each half owns its own loading, its own failure and its own writes.** The
 * shell holds one piece of state, and it is which half is on screen. That is
 * ADR-045's per-widget boundary applied one level up: „Ishrana" failing to load
 * must leave „Trening" perfectly usable, and it does, because neither knows the
 * other exists.
 *
 * Switching sections UNMOUNTS the other one, deliberately. A half kept alive off
 * screen would hold an open form, a debounced search and a day it had walked to,
 * and would come back showing a moment that has since passed — while its data
 * would be as stale as the last time anybody looked. Coming back to a fresh
 * read is the honest behaviour and costs one round trip.
 */

/** The page's two halves, in the order the switch draws them. */
const FIT_SECTIONS = ["nutrition", "training", "measurements"] as const;

type FitSection = (typeof FIT_SECTIONS)[number];

export interface FitnessPageProps {
  profileId: string;
}

export function FitnessPage({ profileId }: FitnessPageProps) {
  const s = strings.fitness.sections;
  const [section, setSection] = useState<FitSection>("nutrition");

  return (
    <div className="fit">
      <PageHeader title={moduleName("fitness")} />

      <div className="fit__sections" role="group" aria-label={s.label}>
        {FIT_SECTIONS.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            className="nx-segmented__option fit__section-tab"
            aria-pressed={section === option}
            onClick={() => setSection(option)}
          >
            {option === "nutrition" ? s.nutrition : option === "training" ? s.training : s.measurements}
          </Button>
        ))}
      </div>

      {section === "nutrition" ? (
        <FitNutrition profileId={profileId} />
      ) : section === "training" ? (
        <FitTraining profileId={profileId} />
      ) : (
        <FitMeasurements profileId={profileId} />
      )}
    </div>
  );
}
