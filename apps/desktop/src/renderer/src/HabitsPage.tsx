import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ACCENT_IDS } from "@nexus/tokens";
import { Button, Checkbox, Chip, EmptyState, Icon, ListRow, LoadingState, PageHeader, TextField } from "@nexus/ui";
import { computeHabitStreak } from "@nexus/core";
import type { WeekStart } from "@nexus/core";
import {
  HABIT_MAX_PER_WEEK,
  HABIT_MAX_WEEKDAY,
  HABIT_MIN_WEEKDAY,
  MAX_HABIT_COUNT,
  MAX_HABIT_NAME_LENGTH,
  MAX_HABIT_UNIT_LENGTH,
} from "../../shared/ipc.js";
import type {
  Habit,
  HabitEntry,
  HabitSchedule,
  NoteFolderColor,
} from "../../shared/ipc.js";
import { localTodayKey } from "./examDates.js";
import {
  HABIT_WINDOW_DAYS,
  countsAsDone,
  habitDayStates,
  habitStartDay,
  habitWindowScore,
  habitsExpectedToday,
  indexHabitEntries,
  isEditableDayState,
  quotaWeekProgress,
  satisfiedDaysOf,
  shiftDay,
  valueOn,
  weekStartKey,
  type HabitEntryIndex,
} from "./habitDone.js";
import { HabitWall } from "./HabitWall.js";
import { habitDayPhrase, habitPeriodPhrase, habitWeekPhrase } from "./habitFormat.js";
import { readStoredDefaultReminder } from "./habitPrefs.js";
import { strings } from "./strings.js";
import { readStoredWeekStart, toWeekStart } from "./weekStart.js";
import { moduleName } from "./moduleName.js";

/**
 * Navike (HABIT slices b and c) — the module's page. Slice a shipped the storage
 * (migration 055), the two-kind schedule vocabulary and the streak engine; this
 * page is bound by every one of them and revisits none:
 *
 * - **Two schedule kinds, and no third.** „Dani" names the weekdays a habit is
 *   expected on; „Kvota" asks for N days a week, whichever ones. The form offers
 *   exactly these two because neither expresses the other — „teretana pon/sre/pet"
 *   is not „teretana 3× nedeljno", and that difference IS why somebody picks one.
 * - **„Urađeno" has ONE definition**, and it lives in `habitDone.ts` rather than
 *   in this file: a binary habit's day counts when it has an entry, a measured
 *   one's when its entry reaches the target. The ticks, the grid, the streaks
 *   and the 30-day figure all read that one module, because three inline copies
 *   is how they would stop agreeing.
 * - **The week start is the DEVICE's** (`weekStart.ts`), passed into
 *   `computeHabitStreak` and into the grid's layout. The engine takes it as a
 *   parameter precisely so nothing guesses it.
 * - **Nothing here invents a figure.** Every number on this screen is a fraction
 *   of what the schedule actually expected, and a habit with no history says so
 *   in words rather than reporting a zero it never earned. There is no
 *   percentage anywhere, and no projection.
 * - **A running period is never a miss.** Today's untouched tick, and this
 *   week's unmet quota, leave the niz standing and stay out of both halves of
 *   the 30-day fraction — `computeHabitStreak`'s own gentleness, restated on
 *   every surface that could contradict it.
 *
 * Slice c adds the two things slice b deliberately left for it:
 *
 * - **A past day can be corrected.** The history grid's cells are buttons
 *   wherever a day carries a verdict, and a click toggles that day through the
 *   very same one-entry-per-day path „Danas" writes on. Slice b let main stamp
 *   the day, which read as strict and was in fact a missing feature: the grid sat
 *   there showing yesterday's miss and the app had no way to be told otherwise.
 *   The day now travels and main validates BOTH its bounds (`asHabitEntryDay`) —
 *   a day the user names is data, exactly as a FIN transaction's date is.
 * - **„Podsetnik" is offered**, now that `reminder_time` does something: HABIT is
 *   a notification source from slice c, and a control that changes nothing is the
 *   only reason it was withheld.
 */

/** How many weeks of history the grid draws. Twelve: a season, which is about as far back as „da li mi ovo ide" is a real question. */
const HISTORY_WEEKS = 12;

const DAYS_PER_WEEK = 7;

/** Which schedule kind the form is editing. The stored value is `HabitSchedule`; this is only what the switch stands on. */
type ScheduleKind = HabitSchedule["kind"];

const SCHEDULE_KINDS: readonly ScheduleKind[] = ["days", "quota"];

/** The one open editor, if any — the FIN rail's shape: a create and an edit are one form. */
type Editing = null | { mode: "new" } | { mode: "edit"; id: string };

