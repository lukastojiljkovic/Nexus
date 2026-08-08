import type { ReactNode } from "react";
import type { MuscleGroup } from "@nexus/core";

/**
 * The drawn body — front and back, twenty muscle groups, one shade each.
 *
 * **THE FIGURE IS SCHEMATIC ON PURPOSE.** It is built from named shapes on a
 * stated 120×260 grid, not from traced anatomy: every plate is a path in
 * `REGIONS` below and every bounding box is a number, so the drawing can be
 * checked by reading it rather than by squinting at it. It also keeps the
 * graphic from looking like the anatomy poster every other training app ships.
 *
 * **HALF A BODY IS AUTHORED AND THE OTHER HALF IS A MIRROR.** A paired muscle
 * carries one path and `mirrored: true`; the drawing reflects it about x = 60.
 * Twenty hand-typed pairs would be forty chances for a left shoulder to sit two
 * pixels lower than the right one, and nobody would ever find the one that did.
 * The four midline groups — trapezius, abdominals, adductors' inner block and
 * the erectors — carry `mirrored: false` and are drawn once.
 *
 * **EACH GROUP APPEARS EXACTLY ONCE, ON THE SIDE YOU WOULD SEE IT FROM.** Chest
 * is on the front, lats are on the back, and no muscle is drawn on both views: a
 * muscle painted twice is a muscle a reader has to cross-check against itself.
 *
 * **THE PLATES ARE A SHORTCUT, NOT THE CONTROL.** They answer to the mouse and
 * they carry a tooltip, and they are deliberately NOT buttons: the smallest of
 * them is ten grid units wide, which is twenty rendered pixels, and calling that
 * a control would be claiming a target nobody can reliably hit. The real,
 * keyboard-reachable list of all twenty groups sits beside the figure and does
 * everything the plates do — the same arrangement `ChartFrame` requires of every
 * graphic in this product, applied to a picker instead of a chart. The `<svg>`
 * is `aria-hidden` for exactly that reason: everything it conveys is in the list.
 */

/** One figure's own space. Every number in `REGIONS` is written in it. */
export const FIGURE_WIDTH = 120;
export const FIGURE_HEIGHT = 260;

/** The mirror axis — the body's midline, and the only place a paired shape is reflected about. */
const MIDLINE = FIGURE_WIDTH / 2;

/**
 * How much bigger than its own space each figure is drawn, and the width of the
 * panel that holds both.
 *
 * `2 × 240 + 3 × 80 = 720` exactly, so the two bodies are as far from each other
 * as they are from the edges — the only spacing that reads as a pair rather than
 * as one figure with a straggler.
 */
const FIGURE_SCALE = 2;
const DRAWN_WIDTH = FIGURE_WIDTH * FIGURE_SCALE;
const DRAWN_HEIGHT = FIGURE_HEIGHT * FIGURE_SCALE;

/**
 * 560, not 720: two 240-wide figures with 26/28/26 between and beside them.
 *
 * The width is what decides whether the rail can stand BESIDE the figure. At
 * the window this app ships at, the main pane is about 860px; a 720 drawing
 * leaves 140 for a column that has to hold exercise names, so the rail dropped
 * below the fold and „click a muscle" put its own answer off screen. At 560 the
 * two fit side by side with room to spare, and the bodies lose nothing — they
 * are drawn at the same scale, with the margins taking the difference.
 */
export const VIEW_WIDTH = 560;
const SIDE_MARGIN = 26;
const FRONT_X = SIDE_MARGIN;
const BACK_X = VIEW_WIDTH - SIDE_MARGIN - DRAWN_WIDTH;
/** Room above each figure for its view label, which sits OUTSIDE the scale. */
const FIGURE_TOP = 22;
export const VIEW_HEIGHT = FIGURE_TOP + DRAWN_HEIGHT;

interface Region {
  readonly muscle: MuscleGroup;
  readonly side: "front" | "back";
  /** SVG path data in the figure's own space, for the LEFT half of a paired group or for a midline one. */
  readonly d: string;
  /** Whether the shape is also drawn reflected about the midline. */
  readonly mirrored: boolean;
}

/**
 * Where each muscle group sits.
 *
 * Two conventions the shapes were drawn against, both inherited from
 * `MUSCLE_GROUPS`' own definitions: `gluteusi` is the gluteus MAXIMUS (hip
 * extension) and sits on the back, while `abduktori` is the abduction side —
 * medius, minimus, TFL — which is why it is a wedge on the front of the hip and
 * not a second shape behind the first. `donja-ledja` is the erector spinae as a
 * spinal extensor, so it is the column between the lats and the glutes.
 *
 * The shapes do not overlap. `FitBodyFigure.test.ts` re-derives every bounding
 * box and refuses a pair that shares area, because a plate that crept under its
 * neighbour would shade two groups with one count.
 */
