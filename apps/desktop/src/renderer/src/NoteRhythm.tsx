import { useEffect, useState } from "react";
import { CellMatrix, ChartLegend } from "@nexus/ui";
import type { ChartLevel, MatrixCell } from "@nexus/ui";
import { heatmapWeeks, weekOpeningDayKey } from "@nexus/core";
import type { NoteMeta } from "../../shared/ipc.js";
import { localTodayKey, shiftDayKey } from "./examDates.js";
import { readStoredWeekStart, toWeekStart } from "./weekStart.js";
import { strings } from "./strings.js";

/**
 * „Ritam pisanja" — NOTE's signature graphic: the last 26 weeks, one column
 * per week and one row per weekday, shaded by how many notes were written or
 * touched that day. Built on `heatmapWeeks` (`@nexus/core`) so a cell's ROW is
 * genuinely its weekday — packing days in sequence and letting them wrap is
 * the classic contribution-graph bug, and the helper exists to make it
 * unrepresentable.
 *
 * **`null` and `level: 0` are different statements, and that difference is the
 * whole correctness of this chart.** `null` is a day outside the drawn window
 * or a day still in the future — nothing has happened there, and (for the
 * future) nothing can have yet. `level: 0` is a MEASURED zero: a day inside
 * the window on which nothing was written. Only the second is a fact about
 * the user; the first is silence, and painting it as a zero would be the
 * graphic accusing someone of a day that has not happened.
 *
 * **This is honestly a FLOOR, not an exact count, and the caption says so.** A
 * note keeps exactly two instants — `createdAt` and `updatedAt` — and nothing
 * in between, so a note edited on nine different days still contributes at
 * most two shaded squares. There is no third instant to read, and inventing
 * one would mean claiming edits the store never recorded.
 *
 * **A word count is deliberately absent here and everywhere else.** A note's
 * text never leaves its own document; a library-wide figure would mean
 * opening and replaying every note in the profile just to print one number.
 */

/** How far back the rhythm reaches — half a year of weeks, long enough to show a habit and short enough to still be "lately". */
const WINDOW_WEEKS = 26;
const DAYS_PER_WEEK = 7;

const CELL_DAY_FORMAT = new Intl.DateTimeFormat("sr-Latn", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** 1–2 notes, 3–5, 6+ — three steps, never a continuous ramp (`CellMatrix`'s own rule). */
function levelForCount(count: number): ChartLevel {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  return 3;
}

/** The local calendar day ("YYYY-MM-DD") a full ISO instant falls on, in the host's own time zone. */
function localDayOf(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}

export interface NoteRhythmProps {
  profileId: string;
}

export function NoteRhythm({ profileId }: NoteRhythmProps) {
  const [notes, setNotes] = useState<NoteMeta[] | null>(null);

  // Unfiltered and independent of whatever folder is selected elsewhere on the
  // page: this graphic answers "is the library alive", so it reads every note
  // in the profile rather than whatever `NotesPage`'s own folder scoping shows.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const found = await window.nexus.listNotes(profileId);
        if (active) setNotes(found);
      } catch (error) {
        if (active) setNotes([]);
        console.error("Nexus: failed to load the note rhythm:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  const s = strings.notes.chart;
  if (notes === null) return null;

  const weekStart = toWeekStart(readStoredWeekStart());
  const today = localTodayKey();
  const currentWeekOpen = weekOpeningDayKey(today, weekStart);
  const windowStart = shiftDayKey(currentWeekOpen, -(WINDOW_WEEKS - 1) * DAYS_PER_WEEK);
  const windowEnd = shiftDayKey(currentWeekOpen, DAYS_PER_WEEK - 1);
  const weeks = heatmapWeeks(windowStart, windowEnd, weekStart);

  // Each note counts at most once per day: the local day it was created and
  // the local day it was last touched, deduplicated when the two coincide.
  const dayCounts = new Map<string, number>();
  for (const note of notes) {
    const createdDay = localDayOf(note.createdAt);
    const updatedDay = localDayOf(note.updatedAt);
    dayCounts.set(createdDay, (dayCounts.get(createdDay) ?? 0) + 1);
    if (updatedDay !== createdDay) {
      dayCounts.set(updatedDay, (dayCounts.get(updatedDay) ?? 0) + 1);
    }
  }

  const columns = weeks.map((_, index) => index);
  const rows = [0, 1, 2, 3, 4, 5, 6] as const;

  function cellAt(row: number, col: number): MatrixCell | null {
    const day = weeks[col]?.[row] ?? null;
    if (day === null) return null; // padding — outside the drawn window
    if (day > today) return null; // the future — nothing has happened there yet
    const count = dayCounts.get(day) ?? 0;
    return {
      tone: "accent",
      level: levelForCount(count),
      label: `${CELL_DAY_FORMAT.format(new Date(day))}: ${String(count)}`,
    };
  }

  // Every day actually drawn (inside the window, not in the future) that has
  // at least one touch — the same test `cellAt` uses to pick a non-zero level,
  // counted once here rather than re-derived from a second read of the grid.
  let daysWithNotes = 0;
  for (const week of weeks) {
    for (const day of week) {
      if (day !== null && day <= today && (dayCounts.get(day) ?? 0) > 0) daysWithNotes += 1;
    }
  }

  const description = `${s.descriptionLead}: ${String(daysWithNotes)} ${s.descriptionDays}.`;

  return (
    <div className="nx-chart-group">
      <CellMatrix
        title={s.heading}
        description={description}
        caption={s.caption}
        empty={notes.length === 0 ? { reason: s.emptyReason } : null}
        columns={columns}
        rows={rows}
        cellAt={cellAt}
      />
      {notes.length > 0 && (
        <ChartLegend
          inline
          items={[
            { label: s.legendSome, tone: "accent", level: 1, shape: "swatch" },
            { label: s.legendMore, tone: "accent", level: 2, shape: "swatch" },
            { label: s.legendMost, tone: "accent", level: 3, shape: "swatch" },
          ]}
        />
      )}
    </div>
  );
}
