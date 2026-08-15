import { describe, expect, it } from "vitest";

import {
  angleOfView,
  circleOfConfusionFromDiagonal,
  cropFactor,
  depthOfField,
  diffractionLimit,
  exactFrameRate,
  exposureDifference,
  exposureSolve,
  flashAperture,
  flashDistance,
  frameRateConform,
  illuminanceToAperture,
  miredShift,
  motionBlurPixels,
  motionBlurShutter,
  ndFilterExposure,
  parseShutterTime,
  PQ_C1,
  PQ_C2,
  PQ_C3,
  pqFromLuminance,
  pqFromSignal,
  pqSignalFromCode,
  rasterImageSize,
  timecodeDrift,
  timecodeOperation,
  timecodeSeconds,
  timecodeToFrames,
  framesToTimecode,
  timelapsePlan,
  videoStorage,
} from "./foto.js";

/**
 * Every expectation here is worked by hand from the inputs before it is
 * asserted, and the arithmetic lives in the comment above it so a reader can
 * check it without running anything — exactly as `gradnja.test.ts` does. Where
 * the assignment's own catalogue vector disagreed with a hand re-derivation
 * (angle-of-view's third vector, depth-of-field's third vector, the ND stack,
 * motion-blur's rounding direction), the corrected number is the one asserted,
 * and the disagreement is reported rather than silently absorbed.
 */