const REGIONS: readonly Region[] = [
  // --- Front ---------------------------------------------------------------
  { muscle: "prednja-ramena", side: "front", mirrored: true, d: "M29 46 Q39 42 47 47 L47 64 Q36 69 30 61 Z" },
  { muscle: "bocna-ramena", side: "front", mirrored: true, d: "M16 52 Q13 62 16 73 L27 70 Q25 60 27 50 Z" },
  { muscle: "grudi", side: "front", mirrored: true, d: "M36 70 L58 70 L58 86 Q46 91 37 84 Z" },
  { muscle: "biceps", side: "front", mirrored: true, d: "M18 78 Q15 89 18 100 L29 98 Q27 87 28 77 Z" },
  { muscle: "podlaktica", side: "front", mirrored: true, d: "M19 105 Q16 120 20 135 L29 133 Q28 118 28 104 Z" },
  { muscle: "trbusnjaci", side: "front", mirrored: false, d: "M51 93 L69 93 L68 118 Q60 122 52 118 Z" },
  { muscle: "kosi-trbusni", side: "front", mirrored: true, d: "M41 93 L50 93 L51 114 Q45 118 41 110 Z" },
  { muscle: "fleksori-kuka", side: "front", mirrored: true, d: "M45 122 L58 124 L56 135 L44 132 Z" },
  { muscle: "abduktori", side: "front", mirrored: true, d: "M36 127 Q34 134 37 142 L43 141 L42 127 Z" },
  { muscle: "kvadriceps", side: "front", mirrored: true, d: "M38 145 Q36 166 40 190 L48 189 Q49 166 48 145 Z" },
  { muscle: "adduktori", side: "front", mirrored: true, d: "M50 145 L57 145 Q56 168 54 182 L50 181 Z" },
  // --- Back ----------------------------------------------------------------
  { muscle: "trapez", side: "back", mirrored: false, d: "M47 45 L73 45 L69 66 L51 66 Z" },
  { muscle: "zadnja-ramena", side: "back", mirrored: true, d: "M29 46 Q39 42 47 47 L47 64 Q36 69 30 61 Z" },
  { muscle: "romboidi", side: "back", mirrored: true, d: "M42 69 L57 70 L56 84 L43 83 Z" },
  { muscle: "triceps", side: "back", mirrored: true, d: "M18 77 Q15 89 18 101 L29 99 Q27 88 28 76 Z" },
  { muscle: "latovi", side: "back", mirrored: true, d: "M36 87 L53 89 L51 112 Q39 110 36 98 Z" },
  { muscle: "donja-ledja", side: "back", mirrored: false, d: "M50 114 L70 114 L69 134 L51 134 Z" },
  { muscle: "gluteusi", side: "back", mirrored: true, d: "M37 137 Q35 150 41 158 L58 156 L58 137 Z" },
  { muscle: "zadnja-loza", side: "back", mirrored: true, d: "M39 161 Q38 180 42 197 L54 196 Q55 178 54 161 Z" },
  { muscle: "listovi", side: "back", mirrored: true, d: "M44 203 Q41 218 45 237 L54 235 Q55 216 54 202 Z" },
];

/**
 * Every muscle group is drawn. Exported so the test can assert it against
 * `MUSCLE_GROUPS` rather than against a copy of the list — a group added to the
 * vocabulary and forgotten here would otherwise be a muscle the map silently
 * stops asking about.
 */
export const DRAWN_REGIONS = REGIONS;

/**
 * The BODY under the plates — a filled silhouette, not an outline.
 *
 * It was a stroke-only wireframe first, and the screenshot said what that
 * looks like: a mannequin assembled from six floating boxes, with the muscle
 * plates painted over the gaps between them. A stroke shows every seam; a fill
 * hides them, so the parts below deliberately OVERLAP — the neck reaches into
 * both the head and the torso, the arms into the shoulders, the legs into the
 * hips — and merge into one shape because they all carry the same fill and no
 * stroke at all.
 *
 * The proportions are a schematic figure at roughly seven heads, and every
 * plate in `REGIONS` was placed against these edges: a plate wider than the
 * limb it is on paints outside the body, which is the exact defect the first
 * draft shipped at the knee.
 *
 * Authored as a left half plus its mirror for the limbs, for `REGIONS`' reason,
 * and as whole shapes for the head, neck and torso, which are symmetric about
 * the midline by construction and would gain nothing from being halved.
 */
