import { useCallback, useEffect, useRef, useState } from "react";
import {
  TILE_2048_SIZES,
  continueAfterWin,
  createTile2048,
  highestTile,
  moveTile2048,
  undoLastMove,
  type Tile2048Move,
  type Tile2048Size,
  type Tile2048State,
} from "@nexus/core";
import { Button, Chip } from "@nexus/ui";
import { boardPixels, cellSizeFor } from "../canvas.js";
import { copy } from "../copy.js";
import { formatCount } from "../format.js";
import { isUndoKey, tile2048MoveFor } from "../input.js";
import { newSeed } from "../loop.js";
import { boardFont, paintCellText, paintGround } from "../paint.js";
import type { BoardPalette } from "../palette.js";
import { Board, BoardSlot, Veil, useCanvasRef } from "../parts.js";
import { tileStep } from "../tiles.js";
import { aControlHasFocus, type BoardGameProps } from "./props.js";

/**
 * 2048 on the page (ADR-090): a turn-based board, so there is no frame loop at
 * all - a move is a key press, and the engine answers with a whole new state.
 *
 * **The four steps of intensity are the design system's own rule for a chart**,
 * applied to a tile board: one hue, four steps, never a continuous ramp. They are
 * drawn with `globalAlpha` rather than with four colours, because a colour this
 * file invented would be a value outside the token set - and alpha is not a
 * colour, it is how much of the accent the tile gets.
 *
 * **Winning does not end the game**, which is the engine's rule and the original
 * game's: the board keeps playing until the player cannot move, so the win is a
 * banner with two ways out (carry on, or start again) rather than a stop.
 */

/** The board the page ships. The engine builds 4, 5 and 6; the shelf records whichever is played. */
const SIZE: Tile2048Size = TILE_2048_SIZES[0] ?? 4;

const BOARD_BOX = { maxWidth: 560, maxHeight: 360, maxCell: 44 } as const;
const CELL = cellSizeFor(SIZE, SIZE, BOARD_BOX);
const BOARD = boardPixels(SIZE, SIZE, CELL);
const GAP = 3;

/** The alpha a tile of `step` is filled with, and the ink that stays readable on it. */
function tileFill(step: number): number {
  return [0.18, 0.34, 0.56, 0.82][step] ?? 0.82;
}

export function Tile2048Game({ onFinish }: BoardGameProps) {
  const [state, setState] = useState<Tile2048State>(() => createTile2048(newSeed(), SIZE));
  const canvas = useCanvasRef();
  /** The state a handler reads and writes, so two moves in one tick cannot lose one. */
  const stateRef = useRef(state);
  const commit = useCallback((next: Tile2048State): void => {
    stateRef.current = next;
    setState(next);
  }, []);
  const reported = useRef(false);

  const restart = useCallback(() => {
    reported.current = false;
    commit(createTile2048(newSeed(), SIZE));
  }, [commit]);

  useEffect(() => {
    canvas.current?.focus();
  }, [canvas]);

  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (aControlHasFocus()) return;
      // The win is the engine's own state, and the board keeps playing only once
      // the player has answered it: a move pressed behind the banner would be a
      // move nobody saw, on a board nobody could read.
      const current = stateRef.current;
      if (current.won && !current.keepGoing) return;
      if (isUndoKey(event.key)) {
        event.preventDefault();
        const previous = undoLastMove(current);
        if (previous !== null) commit(previous);
        return;
      }
      const move: Tile2048Move | null = tile2048MoveFor(event.key);
      if (move === null) return;
      event.preventDefault();
      // A direction that changes nothing answers the same state, which is the
      // engine's own way of saying that was not a move.
      const next = moveTile2048(current, move);
      if (next !== current) commit(next);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [commit]);

  useEffect(() => {
    if (!state.over || reported.current) return;
    reported.current = true;
    onFinish({
      game: "tile2048",
      size: SIZE,
      score: state.score,
      moves: state.moves,
      won: state.won,
    });
  }, [state.over, state.score, state.moves, state.won, onFinish]);

  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, palette: BoardPalette): void => {
      paintGround(ctx, palette, BOARD.width, BOARD.height);
      const font = boardFont(ctx, Math.round(CELL * 0.34));
      state.cells.forEach((value, index) => {
        const column = index % SIZE;
        const row = Math.floor(index / SIZE);
        const step = tileStep(value);
        // The winning tile is the one tile with the second colour role: everything
        // below it is intensity of the player's own hue.
        const won = value >= 2048;
        ctx.globalAlpha = value === 0 ? 1 : tileFill(step);
        ctx.fillStyle = value === 0 ? palette.surfaceAlt : won ? palette.data : palette.accent;
        ctx.fillRect(
          column * CELL + GAP,
          row * CELL + GAP,
          CELL - GAP * 2,
          CELL - GAP * 2,
        );
        ctx.globalAlpha = 1;
        if (value > 0) {
          const ink = won || step >= 2 ? palette.surface : palette.ink;
          paintCellText(ctx, formatCount(value), column, row, CELL, ink, font);
        }
      });
    },
    [state],
  );

  const won = state.won && !state.keepGoing;

  return (
    <div className="arcade__game">
      <div className="arcade__status-row" role="status">
        <Chip variant="accent">
          {copy.status.score} {formatCount(state.score)}
        </Chip>
        <Chip>
          {copy.status.moves} {formatCount(state.moves)}
        </Chip>
        <Chip>
          {copy.status.bestTile} {formatCount(highestTile(state))}
        </Chip>
      </div>
      <div className="arcade__board-row">
        <BoardSlot>
          <Board
            width={BOARD.width}
            height={BOARD.height}
            label={`${copy.games.tile2048} - ${copy.status.score} ${String(state.score)}`}
            canvasRef={canvas}
            onPaint={paint}
          />
          {won ? (
            <Veil
              title={copy.status.won}
              action={
                <>
                  <Button size="sm" variant="primary" onClick={() => commit(continueAfterWin(stateRef.current))}>
                    {copy.actions.continueAfterWin}
                  </Button>
                  <Button size="sm" onClick={restart}>
                    {copy.actions.newGame}
                  </Button>
                </>
              }
            />
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
        <Button
          size="sm"
          variant="quiet"
          disabled={state.undo === null}
          onClick={() => {
            const previous = undoLastMove(stateRef.current);
            if (previous !== null) commit(previous);
          }}
        >
          {copy.actions.undo}
        </Button>
      </div>
      <p className="nx-hint">{copy.keys.tile2048}</p>
    </div>
  );
}
