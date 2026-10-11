import { useCallback, useEffect, useRef, useState } from "react";
import {
  SNAKE_COLUMNS,
  SNAKE_ROWS,
  createSnake,
  snakeTickMs,
  stepSnake,
  type SnakeDirection,
  type SnakeState,
} from "@nexus/core";
import { Button, Chip } from "@nexus/ui";
import { boardPixels, cellSizeFor } from "../canvas.js";
import { copy } from "../copy.js";
import { formatCount } from "../format.js";
import { directionFor } from "../input.js";
import { newSeed, planTicks, resumeAt, useFrameLoop, useWindowFocus } from "../loop.js";
import { paintFill, paintGrid, paintGround } from "../paint.js";
import type { BoardPalette } from "../palette.js";
import { Board, BoardSlot, PauseVeil, Veil, useCanvasRef } from "../parts.js";
import { aControlHasFocus, type BoardGameProps } from "./props.js";

/**
 * SNAKE on the page (ADR-090): the engine, the loop and one queue of turns.
 *
 * **A turn is queued, not applied.** The engine buffers at most two turns and
 * drops one that reverses the direction the snake is committed to - which is what
 * stops two fast presses folding the snake into its own neck - so the page's job
 * is only to hold the third press until the queue has room. That is why the queue
 * here is capped at the engine's own limit rather than at whatever a keyboard can
 * produce.
 *
 * **The board has walls**, and they are drawn: the frame around the field is the
 * rule the snake dies on, so a player who cannot see it is playing a different
 * game from the one the engine runs.
 */

const BOARD_BOX = { maxWidth: 560, maxHeight: 360, maxCell: 34 } as const;
const CELL = cellSizeFor(SNAKE_COLUMNS, SNAKE_ROWS, BOARD_BOX);
const BOARD = boardPixels(SNAKE_COLUMNS, SNAKE_ROWS, CELL);

/** How many turns may wait; the engine's own buffer, so the two cannot disagree. */
const TURN_QUEUE_CAP = 2;

export function SnakeGame({ onFinish }: BoardGameProps) {
  const [state, setState] = useState<SnakeState>(() => createSnake(newSeed(), performance.now()));
  const { paused, resume, resetPause } = useWindowFocus();
  const canvas = useCanvasRef();
  /** The state a frame reads and writes; see `Blocks.tsx` for why this is a ref rather than an updater. */
  const stateRef = useRef(state);
  const commit = useCallback((next: SnakeState): void => {
    stateRef.current = next;
    setState(next);
  }, []);
  const turns = useRef<SnakeDirection[]>([]);
  const reported = useRef(false);

  const advance = useCallback((current: SnakeState, now: number): SnakeState => {
    if (current.over) return current;
    const due = planTicks(current.lastTickAt, now, snakeTickMs(current.level), 1) > 0;
    const turn = turns.current.length === 0 ? undefined : turns.current.shift();
    if (turn === undefined && !due) return current;
    return stepSnake(current, turn === undefined ? {} : { turn }, now);
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
    turns.current.length = 0;
    reported.current = false;
    resetPause();
    commit(createSnake(newSeed(), performance.now()));
  }, [resetPause, commit]);

  const resumeWithFocus = useCallback(() => {
    // The clock moves to now before the loop restarts: the frames the snake spent
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
    // A direction held while the window was away is not a direction the player
    // is still asking for; the same rule `resumeAt` applies to the clock.
    turns.current.length = 0;
  }, [paused]);

  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (paused) {
        resumeWithFocus();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (aControlHasFocus()) return;
      const turn = directionFor(event.key);
      if (turn === null) return;
      event.preventDefault();
      if (turns.current.length < TURN_QUEUE_CAP) turns.current.push(turn);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [paused, resumeWithFocus]);

  useEffect(() => {
    if (!state.over || reported.current) return;
    reported.current = true;
    onFinish({ game: "snake", score: state.score, eaten: state.eaten });
  }, [state.over, state.score, state.eaten, onFinish]);

  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, palette: BoardPalette): void => {
      paintGround(ctx, palette, BOARD.width, BOARD.height);
      paintGrid(ctx, palette, SNAKE_COLUMNS, SNAKE_ROWS, CELL);
      // The food is the thing out there; the snake is the player's own mark, with
      // its head in the strong slot so the direction of travel is readable.
      paintFill(ctx, palette.data, state.food % SNAKE_COLUMNS, Math.floor(state.food / SNAKE_COLUMNS), CELL, 2);
      state.body.forEach((cell, index) => {
        paintFill(
          ctx,
          index === 0 ? palette.accentStrong : palette.accent,
          cell % SNAKE_COLUMNS,
          Math.floor(cell / SNAKE_COLUMNS),
          CELL,
          1,
        );
      });
      // The walls: the rule the snake dies on, drawn where it applies.
      ctx.strokeStyle = palette.frame;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, BOARD.width - 1, BOARD.height - 1);
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
          {copy.status.length} {formatCount(state.body.length)}
        </Chip>
        <Chip>
          {copy.status.eaten} {formatCount(state.eaten)}
        </Chip>
        <Chip>
          {copy.status.level} {formatCount(state.level)}
        </Chip>
      </div>
      <div className="arcade__board-row">
        <BoardSlot>
          <Board
            width={BOARD.width}
            height={BOARD.height}
            label={`${copy.games.snake} - ${copy.status.score} ${String(state.score)}`}
            canvasRef={canvas}
            onPaint={paint}
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
      <p className="nx-hint">{copy.keys.snake}</p>
    </div>
  );
}
