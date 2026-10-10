import { useCallback, useEffect, useRef, useState } from "react";
import {
  BRICKS_BALL_RADIUS,
  BRICKS_BRICK_TOP,
  BRICKS_COLUMNS,
  BRICKS_PADDLE_HEIGHT,
  BRICKS_PADDLE_WIDTH,
  BRICKS_ROWS,
  BRICKS_TENTHS,
  BRICKS_TICK_MS,
  bricksRemaining,
  createBricks,
  stepBricks,
  type BricksState,
} from "@nexus/core";
import { Button, Chip } from "@nexus/ui";
import { boardPixels, cellSizeFor } from "../canvas.js";
import { copy } from "../copy.js";
import { formatCount } from "../format.js";
import { paddleFor } from "../input.js";
import { newSeed, planTicks, resumeAt, useFrameLoop, useWindowFocus } from "../loop.js";
import { paintFill, paintGrid, paintGround } from "../paint.js";
import type { BoardPalette } from "../palette.js";
import { Board, BoardSlot, PauseVeil, Veil, useCanvasRef } from "../parts.js";
import { aControlHasFocus, type BoardGameProps } from "./props.js";

/**
 * BRICKS on the page (ADR-090): the engine, the loop, and two ways to steer.
 *
 * **The paddle is steered by a direction, because that is what the engine
 * takes.** The keys are read as a set (both at once is no direction), and the
 * pointer is turned into the SAME direction: the page measures where the pointer
 * is and asks for left or right until the paddle is under it. Nothing here moves
 * the paddle itself - a page that did would be a second answer to "how fast does
 * a paddle move", and the engine's `BRICKS_PADDLE_SPEED` is the first.
 *
 * **A wall goes down and a new one is drawn**, so the field is a level rather
 * than a fixed course; the ball rides the paddle between levels and between
 * lives, and Space (or a click) launches it.
 */

const BOARD_BOX = { maxWidth: 560, maxHeight: 360, maxCell: 30 } as const;
const CELL = cellSizeFor(BRICKS_COLUMNS, BRICKS_ROWS, BOARD_BOX);
const BOARD = boardPixels(BRICKS_COLUMNS, BRICKS_ROWS, CELL);

/** One tenth of a cell, in pixels: the engine measures the field in tenths. */
const TENTH = CELL / BRICKS_TENTHS;

/** Where the pointer is asking the paddle to be, in tenths, or null when it has not asked. */
type PointerTarget = number | null;

