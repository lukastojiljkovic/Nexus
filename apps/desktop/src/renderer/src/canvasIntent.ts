import { parseCanvasRef, parseCanvasSketch } from "@nexus/core";
import type { CanvasRef, CanvasSketch } from "@nexus/core";

/**
 * What the Canvas page is asked to do by a location (`nexus:open-location`): open a
 * board, and, when the assistant asked for it, apply a sketch or place a card on
 * it. The page owns the scene, so these are applied here and never by main.
 */
export type CanvasIntent =
  | { readonly kind: "reveal"; readonly boardId: string }
  | { readonly kind: "sketch"; readonly boardId: string; readonly sketch: CanvasSketch }
  | { readonly kind: "card"; readonly boardId: string; readonly ref: CanvasRef };

/**
 * The intent a location asks of the Canvas page, or `null` when it names no
 * board.
 *
 * The payload is validated again here: a location travels through a window
 * event, so nothing between main and this page is a gate. A payload that does
 * not validate opens the board and asks for nothing else, rather than drawing a
 * half-understood sketch.
 */
export function canvasIntentOf(location: { readonly item?: unknown; readonly action?: unknown }): CanvasIntent | null {
  const boardId = typeof location.item === "string" && location.item !== "" ? location.item : null;
  if (boardId === null) return null;
  const action = location.action;
  if (typeof action !== "object" || action === null) return { kind: "reveal", boardId };
  const { name, payload } = action as { name?: unknown; payload?: unknown };
  if (name === "sketch") {
    const sketch = validOrNull(() => parseCanvasSketch(payload));
    return sketch === null ? { kind: "reveal", boardId } : { kind: "sketch", boardId, sketch };
  }
  if (name === "place-card") {
    const text = (payload as { ref?: unknown } | null | undefined)?.ref;
    const ref = typeof text === "string" ? parseCanvasRef(text) : null;
    return ref === null ? { kind: "reveal", boardId } : { kind: "card", boardId, ref };
  }
  return { kind: "reveal", boardId };
}

function validOrNull<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}
