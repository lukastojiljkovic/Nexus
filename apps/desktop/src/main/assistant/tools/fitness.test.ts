import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FitFoodStore,
  FitMealStore,
  FitMeasurementStore,
  FitRoutineStore,
  FitTargetStore,
  FitWorkoutStore,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { fitnessTools } from "./fitness.js";

/**
 * The FITNESS tools over a real database. What this suite pins is that every
 * write is the store's own write with a value the trusted side resolved: a food's
 * numbers come from the catalogue or the profile's row, a set's metric from its
 * exercise, and nothing a model says is stored as a macro or a metric. A name is
 * resolved or refused, never guessed, and a declined confirmation writes nothing.
 */

// Local 2026-10-10, 09:00: "today" for every tool below.
const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();
const TODAY = "2026-10-10";

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-fitness-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function tools(): readonly Tool[] {
  return fitnessTools({ profileDb: (id, open) => open(db.raw, id), now: () => NOW_MS });
}

function toolOf(name: string): Tool {
  const found = tools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function contextFor(locale: "sr" | "en", allow: boolean): {
  readonly context: ToolContext;
  readonly confirms: ConfirmRequest[];
} {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

const CATALOGUE_YOGHURT = "Jogurt, punomasni";
const CATALOGUE_BENCH = "Potisak sa klupe";
const CATALOGUE_HANG = "Vis na šipci";

describe("fitness.meal", () => {
  it("logs a catalogue food with the numbers the catalogue carries, and names the module", async () => {
    const { context, confirms } = contextFor("sr", true);
    const result = await toolOf("fitness.meal").run(
      { food: CATALOGUE_YOGHURT, slot: "breakfast", grams: 150, day: TODAY },
      context,
    );

    expect(result).toEqual({
      ok: true,
      content: "Upisano: 150 g „Jogurt, punomasni“, doručak (10. oktobar 2026).",
      navigateTo: { module: "fitness" },
    });
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.tool).toBe("fitness.meal");
    expect(confirms[0]?.effect).toBe("write");
    expect(confirms[0]?.summary).toContain("„Jogurt, punomasni“");

    const [item] = new FitMealStore(db.raw, profileId).listDay(TODAY).dorucak;
    expect(item).toMatchObject({ foodRef: "catalogue:jogurt-punomasni", grams: 150, slot: "dorucak" });
    expect(item?.per100g.kcal).toBe(61);
  });

  it("logs a food of the profile's own, by its name", async () => {
    const own = new FitFoodStore(db.raw, profileId).create(
      {
        name: "Domaća pita",
        category: "pekarsko",
        per100g: { kcal: 250, protein: 6, carbs: 30, fat: 11, fiber: 2, sugar: 3, sodiumMg: 300 },
      },
      NOW_ISO,
    );
    const { context } = contextFor("sr", true);
    const result = await toolOf("fitness.meal").run(
      { food: "domaća pita", slot: "lunch", grams: 200, day: TODAY },
      context,
    );
    expect(result.ok).toBe(true);
    const [item] = new FitMealStore(db.raw, profileId).listDay(TODAY).rucak;
    expect(item).toMatchObject({ foodRef: `user:${own.id}`, label: "Domaća pita", grams: 200 });
  });

  it("refuses a soft-deleted user food by name and writes nothing", async () => {
    const foods = new FitFoodStore(db.raw, profileId);
    const gone = foods.create({ name: "Stara pita", category: "pekarsko", per100g: { kcal: 1, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodiumMg: 0 } }, NOW_ISO);
    foods.softDelete(gone.id, NOW_ISO);
    const { context, confirms } = contextFor("sr", true);
    const result = await toolOf("fitness.meal").run(
      { food: "Stara pita", slot: "lunch", grams: 100, day: TODAY },
      context,
    );
    expect(result).toEqual({ ok: false, content: "Neuspešno: Nema namirnice „Stara pita“." });
    expect(confirms).toHaveLength(0);
  });

  it("refuses an ambiguous name, listing the candidates, and writes nothing", async () => {
    const { context, confirms } = contextFor("sr", true);
    const result = await toolOf("fitness.meal").run(
      { food: "jogurt", slot: "breakfast", grams: 150, day: TODAY },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.content).toContain("Jogurt, punomasni");
    expect(result.ok ? "" : result.content).toContain("Reci koja.");
    expect(confirms).toHaveLength(0);
  });

  it("writes nothing when the user declines", async () => {
    const { context } = contextFor("sr", false);
    const result = await toolOf("fitness.meal").run(
      { food: CATALOGUE_YOGHURT, slot: "breakfast", grams: 150, day: TODAY },
      context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(new FitMealStore(db.raw, profileId).listDay(TODAY).dorucak).toHaveLength(0);
  });

  it("refuses invalid arguments with the schema's message, and a future day", async () => {
    const { context } = contextFor("sr", true);
    const slot = await toolOf("fitness.meal").run(
      { food: CATALOGUE_YOGHURT, slot: "brunch", grams: 150 },
      context,
    );
    expect(slot.ok).toBe(false);
    const grams = await toolOf("fitness.meal").run(
      { food: CATALOGUE_YOGHURT, slot: "breakfast", grams: 0 },
      context,
    );
    expect(grams.ok).toBe(false);
    const future = await toolOf("fitness.meal").run(
      { food: CATALOGUE_YOGHURT, slot: "breakfast", grams: 150, day: "2026-10-11" },
      context,
    );
    expect(future).toEqual({ ok: false, content: 'Neuspešno: "day" must not be in the future.' });
  });
});

describe("fitness.day", () => {
  it("answers a day's meals and totals against the goals", async () => {
    new FitTargetStore(db.raw, profileId).save({ kcal: 800, proteinG: null, carbsG: null, fatG: null }, NOW_ISO);
    const { context } = contextFor("sr", true);
    await toolOf("fitness.meal").run(
      { food: CATALOGUE_YOGHURT, slot: "breakfast", grams: 150, day: TODAY },
      context,
    );

    const result = await toolOf("fitness.day").run({ day: TODAY }, context);
    expect(result).toEqual({
      ok: true,
      content: [
        "Ishrana, 10. oktobar 2026:",
        "- doručak: Jogurt, punomasni 150 g (91,5 kcal)",
        "Ukupno: kalorije 91,5 / 800 kcal, proteini 5,25 g, ugljeni hidrati 7,05 g, masti 4,8 g.",
      ].join("\n"),
    });
  });

  it("says nothing is logged for an empty day", async () => {
    const { context } = contextFor("sr", true);
    const result = await toolOf("fitness.day").run({ day: "2026-10-01" }, context);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.content : "").toContain("Ništa nije upisano za taj dan.");
  });
});

describe("fitness.set", () => {
  it("logs a weight and reps set from the exercise's catalogue metric, and starts the workout", async () => {
    const { context, confirms } = contextFor("sr", true);
    const result = await toolOf("fitness.set").run(
      { exercise: CATALOGUE_BENCH, weight: 60, reps: 8 },
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.ok ? result.navigateTo : undefined).toEqual({ module: "fitness" });
    expect(confirms[0]?.summary).toContain("Pokreće se trening");

    const open = new FitWorkoutStore(db.raw, profileId).open();
    expect(open).not.toBeNull();
    expect(open?.sets).toHaveLength(1);
    expect(open?.sets[0]).toMatchObject({
      exerciseRef: "catalogue:potisak-sa-klupe",
      metric: "weight_reps",
      weightKg: 60,
      reps: 8,
      seconds: null,
      kind: "working",
    });
  });

  it("takes the metric from the exercise, so a timed hold stores seconds and no weight", async () => {
    const { context } = contextFor("sr", true);
    const result = await toolOf("fitness.set").run({ exercise: CATALOGUE_HANG, seconds: 30 }, context);
    expect(result.ok).toBe(true);
    const [set] = new FitWorkoutStore(db.raw, profileId).open()?.sets ?? [];
    expect(set).toMatchObject({ metric: "time", seconds: 30, weightKg: null, reps: null });
  });

  it("refuses a weight on a timed exercise, and a set that is missing a number it records", async () => {
    const { context, confirms } = contextFor("sr", true);
    const weighted = await toolOf("fitness.set").run(
      { exercise: CATALOGUE_HANG, weight: 10, seconds: 30 },
      context,
    );
    expect(weighted).toEqual({ ok: false, content: "Neuspešno: „Vis na šipci“ ne beleži: težinu." });
    const missing = await toolOf("fitness.set").run({ exercise: CATALOGUE_BENCH, weight: 60 }, context);
    expect(missing).toEqual({ ok: false, content: "Neuspešno: „Potisak sa klupe“ traži: ponavljanja." });
    expect(confirms).toHaveLength(0);
    expect(new FitWorkoutStore(db.raw, profileId).open()).toBeNull();
  });

  it("adds to the workout already in progress and writes nothing when declined", async () => {
    const declining = contextFor("sr", false);
    const declined = await toolOf("fitness.set").run(
      { exercise: CATALOGUE_BENCH, weight: 60, reps: 8 },
      declining.context,
    );
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(new FitWorkoutStore(db.raw, profileId).open()).toBeNull();

    const accepting = contextFor("sr", true);
    await toolOf("fitness.set").run({ exercise: CATALOGUE_BENCH, weight: 60, reps: 8 }, accepting.context);
    await toolOf("fitness.set").run({ exercise: CATALOGUE_BENCH, weight: 62.5, reps: 6 }, accepting.context);
    const open = new FitWorkoutStore(db.raw, profileId).open();
    expect(open?.sets.map((set) => set.weightKg)).toEqual([60, 62.5]);
    expect(accepting.confirms[1]?.summary).not.toContain("Pokreće");
  });

  it("refuses an ambiguous exercise name", async () => {
    const { context } = contextFor("sr", true);
    const result = await toolOf("fitness.set").run({ exercise: "potisak", weight: 60, reps: 8 }, context);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.content).toContain("može da bude više stavki");
    expect(new FitWorkoutStore(db.raw, profileId).open()).toBeNull();
  });
});

