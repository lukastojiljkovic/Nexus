import { describe, expect, it } from "vitest";
import {
  ACTIVITY_FACTORS,
  ACTIVITY_LEVELS,
  BODY_SEXES,
  KCAL_PER_KG_BODY_MASS,
  MAX_CIRCUMFERENCE_CM,
  MAX_HEIGHT_CM,
  MAX_WEIGHT_KG,
  MEASURED_MIN_INTAKE_COVERAGE,
  MEASURED_MIN_TREND_READINGS,
  MEASURED_MIN_WINDOW_DAYS,
  MEASURED_TREND_DAYS,
  NO_CIRCUMFERENCES,
  WEIGHT_GOALS,
  ageOnDay,
  bmiFor,
  energyTiers,
  katchMcArdleBmr,
  leanBodyMassKg,
  measuredEnergy,
  mifflinStJeorBmr,
  muscleMassKg,
  restingEnergy,
  suggestDailyEnergy,
  totalEnergy,
  validateBodyMeasurement,
  validateBodyProfile,
} from "./body.js";
import type {
  BodyMeasurement,
  BodyProfile,
  IntakeDay,
  MeasuredEnergyInput,
  WeightReading,
} from "./body.js";

/** The reference „today" every test below is written against. Nothing here reads a clock. */
const TODAY = "2026-08-01";

const PROFILE: BodyProfile = {
  sex: "male",
  birthDate: "1996-03-15",
  heightCm: 180,
  activity: "moderate",
};

const MEASUREMENT: BodyMeasurement = {
  day: "2026-08-01",
  weightKg: 80,
  bodyFatPercent: null,
  muscle: null,
  waterPercent: null,
  circumferences: NO_CIRCUMFERENCES,
};

function profile(patch: Partial<BodyProfile>): BodyProfile {
  return { ...PROFILE, ...patch };
}

function measurement(patch: Partial<BodyMeasurement>): BodyMeasurement {
  return { ...MEASUREMENT, ...patch };
}

function profileCodes(value: unknown, today = TODAY): string[] {
  return validateBodyProfile(value, today).map((problem) => `${problem.field}:${problem.code}`);
}

function measurementCodes(value: unknown, today = TODAY): string[] {
  return validateBodyMeasurement(value, today).map((problem) => `${problem.field}:${problem.code}`);
}

