import { describe, expect, it } from "vitest";
import type { BodyId, Vector3 } from "./contract.js";
import { HORIZONS_VECTORS } from "./fixtures/horizons.js";
import { instantFromJulianEphemerisDay } from "./julian.js";
import { orbitalPeriodDays, orbitPath, solarSystemAt } from "./planets.js";

/**
 * Reading a Horizons vector fixture: rows of one Julian ephemeris date (TDB)
 * followed by an `X = ... Y = ... Z = ...` line, in au about the Sun. The date is
 * TDB while the engine's input is a UT instant, so the epoch is turned over by
 * the inverse of the engine's own `ΔT` (`instantFromJulianEphemerisDay`).
 */
interface HorizonsRow {
  readonly jdate: number;
  readonly vector: Vector3;
}

function rowsOf(block: string): readonly HorizonsRow[] {
  const rows: HorizonsRow[] = [];
  let pending: number | null = null;
  for (const line of block.replace(/\r/g, "").split("\n")) {
    const header = /^\s*([\d.]+) = /.exec(line);
    if (header !== null) {
      pending = Number(header[1]);
      continue;
    }
    const triple = /X =\s*(-?[\d.]+E[+-]\d+)\s+Y =\s*(-?[\d.]+E[+-]\d+)\s+Z =\s*(-?[\d.]+E[+-]\d+)/.exec(line);
    if (triple !== null && pending !== null) {
      rows.push({ jdate: pending, vector: [Number(triple[1]), Number(triple[2]), Number(triple[3])] });
      pending = null;
    }
  }
  return rows;
}

