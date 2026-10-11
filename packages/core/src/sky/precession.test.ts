import { describe, expect, it } from "vitest";
import { precessEquatorial, precessionAngles, type EquatorialDirection } from "./precession.js";

/** J2000.0, the epoch every catalogue position in this module is stated at. */
const J2000_JDE = 2451545;

/** The angular distance between two directions, degrees - the quantity a rotation may not change. */
function separation(a: EquatorialDirection, b: EquatorialDirection): number {
  const toRadians = Math.PI / 180;
  const cos =
    Math.cos(a.declination * toRadians) * Math.cos(b.declination * toRadians) *
      Math.cos((a.rightAscension - b.rightAscension) * toRadians) +
    Math.sin(a.declination * toRadians) * Math.sin(b.declination * toRadians);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

describe("precessionAngles", () => {
  it("evaluates the IAU 1976 series by hand for 9778.5 days", () => {
    // The reduction starts at J2000, so t0 = 0 and every t0 term vanishes, and
    // the interval is t = 9778.5 / 36525 = 0.267720739 centuries. The three
    // published series (Meeus eq. 21.2; SOFA's `iauPrec76`, checked against its
    // source on 2026-10-10) then read, with w = 2306.2181":
    //
    //   zeta  = (w + (0.30188 + 0.017998 t) t) t
    //         = (2306.2181 + 0.306698 x 0.267720739) x 0.267720739
    //         = 617.444397" = 0.171512332 deg
    //   z     = (w + (1.09468 + 0.018203 t) t) t
    //         = (2306.2181 + 1.099553 x 0.267720739) x 0.267720739
    //         = 617.501224" = 0.171528118 deg
    //   theta = (2004.3109 - 0.42665 t - 0.041833 t^2) t
    //         = 536.564213" = 0.149045615 deg
    //
    // One thing the arithmetic says out loud and a reader should not miss: the
    // whole bracket is multiplied by t. The leading term is `w t`, not `w`, and
    // a reduction over an interval of no time is the identity.
    const angles = precessionAngles(J2000_JDE, J2000_JDE + 9778.5);
    expect(angles.zeta).toBeCloseTo(0.171512332, 9);
    expect(angles.z).toBeCloseTo(0.171528118, 9);
    expect(angles.theta).toBeCloseTo(0.149045615, 9);
  });

  it("is the identity over an interval of no time", () => {
    const angles = precessionAngles(J2000_JDE, J2000_JDE);
    expect(angles.zeta).toBe(0);
    expect(angles.z).toBe(0);
    expect(angles.theta).toBe(0);
  });
});

describe("precessEquatorial", () => {
  it("puts the north celestial pole at (180 + z, 90 - theta)", () => {
    // A direction exactly on the pole has cos(dec) = 0, so the reduction's A is
    // 0 and its B is -sin(theta): the pole lands at right ascension 180 + z and
    // at declination 90 - theta, which is the reduction's own definition of the
    // two angles. The digits are the hand calculation above.
    const pole = precessEquatorial(
      { rightAscension: 0, declination: 90 },
      J2000_JDE,
      J2000_JDE + 9778.5,
    );
    expect(pole.rightAscension).toBeCloseTo(180.171528118, 9);
    expect(pole.declination).toBeCloseTo(89.850954385, 9);
  });

  it("leaves the angle between two stars alone", () => {
    // Precession is a rotation of the frame, so the sky between two stars is
    // unchanged by it: Sirius and Vega are 157.859568 degrees apart at J2000
    // (the two catalogue positions below, by the spherical law of cosines), and
    // still are a century later.
    const sirius: EquatorialDirection = { rightAscension: 101.28708, declination: -16.71611 };
    const vega: EquatorialDirection = { rightAscension: 279.23458, declination: 38.78361 };
    const before = separation(sirius, vega);
    const movedSirius = precessEquatorial(sirius, J2000_JDE, J2000_JDE + 36525);
    const movedVega = precessEquatorial(vega, J2000_JDE, J2000_JDE + 36525);
    expect(separation(movedSirius, movedVega)).toBeCloseTo(before, 9);
  });

  it("returns to where it started after a trip out and back", () => {
    // The chain matters here rather than the arithmetic: the reduction back is
    // built from a DIFFERENT starting epoch, so this only cancels if the series
    // are being read at the epoch they are written for.
    const arcturus: EquatorialDirection = { rightAscension: 213.91542, declination: 19.1825 };
    const out = precessEquatorial(arcturus, J2000_JDE, J2000_JDE + 36525);
    const back = precessEquatorial(out, J2000_JDE + 36525, J2000_JDE);
    expect(back.rightAscension).toBeCloseTo(arcturus.rightAscension, 9);
    expect(back.declination).toBeCloseTo(arcturus.declination, 9);
  });
});