describe("fitness.workout", () => {
  it("starts a workout, then finishes it", async () => {
    const { context } = contextFor("sr", true);
    const started = await toolOf("fitness.workout").run({ action: "start", day: TODAY }, context);
    expect(started).toEqual({
      ok: true,
      content: "Trening pokrenut za 10. oktobar 2026.",
      navigateTo: { module: "fitness" },
    });
    expect(new FitWorkoutStore(db.raw, profileId).open()?.day).toBe(TODAY);

    const finished = await toolOf("fitness.workout").run({ action: "finish" }, context);
    expect(finished.ok).toBe(true);
    expect(new FitWorkoutStore(db.raw, profileId).open()).toBeNull();
  });

  it("starts from a routine by its name and keeps the routine's name on the session", async () => {
    const routine = new FitRoutineStore(db.raw, profileId).create(
      { name: "Push", items: [] },
      NOW_ISO,
    );
    const { context } = contextFor("sr", true);
    const result = await toolOf("fitness.workout").run({ action: "start", routine: "push" }, context);
    expect(result.ok).toBe(true);
    expect(new FitWorkoutStore(db.raw, profileId).open()).toMatchObject({
      routineRef: routine.id,
      routineLabel: "Push",
    });
  });

  it("refuses a second start, finishing with nothing open, and a routine on finish", async () => {
    const { context } = contextFor("sr", true);
    await toolOf("fitness.workout").run({ action: "start" }, context);
    expect(await toolOf("fitness.workout").run({ action: "start" }, context)).toEqual({
      ok: false,
      content: "Neuspešno: Trening je već u toku; prvo ga završi.",
    });
    await toolOf("fitness.workout").run({ action: "finish" }, context);
    expect(await toolOf("fitness.workout").run({ action: "finish" }, context)).toEqual({
      ok: false,
      content: "Neuspešno: Nema treninga u toku.",
    });
    expect(
      await toolOf("fitness.workout").run({ action: "finish", routine: "Push" }, context),
    ).toEqual({ ok: false, content: "Neuspešno: Rutina se bira samo pri pokretanju treninga." });
  });

  it("starts nothing when declined", async () => {
    const { context } = contextFor("sr", false);
    const result = await toolOf("fitness.workout").run({ action: "start" }, context);
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(new FitWorkoutStore(db.raw, profileId).open()).toBeNull();
  });
});

