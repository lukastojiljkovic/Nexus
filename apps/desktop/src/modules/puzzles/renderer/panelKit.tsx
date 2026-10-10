import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@nexus/ui";
import type {
  PuzzleId,
  PuzzlesSettingsView,
  PuzzleSaveView,
  PuzzleStateView,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import { elapsedSecondsOf } from "./format.js";

/**
 * The four things all four panels do (ADR-090): read the game this profile was
 * already playing, hold a clock, offer the grades as a segmented control, and
 * state a failure. One copy each, so „how a puzzle resumes" is one rule in one
 * file rather than four that drift.
 */

/**
 * The game this profile has in progress for one puzzle and grade, or `null`.
 *
 * Matched on the PAIR rather than the puzzle alone: a hard sudoku and an easy
 * one are two different games, and resuming „the sudoku" would hand somebody
 * back a board they did not leave.
 */
export function savedFor(
  saves: readonly PuzzleSaveView[],
  puzzle: PuzzleId,
  variant: string,
): PuzzleSaveView | null {
  return saves.find((save) => save.puzzle === puzzle && save.variant === variant) ?? null;
}

/**
 * Which grade a puzzle opens on: the first one this profile has a game in, and
 * otherwise the first grade the module offers.
 *
 * Games in progress come first on purpose. The whole module is „leave and come
 * back to it", so opening onto the board somebody left is the behaviour the
 * module promises; a grade nobody is playing is where a NEW game starts, and
 * that is the second-best answer.
 */
export function initialVariant(
  saves: readonly PuzzleSaveView[],
  puzzle: PuzzleId,
  variants: readonly string[],
): string {
  const played = saves.find((save) => save.puzzle === puzzle);
  return played?.variant ?? variants[0] ?? "";
}

/** Everything one panel reads once, when it opens. */
export interface InitialGame {
  readonly variant: string;
  readonly seed: number;
  readonly saved: PuzzleSaveView | null;
  readonly elapsedSeconds: number;
}

export function initialGame(
  saves: readonly PuzzleSaveView[],
  puzzle: PuzzleId,
  variants: readonly string[],
  newSeed: () => number,
): InitialGame {
  const variant = initialVariant(saves, puzzle, variants);
  const saved = savedFor(saves, puzzle, variant);
  return {
    variant,
    seed: saved?.seed ?? newSeed(),
    saved,
    elapsedSeconds: saved?.elapsedSeconds ?? 0,
  };
}

/**
 * What a grade is called in the language being read — „Lako", „Easy", „5 × 5".
 *
 * One function rather than four call sites reading the table themselves: the
 * index is the only way to reach a leaf whose key is a variant the page was
 * handed, so the awkward part stays in one place. The English and Serbian tables
 * are the same shape, so a variant one of them lacks cannot exist.
 */
export function variantLabel(puzzle: PuzzleId, variant: string): string {
  // Indexed on `copy.variants` itself rather than through a widened local: the
  // table's keys are the store's variant list, which no type can narrow, and
  // this is the one read that has to reach a leaf by a key it was handed.
  const grades = copy.variants[puzzle] as Readonly<Record<string, string>>;
  return grades[variant] ?? variant;
}

/**
 * The panel's clock, in whole seconds.
 *
 * `banked` is what earlier runs of this game added up to — which is what a
 * resumed game carries — and the run in progress is a `performance.now()` delta,
 * on the timers module's terms: an interval that a hidden window throttles would
 * make a counter fall behind, and a game saved from a page that was away would
 * carry a time nobody spent.
 *
 * One second is the repaint period because a second is the unit printed; the
 * interval advances no state of its own.
 */
export function useElapsedClock(carriedSeconds: number): {
  readonly seconds: number;
  restart(from?: number): void;
} {
  const banked = useRef(carriedSeconds);
  const startedAt = useRef<number | null>(performance.now());
  const [nowMs, setNowMs] = useState(() => performance.now());

  useEffect(() => {
    const handle = setInterval(() => setNowMs(performance.now()), 1_000);
    return () => clearInterval(handle);
  }, []);

  return {
    seconds: elapsedSecondsOf(banked.current, startedAt.current, nowMs),
    restart: (from = 0) => {
      banked.current = from;
      startedAt.current = performance.now();
      setNowMs(performance.now());
    },
  };
}

/**
 * A puzzle's grades as a segmented control.
 *
 * The labels come from the caller (`copy.variants[puzzle][variant]`), so this
 * component never knows a grade's name — and the group carries a name of its own
 * because „Lako, Srednje, Teško" announced without one is three buttons with no
 * subject.
 */
export function VariantChips({
  label,
  options,
  value,
  labelOf,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly string[];
  readonly value: string;
  readonly labelOf: (option: string) => string;
  readonly onChange: (next: string) => void;
}) {
  return (
    <div className="pz__chips" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option}
          size="sm"
          className="nx-segmented__option pz__chip"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {labelOf(option)}
        </Button>
      ))}
    </div>
  );
}

/** A row of controls under a board, wrapping rather than squeezing at 900 × 600. */
export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="pz__actions">{children}</div>;
}

/** Writing the game in progress: the board as it stands, and how long it has been open. */
export interface SaveInput {
  readonly puzzle: PuzzleId;
  readonly variant: string;
  readonly seed: number;
  readonly state: PuzzleStateView;
  readonly elapsedSeconds: number;
}

/** Folding a finished game into the record. `distance` is Broj's own field. */
export interface FinishInput {
  readonly puzzle: PuzzleId;
  readonly variant: string;
  readonly solved: boolean;
  readonly elapsedSeconds: number;
  readonly distance?: number | null;
}

/** Dropping the game in progress: what „Nova igra" writes before it deals. */
export interface ClearInput {
  readonly puzzle: PuzzleId;
  readonly variant: string;
}

/**
 * What every panel is handed.
 *
 * The MUTATIONS arrive as callbacks rather than as the bridge itself, so a panel
 * cannot reach an op its puzzle has no business calling — and the page stays the
 * one place that knows how a failed write is reported. `settings` is the whole
 * module's one preference; only the sudoku panel reads it.
 */
export interface PanelProps {
  readonly saves: readonly PuzzleSaveView[];
  readonly variants: readonly string[];
  readonly settings: PuzzlesSettingsView;
  readonly onSave: (input: SaveInput) => void;
  readonly onFinish: (input: FinishInput) => void;
  /**
   * „Nova igra" is TWO writes and the clearing one is what makes it new: a
   * panel that only drew a fresh seed would deal a fresh board and leave the old
   * row standing, so the next visit would resume a game the user had abandoned —
   * which is the row's job to prevent, not the page's memory of it.
   */
  readonly onClear: (input: ClearInput) => void;
}

/** One line of numbers, right-aligned and tabular: the readouts a board carries. */
export function Readout({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <p className="pz__readout">
      <span className="pz__readout-label">{label}</span>
      <span className="pz__readout-value">{value}</span>
    </p>
  );
}
