import { useEffect, useRef, useState } from "react";
import { Button, Card, LoadingState } from "@nexus/ui";
import type { SudokuPuzzle } from "@nexus/core";
import type { SudokuStateView } from "../shared/ipc.js";
import { activeLocale } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { copy } from "./copy.js";
import type { EngineStage } from "./engine.js";
import { useEngine } from "./engineClient.js";
import { formatClock, formatCount } from "./format.js";
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
  ActionRow,
  Readout,
  VariantChips,
  initialGame,
  variantLabel,
  useElapsedClock,
  type PanelProps,
} from "./panelKit.js";
import { newSeed } from "./seed.js";
import {
  clearCell,
  conflictCells,
  enterDigit,
  filledCount,
  hintFacts,
  hintFor,
  isSolved,
  mergedCells,
  sameDigitCells,
  toggleNote,
  unitsOf,
  type HintFacts,
} from "./sudoku.js";

/**
 * SUDOKU (ADR-090): the board, the digit pad, the pencil marks and the ladder.
 *
 * **The engine proves, the page edits.** Uniqueness, the difficulty grade, what
 * conflicts are and what technique comes next are all `@nexus/core` answers; this
 * file owns what a tap means, which cell is being looked at, and how a hint is
 * said in words. The generation itself runs in the worker (`engineClient`),
 * because grading a puzzle digs every hole against the whole technique ladder.
 *
 * **Conflicts are drawn only when asked.** The product's rule is „shown only when
 * the user asks", so the toggle starts from the profile's own preference and the
 * board passes `false` for as long as the user has not asked for anything else —
 * `conflictCells` is where that is unrepresentable rather than remembered.
 *
 * **The board is saved as it is played.** Every placement, every mark and every
 * step of undo writes the row, so „resumes exactly" is true at the instant the
 * window closes rather than at the next save point. The writes are the store's
 * own single-row upsert, and a person makes a few of them a minute.
 */

