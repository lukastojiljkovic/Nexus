import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@nexus/ui";
import {
  draughts,
  draughtsSquareName,
  fourColumnName,
  fourInARow,
  mlin,
  mlinPointName,
  reversi,
  reversiCellName,
} from "@nexus/core";
import type { BoardEvent, BoardSeatKind, BoardsGame } from "@nexus/core";
import { copy } from "./copy.js";
import {
  EIGHT_GRID,
  MLIN_GRID,
  draughtsCell,
  mlinCell,
  reversiCell,
} from "./geometry.js";
import { BackgammonBoard, LudoBoard } from "./DiceBoards.js";
import "./boards.css";

/**
 * The boards the six games are played on (ADR-090 stage 2).
 *
 * **One component per game, and the same props for all six.** A board is given the
 * position, the legal moves, who plays each seat, whether it is this person's turn,
 * the last thing that happened and one `onMove` — and it answers with the move the
 * click means. Nothing here computes a rule: what may be clicked comes from the
 * engines' own move list, and a click hands that move back unchanged. The one
 * thing a board does own is the SELECTION — which piece is chosen, which
 * destination is being aimed at — because that is a fact about a person's hand and
 * not about the game.
 *
 * **Every cell is a real button, and only the actionable ones are focusable.** A
 * board that drew divs with click handlers would be unreachable by keyboard, and
 * one that made every cell focusable would be 64 tab stops to reach four legal
 * placements. A cell that cannot be played is `disabled`, so Tab walks exactly the
 * moves available and Enter plays the one it is on. Each button's accessible name
 * is the game's own NOTATION — `d3`, `b3`, `f` — plus whose piece it holds, which
 * is the same spelling the move list uses and needs no language of its own.
 *
 * **Selection is reset when the position changes**, so a piece chosen before the
 * opponent's reply cannot stay chosen afterwards, and Escape backs out of whatever
 * is half-chosen — the rule the whole app keeps for anything that opens.
 */

export interface BoardProps {
  readonly game: BoardsGame;
  readonly state: unknown;
  readonly moves: readonly unknown[];
  readonly seats: readonly BoardSeatKind[];
  /** Whether the person at this machine may move at all right now. */
  readonly interactive: boolean;
  /** The last thing that happened, so the board can mark it. */
  readonly lastEvent: BoardEvent | null;
  readonly onMove: (move: unknown) => void;
}

/** One grid, sized to its board: every cell is one fraction of the whole. */
function gridStyle(columns: number, rows: number): CSSProperties {
  return {
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
  };
}

function cellStyle(column: number, row: number): CSSProperties {
  return { gridColumn: column, gridRow: row };
}

/** Whose piece stands on a cell, as the words the copy table already has for a seat. */
function ownerLabel(seats: readonly BoardSeatKind[], seat: number): string {
  return seats[seat] === "human" ? copy.cell.human : copy.cell.computer;
}

/**
 * A cell's accessible name: its notation, and what stands there.
 *
 * `undefined` is "nothing to say" — a column to drop into, a track square — and
 * answers the notation alone, where `null` is a cell somebody can play on that is
 * empty right now.
 */
function cellName(
  notation: string,
  occupant: number | null | undefined,
  seats: readonly BoardSeatKind[],
): string {
  if (occupant === undefined) return notation;
  const owner = occupant === null ? copy.cell.empty : ownerLabel(seats, occupant);
  return `${notation}, ${owner}`;
}

/**
 * The board of whichever game is being played.
 *
 * The six are six components because the six boards are six pictures; what they
 * share is the props above and the two-column rules below them, and a switch is
 * cheaper to read than a strategy table that would put six pictures in one file.
 */
export function Board(props: BoardProps) {
  switch (props.game) {
    case "reversi":
      return <ReversiBoard {...props} />;
    case "draughts":
      return <DraughtsBoard {...props} />;
    case "mlin":
      return <MlinBoard {...props} />;
    case "four-in-a-row":
      return <FourBoard {...props} />;
    case "backgammon":
      return <BackgammonBoard {...props} />;
    case "ludo":
      return <LudoBoard {...props} />;
  }
}

/** Escape backs out of a half-made choice, whichever board made it. */
function useEscape(reset: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") reset();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [reset]);
}

// --- Reversi ----------------------------------------------------------------

