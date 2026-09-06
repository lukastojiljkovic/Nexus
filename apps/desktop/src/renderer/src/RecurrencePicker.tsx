import { useState } from "react";
import { Button, Icon } from "@nexus/ui";
import { MAX_RECURRENCE_COUNT, MAX_RECURRENCE_INTERVAL, isValidDayKey, shiftDayKey } from "@nexus/core";
import type {
  RecurrenceEnd,
  RecurrenceFreq,
  RecurrenceOrdinal,
  RecurrenceRule,
  RecurrenceWeekday,
} from "../../shared/ipc.js";
import { lookup, strings } from "./strings.js";

/**
 * The "Ponavljanje" field (ADR-024), shared by the task form and the event
 * form. It edits a `RecurrenceRule | null` and nothing else — the caller owns
 * the record, decides what a change means (a task re-anchors, an event asks
 * the scope dialog) and validates nothing here, since the store revalidates
 * every rule it is handed.
 *
 * Three things a reader would otherwise have to reverse-engineer:
 *  - **Presets are anchor-relative.** "Svake nedelje" means "every week on the
 *    form's own day", so a rule reads back as a preset only when it matches
 *    what that preset would build at this anchor; everything else reads as
 *    Prilagođeno with its fields populated. That is the whole round trip.
 *  - **No anchor, no rule.** Both stores refuse a rule without a date to phase
 *    it from (a task's `dueDate`, an event's `startAt`), so the field disables
 *    itself and says why rather than letting the user hit that error blind.
 *  - **Custom mode is sticky per mounted record.** Callers mount this with a
 *    `key` tied to the record being edited; within one editing session the
 *    Prilagođeno panel stays open even if the rule momentarily equals a preset,
 *    and switching records re-derives the mode from the loaded rule.
 */

const WEEKDAYS: readonly RecurrenceWeekday[] = [0, 1, 2, 3, 4, 5, 6];
const ORDINALS: readonly RecurrenceOrdinal[] = [1, 2, 3, 4, -1];

/** Default horizon of a freshly picked "Do datuma": a year out, so the rule is never degenerate before the user has touched the date. */
const DEFAULT_UNTIL_DAYS = 365;
/** Default of a freshly picked "Posle N ponavljanja". */
const DEFAULT_COUNT = 10;

export type RecurrencePreset =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";

const PRESETS: readonly RecurrencePreset[] = [
  "none",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "yearly",
  "custom",
];

/** The frequency select inside Prilagođeno; both monthly rule kinds share the one "Mesečno" entry and branch on the mode select below it. */
type CustomFreq = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
const CUSTOM_FREQS: readonly CustomFreq[] = ["daily", "weekdays", "weekly", "monthly", "yearly"];

/** Which numeric field is mid-edit; see `numberDraft`. */
type NumberField = "interval" | "monthDay" | "count";

// --- Anchor-derived defaults ------------------------------------------------
//
// Bare day keys are parsed in UTC exactly like every other date in the calendar
// (see calendarItems.ts): a local-time `Date` would shift a whole series by a
// day west of Greenwich. Callers only reach these with a valid key.

function utcMsOf(dayKey: string): number {
  return Date.UTC(
    Number(dayKey.slice(0, 4)),
    Number(dayKey.slice(5, 7)) - 1,
    Number(dayKey.slice(8, 10)),
  );
}

/** Monday-first weekday index of a bare day key — `getUTCDay()` is Sunday-first, hence the +6. */
function weekdayOf(dayKey: string): RecurrenceWeekday {
  const index = (new Date(utcMsOf(dayKey)).getUTCDay() + 6) % 7;
  return WEEKDAYS[index] ?? 0;
}

function monthDayOf(dayKey: string): number {
  return Number(dayKey.slice(8, 10));
}

/** Which occurrence of its own weekday the anchor is; a 5th one has no rule value, so it becomes "poslednji". */
function ordinalOf(dayKey: string): RecurrenceOrdinal {
  const nth = Math.ceil(monthDayOf(dayKey) / 7);
  return nth >= 5 ? -1 : (ORDINALS[nth - 1] ?? 1);
}

// --- Presets ----------------------------------------------------------------