describe("fitness.training", () => {
  it("lists recent sessions with their sets, most recent first, and the routine names", async () => {
    const workouts = new FitWorkoutStore(db.raw, profileId);
    const session = workouts.start({ day: "2026-10-08" }, NOW_ISO);
    workouts.logSet(
      session.id,
      {
        exerciseRef: "catalogue:potisak-sa-klupe",
        label: CATALOGUE_BENCH,
        metric: "weight_reps",
        primaryMuscles: ["grudi"],
        kind: "working",
        weightKg: 60,
        reps: 8,
      },
      NOW_ISO,
    );
    workouts.finish(session.id, NOW_ISO);
    new FitRoutineStore(db.raw, profileId).create({ name: "Push", items: [] }, NOW_ISO);

    const { context } = contextFor("sr", true);
    const result = await toolOf("fitness.training").run({ days: 14 }, context);
    expect(result).toEqual({
      ok: true,
      content: [
        "Treninzi (1):",
        "- 8. oktobar 2026 (bez rutine): Potisak sa klupe 60 kg × 8",
        "Rutine: Push.",
      ].join("\n"),
    });
  });

  it("says when nothing was trained in the window", async () => {
    const { context } = contextFor("sr", true);
    const result = await toolOf("fitness.training").run({ days: 1 }, context);
    expect(result).toEqual({ ok: true, content: "Nema treninga u poslednjih 1 dan." });
  });
});

