import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Button } from "@nexus/ui";
import { prepareCanvas, useBoardPalette } from "./canvas.js";
import { copy } from "./copy.js";
import type { BoardPalette } from "./palette.js";

/**
 * The three pieces five games share (ADR-090): the canvas a board is painted on,
 * the veil a paused game wears, and the line that reports what is going on.
 *
 * **Why one canvas component rather than five.** Every board sizes itself the
 * same way (the CSS box, the device pixel ratio, one transform) and repaints at
 * the same moment (after the commit that changed its state, because a canvas has
 * no reconciliation of its own). Five copies of that would be five places for the
 * ratio to be forgotten - and `prepareCanvas` is the only place it is written.
 *
 * **Why the status line is DOM and not painted on the canvas.** Score, time and
 * the game's own state are text, and text belongs where a reader can select it, a
 * screen reader can announce it and the interface can style it: the canvas is the
 * BOARD, and `aria-live` on the line beside it is what makes a score change
 * audible without anybody looking at a picture.
 */

export interface BoardProps {
  /** The drawing area in CSS pixels, which is what `cellSizeFor` answered. */
  readonly width: number;
  readonly height: number;
  /** What the board is, for a reader who cannot see it. */
  readonly label: string;
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly onPaint: (ctx: CanvasRenderingContext2D, palette: BoardPalette) => void;
  readonly onKeyDown?: ((event: KeyboardEvent<HTMLCanvasElement>) => void) | undefined;
  readonly onPointerDown?: ((event: PointerEvent<HTMLCanvasElement>) => void) | undefined;
  readonly onPointerMove?: ((event: PointerEvent<HTMLCanvasElement>) => void) | undefined;
}

/**
 * One board: a focusable canvas that repaints itself after every commit.
 *
 * `role="img"` rather than an interactive role, and that is the honest one: the
 * board is a picture of a value - every fact it shows is also in the status line
 * and in the copy under it - and the KEYS are what makes it playable, not a
 * widget's own affordances. The canvas is focusable so the page can hand it focus
 * when a game starts or resumes.
 */
export function Board({
  width,
  height,
  label,
  canvasRef,
  onPaint,
  onKeyDown,
  onPointerDown,
  onPointerMove,
}: BoardProps) {
  const palette = useBoardPalette();

  // No dependency list, deliberately: the effect runs after every commit, and a
  // commit is exactly the moment the thing on the canvas changed. A canvas has no
  // other way to know.
  useEffect(() => {
    const ctx = prepareCanvas(canvasRef.current, width, height);
    if (ctx !== null) onPaint(ctx, palette);
  });

  return (
    <canvas
      ref={canvasRef}
      // The attributes are the initial size and the fallback React restores; the
      // device ratio is applied by `prepareCanvas` on every commit.
      width={width}
      height={height}
      tabIndex={0}
      role="img"
      aria-label={label}
      className="arcade__canvas"
      style={{ width: `${width}px`, height: `${height}px` }}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}

/**
 * What covers a board when the game is not running: the paused blur, and the
 * end of a game.
 *
 * It covers the board rather than hiding it, because the state a player left is
 * the state they come back to - and the button is a real button, so the way back
 * (or the way into a new game) is reachable by keyboard and by pointer alike.
 */
export function Veil({
  title,
  hint,
  action,
  onSurfaceClick,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly action: ReactNode;
  /**
   * What a click anywhere on the veil does, for the one veil where that gesture
   * is obvious. The action's own button stays the accessible control; this is
   * the pointer convenience a player reaches for first, and a veil handed no
   * handler is simply not clickable.
   */
  readonly onSurfaceClick?: (() => void) | undefined;
}) {
  return (
    <div className="arcade__veil" onClick={onSurfaceClick}>
      <p className="arcade__veil-title">{title}</p>
      {hint !== undefined && <p className="nx-hint">{hint}</p>}
      {action}
    </div>
  );
}

/**
 * A paused game: the one veil every game wears, with the one control that starts
 * it again. Any key also resumes (the games listen for it), which is what a
 * player will try first - and the button is there for the pointer and for anybody
 * who would rather not guess.
 */
export function PauseVeil({ onResume }: { readonly onResume: () => void }) {
  return (
    <Veil
      title={copy.status.paused}
      hint={copy.status.pausedHint}
      onSurfaceClick={onResume}
      action={
        <Button size="sm" variant="primary" onClick={onResume}>
          {copy.actions.resume}
        </Button>
      }
    />
  );
}

/**
 * The board's own frame: the canvas and the veil share one positioned box, which
 * is what lets the veil cover exactly the board rather than the whole page.
 */
export function BoardSlot({ children }: { readonly children: ReactNode }) {
  return <div className="arcade__board-slot">{children}</div>;
}

/** A `useRef` for a canvas, typed so `prepareCanvas` can take it directly. */
export function useCanvasRef(): React.RefObject<HTMLCanvasElement | null> {
  return useRef<HTMLCanvasElement | null>(null);
}
