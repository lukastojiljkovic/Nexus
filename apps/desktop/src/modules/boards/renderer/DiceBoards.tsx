import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Icon } from "@nexus/ui";
import { backgammon, backgammonSiteName, ludo } from "@nexus/core";
import type { BoardSeatKind } from "@nexus/core";
import type { BoardProps } from "./Board.js";
import { copy } from "./copy.js";
import {
  BACKGAMMON_COLUMNS,
  LUDO_GRID,
  backgammonBarCell,
  backgammonCell,
  ludoHomeCell,
  ludoTokenCell,
  ludoTrackCell,
  ludoYardCell,
} from "./geometry.js";
import "./boards.css";

/**
 * The two boards whose turn is a DECISION about dice (ADR-090 stage 2).
 *
 * They are their own file because the other four are one click each and these two
 * are not. Backgammon's move is a whole turn — every checker play the two dice
 * allow, which is a set the engine enumerates — so the board walks it: click a
 * source, click where it goes, and the turn is played when the plays make one of
 * the engine's own turns. Ludo's die is read off the position and a move is one
 * token, which is one click too, but which tokens may move comes from the die —
 * and the board has to draw 52 squares and sixteen tokens to say so.
 *
 * **Both keep their half-finished choice locally, and clear it when the position
 * changes.** A chosen source that outlived the opponent's reply would be a click
 * that plays a move nobody aimed at.
 */

/** Whose piece stands somewhere, as the words the copy table already has for a seat. */
function ownerLabel(seats: readonly BoardSeatKind[], seat: number): string {
  return seats[seat] === "human" ? copy.cell.human : copy.cell.computer;
}

function gridStyle(columns: number, rows: number): CSSProperties {
  return {
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
  };
}

function cellStyle(column: number, row: number): CSSProperties {
  return { gridColumn: column, gridRow: row };
}

// --- Backgammon -------------------------------------------------------------

/**
 * Twenty-four points, the bar between them, and the two trays checkers leave by.
 *
 * The engine's move is a set of plays, so a click means one PLAY of that set:
 * choose where a checker comes from, then where it goes. Every candidate turn that
 * still matches what has been chosen stays in play, and the turn is played the
 * moment the chosen plays make one of them.
 */
