import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  MINESWEEPER_PRESETS,
  MINESWEEPER_PRESET_IDS,
  chordCell,
  createMinesweeper,
  createSeededRandom,
  cycleMark,
  minesweeperElapsedMs,
  minesweeperFaces,
  minesweeperIndex,
  minesweeperRemainingMines,
  revealCell,
  type MinesweeperConfig,
  type MinesweeperFace,
  type MinesweeperState,
} from "@nexus/core";
import { Button, Chip, Select, TextField } from "@nexus/ui";
import { boardPixels, cellSizeFor } from "../canvas.js";
import { copy } from "../copy.js";
import { readCustomBoard, type MinesweeperLevel } from "../customBoard.js";
import { formatElapsed } from "../format.js";
import { isChordKey, isMarkKey, isRevealKey, minesweeperStepFor } from "../input.js";
import { netElapsedMs, newSeed, useWindowFocus } from "../loop.js";
import { boardFont, paintFill, paintGround, paintOutline } from "../paint.js";
import type { BoardPalette } from "../palette.js";
import { Board, BoardSlot, PauseVeil, Veil, useCanvasRef } from "../parts.js";
import { presetLabel } from "../variants.js";
import { aControlHasFocus, type BoardGameProps } from "./props.js";

/**
 * MINESWEEPER on the page (ADR-090): the engine, the two hands that play it, and
 * the one clock the player watches.
 *
 * **The clock is the engine's, less the time the window was away.** The engine
 * measures a span between two instants (`startedAt` on the first click, `endedAt`
 * on the win or the loss) and it is right to: whose mines were placed under a
 * running clock keep running while the app is behind another window. What the
 * page adds is the deduction - `netElapsedMs` takes off the milliseconds this page
 * spent paused - so the recorded best is a fact about the board rather than about
 * the interruptions, and a game left open overnight is not a four-hour beginner
 * win.
 *
 * **Both hands work, and neither is a fallback.** The pointer is the classic
 * board (left opens, right marks, middle chords); the keyboard is complete on its
 * own (arrows move a cursor, Space opens, F marks, C chords), because "keyboard
 * first" is a promise this page makes - and the cursor is drawn, so a player who
 * cannot see where the arrows went is not playing a game with a hidden pointer.
 *
 * **The questions are on.** The engine makes the question mark optional
 * (`MinesweeperOptions.questions`); this page turns it on, because a mark that
 * says "not sure" is how the board is really played, and the alternative is a
 * flag a player has to place before they have decided.
 */

const BOARD_BOX = { maxWidth: 620, maxHeight: 360, maxCell: 34 } as const;

/** Where a game starts, and the numbers the custom form opens with: the beginner board. */
const FIRST_LEVEL: MinesweeperLevel = "beginner";
const FIRST_FIELDS = { columns: "9", rows: "9", mines: "10" };

/** What a press asks for, from either hand. */
type CellAction = "open" | "mark" | "chord";

