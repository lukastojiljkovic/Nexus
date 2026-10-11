/**
 * Where a part sits, where its pins are, and what a wire between two of them
 * looks like — the whole of the workbench's arithmetic, with no React in it.
 *
 * **It is here rather than in `@nexus/core` because it is a DRAWING decision,
 * not a fact about the hardware.** How wide a DHT22 is drawn, which side its
 * pins come out of, how far a jumper bows — none of that is in a datasheet and
 * none of it belongs in a catalogue two other surfaces (the rules engine, the
 * sketch generator) read. What core owns is `ComponentDef`; what this owns is
 * one way of putting it on a screen.
 *
 * **The stored coordinate is the part's TOP-LEFT, unrotated.** Rotation is
 * applied about that origin and shifted back into the positive quadrant, so a
 * part's `x`/`y` mean the same thing at every angle and a rotate never moves
 * the part. `ROTATION_SHIFT` below is the single table both the pin arithmetic
 * and the SVG transform are derived from — they cannot disagree, which matters
 * because a wire drawn to a pin the eye sees somewhere else is the one bug on
 * this surface a user could not diagnose.
 */

import type { ComponentDef, PartRotation, Pin } from "@nexus/core";

/**
 * The workbench grid, in circuit units.
 *
 * Ten rather than the 2.54 mm (0.1") of a real header, because a circuit unit
 * is not a millimetre and pretending otherwise would invite the next reader to
 * compute a physical size from it. What it IS: the step a dragged part snaps
 * to, and the divisor every part's own box is rounded up to, so two parts
 * placed by hand line up without anybody aligning them.
 */
export const ELEC_GRID = 10;

/** Distance between two pins along one edge. */
export const PIN_PITCH = 24;

/** How far a pin's pad sticks out past the body — the „leg". */
export const PIN_LEG = 8;

/** The smallest a part may be drawn, whatever its pin count says. */
const PART_MIN_WIDTH = 96;
const PART_MIN_HEIGHT = 56;

/**
 * Body edge to the start of a pin's label, and the clear space between the two
 * label columns.
 *
 * `PIN_LABEL_INSET` is exported because the bench draws the label at it while
 * `partSize` reserves room for it: two numbers that have to be the same number,
 * and a hand-typed copy on the drawing side would silently print every label
 * either overlapping the body or floating away from it.
 */
export const PIN_LABEL_INSET = 9;
const PIN_LABEL_CHAR = 6;
const PART_CENTRE_GAP = 18;

/** A part's drawn box, in circuit units, at rotation 0. */
export interface PartSize {
  readonly width: number;
  readonly height: number;
}

/** A point in circuit units. */
export interface ElecPoint {
  readonly x: number;
  readonly y: number;
}

/** One pin, placed: which edge it leaves by, and where it is in the part's own frame. */
export interface PlacedPin extends ElecPoint {
  readonly pin: Pin;
  readonly side: "left" | "right";
}

/** The nearest grid intersection — what a dragged part lands on. */
export function snapToGrid(value: number): number {
  return Math.round(value / ELEC_GRID) * ELEC_GRID;
}

/** Rounds a measurement UP to the grid, so a part's own box never lands off it. */
function ceilToGrid(value: number): number {
  return Math.ceil(value / ELEC_GRID) * ELEC_GRID;
}

/**
 * How the pins divide between the two edges.
 *
 * The DIP convention, because it is the one every part in this catalogue is
 * actually printed with: pin 1 at the top left, down the left edge, and the
 * numbering comes back UP the right one. So the left column takes the first
 * half in order and the right column takes the rest in REVERSE — which is why
 * this is a function and not a `slice`.
 */
export function pinSides(component: ComponentDef): {
  readonly left: readonly Pin[];
  readonly right: readonly Pin[];
} {
  const perSide = Math.ceil(component.pins.length / 2);
  return {
    left: component.pins.slice(0, perSide),
    right: component.pins.slice(perSide),
  };
}

/**
 * A part's box at rotation 0.
 *
 * The height is the pin column; the width is whatever the two label columns
 * need, so a board whose pins are called „A0" and one whose pins are called
 * „MOSI" are each drawn wide enough to read rather than both drawn at some
 * average. Both are rounded up to the grid.
 */
