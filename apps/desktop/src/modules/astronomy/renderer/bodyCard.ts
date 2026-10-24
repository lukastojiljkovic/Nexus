import type { BodyId, BodyState, SolarSystemSnapshot, Vector3 } from "@nexus/core";

import { activeLocale, numberFormat } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { BODY_FACTS, type BodyFacts } from "../shared/facts.js";
import { copy } from "./copy.js";
import { KM_PER_AU } from "./solar/scale.js";

type Locale = ReturnType<typeof activeLocale>;

/**
 * What the body card says about one selected body: where it is now, relative to
 * the others, and what NASA publishes about it.
 *
 * Every distance here is the length of a difference of two heliocentric
 * positions, computed from the snapshot the view already draws, so the card and
 * the view cannot disagree about where a body is. The published facts come from
 * `shared/facts.ts`, parsed by key, never typed in here.
 */

/** The speed of light in vacuum, metres per second. Exact by the SI definition of the metre. */
const SPEED_OF_LIGHT_M_S = 299_792_458;

export type BodyKind = "star" | "planet" | "dwarf" | "moon";

export interface Distance {
  readonly id: BodyId;
  readonly au: number;
}

/** One published value. `value` is a number, or a Yes/No flag for the ring system. */
export interface BodyFact {
  readonly key:
    | "diameter"
    | "mass"
    | "gravity"
    | "day"
    | "rotation"
    | "orbit"
    | "orbitMoon"
    | "temperature"
    | "moons"
    | "rings";
  readonly value: number | boolean;
}

export interface BodyCardModel {
  readonly id: BodyId;
  readonly kind: BodyKind;
  readonly fromSunAu: number | null;
  readonly fromEarthAu: number | null;
  readonly lightSeconds: number | null;
  readonly nearest: Distance | null;
  readonly others: readonly Distance[];
  readonly facts: readonly BodyFact[];
}

function bodyAt(snapshot: SolarSystemSnapshot, id: BodyId): BodyState {
  const body = snapshot.bodies.find((candidate) => candidate.id === id);
  if (body === undefined) throw new Error(`The snapshot holds no ${id}`);
  return body;
}

function distanceAu(a: Vector3, b: Vector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function kindOf(id: BodyId): BodyKind {
  if (id === "sun") return "star";
  if (id === "pluto") return "dwarf";
  if (id === "moon") return "moon";
  return "planet";
}

/** A published number, or `null` when the table has no such row or the row has no number. */
function numberRow(table: BodyFacts, row: string): number | null {
  const value = table[row]?.value;
  return value !== undefined && "number" in value ? value.number : null;
}

function facts(id: BodyId): readonly BodyFact[] {
  const table = BODY_FACTS[id];
  const isSun = id === "sun";
  const entries: readonly (readonly [BodyFact["key"], number | boolean | null])[] = [
    ["diameter", isSun ? twice(numberRow(table, "volumetricMeanRadius")) : numberRow(table, "diameter")],
    ["mass", numberRow(table, "mass")],
    ["gravity", numberRow(table, isSun ? "surfaceGravity" : "gravity")],
    [isSun ? "rotation" : "day", numberRow(table, isSun ? "siderealRotationPeriod" : "lengthOfDay")],
    [id === "moon" ? "orbitMoon" : "orbit", numberRow(table, "orbitalPeriod")],
    ["temperature", numberRow(table, "meanTemperature")],
    ["moons", numberRow(table, "numberOfMoons")],
    ["rings", flagRow(table, "ringSystem")],
  ];
  return entries.flatMap(([key, value]) => (value === null ? [] : [{ key, value }]));
}

function twice(value: number | null): number | null {
  return value === null ? null : 2 * value;
}

function flagRow(table: BodyFacts, row: string): boolean | null {
  const value = table[row]?.value;
  return value !== undefined && "flag" in value ? value.flag : null;
}

export function bodyCardModel(snapshot: SolarSystemSnapshot, id: BodyId): BodyCardModel {
  const body = bodyAt(snapshot, id);
  const sun = bodyAt(snapshot, "sun");
  const earth = bodyAt(snapshot, "earth");

  const fromSunAu = id === "sun" ? null : distanceAu(body.position, sun.position);
  const fromEarthAu = id === "earth" ? null : distanceAu(body.position, earth.position);
  const lightSeconds =
    fromEarthAu === null ? null : (fromEarthAu * KM_PER_AU * 1000) / SPEED_OF_LIGHT_M_S;

  const others = snapshot.bodies
    .filter((other) => other.id !== id)
    .map((other) => ({ id: other.id, au: distanceAu(body.position, other.position) }))
    .sort((a, b) => a.au - b.au);

  return {
    id,
    kind: kindOf(id),
    fromSunAu,
    fromEarthAu,
    lightSeconds,
    nearest: others[0] ?? null,
    others,
    facts: facts(id),
  };
}

/**
 * A distance in the interface's language. Under 0.01 au it is kilometres, which
 * is the scale a satellite is measured in; from there it is au with three
 * decimals and million kilometres with one.
 */
export function formatDistance(au: number, locale: Locale): string {
  if (au < 0.01) {
    const km = numberFormat({ maximumFractionDigits: 0 }, locale).format(au * KM_PER_AU);
    return `${km} ${copy.card.units.km}`;
  }
  const inAu = numberFormat({ minimumFractionDigits: 3, maximumFractionDigits: 3 }, locale).format(au);
  const inMillionKm = numberFormat(
    { minimumFractionDigits: 1, maximumFractionDigits: 1 },
    locale,
  ).format((au * KM_PER_AU) / 1_000_000);
  return `${inAu} ${copy.card.units.au} · ${inMillionKm} ${copy.card.units.millionKm}`;
}

/** A light time in seconds, minutes or hours, whichever keeps the figure under a few hundred. */
export function formatLightTime(seconds: number, locale: Locale): string {
  const oneDecimal = numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 }, locale);
  if (seconds < 120) return `${oneDecimal.format(seconds)} ${copy.card.units.seconds}`;
  if (seconds < 7200) return `${oneDecimal.format(seconds / 60)} ${copy.card.units.minutes}`;
  return `${oneDecimal.format(seconds / 3600)} ${copy.card.units.hours}`;
}
