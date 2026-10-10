/**
 * The stereographic projection the star map draws through, and its inverse.
 *
 * **Why a projection at all, and why this one.** A star map is a map of a
 * sphere, and every flat map of a sphere distorts something. The stereographic
 * projection is the one that keeps ANGLES: the shape of a constellation near
 * the edge of the view is the shape it has in the middle, and a square degree
 * of sky is drawn as the same shape wherever it is. That is what a reader
 * comparing the screen with the sky is doing. Its costs are known and accepted:
 * the scale grows toward the far side, and the point exactly opposite the
 * projection's centre is not on the plane at all.
 *
 * **The plane, in its own units.** The projection's centre is the origin, the
 * zenith-side tangent direction is `+y`, and the radius at which a direction
 * `theta` degrees away from the centre lands is `2 tan(theta / 2)`. So the
 * horizon - 90 degrees from a zenith-centred view - is exactly the circle of
 * radius 2, which is the number `HORIZON_RADIUS` names and what a caller fits
 * to the canvas. Nothing here knows about pixels: `view.ts` in the astronomy
 * module applies the pan and the zoom, and this file stays a pure map.
 *
 * **Which way round.** `+x` is not a compass direction but a relation to the
 * view: the map is the sky as the observer SEES it, looking outward along the
 * projection's centre. With the centre at the zenith that reads the way a chart
 * held overhead does - north up, east to the left - and with the centre on the
 * horizon it reads the way the view facing that compass point does. The two
 * look like opposite conventions and are one property, which the orientation
 * test pins in both cases.
 */

/** Where a direction is in the sky overhead: degrees, azimuth clockwise from true north. */
export interface HorizontalDirection {
  readonly altitude: number;
  readonly azimuth: number;
}

/** A point on the projection's plane, in the units above: `+y` toward the zenith, `+x` as the view reads. */
export interface PlanePoint {
  readonly x: number;
  readonly y: number;
}

/** The projection's own centre by default, and the one direction a star map starts from. */
export const ZENITH: HorizontalDirection = { altitude: 90, azimuth: 0 };

/** Where the horizon lands when the projection is centred on the zenith: `2 tan(45 degrees)`. */
export const HORIZON_RADIUS = 2;

/** A direction as a unit vector in the observer's own frame: north, east, up. */
function unitVector(direction: HorizontalDirection): readonly [number, number, number] {
  const cosAltitude = Math.cos((direction.altitude * Math.PI) / 180);
  const azimuth = (direction.azimuth * Math.PI) / 180;
  return [cosAltitude * Math.cos(azimuth), cosAltitude * Math.sin(azimuth), Math.sin((direction.altitude * Math.PI) / 180)];
}

/**
 * The tangent basis at the projection's centre: `p` toward the zenith and `q`
 * the way the view reads, which is `p` cross the centre.
 *
 * At the zenith itself "toward the zenith" is undefined - the centre IS the
 * zenith - and the frame is fixed by taking north for `p`, which is the choice
 * that makes a zenith-centred map read north-up.
 */
function tangentBasis(centre: readonly [number, number, number]): {
  readonly p: readonly [number, number, number];
  readonly q: readonly [number, number, number];
} {
  const [nx, ny, nz] = centre;
  // The zenith component the centre does not already carry.
  const upx = -nx * nz;
  const upy = -ny * nz;
  const upz = 1 - nz * nz;
  const upLength = Math.hypot(upx, upy, upz);
  const p: readonly [number, number, number] =
    upLength > 1e-12 ? [upx / upLength, upy / upLength, upz / upLength] : [1, 0, 0];
  // q = p x centre, and NOT centre x p: this is the handedness that makes the
  // plane an observer's view rather than a mirror of it.
  return {
    p,
    q: [p[1] * nz - p[2] * ny, p[2] * nx - p[0] * nz, p[0] * ny - p[1] * nx],
  };
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Where a direction lands on the plane, or `null` for the one direction the
 * projection has no image of: the antipode of the centre, which it sends to
 * infinity.
 *
 * `null` rather than `NaN` or an infinite point, because the two are not the
 * same statement to a caller: `NaN` silently poisons the arithmetic that
 * follows it and an infinite point draws a star at an arbitrary place on
 * screen, while the antipode is a direction that genuinely cannot be drawn.
 * Nothing on a star map meets it in practice - the antipode is 90 degrees
 * outside the horizon the view is fitted to - but a caller iterating over a
 * whole catalogue of stars will reach it eventually.
 */
export function projectStereographic(
  direction: HorizontalDirection,
  centre: HorizontalDirection = ZENITH,
): PlanePoint | null {
  const c = unitVector(centre);
  const { p, q } = tangentBasis(c);
  const v = unitVector(direction);
  const cosTheta = Math.min(1, Math.max(-1, dot(v, c)));
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  if (sinTheta < 1e-12) {
    // Exactly the centre, or exactly its antipode.
    return cosTheta > 0 ? { x: 0, y: 0 } : null;
  }
  // 2 tan(theta/2), written through the half-angle so the antipode is the only
  // place the radius runs away.
  const radius = (2 * sinTheta) / (1 + cosTheta);
  return { x: (radius * dot(v, q)) / sinTheta, y: (radius * dot(v, p)) / sinTheta };
}

/**
 * The direction a point of the plane stands for - the exact inverse of
 * {@link projectStereographic} everywhere except at the antipode, which no
 * finite point reaches.
 *
 * The radius is turned back into an angle with `2 atan(r/2)`, which is the
 * inverse of the half-angle form above and stays accurate out to radii far
 * larger than a canvas.
 */
export function unprojectStereographic(
  point: PlanePoint,
  centre: HorizontalDirection = ZENITH,
): HorizontalDirection {
  const c = unitVector(centre);
  const { p, q } = tangentBasis(c);
  const radius = Math.hypot(point.x, point.y);
  const theta = 2 * Math.atan(radius / 2);
  const cosTheta = Math.cos(theta);
  // sin(theta) / radius is the factor the two tangent components are already
  // scaled by, and folding the division in here is what keeps the origin (a
  // radius of zero) from dividing by it: at the origin both components are
  // zero and the direction is the centre itself.
  const spread = radius === 0 ? 0 : Math.sin(theta) / radius;
  const towards = spread * point.y;
  const sideways = spread * point.x;
  const x = cosTheta * c[0] + towards * p[0] + sideways * q[0];
  const y = cosTheta * c[1] + towards * p[1] + sideways * q[1];
  const z = cosTheta * c[2] + towards * p[2] + sideways * q[2];
  const toDegrees = 180 / Math.PI;
  return {
    altitude: Math.asin(Math.min(1, Math.max(-1, z))) * toDegrees,
    azimuth: ((Math.atan2(y, x) * toDegrees) % 360 + 360) % 360,
  };
}
