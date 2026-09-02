/**
 * The machine a circuit is the electronics OF — ADR-085 slice E4c.
 *
 * **This file exists because nothing else in the module can answer it.** A
 * URDF/SDF describes link lengths, joint origins, masses and inertias. The
 * catalogue knows a part number and a pin map; a circuit knows what is wired to
 * what. Neither knows how far the left wheel is from the right one, and a
 * number invented here would be a fabricated measurement inside a file a
 * simulator treats as fact — an error that then propagates into every result
 * computed from it. ADR-085 §8 left the source of this geometry open and said
 * E4 would decide; the decision is **every number comes from the user**, and
 * this file is the shape of what they are asked for.
 *
 * **Two shapes, not four, and both of them wheeled.** A differential rover and
 * a four-wheel rover are what a hobbyist with an SBC and a motor driver builds,
 * and they share one parameter set exactly, so the form is the same form. An
 * arm was considered and dropped: its joints are a different model, its ROS
 * story is MoveIt rather than a robot description, and shipping a third shape
 * whose fields are all different would be building the general case for one
 * user who has not asked yet.
 *
 * **Centimetres and grams, because that is what the user has.** A hobby robot
 * is measured with a ruler and weighed on a kitchen scale. Storing SI would
 * mean converting in both directions through a form and reporting a bound in a
 * unit nobody typed; the single conversion to metres and kilograms happens once,
 * in the generator, where the URDF's unit is a fact about the FORMAT.
 */

import type { CircuitProblem } from "./circuit.js";

export const CHASSIS_SHAPES = ["diff-rover", "four-wheel-rover"] as const;

export type ChassisShape = (typeof CHASSIS_SHAPES)[number];

/**
 * Where a sensor sits on the body, as a NAME rather than as three more numbers.
 *
 * Every origin is derived from the body the user already dimensioned (see
 * {@link mountOrigin}), which is what keeps the form from growing by three
 * fields per sensor. It also carries the direction: a ranger on the front face
 * looks forward, and a ranger on the left looks left, because that is what
 * mounting it there means.
 */
export const MOUNTS = ["front", "rear", "left", "right", "top"] as const;

export type Mount = (typeof MOUNTS)[number];

/** Five metres. Past this it is not a thing you carry to a desk. */
export const CHASSIS_MAX_CM = 500;

/** A hundred kilograms, in grams. Same argument, from the other end. */
export const CHASSIS_MAX_GRAMS = 100_000;

/** The seven lengths, in centimetres. Order is the order the form asks in. */
export const CHASSIS_LENGTHS = [
  "bodyLength",
  "bodyWidth",
  "bodyHeight",
  "wheelRadius",
  "wheelWidth",
  "wheelTrack",
  "wheelBase",
] as const;

/** The two masses, in grams. */
export const CHASSIS_MASSES = ["bodyMass", "wheelMass"] as const;

export type ChassisLength = (typeof CHASSIS_LENGTHS)[number];
export type ChassisMass = (typeof CHASSIS_MASSES)[number];
export type ChassisField = ChassisLength | ChassisMass;

export interface Chassis extends Record<ChassisField, number> {
  readonly shape: ChassisShape;
  /** Centimetres. */
  readonly bodyLength: number;
  readonly bodyWidth: number;
  readonly bodyHeight: number;
  readonly wheelRadius: number;
  readonly wheelWidth: number;
  /** Centre-to-centre across the machine. */
  readonly wheelTrack: number;
  /**
   * Centre-to-centre along it. On a four-wheel rover it separates the axles; on
   * a differential rover it puts the caster behind the driven pair, so the field
   * means something on both shapes and neither shape carries a dead one.
   */
  readonly wheelBase: number;
  /** Grams. */
  readonly bodyMass: number;
  readonly wheelMass: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isMount(value: unknown): value is Mount {
  return (MOUNTS as readonly unknown[]).includes(value);
}

export function isChassisShape(value: unknown): value is ChassisShape {
  return (CHASSIS_SHAPES as readonly unknown[]).includes(value);
}

/**
 * Every problem with a chassis, naming all of them rather than the first.
 *
 * The bounds are the point. Zero is refused as firmly as a negative is: a body
 * 0 cm long is a link with no extent and an inertia of zero, which Gazebo
 * accepts and then simulates as a machine that cannot be pushed — a silent
 * wrong answer, which is worse than a refusal.
 */
export function chassisProblems(value: unknown): readonly CircuitProblem[] {
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];

  const problems: CircuitProblem[] = [];
  if (!isChassisShape(value["shape"])) problems.push({ field: "shape", code: "range" });

  const bounded = (field: ChassisField, max: number): number | undefined => {
    const given = value[field];
    if (typeof given !== "number") {
      problems.push({ field, code: "shape" });
      return undefined;
    }
    if (!Number.isFinite(given) || given <= 0 || given > max) {
      problems.push({ field, code: "range" });
      return undefined;
    }
    return given;
  };

  const lengths = new Map<ChassisLength, number | undefined>();
  for (const field of CHASSIS_LENGTHS) lengths.set(field, bounded(field, CHASSIS_MAX_CM));
  for (const field of CHASSIS_MASSES) bounded(field, CHASSIS_MAX_GRAMS);

  // The one cross-field rule, and it is here because it is the one a person
  // gets wrong: wheels centred closer together than they are wide overlap each
  // other through the middle of the robot. Equality is refused too — wheels
  // exactly touching are in permanent contact, which is a machine that grinds
  // rather than one that drives.
  const track = lengths.get("wheelTrack");
  const width = lengths.get("wheelWidth");
  if (track !== undefined && width !== undefined && track <= width) {
    problems.push({ field: "wheelTrack", code: "range" });
  }
  return problems;
}

/** One link's placement: metres and radians, the URDF's own units. */
export interface MountOrigin {
  readonly xyz: readonly [number, number, number];
  readonly rpy: readonly [number, number, number];
}

/** Centimetres to metres — the one conversion, in the one place it belongs. */
const m = (cm: number): number => cm / 100;

/**
 * Where a named mount puts a sensor, and which way it looks.
 *
 * **`base_link`'s origin is the centre of the body's underside**, and the wheel
 * axles sit on that plane — so the ground is one wheel radius below it and the
 * clearance is the wheel, which is how a rover with its motors bolted under the
 * deck actually stands. Choosing this frame rather than the body's centre is
 * what lets every mount be a simple face of the box, and it costs no parameter.
 *
 * The rotation is not decoration: a URDF sensor looks along its own **+X**, so
 * the yaw *is* the direction the user meant when they said „front" or „left".
 * A top mount pitches by −π/2, which carries +X onto +Z.
 */
export function mountOrigin(mount: Mount, chassis: Chassis): MountOrigin {
  const halfL = m(chassis.bodyLength) / 2;
  const halfW = m(chassis.bodyWidth) / 2;
  const halfH = m(chassis.bodyHeight) / 2;

  switch (mount) {
    case "front":
      return { xyz: [halfL, 0, halfH], rpy: [0, 0, 0] };
    case "rear":
      return { xyz: [-halfL, 0, halfH], rpy: [0, 0, Math.PI] };
    case "left":
      return { xyz: [0, halfW, halfH], rpy: [0, 0, Math.PI / 2] };
    case "right":
      return { xyz: [0, -halfW, halfH], rpy: [0, 0, -Math.PI / 2] };
    case "top":
      return { xyz: [0, 0, halfH * 2], rpy: [0, -Math.PI / 2, 0] };
  }
}