/** `days` consecutive day keys from `start`, so a window's shape is written once. */
function dayKeys(start: string, days: number): string[] {
  const startMs = Date.UTC(
    Number(start.slice(0, 4)),
    Number(start.slice(5, 7)) - 1,
    Number(start.slice(8, 10)),
  );
  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(startMs + offset * 86_400_000);
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${date.getUTCFullYear()}-${month}-${day}`;
  });
}

const WINDOW_FROM = "2026-01-01";
const WINDOW_TO = "2026-01-14";

/**
 * The reference 14-day window: 2 500 kcal logged every day, 80,0 kg every day of
 * the opening week and 79,5 kg every day of the closing one. Every measured-tier
 * test starts from this and breaks one thing.
 */
function referenceWindow(patch: Partial<MeasuredEnergyInput> = {}): MeasuredEnergyInput {
  const keys = dayKeys(WINDOW_FROM, 14);
  const intake: IntakeDay[] = keys.map((day) => ({ day, kcal: 2500 }));
  const weights: WeightReading[] = keys.map((day, index) => ({
    day,
    weightKg: index < 7 ? 80 : 79.5,
  }));
  return { from: WINDOW_FROM, to: WINDOW_TO, intake, weights, ...patch };
}

describe("ageOnDay", () => {
  it("counts COMPLETED years, so the age turns over on the birthday itself", () => {
    expect(ageOnDay("1996-03-15", "2026-03-14")).toBe(29);
    expect(ageOnDay("1996-03-15", "2026-03-15")).toBe(30);
    expect(ageOnDay("1996-03-15", "2026-03-16")).toBe(30);
  });

  it("is right across a year boundary in both directions", () => {
    expect(ageOnDay("1996-12-31", "2026-01-01")).toBe(29);
    expect(ageOnDay("1996-01-01", "2026-12-31")).toBe(30);
  });

  it("gives a 29 February person their year on 1 March in a non-leap year", () => {
    // Deliberately NOT `birthdayOccurrencesInRange`'s clamp to the 28th: that
    // decides which day the party is on, this counts completed years, and on
    // 28 February the year is not complete.
    expect(ageOnDay("2000-02-29", "2026-02-28")).toBe(25);
    expect(ageOnDay("2000-02-29", "2026-03-01")).toBe(26);
  });

  it("gives a 29 February person their year on the 29th in a leap year", () => {
    expect(ageOnDay("2000-02-29", "2028-02-28")).toBe(27);
    expect(ageOnDay("2000-02-29", "2028-02-29")).toBe(28);
  });

  it("is zero on the day of birth and null the day before", () => {
    expect(ageOnDay("2026-08-01", "2026-08-01")).toBe(0);
    expect(ageOnDay("2026-08-01", "2026-07-31")).toBeNull();
  });

  it("reports nothing rather than a negative age for a birth date in the future", () => {
    expect(ageOnDay("2030-01-01", "2026-08-01")).toBeNull();
  });

  it("throws on anything that is not a real calendar day", () => {
    expect(() => ageOnDay("2026-02-30", TODAY)).toThrow(TypeError);
    expect(() => ageOnDay("1996-03-15", "not-a-day")).toThrow(TypeError);
  });
});

describe("validateBodyProfile", () => {
  it("accepts a well-formed profile", () => {
    expect(validateBodyProfile(PROFILE, TODAY)).toEqual([]);
  });

  /**
   * `value` is untrusted and gets a problem code; `today` is the CALLER'S OWN
   * reference day, so a malformed one is a programming error. It must be loud:
   * skipping the future rule would let a birth date in 2090 validate clean, and
   * a validator that quietly drops one of its rules is worse than one that
   * refuses to run.
   */
  it("throws on a malformed reference day rather than dropping the future rule", () => {
    expect(() => validateBodyProfile(PROFILE, "not-a-day" as never)).toThrow(TypeError);
    expect(() => validateBodyMeasurement(MEASUREMENT, "2026-13-01" as never)).toThrow(TypeError);
    // And the rule it governs still fires against a good reference day.
    expect(validateBodyProfile(profile({ birthDate: "2090-01-01" }), TODAY)).toEqual([
      { field: "birthDate", code: "future" },
    ]);
  });

  it("accepts a profile with no sex — its absence is legal and closes a tier instead", () => {
    expect(validateBodyProfile(profile({ sex: null }), TODAY)).toEqual([]);
  });

  it("refuses anything that is not an object", () => {
    expect(profileCodes(null)).toEqual(["<root>:shape"]);
    expect(profileCodes([PROFILE])).toEqual(["<root>:shape"]);
  });

  it("accepts every declared sex and refuses anything else", () => {
    for (const sex of BODY_SEXES) {
      expect(validateBodyProfile(profile({ sex }), TODAY)).toEqual([]);
    }
    expect(profileCodes({ ...PROFILE, sex: "other" })).toEqual(["sex:sex"]);
    expect(profileCodes({ ...PROFILE, sex: undefined })).toEqual(["sex:sex"]);
  });

  it("accepts every declared activity level and refuses anything else", () => {
    for (const activity of ACTIVITY_LEVELS) {
      expect(validateBodyProfile(profile({ activity }), TODAY)).toEqual([]);
    }
    expect(profileCodes({ ...PROFILE, activity: "athlete" })).toEqual(["activity:activity"]);
  });

  it("refuses a birth date in the future, naming it as such", () => {
    expect(profileCodes(profile({ birthDate: "2026-08-02" }))).toEqual(["birthDate:future"]);
    // The reference day itself is not the future — a newborn logged today.
    expect(validateBodyProfile(profile({ birthDate: TODAY }), TODAY)).toEqual([]);
  });

  it("refuses a birth date that is not a real calendar day", () => {
    expect(profileCodes(profile({ birthDate: "1996-02-30" }))).toEqual(["birthDate:day"]);
    expect(profileCodes({ ...PROFILE, birthDate: 19960315 })).toEqual(["birthDate:shape"]);
  });

  it("refuses a negative, zero, non-finite or absurd height", () => {
    for (const heightCm of [-180, 0, Number.NaN, Number.POSITIVE_INFINITY, MAX_HEIGHT_CM + 1]) {
      expect(profileCodes(profile({ heightCm }))).toEqual(["heightCm:range"]);
    }
    expect(profileCodes({ ...PROFILE, heightCm: "180" })).toEqual(["heightCm:shape"]);
  });

  it("accepts the height ceiling exactly", () => {
    expect(validateBodyProfile(profile({ heightCm: MAX_HEIGHT_CM }), TODAY)).toEqual([]);
  });

  it("reports every problem at once rather than the first", () => {
    expect(profileCodes({ sex: "other", birthDate: "1996-02-30", heightCm: -1, activity: "x" })).toEqual([
      "sex:sex",
      "birthDate:day",
      "heightCm:range",
      "activity:activity",
    ]);
  });
});

describe("validateBodyMeasurement", () => {
  it("accepts a bare weigh-in and a full smart-scale reading alike", () => {
    expect(validateBodyMeasurement(MEASUREMENT, TODAY)).toEqual([]);
    expect(
      validateBodyMeasurement(
        measurement({
          bodyFatPercent: 18.4,
          muscle: { unit: "kg", value: 35.2 },
          waterPercent: 57.1,
          circumferences: { waist: 84, hip: 98, chest: 102, thigh: 56, upperArm: 33 },
        }),
        TODAY,
      ),
    ).toEqual([]);
  });

  it("refuses a weigh-in dated after the reference day", () => {
    expect(measurementCodes(measurement({ day: "2026-08-02" }))).toEqual(["day:future"]);
  });

  it("refuses a weight of zero, a negative weight and an absurd one", () => {
    for (const weightKg of [0, -80, Number.NaN, MAX_WEIGHT_KG + 1]) {
      expect(measurementCodes(measurement({ weightKg }))).toEqual(["weightKg:range"]);
    }
  });

  it("refuses an impossible body-fat percentage at both ends and accepts what sits between", () => {
    for (const bodyFatPercent of [0, 100, 100.1, -5]) {
      expect(measurementCodes(measurement({ bodyFatPercent }))).toEqual(["bodyFatPercent:range"]);
    }
    expect(validateBodyMeasurement(measurement({ bodyFatPercent: 99.9 }), TODAY)).toEqual([]);
    expect(validateBodyMeasurement(measurement({ bodyFatPercent: 0.1 }), TODAY)).toEqual([]);
  });

  it("refuses an impossible water percentage", () => {
    expect(measurementCodes(measurement({ waterPercent: 100 }))).toEqual(["waterPercent:range"]);
  });

  it("refuses a muscle reading whose unit is neither percent nor kg", () => {
    expect(measurementCodes({ ...MEASUREMENT, muscle: { unit: "lb", value: 77 } })).toEqual([
      "muscle.unit:unit",
    ]);
    expect(measurementCodes({ ...MEASUREMENT, muscle: { value: 35 } })).toEqual(["muscle.unit:unit"]);
  });

  it("refuses muscle mass above the body it is part of, by its own code", () => {
    expect(measurementCodes(measurement({ muscle: { unit: "kg", value: 80.1 } }))).toEqual([
      "muscle.value:composition",
    ]);
    expect(validateBodyMeasurement(measurement({ muscle: { unit: "kg", value: 80 } }), TODAY)).toEqual([]);
  });

  it("does not derive a second muscle problem from an unusable weight", () => {
    expect(measurementCodes(measurement({ weightKg: -1, muscle: { unit: "kg", value: 35 } }))).toEqual([
      "weightKg:range",
    ]);
  });

  it("refuses a muscle percentage outside 0..100", () => {
    expect(measurementCodes(measurement({ muscle: { unit: "percent", value: 100 } }))).toEqual([
      "muscle.value:range",
    ]);
  });

  it("refuses a non-object circumferences and an out-of-range tape reading", () => {
    expect(measurementCodes({ ...MEASUREMENT, circumferences: null })).toEqual([
      "circumferences:shape",
    ]);
    expect(
      measurementCodes(
        measurement({ circumferences: { ...NO_CIRCUMFERENCES, waist: MAX_CIRCUMFERENCE_CM + 1 } }),
      ),
    ).toEqual(["circumferences.waist:range"]);
    expect(
      measurementCodes(measurement({ circumferences: { ...NO_CIRCUMFERENCES, hip: 0 } })),
    ).toEqual(["circumferences.hip:range"]);
  });
});

describe("leanBodyMassKg and muscleMassKg", () => {
  it("takes the fat off the weight", () => {
    expect(leanBodyMassKg(80, 20)).toBeCloseTo(64, 10);
    expect(leanBodyMassKg(65, 30)).toBeCloseTo(45.5, 10);
  });

  it("throws rather than answering for an impossible input", () => {
    expect(() => leanBodyMassKg(0, 20)).toThrow(RangeError);
    expect(() => leanBodyMassKg(80, 0)).toThrow(RangeError);
    expect(() => leanBodyMassKg(80, 100)).toThrow(RangeError);
    expect(() => leanBodyMassKg(80, Number.NaN)).toThrow(RangeError);
  });

  it("keeps a muscle reading in the unit the device gave it and converts on request", () => {
    expect(muscleMassKg(MEASUREMENT)).toBeNull();
    expect(muscleMassKg(measurement({ muscle: { unit: "kg", value: 35.2 } }))).toBe(35.2);
    // 44 % of the same measurement's own 80 kg — never another day's weight.
    expect(muscleMassKg(measurement({ muscle: { unit: "percent", value: 44 } }))).toBeCloseTo(35.2, 10);
  });
});

describe("bmiFor", () => {
  it("is kg / m²", () => {
    // 80 / 1,80² = 80 / 3,24 = 24,6913…
    expect(bmiFor(PROFILE, MEASUREMENT).value).toBeCloseTo(24.691358, 6);
  });

  it("carries its caveat with the number rather than beside it", () => {
    expect(bmiFor(PROFILE, MEASUREMENT).caveat).toBe("population-screening");
  });

  it("says it is superseded exactly when a real body-fat reading exists", () => {
    expect(bmiFor(PROFILE, MEASUREMENT).supersededByBodyFat).toBe(false);
    expect(bmiFor(PROFILE, measurement({ bodyFatPercent: 18 })).supersededByBodyFat).toBe(true);
  });

  it("throws on an impossible height or weight", () => {
    expect(() => bmiFor(profile({ heightCm: 0 }), MEASUREMENT)).toThrow(RangeError);
    expect(() => bmiFor(PROFILE, measurement({ weightKg: 0 }))).toThrow(RangeError);
  });
});

describe("katchMcArdleBmr", () => {
  it("is 370 + 21,6 × LBM", () => {
    // 80 kg at 20 % fat → 64 kg lean → 370 + 21,6 × 64 = 370 + 1 382,4 = 1 752,4.
    expect(katchMcArdleBmr(leanBodyMassKg(80, 20))).toBeCloseTo(1752.4, 10);
    // 45,5 kg lean → 370 + 982,8 = 1 352,8.
    expect(katchMcArdleBmr(45.5)).toBeCloseTo(1352.8, 10);
  });

  it("throws on a non-positive lean mass", () => {
    expect(() => katchMcArdleBmr(0)).toThrow(RangeError);
    expect(() => katchMcArdleBmr(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("mifflinStJeorBmr", () => {
  it("is 10×kg + 6,25×cm − 5×age, +5 male", () => {
    // 800 + 1 125 − 150 + 5 = 1 780.
    expect(mifflinStJeorBmr("male", 80, 180, 30)).toBeCloseTo(1780, 10);
  });

  it("is the same expression − 161 female", () => {
    // 650 + 1 031,25 − 140 − 161 = 1 380,25.
    expect(mifflinStJeorBmr("female", 65, 165, 28)).toBeCloseTo(1380.25, 10);
  });

  it("differs between the sexes by exactly 166 at the same body", () => {
    expect(mifflinStJeorBmr("male", 80, 180, 30) - mifflinStJeorBmr("female", 80, 180, 30)).toBeCloseTo(
      166,
      10,
    );
  });

  it("throws on an impossible body or a negative age", () => {
    expect(() => mifflinStJeorBmr("male", 0, 180, 30)).toThrow(RangeError);
    expect(() => mifflinStJeorBmr("male", 80, 0, 30)).toThrow(RangeError);
    expect(() => mifflinStJeorBmr("male", 80, 180, -1)).toThrow(RangeError);
  });
});

describe("restingEnergy", () => {
  it("prefers Katch–McArdle whenever a body-fat percentage was measured", () => {
    const estimate = restingEnergy(measurement({ bodyFatPercent: 20 }), PROFILE, TODAY);
    expect(estimate).toEqual({
      kcal: 1752.4,
      kind: "resting",
      method: "katch-mcardle",
      assumptions: ["population-equation"],
    });
  });

  it("does not carry a sex assumption on Katch–McArdle — the equation has no sex term", () => {
    const male = restingEnergy(measurement({ bodyFatPercent: 20 }), PROFILE, TODAY);
    const female = restingEnergy(
      measurement({ bodyFatPercent: 20 }),
      profile({ sex: "female" }),
      TODAY,
    );
    expect(male).toEqual(female);
    expect(male?.assumptions).not.toContain("sex-term-proxies-composition");
  });

  it("needs no profile at all for Katch–McArdle", () => {
    expect(restingEnergy(measurement({ bodyFatPercent: 20 }), null, TODAY)?.method).toBe(
      "katch-mcardle",
    );
  });

  it("falls back to Mifflin–St Jeor and says what its sex term stands for", () => {
    // Born 1996-03-15, today 2026-08-01 → 30 years complete.
    expect(restingEnergy(MEASUREMENT, PROFILE, TODAY)).toEqual({
      kcal: 1780,
      kind: "resting",
      method: "mifflin-st-jeor",
      assumptions: ["population-equation", "sex-term-proxies-composition"],
    });
  });

  it("answers nothing when composition is unknown and so is sex", () => {
    expect(restingEnergy(MEASUREMENT, profile({ sex: null }), TODAY)).toBeNull();
    expect(restingEnergy(MEASUREMENT, null, TODAY)).toBeNull();
  });

  it("answers nothing when the birth date yields no age", () => {
    expect(restingEnergy(MEASUREMENT, profile({ birthDate: "2030-01-01" }), TODAY)).toBeNull();
  });
});

describe("totalEnergy", () => {
  it("multiplies by the activity factor and names the multiplier as an assumption", () => {
    const resting = restingEnergy(MEASUREMENT, PROFILE, TODAY);
    expect(resting).not.toBeNull();
    const total = totalEnergy(resting as NonNullable<typeof resting>, "moderate");
    expect(total).toEqual({
      kcal: 1780 * 1.55,
      kind: "total",
      method: "mifflin-st-jeor",
      assumptions: ["population-equation", "sex-term-proxies-composition", "activity-multiplier"],
    });
  });

  it("moves a BMR by more than a meal across one rung of the ladder", () => {
    const resting = { kcal: 1700, kind: "resting", method: "mifflin-st-jeor", assumptions: [] } as const;
    const light = totalEnergy(resting, "light").kcal;
    const moderate = totalEnergy(resting, "moderate").kcal;
    expect(moderate - light).toBeCloseTo(1700 * (ACTIVITY_FACTORS.moderate - ACTIVITY_FACTORS.light), 10);
    expect(moderate - light).toBeGreaterThan(290);
  });

  it("refuses to multiply a total twice", () => {
    const total = { kcal: 2759, kind: "total", method: "mifflin-st-jeor", assumptions: [] } as const;
    expect(() => totalEnergy(total, "moderate")).toThrow(TypeError);
  });
});

describe("measuredEnergy — the answer", () => {
  it("prices the trend change against the intake and shows its working", () => {
    const result = measuredEnergy(referenceWindow());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    // 80,0 kg over days 0..6 (centroid 3), 79,5 kg over days 7..13 (centroid 10):
    // −0,5 kg over 7 days → 2 500 + 0,5 × 7 700 / 7 = 2 500 + 550 = 3 050.
    expect(result.estimate.kcal).toBeCloseTo(3050, 10);
    expect(result.estimate.kind).toBe("total");
    expect(result.estimate.method).toBe("measured");
    expect(result.detail).toEqual({
      meanIntakeKcal: 2500,
      trendStartKg: 80,
      trendEndKg: 79.5,
      deltaKg: -0.5,
      daysBetweenTrends: 7,
      windowDays: 14,
      loggedDays: 14,
      intakeCoverage: 1,
    });
  });

  it("divides by the distance between the two TREND centroids, not by the window", () => {
    // The window is 14 days but the endpoint averages are only 7 apart. Dividing
    // by 14 would halve the rate of change and land on 2 775 instead.
    const result = measuredEnergy(referenceWindow());
    expect(result.status === "ready" && result.detail.daysBetweenTrends).toBe(7);
    expect(result.status === "ready" && result.estimate.kcal).not.toBeCloseTo(2775, 6);
  });

  it("uses the readings' OWN centroid when they are not spread evenly across a block", () => {
    // Weigh-ins only on days 0..3 and 10..13: centroids 1,5 and 11,5, so the
    // change spans 10 days rather than the nominal 7.
    const keys = dayKeys(WINDOW_FROM, 14);
    const weights: WeightReading[] = keys.flatMap((day, index) =>
      index <= 3 ? [{ day, weightKg: 80 }] : index >= 10 ? [{ day, weightKg: 79.5 }] : [],
    );
    const result = measuredEnergy(referenceWindow({ weights }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.detail.daysBetweenTrends).toBeCloseTo(10, 10);
    expect(result.estimate.kcal).toBeCloseTo(2500 + (0.5 * KCAL_PER_KG_BODY_MASS) / 10, 10);
  });

  it("names the 7 700 kcal/kg conversion as an assumption on every answer", () => {
    const result = measuredEnergy(referenceWindow());
    expect(result.status === "ready" && result.estimate.assumptions).toEqual(["energy-density"]);
  });

  it("carries no activity multiplier — tier 1 never touches the ladder", () => {
    const result = measuredEnergy(referenceWindow());
    expect(result.status === "ready" && result.estimate.assumptions).not.toContain(
      "activity-multiplier",
    );
  });

  it("says out loud when unlogged days were stood in for", () => {
    const keys = dayKeys(WINDOW_FROM, 14);
    const intake: IntakeDay[] = keys
      .filter((_, index) => index !== 5 && index !== 6)
      .map((day) => ({ day, kcal: 2500 }));
    const result = measuredEnergy(referenceWindow({ intake }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.estimate.assumptions).toEqual(["energy-density", "unlogged-days-imputed"]);
    expect(result.detail.loggedDays).toBe(12);
    expect(result.detail.intakeCoverage).toBeCloseTo(12 / 14, 10);
  });

  it("counts a logged ZERO as a fasted day rather than as a blank one", () => {
    const keys = dayKeys(WINDOW_FROM, 14);
    const intake: IntakeDay[] = keys.map((day, index) => ({ day, kcal: index === 0 ? 0 : 2500 }));
    const result = measuredEnergy(referenceWindow({ intake }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.detail.loggedDays).toBe(14);
    expect(result.detail.intakeCoverage).toBe(1);
    expect(result.detail.meanIntakeKcal).toBeCloseTo((13 * 2500) / 14, 10);
  });

  it("ignores entries dated outside the window and malformed keys", () => {
    const base = referenceWindow();
    const result = measuredEnergy({
      ...base,
      intake: [...base.intake, { day: "2025-12-31", kcal: 9000 }, { day: "not-a-day", kcal: 9000 }],
    });
    expect(result.status === "ready" && result.detail.meanIntakeKcal).toBe(2500);
  });

  it("lets the last entry for a repeated day win, the way an upsert would", () => {
    const base = referenceWindow();
    const result = measuredEnergy({
      ...base,
      intake: [...base.intake, { day: WINDOW_FROM, kcal: 3900 }],
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.detail.loggedDays).toBe(14);
    expect(result.detail.meanIntakeKcal).toBeCloseTo((13 * 2500 + 3900) / 14, 10);
  });

  it("throws on a window whose bounds are not real calendar days", () => {
    expect(() => measuredEnergy(referenceWindow({ from: "2026-02-30" }))).toThrow(TypeError);
  });
});

describe("measuredEnergy — every refusal, by its own reason", () => {
  it("refuses a window shorter than the minimum, naming the days it has and needs", () => {
    const keys = dayKeys(WINDOW_FROM, 13);
    const result = measuredEnergy({
      from: WINDOW_FROM,
      to: "2026-01-13",
      intake: keys.map((day) => ({ day, kcal: 2500 })),
      weights: keys.map((day, index) => ({ day, weightKg: index < 7 ? 80 : 79.5 })),
    });
    expect(result).toEqual({
      status: "refused",
      refusals: [{ code: "window-days", have: 13, need: MEASURED_MIN_WINDOW_DAYS }],
    });
  });

  it("accepts a window of exactly the minimum length", () => {
    expect(measuredEnergy(referenceWindow()).status).toBe("ready");
  });

  it("short-circuits on a short window rather than diagnosing a window that is not there", () => {
    const result = measuredEnergy({ from: WINDOW_FROM, to: "2026-01-03", intake: [], weights: [] });
    expect(result.status === "refused" && result.refusals.map((refusal) => refusal.code)).toEqual([
      "window-days",
    ]);
  });

  it("refuses a sparse intake log, naming the coverage it has and needs", () => {
    // 11 of 14 days = 0,7857… — below the 0,8 floor.
    const keys = dayKeys(WINDOW_FROM, 14);
    const intake: IntakeDay[] = keys.slice(0, 11).map((day) => ({ day, kcal: 2500 }));
    const result = measuredEnergy(referenceWindow({ intake }));
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]?.code).toBe("intake-coverage");
    expect(result.refusals[0]?.have).toBeCloseTo(11 / 14, 10);
    expect(result.refusals[0]?.need).toBe(MEASURED_MIN_INTAKE_COVERAGE);
  });

  it("accepts coverage exactly at the floor and refuses one day below it", () => {
    const keys = dayKeys(WINDOW_FROM, 20);
    const window = {
      from: WINDOW_FROM,
      to: "2026-01-20",
      weights: keys.map((day, index) => ({ day, weightKg: index < 7 ? 80 : 79.5 })),
    };
    // 16 of 20 is exactly 0,80; 15 of 20 is 0,75.
    expect(
      measuredEnergy({
        ...window,
        intake: keys.slice(0, 16).map((day) => ({ day, kcal: 2500 })),
      }).status,
    ).toBe("ready");
    expect(
      measuredEnergy({
        ...window,
        intake: keys.slice(0, 15).map((day) => ({ day, kcal: 2500 })),
      }).status,
    ).toBe("refused");
  });

  it("refuses thin trend endpoints, naming the THINNER block", () => {
    const keys = dayKeys(WINDOW_FROM, 14);
    // Three weigh-ins in the opening block, all seven in the closing one.
    const weights: WeightReading[] = keys.flatMap((day, index) =>
      index < 7 ? (index < 3 ? [{ day, weightKg: 80 }] : []) : [{ day, weightKg: 79.5 }],
    );
    const result = measuredEnergy(referenceWindow({ weights }));
    expect(result).toEqual({
      status: "refused",
      refusals: [{ code: "trend-readings", have: 3, need: MEASURED_MIN_TREND_READINGS }],
    });
  });

  it("accepts exactly the minimum number of readings in each endpoint block", () => {
    const keys = dayKeys(WINDOW_FROM, 14);
    const weights: WeightReading[] = keys.flatMap((day, index) => {
      if (index < MEASURED_MIN_TREND_READINGS) return [{ day, weightKg: 80 }];
      if (index >= 14 - MEASURED_MIN_TREND_READINGS) return [{ day, weightKg: 79.5 }];
      return [];
    });
    expect(measuredEnergy(referenceWindow({ weights })).status).toBe("ready");
  });

  it("refuses a window with no weigh-ins at all as thin endpoints", () => {
    const result = measuredEnergy(referenceWindow({ weights: [] }));
    expect(result).toEqual({
      status: "refused",
      refusals: [{ code: "trend-readings", have: 0, need: MEASURED_MIN_TREND_READINGS }],
    });
  });

  it("reports a sparse log and thin endpoints TOGETHER — every gap at once", () => {
    const keys = dayKeys(WINDOW_FROM, 14);
    const result = measuredEnergy({
      from: WINDOW_FROM,
      to: WINDOW_TO,
      intake: keys.slice(0, 5).map((day) => ({ day, kcal: 2500 })),
      weights: keys.slice(0, 2).map((day) => ({ day, weightKg: 80 })),
    });
    expect(result.status === "refused" && result.refusals.map((refusal) => refusal.code)).toEqual([
      "intake-coverage",
      "trend-readings",
    ]);
  });

  it("refuses an impossible answer rather than printing a negative expenditure", () => {
    const keys = dayKeys(WINDOW_FROM, 14);
    // 1 000 kcal a day while gaining 5 kg over the 7-day trend span:
    // 1 000 − 5 × 7 700 / 7 = 1 000 − 5 500 = −4 500.
    const result = measuredEnergy({
      from: WINDOW_FROM,
      to: WINDOW_TO,
      intake: keys.map((day) => ({ day, kcal: 1000 })),
      weights: keys.map((day, index) => ({ day, weightKg: index < 7 ? 75 : 80 })),
    });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]?.code).toBe("plausible-result");
    expect(result.refusals[0]?.have).toBeCloseTo(-4500, 10);
    expect(result.refusals[0]?.need).toBe(0);
  });

  it("keeps the two endpoint blocks from ever overlapping", () => {
    // The blocks tile the shortest legal window exactly: 7 + 7 = 14.
    expect(MEASURED_TREND_DAYS * 2).toBe(MEASURED_MIN_WINDOW_DAYS);
  });
});

describe("energyTiers", () => {
  const HISTORY = referenceWindow();

  it("picks the measured tier when the history supports it", () => {
    const report = energyTiers({
      profile: PROFILE,
      measurement: measurement({ bodyFatPercent: 20 }),
      history: HISTORY,
      today: TODAY,
    });
    expect(report.available).toEqual(["measured", "katch-mcardle", "mifflin-st-jeor"]);
    expect(report.gaps).toEqual([]);
    expect(report.estimate?.method).toBe("measured");
    expect(report.estimate?.kcal).toBeCloseTo(3050, 10);
    expect(report.measured?.status).toBe("ready");
  });

  it("falls to Katch–McArdle and says what tier 1 is still waiting for", () => {
    const report = energyTiers({
      profile: PROFILE,
      measurement: measurement({ bodyFatPercent: 20 }),
      history: null,
      today: TODAY,
    });
    expect(report.available).toEqual(["katch-mcardle", "mifflin-st-jeor"]);
    expect(report.gaps).toEqual([{ method: "measured", missing: ["history"] }]);
    expect(report.estimate).toEqual({
      kcal: 1752.4 * ACTIVITY_FACTORS.moderate,
      kind: "total",
      method: "katch-mcardle",
      assumptions: ["population-equation", "activity-multiplier"],
    });
    expect(report.measured).toBeNull();
  });

  it("falls to Mifflin–St Jeor and names the body-fat reading that would improve it", () => {
    const report = energyTiers({
      profile: PROFILE,
      measurement: MEASUREMENT,
      history: null,
      today: TODAY,
    });
    expect(report.available).toEqual(["mifflin-st-jeor"]);
    expect(report.gaps).toEqual([
      { method: "measured", missing: ["history"] },
      { method: "katch-mcardle", missing: ["body-fat"] },
    ]);
    expect(report.estimate?.kcal).toBeCloseTo(1780 * ACTIVITY_FACTORS.moderate, 10);
  });

  it("names sex as what closes the last tier, and nothing else", () => {
    const report = energyTiers({
      profile: profile({ sex: null }),
      measurement: MEASUREMENT,
      history: null,
      today: TODAY,
    });
    expect(report.estimate).toBeNull();
    expect(report.available).toEqual([]);
    expect(report.gaps).toEqual([
      { method: "measured", missing: ["history"] },
      { method: "katch-mcardle", missing: ["body-fat"] },
      { method: "mifflin-st-jeor", missing: ["sex"] },
    ]);
  });

  it("passes tier 1's numbered refusals straight through as its gap", () => {
    const report = energyTiers({
      profile: PROFILE,
      measurement: MEASUREMENT,
      history: referenceWindow({ weights: [] }),
      today: TODAY,
    });
    expect(report.gaps[0]).toEqual({ method: "measured", missing: ["trend-readings"] });
    expect(report.measured?.status).toBe("refused");
  });

  it("reports an empty profile honestly rather than answering", () => {
    const report = energyTiers({ profile: null, measurement: null, history: null, today: TODAY });
    expect(report.estimate).toBeNull();
    expect(report.available).toEqual([]);
    expect(report.gaps).toEqual([
      { method: "measured", missing: ["history"] },
      { method: "katch-mcardle", missing: ["profile", "measurement"] },
      { method: "mifflin-st-jeor", missing: ["profile", "measurement"] },
    ]);
  });

  it("needs a profile even for Katch–McArdle, because a TDEE needs an activity level", () => {
    const report = energyTiers({
      profile: null,
      measurement: measurement({ bodyFatPercent: 20 }),
      history: null,
      today: TODAY,
    });
    expect(report.available).toEqual([]);
    expect(report.gaps[1]).toEqual({ method: "katch-mcardle", missing: ["profile"] });
    // The BMR itself is still reachable — that is what `restingEnergy` is for.
    expect(restingEnergy(measurement({ bodyFatPercent: 20 }), null, TODAY)?.method).toBe(
      "katch-mcardle",
    );
  });

  it("never leaves a gap with nothing missing, even for an unvalidated future birth date", () => {
    const report = energyTiers({
      profile: profile({ birthDate: "2030-01-01" }),
      measurement: MEASUREMENT,
      history: null,
      today: TODAY,
    });
    expect(report.estimate).toBeNull();
    for (const gap of report.gaps) expect(gap.missing.length).toBeGreaterThan(0);
    expect(report.gaps[2]).toEqual({ method: "mifflin-st-jeor", missing: ["profile"] });
  });

  it("always returns every method either as available or as a gap", () => {
    const report = energyTiers({
      profile: PROFILE,
      measurement: MEASUREMENT,
      history: null,
      today: TODAY,
    });
    expect(report.available.length + report.gaps.length).toBe(3);
  });
});

describe("suggestDailyEnergy", () => {
  const TDEE = {
    kcal: 2759,
    kind: "total",
    method: "mifflin-st-jeor",
    assumptions: ["population-equation", "sex-term-proxies-composition", "activity-multiplier"],
  } as const;

  it("prices a loss at 7 700 kcal per kilogram, spread over a week", () => {
    const suggestion = suggestDailyEnergy(TDEE, "lose", 0.5);
    // 0,5 × 7 700 / 7 = 550 kcal/day under.
    expect(suggestion.deltaKcal).toBeCloseTo(-550, 10);
    expect(suggestion.kcal).toBeCloseTo(2209, 10);
    expect(suggestion.weeklyKg).toBeCloseTo(-0.5, 10);
    expect(suggestion.goal).toBe("lose");
  });

  it("prices a gain the same way, with the sign the goal gives it", () => {
    const suggestion = suggestDailyEnergy(TDEE, "gain", 0.25);
    expect(suggestion.deltaKcal).toBeCloseTo(275, 10);
    expect(suggestion.kcal).toBeCloseTo(3034, 10);
    expect(suggestion.weeklyKg).toBeCloseTo(0.25, 10);
  });

  it("pins maintain at zero whatever rate is passed", () => {
    const suggestion = suggestDailyEnergy(TDEE, "maintain", 0.5);
    expect(suggestion.deltaKcal).toBe(0);
    expect(suggestion.kcal).toBe(2759);
    expect(suggestion.weeklyKg).toBe(0);
  });

  it("covers every declared goal", () => {
    for (const goal of WEIGHT_GOALS) {
      expect(suggestDailyEnergy(TDEE, goal, 0.5).goal).toBe(goal);
    }
  });

  it("reports the estimate it was built on verbatim and adds only its own assumption", () => {
    const suggestion = suggestDailyEnergy(TDEE, "lose", 0.5);
    expect(suggestion.from).toBe(TDEE);
    expect(suggestion.assumptions).toEqual([...TDEE.assumptions, "energy-density"]);
  });

  it("does not double `energy-density` when the source already carried it", () => {
    const measured = {
      kcal: 3050,
      kind: "total",
      method: "measured",
      assumptions: ["energy-density"],
    } as const;
    expect(suggestDailyEnergy(measured, "lose", 0.5).assumptions).toEqual(["energy-density"]);
  });

  it("refuses to suggest a day's food off a resting figure", () => {
    const resting = {
      kcal: 1780,
      kind: "resting",
      method: "mifflin-st-jeor",
      assumptions: [],
    } as const;
    expect(() => suggestDailyEnergy(resting, "lose", 0.5)).toThrow(TypeError);
  });

  it("refuses a negative or non-finite rate — the goal carries the sign, not the magnitude", () => {
    expect(() => suggestDailyEnergy(TDEE, "lose", -0.5)).toThrow(RangeError);
    expect(() => suggestDailyEnergy(TDEE, "lose", Number.NaN)).toThrow(RangeError);
  });

  /**
   * `maintain` prices no weight change, so `KCAL_PER_KG_BODY_MASS` never enters
   * the arithmetic and must not be claimed as an assumption. Small, and exactly
   * the size of false statement a module about honest assumptions does not get
   * to make.
   */
  it("claims no energy-density assumption for a maintain suggestion, which used none", () => {
    const suggestion = suggestDailyEnergy(TDEE, "maintain", 0.5);
    expect(suggestion.deltaKcal).toBe(0);
    expect(suggestion.assumptions).toEqual(TDEE.assumptions);
    expect(suggestion.assumptions).not.toContain("energy-density");
  });

  it("still claims it whenever the delta is non-zero, in both directions", () => {
    for (const goal of ["lose", "gain"] as const) {
      expect(suggestDailyEnergy(TDEE, goal, 0.5).assumptions).toContain("energy-density");
    }
  });
});

describe("the stated constants", () => {
  it("bills a kilogram of body mass at the classic pure-adipose figure", () => {
    expect(KCAL_PER_KG_BODY_MASS).toBe(7700);
  });

  it("keeps one activity factor per declared level, ascending", () => {
    const factors = ACTIVITY_LEVELS.map((level) => ACTIVITY_FACTORS[level]);
    expect(factors).toEqual([1.2, 1.375, 1.55, 1.725, 1.9]);
    expect([...factors].sort((a, b) => a - b)).toEqual(factors);
  });
});
