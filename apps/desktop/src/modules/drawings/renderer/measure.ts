/**
 * DRAWINGS' measuring arithmetic, as pure functions.
 *
 * **Why the maths is here and not in the page.** Two of these functions turn a
 * pointer position into a point in the drawing's own coordinates, and a wrong
 * answer there is not a cosmetic bug: every distance and angle the page prints
 * is derived from it, so an error would be a measurement the user cannot tell
 * from a correct one. Physics-free arithmetic is the part of this module a test
 * can pin exactly, so it lives in a file with no DOM and no library in it.
 *
 * **The camera's numbers, not the library's.** `dxf-viewer` hands out its own
 * `THREE.OrthographicCamera`, and `viewOf` below reads the five numbers that
 * decide where a pixel lands. The library hard-disables orbiting
 * (`controls.enableRotate = false`), which is what makes a two-dimensional
 * projection exact here: the frustum is axis-aligned, zoom lives in the camera's
 * own `zoom` (its controls dolly by changing that and re-centring, exactly as
 * `SetView` writes the frustum), and panning moves the camera's position. All
 * three are accounted for, and the test drives them with measured numbers.
 */

/** A point, in whichever space the function says. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A camera's frustum, as `viewOf` reads it off the viewer. */
export interface OrthoView {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly zoom: number;
  /** The camera's position: the view's centre, in the scene's coordinates (the drawing's, minus its origin). */
  readonly centerX: number;
  readonly centerY: number;
}

/** What a pointer is measured against: the canvas' own box, in CSS pixels. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** The camera's frustum and centre, from the object the library hands out. */
export function viewOf(camera: {
  left: number;
  right: number;
  top: number;
  bottom: number;
  zoom: number;
  position: { x: number; y: number };
}): OrthoView {
  return {
    left: camera.left,
    right: camera.right,
    top: camera.top,
    bottom: camera.bottom,
    zoom: camera.zoom,
    centerX: camera.position.x,
    centerY: camera.position.y,
  };
}

/**
 * Where a pointer is, in the drawing's own coordinates.
 *
 * `pixel` is measured from the canvas' top-left corner, so the y axis flips on
 * the way in: a drawing's y grows upwards and a screen's grows down. `origin` is
 * the scene's own offset (`viewer.GetOrigin()`), which the library subtracts
 * when it builds the scene and which therefore has to be added back before the
 * number means anything in the file the user opened.
 */
export function drawingPointAt(
  pixel: Point,
  viewport: Viewport,
  view: OrthoView,
  origin: Point,
): Point {
  const ndcX = (pixel.x / viewport.width) * 2 - 1;
  const ndcY = 1 - (pixel.y / viewport.height) * 2;
  const width = view.right - view.left;
  const height = view.top - view.bottom;
  return {
    x: view.centerX + (ndcX * width) / (2 * view.zoom) + origin.x,
    y: view.centerY + (ndcY * height) / (2 * view.zoom) + origin.y,
  };
}

/** The straight-line distance between two points of the drawing, in the drawing's units. */
export function distance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** A vector's components, which is what a CAD read-out prints beside the distance. */
export function delta(from: Point, to: Point): Point {
  return { x: to.x - from.x, y: to.y - from.y };
}

/**
 * The direction from `from` to `to`, in degrees counter-clockwise from the +X
 * axis, in `0..360`.
 *
 * Counter-clockwise from +X is the convention every CAD drawing is annotated in,
 * so the number this returns is the one a user can compare with the dimension in
 * the file. `Math.atan2` gives `-180..180`, and `360` is added once rather than
 * taken modulo, so the single wrap is visible.
 */
export function angleDegrees(from: Point, to: Point): number {
  const degrees = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

/**
 * The view that shows a box, as `SetView` takes it.
 *
 * `SetView(center, width)` derives the visible height from the canvas' aspect
 * ratio, so a box that is TALLER than it is wide would be clipped: the width
 * asked for is therefore the wider of the box's own width and the width the box
 * needs to fit vertically. The small margin keeps the box's own edges off the
 * canvas' edge, where a line on the boundary is half a pixel of line.
 */
export function windowView(
  box: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number },
  aspect: number,
): { readonly center: Point; readonly width: number } {
  const boxWidth = Math.abs(box.maxX - box.minX);
  const boxHeight = Math.abs(box.maxY - box.minY);
  const needed = boxWidth === 0 && boxHeight === 0 ? 1 : Math.max(boxWidth, boxHeight * aspect);
  return {
    center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
    width: needed * 1.02,
  };
}
