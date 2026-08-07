import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button, Chip, EmptyState, Icon, ListRow, LoadingState, Select, TextField } from "@nexus/ui";
import {
  ACTIVITY_LEVELS,
  BODY_WEIGHT_MIN_SAMPLES,
  BODY_WEIGHT_WINDOW_DAYS,
  bmiFor,
  CIRCUMFERENCE_SITES,
  energyTiers,
  MEASURED_MIN_WINDOW_DAYS,
  movingAverage,
  suggestDailyEnergy,
  trendChange,
  WEIGHT_GOALS,
} from "@nexus/core";
import type {
  ActivityLevel,
  BodyMeasurement,
  BodyProfile,
  CircumferenceSite,
  EnergyEstimate,
  TrendPoint,
  WeightGoal,
} from "@nexus/core";
import type {
  BodySex,
  FitBodyProfile,
  FitDayTotals,
  FitMeasurement,
  FitTargets,
  MuscleReading,
} from "../../shared/ipc.js";
import { localTodayKey } from "./examDates.js";
import { parseAmountInput, gramsInputValue, formatKcal } from "./fitDay.js";
import { figureText } from "./fitWorkoutCopy.js";
import { countUnit, strings } from "./strings.js";

/**
 * „Merenja" (FIT slice d, ADR-081 §8 and §8a) — the third section of the FIT
 * page, and the one where an app is most tempted to invent numbers.
 *
 * Four rules, each of them a refusal:
 *
 * - **The scale is noisy and the page says so.** The figure and the line are
 *   both a 7-day moving average; the raw readings are drawn behind it so nothing
 *   is hidden; and a change is reported between two AVERAGES, never between
 *   yesterday and today.
 * - **Nexus computes no body-fat percentage.** Tape and skinfold formulas carry
 *   ±4 percentage points, more than a year of real change. The field takes what
 *   the user's caliper or scale reported.
 * - **BMI is drawn only while there is no body-fat reading**, and labelled for
 *   what it is: a population screening figure that reads a muscular person as
 *   overweight. With a real composition on file it adds nothing.
 * - **Every expenditure figure names the tier that produced it and what would
 *   reach the tier above.** That sentence is the feature (§8a) — a number with
 *   nothing beside it gets a digit of trust it never earned.
 *
 * And the suggestion is offered, never applied: `fit_targets` is written only by
 * a user who pressed the button. A number that silently replaced somebody's own
 * goal is the same failure as converting money at a rate the app cannot verify.
 */

/**
 * How far back the trend is read. `"all"` is not a number of days because there
 * is no honest number to pick: the whole history is however long this profile
 * has been weighing itself, and a body-weight arc is the one figure here that
 * only means something over years. The copy table has carried „Sve" since the
 * section was written and no control offered it, which is how a preference the
 * product wrote down goes unbuilt.
 */
const TREND_RANGES = [90, 365, "all"] as const;

type TrendRange = (typeof TREND_RANGES)[number];

/**
 * The `from` date a range asks for. „Sve" uses the store's own floor rather than
 * an invented one — `1970-01-01` is before any day key this app can hold, and
 * the query is a bounded range scan on an indexed column either way.
 */
function trendFrom(today: string, range: TrendRange): string {
  return range === "all" ? "1970-01-01" : windowStart(today, range);
}

/** The button's own label — one place, so the control and the copy table cannot drift again. */
function trendRangeLabel(range: TrendRange, s: (typeof strings.fitness.measure)["trend"]): string {
  if (range === 90) return s.range90;
  if (range === 365) return s.range365;
  return s.rangeAll;
}

/** The window the trend change is quoted over — a month, which is long enough that water weight cannot dominate it. */
const CHANGE_WINDOW_DAYS = 30;

/** Everything one render of this section stands on, read in one round. */
interface MeasureSnapshot {
  profile: FitBodyProfile | null;
  /** Ascending, as the store answers them. */
  measurements: FitMeasurement[];
  /** One total per logged day in the measured tier's window. Days with nothing logged are ABSENT. */
  intake: FitDayTotals[];
  targets: FitTargets;
}

