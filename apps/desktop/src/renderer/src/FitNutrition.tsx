import { useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  ListRow,
  LoadingState,
  ProportionBar,
  Select,
  TextField,
} from "@nexus/ui";
import { FOOD_CATEGORIES, macrosFor } from "@nexus/core";
import {
  FIT_MEAL_SLOTS,
  MAX_FIT_FOOD_NAME_LENGTH,
  MAX_FIT_FOOD_NOTES_LENGTH,
  MAX_FIT_FOOD_QUERY_LENGTH,
  MAX_FIT_FOOD_RESULTS,
  MAX_FIT_FOOD_SERVINGS,
  MAX_FIT_SERVING_LABEL_LENGTH,
} from "../../shared/ipc.js";
import type {
  FitDay,
  FitFood,
  FitFoodOption,
  FitMealItem,
  FitMealSlot,
  FitTargets,
  FoodCategory,
  FoodMacros,
  FoodServing,
  FoodSource,
} from "../../shared/ipc.js";
import { localTodayKey, shiftDayKey } from "./examDates.js";
import {
  canStepForward,
  formatGrams,
  formatKcal,
  gramsInputValue,
  itemMacros,
  macroGoals,
  parseAmountInput,
  totalOfItems,
  type GoalMacro,
  type MacroGoal,
} from "./fitDay.js";
import { strings } from "./strings.js";

/**
 * „Ishrana" (FIT slice b) — the food half of the FIT page, one of the two
 * sections `FitnessPage` switches between. Slice a shipped the food vocabulary,
 * the 426-food catalogue, migration 058 and the three stores; this section is
 * bound by every one of their decisions and revisits none:
 *
 * - **A logged item carries a SNAPSHOT.** What this page shows for a past day is
 *   what those foods carried when they were logged, never what they carry today.
 *   Which is also why nothing here sends macros: the page names a food by its
 *   `ref` and says how much, and MAIN resolves it and stamps the numbers (see
 *   `resolveLoggedFood`). Correcting a food changes what you log from now on and
 *   leaves last Tuesday exactly as it was.
 * - **The catalogue is app-shipped data, not rows.** „Moje namirnice" holds only
 *   what the user added; the picker searches both and tells them apart by one
 *   chip. There is nothing on this page that could edit a catalogue food,
 *   because there is no row to edit.
 * - **A meal is a `(dan, slot)` grouping.** Five sections are always drawn, and
 *   an empty one says „Prazno" rather than not existing — there is no meal to
 *   create, only things to put in one.
 * - **Every number can say where it came from.** „Odakle ovaj broj" is on every
 *   food the picker offers, and a `stated` food — kajmak, the one entry with no
 *   public source — shows its `basis` and its published `range` beside the
 *   figure, so a decided number never wears a measured one's clothes.
 * - **Nothing here advises.** There is no recommended intake, no projection and
 *   no verdict on a day. Goals are whatever the user set; a day past one says
 *   „preko cilja" and stops. The reference-only sentence is said once, under the
 *   totals, where the numbers it is about actually are.
 *
 * The bar grammar is the FIN month report's, deliberately and to the class name:
 * one track per macro, the fill on a scale of `max(value, goal)` and the goal as
 * a tick on that same scale, so an exceeded goal shows HOW FAR past rather than
 * clipping at full. Over takes the app's own semantic colour there as here — one
 * visual vocabulary for „past the line you drew", not a second one invented for
 * food.
 */

/** How far back the day walk goes in one press. */
const ONE_DAY = 1;

/** Which food form is open, if any — the FIN rail's shape: a create and an edit are one form. */
type FoodEditing = null | { mode: "new" } | { mode: "edit"; id: string };

/** The one pending undo, and which list it belongs to. */
type PendingUndo = null | { kind: "item"; id: string } | { kind: "food"; id: string };

/** A serving row while it is being typed — both halves are text until they parse. */
interface ServingDraft {
  label: string;
  grams: string;
}

/** The seven per-100 g fields, in the order the form draws them. */
const MACRO_FIELDS: readonly (keyof FoodMacros)[] = [
  "kcal",
  "protein",
  "carbs",
  "fat",
  "fiber",
  "sugar",
  "sodiumMg",
];

/** Every per-100 g field as text, which is what a form actually holds. */
type MacroDraft = Record<keyof FoodMacros, string>;

const EMPTY_MACRO_DRAFT: MacroDraft = {
  kcal: "",
  protein: "",
  carbs: "",
  fat: "",
  fiber: "",
  sugar: "",
  sodiumMg: "",
};

/**
 * The seven typed fields as macros, or null when one of them is not a number.
 *
 * An EMPTY field reads as ZERO, deliberately: „0 g šećera" is a real reading of
 * a real packet, and a form that took a blank to mean „unknown" would store a
 * number the user never saw. Every field is read explicitly rather than in a
 * loop, so the seven that come out are the seven `FoodMacros` names — nothing
 * here can build a partial record and call it macros.
 */
function readMacroDraft(draft: MacroDraft): FoodMacros | null {
  const read = (field: keyof FoodMacros): number | null => {
    const raw = draft[field].trim();
    return raw === "" ? 0 : parseAmountInput(raw);
  };
  const kcal = read("kcal");
  const protein = read("protein");
  const carbs = read("carbs");
  const fat = read("fat");
  const fiber = read("fiber");
  const sugar = read("sugar");
  const sodiumMg = read("sodiumMg");
  if (
    kcal === null ||
    protein === null ||
    carbs === null ||
    fat === null ||
    fiber === null ||
    sugar === null ||
    sodiumMg === null
  ) {
    return null;
  }
  return { kcal, protein, carbs, fat, fiber, sugar, sodiumMg };
}