describe("fitness.measure", () => {
  it("records a day's weight and girth, and keeps the fields the day already had", async () => {
    const { context } = contextFor("sr", true);
    await toolOf("fitness.measure").run({ day: TODAY, weightKg: 82.4, waistCm: 90 }, context);
    const result = await toolOf("fitness.measure").run({ day: TODAY, chestCm: 100 }, context);
    expect(result).toEqual({
      ok: true,
      content: "Merenje za 10. oktobar 2026 upisano.",
      navigateTo: { module: "fitness" },
    });

    const saved = new FitMeasurementStore(db.raw, profileId).get(TODAY);
    expect(saved?.weightKg).toBe(82.4);
    expect(saved?.circumferences).toMatchObject({ waist: 90, chest: 100, hip: null });
  });

  it("needs a weight for a day that has none, and writes nothing when declined", async () => {
    const { context } = contextFor("sr", true);
    const noWeight = await toolOf("fitness.measure").run({ day: "2026-10-09", waistCm: 90 }, context);
    expect(noWeight).toEqual({ ok: false, content: "Neuspešno: Za 9. oktobar 2026 još nema težine; navedi je." });

    await toolOf("fitness.measure").run({ day: TODAY, weightKg: 82.4 }, context);
    const declining = contextFor("sr", false);
    const declined = await toolOf("fitness.measure").run(
      { day: TODAY, weightKg: 80, waistCm: 88 },
      declining.context,
    );
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(new FitMeasurementStore(db.raw, profileId).get(TODAY)).toMatchObject({
      weightKg: 82.4,
      circumferences: { waist: null },
    });
  });

  it("refuses a call that records nothing", async () => {
    const { context } = contextFor("sr", true);
    expect(await toolOf("fitness.measure").run({}, context)).toEqual({
      ok: false,
      content: "Neuspešno: Nema šta da se upiše: navedi težinu ili obim.",
    });
  });
});