export function partSize(component: ComponentDef): PartSize {
  const { left, right } = pinSides(component);
  const rows = Math.max(left.length, right.length);
  const span = Math.max(0, rows - 1) * PIN_PITCH;

  const widest = (pins: readonly Pin[]): number =>
    pins.reduce((max, pin) => Math.max(max, pin.label.length), 0);
  const labels = (widest(left) + widest(right)) * PIN_LABEL_CHAR;

  return {
    width: ceilToGrid(Math.max(PART_MIN_WIDTH, PIN_LABEL_INSET * 2 + labels + PART_CENTRE_GAP)),
    height: ceilToGrid(Math.max(PART_MIN_HEIGHT, PIN_PITCH + span)),
  };
}

/**
 * The box a part is drawn in when this build ships no component with its id.
 *
 * A fixed size, because there is nothing to derive one from: the pins, the
 * labels and the name are exactly what is missing. Big enough to carry the
 * placeholder's own sentence, and no bigger — a mystery part must not dominate
 * the bench it is standing on.
 */
export const UNKNOWN_PART_SIZE: PartSize = { width: 140, height: 60 };

/**
 * A placed part's box, whether or not its component resolved.
 *
 * One function rather than a conditional at each of the four call sites (the
 * drawing, the pin arithmetic, the fit, the drag), because a placeholder drawn
 * at one size and measured at another is a part you cannot pick up.
 */
export function sizeOf(component: ComponentDef | undefined): PartSize {
  return component === undefined ? UNKNOWN_PART_SIZE : partSize(component);
}

/**
 * Every pin of a component, placed in the part's own frame.
 *
 * Both columns are CENTRED against the box rather than hung from its top,
 * because the box was rounded up to the grid and a column pinned to the top
 * edge would leave the slack at the bottom — visibly lopsided on exactly the
 * parts whose pin count is odd.
 */
export function pinLayout(component: ComponentDef): readonly PlacedPin[] {
  const size = partSize(component);
  const { left, right } = pinSides(component);
  const rows = Math.max(left.length, right.length);
  const top = (size.height - Math.max(0, rows - 1) * PIN_PITCH) / 2;

  const placed: PlacedPin[] = [];
  left.forEach((pin, index) => {
    placed.push({ pin, side: "left", x: 0, y: top + index * PIN_PITCH });
  });
  // Bottom-up, counted against the COLUMN and not against the right list: on
  // an odd pin count the right side is one short, and measuring from its own
  // length would hang it from the top — the pin the silkscreen puts at the
  // bottom right would be drawn opposite pin 1.
  right.forEach((pin, index) => {
    placed.push({
      pin,
      side: "right",
      x: size.width,
      y: top + (rows - 1 - index) * PIN_PITCH,
    });
  });
  return placed;
}

/** One pin's place in the part's own frame, or `undefined` for a pin the component does not have. */
export function pinLocal(component: ComponentDef, pinId: string): PlacedPin | undefined {
  return pinLayout(component).find((placed) => placed.pin.id === pinId);
}

/**
 * The one table the whole rotation story is derived from.
 *
 * A quarter turn about the origin sends a point out of the positive quadrant,
 * so each angle needs a shift to bring the box back. Both the arithmetic
 * (`rotateInBox`) and the SVG transform (`partTransform`) read THIS, rather
 * than each carrying its own reading of the same geometry — a pin whose drawn
 * position and whose computed position disagree would draw every wire to the
 * wrong place, and the two would look individually correct.
 */
const ROTATION_SHIFT: Record<PartRotation, (size: PartSize) => ElecPoint> = {
  0: () => ({ x: 0, y: 0 }),
  90: (size) => ({ x: size.height, y: 0 }),
  180: (size) => ({ x: size.width, y: size.height }),
  270: (size) => ({ x: 0, y: size.width }),
};

/**
 * A quarter turn about the origin, in SVG's coordinate sense (y downwards).
 *
 * Every arm negates a coordinate, and IEEE-754 answers `-0` for `-0` — a value
 * that is not `Object.is`-equal to zero, prints as „-0.00" inside a path, and
 * would make two identical directions compare unequal. `nz` is where that is
 * settled, once, rather than at each of the four call sites downstream.
 */