function macroDraftOf(macros: FoodMacros): MacroDraft {
  return {
    kcal: gramsInputValue(macros.kcal),
    protein: gramsInputValue(macros.protein),
    carbs: gramsInputValue(macros.carbs),
    fat: gramsInputValue(macros.fat),
    fiber: gramsInputValue(macros.fiber),
    sugar: gramsInputValue(macros.sugar),
    sodiumMg: gramsInputValue(macros.sodiumMg),
  };
}

/**
 * Maps a store/IPC failure onto the Serbian copy by matching the store's own
 * validation messages (they cross IPC inside the error text) — the exact shape
 * `habitErrorMessage` uses. UX only: the store remains the authority on what is
 * rejected, and nothing here decides anything.
 */
function fitErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const copy = strings.fitness.form;
  if (message.includes(`"name" must be`)) return copy.invalidName;
  if (message.includes(`"category" must be`)) return copy.invalidCategory;
  if (message.includes(`"servings`)) return copy.invalidServing;
  if (message.includes("must be a finite number")) return copy.invalidNumber;
  if (
    message.includes("No live food") ||
    message.includes("No deleted food") ||
    message.includes("No live meal item") ||
    message.includes("No removed meal item") ||
    message.includes("names no food this build ships")
  ) {
    return copy.notFound;
  }
  return strings.fitness.actionError;
}

/**
 * The open day in words — „subota, 1. avgust 2026." UTC-parsed, like every bare
 * date in this house, so it never slides a day.
 */
