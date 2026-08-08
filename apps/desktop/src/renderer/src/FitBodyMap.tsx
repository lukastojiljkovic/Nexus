import type { ReactNode } from "react";
import { ChartFrame, Chip } from "@nexus/ui";
import type { ChartLevel } from "@nexus/ui";
import { countsTowardVolume, MUSCLE_GROUPS } from "@nexus/core";
import type { MuscleGroup, ProgressSet } from "@nexus/core";
import { strings } from "./strings.js";

/**
 * „Mapa tela" — FIT's signature graphic, and the one question a sorted list of
 * chips answers only in sequence: WHAT DID I NOT TRAIN.
 *
 * Twenty muscle groups as twenty chips have to be read one at a time, and the
 * answer is always in the ones at the bottom. A silhouette with two pale
 * shoulders answers it at a glance, which is the entire argument for drawing a
 * body instead of a table.
 *
 * THE FIGURE IS SCHEMATIC ON PURPOSE. It is built from rounded plates on a
 * stated grid, not from traced anatomy — every plate's rectangle is a number in
 * `REGIONS` below, so the drawing can be checked by reading it rather than by
 * squinting at it, and nothing overlaps by accident. It also keeps the graphic
 * from looking like the anatomy poster every other training app ships.
 *
 * EACH GROUP APPEARS EXACTLY ONCE. Chest is on the front, lats are on the back,
 * and no muscle is drawn on both views — twenty groups, twenty plates, one
 * shade each. A muscle painted twice would be a muscle a reader has to
 * cross-check against itself.
 *
 * THE BANDS ARE A DRAWING DECISION AND THE CAPTION SAYS SO. Nothing here claims
 * a muscle is undertrained: the app does not know anybody's programme, and „ten
 * hard sets a week" is a landmark from the literature, not a verdict about this
 * person. What the map states is the count; what it means is the lifter's call.
 *
 * WARM-UPS DO NOT COUNT, through `countsTowardVolume` — the same line every
 * other volume figure in the module draws, read from `@nexus/core` rather than
 * restated, so the map and „Nedeljni obim" can never disagree about what a set
 * is. Sets bill their PRIMARY muscles only, which is `weeklyVolume`'s own rule:
 * one bench press counted as chest and triceps and shoulders would make every
 * body look evenly trained.
 */

/** How far back the map looks. Seven days: the span a training week is actually balanced over. */
const WINDOW_DAYS = 7;

/** The set counts each shade stands for. Stated in the caption, because a shade nobody explained is a shade somebody guesses at. */
const BAND_LOW = 5;
const BAND_HIGH = 10;

/**
 * One figure's own space — the coordinate system every rectangle in `REGIONS`
 * is written in, and deliberately UNTOUCHED by the sizing below. The map is
 * FIT's signature graphic and used to be drawn at the 320px card width, tucked
 * under a list of records; it is a panel graphic now, and it gets there by
 * scaling the whole drawing rather than by anyone re-typing twenty plates.
 */
const FIGURE_WIDTH = 120;
const FIGURE_HEIGHT = 260;

/**
 * How much bigger than its own space each figure is drawn. 1.6 is what fits two
 * figures plus a readable gap inside the 720 panel box `ChartFrame` allows —
 * `2 × 192 + 192 + 2 × 72 = 720` exactly, so the two bodies are as far apart as
 * they are wide and neither is crowded against an edge.
 */
const FIGURE_SCALE = 1.6;
const DRAWN_WIDTH = FIGURE_WIDTH * FIGURE_SCALE;
const DRAWN_HEIGHT = FIGURE_HEIGHT * FIGURE_SCALE;

/** The panel box. 320 (card) or 720 (panel) — `ChartFrame` allows no third. */
const VIEW_WIDTH = 720;
const SIDE_MARGIN = 72;
const FRONT_X = SIDE_MARGIN;
const BACK_X = VIEW_WIDTH - SIDE_MARGIN - DRAWN_WIDTH;
/** Room above each figure for its view label, which sits OUTSIDE the scale. */
const FIGURE_TOP = 20;
const VIEW_HEIGHT = FIGURE_TOP + DRAWN_HEIGHT;

const PLATE_RADIUS = 3;

