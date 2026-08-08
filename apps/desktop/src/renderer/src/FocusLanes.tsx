import { FOCUS_PHASE_KINDS } from "@nexus/core";
import type { FocusPhaseKind } from "@nexus/core";
import { SpanLanes } from "@nexus/ui";
import type { SpanLanesLane, SpanLanesSpan } from "@nexus/ui";
import type { FocusSession } from "../../shared/ipc.js";
import { focusSessionMinutes, formatDurationMinutes } from "./focusFormat.js";
import { formatClockTime } from "./timeFormat.js";
import { strings } from "./strings.js";

/**
 * „Trake pažnje" — FOCUS's signature graphic: today's FINISHED phases laid on
 * one shared time axis, so the RHYTHM of the day shows — three long blocks
 * before noon and nothing after, or twelve fragments with breaks scattered
 * through it. A list of rows states WHAT happened; only a timeline states
 * WHEN, and the shape between the bars is the whole point a list cannot make.
 *
 * **A span is WALL CLOCK, start to end — pauses included.** The minutes figure
 * everywhere else in the app (`focusSessionMinutes`) SUBTRACTS the paused
 * seconds, because that is the attention the phase actually held. Those are two
 * different numbers about the same phase: the bar answers "how much of the day
 * did this occupy", the minutes beside it answer "how much of it was spent
 * working". The caption states the split so a reader is told rather than left
 * to notice the two numbers disagree.
 *
 * **There is no „prekinuto" lane.** A cancelled timer (`focus:cancel`) is never
 * written down at all, and a running phase is never a row either — it lives in
 * `focus:status`, not in `listFocusRange`. A bucket for either would therefore
 * be permanently empty, and an always-empty lane reads as „you never abandon
 * anything" — a claim this data cannot make.
 */

const MINUTES_PER_DAY = 1440;
const HOUR_MINUTES = 60;

/** Minutes since local midnight, fractional to the second — the same reading `formatClockTime` draws its hour/minute from. */
function minuteOfDay(date: Date): number {
  return date.getHours() * HOUR_MINUTES + date.getMinutes() + date.getSeconds() / 60;
}

function localMinuteOfDay(iso: string): number {
  return minuteOfDay(new Date(iso));
}

const LANE_TONE: Record<FocusPhaseKind, "accent" | "neutral"> = {
  work: "accent",
  short_break: "neutral",
  long_break: "neutral",
};

export interface FocusLanesProps {
  /** Today's FINISHED phases only — a running one is read through `focus:status` and is never a row here. */
  sessions: readonly FocusSession[];
}

export function FocusLanes({ sessions }: FocusLanesProps) {
  const s = strings.focus.chart;
  const laneLabel: Record<FocusPhaseKind, string> = {
    work: s.workLane,
    short_break: s.shortBreakLane,
    long_break: s.longBreakLane,
  };

  const spansByKind = new Map<FocusPhaseKind, SpanLanesSpan[]>();
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  for (const session of sessions) {
    const start = localMinuteOfDay(session.startedAt);
    let end = localMinuteOfDay(session.endedAt);
    // A phase that ran past local midnight would otherwise read backwards on
    // an axis that is only ever "today" — clamp to the day's own end instead
    // of drawing a bar running right to left.
    if (end < start) end = MINUTES_PER_DAY;
    const span: SpanLanesSpan = {
      from: start,
      to: end,
      label: `${strings.focus.kind[session.kind]}, ${formatClockTime(session.startedAt)}–${formatClockTime(session.endedAt)}`,
    };
    const bucket = spansByKind.get(session.kind);
    if (bucket === undefined) spansByKind.set(session.kind, [span]);
    else bucket.push(span);
    earliest = Math.min(earliest, start);
    latest = Math.max(latest, end);
  }

  // One lane per kind, present only when today actually holds a phase of it —
  // an always-empty lane is exactly the "prekinuto" trap described above.
  const lanes: SpanLanesLane[] = FOCUS_PHASE_KINDS.filter(
    (kind) => (spansByKind.get(kind)?.length ?? 0) > 0,
  ).map((kind) => ({
    key: kind,
    label: laneLabel[kind],
    tone: LANE_TONE[kind],
    spans: spansByKind.get(kind) ?? [],
    marks: [],
  }));

  // Narrowed to the span actually used, padded to the hour, so a day of
  // afternoon work does not draw as a sliver beside an empty morning.
  const domain: [number, number] =
    sessions.length === 0
      ? [0, MINUTES_PER_DAY]
      : [
          Math.max(0, Math.floor(earliest / HOUR_MINUTES) * HOUR_MINUTES),
          Math.min(MINUTES_PER_DAY, Math.ceil(latest / HOUR_MINUTES) * HOUR_MINUTES),
        ];

  // The finding, from the very sessions that produced the spans: how many
  // phases, and how much MEASURED attention (pauses already subtracted) they
  // held — never the wall-clock span the bars themselves draw.
  const totalMinutes = sessions.reduce((sum, session) => sum + focusSessionMinutes(session), 0);
  const description = `${s.descriptionLead}: ${String(sessions.length)} ${s.descriptionPhases}, ${formatDurationMinutes(totalMinutes)}.`;

  return (
    // Capped to the same 720 the drawing is laid out at, so the figure's title,
    // its bars and its caption share one left edge. An `align-self: stretch`
    // group in a 1180px pane left the title at x=0 while `preserveAspectRatio`
    // centred a 720-wide drawing two hundred pixels to its right — a graphic
    // visibly come loose from its own heading.
    <div className="nx-chart-group foc__lanes">
      <SpanLanes
        title={s.heading}
        description={description}
        caption={s.caption}
        empty={sessions.length === 0 ? { reason: s.emptyReason } : null}
        domain={domain}
        lanes={lanes}
        rule={{ at: minuteOfDay(new Date()), label: s.nowLabel, tone: "neutral" }}
        width={720}
        // A lane is a KIND, and there are at most three of them — so each one can
        // have real height instead of the card default. At 26 a day of work sat
        // as one thin bar in a strip barely taller than its own label.
        laneHeight={34}
      />
    </div>
  );
}
