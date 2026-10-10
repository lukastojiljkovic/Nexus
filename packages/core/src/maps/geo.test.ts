import { describe, expect, it } from "vitest";
import {
  EARTH_MEAN_RADIUS_M,
  WEB_MERCATOR_CIRCUMFERENCE_M,
  formatCoordinates,
  formatDecimalCoordinates,
  formatDmsCoordinates,
  formatDistanceKilometres,
  formatDistanceMetres,
  formatDistanceShort,
  haversineMetres,
  metresPerPixel,
  scaleBar,
  toDms,
  type GeoPoint,
} from "./geo.js";

/**
 * The map's arithmetic, against hand calculations.
 *
 * Every expected value below was derived OUTSIDE this file, with the
 * intermediate values printed in the comment above it, so a test that agrees
 * with the implementation because the implementation wrote it is not what is
 * being asserted. The two source points are real places, so a reader can check
 * the answer against any map: node 60571493 is Beograd and node 59735022 is
 * Novi Sad (`https://www.openstreetmap.org/node/60571493`, read 2026-10-10).
 */

const BEOGRAD: GeoPoint = { lat: 44.8178131, lon: 20.4568974 };
const NOVI_SAD: GeoPoint = { lat: 45.2551338, lon: 19.8451756 };
const CACAK: GeoPoint = { lat: 43.8914332, lon: 20.3491624 };

describe("the constants", () => {
  it("uses the IUGG mean radius and the Web Mercator circumference derived from the ellipsoid it is defined on", () => {
    expect(EARTH_MEAN_RADIUS_M).toBe(6371008.7714);
    // 2 * pi * 6378137 (the WGS 84 semi-major axis, which is the sphere Web
    // Mercator is defined on) = 40075016.68557849.
    expect(WEB_MERCATOR_CIRCUMFERENCE_M).toBeCloseTo(2 * Math.PI * 6378137, 6);
  });
});

