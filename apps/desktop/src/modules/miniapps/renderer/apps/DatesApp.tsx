import { useState } from "react";
import { Button, Card, TextField } from "@nexus/ui";
import {
  addToDate,
  dateDifference,
  orthodoxEaster,
  serbianHolidays,
  serbianNonWorkingDays,
  workdaysBetween,
} from "@nexus/core";
import { copy } from "../copy.js";
import {
  dateOfDayKey,
  formatCount,
  formatDay,
  todayKey,
  weekdayName,
} from "../format.js";
/**
 * The date calculator (mini-apps): the distance between two dates, adding and
 * subtracting units, and working days in Serbia.
 *
 * **Every number is the engine's.** `@nexus/core`'s `dateCalc.ts` owns the
 * arithmetic - the calendar difference that walks back through `addToDate`, the
 * month clamping, the Orthodox Easter computus and the holiday rule from the
 * law - and this page only formats what it answers. That is why the page cannot
 * be a place where a date quietly shifts by a day: it never computes one.
 *
 * **The holiday list is the law's own reading.** Non-working days come from
 * `serbianNonWorkingDays`, which already carries the substitute day a state
 * holiday earns when it falls on a Sunday; each date is labelled with the
 * holiday it belongs to, or named as a substitute, so a reader can tell why the
 * day is on the list. Easter is shown beside them because it is the one date
 * that moves.
 *
 * **The fields are `YYYY-MM-DD` text, not date pickers.** The engine works in
 * bare day keys - which is exactly what avoids a timezone shifting the answer -
 * and a picker's own value format is a second convention to translate. The hint
 * under the form states the shape, and a key the calendar does not have is
 * refused with a sentence rather than rolled over.
 */

/** A field's text as a date key the calendar has, or `null` - which is also what a blank field is. */
function readDay(text: string): string | null {
  const trimmed = text.trim();
  return dateOfDayKey(trimmed) === null ? null : trimmed;
}