/** The rule a preset stands for at `anchor`; every preset is `interval: 1` and never ends. */
function presetRule(preset: RecurrencePreset, anchor: string): RecurrenceRule | null {
  const end: RecurrenceEnd = { kind: "never" };
  switch (preset) {
    case "none":
      return null;
    case "weekdays":
      return { freq: { kind: "weekdays" }, end };
    case "weekly":
      return { freq: { kind: "weekly", interval: 1, days: [weekdayOf(anchor)] }, end };
    case "monthly":
      return { freq: { kind: "monthly-date", interval: 1, day: monthDayOf(anchor) }, end };
    case "yearly":
      return { freq: { kind: "yearly", interval: 1 }, end };
    // Prilagođeno opens on the plainest possible rule; an existing one is kept
    // by the caller below rather than replaced by this.
    case "daily":
    case "custom":
      return { freq: { kind: "daily", interval: 1 }, end };
  }
}

/** Which select entry a rule reads back as — a preset only when it is exactly that preset at this anchor. */
export function presetOf(rule: RecurrenceRule | null, anchor: string): RecurrencePreset {
  if (rule === null) return "none";
  if (rule.end.kind !== "never") return "custom";
  const freq = rule.freq;
  switch (freq.kind) {
    case "weekdays":
      return "weekdays";
    case "daily":
      return freq.interval === 1 ? "daily" : "custom";
    case "yearly":
      return freq.interval === 1 ? "yearly" : "custom";
    case "weekly":
      return freq.interval === 1 && freq.days.length === 1 && freq.days[0] === weekdayOf(anchor)
        ? "weekly"
        : "custom";
    case "monthly-date":
      return freq.interval === 1 && freq.day === monthDayOf(anchor) ? "monthly" : "custom";
    case "monthly-ordinal":
      return "custom";
  }
}

function customFreqOf(freq: RecurrenceFreq): CustomFreq {
  return freq.kind === "monthly-date" || freq.kind === "monthly-ordinal" ? "monthly" : freq.kind;
}

/** Every kind but `weekdays` carries an interval; it is preserved across a kind change so switching back and forth is lossless. */
function intervalOf(freq: RecurrenceFreq): number {
  return freq.kind === "weekdays" ? 1 : freq.interval;
}

/** Rebuilds a frequency for a newly chosen kind, carrying over whatever the previous one can still say. */
function rebuildFreq(kind: CustomFreq, previous: RecurrenceFreq, anchor: string): RecurrenceFreq {
  const interval = intervalOf(previous);
  switch (kind) {
    case "daily":
      return { kind: "daily", interval };
    case "weekdays":
      return { kind: "weekdays" };
    case "weekly":
      return {
        kind: "weekly",
        interval,
        days: previous.kind === "weekly" ? previous.days : [weekdayOf(anchor)],
      };
    case "monthly":
      return previous.kind === "monthly-ordinal"
        ? previous
        : { kind: "monthly-date", interval, day: monthDayOf(anchor) };
    case "yearly":
      return { kind: "yearly", interval };
  }
}

function withInterval(freq: RecurrenceFreq, interval: number): RecurrenceFreq {
  switch (freq.kind) {
    case "weekdays":
      return freq;
    case "daily":
      return { kind: "daily", interval };
    case "weekly":
      return { kind: "weekly", interval, days: freq.days };
    case "monthly-date":
      return { kind: "monthly-date", interval, day: freq.day };
    case "monthly-ordinal":
      return { kind: "monthly-ordinal", interval, ordinal: freq.ordinal, weekday: freq.weekday };
    case "yearly":
      return { kind: "yearly", interval };
  }
}

/** Membership against the closed lists, narrowing a `<select>`'s raw string without an assertion. */
function asPreset(value: string): RecurrencePreset {
  for (const preset of PRESETS) if (preset === value) return preset;
  return "none";
}
function asCustomFreq(value: string): CustomFreq {
  for (const freq of CUSTOM_FREQS) if (freq === value) return freq;
  return "daily";
}
function asWeekday(value: string): RecurrenceWeekday {
  for (const day of WEEKDAYS) if (String(day) === value) return day;
  return 0;
}
function asOrdinal(value: string): RecurrenceOrdinal {
  for (const ordinal of ORDINALS) if (String(ordinal) === value) return ordinal;
  return 1;
}

// --- The marker -------------------------------------------------------------

/**
 * The "this repeats" marker: the app's own drawn `repeat` icon in the muted
 * token colour, never a glow (design rules). Carries its own accessible name,
 * so a row that repeats says so out loud too.
 */
export function RecurrenceMark() {
  return (
    <span className="recur__mark" role="img" aria-label={strings.recurrence.marker}>
      <Icon name="repeat" size={14} />
    </span>
  );
}

// --- The field --------------------------------------------------------------

export interface RecurrencePickerProps {
  /** The rule being edited, or null for "Ne ponavlja se". */
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  /** The form's own date ("YYYY-MM-DD"), or "" while it has none — every preset phases from it. */
  anchor: string;
}

