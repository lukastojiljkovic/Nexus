import { describe, expect, it } from "vitest";
import {
  HORIZON_RADIUS,
  ZENITH,
  projectStereographic,
  unprojectStereographic,
  type HorizontalDirection,
} from "./starProjection.js";

/** Belgrade's latitude, the one the star oracle uses: the celestial pole's altitude over that place. */
const LATITUDE = 44.82;

/** The plane point a direction lands on, or a failure - the projection has no image of its antipode. */
function plane(direction: HorizontalDirection): { x: number; y: number } {
  const point = projectStereographic(direction);
  if (point === null) throw new Error(`no image of ${direction.altitude}/${direction.azimuth}`);
  return point;
}

describe("projectStereographic", () => {
  it("puts the projection's own centre at the origin", () => {
    expect(plane(ZENITH)).toEqual({ x: 0, y: 0 });
  });

  it("puts the horizon on a circle of radius 2, with north up and east to the left", () => {
    // The radius is 2 tan(theta/2) with theta = 90 degrees, and the sides are
    // the view's: this is a chart held overhead, so east is on the left and
    // west on the right. The orientation is a decision, and this is it, pinned.
    const north = plane({ altitude: 0, azimuth: 0 });
    expect(north.x).toBeCloseTo(0, 12);
    expect(north.y).toBeCloseTo(2, 12);
    const east = plane({ altitude: 0, azimuth: 90 });
    expect(east.x).toBeCloseTo(-2, 12);
    expect(east.y).toBeCloseTo(0, 12);
    const south = plane({ altitude: 0, azimuth: 180 });
    expect(south.x).toBeCloseTo(0, 12);
    expect(south.y).toBeCloseTo(-2, 12);
    const west = plane({ altitude: 0, azimuth: 270 });
    expect(west.x).toBeCloseTo(2, 12);
    expect(west.y).toBeCloseTo(0, 12);
    expect(HORIZON_RADIUS).toBe(2);
  });

  it("draws the two celestial poles where the observer's latitude puts them", () => {
    // From a zenith-centred view the north pole is (90 - latitude) from the
    // centre, i.e. 45.18 degrees, and 2 tan(22.59 degrees) = 0.832110129; the
    // south pole is 134.82 degrees away, on the far side of the plane, where
    // the same formula gives 2 tan(67.41 degrees) = 4.807056015. Both are exact
    // values of the projection rather than measurements.
    const north = plane({ altitude: LATITUDE, azimuth: 0 });
    expect(north.x).toBeCloseTo(0, 12);
    expect(north.y).toBeCloseTo(0.832110129, 9);
    const south = plane({ altitude: -LATITUDE, azimuth: 180 });
    expect(south.x).toBeCloseTo(0, 12);
    expect(south.y).toBeCloseTo(-4.807056015, 9);
  });

  it("projects a tilted view's zenith up the plane's own axis", () => {
    // Centre 45 degrees above the southern horizon: the zenith is 45 degrees
    // from it, toward increasing altitude, so it lands at (0, 2 tan 22.5) =
    // (0, 0.828427125) whatever the azimuth of the centre was.
    const point = projectStereographic(ZENITH, { altitude: 45, azimuth: 180 });
    expect(point?.x).toBeCloseTo(0, 12);
    expect(point?.y).toBeCloseTo(0.828427125, 9);
  });

  it("refuses the one direction it has no image of", () => {
    expect(projectStereographic({ altitude: -90, azimuth: 0 }, ZENITH)).toBeNull();
    // A hair inside the antipode is not refused: it is simply far away, which
    // is the honest answer and what keeps the refusal meaningful. The SIGN
    // says which side of the projection's pole it passed on: a direction
    // 0.01 degrees short of the nadir but displaced toward the north lands far
    // up the +y axis, and the same direction displaced south lands far down
    // the -y axis. Both radii are the same 2 tan(89.995 degrees) = 22918.31.
    expect(plane({ altitude: -89.99, azimuth: 0 }).y).toBeCloseTo(22_918.31, 2);
    expect(plane({ altitude: -89.99, azimuth: 180 }).y).toBeCloseTo(-22_918.31, 2);
  });
});

describe("unprojectStereographic", () => {
  it("turns the plane back into the sky, everywhere", () => {
    const directions: HorizontalDirection[] = [
      ZENITH,
      { altitude: 0, azimuth: 0 },
      { altitude: 0, azimuth: 135 },
      { altitude: LATITUDE, azimuth: 0 },
      { altitude: -LATITUDE, azimuth: 180 },
      { altitude: 12.5, azimuth: 271.25 },
      { altitude: -80, azimuth: 40 },
    ];
    for (const direction of directions) {
      const back = unprojectStereographic(plane(direction));
      expect(back.altitude, `altitude of ${direction.azimuth}`).toBeCloseTo(direction.altitude, 9);
      if (direction.altitude < 90) {
        expect(back.azimuth, `azimuth of ${direction.azimuth}`).toBeCloseTo(direction.azimuth, 9);
      }
    }
  });

  it("reads the horizon circle and the projection's origin back", () => {
    expect(unprojectStereographic({ x: 0, y: 2 })).toEqual({
      altitude: expect.closeTo(0, 12),
      azimuth: expect.closeTo(0, 12),
    });
    expect(unprojectStereographic({ x: 0, y: 0 })).toEqual({
      altitude: 90,
      azimuth: 0,
    });
    // The origin of a tilted view is that view's centre, not the zenith.
    const tilted = unprojectStereographic({ x: 0, y: 0 }, { altitude: 30, azimuth: 200 });
    expect(tilted.altitude).toBeCloseTo(30, 9);
    expect(tilted.azimuth).toBeCloseTo(200, 9);
  });
});
