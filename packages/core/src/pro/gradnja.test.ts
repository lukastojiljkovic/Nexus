import { describe, expect, it } from "vitest";

import {
  barSpacing,
  beamCheck,
  concreteTakeoff,
  convertAngle,
  degreesToDms,
  dmsToDegrees,
  drawingScaleArea,
  drawingScaleFit,
  drawingScaleLength,
  earthworkVolumes,
  levelRun,
  rebarFromLength,
  rebarFromMass,
  rebarMassPerMetre,
  roofPitch,
  roomSurfaces,
  slopeGrade,
  squareCheck,
  stairFlight,
  stairRiserCandidates,
  surveyForward,
  surveyInverse,
  tileCount,
  trenchVolume,
  wallAssembly,
} from "./gradnja.js";

/**
 * Every expectation here was worked by hand from the inputs before the code
 * existed, and the arithmetic is written into the test names and comments so a
 * reader can check it without running anything. A test whose expected value was
 * copied out of a first run pins the bug as firmly as the behaviour.
 */

describe("stairFlight", () => {
  it("divides the storey height exactly — 2850/17 = 167.647… mm, never a rounded 168", () => {
    const flight = stairFlight({ rise: 2850, risers: 17, going: 280, top: "flush" });
    expect(flight.ok).toBe(true);
    if (!flight.ok) return;
    // 2850/17 = 167.6470588… — and 17 × that is exactly 2850, which a rounded
    // 168 would miss by 6 mm spread onto whichever step got the remainder.
    expect(flight.riser).toBeCloseTo(167.647059, 6);
    expect(flight.riser * 17).toBeCloseTo(2850, 9);
    // Flush with the upper floor: the last riser lands on it and has no tread.
    expect(flight.goings).toBe(16);
    expect(flight.run).toBe(4480); // 16 × 280
    // atan(167.6470588/280) = atan(0.59873949) = 30.9106°
    expect(flight.pitch).toBeCloseTo(30.9106, 4);
    // 2r + g = 335.294118 + 280
    expect(flight.blondel).toBeCloseTo(615.294118, 6);
  });

  it("counts one more going when the flight arrives at a landing in the plane of the last riser", () => {
    const flush = stairFlight({ rise: 3000, risers: 18, going: 300, top: "flush" });
    const landing = stairFlight({ rise: 3000, risers: 18, going: 300, top: "landing" });
    expect(flush.ok && landing.ok).toBe(true);
    if (!flush.ok || !landing.ok) return;
    // The riser is the same — the top condition changes the FOOTPRINT and
    // nothing else, which is the whole reason it is an input.
    expect(flush.riser).toBeCloseTo(166.666667, 6);
    expect(landing.riser).toBeCloseTo(166.666667, 6);
    expect(flush.goings).toBe(17);
    expect(landing.goings).toBe(18);
    expect(flush.run).toBe(5100); // 17 × 300
    expect(landing.run).toBe(5400); // 18 × 300
    // atan(166.6666667/300) = atan(0.55555556) = 29.0546°
    expect(flush.pitch).toBeCloseTo(29.0546, 4);
    expect(flush.blondel).toBeCloseTo(633.333333, 6);
  });

  it("reports the ratio against the user's own limits, and nothing else about them", () => {
    const flight = stairFlight({
      rise: 2850,
      risers: 17,
      going: 280,
      top: "flush",
      riserLimit: 175,
      goingLimit: 280,
    });
    expect(flight.ok).toBe(true);
    if (!flight.ok) return;
    // 167.6470588 / 175 = 0.95798319
    expect(flight.riserRatio).toBeCloseTo(0.957983, 6);
    // Exactly at the limit is exactly 1 — and the result says 1, not „ok".
    expect(flight.goingRatio).toBe(1);
  });

  it("draws no comparison at all when no limit was typed — an absent rule is not a satisfied one", () => {
    const flight = stairFlight({ rise: 2850, risers: 17, going: 280, top: "flush" });
    expect(flight.ok).toBe(true);
    if (!flight.ok) return;
    expect(flight.riserRatio).toBeUndefined();
    expect(flight.goingRatio).toBeUndefined();
  });

  it("treats a non-positive limit as no limit rather than dividing by it", () => {
    const flight = stairFlight({
      rise: 2850,
      risers: 17,
      going: 280,
      top: "flush",
      riserLimit: 0,
      goingLimit: -1,
    });
    expect(flight.ok).toBe(true);
    if (!flight.ok) return;
    expect(flight.riserRatio).toBeUndefined();
    expect(flight.goingRatio).toBeUndefined();
  });

  it("refuses rather than repairs: a non-positive height, a fractional or out-of-range riser count, a zero going", () => {
    expect(stairFlight({ rise: 0, risers: 17, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "rise",
    });
    expect(stairFlight({ rise: -2850, risers: 17, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "rise",
    });
    expect(stairFlight({ rise: 2850, risers: 16.5, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "risers",
    });
    expect(stairFlight({ rise: 2850, risers: 0, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "risers",
    });
    expect(stairFlight({ rise: 2850, risers: 61, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "risers",
    });
    expect(stairFlight({ rise: 2850, risers: 17, going: 0, top: "flush" })).toEqual({
      ok: false,
      reason: "going",
    });
    expect(stairFlight({ rise: Number.NaN, risers: 17, going: 280, top: "flush" })).toEqual({
      ok: false,
      reason: "rise",
    });
  });

  it("keeps a single-riser flight representable — one step out of a doorway is a stair", () => {
    const flight = stairFlight({ rise: 180, risers: 1, going: 300, top: "flush" });
    expect(flight.ok).toBe(true);
    if (!flight.ok) return;
    expect(flight.riser).toBe(180);
    // Flush: the one riser lands on the floor above, so there is no tread and
    // no run. A `goings` of 0 is the honest answer, not a defect.
    expect(flight.goings).toBe(0);
    expect(flight.run).toBe(0);
  });
});

describe("stairRiserCandidates", () => {
  it("offers the rounded count and both neighbours, so the choice stays the designer's", () => {
    // 2850/170 = 16.7647 → nearest 17, neighbours 16 and 18.
    const result = stairRiserCandidates(2850, 170);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates.map((c) => c.risers)).toEqual([16, 17, 18]);
    expect(result.candidates[0]?.riser).toBeCloseTo(178.125, 6); // 2850/16
    expect(result.candidates[1]?.riser).toBeCloseTo(167.647059, 6); // 2850/17
    expect(result.candidates[2]?.riser).toBeCloseTo(158.333333, 6); // 2850/18
  });

  it("drops a neighbour that falls outside the representable range rather than offering an impossible flight", () => {
    // 2850/2900 = 0.98 → nearest 1, so the lower neighbour would be 0.
    const result = stairRiserCandidates(2850, 2900);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates.map((c) => c.risers)).toEqual([1, 2]);
  });

  it("refuses a non-positive height or desired riser", () => {
    expect(stairRiserCandidates(0, 170)).toEqual({ ok: false, reason: "rise" });
    expect(stairRiserCandidates(2850, 0)).toEqual({ ok: false, reason: "desiredRiser" });
  });
});

describe("stairFlight — the flight as it will be built", () => {
  const flight = (over: Partial<Parameters<typeof stairFlight>[0]> = {}) =>
    stairFlight({ rise: 2850, risers: 17, going: 280, top: "flush", ...over });

  it("rounds the riser to whole millimetres by default and names what the rounding costs", () => {
    // 2850 / 17 = 167.647058823…  → 168 mm on the rule.
    // 17 × 168 = 2856, which is 6 mm ABOVE the 2850 asked for, so the flight
    // overshoots the upper floor and one step has to come down by 6 mm.
    const result = flight();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rounded.step).toBe(1);
    expect(result.rounded.riser).toBe(168);
    expect(result.rounded.rise).toBe(2856);
    expect(result.rounded.remainder).toBe(-6);
    // The exact riser is untouched — the rounded one is a second answer, not a
    // replacement for it.
    expect(result.riser).toBeCloseTo(167.647059, 6);
  });

  it("reports nothing to place when the division comes out even", () => {
    // 2700 / 15 = 180 exactly; 15 × 180 = 2700; remainder 0.
    const result = flight({ rise: 2700, risers: 15 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rounded.riser).toBe(180);
    expect(result.rounded.rise).toBe(2700);
    expect(result.rounded.remainder).toBe(0);
  });

  it("rounds to a coarser step when the setting-out is coarser, and the cost grows with it", () => {
    // 167.647058823… / 5 = 33.5294… → 34 → 34 × 5 = 170 mm.
    // 17 × 170 = 2890, i.e. 40 mm over 2850. Five times the step, roughly seven
    // times the remainder — which is the whole reason the step is an input.
    const result = flight({ roundTo: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rounded.riser).toBe(170);
    expect(result.rounded.rise).toBe(2890);
    expect(result.rounded.remainder).toBe(-40);
  });

  it("takes a fractional step, and leaves nothing over when it divides evenly", () => {
    // 2600 / 16 = 162.5; 162.5 / 2.5 = 65 exactly → 65 × 2.5 = 162.5.
    // 16 × 162.5 = 2600. Every value here is an exact binary fraction, so this
    // is a real zero rather than one that survived a tolerance.
    const result = flight({ rise: 2600, risers: 16, roundTo: 2.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rounded.riser).toBe(162.5);
    expect(result.rounded.remainder).toBe(0);
  });

  it("rounds a riser that lands exactly halfway upward, as a rule does", () => {
    // 3000 / 16 = 187.5 exactly → 188. 16 × 188 = 3008, i.e. 8 mm over.
    const result = flight({ rise: 3000, risers: 16 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rounded.riser).toBe(188);
    expect(result.rounded.remainder).toBe(-8);
  });

  it("refuses a step that is not a length", () => {
    expect(flight({ roundTo: 0 })).toEqual({ ok: false, reason: "roundTo" });
    expect(flight({ roundTo: -1 })).toEqual({ ok: false, reason: "roundTo" });
    expect(flight({ roundTo: Number.POSITIVE_INFINITY })).toEqual({ ok: false, reason: "roundTo" });
  });
});

/* ---------------------------------------------------------------------------
 * angle-units
 * ------------------------------------------------------------------------ */

describe("dmsToDegrees", () => {
  it("45°17′32″ → 45 + 17/60 + 32/3600 = 45.292222°", () => {
    // 17/60 = 0.2833333…, 32/3600 = 0.0088889…, sum = 45.2922222…
    const result = dmsToDegrees({ negative: false, degrees: 45, minutes: 17, seconds: 32 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degrees).toBeCloseTo(45.292222, 6);
  });

  it("carries the sign on the WHOLE reading — −1°30′ is −1.5°, not −0.5°", () => {
    const result = dmsToDegrees({ negative: true, degrees: 1, minutes: 30, seconds: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degrees).toBeCloseTo(-1.5, 9);
  });

  it("refuses a minute or second at or above 60 rather than reading it as a carry", () => {
    expect(dmsToDegrees({ negative: false, degrees: 45, minutes: 60, seconds: 0 })).toEqual({
      ok: false,
      reason: "minutes",
    });
    expect(dmsToDegrees({ negative: false, degrees: 45, minutes: 0, seconds: 60 })).toEqual({
      ok: false,
      reason: "seconds",
    });
    expect(dmsToDegrees({ negative: false, degrees: -1, minutes: 0, seconds: 0 })).toEqual({
      ok: false,
      reason: "degrees",
    });
  });
});

describe("degreesToDms", () => {
  it("111.111030° → 111° 6′ 39.708″", () => {
    // whole = 111; frac = 0.111030 × 60 = 6.6618′ → 6′; 0.6618 × 60 = 39.708″
    const result = degreesToDms(111.11103);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.negative).toBe(false);
    expect(result.degrees).toBe(111);
    expect(result.minutes).toBe(6);
    expect(result.seconds).toBeCloseTo(39.708, 3);
  });

  it("carries a rounded 60.000″ into the minute, and a rounded 60′ into the degree", () => {
    // 39.99999999°: whole=39, (0.99999999×60)=59.9999994′ → minutes=59,
    // seconds=(0.9999994×60)=59.999964″ → rounds to 60.000″ at 3 decimals,
    // which carries: seconds→0, minutes→60→carries again: minutes→0, degrees→40.
    // Without the carry this would print the impossible „39° 59′ 60.000″".
    const result = degreesToDms(39.99999999);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degrees).toBe(40);
    expect(result.minutes).toBe(0);
    expect(result.seconds).toBeCloseTo(0, 3);
  });

  it("refuses a non-finite degree value", () => {
    expect(degreesToDms(Number.NaN)).toEqual({ ok: false, reason: "degrees" });
  });
});

describe("convertAngle", () => {
  it("45°17′32″ in all remaining notations: 50.3247 gon, 0.790498403 rad", () => {
    // Decimal degrees = 45.292222 (see dmsToDegrees above).
    // gon = 45.292222 × 10/9 = 50.324691… → 4-decimal display policy: 50.3247.
    // rad = 45.292222 × π/180 = 0.790498403.
    const result = convertAngle({
      unit: "dms",
      dms: { negative: false, degrees: 45, minutes: 17, seconds: 32 },
      normalize: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degrees).toBeCloseTo(45.292222, 6);
    expect(result.gon).toBeCloseTo(50.3247, 4);
    expect(result.radians).toBeCloseTo(0.790498403, 6);
  });

  it("123.4567 gon → 111° 6′ 39.708″, 1.939253 rad", () => {
    const result = convertAngle({ unit: "gon", value: 123.4567, normalize: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degrees).toBeCloseTo(111.11103, 5);
    expect(result.dms).toEqual({ negative: false, degrees: 111, minutes: 6, seconds: expect.any(Number) });
    expect(result.dms.seconds).toBeCloseTo(39.708, 3);
    expect(result.radians).toBeCloseTo(1.939253, 6);
  });

  it("folds a negative reading by FLOOR, and reports the opposite direction", () => {
    // −1°30′00″ = −1.500000° = −1.6666667 gon. Folded by floor (not truncated):
    // 400 − 1.6666667 = 398.3333333 gon.
    const result = convertAngle({
      unit: "dms",
      dms: { negative: true, degrees: 1, minutes: 30, seconds: 0 },
      normalize: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gon).toBeCloseTo(398.3333333, 5);
    // The opposite of 398.3333 gon is +200 gon folded: 198.3333 gon.
    expect(result.oppositeGon).toBeCloseTo(198.3333333, 5);
  });

  it("leaves an unnormalized angle exactly as given — 720° stays 720°, not folded to 0°", () => {
    const result = convertAngle({ unit: "deg", value: 720, normalize: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degrees).toBe(720);
    // The folded value is still reported, alongside the raw one.
    expect(result.normalizedDegrees).toBeCloseTo(0, 9);
  });

  it("no longer offers a mil notation — the tool is deg/gon/rad/dms only", () => {
    const result = convertAngle({ unit: "gon", value: 100, normalize: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).not.toHaveProperty("mil");
  });

  it("refuses a non-finite value and an invalid DMS reading", () => {
    expect(convertAngle({ unit: "deg", value: Number.NaN, normalize: true })).toEqual({
      ok: false,
      reason: "value",
    });
    expect(
      convertAngle({
        unit: "dms",
        dms: { negative: false, degrees: 10, minutes: 61, seconds: 0 },
        normalize: true,
      }),
    ).toEqual({ ok: false, reason: "minutes" });
  });
});

/* ---------------------------------------------------------------------------
 * bar-spacing
 * ------------------------------------------------------------------------ */

describe("barSpacing", () => {
  it("slab bars, 34 pieces on both ends — the count rounds up, then the spacing divides out exactly", () => {
    // U = 5000 − 50 − 50 = 4900; k = ceil(4900/150) = ceil(32.6667) = 33; n = 34.
    // s = 4900/33 = 148.4848 mm; s/s_max = 148.4848/150 = 0.9899.
    // Last position = 50 + 33×148.4848 = 50 + 4900 = 4950 = L − e2.
    const result = barSpacing({
      length: 5000,
      startCover: 50,
      endCover: 50,
      layout: "ends",
      maxSpacing: 150,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(34);
    expect(result.spaces).toBe(33);
    expect(result.spacing).toBeCloseTo(148.484848, 6);
    expect(result.spacingRatio).toBeCloseTo(0.9899, 4);
    expect(result.positions[33]).toBeCloseTo(4950, 6);
  });

  it("rafters between two walls, 7 pieces centred in the field", () => {
    // U = 4200; n = ceil(4200/625) = ceil(6.72) = 7; s = 4200/7 = 600.0 mm.
    // Positions = (i+0.5)×600 for i=0..6: 300, 900, …, 3900; last + 300 = 4200.
    const result = barSpacing({
      length: 4200,
      startCover: 0,
      endCover: 0,
      layout: "field",
      maxSpacing: 625,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(7);
    expect(result.spacing).toBe(600);
    expect(result.spacingRatio).toBeCloseTo(0.96, 6);
    expect(result.positions).toEqual([300, 900, 1500, 2100, 2700, 3300, 3900]);
  });

  it("guard-rail infill: a clear-gap limit and a piece width give a picket count with n+1 gaps", () => {
    // U = 2000, g_max = 100, w = 40.
    // n = ceil((2000−100)/(40+100)) = ceil(1900/140) = ceil(13.5714) = 14.
    // spacing (clear gap) = (2000 − 14×40)/15 = (2000−560)/15 = 1440/15 = 96.0 mm.
    // axisPitch = 96 + 40 = 136.0 = (2000+40)/15 = 2040/15 = 136.0 — the two
    // forms of the same number the correction calls out.
    const result = barSpacing({
      length: 2000,
      startCover: 0,
      endCover: 0,
      layout: "field",
      pieceWidth: 40,
      maxGap: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(14);
    expect(result.spaces).toBe(15);
    expect(result.spacing).toBeCloseTo(96, 9);
    expect(result.axisPitch).toBeCloseTo(136, 9);
    expect(result.spacingRatio).toBeCloseTo(0.96, 6);
    // First picket centre = 0 + 96 + 20 = 116; last = 116 + 13×136 = 1884.
    expect(result.positions[0]).toBeCloseTo(116, 6);
    expect(result.positions[13]).toBeCloseTo(1884, 6);
  });

  it("reports the axis pitch for an ordinary count too, once a piece width is given", () => {
    // Reuse the 34-piece slab vector, spacing 148.484848, piece 12 mm wide.
    const result = barSpacing({
      length: 5000,
      startCover: 50,
      endCover: 50,
      layout: "ends",
      maxSpacing: 150,
      pieceWidth: 12,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.axisPitch).toBeCloseTo(160.484848, 6);
  });

  it("refuses rather than divides by zero: a zero maximum spacing, and a single piece in the ends layout", () => {
    expect(
      barSpacing({ length: 5000, startCover: 0, endCover: 0, layout: "ends", maxSpacing: 0 }),
    ).toEqual({ ok: false, reason: "maxSpacing" });
    expect(
      barSpacing({ length: 5000, startCover: 0, endCover: 0, layout: "ends", count: 1 }),
    ).toEqual({ ok: false, reason: "count" });
  });

  it("refuses a clear-gap request with no piece width, and one that admits not even one piece", () => {
    expect(
      barSpacing({ length: 2000, startCover: 0, endCover: 0, layout: "field", maxGap: 100 }),
    ).toEqual({ ok: false, reason: "pieceWidth" });
    // A gap bigger than the whole run: ceil((100−200)/(40+200)) = ceil(−0.4166) = 0.
    expect(
      barSpacing({
        length: 100,
        startCover: 0,
        endCover: 0,
        layout: "field",
        pieceWidth: 40,
        maxGap: 200,
      }),
    ).toEqual({ ok: false, reason: "maxGap" });
  });

  it("refuses a maxGap request that also carries a count or a maxSpacing, rather than silently ignoring either", () => {
    // `count` and `maxSpacing` belong to the `ends`/`field` layouts and are
    // never read on the `maxGap` path; a value left in either after switching
    // to `maxGap` must be refused by name, exactly as a spare `force` left
    // over from a beam-scheme switch is refused in `beamCheck`.
    expect(
      barSpacing({
        length: 2000,
        startCover: 0,
        endCover: 0,
        layout: "field",
        pieceWidth: 40,
        maxGap: 100,
        count: 14,
      }),
    ).toEqual({ ok: false, reason: "count" });
    expect(
      barSpacing({
        length: 2000,
        startCover: 0,
        endCover: 0,
        layout: "field",
        pieceWidth: 40,
        maxGap: 100,
        maxSpacing: 100,
      }),
    ).toEqual({ ok: false, reason: "maxSpacing" });
  });

  it("refuses when the covers alone consume the whole length — usableLength <= 0", () => {
    expect(
      barSpacing({ length: 100, startCover: 60, endCover: 60, layout: "field", maxSpacing: 50 }),
    ).toEqual({ ok: false, reason: "usableLength" });
  });

  it("refuses a maxGap arrangement the ceiling makes impossible, rather than a negative clear gap", () => {
    // U = 390, w = 100, g_max = 20. n = ceil((390−20)/(100+20)) = ceil(3.0833) = 4.
    // 4 pickets of 100 mm already total 400 mm, more than the 390 mm run — no
    // clear gap remains, let alone one at or under 20 mm. n = 3 gives
    // (390−300)/4 = 22.5 mm, itself already over the maximum: no arrangement
    // of 100 mm pickets satisfies a 20 mm clear gap over 390 mm, so the tool
    // refuses instead of returning spacing = (390−400)/5 = −2 mm.
    expect(
      barSpacing({
        length: 390,
        startCover: 0,
        endCover: 0,
        layout: "field",
        pieceWidth: 100,
        maxGap: 20,
      }),
    ).toEqual({ ok: false, reason: "maxGap" });
  });

  it("(life-safety) reports only the ratio against a user's own limit, and nothing when they gave none", () => {
    const withLimit = barSpacing({
      length: 4200,
      startCover: 0,
      endCover: 0,
      layout: "field",
      maxSpacing: 625,
    });
    expect(withLimit.ok && withLimit.spacingRatio).toBeCloseTo(0.96, 6);
    const withCount = barSpacing({
      length: 4200,
      startCover: 0,
      endCover: 0,
      layout: "field",
      count: 7,
    });
    expect(withCount.ok).toBe(true);
    if (!withCount.ok) return;
    expect(withCount.spacingRatio).toBeUndefined();
    expect(withCount).not.toHaveProperty("compliant");
    expect(withCount).not.toHaveProperty("passes");
  });
});

/* ---------------------------------------------------------------------------
 * beam-check
 * ------------------------------------------------------------------------ */

describe("beamCheck", () => {
  it("simple beam, uniformly distributed load: 25 kN reactions, 31.25 kNm, 7.7505 mm, L/f = 645", () => {
    // q=10 kN/m, L=5 m, E=210 GPa, I=5000 cm^4.
    // R = 10×5/2 = 25.000 kN; M = 10×5²/8 = 31.2500 kNm.
    // f = 5×10000×5⁴/(384×2.1e11×5e-5) = 31,250,000/4.032e9 = 0.00775050 m
    //   = 7.7505 mm; L/f = 5/0.0077505 = 645.12 → floor 645.
    const result = beamCheck({
      scheme: "simple-udl",
      span: 5,
      load: 10,
      modulus: 210,
      inertia: 5000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reaction).toBeCloseTo(25, 3);
    expect(result.shear).toBeCloseTo(25, 3);
    expect(result.maxMoment).toBeCloseTo(31.25, 4);
    expect(result.fixingMoment).toBeUndefined(); // no fixing on a simple beam
    expect(result.deflection).toBeCloseTo(7.7505, 3);
    expect(result.spanOverDeflection).toBe(645);
    expect(result.stress).toBeUndefined(); // no W given or derivable
  });

  it("timber cantilever, point load at the tip, rectangular section: I and W derived, fixing moment named", () => {
    // P=2 kN, L=1.20 m, b=100 mm, h=200 mm, E=11 GPa.
    // I = 0.1×0.2³/12 = 6.666667e-5 m^4 = 6666.67 cm^4.
    // W = 0.1×0.2²/6 = 6.666667e-4 m^3 = 666.67 cm^3.
    // R = 2.000 kN; M = 2×1.20 = 2.4000 kNm — and the fixing moment IS that number.
    // σ = 2400/6.666667e-4 = 3.600e6 Pa = 3.600 MPa.
    // f = 2000×1.728/(3×1.1e10×6.666667e-5) = 3456/2.2e6 = 0.00157091 m = 1.5709 mm.
    // L/f = 1.20/0.00157091 = 763.87 → floor 763.
    const result = beamCheck({
      scheme: "cantilever-point",
      span: 1.2,
      force: 2,
      modulus: 11,
      section: { width: 100, height: 200 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inertia).toBeCloseTo(6666.67, 1);
    expect(result.sectionModulus).toBeCloseTo(666.67, 1);
    expect(result.reaction).toBeCloseTo(2, 3);
    expect(result.shear).toBeCloseTo(2, 3);
    expect(result.maxMoment).toBeCloseTo(2.4, 4);
    expect(result.fixingMoment).toBeCloseTo(2.4, 4);
    expect(result.stress).toBeCloseTo(3.6, 3);
    expect(result.deflection).toBeCloseTo(1.5709, 3);
    expect(result.spanOverDeflection).toBe(763);
  });

  it("cantilever, uniformly distributed load: 15 kN reaction, 22.5000 kNm fixing moment, 3.164063 mm, L/f = 948", () => {
    // q=5 kN/m, L=3 m, E=200 GPa, I=8000 cm^4.
    // R = q×L = 5×3 = 15.000 kN; M = q×L²/2 = 5×9/2 = 22.5000 kNm — and the
    // fixing moment IS that number, unlike on a simple beam.
    // f = q×L⁴/(8×E×I) = 5000×81/(8×2.0e11×8e-5) = 405,000/1.28e8
    //   = 0.0031640625 m = 3.164063 mm; L/f = 3/0.0031640625 = 948.148… → 948.
    const result = beamCheck({
      scheme: "cantilever-udl",
      span: 3,
      load: 5,
      modulus: 200,
      inertia: 8000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reaction).toBeCloseTo(15, 6);
    expect(result.shear).toBeCloseTo(15, 6);
    expect(result.maxMoment).toBeCloseTo(22.5, 6);
    expect(result.fixingMoment).toBeCloseTo(22.5, 6);
    expect(result.deflection).toBeCloseTo(3.164063, 5);
    expect(result.spanOverDeflection).toBe(948);
  });

  it("simple beam, point load, the 1/48 deflection coefficient: reaction 6 kN, moment 12.0000 kNm, 1.269841 mm, L/f = 3150 exactly", () => {
    // P=12 kN, L=4 m, E=210 GPa, I=6000 cm^4.
    // R = P/2 = 6.000 kN; M = P×L/4 = 12×4/4 = 12.0000 kNm; no fixing — a
    // simple beam has no fixed support.
    // f = P×L³/(48×E×I) = 12000×64/(48×2.1e11×6e-5) = 768,000/6.048e8
    //   = 0.00126984127 m = 1.269841 mm.
    // L/f = 48×E×I/(P×L²) = 604,800,000/192,000 = 3150.00 exactly.
    const result = beamCheck({
      scheme: "simple-point",
      span: 4,
      force: 12,
      modulus: 210,
      inertia: 6000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reaction).toBeCloseTo(6, 6);
    expect(result.maxMoment).toBeCloseTo(12, 6);
    expect(result.fixingMoment).toBeUndefined();
    expect(result.deflection).toBeCloseTo(1.269841, 5);
    expect(result.spanOverDeflection).toBe(3150);
  });

  it("(life-safety) the deflection ratio is the user's OWN limit divided by the computed L/f, inverted so both ratios point the same way", () => {
    // Same simple-udl vector as the very first test in this block: the exact
    // (unfloored) L/f is 5 / (31,250,000/4,032,000,000) = 5×4,032,000,000 /
    // 31,250,000 = 645.12 exactly — the .12 is exactly what the floor to 645
    // above discards. With a user limit of 500: deflectionRatio =
    // 500/645.12 = 0.775050.
    const result = beamCheck({
      scheme: "simple-udl",
      span: 5,
      load: 10,
      modulus: 210,
      inertia: 5000,
      deflectionRatioLimit: 500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spanOverDeflection).toBe(645);
    expect(result.deflectionRatio).toBeCloseTo(0.77505, 4);
  });

  it("reports no deflection without E or I, and no stress without W — the moment stands on its own", () => {
    const result = beamCheck({ scheme: "simple-point", span: 4, force: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reaction).toBeCloseTo(5, 6); // 10/2
    expect(result.maxMoment).toBeCloseTo(10, 6); // 10×4/4
    expect(result.deflection).toBeUndefined();
    expect(result.stress).toBeUndefined();
    expect(result.spanOverDeflection).toBeUndefined();
  });

  it("does not show a span/deflection ratio for a beam carrying no load — f = 0", () => {
    const result = beamCheck({ scheme: "simple-udl", span: 5, load: 0, modulus: 210, inertia: 5000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deflection).toBe(0);
    expect(result.spanOverDeflection).toBeUndefined();
  });

  it("refuses each malformed input by its own name", () => {
    expect(beamCheck({ scheme: "simple-udl", span: 0, load: 10 })).toEqual({
      ok: false,
      reason: "span",
    });
    expect(beamCheck({ scheme: "simple-udl", span: 5 })).toEqual({ ok: false, reason: "load" });
    expect(beamCheck({ scheme: "simple-point", span: 5 })).toEqual({ ok: false, reason: "force" });
    expect(beamCheck({ scheme: "simple-udl", span: 5, load: 10, modulus: -1 })).toEqual({
      ok: false,
      reason: "modulus",
    });
    expect(beamCheck({ scheme: "simple-udl", span: 5, load: 10, inertia: 0 })).toEqual({
      ok: false,
      reason: "inertia",
    });
    expect(
      beamCheck({ scheme: "simple-udl", span: 5, load: 10, section: { width: 0, height: 200 } }),
    ).toEqual({ ok: false, reason: "section" });
  });

  it("refuses a value left in the field the chosen scheme does not consume", () => {
    // A UDL scheme reads `load`; a leftover `force` from before a scheme
    // switch must not be silently dropped — the beam it describes is not the
    // one on screen.
    expect(
      beamCheck({ scheme: "simple-udl", span: 5, load: 10, force: 99 }),
    ).toEqual({ ok: false, reason: "force" });
    expect(
      beamCheck({ scheme: "simple-point", span: 5, force: 10, load: 99 }),
    ).toEqual({ ok: false, reason: "load" });
  });

  it("(life-safety) never returns a verdict field alongside the numbers", () => {
    const result = beamCheck({
      scheme: "simple-udl",
      span: 5,
      load: 10,
      modulus: 210,
      inertia: 5000,
      stressLimit: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).not.toHaveProperty("passes");
    expect(result).not.toHaveProperty("compliant");
    expect(result).not.toHaveProperty("status");
  });

  it("(life-safety) reports a ratio only with a user limit, undefined without one", () => {
    const withLimit = beamCheck({
      scheme: "simple-udl",
      span: 5,
      load: 10,
      modulus: 210,
      inertia: 5000,
      section: undefined,
      sectionModulus: 20000,
      stressLimit: 10,
    });
    expect(withLimit.ok).toBe(true);
    if (!withLimit.ok) return;
    // M = 31.25 kNm = 31,250,000 Nmm... in SI: M=31250 Nm, W=20000cm^3=0.02 m^3.
    // σ = 31250/0.02 = 1,562,500 Pa = 1.5625 MPa; ratio = 1.5625/10 = 0.15625.
    expect(withLimit.stress).toBeCloseTo(1.5625, 4);
    expect(withLimit.stressRatio).toBeCloseTo(0.15625, 5);

    const withoutLimit = beamCheck({
      scheme: "simple-udl",
      span: 5,
      load: 10,
      modulus: 210,
      inertia: 5000,
      sectionModulus: 20000,
    });
    expect(withoutLimit.ok && withoutLimit.stressRatio).toBeUndefined();
  });

  // Every input below is a positive finite number and passes every per-field
  // guard. What leaves the range of a double is the PRODUCT: b·h³/12 and E·I are
  // where a beam stops being a beam, and until this was checked the tool answered
  // `ok: true` with a stress and a deflection of `Infinity`.
  it("refuses a section or a stiffness whose product underflows, naming the typed field", () => {
    // A 1e-100 mm rectangle: I = 1e-103 · 1e-309 / 12 rounds to exactly 0, so the
    // deflection would be (5·q·L⁴)/(384·E·0) — and the user typed `section`.
    expect(
      beamCheck({
        scheme: "simple-udl",
        span: 5,
        load: 10,
        modulus: 210,
        section: { width: 1e-100, height: 1e-100 },
      }),
    ).toEqual({ ok: false, reason: "section" });
    // The same underflow from a directly typed inertia names `inertia` instead:
    // 1e-320 is a denormal, positive and finite, and 1e-320 · 1e-8 is 0.
    expect(
      beamCheck({ scheme: "simple-udl", span: 5, load: 10, modulus: 210, inertia: 1e-320 }),
    ).toEqual({ ok: false, reason: "inertia" });
    // And E·I from the other end: a modulus of 1e300 GPa is 1e309 Pa, i.e.
    // Infinity, so the stiffness is Infinity and the deflection would be 0.
    expect(
      beamCheck({ scheme: "simple-udl", span: 5, load: 10, modulus: 1e300, inertia: 5000 }),
    ).toEqual({ ok: false, reason: "modulus" });
    // A section modulus that underflows is refused before it can divide.
    expect(
      beamCheck({ scheme: "simple-udl", span: 5, load: 10, sectionModulus: 1e-320 }),
    ).toEqual({ ok: false, reason: "sectionModulus" });
  });
});

/* ---------------------------------------------------------------------------
 * concrete-takeoff
 * ------------------------------------------------------------------------ */

describe("concreteTakeoff", () => {
  it("slab 6.00×4.50×0.16 m: 4.3200 m³, 30.360 m² of formwork", () => {
    // V = 6.00×4.50×0.16 = 4.3200 m³.
    // Formwork = 6.00×4.50 + 2×(6.00+4.50)×0.16 = 27.000 + 3.360 = 30.360 m².
    const result = concreteTakeoff({
      element: { kind: "slab", a: 6, b: 4.5, d: 0.16 },
      pieces: 1,
      waste: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netVolume).toBeCloseTo(4.32, 4);
    expect(result.formwork).toBeCloseTo(30.36, 3);
  });

  it("12 columns 0.30×0.30×2.80 m, 5% waste, a 6 m³ mixer, 2500 kg/m³: 1 batch, 7.938 t", () => {
    // V = 0.30×0.30×2.80×12 = 3.0240 m³; with waste ×1.05 = 3.1752 m³.
    // Formwork = 2×(0.30+0.30)×2.80×12 = 40.320 m²; batches = ceil(3.1752/6) = 1.
    // Mass = 3.1752×2500/1000 = 7.938 t.
    const result = concreteTakeoff({
      element: { kind: "column", a: 0.3, b: 0.3, h: 2.8 },
      pieces: 12,
      waste: 5,
      mixerVolume: 6,
      density: 2500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netVolume).toBeCloseTo(3.024, 4);
    expect(result.grossVolume).toBeCloseTo(3.1752, 4);
    expect(result.formwork).toBeCloseTo(40.32, 2);
    expect(result.batches).toBe(1);
    expect(result.concreteMass).toBeCloseTo(7.938, 3);
  });

  it("an opening reduces the volume but never the slab's formwork", () => {
    const withoutOpening = concreteTakeoff({
      element: { kind: "slab", a: 6, b: 4.5, d: 0.16 },
      pieces: 1,
      waste: 0,
    });
    const withOpening = concreteTakeoff({
      element: { kind: "slab", a: 6, b: 4.5, d: 0.16 },
      pieces: 1,
      waste: 0,
      openings: 2,
    });
    expect(withoutOpening.ok && withOpening.ok).toBe(true);
    if (!withoutOpening.ok || !withOpening.ok) return;
    // 27−2 = 25 m² of slab, times 0.16 = 4.0000 m³ net.
    expect(withOpening.netVolume).toBeCloseTo(4.0, 4);
    expect(withOpening.formwork).toBe(withoutOpening.formwork);
  });

  it("a strip footing forms only its two sides — the bottom is the ground", () => {
    const result = concreteTakeoff({
      element: { kind: "strip-footing", b: 0.6, h: 0.4, length: 10 },
      pieces: 1,
      waste: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netVolume).toBeCloseTo(2.4, 4); // 0.6×0.4×10
    expect(result.formwork).toBeCloseTo(8, 4); // 2×0.4×10
  });

  it("refuses an opening deduction left over on an element that is not a slab", () => {
    // `openings` is read only inside the `slab` branch; a value left there
    // after switching the element kind (a beam, here) must not be silently
    // ignored — the undeducted volume it would otherwise return is wrong by
    // exactly the deduction the user typed and expected to see applied.
    expect(
      concreteTakeoff({
        element: { kind: "beam", b: 0.3, h: 0.5, length: 4 },
        pieces: 1,
        waste: 0,
        openings: 0.2,
      }),
    ).toEqual({ ok: false, reason: "openings" });
  });

  it("refuses each malformed input by name, and openings at or past the slab's own plan area", () => {
    expect(
      concreteTakeoff({ element: { kind: "slab", a: 0, b: 4.5, d: 0.16 }, pieces: 1, waste: 0 }),
    ).toEqual({ ok: false, reason: "a" });
    expect(
      concreteTakeoff({
        element: { kind: "slab", a: 6, b: 4.5, d: 0.16 },
        pieces: 1,
        waste: 0,
        openings: 27,
      }),
    ).toEqual({ ok: false, reason: "openings" });
    expect(
      concreteTakeoff({ element: { kind: "column", a: 0.3, b: 0.3, h: 2.8 }, pieces: 0, waste: 0 }),
    ).toEqual({ ok: false, reason: "pieces" });
    expect(
      concreteTakeoff({
        element: { kind: "column", a: 0.3, b: 0.3, h: 2.8 },
        pieces: 1,
        waste: -1,
      }),
    ).toEqual({ ok: false, reason: "waste" });
    expect(
      concreteTakeoff({
        element: { kind: "column", a: 0.3, b: 0.3, h: 2.8 },
        pieces: 1,
        waste: 0,
        density: 500,
      }),
    ).toEqual({ ok: false, reason: "density" });
  });
});

/* ---------------------------------------------------------------------------
 * drawing-scale
 * ------------------------------------------------------------------------ */

describe("drawingScaleLength", () => {
  it("1:50, 84 mm on paper → 4.200 m real", () => {
    const result = drawingScaleLength({ denominator: 50, direction: "paper-to-real", length: 84 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.realLength).toBeCloseTo(4.2, 6); // 84 × 50 / 1000
  });

  it("1:50, 6.30 m real, reverse direction → 126.00 mm on paper", () => {
    const result = drawingScaleLength({ denominator: 50, direction: "real-to-paper", length: 6.3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paperLength).toBeCloseTo(126, 6); // 6.30 × 1000 / 50
  });

  it("2:1 magnification (M = 0.5), 40 mm on paper → 20 mm real, smaller than drawn", () => {
    // 40 × 0.001 × 0.5 = 0.020 m = 20 mm — an enlargement shrinks the real size.
    const result = drawingScaleLength({ denominator: 0.5, direction: "paper-to-real", length: 40 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.realLength).toBeCloseTo(0.02, 6);
  });

  it("refuses a non-positive denominator and a non-positive length", () => {
    expect(drawingScaleLength({ denominator: 0, direction: "paper-to-real", length: 84 })).toEqual({
      ok: false,
      reason: "denominator",
    });
    expect(drawingScaleLength({ denominator: 50, direction: "paper-to-real", length: 0 })).toEqual({
      ok: false,
      reason: "length",
    });
  });
});

describe("drawingScaleArea", () => {
  it("1:100, 12.5 cm² on paper → 12.50 m² real — the factor is SQUARED", () => {
    // 12.5 × 1e-4 × 100² = 12.5 × 1e-4 × 10000 = 12.50 m².
    const result = drawingScaleArea(100, 12.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.realArea).toBeCloseTo(12.5, 6);
  });

  it("refuses a non-positive denominator or paper area", () => {
    expect(drawingScaleArea(0, 12.5)).toEqual({ ok: false, reason: "denominator" });
    expect(drawingScaleArea(100, 0)).toEqual({ ok: false, reason: "paperArea" });
  });
});

describe("drawingScaleFit", () => {
  it("finds the smallest standard M that fits, including an ISO 5455 enlargement for a tiny object", () => {
    // A 1 mm object at M = 0.02 (50:1) draws at 1000×0.001/0.02 = 50 mm, which
    // fits an A4 portrait sheet (210−20=190, 297−20=277 usable) easily.
    const result = drawingScaleFit({
      denominator: 1,
      objectWidth: 0.001,
      objectHeight: 0.001,
      sheet: "A4",
      orientation: "portrait",
      margin: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seriesDenominator).toBe(0.02);
  });

  it("reports the usable width and height separately, never as one area", () => {
    const result = drawingScaleFit({
      denominator: 100,
      objectWidth: 3,
      objectHeight: 2,
      sheet: "A3",
      orientation: "landscape",
      margin: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A3 landscape is 420×297; usable = 420−20=400, 297−20=277.
    expect(result.usableWidth).toBe(400);
    expect(result.usableHeight).toBe(277);
  });

  it("fits only when the object is turned, and names the mid-series scale and the exact M that would just fit", () => {
    // Object 2.00 × 3.00 m at 1:10 on A3 landscape (usable 400×277, as above).
    // drawn.w = 2000/10 = 200 mm, drawn.h = 3000/10 = 300 mm.
    // Upright: 200<=400 but 300<=277 is FALSE — upright fails.
    // Turned:  300<=400 AND 200<=277 — turned passes.
    // required = min(max(200/400,300/277), max(300/400,200/277))
    //          = min(max(0.5,1.083032), max(0.75,0.722022)) = min(1.083032,0.75)
    //          = 0.75; requiredDenominator = 0.75×10 = 7.5000 exactly —
    // check: at M=7.5, drawn.h = 3000/7.5 = 400.00 = usableWidth exactly, the
    // binding constraint (turned orientation).
    // seriesDenominator: 1:5 draws 400×600, which fails BOTH orientations
    // (600 exceeds both 400 and 277); 1:10 is the next entry up and is this
    // very vector, which passes turned — so 10 is the answer, a genuine
    // MID-series pick and not the series' own first entry.
    const result = drawingScaleFit({
      denominator: 10,
      objectWidth: 2,
      objectHeight: 3,
      sheet: "A3",
      orientation: "landscape",
      margin: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drawnWidth).toBeCloseTo(200, 6);
    expect(result.drawnHeight).toBeCloseTo(300, 6);
    expect(result.fits).toBe(false);
    expect(result.fitsRotated).toBe(true);
    expect(result.requiredDenominator).toBeCloseTo(7.5, 6);
    expect(result.seriesDenominator).toBe(10);
  });

  it("refuses a margin that consumes the whole shorter side", () => {
    const result = drawingScaleFit({
      denominator: 100,
      objectWidth: 3,
      objectHeight: 2,
      sheet: "A4",
      orientation: "portrait",
      margin: 200, // ≥ half of 210
    });
    expect(result).toEqual({ ok: false, reason: "margin" });
  });
});

/* ---------------------------------------------------------------------------
 * earthwork-prismoidal
 * ------------------------------------------------------------------------ */

describe("earthworkVolumes", () => {
  it("three profiles, average-end-area throughout: 305.00 + 274.00 = 579.00 m³", () => {
    const result = earthworkVolumes({
      profiles: [
        { station: 0, cut: 12.5, fill: 0 },
        { station: 20, cut: 18.0, fill: 0 },
        { station: 40, cut: 9.4, fill: 0 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segments[0]?.cut).toBeCloseTo(305, 2); // 20×(12.5+18)/2
    expect(result.segments[1]?.cut).toBeCloseTo(274, 2); // 20×(18+9.4)/2
    expect(result.totalCut).toBeCloseTo(579, 2);
  });

  it("a measured mid-section area SHRINKS the prismoidal answer below average-end-area for a tapering shape", () => {
    // L=30, A1=10.0, A2=20.0. Average end area: 30×(10+20)/2 = 450.00 m³.
    // With A_m = 14.0: (30/6)×(10+56+20) = 5×86 = 430.00 m³ — LESS than 450,
    // because the tapering section's true mid-area sits below the straight
    // average of its ends, so the cruder method overestimates.
    const result = earthworkVolumes({
      profiles: [
        { station: 0, cut: 10, fill: 0, midCut: 14 },
        { station: 30, cut: 20, fill: 0 },
      ],
      bulking: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segments[0]?.cut).toBeCloseTo(430, 2);
    expect(result.segments[0]?.cutMethod).toBe("prismoidal");
    expect(result.cutLoose).toBeCloseTo(516, 2); // 430 × 1.20
  });

  it("refuses fewer than two profiles, non-increasing stationing, and a negative area", () => {
    expect(earthworkVolumes({ profiles: [{ station: 0, cut: 1, fill: 0 }] })).toEqual({
      ok: false,
      reason: "rows",
    });
    expect(
      earthworkVolumes({
        profiles: [
          { station: 10, cut: 1, fill: 0 },
          { station: 10, cut: 1, fill: 0 },
        ],
      }),
    ).toEqual({ ok: false, reason: "station:1" });
    expect(
      earthworkVolumes({
        profiles: [
          { station: 0, cut: -1, fill: 0 },
          { station: 10, cut: 1, fill: 0 },
        ],
      }),
    ).toEqual({ ok: false, reason: "cut:0" });
  });

  it("refuses a mid-section area typed on the LAST profile — it begins no segment and would silently be dropped", () => {
    // Same two profiles as the tapering-frustum vector above, but with midCut
    // moved from the profile that BEGINS the only segment (index 0) to the
    // one that ends it (index 1, also the last profile). Consuming it would
    // give 430.00 m³ by the prismoidal rule; silently dropping it would give
    // 450.00 m³ by average-end-area instead — 30×(10+20)/2 = 450.00, 4.4%
    // over the correct 430.00 and in the direction that overestimates.
    expect(
      earthworkVolumes({
        profiles: [
          { station: 0, cut: 10, fill: 0 },
          { station: 30, cut: 20, fill: 0, midCut: 14 },
        ],
      }),
    ).toEqual({ ok: false, reason: "midCut:1" });
    expect(
      earthworkVolumes({
        profiles: [
          { station: 0, cut: 0, fill: 10 },
          { station: 30, cut: 0, fill: 20, midFill: 14 },
        ],
      }),
    ).toEqual({ ok: false, reason: "midFill:1" });
  });

  it("gives an adjusted balance only when BOTH bulking and settlement are supplied", () => {
    const oneOnly = earthworkVolumes({
      profiles: [
        { station: 0, cut: 10, fill: 5 },
        { station: 10, cut: 10, fill: 5 },
      ],
      bulking: 20,
    });
    expect(oneOnly.ok).toBe(true);
    if (!oneOnly.ok) return;
    expect(oneOnly.cutLoose).toBeDefined();
    expect(oneOnly.fillWithSettlement).toBeUndefined();
    expect(oneOnly.balanceAdjusted).toBeUndefined();
    // The plain in-situ balance is always available regardless.
    expect(oneOnly.balance).toBeCloseTo(oneOnly.totalCut - oneOnly.totalFill, 6);
  });
});

/* ---------------------------------------------------------------------------
 * level-run
 * ------------------------------------------------------------------------ */

describe("levelRun", () => {
  it("one station with an intermediate sight, which never enters the arithmetic check", () => {
    // R1=100.000, BS=1.532 → HI=101.532. IS T1=0.875 → H=100.657 (not checked).
    // FS on R2=2.104 → H=99.428. ΣBS−ΣFS = 1.532−2.104 = −0.572 =
    // H_end−H_start = 99.428−100.000 = −0.572; check difference 0.000.
    const result = levelRun({
      startElevation: 100,
      readings: [
        { point: "R1", backsight: 1.532 },
        { point: "T1", intermediate: 0.875 },
        { point: "R2", foresight: 2.104 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[1]?.elevation).toBeCloseTo(100.657, 3);
    expect(result.lastElevation).toBeCloseTo(99.428, 3);
    expect(result.checkDifference).toBeCloseTo(0, 9);
  });

  it("closed traverse, two stations: −8 mm misclosure, distributed by station count", () => {
    // R1=145.320; BS 1.204→HI 146.524; FS P1 2.876→143.648; BS P1 1.955→HI 145.603;
    // FS back to R1 0.291→145.312. ΣBS−ΣFS = 3.159−3.167 = −0.008 = 145.312−145.320.
    // f = 145.312 − 145.320 = −0.008 m. Correction +4 mm per station:
    // P1 → 143.648+0.004=143.652; close → 145.312+0.008=145.320.
    const result = levelRun({
      startElevation: 145.32,
      readings: [
        { point: "R1", backsight: 1.204 },
        { point: "P1", foresight: 2.876, backsight: 1.955 },
        { point: "R1", foresight: 0.291 },
      ],
      closingElevation: 145.32,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.misclosure).toBeCloseTo(-0.008, 3);
    expect(result.rows[1]?.adjustedElevation).toBeCloseTo(143.652, 3);
    expect(result.rows[2]?.adjustedElevation).toBeCloseTo(145.32, 3);
    // The opening benchmark carries no correction — it is the fixed end.
    expect(result.rows[0]?.correction).toBeCloseTo(0, 9);
  });

  it("refuses a backsight with no established point behind it, and a non-finite starting elevation", () => {
    expect(
      levelRun({
        startElevation: Number.NaN,
        readings: [{ point: "R1", backsight: 1 }],
      }),
    ).toEqual({ ok: false, reason: "startElevation" });
    expect(
      levelRun({
        startElevation: 100,
        readings: [
          { point: "A", backsight: 1 },
          { point: "B", backsight: 1 }, // two backsights with no foresight between
        ],
      }),
    ).toEqual({ ok: false, reason: "backsight:1" });
  });

  it("refuses an entirely blank row", () => {
    expect(
      levelRun({ startElevation: 100, readings: [{ point: "A" }] }),
    ).toEqual({ ok: false, reason: "row:0" });
  });

  it("refuses a sight length typed on a row that carries no backsight — it opens no station", () => {
    // `distance` belongs to the station a BACKSIGHT opens; on a foresight- or
    // intermediate-only row it names nothing this run can act on. Silently
    // discarding it would let a field-book length that was typed look included.
    expect(
      levelRun({
        startElevation: 100,
        readings: [
          { point: "R1", backsight: 1 },
          { point: "R2", foresight: 1, distance: 50 },
        ],
      }),
    ).toEqual({ ok: false, reason: "distance:1" });
    expect(
      levelRun({
        startElevation: 100,
        readings: [
          { point: "R1", backsight: 1 },
          { point: "T1", intermediate: 0.5, distance: 20 },
          { point: "R2", foresight: 1 },
        ],
      }),
    ).toEqual({ ok: false, reason: "distance:1" });
  });

  it("refuses a run where only SOME stations carry a sight length, rather than half-weighting it", () => {
    // Three stations, only the first two backsights carry a distance — the
    // third leg's length was never entered, and treating it as a zero-length
    // leg (falling into station-count weighting or silently as 0 m) would
    // misdistribute the misclosure.
    expect(
      levelRun({
        startElevation: 100,
        readings: [
          { point: "R1", backsight: 1, distance: 30 },
          { point: "P1", foresight: 1, backsight: 1, distance: 40 },
          { point: "P2", foresight: 1, backsight: 1 },
          { point: "R1", foresight: 1 },
        ],
        closingElevation: 100,
      }),
    ).toEqual({ ok: false, reason: "distance" });
  });

  it("distributes the misclosure by sight length when every station reports one", () => {
    // Two stations, distances 30 m and 20 m (50 m total). R1=100.000, BS
    // 1.000 → HI 101.000; FS P1 2.000 → 99.000; BS P1 1.000, distance 30 →
    // HI 100.000; FS R1 1.500 → 98.500. Known close = 98.520 →
    // f = 98.500 − 98.520 = −0.020 m. P1's correction is weighted by the
    // distance BEFORE its own backsight (30 m of 50 m): −f×30/50 = +0.012 m
    // → 99.000+0.012 = 99.012. The close's correction is the full −f×50/50 =
    // +0.020 → 98.500+0.020 = 98.520, landing exactly on the known value.
    const result = levelRun({
      startElevation: 100,
      readings: [
        { point: "R1", backsight: 1, distance: 30 },
        { point: "P1", foresight: 2, backsight: 1, distance: 20 },
        { point: "R1", foresight: 1.5 },
      ],
      closingElevation: 98.52,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.misclosure).toBeCloseTo(-0.02, 6);
    expect(result.rows[1]?.adjustedElevation).toBeCloseTo(99.012, 6);
    expect(result.rows[2]?.adjustedElevation).toBeCloseTo(98.52, 6);
  });
});

/* ---------------------------------------------------------------------------
 * rebar-weight
 * ------------------------------------------------------------------------ */

describe("rebarMassPerMetre", () => {
  it("Ø10 and Ø16 against the tabulated nominal masses", () => {
    // (π/4)×0.0001×7850 = 0.616538 kg/m (tabulated 0.617).
    const ten = rebarMassPerMetre(10);
    expect(ten.ok && ten.massPerMetre).toBeCloseTo(0.616538, 6);
    // (π/4)×0.000256×7850 = 1.578336 kg/m (tabulated 1.578).
    const sixteen = rebarMassPerMetre(16);
    expect(sixteen.ok && sixteen.massPerMetre).toBeCloseTo(1.578336, 6);
  });

  it("refuses a diameter outside 1–60 mm", () => {
    expect(rebarMassPerMetre(0)).toEqual({ ok: false, reason: "diameter" });
    expect(rebarMassPerMetre(61)).toEqual({ ok: false, reason: "diameter" });
  });
});

describe("rebarFromLength", () => {
  it("Ø12, 12.00 m × 40 bars → 0.887814 kg/m, 480.00 m, 426.151 kg", () => {
    const result = rebarFromLength({ diameter: 12, barLength: 12, bars: 40 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.massPerMetre).toBeCloseTo(0.887814, 6);
    expect(result.totalLength).toBe(480);
    expect(result.totalMass).toBeCloseTo(426.151, 3);
    expect(result.totalTonnes).toBeCloseTo(0.426, 3);
  });

  it("refuses a non-positive bar length and a non-integer or out-of-range bar count", () => {
    expect(rebarFromLength({ diameter: 12, barLength: 0, bars: 40 })).toEqual({
      ok: false,
      reason: "barLength",
    });
    expect(rebarFromLength({ diameter: 12, barLength: 12, bars: 0.5 })).toEqual({
      ok: false,
      reason: "bars",
    });
  });
});

describe("rebarFromMass", () => {
  it("Ø8, 500 kg, 12 m stock → 1267.157 m, 105 whole bars, 7.157 m over", () => {
    // m' = 0.394584 kg/m; L = 500/0.394584 = 1267.157 m.
    // wholeBars = floor(1267.157/12) = floor(105.596) = 105.
    // remainder = 1267.157 − 105×12 = 1267.157 − 1260 = 7.157 m.
    const result = rebarFromMass({ diameter: 8, mass: 500, barLength: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.massPerMetre).toBeCloseTo(0.394584, 6);
    expect(result.totalLength).toBeCloseTo(1267.157, 2);
    expect(result.wholeBars).toBe(105);
    expect(result.remainder).toBeCloseTo(7.157, 2);
  });

  it("answers only the total length without a stock bar length — no invented bar count", () => {
    const result = rebarFromMass({ diameter: 8, mass: 500 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wholeBars).toBeUndefined();
    expect(result.remainder).toBeUndefined();
  });

  it("refuses a non-positive mass", () => {
    expect(rebarFromMass({ diameter: 8, mass: 0 })).toEqual({ ok: false, reason: "mass" });
  });
});

/* ---------------------------------------------------------------------------
 * roof-pitch
 * ------------------------------------------------------------------------ */

describe("roofPitch", () => {
  it("30°, base 5.00 m, projection 120 m², with a matching second base for the hip", () => {
    // h = 5×tan30° = 2.886751 m; rafter = 5/cos30° = 5.773503 m.
    // True area = 120/cos30° = 138.564 m² (divided, never multiplied).
    // hip run = √50 = 7.071068 m; hip length = √(50+2.886751²) = √58.333333 = 7.637626 m.
    // hip angle = atan(2.886751/7.071068) = 22.2077°, slacker than 30°.
    const result = roofPitch({
      pitch: 30,
      pitchUnit: "degrees",
      base: 5,
      planArea: 120,
      secondBase: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.height).toBeCloseTo(2.886751, 5);
    expect(result.rafter).toBeCloseTo(5.773503, 5);
    expect(result.slopeArea).toBeCloseTo(138.564, 3);
    expect(result.hipLength).toBeCloseTo(7.637626, 5);
    expect(result.hipAngle).toBeCloseTo(22.2077, 3);
    expect(result.hipAngle).toBeLessThan(30); // the hip is always slacker
  });

  it("100% pitch (45°), with an eaves overhang added along the same slope", () => {
    // θ=45°; h=4×tan45°=4.000; rafter=4/cos45°=5.656854; area=100/cos45°=141.4214.
    // With eaves 0.60 m: rafter grows by 0.60/cos45°=0.848528 → 6.505382 m.
    const result = roofPitch({ pitch: 100, pitchUnit: "percent", base: 4, planArea: 100, eaves: 0.6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.height).toBeCloseTo(4, 3);
    expect(result.rafter).toBeCloseTo(5.656854, 5);
    expect(result.slopeArea).toBeCloseTo(141.4214, 3);
    expect(result.rafterWithEaves).toBeCloseTo(6.505382, 5);
  });

  it("refuses 90 degrees and a non-positive base or ratio pitch", () => {
    expect(roofPitch({ pitch: 90, pitchUnit: "degrees", base: 5 })).toEqual({
      ok: false,
      reason: "pitch",
    });
    expect(roofPitch({ pitch: 30, pitchUnit: "degrees", base: 0 })).toEqual({
      ok: false,
      reason: "base",
    });
    expect(roofPitch({ pitch: 0, pitchUnit: "ratio", base: 5 })).toEqual({
      ok: false,
      reason: "pitch",
    });
  });

  it("a flat roof (θ=0) has a rafter equal to the base and a true area equal to the projection", () => {
    const result = roofPitch({ pitch: 0, pitchUnit: "degrees", base: 5, planArea: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.height).toBe(0);
    expect(result.rafter).toBeCloseTo(5, 9);
    expect(result.slopeArea).toBeCloseTo(20, 9);
  });
});

/* ---------------------------------------------------------------------------
 * room-surfaces
 * ------------------------------------------------------------------------ */

describe("roomSurfaces", () => {
  const base = {
    length: 4.2,
    width: 3.6,
    height: 2.7,
    deductOpenings: true,
    includeWalls: true,
    includeReveals: true,
    includeCeiling: true,
    revealDepth: 0.25,
  };

  it("perimeter 15.600 m, net wall 38.5950 m², ceiling 15.1200 m²", () => {
    // O = 2×(4.20+3.60) = 15.600 m; gross wall = 15.600×2.70 = 42.1200 m².
    // Openings: 0.90×2.05 + 1.40×1.20 = 1.8450 + 1.6800 = 3.5250 m².
    // Net wall = 42.1200 − 3.5250 = 38.5950 m²; ceiling = 4.20×3.60 = 15.1200 m².
    const result = roomSurfaces({
      ...base,
      openings: [
        { width: 0.9, height: 2.05, count: 1, kind: "door" },
        { width: 1.4, height: 1.2, count: 1, kind: "window" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perimeter).toBeCloseTo(15.6, 3);
    expect(result.grossWall).toBeCloseTo(42.12, 4);
    expect(result.openingArea).toBeCloseTo(3.525, 4);
    expect(result.netWall).toBeCloseTo(38.595, 4);
    expect(result.ceiling).toBeCloseTo(15.12, 4);
  });

  it("default reveal convention: sill counted for the window, not for the door — 10.20 m of reveal", () => {
    // Door (no sill by default): 2×2.05+0.90 = 5.00 m.
    // Window (sill by default):  2×1.20+2×1.40 = 2.40+2.80 = 5.20 m.
    // Total reveal length = 10.20 m → area at d=0.25 m = 2.5500 m².
    const result = roomSurfaces({
      ...base,
      openings: [
        { width: 0.9, height: 2.05, count: 1, kind: "door" },
        { width: 1.4, height: 1.2, count: 1, kind: "window" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revealLength).toBeCloseTo(10.2, 3);
    expect(result.revealArea).toBeCloseTo(2.55, 4);
  });

  it("the per-opening switch overrides the convention in both directions — matching the two extremes worked by hand", () => {
    // All sills OFF (door explicitly off, window explicitly off): door 5.00 +
    // window 3.80 (2×1.20+1.40) = 8.80 m → 8.80×0.25 = 2.2000 m².
    const allOff = roomSurfaces({
      ...base,
      openings: [
        { width: 0.9, height: 2.05, count: 1, kind: "door", includeSill: false },
        { width: 1.4, height: 1.2, count: 1, kind: "window", includeSill: false },
      ],
    });
    expect(allOff.ok && allOff.revealLength).toBeCloseTo(8.8, 3);
    expect(allOff.ok && allOff.revealArea).toBeCloseTo(2.2, 4);

    // All sills ON (door explicitly on, window explicitly on): door
    // (2×2.05+2×0.90)=5.90 + window (2×1.20+2×1.40)=5.20 = 11.10 m → 2.7750 m².
    const allOn = roomSurfaces({
      ...base,
      openings: [
        { width: 0.9, height: 2.05, count: 1, kind: "door", includeSill: true },
        { width: 1.4, height: 1.2, count: 1, kind: "window", includeSill: true },
      ],
    });
    expect(allOn.ok && allOn.revealLength).toBeCloseTo(11.1, 3);
    expect(allOn.ok && allOn.revealArea).toBeCloseTo(2.775, 4);
  });

  it("required coverage mode: the same figure means two different quantities", () => {
    // Walls + ceiling only, no reveals: 38.5950 + 15.1200 = 53.7150 m², 2 coats.
    // Area-per-litre 10 m²/l → 53.7150×2/10 = 10.743 l.
    const litres = roomSurfaces({
      ...base,
      includeReveals: false,
      openings: [
        { width: 0.9, height: 2.05, count: 1, kind: "door" },
        { width: 1.4, height: 1.2, count: 1, kind: "window" },
      ],
      coverage: 10,
      coverageMode: "area-per-litre",
      coats: 2,
    });
    expect(litres.ok && litres.quantity).toBeCloseTo(10.743, 3);

    // Walls only, mass-per-area 1.2 kg/m², 1 coat: 38.5950×1.2 = 46.314 kg.
    const kg = roomSurfaces({
      ...base,
      includeReveals: false,
      includeCeiling: false,
      openings: [
        { width: 0.9, height: 2.05, count: 1, kind: "door" },
        { width: 1.4, height: 1.2, count: 1, kind: "window" },
      ],
      coverage: 1.2,
      coverageMode: "mass-per-area",
      coats: 1,
    });
    expect(kg.ok && kg.quantity).toBeCloseTo(46.314, 3);
    // The SAME number read as the other unit gives a materially different answer.
    expect(kg.ok && kg.quantity).not.toBeCloseTo(32.163, 1);
  });

  it("reports a negative net wall as it is, rather than clamping it to zero", () => {
    // perimeter = 2×(0.5+0.5) = 2.000 m; gross wall = 2.000×0.5 = 1.0000 m².
    // Opening area = 1.9×1 = 1.9000 m² — bigger than the wall itself.
    // Net wall = 1.0000 − 1.9000 = −0.9000 m², reported, not clamped to 0.
    const result = roomSurfaces({
      length: 0.5,
      width: 0.5,
      height: 0.5,
      deductOpenings: true,
      includeWalls: true,
      includeReveals: false,
      includeCeiling: false,
      openings: [{ width: 1.9, height: 1, count: 1, kind: "door" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.netWall).toBeCloseTo(-0.9, 4);
  });

  it("leaves revealArea undefined rather than a silent 0 m² when reveals are not counted and no depth was ever typed", () => {
    // includeReveals is false, so `revealDepth` is never required — but the
    // field still has to say NOTHING was measured rather than print 0.0000 m²
    // as though a reveal of zero depth had been surveyed.
    const result = roomSurfaces({
      length: 4.2,
      width: 3.6,
      height: 2.7,
      deductOpenings: true,
      includeWalls: true,
      includeReveals: false,
      includeCeiling: false,
      openings: [{ width: 0.9, height: 2.05, count: 1, kind: "door" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revealArea).toBeUndefined();
    // The reveal length is still a fact about the openings alone — that part
    // needs no depth at all.
    expect(result.revealLength).toBeCloseTo(5, 3); // 2×2.05 + 0.90 (door, no sill)
  });

  it("refuses coverage given without a coverage mode, and a ceiling request with no derivable area", () => {
    expect(
      roomSurfaces({
        length: 4.2,
        width: 3.6,
        height: 2.7,
        deductOpenings: true,
        includeWalls: true,
        includeReveals: false,
        includeCeiling: false,
        openings: [],
        coverage: 10,
        coats: 1,
      }),
    ).toEqual({ ok: false, reason: "coverageMode" });
    expect(
      roomSurfaces({
        perimeter: 15.6,
        height: 2.7,
        deductOpenings: true,
        includeWalls: false,
        includeReveals: false,
        includeCeiling: true,
        openings: [],
      }),
    ).toEqual({ ok: false, reason: "ceilingArea" });
  });

  it("refuses reveals requested with no reveal depth, symmetric with the other optional pairings", () => {
    // Same room as the base fixture but with revealDepth left unset — this is
    // "nothing typed yet", and answering with 0 m² of reveal (the old `?? 0`
    // behaviour) would be the silent zero this pack refuses to give.
    expect(
      roomSurfaces({
        length: 4.2,
        width: 3.6,
        height: 2.7,
        deductOpenings: true,
        includeWalls: true,
        includeReveals: true,
        includeCeiling: true,
        openings: [{ width: 0.9, height: 2.05, count: 1, kind: "door" }],
      }),
    ).toEqual({ ok: false, reason: "revealDepth" });
  });
});

/* ---------------------------------------------------------------------------
 * slope-grade
 * ------------------------------------------------------------------------ */

describe("slopeGrade", () => {
  it("drainage fall, L=24.000 m, h=0.360 m: 1.5000%, 15.000‰, 1:66.6667, 0.859372°", () => {
    // p = 100×0.36/24 = 1.5000%; permille = 15.000.
    // n = 24/0.36 = 66.6667 → ratio field |run/rise| = 66.666667.
    // θ = atan(0.015) = 0.014998875 rad = 0.859372°.
    // s = √(576+0.1296) = √576.1296 = 24.00270 m.
    const result = slopeGrade({ known: "run-rise", run: 24, rise: 0.36 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.percent).toBeCloseTo(1.5, 4);
    expect(result.permille).toBeCloseTo(15, 3);
    expect(result.ratio).toBeCloseTo(66.666667, 4);
    expect(result.degrees).toBeCloseTo(0.859372, 5);
    expect(result.slant).toBeCloseTo(24.0027, 3);
    expect(result.descending).toBe(false);
  });

  it("1:2 ratio (rise:run) with a 6.00 m base → 3.00 m rise, 50%, 26.565051°", () => {
    const result = slopeGrade({ known: "run-slope", run: 6, slope: 2, slopeUnit: "ratio" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rise).toBeCloseTo(3, 6);
    expect(result.percent).toBeCloseTo(50, 4);
    expect(result.degrees).toBeCloseTo(26.565051, 4);
    expect(result.slant).toBeCloseTo(6.708204, 5);
  });

  it("slant + rise and slant + run are plain Pythagoras and agree with each other", () => {
    // slant=10, rise=6 → run = √(100−36) = √64 = 8.000000.
    const fromRise = slopeGrade({ known: "slant-rise", slant: 10, rise: 6 });
    expect(fromRise.ok).toBe(true);
    if (!fromRise.ok) return;
    expect(fromRise.run).toBeCloseTo(8, 6);
    expect(fromRise.percent).toBeCloseTo(75, 4); // 100×6/8

    // slant=10, run=8 → rise = √(100−64) = √36 = 6.000000 (ascent assumed).
    const fromRun = slopeGrade({ known: "slant-run", slant: 10, run: 8 });
    expect(fromRun.ok).toBe(true);
    if (!fromRun.ok) return;
    expect(fromRun.rise).toBeCloseTo(6, 6);
    expect(fromRun.percent).toBeCloseTo(75, 4);
  });

  it("refuses a vertical run, an out-of-range angle, and a 1:0 ratio", () => {
    expect(slopeGrade({ known: "run-rise", run: 0, rise: 1 })).toEqual({
      ok: false,
      reason: "run",
    });
    expect(
      slopeGrade({ known: "run-slope", run: 5, slope: 95, slopeUnit: "degrees" }),
    ).toEqual({ ok: false, reason: "slope" });
    expect(slopeGrade({ known: "run-slope", run: 5, slope: 0, slopeUnit: "ratio" })).toEqual({
      ok: false,
      reason: "slope",
    });
  });

  it("refuses a slant shorter than (or equal to) the given leg — the triangle would not close", () => {
    expect(slopeGrade({ known: "slant-rise", slant: 5, rise: 5 })).toEqual({
      ok: false,
      reason: "rise",
    });
    expect(slopeGrade({ known: "slant-run", slant: 5, run: 6 })).toEqual({
      ok: false,
      reason: "run",
    });
  });

  it("a zero rise has no 1:n reading — flat is not an infinite n", () => {
    const result = slopeGrade({ known: "run-rise", run: 10, rise: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.percent).toBe(0);
    expect(result.ratio).toBeUndefined();
  });
});

/* ---------------------------------------------------------------------------
 * square-check
 * ------------------------------------------------------------------------ */

describe("squareCheck", () => {
  it("a=6.000, b=4.000, measured d=7.220 → +8.9 mm long, corner 90.153266°, pulled −10.7 mm", () => {
    // d0 = √52 = 7.211103; diff = (7.220−7.211103)×1000 = 8.897 → 8.9 mm.
    // cosα = (36+16−52.1284)/48 = −0.1284/48 = −0.0026750; α = 90.153266°.
    // offsetAlongA = 4×(−0.002675)×1000 = −10.7 mm (obtuse: point pushed out).
    const result = squareCheck({ sideA: 6, sideB: 4, measuredDiagonal: 7.22 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expectedDiagonal).toBeCloseTo(7.211103, 5);
    expect(result.diagonalError).toBeCloseTo(8.9, 1);
    expect(result.angle).toBeCloseTo(90.153266, 3);
    expect(result.angleError).toBeCloseTo(0.153266, 3);
    expect(result.offsetAlongA).toBeCloseTo(-10.7, 1);
  });

  it("the 3-4-5 control case gives an EXACT 90° and an exact zero offset, never 89.99999°", () => {
    const result = squareCheck({ sideA: 3, sideB: 4, measuredDiagonal: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expectedDiagonal).toBe(5);
    expect(result.diagonalError).toBe(0);
    expect(result.angle).toBeCloseTo(90, 9);
    expect(result.offsetAlongA).toBe(0);
  });

  it("predicts the second diagonal a PARALLELOGRAM would have, and names the skew when a real measurement disagrees", () => {
    // A true parallelogram, a=5, b=3, corner angle 60°: p² = a²+b²−2ab·cos60°
    // = 25+9−15 = 19 → p = √19 = 4.358899; q² = a²+b²+2ab·cos60° = 25+9+15 =
    // 49 → q = 7.000000 exactly, and the parallelogram law checks itself:
    // p²+q² = 19+49 = 68 = 2×(25+9). expectedSecondDiagonal = √(2×34−19) =
    // √49 = 7.000000 — reproducing q exactly BECAUSE this data really is a
    // parallelogram, so the skew against the true q = 7.000 is zero.
    const trueParallelogram = squareCheck({
      sideA: 5,
      sideB: 3,
      measuredDiagonal: 4.3588989435,
      secondDiagonal: 7,
    });
    expect(trueParallelogram.ok).toBe(true);
    if (!trueParallelogram.ok) return;
    expect(trueParallelogram.expectedSecondDiagonal).toBeCloseTo(7, 5);
    expect(trueParallelogram.parallelogramSkew).toBeCloseTo(0, 2);

    // The same sides and the same measured p, but a second diagonal of
    // 6.900 m instead of the 7.000 m a parallelogram would have — these four
    // corners are NOT a parallelogram, and the skew names exactly that:
    // (6.900 − 7.000) × 1000 = −100.000 mm.
    const notAParallelogram = squareCheck({
      sideA: 5,
      sideB: 3,
      measuredDiagonal: 4.3588989435,
      secondDiagonal: 6.9,
    });
    expect(notAParallelogram.ok).toBe(true);
    if (!notAParallelogram.ok) return;
    expect(notAParallelogram.expectedSecondDiagonal).toBeCloseTo(7, 5);
    expect(notAParallelogram.parallelogramSkew).toBeCloseTo(-100, 1);

    // The prediction depends only on the two sides and the FIRST diagonal, so
    // it is still given even when no second diagonal was ever measured — the
    // skew, which needs both, is not.
    const noSecondDiagonal = squareCheck({ sideA: 5, sideB: 3, measuredDiagonal: 4.3588989435 });
    expect(noSecondDiagonal.ok).toBe(true);
    if (!noSecondDiagonal.ok) return;
    expect(noSecondDiagonal.expectedSecondDiagonal).toBeCloseTo(7, 5);
    expect(noSecondDiagonal.parallelogramSkew).toBeUndefined();
  });

  it("without a measured diagonal, only the target diagonal is answered", () => {
    const result = squareCheck({ sideA: 6, sideB: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expectedDiagonal).toBeCloseTo(7.211103, 5);
    expect(result.angle).toBeUndefined();
    expect(result.offsetAlongA).toBeUndefined();
    expect(result.expectedSecondDiagonal).toBeUndefined();
    expect(result.parallelogramSkew).toBeUndefined();
  });

  it("refuses a diagonal outside the triangle inequality rather than feeding acos an out-of-range cosine", () => {
    expect(squareCheck({ sideA: 6, sideB: 4, measuredDiagonal: 1.9 })).toEqual({
      ok: false,
      reason: "measuredDiagonal",
    });
    expect(squareCheck({ sideA: 6, sideB: 4, measuredDiagonal: 10.1 })).toEqual({
      ok: false,
      reason: "measuredDiagonal",
    });
  });

  it("refuses a non-positive side", () => {
    expect(squareCheck({ sideA: 0, sideB: 4 })).toEqual({ ok: false, reason: "sideA" });
    expect(squareCheck({ sideA: 6, sideB: 0 })).toEqual({ ok: false, reason: "sideB" });
  });
});

/* ---------------------------------------------------------------------------
 * survey-bearing-distance
 * ------------------------------------------------------------------------ */

describe("surveyInverse", () => {
  it("A(7458000,4890000) → B(7458100,4890100): 141.421 m at 50.0000 gon (NE, 45°)", () => {
    const result = surveyInverse({
      from: { y: 7458000, x: 4890000 },
      to: { y: 7458100, x: 4890100 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distance).toBeCloseTo(141.421, 3);
    expect(result.bearingGon).toBeCloseTo(50, 4);
    expect(result.oppositeGon).toBeCloseTo(250, 4);
  });

  it("A(0,0) → B(−100,0): due west, 300.0000 gon — atan2 argument order matters", () => {
    // ΔY=−100, ΔX=0 → atan2(−100,0) = −π/2, folded to 3π/2 = 270° = 300 gon.
    const result = surveyInverse({ from: { y: 0, x: 0 }, to: { y: -100, x: 0 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distance).toBeCloseTo(100, 3);
    expect(result.bearingGon).toBeCloseTo(300, 4);
  });

  it("coincident points: zero distance and NO bearing — a direction to oneself is not zero, it is undefined", () => {
    const result = surveyInverse({ from: { y: 5, x: 5 }, to: { y: 5, x: 5 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distance).toBe(0);
    expect(result.bearingGon).toBeUndefined();
    expect(result.bearingDeg).toBeUndefined();
  });

  it("refuses a non-finite coordinate", () => {
    expect(surveyInverse({ from: { y: Number.NaN, x: 0 }, to: { y: 1, x: 1 } })).toEqual({
      ok: false,
      reason: "pointA",
    });
  });
});

describe("surveyForward", () => {
  it("A(1000,2000), ν=150.0000 gon (=135°), d=200.000 → (1141.421, 1858.579)", () => {
    const result = surveyForward({
      from: { y: 1000, x: 2000 },
      bearing: 150,
      bearingUnit: "gon",
      distance: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.point.y).toBeCloseTo(1141.421, 2);
    expect(result.point.x).toBeCloseTo(1858.579, 2);
  });

  it("the same bearing read as 135° DMS gives the identical point", () => {
    const result = surveyForward({
      from: { y: 1000, x: 2000 },
      bearingUnit: "dms",
      bearingDms: { negative: false, degrees: 135, minutes: 0, seconds: 0 },
      distance: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.point.y).toBeCloseTo(1141.421, 2);
    expect(result.point.x).toBeCloseTo(1858.579, 2);
  });

  it("folds a bearing outside the circle BEFORE computing the point, as a summed traverse angle would need", () => {
    const wrapped = surveyForward({
      from: { y: 0, x: 0 },
      bearing: 450, // 450 - 360 = 90°: due east
      bearingUnit: "deg",
      distance: 10,
    });
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    expect(wrapped.point.y).toBeCloseTo(10, 6);
    expect(wrapped.point.x).toBeCloseTo(0, 6);
  });

  it("refuses a missing bearing for the chosen unit, and a negative distance", () => {
    expect(
      surveyForward({ from: { y: 0, x: 0 }, bearingUnit: "gon", distance: 10 }),
    ).toEqual({ ok: false, reason: "bearing" });
    expect(
      surveyForward({ from: { y: 0, x: 0 }, bearingUnit: "dms", distance: 10 }),
    ).toEqual({ ok: false, reason: "bearing" });
    expect(
      surveyForward({ from: { y: 0, x: 0 }, bearing: 0, bearingUnit: "gon", distance: -1 }),
    ).toEqual({ ok: false, reason: "distance" });
  });
});

/* ---------------------------------------------------------------------------
 * tile-count
 * ------------------------------------------------------------------------ */

describe("tileCount", () => {
  it("24.00 m², 300×600 mm tile, 3 mm joint, 10% waste, boxes of 8: 145 pieces, 19 boxes, 1.260 m² of surplus (nominal, not effective)", () => {
    // Effective piece = 303×603 = 182,709 mm² → 1e6/182709 = 5.4732 per m².
    // Needed area = 24.00×1.10 = 26.400 m² → n = ceil(26,400,000/182,709) = ceil(144.4921) = 145.
    // boxes = ceil(145/8) = 19 (152 pieces); surplus = 7 pieces.
    // Surplus is valued at the NOMINAL area a×b = 0.18 m², not the effective
    // (jointed) area — nobody buys back grout, so 7×0.18 = 1.260 m², NOT
    // 7×0.182709 = 1.279 m² as the source vector states (see report).
    const result = tileCount({ area: 24, tileWidth: 300, tileHeight: 600, joint: 3, waste: 10, perBox: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perSquareMetre).toBeCloseTo(5.4732, 4);
    expect(result.areaWithWaste).toBeCloseTo(26.4, 3);
    expect(result.pieces).toBe(145);
    expect(result.boxes).toBe(19);
    expect(result.surplusPieces).toBe(7);
    expect(result.surplusArea).toBeCloseTo(1.26, 3);
  });

  it("wall block 250×190 mm, 10 mm joint, 5% waste, 12.50 m²: 253 pieces", () => {
    // Effective = 260×200 = 52,000 mm² → 1e6/52000 = 19.2308/m².
    // Needed = 12.50×1.05 = 13.125 m² → n = ceil(13,125,000/52,000) = ceil(252.4038) = 253.
    const result = tileCount({ area: 12.5, tileWidth: 250, tileHeight: 190, joint: 10, waste: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perSquareMetre).toBeCloseTo(19.2308, 3);
    expect(result.pieces).toBe(253);
  });

  it("a butt joint with zero waste rounds up exactly, never below the true count", () => {
    // 100×100 mm, no joint, no waste, 5.00 m² → 10,000 mm² each → 100.0000/m²;
    // n = ceil(5,000,000/10,000) = 500 exactly, with nothing to round away.
    const result = tileCount({ area: 5, tileWidth: 100, tileHeight: 100, joint: 0, waste: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perSquareMetre).toBe(100);
    expect(result.pieces).toBe(500);
  });

  it("boxes bought by area do not name a surplus piece count — that would be a guess", () => {
    const result = tileCount({
      area: 24,
      tileWidth: 300,
      tileHeight: 600,
      joint: 3,
      waste: 10,
      areaPerBox: 1.44,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boxBasis).toBe("area");
    expect(result.surplusPieces).toBeUndefined();
    expect(result.surplusArea).toBeUndefined();
  });

  it("refuses a non-positive area, tile dimension, or waste out of range", () => {
    expect(tileCount({ area: 0, tileWidth: 300, tileHeight: 600, joint: 3, waste: 10 })).toEqual({
      ok: false,
      reason: "area",
    });
    expect(tileCount({ area: 24, tileWidth: 0, tileHeight: 600, joint: 3, waste: 10 })).toEqual({
      ok: false,
      reason: "tileWidth",
    });
    expect(tileCount({ area: 24, tileWidth: 300, tileHeight: 600, joint: -1, waste: 10 })).toEqual({
      ok: false,
      reason: "joint",
    });
    expect(tileCount({ area: 24, tileWidth: 300, tileHeight: 600, joint: 3, waste: 101 })).toEqual({
      ok: false,
      reason: "waste",
    });
  });
});

/* ---------------------------------------------------------------------------
 * trench-volume
 * ------------------------------------------------------------------------ */

describe("trenchVolume", () => {
  it("vertical-sided trench, L=30, b=0.80, h=1.20: 0.9600 m² section, 28.800 m³", () => {
    const result = trenchVolume({
      length: 30,
      bottomWidth: 0.8,
      depth: 1.2,
      batter: 0,
      bulking: 0,
      returnsSpoil: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crossSection).toBeCloseTo(0.96, 4);
    expect(result.topWidth).toBeCloseTo(0.8, 3);
    expect(result.excavation).toBeCloseTo(28.8, 3);
    expect(result.surplus).toBe(0); // no pipe, no bedding
  });

  it("battered trench with pipe and bedding, spoil returned: 1.3200 m², 39.600 m³, 34.862 m³ backfill, 5.922 m³ to cart", () => {
    // A = 1.20×(0.80+0.25×1.20) = 1.20×1.10 = 1.3200 m²; top = 0.80+0.60 = 1.400 m.
    // V_excavation = 39.600 m³.
    // V_pipe = (π/4)×0.315²×30 = 0.7853981634×0.099225×30 = 2.338 m³.
    // V_bedding = 0.80×0.10×30 = 2.400 m³.
    // backfill = 39.600−2.338−2.400 = 34.862 m³; surplus (in situ) = 4.738 m³;
    // loose at 25% bulking = 4.738×1.25 = 5.9225 → 5.922 m³ (3 dp).
    const result = trenchVolume({
      length: 30,
      bottomWidth: 0.8,
      depth: 1.2,
      batter: 0.25,
      pipeDiameter: 0.315,
      beddingThickness: 0.1,
      bulking: 25,
      returnsSpoil: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crossSection).toBeCloseTo(1.32, 4);
    expect(result.topWidth).toBeCloseTo(1.4, 3);
    expect(result.excavation).toBeCloseTo(39.6, 3);
    expect(result.pipe).toBeCloseTo(2.338, 3);
    expect(result.bedding).toBeCloseTo(2.4, 3);
    expect(result.backfill).toBeCloseTo(34.862, 3);
    expect(result.surplus).toBeCloseTo(4.738, 3);
    expect(result.surplusLoose).toBeCloseTo(5.922, 3);
  });

  it("when the spoil does NOT return, the entire excavation is the surplus, not just bedding+pipe", () => {
    const result = trenchVolume({
      length: 30,
      bottomWidth: 0.8,
      depth: 1.2,
      batter: 0.25,
      pipeDiameter: 0.315,
      beddingThickness: 0.1,
      bulking: 25,
      returnsSpoil: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backfill).toBe(0);
    expect(result.surplus).toBeCloseTo(39.6, 3); // = excavation, not 4.738
    expect(result.surplusLoose).toBeCloseTo(49.5, 3); // 39.6 × 1.25
  });

  it("derives the bottom width from the pipe diameter and a working-space allowance, agreeing with typing it directly", () => {
    // 0.315 + 2×0.2425 = 0.315 + 0.485 = 0.800 m — the same 0.80 m as above.
    const derived = trenchVolume({
      length: 30,
      depth: 1.2,
      batter: 0.25,
      pipeDiameter: 0.315,
      workingSpace: 0.2425,
      beddingThickness: 0.1,
      bulking: 25,
      returnsSpoil: true,
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.topWidth).toBeCloseTo(1.4, 3);
    expect(derived.excavation).toBeCloseTo(39.6, 3);
  });

  it("refuses a pipe wider than the trench bottom, and a bedding at or past the full depth", () => {
    expect(
      trenchVolume({
        length: 10,
        bottomWidth: 0.5,
        depth: 1,
        batter: 0,
        pipeDiameter: 0.6,
        bulking: 0,
        returnsSpoil: true,
      }),
    ).toEqual({ ok: false, reason: "pipeDiameter" });
    expect(
      trenchVolume({
        length: 10,
        bottomWidth: 0.8,
        depth: 1,
        batter: 0,
        beddingThickness: 1,
        bulking: 0,
        returnsSpoil: true,
      }),
    ).toEqual({ ok: false, reason: "beddingThickness" });
  });

  it("refuses when neither a bottom width nor a pipe diameter + working space is given", () => {
    expect(
      trenchVolume({ length: 10, depth: 1, batter: 0, bulking: 0, returnsSpoil: true }),
    ).toEqual({ ok: false, reason: "bottomWidth" });
  });

  it("refuses a pipe and bedding that together do not fit inside the depth", () => {
    // depth = 0.5, bedding = 0.4, pipe = 1.0 → 0.4+1.0 = 1.4 m, almost triple
    // the 0.5 m depth. Each guard alone would pass this (bedding 0.4 < depth
    // 0.5; pipe 1.0 <= bottomWidth 1.0), so only the SUM catches it — without
    // this guard backfill = excavation − bedding − pipe = 5.000 − 4.000 −
    // 7.854 = −6.854 m³, an impossible trench reported as ok:true.
    expect(
      trenchVolume({
        length: 10,
        bottomWidth: 1,
        depth: 0.5,
        batter: 0,
        pipeDiameter: 1,
        beddingThickness: 0.4,
        bulking: 0,
        returnsSpoil: true,
      }),
    ).toEqual({ ok: false, reason: "beddingThickness" });
  });
});

/* ---------------------------------------------------------------------------
 * wall-u-value
 * ------------------------------------------------------------------------ */

describe("wallAssembly", () => {
  it("four-layer wall: R_uk = 3.382208 m²K/W, U = 0.2957 W/(m²K), EPS carries 79.9% of the resistance", () => {
    // Rsi=0.13, Rse=0.04. Layers: 0.02/0.87=0.022989; 0.25/0.52=0.480769;
    // 0.10/0.037=2.702703; 0.005/0.87=0.005747. Sum=3.212208.
    // R_uk = 0.13+3.212208+0.04 = 3.382208; U = 1/3.382208 = 0.2957.
    // EPS share = 2.702703/3.382208 = 0.7991 → 79.9%.
    const result = wallAssembly({
      layers: [
        { thickness: 0.02, conductivity: 0.87 },
        { thickness: 0.25, conductivity: 0.52 },
        { thickness: 0.1, conductivity: 0.037 },
        { thickness: 0.005, conductivity: 0.87 },
      ],
      rsi: 0.13,
      rse: 0.04,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalResistance).toBeCloseTo(3.382208, 5);
    expect(result.uValue).toBeCloseTo(0.2957, 4);
    expect(result.layers[2]?.share).toBeCloseTo(79.9, 1);
  });

  it("single-layer control: R_uk = 0.370000 exactly, U = 2.7027, surface temperatures 11.216°C / −2.297°C", () => {
    // R = 0.20/1.00 = 0.200000; R_uk = 0.13+0.20+0.04 = 0.370000 exactly.
    // U = 1/0.37 = 2.7027. Drop = 20−(−5) = 25 K.
    // Inner surface = 20 − (0.13/0.37)×25 = 20 − 8.783784 = 11.216°C.
    // Outer surface = −5 + (0.04/0.37)×25 = −5 + 2.702703 = −2.297°C.
    const result = wallAssembly({
      layers: [{ thickness: 0.2, conductivity: 1.0 }],
      rsi: 0.13,
      rse: 0.04,
      insideTemperature: 20,
      outsideTemperature: -5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalResistance).toBeCloseTo(0.37, 6);
    expect(result.uValue).toBeCloseTo(2.7027, 4);
    expect(result.innerSurfaceTemperature).toBeCloseTo(11.216, 2);
    expect(result.outerSurfaceTemperature).toBeCloseTo(-2.297, 2);
  });

  it("an unventilated air layer is entered as a ready-made resistance, never divided by a thickness", () => {
    const result = wallAssembly({
      layers: [
        { thickness: 0.1, conductivity: 0.5 },
        { resistance: 0.18 }, // the air layer — no thickness, no conductivity
      ],
      rsi: 0.13,
      rse: 0.04,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers[1]?.resistance).toBe(0.18);
  });

  it("gives no temperature profile without both temperatures, but still gives R and U", () => {
    const result = wallAssembly({
      layers: [{ thickness: 0.2, conductivity: 1.0 }],
      rsi: 0.13,
      rse: 0.04,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uValue).toBeCloseTo(2.7027, 4);
    expect(result.innerSurfaceTemperature).toBeUndefined();
    expect(result.layers[0]?.boundaryTemperature).toBeUndefined();
  });

  it("refuses a non-positive thickness or conductivity, named by row, and an out-of-range Rsi", () => {
    expect(
      wallAssembly({ layers: [{ thickness: 0, conductivity: 1 }], rsi: 0.13, rse: 0.04 }),
    ).toEqual({ ok: false, reason: "thickness:0" });
    expect(
      wallAssembly({ layers: [{ thickness: 0.1, conductivity: 0 }], rsi: 0.13, rse: 0.04 }),
    ).toEqual({ ok: false, reason: "conductivity:0" });
    expect(
      wallAssembly({ layers: [{ thickness: 0.1, conductivity: 1 }], rsi: 1.5, rse: 0.04 }),
    ).toEqual({ ok: false, reason: "rsi" });
  });
});

describe("a union value is a claim, not a fact — the table is asked at runtime", () => {
  type ScaleFitInput = Parameters<typeof drawingScaleFit>[0];

  it("drawingScaleFit refuses a sheet size outside the table rather than indexing it and throwing", () => {
    const good: ScaleFitInput = {
      denominator: 100,
      objectWidth: 3,
      objectHeight: 2,
      sheet: "A3",
      orientation: "landscape",
      margin: 10,
    };
    // The cast is the test: TypeScript forbids this value, the renderer is not
    // obliged to honour that, and the function must refuse rather than throw.
    const bad: ScaleFitInput = { ...good, sheet: "A5" as ScaleFitInput["sheet"] };
    expect(drawingScaleFit(bad)).toEqual({ ok: false, reason: "sheet" });
    expect(drawingScaleFit(good).ok).toBe(true);
  });
});