export function RecurrencePicker({ value, onChange, anchor }: RecurrencePickerProps) {
  const s = strings.recurrence;
  const usable = isValidDayKey(anchor);
  const derived = presetOf(value, anchor);
  const [customOpen, setCustomOpen] = useState(derived === "custom");
  // A controlled number input whose value came straight from the rule could
  // never be cleared to retype — the rule would re-render the old digits back
  // in. So the field being typed into keeps its raw text until it is left.
  const [numberDraft, setNumberDraft] = useState<{ field: NumberField; text: string } | null>(null);

  const preset: RecurrencePreset =
    value === null ? "none" : customOpen || derived === "custom" ? "custom" : derived;

  function selectPreset(next: RecurrencePreset): void {
    setNumberDraft(null);
    setCustomOpen(next === "custom");
    // Opening Prilagođeno over an existing rule keeps that rule and merely
    // reveals its fields; opening it over "Ne ponavlja se" needs a rule to show.
    if (next === "custom" && value !== null) return;
    onChange(presetRule(next, anchor));
  }

  function setFreq(freq: RecurrenceFreq): void {
    onChange({ freq, end: value?.end ?? { kind: "never" } });
  }

  function setEnd(end: RecurrenceEnd): void {
    onChange({ freq: value?.freq ?? { kind: "daily", interval: 1 }, end });
  }

  function numberText(field: NumberField, actual: number): string {
    return numberDraft?.field === field ? numberDraft.text : String(actual);
  }

  /** Records the raw text, and commits only a value the rule language accepts. */
  function editNumber(
    field: NumberField,
    text: string,
    max: number,
    apply: (parsed: number) => void,
  ): void {
    setNumberDraft({ field, text });
    const parsed = Number(text);
    if (text.trim().length > 0 && Number.isInteger(parsed) && parsed >= 1 && parsed <= max) {
      apply(parsed);
    }
  }

  function toggleWeeklyDay(freq: RecurrenceFreq, day: RecurrenceWeekday): void {
    if (freq.kind !== "weekly") return;
    const selected = freq.days.includes(day);
    // A weekly rule with no day at all has no meaning, so the last one stays on.
    if (selected && freq.days.length === 1) return;
    const days = selected
      ? freq.days.filter((current) => current !== day)
      : [...freq.days, day].sort((a, b) => a - b);
    setFreq({ kind: "weekly", interval: freq.interval, days });
  }

  const freq = value?.freq ?? null;
  const end = value?.end ?? null;

  return (
    <div className="recur">
      <label className="recur__field">
        <span className="recur__label">{s.fieldLabel}</span>
        <select
          className="recur__select"
          value={preset}
          disabled={!usable}
          onChange={(event) => selectPreset(asPreset(event.target.value))}
        >
          {PRESETS.map((option) => (
            <option key={option} value={option}>
              {s.preset[option]}
            </option>
          ))}
        </select>
      </label>

      {!usable && <p className="nx-hint">{s.needsDate}</p>}

      {usable && preset === "custom" && freq !== null && end !== null && (
        <div className="recur__custom">
          <label className="recur__field">
            <span className="recur__label">{s.freqLabel}</span>
            <select
              className="recur__select"
              value={customFreqOf(freq)}
              onChange={(event) => {
                setNumberDraft(null);
                setFreq(rebuildFreq(asCustomFreq(event.target.value), freq, anchor));
              }}
            >
              {CUSTOM_FREQS.map((option) => (
                <option key={option} value={option}>
                  {s.freq[option]}
                </option>
              ))}
            </select>
          </label>

          {freq.kind !== "weekdays" && (
            <label className="recur__field">
              <span className="recur__label">{s.intervalLabel}</span>
              <input
                type="number"
                inputMode="numeric"
                className="nx-textfield__input recur__number"
                min={1}
                max={MAX_RECURRENCE_INTERVAL}
                value={numberText("interval", freq.interval)}
                onChange={(event) =>
                  editNumber("interval", event.target.value, MAX_RECURRENCE_INTERVAL, (parsed) =>
                    setFreq(withInterval(freq, parsed)),
                  )
                }
                onBlur={() => setNumberDraft(null)}
              />
            </label>
          )}

          {freq.kind === "weekly" && (
            <div className="recur__field">
              <span className="recur__label">{s.daysLabel}</span>
              <div className="recur__days" role="group" aria-label={s.daysLabel}>
                {WEEKDAYS.map((day) => {
                  const selected = freq.days.includes(day);
                  return (
                    <Button
                      key={day}
                      size="sm"
className="nx-segmented__option recur__day"
                      aria-pressed={selected}
                      onClick={() => toggleWeeklyDay(freq, day)}
                    >
                      {s.weekdayShort[day]}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {(freq.kind === "monthly-date" || freq.kind === "monthly-ordinal") && (
            <label className="recur__field">
              <span className="recur__label">{s.monthlyModeLabel}</span>
              <select
                className="recur__select"
                value={freq.kind === "monthly-ordinal" ? "ordinal" : "date"}
                onChange={(event) => {
                  setNumberDraft(null);
                  setFreq(
                    event.target.value === "ordinal"
                      ? {
                          kind: "monthly-ordinal",
                          interval: freq.interval,
                          ordinal: ordinalOf(anchor),
                          weekday: weekdayOf(anchor),
                        }
                      : { kind: "monthly-date", interval: freq.interval, day: monthDayOf(anchor) },
                  );
                }}
              >
                <option value="date">{s.monthlyModeDate}</option>
                <option value="ordinal">{s.monthlyModeOrdinal}</option>
              </select>
            </label>
          )}

          {freq.kind === "monthly-date" && (
            <label className="recur__field">
              <span className="recur__label">{s.monthDayLabel}</span>
              <input
                type="number"
                inputMode="numeric"
                className="nx-textfield__input recur__number"
                min={1}
                max={31}
                value={numberText("monthDay", freq.day)}
                onChange={(event) =>
                  editNumber("monthDay", event.target.value, 31, (parsed) =>
                    setFreq({ kind: "monthly-date", interval: freq.interval, day: parsed }),
                  )
                }
                onBlur={() => setNumberDraft(null)}
              />
            </label>
          )}

          {freq.kind === "monthly-ordinal" && (
            <>
              <label className="recur__field">
                <span className="recur__label">{s.ordinalLabel}</span>
                <select
                  className="recur__select"
                  value={String(freq.ordinal)}
                  onChange={(event) =>
                    setFreq({ ...freq, ordinal: asOrdinal(event.target.value) })
                  }
                >
                  {ORDINALS.map((ordinal) => (
                    <option key={ordinal} value={String(ordinal)}>
                      {lookup(s.ordinal, String(ordinal)) ?? String(ordinal)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="recur__field">
                <span className="recur__label">{s.weekdayLabel}</span>
                <select
                  className="recur__select"
                  value={String(freq.weekday)}
                  onChange={(event) =>
                    setFreq({ ...freq, weekday: asWeekday(event.target.value) })
                  }
                >
                  {WEEKDAYS.map((day) => (
                    <option key={day} value={String(day)}>
                      {s.weekday[day]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <label className="recur__field">
            <span className="recur__label">{s.endLabel}</span>
            <select
              className="recur__select"
              value={end.kind}
              onChange={(event) => {
                setNumberDraft(null);
                const next = event.target.value;
                if (next === "until") {
                  setEnd({ kind: "until", date: shiftDayKey(anchor, DEFAULT_UNTIL_DAYS) });
                } else if (next === "count") {
                  setEnd({ kind: "count", total: DEFAULT_COUNT });
                } else {
                  setEnd({ kind: "never" });
                }
              }}
            >
              <option value="never">{s.endNever}</option>
              <option value="until">{s.endUntil}</option>
              <option value="count">{s.endCount}</option>
            </select>
          </label>

          {end.kind === "until" && (
            <label className="recur__field">
              <span className="recur__label">{s.endUntilLabel}</span>
              <input
                type="date"
                className="nx-textfield__input"
                value={end.date}
                onChange={(event) => {
                  // A cleared date input reports "": keep the rule as it stands
                  // rather than writing an end the engine would throw on.
                  const next = event.target.value;
                  if (isValidDayKey(next)) setEnd({ kind: "until", date: next });
                }}
              />
            </label>
          )}

          {end.kind === "count" && (
            <label className="recur__field">
              <span className="recur__label">{s.endCountLabel}</span>
              <span className="recur__counted">
                <input
                  type="number"
                  inputMode="numeric"
                  className="nx-textfield__input recur__number"
                  min={1}
                  max={MAX_RECURRENCE_COUNT}
                  value={numberText("count", end.total)}
                  onChange={(event) =>
                    editNumber("count", event.target.value, MAX_RECURRENCE_COUNT, (parsed) =>
                      setEnd({ kind: "count", total: parsed }),
                    )
                  }
                  onBlur={() => setNumberDraft(null)}
                />
                <span className="recur__unit">{s.endCountUnit}</span>
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
