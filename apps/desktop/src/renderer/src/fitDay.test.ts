import { describe, expect, it } from "vitest";

import {
  GOAL_MACROS,
  canStepForward,
  formatGrams,
  formatKcal,
  gramsInputValue,
  itemMacros,
  macroGoals,
  parseAmountInput,
  totalOfItems,
} from "./fitDay.js";
import type { FitMealItem, FitMealSlot, FitTargets, FoodMacros } from "../../shared/ipc.js";

/**
 * „Ishrana"'s pure half (FIT slice b): what a day's figures ARE, before anything
 * draws them. The arithmetic itself is `@nexus/core`'s — this module only scales
 * a row, adds a list up and says how a total stands against a goal, and each of
 * those is a place the page could otherwise have grown its own second answer.
 */

const ZERO: FoodMacros = {
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
  sodiumMg: 0,
};

/** Per 100 g of something plausible: 200 kcal, 10 g protein, 20 g carbs, 9 g fat. */
const PER_100G: FoodMacros = {
  kcal: 200,
  protein: 10,
  carbs: 20,
  fat: 9,
  fiber: 3,
  sugar: 5,
  sodiumMg: 400,
};

function item(grams: number, slot: FitMealSlot = "rucak", per100g: FoodMacros = PER_100G): FitMealItem {
  return {
    id: `item-${grams}-${slot}`,
    profileId: "p1",
    date: "2026-08-01",
    slot,
    foodRef: "catalogue:jaje-celo-sirovo",
    label: "Nešto",
    grams,
    per100g,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  };
}

function targets(goals: Partial<Omit<FitTargets, "updatedAt">> = {}): FitTargets {
  return {
    kcal: goals.kcal ?? null,
    proteinG: goals.proteinG ?? null,
    carbsG: goals.carbsG ?? null,
    fatG: goals.fatG ?? null,
    updatedAt: null,
  };
}

describe("itemMacros / totalOfItems", () => {
  it("scales an item by its own weight through core's arithmetic", () => {
    expect(itemMacros(item(50))).toEqual({
      kcal: 100,
      protein: 5,
      carbs: 10,
      fat: 4.5,
      fiber: 1.5,
      sugar: 2.5,
      sodiumMg: 200,
    });
  });

  it("totals an empty list to zero of everything — what a day with nothing logged carries", () => {
    expect(totalOfItems([])).toEqual(ZERO);
  });

  it("adds a list up field by field", () => {
    const total = totalOfItems([item(50, "dorucak"), item(150, "rucak")]);
    expect(total.kcal).toBeCloseTo(400, 10);
    expect(total.protein).toBeCloseTo(20, 10);
    expect(total.fat).toBeCloseTo(18, 10);
  });

  it("rounds nothing — a total is rounded where it is drawn, not on the way through", () => {
    // 33 g of a 200 kcal/100 g food is 66 kcal exactly; 33.3 g is not a round
    // number and must not be made one here.
    expect(totalOfItems([item(33.3)]).kcal).toBeCloseTo(66.6, 10);
  });
});