const OUTLINE_HALVES: readonly string[] = [
  // Arm: reaching into the shoulder at the top, tapering through the elbow to
  // the wrist. The right edge runs inside the torso down to y≈68, so the
  // deltoid plate spanning the joint sits on solid body rather than on a gap.
  "M15 44 C11 62 12 82 15 98 L18 142 L31 142 L30 98 C31 82 34 60 36 44 Z",
  // Leg: hip to ankle. Nearly straight through the thigh — a schematic leg
  // that tapers as fast as a real one leaves the quadriceps plate hanging over
  // the edge at the knee, which is exactly what the first draft did.
  "M33 134 L59 134 L57 198 L55 250 L41 250 L36 198 Z",
];

const OUTLINE_WHOLE: readonly string[] = [
  // Torso: shoulders domed, ribs in at the waist, hips back out.
  "M28 44 C38 39 82 39 92 44 L86 78 L82 106 L86 140 L34 140 L38 106 L34 78 Z",
  // Neck — into the head above and the chest below.
  "M54 26 L66 26 L66 46 L54 46 Z",
];

/** How strongly one group is painted. The four steps `.nx-cell--l0…l3` already ship for every other graphic in the app. */
export type MuscleShade = 0 | 1 | 2 | 3;

export interface FitBodyFigureProps {
  /** The shade each group wears. A group absent from the map is drawn at 0 — „nothing here", which is a real answer. */
  shades: ReadonlyMap<MuscleGroup, MuscleShade>;
  /** The group drawn as chosen, or null. Outlined rather than recoloured: the shade is data and must not be overwritten by a selection. */
  selected: MuscleGroup | null;
  /** One line per group, read on hover — the count and when it last happened. */
  title: (muscle: MuscleGroup) => string;
  onSelect: (muscle: MuscleGroup) => void;
  frontLabel: string;
  backLabel: string;
}

export function FitBodyFigure({
  shades,
  selected,
  title,
  onSelect,
  frontLabel,
  backLabel,
}: FitBodyFigureProps) {
  const figure = (side: "front" | "back", offsetX: number, label: string): ReactNode => (
    <g transform={`translate(${String(offsetX)} 0)`}>
      {/* The label rides in the VIEW's units and the body in the figure's own,
          which is why the scale starts below it: a label inside the scaled group
          would be a 26px word over a schematic drawing, competing with the
          shading it names. */}
      <text className="fit__body-side" x={DRAWN_WIDTH / 2} y={12} textAnchor="middle">
        {label}
      </text>
      <g transform={`translate(0 ${String(FIGURE_TOP)}) scale(${String(FIGURE_SCALE)})`}>
        <g className="fit__body-outline">
          {OUTLINE_WHOLE.map((d) => (
            <path key={d} d={d} />
          ))}
          {OUTLINE_HALVES.map((d) => (
            <g key={d}>
              <path d={d} />
              <path d={d} transform={`translate(${String(FIGURE_WIDTH)} 0) scale(-1 1)`} />
            </g>
          ))}
          <circle cx={MIDLINE} cy={18} r={12} />
        </g>
        {REGIONS.filter((region) => region.side === side).map((region) => {
          const shade = shades.get(region.muscle) ?? 0;
          const chosen = region.muscle === selected;
          return (
            <g
              key={region.muscle}
              className={`fit__body-region${chosen ? " fit__body-region--on" : ""}`}
              onClick={() => onSelect(region.muscle)}
            >
              <title>{title(region.muscle)}</title>
              <path className={`fit__body-plate nx-cell nx-cell--l${String(shade)}`} d={region.d} />
              {region.mirrored && (
                <path
                  className={`fit__body-plate nx-cell nx-cell--l${String(shade)}`}
                  d={region.d}
                  transform={`translate(${String(FIGURE_WIDTH)} 0) scale(-1 1)`}
                />
              )}
            </g>
          );
        })}
      </g>
    </g>
  );

  return (
    // Hidden from assistive technology on purpose — see the file header. The
    // list beside this figure carries every group it draws, as real buttons.
    <svg
      className="fit__body-svg"
      aria-hidden="true"
      viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
      width="100%"
      height={VIEW_HEIGHT}
    >
      {figure("front", FRONT_X, frontLabel)}
      {figure("back", BACK_X, backLabel)}
    </svg>
  );
}

/** Which view a group is drawn on — the rail uses it to say „prednja strana" beside a selected muscle. */
export function sideOf(muscle: MuscleGroup): "front" | "back" {
  return REGIONS.find((region) => region.muscle === muscle)?.side ?? "front";
}
