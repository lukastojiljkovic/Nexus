import { useEffect, useState } from "react";
import { Button, Card, Chip, Select, TextField } from "@nexus/ui";
import { meetingWindows, readZone, type ZoneReading } from "@nexus/core";
import { copy } from "../copy.js";
import { MINIAPPS_CITIES, cityOfZone } from "../cities.js";
import {
  formatCount,
  formatDay,
  formatUtcHourMinute,
  parseMinuteOfDay,
  todayKey,
} from "../format.js";
import type { MiniAppProps } from "./contract.js";

/**
 * The world clock and its meeting finder (mini-apps).
 *
 * **The zones come from the runtime, never from a table of offsets.** Every
 * reading is `@nexus/core`'s `readZone`, which asks `Intl` for the offset in
 * force at that instant - so a country that changes its mind about summer time
 * changes this page with it, and a shipped table would not. The city list is a
 * curated set of ids (a picker that offered the whole tz database would be a
 * spelling test); the fact behind each one is the runtime's own.
 *
 * **The clock ticks, the store does not.** A second-by-second repaint is this
 * page's own business and nothing is written for it; the only thing kept is
 * which cities were picked, which is written when the list changes. That is the
 * whole distinction the module draws between a tool's session and the user's
 * data.
 *
 * **The meeting finder answers with an interval, and "none" is an answer.** Each
 * city's working hours are a local window on the chosen date, the windows are
 * intersected in absolute time by the engine, and a team that spans Belgrade and
 * Sydney that day gets "no overlap" rather than a stretched day. The overlap is
 * shown in every picked city's own clock, because that is the form a person can
 * act on.
 */

/** How many cities the world clock keeps. The store's own bound (`MINIAPPS_MAX_CITIES`), mirrored because the renderer may not reach `@nexus/db`. */
const CITY_LIMIT = 12;

/** The zone this machine is in, or UTC when the runtime names none (a container, a locked-down OS). */
function homeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** One zone's reading, or `null` when the runtime does not know the zone. */
function readingOf(zone: string, atMs: number, home: string): ZoneReading | null {
  try {
    return readZone(zone, atMs, home);
  } catch (error) {
    console.error(`Nexus: the world clock could not read the zone "${zone}":`, error);
    return null;
  }
}

