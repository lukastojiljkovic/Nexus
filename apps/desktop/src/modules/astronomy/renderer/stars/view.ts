import { HORIZON_RADIUS, type PlanePoint } from "@nexus/core";

/**
 * The star map's view over the projection's plane: a scale, where the plane's
 * origin sits on the canvas, and the arithmetic that panning, zooming, the
 * search's "centre on this" and the drawing all go through.
 *
 * **Why this is not in the component.** The view is arithmetic with a handful
 * of decisions in it - how much of the canvas the horizon may claim, how far
 * panning may go, how big a star of a given magnitude is drawn - and none of
 * those decisions needs a canvas to be exercised. `StarMap.tsx` is left with
 * the DOM, the colours and the drawing, and this file with the numbers, which
 * is also the half a test can check.
 *
 * **The plane's own units, once more** (`@nexus/core`'s `starProjection.ts`):
 * the projection's centre is the origin, `+y` is toward the zenith and `+x` is
 * the way the view reads, and the horizon is the circle of radius
 * {@link HORIZON_RADIUS}. Pixels appear only in this file, and the canvas's own
 * y axis grows downward, so every conversion flips the sign of y exactly once.
 */

/** Where the plane sits on the canvas: pixels per plane unit, and the plane's origin in CSS pixels. */
export interface SkyView {
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
}

/** A canvas, in CSS pixels. */
export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/**
 * How much of the canvas's short side the horizon may claim at the closest
 * view. Not 1: a circle drawn exactly on the edge loses its cardinal points and
 * looks like a cropped photograph rather than a chart.
 */
const FIT = 0.92;

/** The closest zoom, as a multiple of the fitted scale. Twelve times puts a constellation across the window. */
export const MAX_ZOOM = 12;

/** The four steps a star's colour index is drawn in (see {@link tintFor}). */
export type StarTint = "hot" | "solar" | "warm" | "red";

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The widest view: the horizon circle inscribed in the canvas's short side, centred. */
export function fittedView(size: CanvasSize): SkyView {
  const shortSide = Math.min(size.width, size.height);
  return {
    scale: ((shortSide / 2) * FIT) / HORIZON_RADIUS,
    originX: size.width / 2,
    originY: size.height / 2,
  };
}

/** A plane point in canvas pixels. */
export function toPixel(view: SkyView, point: PlanePoint): { readonly x: number; readonly y: number } {
  return {
    x: view.originX + view.scale * point.x,
    y: view.originY - view.scale * point.y,
  };
}

/** A canvas pixel back in the plane's own units - what a drag or a hit test needs. */
export function fromPixel(view: SkyView, x: number, y: number): PlanePoint {
  return { x: (x - view.originX) / view.scale, y: -(y - view.originY) / view.scale };
}

/** The view after dragging it by a pixel offset. The plane moves with the pointer, so the offset is not flipped. */
export function panBy(view: SkyView, dx: number, dy: number): SkyView {
  return { ...view, originX: view.originX + dx, originY: view.originY + dy };
}

/**
 * The view after a zoom about a pixel on the canvas.
 *
 * **The point under the pointer does not move**, which is the whole of what
 * makes a wheel zoom feel like a map rather than like a redraw: the plane
 * coordinate under `at` is read before the scale changes and put back under it
 * afterwards. The scale is clamped to `[fitted, fitted * MAX_ZOOM]`, so the
 * horizon can never leave the picture and the view can never run away.
 */
export function zoomAt(
  view: SkyView,
  factor: number,
  size: CanvasSize,
  at: { readonly x: number; readonly y: number },
): SkyView {
  const fitted = fittedView(size).scale;
  const scale = clamp(view.scale * factor, fitted, fitted * MAX_ZOOM);
  const under = fromPixel(view, at.x, at.y);
  return { scale, originX: at.x - scale * under.x, originY: at.y + scale * under.y };
}

/**
 * The view after the search centres on a plane point.
 *
 * It is NOT clamped here, and panning is: a searched star is centred even if it
 * is below the horizon, where the clamp would refuse to go, and the user's own
 * drag is the gesture that should not be able to lose the sky.
 */
