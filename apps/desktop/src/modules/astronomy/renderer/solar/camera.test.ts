import { describe, expect, it } from "vitest";
import type { Vector3 } from "@nexus/core";

import { easeInOut, fitDistance, flyToPath, followPose, poseFor, type CameraPose } from "./camera.js";

/**
 * The camera arithmetic, pinned by values.
 *
 * The oracle for the fit is the pinhole relation written out by hand:
 * `tan(22.5°) = √2 − 1`, so a sphere of radius 5 filling 0.8 of the half-frame at
 * a 45° vertical field of view stands 5 / (0.8 · (√2 − 1)) ≈ 15.0888 units away.
 * The flight's oracle is the geometric mean, which for a drop from 100 units to 1
 * is exactly 10 halfway through.
 */

const ORIGIN: Vector3 = [0, 0, 0];

describe("fitDistance", () => {
  it("is the pinhole relation: r / (fill · tan(fov/2))", () => {
    const tangent = Math.SQRT2 - 1;
    expect(fitDistance(5, 45, 0.8)).toBeCloseTo(5 / (0.8 * tangent), 10);
    expect(fitDistance(1, 45, 1)).toBeCloseTo(1 / tangent, 10);
    // A wider field of view frames the same sphere from closer.
    expect(fitDistance(5, 60, 0.8)).toBeLessThan(fitDistance(5, 30, 0.8));
  });

  it("answers zero for anything it cannot frame", () => {
    expect(fitDistance(0, 45, 0.8)).toBe(0);
    expect(fitDistance(5, 45, 0)).toBe(0);
    expect(fitDistance(-5, 45, 0.8)).toBe(0);
  });
});

describe("poseFor", () => {
  it("stands exactly the fit distance off the target, along the direction it was given", () => {
    const direction: Vector3 = [0, 1, 0];
    const pose = poseFor([0, 2, 0], 5, 45, 0.8, direction);
    expect(pose.target).toEqual([0, 2, 0]);
    expect(pose.position).toEqual([0, 2 + fitDistance(5, 45, 0.8), 0]);
  });

  it("normalises whatever direction it is handed, and has a fallback for none at all", () => {
    const pose = poseFor(ORIGIN, 5, 45, 0.8, [0, 3, 0]);
    expect(pose.position[1]).toBeCloseTo(fitDistance(5, 45, 0.8), 10);
    const fallback = poseFor(ORIGIN, 5, 45, 0.8, ORIGIN);
    expect(fallback.position[2]).toBeCloseTo(fitDistance(5, 45, 0.8), 10);
  });
});

describe("easeInOut", () => {
  it("runs from rest to rest through the middle", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(1)).toBe(1);
  });

  it("is monotone, symmetric, and clamped outside the flight", () => {
    for (let step = 0; step <= 20; step += 1) {
      const t = step / 20;
      expect(easeInOut(t)).toBeLessThanOrEqual(easeInOut(t + 0.05));
      expect(easeInOut(t) + easeInOut(1 - t)).toBeCloseTo(1, 12);
    }
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });
});

describe("flyToPath", () => {
  const near: CameraPose = { position: [0, 0, 100], target: ORIGIN };
  const close: CameraPose = { position: [0, 0, 1], target: ORIGIN };

  it("starts and lands exactly, never near", () => {
    expect(flyToPath(near, close, 0)).toEqual(near);
    expect(flyToPath(near, close, 1)).toEqual(close);
    expect(flyToPath(near, close, -3)).toEqual(near);
    expect(flyToPath(near, close, 4)).toEqual(close);
  });

  it("closes the distance geometrically: 100 units to 1 is 10 halfway", () => {
    const half = flyToPath(near, close, 0.5);
    expect(half.position[2]).toBeCloseTo(10, 10);
    expect(half.position[0]).toBeCloseTo(0, 12);
    expect(half.position[1]).toBeCloseTo(0, 12);
  });

  it("closes the distance all the way, without a step that ever grows", () => {
    let previous = 100;
    for (let step = 1; step <= 20; step += 1) {
      const distance = Math.abs(flyToPath(near, close, step / 20).position[2]);
      expect(distance).toBeLessThan(previous);
      previous = distance;
    }
  });

  it("moves the target as it goes", () => {
    const from: CameraPose = { position: [0, 0, 100], target: ORIGIN };
    const to: CameraPose = { position: [5, 0, 60], target: [5, 0, 0] };
    const half = flyToPath(from, to, 0.5);
    expect(half.target).toEqual([2.5, 0, 0]);
  });

  it("survives two opposite view directions without a NaN", () => {
    const from: CameraPose = { position: [0, 0, 100], target: ORIGIN };
    const to: CameraPose = { position: [0, 0, -1], target: ORIGIN };
    const half = flyToPath(from, to, 0.5);
    for (const value of [...half.position, ...half.target]) expect(Number.isFinite(value)).toBe(true);
    expect(flyToPath(from, to, 1).position).toEqual([0, 0, -1]);
  });
});

describe("followPose", () => {
  it("keeps the standoff and applies the target's movement", () => {
    const pose: CameraPose = { position: [0, 10, 100], target: ORIGIN };
    const moved: Vector3 = [3, 0, -4];
    const followed = followPose(pose, moved);
    expect(followed.target).toEqual([3, 0, -4]);
    expect(followed.position).toEqual([3, 10, 96]);
    const standoff = (value: CameraPose): number =>
      Math.hypot(
        value.position[0] - value.target[0],
        value.position[1] - value.target[1],
        value.position[2] - value.target[2],
      );
    expect(standoff(followed)).toBeCloseTo(standoff(pose), 12);
  });
});