/** A shaded plate, in its own figure's 120×260 space. */
interface Plate {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Region {
  muscle: MuscleGroup;
  side: "front" | "back";
  /** One entry per drawn shape — a paired muscle is two, a midline one is one. */
  plates: readonly Plate[];
}

/**
 * Where each muscle group sits. Coordinates are in the figure's own space and
 * are checked to not overlap: a plate that crept under its neighbour would
 * shade two groups with one count.
 *
 * The split between the views is anatomical rather than convenient — a muscle
 * is drawn on the side you would see it from.
 */
const REGIONS: readonly Region[] = [
  // --- Front ---------------------------------------------------------------
  { muscle: "prednja-ramena", side: "front", plates: [{ x: 24, y: 44, w: 18, h: 16 }, { x: 78, y: 44, w: 18, h: 16 }] },
  { muscle: "bocna-ramena", side: "front", plates: [{ x: 14, y: 46, w: 10, h: 20 }, { x: 96, y: 46, w: 10, h: 20 }] },
  { muscle: "grudi", side: "front", plates: [{ x: 32, y: 62, w: 26, h: 20 }, { x: 62, y: 62, w: 26, h: 20 }] },
  { muscle: "biceps", side: "front", plates: [{ x: 16, y: 70, w: 12, h: 26 }, { x: 92, y: 70, w: 12, h: 26 }] },
  { muscle: "podlaktica", side: "front", plates: [{ x: 18, y: 100, w: 11, h: 32 }, { x: 91, y: 100, w: 11, h: 32 }] },
  { muscle: "trbusnjaci", side: "front", plates: [{ x: 50, y: 86, w: 20, h: 32 }] },
  { muscle: "kosi-trbusni", side: "front", plates: [{ x: 38, y: 88, w: 10, h: 28 }, { x: 72, y: 88, w: 10, h: 28 }] },
  { muscle: "fleksori-kuka", side: "front", plates: [{ x: 42, y: 120, w: 14, h: 12 }, { x: 64, y: 120, w: 14, h: 12 }] },
  { muscle: "abduktori", side: "front", plates: [{ x: 31, y: 134, w: 6, h: 30 }, { x: 83, y: 134, w: 6, h: 30 }] },
  { muscle: "kvadriceps", side: "front", plates: [{ x: 39, y: 138, w: 15, h: 46 }, { x: 66, y: 138, w: 15, h: 46 }] },
  { muscle: "adduktori", side: "front", plates: [{ x: 56, y: 138, w: 8, h: 40 }] },
  // --- Back ----------------------------------------------------------------
  { muscle: "trapez", side: "back", plates: [{ x: 46, y: 40, w: 28, h: 20 }] },
  { muscle: "zadnja-ramena", side: "back", plates: [{ x: 24, y: 44, w: 18, h: 16 }, { x: 78, y: 44, w: 18, h: 16 }] },
  { muscle: "romboidi", side: "back", plates: [{ x: 40, y: 62, w: 17, h: 14 }, { x: 63, y: 62, w: 17, h: 14 }] },
  { muscle: "triceps", side: "back", plates: [{ x: 16, y: 70, w: 12, h: 28 }, { x: 92, y: 70, w: 12, h: 28 }] },
  { muscle: "latovi", side: "back", plates: [{ x: 30, y: 78, w: 22, h: 28 }, { x: 68, y: 78, w: 22, h: 28 }] },
  { muscle: "donja-ledja", side: "back", plates: [{ x: 48, y: 108, w: 24, h: 20 }] },
  { muscle: "gluteusi", side: "back", plates: [{ x: 38, y: 132, w: 20, h: 22 }, { x: 62, y: 132, w: 20, h: 22 }] },
  { muscle: "zadnja-loza", side: "back", plates: [{ x: 40, y: 156, w: 17, h: 42 }, { x: 63, y: 156, w: 17, h: 42 }] },
  { muscle: "listovi", side: "back", plates: [{ x: 42, y: 202, w: 14, h: 34 }, { x: 64, y: 202, w: 14, h: 34 }] },
];

/**
 * The outline under the plates, so the shapes read as a body rather than as a
 * scattered set of bars. Purely structural — it carries no data and no colour,
 * only the border hairline.
 */
function Silhouette(): ReactNode {
  return (
    <g className="fit__body-outline" aria-hidden="true">
      <circle cx={60} cy={20} r={13} />
      <rect x={53} y={31} width={14} height={10} rx={4} />
      {/* Torso: shoulders, waist, hips. */}
      <path d="M26 44 L94 44 L82 108 L84 136 L36 136 L38 108 Z" />
      {/* Arms, hanging clear of the torso. */}
      <rect x={13} y={44} width={16} height={90} rx={7} />
      <rect x={91} y={44} width={16} height={90} rx={7} />
      {/* Legs. */}
      <path d="M37 136 L58 136 L57 198 L56 250 L42 250 L41 198 Z" />
      <path d="M62 136 L83 136 L79 198 L78 250 L64 250 L63 198 Z" />
    </g>
  );
}

/** One muscle's week: how many counting sets, and the last day it saw one. */
interface MuscleWeek {
  sets: number;
  lastDay: string | null;
}

/**
 * The window's counts, per muscle.
 *
 * Exported for the test that pins the two rules it would be easiest to get
 * wrong later — warm-ups are not counted, and a set bills only its primary
 * muscles.
 */
export function muscleWeek(
  sets: readonly ProgressSet[],
  from: string,
  to: string,
): Map<MuscleGroup, MuscleWeek> {
  const found = new Map<MuscleGroup, MuscleWeek>();
  for (const set of sets) {
    if (!countsTowardVolume(set.kind)) continue;
    if (set.day < from || set.day > to) continue;
    for (const muscle of set.primaryMuscles) {
      const current = found.get(muscle);
      if (current === undefined) {
        found.set(muscle, { sets: 1, lastDay: set.day });
      } else {
        current.sets += 1;
        if (current.lastDay === null || set.day > current.lastDay) current.lastDay = set.day;
      }
    }
  }
  return found;
}

/** Which shade a count wears. Four steps, because nobody reads step six from step seven. */
function bandOf(count: number): ChartLevel {
  if (count <= 0) return 0;
  if (count < BAND_LOW) return 1;
  if (count < BAND_HIGH) return 2;
  return 3;
}

/** The first day of a window of `days` ending on `to`, both ends inclusive. */
function windowFrom(to: string, days: number): string {
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().slice(0, 10);
}

export interface FitBodyMapProps {
  /** Every set the surrounding range holds; this component narrows to its own week. */
  sets: readonly ProgressSet[];
  today: string;
}

export function FitBodyMap({ sets, today }: FitBodyMapProps) {
  const s = strings.fitness.training.progress.bodyMap;
  const names = strings.fitness.training.muscle;

  const from = windowFrom(today, WINDOW_DAYS);
  const week = muscleWeek(sets, from, today);

  const trained = MUSCLE_GROUPS.filter((muscle) => (week.get(muscle)?.sets ?? 0) > 0);
  const untouched = MUSCLE_GROUPS.filter((muscle) => (week.get(muscle)?.sets ?? 0) === 0);

  // Every number in both sentences comes from the constant that governs it, so
  // neither can outlive the drawing: the window from `WINDOW_DAYS`, the bands
  // from their own edges, the denominator from the vocabulary itself.
  const span = `${String(WINDOW_DAYS)} ${s.captionDayUnit}`;
  const caption =
    `${s.captionLead} ${span} — ${s.captionBands} 1–${String(BAND_LOW - 1)}, ` +
    `${String(BAND_LOW)}–${String(BAND_HIGH - 1)}, ${String(BAND_HIGH)} ${s.captionAndUp}. ${s.captionTail}`;
  // Derived from the very map that shades the plates, so the sentence cannot
  // describe a body other than the one drawn.
  const description =
    `${s.descriptionLead} ${span}: ${String(trained.length)} ${s.descriptionOf} ` +
    `${String(MUSCLE_GROUPS.length)} ${s.descriptionTrained}.`;

  /** One muscle's label, read on hover and by a reader — the count, and when it last happened. */
  const plateTitle = (muscle: MuscleGroup): string => {
    const entry = week.get(muscle);
    const name = names[muscle];
    if (entry === undefined || entry.sets === 0) return `${name}: ${s.neverTrained}`;
    const when = entry.lastDay === null ? "" : ` · ${s.lastPrefix} ${entry.lastDay}`;
    return `${name}: ${String(entry.sets)} ${s.setsSuffix}${when}`;
  };

  // The label rides in the VIEW's units and the body in the figure's own, which
  // is why the scale starts below it: a label inside the scaled group would be
  // an 18px word over a schematic drawing, competing with the shading it names.
  const figure = (side: "front" | "back", offsetX: number, label: string) => (
    <g transform={`translate(${String(offsetX)} 0)`}>
      <text className="fit__body-side" x={DRAWN_WIDTH / 2} y={11} textAnchor="middle">
        {label}
      </text>
      <g transform={`translate(0 ${String(FIGURE_TOP)}) scale(${String(FIGURE_SCALE)})`}>
        <Silhouette />
        {REGIONS.filter((region) => region.side === side).map((region) => (
          <g key={region.muscle}>
            <title>{plateTitle(region.muscle)}</title>
            {region.plates.map((plate) => (
              <rect
                key={`${String(plate.x)}:${String(plate.y)}`}
                className={`nx-cell nx-cell--l${String(bandOf(week.get(region.muscle)?.sets ?? 0))}`}
                x={plate.x}
                y={plate.y}
                width={plate.w}
                height={plate.h}
                rx={PLATE_RADIUS}
              />
            ))}
          </g>
        ))}
      </g>
    </g>
  );

  return (
    <div className="nx-chart-group">
      <ChartFrame
        title={s.heading}
        description={description}
        caption={caption}
        empty={sets.length === 0 ? { reason: s.emptyReason } : null}
        viewBox={[VIEW_WIDTH, VIEW_HEIGHT]}
        height={VIEW_HEIGHT}
      >
        {figure("front", FRONT_X, s.front)}
        {figure("back", BACK_X, s.back)}
      </ChartFrame>
      {/* The truth behind the picture. The map is the shortcut; this is the
          list, reachable by the same keyboard route, and it is the half a
          reader who cannot see the shading needs. */}
      {sets.length > 0 && (
        <>
          <div className="fit__figures-heading">{`${s.untouchedHeading} ${span}`}</div>
          {untouched.length === 0 ? (
            <p className="fit__note">{s.untouchedNone}</p>
          ) : (
            <div className="fit__chips">
              {untouched.map((muscle) => (
                <Chip key={muscle}>{names[muscle]}</Chip>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
