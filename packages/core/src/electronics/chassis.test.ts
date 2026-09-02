import { describe, expect, it } from "vitest";

import {
  CHASSIS_MAX_CM,
  CHASSIS_MAX_GRAMS,
  MOUNTS,
  chassisProblems,
  isMount,
  mountOrigin,
  type Chassis,
} from "./chassis.js";

/**
 * The chassis is the one part of a URDF the circuit cannot derive, so every
 * number in it came from the user — and this suite is mostly about the bounds
 * that keep it that way. A dimension nobody typed is a fabricated measurement
 * inside a file a simulator treats as fact, which is the whole reason ADR-085
 * §8 left the geometry source open rather than guessing at it.
 */

const rover: Chassis = {
  shape: "diff-rover",
  bodyLength: 20,
  bodyWidth: 15,
  bodyHeight: 6,
  wheelRadius: 3.4,
  wheelWidth: 2.6,
  wheelTrack: 17,
  wheelBase: 12,
  bodyMass: 900,
  wheelMass: 40,
};

describe("chassisProblems", () => {
  it("says nothing about a rover somebody actually measured", () => {
    expect(chassisProblems(rover)).toEqual([]);
    expect(chassisProblems({ ...rover, shape: "four-wheel-rover" })).toEqual([]);
  });

  it("refuses a shape it does not ship", () => {
    expect(chassisProblems({ ...rover, shape: "hovercraft" })).toEqual([
      { field: "shape", code: "range" },
    ]);
  });

  it("refuses anything that is not a record at all", () => {
    for (const value of [null, undefined, 7, "rover", []]) {
      expect(chassisProblems(value)).toEqual([{ field: "<root>", code: "shape" }]);
    }
  });

  /**
   * Zero is the interesting one. A body 0 cm long is a link with no extent and
   * an inertia of zero, which Gazebo accepts and then simulates as a machine
   * that cannot be pushed — a silent wrong answer rather than a refusal.
   */
  it("refuses a dimension that is zero, negative, or not a number", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(chassisProblems({ ...rover, wheelRadius: bad })).toEqual([
        { field: "wheelRadius", code: "range" },
      ]);
    }
    expect(chassisProblems({ ...rover, bodyWidth: "15" })).toEqual([
      { field: "bodyWidth", code: "shape" },
    ]);
  });

  it("refuses a machine larger than the bound, in the unit the user typed", () => {
    expect(chassisProblems({ ...rover, bodyLength: CHASSIS_MAX_CM })).toEqual([]);
    expect(chassisProblems({ ...rover, bodyLength: CHASSIS_MAX_CM + 1 })).toEqual([
      { field: "bodyLength", code: "range" },
    ]);
    expect(chassisProblems({ ...rover, bodyMass: CHASSIS_MAX_GRAMS + 1 })).toEqual([
      { field: "bodyMass", code: "range" },
    ]);
  });

  it("names every bad field, rather than stopping at the first", () => {
    const problems = chassisProblems({ ...rover, bodyLength: 0, wheelMass: -2 });
    expect(problems.map((problem) => problem.field).sort()).toEqual(["bodyLength", "wheelMass"]);
  });

  /**
   * The one cross-field rule, and it is here because it is the one a person
   * gets wrong: wheels whose track is narrower than they are wide overlap each
   * other through the middle of the robot.
   */
  it("refuses wheels that would intersect each other", () => {
    expect(chassisProblems({ ...rover, wheelTrack: 2.6 })).toEqual([
      { field: "wheelTrack", code: "range" },
    ]);
    expect(chassisProblems({ ...rover, wheelTrack: 2.61 })).toEqual([]);
  });
});

describe("mountOrigin", () => {
  /**
   * Every mount is DERIVED from the body the user dimensioned — no mount adds a
   * number to the form. That is the whole reason the mount is a named position
   * and not three more centimetre fields per sensor.
   */
  it("puts a front mount on the front face, at half the body's height", () => {
    const { xyz, rpy } = mountOrigin("front", rover);
    // Metres: the URDF's unit, converted once here.
    expect(xyz).toEqual([0.1, 0, 0.03]);
    expect(rpy).toEqual([0, 0, 0]);
  });

  it("turns a side mount to face outward, which is the point of naming it", () => {
    expect(mountOrigin("left", rover).xyz).toEqual([0, 0.075, 0.03]);
    expect(mountOrigin("left", rover).rpy[2]).toBeCloseTo(Math.PI / 2);
    expect(mountOrigin("right", rover).xyz).toEqual([0, -0.075, 0.03]);
    expect(mountOrigin("right", rover).rpy[2]).toBeCloseTo(-Math.PI / 2);
    expect(mountOrigin("rear", rover).xyz).toEqual([-0.1, 0, 0.03]);
    expect(mountOrigin("rear", rover).rpy[2]).toBeCloseTo(Math.PI);
  });

  it("points a top mount up, because that is where a camera or an IMU goes", () => {
    const { xyz, rpy } = mountOrigin("top", rover);
    expect(xyz).toEqual([0, 0, 0.06]);
    expect(rpy[1]).toBeCloseTo(-Math.PI / 2);
  });

  it("moves with the body, so no origin is a constant", () => {
    const bigger = { ...rover, bodyLength: 40, bodyHeight: 10 };
    expect(mountOrigin("front", bigger).xyz).toEqual([0.2, 0, 0.05]);
  });
});

describe("isMount", () => {
  it("admits the five it ships and nothing else", () => {
    for (const mount of MOUNTS) expect(isMount(mount)).toBe(true);
    for (const value of ["FRONT", "bottom", "", null, 3]) expect(isMount(value)).toBe(false);
  });
});