describe("fitness.goals", () => {
  it("changes only the goals it is given", async () => {
    const { context, confirms } = contextFor("sr", true);
    await toolOf("fitness.goals").run({ kcal: 800 }, context);
    const result = await toolOf("fitness.goals").run({ proteinG: 120 }, context);
    expect(result).toEqual({
      ok: true,
      content: "Ciljevi postavljeni: proteini 120 g.",
      navigateTo: { module: "fitness" },
    });
    expect(confirms[1]?.summary).toBe("Postavi ciljeve: proteini 120 g.");

    const goals = new FitTargetStore(db.raw, profileId).get();
    expect(goals).toMatchObject({ kcal: 800, proteinG: 120, carbsG: null, fatG: null });
  });

  it("asks nothing for a goal that already reads that way, and refuses an empty call", async () => {
    const { context, confirms } = contextFor("sr", true);
    await toolOf("fitness.goals").run({ kcal: 800 }, context);
    const before = confirms.length;
    expect(await toolOf("fitness.goals").run({ kcal: 800 }, context)).toEqual({
      ok: true,
      content: "Ciljevi su već takvi.",
    });
    expect(confirms.length).toBe(before);
    expect(await toolOf("fitness.goals").run({}, context)).toEqual({
      ok: false,
      content: "Neuspešno: Nema šta da se postavi: navedi bar jedan cilj.",
    });
  });
});

describe("fitness.measurements", () => {
  it("lists the readings of the window, most recent first, and says when there are none", async () => {
    const measurements = new FitMeasurementStore(db.raw, profileId);
    measurements.save({ day: "2026-10-01", weightKg: 83, bodyFatPercent: null, muscle: null, waterPercent: null, circumferences: { neck: null, chest: null, upperArm: null, waist: 92, thigh: null, hip: null } }, NOW_ISO);
    measurements.save({ day: TODAY, weightKg: 82.4, bodyFatPercent: null, muscle: null, waterPercent: null, circumferences: { neck: null, chest: null, upperArm: null, waist: null, thigh: null, hip: null } }, NOW_ISO);

    const { context } = contextFor("sr", true);
    const result = await toolOf("fitness.measurements").run({ days: 30 }, context);
    expect(result).toEqual({
      ok: true,
      content: [
        "Merenja (2):",
        "- 10. oktobar 2026: 82,4 kg",
        "- 1. oktobar 2026: 83 kg, struk 92 cm",
      ].join("\n"),
    });
  });

  it("says when there are no readings in the window", async () => {
    const { context } = contextFor("sr", true);
    expect(await toolOf("fitness.measurements").run({ days: 30 }, context)).toEqual({
      ok: true,
      content: "Nema merenja u poslednjih 30 dana.",
    });
  });
});

describe("the fitness tool set", () => {
  it("declares its eight tools, each named area.verb with both descriptions", () => {
    const names = tools().map((tool) => tool.name);
    expect(names).toEqual([
      "fitness.day",
      "fitness.meal",
      "fitness.training",
      "fitness.workout",
      "fitness.set",
      "fitness.measure",
      "fitness.goals",
      "fitness.measurements",
    ]);
    for (const tool of tools()) {
      expect(tool.description.sr.length).toBeGreaterThan(0);
      expect(tool.description.en.length).toBeGreaterThan(0);
    }
  });

  it("answers in English when the context is English", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("fitness.meal").run(
      { food: "Yoghurt, whole-milk", slot: "dinner", grams: 100, day: TODAY },
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.ok ? result.content : "").toBe(
      "Logged: 100 g “Jogurt, punomasni”, dinner (10 October 2026).",
    );
  });
});