/**
 * The eight-by-eight disc board. There is no selection to make: a placement is
 * legal or it is not, so every legal cell is a button and clicking one plays it.
 */
function ReversiBoard({ state, moves, seats, interactive, lastEvent, onMove }: BoardProps) {
  const discs = (state as reversi.ReversiState).discs;
  const placements = new Set<number>();
  for (const move of moves as reversi.ReversiMove[]) {
    if (move.kind === "place") placements.add(move.cell);
  }
  const last = lastEvent?.kind === "move" ? (lastEvent.move as reversi.ReversiMove) : null;
  const lastCell = last !== null && last.kind === "place" ? last.cell : null;

  return (
    <div className="boards__board boards__board--reversi" style={gridStyle(EIGHT_GRID, EIGHT_GRID)}>
      {Array.from({ length: reversi.REVERSI_CELLS }, (_, cell) => {
        const at = reversiCell(cell);
        const disc = discs[cell] as reversi.ReversiDisc;
        const legal = placements.has(cell);
        return (
          <button
            key={cell}
            type="button"
            style={cellStyle(at.column, at.row)}
            className={`boards__cell${legal ? " boards__cell--legal" : ""}${
              lastCell === cell ? " boards__cell--last" : ""
            }`}
            aria-label={cellName(reversiCellName(cell), disc === 0 ? null : disc - 1, seats)}
            disabled={!interactive || !legal}
            onClick={() => onMove({ kind: "place", cell })}
          >
            {disc !== 0 && <span className={`boards__piece boards__piece--s${disc - 1}`} />}
          </button>
        );
      })}
    </div>
  );
}

// --- Draughts ---------------------------------------------------------------

/**
 * The dark squares of the eight-by-eight board. A capture is one move however many
 * pieces it takes, so the selection walks the SEQUENCE: each click appends a
 * landing, and the move is played when a landing completes one of the engine's own
 * sequences.
 */
function DraughtsBoard({ state, moves, seats, interactive, lastEvent, onMove }: BoardProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [path, setPath] = useState<number[]>([]);

  useEffect(() => {
    setSelected(null);
    setPath([]);
  }, [state]);
  useEscape(() => {
    setSelected(null);
    setPath([]);
  });

  const legal = moves as draughts.DraughtsMove[];
  const selectedMoves = legal.filter((move) => move.from === selected);
  // The cells a click can reach next: the landing at this depth of every sequence
  // that is still a candidate, deduplicated.
  const reachable = new Map<number, draughts.DraughtsMove>();
  const landingCandidates = new Map<number, draughts.DraughtsMove[]>();
  for (const move of selectedMoves) {
    const landing =
      move.kind === "step"
        ? path.length === 0
          ? move.to
          : null
        : (move.path[path.length] ?? null);
    if (landing === null) continue;
    if (move.kind === "capture" && !path.every((square, index) => square === move.path[index])) {
      continue;
    }
    reachable.set(landing, move);
    landingCandidates.set(landing, [...(landingCandidates.get(landing) ?? []), move]);
  }
  const pieces = (state as draughts.DraughtsState).squares;
  const lastMove = lastEvent?.kind === "move" ? (lastEvent.move as draughts.DraughtsMove) : null;
  const lastSquares = new Set<number>();
  if (lastMove !== null) {
    lastSquares.add(lastMove.from);
    if (lastMove.kind === "step") lastSquares.add(lastMove.to);
    else for (const landing of lastMove.path) lastSquares.add(landing);
  }

  return (
    <div className="boards__wrap">
      <div className="boards__board boards__board--draughts" style={gridStyle(EIGHT_GRID, EIGHT_GRID)}>
      {Array.from({ length: EIGHT_GRID * EIGHT_GRID }, (_, index) => {
        const row = Math.floor(index / EIGHT_GRID);
        const column = index % EIGHT_GRID;
        const square = draughts.draughtsSquareAt(EIGHT_GRID - 1 - row, column);
        if (square === null) {
          // A light square: part of the picture, and never a place to click —
          // which is why it is a span and not a disabled button.
          return (
            <span
              key={index}
              className="boards__cell boards__cell--blocked"
              style={cellStyle(column + 1, row + 1)}
            />
          );
        }
        const at = draughtsCell(square);
        const piece = pieces[square] as draughts.DraughtsPiece;
        const owner = draughts.draughtsOwner(piece);
        const mine = selectedMoves.some((move) => move.from === square);
        const target = reachable.has(square);
        return (
          <button
            key={index}
            type="button"
            style={cellStyle(at.column, at.row)}
            className={`boards__cell${target ? " boards__cell--legal" : ""}${
              selected === square ? " boards__cell--selected" : ""
            }${lastSquares.has(square) ? " boards__cell--last" : ""}`}
            aria-label={cellName(draughtsSquareName(square), owner, seats)}
            disabled={!interactive || !(mine || target)}
            onClick={() => {
              if (target) {
                const candidates = landingCandidates.get(square) ?? [];
                // A step is a whole move at once; a capture is walked one landing at
                // a time, because a man must go on jumping while it can.
                const stepped = candidates.find(
                  (move): move is Extract<draughts.DraughtsMove, { kind: "step" }> =>
                    move.kind === "step" && path.length === 0,
                );
                if (stepped !== undefined) {
                  onMove(stepped);
                  setSelected(null);
                  setPath([]);
                  return;
                }
                const next = [...path, square];
                // A sequence that is COMPLETE — one of the engine's own sequences
                // ends exactly here — is played; anything shorter waits for the next
                // landing, which is what makes a double capture readable.
                const finished = candidates.find(
                  (candidate) =>
                    candidate.kind === "capture" &&
                    candidate.path.length === next.length &&
                    next.every((landing, at) => candidate.path[at] === landing),
                );
                if (finished !== undefined) {
                  onMove(finished);
                  setSelected(null);
                  setPath([]);
                  return;
                }
                setPath(next);
                return;
              }
              setSelected(square);
              setPath([]);
            }}
          >
            {piece !== 0 && (
              <span
                className={`boards__piece boards__piece--s${owner ?? 0}${
                  draughts.draughtsIsKing(piece) ? " boards__piece--crowned" : ""
                }`}
              />
            )}
          </button>
        );
      })}
      </div>
      <p className="nx-hint boards__prompt">
        {selected === null ? copy.game.pickFrom : copy.game.pickTo}
      </p>
    </div>
  );
}