describe("the great-circle distance", () => {
  it("measures Beograd to Novi Sad as the haversine says", () => {
    // lam1 = 44.8178131 deg, phi1 = 20.4568974 deg, lam2 = 45.2551338 deg,
    // phi2 = 19.8451756 deg. With half-deltas in radians:
    //   sin^2(dlam/2) = 1.4564374558652965e-05
    //   cos(lam1) cos(lam2) sin^2(dphi/2) = 1.42299533744304e-05
    //   a = 2.879432793308386e-05, sqrt(a) = 0.005366034656343906,
    //   c = 2 atan2(sqrt(a), sqrt(1-a)) = 2 * 0.00536606040857119 = 0.01073212081714238
    //   d = 6371008.7714 * 0.01073212081714238 = 68374.43586173863 m
    expect(haversineMetres(BEOGRAD, NOVI_SAD)).toBeCloseTo(68374.43586173863, 6);
  });

  it("measures Beograd to Cacak, and is symmetric", () => {
    // 6371008.7714 * 2 * atan2(0.008112..., 0.999967...) = 103364.3863701725 m
    expect(haversineMetres(BEOGRAD, CACAK)).toBeCloseTo(103364.3863701725, 6);
    expect(haversineMetres(CACAK, BEOGRAD)).toBeCloseTo(103364.3863701725, 6);
  });

  it("is zero for one point, and one degree of longitude at the equator is one degree of the sphere", () => {
    expect(haversineMetres(BEOGRAD, BEOGRAD)).toBe(0);
    // R * pi / 180 = 6371008.7714 * pi / 180 = 111195.07973436874 m.
    expect(haversineMetres({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(
      111195.07973436874,
      6,
    );
  });

  it("does not produce NaN at a coincident pair, where the haversine's a can land on 1", () => {
    // Same node twice is the case a floating-point `a` of 1.0000000000000002
    // would turn into `sqrt(1 - a) = NaN` without the clamp.
    expect(Number.isNaN(haversineMetres({ lat: -90, lon: 0 }, { lat: -90, lon: 0 }))).toBe(false);
    expect(haversineMetres({ lat: -90, lon: 0 }, { lat: -90, lon: 0 })).toBe(0);
  });
});

describe("coordinates in the two writings", () => {
  it("writes a pair in decimal degrees in the active locale", () => {
    expect(formatDecimalCoordinates(BEOGRAD, "sr")).toBe("44,81781° N, 20,45690° E");
    expect(formatDecimalCoordinates(BEOGRAD, "en")).toBe("44.81781° N, 20.45690° E");
    // A southern and western pair: both hemispheres change letter and the
    // numbers stay magnitudes, never signed values.
    expect(formatDecimalCoordinates({ lat: -33.8688, lon: -70.6693 }, "sr")).toBe(
      "33,86880° S, 70,66930° W",
    );
  });

  it("writes a pair in degrees, minutes and seconds", () => {
    expect(formatDmsCoordinates(BEOGRAD)).toBe("44°49′04″ N, 20°27′25″ E");
    expect(formatDmsCoordinates(CACAK)).toBe("43°53′29″ N, 20°20′57″ E");
    expect(formatDmsCoordinates(NOVI_SAD)).toBe("45°15′18″ N, 19°50′43″ E");
    expect(formatDmsCoordinates({ lat: -33.8688, lon: -70.6693 })).toBe(
      "33°52′08″ S, 70°40′09″ W",
    );
  });

  it("carries a rounded second into the next minute, and a rounded minute into the next degree", () => {
    // 44.9999999 deg = 44 deg + 0.9999999 * 60 min = 44 deg 59.999994 min; the
    // seconds round to 60, which must carry rather than print "44°59′60″".
    expect(formatDmsCoordinates({ lat: 44.9999999, lon: 20 })).toBe("45°00′00″ N, 20°00′00″ E");
    expect(toDms(44.9999999)).toEqual({ degrees: 45, minutes: 0, seconds: 0 });
    // The equator and the prime meridian are north and east by the convention
    // every map prints, not "no hemisphere".
    expect(formatDmsCoordinates({ lat: 0, lon: 0 })).toBe("0°00′00″ N, 0°00′00″ E");
  });

  it("answers both writings of one pair under the two names", () => {
    expect(formatCoordinates(BEOGRAD, "sr")).toEqual({
      decimal: "44,81781° N, 20,45690° E",
      dms: "44°49′04″ N, 20°27′25″ E",
    });
  });
});

describe("the scale bar", () => {
  it("converts zoom and latitude into ground metres per pixel", () => {
    // cos(44.8178131 deg) = 0.7093516334129253; 40075016.68557849 *
    // 0.7093516334129253 / (512 * 2^10) = 54.220730867319745 m/px.
    expect(metresPerPixel(10, BEOGRAD.lat)).toBeCloseTo(54.220730867319745, 9);
    // One zoom level out is four times the ground per pixel: 3470.1267755084637.
    expect(metresPerPixel(4, BEOGRAD.lat)).toBeCloseTo(3470.1267755084637, 9);
    // The equator does not shrink: 40075016.68557849 / (512 * 2^0) = 78271.51696402048.
    expect(metresPerPixel(0, 0)).toBeCloseTo(78271.51696402048, 9);
  });

  it("picks the widest ladder step that fits, with its width and label", () => {
    // At 54.220730867 m/px a 5 km bar is 92.2156510991192 px (10 km would be
    // 184.43 px, past the 100 px budget).
    const ten = scaleBar(10, BEOGRAD.lat, 100, "sr");
    expect(ten.metres).toBe(5000);
    expect(ten.pixels).toBeCloseTo(92.2156510991192, 9);
    expect(ten.label).toBe("5 km");
    // Four zooms out the same budget buys 200 km (57.63 px; 500 km would be
    // 144.09 px).
    const four = scaleBar(4, BEOGRAD.lat, 100, "sr");
    expect(four.metres).toBe(200000);
    expect(four.pixels).toBeCloseTo(57.634781936949494, 9);
    expect(four.label).toBe("200 km");
  });

  it("states metres below a kilometre", () => {
    // At zoom 15 one pixel is 1.694397839 m of ground (54.220730867 / 32), so
    // 100 px is 169.4 m and the widest rung under it is 100 m.
    expect(scaleBar(15, BEOGRAD.lat, 100, "en").label).toBe("100 m");
  });
});

describe("distances through Intl", () => {
  it("writes whole metres", () => {
    expect(formatDistanceMetres(1234.4, "sr")).toBe("1.234 m");
    expect(formatDistanceMetres(1234.4, "en")).toBe("1,234 m");
    expect(formatDistanceMetres(844.6, "sr")).toBe("845 m");
  });

  it("writes kilometres at the precision the magnitude deserves", () => {
    expect(formatDistanceKilometres(1234, "sr")).toBe("1,23 km");
    expect(formatDistanceKilometres(845, "en")).toBe("0.85 km");
    expect(formatDistanceKilometres(48600, "sr")).toBe("48,6 km");
    expect(formatDistanceKilometres(845000, "en")).toBe("845 km");
    // The caller may state the precision: a scale bar's rung is a round number
    // and is printed round.
    expect(formatDistanceKilometres(5000, "sr", 0)).toBe("5 km");
    expect(formatDistanceKilometres(5000, "en", 0)).toBe("5 km");
  });

  it("switches at the kilometre", () => {
    expect(formatDistanceShort(999, "sr")).toBe("999 m");
    expect(formatDistanceShort(1000, "sr")).toBe("1,00 km");
    expect(formatDistanceShort(68374.43586173863, "sr")).toBe("68,4 km");
  });
});