export function BricksGame({ onFinish }: BoardGameProps) {
  const [state, setState] = useState<BricksState>(() => createBricks(newSeed(), performance.now()));
  const { paused, resume, resetPause } = useWindowFocus();
  const canvas = useCanvasRef();
  /** The state a frame reads and writes; see `Blocks.tsx` for why this is a ref rather than an updater. */
  const stateRef = useRef(state);
  const commit = useCallback((next: BricksState): void => {
    stateRef.current = next;
    setState(next);
  }, []);
  const keys = useRef(new Set<string>());
  const pointer = useRef<PointerTarget>(null);
  const launch = useRef(false);
  const reported = useRef(false);
  /** Whether the ball is riding the paddle, mirrored for the handlers: a launch only means something then. */
  const waiting = useRef(state.waiting);

  useEffect(() => {
    waiting.current = state.waiting;
    // A ball in flight has already been launched, so a flag that outlived its
    // tick goes with it rather than starting the next ball by itself.
    if (!state.waiting) launch.current = false;
  }, [state.waiting]);

  /**
   * One frame: a tick if the clock owes one, and the launch flag consumed only
   * when that tick happened.
   *
   * The order matters: the engine's `launch` is a per-tick instruction, so a
   * Space pressed between two ticks has to survive until the tick it belongs to.
   * A frame that is not due therefore hands the state back untouched and leaves
   * the flag standing - and the flag is read outside a state updater, because a
   * frame that consumed it twice would lose the second press.
   */
  const advance = useCallback((current: BricksState, now: number): BricksState => {
    if (current.over) return current;
    const due = planTicks(current.lastTickAt, now, BRICKS_TICK_MS, 1) > 0;
    if (!due) return current;
    const wanted = launch.current;
    launch.current = false;
    return stepBricks(
      current,
      { paddle: paddleDirection(keys.current, pointer.current, current), launch: wanted },
      now,
    );
  }, []);

  const frame = useCallback(
    (now: number) => {
      const next = advance(stateRef.current, now);
      if (next !== stateRef.current) commit(next);
    },
    [advance, commit],
  );
  useFrameLoop(frame, !paused && !state.over);

  const restart = useCallback(() => {
    keys.current.clear();
    pointer.current = null;
    launch.current = false;
    reported.current = false;
    resetPause();
    commit(createBricks(newSeed(), performance.now()));
  }, [resetPause, commit]);

  const resumeWithFocus = useCallback(() => {
    // The clock moves to now before the loop restarts: the frames the ball spent
    // behind a blurred window are dropped rather than replayed (see `resumeAt`).
    commit(resumeAt(stateRef.current, performance.now()));
    resume();
    canvas.current?.focus();
  }, [commit, resume, canvas]);

  useEffect(() => {
    canvas.current?.focus();
  }, [canvas]);

  useEffect(() => {
    if (!paused) return;
    keys.current.clear();
    pointer.current = null;
    launch.current = false;
  }, [paused]);

  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (paused) {
        resumeWithFocus();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (aControlHasFocus()) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (waiting.current) launch.current = true;
        return;
      }
      if (event.key.startsWith("Arrow") || event.key === "a" || event.key === "d") {
        event.preventDefault();
        keys.current.add(event.key);
      }
    };
    const up = (event: KeyboardEvent): void => {
      keys.current.delete(event.key);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [paused, resumeWithFocus]);

  useEffect(() => {
    if (!state.over || reported.current) return;
    reported.current = true;
    onFinish({ game: "bricks", score: state.score, levels: state.cleared });
  }, [state.over, state.score, state.cleared, onFinish]);

  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, palette: BoardPalette): void => {
      paintGround(ctx, palette, BOARD.width, BOARD.height);
      paintGrid(ctx, palette, BRICKS_COLUMNS, BRICKS_ROWS, CELL);
      for (let row = 0; row < state.brickRows; row += 1) {
        for (let column = 0; column < state.columns; column += 1) {
          if (state.bricks[row * state.columns + column] !== true) continue;
          // The wall is the thing to be dealt with, which is the data role.
          paintFill(ctx, palette.data, column, row + BRICKS_BRICK_TOP, CELL, 1);
        }
      }
      // The paddle and the ball are the player's own mark, in the accent role.
      ctx.fillStyle = palette.accent;
      ctx.fillRect(
        state.paddleLeft * TENTH,
        (state.rows * BRICKS_TENTHS - BRICKS_PADDLE_HEIGHT - 2 * BRICKS_TENTHS) * TENTH,
        BRICKS_PADDLE_WIDTH * TENTH,
        BRICKS_PADDLE_HEIGHT * TENTH,
      );
      ctx.beginPath();
      ctx.arc(state.ballX * TENTH, state.ballY * TENTH, BRICKS_BALL_RADIUS * TENTH, 0, Math.PI * 2);
      ctx.fillStyle = palette.accentStrong;
      ctx.fill();
    },
    [state],
  );

  return (
    <div className="arcade__game">
      <div className="arcade__status-row" role="status">
        <Chip variant="accent">
          {copy.status.score} {formatCount(state.score)}
        </Chip>
        <Chip>
          {copy.status.lives} {formatCount(state.lives)}
        </Chip>
        <Chip>
          {copy.status.cleared} {formatCount(state.cleared)}
        </Chip>
        <Chip>
          {copy.status.level} {formatCount(state.level)}
        </Chip>
        <Chip>
          {copy.status.remaining} {formatCount(bricksRemaining(state))}
        </Chip>
      </div>
      <div className="arcade__board-row">
        <BoardSlot>
          <Board
            width={BOARD.width}
            height={BOARD.height}
            label={`${copy.games.bricks} - ${copy.status.score} ${String(state.score)}`}
            canvasRef={canvas}
            onPaint={paint}
            onPointerDown={(event) => {
              pointer.current = pointerTenthsOf(event.currentTarget, event.clientX);
              if (waiting.current) launch.current = true;
            }}
            onPointerMove={(event) => {
              pointer.current = pointerTenthsOf(event.currentTarget, event.clientX);
            }}
          />
          {paused ? (
            <PauseVeil onResume={resumeWithFocus} />
          ) : (
            state.over && (
              <Veil
                title={copy.status.over}
                action={
                  <Button size="sm" variant="primary" onClick={restart}>
                    {copy.actions.newGame}
                  </Button>
                }
              />
            )
          )}
        </BoardSlot>
      </div>
      <div className="arcade__actions">
        <Button size="sm" onClick={restart}>
          {copy.actions.newGame}
        </Button>
      </div>
      <p className="nx-hint">{copy.keys.bricks}</p>
    </div>
  );
}

/**
 * The direction the paddle is being asked for, from the keys and the pointer.
 *
 * The keys win while they are held - a player with a hand on the board is
 * steering on purpose - and the pointer is a direction towards where it asks,
 * with a dead zone of two tenths so the paddle settles under it instead of
 * jittering.
 */
function paddleDirection(
  held: ReadonlySet<string>,
  target: PointerTarget,
  state: BricksState,
): -1 | 0 | 1 {
  const fromKeys = paddleFor(held);
  if (fromKeys !== 0 || target === null) return fromKeys;
  const centre = state.paddleLeft + BRICKS_PADDLE_WIDTH / 2;
  const difference = target - centre;
  if (Math.abs(difference) <= 2) return 0;
  return difference < 0 ? -1 : 1;
}

/** Where a pointer is, in the field's own tenths, clamped to the field. */
function pointerTenthsOf(canvas: HTMLCanvasElement, clientX: number): number {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const tenths = (x / CELL) * BRICKS_TENTHS;
  const width = BRICKS_COLUMNS * BRICKS_TENTHS;
  return Math.max(0, Math.min(width, Math.round(tenths)));
}