describe("angleOfView", () => {
  it("36x24 at f=50, D=5 m — textbook vector", () => {
    // diag = sqrt(36^2+24^2) = sqrt(1872) = 43.266615 mm
    // horizontal = 2*atan(36/100) = 2*atan(0.36) = 2*19.798876deg = 39.597753deg
    // vertical   = 2*atan(24/100) = 2*atan(0.24) = 2*13.495733deg = 26.991467deg
    // diagonal   = 2*atan(43.266615/100) = 2*23.396502deg = 46.793003deg
    // field width  = 5000*36/50  = 3600 mm = 3.600 m
    // field height = 5000*24/50  = 2400 mm = 2.400 m
    const result = angleOfView({
      sensorWidth: 36,
      sensorHeight: 24,
      focalLength: 50,
      subjectDistance: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sensorDiagonal).toBeCloseTo(43.266615, 5);
    expect(result.horizontal).toBeCloseTo(39.597753, 4);
    expect(result.vertical).toBeCloseTo(26.991467, 4);
    expect(result.diagonal).toBeCloseTo(46.793003, 4);
    expect(result.fieldWidth).toBeCloseTo(3.6, 3);
    expect(result.fieldHeight).toBeCloseTo(2.4, 3);
    // The model is focused at infinity — a fact the result states rather than
    // leaving it to a JSDoc comment nobody building a surface would ever open.
    expect(result.focusedAtInfinity).toBe(true);
    // fieldDiagonal is the third field figure, never asserted before: the field
    // covered along the sensor's diagonal at the same subject distance.
    // 5000*43.266615/50 = 4326.6615 mm = 4.326662 m
    expect(result.fieldDiagonal).toBeCloseTo(4.326662, 5);
  });

  it("atan(0.75) is a textbook value: 36x24 at f=24 gives exactly 73.7398 deg horizontal", () => {
    // 2*atan(36/48) = 2*atan(0.75) = 2*36.869898deg = 73.739795deg
    const result = angleOfView({ sensorWidth: 36, sensorHeight: 24, focalLength: 24 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.horizontal).toBeCloseTo(73.739795, 4);
    expect(result.fieldWidth).toBeUndefined();
    expect(result.fieldDiagonal).toBeUndefined();
  });

  it("corrects the catalogue's third vector: atan(23.5/70) is 18.557637 deg, so horizontal is 37.115275 deg, not 37.08", () => {
    // x = 23.5/70 = 0.3357143. Series x - x^3/3 + x^5/5 - x^7/7 + x^9/9 - x^11/11
    // converges to 0.3238919 rad = 18.557637 deg (the draft's 18.5423 deg was a
    // transcription slip). 2*18.557637 = 37.115275, which rounds to 37.12, not
    // the draft's 37.08 — and precision 1 (tolerance 0.05) would have let both
    // pass, so this asserts to precision 3 and rules the draft's figure out
    // explicitly rather than merely failing to rule it in.
    // field width = 2000*23.5/35 = 1342.857 mm = 1.342857 m
    const result = angleOfView({
      sensorWidth: 23.5,
      sensorHeight: 15.6,
      focalLength: 35,
      subjectDistance: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.horizontal).toBeCloseTo(37.115275, 3);
    expect(result.horizontal).not.toBeCloseTo(37.08, 2);
    expect(result.fieldWidth).toBeCloseTo(1.342857, 3);
  });

  it("refuses a non-positive sensor dimension or focal length, and an out-of-range distance", () => {
    expect(angleOfView({ sensorWidth: 0, sensorHeight: 24, focalLength: 50 })).toEqual({
      ok: false,
      reason: "sensorWidth",
    });
    expect(angleOfView({ sensorWidth: 36, sensorHeight: 0, focalLength: 50 })).toEqual({
      ok: false,
      reason: "sensorHeight",
    });
    expect(angleOfView({ sensorWidth: 36, sensorHeight: 24, focalLength: 0 })).toEqual({
      ok: false,
      reason: "focalLength",
    });
    expect(
      angleOfView({ sensorWidth: 36, sensorHeight: 24, focalLength: 50, subjectDistance: 0 }),
    ).toEqual({ ok: false, reason: "subjectDistance" });
  });
});

describe("cropFactor", () => {
  it("APS-C 23.5x15.6 — computed crop, never the marketing 1.5", () => {
    // diag = sqrt(552.25+243.36) = sqrt(795.61) = 28.20656 mm
    // crop = 43.266615/28.20656 = 1.533921
    // f=35: 35*1.533921 = 53.69 mm.  N=1.8: 1.8*1.533921 = 2.76
    const result = cropFactor({ sensorWidth: 23.5, sensorHeight: 15.6, focalLength: 35, fNumber: 1.8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sensorDiagonal).toBeCloseTo(28.20656, 4);
    expect(result.cropFactor).toBeCloseTo(1.533921, 5);
    expect(result.equivalentFocalLength).toBeCloseTo(53.69, 2);
    expect(result.equivalentAperture).toBeCloseTo(2.76, 2);
  });

  it("Four Thirds 17.3x13.0 lands at 1.9994, deliberately not the rounded 2.0", () => {
    // diag = sqrt(299.29+169.00) = sqrt(468.29) = 21.64 mm (21.64^2 = 468.2896)
    // crop = 43.266615/21.64 = 1.999381
    // f=12: 12*1.999381 = 23.99 mm
    const result = cropFactor({ sensorWidth: 17.3, sensorHeight: 13.0, focalLength: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sensorDiagonal).toBeCloseTo(21.64, 2);
    expect(result.cropFactor).toBeCloseTo(1.9994, 3);
    expect(result.cropFactor).not.toBeCloseTo(2, 3);
    expect(result.equivalentFocalLength).toBeCloseTo(23.99, 2);
  });

  it("36x24 is the identity that checks the embedded 135 diagonal: crop = 1.0000 exactly", () => {
    const result = cropFactor({ sensorWidth: 36, sensorHeight: 24, focalLength: 50, fNumber: 1.4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cropFactor).toBeCloseTo(1, 6);
    expect(result.equivalentFocalLength).toBeCloseTo(50, 2);
    expect(result.equivalentAperture).toBeCloseTo(1.4, 2);
  });

  it("leaves focal length and aperture undefined when neither was given", () => {
    const result = cropFactor({ sensorWidth: 23.5, sensorHeight: 15.6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.equivalentFocalLength).toBeUndefined();
    expect(result.equivalentAperture).toBeUndefined();
  });

  it("refuses a non-positive sensor dimension", () => {
    expect(cropFactor({ sensorWidth: 0, sensorHeight: 24 })).toEqual({
      ok: false,
      reason: "sensorWidth",
    });
    expect(cropFactor({ sensorWidth: 36, sensorHeight: -1 })).toEqual({
      ok: false,
      reason: "sensorHeight",
    });
  });
});

describe("depthOfField", () => {
  it("f=50, N=8, c=0.030 mm, s=3.000 m", () => {
    // H = 2500/(8*0.03) + 50 = 2500/0.24 + 50 = 31400/3 = 10466.6667 mm = 10.467 m
    // near = 3000*(H-50)/(H+3000-100) = 93750000/40100 = 2337.90524 mm = 2.338 m
    // far  = 3000*(H-50)/(H-3000)     = 93750000/22400  = 4185.26786 mm = 4.185 m
    // dof = 4185.26786 - 2337.90524 = 1847.36262 mm = 1.847 m
    const result = depthOfField({ focalLength: 50, fNumber: 8, focusDistance: 3, circleOfConfusion: 0.03 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hyperfocal).toBeCloseTo(10.466667, 5);
    expect(result.nearLimit).toBeCloseTo(2.337905, 5);
    expect(result.farLimit).toBeCloseTo(4.185268, 5);
    expect(result.totalDepth).toBeCloseTo(1.847363, 5);
  });

  it("focus AT or beyond the hyperfocal: far is infinite and near approaches H/2 by algebraic identity", () => {
    // H = 31400/3 mm = 10.466667 m. Focusing a hair beyond it (not bit-for-bit
    // AT it, which floating point cannot guarantee across the m/mm round trip)
    // still puts s >= H, so far must be infinite and near must sit at very
    // nearly H/2 = 5.233333 m — the identity near = H*(H-f)/(2*(H-f)) = H/2
    // holds independent of f, N and c.
    const hyperfocalM = 31400 / 3 / 1000;
    const result = depthOfField({
      focalLength: 50,
      fNumber: 8,
      focusDistance: hyperfocalM + 0.001,
      circleOfConfusion: 0.03,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hyperfocal).toBeCloseTo(hyperfocalM, 6);
    expect(result.nearLimit).toBeCloseTo(hyperfocalM / 2, 3);
    // Absent, not a very large number: at s >= H the far limit IS infinity,
    // and the absence is the only thing that says so.
    expect(result.farLimit).toBeUndefined();
    expect(result.totalDepth).toBeUndefined();
  });

  it("corrects the catalogue's third vector: near limit is 938.050 mm, not the draft's 938.03", () => {
    // f=24, N=11, c=0.030, s=2.000 m = 2000 mm.
    // H = 576/(11*0.03) + 24 = 576/0.33 + 24 = 19464/11 mm = 1769.454545 mm
    // s (2000) > H, so far is infinite.
    // near = 2000*(H-24)/(H+2000-48) = 2000*(19200/11)/(40936/11)
    //      = 38400000/40936 = 4800000/5117 = 938.049638 mm = 0.938050 m
    const result = depthOfField({ focalLength: 24, fNumber: 11, focusDistance: 2, circleOfConfusion: 0.03 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hyperfocal).toBeCloseTo(1.769455, 5);
    expect(result.nearLimit).toBeCloseTo(0.938050, 5);
    // Absent, not a very large number: at s >= H the far limit IS infinity,
    // and the absence is the only thing that says so.
    expect(result.farLimit).toBeUndefined();
    expect(result.totalDepth).toBeUndefined();
  });

  it("refuses a non-positive focal length, f-number or CoC, and focus at or inside the front principal plane", () => {
    expect(depthOfField({ focalLength: 0, fNumber: 8, focusDistance: 3, circleOfConfusion: 0.03 })).toEqual({
      ok: false,
      reason: "focalLength",
    });
    expect(depthOfField({ focalLength: 50, fNumber: 0, focusDistance: 3, circleOfConfusion: 0.03 })).toEqual({
      ok: false,
      reason: "fNumber",
    });
    expect(
      depthOfField({ focalLength: 50, fNumber: 8, focusDistance: 3, circleOfConfusion: 0 }),
    ).toEqual({ ok: false, reason: "circleOfConfusion" });
    // f = 2000 mm = 2 m, s = 1 m: the subject is inside the front principal plane.
    expect(
      depthOfField({ focalLength: 2000, fNumber: 8, focusDistance: 1, circleOfConfusion: 0.03 }),
    ).toEqual({ ok: false, reason: "focusDistance" });
  });

  it("takes the circle of confusion with no default at all — there is no field to omit it from", () => {
    // TypeScript enforces this structurally: circleOfConfusion is required, not `?`.
    const result = depthOfField({ focalLength: 50, fNumber: 8, focusDistance: 3, circleOfConfusion: 0.03 });
    expect(result.ok).toBe(true);
  });
});

describe("circleOfConfusionFromDiagonal", () => {
  it("divides the diagonal by the chosen divisor", () => {
    // 43.266615/1500 = 0.028844 mm
    const result = circleOfConfusionFromDiagonal(43.266615, 1500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.circleOfConfusion).toBeCloseTo(0.028844, 6);
  });

  it("refuses a diagonal or divisor outside its band", () => {
    expect(circleOfConfusionFromDiagonal(0, 1500)).toEqual({ ok: false, reason: "sensorDiagonal" });
    expect(circleOfConfusionFromDiagonal(43, 100)).toEqual({ ok: false, reason: "divisor" });
  });
});

describe("diffractionLimit", () => {
  it("N=16, lambda=550 nm, 36 mm sensor at 6000 px", () => {
    // pitch = 36/6000 = 0.006 mm = 6.000 um
    // perStop = 2.4393398*0.550 = 1.341637; d = 1.341637*16 = 21.466 um
    // ratio = 21.466/6.000 = 3.58; N_equal = 6.000/1.341637 = 4.47
    const result = diffractionLimit({ fNumber: 16, wavelengthNm: 550, sensorWidth: 36, pixelCount: 6000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pixelPitch).toBeCloseTo(6.0, 4);
    expect(result.airyDiameter).toBeCloseTo(21.466, 2);
    expect(result.ratio).toBeCloseTo(3.58, 2);
    expect(result.fNumberAtOnePitch).toBeCloseTo(4.47, 2);
  });

  it("N=4, lambda=550 nm, 36 mm sensor at 8256 px", () => {
    // pitch = 36/8256 = 0.00436047 mm = 4.36047 um
    // d = 1.341637*4 = 5.36655 um; ratio = 5.36655/4.36047 = 1.23
    // N_equal = 4.36047/1.341637 = 3.25
    const result = diffractionLimit({ fNumber: 4, wavelengthNm: 550, sensorWidth: 36, pixelCount: 8256 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pixelPitch).toBeCloseTo(4.3605, 3);
    expect(result.airyDiameter).toBeCloseTo(5.3665, 2);
    expect(result.ratio).toBeCloseTo(1.23, 2);
    expect(result.fNumberAtOnePitch).toBeCloseTo(3.25, 2);
  });

  it("self-check: at N = N_equal the ratio prints exactly 1.00", () => {
    // pitch 6.000 um, lambda 550 nm: N = 6.000/1.341637 = 4.4721
    const result = diffractionLimit({ fNumber: 4.4721, wavelengthNm: 550, sensorWidth: 36, pixelCount: 6000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBeCloseTo(1.0, 2);
  });

  it("refuses an out-of-range f-number, wavelength, sensor width or pixel count", () => {
    expect(diffractionLimit({ fNumber: 0, wavelengthNm: 550, sensorWidth: 36, pixelCount: 6000 })).toEqual({
      ok: false,
      reason: "fNumber",
    });
    expect(diffractionLimit({ fNumber: 8, wavelengthNm: 100, sensorWidth: 36, pixelCount: 6000 })).toEqual({
      ok: false,
      reason: "wavelengthNm",
    });
    expect(diffractionLimit({ fNumber: 8, wavelengthNm: 550, sensorWidth: 0, pixelCount: 6000 })).toEqual({
      ok: false,
      reason: "sensorWidth",
    });
    expect(diffractionLimit({ fNumber: 8, wavelengthNm: 550, sensorWidth: 36, pixelCount: 0 })).toEqual({
      ok: false,
      reason: "pixelCount",
    });
  });
});

describe("exposureSolve", () => {
  it("solves the shutter: N1=2.8/t1=1/125/S1=100 to N2=5.6/S2=100 needs t2 = 1/31.25, not the draft's 1/31.3", () => {
    // t2 = t1*(N2/N1)^2*(S1/S2) = 0.008*4*1 = 0.032 s = 1/31.25 (never quietly snapped)
    // givenShiftStops = 2*log2(5.6/2.8) = 2*log2(2) = 2.000
    // referenceEv100 = log2(2.8^2/0.008) = log2(980) = 9.937
    const result = exposureSolve({
      reference: { fNumber: 2.8, shutter: 1 / 125, iso: 100 },
      targetFNumber: 5.6,
      targetIso: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.solvedField).toBe("shutter");
    expect(result.target.shutter).toBeCloseTo(0.032, 6);
    expect(result.targetShutterDenominator).toBeCloseTo(31.25, 6);
    expect(result.givenShiftStops).toBeCloseTo(2.0, 5);
    expect(result.referenceEv100).toBeCloseTo(9.937, 2);
    // Equal exposure by construction: both combinations sit at the same EV.
    expect(result.targetEv100).toBeCloseTo(result.referenceEv100, 6);
  });

  it("closes the coverage gap the review found: S1=100/S2=400 (S1 != S2) still gives the textbook t2 = 0.008 s", () => {
    // Every prior shutter-solve vector used S1 = S2, so the (S1/S2) factor was
    // always 1 and an inverted (S2/S1) would have passed unnoticed. Here it does
    // not: S1/S2 = 100/400 = 0.25. t2 = t1*(N2/N1)^2*(S1/S2) = 0.008*4*0.25 =
    // 0.008 s. An implementation that swapped the ratio to (S2/S1) = 4 would
    // instead print 0.128 s, sixteen times too long.
    const result = exposureSolve({
      reference: { fNumber: 2.8, shutter: 1 / 125, iso: 100 },
      targetFNumber: 5.6,
      targetIso: 400,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.solvedField).toBe("shutter");
    expect(result.target.shutter).toBeCloseTo(0.008, 6);
  });

  it("solves the aperture: N1=11/t1=1/250/S1=200 to t2=1/60/S2=200 needs N2 = 22.45", () => {
    // ratio = (t2*S2)/(t1*S1) = ((1/60)*200)/((1/250)*200) = 250/60 = 4.166667
    // N2 = 11*sqrt(4.166667) = 11*2.041241 = 22.45
    const result = exposureSolve({
      reference: { fNumber: 11, shutter: 1 / 250, iso: 200 },
      targetShutter: 1 / 60,
      targetIso: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.solvedField).toBe("fNumber");
    expect(result.target.fNumber).toBeCloseTo(22.45, 1);
  });

  it("closes the coverage gap the review found: N1=8/t1=1/100/S1=100 to t2=1/25/S2=400 (t1 != t2 AND S1 != S2) needs N2 = 32", () => {
    // Every prior aperture-solve vector used S1 = S2, so only the t2/t1 ratio was
    // exercised. Here ratio = (t2*S2)/(t1*S1) = ((1/25)*400)/((1/100)*100) =
    // 16/1 = 16, N2 = 8*sqrt(16) = 8*4 = 32. Swapping the ratio upside down
    // would give sqrt(1/16) = 0.25 and N2 = 2 — nowhere near 32.
    const result = exposureSolve({
      reference: { fNumber: 8, shutter: 1 / 100, iso: 100 },
      targetShutter: 1 / 25,
      targetIso: 400,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.solvedField).toBe("fNumber");
    expect(result.target.fNumber).toBeCloseTo(32, 6);
  });

  it("solves the ISO: N1=2.8/t1=1/125/S1=100 to N2=5.6/t2=1/125 (same shutter) needs S2 = 400", () => {
    // apertureRatio = 5.6/2.8 = 2. S2 = 100*2^2*(t1/t2) = 100*4*1 = 400, since
    // t1 = t2 here. Cross-check: E1 = 7.84/(0.008*100) = 9.8, E2 = 31.36/(0.008*400) = 9.8.
    const result = exposureSolve({
      reference: { fNumber: 2.8, shutter: 1 / 125, iso: 100 },
      targetFNumber: 5.6,
      targetShutter: 1 / 125,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.solvedField).toBe("iso");
    expect(result.target.iso).toBeCloseTo(400, 6);
    expect(result.targetEv100).toBeCloseTo(result.referenceEv100, 6);
  });

  it("closes the coverage gap the review found: N1=2.8/t1=1/125/S1=100 to N2=4/t2=1/500 (t1 != t2) needs S2 = 816.327", () => {
    // Every prior ISO-solve vector used t1 = t2, so only the aperture ratio
    // squared was exercised. Here apertureRatio = 4/2.8 = 10/7, squared =
    // 100/49; t1/t2 = (1/125)/(1/500) = 4. S2 = 100*(100/49)*4 = 40000/49 =
    // 816.326531. Swapping to (t2/t1) = 0.25 would instead give 51.02.
    const result = exposureSolve({
      reference: { fNumber: 2.8, shutter: 1 / 125, iso: 100 },
      targetFNumber: 4,
      targetShutter: 1 / 500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.solvedField).toBe("iso");
    expect(result.target.iso).toBeCloseTo(816.326531, 4);
  });

  it("refuses zero or two empty target fields — exactly one must be left blank", () => {
    expect(
      exposureSolve({
        reference: { fNumber: 2.8, shutter: 0.008, iso: 100 },
        targetFNumber: 5.6,
        targetShutter: 0.002,
        targetIso: 100,
      }),
    ).toEqual({ ok: false, reason: "targets" });
    expect(exposureSolve({ reference: { fNumber: 2.8, shutter: 0.008, iso: 100 } })).toEqual({
      ok: false,
      reason: "targets",
    });
  });

  it("refuses an invalid reference combination", () => {
    expect(
      exposureSolve({
        reference: { fNumber: 0, shutter: 0.008, iso: 100 },
        targetFNumber: 5.6,
        targetIso: 100,
      }),
    ).toEqual({ ok: false, reason: "referenceFNumber" });
  });
});

describe("exposureDifference", () => {
  it("N1=4/t1=1/60/S1=400 vs N2=4/t2=1/60/S2=1600: exactly two stops brighter, no calculator needed", () => {
    // E1 = 16/((1/60)*400) = 2.4 exactly. E2 = 16/((1/60)*1600) = 0.6 exactly.
    // stops = log2(0.6/2.4) = log2(0.25) = -2 exactly: two ISO doublings.
    const result = exposureDifference(
      { fNumber: 4, shutter: 1 / 60, iso: 400 },
      { fNumber: 4, shutter: 1 / 60, iso: 1600 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops).toBeCloseTo(-2, 6);
    // The identity the JSDoc claims is checked: EV100 = log2(N^2/t) - log2(S/100)
    // = log2(100*E). firstEv100 = log2(100*2.4) = log2(240) = 7.906891.
    // secondEv100 = log2(100*0.6) = log2(60) = 5.906891. Their difference must
    // equal `stops` exactly, rather than the two code paths merely agreeing by
    // construction with nothing asserting it.
    expect(result.firstEv100).toBeCloseTo(7.906891, 5);
    expect(result.secondEv100).toBeCloseTo(5.906891, 5);
    expect(result.stops).toBeCloseTo(result.secondEv100 - result.firstEv100, 9);
  });

  it("refuses an invalid first or second combination", () => {
    expect(
      exposureDifference({ fNumber: 0, shutter: 0.01, iso: 100 }, { fNumber: 4, shutter: 0.01, iso: 100 }),
    ).toEqual({ ok: false, reason: "firstFNumber" });
    expect(
      exposureDifference({ fNumber: 4, shutter: 0.01, iso: 100 }, { fNumber: 4, shutter: -1, iso: 100 }),
    ).toEqual({ ok: false, reason: "secondShutter" });
  });
});

describe("flashAperture", () => {
  it("GN=58 m at ISO 100, d=5 m, S=100: N=11.60, and doubling ISO to 400 doubles GN to 116.00, giving N=23.20 — two stops for two stops", () => {
    const base = flashAperture({ guideNumber: 58, guideNumberUnit: "m", distance: 5, iso: 100 });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    expect(base.fNumber).toBeCloseTo(11.6, 2);

    const scaled = flashAperture({ guideNumber: 58, guideNumberUnit: "m", distance: 5, iso: 400 });
    expect(scaled.ok).toBe(true);
    if (!scaled.ok) return;
    expect(scaled.guideNumberAtIso).toBeCloseTo(116.0, 2);
    expect(scaled.fNumber).toBeCloseTo(23.2, 2);
  });

  it("accepts the guide number in feet, without a default unit — 100 ft = 30.48 m", () => {
    // GN = 100*0.3048 = 30.48 m; N = 30.48/5 = 6.096
    const result = flashAperture({ guideNumber: 100, guideNumberUnit: "ft", distance: 5, iso: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.guideNumberAtIso).toBeCloseTo(30.48, 3);
    expect(result.fNumber).toBeCloseTo(6.096, 3);
  });

  it("moving the light from 2 m to 3 m loses 1.170 stops, matching the aperture route exactly", () => {
    // stops = 2*log2(3/2) = 2*0.5849625 = 1.170 stops lost.
    // Cross-check with GN=24 m: N goes 12.00 -> 8.00, 2*log2(12/8) = 1.170.
    const result = flashAperture({
      guideNumber: 24,
      guideNumberUnit: "m",
      distance: 2,
      iso: 100,
      secondDistance: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fNumber).toBeCloseTo(12.0, 2);
    expect(result.secondFNumber).toBeCloseTo(8.0, 2);
    expect(result.distanceStops).toBeCloseTo(1.17, 2);
  });

  it("refuses a guide number, distance or ISO outside its band", () => {
    expect(flashAperture({ guideNumber: 0, guideNumberUnit: "m", distance: 5, iso: 100 })).toEqual({
      ok: false,
      reason: "guideNumber",
    });
    expect(flashAperture({ guideNumber: 58, guideNumberUnit: "m", distance: 0, iso: 100 })).toEqual({
      ok: false,
      reason: "distance",
    });
    expect(flashAperture({ guideNumber: 58, guideNumberUnit: "m", distance: 5, iso: 1 })).toEqual({
      ok: false,
      reason: "iso",
    });
  });

  it("a feet figure typed into the metre range refuses rather than silently under-reading by 3.28x", () => {
    // 200 ft = 60.96 m, still inside 1-200, so it must be an EXTREME feet value
    // to exceed the metres band after conversion — 700 ft = 213.36 m > 200.
    const result = flashAperture({ guideNumber: 700, guideNumberUnit: "ft", distance: 5, iso: 100 });
    expect(result).toEqual({ ok: false, reason: "guideNumber" });
  });
});

describe("flashDistance", () => {
  it("GN=36 m at ISO 100, target N=8: maximum distance is 4.50 m", () => {
    const result = flashDistance({ guideNumber: 36, guideNumberUnit: "m", fNumber: 8, iso: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distance).toBeCloseTo(4.5, 2);
  });

  it("rescales the guide number to the entered ISO before dividing by the aperture: GN=36 m at ISO 400 reaches 9.00 m at f/8, not the 18.00 m a dropped sqrt would give", () => {
    // guideNumberAtIso = 36*sqrt(400/100) = 36*2 = 72.00 m; distance = 72/8 = 9.00 m.
    // ISO 100 (sqrt(S/100) = 1) can't catch a dropped sqrt; this can.
    const result = flashDistance({ guideNumber: 36, guideNumberUnit: "m", fNumber: 8, iso: 400 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.guideNumberAtIso).toBeCloseTo(72, 2);
    expect(result.distance).toBeCloseTo(9, 2);
    expect(result.distance).not.toBeCloseTo(18, 2);
  });

  it("refuses a non-positive f-number", () => {
    expect(flashDistance({ guideNumber: 36, guideNumberUnit: "m", fNumber: 0, iso: 100 })).toEqual({
      ok: false,
      reason: "fNumber",
    });
  });
});

describe("frameRateConform", () => {
  it("120 fps captured, 24 fps timeline, 5.000 s clip (600 frames)", () => {
    // speedFactor = 24/120 = 0.2 = 20.0000%. conformed = 600/24 = 25.000 s.
    // drift = 25.000 - 5.000 = +20.000 s
    const result = frameRateConform({ captureFps: 120, timelineFps: 24, sourceDuration: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frameCount).toBe(600);
    expect(result.speedPercent).toBeCloseTo(20.0, 4);
    expect(result.conformedDuration).toBeCloseTo(25.0, 3);
    expect(result.drift).toBeCloseTo(20.0, 3);
  });

  it("one hour at 24 fps (86400 frames) conformed to 23.976 fps drifts by the textbook pull-down 3.600 s", () => {
    // captureFps stays 24 (not near an NTSC label). timelineFps 23.976 -> 24000/1001.
    // conformed = 86400*1001/24000 = 3603.600 s. source = 86400/24 = 3600.000 s.
    // speedFactor = (24000/1001)/24 = 1000/1001 = 0.999001 = 99.9001%
    const result = frameRateConform({ captureFps: 24, timelineFps: 23.976, frameCount: 86400 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timelineFps).toBeCloseTo(24000 / 1001, 6);
    expect(result.sourceDuration).toBeCloseTo(3600.0, 3);
    expect(result.conformedDuration).toBeCloseTo(3603.6, 3);
    expect(result.drift).toBeCloseTo(3.6, 3);
    expect(result.speedPercent).toBeCloseTo(99.9001, 4);
  });

  it("60 fps captured, 25 fps timeline, 10.000 s clip (600 frames): 41.6667% speed, +14.000 s drift", () => {
    const result = frameRateConform({ captureFps: 60, timelineFps: 25, frameCount: 600 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.speedPercent).toBeCloseTo(41.6667, 4);
    expect(result.conformedDuration).toBeCloseTo(24.0, 3);
    expect(result.drift).toBeCloseTo(14.0, 3);
  });

  it("a clip length that does not land on a whole frame is rounded, and the exact resulting length is reported back", () => {
    // captureFps 29.97 -> 30000/1001. Nf = round(30000/1001*5) = round(149.850) = 150.
    // sourceDuration = 150*1001/30000 = 5.005 s, not the requested 5 s exactly.
    const result = frameRateConform({ captureFps: 29.97, timelineFps: 25, sourceDuration: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frameCount).toBe(150);
    expect(result.sourceDuration).toBeCloseTo(5.005, 3);
  });

  it("solving for a 5x slow-motion factor on a 24 fps timeline needs a 120 fps capture rate", () => {
    // k is the slow-motion MULTIPLIER: captureFps = timelineFps*k = 24*5 = 120.
    const result = frameRateConform({
      captureFps: 120,
      timelineFps: 24,
      sourceDuration: 5,
      slowMotionFactor: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.requiredCaptureFps).toBeCloseTo(120, 6);
  });

  it("refuses a non-positive rate, both or neither of duration/frameCount, and an out-of-range slow-motion factor", () => {
    expect(frameRateConform({ captureFps: 0, timelineFps: 24, sourceDuration: 5 })).toEqual({
      ok: false,
      reason: "captureFps",
    });
    expect(frameRateConform({ captureFps: 24, timelineFps: 24, sourceDuration: 5, frameCount: 120 })).toEqual({
      ok: false,
      reason: "clipLength",
    });
    expect(frameRateConform({ captureFps: 24, timelineFps: 24 })).toEqual({
      ok: false,
      reason: "clipLength",
    });
    expect(
      frameRateConform({ captureFps: 24, timelineFps: 24, sourceDuration: 5, slowMotionFactor: 0 }),
    ).toEqual({ ok: false, reason: "slowMotionFactor" });
  });
});

describe("illuminanceToAperture", () => {
  it("E=1000 lx, S=100, t=1/50 s, C=250: N = sqrt(8) = 2.83", () => {
    // 1000*100 = 100000; *0.02 = 2000; /250 = 8; sqrt(8) = 2.8284
    const result = illuminanceToAperture({ illuminance: 1000, unit: "lx", iso: 100, shutter: 1 / 50, calibrationConstant: 250 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fNumber).toBeCloseTo(2.83, 2);
  });

  it("converts lx <-> fc even when no calibration constant was given, rather than blanking the whole surface", () => {
    // 1000*0.09290304 = 92.9030 fc
    const result = illuminanceToAperture({ illuminance: 1000, unit: "lx", iso: 100, shutter: 0.02 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.footCandles).toBeCloseTo(92.903, 3);
    expect(result.fNumber).toBeUndefined();
    expect(result.nearestThirdStop).toBeUndefined();
  });

  it("closes the completeness gap the review found: converts lx <-> fc with NEITHER iso NOR shutter typed at all", () => {
    // The C-less branch reads neither iso nor shutter, so a user who has typed
    // only an illuminance must still get the conversion rather than a refusal
    // for a field the answer never touches. 1000*0.09290304 = 92.9030 fc.
    const result = illuminanceToAperture({ illuminance: 1000, unit: "lx" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lux).toBe(1000);
    expect(result.footCandles).toBeCloseTo(92.903, 3);
    expect(result.fNumber).toBeUndefined();
  });

  it("the lx -> fc -> lx round trip closes exactly, because both directions share the one defined foot", () => {
    const forward = illuminanceToAperture({ illuminance: 1000, unit: "lx", iso: 100, shutter: 0.02 });
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;
    const back = illuminanceToAperture({
      illuminance: forward.footCandles,
      unit: "fc",
      iso: 100,
      shutter: 0.02,
    });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.lux).toBeCloseTo(1000, 6);
  });

  it("E=500 fc, S=400, t=1/48 s, C=250: N = 13.393973, nearest third-stop mark is f/12.699 at k=22", () => {
    // 500*10.763910417 = 5381.955208 lx; *400 = 2152782083.5; *(1/48) = 44849626.7
    // /250 = 179398.507; N = sqrt(E*S*t/C) = sqrt(5381.955208*400/48/250)
    //      = sqrt(179.398507) = 13.393973
    // Third-stop search: centre k = round(6*log2(13.393973)) = round(6*3.74354)
    // = round(22.4613) = 22. Neighbour marks: k=21 -> 2^3.5 = 11.313708,
    // k=22 -> 2^(11/3) = 12.699208, k=23 -> 2^(23/6) = 14.254379. Distances to
    // 13.393973 are 2.0803, 0.6948 and 0.8604 — the centre mark (k=22) is
    // closest, so it wins over both neighbours.
    const result = illuminanceToAperture({ illuminance: 500, unit: "fc", iso: 400, shutter: 1 / 48, calibrationConstant: 250 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lux).toBeCloseTo(5381.955208, 5);
    expect(result.fNumber).toBeCloseTo(13.393973, 4);
    expect(result.thirdStopIndex).toBe(22);
    expect(result.nearestThirdStop).toBeCloseTo(12.699208, 5);
  });

  it("refuses an out-of-range illuminance, or a supplied-but-invalid ISO, shutter or calibration constant", () => {
    expect(illuminanceToAperture({ illuminance: 0, unit: "lx", iso: 100, shutter: 0.02 })).toEqual({
      ok: false,
      reason: "illuminance",
    });
    // iso and shutter are validated only on the branch that computes fNumber —
    // see the completeness test above — so a calibration constant must be
    // present here for these two cases to reach the range checks at all.
    expect(
      illuminanceToAperture({ illuminance: 1000, unit: "lx", iso: 1, shutter: 0.02, calibrationConstant: 250 }),
    ).toEqual({ ok: false, reason: "iso" });
    expect(
      illuminanceToAperture({ illuminance: 1000, unit: "lx", iso: 100, shutter: 0, calibrationConstant: 250 }),
    ).toEqual({ ok: false, reason: "shutter" });
    expect(
      illuminanceToAperture({ illuminance: 1000, unit: "lx", iso: 100, shutter: 0.02, calibrationConstant: 50 }),
    ).toEqual({ ok: false, reason: "calibrationConstant" });
  });
});

describe("miredShift", () => {
  it("3200 K to 5600 K is -133.929 mireds, why a full CTB is quoted at roughly -130", () => {
    // M1 = 1e6/3200 = 312.500. M2 = 1e6/5600 = 178.571. dM = 178.571-312.500 = -133.929
    const result = miredShift({ sourceTemperature: 3200, targetTemperature: 5600 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceMired).toBeCloseTo(312.5, 3);
    expect(result.resultMired).toBeCloseTo(178.571, 3);
    expect(result.shift).toBeCloseTo(-133.929, 3);
  });

  it("5600 K with a +81 mired shift lands at 3852.5 K", () => {
    // M = 178.571+81 = 259.571; T = 1e6/259.571 = 3852.5 K
    const result = miredShift({ sourceTemperature: 5600, shift: 81 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resultTemperature).toBeCloseTo(3852.5, 0);
  });

  it("3200 K with a -131 mired shift lands at 5509.6 K, not the 5600 K the gel is sold as reaching", () => {
    const result = miredShift({ sourceTemperature: 3200, shift: -131 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resultTemperature).toBeCloseTo(5509.6, 0);
    expect(result.resultTemperature).not.toBeCloseTo(5600, 0);
  });

  it("when both a target and a shift are given, the target wins and the shift is reported as the derived difference", () => {
    // shift: 50 is a plausible but WRONG value on purpose — the point of the
    // test is that it gets overwritten by the derived -133.929, not honoured.
    const result = miredShift({ sourceTemperature: 3200, targetTemperature: 5600, shift: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resultTemperature).toBe(5600);
    expect(result.shift).toBeCloseTo(-133.929, 3);
  });

  it("refuses a temperature out of range, a shift out of range, neither target nor shift, and a shift past the reciprocal origin", () => {
    expect(miredShift({ sourceTemperature: 500 })).toEqual({ ok: false, reason: "sourceTemperature" });
    expect(miredShift({ sourceTemperature: 3200, targetTemperature: 99999 })).toEqual({
      ok: false,
      reason: "targetTemperature",
    });
    expect(miredShift({ sourceTemperature: 3200, shift: 9999 })).toEqual({ ok: false, reason: "shift" });
    expect(miredShift({ sourceTemperature: 3200 })).toEqual({ ok: false, reason: "target" });
    // M(1000 K) = 1000; a shift of -1000 drives it to zero, which has no kelvin answer.
    expect(miredShift({ sourceTemperature: 1000, shift: -1000 })).toEqual({ ok: false, reason: "shift" });
  });
});

describe("motionBlurPixels", () => {
  it("v=10 m/s, D=50 m, f=200 mm, t=1/500 s, 36 mm sensor at 6000 px: 13.386881 px", () => {
    // dx = 10*0.002 = 0.02 m = 20 mm. magnification = 200/49800 = 0.00401606
    // dImage = 20*0.00401606 = 0.08032129 mm. blurPx = 0.08032129/(36/6000) = 13.386881
    // (precision 1 alone would not rule out the draft's rounding of 13.39 to
    // something like 13.35, so this is asserted to precision 4.)
    const result = motionBlurPixels({
      speed: 10,
      speedUnit: "m/s",
      subjectDistance: 50,
      focalLength: 200,
      sensorWidth: 36,
      pixelCount: 6000,
      shutter: 1 / 500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.magnification).toBeCloseTo(0.0040161, 6);
    expect(result.blurMillimetres).toBeCloseTo(0.0803213, 5);
    expect(result.blurPixels).toBeCloseTo(13.386881, 4);
  });

  it("60 km/h subject: converted to 16.6667 m/s before anything else is multiplied — 27.847396 px", () => {
    // v = 60/3.6 = 16.6667 m/s. dx = 16.6667/250 = 0.0666667 m = 66.6667 mm.
    // magnification = 50/19950 = 0.00250627. dImage = 66.6667*0.00250627 = 0.167084 mm
    // blurPx = 0.167084/(36/6000) = 27.847396
    const result = motionBlurPixels({
      speed: 60,
      speedUnit: "km/h",
      subjectDistance: 20,
      focalLength: 50,
      sensorWidth: 36,
      pixelCount: 6000,
      shutter: 1 / 250,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blurMillimetres).toBeCloseTo(0.167084, 5);
    expect(result.blurPixels).toBeCloseTo(27.847396, 4);
  });

  it("refuses a subject at or inside the focal length, a non-positive speed, sensor width or pixel count", () => {
    expect(
      motionBlurPixels({
        speed: 10,
        speedUnit: "m/s",
        subjectDistance: 0.1,
        focalLength: 200,
        sensorWidth: 36,
        pixelCount: 6000,
        shutter: 0.002,
      }),
    ).toEqual({ ok: false, reason: "subjectDistance" });
    expect(
      motionBlurPixels({
        speed: 0,
        speedUnit: "m/s",
        subjectDistance: 50,
        focalLength: 200,
        sensorWidth: 36,
        pixelCount: 6000,
        shutter: 0.002,
      }),
    ).toEqual({ ok: false, reason: "speed" });
  });
});

describe("motionBlurShutter", () => {
  it("corrects the direction of rounding: the denominator rounds UP to 1/6694, never DOWN to 1/6693", () => {
    // Same geometry as the 13.39 px vector, solved for B = 1.00 px:
    // t = 1*(36/6000)*(50000-200)/(200*10000) = 0.006*49800/2000000 = 0.0001494 s
    // exactDenominator = 1/0.0001494 = 6693.4404...
    // 1/6693 = 1.49409e-4 s is LONGER than 0.0001494 s and would allow MORE than
    // 1.00 px of blur, which is the exact defect the review found: the
    // denominator must round UP (a shorter, more conservative exposure).
    const result = motionBlurShutter({
      speed: 10,
      speedUnit: "m/s",
      subjectDistance: 50,
      focalLength: 200,
      sensorWidth: 36,
      pixelCount: 6000,
      acceptableBlurPixels: 1.0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shutter).toBeCloseTo(0.0001494, 7);
    expect(result.exactDenominator).toBeCloseTo(6693.44, 1);
    expect(result.shutterDenominator).toBe(6694);
    // The rounded shutter never allows more blur than the exact one would.
    expect(1 / result.shutterDenominator).toBeLessThanOrEqual(result.shutter);
  });

  it("refuses an out-of-range acceptable blur", () => {
    expect(
      motionBlurShutter({
        speed: 10,
        speedUnit: "m/s",
        subjectDistance: 50,
        focalLength: 200,
        sensorWidth: 36,
        pixelCount: 6000,
        acceptableBlurPixels: 0,
      }),
    ).toEqual({ ok: false, reason: "acceptableBlurPixels" });
  });
});

describe("ndFilterExposure", () => {
  it("a single 10-stop filter: F=1024.000, D=3.010, t2 = 8.192 s exactly", () => {
    const result = ndFilterExposure({ baseShutter: 1 / 125, filters: [{ stops: 10 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factor).toBeCloseTo(1024, 3);
    expect(result.density).toBeCloseTo(3.01, 3);
    expect(result.shutter).toBeCloseTo(8.192, 3);
  });

  it("a filter given as density D=1.8: F = 10^1.8 = 63.0957, t2 = 1.052 s", () => {
    // stops = 1.8/0.30103 = 5.979
    const result = ndFilterExposure({ baseShutter: 1 / 60, filters: [{ density: 1.8 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops).toBeCloseTo(5.979, 2);
    expect(result.factor).toBeCloseTo(63.0957, 2);
    expect(result.shutter).toBeCloseTo(1.052, 3);
  });

  it("corrects the catalogue's stacking vector: 6 stops + D=0.9 gives factor 508.370, not the draft's 508.60", () => {
    // 64*10^0.9 = 64*7.943282 = 508.370 (never sum factors linearly)
    // density = log10(64) + 0.9 = 1.80618 + 0.9 = 2.706. With t1=1/500: t2 = 1.017 s
    const result = ndFilterExposure({ baseShutter: 1 / 500, filters: [{ stops: 6 }, { density: 0.9 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factor).toBeCloseTo(508.37, 1);
    expect(result.factor).not.toBeCloseTo(508.6, 1);
    expect(result.density).toBeCloseTo(2.706, 2);
    expect(result.shutter).toBeCloseTo(1.017, 3);
  });

  it("refuses an empty stack, a filter given in two forms at once, and a factor below 1", () => {
    expect(ndFilterExposure({ baseShutter: 0.008, filters: [] })).toEqual({ ok: false, reason: "filters" });
    expect(ndFilterExposure({ baseShutter: 0.008, filters: [{ stops: 3, density: 0.9 }] })).toEqual({
      ok: false,
      reason: "filterForm",
    });
    expect(ndFilterExposure({ baseShutter: 0.008, filters: [{ factor: 0.5 }] })).toEqual({
      ok: false,
      reason: "factor",
    });
  });
});

describe("pqFromSignal / pqFromLuminance", () => {
  it("the four ST 2084 constants satisfy c1 = c3 - c2 + 1, catching a mistyped digit by arithmetic", () => {
    expect(PQ_C3 - PQ_C2 + 1).toBeCloseTo(PQ_C1, 10);
  });

  it("N=1.000000 is peak luminance, exactly: this checks the five constants at once", () => {
    const result = pqFromSignal(1, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.luminance).toBeCloseTo(10000, 3);
    // Narrow top of range is 940, full range top is the max code 1023.
    expect(result.code.narrow).toBe(940);
    expect(result.code.full).toBe(1023);
  });

  it("N=0.500000 at 10 bit: about 92.246 cd/m^2, and the code values round 511.5 UP to 512", () => {
    const result = pqFromSignal(0.5, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.luminance).toBeCloseTo(92.246, 1);
    // narrow = round(876*0.5+64) = round(502) = 502 exactly.
    expect(result.code.narrow).toBe(502);
    // full = round(1023*0.5) = round(511.5). Only round-half-UP gives 512.
    expect(result.code.full).toBe(512);
  });

  it("Y=100.000 cd/m^2 round-trips through the EOTF back to 100.000, by construction", () => {
    const toSignal = pqFromLuminance(100, 10);
    expect(toSignal.ok).toBe(true);
    if (!toSignal.ok) return;
    // yp = (100/10000)^m1 = 0.01^0.1593018 = 0.480172 (10^(-2*2610/16384)).
    // signal = ((c1 + c2*yp)/(1 + c3*yp))^m2 = (9.887930/9.973214)^78.84375
    //        = 0.991449^78.84375 = 0.508078, not the loosely-toleranced
    //        0.508071 the previous assertion let through at precision 4.
    expect(toSignal.signal).toBeCloseTo(0.508078, 5);
    expect(toSignal.code.narrow).toBe(509);
    expect(toSignal.code.full).toBe(520);

    const back = pqFromSignal(toSignal.signal, 10);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.luminance).toBeCloseTo(100, 3);
  });

  it("refuses a signal outside [0,1] and a luminance outside [0,10000] — the curve is undefined past its peak", () => {
    expect(pqFromSignal(1.5, 10)).toEqual({ ok: false, reason: "signal" });
    expect(pqFromSignal(-0.1, 10)).toEqual({ ok: false, reason: "signal" });
    expect(pqFromLuminance(10001, 10)).toEqual({ ok: false, reason: "luminance" });
    expect(pqFromLuminance(-1, 10)).toEqual({ ok: false, reason: "luminance" });
  });

  it("the 12-bit path scales narrow and full range by 2^(12-8)=16, not the 10-bit scale of 1", () => {
    // N=1: narrow = round(3504*1+256) = 3760; full = round(4095*1) = 4095.
    const peak = pqFromSignal(1, 12);
    expect(peak.ok).toBe(true);
    if (peak.ok) {
      expect(peak.code.narrow).toBe(3760);
      expect(peak.code.full).toBe(4095);
    }

    // N=0.5: narrow = round(3504*0.5+256) = round(2008) = 2008 exactly.
    // full = round(4095*0.5) = round(2047.5) = 2048 — half rounds UP, same rule
    // as the 10-bit 511.5 -> 512 case, at a scale that would expose a hardcoded
    // 10-bit constant immediately.
    const half = pqFromSignal(0.5, 12);
    expect(half.ok).toBe(true);
    if (half.ok) {
      expect(half.code.narrow).toBe(2008);
      expect(half.code.full).toBe(2048);
    }
  });
});

describe("pqSignalFromCode", () => {
  it("narrow range: code 64 is black (signal 0), code 940 is peak (signal 1) at 10 bit", () => {
    const black = pqSignalFromCode(64, 10, "narrow");
    expect(black.ok).toBe(true);
    if (black.ok) expect(black.signal).toBeCloseTo(0, 9);
    const peak = pqSignalFromCode(940, 10, "narrow");
    expect(peak.ok).toBe(true);
    if (peak.ok) expect(peak.signal).toBeCloseTo(1, 9);
  });

  it("full range: code 0 and code 1023 are the two ends at 10 bit", () => {
    const black = pqSignalFromCode(0, 10, "full");
    expect(black.ok).toBe(true);
    if (black.ok) expect(black.signal).toBe(0);
    const peak = pqSignalFromCode(1023, 10, "full");
    expect(peak.ok).toBe(true);
    if (peak.ok) expect(peak.signal).toBeCloseTo(1, 9);
  });

  it("refuses a narrow-range code in the footroom/headroom, which maps outside [0,1]", () => {
    expect(pqSignalFromCode(0, 10, "narrow")).toEqual({ ok: false, reason: "code" });
  });

  it("refuses a code outside the bit depth's representable range", () => {
    expect(pqSignalFromCode(-1, 10, "full")).toEqual({ ok: false, reason: "code" });
    expect(pqSignalFromCode(1024, 10, "full")).toEqual({ ok: false, reason: "code" });
  });
});

describe("rasterImageSize", () => {
  it("6000x4000, 3 channels, 16 bit, 1 layer: 144.000 MB, 137.329 MiB", () => {
    // bytes = 6000*4000*3*16/8 = 144000000 B = 144.000 MB
    // MiB = 144000000/1048576 = 137.329
    const result = rasterImageSize({ width: 6000, height: 4000, channels: 3, bitDepth: 16, layers: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(144000000);
    expect(result.megabytes).toBeCloseTo(144, 3);
    expect(result.mebibytes).toBeCloseTo(137.329, 3);
  });

  it("the same file with 12 layers: 1.728 GB, 1.609 GiB", () => {
    const result = rasterImageSize({ width: 6000, height: 4000, channels: 3, bitDepth: 16, layers: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(1728000000);
    expect(result.gigabytes).toBeCloseTo(1.728, 3);
    expect(result.gibibytes).toBeCloseTo(1.609, 3);
  });

  it("64 GB capacity with a typed 25.0 MB average file: 2560 files fit", () => {
    const result = rasterImageSize({
      width: 6000,
      height: 4000,
      channels: 3,
      bitDepth: 16,
      layers: 1,
      capacity: { value: 64, unit: "GB" },
      averageFileSizeMb: 25,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filesThatFit).toBe(2560);
  });

  it("adopts floorSnapped for filesThatFit: 4.1 GB over a 0.1 MB average file is 41000, not the raw-floor 40999", () => {
    // capacityBytes = 4.1*1e9 = 4099999999.9999995 in double precision (4.1 is
    // not exactly representable); fileBytes = 0.1*1e6 = 100000 exactly. The raw
    // quotient is 40999.99999999999, one ULP below the true 41000 files that
    // 4,100,000,000 bytes over 100,000-byte files actually holds — plain
    // Math.floor would under-report by one file.
    const result = rasterImageSize({
      width: 6000,
      height: 4000,
      channels: 3,
      bitDepth: 16,
      layers: 1,
      capacity: { value: 4.1, unit: "GB" },
      averageFileSizeMb: 0.1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filesThatFit).toBe(41000);
  });

  it("corrects the row-padding bug: at 1-bit depth a row rounds UP to a whole byte before it is multiplied by height", () => {
    // 10 px wide, 1 channel, 1 bit: 10 bits per row -> ceil(10/8) = 2 bytes/row,
    // not the old width*height*channels*depth/8 = 1.25 B (not even an integer).
    const padded = rasterImageSize({ width: 10, height: 1, channels: 1, bitDepth: 1, layers: 1 });
    expect(padded.ok).toBe(true);
    if (padded.ok) expect(padded.bytes).toBe(2);

    // 9 px wide, 3 rows: 9 bits/row -> ceil(9/8) = 2 bytes/row -> 2*3 = 6 bytes.
    const threeRows = rasterImageSize({ width: 9, height: 3, channels: 1, bitDepth: 1, layers: 1 });
    expect(threeRows.ok).toBe(true);
    if (threeRows.ok) expect(threeRows.bytes).toBe(6);
  });

  it("refuses a non-positive dimension, an out-of-set bit depth, and an out-of-range channel or layer count", () => {
    expect(rasterImageSize({ width: 0, height: 4000, channels: 3, bitDepth: 16, layers: 1 })).toEqual({
      ok: false,
      reason: "width",
    });
    expect(rasterImageSize({ width: 6000, height: 4000, channels: 3, bitDepth: 12, layers: 1 })).toEqual({
      ok: false,
      reason: "bitDepth",
    });
    expect(rasterImageSize({ width: 6000, height: 4000, channels: 17, bitDepth: 8, layers: 1 })).toEqual({
      ok: false,
      reason: "channels",
    });
  });

  it("leaves filesThatFit undefined when no capacity was given", () => {
    const result = rasterImageSize({ width: 6000, height: 4000, channels: 3, bitDepth: 16, layers: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filesThatFit).toBeUndefined();
  });
});

describe("timecodeToFrames", () => {
  it("29.97 DF, 01:00:00;00 -> frame 107892 (the drop-frame accounting subtracts 108)", () => {
    // totalMinutes = 60, floor(60/10) = 6, frame = 108000 - 2*(60-6) = 107892
    const result = timecodeToFrames(
      { hours: 1, minutes: 0, seconds: 0, frames: 0 },
      { nominalRate: 30, ntscPullDown: true, dropFrame: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frames).toBe(107892);
  });

  it("29.97 NDF, 01:00:00:00 -> frame 108000, counted at the nominal rate with nothing dropped", () => {
    const result = timecodeToFrames(
      { hours: 1, minutes: 0, seconds: 0, frames: 0 },
      { nominalRate: 30, ntscPullDown: true, dropFrame: false },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frames).toBe(108000);
  });

  it("23.976, 00:00:01:00 -> frame 24 (counts at the nominal 24, not the real rate)", () => {
    const result = timecodeToFrames(
      { hours: 0, minutes: 0, seconds: 1, frames: 0 },
      { nominalRate: 24, ntscPullDown: true, dropFrame: false },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frames).toBe(24);
  });

  it("25 fps, 00:10:00:00 -> frame 15000", () => {
    const result = timecodeToFrames(
      { hours: 0, minutes: 10, seconds: 0, frames: 0 },
      { nominalRate: 25, ntscPullDown: false, dropFrame: false },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frames).toBe(15000);
  });

  it("refuses a dropped label that does not exist, and a frame number at or above the nominal rate", () => {
    // 00:01:00;00 and 00:01:00;01 are the two labels 29.97 DF skips.
    expect(
      timecodeToFrames(
        { hours: 0, minutes: 1, seconds: 0, frames: 0 },
        { nominalRate: 30, ntscPullDown: true, dropFrame: true },
      ),
    ).toEqual({ ok: false, reason: "droppedLabel" });
    expect(
      timecodeToFrames(
        { hours: 0, minutes: 1, seconds: 0, frames: 1 },
        { nominalRate: 30, ntscPullDown: true, dropFrame: true },
      ),
    ).toEqual({ ok: false, reason: "droppedLabel" });
    // Minute 10 is a multiple of ten and drops nothing.
    expect(
      timecodeToFrames(
        { hours: 0, minutes: 10, seconds: 0, frames: 0 },
        { nominalRate: 30, ntscPullDown: true, dropFrame: true },
      ),
    ).toEqual({ ok: true, frames: 17982 });
    expect(
      timecodeToFrames(
        { hours: 0, minutes: 0, seconds: 0, frames: 30 },
        { nominalRate: 30, ntscPullDown: false, dropFrame: false },
      ),
    ).toEqual({ ok: false, reason: "frames" });
  });

  it("refuses drop-frame at a rate that cannot carry it, and an unrecognised nominal rate", () => {
    expect(
      timecodeToFrames(
        { hours: 0, minutes: 0, seconds: 0, frames: 0 },
        { nominalRate: 25, ntscPullDown: false, dropFrame: true },
      ),
    ).toEqual({ ok: false, reason: "dropFrame" });
    expect(
      timecodeToFrames(
        { hours: 0, minutes: 0, seconds: 0, frames: 0 },
        { nominalRate: 27, ntscPullDown: false, dropFrame: false },
      ),
    ).toEqual({ ok: false, reason: "nominalRate" });
  });
});

describe("framesToTimecode", () => {
  it("29.97 DF, frame 1800 -> 00:01:00;02 — labels ;00 and ;01 of minute 1 do not exist", () => {
    const result = framesToTimecode(1800, { nominalRate: 30, ntscPullDown: true, dropFrame: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timecode).toEqual({ hours: 0, minutes: 1, seconds: 0, frames: 2 });
  });

  it("29.97 DF, frame 17982 -> 00:10:00;00 — the tenth minute drops nothing", () => {
    const result = framesToTimecode(17982, { nominalRate: 30, ntscPullDown: true, dropFrame: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timecode).toEqual({ hours: 0, minutes: 10, seconds: 0, frames: 0 });
  });

  it("wraps a full day of 29.97 DF labels (2,589,408 frames) back to 00:00:00;00, not to hour 24", () => {
    const format = { nominalRate: 30, ntscPullDown: true, dropFrame: true } as const;
    const wrapped = framesToTimecode(2589408, format);
    expect(wrapped.ok).toBe(true);
    if (wrapped.ok) expect(wrapped.timecode).toEqual({ hours: 0, minutes: 0, seconds: 0, frames: 0 });

    // One day plus the frame-1800 vector above must read the same as frame 1800 alone.
    const dayPlus = framesToTimecode(2589408 + 1800, format);
    expect(dayPlus.ok).toBe(true);
    if (dayPlus.ok) expect(dayPlus.timecode).toEqual({ hours: 0, minutes: 1, seconds: 0, frames: 2 });
  });

  it("wraps a full day of plain 25 fps frames (2,160,000) back to 00:00:00:00", () => {
    const result = framesToTimecode(2160000, { nominalRate: 25, ntscPullDown: false, dropFrame: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timecode).toEqual({ hours: 0, minutes: 0, seconds: 0, frames: 0 });
  });

  it("refuses a negative or non-integer frame count", () => {
    expect(framesToTimecode(-1, { nominalRate: 25, ntscPullDown: false, dropFrame: false })).toEqual({
      ok: false,
      reason: "frames",
    });
    expect(framesToTimecode(1.5, { nominalRate: 25, ntscPullDown: false, dropFrame: false })).toEqual({
      ok: false,
      reason: "frames",
    });
  });
});

describe("timecodeSeconds", () => {
  it("29.97 DF real time for one hour of LABEL is 3599.996400 s, 3.6 ms short — the residual DF cannot remove", () => {
    const result = timecodeSeconds(107892, { nominalRate: 30, ntscPullDown: true, dropFrame: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.seconds).toBeCloseTo(3599.9964, 4);
  });

  it("29.97 NDF real time for the same label count is 3603.600000 s — the 3.6 s/h pull-down error", () => {
    const result = timecodeSeconds(108000, { nominalRate: 30, ntscPullDown: true, dropFrame: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.seconds).toBeCloseTo(3603.6, 4);
  });

  it("23.976, frame 24: real time 1.001000 s", () => {
    const result = timecodeSeconds(24, { nominalRate: 24, ntscPullDown: true, dropFrame: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.seconds).toBeCloseTo(1.001, 4);
  });

  it("25 fps, frame 15000: real time 600.000000 s exactly, zero drift", () => {
    const result = timecodeSeconds(15000, { nominalRate: 25, ntscPullDown: false, dropFrame: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.seconds).toBeCloseTo(600, 6);
  });
});

describe("timecodeOperation", () => {
  it("wraps the displayed label at 24 hours while the signed frame count stays exact and unbounded", () => {
    // 23:59:59:24 is the last frame of a 25 fps NDF day (frame 2,159,999).
    // Adding one more frame crosses midnight: the label wraps to 00:00:00:00,
    // but the returned frame count is the true, un-wrapped 2,160,000.
    const format = { nominalRate: 25, ntscPullDown: false, dropFrame: false } as const;
    const result = timecodeOperation({
      a: { hours: 23, minutes: 59, seconds: 59, frames: 24 },
      format,
      operandFrames: 1,
      operation: "add",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toBe(2160000);
    expect(result.timecode).toEqual({ hours: 0, minutes: 0, seconds: 0, frames: 0 });
    expect(result.elapsedSeconds).toBeCloseTo(86400, 6);
  });

  it("subtracting past zero carries the sign, and the label is read from the absolute value", () => {
    const format = { nominalRate: 25, ntscPullDown: false, dropFrame: false } as const;
    const result = timecodeOperation({
      a: { hours: 0, minutes: 0, seconds: 0, frames: 0 },
      format,
      operandFrames: 25,
      operation: "subtract",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toBe(-25);
    expect(result.negative).toBe(true);
    expect(result.timecode).toEqual({ hours: 0, minutes: 0, seconds: 1, frames: 0 });
  });

  it("takes the second operand as a label (operandTimecode), converting both to frames before adding", () => {
    // 00:00:59;29 at 29.97 DF is frame 1799 (minute 0 drops nothing).
    // 00:00:00;01 is frame 1 (also minute 0). Sum = 1800, which the earlier
    // framesToTimecode vector shows lands on 00:01:00;02.
    const format = { nominalRate: 30, ntscPullDown: true, dropFrame: true } as const;
    const result = timecodeOperation({
      a: { hours: 0, minutes: 0, seconds: 59, frames: 29 },
      format,
      operandTimecode: { hours: 0, minutes: 0, seconds: 0, frames: 1 },
      operation: "add",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toBe(1800);
    expect(result.timecode).toEqual({ hours: 0, minutes: 1, seconds: 0, frames: 2 });
  });

  it("refuses an operandTimecode that itself names a dropped label that does not exist", () => {
    const format = { nominalRate: 30, ntscPullDown: true, dropFrame: true } as const;
    const result = timecodeOperation({
      a: { hours: 0, minutes: 0, seconds: 0, frames: 0 },
      format,
      operandTimecode: { hours: 0, minutes: 1, seconds: 0, frames: 0 },
      operation: "add",
    });
    expect(result).toEqual({ ok: false, reason: "droppedLabel" });
  });

  it("refuses both an operand timecode and an operand frame count, and neither", () => {
    const format = { nominalRate: 25, ntscPullDown: false, dropFrame: false } as const;
    expect(
      timecodeOperation({
        a: { hours: 0, minutes: 0, seconds: 0, frames: 0 },
        format,
        operandFrames: 1,
        operandTimecode: { hours: 0, minutes: 0, seconds: 0, frames: 1 },
        operation: "add",
      }),
    ).toEqual({ ok: false, reason: "operand" });
    expect(
      timecodeOperation({ a: { hours: 0, minutes: 0, seconds: 0, frames: 0 }, format, operation: "add" }),
    ).toEqual({ ok: false, reason: "operand" });
  });
});

describe("timecodeDrift", () => {
  it("closes the completeness gap the review found: 29.97 NDF label 01:00:00:00 drifts +3.600000 s of real time over the hour", () => {
    // nominalSeconds reads the label's own digits at the nominal rate:
    // 1*3600+0*60+0+0/30 = 3600.000 s. frames = 108000 (nominal counting, no
    // drop-frame accounting — see the timecodeToFrames NDF vector).
    // realSeconds = 108000*1001/30000 = 3603.600 s (secondsPerFrame vector).
    // driftSeconds = realSeconds - nominalSeconds = 3603.600 - 3600.000 = +3.600
    // — the textbook "NDF gains 3.6 s per labelled hour" pull-down error, now a
    // number the tool hands back instead of one every surface re-derives.
    const result = timecodeDrift(
      { hours: 1, minutes: 0, seconds: 0, frames: 0 },
      { nominalRate: 30, ntscPullDown: true, dropFrame: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toBe(108000);
    expect(result.nominalSeconds).toBeCloseTo(3600, 6);
    expect(result.realSeconds).toBeCloseTo(3603.6, 4);
    expect(result.driftSeconds).toBeCloseTo(3.6, 4);
  });

  it("29.97 DF label 01:00:00;00 drifts -0.003600 s (-3.6 ms) — DF corrects the label but not exactly", () => {
    // frames = 107892 (the drop-frame accounting vector: 108000 - 2*(60-6)).
    // nominalSeconds reads the same label digits as the NDF case: 3600.000 s.
    // realSeconds = 107892*1001/30000 = 3599.9964 s.
    // driftSeconds = 3599.9964 - 3600.000 = -0.0036 s = -3.6 ms, the residual
    // drop-frame cannot remove — opposite sign and three orders of magnitude
    // smaller than the NDF case above, which is the whole point of dropping
    // labels in the first place.
    const result = timecodeDrift(
      { hours: 1, minutes: 0, seconds: 0, frames: 0 },
      { nominalRate: 30, ntscPullDown: true, dropFrame: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toBe(107892);
    expect(result.nominalSeconds).toBeCloseTo(3600, 6);
    expect(result.realSeconds).toBeCloseTo(3599.9964, 4);
    expect(result.driftSeconds).toBeCloseTo(-0.0036, 6);
  });

  it("plain 25 fps has zero drift: the label and real time were never different quantities", () => {
    const result = timecodeDrift(
      { hours: 0, minutes: 10, seconds: 0, frames: 0 },
      { nominalRate: 25, ntscPullDown: false, dropFrame: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nominalSeconds).toBeCloseTo(600, 6);
    expect(result.realSeconds).toBeCloseTo(600, 6);
    expect(result.driftSeconds).toBeCloseTo(0, 9);
  });

  it("refuses the same invalid labels timecodeToFrames refuses — a dropped label that does not exist", () => {
    expect(
      timecodeDrift(
        { hours: 0, minutes: 1, seconds: 0, frames: 0 },
        { nominalRate: 30, ntscPullDown: true, dropFrame: true },
      ),
    ).toEqual({ ok: false, reason: "droppedLabel" });
  });
});

describe("timelapsePlan", () => {
  it("interval 5 s, clip 20 s at 25 fps: 500 frames, 00:41:35 shooting, 125.0x speed-up", () => {
    // Nf = 20*25 = 500. T = (500-1)*5 = 2495 s. Speed-up = 5*25 = 125.0x
    const result = timelapsePlan({ interval: 5, timelineFps: 25, clipLength: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frameCount).toBe(500);
    expect(result.shootingDuration).toBeCloseTo(2495, 3);
    expect(result.clipLength).toBeCloseTo(20, 3);
    expect(result.speedUpFactor).toBeCloseTo(125.0, 1);
  });

  it("a 4-hour event at a 10 s interval and 24 fps needs the +1 fencepost: 1441 frames, not 1440", () => {
    // Nf = floor(14400/10) + 1 = 1441. L = 1441/24 = 60.042 s. Speed-up = 240.0x
    const result = timelapsePlan({ interval: 10, timelineFps: 24, shootingDuration: 14400 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frameCount).toBe(1441);
    expect(result.clipLength).toBeCloseTo(60.042, 3);
    expect(result.speedUpFactor).toBeCloseTo(240.0, 1);
  });

  it("adopts floorSnapped for the shooting-duration route: 1.2 s at a 0.1 s interval is 13 frames, not the raw-floor 12", () => {
    // 1.2/0.1 = 11.999999999999998 in double precision (0.1 has no exact binary
    // representation), one ULP below the true 12 whole intervals the 1.2 s
    // window spans. Plain Math.floor would give frames = floor(11.999...) + 1 =
    // 12, one short; floorSnapped recovers the true frames = 12 + 1 = 13.
    const result = timelapsePlan({ interval: 0.1, timelineFps: 25, shootingDuration: 1.2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frameCount).toBe(13);
  });

  it("interval 2 s, 900 frames, 30 fps: 00:29:58 shooting, 30.000 s clip, 60.0x", () => {
    const result = timelapsePlan({ interval: 2, timelineFps: 30, frameCount: 900 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shootingDuration).toBeCloseTo(1798, 3);
    expect(result.clipLength).toBeCloseTo(30, 3);
    expect(result.speedUpFactor).toBeCloseTo(60.0, 1);
  });

  it("a clip length that does not land on a whole frame at 29.97 fps is rounded, and the exact length is reported back", () => {
    // Nf = round(20*30000/1001) = round(599.4006) = 599.
    // clipLength = 599*1001/30000 = 19.986633 s, not a silent 599.4 frames.
    const result = timelapsePlan({ interval: 5, timelineFps: 29.97, clipLength: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frameCount).toBe(599);
    expect(result.clipLength).toBeCloseTo(19.986633, 4);
  });

  it("states t > i as a fact when the shutter exceeds the interval, without recommending anything", () => {
    const result = timelapsePlan({ interval: 5, timelineFps: 25, clipLength: 20, shutter: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shutterOverIntervalRatio).toBeCloseTo(1.2, 3);
  });

  it("refuses a non-positive interval or rate, and zero or more than one of L/T/Nf given", () => {
    expect(timelapsePlan({ interval: 0, timelineFps: 25, clipLength: 20 })).toEqual({
      ok: false,
      reason: "interval",
    });
    expect(timelapsePlan({ interval: 5, timelineFps: 25 })).toEqual({ ok: false, reason: "target" });
    expect(
      timelapsePlan({ interval: 5, timelineFps: 25, clipLength: 20, frameCount: 500 }),
    ).toEqual({ ok: false, reason: "target" });
  });

  it("bounds the timeline rate the same way frameRateConform bounds the same quantity, so an absurd rate cannot slip through", () => {
    expect(timelapsePlan({ interval: 5, timelineFps: 1e9, clipLength: 20 })).toEqual({
      ok: false,
      reason: "timelineFps",
    });
  });

  it("bounds a frame count DERIVED from clip length the same way a typed frame count is bounded to 1..1000000", () => {
    // interval at its minimum, timelineFps and clipLength at their maxima:
    // frames = round(86400*10000) = 864000000, far past the ceiling a typed
    // frameCount would be refused at — the clip-length route must not evade it.
    expect(timelapsePlan({ interval: 0.05, timelineFps: 10000, clipLength: 86400 })).toEqual({
      ok: false,
      reason: "clipLength",
    });
  });

  it("bounds a frame count derived from shooting duration the same way", () => {
    // frames = floor(8640000/0.05) + 1 = 172800001, far past 1000000.
    expect(timelapsePlan({ interval: 0.05, timelineFps: 25, shootingDuration: 8640000 })).toEqual({
      ok: false,
      reason: "shootingDuration",
    });
  });
});

describe("videoStorage", () => {
  it("100 + 1.5 Mbit/s for 60 minutes: 45.675 GB, 42.538 GiB", () => {
    // totalBitrate = 101.5e6 bit/s. bytes = 101500000*3600/8 = 45675000000 B
    // GiB = 45.675e9/1.073741824e9 = 42.538
    const result = videoStorage({ videoBitrateMbps: 100, audioBitrateMbps: 1.5, duration: 3600 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(45675000000);
    expect(result.gigabytes).toBeCloseTo(45.675, 3);
    expect(result.gibibytes).toBeCloseTo(42.538, 3);
  });

  it("a 128 GB card as labelled at 400 Mbit/s records for 00:42:40 (2560 s)", () => {
    const result = videoStorage({ videoBitrateMbps: 400, capacityGb: 128 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recordableSecondsPerCard).toBeCloseTo(2560, 3);
  });

  it("64.000 GiB at 250 Mbit/s plays for 2199.023 s (00:36:39.023)", () => {
    const result = videoStorage({ videoBitrateMbps: 250, size: { value: 64, unit: "GiB" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duration).toBeCloseTo(2199.023, 2);
  });

  it("multiplies recordable time by the card count", () => {
    const result = videoStorage({ videoBitrateMbps: 400, capacityGb: 128, cardCount: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recordableSecondsTotal).toBeCloseTo(2560 * 3, 1);
  });

  it("refuses a non-positive bitrate, an out-of-range card count, and zero or more than one of duration/size/capacity", () => {
    expect(videoStorage({ videoBitrateMbps: 0, duration: 60 })).toEqual({
      ok: false,
      reason: "videoBitrateMbps",
    });
    expect(videoStorage({ videoBitrateMbps: 100, duration: 60, cardCount: 0 })).toEqual({
      ok: false,
      reason: "cardCount",
    });
    expect(videoStorage({ videoBitrateMbps: 100 })).toEqual({ ok: false, reason: "target" });
    expect(
      videoStorage({ videoBitrateMbps: 100, duration: 60, capacityGb: 128 }),
    ).toEqual({ ok: false, reason: "target" });
  });
});

describe("parseShutterTime", () => {
  it("reads the engraved 1/x form and plain seconds alike", () => {
    const fraction = parseShutterTime("1/125");
    expect(fraction.ok).toBe(true);
    if (fraction.ok) expect(fraction.seconds).toBeCloseTo(0.008, 6);

    const seconds = parseShutterTime("0.02");
    expect(seconds.ok).toBe(true);
    if (seconds.ok) expect(seconds.seconds).toBeCloseTo(0.02, 6);
  });

  it("refuses an empty field and a non-positive numerator or denominator", () => {
    expect(parseShutterTime("")).toEqual({ ok: false, reason: "shutter" });
    expect(parseShutterTime("1/0")).toEqual({ ok: false, reason: "shutter" });
    expect(parseShutterTime("-1/125")).toEqual({ ok: false, reason: "shutter" });
  });
});

describe("exactFrameRate", () => {
  it("recognises the three NTSC-derived labels and leaves an exact rational idempotent", () => {
    expect(exactFrameRate(29.97)).toBeCloseTo(30000 / 1001, 9);
    expect(exactFrameRate(30000 / 1001)).toBeCloseTo(30000 / 1001, 9);
    expect(exactFrameRate(59.94)).toBeCloseTo(60000 / 1001, 9);
  });

  it("leaves an ordinary integer rate untouched — 24 is not close enough to 23.976 to be relabelled", () => {
    expect(exactFrameRate(24)).toBe(24);
  });
});
