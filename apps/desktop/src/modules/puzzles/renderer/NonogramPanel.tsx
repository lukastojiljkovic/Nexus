import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Button, Card, LoadingState } from "@nexus/ui";
import type { NonogramPuzzle } from "@nexus/core";
import type { NonogramPictureView, NonogramStateView } from "../shared/ipc.js";
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
  choosePicture,
  completedLines,
  emptyMarks,
  isSolved,
  nonogramSizeOf,
  pictureToPuzzle,
  progressOf,
  zoomCellSize,
  type NonogramTool,
} from "./nonogram.js";
import {
  ActionRow,
  NewGameButton,
  Readout,
  VariantChips,
  initialGame,
  savedFor,
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
 * **Pictures from the pack.** When the `nonograms-pictures` pack is installed, a
 * game at a size the pack has pictures for is dealt one of them and never reaches
 * the worker: its picture is line-solvable by the pack builder's own proof. A
 * saved game names its picture by id, so a pack update that reorders the list
 * cannot change the board under a player. A picture that has left the pack is a
 * notice and a New game button, never a random board in its place.
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

/**
 * The smallest board the pack has pictures for, from its builder (10, 15 and 20).
 * Below it a board is always random, and the pack line under the board is for the
 * sizes the pack would have changed.
 */
const PACK_SIZE_MIN = 10;

/** The installed pack's pictures: `undefined` while the read is pending, `null` when no pack is installed or the read failed. */
function usePackPictures(): readonly NonogramPictureView[] | null | undefined {
  const [pictures, setPictures] = useState<readonly NonogramPictureView[] | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let active = true;
    window.nexus.modules.puzzles
      .packs({})
      .then((view) => {
        if (active) setPictures(view.pictures?.pictures ?? null);
      })
      .catch((error: unknown) => {
        console.error("Nexus: the nonogram pictures could not be read:", error);
        if (active) setPictures(null);
      });
    return () => {
      active = false;
    };
  }, []);
  return pictures;
}

/** The picture a game of `variant` is dealt from, or `null` for a random board. */
function dealPicture(
  pictures: readonly NonogramPictureView[],
  variant: string,
  seed: number,
  previous: string | null,
): NonogramPictureView | null {
  const size = nonogramSizeOf(variant);
  return size === null ? null : choosePicture(pictures, size.width, seed, previous);
}

/** The picture a saved game names, by id, or `null` when it names none or the pack no longer carries it. */
function pictureNamed(
  pictures: readonly NonogramPictureView[],
  id: string | undefined,
): NonogramPictureView | null {
  return pictures.find((picture) => picture.id === id) ?? null;
}

export function NonogramPanel(props: PanelProps) {
  const pictures = usePackPictures();
  if (pictures === undefined) {
    return (
      <Card className="pz__card">
        <LoadingState label={copy.page.loading} rows={4} className="pz__pending" />
      </Card>
    );
  }
  return <NonogramGame {...props} pictures={pictures} />;
}