function nz(value: number): number {
  return value === 0 ? 0 : value;
}

function turn(point: ElecPoint, rotation: PartRotation): ElecPoint {
  switch (rotation) {
    case 0:
      return point;
    case 90:
      return { x: nz(-point.y), y: point.x };
    case 180:
      return { x: nz(-point.x), y: nz(-point.y) };
    case 270:
      return { x: point.y, y: nz(-point.x) };
  }
}

/** A point in the part's own frame, rotated and brought back into the box. */
export function rotateInBox(point: ElecPoint, size: PartSize, rotation: PartRotation): ElecPoint {
  const turned = turn(point, rotation);
  const shift = ROTATION_SHIFT[rotation](size);
  return { x: turned.x + shift.x, y: turned.y + shift.y };
}

/** The box a rotated part actually occupies — the quarter turns swap the axes. */
export function rotatedSize(size: PartSize, rotation: PartRotation): PartSize {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : size;
}

/**
 * The `transform` the part's SVG group wears. Derived from `ROTATION_SHIFT`,
 * which is what makes it the same geometry `rotateInBox` computes rather than a
 * second opinion about it.
 */
export function partTransform(origin: ElecPoint, size: PartSize, rotation: PartRotation): string {
  const shift = ROTATION_SHIFT[rotation](size);
  return `translate(${origin.x + shift.x} ${origin.y + shift.y}) rotate(${rotation})`;
}

/** Which way a pin's leg points once the part is turned — a unit vector. */
export function pinDirection(side: "left" | "right", rotation: PartRotation): ElecPoint {
  return turn(side === "left" ? { x: -1, y: 0 } : { x: 1, y: 0 }, rotation);
}

/** Where a pin is on the workbench, given the part's stored position. */
export function pinPoint(
  origin: ElecPoint,
  component: ComponentDef,
  pinId: string,
  rotation: PartRotation,
): ElecPoint | undefined {
  const placed = pinLocal(component, pinId);
  if (placed === undefined) return undefined;
  const local = rotateInBox({ x: placed.x, y: placed.y }, partSize(component), rotation);
  return { x: origin.x + local.x, y: origin.y + local.y };
}

/** One end of a wire, as the path needs it: where it starts and which way it leaves. */
export interface WireAnchor extends ElecPoint {
  readonly out: ElecPoint;
}

const WIRE_REACH_MIN = 26;
const WIRE_REACH_MAX = 140;
const WIRE_SAG_MAX = 26;

/**
 * How a jumper bows between the two pins it connects.
 *
 * A cubic whose control points leave each pin ALONG ITS OWN LEG, so a wire
 * never grows out of the side of a part it is not connected to — and with a sag
 * proportional to the run, because a jumper wire on a desk hangs. Straight
 * segments were the first draft and read as a schematic; the founder asked for
 * „što realističnije", and a bench is the thing being drawn.
 */
export function wireControls(from: WireAnchor, to: WireAnchor): readonly [ElecPoint, ElecPoint] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const reach = Math.min(WIRE_REACH_MAX, Math.max(WIRE_REACH_MIN, distance * 0.35));
  const sag = Math.min(WIRE_SAG_MAX, distance * 0.1);

  // Both control points come back rather than being inlined into the path:
  // `wireFocusBox` needs the same curve, and a second derivation of the reach
  // and the sag would be a focus ring that visibly does not fit its wire.
  return [
    { x: from.x + from.out.x * reach, y: from.y + from.out.y * reach + sag },
    { x: to.x + to.out.x * reach, y: to.y + to.out.y * reach + sag },
  ];
}

/** A jumper between two pins, as the path the bench draws. */
export function wirePath(from: WireAnchor, to: WireAnchor): string {
  const [c1, c2] = wireControls(from, to);
  const n = (value: number): string => value.toFixed(2);
  return `M ${n(from.x)} ${n(from.y)} C ${n(c1.x)} ${n(c1.y)}, ${n(c2.x)} ${n(c2.y)}, ${n(to.x)} ${n(to.y)}`;
}

