import { zonePoint, type LatLon } from "@nexus/core";

/**
 * ASTRONOMY's one preference — the place — as a DEVICE value in `localStorage`.
 *
 * **Why this is not a profile row.** The module has no store and no migration
 * (`shared/manifest.ts` says so), and the place is a fact about THIS machine
 * before it is a fact about the person: the default is the principal city of the
 * computer's own time zone, read with no permission, no prompt and no network
 * (`zoneLocation.ts`). `signals`' `prefs.ts` states the same arrangement for its
 * three knobs, and the settings card is declared `storage: "device"` so the
 * shell's own „Vrati na podrazumevano" is offered over it.
 *
 * **One key, and every reader is total.** `localStorage` is writable by anything
 * with a console, so a stored pair is narrowed on read: a latitude outside
 * ±90, a longitude outside ±180, a missing field, a string that is not JSON —
 * each answers `null`, which is the honest „no place picked" rather than a
 * coordinate the views would then draw a sky for.
 *
 * **The key is per profile.** The value is this machine's, but it is somebody's:
 * two people share a laptop, and the astronomy corner of one is not the other's.
 * `signals` keeps its keys the same way, and `nexus.profile.…` belongs to the
 * opening questionnaire — hence the qualified prefix rather than a bare name.
 */

export interface AstronomyPrefs {
  /** The picked place, or `null` for „use the computer's zone". */
  readonly place: LatLon | null;
}

/** The default: no picked place, so the zone decides. */
export const ASTRONOMY_DEFAULTS: AstronomyPrefs = { place: null };

/**
 * The `localStorage` key of one profile's place.
 *
 * Exported so the key is data a test can pin rather than a string built at two
 * call sites — the defect that shape produces is a write to one key and a read
 * from another, which reads as a preference that silently does not stick.
 */
export function astronomyPrefKey(profileId: string): string {
  return `nexus.astronomy.${profileId}.place`;
}

/** A latitude inside its own range, or `null`. */
function latitude(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90
    ? value
    : null;
}

/** A longitude inside its own range, or `null`. */
function longitude(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180
    ? value
    : null;
}

/**
 * A stored document, read whole, or the defaults.
 *
 * The two halves are read TOGETHER because a place is a pair: half of one is a
 * coordinate the views cannot draw a sky for, and answering the other half
 * would be inventing the second coordinate.
 */
export function parseAstronomyPrefs(stored: string | null): AstronomyPrefs {
  if (stored === null) return ASTRONOMY_DEFAULTS;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return ASTRONOMY_DEFAULTS;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ASTRONOMY_DEFAULTS;
  const record = raw as Record<string, unknown>;
  const latDeg = latitude(record["latDeg"]);
  const lonDeg = longitude(record["lonDeg"]);
  return latDeg === null || lonDeg === null ? ASTRONOMY_DEFAULTS : { place: { latDeg, lonDeg } };
}

/** This profile's stored place. */
export function readAstronomyPrefs(profileId: string): AstronomyPrefs {
  return parseAstronomyPrefs(localStorage.getItem(astronomyPrefKey(profileId)));
}

/**
 * Writes the place. „No picked place" REMOVES the key, so the zone default has
 * exactly one representation — a stored document saying `null` would be a second
 * one, and the two would then have to be kept meaning the same thing.
 */
export function persistAstronomyPrefs(profileId: string, prefs: AstronomyPrefs): void {
  if (prefs.place === null) {
    localStorage.removeItem(astronomyPrefKey(profileId));
    return;
  }
  localStorage.setItem(
    astronomyPrefKey(profileId),
    JSON.stringify({ latDeg: prefs.place.latDeg, lonDeg: prefs.place.lonDeg }),
  );
}

/** Forgets the picked place — the reset the module's own settings card offers. */
export function clearStoredAstronomyPreferences(profileId: string): void {
  localStorage.removeItem(astronomyPrefKey(profileId));
}

/**
 * The place the views actually draw, from the stored preference and the zone.
 *
 * A picked place wins outright; with none, the zone's own principal city is the
 * answer (`zonePoint`), and a zone the shipped table does not carry answers
 * `null` rather than a neighbour's coordinates (`zoneLocation.ts` explains why
 * that is the honest answer). This is the whole of the module's place
 * resolution, which is what makes a first open already right and a second one
 * the user's own.
 */
export function resolveObserver(place: LatLon | null, zone: string | null): LatLon | null {
  if (place !== null) return place;
  return zone === null ? null : zonePoint(zone);
}
