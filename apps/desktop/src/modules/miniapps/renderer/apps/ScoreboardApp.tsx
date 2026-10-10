import { useState } from "react";
import { Button, Card, Chip, ListRow, TextField } from "@nexus/ui";
import {
  SCOREBOARD_MAX_NAME_LENGTH,
  SCOREBOARD_MAX_SCORE,
  ScoreboardError,
  emptyScoreboardState,
  scoreboardCanRedo,
  scoreboardCanUndo,
  scoreboardIsOver,
  scoreboardReduce,
  scoreboardStandings,
  type ScoreboardAction,
  type ScoreboardErrorCode,
  type ScoreboardState,
} from "@nexus/core";
import { copy } from "../copy.js";
import { randomId } from "../entropy.js";
import { formatCount } from "../format.js";
import type { MiniAppProps } from "./contract.js";

/**
 * The scoreboard (mini-apps): players, rounds, totals, standings - kept.
 *
 * **The reducer owns the board; the page owns the session.** `scoreboardReduce`
 * carries the undo stack of whole boards, so a mistake in round four is undone
 * by the engine rather than by arithmetic here, and the page writes the
 * resulting BOARD (never the stacks) so what a restore brings back is the game
 * as it stands rather than the ability to undo somebody else's last move.
 *
 * **Whole numbers only, and the engine's rule is what the cell enforces.** A
 * total is compared by equality - that is what a ranking is - so a fractional
 * score is refused rather than rounded: the cell accepts an integer in
 * `-SCOREBOARD_MAX_SCORE..SCOREBOARD_MAX_SCORE` and says so when the text is not
 * one, instead of silently dropping the character.
 *
 * **Why the score cells carry `aria-label` rather than a visible label.** A cell
 * of a grid is named by its row and its column - the two things the eye already
 * has - and a caption per cell would draw thirty names on a board that is
 * already a table. `TextField`'s own contract has an arm for exactly this case.
 */
function scoreboardErrorText(code: ScoreboardErrorCode): string {
  switch (code) {
    case "name":
      return copy.scoreboard.nameError;
    case "player-limit":
      return copy.scoreboard.limitError;
    case "round-limit":
      return copy.scoreboard.roundLimit;
    case "target-range":
      return copy.scoreboard.targetError;
    case "id":
    case "duplicate-id":
    case "unknown-player":
    case "unknown-round":
    case "score-range":
      // Unreachable from this page: the ids are minted here, a cell can only
      // name a player who is on the board, and a round can only be acted on
      // while it is drawn.
      return copy.errors.mutate;
  }
}

/** A score cell's text as the integer the engine will take, or `null`. */
function scoreOf(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d{1,6}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Math.abs(value) <= SCOREBOARD_MAX_SCORE ? value : null;
}

