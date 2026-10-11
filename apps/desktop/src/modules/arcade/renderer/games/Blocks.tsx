import { useCallback, useEffect, useRef, useState } from "react";
import {
  BLOCKS_COLUMNS,
  BLOCKS_PREVIEW_COUNT,
  BLOCKS_ROWS,
  BLOCKS_TICK_MS,
  activeCells,
  createBlocks,
  ghostCells,
  step,
  type BlockPieceId,
  type BlocksInput,
  type BlocksState,
} from "@nexus/core";
import { Button, Chip } from "@nexus/ui";
import { boardPixels, cellSizeFor, prepareCanvas, useBoardPalette } from "../canvas.js";
import { copy } from "../copy.js";
import { formatCount } from "../format.js";
import { BLOCKS_ARR_MS, BLOCKS_DAS_MS, BLOCKS_SOFT_DROP_MS, blocksActionFor } from "../input.js";
import {
  newSeed,
  planTicks,
  repeatCount,
  resumeAt,
  useFlash,
  useFrameLoop,
  useReducedMotion,
  useWindowFocus,
} from "../loop.js";
import { paintFill, paintGrid, paintGround, paintOutline, paintPiece, pieceColour } from "../paint.js";
import type { BoardPalette } from "../palette.js";
import { Board, BoardSlot, PauseVeil, Veil, useCanvasRef } from "../parts.js";
import { aControlHasFocus, type BoardGameProps } from "./props.js";

/**
 * BLOCKS on the page (ADR-090): the engine, the loop, the keys and the board.
 *
 * **The engine owns the clock, and the page owns only the decision to step.**
 * `step(state, input, now)` accumulates gravity from the interval between two
 * readings, so a board stepped on a 60 Hz display and one stepped on a 144 Hz
 * display fall at the same speed - which is the whole reason the engine takes
 * `now` rather than a tick count. The page's own contribution is the gate in
 * `advance`: a frame with no tick due and no key waiting hands React back the
 * state it already had, so the board is copied 264 cells' worth only when
 * something actually happens.
 *
 * **The two rates a held key needs are the page's, and they are counted rather
 * than timed.** `repeatCount` turns "how long has this been down" into "how many
 * keystrokes it has earned", and the queue between the two is capped: a window
 * that produced a hundred due keystrokes is a window that was not being watched,
 * and the honest answer to it is the eight the player can still act on.
 *
 * **A hold is cleared when the game pauses**, deliberately. A key held while the
 * app was behind another window must not fire a burst the moment the window comes
 * back, which is the same rule `resumeAt` applies to the clock.
 */

/** The box the board is drawn in: 20 px a cell for 12 x 22, which fits the minimum window. */
const BOARD_BOX = { maxWidth: 560, maxHeight: 352, maxCell: 26 } as const;
const CELL = cellSizeFor(BLOCKS_COLUMNS, BLOCKS_ROWS, BOARD_BOX);
const BOARD = boardPixels(BLOCKS_COLUMNS, BLOCKS_ROWS, CELL);

/** How many keystrokes may wait for a step; see the header. */
const QUEUE_CAP = 8;

/** One key being held: what it asks for, how fast it repeats, and how many it has already asked for. */
interface Repeat {
  readonly input: BlocksInput;
  readonly dasMs: number;
  readonly arrMs: number;
  readonly sinceMs: number;
  delivered: number;
}

