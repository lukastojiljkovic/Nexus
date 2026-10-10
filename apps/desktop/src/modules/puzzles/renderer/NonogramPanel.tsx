import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Button, Card, LoadingState } from "@nexus/ui";
import type { NonogramPuzzle } from "@nexus/core";
import type { NonogramStateView } from "../shared/ipc.js";
import { activeLocale } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { copy } from "./copy.js";
import type { EngineStage } from "./engine.js";
import { useEngine } from "./engineClient.js";
import { formatClock, formatCount, formatPixels } from "./format.js";
import {
  canRedo,
  canUndo,
  createHistory,
  push,
  redo,
  undo,
  type History,
} from "./history.js";
import {
  MARK_CROSSED,
  MARK_FILLED,
  ZOOM_CELL_SIZES,
  applyMark,
  completedLines,
  emptyMarks,
  isSolved,
  progressOf,
  zoomCellSize,
  type NonogramTool,
} from "./nonogram.js";
import {
  ActionRow,
  Readout,
  VariantChips,
  initialGame,
  variantLabel,
  useElapsedClock,
  type PanelProps,
} from "./panelKit.js";
import { newSeed } from "./seed.js";

/**
 * NONOGRAMS (ADR-090): the marks, the clues, and the zoom.
 *
 * **Every puzzle this panel draws is line-solvable by construction**, because
 * `generateNonogram` accepts a picture only when the line solver finishes it from
 * the clues alone — which is also the uniqueness proof. The generation retries
 * until it finds one of those, so it runs in the worker, and this panel shows
 * which stage it is at rather than freezing.
 *
 * **Three marks, two of the engine's.** A cell is filled, crossed, or untouched;
 * the engine knows filled and not-filled, and `nonogram.ts` maps between the two
 * so that „I am sure this is empty" is a thing a person can say without the
 * puzzle having to interpret it.
 *
 * **The clues cross themselves off.** A row or a column whose filled cells
 * already match its clue is muted, which is the pencil-and-paper habit and the
 * only progress readout a nonogram has.
 */