/**
 * Maps a habit store/IPC failure onto the Serbian copy by matching the store's
 * own validation messages (they cross IPC inside the error text) — the exact
 * shape `financeErrorMessage` uses for FIN. UX only: the store remains the
 * authority on what is rejected, and nothing here decides anything.
 */
function habitErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const copy = strings.habits.form;
  // The module's central refusal: an ADR-024 recurrence rule, or anything else
  // that is not one of the two kinds, dies at the wire and again at the store.
  if (message.includes("not a valid habit schedule")) return copy.invalidSchedule;
  if (message.includes(`"unit" needs a "target"`)) return copy.unitNeedsTarget;
  if (message.includes(`"unit" must be at most`)) return copy.invalidUnit;
  if (message.includes(`"name" must be`)) return copy.invalidName;
  if (message.includes(`"target" must be`) || message.includes(`"value" must be`)) {
    return copy.invalidTarget;
  }
  if (message.includes("No live habit") || message.includes("No deleted habit") ||
      message.includes("No archived habit") || message.includes("No unarchived habit")) {
    return copy.notFound;
  }
  return strings.habits.actionError;
}

/**
 * A grid cell's day in words — „sreda, 8. jul 2026." The WEEKDAY is in it and
 * that is the point: the cell is a 13px square in a lattice of eighty-four, so
 * the one thing a person aiming at it needs confirmed is which column they are
 * in. UTC-parsed, like every bare date in this house, so it never slides a day.
 */
function formatCellDate(day: string): string {
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

/** A schedule in words, for the row that carries it — the same reading in „Danas" and in „Sve navike". */
function scheduleLabel(schedule: HabitSchedule): string {
  const s = strings.habits.schedule;
  if (schedule.kind === "quota") return `${schedule.perWeek}${s.perWeekSuffix}`;
  if (schedule.weekdays.length === DAYS_PER_WEEK) return s.everyDay;
  return schedule.weekdays.map((iso) => s.weekdayShort[iso - 1] ?? "").join(" · ");
}

/**
 * The weekdays in the order THIS device reads a week in, as ISO numbers — the
 * order the picker offers and the order the grid's columns run in, so the two
 * never disagree with the calendar the user already has.
 */
function weekdayOrder(weekStart: WeekStart): number[] {
  // `WeekStart` is in `getUTCDay()` terms (1 = Monday, 0 = Sunday); ISO counts
  // Monday as 1 and Sunday as 7, so a Sunday-first week opens on ISO 7.
  const first = weekStart === 0 ? DAYS_PER_WEEK : weekStart;
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => ((first - 1 + index) % DAYS_PER_WEEK) + 1);
}

/** Everything one render of this page stands on, read in one round of parallel calls. */
interface HabitsSnapshot {
  habits: Habit[];
  entries: HabitEntry[];
}

/**
 * The page's one read. Both halves come back together for FIN's reason: a render
 * holding habits but not the ticks that make their streaks — or ticks that
 * predate the habit that changed — is never shown.
 *
 * The entry window opens at the EARLIEST habit's first day rather than at some
 * fixed horizon, because „Najduži niz" is a claim about the whole history and a
 * window would quietly turn it into „najduži u poslednjih N nedelja". It is
 * bounded all the same — no habit predates the profile.
 *
 * Module-level so the mount effect and every write's refresh call the same thing
 * without either becoming a dependency of the other.
 */
async function loadHabits(profileId: string): Promise<HabitsSnapshot> {
  const habits = await window.nexus.listHabits(profileId);
  if (habits.length === 0) return { habits, entries: [] };
  const today = localTodayKey();
  const from = habits.reduce(
    (earliest, habit) => (habitStartDay(habit) < earliest ? habitStartDay(habit) : earliest),
    today,
  );
  const entries = await window.nexus.habitEntries(profileId, { from, to: today });
  return { habits, entries };
}

export interface HabitsPageProps {
  profileId: string;
}