/** The rectangle everything on the circuit occupies, or nothing at all for an empty one. */
export interface ElecBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** How far a wire's focus ring stands off the wire, from the wire's own centre line. */
const WIRE_FOCUS_OFFSET = 5;
/**
 * The smallest side a focus ring may have, whatever the wire inside it measures.
 * One pin pitch, which is the floor this bench already builds everything to: a
 * pin's own hit disc is exactly this across, and it is the size below which the
 * ring reads as two parallel lines rather than as a box around a wire.
 */
const WIRE_FOCUS_MIN = PIN_PITCH;

/**
 * The extreme values of one axis of a cubic, over the whole segment.
 *
 * The curve leaves the box its two ends span only where its derivative crosses
 * zero, so the extremes are at the ends and at whatever roots of `B'(t)` land
 * inside the segment. Taking the four control points instead is three lines
 * shorter and up to one control arm wrong, and the caller draws a box around
 * this, so wrong means a focus ring visibly failing to contain the wire it is
 * around.
 */
function curveSpan(p0: number, p1: number, p2: number, p3: number): { min: number; max: number } {
  const at = (t: number): number => {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  };
  let min = Math.min(p0, p3);
  let max = Math.max(p0, p3);
  const include = (t: number): void => {
    if (t <= 0 || t >= 1) return;
    const value = at(t);
    min = Math.min(min, value);
    max = Math.max(max, value);
  };

  // B'(t)/3 is the quadratic below, so the extremes are its roots.
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (a === 0) {
    if (b !== 0) include(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      include((-b + root) / (2 * a));
      include((-b - root) / (2 * a));
    }
  }
  return { min, max };
}

/**
 * The box a wire's focus ring is drawn on: the whole curve, opened out by
 * `WIRE_FOCUS_OFFSET` on every side and centred on what it surrounds.
 *
 * **A ring AROUND the wire, not a stroke along it.** The wire is already one of
 * nine colours, and this is the one mark on the bench whose job is to be seen
 * whatever is under it; a ring drawn on the wire would have to be told apart
 * from the wire, and gold over a yellow jumper is not a ring. Standing the box
 * off the curve puts the ring in the canvas on either side of the wire, at
 * `WIRE_FOCUS_OFFSET` from the centre line, so the wire's own 3-unit stroke
 * (half of it on each side) still leaves a visible gap, and that is the same
 * mark on the yellow, the white and the black.
 *
 * **Nothing reads this but a keyboard.** The box is the target of the group's
 * roving tab stop and of nothing else; a pointer never resolves it, and the hit
 * path a click lands on is unchanged (`ElecBench.tsx`).
 */
export function wireFocusBox(from: WireAnchor, to: WireAnchor): ElecBounds {
  const [c1, c2] = wireControls(from, to);
  const x = curveSpan(from.x, c1.x, c2.x, to.x);
  const y = curveSpan(from.y, c1.y, c2.y, to.y);
  const width = Math.max(WIRE_FOCUS_MIN, x.max - x.min + WIRE_FOCUS_OFFSET * 2);
  const height = Math.max(WIRE_FOCUS_MIN, y.max - y.min + WIRE_FOCUS_OFFSET * 2);
  const centre = { x: (x.min + x.max) / 2, y: (y.min + y.max) / 2 };

  // The floor is applied about the CURVE's own centre, so a short jumper's ring
  // grows outwards on all four sides instead of drifting off the wire it rings.
  return {
    minX: centre.x - width / 2,
    minY: centre.y - height / 2,
    maxX: centre.x + width / 2,
    maxY: centre.y + height / 2,
  };
}

/** What the view is looking at: a translation in screen pixels and a scale. */
export interface ElecView {
  readonly tx: number;
  readonly ty: number;
  readonly scale: number;
}

export const ELEC_MIN_SCALE = 0.2;
export const ELEC_MAX_SCALE = 3;

/** Never zoom PAST this when fitting — three parts on an empty bench at 3× is a magnifying glass, not a fit. */
const FIT_MAX_SCALE = 1.2;
const FIT_PADDING = 56;

/**
 * The box every placed part covers.
 *
 * A part whose component this build does not ship still counts, at the
 * placeholder's own size: leaving it out would let „prilagodi prikaz" frame a
 * circuit that visibly has something outside the frame.
 */