export function MinesweeperGame({ onFinish }: BoardGameProps) {
  const [level, setLevel] = useState<MinesweeperLevel>(FIRST_LEVEL);
  const [fields, setFields] = useState(FIRST_FIELDS);
  const [config, setConfig] = useState<MinesweeperConfig>(MINESWEEPER_PRESETS.beginner);
  const [state, setState] = useState<MinesweeperState>(() =>
    createMinesweeper(MINESWEEPER_PRESETS.beginner, { questions: true }),
  );
  const [problem, setProblem] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { paused, pausedMs, resume, resetPause } = useWindowFocus();
  const canvas = useCanvasRef();
  /** The state a handler reads and writes, so a click and a key in one tick cannot lose one. */
  const stateRef = useRef(state);
  const commit = useCallback((next: MinesweeperState): void => {
    stateRef.current = next;
    setState(next);
  }, []);
  /** The cursor, mirrored for the key listener so it always reads the newest one. */
  const cursorRef = useRef(cursor);
  /** The game's own source for the first click's layout (see `packages/core/src/games/random.ts`). */
  const random = useRef(createSeededRandom(newSeed()));
  const reported = useRef(false);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  const cell = cellSizeFor(config.columns, config.rows, BOARD_BOX);
  const board = boardPixels(config.columns, config.rows, cell);
  const playing = state.status === "playing";
  const elapsed = minesweeperElapsedMs(state, new Date(nowMs).toISOString());
  const shownMs = elapsed === null ? 0 : netElapsedMs(elapsed, pausedMs);

  /** Starts a game on the level currently chosen, or reports why it cannot. */
  const start = useCallback(() => {
    const next = level === "custom" ? readCustomBoard(fields) : MINESWEEPER_PRESETS[level];
    if (next === null) {
      setProblem(true);
      return;
    }
    setProblem(false);
    reported.current = false;
    random.current = createSeededRandom(newSeed());
    resetPause();
    setConfig(next);
    commit(createMinesweeper(next, { questions: true }));
    setCursor(0);
    setNowMs(Date.now());
    canvas.current?.focus();
  }, [level, fields, resetPause, commit, canvas]);

  useEffect(() => {
    canvas.current?.focus();
  }, [canvas]);

  /**
   * The clock, read once a second while a game runs.
   *
   * It forces a repaint and advances nothing: the number on screen is the span
   * between the engine's two instants and this reading, so a throttled interval
   * (which a hidden window guarantees) can only make the display late, never
   * wrong.
   */
  useEffect(() => {
    if (!playing || paused) return;
    const handle = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(handle);
  }, [playing, paused]);

  /** One action on one cell, from either hand. */
  const act = useCallback(
    (current: MinesweeperState, index: number, action: CellAction) => {
      if (current.status === "won" || current.status === "lost") return;
      const at = new Date(Date.now()).toISOString();
      if (action === "mark") {
        commit(cycleMark(current, index));
        return;
      }
      if (action === "chord") {
        commit(chordCell(current, index, at));
        return;
      }
      // Opening an OPEN cell takes the chord instead: that is the classic board's
      // own grammar, and it is the move a finished board is won with.
      const target = current.cells[index];
      if (target !== undefined && target.revealed && (current.adjacent[index] ?? 0) > 0) {
        commit(chordCell(current, index, at));
        return;
      }
      commit(revealCell(current, index, random.current, at));
    },
    [commit],
  );

  /** One pointer press, in the board's own coordinates. */
  const press = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (paused) {
        resume();
        canvas.current?.focus();
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const column = Math.floor((event.clientX - rect.left) / cell);
      const row = Math.floor((event.clientY - rect.top) / cell);
      const current = stateRef.current;
      if (column < 0 || column >= current.config.columns || row < 0 || row >= current.config.rows) {
        return;
      }
      const index = minesweeperIndex(current.config, column, row);
      setCursor(index);
      act(current, index, event.button === 2 ? "mark" : event.button === 1 ? "chord" : "open");
    },
    [paused, resume, canvas, cell, act],
  );

  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (paused) {
        resume();
        canvas.current?.focus();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (aControlHasFocus()) return;
      const current = stateRef.current;
      const step = minesweeperStepFor(event.key);
      if (step !== null) {
        event.preventDefault();
        const index = cursorRef.current;
        const column = index % current.config.columns;
        const row = Math.floor(index / current.config.columns);
        const nextColumn = Math.min(current.config.columns - 1, Math.max(0, column + step.dx));
        const nextRow = Math.min(current.config.rows - 1, Math.max(0, row + step.dy));
        setCursor(minesweeperIndex(current.config, nextColumn, nextRow));
        return;
      }
      const action: CellAction | null = isMarkKey(event.key)
        ? "mark"
        : isChordKey(event.key)
          ? "chord"
          : isRevealKey(event.key)
            ? "open"
            : null;
      if (action === null) return;
      event.preventDefault();
      act(current, cursorRef.current, action);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [paused, resume, canvas, act]);

  useEffect(() => {
    if (reported.current) return;
    if (state.status !== "won" && state.status !== "lost") return;
    reported.current = true;
    const raw = minesweeperElapsedMs(state, new Date(Date.now()).toISOString()) ?? 0;
    onFinish({
      game: "minesweeper",
      columns: config.columns,
      rows: config.rows,
      mines: config.mines,
      won: state.status === "won",
      timeMs: state.status === "won" ? netElapsedMs(raw, pausedMs) : null,
    });
  }, [state, config, pausedMs, onFinish]);

  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, palette: BoardPalette): void => {
      paintGround(ctx, palette, board.width, board.height);
      const numberFont = `600 ${boardFont(ctx, Math.round(cell * 0.56))}`;
      const markFont = boardFont(ctx, Math.round(cell * 0.5));
      minesweeperFaces(state).forEach((face, index) => {
        paintFace(
          ctx,
          palette,
          face,
          state.adjacent[index] ?? 0,
          index % state.config.columns,
          Math.floor(index / state.config.columns),
          cell,
          numberFont,
          markFont,
        );
      });
      // The keyboard cursor, drawn on the cell it stands on: the board holds
      // focus, and this is what says where the arrows have moved it.
      if (state.status === "ready" || state.status === "playing") {
        paintOutline(
          ctx,
          palette.accent,
          cursor % config.columns,
          Math.floor(cursor / config.columns),
          cell,
          2,
        );
      }
    },
    [state, cursor, cell, config.columns, board.width, board.height],
  );

  return (
    <div className="arcade__game">
      <div className="arcade__status-row" role="status">
        <Chip variant="accent">
          {copy.status.remaining} {String(minesweeperRemainingMines(state))}
        </Chip>
        <Chip>
          {copy.status.time} {formatElapsed(shownMs)}
        </Chip>
        {state.status === "ready" && <Chip>{copy.status.ready}</Chip>}
        {state.status === "won" && <Chip variant="data">{copy.status.won}</Chip>}
        {state.status === "lost" && <Chip variant="danger">{copy.status.lost}</Chip>}
      </div>
      <div className="arcade__options">
        <Select
          label={copy.levels.label}
          value={level}
          onChange={(event) => setLevel(event.target.value as MinesweeperLevel)}
        >
          {MINESWEEPER_PRESET_IDS.map((id) => (
            <option key={id} value={id}>
              {presetLabel(id)}
            </option>
          ))}
          <option value="custom">{copy.levels.custom}</option>
        </Select>
        {level === "custom" && (
          // The three fields wear their own labels; the heading is what says
          // they are ONE board rather than three unrelated numbers.
          <div className="arcade__custom-group">
            <span className="nx-eyebrow">{copy.custom.title}</span>
            <div className="arcade__custom">
              <TextField
                label={copy.custom.columns}
                inputMode="numeric"
                value={fields.columns}
                onChange={(event) => setFields({ ...fields, columns: event.target.value })}
              />
              <TextField
                label={copy.custom.rows}
                inputMode="numeric"
                value={fields.rows}
                onChange={(event) => setFields({ ...fields, rows: event.target.value })}
              />
              <TextField
                label={copy.custom.mines}
                inputMode="numeric"
                value={fields.mines}
                onChange={(event) => setFields({ ...fields, mines: event.target.value })}
              />
            </div>
          </div>
        )}
        <Button size="sm" variant="primary" onClick={start}>
          {copy.actions.newGame}
        </Button>
      </div>
      {problem && (
        <p className="arcade__error" role="alert">
          {copy.custom.invalid}
        </p>
      )}
      <div className="arcade__board-row">
        <BoardSlot>
          <Board
            width={board.width}
            height={board.height}
            label={`${copy.games.minesweeper} - ${String(config.columns)} x ${String(config.rows)}`}
            canvasRef={canvas}
            onPaint={paint}
            onPointerDown={press}
          />
          {paused ? (
            <PauseVeil
              onResume={() => {
                resume();
                canvas.current?.focus();
              }}
            />
          ) : (
            (state.status === "won" || state.status === "lost") && (
              <Veil
                title={state.status === "won" ? copy.status.won : copy.status.lost}
                action={
                  <Button size="sm" variant="primary" onClick={start}>
                    {copy.actions.newGame}
                  </Button>
                }
              />
            )
          )}
        </BoardSlot>
      </div>
      <p className="nx-hint">{copy.keys.minesweeper}</p>
    </div>
  );
}