describe("macroGoals", () => {
  it("answers for exactly the four macros the goals cover, in that order", () => {
    const rows = macroGoals(ZERO, targets());
    expect(rows.map((row) => row.macro)).toEqual([...GOAL_MACROS]);
    expect(GOAL_MACROS).toEqual(["kcal", "protein", "carbs", "fat"]);
  });

  // Protein is the one goal people set in order to REACH it, so being past it is
  // the goal met rather than missed. Without the distinction the page paints all
  // four in the overspent-envelope grammar, and eating enough protein reads as a
  // warning — the scold this module is not allowed to be.
  it("calls protein a FLOOR and the other three CEILINGS", () => {
    const rows = macroGoals(ZERO, targets({ kcal: 1800, proteinG: 120, carbsG: 200, fatG: 60 }));
    expect(rows.map((row) => (row.target === null ? null : row.sense))).toEqual([
      "ceiling",
      "floor",
      "ceiling",
      "ceiling",
    ]);
  });

  it("still reports `over` for a floor — the fact is the same, only its reading differs", () => {
    const [, protein] = macroGoals({ ...ZERO, protein: 150 }, targets({ proteinG: 120 }));
    if (protein?.target === null) throw new Error("expected a goal");
    expect(protein?.over).toBe(true);
    expect(protein?.sense).toBe("floor");
  });

  it("carries no ratios at all for a macro with no goal — there is no scale to draw one against", () => {
    const [kcal] = macroGoals({ ...ZERO, kcal: 1200 }, targets());
    expect(kcal?.target).toBeNull();
    expect(kcal?.value).toBe(1200);
    // The shape itself refuses to hand the page a fill it could only invent.
    expect(kcal && "valueRatio" in kcal).toBe(false);
  });

  it("fills to the fraction of the goal that is used, with the tick at the goal", () => {
    const [kcal] = macroGoals({ ...ZERO, kcal: 900 }, targets({ kcal: 1800 }));
    expect(kcal?.target).toBe(1800);
    if (kcal?.target === null) throw new Error("expected a goal");
    expect(kcal?.valueRatio).toBeCloseTo(0.5, 10);
    expect(kcal?.targetRatio).toBe(1);
    expect(kcal?.over).toBe(false);
  });

  it("rescales to the VALUE once it passes the goal, so the tick moves back and the bar stays full", () => {
    // The FIN budget's grammar exactly: the scale is max(value, goal), so an
    // exceeded goal shows how far past it you are rather than clipping at 100 %.
    const [, protein] = macroGoals({ ...ZERO, protein: 150 }, targets({ proteinG: 100 }));
    if (protein?.target === null) throw new Error("expected a goal");
    expect(protein?.valueRatio).toBe(1);
    expect(protein?.targetRatio).toBeCloseTo(2 / 3, 10);
    expect(protein?.over).toBe(true);
  });

  it("treats reaching the goal exactly as reached, never as over", () => {
    const [kcal] = macroGoals({ ...ZERO, kcal: 1800 }, targets({ kcal: 1800 }));
    if (kcal?.target === null) throw new Error("expected a goal");
    expect(kcal?.over).toBe(false);
    expect(kcal?.valueRatio).toBe(1);
  });

  it("keeps a goal of ZERO apart from no goal at all", () => {
    // NULL is „no goal" and 0 is „a goal of zero" — different claims, which the
    // schema, the store and this row all keep apart.
    const [withZero] = macroGoals({ ...ZERO, kcal: 500 }, targets({ kcal: 0 }));
    expect(withZero?.target).toBe(0);
    if (withZero?.target === null) throw new Error("expected a goal");
    expect(withZero?.over).toBe(true);
    expect(withZero?.valueRatio).toBe(1);
    expect(withZero?.targetRatio).toBe(0);

    const [withNone] = macroGoals({ ...ZERO, kcal: 500 }, targets());
    expect(withNone?.target).toBeNull();
  });

  it("draws an empty bar for a goal nothing has been logged against", () => {
    const [kcal] = macroGoals(ZERO, targets({ kcal: 2000 }));
    if (kcal?.target === null) throw new Error("expected a goal");
    expect(kcal?.valueRatio).toBe(0);
    expect(kcal?.targetRatio).toBe(1);
    expect(kcal?.over).toBe(false);
  });

  it("survives the degenerate day: a goal of zero with nothing logged", () => {
    const [kcal] = macroGoals(ZERO, targets({ kcal: 0 }));
    if (kcal?.target === null) throw new Error("expected a goal");
    expect(kcal?.valueRatio).toBe(0);
    expect(kcal?.targetRatio).toBe(0);
    expect(kcal?.over).toBe(false);
  });

  it("reads each macro off its own goal field", () => {
    const rows = macroGoals(
      { ...ZERO, kcal: 1, protein: 2, carbs: 3, fat: 4 },
      targets({ kcal: 10, proteinG: 20, carbsG: 30, fatG: 40 }),
    );
    expect(rows.map((row) => row.target)).toEqual([10, 20, 30, 40]);
    expect(rows.map((row) => row.value)).toEqual([1, 2, 3, 4]);
  });
});

describe("parseAmountInput", () => {
  it("reads a whole number", () => {
    expect(parseAmountInput("180")).toBe(180);
  });

  it("reads both separators — the Serbian comma and what a numeric keypad gives you", () => {
    expect(parseAmountInput("87,5")).toBe(87.5);
    expect(parseAmountInput("87.5")).toBe(87.5);
  });

  it("trims, and reads zero as zero — a goal of zero is a goal", () => {
    expect(parseAmountInput("  0 ")).toBe(0);
  });

  it("refuses grouping rather than guessing which reading was meant", () => {
    // „1.234" is 1234 to one reader and 1,234 to another; a diary that guesses
    // wrong holds the wrong number, so it is refused (`parseMoneyInput`'s rule).
    expect(parseAmountInput("1.234,5")).toBeNull();
  });

  it("refuses a negative, a sign, a blank and anything that is not a number", () => {
    for (const text of ["-5", "+5", "", "   ", "sto", "12g", "1e3", ".", ","]) {
      expect(parseAmountInput(text), text).toBeNull();
    }
  });

  it("refuses more precision than a kitchen has, never rounding it away", () => {
    expect(parseAmountInput("12,34")).toBe(12.34);
    expect(parseAmountInput("12,345")).toBeNull();
  });
});

describe("gramsInputValue", () => {
  it("writes the value back in the language the field reads", () => {
    expect(gramsInputValue(180)).toBe("180");
    expect(gramsInputValue(87.5)).toBe("87,5");
  });

  it("round-trips through the parser", () => {
    for (const grams of [1, 87.5, 250, 12.34]) {
      expect(parseAmountInput(gramsInputValue(grams))).toBe(grams);
    }
  });
});

describe("formatKcal / formatGrams", () => {
  it("shows calories whole — a tenth of a kilocalorie is noise", () => {
    expect(formatKcal(1234.6)).toBe("1.235");
  });

  it("shows grams to at most one decimal, and drops a trailing zero", () => {
    expect(formatGrams(12)).toBe("12");
    expect(formatGrams(12.34)).toBe("12,3");
  });
});

describe("canStepForward", () => {
  it("allows the walk back through history and stops at today", () => {
    expect(canStepForward("2026-07-31", "2026-08-01")).toBe(true);
    expect(canStepForward("2026-08-01", "2026-08-01")).toBe(false);
  });
});