export function centredOn(view: SkyView, size: CanvasSize, point: PlanePoint): SkyView {
  return {
    ...view,
    originX: size.width / 2 - view.scale * point.x,
    originY: size.height / 2 + view.scale * point.y,
  };
}

/**
 * The view with the plane's origin held to within the horizon's own radius of
 * the canvas's centre.
 *
 * That is the bound at which the horizon circle still crosses the canvas
 * whichever way the user drags, so the sky is never lost off screen - and it
 * still lets every direction ABOVE the horizon be centred exactly, because
 * those are within one horizon radius of the zenith.
 */
export function clampView(view: SkyView, size: CanvasSize): SkyView {
  const limit = HORIZON_RADIUS * view.scale;
  return {
    ...view,
    originX: size.width / 2 + clamp(view.originX - size.width / 2, -limit, limit),
    originY: size.height / 2 + clamp(view.originY - size.height / 2, -limit, limit),
  };
}

/** The smallest a star is drawn, in CSS pixels: a magnitude-6 star is still a point of light. */
const STAR_RADIUS_MIN = 0.7;

/** The largest: a planet or Sirius should read as a disc without becoming a blob. */
const STAR_RADIUS_MAX = 4.5;

/** The radius a magnitude-0 star is drawn at, in CSS pixels. */
const STAR_RADIUS_AT_ZERO = 1.7;

/**
 * A star's drawn radius from its magnitude.
 *
 * Brightness is a flux, and radius is drawn from the SQUARE ROOT of it, so the
 * radius is `1.7 * 10^(-0.2 m)` pixels: two magnitudes (a factor of 6.3 in
 * flux) read as a factor of 2.5 in radius, which is what makes a chart's
 * bright stars look like the sky's rather than like a bar chart's. Clamped at
 * both ends, because a size is a legibility decision before it is a photometric
 * one.
 */
export function starRadius(magnitude: number): number {
  return clamp(STAR_RADIUS_AT_ZERO * Math.pow(10, -0.2 * magnitude), STAR_RADIUS_MIN, STAR_RADIUS_MAX);
}

/**
 * Which of the four tints a colour index is drawn in, or which a star without
 * one gets.
 *
 * **Why four steps and not a gradient.** The rule this app is built under bans
 * blue - and a star's colour is a temperature, so the honest blue-white end of
 * the ramp is not available. A four-step ramp from the theme's coolest neutral
 * to its strongest warm hue reads as a ramp in POSITION without pretending to
 * be the spectrum, and it is testable to the bucket. The three boundaries split
 * the 5,027 indices this catalogue measures - it is 5027, and not 5,080,
 * because 53 of the stars have no B-V in V/50 - into 2,074 cool, 928 solar,
 * 1,497 warm and 528 red, which `view.test.ts` counts for itself.
 */
export function tintFor(colourIndex: number | undefined): StarTint {
  if (colourIndex === undefined) return "solar";
  if (colourIndex < 0.3) return "hot";
  if (colourIndex < 0.9) return "solar";
  if (colourIndex < 1.5) return "warm";
  return "red";
}

/** Every star at or brighter than this is named when the view is fitted, and every one above when it is closest. */
const NAMED_AT_FIT = 2.5;
const NAMED_AT_MAX_ZOOM = 6;

/**
 * The magnitude up to which stars are labelled, for this view: 2.5 at the
 * fitted scale, every star in the catalogue at the closest zoom, and
 * interpolated between the two in the logarithm of the zoom - because that is
 * how a reader experiences a zoom, each step multiplying what is on screen
 * rather than adding to it.
 */
export function namedMagnitude(view: SkyView, size: CanvasSize): number {
  const fitted = fittedView(size).scale;
  const zoom = Math.max(1, view.scale / fitted);
  const fraction = Math.log(zoom) / Math.log(MAX_ZOOM);
  return NAMED_AT_FIT + fraction * (NAMED_AT_MAX_ZOOM - NAMED_AT_FIT);
}
