import { ChartFrame } from "./ChartFrame.js";

/**
 * The three colour ROLES a graphic may use, and there is no fourth.
 *
 * `accent` is what the person did; `data` (jade) is the comparison or the
 * second series; `danger` is a genuinely bad state — overdue, lapsed, missed,
 * negative. „A third series" is not a reason to reach past these: it is a sign
 * the chart is doing two jobs.
 */
export type ChartTone = "accent" | "data" | "danger" | "neutral";

/**
 * Intensity is ONE hue at four steps, never a continuous ramp. Nobody reads
 * step 6 from step 7, and a ten-stop ramp claims a precision the underlying
 * counts do not have.
 */
export type ChartLevel = 0 | 1 | 2 | 3;

export interface MatrixCell {
  tone: ChartTone;
  level: ChartLevel;
  /** What this one cell means, read aloud if the cell is focusable. */
  label: string;
}

export interface CellMatrixProps<R, C> {
  title: string;
  description: string;
  caption?: string;
  empty: { reason: string } | null;
  columns: readonly C[];
  rows: readonly R[];
  /**
   * The cell at a crossing, or `null` for NOT DRAWN.
   *
   * `null` and `level: 0` are different statements and the distinction is the
   * whole reason this is a primitive. `level: 0` is a measured zero — the habit
   * was asked of you that day and you did not do it. `null` is silence — the
   * day is outside the range, or the habit was not scheduled, or the term had
   * not started. Painting silence as zero is the most common lie a heatmap
   * tells, and here it is unrepresentable.
   */
  cellAt: (row: R, col: C) => MatrixCell | null;
  /** Short-edge size in px. The house size is 13; below 10 it is texture, not a control. */
  size?: number;
  gap?: number;
  onActivate?: (row: R, col: C) => void;
}

const RADIUS = 2.5;

/** The user-space box a matrix of a given shape occupies. */
export interface MatrixBox {
  /** One cell plus one gap — the pitch a cell's origin advances by. */
  step: number;
  width: number;
  height: number;
}

/**
 * The grid's outer box, and the one thing about it that is easy to get wrong.
 *
 * The box is `n * step - gap`, NOT `n * step`: a matrix has n cells and n-1
 * gaps between them, so the trailing gap has to come back off. Leaving it in
 * puts a band of dead space down the right edge and along the bottom of every
 * heatmap, which inside a `viewBox` is not empty margin — it is scale, and the
 * whole grid is drawn a few percent small to make room for a gap that has no
 * cell after it.
 *
 * The floor at 1 is for the empty matrix: a `viewBox` of width 0 is invalid
 * and browsers respond to it by not drawing the `<svg>` at all.
 */
export function matrixBox(columns: number, rows: number, size: number, gap: number): MatrixBox {
  const step = size + gap;
  return {
    step,
    width: Math.max(1, columns * step - gap),
    height: Math.max(1, rows * step - gap),
  };
}

export function CellMatrix<R, C>({
  title,
  description,
  caption,
  empty,
  columns,
  rows,
  cellAt,
  size = 13,
  gap = 3,
  onActivate,
}: CellMatrixProps<R, C>) {
  const { step, width, height } = matrixBox(columns.length, rows.length, size, gap);
  const interactive = onActivate !== undefined;

  return (
    <ChartFrame
      title={title}
      description={description}
      {...(caption === undefined ? {} : { caption })}
      empty={empty}
      viewBox={[width, height]}
      height={height}
    >
      {columns.map((col, x) =>
        rows.map((row, y) => {
          const cell = cellAt(row, col);
          // Not drawn at all — see the note on `cellAt`.
          if (cell === null) return null;
          const key = `${String(x)}:${String(y)}`;
          return (
            <rect
              key={key}
              className={`nx-cell nx-cell--${cell.tone} nx-cell--l${String(cell.level)}`}
              x={x * step}
              y={y * step}
              width={size}
              height={size}
              rx={RADIUS}
              {...(interactive
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": cell.label,
                    onClick: () => onActivate(row, col),
                    // SVG has no `<button>`, so the keyboard contract is made
                    // by hand: a focusable rect that answers both keys a button
                    // answers. Without this the cells are reachable by tab and
                    // then do nothing, which is worse than not being reachable.
                    onKeyDown: (event: React.KeyboardEvent<SVGRectElement>) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onActivate(row, col);
                    },
                  }
                : { "aria-hidden": true })}
            >
              {/* A tooltip is not an alternative to the sentence — this only
                  repeats what the cell's own label already says. */}
              <title>{cell.label}</title>
            </rect>
          );
        }),
      )}
    </ChartFrame>
  );
}