export function WorldClockApp({ profileId, view, run }: MiniAppProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [choice, setChoice] = useState(() => MINIAPPS_CITIES[0]?.id ?? "");
  const [day, setDay] = useState(todayKey);
  const [startText, setStartText] = useState("09:00");
  const [endText, setEndText] = useState("17:00");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, []);

  const home = homeZone();
  const readings = view.cities.map((zone) => ({ zone, reading: readingOf(zone, nowMs, home) }));
  const homeReading = readingOf(home, nowMs, home);

  function addCity(): void {
    const city = MINIAPPS_CITIES.find((held) => held.id === choice);
    if (city === undefined) return;
    if (view.cities.includes(city.zone)) return;
    if (view.cities.length >= CITY_LIMIT) {
      setProblem(copy.worldclock.limitError);
      return;
    }
    setProblem(null);
    void run((api) =>
      api.saveCities({ profileId, cities: [...view.cities, city.zone] }),
    );
  }

  function removeCity(zone: string): void {
    setProblem(null);
    void run((api) => api.saveCities({ profileId, cities: view.cities.filter((held) => held !== zone) }));
  }

  /** The overlap of the working hours on the chosen day, or none - and the hours themselves when a field is not a clock reading. */
  const startMinute = parseMinuteOfDay(startText);
  const endMinute = parseMinuteOfDay(endText);
  const meeting = (() => {
    if (view.cities.length === 0) return null;
    if (startMinute === null || endMinute === null || endMinute <= startMinute) {
      return { problem: copy.dates.invalid, windows: [] };
    }
    try {
      return {
        problem: null,
        windows: meetingWindows({
          day,
          zones: view.cities.map((zone) => ({ zone, startMinute, endMinute })),
        }),
      };
    } catch (error) {
      console.error("Nexus: the meeting finder could not read that day:", error);
      return { problem: copy.dates.invalid, windows: [] };
    }
  })();

  const overlap = meeting?.windows[0] ?? null;

  return (
    <div className="miniapps__app">
      <Card className="miniapps__card" title={copy.worldclock.cities}>
        <div className="miniapps__row">
          <Select
            label={copy.worldclock.city}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            {MINIAPPS_CITIES.map((city) => (
              <option key={city.id} value={city.id}>
                {`${copy.cities[city.id as keyof typeof copy.cities]} (${city.zone})`}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="primary"
            disabled={view.cities.length >= CITY_LIMIT}
            onClick={addCity}
          >
            {copy.worldclock.add}
          </Button>
          <span className="miniapps__readout">
            {`${copy.worldclock.home}: ${home}${
              homeReading === null ? "" : ` ${homeReading.localIso.slice(11, 16)}`
            }`}
          </span>
        </div>
        {problem !== null && <p className="miniapps__field-error">{problem}</p>}
        {view.cities.length === 0 ? (
          <p className="nx-hint">{`${copy.worldclock.empty} ${copy.worldclock.emptyBody}`}</p>
        ) : (
          <div className="miniapps__list">
            {readings.map(({ zone, reading }) => (
              <div key={zone} className="miniapps__clock-row">
                <span className="miniapps__row-name">
                  {cityOfZone(zone) === null
                    ? zone
                    : copy.cities[cityOfZone(zone) as keyof typeof copy.cities]}
                </span>
                {reading === null ? (
                  <span className="miniapps__field-error">{copy.worldclock.unknownZone}</span>
                ) : (
                  <>
                    <span className="miniapps__clock-time">
                      {reading.localIso.slice(11, 16)}
                    </span>
                    <span className="miniapps__step-note">
                      {`${copy.worldclock.offset}: ${reading.utcOffsetText}`}
                    </span>
                    {reading.dst && <Chip variant="data">{copy.worldclock.dst}</Chip>}
                    {reading.dayDifference > 0 && <Chip>{copy.worldclock.dayAhead}</Chip>}
                    {reading.dayDifference < 0 && <Chip>{copy.worldclock.dayBehind}</Chip>}
                  </>
                )}
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`${copy.actions.remove}: ${zone}`}
                  onClick={() => removeCity(zone)}
                >
                  {copy.actions.remove}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="miniapps__card" title={copy.worldclock.meeting}>
        <p className="nx-hint">{copy.worldclock.meetingHint}</p>
        <div className="miniapps__row">
          <TextField
            label={copy.worldclock.date}
            className="miniapps__date-field"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
          <TextField
            label={copy.worldclock.start}
            className="miniapps__number-field"
            value={startText}
            onChange={(event) => setStartText(event.target.value)}
          />
          <TextField
            label={copy.worldclock.end}
            className="miniapps__number-field"
            value={endText}
            onChange={(event) => setEndText(event.target.value)}
          />
          <Button size="sm" variant="quiet" onClick={() => setDay(todayKey())}>
            {copy.actions.today}
          </Button>
        </div>
        {meeting !== null && meeting.problem !== null && (
          <p className="miniapps__field-error">{meeting.problem}</p>
        )}
        {view.cities.length > 0 && meeting !== null && meeting.problem === null && overlap === null && (
          <p className="miniapps__readout">{copy.worldclock.noWindow}</p>
        )}
        {overlap !== null && startMinute !== null && endMinute !== null && (
          <>
            <p className="miniapps__readout">
              {`${copy.worldclock.window}: ${formatUtcHourMinute(overlap.startMs)} - ${formatUtcHourMinute(overlap.endMs)} ${copy.worldclock.utc}`}
            </p>
            <p className="miniapps__row-label">{copy.worldclock.local}</p>
            <div className="miniapps__list">
              {view.cities.map((zone) => {
                const startLocal = readingOf(zone, overlap.startMs, home);
                const endLocal = readingOf(zone, overlap.endMs, home);
                if (startLocal === null || endLocal === null) return null;
                return (
                  <div key={zone} className="miniapps__clock-row">
                    <span className="miniapps__row-name">
                      {cityOfZone(zone) === null
                        ? zone
                        : copy.cities[cityOfZone(zone) as keyof typeof copy.cities]}
                    </span>
                    <span className="miniapps__clock-time">
                      {`${startLocal.localIso.slice(11, 16)} - ${endLocal.localIso.slice(11, 16)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <p className="nx-hint">{formatDay(day)}</p>
        <p className="nx-hint">{`${copy.worldclock.cities}: ${formatCount(view.cities.length)} / ${formatCount(CITY_LIMIT)}`}</p>
      </Card>
    </div>
  );
}
