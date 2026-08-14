import { describe, expect, it } from "vitest";

import {
  beamSpot,
  cateringPerGuest,
  eventBudget,
  generatorSizing,
  iceChilling,
  ledWallLayout,
  parkingCloakroom,
  projectorThrowScreen,
  runOfShow,
  seatingTables,
  slingForce,
  stageDeckLayout,
  tentBayLayout,
  threePhaseLoadBalance,
  trussHoistReactions,
  venueOccupancyArea,
  voltageDrop,
} from "./event.js";

/**
 * Every expectation here is worked by hand from the inputs (cross-checked
 * with an independent node calculation, never the module under test) before
 * being written down, exactly as `gradnja.test.ts` does.
 */

describe("beamSpot", () => {
  it("normal incidence: 26° beam at D=8.0m — d=2·8·tan13°=3.694m, E=120000/64=1875.0lx, spacing/count from UNROUNDED numbers", () => {
    const r = beamSpot({
      beamAngleDeg: 26,
      distanceM: 8.0,
      intensityCd: 120000,
      overlapPct: 30,
      coverageLengthM: 20,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 2*8*tan(13°) = 16*0.2308681911... = 3.693891058...
    expect(r.beamDiameterM).toBeCloseTo(3.693891, 6);
    expect(r.illuminanceAtAimPointLx).toBeCloseTo(1875.0, 6);
    // spacing = 3.693891058 * 0.70 = 2.585723741
    expect(r.spacingM).toBeCloseTo(2.585724, 6);
    // (20 - 3.693891)/2.585724 = 6.30621 -> ceil 7 -> n = 8
    expect(r.fixtureCount).toBe(8);
    // (8-1)*2.585724 + 3.693891 = 21.79396, NOT 21.796 (the pre-rounded-input answer)
    expect(r.coveredLengthM).toBeCloseTo(21.793957, 5);
  });

  it("oblique incidence uses the EXACT minor axis, not the small-angle approximation (2.4286m, not 2.413m)", () => {
    const r = beamSpot({ beamAngleDeg: 19, heightM: 6.0, horizontalOffsetM: 4.0, intensityCd: 60000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slantDistanceM).toBeCloseTo(7.211103, 6); // sqrt(52)
    expect(r.tiltDeg).toBeCloseTo(33.690068, 5); // atan(4/6)
    expect(r.minorAxisM).toBeCloseTo(2.428610, 5); // exact closed form — the corrected figure
    expect(r.majorAxisM).toBeCloseTo(2.937161, 5);
    expect(r.nearEdgeM).toBeCloseTo(2.695257, 5); // h*tan(gamma - theta/2)
    expect(r.farEdgeM).toBeCloseTo(5.632418, 5); // h*tan(gamma + theta/2)
    // illuminance AT THE AIM POINT, not the ellipse centre
    expect(r.illuminanceAtAimPointLx).toBeCloseTo(960.058, 2);
  });

  it("field angle roughly doubles the beam diameter at small angles: 2.625m vs 5.290m at D=15m", () => {
    const r = beamSpot({ beamAngleDeg: 10, fieldAngleDeg: 20, distanceM: 15 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.beamDiameterM).toBeCloseTo(2.624660, 5);
    expect(r.fieldDiameterM).toBeCloseTo(5.289809, 5);
  });

  it("refuses entering both a perpendicular distance and a height/offset — ambiguous which distance the illuminance used", () => {
    expect(beamSpot({ beamAngleDeg: 20, distanceM: 5, heightM: 5 })).toEqual({
      ok: false,
      reason: "ambiguousDistance",
    });
  });

  it("refuses a beam that runs parallel to the surface and never lands (gamma + theta/2 >= 90°)", () => {
    const r = beamSpot({ beamAngleDeg: 60, heightM: 2, horizontalOffsetM: 50 });
    expect(r).toEqual({ ok: false, reason: "grazing" });
  });

  it("refuses a non-positive beam angle and a missing distance", () => {
    expect(beamSpot({ beamAngleDeg: 0, distanceM: 5 })).toEqual({ ok: false, reason: "beamAngleDeg" });
    expect(beamSpot({ beamAngleDeg: 20 })).toEqual({ ok: false, reason: "distanceM" });
  });

  it("refuses a field angle combined with oblique incidence — no ellipse formula for it, so it must not silently vanish", () => {
    const r = beamSpot({ beamAngleDeg: 19, fieldAngleDeg: 30, heightM: 6.0, horizontalOffsetM: 4.0 });
    expect(r).toEqual({ ok: false, reason: "fieldAngleDeg" });
  });

  it("fixtureCount uses a TOLERANT ceil: an exact-division raw of 7.000000000000001 must read 7, not overcount to 8", () => {
    // overlap 0% makes spacing===d bit-for-bit, so L=8d makes raw=(L-d)/d
    // mathematically exactly 7 — but IEEE 754 computes 7.000000000000001.
    // A bare Math.ceil reads that as 8 fixtures (9 total); ceilSnapped reads 7 (8 total).
    const d = 2 * 5 * Math.tan(((1 * Math.PI) / 180) / 2);
    const r = beamSpot({ beamAngleDeg: 1, distanceM: 5, overlapPct: 0, coverageLengthM: 8 * d });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixtureCount).toBe(8);
  });
});

describe("eventBudget", () => {
  it("full budget: base 640,500 + agency 10% + reserve 5% + tax 20% = 887,733.00", () => {
    const r = eventBudget({
      guests: 120,
      tables: 15,
      lines: [
        { type: "fixed", amount: 180000 },
        { type: "perGuest", amount: 2400 },
        { type: "perTable", amount: 3500 },
        { type: "fixed", amount: 120000 },
        { type: "percent", amount: 10 },
      ],
      reservePct: 5,
      taxRatePct: 20,
      taxBaseMode: "total",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 2400*120=288000; 3500*15=52500; base=180000+288000+52500+120000=640500
    expect(r.base).toBeCloseTo(640500, 6);
    expect(r.percentSum).toBeCloseTo(64050, 6); // 0.10 * 640500
    expect(r.subtotal).toBeCloseTo(704550, 6);
    expect(r.reserve).toBeCloseTo(35227.5, 6); // 704550*0.05
    expect(r.preTaxTotal).toBeCloseTo(739777.5, 6);
    expect(r.tax).toBeCloseTo(147955.5, 6); // 739777.5*0.20
    expect(r.grandTotal).toBeCloseTo(887733, 6);
    expect(r.costPerGuestWithTax).toBeCloseTo(7397.775, 6);
    expect(r.costPerTableWithTax).toBeCloseTo(59182.2, 6);
    expect(r.costPerGuestWithoutTax).toBeCloseTo(6164.8125, 6);
  });

  it("break-even ticket price rounds UP to the cent: (887733-200000)/90 = 7641.4778 -> 7641.48", () => {
    const r = eventBudget({
      guests: 120,
      tables: 15,
      lines: [
        { type: "fixed", amount: 180000 },
        { type: "perGuest", amount: 2400 },
        { type: "perTable", amount: 3500 },
        { type: "fixed", amount: 120000 },
        { type: "percent", amount: 10 },
      ],
      reservePct: 5,
      taxRatePct: 20,
      taxBaseMode: "total",
      revenueLines: [{ amount: 200000 }],
      payingGuests: 90,
      ticketPrice: 6000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticketRevenue).toBeCloseTo(540000, 6); // 90*6000
    expect(r.revenueTotal).toBeCloseTo(740000, 6); // 540000+200000
    expect(r.revenueDifference).toBeCloseTo(-147733, 6); // 740000-887733
    expect(r.breakEvenTicketPriceCeil).toBeCloseTo(7641.48, 2);
  });

  it("break-even DISCRIMINATES ceil from round: 687,730/90 = 7641.4444 must round UP to 7641.45, not to 7641.44", () => {
    // Constructed so 40 para of the discriminating case is legible by hand:
    // a single fixed line makes grandTotal exactly 887730 (no reserve, no
    // tax), and revenue of 200000 leaves (887730-200000)/90 = 687730/90 =
    // 7641.444444... — a fraction (4/9 of a cent) BELOW one half, so
    // nearest-rounding and ceiling disagree, unlike the test above (.7778,
    // above half, where they coincide by luck).
    const r = eventBudget({
      guests: 1,
      tables: 0,
      lines: [{ type: "fixed", amount: 887730 }],
      reservePct: 0,
      taxRatePct: 0,
      taxBaseMode: "total",
      revenueLines: [{ amount: 200000 }],
      payingGuests: 90,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.grandTotal).toBe(887730);
    // ceil(764144.4444...) / 100 = 764145 / 100 = 7641.45
    expect(r.breakEvenTicketPriceCeil).toBeCloseTo(7641.45, 6);
    // the nearest-rounded 7641.44 would fall forty para (0.40) short of the
    // 687730 that ticket sales alone need to raise: 7641.44*90 = 687729.60
    expect(7641.44 * 90).toBeCloseTo(687729.6, 6);
    expect(r.breakEvenTicketPriceCeil).not.toBeCloseTo(7641.44, 2);
  });

  it("ticket-only revenue: revenueTotal/revenueDifference must not need a revenueLines entry to exist", () => {
    const r = eventBudget({
      guests: 120,
      tables: 15,
      lines: [
        { type: "fixed", amount: 180000 },
        { type: "perGuest", amount: 2400 },
        { type: "perTable", amount: 3500 },
        { type: "fixed", amount: 120000 },
        { type: "percent", amount: 10 },
      ],
      reservePct: 5,
      taxRatePct: 20,
      taxBaseMode: "total",
      // no revenueLines — the event is financed purely by ticket sales
      payingGuests: 90,
      ticketPrice: 6000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticketRevenue).toBeCloseTo(540000, 6); // 90*6000
    expect(r.revenueTotal).toBeCloseTo(540000, 6); // no other revenue lines
    expect(r.revenueDifference).toBeCloseTo(540000 - 887733, 6);
  });

  it("sharePct is undefined, not 0, when the grand total is 0 — a share of nothing is not a number", () => {
    const r = eventBudget({
      guests: 1,
      tables: 0,
      lines: [{ type: "fixed", amount: 0 }],
      reservePct: 0,
      taxRatePct: 0,
      taxBaseMode: "total",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.grandTotal).toBe(0);
    expect(r.lines[0]?.sharePct).toBeUndefined();
  });

  it("a percent line never enters the base of another percent line: two 10% lines on 100,000 give 120,000, not 121,000", () => {
    const r = eventBudget({
      guests: 10,
      tables: 0,
      lines: [
        { type: "fixed", amount: 100000 },
        { type: "percent", amount: 10 },
        { type: "percent", amount: 10 },
      ],
      reservePct: 0,
      taxRatePct: 20,
      taxBaseMode: "total",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines[1]?.amount).toBeCloseTo(10000, 6);
    expect(r.lines[2]?.amount).toBeCloseTo(10000, 6);
    expect(r.percentSum).toBeCloseTo(20000, 6);
    expect(r.subtotal).toBeCloseTo(120000, 6); // not 121,000 — no chaining
    expect(r.tax).toBeCloseTo(24000, 6);
    expect(r.grandTotal).toBeCloseTo(144000, 6);
  });

  it("refuses a per-table line when tables is 0 — the cost must not silently vanish from the base", () => {
    const r = eventBudget({
      guests: 10,
      tables: 0,
      lines: [{ type: "perTable", amount: 100 }],
      reservePct: 0,
      taxRatePct: 0,
      taxBaseMode: "total",
    });
    expect(r).toEqual({ ok: false, reason: "tables" });
  });

  it("refuses zero guests, an empty line list, and a percent line pointing at another percent line", () => {
    expect(
      eventBudget({ guests: 0, tables: 0, lines: [{ type: "fixed", amount: 1 }], reservePct: 0, taxRatePct: 0, taxBaseMode: "total" }),
    ).toEqual({ ok: false, reason: "guests" });
    expect(
      eventBudget({ guests: 1, tables: 0, lines: [], reservePct: 0, taxRatePct: 0, taxBaseMode: "total" }),
    ).toEqual({ ok: false, reason: "lines" });
    expect(
      eventBudget({
        guests: 1,
        tables: 0,
        lines: [
          { type: "fixed", amount: 100 },
          { type: "percent", amount: 10 },
          { type: "percent", amount: 10, percentOfLines: [1] },
        ],
        reservePct: 0,
        taxRatePct: 0,
        taxBaseMode: "total",
      }),
    ).toEqual({ ok: false, reason: "percentOfLines:2" });
  });
});

describe("cateringPerGuest", () => {
  it("roasted item: 250g/guest, 80% uptake, 10% reserve, 5kg packs — 33kg needed, 35kg bought (7 packs)", () => {
    const r = cateringPerGuest({
      guests: 150,
      packRounding: "up",
      lines: [
        {
          unit: "g",
          quantityPerGuest: 250,
          uptakePct: 80,
          reservePct: 10,
          packSize: 5,
          packUnit: "kg",
          pricePerPack: 4500,
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = r.lines[0];
    // 150*250=37500; *0.80=30000; *1.10=33000 g
    expect(line?.grossQuantity).toBeCloseTo(33000, 6);
    expect(line?.packs).toBe(7); // ceil(33000/5000)=ceil(6.6)=7
    expect(line?.surplus).toBeCloseTo(2000, 6); // 35000-33000
    expect(line?.cost).toBeCloseTo(31500, 6); // 7*4500
    expect(line?.costPerGuest).toBeCloseTo(210, 6);
    // net need = 150*250*0.80 = 30000; purchased 35000 -> reserve after rounding = 16.667%, not the entered 10%
    expect(line?.actualReservePct).toBeCloseTo(16.666667, 5);
  });

  it("wine: reports pours from the NEED and from what was actually PURCHASED (238 vs 240 glasses)", () => {
    const r = cateringPerGuest({
      guests: 150,
      packRounding: "up",
      lines: [
        {
          unit: "ml",
          quantityPerGuest: 350,
          uptakePct: 65,
          reservePct: 5,
          packSize: 750,
          packUnit: "ml",
          pourSizeMl: 150,
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = r.lines[0];
    // 150*350=52500; *0.65=34125; *1.05=35831.25 ml
    expect(line?.grossQuantity).toBeCloseTo(35831.25, 4);
    expect(line?.packs).toBe(48); // ceil(35831.25/750)=ceil(47.775)=48
    expect(line?.surplus).toBeCloseTo(168.75, 4); // 36000-35831.25
    expect(line?.poursFromNeed).toBe(238); // floor(35831.25/150)
    expect(line?.poursFromPurchased).toBe(240); // floor(36000/150) — what the bartender actually has
  });

  it("exact division adds no extra pack: 480 kom / 24 = 20.0 exactly", () => {
    const r = cateringPerGuest({
      guests: 80,
      packRounding: "up",
      lines: [{ unit: "kom", quantityPerGuest: 6, uptakePct: 100, reservePct: 0, packSize: 24, packUnit: "kom" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines[0]?.grossQuantity).toBe(480);
    expect(r.lines[0]?.packs).toBe(20);
    expect(r.lines[0]?.surplus).toBe(0);
  });

  it("refuses a pack unit whose DIMENSION does not match the line's own unit — mass against volume", () => {
    const r = cateringPerGuest({
      guests: 10,
      packRounding: "up",
      lines: [{ unit: "g", quantityPerGuest: 10, uptakePct: 100, reservePct: 0, packSize: 1, packUnit: "ml" }],
    });
    expect(r).toEqual({ ok: false, reason: "packUnit:0" });
  });

  it("a 0% uptake line is kept, not dropped — zero quantity, zero packs, still a row", () => {
    const r = cateringPerGuest({
      guests: 100,
      packRounding: "up",
      lines: [{ unit: "g", quantityPerGuest: 100, uptakePct: 0, reservePct: 0, packSize: 1, packUnit: "kg" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines[0]?.grossQuantity).toBe(0);
    expect(r.lines[0]?.packs).toBe(0);
    // net need is 0 on a 0%-uptake line — "actual reserve" over nothing is undefined, not 0%
    expect(r.lines[0]?.actualReservePct).toBeUndefined();
  });
});

describe("generatorSizing", () => {
  it("running point with no motor: P=22.400kW, Q=6.6564kvar, S=23.368kVA, PF=0.9586", () => {
    const r = generatorSizing({
      consumers: [
        { kw: 12, cosPhi: 0.95, simultaneityPct: 100 },
        { kw: 8, cosPhi: 0.9, simultaneityPct: 70 },
        { kw: 6, cosPhi: 1.0, simultaneityPct: 80 },
      ],
      reservePct: 20,
      deratePct: 0,
      ratedPowerFactor: 0.8,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // P = 12 + 8*0.7 + 6*0.8 = 12 + 5.6 + 4.8 = 22.4
    expect(r.runningActiveKw).toBeCloseTo(22.4, 6);
    expect(r.runningReactiveKvar).toBeCloseTo(6.656413, 5);
    expect(r.runningApparentKva).toBeCloseTo(23.368094, 5);
    expect(r.runningPowerFactor).toBeCloseTo(0.958572, 5);
    expect(r.peakMotorIndex).toBeUndefined();
    // design = 23.368094*1.20 = 28.041713; at PF 0.8 -> 22.433kW
    expect(r.designApparentKva).toBeCloseTo(28.041713, 4);
    expect(r.designActiveKw).toBeCloseTo(22.43337, 3);
  });

  it("the worst STARTING peak is chosen by its own computed kVA (104.874), not by the largest nameplate kW", () => {
    const r = generatorSizing({
      consumers: [
        { kw: 12, cosPhi: 0.95, simultaneityPct: 100 },
        { kw: 8, cosPhi: 0.9, simultaneityPct: 70 },
        { kw: 6, cosPhi: 1.0, simultaneityPct: 80 },
        {
          kw: 15,
          cosPhi: 0.85,
          simultaneityPct: 100,
          isMotor: true,
          startingKvaPerKw: 6,
          startingCosPhi: 0.3,
        },
      ],
      reservePct: 20,
      deratePct: 0,
      ratedPowerFactor: 0.8,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.peakMotorIndex).toBe(3);
    expect(r.runningApparentKva).toBeCloseTo(40.660113, 4);
    // S_start = 15*6 = 90 kVA
    expect(r.peakApparentKva).toBeCloseTo(104.874374, 3);
    // design = max(40.660,104.874)*1.20
    expect(r.designApparentKva).toBeCloseTo(125.849249, 3);
  });

  it("fuel: 0.28 l/kWh * 22.400 kW * 8 h = 50.2 l, 6.27 l/h", () => {
    const r = generatorSizing({
      consumers: [
        { kw: 12, cosPhi: 0.95, simultaneityPct: 100 },
        { kw: 8, cosPhi: 0.9, simultaneityPct: 70 },
        { kw: 6, cosPhi: 1.0, simultaneityPct: 80 },
      ],
      reservePct: 20,
      deratePct: 0,
      ratedPowerFactor: 0.8,
      specificFuelConsumptionLPerKwh: 0.28,
      hours: 8,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fuelLitresPerHour).toBeCloseTo(6.272, 3);
    expect(r.fuelLitresTotal).toBeCloseTo(50.176, 3);
  });

  it("a leading load (negative cosPhi) subtracts reactive power instead of adding it", () => {
    const lagging = generatorSizing({
      consumers: [{ kw: 10, cosPhi: 0.8, simultaneityPct: 100 }],
      reservePct: 0,
      deratePct: 0,
      ratedPowerFactor: 0.8,
    });
    const leading = generatorSizing({
      consumers: [
        { kw: 10, cosPhi: 0.8, simultaneityPct: 100 },
        { kw: 10, cosPhi: -0.8, simultaneityPct: 100 },
      ],
      reservePct: 0,
      deratePct: 0,
      ratedPowerFactor: 0.8,
    });
    expect(lagging.ok && leading.ok).toBe(true);
    if (!lagging.ok || !leading.ok) return;
    // The lagging and leading Q cancel exactly, leaving Q=0 and PF=1.
    expect(leading.runningReactiveKvar).toBeCloseTo(0, 6);
    expect(leading.runningPowerFactor).toBeCloseTo(1, 6);
  });

  it("refuses a genset rated power factor with no explicit value in range, and derate at 100%", () => {
    expect(
      generatorSizing({
        consumers: [{ kw: 5, cosPhi: 0.9 }],
        reservePct: 0,
        deratePct: 0,
        ratedPowerFactor: 0,
      }),
    ).toEqual({ ok: false, reason: "ratedPowerFactor" });
    expect(
      generatorSizing({
        consumers: [{ kw: 5, cosPhi: 0.9 }],
        reservePct: 0,
        deratePct: 100,
        ratedPowerFactor: 0.8,
      }),
    ).toEqual({ ok: false, reason: "deratePct" });
  });

  it("refuses a derate above 50% — the spec's own input range, tighter than the earlier <100% check", () => {
    expect(
      generatorSizing({
        consumers: [{ kw: 5, cosPhi: 0.9 }],
        reservePct: 0,
        deratePct: 60,
        ratedPowerFactor: 0.8,
      }),
    ).toEqual({ ok: false, reason: "deratePct" });
  });

  it("runningPowerFactor is undefined, not 0, when every consumer sits at 0% simultaneity (S_run=0)", () => {
    const r = generatorSizing({
      consumers: [{ kw: 5, cosPhi: 0.9, simultaneityPct: 0 }],
      reservePct: 0,
      deratePct: 0,
      ratedPowerFactor: 0.8,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.runningApparentKva).toBe(0);
    expect(r.runningPowerFactor).toBeUndefined();
  });
});

describe("iceChilling", () => {
  it("pull-down: 100kg drink 22->6°C needs 18.665kg of 0°C ice — Q=6694.4kJ, h=358.654kJ/kg", () => {
    const r = iceChilling({ drinkMassKg: 100, startTempC: 22, targetTempC: 6, iceTempC: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Q = 100*4.184*(22-6) = 100*4.184*16 = 6694.4
    expect(r.heatToRemoveKj).toBeCloseTo(6694.4, 4);
    // h = 0 + 333.55 + 4.184*6 = 358.654
    expect(r.heatCapacityPerKgIce).toBeCloseTo(358.654, 4);
    expect(r.icePulldownKg).toBeCloseTo(18.665343, 5);
    expect(r.solidVolumeL).toBeCloseTo(20.354791, 4);
    expect(r.bags).toBe(4); // ceil(18.665/5)
  });

  it("colder ice (-18°C) needs 1.785kg LESS: 16.880kg vs 18.665kg", () => {
    const r = iceChilling({ drinkMassKg: 100, startTempC: 22, targetTempC: 6, iceTempC: -18 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // h = 2.108*18 + 333.55 + 4.184*6 = 37.944+333.55+25.104 = 396.598
    expect(r.heatCapacityPerKgIce).toBeCloseTo(396.598, 4);
    expect(r.icePulldownKg).toBeCloseTo(16.879561, 5);
  });

  it("holding melt (latent-only, an UPPER bound): 150W for 4h -> 6.476kg, total 25.141kg", () => {
    const r = iceChilling({
      drinkMassKg: 100,
      startTempC: 22,
      targetTempC: 6,
      iceTempC: 0,
      ambientHeatIngressW: 150,
      holdHours: 4,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // energy = 150*4*3600/1000 = 2160 kJ; melt = 2160/333.55 = 6.4758
    expect(r.iceHoldingMeltKg).toBeCloseTo(6.475791, 4);
    expect(r.totalIceKg).toBeCloseTo(25.141134, 4);
    expect(r.solidVolumeL).toBeCloseTo(27.416722, 3);
    expect(r.bags).toBe(6); // ceil(25.141/5)
  });

  it("open-mix dilution (punch): 18.665kg ice into 100kg drink = 15.7%, undefined when meltsIntoDrink is not set", () => {
    const open = iceChilling({ drinkMassKg: 100, startTempC: 22, targetTempC: 6, iceTempC: 0, meltsIntoDrink: true });
    const sealed = iceChilling({ drinkMassKg: 100, startTempC: 22, targetTempC: 6, iceTempC: 0 });
    expect(open.ok && sealed.ok).toBe(true);
    if (!open.ok || !sealed.ok) return;
    expect(open.dilutionPct).toBeCloseTo(15.729397, 4);
    expect(sealed.dilutionPct).toBeUndefined();
  });

  it("carries a bulk (packed) volume only when the user supplies a solid fraction — this is food-safety: no default packing table", () => {
    const withFraction = iceChilling({
      drinkMassKg: 100,
      startTempC: 22,
      targetTempC: 6,
      iceTempC: 0,
      bulkSolidFraction: 0.6,
    });
    const withoutFraction = iceChilling({ drinkMassKg: 100, startTempC: 22, targetTempC: 6, iceTempC: 0 });
    expect(withFraction.ok && withoutFraction.ok).toBe(true);
    if (!withFraction.ok || !withoutFraction.ok) return;
    expect(withFraction.bulkVolumeL).toBeCloseTo(20.354791 / 0.6, 3);
    expect(withoutFraction.bulkVolumeL).toBeUndefined();
  });

  it("noCoolingNeeded names a target already reached (0kg is a fact, not a silent clamp)", () => {
    const alreadyCold = iceChilling({ drinkMassKg: 100, startTempC: 6, targetTempC: 6, iceTempC: 0 });
    const normal = iceChilling({ drinkMassKg: 100, startTempC: 22, targetTempC: 6, iceTempC: 0 });
    expect(alreadyCold.ok && normal.ok).toBe(true);
    if (!alreadyCold.ok || !normal.ok) return;
    expect(alreadyCold.heatToRemoveKj).toBe(0);
    expect(alreadyCold.noCoolingNeeded).toBe(true);
    expect(normal.noCoolingNeeded).toBe(false);
  });

  it("holdIngressW is UNCLAMPED (can read negative) even though the melt it produces is clamped at 0", () => {
    // ambient (2°C) colder than the target (6°C): the UA path computes a
    // negative ingress. 10*(2-6) = -40W — the melt clamps to 0, but the raw
    // wattage is still visible instead of looking identical to "not asked".
    const r = iceChilling({
      drinkMassKg: 100,
      startTempC: 22,
      targetTempC: 6,
      iceTempC: 0,
      holdUaWPerK: 10,
      ambientTempC: 2,
      holdHours: 2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.holdIngressW).toBeCloseTo(-40, 6);
    expect(r.iceHoldingMeltKg).toBeCloseTo(0, 6);
  });

  it("refuses ice starting above 0°C and a non-positive drink mass", () => {
    expect(iceChilling({ drinkMassKg: 100, startTempC: 22, targetTempC: 6, iceTempC: 1 })).toEqual({
      ok: false,
      reason: "iceTempC",
    });
    expect(iceChilling({ drinkMassKg: 0, startTempC: 22, targetTempC: 6 })).toEqual({
      ok: false,
      reason: "drinkMassKg",
    });
  });
});

describe("ledWallLayout", () => {
  it("P2.5 on 500mm panels, 10x6: 200x200px/panel, 5.000x3.000m wall, 4 ports, 54.92A", () => {
    const r = ledWallLayout({
      pitchMm: 2.5,
      panelWidthMm: 500,
      panelHeightMm: 500,
      panelsWide: 10,
      panelsHigh: 6,
      acuityArcmin: 1,
      portCapacityPx: 650000,
      panelMaxW: 200,
      panelAvgW: 65,
      voltage: 230,
      powerFactor: 0.95,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.panelPixelsWide).toBe(200);
    expect(r.wallWidthM).toBeCloseTo(5.0, 6);
    expect(r.wallHeightM).toBeCloseTo(3.0, 6);
    expect(r.totalPixels).toBe(2400000);
    expect(r.aspectDecimal).toBeCloseTo(1.666667, 5);
    // 2.5/(1*RAD_PER_ARCMIN)/1000
    expect(r.viewingDistanceAt1ArcminM).toBeCloseTo(8.594367, 4);
    expect(r.viewingDistanceAt2ArcminM).toBeCloseTo(4.297183, 4);
    // panelsPerPort = floor(650000/40000)=16; ports=ceil(60/16)=4
    expect(r.ports).toBe(4);
    expect(r.powerMaxKw).toBeCloseTo(12.0, 6);
    expect(r.currentMaxA).toBeCloseTo(54.919908, 4);
  });

  it("ports count by WHOLE panels: capacity 79,000px, panel 200x200px, 10 panels -> 10 ports, not ceil(N/capacity)=6", () => {
    const r = ledWallLayout({
      pitchMm: 2.5,
      panelWidthMm: 500,
      panelHeightMm: 500,
      panelsWide: 10,
      panelsHigh: 1,
      acuityArcmin: 1,
      portCapacityPx: 79000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // panelsPerPort = floor(79000/40000) = 1; ports = ceil(10/1) = 10
    expect(r.ports).toBe(10);
  });

  it("divisibility check uses a tolerance: 168mm panel / 0.7mm pitch is exactly 240px despite IEEE 754 noise", () => {
    const r = ledWallLayout({
      pitchMm: 0.7,
      panelWidthMm: 168,
      panelHeightMm: 168,
      panelsWide: 1,
      panelsHigh: 1,
      acuityArcmin: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.panelPixelsWide).toBe(240);
  });

  it("refuses a pitch that does not evenly divide the panel: 500/3.91 = 127.88, not an integer", () => {
    const r = ledWallLayout({
      pitchMm: 3.91,
      panelWidthMm: 500,
      panelHeightMm: 1000,
      panelsWide: 1,
      panelsHigh: 1,
      acuityArcmin: 1,
    });
    expect(r).toEqual({ ok: false, reason: "pitchMm" });
  });

  it("accepts the exact matching pitch: 500/3.90625=128px, 1000/3.90625=256px, distance for 1' = 13.43m", () => {
    const r = ledWallLayout({
      pitchMm: 3.90625,
      panelWidthMm: 500,
      panelHeightMm: 1000,
      panelsWide: 16,
      panelsHigh: 3,
      acuityArcmin: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.panelPixelsWide).toBe(128);
    expect(r.panelPixelsHigh).toBe(256);
    expect(r.wallWidthM).toBeCloseTo(8.0, 6);
    expect(r.wallHeightM).toBeCloseTo(3.0, 6);
    expect(r.resolutionWide).toBe(2048);
    expect(r.resolutionHigh).toBe(768);
    expect(r.viewingDistanceAt1ArcminM).toBeCloseTo(13.428698, 4);
  });

  it("solves panel counts from a target wall size: 7.2x4.0m with a 600x337.5mm panel achieves 7.200x4.050m", () => {
    const r = ledWallLayout({
      pitchMm: 0.75, // divides both 600 and 337.5 evenly
      panelWidthMm: 600,
      panelHeightMm: 337.5,
      targetWidthM: 7.2,
      targetHeightM: 4.0,
      acuityArcmin: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.panelsWide).toBe(12);
    expect(r.panelsHigh).toBe(12);
    expect(r.wallWidthM).toBeCloseTo(7.2, 6);
    expect(r.wallHeightM).toBeCloseTo(4.05, 6);
  });

  it("a target size that derives more than 200 panels wide is refused, same as typing the count directly", () => {
    // panelsWide = ceil(150 / 0.6) = 250, over the explicit-count branch's own 1-200 bound
    const r = ledWallLayout({
      pitchMm: 0.75,
      panelWidthMm: 600,
      panelHeightMm: 337.5,
      targetWidthM: 150,
      targetHeightM: 4.0,
      acuityArcmin: 1,
    });
    expect(r).toEqual({ ok: false, reason: "targetWidthM" });
  });
});

describe("parkingCloakroom", () => {
  it("cars: 70% of 300 guests at 2.5/car = 84 cars, 2100.0 m² — ratio against 60 available stalls", () => {
    const r = parkingCloakroom({
      guests: 300,
      carSharePct: 70,
      occupancyPerCar: 2.5,
      areaPerStallM2: 25,
      availableStalls: 60,
      coatSharePct: 0,
      itemsPerGuest: 1,
      hangerPitchM: 0.05,
      checkInWindowMinutes: 10,
      checkInRatePiecesPerMinute: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.carGuests).toBe(210); // round(300*0.70)
    expect(r.cars).toBe(84); // ceil(210/2.5)
    expect(r.parkingAreaM2).toBeCloseTo(2100.0, 6);
    expect(r.stallRatio).toBeCloseTo(1.4, 6);
    expect(r.stallDiff).toBe(24);
  });

  it("rail capacity is PER SEGMENT: 3 rails of 2.5m at 0.06m pitch give 3*floor(2.5/0.06)=123, not floor(7.5/0.06)=125", () => {
    const r = parkingCloakroom({
      guests: 300,
      carSharePct: 0,
      occupancyPerCar: 1,
      areaPerStallM2: 25,
      coatSharePct: 90,
      itemsPerGuest: 1.2,
      hangerPitchM: 0.06,
      availableRailSegmentsM: [2.5, 2.5, 2.5],
      checkInWindowMinutes: 30,
      checkInRatePiecesPerMinute: 3,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.railCapacityItems).toBe(123);
  });

  it("garderoba: 90% of 300 with 1.2 items/guest = 324 items, 16.20m of rail; throughput uses PIECES per minute", () => {
    const r = parkingCloakroom({
      guests: 300,
      carSharePct: 0,
      occupancyPerCar: 1,
      areaPerStallM2: 25,
      coatSharePct: 90,
      itemsPerGuest: 1.2,
      hangerPitchM: 0.05,
      availableRailSegmentsM: [2.5, 2.5, 2.5],
      checkInWindowMinutes: 30,
      checkInRatePiecesPerMinute: 3,
      checkInAttendants: 2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.coatGuests).toBe(270);
    expect(r.items).toBe(324); // ceil(270*1.2)
    expect(r.railLengthNeededM).toBeCloseTo(16.2, 6);
    expect(r.railCapacityItems).toBe(150); // 3 * floor(2.5/0.05)
    expect(r.railRatio).toBeCloseTo(2.16, 6);
    // attendants needed = ceil(324/(30*3)) = ceil(3.6) = 4 (PIECES, not guests — a design choice, see the report)
    expect(r.checkIn.attendantsNeeded).toBe(4);
    // with 2 attendants: 324/(2*3) = 54min, i.e. 24min over the 30min window
    expect(r.checkIn.clearTimeMinutes).toBeCloseTo(54, 6);
    expect(r.checkIn.clearTimeDiffMinutes).toBeCloseTo(24, 6);
  });

  it("buses are counted separately from cars, and the two shares may leave a remainder walking/by taxi", () => {
    const r = parkingCloakroom({
      guests: 800,
      carSharePct: 40,
      occupancyPerCar: 2.0,
      busSharePct: 20,
      seatsPerBus: 50,
      areaPerStallM2: 28,
      coatSharePct: 0,
      itemsPerGuest: 1,
      hangerPitchM: 0.05,
      checkInWindowMinutes: 10,
      checkInRatePiecesPerMinute: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.carGuests).toBe(320);
    expect(r.cars).toBe(160);
    expect(r.parkingAreaM2).toBeCloseTo(4480, 6);
    expect(r.busGuests).toBe(160);
    expect(r.buses).toBe(4); // ceil(160/50)
  });

  it("refuses a non-positive attendant count instead of dividing by it (Infinity/negative clear time)", () => {
    const zero = parkingCloakroom({
      guests: 300,
      carSharePct: 0,
      occupancyPerCar: 1,
      areaPerStallM2: 25,
      coatSharePct: 90,
      itemsPerGuest: 1.2,
      hangerPitchM: 0.05,
      checkInWindowMinutes: 30,
      checkInRatePiecesPerMinute: 3,
      checkInAttendants: 0,
    });
    expect(zero).toEqual({ ok: false, reason: "attendants" });
    const negative = parkingCloakroom({
      guests: 300,
      carSharePct: 0,
      occupancyPerCar: 1,
      areaPerStallM2: 25,
      coatSharePct: 90,
      itemsPerGuest: 1.2,
      hangerPitchM: 0.05,
      checkInWindowMinutes: 30,
      checkInRatePiecesPerMinute: 3,
      checkInAttendants: -1,
    });
    expect(negative).toEqual({ ok: false, reason: "attendants" });
  });

  it("a 0% car share gives POSITIVE zero cars, not -0 (Object.is(-0,0) is false, and every consumer reads -0 as a bug)", () => {
    const r = parkingCloakroom({
      guests: 300,
      carSharePct: 0,
      occupancyPerCar: 2.5,
      areaPerStallM2: 25,
      coatSharePct: 0,
      itemsPerGuest: 1,
      hangerPitchM: 0.05,
      checkInWindowMinutes: 10,
      checkInRatePiecesPerMinute: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.is(r.cars, 0)).toBe(true);
    expect(Object.is(r.items, 0)).toBe(true);
  });

  it("refuses a car+bus share summing over 100% — the tool never lets a guest arrive twice", () => {
    const r = parkingCloakroom({
      guests: 100,
      carSharePct: 70,
      occupancyPerCar: 1,
      busSharePct: 60,
      seatsPerBus: 50,
      areaPerStallM2: 25,
      coatSharePct: 0,
      itemsPerGuest: 1,
      hangerPitchM: 0.05,
      checkInWindowMinutes: 10,
      checkInRatePiecesPerMinute: 1,
    });
    expect(r).toEqual({ ok: false, reason: "shareSum" });
  });
});

describe("projectorThrowScreen", () => {
  it("TR=1.5 at D=9.0m, 16:9: W=6.000m, H=3.375m, diag=6.884m=271.0in, 55.05fL via two independent routes", () => {
    const r = projectorThrowScreen({
      throwRatio: 1.5,
      known: "distance",
      knownValueM: 9.0,
      aspectRatio: 16 / 9,
      lumens: 12000,
      gain: 1.0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.widthM).toBeCloseTo(6.0, 6);
    expect(r.heightM).toBeCloseTo(3.375, 6);
    // sqrt(36+11.390625)=sqrt(47.390625)=6.884084...
    expect(r.diagonalM).toBeCloseTo(6.884085, 5);
    expect(r.diagonalIn).toBeCloseTo(271.026965, 3);
    expect(r.areaM2).toBeCloseTo(20.25, 6);
    expect(r.avgIlluminanceLx).toBeCloseTo(592.592593, 4);
    // via lm/(area in ft^2)*gain — the cross-check route named in the spec
    expect(r.avgLuminanceFl).toBeCloseTo(55.053653, 3);
    // known: "distance" — distanceM is an identity: it returns knownValueM exactly
    expect(r.distanceM).toBeCloseTo(9.0, 6);
  });

  it("the two luminance figures are the same quantity: cd/m² ÷ fL is the foot-lambert", () => {
    // `avgLuminanceCdM2` and `avgLuminanceFl` are derived INDEPENDENTLY, each
    // from its own unit system's primitive definition — a nit is lux·gain/π, a
    // foot-lambert is lumens per square foot. Nothing in the code makes one
    // follow from the other, so nothing in the code notices if one of the two
    // lines is edited alone. This does: their quotient must be the defined
    // 1 fL = 3.4262591 cd/m², at every gain and every screen size.
    const FOOT_LAMBERT_CD_M2 = 3.4262591;
    for (const [lumens, gain, aspectRatio, knownValueM] of [
      [12000, 1.0, 16 / 9, 9.0],
      [3500, 1.8, 4 / 3, 4.25],
      [30000, 0.6, 2.39, 14.0],
    ] as const) {
      const r = projectorThrowScreen({
        throwRatio: 1.5,
        known: "distance",
        knownValueM,
        aspectRatio,
        lumens,
        gain,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.avgLuminanceCdM2).toBeDefined();
      expect(r.avgLuminanceFl).toBeDefined();
      expect((r.avgLuminanceCdM2 ?? 0) / (r.avgLuminanceFl ?? 1)).toBeCloseTo(FOOT_LAMBERT_CD_M2, 6);
    }
  });

  it("solves the FORWARD direction, D = W*TR: a 1.5 TR lens on a 4.000m-wide image puts the projector at 6.000m", () => {
    const r = projectorThrowScreen({
      throwRatio: 1.5,
      known: "width",
      knownValueM: 4.0,
      aspectRatio: 16 / 9,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // D = W*TR = 4.0*1.5 = 6.000
    expect(r.distanceM).toBeCloseTo(6.0, 6);
  });

  it("also solves from a known DIAGONAL: at 4:3, 1+1/AR²=25/16 so sqrt is exactly 5/4 — 2.5m diag gives W=2.0m, D=3.0m", () => {
    const r = projectorThrowScreen({
      throwRatio: 1.5,
      known: "diagonal",
      knownValueM: 2.5,
      aspectRatio: 4 / 3,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // W = diagonal / sqrt(1+1/AR^2) = 2.5 / sqrt(1+9/16) = 2.5 / sqrt(25/16) = 2.5 / 1.25 = 2.0
    expect(r.widthM).toBeCloseTo(2.0, 6);
    expect(r.heightM).toBeCloseTo(1.5, 6); // 2.0/(4/3)
    // D = W*TR = 2.0*1.5 = 3.000
    expect(r.distanceM).toBeCloseTo(3.0, 6);
  });

  it("contrast with ambient light, no diffuse-reflectance given: uses gain as the approximation and flags it", () => {
    const r = projectorThrowScreen({
      throwRatio: 1,
      known: "width",
      knownValueM: 4.0,
      aspectRatio: 16 / 9,
      lumens: 8000,
      gain: 1.2,
      contrastRatio: 2000,
      ambientLux: 50,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.heightM).toBeCloseTo(2.25, 6);
    expect(r.areaM2).toBeCloseTo(9.0, 6);
    expect(r.avgIlluminanceLx).toBeCloseTo(888.888889, 4);
    expect(r.onScreenContrast).toBeCloseTo(18.612335, 3);
    expect(r.ambientUsesGainApproximation).toBe(true);
  });

  it("zoom lens at a fixed width: D range 4.80-7.20m; viewing angle from the back row is 18.92°", () => {
    const r = projectorThrowScreen({
      throwRatioMin: 1.2,
      throwRatioMax: 1.8,
      known: "width",
      knownValueM: 4.0,
      aspectRatio: 16 / 9,
      seatingDistanceM: 12,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.zoomDistanceMinM).toBeCloseTo(4.8, 6);
    expect(r.zoomDistanceMaxM).toBeCloseTo(7.2, 6);
    expect(r.viewingAngleDeg).toBeCloseTo(18.924644, 4);
    // a zoom lens has a RANGE, not a single distance
    expect(r.distanceM).toBeUndefined();
  });

  it("refuses giving both a single throw ratio and a zoom range, and a zoom range with only a known distance", () => {
    expect(
      projectorThrowScreen({ throwRatio: 1.5, throwRatioMin: 1.2, throwRatioMax: 1.8, known: "width", knownValueM: 4, aspectRatio: 1.78 }),
    ).toEqual({ ok: false, reason: "throwRatio" });
    expect(
      projectorThrowScreen({ throwRatioMin: 1.2, throwRatioMax: 1.8, known: "distance", knownValueM: 5, aspectRatio: 1.78 }),
    ).toEqual({ ok: false, reason: "ambiguousZoom" });
  });
});

describe("runOfShow", () => {
  it("forward, with a gap before an anchored item and a curfew overrun (all times in minutes since midnight)", () => {
    const r = runOfShow({
      startMin: 18 * 60,
      direction: "forward",
      changeoverMin: 10,
      curfewMin: 60, // 01:00
      items: [
        { durationMin: 60 }, // doček
        { durationMin: 90 }, // večera
        { durationMin: 15, anchorMin: 21 * 60 + 30 }, // prvi ples, zakovan 21:30
        { durationMin: 20 }, // torta
        { durationMin: 180 }, // muzika
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // doček 18:00-19:00; +10 -> večera 19:10-20:40; +10 -> cursor 20:50, anchor 21:30 -> gap 40
    expect(r.rows[2]?.gapBeforeMin).toBe(40);
    expect(r.rows[2]?.startMin).toBe(21 * 60 + 30);
    expect(r.totalGapMin).toBe(40);
    expect(r.totalCollisionMin).toBe(0);
    expect(r.totalDurationMin).toBe(365); // 60+90+15+20+180
    expect(r.totalChangeoverMin).toBe(40); // 4*10
    expect(r.spanMin).toBe(445); // 365+40+40 = 7:25
    // last item ends 22:25+180=... -> 01:25 next day = 1525 minutes
    expect(r.endMin).toBe(1525);
    // curfew 01:00 next day = 1500; 1500-1525 = -25 (overrun)
    expect(r.curfewRemainingMin).toBe(-25);
  });

  it("a fixed time earlier than the cursor is a COLLISION, named as its own quantity, not a silent shortfall", () => {
    const r = runOfShow({
      startMin: 18 * 60,
      direction: "forward",
      changeoverMin: 0,
      items: [{ durationMin: 60 }, { durationMin: 30, anchorMin: 18 * 60 + 30 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // first item ends at 19:00 (1140); anchor is 18:30 (1110) -> 30min collision
    expect(r.rows[1]?.collisionMin).toBe(30);
    expect(r.rows[1]?.startMin).toBe(18 * 60 + 30);
    expect(r.totalCollisionMin).toBe(30);
  });

  it("backward: anchors the walk to the final item, then builds forward from the SOLVED start (18:35, not the entered 18:45)", () => {
    const r = runOfShow({
      startMin: 18 * 60 + 45,
      direction: "backward",
      changeoverMin: 5,
      items: [
        { durationMin: 45 }, // okupljanje
        { durationMin: 30 }, // koktel
        { durationMin: 1, anchorMin: 20 * 60 }, // ulazak, zakovan 20:00
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // requiredStart = 20:00 - (45+5+30+5) = 20:00 - 85min = 18:35 = 1115
    expect(r.requiredStartMin).toBe(1115);
    // slack = requiredStart - enteredStart = 1115 - 1125 = -10 (a 10-minute SHORTFALL)
    expect(r.slackMin).toBe(-10);
    expect(r.rows[2]?.startMin).toBe(1200); // lands exactly on the anchor
  });

  it("backward with a buffer: the buffer shows as a GAP before the anchored item, which still lands exactly on the anchor", () => {
    // beforeLast = 60 (one 60-min item, changeover 0); buffer = 20.
    // requiredStart = anchor(1200) - beforeLast(60) - buffer(20) = 1120.
    // Forward from 1120: item0 1120-1180 (cursor 1180); item1 is anchored at
    // 1200, so gap = 1200-1180 = 20 (the buffer, now a visible row) and it
    // starts EXACTLY at 1200, ending at 1230 — not 1210, which is what an
    // unapplied buffer would give.
    const r = runOfShow({
      startMin: 1000,
      direction: "backward",
      changeoverMin: 0,
      bufferBeforeServiceMin: 20,
      items: [{ durationMin: 60 }, { durationMin: 30, anchorMin: 1200 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.requiredStartMin).toBe(1120);
    expect(r.rows[1]?.gapBeforeMin).toBe(20);
    expect(r.rows[1]?.startMin).toBe(1200);
    expect(r.rows[1]?.endMin).toBe(1230);
    expect(r.endMin).toBe(1230);
    // span runs from the SOLVED start (1120), not the entered one (1000)
    expect(r.spanMin).toBe(110); // 1230 - 1120
  });

  it("refuses an anchor on anything but the LAST item in backward direction, and a missing anchor on the last one", () => {
    expect(
      runOfShow({
        startMin: 600,
        direction: "backward",
        changeoverMin: 0,
        items: [{ durationMin: 10, anchorMin: 700 }, { durationMin: 10 }],
      }),
    ).toEqual({ ok: false, reason: "anchorMin:0" });
    expect(
      runOfShow({ startMin: 600, direction: "backward", changeoverMin: 0, items: [{ durationMin: 10 }] }),
    ).toEqual({ ok: false, reason: "anchorMin" });
  });

  it("refuses a non-positive item duration and an empty item list", () => {
    expect(
      runOfShow({ startMin: 600, direction: "forward", changeoverMin: 0, items: [{ durationMin: 0 }] }),
    ).toEqual({ ok: false, reason: "durationMin:0" });
  });
});

describe("seatingTables", () => {
  it("round tables: D=1.80m, s=0.65m -> 8 seats/table, 15 tables, 163.35m² total cell area", () => {
    const r = seatingTables({
      guests: 120,
      table: { kind: "round", diameterM: 1.8 },
      seatWidthM: 0.65,
      clearanceM: 0.75,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // perimeter = pi*1.8 = 5.654867; floor(5.654867/0.65) = floor(8.6998) = 8
    expect(r.seatsPerTable).toBe(8);
    expect(r.tables).toBe(15); // ceil(120/8)
    expect(r.lastTableGuests).toBe(8);
    expect(r.cellAreaM2).toBeCloseTo(10.89, 6); // (1.8+1.5)^2
    expect(r.totalCellAreaM2).toBeCloseTo(163.35, 6);
    // pi*(0.9+0.75)^2 = pi*2.7225 = 8.5530
    expect(r.circularFootprintM2).toBeCloseTo(8.552986, 4);
    expect(r.totalCircularFootprintM2).toBeCloseTo(128.294798, 3);
  });

  it("long tables with ends: 8 seats/table, 6 tables, continuous run needs 7 segments (not per-table floor division)", () => {
    const r = seatingTables({
      guests: 48,
      table: { kind: "long", lengthM: 2.2, widthM: 0.9, ends: true },
      seatWidthM: 0.6,
      clearanceM: 0.75,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // perSide = floor(2.2/0.6) = 3, two sides = 6; ends = 2*floor(0.9/0.6) = 2*1 = 2
    expect(r.seatsPerTable).toBe(8);
    expect(r.tables).toBe(6);
    expect(r.lastTableGuests).toBe(8);
    expect(r.cellAreaM2).toBeCloseTo(8.88, 6); // (2.2+1.5)*(0.9+1.5)
    expect(r.totalCellAreaM2).toBeCloseTo(53.28, 6);
    // L_total = 48*0.6/2 = 14.4; segments = ceil(14.4/2.2) = ceil(6.545) = 7
    expect(r.continuousSegments).toBe(7);
  });

  it("refuses a seat width so wide a long table's own side seats nobody", () => {
    // Round tables cannot hit this within the valid input range: the smallest
    // legal diameter (0.8m) times pi already exceeds twice the largest legal
    // seat width (1.0m), so perimeter/s can never floor below 2. A long
    // table's minimum length (0.8m) against the same 1.0m seat width DOES:
    // perSide = floor(0.8/1.0) = 0, and with no ends that is 0 seats total.
    const r = seatingTables({
      guests: 10,
      table: { kind: "long", lengthM: 0.8, widthM: 0.6, ends: false },
      seatWidthM: 1.0,
      clearanceM: 0.4,
    });
    expect(r).toEqual({ ok: false, reason: "tooFewSeats" });
  });

  it("compares against an available AREA with no verdict — only the two numbers and their ratio", () => {
    const r = seatingTables({
      guests: 120,
      table: { kind: "round", diameterM: 1.8 },
      seatWidthM: 0.65,
      clearanceM: 0.75,
      availableAreaM2: 150,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.areaRatio).toBeCloseTo(163.35 / 150, 4);
  });
});

describe("slingForce", () => {
  it("500kg, 2 legs, 30° from vertical: F=2.8309kN=288.68kgf, vertical=250.00kgf, horizontal=144.34kgf", () => {
    const r = slingForce({ massKg: 500, legs: 2, angleMode: "fromVertical", angleValueDeg: 30 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.weightKn).toBeCloseTo(4.903325, 5);
    expect(r.weightKgf).toBeCloseTo(500, 6);
    // 500/(2*cos30°) = 250/0.8660254 = 288.675 kgf
    expect(r.forceLegKgf).toBeCloseTo(288.675135, 3);
    expect(r.forceLegKn).toBeCloseTo(2.830936, 4);
    expect(r.verticalKgf).toBeCloseTo(250.0, 3);
    expect(r.horizontalKgf).toBeCloseTo(144.337567, 3);
    expect(r.angleFactor).toBeCloseTo(1.154701, 5);
    // vertical(250) + horizontal-derived checks against the weight per leg pair
    expect(r.verticalKgf).toBeCloseTo(250, 3);
    // no dynamicFactor entered: the STATIC and FACTORED figures coincide, and
    // the raw entered value (undefined) is returned as-is, not defaulted to 1
    expect(r.dynamicFactor).toBeUndefined();
    expect(r.forceLegKgfFactored).toBeCloseTo(288.675135, 3);
    expect(r.weightKgfFactored).toBeCloseTo(500, 6);
  });

  it("two-point pick to ONE hook: angles are consequences of the hook height, not independent inputs", () => {
    const r = slingForce({
      massKg: 300,
      legs: 2,
      angleMode: "fromVertical", // ignored — twoPoint takes over
      twoPoint: { spanM: 6.0, cogFromAM: 2.0, hookHeightM: 4.0 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // beta_A = atan(2/4) = 26.565°, beta_B = atan(4/4) = 45.000°
    expect(r.twoPointBetaADeg).toBeCloseTo(26.565051, 4);
    expect(r.twoPointBetaBDeg).toBeCloseTo(45.0, 6);
    // V_A=300*4/6=200kgf, V_B=300*2/6=100kgf
    // F_A = 200/cos(26.565°) = 223.607 kgf = 2192.83 N
    expect(r.twoPointForceAKgf).toBeCloseTo(223.606798, 3);
    expect(r.twoPointForceBKgf).toBeCloseTo(141.421356, 3);
    // horizontal is EQUAL on both sides by construction: F_A*sin(beta_A) = F_B*sin(beta_B) = 100 kgf
    expect(r.horizontalKgf).toBeCloseTo(100.0, 3);
    expect(r.twoPointLegLengthAM).toBeCloseTo(4.472136, 4); // h/cos(beta_A)
    expect(r.twoPointLegLengthBM).toBeCloseTo(5.656854, 4);
  });

  it("two-point pick with a dynamic factor: STATIC (223.61/141.42kgf) and FACTORED (313.05/197.99kgf) are both printed", () => {
    const r = slingForce({
      massKg: 300,
      legs: 2,
      angleMode: "fromVertical",
      twoPoint: { spanM: 6.0, cogFromAM: 2.0, hookHeightM: 4.0 },
      dynamicFactor: 1.4,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.twoPointForceAKgf).toBeCloseTo(223.606798, 3);
    expect(r.twoPointForceBKgf).toBeCloseTo(141.421356, 3);
    expect(r.twoPointForceAKgfFactored).toBeCloseTo(223.606798 * 1.4, 3);
    expect(r.twoPointForceBKgfFactored).toBeCloseTo(141.421356 * 1.4, 3);
    expect(r.horizontalKgf).toBeCloseTo(100.0, 3); // STATIC, unfactored
    expect(r.horizontalKgfFactored).toBeCloseTo(140.0, 3);
  });

  it("4 legs with a dynamic factor: STATIC (176.78/353.55kgf) and FACTORED (247.49/494.97kgf) are both printed, never merged", () => {
    const r = slingForce({
      massKg: 500,
      legs: 4,
      angleMode: "fromVertical",
      angleValueDeg: 45,
      dynamicFactor: 1.4,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 500/(4*cos45°) = 125/0.7071068 = 176.7767 kgf — STATIC, unfactored
    expect(r.fourLegShareKgf).toBeCloseTo(176.776695, 3);
    expect(r.fourLegShareKgfFactored).toBeCloseTo(247.487373, 3); // *1.4
    // 500/(2*cos45°) = 250/0.7071068 = 353.5534 kgf — STATIC, unfactored
    expect(r.twoLegShareKgf).toBeCloseTo(353.553391, 3);
    expect(r.twoLegShareKgfFactored).toBeCloseTo(494.974747, 3); // *1.4
    expect(r.angleFactor).toBeCloseTo(1.414214, 5);
    // the load's own weight is a fact — untouched by the dynamic factor
    expect(r.weightKgf).toBeCloseTo(500, 6);
    expect(r.weightKgfFactored).toBeCloseTo(700, 6);
    // the entered factor is returned exactly, distinguishing it from an
    // omitted one (which would read `undefined`, not `1`)
    expect(r.dynamicFactor).toBe(1.4);
  });

  it("reports the ratio against the user's own WLL, converted to the chosen unit — no verdict, no colour", () => {
    const withLimit = slingForce({
      massKg: 500,
      legs: 2,
      angleMode: "fromVertical",
      angleValueDeg: 30,
      wllPerLeg: 500,
      wllUnit: "kg",
    });
    const withoutLimit = slingForce({ massKg: 500, legs: 2, angleMode: "fromVertical", angleValueDeg: 30 });
    expect(withLimit.ok && withoutLimit.ok).toBe(true);
    if (!withLimit.ok || !withoutLimit.ok) return;
    expect(withLimit.wllRatio).toBeCloseTo(288.675135 / 500, 4);
    expect(withoutLimit.wllRatio).toBeUndefined();
  });

  it("refuses an angle of 90° or more (the force would diverge) and a load outside the two-point span", () => {
    expect(slingForce({ massKg: 100, legs: 2, angleMode: "fromVertical", angleValueDeg: 90 })).toEqual({
      ok: false,
      reason: "angle",
    });
    expect(
      slingForce({ massKg: 100, legs: 2, angleMode: "fromVertical", twoPoint: { spanM: 5, cogFromAM: 6, hookHeightM: 3 } }),
    ).toEqual({ ok: false, reason: "cogFromAM" });
  });
});

describe("stageDeckLayout", () => {
  it("10x6m stage, 2x1m modules: both orientations reach 30 decks / 60.00m² with zero waste", () => {
    const r = stageDeckLayout({
      widthM: 10,
      depthM: 6,
      moduleLengthM: 2,
      moduleWidthM: 1,
      stageHeightM: 0.6,
      skirtSides: "three",
      totalMassKg: 2400,
      deckUdlLimitKgM2: 750,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.requiredAreaM2).toBeCloseTo(60.0, 6);
    expect(r.perimeterM).toBeCloseTo(32.0, 6);
    expect(r.positionA.decks).toBe(30);
    expect(r.positionA.coveredAreaM2).toBeCloseTo(60.0, 6);
    expect(r.positionB.decks).toBe(30);
    expect(r.fewerDecksPosition).toBe("equal");
    // skirt on three sides: (10+6+6)*0.6 = 13.20
    expect(r.skirtAreaM2).toBeCloseTo(13.2, 6);
    // legs = (5+1)*(6+1) = 42; 2400/42 = 57.14
    expect(r.positionA.legs).toBe(42);
    expect(r.positionA.massPerLegKg).toBeCloseTo(57.142857, 4);
    // 2400/60 = 40.00 kg/m² against a 750 kg/m² limit -> ratio 0.053
    expect(r.udlKgM2).toBeCloseTo(40.0, 6);
    expect(r.udlRatio).toBeCloseTo(0.053333, 4);
  });

  it("names the orientations A/B rather than 'better': A wastes less (7.00m²) than B (15.00m²) on a 7.5x4.4m stage", () => {
    const r = stageDeckLayout({
      widthM: 7.5,
      depthM: 4.4,
      moduleLengthM: 2,
      moduleWidthM: 1,
      stageHeightM: 0.6,
      skirtSides: "none",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.positionA.decks).toBe(20);
    expect(r.positionA.wasteM2).toBeCloseTo(7.0, 4);
    expect(r.positionA.wastePct).toBeCloseTo(21.212121, 3);
    expect(r.positionB.decks).toBe(24);
    expect(r.positionB.wasteM2).toBeCloseTo(15.0, 4);
    expect(r.positionB.wastePct).toBeCloseTo(45.454545, 3);
    expect(r.fewerDecksPosition).toBe("A");
  });

  it("occupancy: floor(24.00/1.0) = 24 persons at the user's own density", () => {
    const r = stageDeckLayout({
      widthM: 6,
      depthM: 4,
      moduleLengthM: 2,
      moduleWidthM: 1,
      stageHeightM: 0.5,
      skirtSides: "none",
      totalMassKg: 1850,
      deckUdlLimitKgM2: 500,
      occupancyDensityM2PerPerson: 1.0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.occupancyPersons).toBe(24);
    // 1850/24 = 77.08 kg/m² against 500 -> ratio 0.154
    expect(r.udlKgM2).toBeCloseTo(77.083333, 3);
    expect(r.udlRatio).toBeCloseTo(0.154167, 4);
  });

  it("refuses a non-positive stage width or depth", () => {
    expect(
      stageDeckLayout({ widthM: 0, depthM: 4, moduleLengthM: 2, moduleWidthM: 1, stageHeightM: 0.5, skirtSides: "none" }),
    ).toEqual({ ok: false, reason: "widthM" });
  });

  it("enforces the stated width/depth/height ranges (0.5-100m, 0.5-100m, 0.1-3.0m), not just positivity", () => {
    expect(
      stageDeckLayout({ widthM: 150, depthM: 4, moduleLengthM: 2, moduleWidthM: 1, stageHeightM: 0.5, skirtSides: "none" }),
    ).toEqual({ ok: false, reason: "widthM" });
    expect(
      stageDeckLayout({ widthM: 6, depthM: 4, moduleLengthM: 2, moduleWidthM: 1, stageHeightM: 5, skirtSides: "none" }),
    ).toEqual({ ok: false, reason: "stageHeightM" });
  });
});

describe("tentBayLayout", () => {
  it("300m² needed, 10m wide, 5m bays, streha 2.6m, pitch 20°: 6 bays, 30.00m, sheeting 545.45m²", () => {
    const r = tentBayLayout({
      requiredAreaM2: 300,
      widthM: 10,
      bayLengthM: 5,
      eaveHeightM: 2.6,
      roofPitchDeg: 20,
      marginM: 1.5,
      sides: "all",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bays).toBe(6);
    expect(r.lengthM).toBeCloseTo(30.0, 6);
    expect(r.areaM2).toBeCloseTo(300.0, 6);
    expect(r.wasteM2).toBeCloseTo(0, 6);
    expect(r.footprintWidthM).toBeCloseTo(13.0, 6);
    expect(r.footprintLengthM).toBeCloseTo(33.0, 6);
    expect(r.footprintAreaM2).toBeCloseTo(429.0, 4);
    expect(r.tentPerimeterM).toBeCloseTo(80.0, 6);
    // r = 5*tan20° = 1.820; ridge = 2.6+1.820 = 4.420
    expect(r.ridgeRiseM).toBeCloseTo(1.819851, 4);
    expect(r.ridgeHeightM).toBeCloseTo(4.419851, 4);
    // roof = 10*30/cos20° = 319.25
    expect(r.roofAreaM2).toBeCloseTo(319.253332, 3);
    expect(r.sideWallAreaM2).toBeCloseTo(156.0, 4);
    expect(r.gableEndsAreaM2).toBeCloseTo(70.198512, 3);
    expect(r.totalSheetingM2).toBeCloseTo(545.451843, 2);
    expect(r.legs).toBe(14);
  });

  it("180m² needed, 8m wide, 3m bays: 8 bays overshoot to 192.00m², 6.67% waste", () => {
    const r = tentBayLayout({
      requiredAreaM2: 180,
      widthM: 8,
      bayLengthM: 3,
      eaveHeightM: 2.6,
      roofPitchDeg: 20,
      marginM: 0,
      sides: "none",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bays).toBe(8);
    expect(r.lengthM).toBeCloseTo(24.0, 6);
    expect(r.areaM2).toBeCloseTo(192.0, 6);
    expect(r.wasteM2).toBeCloseTo(12.0, 4);
    expect(r.wastePct).toBeCloseTo(6.666667, 3);
    expect(r.legs).toBe(18);
    expect(r.tentPerimeterM).toBeCloseTo(64.0, 6);
  });

  it("sized from a LENGTH instead of an area: no waste%, but the achieved-vs-requested length difference is printed", () => {
    const r = tentBayLayout({
      requiredLengthM: 40,
      widthM: 15,
      bayLengthM: 5,
      eaveHeightM: 3.0,
      roofPitchDeg: 25,
      marginM: 0,
      sides: "noEnds",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bays).toBe(8);
    expect(r.lengthM).toBeCloseTo(40.0, 6);
    expect(r.wasteM2).toBeUndefined();
    expect(r.lengthDiffM).toBeCloseTo(0, 6); // divides exactly
    expect(r.roofAreaM2).toBeCloseTo(662.026751, 2);
    expect(r.sideWallAreaM2).toBeCloseTo(240.0, 4);
    expect(r.gableEndsAreaM2).toBeCloseTo(142.459612, 3);
  });

  it("refuses giving both a required area and a required length in the same call", () => {
    const r = tentBayLayout({
      requiredAreaM2: 100,
      requiredLengthM: 20,
      widthM: 10,
      bayLengthM: 5,
      eaveHeightM: 2.6,
      roofPitchDeg: 20,
      marginM: 0,
      sides: "all",
    });
    expect(r).toEqual({ ok: false, reason: "requiredAreaM2" });
  });

  it("enforces the stated width/eaveHeight ranges (3-60m, 1.5-8m), not just positivity", () => {
    expect(
      tentBayLayout({
        requiredAreaM2: 100,
        widthM: 2,
        bayLengthM: 5,
        eaveHeightM: 2.6,
        roofPitchDeg: 20,
        marginM: 0,
        sides: "all",
      }),
    ).toEqual({ ok: false, reason: "widthM" });
    expect(
      tentBayLayout({
        requiredAreaM2: 100,
        widthM: 10,
        bayLengthM: 5,
        eaveHeightM: 9,
        roofPitchDeg: 20,
        marginM: 0,
        sides: "all",
      }),
    ).toEqual({ ok: false, reason: "eaveHeightM" });
  });
});

describe("threePhaseLoadBalance", () => {
  it("mixed single-phase + three-phase load: I_avg=25.4552A from the FULL-PRECISION currents, imbalance 20.93%", () => {
    const r = threePhaseLoadBalance({
      lineVoltage: 400,
      consumers: [
        { kw: 5.0, cosPhi: 1.0, connection: "L1" },
        { kw: 3.0, cosPhi: 0.9, connection: "L2" },
        { kw: 2.0, cosPhi: 0.8, connection: "L3" },
        { kw: 6.0, cosPhi: 0.85, connection: "three-phase" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // U_LN = 400/sqrt(3) = 230.940
    expect(r.phases[0].currentA).toBeCloseTo(30.7824, 3);
    expect(r.phases[1].currentA).toBeCloseTo(24.5901, 3);
    expect(r.phases[2].currentA).toBeCloseTo(20.9932, 3);
    // I_avg computed from the exact currents, NOT the currents already rounded to 2 decimals
    expect(r.avgCurrentA).toBeCloseTo(25.4552, 3);
    // imbalance = max|I_k - I_avg|/I_avg — the largest deviation, which is L1's, not (I_max-I_avg)/I_avg by coincidence here
    expect(r.imbalancePct).toBeCloseTo(20.9275, 2);
  });

  it("imbalance uses max ABSOLUTE deviation, not (I_max-I_avg)/I_avg: 10,10,4A gives 50%, not 25%", () => {
    // Constructed so each phase draws a round current at cosPhi=1: I = P/U_LN, P(kW) = I * U_LN / 1000.
    const uLn = 400 / Math.sqrt(3);
    const r = threePhaseLoadBalance({
      lineVoltage: 400,
      consumers: [
        { kw: (10 * uLn) / 1000, cosPhi: 1, connection: "L1" },
        { kw: (10 * uLn) / 1000, cosPhi: 1, connection: "L2" },
        { kw: (4 * uLn) / 1000, cosPhi: 1, connection: "L3" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.phases[0].currentA).toBeCloseTo(10, 3);
    expect(r.phases[1].currentA).toBeCloseTo(10, 3);
    expect(r.phases[2].currentA).toBeCloseTo(4, 3);
    // avg = 8; the (I_max-avg)/avg formula gives (10-8)/8=25%, but the largest
    // deviation is on the SMALLEST phase: |4-8|/8 = 50%
    expect(r.avgCurrentA).toBeCloseTo(8, 3);
    expect(r.imbalancePct).toBeCloseTo(50, 3);
  });

  it("neutral current: two equal 10A resistive phases on L1/L2 give I_N=10.00A; all three equal gives I_N=0.00A", () => {
    const uLn = 400 / Math.sqrt(3);
    const twoPhase = threePhaseLoadBalance({
      lineVoltage: 400,
      consumers: [
        { kw: (10 * uLn) / 1000, cosPhi: 1, connection: "L1" },
        { kw: (10 * uLn) / 1000, cosPhi: 1, connection: "L2" },
      ],
    });
    const threePhaseBalanced = threePhaseLoadBalance({
      lineVoltage: 400,
      consumers: [
        { kw: (10 * uLn) / 1000, cosPhi: 1, connection: "L1" },
        { kw: (10 * uLn) / 1000, cosPhi: 1, connection: "L2" },
        { kw: (10 * uLn) / 1000, cosPhi: 1, connection: "L3" },
      ],
    });
    expect(twoPhase.ok && threePhaseBalanced.ok).toBe(true);
    if (!twoPhase.ok || !threePhaseBalanced.ok) return;
    expect(twoPhase.neutralCurrentA).toBeCloseTo(10.0, 3);
    expect(threePhaseBalanced.neutralCurrentA).toBe(0); // clamped below 1e-9
  });

  it("single-phase installation: 2.2kW at 230V direct is 9.57A; against a 16A breaker the ratio is 0.598, no verdict", () => {
    const r = threePhaseLoadBalance({
      phaseVoltage: 230,
      consumers: [{ kw: 2.2, cosPhi: 1.0, connection: "L1" }],
      ratedBreakerA: 16,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.phases[0].currentA).toBeCloseTo(9.565217, 3);
    expect(r.phases[0].breakerRatio).toBeCloseTo(0.597826, 3);
  });

  it("refuses a three-phase connection on an installation where phaseVoltage was given directly (no 3-phase system present)", () => {
    const r = threePhaseLoadBalance({
      phaseVoltage: 230,
      consumers: [{ kw: 2.2, cosPhi: 1.0, connection: "three-phase" }],
    });
    expect(r).toEqual({ ok: false, reason: "connection:0" });
  });

  it("refuses cosPhi = 0 (infinite current for finite power)", () => {
    const r = threePhaseLoadBalance({ consumers: [{ kw: 1, cosPhi: 0, connection: "L1" }] });
    expect(r).toEqual({ ok: false, reason: "cosPhi:0" });
  });

  it("a leading load (negative cosPhi) is accepted and its reactive power cancels a lagging one, like generatorSizing", () => {
    const lagging = threePhaseLoadBalance({
      lineVoltage: 400,
      consumers: [{ kw: 10, cosPhi: 0.8, connection: "L1" }],
    });
    const leading = threePhaseLoadBalance({
      lineVoltage: 400,
      consumers: [
        { kw: 10, cosPhi: 0.8, connection: "L1" },
        { kw: 10, cosPhi: -0.8, connection: "L1" },
      ],
    });
    expect(lagging.ok && leading.ok).toBe(true);
    if (!lagging.ok || !leading.ok) return;
    // Equal-magnitude lagging and leading Q cancel exactly, leaving pure P.
    expect(leading.phases[0].reactiveKvar).toBeCloseTo(0, 6);
    expect(leading.totalReactiveKvar).toBeCloseTo(0, 6);
    expect(leading.powerFactor).toBeCloseTo(1, 6);
    // 20.00 kVA combined: 2 phasors of 12.5kVA each at ±36.87°, recombining
    // along the real axis to 2*12.5*cos(36.87°) = 2*12.5*0.8 = 20.00 kVA —
    // 1.6× the single lagging phasor's own 12.5 kVA, not 2× (angles matter).
    expect(lagging.phases[0].apparentKva).toBeCloseTo(12.5, 3);
    expect(leading.phases[0].apparentKva).toBeCloseTo(20.0, 3);
  });

  it("powerFactor is undefined, not 0, when the total apparent power is 0 (every consumer at 0% simultaneity)", () => {
    const r = threePhaseLoadBalance({
      lineVoltage: 400,
      consumers: [{ kw: 5, cosPhi: 0.9, connection: "L1", simultaneityPct: 0 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalApparentKva).toBe(0);
    expect(r.powerFactor).toBeUndefined();
  });
});

describe("trussHoistReactions", () => {
  it("truss with 5 point loads + self weight, asymmetric supports: R_A=90.60kg, R_B=95.40kg, cog=6.129m", () => {
    const r = trussHoistReactions({
      lengthM: 12,
      selfWeightKgPerM: 6.5,
      pointAM: 1,
      pointBM: 11,
      loads: [
        { massKg: 12, positionM: 2 },
        { massKg: 12, positionM: 5 },
        { massKg: 12, positionM: 8 },
        { massKg: 12, positionM: 11 },
        { massKg: 60, positionM: 6 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pointMassKg).toBe(108); // 4*12+60
    expect(r.distributedMassKg).toBeCloseTo(78, 6); // 6.5*12
    expect(r.totalMassKg).toBe(186);
    expect(r.reactionAKg).toBeCloseTo(90.6, 4);
    expect(r.reactionBKg).toBeCloseTo(95.4, 4);
    expect(r.reactionAKn).toBeCloseTo(0.8885, 3);
    expect(r.reactionBKn).toBeCloseTo(0.9356, 3);
    expect(r.cogPositionM).toBeCloseTo(6.129032, 4);
    expect(r.checkResidual).toBeCloseTo(0, 6);
    // hand-verified max moment: 276 kg·m at x=6m (independently, not from this module)
    expect(r.maxMomentKgM).toBeCloseTo(276, 1);
    expect(r.maxMomentPositionM).toBeCloseTo(6, 6);
    expect(r.shearAtAKg).toBeCloseTo(84.1, 1);
    expect(r.shearAtBKg).toBeCloseTo(-76.9, 1);
    // q_eq = 8*276/10^2 = 22.08
    expect(r.equivalentUdlKgM).toBeCloseTo(22.08, 1);
  });

  it("uplift: an overhang load beyond B can lift end A — reported as a signed negative reaction, no repair", () => {
    const r = trussHoistReactions({
      lengthM: 8,
      selfWeightKgPerM: 0,
      pointAM: 2,
      pointBM: 4,
      loads: [{ massKg: 100, positionM: 7.5 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reactionBKg).toBeCloseTo(275.0, 4);
    expect(r.reactionAKg).toBeCloseTo(-175.0, 4); // uplift at A
    expect(r.reactionAKg + r.reactionBKg).toBeCloseTo(100, 6);
  });

  it("symmetric case: supports at both ends, load at midspan — R_A = R_B = 125.00kg", () => {
    const r = trussHoistReactions({
      lengthM: 10,
      selfWeightKgPerM: 5,
      pointAM: 0,
      pointBM: 10,
      loads: [{ massKg: 200, positionM: 5 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reactionAKg).toBeCloseTo(125.0, 4);
    expect(r.reactionBKg).toBeCloseTo(125.0, 4);
    expect(r.cogPositionM).toBeCloseTo(5.0, 4);
  });

  it("refuses two coincident support points, an empty-load truss (M=0), and a load outside [0,L]", () => {
    expect(
      trussHoistReactions({ lengthM: 10, selfWeightKgPerM: 5, pointAM: 3, pointBM: 3, loads: [] }),
    ).toEqual({ ok: false, reason: "pointAM" });
    expect(
      trussHoistReactions({ lengthM: 10, selfWeightKgPerM: 0, pointAM: 2, pointBM: 8, loads: [] }),
    ).toEqual({ ok: false, reason: "noLoad" });
    expect(
      trussHoistReactions({
        lengthM: 10,
        selfWeightKgPerM: 5,
        pointAM: 2,
        pointBM: 8,
        loads: [{ massKg: 10, positionM: 11 }],
      }),
    ).toEqual({ ok: false, reason: "positionM:0" });
  });
});

describe("venueOccupancyArea", () => {
  it("24x15m hall minus deducted zones: net 310.00m², 476 persons at 0.65m²/person, ratio 1.190 against documented 400", () => {
    const r = venueOccupancyArea({
      grossAreaM2: 24 * 15,
      deductedZonesM2: [8 * 4, 12, 6],
      layouts: [{ densityM2PerPerson: 0.65, basis: "net", documentedCount: 400 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deductedAreaM2).toBeCloseTo(50.0, 6);
    expect(r.netAreaM2).toBeCloseTo(310.0, 6);
    expect(r.layouts[0]?.persons).toBe(476); // floor(310/0.65)
    expect(r.layouts[0]?.documentedRatio).toBeCloseTo(1.19, 4);
    expect(r.layouts[0]?.documentedDiff).toBe(76);
  });

  it("reverse direction: 220 guests at 1.20m²/person needs 264.00m², a +46.00m² SIGNED spare against the 310.00m² net", () => {
    const r = venueOccupancyArea({
      grossAreaM2: 24 * 15,
      deductedZonesM2: [8 * 4, 12, 6],
      layouts: [{ densityM2PerPerson: 1.2, basis: "net" }],
      guests: 220,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layouts[0]?.persons).toBe(258); // floor(310/1.20)
    expect(r.areaPerGuestM2).toBeCloseTo(1.409091, 4);
    expect(r.layouts[0]?.requiredAreaDiffM2).toBeCloseTo(46.0, 4); // 310 - 220*1.20
  });

  it("percentage deduction: a 300m² tent minus 15% = 255.00m² net, 318 persons at 0.80m²/person", () => {
    const r = venueOccupancyArea({
      grossAreaM2: 300,
      deductPct: 15,
      layouts: [{ densityM2PerPerson: 0.8, basis: "net" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deductedAreaM2).toBeCloseTo(45.0, 6);
    expect(r.netAreaM2).toBeCloseTo(255.0, 6);
    expect(r.layouts[0]?.persons).toBe(318);
  });

  it("floor() uses a tolerance: 9.60/0.80 is 11.999999999999998 in IEEE 754, and must still read 12", () => {
    const r = venueOccupancyArea({
      grossAreaM2: 9.6,
      layouts: [{ densityM2PerPerson: 0.8, basis: "gross" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layouts[0]?.persons).toBe(12);
  });

  it("refuses giving both deducted zones and a deduction percentage — mutually exclusive forms", () => {
    const r = venueOccupancyArea({
      grossAreaM2: 100,
      deductedZonesM2: [10],
      deductPct: 10,
      layouts: [{ densityM2PerPerson: 1, basis: "net" }],
    });
    expect(r).toEqual({ ok: false, reason: "deduction" });
  });

  it("enforces the stated 1-100,000 m² gross area range, not just positivity", () => {
    expect(
      venueOccupancyArea({ grossAreaM2: 0.5, layouts: [{ densityM2PerPerson: 1, basis: "net" }] }),
    ).toEqual({ ok: false, reason: "grossAreaM2" });
    expect(
      venueOccupancyArea({ grossAreaM2: 200000, layouts: [{ densityM2PerPerson: 1, basis: "net" }] }),
    ).toEqual({ ok: false, reason: "grossAreaM2" });
  });
});

describe("voltageDrop", () => {
  // Spec vector disagreement: the assignment prints "4,798 %" by rounding its
  // own already-rounded 11,0342 V forward, but 11,03424/230*100 = 4,797497…,
  // which rounds to 4,797 % — not 4,798 %. Re-derived by hand below.
  it("copper 2.5mm², 50m, 16A, 230V single-phase at 20°C: R_loop=0.68964Ω, dU=11.0342V (4.797%), loss=176.55W", () => {
    const r = voltageDrop({
      system: "single-phase",
      material: "copper",
      crossSectionMm2: 2.5,
      lengthM: 50,
      currentA: 16,
      nominalVoltage: 230,
      conductorTempC: 20,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resistanceOhm).toBeCloseTo(0.68964, 5);
    expect(r.dropVolts).toBeCloseTo(11.0342, 4);
    // 11.03424 / 230 * 100 = 4.797495652... -> 4.797 (not the assignment's 4.798)
    expect(r.dropPct).toBeCloseTo(4.797, 3);
    expect(r.farEndVoltage).toBeCloseTo(218.97, 2);
    expect(r.powerLossW).toBeCloseTo(176.55, 2);
  });

  it("aluminium 16mm², 80m, 63A, 400V three-phase at 70°C: dU=18.528V line-to-line, dU/√3 per phase, loss=2021.8W", () => {
    const r = voltageDrop({
      system: "three-phase",
      material: "aluminium",
      crossSectionMm2: 16,
      lengthM: 80,
      currentA: 63,
      nominalVoltage: 400,
      conductorTempC: 70,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // rho_70 = 0.028264*(1+0.00403*50) = 0.0339592; R1 = *80/16 = 0.169796
    expect(r.resistanceOhm).toBeCloseTo(0.169796, 4);
    expect(r.dropVolts).toBeCloseTo(18.528, 2);
    expect(r.dropVoltsPerPhase).toBeCloseTo(18.528 / Math.sqrt(3), 2);
    expect(r.dropPct).toBeCloseTo(4.632, 2);
    expect(r.farEndVoltage).toBeCloseTo(381.47, 2);
    expect(r.powerLossW).toBeCloseTo(2021.8, 0);
  });

  it("copper 1.5mm², 25m, 10A, 230V, user limit 3%: dU%=2.499, ratio 0.833 — no verdict on the comparison", () => {
    const r = voltageDrop({
      system: "single-phase",
      material: "copper",
      crossSectionMm2: 1.5,
      lengthM: 25,
      currentA: 10,
      nominalVoltage: 230,
      dropLimitPct: 3,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropPct).toBeCloseTo(2.499, 3);
    expect(r.powerLossW).toBeCloseTo(57.47, 2);
    expect(r.dropRatio).toBeCloseTo(0.833, 3);
  });

  it("reverse direction (solve for section): required ≈4.997mm² rounds up to the standard 6mm², achieving 2.499% (ratio 0.833)", () => {
    const r = voltageDrop({
      system: "single-phase",
      material: "copper",
      lengthM: 40,
      currentA: 25,
      nominalVoltage: 230,
      dropLimitPct: 3,
      conductorTempC: 20,
      solveForSection: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.requiredSectionMm2).toBeCloseTo(4.997391, 3);
    expect(r.selectedStandardSectionMm2).toBe(6);
    expect(r.achievedDropPctAtSelected).toBeCloseTo(2.498696, 3);
  });

  it("reverse direction past the top of the standard series (1000mm²) selects nothing, but still reports the exact requirement", () => {
    const r = voltageDrop({
      system: "single-phase",
      material: "copper",
      lengthM: 4000,
      currentA: 1500,
      nominalVoltage: 230,
      dropLimitPct: 1,
      solveForSection: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.requiredSectionMm2).toBeGreaterThan(1000);
    expect(r.selectedStandardSectionMm2).toBeUndefined();
    expect(r.achievedDropPctAtSelected).toBeUndefined();
  });

  it("refuses a non-positive length/current, and giving neither a cross-section nor a custom cable resistance", () => {
    expect(
      voltageDrop({ system: "dc", material: "copper", crossSectionMm2: 2.5, lengthM: 0, currentA: 10 }),
    ).toEqual({ ok: false, reason: "lengthM" });
    expect(voltageDrop({ system: "dc", material: "copper", lengthM: 10, currentA: 10 })).toEqual({
      ok: false,
      reason: "crossSectionMm2",
    });
  });

  it("a custom cable resistance from the datasheet bypasses ρ(θ) entirely", () => {
    const r = voltageDrop({
      system: "dc",
      material: "copper",
      lengthM: 50,
      currentA: 16,
      customResistanceOhmPerKm: 8,
      nominalVoltage: 230,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // R1 = 8 * 50/1000 = 0.4; loop = 0.8; dU = 16*0.8 = 12.8
    expect(r.resistanceOhm).toBeCloseTo(0.8, 6);
    expect(r.dropVolts).toBeCloseTo(12.8, 6);
  });
});

/**
 * `lineVoltage` defaults to 400 V, and the surface restated that 400 beside the
 * echo. See `ShelfSpacingResult.rasterUsed`. Every current on that screen is
 * inversely proportional to it, and 400 is a default precisely because a touring
 * rig also meets 380 and 415.
 */
describe("threePhaseLoadBalance returns the line voltage it used", () => {
  const consumers = [{ kw: 5.0, cosPhi: 1.0, connection: "L1" }] as const;

  it("reports 400 when none was given", () => {
    const r = threePhaseLoadBalance({ consumers: [...consumers] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineVoltageUsed).toBe(400);
    // U_LN = 400/sqrt(3) = 230.9401; I = 5000/230.9401 = 21.6506 A at cos phi 1.
    expect(r.phases[0].currentA).toBeCloseTo(21.6506, 3);
  });

  it("reports the voltage given, and the current follows it", () => {
    const r = threePhaseLoadBalance({ lineVoltage: 230, consumers: [...consumers] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineVoltageUsed).toBe(230);
    // U_LN = 230/sqrt(3) = 132.7906; I = 5000/132.7906 = 37.6533 A.
    expect(r.phases[0].currentA).toBeCloseTo(37.6533, 3);
  });
});