export function BlocksGame({ onFinish }: BoardGameProps) {
  const [state, setState] = useState<BlocksState>(() => createBlocks(newSeed(), performance.now()));
  const { paused, resume, resetPause } = useWindowFocus();
  const reduceMotion = useReducedMotion();
  const canvas = useCanvasRef();
  /**
   * The state a frame reads, and the state it writes.
   *
   * A frame's work has SIDE EFFECTS - it consumes keystrokes and advances
   * repeat counters - so it may not live inside a `setState` updater: React
   * invokes an updater twice in development (`StrictMode`), which would consume
   * two keystrokes per frame and halve every repeat rate. The ref is written the
   * instant a state is committed, so a frame always reads the newest one and
   * runs its effects exactly once.
   */
  const stateRef = useRef(state);
  const commit = useCallback((next: BlocksState): void => {
    stateRef.current = next;
    setState(next);
  }, []);
  /** The keystrokes waiting for a step, oldest first. */
  const queue = useRef<BlocksInput[]>([]);
  /** The keys currently held, by the key that is down. */
  const repeats = useRef(new Map<string, Repeat>());
  /** Whether this game's result has already been handed to main. */
  const reported = useRef(false);
  const flash = useFlash(state.lines, reduceMotion);

  /**
   * One frame: the repeats a held key has earned, then the step if anything is
   * due. Returning the state unchanged is what makes a frame with nothing to do
   * cost nothing - React sees the same object and skips the render.
   */
  const advance = useCallback((current: BlocksState, now: number): BlocksState => {
    if (current.status === "over") return current;
    for (const held of repeats.current.values()) {
      const owed = repeatCount(now - held.sinceMs, held.dasMs, held.arrMs);
      while (held.delivered < owed && queue.current.length < QUEUE_CAP) {
        held.delivered += 1;
        queue.current.push(held.input);
      }
      // Past the cap the rest are dropped rather than kept: they are keystrokes
      // nobody could still be asking for by the time they ran.
      held.delivered = owed;
    }
    const due = planTicks(current.lastTickAt, now, BLOCKS_TICK_MS, 1) > 0;
    const input = queue.current.shift();
    if (input === undefined && !due) return current;
    return step(current, input ?? "none", now);
  }, []);

  const frame = useCallback(
    (now: number) => {
      const next = advance(stateRef.current, now);
      if (next !== stateRef.current) commit(next);
    },
    [advance, commit],
  );
  useFrameLoop(frame, !paused && state.status === "playing");

  const restart = useCallback(() => {
    queue.current.length = 0;
    repeats.current.clear();
    reported.current = false;
    resetPause();
    commit(createBlocks(newSeed(), performance.now()));
  }, [resetPause, commit]);

  /**
   * The way back into the game, from the veil: the clock is moved to now and the
   * board takes focus so the keys reach it again.
   *
   * The clock is the half that matters. A game resumed after a minute away has a
   * last-step reading a minute old, and the engine would honestly apply a
   * minute's worth of gravity to it - eleven rows of the stack, dropped. So the
   * frames behind a blurred window are dropped instead (`resumeAt`), which is the
   * same policy the engine states for a backlog of its own ticks.
   */
  const resumeWithFocus = useCallback(() => {
    commit(resumeAt(stateRef.current, performance.now()));
    resume();
    canvas.current?.focus();
  }, [commit, resume, canvas]);

  // The board holds focus while a game runs, so a key press after a restart or a
  // resume goes to the game rather than to whatever was focused before.
  useEffect(() => {
    canvas.current?.focus();
  }, [canvas]);

  useEffect(() => {
    if (!paused) return;
    queue.current.length = 0;
    repeats.current.clear();
  }, [paused]);

  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (paused) {
        resumeWithFocus();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (aControlHasFocus()) return;
      const action = blocksActionFor(event.key);
      if (action === null) return;
      event.preventDefault();
      // The system's own key repeat is ignored: this page's repeats are the ones
      // with a delay and a rate a player can predict.
      if (event.repeat) return;
      queue.current.push(action);
      if (action === "left" || action === "right" || action === "softDrop") {
        repeats.current.set(event.key, {
          input: action,
          dasMs: action === "softDrop" ? 0 : BLOCKS_DAS_MS,
          arrMs: action === "softDrop" ? BLOCKS_SOFT_DROP_MS : BLOCKS_ARR_MS,
          sinceMs: performance.now(),
          delivered: 1,
        });
      }
    };
    const up = (event: KeyboardEvent): void => {
      repeats.current.delete(event.key);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [paused, resumeWithFocus]);

  useEffect(() => {
    if (state.status !== "over" || reported.current) return;
    reported.current = true;
    onFinish({ game: "blocks", score: state.score, lines: state.lines });
  }, [state.status, state.score, state.lines, onFinish]);

  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, palette: BoardPalette): void => {
      paintGround(ctx, palette, BOARD.width, BOARD.height);
      paintGrid(ctx, palette, BLOCKS_COLUMNS, BLOCKS_ROWS, CELL);
      state.board.forEach((id, index) => {
        if (id === null) return;
        paintFill(
          ctx,
          pieceColour(palette, id),
          index % BLOCKS_COLUMNS,
          Math.floor(index / BLOCKS_COLUMNS),
          CELL,
          1,
        );
      });
      // The ghost first, so the piece in play is drawn over its own shadow.
      for (const cellOfGhost of ghostCells(state)) {
        paintOutline(ctx, palette.muted, cellOfGhost.x, cellOfGhost.y, CELL, 1);
      }
      for (const cellOfPiece of activeCells(state)) {
        paintFill(
          ctx,
          state.active === null ? palette.accent : pieceColour(palette, state.active.id),
          cellOfPiece.x,
          cellOfPiece.y,
          CELL,
          1,
        );
      }
    },
    [state],
  );

  return (
    <div className="arcade__game">
      <div className="arcade__status-row" role="status">
        <Chip variant="accent">
          {copy.status.score} {formatCount(state.score)}
        </Chip>
        <Chip className={flash ? "arcade__chip--hit" : undefined}>
          {copy.status.lines} {formatCount(state.lines)}
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
            label={`${copy.games.blocks} - ${copy.status.score} ${String(state.score)}`}
            canvasRef={canvas}
            onPaint={paint}
          />
          {paused ? (
            <PauseVeil onResume={resumeWithFocus} />
          ) : (
            state.status === "over" && (
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
        <div className="arcade__slots">
          <div className="arcade__slot">
            <span className="nx-eyebrow">{copy.status.hold}</span>
            <PieceSlot id={state.hold} />
          </div>
          <div className="arcade__slot">
            {/* One label over the whole queue: the three pieces are in the order
                they come, and three copies of the word would say nothing about
                which slot is the nearest. */}
            <span className="nx-eyebrow">{copy.status.next}</span>
            <div className="arcade__queue">
              {state.next.slice(0, BLOCKS_PREVIEW_COUNT).map((id, index) => (
                <PieceSlot key={`${id}-${String(index)}`} id={id} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="arcade__actions">
        <Button size="sm" onClick={restart}>
          {copy.actions.newGame}
        </Button>
      </div>
      <p className="nx-hint">{copy.keys.blocks}</p>
    </div>
  );
}

/** One piece in a slot of its own: the reserve, and the queue as it comes. */
function PieceSlot({ id }: { readonly id: BlockPieceId | null }) {
  const palette = useBoardPalette();
  const canvas = useCanvasRef();
  const cell = 12;
  const side = cell * 4;

  useEffect(() => {
    const ctx = prepareCanvas(canvas.current, side, side);
    if (ctx === null) return;
    paintGround(ctx, palette, side, side);
    paintGrid(ctx, palette, 4, 4, cell);
    if (id !== null) paintPiece(ctx, palette, id, cell, 0, cell);
  });

  return (
    <canvas
      ref={canvas}
      // Decoration of the label beside it: the piece is not a fact a reader
      // needs announced twice.
      aria-hidden="true"
      width={side}
      height={side}
      className="arcade__slot-canvas"
      style={{ width: `${side}px`, height: `${side}px` }}
    />
  );
}
