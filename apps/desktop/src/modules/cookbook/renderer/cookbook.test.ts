import { afterEach, describe, expect, it } from "vitest";
import type { RecipeIngredientView } from "../shared/ipc.js";
import {
  clampServings,
  courseLabel,
  formatAmount,
  formatTime,
  lineText,
  scaleLines,
  stepIndex,
  totalMinutes,
  unitLabel,
} from "./cookbook.js";
import { copy } from "./copy.js";
import { applyLocale } from "../../../renderer/src/strings.js";

/**
 * COOKBOOK's page arithmetic (ADR-090). What is pinned here is the property the
 * whole page rests on: a scaled amount is the ORIGINAL amount times the factor
 * and then rounded by the unit's own kitchen rule, and a factor of exactly one
 * changes nothing at all. Every expected value below is either a hand
 * calculation written beside it or a value a person can check on a kitchen
 * scale.
 */

function line(overrides: Partial<RecipeIngredientView> = {}): RecipeIngredientView {
  return {
    id: "line-1",
    quantity: null,
    quantityMax: null,
    unit: null,
    rawText: "",
    name: "kupus",
    preparation: null,
    group: null,
    foodRef: null,
    gramsPerUnit: null,
    ...overrides,
  };
}

afterEach(() => {
  applyLocale("sr");
});

describe("clampServings", () => {
  it("keeps a count the store will take: a whole number in 1..100", () => {
    expect(clampServings(4)).toBe(4);
    expect(clampServings(0)).toBe(1);
    expect(clampServings(-3)).toBe(1);
    expect(clampServings(101)).toBe(100);
    // A typed „2,5 porcije" is rounded rather than refused: half a serving is a
    // number the store refuses, and the field's job is to hold one it takes.
    expect(clampServings(2.5)).toBe(3);
    expect(clampServings(Number.NaN)).toBe(1);
  });
});

describe("scaleLines", () => {
  it("multiplies by the factor and rounds by the unit's own kitchen rule", () => {
    // 200 g × 1.5 = 300 g, and 300 ≥ 100 so the rule rounds to a multiple of 5.
    expect(scaleLines([line({ quantity: 200, unit: "g" })], 4, 6)[0]?.quantity).toBe(300);
    // 2 kašike × 1.5 = 3 kašike — a quarter is the rule and 3 is already one.
    expect(scaleLines([line({ quantity: 2, unit: "tbsp" })], 4, 6)[0]?.quantity).toBe(3);
    // 1 čen × 1.5 = 1.5 — a count rounds to the nearest half, and half a clove
    // is a thing a person does.
    expect(scaleLines([line({ quantity: 1, unit: "clove" })], 2, 3)[0]?.quantity).toBe(1.5);
    // 1 šolja × 1.5 = 1.5 → the nearest eighth is 1.5 exactly.
    expect(scaleLines([line({ quantity: 1, unit: "cup" })], 2, 3)[0]?.quantity).toBe(1.5);
  });

  it("changes nothing when the servings asked for are the recipe's own", () => {
    const lines = [line({ quantity: 0.3, unit: "tsp" })];
    const scaled = scaleLines(lines, 4, 4);
    expect(scaled[0]?.quantity).toBe(0.3);
    // A factor of one hands the very same lines back, which is what makes a
    // re-render at the recipe's own size show the author's amounts.
    expect(scaled[0]).toBe(lines[0]);
  });

  it("keeps a line that states no amount as it is", () => {
    expect(scaleLines([line({ preparation: "po ukusu" })], 2, 8)[0]?.quantity).toBeNull();
  });
});

describe("formatAmount and unitLabel", () => {
  it("reads a quantity in the active locale with the unit's own label", () => {
    expect(formatAmount(2, 3, "tbsp")).toBe("2–3 kašika");
    expect(formatAmount(300, null, "g")).toBe("300 g");
    expect(formatAmount(null, null, "g")).toBe("");
    expect(unitLabel(null)).toBe("");
    expect(unitLabel("tbsp")).toBe(copy.units.tbsp);
  });

  it("reads the same value through the English table after a locale switch", () => {
    expect(formatAmount(2, 3, "tbsp")).toBe("2–3 kašika");
    applyLocale("en");
    expect(formatAmount(2, 3, "tbsp")).toBe("2–3 tbsp");
  });
});

describe("lineText", () => {
  it("draws the amount, the name and the preparation note, scaled", () => {
    expect(lineText(line({ quantity: 200, unit: "g", name: "kupus" }), 1.5)).toBe("300 g kupus");
    expect(lineText(line({ quantity: 2, unit: "tbsp", name: "ulje", preparation: "hladno" }), 1)).toBe(
      "2 kašika ulje, hladno",
    );
    expect(lineText(line({ name: "so", preparation: "po ukusu" }), 2)).toBe("so, po ukusu");
  });
});

describe("courseLabel", () => {
  it("names every course in the module's own vocabulary", () => {
    expect(courseLabel("main")).toBe(copy.courses.main);
    expect(courseLabel("other")).toBe(copy.courses.other);
  });
});

describe("formatTime and totalMinutes", () => {
  it("prints a duration the way a recipe does", () => {
    expect(formatTime(45)).toBe("45 min");
    expect(formatTime(60)).toBe("1 h");
    expect(formatTime(90)).toBe("1 h 30 min");
  });

  it("adds the two halves it has and answers null when neither is stated", () => {
    expect(totalMinutes({ prepMinutes: 15, cookMinutes: 45 })).toBe(60);
    expect(totalMinutes({ prepMinutes: null, cookMinutes: 30 })).toBe(30);
    expect(totalMinutes({ prepMinutes: null, cookMinutes: null })).toBeNull();
  });
});

describe("stepIndex", () => {
  it("clamps at both ends rather than wrapping", () => {
    expect(stepIndex(0, 1, 4)).toBe(1);
    expect(stepIndex(3, 1, 4)).toBe(3);
    expect(stepIndex(0, -1, 4)).toBe(0);
    // A recipe with no steps has no step to point at.
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});
