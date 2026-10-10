import { useEffect, useMemo, useRef, useState } from "react";
import { computerZone, type LatLon, type SkyDayState } from "@nexus/core";
import { Card, Chip } from "@nexus/ui";
import { dateTimeFormat, numberFormat } from "../../../../renderer/src/intl.js";
import { fill } from "../../../../renderer/src/strings.js";
import { copy } from "./copy.js";
import {
  compassNorth,
  dayLength,
  latitudeText,
  longitudeText,
  moonDisk,
  phaseSequence,
  sunMoonReadings,
  twilightRows,
  type EdgeReading,
  type SunMoonReadings,
} from "./panel.js";
import "./sunmoon.css";

/**
 * The Sun and the Moon for one place and one day: the four Sun rows, the three
 * twilight bands, the Moon's disk and its own four events, the next four phases,
 * and the compass.
 *
 * **Where the numbers come from.** All of them are the engine's
 * (`sunMoonReadings` in `panel.ts` is the only call this component makes), and
 * every one of them is printed through `Intl`. Nothing here invents a time, and
 * nothing here prints one for a body that did not cross: the engine answers
 * `null` for an event its UTC day does not contain, and a `null` becomes a
 * sentence rather than a made-up clock reading. Polar day and polar night are
 * the case that matters most, and they are words before they are numbers.
 *
 * **The zone is the computer's, always.** The place decides where the sky is;
 * the clock the reader reads is the machine's own zone, which is the one their
 * other clocks keep. A time that falls on the reader's next or previous local
 * date carries that date beside it, so a sunset at 00:12 reads as 00:12 on the
 * 11th rather than as a wrong time (`panel.ts` explains why the day itself is
 * the engine's UTC day).
 */

export interface SunMoonPanelProps {
  /** The reader's place, or `null` when neither the zone nor the picker has named one. */
  readonly observer: LatLon | null;
  /** Any instant inside the day asked about. The engine answers for the UTC day containing it. */
  readonly day: Date;
}

/** The four ways a reader can report where the Sun is: the sighting `northFromSun` takes. */
const SUN_OFFSETS = [
  { key: "ahead", degrees: 0 },
  { key: "right", degrees: 90 },
  { key: "behind", degrees: 180 },
  { key: "left", degrees: 270 },
] as const;

type SunOffsetKey = (typeof SUN_OFFSETS)[number]["key"];