function NonogramGame({
  saves,
  variants,
  onSave,
  onFinish,
  onClear,
  opening,
  pictures,
}: PanelProps & { readonly pictures: readonly NonogramPictureView[] | null }) {
  const engine = useEngine();
  const [initial] = useState(() => initialGame(saves, "nonogram", variants, newSeed, opening));
  const [variant, setVariant] = useState(initial.variant);
  const [seed, setSeed] = useState(initial.seed);
  const [board, setBoard] = useState<History<NonogramStateView> | null>(
    initial.saved === null ? null : createHistory(initial.saved.state as NonogramStateView),
  );
  const [picture, setPicture] = useState<NonogramPictureView | null>(() => {
    if (pictures === null) return null;
    return initial.saved === null
      ? dealPicture(pictures, initial.variant, initial.seed, null)
      : pictureNamed(pictures, (initial.saved.state as NonogramStateView).picture);
  });
  const clock = useElapsedClock(initial.elapsedSeconds);
  // The engine's board is kept with the game it was dealt for, so a board from an
  // earlier game can never be read as the current one before the effect clears it.
  const [randomGame, setRandomGame] = useState<{
    readonly key: string;
    readonly puzzle: NonogramPuzzle;
  } | null>(null);
  const [stage, setStage] = useState<EngineStage | null>(null);
  const [failed, setFailed] = useState(false);
  const [tool, setTool] = useState<NonogramTool>("fill");
  const [zoom, setZoom] = useState(1);
  const solvedOnce = useRef(false);

  const pictured = useMemo(() => (picture === null ? null : pictureToPuzzle(picture)), [picture]);
  const gameKey = `${variant}:${seed}`;
  const randomPuzzle =
    randomGame !== null && randomGame.key === gameKey ? randomGame.puzzle : null;
  const puzzle = pictured ?? randomPuzzle;
  // A saved game that names a picture the pack no longer carries is neither a
  // picture game nor a random one, so it is never handed to the engine.
  const missing = board !== null && board.present.picture !== undefined && picture === null;

  useEffect(() => {
    if (picture !== null || missing) return;
    let active = true;
    const key = `${variant}:${seed}`;
    setStage(null);
    setFailed(false);
    engine
      .request({ kind: "nonogram", seed, variant }, (next) => {
        if (active) setStage(next);
      })
      .then((response) => {
        if (!active || response.kind !== "nonogram") return;
        setRandomGame({ key, puzzle: response.puzzle });
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
  }, [engine, seed, variant, picture, missing]);

  useEffect(() => {
    if (puzzle === null || board !== null) return;
    const fresh: NonogramStateView = {
      width: puzzle.width,
      height: puzzle.height,
      marks: emptyMarks(puzzle.width, puzzle.height),
      ...(picture === null ? {} : { picture: picture.id }),
    };
    setBoard(createHistory(fresh));
    onSave({ puzzle: "nonogram", variant, seed, state: fresh, elapsedSeconds: clock.seconds });
  }, [puzzle, board, picture, variant, seed, clock.seconds, onSave]);

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
    const nextSeed = row?.seed ?? newSeed();
    setVariant(nextVariant);
    setSeed(nextSeed);
    setBoard(row === null ? null : createHistory(row.state as NonogramStateView));
    if (pictures !== null) {
      setPicture(
        row === null
          ? dealPicture(pictures, nextVariant, nextSeed, null)
          : pictureNamed(pictures, (row.state as NonogramStateView).picture),
      );
    }
    clock.restart(row?.elapsedSeconds ?? 0);
    solvedOnce.current = false;
  }

  /** Deals a new picture: the row goes first, so the fresh board is the one that is kept. */
  function newGame(): void {
    onClear({ puzzle: "nonogram", variant });
    const nextSeed = newSeed();
    setSeed(nextSeed);
    if (pictures !== null) {
      setPicture(dealPicture(pictures, variant, nextSeed, board?.present.picture ?? null));
    }
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
  if (missing) {
    return (
      <Card className="pz__card">
        <p className="nx-hint" role="status">
          {copy.nonogram.missingPicture}
        </p>
        <ActionRow>
          <NewGameButton saved={savedFor(saves, "nonogram", variant) !== null} primary onNew={newGame} />
        </ActionRow>
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
  const size = nonogramSizeOf(variant);
  const withoutPack = pictures === null && size !== null && size.width >= PACK_SIZE_MIN;

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
                {(clues.length === 0 ? [0] : clues).map((clue, at) => (
                  <span key={at}>{clue}</span>
                ))}
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
      {withoutPack && <p className="nx-hint">{copy.nonogram.packMissing}</p>}

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
        <NewGameButton saved={savedFor(saves, "nonogram", variant) !== null} primary onNew={newGame} />
      </ActionRow>

      {isSolved(marks, puzzle) && (
        <>
          <p className="pz__solved" role="status">
            {picture === null
              ? copy.nonogram.solved
              : copy.nonogram.solvedPicture.replace("{title}", () => picture.title[locale])}
          </p>
          {picture !== null && (
            <p className="nx-hint">{`${copy.nonogram.credit} ${picture.author} · game-icons.net · CC BY 3.0`}</p>
          )}
        </>
      )}
    </Card>
  );
}
