import type { Vector3 } from "@nexus/core";

/**
 * Where the camera stands, as pure arithmetic — the half of "fly to a body"
 * that can be tested without a renderer.
 *
 * A pose is a position and what it looks at, which is what `OrbitControls`
 * needs as well: `camera.position` plus `controls.target`. Everything here is a
 * function of those two triples and a field of view, so the flight path, the
 * fit distance and the follow-while-time-runs rule are all pinned by values
 * rather than by what the picture happened to look like.
 */

export interface CameraPose {
  readonly position: Vector3;
  readonly target: Vector3;
}

/** How long a flight takes. Short enough to feel like a jump, long enough to be followed. */
export const FLIGHT_MS = 720;

function halfFovTangent(verticalFovDeg: number): number {
  return Math.tan((verticalFovDeg * Math.PI) / 360);
}

function vectorLength(vector: Vector3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function unit(vector: Vector3, fallback: Vector3): Vector3 {
  const length = vectorLength(vector);
  if (length === 0) return fallback;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * The distance at which a sphere of `radiusUnits` fills `fillFraction` of the
 * frame's half-height.
 *
 * The plain pinhole relation: at distance `d` the view's half-height is
 * `d · tan(fov/2)`, so a sphere of radius `r` that is to cover `f` of it needs
 * `d = r / (f · tan(fov/2))`. Anything degenerate — no radius, no fill — answers
 * zero, which the caller can only read as "there is nothing to frame".
 */
export function fitDistance(
  radiusUnits: number,
  verticalFovDeg: number,
  fillFraction: number,
): number {
  if (!(radiusUnits > 0) || !(fillFraction > 0)) return 0;
  return radiusUnits / (fillFraction * halfFovTangent(verticalFovDeg));
}

/**
 * A pose that frames a sphere of `radiusUnits` at `target`, standing off in
 * `viewDirection`.
 *
 * The direction is what keeps a flight from spinning the view: the component
 * hands it the direction the camera is already looking from, so picking a planet
 * moves the camera but does not turn the sky over.
 */
export function poseFor(
  target: Vector3,
  radiusUnits: number,
  verticalFovDeg: number,
  fillFraction: number,
  viewDirection: Vector3,
): CameraPose {
  const direction = unit(viewDirection, [0, 0, 1]);
  const distance = fitDistance(radiusUnits, verticalFovDeg, fillFraction);
  return {
    position: [
      target[0] + direction[0] * distance,
      target[1] + direction[1] * distance,
      target[2] + direction[2] * distance,
    ],
    target,
  };
}

/**
 * The eased fraction of a flight, `0…1`.
 *
 * Smoothstep: it starts and ends at rest, which is what keeps a jump from
 * reading as a teleport followed by a stop. `t` outside the flight is clamped,
 * so a frame that arrives late cannot overshoot.
 */
export function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * The pose partway through a flight.
 *
 * **The distance shrinks geometrically, not linearly, and that is the whole
 * design of this function.** A flight from the whole system (tens of thousands
 * of units) to one planet (a fraction of a unit) spans about eight orders of
 * magnitude; a straight interpolation spends almost all of it still leaving the
 * solar system and then arrives instantly. Interpolating the *logarithm* puts
 * half the flight at the geometric mean of the two distances, so the closing
 * half is visible.
 *
 * `t <= 0` is exactly `from` and `t >= 1` is exactly `to` — a flight must land
 * where it was aimed, not near it.
 */
export function flyToPath(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const eased = easeInOut(t);
  const target: Vector3 = [
    lerp(from.target[0], to.target[0], eased),
    lerp(from.target[1], to.target[1], eased),
    lerp(from.target[2], to.target[2], eased),
  ];

  const fromOffset: Vector3 = [
    from.position[0] - from.target[0],
    from.position[1] - from.target[1],
    from.position[2] - from.target[2],
  ];
  const toOffset: Vector3 = [
    to.position[0] - to.target[0],
    to.position[1] - to.target[1],
    to.position[2] - to.target[2],
  ];
  const fromLength = vectorLength(fromOffset);
  const toLength = vectorLength(toOffset);
  if (fromLength === 0 || toLength === 0) {
    return {
      position: [
        lerp(from.position[0], to.position[0], eased),
        lerp(from.position[1], to.position[1], eased),
        lerp(from.position[2], to.position[2], eased),
      ],
      target,
    };
  }

  const direction = unit(
    [
      lerp(fromOffset[0] / fromLength, toOffset[0] / toLength, eased),
      lerp(fromOffset[1] / fromLength, toOffset[1] / toLength, eased),
      lerp(fromOffset[2] / fromLength, toOffset[2] / toLength, eased),
    ],
    // Two exactly opposite view directions have no direction between them; the
    // flight then turns at the end rather than passing through the middle, and
    // `t = 1` still lands on `to`.
    [toOffset[0] / toLength, toOffset[1] / toLength, toOffset[2] / toLength],
  );
  const distance = fromLength * (toLength / fromLength) ** eased;
  return {
    position: [
      target[0] + direction[0] * distance,
      target[1] + direction[1] * distance,
      target[2] + direction[2] * distance,
    ],
    target,
  };
}

/**
 * The pose after the body it is watching has moved.
 *
 * Time advances on the same screen the camera is pointed at, so a selected body
 * that drifts while its planet travels on would slide out of frame within
 * minutes. The camera keeps its standoff and follows: the offset from the old
 * target is applied to the new one. Called only while a body is selected and no
 * flight is running — during a flight the path is the answer.
 */
export function followPose(pose: CameraPose, target: Vector3): CameraPose {
  return {
    position: [
      pose.position[0] + target[0] - pose.target[0],
      pose.position[1] + target[1] - pose.target[1],
      pose.position[2] + target[2] - pose.target[2],
    ],
    target,
  };
}