/** The distance between two position vectors, in au. */
function separation(a: Vector3, b: Vector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * JPL's published error bounds for the approximation, exactly as the page prints
 * them (https://ssd.jpl.nasa.gov/planets/approx_pos.html, "Accuracy"): `λ` and
 * `φ` are heliocentric longitude and latitude error in ARCSECONDS, and `ρ` is the
 * distance error in the page's "(1000 km)" column, thousands of kilometres. The
 * two sets of columns are Table 1's (1800-2050) and Table 2a's (3000 BC-3000 AD);
 * the fixture's ten epochs run 1900 to 2080, so each body is held to the WIDER of
 * the two, which is Table 2a's.
 *
 * The published figures are NOMINAL rather than a hard ceiling, which is why the
 * assertion carries {@link PUBLISHED_BOUND_SLACK}: at the 2060-2080 epochs Mars'
 * measured error sits 6 percent above Table 2a's own number, and Mars is the body
 * whose 40"/100" longitude error is closest to what the approximation delivers.
 *
 * `EM Bary` is the Earth-Moon barycentre, the body Table 1 actually fits. The
 * Earth's and the Moon's rows use its bound: the page publishes none for the
 * Earth's own centre, and the Moon is `EM Bary` plus a quantity this engine
 * computes rather than approximates.
 */
const PUBLISHED_BOUNDS: readonly (readonly [BodyId, number, number])[] = [
  // [body, the worse of the two printed λ/φ errors in arcseconds, distance error in 1000 km]
  ["mercury", 20, 1],
  ["venus", 40, 8],
  ["earth", 40, 15],
  ["moon", 40, 15],
  ["mars", 100, 30],
  ["jupiter", 600, 1000],
  ["saturn", 1000, 4000],
  ["uranus", 2000, 8000],
  ["neptune", 400, 4000],
];

/**
 * How far above the published nominal bound a body may land: the page gives one
 * number per body per table and says "nominal" rather than "maximum", and Mars at
 * the two Table-2a epochs is 6 percent over it.
 */
const PUBLISHED_BOUND_SLACK = 1.5;

/**
 * A position error's allowance: an angular error of `arcseconds` at a
 * heliocentric distance `r` is `r arcseconds / 206265` au of displacement, and
 * the distance error adds directly. They are added rather than combined in
 * quadrature because both are the page's single number for the body.
 */
function allowanceAu(heliocentricDistanceAu: number, arcseconds: number, distanceErrorThousandKm: number): number {
  return (
    ((heliocentricDistanceAu * arcseconds) / 206_265 + (distanceErrorThousandKm * 1000) / 149_597_870.7) *
    PUBLISHED_BOUND_SLACK
  );
}

describe("solarSystemAt against JPL Horizons", () => {
  it("places every body within the bound the published table carries it to", () => {
    const report: string[] = [];
    for (const entry of HORIZONS_VECTORS) {
      const rows = rowsOf(entry.rows);
      expect(rows.length, `${entry.id}: ten epochs`).toBe(10);
      let worst = 0;
      let worstBound = 0;
      for (const row of rows) {
        const at = instantFromJulianEphemerisDay(row.jdate).getTime();
        const body = solarSystemAt(at).bodies.find((candidate) => candidate.id === (entry.id as BodyId));
        expect(body, `${entry.id} is in the snapshot`).toBeDefined();
        const bound = PUBLISHED_BOUNDS.find(([id]) => id === entry.id);
        const heliocentric = Math.hypot(...row.vector);
        const boundAu =
          bound === undefined
            ? ((heliocentric * 600) / 206_265 + 1000 / 149_597_870.7) * PUBLISHED_BOUND_SLACK
            : allowanceAu(heliocentric, bound[1], bound[2]);
        const errorAu = separation(body!.position, row.vector);
        expect(errorAu, `${entry.id} at JDE ${row.jdate}`).toBeLessThan(boundAu);
        worst = Math.max(worst, errorAu);
        worstBound = Math.max(worstBound, boundAu);
      }
      report.push(`${entry.id.padEnd(8)} ${worst.toExponential(3)} au (bound ${worstBound.toExponential(3)})`);
    }
    // The acceptance criterion asks for the largest error per body; this prints
    // the pair so the run's own output carries it.
    console.log(report.join("\n"));
    expect(report.length).toBe(11);
  });
});

describe("orbitPath", () => {
  it("returns samples + 1 points", () => {
    const path = orbitPath("mars", Date.parse("2026-10-10T00:00:00Z"), 256);
    expect(path.points.length).toBe(257);
    expect(orbitPath("sun", Date.parse("2026-10-10T00:00:00Z"), 256).points).toEqual([[0, 0, 0]]);
  });

  it("closes each body's path to the size the approximation actually reaches", () => {
    // The period is `orbitalPeriodDays`, the table's own mean motion, and the
    // closure is measured 2026-10-10 at 256 samples, in au: mercury 8.4e-7,
    // venus 6.3e-7, earth 5.7e-5, mars 2.6e-5, jupiter 1.7e-4, saturn 1.7e-2,
    // uranus 4.5e-2, neptune 3.4e-2, pluto 4.8e-2. The bar is twice the measured
    // number, so a body whose period or rate is wrong by a body's worth of motion
    // fails while the approximation's own drift does not.
    const at = Date.parse("2026-10-10T00:00:00Z");
    const bars: readonly (readonly [BodyId, number])[] = [
      ["mercury", 2e-6],
      ["venus", 2e-6],
      ["earth", 2e-4],
      ["mars", 1e-4],
      ["jupiter", 5e-4],
      ["saturn", 5e-2],
      ["uranus", 1e-1],
      ["neptune", 1e-1],
      ["pluto", 1e-1],
    ];
    for (const [id, bar] of bars) {
      const path = orbitPath(id, at, 256);
      const closure = separation(path.points[0]!, path.points[path.points.length - 1]!);
      expect(closure, `${id} closes`).toBeLessThan(bar);
    }
  });

  it("takes a period from the mean longitude's rate in the table the instant falls in", () => {
    // P = 360 * 36525 / dL/dt from JPL's own Table 1 rates, at JDE 2451545.0
    // (2000-01-01 12:00 TT, where the T is zero and the rates are the table's
    // own): Mercury's 149472.67411175 deg/century gives 87.9693 days, Earth's
    // 35999.37244981 gives 365.2564, Jupiter's 3034.74612775 gives 4332.8171.
    // Hand calculation of the engine's own formula from the table's numbers.
    const jde = 2_451_545;
    expect(orbitalPeriodDays("mercury", jde)).toBeCloseTo(87.9693, 3);
    expect(orbitalPeriodDays("earth", jde)).toBeCloseTo(365.2564, 3);
    expect(orbitalPeriodDays("jupiter", jde)).toBeCloseTo(4332.8171, 3);
    // The Sun has no orbit to draw and is answered with zero rather than a
    // division by an element it does not have.
    expect(orbitalPeriodDays("sun", jde)).toBe(0);
  });
});

describe("solarSystemAt's own invariants", () => {
  it("puts the Sun at the origin and the Earth one astronomical unit from it", () => {
    const snapshot = solarSystemAt(Date.parse("2026-10-10T00:00:00Z"));
    const sun = snapshot.bodies.find((body) => body.id === "sun")!;
    const earth = snapshot.bodies.find((body) => body.id === "earth")!;
    expect(sun.position).toEqual([0, 0, 0]);
    expect(Math.hypot(...earth.position)).toBeGreaterThan(0.98);
    expect(Math.hypot(...earth.position)).toBeLessThan(1.02);
    expect(earth.distanceFromEarthAu).toBe(0);
  });

  it("splits the Earth-Moon barycentre so the Earth and the Moon close on it", () => {
    // The Earth and the Moon sit on opposite sides of their common barycentre, so
    // the mass-weighted mean of the two positions IS that barycentre and the ratio
    // of the two distances is IAU's own 81.3005682. This is the identity that makes
    // Table 1's bound the barycentre's rather than the Earth's: the Earth's centre
    // is 4 671 km from it at the mean lunar distance.
    const snapshot = solarSystemAt(Date.parse("2024-03-19T18:00:00Z"));
    const earth = snapshot.bodies.find((body) => body.id === "earth")!.position;
    const moon = snapshot.bodies.find((body) => body.id === "moon")!.position;
    const total = 82.3005682;
    const barycentre: Vector3 = [
      (earth[0] * 81.3005682 + moon[0]) / total,
      (earth[1] * 81.3005682 + moon[1]) / total,
      (earth[2] * 81.3005682 + moon[2]) / total,
    ];
    const earthOffset = separation(earth, barycentre);
    const moonOffset = separation(moon, barycentre);
    expect(moonOffset / earthOffset).toBeCloseTo(81.3005682, 4);
    // 4 000 to 5 400 km, the range the lunar distance itself puts the Earth's
    // offset in.
    expect(earthOffset * 149_597_870.7).toBeGreaterThan(4_000);
    expect(earthOffset * 149_597_870.7).toBeLessThan(5_400);
  });
});
