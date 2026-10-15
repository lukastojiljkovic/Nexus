import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import { positionCanvasSketch } from "@nexus/core";
import type { CanvasSketch } from "@nexus/core";
import { CANVAS_INK, canvasSwatchColour } from "./canvasPalette.js";

/**
 * A sketch the assistant described, as Excalidraw skeletons the page converts
 * with `convertToExcalidrawElements` and adds to the open board.
 *
 * Pure: the layout comes from core, the colours from the palette, and the
 * placement is arithmetic over the elements already on the board. The editor is
 * touched only by the page, so everything here runs under a plain test.
 */

/** The gap left between what is on the board and a sketch placed beside it. A layout choice, not a measurement. */
const GAP_BESIDE_CONTENT = 120;

/** The room a title takes above the diagram. */
const TITLE_BAND = 60;

/**
 * The top-left corner a sketch starts at: to the right of every live element and
 * level with the highest of them, or the origin on an empty board. Deleted
 * elements are not content, so they do not push a sketch away.
 */
export function freeSpaceOrigin(
  elements: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly isDeleted: boolean }[],
): { x: number; y: number } {
  const live = elements.filter((element) => !element.isDeleted);
  if (live.length === 0) return { x: 0, y: 0 };
  return {
    x: Math.max(...live.map((element) => element.x + element.width)) + GAP_BESIDE_CONTENT,
    y: Math.min(...live.map((element) => element.y)),
  };
}

/**
 * The skeletons for one sketch, placed at `origin`.
 *
 * Box ids and arrow ids carry a prefix, so a box the model named „arrow:0" can
 * never collide with an arrow. An arrow is bound to a box only where the box is a
 * shape Excalidraw can bind to: a bare `text` box is a label, and an arrow to it
 * is drawn to its position without a binding.
 */
export function sketchSkeleton(sketch: CanvasSketch, origin: { readonly x: number; readonly y: number }): ExcalidrawElementSkeleton[] {
  const drawn = positionCanvasSketch(sketch);
  const top = origin.y + (drawn.title === undefined ? 0 : TITLE_BAND);
  const elements: ExcalidrawElementSkeleton[] = [];
  if (drawn.title !== undefined) {
    elements.push({ type: "text", x: origin.x, y: origin.y, text: drawn.title, fontSize: 28 });
  }

  const bindable = new Set<string>();
  for (const box of drawn.boxes) {
    const x = origin.x + box.x;
    const y = top + box.y;
    const strokeColor = box.tone === undefined ? CANVAS_INK : canvasSwatchColour(box.tone);
    if (box.shape === "text") {
      elements.push({ type: "text", id: `box:${box.id}`, x, y, text: box.label, strokeColor });
      continue;
    }
    bindable.add(box.id);
    elements.push({
      type: box.shape === "rect" ? "rectangle" : box.shape,
      id: `box:${box.id}`,
      x,
      y,
      width: box.width,
      height: box.height,
      strokeColor,
      backgroundColor: "transparent",
      label: { text: box.label },
    });
  }

  drawn.arrows.forEach((arrow, k) => {
    const start = { x: origin.x + arrow.start.x, y: top + arrow.start.y };
    const end = { x: origin.x + arrow.end.x, y: top + arrow.end.y };
    elements.push({
      type: "arrow",
      id: `arrow:${k}`,
      x: start.x,
      y: start.y,
      points: [
        [0, 0],
        [end.x - start.x, end.y - start.y],
      ],
      ...(bindable.has(arrow.from) ? { start: { id: `box:${arrow.from}` } } : {}),
      ...(bindable.has(arrow.to) ? { end: { id: `box:${arrow.to}` } } : {}),
      ...(arrow.label === undefined ? {} : { label: { text: arrow.label } }),
    });
  });
  return elements;
}