export function BackgammonBoard({ state, moves, seats, interactive, lastEvent, onMove }: BoardProps) {
  const game = state as backgammon.BackgammonState;
  const legal = moves as backgammon.BackgammonMove[];
  const [chosen, setChosen] = useState<readonly backgammon.BackgammonPlay[]>([]);
  const [from, setFrom] = useState<backgammon.BackgammonSite | null>(null);

  useEffect(() => {
    setChosen([]);
    setFrom(null);
  }, [state]);
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setFrom(null);
      setChosen([]);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // A turn is the plays that remain, given the ones already chosen — prefix
  // matching, in order, so two orders that reach the same place stay two choices.
  const candidates = legal.filter(
    (move) =>
      move.plays.length >= chosen.length &&
      chosen.every(
        (play, index) =>
          move.plays[index]?.from === play.from &&
          move.plays[index]?.to === play.to &&
          move.plays[index]?.die === play.die,
      ),
  );
  const depth = chosen.length;
  const sources = new Set<backgammon.BackgammonSite>();
  for (const move of candidates) {
    const play = move.plays[depth];
    if (play !== undefined) sources.add(play.from);
  }
  const targets = new Map<backgammon.BackgammonSite, backgammon.BackgammonPlay>();
  for (const move of candidates) {
    const play = move.plays[depth];
    if (play !== undefined && from !== null && play.from === from) targets.set(play.to, play);
  }
  const lastPlays = lastEvent?.kind === "move" ? (lastEvent.move as backgammon.BackgammonMove).plays : [];
  const marked = new Set<string>();
  for (const play of [...lastPlays, ...chosen]) {
    marked.add(`from:${String(play.from)}`);
    marked.add(`to:${String(play.to)}`);
  }

  /** Plays the chosen plays when they make a whole turn. */
  function advance(play: backgammon.BackgammonPlay): void {
    const next = [...chosen, play];
    const finished = candidates.find(
      (move) =>
        move.plays.length === next.length &&
        next.every((chosenPlay, index) => samePlay(move.plays[index], chosenPlay)),
    );
    if (finished !== undefined) {
      onMove(finished);
      setChosen([]);
      setFrom(null);
      return;
    }
    setChosen(next);
    setFrom(null);
  }

  function point(index: number) {
    const at = backgammonCell(index);
    const count = game.points[index] as number;
    const seat = count > 0 ? 0 : 1;
    const checkers = Math.abs(count);
    const source = sources.has(index);
    const target = targets.has(index);
    return (
      <button
        key={index}
        type="button"
        style={cellStyle(at.column, at.row)}
        className={`boards__cell boards__cell--point${source ? " boards__cell--legal" : ""}${
          from === index ? " boards__cell--selected" : ""
        }${target ? " boards__cell--target" : ""}${
          marked.has(`from:${String(index)}`) || marked.has(`to:${String(index)}`)
            ? " boards__cell--last"
            : ""
        }`}
        aria-label={`${backgammonSiteName(index)}, ${
          checkers === 0 ? copy.cell.empty : ownerLabel(seats, seat)
        }`}
        disabled={!interactive || !(source || target)}
        onClick={() => {
          if (target && from !== null) {
            const play = targets.get(index) as backgammon.BackgammonPlay;
            advance(play);
            return;
          }
          setFrom(index);
        }}
      >
        {checkers > 0 && (
          <span className={`boards__stack boards__stack--s${seat}`}>
            {Array.from({ length: Math.min(5, checkers) }, (_, checker) => (
              <span key={checker} className={`boards__piece boards__piece--s${seat}`} />
            ))}
            {checkers > 5 && <span className="boards__stack-count">{checkers}</span>}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="boards__backgammon">
      <div className="boards__board boards__board--backgammon" style={gridStyle(BACKGAMMON_COLUMNS, 2)}>
        {Array.from({ length: backgammon.BACKGAMMON_POINTS }, (_, index) => point(index))}
        {[0, 1].map((seat) => {
          const at = backgammonBarCell(seat);
          const count = game.bar[seat] as number;
          const source = sources.has("bar");
          return (
            <button
              key={seat}
              type="button"
              style={cellStyle(at.column, at.row)}
              className={`boards__cell boards__cell--bar${source ? " boards__cell--legal" : ""}${
                from === "bar" ? " boards__cell--selected" : ""
              }`}
              aria-label={`bar, ${ownerLabel(seats, seat)}`}
              disabled={!interactive || !source}
              onClick={() => setFrom("bar")}
            >
              {count > 0 && <span className={`boards__piece boards__piece--s${seat}`} />}
            </button>
          );
        })}
      </div>
      <div className="boards__trays">
        {[0, 1].map((seat) => {
          const count = game.off[seat] as number;
          const target = targets.has("off") && from !== null;
          return (
            <button
              key={seat}
              type="button"
              className={`boards__cell boards__cell--tray${target ? " boards__cell--target" : ""}`}
              aria-label={`off, ${ownerLabel(seats, seat)}`}
              disabled={!interactive || !target}
              onClick={() => {
                const play = targets.get("off");
                if (play !== undefined) advance(play);
              }}
            >
              {count > 0 && <span className={`boards__piece boards__piece--s${seat}`} />}
              <span className="boards__stack-count">{count}</span>
            </button>
          );
        })}
      </div>
      <p className="nx-hint boards__prompt">
        {from === null ? copy.game.pickFrom : copy.game.pickTo}
      </p>
    </div>
  );
}

/** Whether two plays are the same play: the engine's own three fields. */
function samePlay(
  left: backgammon.BackgammonPlay | undefined,
  right: backgammon.BackgammonPlay,
): boolean {
  return left !== undefined && left.from === right.from && left.to === right.to && left.die === right.die;
}

// --- Ludo -------------------------------------------------------------------

/**
 * The track, the four home runs and the yards. A move is one token, so the
 * buttons are the TOKENS: a token that can move is a button, and the track it
 * stands on is a picture. That is what keeps a fifty-two-square board down to at
 * most sixteen tab stops.
 */
export function LudoBoard({ state, moves, seats, interactive, lastEvent, onMove }: BoardProps) {
  const game = state as ludo.LudoState;
  const legal = (moves as ludo.LudoMove[]).map((move) => move.token);
  const last = lastEvent?.kind === "move" ? lastEvent.move : null;

  return (
    <div className="boards__wrap">
    <div className="boards__board boards__board--ludo" style={gridStyle(LUDO_GRID, LUDO_GRID)}>
      {Array.from({ length: ludo.LUDO_TRACK }, (_, square) => {
        const at = ludoTrackCell(square);
        const entry = Array.from({ length: game.seats }, (_, seat) => ludo.ludoEntry(seat)).includes(square);
        return (
          <span
            key={`track-${square}`}
            style={cellStyle(at.column, at.row)}
            className={`boards__cell boards__cell--track${entry ? " boards__cell--entry" : ""}`}
          />
        );
      })}
      {Array.from({ length: game.seats }, (_, seat) =>
        Array.from({ length: ludo.LUDO_HOME_COLUMN }, (_, step) => {
          const at = ludoHomeCell(seat, step);
          return (
            <span
              key={`home-${seat}-${step}`}
              style={cellStyle(at.column, at.row)}
              className={`boards__cell boards__cell--home boards__cell--s${seat}`}
            />
          );
        }),
      )}
      {Array.from({ length: game.seats }, (_, seat) =>
        Array.from({ length: ludo.LUDO_TOKENS }, (_, token) => {
          const at = ludoYardCell(seat, token);
          return (
            <span
              key={`yard-${seat}-${token}`}
              style={cellStyle(at.column, at.row)}
              className={`boards__cell boards__cell--yard boards__cell--s${seat}`}
            />
          );
        }),
      )}
      {Array.from({ length: game.seats }, (_, seat) =>
        Array.from({ length: ludo.LUDO_TOKENS }, (_, token) => {
          const progress = (game.tokens[seat] as readonly number[])[token] as number;
          const at = ludoTokenCell(seat, token, progress);
          const movable = seat === game.toMove && legal.includes(token);
          const moved = last !== null && (last as { token?: number }).token === token && seat === game.toMove;
          return (
            <button
              key={`token-${seat}-${token}`}
              type="button"
              style={cellStyle(at.column, at.row)}
              className={`boards__cell boards__cell--token${movable ? " boards__cell--legal" : ""}${
                moved ? " boards__cell--last" : ""
              }`}
              aria-label={`F${token + 1} ${progress}, ${ownerLabel(seats, seat)}`}
              disabled={!interactive || !movable}
              onClick={() => onMove({ token })}
            >
              <span className={`boards__piece boards__piece--s${seat}`} />
            </button>
          );
        }),
      )}
      <span className="boards__ludo-centre" aria-hidden="true">
        <Icon name="grid" size={18} />
      </span>
    </div>
      <p className="nx-hint boards__prompt">{copy.game.pickFrom}</p>
    </div>
  );
}