/**
 * One cell, as the engine's own face for it.
 *
 * The colours carry the three roles and nothing else: a closed cell is a raised
 * surface, an open one is the board itself, a flag is the player's own mark
 * (accent), a mine is the loss (danger) and a number is ink - the DIGIT is what
 * says how many mines are around it, so colour is never the only channel.
 */
function paintFace(
  ctx: CanvasRenderingContext2D,
  palette: BoardPalette,
  face: MinesweeperFace,
  adjacent: number,
  column: number,
  row: number,
  cell: number,
  numberFont: string,
  markFont: string,
): void {
  const closed = (): void => paintFill(ctx, palette.surfaceAlt, column, row, cell, 1);
  const open = (): void => paintFill(ctx, palette.ground, column, row, cell, 1);
  switch (face) {
    case "hidden":
      closed();
      return;
    case "flag":
      closed();
      paintFlag(ctx, palette.accent, column, row, cell);
      return;
    case "wrong-flag":
      closed();
      paintFlag(ctx, palette.danger, column, row, cell);
      return;
    case "question":
      closed();
      paintMark(ctx, "?", markFont, palette.muted, column, row, cell);
      return;
    case "mine":
      open();
      ctx.beginPath();
      ctx.arc(column * cell + cell / 2, row * cell + cell / 2, cell * 0.24, 0, Math.PI * 2);
      ctx.fillStyle = palette.danger;
      ctx.fill();
      return;
    case "empty":
      open();
      return;
    case "number":
      open();
      paintMark(ctx, String(adjacent), numberFont, palette.ink, column, row, cell);
      return;
  }
}

/** One mark centred in a cell: a digit, or the question mark. */
function paintMark(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  colour: string,
  column: number,
  row: number,
  cell: number,
): void {
  ctx.fillStyle = colour;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, column * cell + cell / 2, row * cell + cell / 2 + 1);
}

/** A flag: a pole and a pennant, in whatever colour the face's meaning carries. */
function paintFlag(
  ctx: CanvasRenderingContext2D,
  colour: string,
  column: number,
  row: number,
  cell: number,
): void {
  const left = column * cell;
  const top = row * cell;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = Math.max(1, cell * 0.08);
  ctx.beginPath();
  ctx.moveTo(left + cell * 0.36, top + cell * 0.2);
  ctx.lineTo(left + cell * 0.36, top + cell * 0.78);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(left + cell * 0.38, top + cell * 0.22);
  ctx.lineTo(left + cell * 0.72, top + cell * 0.38);
  ctx.lineTo(left + cell * 0.38, top + cell * 0.54);
  ctx.closePath();
  ctx.fill();
}