/** The first day of a window of `days` ending on `today`, inclusive of both ends. */
function windowStart(today: string, days: number): string {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().slice(0, 10);
}

async function loadMeasure(
  profileId: string,
  from: string,
  today: string,
): Promise<MeasureSnapshot> {
  const [profile, measurements, intake, targets] = await Promise.all([
    window.nexus.fitBodyProfile(profileId),
    window.nexus.fitMeasurements(profileId, from, today),
    window.nexus.fitDayTotals(profileId, windowStart(today, MEASURED_MIN_WINDOW_DAYS), today),
    window.nexus.fitTargets(profileId),
  ]);
  return { profile, measurements, intake, targets };
}

/** The body profile as a form holds it — every field text until it parses. */
interface ProfileDraft {
  sex: BodySex | "";
  birthDate: string;
  heightCm: string;
  activity: ActivityLevel;
}

/** One reading as a form holds it. */
interface EntryDraft {
  day: string;
  weightKg: string;
  bodyFatPercent: string;
  muscleValue: string;
  muscleUnit: "percent" | "kg";
  waterPercent: string;
  circumferences: Record<CircumferenceSite, string>;
}

const EMPTY_CIRCUMFERENCES: Record<CircumferenceSite, string> = {
  neck: "",
  chest: "",
  upperArm: "",
  waist: "",
  hip: "",
  thigh: "",
};

export interface FitMeasurementsProps {
  profileId: string;
}