/** A field's text as a whole number of units, zero when blank. */
function readUnits(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  if (!/^-?\d{1,5}$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function DatesApp() {
  const today = todayKey();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [base, setBase] = useState(today);
  const [years, setYears] = useState("");
  const [months, setMonths] = useState("");
  const [weeks, setWeeks] = useState("");
  const [days, setDays] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const fromDay = readDay(from);
  const toDay = readDay(to);
  const baseDay = readDay(base);

  /**
   * The difference between the two fields, computed only when both are real
   * dates - and never at the cost of the render: a pair of dates at the extremes
   * of the calendar makes the engine refuse the walk that finds the calendar
   * difference, and a calculator that threw there would blank the page.
   */
  const pair = (() => {
    if (fromDay === null || toDay === null) return null;
    try {
      return {
        difference: dateDifference(fromDay, toDay),
        workdays: workdaysBetween(fromDay, toDay),
      };
    } catch (error) {
      console.error("Nexus: the date calculator could not measure that pair:", error);
      return null;
    }
  })();
  const difference = pair?.difference ?? null;
  const workdays = pair?.workdays ?? null;

  const year = baseDay !== null ? (dateOfDayKey(baseDay)?.getFullYear() ?? 0) : 0;
  const nonWorking = year > 0 ? serbianNonWorkingDays(year) : [];
  const holidays = year > 0 ? serbianHolidays(year) : [];
  const easter = year > 0 ? orthodoxEaster(year) : null;

  function shift(sign: 1 | -1): void {
    if (baseDay === null) {
      setProblem(copy.dates.invalid);
      return;
    }
    const values = {
      years: readUnits(years),
      months: readUnits(months),
      weeks: readUnits(weeks),
      days: readUnits(days),
    };
    if (
      values.years === null ||
      values.months === null ||
      values.weeks === null ||
      values.days === null
    ) {
      setProblem(copy.dates.invalid);
      return;
    }
    try {
      setResult(
        addToDate(baseDay, {
          years: sign * values.years,
          months: sign * values.months,
          weeks: sign * values.weeks,
          days: sign * values.days,
        }),
      );
      setProblem(null);
    } catch (error) {
      console.error("Nexus: the date calculator refused that shift:", error);
      setProblem(copy.dates.invalid);
      setResult(null);
    }
  }

  /** The holiday a non-working day belongs to, or `null` for the substitute day. */
  function holidayOf(date: string): string | null {
    for (const holiday of holidays) {
      if (holiday.dates.includes(date)) return copy.holidays[holiday.id];
    }
    return null;
  }

  return (
    <div className="miniapps__app">
      <Card className="miniapps__card" title={copy.dates.difference}>
        <div className="miniapps__row">
          <TextField
            label={copy.dates.from}
            className="miniapps__date-field"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <TextField
            label={copy.dates.to}
            className="miniapps__date-field"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setFrom(todayKey());
              setTo(todayKey());
            }}
          >
            {copy.actions.today}
          </Button>
        </div>
        <p className="nx-hint">{copy.dates.format}</p>
        {(fromDay === null || toDay === null) && <p className="miniapps__field-error">{copy.dates.invalid}</p>}
        {difference !== null && workdays !== null && (
          <div className="miniapps__readouts">
            <span className="miniapps__readout">
              {`${copy.dates.days}: ${formatCount(difference.totalDays)}`}
            </span>
            <span className="miniapps__readout">
              {`${copy.dates.calendar}: ${formatCount(difference.years)} / ${formatCount(difference.months)} / ${formatCount(difference.days)}`}
            </span>
            <span className="miniapps__readout">
              {`${copy.dates.workdays}: ${formatCount(workdays)}`}
            </span>
          </div>
        )}
        <p className="nx-hint">{copy.dates.workdaysHint}</p>
      </Card>

      <Card className="miniapps__card" title={copy.dates.adjust}>
        <div className="miniapps__row">
          <TextField
            label={copy.dates.base}
            className="miniapps__date-field"
            value={base}
            onChange={(event) => setBase(event.target.value)}
          />
          <TextField
            label={copy.dates.years}
            className="miniapps__number-field"
            inputMode="numeric"
            value={years}
            onChange={(event) => setYears(event.target.value)}
          />
          <TextField
            label={copy.dates.months}
            className="miniapps__number-field"
            inputMode="numeric"
            value={months}
            onChange={(event) => setMonths(event.target.value)}
          />
          <TextField
            label={copy.dates.weeks}
            className="miniapps__number-field"
            inputMode="numeric"
            value={weeks}
            onChange={(event) => setWeeks(event.target.value)}
          />
          <TextField
            label={copy.dates.days}
            className="miniapps__number-field"
            inputMode="numeric"
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
        </div>
        <div className="miniapps__row">
          <Button size="sm" variant="primary" onClick={() => shift(1)}>
            {copy.dates.add}
          </Button>
          <Button size="sm" onClick={() => shift(-1)}>
            {copy.dates.subtract}
          </Button>
          {result !== null && (
            <span className="miniapps__readout">
              {`${copy.dates.result}: ${formatDay(result)} (${weekdayName(result)})`}
            </span>
          )}
        </div>
        {problem !== null && <p className="miniapps__field-error">{problem}</p>}
      </Card>

      <Card className="miniapps__card" title={copy.dates.holidays}>
        <p className="nx-hint">{copy.dates.holidaysHint}</p>
        {easter !== null && (
          <p className="miniapps__readout">{`${copy.dates.easter}: ${formatDay(easter)}`}</p>
        )}
        <div className="miniapps__list">
          {nonWorking.map((date) => (
            <div key={date} className="miniapps__holiday">
              <span className="miniapps__holiday-date">{formatDay(date)}</span>
              <span className="miniapps__step-note">
                {holidayOf(date) ?? copy.dates.substitute}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
