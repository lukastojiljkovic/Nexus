import type { BodyId } from "@nexus/core";

/**
 * Where the HTML labels go, as pure arithmetic over positions that have already
 * been projected to the screen.
 *
 * **The one rule the brief fixes, and why it is geometric rather than fiddly.**
 * A label must never sit on the body it names — a name printed over a planet is
 * worse than no name at all. So the label is placed on ONE axis, offset from the
 * body's centre by at least its drawn radius plus `LABEL_GAP_PX`, and everything
 * the resolver does afterwards moves it along the OTHER axis or further out
 * along the same one. That is what makes the guarantee structural: the nearest
 * point of the label's rectangle to the body's centre is never closer than that
 * gap, whatever the other coordinate ends up being.
 *
 * The four candidates are the four sides, tried right, left, below, above —
 * a name reads best beside its body, and only a body against the edge of a
 * crowded screen needs the others. Candidates are tried against the viewport and
 * against the labels already placed; the first that fits wins. When nothing fits
 * (a screen full of bodies at one pixel each) the first candidate is used
 * unclamped, because a label that hangs off the edge is readable and a label
 * shifted back over its own planet is not.
 *
 * **The order is a sort, not the caller's order.** Two frames of the same scene
 * must place the same labels the same way, so anchors are ordered by height and
 * then by name before anything is decided; the input array's order therefore
 * cannot change the result, and a test says so.
 */

export interface LabelAnchor {
  readonly id: BodyId;
  /** The body's centre, in CSS pixels, measured from the view's top-left corner. */
  readonly x: number;
  readonly y: number;
  /** The body's drawn radius in pixels — the disc the label must clear. */
  readonly radiusPx: number;
  /** The label's own measured width in pixels, read off the rendered element. */
  readonly widthPx: number;
}

export interface LabelBox {
  readonly id: BodyId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LabelPlacement {
  readonly id: BodyId;
  readonly box: LabelBox;
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface LabelViewport {
  readonly width: number;
  readonly height: number;
}

/** One line of `--nx-font-size-caption` at `--nx-font-leading-tight`, padded: the layer's own height for a label. */
export const LABEL_HEIGHT_PX = 18;

/** The clear space between a body's disc and the label that names it. */
export const LABEL_GAP_PX = 8;

/** The clear space between two stacked labels. */
export const LABEL_STACK_GAP_PX = 4;

/** How far a label keeps off the viewport's edges. */
export const LABEL_MARGIN_PX = 4;

/**
 * How many times a label may be pushed before it is accepted wherever it lands.
 * The contract carries eleven bodies, so a column of labels cannot be deeper
 * than eleven; twelve steps is the whole system and one spare.
 */
const MAX_STACK_STEPS = 12;

type Side = "right" | "left" | "below" | "above";

interface Candidate {
  readonly side: Side;
  readonly x: number;
  readonly y: number;
}

function candidatesFor(anchor: LabelAnchor): readonly Candidate[] {
  const gap = anchor.radiusPx + LABEL_GAP_PX;
  const centred = anchor.y - LABEL_HEIGHT_PX / 2;
  return [
    { side: "right", x: anchor.x + gap, y: centred },
    { side: "left", x: anchor.x - gap - anchor.widthPx, y: centred },
    { side: "below", x: anchor.x - anchor.widthPx / 2, y: anchor.y + gap },
    { side: "above", x: anchor.x - anchor.widthPx / 2, y: anchor.y - gap - LABEL_HEIGHT_PX },
  ];
}

function boxOf(anchor: LabelAnchor, candidate: Candidate, y: number): LabelBox {
  return {
    id: anchor.id,
    x: candidate.x,
    y,
    width: anchor.widthPx,
    height: LABEL_HEIGHT_PX,
  };
}

function insideViewport(box: LabelBox, viewport: LabelViewport): boolean {
  return (
    box.x >= LABEL_MARGIN_PX &&
    box.y >= LABEL_MARGIN_PX &&
    box.x + box.width <= viewport.width - LABEL_MARGIN_PX &&
    box.y + box.height <= viewport.height - LABEL_MARGIN_PX
  );
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * The candidate's box, pushed outward until it clears every label already
 * placed. "Outward" is the side's own direction: down for right, left and
 * below, up for above — so the push can never bring the label back over its own
 * body.
 */
function separate(anchor: LabelAnchor, candidate: Candidate, placed: readonly LabelBox[]): LabelBox {
  const step = (LABEL_HEIGHT_PX + LABEL_STACK_GAP_PX) * (candidate.side === "above" ? -1 : 1);
  let y = candidate.y;
  let box = boxOf(anchor, candidate, y);
  for (let attempt = 0; attempt < MAX_STACK_STEPS; attempt += 1) {
    if (!placed.some((other) => overlaps(box, other))) return box;
    y += step;
    box = boxOf(anchor, candidate, y);
  }
  return box;
}

/**
 * Every body's label box, on a screen of `viewport`.
 *
 * Anchors are placed from the top of the screen down, so a label that has to
 * move lands where a reader's eye already is: below the one above it.
 */
export function placeLabels(
  anchors: readonly LabelAnchor[],
  viewport: LabelViewport,
): readonly LabelPlacement[] {
  const ordered = [...anchors].sort(
    (a, b) => a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const placed: LabelBox[] = [];
  const placements: LabelPlacement[] = [];

  for (const anchor of ordered) {
    const candidates = candidatesFor(anchor);
    const separated = candidates.map((candidate) => separate(anchor, candidate, placed));
    const chosen =
      separated.find(
        (box) => insideViewport(box, viewport) && !placed.some((other) => overlaps(box, other)),
      ) ?? separated[0];
    if (chosen === undefined) continue;
    placed.push(chosen);
    placements.push({ id: anchor.id, box: chosen, anchorX: anchor.x, anchorY: anchor.y });
  }
  return placements;
}