export function HabitsPage({ profileId }: HabitsPageProps) {
  const s = strings.habits;

  const [habits, setHabits] = useState<Habit[] | null>(null);
  const [entries, setEntries] = useState<HabitEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The one form, serving create and edit (the FIN rail's own shape).
  const [editing, setEditing] = useState<Editing>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [colorDraft, setColorDraft] = useState<NoteFolderColor | null>(null);
  const [kindDraft, setKindDraft] = useState<ScheduleKind>("days");
  const [weekdaysDraft, setWeekdaysDraft] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [perWeekDraft, setPerWeekDraft] = useState(3);
  const [targetDraft, setTargetDraft] = useState("");
  const [unitDraft, setUnitDraft] = useState("");
  // „HH:MM", or "" for no reminder — which is what every habit ships with.
  const [reminderDraft, setReminderDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Read once per render rather than held in state: it is a device preference
  // the „Izgled" card owns, and this page never writes it.
  const weekStart = toWeekStart(readStoredWeekStart());
  const today = localTodayKey();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const snapshot = await loadHabits(profileId);
        if (!active) return;
        setHabits(snapshot.habits);
        setEntries(snapshot.entries);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load habits:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  /**
   * Re-reads the whole screen after every write. A streak, a grid cell and a
   * 30-day fraction are all DERIVED from the ticks, so a page that patched one
   * row locally would show a niz that no longer follows from the days beside it.
   */
  async function reload(): Promise<void> {
    const snapshot = await loadHabits(profileId);
    setHabits(snapshot.habits);
    setEntries(snapshot.entries);
  }

  /** Runs one mutation: clears the previous refusal, performs it, re-reads. A failure leaves what was typed where it is. */
  async function run(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    try {
      await action();
      await reload();
    } catch (error) {
      setActionError(habitErrorMessage(error));
      console.error("Nexus: habit action failed:", error);
    }
  }

  function closeForm(): void {
    setEditing(null);
    setNameDraft("");
    setTargetDraft("");
    setUnitDraft("");
    setReminderDraft("");
    setFormError(null);
  }

  function beginNew(): void {
    setActionError(null);
    setNameDraft("");
    setColorDraft(null);
    setKindDraft("days");
    setWeekdaysDraft([1, 2, 3, 4, 5, 6, 7]);
    setPerWeekDraft(3);
    setTargetDraft("");
    setUnitDraft("");
    // Silent, always: the switch starts off and a new habit reminds about
    // nothing. This machine's default hour (the „Navike" settings card) is what
    // the field is FILLED with once the switch is turned on, never before.
    setReminderDraft("");
    setFormError(null);
    setEditing({ mode: "new" });
  }

  function beginEdit(habit: Habit): void {
    setActionError(null);
    setNameDraft(habit.name);
    setColorDraft(habit.color);
    setKindDraft(habit.schedule.kind);
    // Whichever kind is not being edited keeps a sensible standing value, so
    // flipping the switch never lands on an empty schedule the store must
    // refuse.
    setWeekdaysDraft(habit.schedule.kind === "days" ? habit.schedule.weekdays : [1, 2, 3, 4, 5, 6, 7]);
    setPerWeekDraft(habit.schedule.kind === "quota" ? habit.schedule.perWeek : 3);
    setTargetDraft(habit.target === null ? "" : String(habit.target));
    setUnitDraft(habit.unit ?? "");
    setReminderDraft(habit.reminderTime ?? "");
    setFormError(null);
    setEditing({ mode: "edit", id: habit.id });
  }

  /**
   * Writes the form. The one refusal repeated here rather than left to the
   * store is the target/unit pair: the store refuses a stranded unit by name,
   * and a form that let the user reach that refusal by accident would be asking
   * for something it already knows cannot be granted. Clearing the target
   * clears the unit with it, in the field's own handler, so the pair can never
   * be half-filled in the first place.
   */
  async function submitForm(event: FormEvent): Promise<void> {
    event.preventDefault();
    const current = editing;
    if (current === null) return;

    const name = nameDraft.trim();
    if (name === "") {
      setFormError(s.form.invalidName);
      return;
    }
    if (kindDraft === "days" && weekdaysDraft.length === 0) {
      setFormError(s.form.invalidWeekdays);
      return;
    }
    const trimmedTarget = targetDraft.trim();
    const target = trimmedTarget === "" ? null : Number(trimmedTarget);
    if (target !== null && (!Number.isInteger(target) || target < 1)) {
      setFormError(s.form.invalidTarget);
      return;
    }
    // The store's own ceiling, refused here so the message names the real
    // reason: „nije ceo broj" would be a lie about 999 999.
    if (target !== null && target > MAX_HABIT_COUNT) {
      setFormError(s.form.targetTooLarge);
      return;
    }
    const unit = target === null ? null : (unitDraft.trim() === "" ? null : unitDraft.trim());

    const schedule: HabitSchedule =
      kindDraft === "quota"
        ? { kind: "quota", perWeek: perWeekDraft }
        : { kind: "days", weekdays: [...weekdaysDraft].sort((a, b) => a - b) };
    // An empty time is „bez podsetnika", which is null on the wire — the store
    // refuses anything that is not a wall-clock HH:MM, and `<input type="time">`
    // is what makes „" the only other thing this field can hold.
    const reminderTime = reminderDraft.trim() === "" ? null : reminderDraft;
    const fields = { name, color: colorDraft, schedule, target, unit, reminderTime };

    setFormError(null);
    try {
      if (current.mode === "new") {
        await window.nexus.createHabit(profileId, fields);
      } else {
        await window.nexus.updateHabit(profileId, current.id, fields);
      }
      closeForm();
      await reload();
    } catch (error) {
      setFormError(habitErrorMessage(error));
      console.error("Nexus: failed to save the habit:", error);
    }
  }

  /** Soft-deletes a habit and offers it back — one pending undo at a time, exactly as FIN and TASK do. */
  async function deleteHabit(habit: Habit): Promise<void> {
    if (editing?.mode === "edit" && editing.id === habit.id) closeForm();
    if (expandedId === habit.id) setExpandedId(null);
    await run(async () => {
      await window.nexus.deleteHabit(profileId, habit.id);
      setPendingUndoId(habit.id);
    });
  }

  async function undoDelete(): Promise<void> {
    const id = pendingUndoId;
    if (id === null) return;
    await run(async () => {
      await window.nexus.restoreHabit(profileId, id);
      setPendingUndoId(null);
    });
  }

  /**
   * Sets or clears ONE day's tick — the single write path for both surfaces that
   * record anything: „Danas"'s controls, which pass today, and a history cell,
   * which passes the day it draws. Zero is not a value this store holds — an
   * untick is a delete — so a stepper walked down to nothing calls
   * `habits:clear-entry` rather than writing a zero row.
   *
   * The day is always stated rather than left to main, which is the whole of
   * slice c's change here: „Danas" says today because it means today, not
   * because main would otherwise have guessed right.
   */
  async function setDay(habit: Habit, day: string, value: number): Promise<void> {
    await run(async () => {
      if (value < 1) {
        await window.nexus.clearHabitEntry(profileId, habit.id, day);
      } else {
        await window.nexus.setHabitEntry(profileId, habit.id, day, value);
      }
    });
  }

  /**
   * Flips one past (or present) day between done and not — what a click on a
   * history cell does.
   *
   * A measured habit's corrected day is set to its TARGET rather than opened as a
   * stepper. A stepper per grid cell would be a second editor for the same fact,
   * eighty-four of them on one screen, in 13px squares — and „I did do my eight
   * glasses that Tuesday" is the correction people actually make. The exact
   * count for TODAY still has its own stepper in „Danas", where there is room to
   * mean something by it.
   */
  async function toggleDay(habit: Habit, day: string, done: boolean): Promise<void> {
    await setDay(habit, day, done ? 0 : (habit.target ?? 1));
  }

  // --- What this render draws ------------------------------------------------

  const habitList = habits ?? [];
  const index: HabitEntryIndex = indexHabitEntries(entries);

  /** What „Zid navika" is about: the regimen as it stands, which an archived habit has left. */
  const liveHabits = habitList.filter((habit) => habit.archivedAt === null);

  /**
   * What is expected today. The rule lives in `habitDone.ts` rather than here
   * since slice c: the „Navike danas" widget draws this same list, and two
   * inline copies is how a card and its page start disagreeing about what today
   * asks for.
   */
  const todayHabits = habitsExpectedToday(habitList, today);

  /** The grid's columns, in the device's own week order; the rows are the last 12 weeks, oldest first. */
  const gridWeekdays = weekdayOrder(weekStart);
  const historyWeeks: string[] = [];
  {
    const thisWeek = weekStartKey(today, weekStart);
    for (let offset = HISTORY_WEEKS - 1; offset >= 0; offset -= 1) {
      historyWeeks.push(shiftDay(thisWeek, -offset * DAYS_PER_WEEK));
    }
  }

  /** One habit's colour, as the swatch variable the folder palette already publishes — one palette, one source. */
  const swatchStyle = (color: NoteFolderColor | null) =>
    color === null ? undefined : { background: `var(--nx-swatch-${color})` };

  /**
   * The eight accent swatches plus „Bez boje" — the `note__swatch-row` recipe
   * outright, classes included, because a swatch picker is a swatch picker and
   * this module reuses the folder palette rather than minting a second colour
   * vocabulary. Selection is a 2px text-coloured ring, never a fill or a glow.
   */
  function renderSwatchRow(): ReactNode {
    return (
      <div className="note__swatch-row" role="group" aria-label={s.form.colorLabel}>
        {ACCENT_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`note__swatch${colorDraft === id ? " note__swatch--selected" : ""}`}
            style={{ background: `var(--nx-swatch-${id})` }}
            aria-label={id}
            aria-pressed={colorDraft === id}
            onClick={() => setColorDraft(id as NoteFolderColor)}
          />
        ))}
        <button
          type="button"
          className="note__swatch note__swatch--none"
          aria-label={s.form.noColor}
          aria-pressed={colorDraft === null}
          onClick={() => setColorDraft(null)}
        >
          <Icon name="swatchNone" size={14} />
        </button>
      </div>
    );
  }

  /**
   * „Danas"'s tick control: a checkbox for a binary habit, a stepper plus the
   * target for a measured one. Both write through `setDay` with TODAY stated
   * outright, so „urađeno" reaches the store as the same act either way — and as
   * the same act a history cell performs on a past day.
   */
  function renderTick(habit: Habit): ReactNode {
    const value = valueOn(index, habit.id, today);
    if (habit.target === null) {
      return (
        <Checkbox
          checked={value > 0}
          aria-label={`${s.stepper.check}: ${habit.name}`}
          onChange={(event) => void setDay(habit, today, event.target.checked ? 1 : 0)}
        />
      );
    }
    return (
      <span className="hab__stepper">
        <Button
          size="sm"
          className="hab__step"
          aria-label={`${s.stepper.decrease}: ${habit.name}`}
          disabled={value === 0}
          onClick={() => void setDay(habit, today, value - 1)}
        >
          <Icon name="minus" size={14} />
        </Button>
        <span className={countsAsDone(habit.target, value) ? "hab__count hab__count--done" : "hab__count"}>
          {`${value}/${habit.target}${habit.unit === null ? "" : ` ${habit.unit}`}`}
        </span>
        <Button
          size="sm"
          className="hab__step"
          aria-label={`${s.stepper.increase}: ${habit.name}`}
          onClick={() => void setDay(habit, today, value + 1)}
        >
          <Icon name="plus" size={14} />
        </Button>
      </span>
    );
  }

  /** One „Danas" row: the swatch, the name, what the schedule says, the niz, and the tick. */
  function renderTodayRow(habit: Habit): ReactNode {
    const streak = computeHabitStreak(habit.schedule, satisfiedDaysOf(habit, index), today, weekStart);
    const quota = quotaWeekProgress(habit, index, today, weekStart);
    return (
      <ListRow
        key={habit.id}
        leading={<span className="hab__dot" style={swatchStyle(habit.color)} aria-hidden="true" />}
        trailing={renderTick(habit)}
      >
        <span className="hab__row-body">
          <span className="hab__name">{habit.name}</span>
          <div className="hab__chips">
            <Chip>{scheduleLabel(habit.schedule)}</Chip>
            {/* A quota habit says how far into its week it is, as a plain
                fraction — the one figure that explains why it is on today's
                list at all. */}
            {quota !== null && (
              <Chip variant="data">
                {`${quota.done}/${quota.perWeek} ${s.today.thisWeek}`}
              </Chip>
            )}
            {streak.current > 0 && (
              <Chip variant="accent">
                {`${s.today.streakLabel}: ${habitPeriodPhrase(streak.current, habit.schedule.kind)}`}
              </Chip>
            )}
          </div>
        </span>
      </ListRow>
    );
  }

  /**
   * The 12-week calendar. One row per week, one cell per day, in the device's
   * own weekday order — and a SATISFIED cell takes the habit's own swatch, so
   * the page holds one colour vocabulary rather than a second one invented for
   * a grid.
   *
   * Since slice c the cells that carry a VERDICT are real buttons: a click
   * toggles that day through the same one-entry-per-day path „Danas" writes on.
   * The other two states stay inert `<span>`s and neither is an oversight — see
   * `isEditableDayState`. So the grid stops being a picture that only ever
   * accuses and becomes the place the accusation is answered, which is why it is
   * no longer `role="img"`: it is a group of controls, and each one announces
   * which day it is about and what pressing it will do.
   */
  function renderHistory(habit: Habit): ReactNode {
    const legend = s.detail;
    // Built from `HISTORY_WEEKS` rather than written out, so the heading cannot
    // outlive the span it names.
    const heading = `${legend.windowPrefix} ${habitWeekPhrase(HISTORY_WEEKS)}`;
    return (
      <div className="hab__history">
        <div className="hab__history-heading">{heading}</div>
        <div className="hab__grid" role="group" aria-label={`${heading}: ${habit.name}`}>
          {historyWeeks.map((weekOpens) => {
            // The week opens on the DEVICE's first day, so column `n` is the
            // n-th weekday in that same order — the grid and the picker read a
            // week the same way round.
            const days = gridWeekdays.map((_, column) => shiftDay(weekOpens, column));
            const states = habitDayStates(habit, index, days, today);
            return (
              <div key={weekOpens} className="hab__grid-week">
                {days.map((day, column) => {
                  const state = states[column] ?? "unjudged";
                  const className = `hab__cell hab__cell--${state}`;
                  const fill = state === "satisfied" ? swatchStyle(habit.color) : undefined;
                  if (!isEditableDayState(state)) {
                    return <span key={day} className={className} style={fill} title={day} />;
                  }
                  const done = state === "satisfied";
                  return (
                    <button
                      key={day}
                      type="button"
                      className={`${className} hab__cell--editable`}
                      style={fill}
                      // Both halves out loud: WHICH day, and what the press does
                      // to it. „Ćelija 3" would be a control nobody can aim.
                      //
                      // Deliberately NO `aria-pressed` beside a label that
                      // already changes with the state. The two are alternative
                      // conventions, not complementary ones — a constant label
                      // plus a pressed state (the swatch row above), or an action
                      // label that says what happens next. Both at once has a
                      // reader announcing „označi kao urađeno, nije pritisnuto",
                      // which states the same fact twice and in two directions.
                      aria-label={`${formatCellDate(day)}: ${
                        done ? legend.cellUnmark : legend.cellMark
                      }`}
                      title={`${formatCellDate(day)} · ${
                        done ? legend.cellUnmark : legend.cellMark
                      }`}
                      onClick={() => void toggleDay(habit, day, done)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
        {/* The three states named in words, because a colour nobody explained is
            a colour somebody has to guess. */}
        <div className="hab__legend">
          <span className="hab__legend-item">
            <span className="hab__cell hab__cell--satisfied" style={swatchStyle(habit.color)} />
            {legend.legendDone}
          </span>
          <span className="hab__legend-item">
            <span className="hab__cell hab__cell--missed" />
            {legend.legendMissed}
          </span>
          <span className="hab__legend-item">
            <span className="hab__cell hab__cell--unexpected" />
            {legend.legendOff}
          </span>
        </div>
        {/* Said once, quietly, rather than discovered: two of the four cell
            kinds are clickable and the other two are not, which is not
            something a colour can express. */}
        <p className="hab__note">{legend.gridHint}</p>
      </div>
    );
  }

  /** The habit's own numbers: the streak pair, and the honest 30-day fraction. */
  function renderStats(habit: Habit): ReactNode {
    const d = s.detail;
    const satisfied = satisfiedDaysOf(habit, index);
    const streak = computeHabitStreak(habit.schedule, satisfied, today, weekStart);
    const score = habitWindowScore(habit, index, today, weekStart);
    const kind = habit.schedule.kind;

    // Nothing recorded and nothing expected yet: a zero here would be a figure
    // about a period nobody was ever asked for.
    if (satisfied.length === 0 && score.expected === 0) {
      return <p className="hab__note">{d.noHistory}</p>;
    }

    return (
      <div className="hab__stats">
        <span className="hab__stat">
          <span className="hab__stat-label">{d.streakCurrent}</span>
          <span className="hab__stat-value">{habitPeriodPhrase(streak.current, kind)}</span>
        </span>
        <span className="hab__stat">
          <span className="hab__stat-label">{d.streakBest}</span>
          <span className="hab__stat-value">{habitPeriodPhrase(streak.best, kind)}</span>
        </span>
        <span className="hab__stat">
          {/* „Poslednjih 30 dana", with the 30 coming from the constant the
              window is actually measured over. */}
          <span className="hab__stat-label">
            {`${d.windowPrefix} ${habitDayPhrase(HABIT_WINDOW_DAYS)}`}
          </span>
          <span className="hab__stat-value">
            {`${score.done}/${
              score.kind === "weeks" ? habitWeekPhrase(score.expected) : habitDayPhrase(score.expected)
            }`}
          </span>
          {/* What the denominator IS — it is not thirty, and a fraction whose
              bottom half nobody explained is a fraction nobody can trust. */}
          <span className="hab__stat-caption">
            {score.kind === "weeks" ? d.windowWeeksCaption : d.windowDaysCaption}
          </span>
        </span>
      </div>
    );
  }

  /** One „Sve navike" row: the habit and its four actions, and — when expanded — its history and its numbers. */
  function renderHabitRow(habit: Habit): ReactNode {
    const archived = habit.archivedAt !== null;
    const expanded = expandedId === habit.id;
    return (
      <div key={habit.id} className="hab__item">
        <ListRow
          muted={archived}
          leading={<span className="hab__dot" style={swatchStyle(habit.color)} aria-hidden="true" />}
          trailing={
            <span className="hab__row-actions">
              <Button
                size="sm"
                className="hab__row-action"
                aria-expanded={expanded}
                aria-label={`${expanded ? s.all.collapse : s.all.expand}: ${habit.name}`}
                title={expanded ? s.all.collapse : s.all.expand}
                onClick={() => setExpandedId(expanded ? null : habit.id)}
              >
                <Icon name={expanded ? "chevronDown" : "chevronRight"} size={14} />
              </Button>
              <Button
                size="sm"
                className="hab__row-action"
                aria-label={`${s.all.edit}: ${habit.name}`}
                title={s.all.edit}
                onClick={() => beginEdit(habit)}
              >
                <Icon name="pencil" size={14} />
              </Button>
              <Button
                size="sm"
                className="hab__row-action"
                aria-label={`${archived ? s.all.unarchive : s.all.archive}: ${habit.name}`}
                title={archived ? s.all.unarchive : s.all.archive}
                onClick={() =>
                  void run(async () => {
                    if (archived) await window.nexus.unarchiveHabit(profileId, habit.id);
                    else await window.nexus.archiveHabit(profileId, habit.id);
                  })
                }
              >
                <Icon name={archived ? "unarchive" : "archive"} size={14} />
              </Button>
              <Button
                size="sm"
                className="hab__row-action hab__row-delete"
                aria-label={`${s.all.delete}: ${habit.name}`}
                title={s.all.delete}
                onClick={() => void deleteHabit(habit)}
              >
                <Icon name="trash" size={14} />
              </Button>
            </span>
          }
        >
          <span className="hab__row-body">
            <span className="hab__name">{habit.name}</span>
            <div className="hab__chips">
              <Chip>{scheduleLabel(habit.schedule)}</Chip>
              {habit.target !== null && (
                <Chip variant="data">
                  {`${habit.target}${habit.unit === null ? "" : ` ${habit.unit}`}`}
                </Chip>
              )}
              {archived && (
                <Chip className="hab__archived-chip" title={s.all.archivedChipTitle}>
                  {s.all.archivedChip}
                </Chip>
              )}
            </div>
          </span>
        </ListRow>
        {expanded && (
          <div className="hab__detail">
            {renderHistory(habit)}
            {renderStats(habit)}
          </div>
        )}
      </div>
    );
  }

  /** The Dani/Kvota picker and whatever the chosen kind needs. Two kinds, and the form offers no third. */
  function renderSchedulePicker(): ReactNode {
    const f = s.form;
    return (
      <>
        <div className="hab__segmented" role="group" aria-label={f.kindLabel}>
          {SCHEDULE_KINDS.map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant={kindDraft === kind ? "primary" : "ghost"}
              aria-pressed={kindDraft === kind}
              onClick={() => setKindDraft(kind)}
            >
              {kind === "days" ? f.kindDays : f.kindQuota}
            </Button>
          ))}
        </div>
        <span className="hab__field-hint">
          {kindDraft === "days" ? f.kindDaysHint : f.kindQuotaHint}
        </span>

        {kindDraft === "days" ? (
          <>
            <div className="hab__weekdays" role="group" aria-label={f.weekdaysLabel}>
              {weekdayOrder(weekStart).map((iso) => {
                const picked = weekdaysDraft.includes(iso);
                return (
                  <Button
                    key={iso}
                    type="button"
                    size="sm"
                    className={picked ? "hab__weekday hab__weekday--picked" : "hab__weekday"}
                    aria-pressed={picked}
                    aria-label={s.schedule.weekdayLong[iso - 1] ?? String(iso)}
                    onClick={() =>
                      setWeekdaysDraft((current) =>
                        picked ? current.filter((day) => day !== iso) : [...current, iso],
                      )
                    }
                  >
                    {s.schedule.weekdayShort[iso - 1] ?? String(iso)}
                  </Button>
                );
              })}
            </div>
            {/* „Svaki dan" is genuinely the seven-day case (`habitSchedule.ts`),
                so this is a shortcut into the same value rather than a kind. */}
            <Button
              type="button"
              size="sm"
              className="hab__quiet"
              onClick={() =>
                setWeekdaysDraft(
                  Array.from(
                    { length: HABIT_MAX_WEEKDAY - HABIT_MIN_WEEKDAY + 1 },
                    (_, index) => HABIT_MIN_WEEKDAY + index,
                  ),
                )
              }
            >
              {f.everyDay}
            </Button>
          </>
        ) : (
          <label className="hab__field">
            <span className="hab__field-label">{f.perWeekLabel}</span>
            <select
              className="hab__select"
              value={String(perWeekDraft)}
              onChange={(event) => setPerWeekDraft(Number(event.target.value))}
            >
              {Array.from({ length: HABIT_MAX_PER_WEEK }, (_, index) => index + 1).map((count) => (
                <option key={count} value={String(count)}>
                  {count}
                </option>
              ))}
            </select>
          </label>
        )}
      </>
    );
  }

  // --- The screen -------------------------------------------------------------

  if (failed) {
    return <EmptyState title={s.loadErrorTitle} description={s.loadError} />;
  }
  if (habits === null) {
    return <LoadingState label={strings.app.loading} rows={6} />;
  }

  return (
    <div className="hab">
      <PageHeader title={moduleName("habits")} />
      {pendingUndoId !== null && (
        <div className="hab__undo" role="status">
          <span className="hab__undo-text">{s.all.deletedNotice}</span>
          <Button size="sm" className="hab__undo-action" onClick={() => void undoDelete()}>
            {s.undo}
          </Button>
          <Button
            size="sm"
            className="hab__quiet"
            aria-label={s.dismiss}
            onClick={() => setPendingUndoId(null)}
          >
            <Icon name="close" size={14} />
          </Button>
        </div>
      )}

      {/* The regimen before its parts. „Danas" and „Sve navike" are both lists
          of one habit at a time; the wall is the only thing on this page that
          shows the shape of the whole thing, so it opens the page. Live habits
          only — an archived one is no longer part of the regimen. */}
      {liveHabits.length > 0 && (
        <section className="hab__section" aria-label={s.wall.heading}>
          <HabitWall habits={liveHabits} index={index} today={today} weekStart={weekStart} />
        </section>
      )}

      <section className="hab__section" aria-label={s.today.heading}>
        <div className="hab__heading">{s.today.heading}</div>
        <p className="hab__note">{s.today.caption}</p>
        {habitList.length === 0 ? (
          // No habits at all and nothing expected today are two different
          // situations with two different answers; one sentence for both would
          // be a lie about one of them.
          <EmptyState
            title={s.all.emptyTitle}
            description={s.all.emptyDescription}
            action={
              <Button variant="primary" onClick={beginNew}>
                {s.all.newHabit}
              </Button>
            }
          />
        ) : todayHabits.length === 0 ? (
          <EmptyState title={s.today.emptyTitle} description={s.today.emptyDescription} />
        ) : (
          <div className="hab__list">{todayHabits.map((habit) => renderTodayRow(habit))}</div>
        )}
      </section>

      <section className="hab__section" aria-label={s.all.heading}>
        <div className="hab__heading">{s.all.heading}</div>

        {editing !== null ? (
          <form className="hab__form" onSubmit={(event) => void submitForm(event)}>
            <div className="hab__form-title">
              {editing.mode === "new" ? s.form.newTitle : s.form.editTitle}
            </div>
            <TextField
              label={s.form.nameLabel}
              value={nameDraft}
              placeholder={s.form.namePlaceholder}
              maxLength={MAX_HABIT_NAME_LENGTH}
              onChange={(event) => setNameDraft(event.target.value)}
            />
            <span className="hab__field-label">{s.form.colorLabel}</span>
            {renderSwatchRow()}

            {renderSchedulePicker()}

            <div className="hab__pair">
              <TextField
                label={s.form.targetLabel}
                value={targetDraft}
                inputMode="numeric"
                placeholder={s.form.targetPlaceholder}
                onChange={(event) => {
                  setTargetDraft(event.target.value);
                  // The store refuses a unit with no target to be the unit OF;
                  // clearing them together is how the form keeps the user from
                  // reaching that refusal by accident.
                  if (event.target.value.trim() === "") setUnitDraft("");
                }}
              />
              <TextField
                label={s.form.unitLabel}
                value={unitDraft}
                placeholder={s.form.unitPlaceholder}
                maxLength={MAX_HABIT_UNIT_LENGTH}
                disabled={targetDraft.trim() === ""}
                onChange={(event) => setUnitDraft(event.target.value)}
              />
            </div>
            <span className="hab__field-hint">{s.form.targetHint}</span>
            <span className="hab__field-hint">{s.form.unitHint}</span>

            {/* „Podsetnik" (slice c): a switch, and — only once it is on — a
                time. Two controls rather than one for a concrete reason: an
                empty `<input type="time">` has no answer to „what hour would you
                like", so a bare field could never open on this machine's usual
                one. The switch is what asks the question, and turning it on fills
                the field with the „Navike" card's default (`habitPrefs.ts`);
                turning it off clears the time, because „bez podsetnika" IS the
                absent value and not a second flag to keep in step.
                A habit still ships silent — the switch starts off. */}
            <div className="hab__field">
              <Checkbox
                checked={reminderDraft !== ""}
                onChange={(event) =>
                  setReminderDraft(event.target.checked ? readStoredDefaultReminder() : "")
                }
              >
                {s.form.reminderLabel}
              </Checkbox>
              {reminderDraft !== "" && (
                <span className="hab__reminder">
                  <input
                    type="time"
                    className="nx-textfield__input hab__time"
                    value={reminderDraft}
                    aria-label={s.form.reminderTimeLabel}
                    onChange={(event) => setReminderDraft(event.target.value)}
                  />
                </span>
              )}
            </div>
            <span className="hab__field-hint">{s.form.reminderHint}</span>

            {formError !== null && (
              <p className="hab__error" role="alert">
                {formError}
              </p>
            )}

            <div className="hab__form-actions">
              <Button type="submit" size="sm" variant="primary">
                {s.form.save}
              </Button>
              <Button type="button" size="sm" className="hab__quiet" onClick={closeForm}>
                {s.form.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="primary" onClick={beginNew}>
            {s.all.newHabit}
          </Button>
        )}

        {habitList.length > 0 && (
          <div className="hab__list">{habitList.map((habit) => renderHabitRow(habit))}</div>
        )}

        {actionError !== null && (
          <p className="hab__error" role="status">
            {actionError}
          </p>
        )}
      </section>
    </div>
  );
}