// --- Nine men's morris ------------------------------------------------------

/**
 * The three nested squares and their arms. A placement that forms a mill carries
 * the piece it takes in the SAME move, so when the engine offers more than one
 * victim the board asks which — which is the one choice a morris turn has.
 */
function MlinBoard({ state, moves, seats, interactive, lastEvent, onMove }: BoardProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [removal, setRemoval] = useState<readonly mlin.MlinMove[] | null>(null);

  useEffect(() => {
    setSelected(null);
    setRemoval(null);
  }, [state]);
  useEscape(() => {
    setSelected(null);
    setRemoval(null);
  });

  const points = (state as mlin.MlinState).points;
  const legal = moves as mlin.MlinMove[];
  const placings = legal.filter((move): move is Extract<mlin.MlinMove, { kind: "place" }> => move.kind === "place");
  const moving = legal.filter((move): move is Extract<mlin.MlinMove, { kind: "move" }> => move.kind === "move");
  const destinations = new Map<number, mlin.MlinMove>();
  for (const move of moving) {
    if (move.from === selected) destinations.set(move.to, move);
  }

  /** Plays a move, or asks which piece it takes when the rules allow a choice. */
  function commit(candidates: readonly mlin.MlinMove[]): void {
    const victims = new Set(candidates.map((move) => move.remove ?? -1));
    if (victims.size <= 1) {
      const only = candidates[0];
      if (only !== undefined) onMove(only);
      setSelected(null);
      setRemoval(null);
      return;
    }
    setRemoval(candidates);
  }

  const lastMove = lastEvent?.kind === "move" ? (lastEvent.move as mlin.MlinMove) : null;
  const lastPoints = new Set<number>();
  if (lastMove !== null) {
    if (lastMove.kind === "place") lastPoints.add(lastMove.point);
    else {
      lastPoints.add(lastMove.from);
      lastPoints.add(lastMove.to);
    }
    if (lastMove.remove !== null) lastPoints.add(lastMove.remove);
  }
  const removable = new Set((removal ?? []).map((move) => move.remove));

  return (
    <div className="boards__wrap">
      <div className="boards__board boards__board--mlin" style={gridStyle(MLIN_GRID, MLIN_GRID)}>
      {/* The lines the points sit on, drawn once behind them: the board's own
          picture, and the reason two points that are a mill look like one. */}
      <svg className="boards__lines" viewBox="0 0 6 6" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 0H6V6H0ZM1 1H5V5H1ZM2 2H4V4H2Z" />
        <path d="M3 0V2M3 4V6M0 3H2M4 3H6" />
      </svg>
      {points.map((piece, point) => {
        const at = mlinCell(point);
        const placing = placings.filter((move) => move.point === point);
        const target = destinations.has(point);
        const takeAway = removable.has(point);
        const playable = placing.length > 0 || target || takeAway;
        return (
          <button
            key={point}
            type="button"
            style={cellStyle(at.column, at.row)}
            className={`boards__cell boards__cell--point${
              playable && (placing.length > 0 || target) ? " boards__cell--legal" : ""
            }${selected === point ? " boards__cell--selected" : ""}${
              takeAway ? " boards__cell--target" : ""
            }${lastPoints.has(point) ? " boards__cell--last" : ""}`}
            aria-label={cellName(mlinPointName(point), piece === 0 ? null : piece - 1, seats)}
            disabled={!interactive || !playable}
            onClick={() => {
              if (removal !== null && takeAway) {
                const move = removal.find((candidate) => candidate.remove === point);
                if (move !== undefined) onMove(move);
                setSelected(null);
                setRemoval(null);
                return;
              }
              if (target) {
                commit(moving.filter((move) => move.from === selected && move.to === point));
                return;
              }
              if (placing.length > 0) {
                commit(placing);
                return;
              }
              if (point !== selected) {
                setSelected(point);
                setRemoval(null);
              }
            }}
          >
            {piece !== 0 && <span className={`boards__piece boards__piece--s${piece - 1}`} />}
          </button>
        );
      })}
      </div>
      <p className="nx-hint boards__prompt">
        {removal === null
          ? selected === null
            ? copy.game.pickFrom
            : copy.game.pickTo
          : copy.game.pickRemoval}
      </p>
    </div>
  );
}