export function FitMeasurements({ profileId }: FitMeasurementsProps) {
  const s = strings.fitness.measure;
  const today = localTodayKey();

  const [range, setRange] = useState<TrendRange>(90);
  const [snapshot, setSnapshot] = useState<MeasureSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [entry, setEntry] = useState<EntryDraft>({
    day: today,
    weightKg: "",
    bodyFatPercent: "",
    muscleValue: "",
    muscleUnit: "percent",
    waterPercent: "",
    circumferences: EMPTY_CIRCUMFERENCES,
  });
  const [entryError, setEntryError] = useState<string | null>(null);

  const [goal, setGoal] = useState<WeightGoal>("maintain");
  const [rate, setRate] = useState("");

  const from = trendFrom(today, range);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await loadMeasure(profileId, from, today);
        if (!active) return;
        setSnapshot(next);
        setFailed(false);
        // The profile form is seeded ONCE from what is stored — after that it is
        // the user's draft, and a reload must not overwrite what they are typing.
        setProfileDraft((current) => current ?? draftOfProfile(next.profile));
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load the body measurements:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, from, today]);

  async function reload(): Promise<void> {
    setSnapshot(await loadMeasure(profileId, from, today));
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    try {
      await action();
      await reload();
    } catch (error) {
      setActionError(s.actionError);
      console.error("Nexus: a measurement action failed:", error);
    }
  }

  async function saveProfile(event: FormEvent): Promise<void> {
    event.preventDefault();
    const draft = profileDraft;
    if (draft === null) return;
    const heightCm = parseAmountInput(draft.heightCm);
    if (heightCm === null || heightCm <= 0) {
      setProfileError(s.profile.invalidHeight);
      return;
    }
    if (draft.birthDate.trim() === "") {
      setProfileError(s.profile.invalidBirth);
      return;
    }
    setProfileError(null);
    setNotice(null);
    await run(async () => {
      await window.nexus.fitSaveBodyProfile(profileId, {
        sex: draft.sex === "" ? null : draft.sex,
        birthDate: draft.birthDate,
        heightCm,
        activity: draft.activity,
      });
      setNotice(s.profile.saved);
    });
  }

  async function saveEntry(event: FormEvent): Promise<void> {
    event.preventDefault();
    const weightKg = parseAmountInput(entry.weightKg);
    if (weightKg === null || weightKg <= 0) {
      setEntryError(s.entry.invalidWeight);
      return;
    }
    const optional = readOptional(entry);
    if (optional === null) {
      setEntryError(s.entry.invalidNumber);
      return;
    }
    setEntryError(null);
    setNotice(null);
    await run(async () => {
      await window.nexus.fitSaveMeasurement(profileId, {
        day: entry.day,
        weightKg,
        ...optional,
      });
    });
  }

  function loadEntry(measurement: FitMeasurement): void {
    setEntryError(null);
    setEntry({
      day: measurement.day,
      weightKg: gramsInputValue(measurement.weightKg),
      bodyFatPercent:
        measurement.bodyFatPercent === null ? "" : gramsInputValue(measurement.bodyFatPercent),
      muscleValue: measurement.muscle === null ? "" : gramsInputValue(measurement.muscle.value),
      muscleUnit: measurement.muscle?.unit ?? "percent",
      waterPercent:
        measurement.waterPercent === null ? "" : gramsInputValue(measurement.waterPercent),
      circumferences: Object.fromEntries(
        CIRCUMFERENCE_SITES.map((site) => [
          site,
          measurement.circumferences[site] === null
            ? ""
            : gramsInputValue(measurement.circumferences[site]),
        ]),
      ) as Record<CircumferenceSite, string>,
    });
  }

  async function adoptTarget(kcal: number): Promise<void> {
    const current = snapshot?.targets;
    if (current === undefined) return;
    setNotice(null);
    await run(async () => {
      // The other three goals are carried through untouched: adopting a calorie
      // suggestion is a statement about calories and about nothing else.
      await window.nexus.fitSaveTargets(profileId, {
        kcal: Math.round(kcal),
        proteinG: current.proteinG,
        carbsG: current.carbsG,
        fatG: current.fatG,
      });
      setNotice(s.suggest.adopted);
    });
  }

  if (failed) {
    return <EmptyState title={s.loadErrorTitle} description={s.loadError} />;
  }
  if (snapshot === null || profileDraft === null) {
    return <LoadingState label={strings.app.loading} rows={6} />;
  }

  const latest = snapshot.measurements.at(-1) ?? null;
  const points = movingAverage(
    snapshot.measurements.map((measurement) => ({
      day: measurement.day,
      value: measurement.weightKg,
    })),
    BODY_WEIGHT_WINDOW_DAYS,
    BODY_WEIGHT_MIN_SAMPLES,
  );
  const change = trendChange(points, CHANGE_WINDOW_DAYS);
  const trendNow = points.at(-1)?.average ?? null;

  const profile = toBodyProfile(snapshot.profile);
  const measurement = toBodyMeasurement(latest);
  const tiers = energyTiers({
    profile,
    measurement,
    history: {
      from: windowStart(today, MEASURED_MIN_WINDOW_DAYS),
      to: today,
      intake: snapshot.intake.map((day) => ({ day: day.day, kcal: day.totals.kcal })),
      weights: snapshot.measurements.map((entryRow) => ({
        day: entryRow.day,
        weightKg: entryRow.weightKg,
      })),
    },
    today,
  });
  // BMI adds nothing beside a real body-fat reading, so it is not drawn beside
  // one (§8a). It is drawn — labelled — only in its absence.
  // Read HERE rather than in the suggestion component, so an unparseable rate is
  // a visible refusal instead of a panel that quietly fails to appear.
  const weeklyKg = goal === "maintain" ? 0 : parseAmountInput(rate.trim());

  const bmi =
    profile !== null && measurement !== null && measurement.bodyFatPercent === null
      ? bmiFor(profile, measurement)
      : null;

  return (
    <>
      {notice !== null && (
        <div className="fit__undo" role="status">
          <span className="fit__undo-text">{notice}</span>
          <Button
            size="sm"
            className="fit__quiet"
            aria-label={strings.fitness.dismiss}
            onClick={() => setNotice(null)}
          >
            <Icon name="close" size={14} />
          </Button>
        </div>
      )}

      <section className="fit__section" aria-label={s.profile.heading}>
        <div className="fit__heading">{s.profile.heading}</div>
        <p className="fit__note">{s.profile.caption}</p>
        <form className="fit__form" onSubmit={(event) => void saveProfile(event)}>
          <Select
            label={s.profile.sexLabel}
            className="fit__select"
            value={profileDraft.sex}
            onChange={(event) =>
            setProfileDraft({ ...profileDraft, sex: event.target.value as BodySex | "" })
            }
          >
            <option value="">{s.profile.sexNone}</option>
            <option value="male">{s.profile.sexMale}</option>
            <option value="female">{s.profile.sexFemale}</option>
          </Select>
          <TextField
            label={s.profile.birthLabel}
            type="date"
            value={profileDraft.birthDate}
            max={today}
            className="fit__day-field"
            onChange={(event) => setProfileDraft({ ...profileDraft, birthDate: event.target.value })}
          />
          <span className="fit__field-hint">{s.profile.birthHint}</span>
          <TextField
            label={s.profile.heightLabel}
            value={profileDraft.heightCm}
            inputMode="decimal"
            className="fit__set-field"
            onChange={(event) => setProfileDraft({ ...profileDraft, heightCm: event.target.value })}
          />
          <Select
            label={s.profile.activityLabel}
            className="fit__select"
            value={profileDraft.activity}
            onChange={(event) =>
            setProfileDraft({ ...profileDraft, activity: event.target.value as ActivityLevel })
            }
          >
            {ACTIVITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {s.profile.activity[level]}
              </option>
            ))}
          </Select>
          <span className="fit__field-hint">{s.profile.activityHint}</span>
          {profileError !== null && (
            <p className="fit__error" role="alert">
              {profileError}
            </p>
          )}
          <div className="fit__form-actions">
            <Button type="submit" size="sm" variant="primary">
              {s.profile.save}
            </Button>
          </div>
        </form>
      </section>

      <section className="fit__section" aria-label={s.trend.heading}>
        <div className="fit__heading">{s.trend.heading}</div>
        <p className="fit__note">{s.trend.caption}</p>
        <div className="fit__ranges" role="group" aria-label={s.trend.rangeLabel}>
          {TREND_RANGES.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              className="nx-segmented__option fit__range"
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {trendRangeLabel(option, s.trend)}
            </Button>
          ))}
        </div>

        {snapshot.measurements.length === 0 ? (
          <EmptyState title={s.trend.emptyTitle} description={s.trend.emptyDescription} />
        ) : (
          <>
            <div className="fit__figures">
              {trendNow !== null && (
                <span className="fit__fact">
                  <span className="fit__fact-label">{s.trend.currentLabel}</span>
                  <span className="fit__fact-value">{`${figureText(trendNow)} ${s.trend.unitKg}`}</span>
                </span>
              )}
              {change !== null && (
                <span className="fit__fact">
                  <span className="fit__fact-label">{s.trend.changeLabel}</span>
                  <span className="fit__fact-value">
                    {`${change.delta > 0 ? "+" : ""}${figureText(change.delta)} ${s.trend.unitKg} ` +
                      `${s.trend.overPrefix} ${String(change.days)} ` +
                      countUnit(
                        change.days,
                        s.trend.dayUnitOne,
                        s.trend.dayUnitFew,
                        s.trend.dayUnitMany,
                      )}
                  </span>
                </span>
              )}
            </div>
            {trendNow === null ? (
              // Two empty states in one section, and until now only one of them
              // had a title: „Još nema merenja" (nothing logged at all) got the
              // full `EmptyState`, while „there are readings but not two days of
              // them" was a bare grey line. `noTrendTitle` was written for this
              // and rendered nowhere.
              <EmptyState variant="inline" title={s.trend.noTrendTitle} description={s.trend.noTrend} />
            ) : (
              <TrendChart points={points} label={s.trend.chartLabel} />
            )}
            {bmi !== null && (
              <>
                <div className="fit__figures">
                  <span className="fit__fact">
                    <span className="fit__fact-label">{s.bmi.label}</span>
                    <span className="fit__fact-value">{figureText(bmi.value)}</span>
                  </span>
                </div>
                <p className="fit__note">{s.bmi.caveat}</p>
              </>
            )}
          </>
        )}
      </section>

      <section className="fit__section" aria-label={s.energy.heading}>
        <div className="fit__heading">{s.energy.heading}</div>
        {tiers.estimate === null ? (
          <EmptyState title={s.energy.noneTitle} description={s.energy.noneDescription} />
        ) : (
          <EnergyReport estimate={tiers.estimate} />
        )}
        {/* „What it would take to reach the tier above" — the sentence ADR-081
            §8a calls the feature. Only the tiers BETTER than the one in use are
            worth listing; the ones below it are already beaten. */}
        {tiers.gaps.length > 0 && (
          <div className="fit__gaps">
            <span className="fit__field-label">{s.energy.nextLabel}</span>
            {tiers.gaps
              .filter((gap) => tiers.estimate === null || betterThan(gap.method, tiers.estimate))
              .map((gap) => (
                <p key={gap.method} className="fit__note">
                  {`${s.energy.method[gap.method]}: ${gap.missing
                    .map((code) => s.energy.missing[code])
                    .join(", ")}`}
                </p>
              ))}
          </div>
        )}
        {tiers.measured?.status === "ready" && (
          <div className="fit__working">
            <span className="fit__field-label">{s.energy.workingLabel}</span>
            <p className="fit__note">
              {`${s.energy.workingIntake}: ${formatKcal(tiers.measured.detail.meanIntakeKcal)} ${s.energy.unit} · ` +
                `${s.energy.workingDelta}: ${figureText(tiers.measured.detail.deltaKg)} ${s.trend.unitKg} · ` +
                `${s.energy.workingDays}: ${String(tiers.measured.detail.daysBetweenTrends)} · ` +
                `${s.energy.workingCoverage}: ${String(tiers.measured.detail.loggedDays)}/${String(tiers.measured.detail.windowDays)}`}
            </p>
          </div>
        )}
        <p className="fit__note">{s.energy.windowNote}</p>
      </section>

      {tiers.estimate !== null && (
        <section className="fit__section" aria-label={s.suggest.heading}>
          <div className="fit__heading">{s.suggest.heading}</div>
          <div className="fit__start">
            <Select
              label={s.suggest.goalLabel}
              className="fit__select"
              value={goal}
              onChange={(event) => setGoal(event.target.value as WeightGoal)}
            >
              {WEIGHT_GOALS.map((option) => (
                <option key={option} value={option}>
                  {s.suggest.goal[option]}
                </option>
              ))}
            </Select>
            {goal !== "maintain" && (
              <TextField
                label={s.suggest.rateLabel}
                value={rate}
                inputMode="decimal"
                className="fit__set-field"
                onChange={(event) => setRate(event.target.value)}
              />
            )}
          </div>
          {goal !== "maintain" && <span className="fit__field-hint">{s.suggest.rateHint}</span>}
          {/* Three states, and the middle one is the reason the parse lives here
              rather than inside `Suggestion`: an EMPTY rate is „you have not said
              yet" and draws nothing, a rate that is not a number is a REFUSAL
              and says so, and only a real one produces a figure. A component
              that returned null for both of the first two would swallow the
              refusal — the user would type „pola" and watch the panel simply not
              appear. */}
          {weeklyKg !== null ? (
            <Suggestion
              estimate={tiers.estimate}
              goal={goal}
              weeklyKg={weeklyKg}
              onAdopt={(kcal) => void adoptTarget(kcal)}
            />
          ) : (
            rate.trim() !== "" && (
              <p className="fit__error" role="alert">
                {s.suggest.invalidRate}
              </p>
            )
          )}
          <p className="fit__note">{s.suggest.note}</p>
        </section>
      )}

      <section className="fit__section" aria-label={s.entry.heading}>
        <div className="fit__heading">{s.entry.heading}</div>
        <form className="fit__form" onSubmit={(event) => void saveEntry(event)}>
          <TextField
            label={s.entry.dayLabel}
            type="date"
            value={entry.day}
            max={today}
            className="fit__day-field"
            onChange={(event) => setEntry({ ...entry, day: event.target.value })}
          />
          {snapshot.measurements.some((row) => row.day === entry.day) && (
            <span className="fit__field-hint">{s.entry.overwrites}</span>
          )}
          <div className="fit__macro-grid">
            <TextField
              label={s.entry.weightLabel}
              value={entry.weightKg}
              inputMode="decimal"
              onChange={(event) => setEntry({ ...entry, weightKg: event.target.value })}
            />
            <TextField
              label={s.entry.bodyFatLabel}
              value={entry.bodyFatPercent}
              inputMode="decimal"
              onChange={(event) => setEntry({ ...entry, bodyFatPercent: event.target.value })}
            />
            <TextField
              label={s.entry.waterLabel}
              value={entry.waterPercent}
              inputMode="decimal"
              onChange={(event) => setEntry({ ...entry, waterPercent: event.target.value })}
            />
          </div>

          <span className="fit__field-label">{s.entry.muscleLabel}</span>
          <div className="fit__start">
            <TextField
              value={entry.muscleValue}
              inputMode="decimal"
              aria-label={s.entry.muscleLabel}
              className="fit__set-field"
              onChange={(event) => setEntry({ ...entry, muscleValue: event.target.value })}
            />
            <Select
              label={s.entry.muscleUnitLabel}
              className="fit__select"
              value={entry.muscleUnit}
              onChange={(event) =>
              setEntry({ ...entry, muscleUnit: event.target.value as "percent" | "kg" })
              }
            >
              <option value="percent">{s.entry.muscleUnitPercent}</option>
              <option value="kg">{s.entry.muscleUnitKg}</option>
            </Select>
          </div>
          <span className="fit__field-hint">{s.entry.muscleHint}</span>

          <span className="fit__field-label">{s.entry.circumferencesLabel}</span>
          <div className="fit__macro-grid">
            {CIRCUMFERENCE_SITES.map((site) => (
              <TextField
                key={site}
                label={s.entry.site[site]}
                value={entry.circumferences[site]}
                inputMode="decimal"
                onChange={(event) =>
                  setEntry({
                    ...entry,
                    circumferences: { ...entry.circumferences, [site]: event.target.value },
                  })
                }
              />
            ))}
          </div>
          <span className="fit__field-hint">{s.entry.hint}</span>

          {entryError !== null && (
            <p className="fit__error" role="alert">
              {entryError}
            </p>
          )}
          <div className="fit__form-actions">
            <Button type="submit" size="sm" variant="primary">
              {s.entry.save}
            </Button>
          </div>
        </form>

        {snapshot.measurements.length > 0 && (
          <div className="fit__list">
            {[...snapshot.measurements].reverse().map((row) => (
              <ListRow
                key={row.day}
                trailing={
                  <span className="fit__row-actions">
                    <Button
                      size="sm"
                      className="fit__row-action"
                      aria-label={`${strings.fitness.training.set.edit}: ${row.day}`}
                      title={strings.fitness.training.set.edit}
                      onClick={() => loadEntry(row)}
                    >
                      <Icon name="pencil" size={14} />
                    </Button>
                    <Button
                      size="sm"
                      className="fit__row-action fit__row-delete"
                      aria-label={`${s.entry.remove}: ${row.day}`}
                      title={s.entry.remove}
                      onClick={() =>
                        void run(async () => {
                          await window.nexus.fitRemoveMeasurement(profileId, row.day);
                        })
                      }
                    >
                      <Icon name="trash" size={14} />
                    </Button>
                  </span>
                }
              >
                <span className="fit__row-body">
                  <span className="fit__row-title">{`${figureText(row.weightKg)} ${s.trend.unitKg}`}</span>
                  <span className="fit__row-meta">{row.day}</span>
                  <span className="fit__chips">
                    {row.bodyFatPercent !== null && (
                      <Chip variant="data">{`${s.entry.bodyFatLabel}: ${figureText(row.bodyFatPercent)}`}</Chip>
                    )}
                    {row.muscle !== null && (
                      <Chip variant="data">
                        {`${s.entry.muscleLabel}: ${figureText(row.muscle.value)} ${
                          row.muscle.unit === "kg" ? s.entry.muscleUnitKg : s.entry.muscleUnitPercent
                        }`}
                      </Chip>
                    )}
                    {row.waterPercent !== null && (
                      <Chip variant="data">{`${s.entry.waterLabel}: ${figureText(row.waterPercent)}`}</Chip>
                    )}
                  </span>
                </span>
              </ListRow>
            ))}
          </div>
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

// --- The pieces --------------------------------------------------------------

/** Which methods outrank which. `ENERGY_METHODS` is already best-first, so this is a position comparison. */
function betterThan(method: EnergyEstimate["method"], estimate: EnergyEstimate): boolean {
  const order = ["measured", "katch-mcardle", "mifflin-st-jeor"] as const;
  return order.indexOf(method) < order.indexOf(estimate.method);
}

/** The estimate, the tier that produced it, and what it rests on — never the number alone. */
function EnergyReport({ estimate }: { estimate: EnergyEstimate }): ReactNode {
  const s = strings.fitness.measure.energy;
  return (
    <>
      <div className="fit__figures">
        <span className="fit__fact">
          <span className="fit__fact-label">{s.method[estimate.method]}</span>
          <span className="fit__fact-value">{`${formatKcal(estimate.kcal)} ${s.unit}`}</span>
        </span>
      </div>
      {/* The uncertainty is a FIELD, not prose buried somewhere: a user shown
          „2 750 kcal" with nothing beside it will trust a digit that was never
          there. */}
      <p className="fit__note">
        {estimate.assumptions.map((assumption) => s.assumption[assumption]).join(" · ")}
      </p>
    </>
  );
}

/**
 * The suggested intake for a goal — computed only once there is a rate to
 * compute it from, because this module publishes no default weekly rate. „Pola
 * kile nedeljno" is a recommendation, and a default would be a medical opinion
 * arriving through a parameter nobody passed.
 */
function Suggestion({
  estimate,
  goal,
  weeklyKg,
  onAdopt,
}: {
  estimate: EnergyEstimate;
  goal: WeightGoal;
  /** A magnitude the CALLER has already read — this component never parses, so it can never silently decline to render. */
  weeklyKg: number;
  onAdopt: (kcal: number) => void;
}): ReactNode {
  const s = strings.fitness.measure.suggest;
  const suggestion = suggestDailyEnergy(estimate, goal, weeklyKg);
  return (
    <div className="fit__figures">
      <span className="fit__fact">
        <span className="fit__fact-label">{s.resultLabel}</span>
        <span className="fit__fact-value">
          {`${formatKcal(suggestion.kcal)} ${strings.fitness.measure.energy.unit}`}
        </span>
      </span>
      <Button size="sm" onClick={() => onAdopt(suggestion.kcal)}>
        {s.adopt}
      </Button>
    </div>
  );
}

/** The chart's box, in the units its own coordinates are in. */
const CHART_WIDTH = 320;
const CHART_HEIGHT = 90;
const CHART_PAD = 6;

/**
 * The weight trend: the 7-day average as a line, the raw readings as dots behind
 * it. Both, always — the line is the honest read and the dots are what it was
 * read from, and hiding either would be the chart making a claim on its own.
 *
 * The x axis is CALENDAR days rather than reading index, so a fortnight nobody
 * weighed in shows as a gap instead of being compressed into the same spacing as
 * a fortnight of daily readings.
 */
function TrendChart({ points, label }: { points: readonly TrendPoint[]; label: string }): ReactNode {
  if (points.length < 2) return null;
  const days = points.map((point) => Date.parse(`${point.day}T00:00:00Z`));
  const minDay = Math.min(...days);
  const maxDay = Math.max(...days);
  const values = points.flatMap((point) =>
    point.average === null ? [point.value] : [point.value, point.average],
  );
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spanDays = maxDay - minDay || 1;
  const spanValue = maxValue - minValue || 1;

  const x = (ms: number) => CHART_PAD + ((ms - minDay) / spanDays) * (CHART_WIDTH - 2 * CHART_PAD);
  const y = (value: number) =>
    CHART_HEIGHT - CHART_PAD - ((value - minValue) / spanValue) * (CHART_HEIGHT - 2 * CHART_PAD);

  const line = points
    .map((point, index) =>
      point.average === null ? null : `${String(x(days[index] ?? minDay))},${String(y(point.average))}`,
    )
    .filter((entry): entry is string => entry !== null)
    .join(" ");

  return (
    <svg
      className="fit__chart"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`}
      width="100%"
      height={CHART_HEIGHT}
      /* The trend line SHOULD stretch to whatever width it is given — that is
         what „none" is for, and the chart's whole job is to fill its column at
         a fixed height. What must not stretch with it is anything round.
         `width="100%"` at a fixed pixel height scales the two axes by
         different factors, and under „none" that turned every reading dot into
         an ellipse, widened by exactly `containerWidth / 320`.
         The fix is not to give up the stretch — it is to draw the dots so the
         stretch cannot reach them. A dot is a ZERO-LENGTH subpath with a round
         cap, which is the same idiom the icon set uses, and
         `vector-effect: non-scaling-stroke` exempts stroke geometry from the
         user-space transform: the cap stays a true circle of exactly the
         stroke width at every container size. The line takes the same
         treatment, because a stroke on a diagonal under a non-uniform scale
         thickens and thins along its length. */
      preserveAspectRatio="none"
    >
      {points.map((point, index) => (
        <path
          key={point.day}
          className="fit__chart-dot"
          d={`M${String(x(days[index] ?? minDay))} ${String(y(point.value))}h0`}
        />
      ))}
      {line !== "" && <polyline className="fit__chart-line" points={line} fill="none" />}
    </svg>
  );
}

// --- Reading the forms -------------------------------------------------------

function draftOfProfile(profile: FitBodyProfile | null): ProfileDraft {
  return {
    sex: profile?.sex ?? "",
    birthDate: profile?.birthDate ?? "",
    heightCm: profile === null ? "" : gramsInputValue(profile.heightCm),
    activity: profile?.activity ?? "moderate",
  };
}

/** The wire's body profile as `@nexus/core`'s — the same four fields, and the arithmetic's own type. */
function toBodyProfile(profile: FitBodyProfile | null): BodyProfile | null {
  return profile === null
    ? null
    : {
        sex: profile.sex,
        birthDate: profile.birthDate,
        heightCm: profile.heightCm,
        activity: profile.activity,
      };
}

/** The wire's measurement as `@nexus/core`'s. */
function toBodyMeasurement(measurement: FitMeasurement | null): BodyMeasurement | null {
  return measurement === null
    ? null
    : {
        day: measurement.day,
        weightKg: measurement.weightKg,
        bodyFatPercent: measurement.bodyFatPercent,
        muscle: measurement.muscle,
        waterPercent: measurement.waterPercent,
        circumferences: measurement.circumferences,
      };
}

/**
 * The optional halves of a reading, or `null` when something typed is not a
 * number.
 *
 * An empty field is `null` — „not measured" — and never zero: a body-fat
 * percentage of zero is impossible, and a waist of zero would be a typo the
 * store would happily accept as a measurement.
 */
function readOptional(
  entry: EntryDraft,
): Omit<FitMeasurement, "day" | "weightKg" | "createdAt" | "updatedAt"> | null {
  const read = (text: string): number | null | "invalid" => {
    const raw = text.trim();
    if (raw === "") return null;
    const value = parseAmountInput(raw);
    return value === null || value < 0 ? "invalid" : value;
  };

  const bodyFatPercent = read(entry.bodyFatPercent);
  const waterPercent = read(entry.waterPercent);
  const muscleValue = read(entry.muscleValue);
  if (bodyFatPercent === "invalid" || waterPercent === "invalid" || muscleValue === "invalid") {
    return null;
  }

  const circumferences: Record<CircumferenceSite, number | null> = {
    neck: null,
    chest: null,
    upperArm: null,
    waist: null,
    hip: null,
    thigh: null,
  };
  for (const site of CIRCUMFERENCE_SITES) {
    const value = read(entry.circumferences[site]);
    if (value === "invalid") return null;
    circumferences[site] = value;
  }

  const muscle: MuscleReading | null =
    muscleValue === null ? null : { unit: entry.muscleUnit, value: muscleValue };
  return { bodyFatPercent, muscle, waterPercent, circumferences };
}