function formatDayLong(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? day
    : new Intl.DateTimeFormat("sr-Latn", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

/** A macro figure with its unit — kcal is whole, the three grams take one decimal. */
function macroText(macro: GoalMacro, value: number): string {
  const u = strings.fitness.totals;
  return macro === "kcal"
    ? `${formatKcal(value)} ${u.unitKcal}`
    : `${formatGrams(value)} ${u.unitGram}`;
}

/** Everything one render of this page stands on, read in one round. */
interface FitnessSnapshot {
  day: FitDay;
  targets: FitTargets;
  foods: FitFood[];
}

/**
 * The page's one read. All three halves come back together for `HabitsPage`'s
 * reason: a render holding the day's rows but not the goals they are drawn
 * against — or a food list that no longer matches what the picker would offer —
 * is never shown.
 *
 * Module-level so the day effect and every write's refresh call the same thing
 * without either becoming a dependency of the other.
 */
async function loadFitness(profileId: string, day: string): Promise<FitnessSnapshot> {
  const [dayData, targets, foods] = await Promise.all([
    window.nexus.fitDay(profileId, day),
    window.nexus.fitTargets(profileId),
    window.nexus.fitFoods(profileId),
  ]);
  return { day: dayData, targets, foods };
}

export interface FitNutritionProps {
  profileId: string;
}

export function FitNutrition({ profileId }: FitNutritionProps) {
  const s = strings.fitness;

  const today = localTodayKey();
  const [day, setDay] = useState(today);
  const [snapshot, setSnapshot] = useState<FitnessSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo>(null);

  // The picker: which slot it is filling, what has been typed, what came back
  // and what was chosen.
  const [pickerSlot, setPickerSlot] = useState<FitMealSlot | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FitFoodOption[]>([]);
  // True only when the search fetch itself rejected — kept apart from an
  // empty `results`, which is a real answer ("nothing matched").
  const [searchFailed, setSearchFailed] = useState(false);
  const [chosen, setChosen] = useState<FitFoodOption | null>(null);
  const [amountDraft, setAmountDraft] = useState("");
  const [pickerError, setPickerError] = useState<string | null>(null);

  // One item's weight AND its meal, while they are being corrected in place.
  //
  // The slot was the missing half. `fitUpdateItem` has always taken it — the
  // patch, the validator and the store all name it — but no control ever asked
  // for it, so a yoghurt logged under „Doručak" that was actually the morning
  // snack could only be fixed by deleting the row and typing it again, and the
  // undo bar then held a delete the user did not really mean. A correction form
  // that can fix one of a row's two facts is a correction form with a hole in
  // it.
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemGramsDraft, setItemGramsDraft] = useState("");
  const [itemSlotDraft, setItemSlotDraft] = useState<FitMealSlot>("dorucak");

  // „Moje namirnice": the one form, serving create and edit alike.
  const [editing, setEditing] = useState<FoodEditing>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<FoodCategory>("jela");
  const [macroDraft, setMacroDraft] = useState<MacroDraft>(EMPTY_MACRO_DRAFT);
  const [servingDrafts, setServingDrafts] = useState<ServingDraft[]>([]);
  const [notesDraft, setNotesDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedFoodId, setExpandedFoodId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await loadFitness(profileId, day);
        if (!active) return;
        setSnapshot(next);
        // Cleared on success, because this effect runs again on every day step:
        // a failure that outlived the day it happened on would leave the whole
        // page reading as broken for the rest of the session.
        setFailed(false);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load the food diary:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, day]);

  /**
   * The picker's search, debounced. The catalogue is four hundred foods and the
   * ranking runs in main, so a keystroke is cheap — but a round trip per
   * keystroke would still race itself, and the `active` flag is what keeps an
   * older answer from landing on a newer query.
   */
  useEffect(() => {
    const needle = query.trim();
    if (needle.length === 0) {
      setResults([]);
      setSearchFailed(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const found = await window.nexus.fitFoodSearch(profileId, needle, MAX_FIT_FOOD_RESULTS);
          if (active) {
            setResults(found);
            setSearchFailed(false);
          }
        } catch (error) {
          if (active) {
            setResults([]);
            setSearchFailed(true);
          }
          console.error("Nexus: the food search failed:", error);
        }
      })();
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [profileId, query]);

  /** Re-reads the whole screen after every write — the day's totals are DERIVED from its rows. */
  async function reload(): Promise<void> {
    setSnapshot(await loadFitness(profileId, day));
  }

  /** Runs one mutation: clears the previous refusal, performs it, re-reads. A failure leaves what was typed where it is. */
  async function run(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    try {
      await action();
      await reload();
    } catch (error) {
      setActionError(fitErrorMessage(error));
      console.error("Nexus: a food-diary action failed:", error);
    }
  }

  function closePicker(): void {
    setPickerSlot(null);
    setQuery("");
    setResults([]);
    setSearchFailed(false);
    setChosen(null);
    setAmountDraft("");
    setPickerError(null);
  }

  /**
   * Walks to another day, closing whatever was mid-edit on this one. Both
   * editors carry a DAY implicitly — the picker would log to wherever you had
   * navigated to by the time you pressed „Upiši", and an open weight field would
   * be pointing at a row that is no longer on screen — so the walk closes them
   * rather than letting either quietly change what it was about.
   */
  function goToDay(next: string): void {
    closePicker();
    setEditingItemId(null);
    setActionError(null);
    setDay(next);
  }

  function openPicker(slot: FitMealSlot): void {
    setActionError(null);
    closePicker();
    setPickerSlot(slot);
  }

  /** Choosing a food fills the amount with its first serving, or with 100 g — the basis every figure on this page is quoted on. */
  function chooseFood(option: FitFoodOption): void {
    setChosen(option);
    setPickerError(null);
    const [first] = option.servings;
    setAmountDraft(gramsInputValue(first?.grams ?? 100));
  }

  /** Logs the chosen food. The wire carries the REFERENCE and the weight; main resolves and snapshots. */
  async function submitPicker(event: FormEvent): Promise<void> {
    event.preventDefault();
    const slot = pickerSlot;
    const option = chosen;
    if (slot === null || option === null) return;
    const grams = parseAmountInput(amountDraft);
    if (grams === null || grams <= 0) {
      setPickerError(s.form.invalidNumber);
      return;
    }
    setPickerError(null);
    try {
      await window.nexus.fitAddItem(profileId, day, slot, option.ref, grams);
      closePicker();
      await reload();
    } catch (error) {
      setPickerError(fitErrorMessage(error));
      console.error("Nexus: failed to log the meal item:", error);
    }
  }

  function beginItemEdit(item: FitMealItem): void {
    setActionError(null);
    setEditingItemId(item.id);
    setItemGramsDraft(gramsInputValue(item.grams));
    // Seeded from the row, never from the slot the row is DRAWN in: the two are
    // the same today, and seeding from the drawing would be a second source for
    // a fact the item already carries.
    setItemSlotDraft(item.slot);
  }

  async function submitItemEdit(item: FitMealItem): Promise<void> {
    const grams = parseAmountInput(itemGramsDraft);
    if (grams === null || grams <= 0) {
      setActionError(s.form.invalidNumber);
      return;
    }
    await run(async () => {
      // Both fields go every time rather than only what changed: the patch is
      // an assignment of what the row should now say, and a „send only the
      // difference" rule would need to know what the row said when the form
      // opened — a second copy of the truth, for no gain.
      await window.nexus.fitUpdateItem(profileId, item.id, { grams, slot: itemSlotDraft });
      setEditingItemId(null);
    });
  }

  /** Removes one logged item and offers it back — one pending undo at a time, exactly as FIN, TASK and HABIT do. */
  async function removeItem(item: FitMealItem): Promise<void> {
    if (editingItemId === item.id) setEditingItemId(null);
    await run(async () => {
      await window.nexus.fitRemoveItem(profileId, item.id);
      setPendingUndo({ kind: "item", id: item.id });
    });
  }

  async function undoPending(): Promise<void> {
    const pending = pendingUndo;
    if (pending === null) return;
    await run(async () => {
      if (pending.kind === "item") await window.nexus.fitRestoreItem(profileId, pending.id);
      else await window.nexus.fitRestoreFood(profileId, pending.id);
      setPendingUndo(null);
    });
  }

  function closeForm(): void {
    setEditing(null);
    setNameDraft("");
    setMacroDraft(EMPTY_MACRO_DRAFT);
    setServingDrafts([]);
    setNotesDraft("");
    setFormError(null);
  }

  function beginNewFood(): void {
    setActionError(null);
    setNameDraft("");
    setCategoryDraft("jela");
    setMacroDraft(EMPTY_MACRO_DRAFT);
    setServingDrafts([]);
    setNotesDraft("");
    setFormError(null);
    setEditing({ mode: "new" });
  }

  function beginEditFood(food: FitFood): void {
    setActionError(null);
    setNameDraft(food.name);
    setCategoryDraft(food.category);
    setMacroDraft(macroDraftOf(food.per100g));
    setServingDrafts(
      food.servings.map((serving) => ({
        label: serving.label,
        grams: gramsInputValue(serving.grams),
      })),
    );
    setNotesDraft(food.notes);
    setFormError(null);
    setEditing({ mode: "edit", id: food.id });
  }

  /** Writes the food form. */
  async function submitFoodForm(event: FormEvent): Promise<void> {
    event.preventDefault();
    const current = editing;
    if (current === null) return;

    const name = nameDraft.trim();
    if (name === "") {
      setFormError(s.form.invalidName);
      return;
    }

    const per100g = readMacroDraft(macroDraft);
    if (per100g === null) {
      setFormError(s.form.invalidNumber);
      return;
    }

    const servings: FoodServing[] = [];
    for (const draft of servingDrafts) {
      const label = draft.label.trim();
      const grams = parseAmountInput(draft.grams);
      // A half-filled row is dropped rather than refused only when it is empty
      // on BOTH halves — an abandoned row costs nothing, a half-typed one is a
      // mistake worth naming.
      if (label === "" && draft.grams.trim() === "") continue;
      if (label === "" || grams === null || grams <= 0) {
        setFormError(s.form.invalidServing);
        return;
      }
      servings.push({ label, grams });
    }

    const fields = { name, category: categoryDraft, per100g, servings, notes: notesDraft.trim() };
    setFormError(null);
    try {
      if (current.mode === "new") await window.nexus.fitCreateFood(profileId, fields);
      else await window.nexus.fitUpdateFood(profileId, current.id, fields);
      closeForm();
      await reload();
    } catch (error) {
      setFormError(fitErrorMessage(error));
      console.error("Nexus: failed to save the food:", error);
    }
  }

  async function deleteFood(food: FitFood): Promise<void> {
    if (editing?.mode === "edit" && editing.id === food.id) closeForm();
    if (expandedFoodId === food.id) setExpandedFoodId(null);
    await run(async () => {
      await window.nexus.fitDeleteFood(profileId, food.id);
      setPendingUndo({ kind: "food", id: food.id });
    });
  }

  // --- What this render draws ------------------------------------------------

  /**
   * One macro's row: its name, the figure, and — only where a goal exists — the
   * track. A macro with no goal carries no ratios at all (`MacroGoal`), so there
   * is no fill here the page could have invented.
   */
  function renderGoalRow(goal: MacroGoal): ReactNode {
    const t = s.totals;
    const name = t.macro[goal.macro];
    const figure = macroText(goal.macro, goal.value);
    if (goal.target === null) {
      return (
        <ProportionBar
          key={goal.macro}
          label={name}
          value={
            <>
              {figure}
              <span className="fit__bar-nogoal">{t.noGoal}</span>
            </>
          }
          segments={[]}
          unmeasured
        />
      );
    }
    const goalText = macroText(goal.macro, goal.target);
    // Past a CEILING (calories, carbohydrate, fat) is what the goal was set to
    // catch, so it takes the same grammar an overspent FIN envelope does. Past a
    // FLOOR (protein) is the goal being MET, so it takes the reached grammar
    // instead — painting „preko cilja" red on protein would turn eating enough
    // of it into a warning, which is the one thing this page must never do.
    //
    // `reached` gets no fill tone of its own: `--nx-success` and `--nx-data`
    // are the same jade (see tokens/themes/*.json), so the FILL already reads
    // identically whether the floor is reached or not — only the FIGURE below
    // changes weight and colour. `ProportionBar` has no `success` tone; it
    // needs none here.
    const past = goal.over && goal.sense === "ceiling";
    const reached = goal.over && goal.sense === "floor";
    const state = past ? `, ${t.over}` : reached ? `, ${t.reached}` : "";
    const modifier = past ? "--over" : reached ? "--reached" : "";
    // `describedAs` carries the state a screen reader cannot see — see the
    // same note on FIN's report line.
    return (
      <ProportionBar
        key={goal.macro}
        describedAs={`${name}: ${figure} / ${goalText}${state}`}
        label={name}
        value={
          <>
            <span className={modifier ? `fit__bar-figure${modifier}` : undefined}>{figure}</span>
            <span className="fit__bar-goal-text">{`/ ${goalText}`}</span>
          </>
        }
        segments={[
          {
            key: goal.macro,
            fraction: goal.valueRatio,
            tone: past ? "danger" : "data",
            label: figure,
          },
        ]}
        target={{ fraction: goal.targetRatio, label: goalText }}
      />
    );
  }

  /** A food's provenance, in full — the reason the catalogue was built the way it was. */
  function renderSource(source: FoodSource | null, notes: string): ReactNode {
    const c = s.source;
    return (
      <div className="fit__source">
        <div className="fit__source-heading">{c.heading}</div>
        {source === null ? (
          <p className="fit__note">{c.userFood}</p>
        ) : source.kind === "stated" ? (
          <>
            <p className="fit__source-kind">{c.stated}</p>
            <p className="fit__source-line">{`${c.basisLabel}: ${source.basis}`}</p>
            <p className="fit__source-line">{`${c.rangeLabel}: ${source.range}`}</p>
            {/* Said out loud wherever this food is picked or reviewed: a decided
                number must never wear a measured one's clothes. */}
            <p className="fit__note fit__note--stated">{c.statedNote}</p>
          </>
        ) : source.kind === "derived" ? (
          <>
            <p className="fit__source-kind">{c.derived}</p>
            <p className="fit__source-line">
              {`${c.yieldLabel}: ${formatGrams(source.yieldGrams)} ${s.totals.unitGram}`}
            </p>
            <div className="fit__source-heading">{c.recipeLabel}</div>
            <ul className="fit__recipe">
              {source.recipe.map((component) => (
                <li key={`${component.what}-${component.grams}`} className="fit__recipe-row">
                  <span>{component.what}</span>
                  <span className="fit__recipe-grams">
                    {`${formatGrams(component.grams)} ${s.totals.unitGram}`}
                  </span>
                  {/* The component's own citation, as text — this app opens no
                      external links yet, and a link that did nothing would be
                      worse than an address that can be copied. */}
                  <span className="fit__source-url">{component.url}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="fit__source-kind">{source.kind === "usda" ? c.usda : c.official}</p>
            <p className="fit__source-line">{`${c.refLabel}: ${source.ref}`}</p>
            <p className="fit__source-url">{`${c.urlLabel}: ${source.url}`}</p>
          </>
        )}
        {notes.trim() !== "" && (
          <p className="fit__source-line">{`${c.notesLabel}: ${notes}`}</p>
        )}
      </div>
    );
  }

  /** The seven per-100 g figures of whatever is being inspected, as a plain row of facts. */
  function renderMacroFacts(macros: FoodMacros): ReactNode {
    const t = s.totals;
    return (
      <div className="fit__facts">
        <span className="fit__fact">
          <span className="fit__fact-label">{t.macro.kcal}</span>
          <span className="fit__fact-value">{`${formatKcal(macros.kcal)} ${t.unitKcal}`}</span>
        </span>
        {(["protein", "carbs", "fat"] as const).map((macro) => (
          <span key={macro} className="fit__fact">
            <span className="fit__fact-label">{t.macro[macro]}</span>
            <span className="fit__fact-value">
              {`${formatGrams(macros[macro])} ${t.unitGram}`}
            </span>
          </span>
        ))}
        {(["fiber", "sugar"] as const).map((macro) => (
          <span key={macro} className="fit__fact">
            <span className="fit__fact-label">{t.extra[macro]}</span>
            <span className="fit__fact-value">
              {`${formatGrams(macros[macro])} ${t.unitGram}`}
            </span>
          </span>
        ))}
        <span className="fit__fact">
          <span className="fit__fact-label">{t.extra.sodiumMg}</span>
          <span className="fit__fact-value">
            {`${formatGrams(macros.sodiumMg)} ${t.unitMilligram}`}
          </span>
        </span>
      </div>
    );
  }

  /** The picker: a query, a ranked list over both sources, and — once something is chosen — an amount. */
  function renderPicker(): ReactNode {
    const p = s.picker;
    const grams = parseAmountInput(amountDraft);
    return (
      <form className="fit__picker" onSubmit={(event) => void submitPicker(event)}>
        <div className="fit__chosen-head">
          <span className="fit__form-title">{p.add}</span>
          {/* The way out, present from the moment the picker opens: a panel that
              could only be closed by first choosing something would be a panel
              that traps you for changing your mind. */}
          <Button type="button" size="sm" className="fit__quiet" onClick={closePicker}>
            {p.cancel}
          </Button>
        </div>

        <TextField
          label={p.searchLabel}
          value={query}
          placeholder={p.searchPlaceholder}
          maxLength={MAX_FIT_FOOD_QUERY_LENGTH}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            setChosen(null);
          }}
        />

        {chosen === null ? (
          query.trim() === "" ? (
            <p className="fit__note">{p.idle}</p>
          ) : searchFailed ? (
            <p className="fit__error" role="alert">
              {p.searchError}
            </p>
          ) : results.length === 0 ? (
            <>
              <p className="fit__note">{p.noResults}</p>
              <p className="fit__note">{p.noResultsHint}</p>
            </>
          ) : (
            <div className="fit__results">
              {results.map((option) => (
                <ListRow
                  key={option.ref}
                  trailing={
                    <Button size="sm" onClick={() => chooseFood(option)}>
                      {p.choose}
                    </Button>
                  }
                >
                  <span className="fit__result-body">
                    <span className="fit__result-name">{option.name}</span>
                    <span className="fit__chips">
                      <Chip>{s.category[option.category]}</Chip>
                      <Chip variant="data">
                        {`${formatKcal(option.per100g.kcal)} ${s.totals.unitKcal} / 100 ${s.totals.unitGram}`}
                      </Chip>
                      {option.source === null && <Chip variant="accent">{p.mine}</Chip>}
                      {/* The uncertainty is visible at PICK time, not only once
                          the food is opened: a `stated` figure is a decided one. */}
                      {option.source?.kind === "stated" && <Chip>{s.source.stated}</Chip>}
                    </span>
                  </span>
                </ListRow>
              ))}
            </div>
          )
        ) : (
          <div className="fit__chosen">
            <div className="fit__chosen-head">
              <span className="fit__result-name">{chosen.name}</span>
              {/* „Nazad na listu", not „Otkaži": unchoosing a food and closing
                  the picker are two different acts, and the header above already
                  owns the second one. */}
              <Button
                size="sm"
                className="fit__quiet"
                onClick={() => {
                  setChosen(null);
                  setAmountDraft("");
                }}
              >
                {p.back}
              </Button>
            </div>

            <div className="fit__chosen-figures">
              <div className="fit__figures-heading">{p.per100gLabel}</div>
              {renderMacroFacts(chosen.per100g)}
            </div>

            {chosen.servings.length > 0 && (
              <>
                <span className="fit__field-label">{p.servingsLabel}</span>
                <div className="fit__servings" role="group" aria-label={p.servingsLabel}>
                  {chosen.servings.map((serving) => (
                    <Button
                      key={`${serving.label}-${serving.grams}`}
                      type="button"
                      size="sm"
                      className="fit__serving"
                      onClick={() => setAmountDraft(gramsInputValue(serving.grams))}
                    >
                      {`${serving.label} · ${formatGrams(serving.grams)} ${s.totals.unitGram}`}
                    </Button>
                  ))}
                </div>
              </>
            )}

            <TextField
              label={p.amountLabel}
              value={amountDraft}
              inputMode="decimal"
              placeholder={p.amountPlaceholder}
              onChange={(event) => setAmountDraft(event.target.value)}
            />

            {grams !== null && grams > 0 && (
              <div className="fit__chosen-figures">
                <div className="fit__figures-heading">{p.portionLabel}</div>
                {renderMacroFacts(macrosFor(chosen.per100g, grams))}
              </div>
            )}

            {renderSource(chosen.source, chosen.notes)}

            {pickerError !== null && (
              <p className="fit__error" role="alert">
                {pickerError}
              </p>
            )}

            <div className="fit__form-actions">
              <Button type="submit" size="sm" variant="primary">
                {p.submit}
              </Button>
            </div>
          </div>
        )}
      </form>
    );
  }

  /** One logged row: what, how much, and what it came to on this day. */
  function renderItem(item: FitMealItem): ReactNode {
    const macros = itemMacros(item);
    const editingThis = editingItemId === item.id;
    /**
     * Enter commits, Escape backs out — on EVERY field of the inline form, not
     * only on the one that happened to have it first. A correction row where
     * the keys work in the amount and do nothing in the meal picker is the same
     * class of half-application the slot control itself was: a rule present on
     * one path is not a rule.
     */
    function onEditKey(event: KeyboardEvent<HTMLElement>): void {
      if (event.key === "Enter") {
        event.preventDefault();
        void submitItemEdit(item);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setEditingItemId(null);
      }
    }
    return (
      <ListRow
        key={item.id}
        trailing={
          editingThis ? (
            <span className="fit__row-actions">
              {/* Which meal the row belongs to. Same `inline` arrangement the
                  rest of the app's controls rows use, so the label is visible
                  rather than smuggled into an `aria-label`. */}
              <Select
                label={s.item.slotLabel}
                layout="inline"
                className="fit__select"
                value={itemSlotDraft}
                onChange={(event) => setItemSlotDraft(event.target.value as FitMealSlot)}
                onKeyDown={onEditKey}
              >
                {FIT_MEAL_SLOTS.map((option) => (
                  <option key={option} value={option}>
                    {s.slot[option]}
                  </option>
                ))}
              </Select>
              {/* Opens with the caret in it, commits on Enter, backs out on
                  Escape — the inline row TASK has always had. This one opened a
                  field the user then had to click into, and offered no key at
                  all for either answer. */}
              <TextField
                value={itemGramsDraft}
                inputMode="decimal"
                label={s.picker.amountLabel}
                layout="inline"
                className="fit__grams-field"
                autoFocus
                onChange={(event) => setItemGramsDraft(event.target.value)}
                onKeyDown={onEditKey}
              />
              <Button size="sm" variant="primary" onClick={() => void submitItemEdit(item)}>
                {s.item.save}
              </Button>
              <Button size="sm" className="fit__quiet" onClick={() => setEditingItemId(null)}>
                {s.item.cancel}
              </Button>
            </span>
          ) : (
            <span className="fit__row-actions">
              <Chip variant="data">{`${formatKcal(macros.kcal)} ${s.totals.unitKcal}`}</Chip>
              <Button
                size="sm"
                className="fit__row-action"
                aria-label={`${s.item.edit}: ${item.label}`}
                title={s.item.edit}
                onClick={() => beginItemEdit(item)}
              >
                <Icon name="pencil" size={14} />
              </Button>
              <Button
                size="sm"
                className="fit__row-action fit__row-delete"
                aria-label={`${s.item.remove}: ${item.label}`}
                title={s.item.remove}
                onClick={() => void removeItem(item)}
              >
                <Icon name="trash" size={14} />
              </Button>
            </span>
          )
        }
      >
        <span className="fit__row-body">
          <span className="fit__row-title">{item.label}</span>
          <span className="fit__row-meta">
            {`${formatGrams(item.grams)} ${s.totals.unitGram} · ` +
              `${formatGrams(macros.protein)} ${s.totals.unitGram} ${s.totals.macro.protein} · ` +
              `${formatGrams(macros.carbs)} ${s.totals.unitGram} ${s.totals.macro.carbs} · ` +
              `${formatGrams(macros.fat)} ${s.totals.unitGram} ${s.totals.macro.fat}`}
          </span>
        </span>
      </ListRow>
    );
  }

  /** One meal: its heading, its own total, whatever is in it, and the way to add to it. */
  function renderSlot(slot: FitMealSlot, items: FitMealItem[]): ReactNode {
    const kcal = totalOfItems(items).kcal;
    return (
      <section key={slot} className="fit__slot" aria-label={s.slot[slot]}>
        <div className="fit__slot-head">
          <span className="fit__slot-name">{s.slot[slot]}</span>
          {items.length > 0 && (
            <span className="fit__slot-total">
              {`${s.item.slotTotal}: ${formatKcal(kcal)} ${s.totals.unitKcal}`}
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="fit__note">{s.item.emptySlot}</p>
        ) : (
          <div className="fit__list">{items.map((item) => renderItem(item))}</div>
        )}
        {pickerSlot === slot ? (
          renderPicker()
        ) : (
          <Button size="sm" onClick={() => openPicker(slot)}>
            {s.picker.add}
          </Button>
        )}
      </section>
    );
  }

  /** One of „Moje namirnice", with its numbers behind a toggle. */
  function renderFood(food: FitFood): ReactNode {
    const expanded = expandedFoodId === food.id;
    return (
      <div key={food.id} className="fit__food">
        <ListRow
          trailing={
            <span className="fit__row-actions">
              <Button
                size="sm"
                className="fit__row-action"
                aria-expanded={expanded}
                aria-label={`${expanded ? s.foods.collapse : s.foods.expand}: ${food.name}`}
                title={expanded ? s.foods.collapse : s.foods.expand}
                onClick={() => setExpandedFoodId(expanded ? null : food.id)}
              >
                <Icon name={expanded ? "chevronDown" : "chevronRight"} size={14} />
              </Button>
              <Button
                size="sm"
                className="fit__row-action"
                aria-label={`${s.foods.edit}: ${food.name}`}
                title={s.foods.edit}
                onClick={() => beginEditFood(food)}
              >
                <Icon name="pencil" size={14} />
              </Button>
              <Button
                size="sm"
                className="fit__row-action fit__row-delete"
                aria-label={`${s.foods.delete}: ${food.name}`}
                title={s.foods.delete}
                onClick={() => void deleteFood(food)}
              >
                <Icon name="trash" size={14} />
              </Button>
            </span>
          }
        >
          <span className="fit__row-body">
            <span className="fit__row-title">{food.name}</span>
            <span className="fit__chips">
              <Chip>{s.category[food.category]}</Chip>
              <Chip variant="data">
                {`${formatKcal(food.per100g.kcal)} ${s.totals.unitKcal} / 100 ${s.totals.unitGram}`}
              </Chip>
            </span>
          </span>
        </ListRow>
        {expanded && (
          <div className="fit__food-detail">
            <div className="fit__figures-heading">{s.form.macrosLabel}</div>
            {renderMacroFacts(food.per100g)}
            {food.servings.length > 0 && (
              <p className="fit__note">
                {`${s.form.servingsLabel}: ${food.servings
                  .map((serving) => `${serving.label} · ${formatGrams(serving.grams)} ${s.totals.unitGram}`)
                  .join(" · ")}`}
              </p>
            )}
            {food.notes.trim() !== "" && (
              <p className="fit__note">{`${s.source.notesLabel}: ${food.notes}`}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  /** The food form — a name, a shelf, seven numbers, the household measures and a sentence. */
  function renderFoodForm(current: Exclude<FoodEditing, null>): ReactNode {
    const f = s.form;
    return (
      <form className="fit__form" onSubmit={(event) => void submitFoodForm(event)}>
        <div className="fit__form-title">{current.mode === "new" ? f.newTitle : f.editTitle}</div>

        <TextField
          label={f.nameLabel}
          className="fit__text-field"
          value={nameDraft}
          placeholder={f.namePlaceholder}
          maxLength={MAX_FIT_FOOD_NAME_LENGTH}
          onChange={(event) => setNameDraft(event.target.value)}
        />

        <Select
          label={f.categoryLabel}
          className="fit__select"
          value={categoryDraft}
          onChange={(event) => setCategoryDraft(event.target.value as FoodCategory)}
        >
          {FOOD_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {s.category[category]}
            </option>
          ))}
        </Select>

        <span className="fit__field-label">{f.macrosLabel}</span>
        <div className="fit__macro-grid">
          {MACRO_FIELDS.map((field) => (
            <TextField
              key={field}
              label={
                field === "kcal"
                  ? `${s.totals.macro.kcal} (${s.totals.unitKcal})`
                  : field === "sodiumMg"
                    ? `${s.totals.extra.sodiumMg} (${s.totals.unitMilligram})`
                    : `${
                        field === "fiber" || field === "sugar"
                          ? s.totals.extra[field]
                          : s.totals.macro[field]
                      } (${s.totals.unitGram})`
              }
              value={macroDraft[field]}
              inputMode="decimal"
              placeholder="0"
              onChange={(event) =>
                setMacroDraft((draft) => ({ ...draft, [field]: event.target.value }))
              }
            />
          ))}
        </div>
        <span className="fit__field-hint">{f.macrosHint}</span>

        <span className="fit__field-label">{f.servingsLabel}</span>
        {servingDrafts.map((draft, index) => (
          <div key={index} className="fit__serving-row">
            <TextField
              value={draft.label}
              placeholder={f.servingLabelPlaceholder}
              maxLength={MAX_FIT_SERVING_LABEL_LENGTH}
              aria-label={f.servingLabelPlaceholder}
              onChange={(event) =>
                setServingDrafts((rows) =>
                  rows.map((row, at) => (at === index ? { ...row, label: event.target.value } : row)),
                )
              }
            />
            <TextField
              value={draft.grams}
              inputMode="decimal"
              placeholder={f.servingGramsPlaceholder}
              aria-label={s.totals.unitGram}
              onChange={(event) =>
                setServingDrafts((rows) =>
                  rows.map((row, at) => (at === index ? { ...row, grams: event.target.value } : row)),
                )
              }
            />
            <Button
              type="button"
              size="sm"
              className="fit__row-action"
              aria-label={f.removeServing}
              title={f.removeServing}
              onClick={() => setServingDrafts((rows) => rows.filter((_, at) => at !== index))}
            >
              <Icon name="close" size={14} />
            </Button>
          </div>
        ))}
        {servingDrafts.length < MAX_FIT_FOOD_SERVINGS && (
          <Button
            type="button"
            size="sm"
            className="fit__quiet"
            onClick={() => setServingDrafts((rows) => [...rows, { label: "", grams: "" }])}
          >
            {f.addServing}
          </Button>
        )}
        <span className="fit__field-hint">{f.servingsHint}</span>

        <TextField
          label={f.notesLabel}
          value={notesDraft}
          placeholder={f.notesPlaceholder}
          maxLength={MAX_FIT_FOOD_NOTES_LENGTH}
          onChange={(event) => setNotesDraft(event.target.value)}
        />

        {formError !== null && (
          <p className="fit__error" role="alert">
            {formError}
          </p>
        )}

        <div className="fit__form-actions">
          <Button type="submit" size="sm" variant="primary">
            {f.save}
          </Button>
          <Button type="button" size="sm" className="fit__quiet" onClick={closeForm}>
            {f.cancel}
          </Button>
        </div>
      </form>
    );
  }

  // --- The screen -------------------------------------------------------------

  if (failed) {
    return <EmptyState title={s.loadErrorTitle} description={s.loadError} />;
  }
  if (snapshot === null) {
    return <LoadingState label={strings.app.loading} rows={6} />;
  }

  const goals = macroGoals(snapshot.day.totals, snapshot.targets);
  const forward = canStepForward(day, today);
  const emptyDay = FIT_MEAL_SLOTS.every((slot) => snapshot.day.slots[slot].length === 0);

  return (
    <>
      {pendingUndo !== null && (
        <div className="fit__undo" role="status">
          <span className="fit__undo-text">
            {pendingUndo.kind === "item" ? s.item.removedNotice : s.foods.deletedNotice}
          </span>
          <Button size="sm" className="fit__undo-action" onClick={() => void undoPending()}>
            {s.undo}
          </Button>
          <Button
            size="sm"
            className="fit__quiet"
            aria-label={s.dismiss}
            onClick={() => setPendingUndo(null)}
          >
            <Icon name="close" size={14} />
          </Button>
        </div>
      )}

      <div className="fit__daybar">
        <Button
          size="sm"
          className="fit__day-step"
          aria-label={s.day.previous}
          title={s.day.previous}
          onClick={() => goToDay(shiftDayKey(day, -ONE_DAY))}
        >
          <Icon name="chevronLeft" size={14} />
        </Button>
        <span className="fit__day-name">{formatDayLong(day)}</span>
        <Button
          size="sm"
          className="fit__day-step"
          aria-label={s.day.next}
          title={forward ? s.day.next : s.day.noFuture}
          disabled={!forward}
          onClick={() => goToDay(shiftDayKey(day, ONE_DAY))}
        >
          <Icon name="chevronRight" size={14} />
        </Button>
        {day !== today && (
          <Button size="sm" className="fit__quiet" onClick={() => goToDay(today)}>
            {s.day.today}
          </Button>
        )}
      </div>

      <section className="fit__section" aria-label={s.totals.heading}>
        <div className="fit__heading">{s.totals.heading}</div>
        {emptyDay && <p className="fit__note">{s.totals.emptyDay}</p>}
        <div className="fit__bars">{goals.map((goal) => renderGoalRow(goal))}</div>
        {/* Said once, where the numbers it is about are. */}
        <p className="fit__note">{s.referenceOnly}</p>
        {snapshot.targets.updatedAt === null && <p className="fit__note">{s.totals.setGoals}</p>}
      </section>

      {/* Five meals, always five — each is its own labelled section, so the
          group needs no landmark of its own to be navigable. */}
      <div className="fit__slots">
        {FIT_MEAL_SLOTS.map((slot) => renderSlot(slot, snapshot.day.slots[slot]))}
      </div>

      <section className="fit__section" aria-label={s.foods.heading}>
        <div className="fit__heading">{s.foods.heading}</div>
        <p className="fit__note">{s.foods.caption}</p>

        {editing !== null ? (
          renderFoodForm(editing)
        ) : (
          <Button variant="primary" onClick={beginNewFood}>
            {s.foods.newFood}
          </Button>
        )}

        {snapshot.foods.length === 0 ? (
          editing === null && (
            <EmptyState title={s.foods.emptyTitle} description={s.foods.emptyDescription} />
          )
        ) : (
          <>
            <div className="fit__list">{snapshot.foods.map((food) => renderFood(food))}</div>
            {/* Said where deleting is possible, and nowhere else: what goes is
                the food, never what was eaten. */}
            <p className="fit__note">{s.foods.deleteNote}</p>
          </>
        )}
      </section>

      {actionError !== null && (
        <p className="fit__error" role="status">
          {actionError}
        </p>
      )}
    </>
  );
}