export function contentBounds(
  parts: readonly { x: number; y: number; rotation: PartRotation }[],
  sizeOf: (index: number) => PartSize,
): ElecBounds | null {
  if (parts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  parts.forEach((part, index) => {
    // Padded on all FOUR sides rather than only left and right: a part at 90°
    // has its legs on the top and bottom edges, and a box that assumed
    // otherwise would frame a circuit with pins visibly outside the frame.
    const size = rotatedSize(sizeOf(index), part.rotation);
    minX = Math.min(minX, part.x - PIN_LEG);
    minY = Math.min(minY, part.y - PIN_LEG);
    maxX = Math.max(maxX, part.x + size.width + PIN_LEG);
    maxY = Math.max(maxY, part.y + size.height + PIN_LEG);
  });
  return { minX, minY, maxX, maxY };
}

/** Clamps a scale to what the bench allows — one place, so the wheel and the buttons agree. */
export function clampScale(scale: number): number {
  return Math.min(ELEC_MAX_SCALE, Math.max(ELEC_MIN_SCALE, scale));
}

/**
 * The view that puts `bounds` in the middle of a `width`×`height` viewport.
 *
 * A viewport with no area yet — the first render, before layout — answers the
 * identity view rather than a division by zero.
 */
export function fitView(
  bounds: ElecBounds | null,
  viewport: { width: number; height: number },
): ElecView {
  if (bounds === null || viewport.width <= 0 || viewport.height <= 0) {
    return { tx: 0, ty: 0, scale: 1 };
  }
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(
    FIT_MAX_SCALE,
    clampScale(
      Math.min(
        (viewport.width - FIT_PADDING * 2) / width,
        (viewport.height - FIT_PADDING * 2) / height,
      ),
    ),
  );
  return {
    tx: viewport.width / 2 - (bounds.minX + width / 2) * scale,
    ty: viewport.height / 2 - (bounds.minY + height / 2) * scale,
    scale,
  };
}

/** A pointer position on the surface, in circuit units. */
export function toCircuitPoint(screen: ElecPoint, view: ElecView): ElecPoint {
  return { x: (screen.x - view.tx) / view.scale, y: (screen.y - view.ty) / view.scale };
}

/**
 * Zooms about a fixed screen point — the pointer under the wheel, or the middle
 * of the viewport for a button. The point stays where it is; everything else
 * moves around it, which is the only zoom that does not feel like the drawing
 * is running away.
 */
export function zoomAbout(view: ElecView, screen: ElecPoint, factor: number): ElecView {
  const scale = clampScale(view.scale * factor);
  const world = toCircuitPoint(screen, view);
  return { tx: screen.x - world.x * scale, ty: screen.y - world.y * scale, scale };
}

/** The middle of the visible bench, in circuit units — where a part the user picked lands. */
export function viewCentre(view: ElecView, viewport: { width: number; height: number }): ElecPoint {
  const centre = toCircuitPoint({ x: viewport.width / 2, y: viewport.height / 2 }, view);
  return { x: snapToGrid(centre.x), y: snapToGrid(centre.y) };
}

/** How far a part steps down and right when the spot it wanted is already taken. */
const DROP_STEP = ELEC_GRID * 2;

/**
 * Where a newly picked part actually lands: the middle of the view, stepped
 * clear of anything already sitting there.
 *
 * Without the step, picking five parts in a row puts five parts on exactly the
 * same coordinates — the user sees ONE part and a palette that appears not to
 * work, and only discovers the other four by dragging the top one away.
 *
 * Occupancy is exact equality rather than an overlap test, and that is enough:
 * every origin on this surface is snapped to the grid, so „the same place" is
 * the same pair of numbers. The loop cannot run away — each step visits a
 * distinct point, so among `taken.length + 1` candidates at least one is free.
 */
export function dropSpot(centre: ElecPoint, taken: readonly ElecPoint[]): ElecPoint {
  const occupied = new Set(taken.map((point) => `${point.x},${point.y}`));
  let spot = { x: snapToGrid(centre.x), y: snapToGrid(centre.y) };
  for (let step = 0; step <= taken.length; step += 1) {
    if (!occupied.has(`${spot.x},${spot.y}`)) return spot;
    spot = { x: spot.x + DROP_STEP, y: spot.y + DROP_STEP };
  }
  return spot;
}
