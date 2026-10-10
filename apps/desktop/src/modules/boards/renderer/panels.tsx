import { useEffect, useId } from "react";
import { Button, Card, Checkbox, Chip, Icon, ListRow, Select } from "@nexus/ui";
import { backgammon } from "@nexus/core";
import type { BoardEvent, BoardSeatKind, BoardsGame } from "@nexus/core";
import { declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { numberFormat } from "../../../renderer/src/intl.js";
import { fill } from "../../../renderer/src/strings.js";
import { manifest } from "../shared/manifest.js";
import type { BoardsStatsView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { isPassMove, notationOf } from "./rules.js";
import type { BoardSession, GameSetup } from "./rules.js";
import "./boards.css";

/**
 * The page's smaller surfaces (ADR-090 stage 2): the new-game form, the move list,
 * the record and the result.
 *
 * They live beside the page rather than inside it because each is a thing a reader
 * looks at on its own — what a game is set to, what has been played, how the
 * record stands, and how the last one ended — and the page itself is the driver
 * that knows the session. Splitting them keeps the driver readable and gives each
 * surface a name to be read by.
 */

/** The declared level names, read from the manifest so this file and the settings card cannot disagree. */
const LEVEL_CONTROL = manifest.settings?.controls.find((control) => control.key === "default-level");
export const LEVEL_OPTIONS: readonly number[] =
  LEVEL_CONTROL?.kind === "choice"
    ? LEVEL_CONTROL.options.map((option) => Number(option.id)).sort((left, right) => left - right)
    : [1, 2, 3];

/**
 * The name of one level, in the language being read.
 *
 * Read from the DECLARATION rather than from this module's copy table: the
 * settings card draws the same three words from the same declaration, and a second
 * table would be two chances for the level a card offers and the level a game
 * starts at to be called different things.
 */
export function levelLabel(level: number): string {
  const option =
    LEVEL_CONTROL?.kind === "choice"
      ? LEVEL_CONTROL.options.find((candidate) => Number(candidate.id) === level)
      : undefined;
  return option === undefined ? String(level) : declaredText(option.labelKey);
}

/** The seat kinds as the words the copy table already has for them. */
export function seatLabel(kind: BoardSeatKind): string {
  return kind === "human" ? copy.cell.human : copy.cell.computer;
}

// --- The new-game form ------------------------------------------------------

/** What the form is filled in with before a game starts. */
export interface SetupDraft {
  readonly game: BoardsGame;
  readonly opponent: "computer" | "human";
  readonly level: number;
  /** Ludo's table size, and the kind of every seat at it. */
  readonly seatKinds: readonly BoardSeatKind[];
  readonly variant: "english" | "russian";
  readonly cube: boolean;
}

/** The form a fresh game starts on, with the level the profile prefers. */
export function defaultDraft(game: BoardsGame, defaultLevel: number): SetupDraft {
  return {
    game,
    opponent: "computer",
    level: defaultLevel,
    // Two seats to begin with, whichever game it is: the other four games are
    // always two, and a ludo table of two is the shortest game the form can offer.
    seatKinds: ["human", "computer"],
    variant: "english",
    cube: false,
  };
}

/** The seats a draft asks for, in the shape the session and the store take. */
export function seatsOf(draft: SetupDraft): BoardSeatKind[] {
  if (draft.game === "ludo") return [...draft.seatKinds];
  return draft.opponent === "computer" ? ["human", "computer"] : ["human", "human"];
}

/** The whole setup one draft describes. */
export function setupOf(draft: SetupDraft): GameSetup {
  const seats = seatsOf(draft);
  return {
    seats,
    level: seats.includes("computer") ? draft.level : null,
    variant: draft.game === "draughts" ? draft.variant : null,
    cubeEnabled: draft.game === "backgammon" && draft.cube,
  };
}

/**
 * The new-game form: who plays, how well, and the two options a game's rules have
 * (draughts' rule set, backgammon's cube). Everything is a labelled control, and
 * Escape closes the form without starting anything.
 */
export function SetupPanel({
  draft,
  onChange,
  onStart,
  onCancel,
}: {
  draft: SetupDraft;
  onChange: (next: SetupDraft) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const cubeRowId = useId();

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const computers = seatsOf(draft).includes("computer");

  return (
    <Card
      className="boards__setup"
      title={fill(copy.setup.title, { game: copy.games[draft.game].name })}
    >
      {draft.game === "ludo" ? (
        <div className="boards__fields">
          <Select
            label={copy.setup.seats}
            value={String(draft.seatKinds.length)}
            onChange={(event) => {
              const count = Number(event.target.value);
              onChange({
                ...draft,
                seatKinds: Array.from({ length: count }, (_, index) =>
                  index === 0 ? "human" : draft.seatKinds[index] ?? "computer",
                ) as BoardSeatKind[],
              });
            }}
          >
            {[2, 3, 4].map((count) => (
              <option key={count} value={count}>
                {numberFormat().format(count)}
              </option>
            ))}
          </Select>
          {draft.seatKinds.map((kind, index) => (
            <Select
              key={index}
              label={fill(copy.setup.seat, { number: numberFormat().format(index + 1) })}
              value={kind}
              onChange={(event) => {
                const next = [...draft.seatKinds];
                next[index] = event.target.value as BoardSeatKind;
                onChange({ ...draft, seatKinds: next });
              }}
            >
              <option value="human">{copy.cell.human}</option>
              <option value="computer">{copy.cell.computer}</option>
            </Select>
          ))}
        </div>
      ) : (
        <div className="boards__fields">
          <Select
            label={copy.setup.opponent}
            value={draft.opponent}
            onChange={(event) =>
              onChange({ ...draft, opponent: event.target.value === "human" ? "human" : "computer" })
            }
          >
            <option value="computer">{copy.setup.computer}</option>
            <option value="human">{copy.setup.human}</option>
          </Select>
          {computers && (
            <Select
              label={copy.setup.level}
              value={String(draft.level)}
              onChange={(event) => onChange({ ...draft, level: Number(event.target.value) })}
            >
              {LEVEL_OPTIONS.map((level) => (
                <option key={level} value={level}>
                  {levelLabel(level)}
                </option>
              ))}
            </Select>
          )}
          {draft.game === "draughts" && (
            <Select
              label={copy.setup.rules}
              value={draft.variant}
              onChange={(event) =>
                onChange({ ...draft, variant: event.target.value === "russian" ? "russian" : "english" })
              }
            >
              <option value="english">{copy.setup.english}</option>
              <option value="russian">{copy.setup.russian}</option>
            </Select>
          )}
        </div>
      )}
      {draft.game === "backgammon" && (
        <div className="boards__row">
          <div className="boards__row-text">
            <span id={cubeRowId} className="boards__label">
              {copy.setup.cube}
            </span>
            <span className="nx-hint">{copy.setup.cubeHint}</span>
          </div>
          <Checkbox
            checked={draft.cube}
            aria-labelledby={cubeRowId}
            onChange={(event) => onChange({ ...draft, cube: event.target.checked })}
          />
        </div>
      )}
      <div className="boards__actions">
        <Button variant="primary" onClick={onStart}>
          {copy.setup.start}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {copy.setup.cancel}
        </Button>
      </div>
    </Card>
  );
}

// --- The move list ----------------------------------------------------------

/**
 * The list of everything that has happened: every move in its game's own notation,
 * and the dice, passes and doubled stakes from the words the copy table has for
 * them. A roll is a row because a roll IS a thing that happened — and it is what
 * makes a dice game's history readable at all.
 */
export function MoveList({ session }: { session: BoardSession }) {
  return (
    <Card className="boards__card" title={copy.game.listTitle}>
      {session.events.length === 0 ? (
        <p className="nx-hint">{copy.game.listEmpty}</p>
      ) : (
        <div className="boards__moves">
          {session.events.map((event, index) => (
            <ListRow
              key={index}
              leading={<span className="boards__move-number">{numberFormat().format(index + 1)}</span>}
              className={index === session.events.length - 1 ? "boards__move--last" : undefined}
            >
              <span className="boards__move-text">{eventText(session.game, event)}</span>
            </ListRow>
          ))}
        </div>
      )}
    </Card>
  );
}

/** One event, as a row of the list reads. */
function eventText(game: BoardsGame, event: BoardEvent): string {
  if (event.kind === "roll") {
    return `${copy.moves.roll}: ${event.dice.map((die) => numberFormat().format(die)).join(" ")}`;
  }
  if (event.kind === "pass") return copy.moves.pass;
  if (event.kind === "double") return copy.moves.double;
  if (isPassMove(game, event)) return copy.moves.pass;
  return notationOf(game, event) ?? "";
}

// --- The record -------------------------------------------------------------

/**
 * The record, one row per game (and per variant, where a game has them), read at
 * one level at a time.
 *
 * The level is a control on the card rather than three tables on the page: what a
 * player wants to know is how they stand at the level they are about to play, and
 * eighteen rows of figures would answer that question by hiding it.
 */
export function StatsCard({
  stats,
  level,
  onLevel,
}: {
  stats: readonly BoardsStatsView[];
  level: number;
  onLevel: (level: number) => void;
}) {
  const rows = stats.filter((row) => row.level === level);
  const played = rows.reduce((total, row) => total + row.played, 0);
  return (
    <Card className="boards__card" title={copy.stats.title}>
      <div className="boards__fields">
        <Select label={copy.stats.level} value={String(level)} onChange={(event) => onLevel(Number(event.target.value))}>
          {LEVEL_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {levelLabel(option)}
            </option>
          ))}
        </Select>
      </div>
      {played === 0 ? (
        <p className="nx-hint">{copy.stats.none}</p>
      ) : (
        <div className="boards__stats">
          <div className="boards__stats-head nx-eyebrow">
            <span>{copy.lobby.title}</span>
            <span>{copy.stats.played}</span>
            <span>{copy.stats.won}</span>
            <span>{copy.stats.drawn}</span>
            <span>{copy.stats.lost}</span>
          </div>
          {rows
            .filter((row) => row.played > 0)
            .map((row) => (
              <div className="boards__stats-row" key={`${row.game}-${row.variant}`}>
                <span className="boards__stats-name">
                  {copy.games[row.game].name}
                  {row.variant !== "" && (
                    <Chip className="boards__stats-variant">
                      {copy.stats.variant[row.variant as "english" | "russian"]}
                    </Chip>
                  )}
                </span>
                <span className="boards__stats-number">{numberFormat().format(row.played)}</span>
                <span className="boards__stats-number">{numberFormat().format(row.won)}</span>
                <span className="boards__stats-number">{numberFormat().format(row.drawn)}</span>
                <span className="boards__stats-number">{numberFormat().format(row.lost)}</span>
              </div>
            ))}
        </div>
      )}
      <p className="nx-hint">{copy.stats.caption}</p>
    </Card>
  );
}

// --- The end of a game ------------------------------------------------------

/** How a game ended, in the words the copy table has, and what to do about it. */
export function ResultPanel({
  title,
  onRecord,
  onNewGame,
}: {
  title: string;
  onRecord: () => void;
  onNewGame: () => void;
}) {
  return (
    <Card className="boards__card boards__result" title={copy.result.title}>
      <p className="boards__result-text">
        <Icon name="success" size={18} /> {title}
      </p>
      <p className="nx-hint">{copy.result.note}</p>
      <div className="boards__actions">
        <Button variant="primary" onClick={onRecord}>
          {copy.game.record}
        </Button>
        <Button onClick={onNewGame}>{copy.game.newGame}</Button>
      </div>
    </Card>
  );
}

/** The one place a caller reads a cube value, so a game without one cannot print it. */
export function cubeText(value: number | null): string | null {
  return value === null ? null : fill(copy.game.cube, { value: numberFormat().format(value) });
}

/** The die or dice the position is waiting on, as the move list writes them. */
export function diceText(state: unknown, game: BoardsGame): string | null {
  if (game === "backgammon") {
    const dice = (state as backgammon.BackgammonState).dice;
    return dice.length === 0 ? null : dice.map((die) => numberFormat().format(die)).join(" ");
  }
  const die = game === "ludo" ? (state as { die: number | null }).die : null;
  return die === null ? null : numberFormat().format(die);
}

/**
 * Whether a game rolls dice at all: the two whose turn begins with a throw, and
 * not the four whose move is the whole of it. Stated as the games rather than
 * asked of an opening position, because "does this game have dice" is a property
 * of the game and not of the position a game happens to start in.
 */
export function rollsDice(game: BoardsGame): boolean {
  return game === "backgammon" || game === "ludo";
}