export function ScoreboardApp({ profileId, view, run }: MiniAppProps) {
  const [state, setState] = useState<ScoreboardState>(() => ({
    ...emptyScoreboardState(),
    ...view.scoreboard,
  }));
  const [playerName, setPlayerName] = useState("");
  const [targetText, setTargetText] = useState(
    view.scoreboard.target === null ? "" : String(view.scoreboard.target),
  );
  const [cells, setCells] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function act(action: ScoreboardAction): void {
    const next = scoreboardReduce(state, action);
    if (next === state) return;
    setState(next);
    setProblem(null);
    // The cells are a cache of what was typed, keyed by round index: a round
    // added or removed renumbers them, so the cache goes rather than pointing at
    // the wrong game.
    if (action.type === "add-round" || action.type === "remove-round") setCells({});
    void run((api) =>
      api.saveScoreboard({
        profileId,
        board: { players: next.players, rounds: next.rounds, target: next.target },
      }),
    );
  }

  function attempt(action: ScoreboardAction): void {
    try {
      act(action);
    } catch (error) {
      setProblem(
        error instanceof ScoreboardError ? scoreboardErrorText(error.code) : copy.errors.mutate,
      );
    }
  }

  function commitTarget(text: string): void {
    setTargetText(text);
    const trimmed = text.trim();
    if (trimmed === "") {
      attempt({ type: "set-target", target: null });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value < 1) {
      setProblem(copy.scoreboard.targetError);
      return;
    }
    attempt({ type: "set-target", target: value });
  }

  function commitCell(round: number, playerId: string, text: string): void {
    setCells((current) => ({ ...current, [`${round}:${playerId}`]: text }));
    const value = scoreOf(text);
    if (value === null) {
      if (text.trim() !== "") setProblem(copy.errors.mutate);
      return;
    }
    setProblem(null);
    act({ type: "set-score", round, playerId, score: value });
  }

  const standings = scoreboardStandings(state);

  return (
    <div className="miniapps__app">
      <Card className="miniapps__card" title={copy.scoreboard.players}>
        <div className="miniapps__row">
          <TextField
            label={copy.scoreboard.playerName}
            className="miniapps__wide-field"
            maxLength={SCOREBOARD_MAX_NAME_LENGTH}
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              const trimmed = playerName.trim();
              if (trimmed !== "") attempt({ type: "add-player", id: randomId(), name: trimmed });
              setPlayerName("");
            }}
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              const trimmed = playerName.trim();
              if (trimmed !== "") attempt({ type: "add-player", id: randomId(), name: trimmed });
              setPlayerName("");
            }}
          >
            {copy.scoreboard.addPlayer}
          </Button>
        </div>
        {state.players.length === 0 ? (
          <p className="nx-hint">{`${copy.scoreboard.empty} ${copy.scoreboard.emptyBody}`}</p>
        ) : (
          <div className="miniapps__list">
            {state.players.map((player) =>
              renaming === player.id ? (
                <div key={player.id} className="miniapps__edit-row">
                  <TextField
                    label={copy.actions.rename}
                    maxLength={SCOREBOARD_MAX_NAME_LENGTH}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <div className="miniapps__row">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        const trimmed = draft.trim();
                        setRenaming(null);
                        if (trimmed.length > 0) {
                          attempt({ type: "rename-player", id: player.id, name: trimmed });
                        }
                      }}
                    >
                      {copy.actions.save}
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setRenaming(null)}>
                      {copy.actions.cancel}
                    </Button>
                  </div>
                </div>
              ) : (
                <ListRow
                  key={player.id}
                  trailing={
                    <span className="miniapps__row-actions">
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-label={`${copy.actions.rename}: ${player.name}`}
                        onClick={() => {
                          setRenaming(player.id);
                          setDraft(player.name);
                        }}
                      >
                        {copy.actions.rename}
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-label={`${copy.actions.remove}: ${player.name}`}
                        onClick={() => attempt({ type: "remove-player", id: player.id })}
                      >
                        {copy.actions.remove}
                      </Button>
                    </span>
                  }
                >
                  <span className="miniapps__row-name">{player.name}</span>
                </ListRow>
              ),
            )}
          </div>
        )}
        {problem !== null && <p className="miniapps__field-error">{problem}</p>}
      </Card>

      <Card className="miniapps__card" title={copy.scoreboard.rounds}>
        <div className="miniapps__row">
          <Button
            size="sm"
            disabled={state.players.length === 0}
            onClick={() => attempt({ type: "add-round" })}
          >
            {copy.scoreboard.addRound}
          </Button>
          <TextField
            label={copy.scoreboard.target}
            className="miniapps__number-field"
            inputMode="numeric"
            value={targetText}
            onChange={(event) => commitTarget(event.target.value)}
          />
          <span className="nx-hint">{copy.scoreboard.targetHint}</span>
          <Button size="sm" disabled={!scoreboardCanUndo(state)} onClick={() => act({ type: "undo" })}>
            {copy.actions.undo}
          </Button>
          <Button size="sm" disabled={!scoreboardCanRedo(state)} onClick={() => act({ type: "redo" })}>
            {copy.actions.redo}
          </Button>
        </div>
        {scoreboardIsOver(state) && <p className="miniapps__readout">{copy.scoreboard.over}</p>}
        {state.rounds.length > 0 && (
          <div className="miniapps__table-wrap">
            <table className="miniapps__table">
              <thead>
                <tr>
                  <th scope="col">{copy.scoreboard.round}</th>
                  {state.players.map((player) => (
                    <th key={player.id} scope="col">
                      {player.name}
                    </th>
                  ))}
                  <th scope="col">{copy.actions.remove}</th>
                </tr>
              </thead>
              <tbody>
                {state.rounds.map((round, index) => (
                  <tr key={index}>
                    <th scope="row">{formatCount(index + 1)}</th>
                    {state.players.map((player) => {
                      const key = `${index}:${player.id}`;
                      return (
                        <td key={player.id}>
                          <TextField
                            aria-label={`${copy.scoreboard.round} ${formatCount(index + 1)}: ${player.name}`}
                            className="miniapps__cell-field"
                            inputMode="numeric"
                            value={cells[key] ?? formatCount(round.scores[player.id] ?? 0)}
                            onChange={(event) => commitCell(index, player.id, event.target.value)}
                          />
                        </td>
                      );
                    })}
                    <td>
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-label={copy.scoreboard.removeRound}
                        onClick={() => attempt({ type: "remove-round", round: index })}
                      >
                        {copy.actions.remove}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="miniapps__card" title={copy.scoreboard.standings}>
        {standings.length === 0 ? (
          <p className="nx-hint">{copy.scoreboard.empty}</p>
        ) : (
          <>
            <div className="nx-eyebrow miniapps__standings-head">
              <span>{copy.scoreboard.rank}</span>
              <span>{copy.scoreboard.total}</span>
            </div>
            <div className="miniapps__list">
              {standings.map((row) => (
                <ListRow
                  key={row.player.id}
                  leading={<span className="miniapps__rank">{formatCount(row.rank)}</span>}
                  trailing={
                    <span className="miniapps__row-actions">
                      {row.tied && <Chip>{copy.scoreboard.tied}</Chip>}
                      <span className="miniapps__history-result">{formatCount(row.total)}</span>
                    </span>
                  }
                >
                  <span className="miniapps__row-name">{row.player.name}</span>
                  <span className="miniapps__step-note">
                    {`${copy.scoreboard.won}: ${formatCount(row.roundsWon)}`}
                  </span>
                </ListRow>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
