import { useCallback, useEffect, useState } from "react";

import { ACCENT_IDS, type AccentId, type ThemeName } from "@nexus/tokens";
import { boardPalette, type BoardPalette } from "./palette.js";

/**
 * The canvas half of the page (ADR-090): how big a cell may be, how a drawing
 * surface is sized for the display it is on, and which palette is current.
 *
 * **The board is drawn at the device pixel ratio, and the ratio is capped.** A
 * canvas whose backing store is its CSS size is a canvas the compositor scales,
 * which is the blurry board this rule exists to prevent; three times the CSS size
 * is the cap, because a 4K display at 200 % scaling would otherwise ask a small
 * game for nine times the pixels it can show, on the machine least able to spare
 * them.
 *
 * **A board is sized to FIT, not to fill.** `cellSizeFor` answers the largest
 * whole-pixel cell that keeps every row and column inside the box the page gives
 * it, so the same code draws a 9 x 9 beginner board and a 30 x 24 custom one
 * without a scrollbar - the minimum window is 900 x 600 and a board that could
 * not fit in it would be a board a player cannot see.
 *
 * **The palette is watched, not captured.** The theme and the accent live on
 * `<html>` as `data-theme` and `data-accent`, and both can change while a game is
 * on screen; a `MutationObserver` on those two attributes is what makes the board
 * follow, rather than a repaint that happens to be triggered by another render.
 */

/** How the page hands a board its box: the widest and tallest it may be, in CSS pixels. */
export interface BoardBox {
  readonly maxWidth: number;
  readonly maxHeight: number;
  /** The largest cell worth drawing: past this a small board looks like a chart, not a board. */
  readonly maxCell?: number;
  /** The smallest cell the page will draw; a guard against a board shrinking to a smear, not a knob the page turns. */
  readonly minCell?: number;
}

/**
 * The side of one cell, in whole CSS pixels.
 *
 * Whole pixels matter at every scale: a 21.7 px cell means each row is offset by
 * a fraction of a pixel, and a board of 22 rows ends 15 px shorter than its own
 * height, which reads as a rendering fault.
 */
export function cellSizeFor(columns: number, rows: number, box: BoardBox): number {
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new RangeError(`cellSizeFor: a board needs whole positive columns and rows, got ${columns}x${rows}`);
  }
  const maxCell = box.maxCell ?? 44;
  const minCell = box.minCell ?? 6;
  const fit = Math.min(Math.floor(box.maxWidth / columns), Math.floor(box.maxHeight / rows));
  return Math.max(minCell, Math.min(maxCell, fit));
}

/** The drawing area one board occupies at `cell` per cell. */
export function boardPixels(columns: number, rows: number, cell: number): { width: number; height: number } {
  return { width: columns * cell, height: rows * cell };
}

/**
 * The scale a canvas's backing store is drawn at.
 *
 * A display reporting a ratio below one (a scaled-down projector, a browser at
 * 80 %) is drawn at one: a backing store SMALLER than the CSS box is a board that
 * loses pixels it was asked for.
 */
export function backingScale(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 1) return 1;
  return Math.min(3, devicePixelRatio);
}

/**
 * Sizes a canvas for the display and hands back a context already scaled to CSS
 * pixels, or `null` when there is no canvas yet.
 *
 * The transform is the whole trick: with it set, every coordinate below is in CSS
 * pixels and the extra device pixels are the compositor's business - so no
 * drawing code multiplies by a ratio, and a board drawn on a 150 % display is the
 * same board.
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement | null,
  cssWidth: number,
  cssHeight: number,
): CanvasRenderingContext2D | null {
  if (canvas === null) return null;
  const scale = backingScale(window.devicePixelRatio);
  const width = Math.round(cssWidth * scale);
  const height = Math.round(cssHeight * scale);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return ctx;
}

/** The theme currently painted on `<html>`, defaulting to the product's identity theme. */
export function activeThemeName(): ThemeName {
  return document.documentElement.dataset["theme"] === "dan" ? "dan" : "noc";
}

/** The accent currently painted on `<html>`, defaulting to the palette's first. */
export function activeAccentId(): AccentId {
  const painted = document.documentElement.dataset["accent"];
  return (ACCENT_IDS as readonly string[]).includes(painted ?? "")
    ? (painted as AccentId)
    : (ACCENT_IDS[0] as AccentId);
}

/**
 * The palette the board should be painted with, re-read when the theme or the
 * accent changes.
 *
 * The observer watches two attributes of one element, so the cost is a callback
 * on a settings change rather than work per frame.
 */
export function useBoardPalette(): BoardPalette {
  const [palette, setPalette] = useState(() => boardPalette(activeThemeName(), activeAccentId()));

  const sync = useCallback(() => {
    setPalette(boardPalette(activeThemeName(), activeAccentId()));
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent"],
    });
    return () => observer.disconnect();
  }, [sync]);

  return palette;
}
