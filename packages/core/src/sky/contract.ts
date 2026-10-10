/**
 * The astronomy corner's seams: the shapes the solar-system engine produces and
 * the 3D view, the day-and-night map and the star map draw.
 *
 * The engine (`packages/core/src/sky/planets.ts`, `earthView.ts`, `stars.ts`)
 * and the three views are written at the same time, so this file fixes what
 * passes between them. Types only.
 *
 * Frames and units, once: positions are heliocentric, in the ecliptic and
 * equinox of J2000.0, in astronomical units; angles are degrees; instants are
 * epoch milliseconds, UTC.
 */

export type BodyId =
  | "sun"
  | "mercury"
  | "venus"
  | "earth"
  | "moon"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune"
  | "pluto";

export type Vector3 = readonly [x: number, y: number, z: number];

export interface BodyState {
  readonly id: BodyId;
  /** Heliocentric ecliptic J2000 position, au. The Sun is at the origin. */
  readonly position: Vector3;
  /** Mean radius, km (IAU). */
  readonly radiusKm: number;
  /** The angle of the prime meridian, degrees (IAU rotation model), for texturing the globe. */
  readonly rotationDeg: number;
  /** The north pole's direction in the same ecliptic frame, as a unit vector. */
  readonly northPole: Vector3;
  /** Distance from Earth's centre, au (0 for Earth). */
  readonly distanceFromEarthAu: number;
}

export interface SolarSystemSnapshot {
  readonly instantMs: number;
  readonly bodies: readonly BodyState[];
}

/** One body's orbit, sampled, for drawing its path. */
export interface OrbitPath {
  readonly id: BodyId;
  readonly points: readonly Vector3[];
}

export interface LatLon {
  readonly latDeg: number;
  readonly lonDeg: number;
}

/** Earth's day and night at one instant. */
export interface DayNight {
  readonly instantMs: number;
  /** Where the Sun is overhead. Its latitude is the Sun's declination. */
  readonly subsolar: LatLon;
  /** Where the Moon is overhead. */
  readonly sublunar: LatLon;
  /** The terminator (Sun's centre on the horizon), west to east, closed. */
  readonly terminator: readonly LatLon[];
  /** The edges of civil, nautical and astronomical twilight, same shape. */
  readonly twilight: {
    readonly civil: readonly LatLon[];
    readonly nautical: readonly LatLon[];
    readonly astronomical: readonly LatLon[];
  };
}

export interface Star {
  /** Bright Star Catalogue number. */
  readonly hr: number;
  readonly name?: string;
  /** J2000 right ascension and declination, degrees. */
  readonly raDeg: number;
  readonly decDeg: number;
  readonly magnitude: number;
  /** B−V colour index, for tinting. */
  readonly colourIndex?: number;
}

export interface Constellation {
  /** IAU three-letter abbreviation. */
  readonly id: string;
  readonly name: { readonly latin: string; readonly sr: string; readonly en: string };
  /** Stick-figure lines as pairs of HR numbers. */
  readonly lines: readonly (readonly [number, number])[];
}