export function SunMoonPanel({ observer, day }: SunMoonPanelProps) {
  const [sunOffset, setSunOffset] = useState<SunOffsetKey>("ahead");
  const diskRef = useRef<HTMLCanvasElement | null>(null);

  const latDeg = observer?.latDeg ?? null;
  const lonDeg = observer?.lonDeg ?? null;
  const readings = useMemo(
    () =>
      latDeg === null || lonDeg === null
        ? null
        : sunMoonReadings({ latitude: latDeg, longitude: lonDeg }, day),
    [latDeg, lonDeg, day],
  );

  const phase = readings === null ? null : moonDisk(readings.phase);
  useEffect(() => {
    const canvas = diskRef.current;
    if (canvas === null || phase === null) return;
    drawMoonDisk(canvas, phase.terminator, phase.litOnRight);
  }, [phase?.terminator, phase?.litOnRight]);

  const numbers = numberFormat({ maximumFractionDigits: 2 });
  const percent = numberFormat({ style: "percent", maximumFractionDigits: 0 });
  const plain = numberFormat();
  const clock = dateTimeFormat({ hour: "2-digit", minute: "2-digit" });
  const longDate = dateTimeFormat({ dateStyle: "medium" });
  const keyFormat = dateTimeFormat({ year: "numeric", month: "2-digit", day: "2-digit" });
  const dayKey = keyFormat.format(day);
  const zone = computerZone();

  /** A time, with the local date beside it whenever the event is not on the day asked about. */
  const timeText = (at: Date): string => {
    const text = clock.format(at);
    return keyFormat.format(at) === dayKey ? text : `${text} (${longDate.format(at)})`;
  };

  /** The Sun's own event: a time, or polar day, or polar night. */
  const sunText = (at: Date | null, state: SkyDayState): string => {
    if (at !== null) return timeText(at);
    if (state === "always-above") return copy.panel.polarDay;
    if (state === "always-below") return copy.panel.polarNight;
    return copy.panel.noEvent;
  };

  /** The Moon's own event: a time, or the day it spent on one side of the horizon. */
  const moonText = (at: Date | null, state: SkyDayState): string => {
    if (at !== null) return timeText(at);
    if (state === "always-above") return copy.panel.moonAlwaysAbove;
    if (state === "always-below") return copy.panel.moonAlwaysBelow;
    return copy.panel.noEvent;
  };

  /** One end of a twilight window: a time, or the day state that says why there is none. */
  const edgeText = (edge: EdgeReading, limit: number): string => {
    if (edge.at !== null) return timeText(edge.at);
    const words = edge.state === "always-above" ? copy.panel.twilightNeverBelow : copy.panel.twilightNeverAbove;
    return fill(words, { limit: plain.format(Math.abs(limit)) });
  };

  if (readings === null || observer === null) {
    return (
      <Card className="ast-sunmoon__card" title={copy.panel.placeTitle}>
        <p className="nx-hint">{copy.panel.placeNone}</p>
      </Card>
    );
  }

  const coordinates = `${latitudeText(observer.latDeg, copy.panel.coordinates, (value) =>
    numbers.format(value),
  )}, ${longitudeText(observer.lonDeg, copy.panel.coordinates, (value) => numbers.format(value))}`;

  return (
    <div className="ast-sunmoon">
      <div className="ast-sunmoon__place">
        <span className="ast-sunmoon__coordinates">{coordinates}</span>
        {zone !== null && <Chip>{zone}</Chip>}
      </div>
      <p className="nx-hint">
        {zone === null ? copy.panel.zoneNoteUnknown : fill(copy.panel.zoneNote, { zone })}
      </p>

      <Card className="ast-sunmoon__card" title={copy.panel.sunTitle}>
        <Row
          label={copy.panel.sunrise}
          value={sunText(readings.sun.rise, readings.sun.state)}
        />
        <Row
          label={copy.panel.solarNoon}
          value={readings.sun.transit === null ? copy.panel.noEvent : timeText(readings.sun.transit)}
        />
        <Row label={copy.panel.sunset} value={sunText(readings.sun.set, readings.sun.state)} />
        <DayLengthRow readings={readings} />
      </Card>

      <Card className="ast-sunmoon__card" title={copy.panel.twilightTitle}>
        {twilightRows(readings.twilight).map((row) => (
          <Row
            key={row.band}
            label={`${copy.panel.bands[row.band]} (${plain.format(row.limit)}°)`}
            value={`${edgeText(row.dawn, row.limit)} – ${edgeText(row.dusk, row.limit)}`}
          />
        ))}
      </Card>

      <Card className="ast-sunmoon__card" title={copy.panel.moonTitle}>
        <div className="ast-sunmoon__moon">
          <canvas ref={diskRef} className="ast-sunmoon__disk" width={48} height={48} aria-hidden="true" />
          <div className="ast-sunmoon__moon-text">
            <span className="ast-sunmoon__phase">{copy.panel.phaseNames[readings.phase.phase]}</span>
            <span className="nx-hint">
              {fill(copy.panel.illuminated, {
                percent: percent.format(readings.phase.illuminatedFraction),
              })}
            </span>
          </div>
        </div>
        <Row label={copy.panel.moonrise} value={moonText(readings.moon.rise, readings.moon.state)} />
        <Row label={copy.panel.moonset} value={moonText(readings.moon.set, readings.moon.state)} />
      </Card>

      <Card className="ast-sunmoon__card" title={copy.panel.phasesTitle}>
        {phaseSequence(readings.phases).map((entry) => (
          <Row
            key={entry.name}
            label={copy.panel.phaseNames[PHASE_NAMES[entry.name]]}
            value={`${keyFormat.format(entry.at)} ${clock.format(entry.at)}`}
          />
        ))}
      </Card>

      <Card className="ast-sunmoon__card" title={copy.panel.orientationTitle}>
        <div className="ast-sunmoon__compass">
          <div className="ast-sunmoon__rose-wrap">
            <div className="ast-sunmoon__rose" role="img" aria-label={copy.panel.roseLabel}>
              <span
                className="ast-sunmoon__needle"
                style={{ transform: `rotate(${compassNorthDegrees(readings, sunOffset)}deg)` }}
                aria-hidden="true"
              />
              <span
                className="ast-sunmoon__sun-mark"
                style={{ transform: `rotate(${offsetDegrees(sunOffset)}deg)` }}
                aria-hidden="true"
              />
            </div>
            <span className="ast-sunmoon__facing">{copy.panel.facing}</span>
          </div>
          <div className="ast-sunmoon__offsets">
            {SUN_OFFSETS.map((offset) => (
              <button
                key={offset.key}
                type="button"
                className="ast-sunmoon__offset"
                aria-pressed={sunOffset === offset.key}
                onClick={() => setSunOffset(offset.key)}
              >
                {copy.panel.sightings[offset.key]}
              </button>
            ))}
          </div>
        </div>
        <p className="nx-hint">
          {readings.sunAltitude < 0
            ? copy.panel.sunBelowHorizon
            : fill(copy.panel.northReading, {
                degrees: plain.format(Math.round(compassNorthDegrees(readings, sunOffset))),
              })}
        </p>
      </Card>
    </div>
  );
}