export function SudokuPanel({
  saves,
  variants,
  settings,
  onSave,
  onFinish,
  onClear,
}: PanelProps) {
  const engine = useEngine();
  const [initial] = useState(() => initialGame(saves, "sudoku", variants, newSeed));
  const [variant, setVariant] = useState(initial.variant);
  const [seed, setSeed] = useState(initial.seed);
  const [board, setBoard] = useState<History<SudokuStateView> | null>(
    initial.saved === null ? null : createHistory(initial.saved.state as SudokuStateView),
  );
  const clock = useElapsedClock(initial.elapsedSeconds);
  const [puzzle, setPuzzle] = useState<SudokuPuzzle | null>(null);
  const [stage, setStage] = useState<EngineStage | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [showConflicts, setShowConflicts] = useState(settings.checkWhileTyping);
  const [hint, setHint] = useState<HintFacts | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const solvedOnce = useRef(false);

  // The board itself: regenerated from (seed, grade) whenever either moves. The
  // engine is deterministic in the seed, so a resumed game draws the same grid
  // the row was saved from.
  useEffect(() => {
    let active = true;
    setPuzzle(null);
    setStage(null);
    setFailed(false);
    engine
      .request({ kind: "sudoku", seed, variant }, (next) => {
        if (active) setStage(next);
      })
      .then((response) => {
        if (!active || response.kind !== "sudoku") return;
        setPuzzle(response.puzzle);
        setStage(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFailed(true);
        setStage(null);
        console.error("Nexus: the sudoku board could not be built:", error);
      });
    return () => {
      active = false;
    };
  }, [engine, seed, variant]);

  // A board with nothing saved yet: the givens, no entries, no marks. Written at
  // once, so the game this profile is playing is the game it comes back to.
  useEffect(() => {
    if (puzzle === null || board !== null) return;
    const fresh: SudokuStateView = {
      givens: [...puzzle.cells],
      entries: new Array<number | null>(81).fill(null),
      notes: Array.from({ length: 81 }, () => [] as number[]),
      hintsUsed: 0,
    };
    setBoard(createHistory(fresh));
    onSave({ puzzle: "sudoku", variant, seed, state: fresh, elapsedSeconds: clock.seconds });
  }, [puzzle, board, variant, seed, clock.seconds, onSave]);

  // The one moment a game becomes a result. The ref is what keeps it one write:
  // the effect re-runs as the clock ticks, and a solved board stays solved.
  useEffect(() => {
    if (puzzle === null || board === null || solvedOnce.current) return;
    if (!isSolved(board.present, puzzle.solution)) return;
    solvedOnce.current = true;
    onFinish({
      puzzle: "sudoku",
      variant,
      solved: true,
      elapsedSeconds: clock.seconds,
    });
  }, [board, puzzle, variant, clock.seconds, onFinish]);

  /** One player move: it goes on the stack, and the row follows it. */
  function play(next: SudokuStateView): void {
    if (board === null) return;
    const stepped = push(board, next);
    setBoard(stepped);
    setHint(null);
    onSave({ puzzle: "sudoku", variant, seed, state: next, elapsedSeconds: clock.seconds });
  }

  function step(back: boolean): void {
    if (board === null) return;
    const stepped = back ? undo(board) : redo(board);
    if (stepped === board) return;
    setBoard(stepped);
    setHint(null);
    onSave({
      puzzle: "sudoku",
      variant,
      seed,
      state: stepped.present,
      elapsedSeconds: clock.seconds,
    });
  }

  /** Opens a grade: the board it has in progress, or a fresh one. */
  function openGame(nextVariant: string): void {
    const row = saves.find(
      (save) => save.puzzle === "sudoku" && save.variant === nextVariant,
    ) ?? null;
    setVariant(nextVariant);
    setSeed(row?.seed ?? newSeed());
    setBoard(row === null ? null : createHistory(row.state as SudokuStateView));
    clock.restart(row?.elapsedSeconds ?? 0);
    setSelected(null);
    setHint(null);
    solvedOnce.current = false;
  }

  /** Deals a new board: the row goes first, so the fresh game is the one that is kept. */
  function newGame(): void {
    onClear({ puzzle: "sudoku", variant });
    setSeed(newSeed());
    setBoard(null);
    clock.restart(0);
    setSelected(null);
    setHint(null);
    setNotice(null);
    solvedOnce.current = false;
  }

  function applyDigit(digit: number): void {
    if (board === null || selected === null) return;
    const next = noteMode
      ? toggleNote(board.present, selected, digit)
      : enterDigit(board.present, selected, digit);
    // The helpers answer the SAME state back when a cell refuses the move (a
    // given has nothing to write, a cell with a digit has no marks): a step that
    // changed nothing is not a step, and the undo stack should not grow one.
    if (next === board.present) return;
    play(next);
  }

  function clearSelected(): void {
    if (board === null || selected === null) return;
    if (noteMode) {
      const marks = board.present.notes[selected] ?? [];
      let next = board.present;
      for (const digit of marks) next = toggleNote(next, selected, digit);
      if (next === board.present) return;
      play(next);
      return;
    }
    const cleared = clearCell(board.present, selected);
    if (cleared === board.present) return;
    play(cleared);
  }

  function askHint(): void {
    if (board === null) return;
    const found = hintFor(board.present);
    if (found === null) {
      setHint(null);
      setNotice(copy.sudoku.hintNone);
      return;
    }
    const facts = hintFacts(found);
    setNotice(null);
    // A hint is recorded as part of the game: the count travels in the saved
    // row, so a resumed board still says how much help it had.
    const next = { ...board.present, hintsUsed: board.present.hintsUsed + 1 };
    setBoard(push(board, next));
    setHint(facts);
    onSave({ puzzle: "sudoku", variant, seed, state: next, elapsedSeconds: clock.seconds });
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

  const state = board.present;
  const locale = activeLocale();
  const cells = mergedCells(state);
  const conflicts = new Set(conflictCells(state, showConflicts));
  const unit = new Set(selected === null ? [] : unitsOf(selected));
  const sameDigit = new Set(selected === null ? [] : sameDigitCells(state, selected));
  const hintCells = new Set(hint?.cells ?? []);
  const hintPattern = new Set(hint?.pattern ?? []);
  const solved = isSolved(state, puzzle.solution);

  return (
    <Card className="pz__card">
      <VariantChips
        label={copy.sudoku.variantLabel}
        options={variants}
        value={variant}
        labelOf={(option) => variantLabel("sudoku", option)}
        onChange={openGame}
      />

      <div className="pz__row">
        <Readout
          label={copy.sudoku.filled}
          value={`${formatCount(filledCount(state), locale)}/${formatCount(81, locale)}`}
        />
        <Readout label={copy.common.time} value={formatClock(clock.seconds)} />
      </div>

      <div
        className="pz-sudoku__board"
        role="group"
        aria-label={copy.sudoku.boardLabel}
        onKeyDown={(event) => {
          const digit = Number(event.key);
          if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
            event.preventDefault();
            applyDigit(digit);
            return;
          }
          if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
            event.preventDefault();
            clearSelected();
            return;
          }
          if (event.key === "Escape") setSelected(null);
        }}
      >
        {cells.map((digit, index) => {
          const given = (state.givens[index] ?? 0) !== 0;
          const marks = state.notes[index] ?? [];
          const classes = ["pz-sudoku__cell"];
          if (given) classes.push("pz-sudoku__cell--given");
          if (selected === index) classes.push("pz-sudoku__cell--selected");
          else if (unit.has(index)) classes.push("pz-sudoku__cell--unit");
          if (sameDigit.has(index) && selected !== index) classes.push("pz-sudoku__cell--same");
          if (conflicts.has(index)) classes.push("pz-sudoku__cell--conflict");
          if (hintCells.has(index)) classes.push("pz-sudoku__cell--hint");
          else if (hintPattern.has(index)) classes.push("pz-sudoku__cell--pattern");
          const row = Math.floor(index / 9) + 1;
          const column = (index % 9) + 1;
          const name =
            digit === 0
              ? `${copy.sudoku.cell} ${formatCount(row, locale)}, ${formatCount(column, locale)}`
              : `${copy.sudoku.cell} ${formatCount(row, locale)}, ${formatCount(column, locale)}: ${formatCount(digit, locale)}`;
          return (
            <button
              key={index}
              type="button"
              className={classes.join(" ")}
              aria-label={name}
              aria-pressed={selected === index}
              onClick={() => setSelected(index)}
            >
              {digit !== 0 ? (
                <span className="pz-sudoku__digit">{digit}</span>
              ) : marks.length > 0 ? (
                <span className="pz-sudoku__notes" aria-hidden="true">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((mark) => (
                    <span key={mark} className="pz-sudoku__note">
                      {marks.includes(mark) ? mark : ""}
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="pz__chips" role="group" aria-label={copy.sudoku.padLabel}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <Button
            key={digit}
            size="sm"
            className="pz__chip pz-sudoku__pad"
            disabled={selected === null}
            onClick={() => applyDigit(digit)}
            aria-label={`${copy.sudoku.padLabel} ${formatCount(digit, locale)}`}
          >
            {digit}
          </Button>
        ))}
        <Button size="sm" disabled={selected === null} onClick={clearSelected}>
          {copy.sudoku.erase}
        </Button>
      </div>

      <ActionRow>
        <Button
          size="sm"
          aria-pressed={noteMode}
          className={noteMode ? "nx-segmented__option" : undefined}
          onClick={() => setNoteMode((current) => !current)}
        >
          {copy.sudoku.notes}
        </Button>
        <Button
          size="sm"
          aria-pressed={showConflicts}
          className={showConflicts ? "nx-segmented__option" : undefined}
          onClick={() => setShowConflicts((current) => !current)}
        >
          {copy.sudoku.conflicts}
        </Button>
        <Button size="sm" disabled={!canUndo(board)} onClick={() => step(true)}>
          {copy.common.undo}
        </Button>
        <Button size="sm" disabled={!canRedo(board)} onClick={() => step(false)}>
          {copy.common.redo}
        </Button>
        <Button size="sm" onClick={askHint}>
          {copy.common.hint}
        </Button>
        <Button size="sm" variant="primary" onClick={newGame}>
          {copy.common.newGame}
        </Button>
      </ActionRow>

      {hint !== null && (
        <p className="pz__note" role="status">
          {`${copy.sudoku.hintLead} ${describeHint(hint, locale)} — ${copy.techniques[hint.technique]}`}
        </p>
      )}
      {notice !== null && <p className="pz__note">{notice}</p>}
      {showConflicts && conflicts.size > 0 && <p className="pz__note">{copy.sudoku.conflictNote}</p>}
      {solved && <p className="pz__solved" role="status">{copy.sudoku.solved}</p>}
    </Card>
  );
}

/** The step in the words the action takes, with the two numbers it names printed in the active locale. */
function describeHint(hint: HintFacts, locale: ReturnType<typeof activeLocale>): string {
  if (hint.action === "fill" && hint.cell !== null && hint.digit !== null) {
    return copy.sudoku.hintFill
      .replace("{digit}", formatCount(hint.digit, locale))
      .replace("{cell}", formatCount(hint.cell + 1, locale));
  }
  return hint.action === "eliminate" ? copy.sudoku.hintEliminate : copy.sudoku.hintNarrow;
}