export function NonogramPanel({ saves, variants, onSave, onFinish, onClear }: PanelProps) {
  const engine = useEngine();
  const [initial] = useState(() => initialGame(saves, "nonogram", variants, newSeed));
  const [variant, setVariant] = useState(initial.variant);
  const [seed, setSeed] = useState(initial.seed);
  const [board, setBoard] = useState<History<NonogramStateView> | null>(
    initial.saved === null ? null : createHistory(initial.saved.state as NonogramStateView),
  );
  const clock = useElapsedClock(initial.elapsedSeconds);
  const [puzzle, setPuzzle] = useState<NonogramPuzzle | null>(null);
  const [stage, setStage] = useState<EngineStage | null>(null);
  const [failed, setFailed] = useState(false);
  const [tool, setTool] = useState<NonogramTool>("fill");
  const [zoom, setZoom] = useState(1);
  const solvedOnce = useRef(false);

  useEffect(() => {
    let active = true;
    setPuzzle(null);
    setStage(null);
    setFailed(false);
    engine
      .request({ kind: "nonogram", seed, variant }, (next) => {
        if (active) setStage(next);
      })
      .then((response) => {
        if (!active || response.kind !== "nonogram") return;
        setPuzzle(response.puzzle);
        setStage(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFailed(true);
        setStage(null);
        console.error("Nexus: the nonogram could not be generated:", error);
      });
    return () => {
      active = false;
    };
  }, [engine, seed, variant]);

  useEffect(() => {
    if (puzzle === null || board !== null) return;
    const fresh: NonogramStateView = {
      width: puzzle.width,
      height: puzzle.height,
      marks: emptyMarks(puzzle.width, puzzle.height),
    };
    setBoard(createHistory(fresh));
    onSave({ puzzle: "nonogram", variant, seed, state: fresh, elapsedSeconds: clock.seconds });
  }, [puzzle, board, variant, seed, clock.seconds, onSave]);

  useEffect(() => {
    if (puzzle === null || board === null || solvedOnce.current) return;
    if (!isSolved(board.present.marks, puzzle)) return;
    solvedOnce.current = true;
    onFinish({ puzzle: "nonogram", variant, solved: true, elapsedSeconds: clock.seconds });
  }, [board, puzzle, variant, clock.seconds, onFinish]);

  function play(next: NonogramStateView): void {
    if (board === null) return;
    setBoard(push(board, next));
    onSave({ puzzle: "nonogram", variant, seed, state: next, elapsedSeconds: clock.seconds });
  }

  function step(back: boolean): void {
    if (board === null) return;
    const stepped = back ? undo(board) : redo(board);
    if (stepped === board) return;
    setBoard(stepped);
    onSave({
      puzzle: "nonogram",
      variant,
      seed,
      state: stepped.present,
      elapsedSeconds: clock.seconds,
    });
  }

  function openGame(nextVariant: string): void {
    const row = saves.find(
      (save) => save.puzzle === "nonogram" && save.variant === nextVariant,
    ) ?? null;
    setVariant(nextVariant);
    setSeed(row?.seed ?? newSeed());
    setBoard(row === null ? null : createHistory(row.state as NonogramStateView));
    clock.restart(row?.elapsedSeconds ?? 0);
    solvedOnce.current = false;
  }

  /** Deals a new picture: the row goes first, so the fresh board is the one that is kept. */
  function newGame(): void {
    onClear({ puzzle: "nonogram", variant });
    setSeed(newSeed());
    setBoard(null);
    clock.restart(0);
    solvedOnce.current = false;
  }

  if (failed) {
    return (
      <Card className="pz__card">
        <p className="pz__error" role="alert">
          {copy.page.loadError}
        </p>
      </Card>
    );
  }
  if (puzzle === null || board === null) {
    return (
      <Card className="pz__card">
        <LoadingState
          label={stage === "deal" ? copy.page.stages.deal : copy.page.loading}
          rows={4}
          className="pz__pending"
        />
      </Card>
    );
  }

  const locale = activeLocale();
  const marks = board.present.marks;
  const lines = completedLines(marks, puzzle);
  const progress = progressOf(marks, puzzle);
  const cell = zoomCellSize(zoom);
  const style = { "--pz-nono-cell": `${cell}px` } as CSSProperties;

  return (
    <Card className="pz__card">
      <VariantChips
        label={copy.nonogram.variantLabel}
        options={variants}
        value={variant}
        labelOf={(option) => variantLabel("nonogram", option)}
        onChange={openGame}
      />

      <div className="pz__row">
        <Readout
          label={copy.nonogram.filled}
          value={`${formatCount(progress.progress, locale)}/${formatCount(puzzle.solution.filter(Boolean).length, locale)}`}
        />
        <Readout label={copy.common.time} value={formatClock(clock.seconds)} />
      </div>

      <div className="pz-nono__scroll">
        <div className="pz-nono" style={style}>
          <div className="pz-nono__line pz-nono__line--clues">
            <span className="pz-nono__clue pz-nono__clue--corner" aria-hidden="true" />
            {puzzle.colClues.map((clues, column) => (
              <span
                key={`column-${column}`}
                className={
                  lines.columns[column] ? "pz-nono__clue pz-nono__clue--done" : "pz-nono__clue"
                }
              >
                {clues.length === 0 ? "0" : clues.join(" ")}
              </span>
            ))}
          </div>
          {puzzle.rowClues.map((clues, row) => (
            <div key={`row-${row}`} className="pz-nono__line">
              <span
                className={lines.rows[row] ? "pz-nono__clue pz-nono__clue--done" : "pz-nono__clue"}
              >
                {clues.length === 0 ? "0" : clues.join(" ")}
              </span>
              {Array.from({ length: puzzle.width }, (_, column) => {
                const index = row * puzzle.width + column;
                const mark = marks[index] ?? 0;
                const classes = ["pz-nono__cell"];
                if (mark === MARK_FILLED) classes.push("pz-nono__cell--filled");
                if (mark === MARK_CROSSED) classes.push("pz-nono__cell--crossed");
                const state =
                  mark === MARK_FILLED
                    ? copy.nonogram.markFilled
                    : mark === MARK_CROSSED
                      ? copy.nonogram.markCrossed
                      : copy.nonogram.markUnknown;
                return (
                  <button
                    key={index}
                    type="button"
                    className={classes.join(" ")}
                    aria-label={`${copy.nonogram.cell} ${formatCount(row + 1, locale)}, ${formatCount(column + 1, locale)} — ${state}`}
                    aria-pressed={mark !== 0}
                    onClick={() => play({ ...board.present, marks: applyMark(marks, index, tool) })}
                  >
                    <span className="pz-nono__mark" aria-hidden="true">
                      {mark === MARK_FILLED ? "" : mark === MARK_CROSSED ? "×" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <ActionRow>
        <div className="pz__chips" role="group" aria-label={copy.nonogram.toolLabel}>
          <Button
            size="sm"
            className={tool === "fill" ? "nx-segmented__option pz__chip" : "pz__chip"}
            aria-pressed={tool === "fill"}
            onClick={() => setTool("fill")}
          >
            {copy.nonogram.fill}
          </Button>
          <Button
            size="sm"
            className={tool === "cross" ? "nx-segmented__option pz__chip" : "pz__chip"}
            aria-pressed={tool === "cross"}
            onClick={() => setTool("cross")}
          >
            {copy.nonogram.cross}
          </Button>
        </div>
        <div className="pz__chips" role="group" aria-label={copy.nonogram.zoomLabel}>
          <Button
            size="sm"
            className="pz__chip"
            disabled={zoom <= 0}
            onClick={() => setZoom((current) => Math.max(0, current - 1))}
          >
            {copy.nonogram.zoomOut}
          </Button>
          <span className="pz__readout-value" aria-live="polite">
            {formatPixels(cell, locale)}
          </span>
          <Button
            size="sm"
            className="pz__chip"
            disabled={zoom >= ZOOM_CELL_SIZES.length - 1}
            onClick={() => setZoom((current) => Math.min(ZOOM_CELL_SIZES.length - 1, current + 1))}
          >
            {copy.nonogram.zoomIn}
          </Button>
        </div>
        <Button size="sm" disabled={!canUndo(board)} onClick={() => step(true)}>
          {copy.common.undo}
        </Button>
        <Button size="sm" disabled={!canRedo(board)} onClick={() => step(false)}>
          {copy.common.redo}
        </Button>
        <Button size="sm" variant="primary" onClick={newGame}>
          {copy.common.newGame}
        </Button>
      </ActionRow>

      {isSolved(marks, puzzle) && (
        <p className="pz__solved" role="status">
          {copy.nonogram.solved}
        </p>
      )}
    </Card>
  );
}