/** Which phase name each of the engine's four phase keys prints as. */
const PHASE_NAMES = {
  newMoon: "new",
  firstQuarter: "first-quarter",
  fullMoon: "full",
  lastQuarter: "last-quarter",
} as const;

/** The sighting's own degrees, off the chosen key. */
function offsetDegrees(key: SunOffsetKey): number {
  return SUN_OFFSETS.find((offset) => offset.key === key)?.degrees ?? 0;
}

/** Where the compass needle points: north, relative to the way the reader is facing. */
function compassNorthDegrees(readings: SunMoonReadings, key: SunOffsetKey): number {
  return compassNorth(readings.sunAzimuth, offsetDegrees(key));
}

/** One label/value line. */
function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="ast-sunmoon__row">
      <span className="ast-sunmoon__label">{label}</span>
      <span className="ast-sunmoon__value">{value}</span>
    </div>
  );
}

/** The day's length, printed as hours and minutes. */
function DayLengthRow({ readings }: { readonly readings: SunMoonReadings }) {
  const parts = dayLength(readings.sun.dayLengthSeconds);
  return (
    <Row
      label={copy.panel.dayLength}
      value={`${numberFormat().format(parts.hours)} h ${numberFormat().format(parts.minutes)} min`}
    />
  );
}

/**
 * The Moon's disk, drawn from its illuminated fraction and which limb is lit.
 *
 * Two arcs and one ellipse: the lit region is a half disk plus (or minus) a
 * half-ellipse whose semi-minor axis is the terminator ratio, which is what a
 * phase IS. The dark part is not drawn at all — it is the card behind it, so the
 * disk cannot show a background of its own.
 */
function drawMoonDisk(canvas: HTMLCanvasElement, terminator: number, litOnRight: boolean): void {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const radius = 20;
  const centre = 24;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const styles = getComputedStyle(canvas);
  const ink = styles.getPropertyValue("--nx-text").trim();
  const lit = styles.getPropertyValue("--nx-accent").trim();
  if (ink === "" || lit === "") return;
  const side = litOnRight ? 1 : -1;
  // The lit region: down the limb on the lit side from the top of the disk to
  // the bottom, then back up the terminator, which is an ellipse whose
  // semi-minor axis is the terminator ratio. The ellipse bulges AWAY from the
  // lit limb when the Moon is gibbous (more than half lit) and INTO it when it
  // is a crescent, which is the sign of the ratio: the arc is walked the way an
  // increasing canvas angle walks, and the two arcs meet at top and bottom.
  context.fillStyle = lit;
  context.beginPath();
  context.arc(centre, centre, radius, -Math.PI / 2, Math.PI / 2, side < 0);
  context.ellipse(
    centre,
    centre,
    Math.abs(terminator) * radius,
    radius,
    0,
    Math.PI / 2,
    -Math.PI / 2,
    terminator < 0,
  );
  context.closePath();
  context.fill();
  // The disk's own edge, so a new moon is a circle rather than nothing.
  context.strokeStyle = ink;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(centre, centre, radius, 0, Math.PI * 2);
  context.stroke();
}

export default SunMoonPanel;
