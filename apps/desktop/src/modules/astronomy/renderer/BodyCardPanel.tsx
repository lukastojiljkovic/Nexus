import type { ReactNode } from "react";
import type { BodyId, SolarSystemSnapshot } from "@nexus/core";
import { Button, Card, Icon } from "@nexus/ui";
import {
  activeLocale,
  dateTimeFormat,
  numberFormat,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { BODY_FACTS_SOURCE } from "../shared/facts.js";
import { copy } from "./copy.js";
import { type BodyFact, bodyCardModel, formatDistance, formatLightTime } from "./bodyCard.js";
import { bodyLabel } from "./solar/bodies.js";

/**
 * The card a clicked body opens: what it is, where it is relative to the others
 * right now, and what NASA publishes about it.
 *
 * It is a labelled region rather than a `section`, because `Card` draws a
 * `div` and a region with a name is what a `section` is for. Escape closes it
 * while focus is inside it, and the close button is the only other way out.
 */
export function BodyCardPanel({
  snapshot,
  id,
  onClose,
}: {
  readonly snapshot: SolarSystemSnapshot;
  readonly id: BodyId;
  readonly onClose: () => void;
}) {
  const locale = activeLocale();
  const model = bodyCardModel(snapshot, id);
  const name = bodyLabel(id, locale);

  return (
    <Card
      role="region"
      aria-label={name}
      className="astronomy__bodycard"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <header className="astronomy__bodycard-head">
        <div>
          <h2 className="astronomy__bodycard-name">{name}</h2>
          <p className="nx-hint">{copy.card.kinds[model.kind]}</p>
        </div>
        <Button variant="ghost" size="sm" aria-label={copy.card.close} onClick={onClose}>
          <Icon name="close" size={14} />
        </Button>
      </header>

      <h3 className="astronomy__bodycard-heading">{copy.card.now}</h3>
      <dl className="astronomy__bodycard-list">
        {model.fromSunAu !== null && (
          <Row term={copy.card.fromSun} value={formatDistance(model.fromSunAu, locale)} />
        )}
        {model.fromEarthAu !== null && (
          <Row term={copy.card.fromEarth} value={formatDistance(model.fromEarthAu, locale)} />
        )}
        {model.lightSeconds !== null && (
          <Row term={copy.card.light} value={formatLightTime(model.lightSeconds, locale)} />
        )}
        {model.nearest !== null && (
          <Row
            term={copy.card.nearest}
            value={`${bodyLabel(model.nearest.id, locale)} · ${formatDistance(model.nearest.au, locale)}`}
          />
        )}
      </dl>

      <details className="astronomy__bodycard-others">
        <summary>{copy.card.others}</summary>
        <dl className="astronomy__bodycard-list">
          {model.others.map((other) => (
            <Row
              key={other.id}
              term={bodyLabel(other.id, locale)}
              value={formatDistance(other.au, locale)}
            />
          ))}
        </dl>
      </details>

      {model.facts.length > 0 && (
        <>
          <h3 className="astronomy__bodycard-heading">{copy.card.facts}</h3>
          <dl className="astronomy__bodycard-list">
            {model.facts.map((fact) => (
              <Row key={fact.key} term={copy.card[fact.key]} value={factText(fact)} />
            ))}
          </dl>
        </>
      )}

      <p className="nx-hint">
        {copy.card.source.replace(
          "{date}",
          dateTimeFormat({ dateStyle: "medium", timeZone: "UTC" }).format(
            new Date(BODY_FACTS_SOURCE.retrieved),
          ),
        )}
      </p>
    </Card>
  );
}

function Row({ term, value }: { readonly term: string; readonly value: ReactNode }) {
  return (
    <div className="astronomy__bodycard-row">
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function factText(fact: BodyFact): string {
  if (typeof fact.value === "boolean") return fact.value ? copy.card.yes : copy.card.no;
  const number = numberFormat({ maximumFractionDigits: 3 }).format(fact.value);
  const unit = factUnit(fact.key);
  return unit === undefined ? number : `${number} ${unit}`;
}

/** The unit each published number is written in; `undefined` for a count. */
function factUnit(key: BodyFact["key"]): string | undefined {
  const units = copy.card.units;
  const table: Record<BodyFact["key"], string | undefined> = {
    diameter: units.km,
    mass: units.mass,
    gravity: units.gravity,
    day: units.hours,
    rotation: units.hours,
    orbit: units.days,
    orbitMoon: units.days,
    temperature: units.celsius,
    moons: undefined,
    rings: undefined,
  };
  return table[key];
}