// --- Four in a row ----------------------------------------------------------

/**
 * Seven columns of six. A move is a COLUMN — gravity decides the row — so the
 * buttons are the columns above the board, each with the row its disc would land
 * on said out loud in its name.
 */
function FourBoard({ state, seats, moves, interactive, lastEvent, onMove }: BoardProps) {
  const four = state as fourInARow.FourState;
  const open = new Set<number>();
  for (const move of moves as fourInARow.FourMove[]) open.add(move.column);
  const last = lastEvent?.kind === "move" ? (lastEvent.move as fourInARow.FourMove) : null;
  const lastCell =
    last === null
      ? null
      : fourInARow.fourIndex(last.column, fourInARow.fourColumnHeight(four.cells, last.column) - 1);

  function column(children: ReactNode, index: number) {
    return (
      <div key={index} className="boards__column">
        <button
          type="button"
          className="boards__cell boards__cell--drop"
          aria-label={cellName(`${copy.cell.column} ${fourColumnName(index)}`, undefined, seats)}
          disabled={!interactive || !open.has(index)}
          onClick={() => onMove({ column: index })}
        >
          <Icon name="arrowDown" size={14} className="boards__drop-mark" />
        </button>
        {children}
      </div>
    );
  }

  return (
    <div className="boards__board--four">
      <div className="boards__columns">
        {Array.from({ length: fourInARow.FOUR_COLUMNS }, (_, index) =>
          column(
            <div className="boards__column-cells">
              {Array.from({ length: fourInARow.FOUR_ROWS }, (_, row) => {
                const cell = fourInARow.fourIndex(index, fourInARow.FOUR_ROWS - 1 - row);
                const disc = four.cells[cell] as fourInARow.FourDisc;
                return (
                  <span
                    key={row}
                    className={`boards__cell${cell === lastCell ? " boards__cell--last" : ""}`}
                  >
                    {disc !== 0 && <span className={`boards__piece boards__piece--s${disc - 1}`} />}
                  </span>
                );
              })}
            </div>,
            index,
          ),
        )}
      </div>
      <p className="nx-hint boards__prompt">{copy.game.pickColumn}</p>
    </div>
  );
}
