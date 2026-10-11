/**
 * The scoreboard (mini-apps, stage 1): players or teams, a score per round,
 * totals, an optional target score that ends the game, a leader, and ties said
 * out loud.
 *
 * Like `tally.ts` this is a pure reducer with `past`/`future` stacks of the
 * WHOLE board, so undo restores players, rounds and target together and no
 * action needs an inverse written by hand.
 *
 * **Scores are whole numbers.** A total is compared by equality — that is what a
 * ranking is — and two sums of decimals are equal exactly when they happen to
 * land on the same double, which is not a rule anybody can explain to the person
 * looking at the board. So a fractional score is refused here rather than
 * rounded, and a page that wants half points has to choose its own unit (a
 * scoreboard counting tenths would set the step to 1 and label them tenths).
 * For the same reason a tie is exact equality and no epsilon appears anywhere in
 * this file.
 *
 * A round's winner is the single player with the highest score in it: a tied
 * round has no winner, which is stated rather than broken in the roster's
 * favour.
 */

import { MAX_ID_LENGTH } from "../ids.js";

/** Board limits, stated here because stage 2's IPC layer validates against them too. */
export const SCOREBOARD_MAX_PLAYERS = 32;
export const SCOREBOARD_MAX_NAME_LENGTH = 40;
export const SCOREBOARD_MAX_ROUNDS = 100;
export const SCOREBOARD_MAX_SCORE = 100_000;

export type ScoreboardErrorCode =
  | "id"
  | "name"
  | "player-limit"
  | "duplicate-id"
  | "unknown-player"
  | "unknown-round"
  | "round-limit"
  | "score-range"
  | "target-range";

/** An action no board can carry out, named so stage 2 can turn the code into its own copy. */
export class ScoreboardError extends Error {
  readonly code: ScoreboardErrorCode;

  constructor(code: ScoreboardErrorCode, message: string) {
    super(message);
    this.name = "ScoreboardError";
    this.code = code;
  }
}

export interface ScoreboardPlayer {
  readonly id: string;
  readonly name: string;
}

/** One round's scores, keyed by player id. Every player of the board is present. */
export interface ScoreboardRound {
  readonly scores: Readonly<Record<string, number>>;
}

/** The board without its history — what `past` and `future` hold. */
export interface ScoreboardBoard {
  readonly players: readonly ScoreboardPlayer[];
  readonly rounds: readonly ScoreboardRound[];
  readonly target: number | null;
}

export interface ScoreboardState extends ScoreboardBoard {
  /** The board before each change, oldest first. */
  readonly past: readonly ScoreboardBoard[];
  /** Undone boards, the next redo last. */
  readonly future: readonly ScoreboardBoard[];
}

export type ScoreboardAction =
  | { readonly type: "add-player"; readonly id: string; readonly name: string }
  | { readonly type: "rename-player"; readonly id: string; readonly name: string }
  | { readonly type: "remove-player"; readonly id: string }
  /** A new round; every player missing from `scores` is recorded with zero. */
  | { readonly type: "add-round"; readonly scores?: Readonly<Record<string, number>> }
  | {
      readonly type: "set-score";
      readonly round: number;
      readonly playerId: string;
      readonly score: number;
    }
  | { readonly type: "remove-round"; readonly round: number }
  | { readonly type: "set-target"; readonly target: number | null }
  | { readonly type: "undo" }
  | { readonly type: "redo" };

export interface ScoreboardStanding {
  readonly player: ScoreboardPlayer;
  readonly total: number;
  /** Competition ranking: equal totals share a rank and the next rank skips. */
  readonly rank: number;
  readonly tied: boolean;
  /** Rounds this player won outright; a tied round is nobody's win. */
  readonly roundsWon: number;
}

export function emptyScoreboardState(): ScoreboardState {
  return { players: [], rounds: [], target: null, past: [], future: [] };
}

function assertId(id: string): void {
  if (typeof id !== "string" || id.trim() === "") {
    throw new ScoreboardError("id", "a player needs an id");
  }
  if (id.length > MAX_ID_LENGTH) throw new ScoreboardError("id", "the player id is too long");
}

function assertName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new ScoreboardError("name", "a player needs a name");
  if (trimmed.length > SCOREBOARD_MAX_NAME_LENGTH) {
    throw new ScoreboardError(
      "name",
      `a player name holds ${SCOREBOARD_MAX_NAME_LENGTH} characters at most`,
    );
  }
  return trimmed;
}

function assertScore(score: number): void {
  if (!Number.isInteger(score) || Math.abs(score) > SCOREBOARD_MAX_SCORE) {
    throw new ScoreboardError(
      "score-range",
      `a score is a whole number from -${SCOREBOARD_MAX_SCORE} to ${SCOREBOARD_MAX_SCORE}`,
    );
  }
}

/** The board part of a state, for the history stacks. */
function board(state: ScoreboardState): ScoreboardBoard {
  return { players: state.players, rounds: state.rounds, target: state.target };
}

function commit(state: ScoreboardState, next: ScoreboardBoard): ScoreboardState {
  return { ...next, past: [...state.past, board(state)], future: [] };
}

function requirePlayer(state: ScoreboardState, id: string): ScoreboardPlayer {
  const player = state.players.find((held) => held.id === id);
  if (player === undefined) throw new ScoreboardError("unknown-player", `no player ${id}`);
  return player;
}

function requireRound(state: ScoreboardState, index: number): ScoreboardRound {
  if (!Number.isInteger(index) || index < 0 || index >= state.rounds.length) {
    throw new ScoreboardError("unknown-round", `there is no round ${index}`);
  }
  return state.rounds[index] as ScoreboardRound;
}

/** One player's total across every round; zero for a player who never scored. */
export function scoreboardTotalFor(state: ScoreboardState, playerId: string): number {
  requirePlayer(state, playerId);
  return state.rounds.reduce((sum, played) => sum + (played.scores[playerId] ?? 0), 0);
}

export function scoreboardCanUndo(state: ScoreboardState): boolean {
  return state.past.length > 0;
}

export function scoreboardCanRedo(state: ScoreboardState): boolean {
  return state.future.length > 0;
}

export function scoreboardReduce(
  state: ScoreboardState,
  action: ScoreboardAction,
): ScoreboardState {
  switch (action.type) {
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return {
        ...previous,
        past: state.past.slice(0, -1),
        future: [...state.future, board(state)],
      };
    }
    case "redo": {
      const next = state.future[state.future.length - 1];
      if (next === undefined) return state;
      return {
        ...next,
        past: [...state.past, board(state)],
        future: state.future.slice(0, -1),
      };
    }
    case "add-player": {
      assertId(action.id);
      if (state.players.some((player) => player.id === action.id)) {
        throw new ScoreboardError("duplicate-id", `there is already a player ${action.id}`);
      }
      if (state.players.length >= SCOREBOARD_MAX_PLAYERS) {
        throw new ScoreboardError(
          "player-limit",
          `a board holds ${SCOREBOARD_MAX_PLAYERS} players at most`,
        );
      }
      const name = assertName(action.name);
      // Rounds already played gain a zero column, so the totals of the players
      // who were there do not move when somebody joins mid-game.
      return commit(state, {
        players: [...state.players, { id: action.id, name }],
        rounds: state.rounds.map((played) => ({
          scores: { ...played.scores, [action.id]: 0 },
        })),
        target: state.target,
      });
    }
    case "rename-player": {
      const player = requirePlayer(state, action.id);
      const name = assertName(action.name);
      if (name === player.name) return state;
      return commit(state, {
        players: state.players.map((held) => (held.id === action.id ? { ...held, name } : held)),
        rounds: state.rounds,
        target: state.target,
      });
    }
    case "remove-player": {
      requirePlayer(state, action.id);
      return commit(state, {
        players: state.players.filter((player) => player.id !== action.id),
        rounds: state.rounds.map((played) => {
          const scores: Record<string, number> = {};
          for (const [id, score] of Object.entries(played.scores)) {
            if (id !== action.id) scores[id] = score;
          }
          return { scores };
        }),
        target: state.target,
      });
    }
    case "add-round": {
      if (state.rounds.length >= SCOREBOARD_MAX_ROUNDS) {
        throw new ScoreboardError("round-limit", `a board holds ${SCOREBOARD_MAX_ROUNDS} rounds at most`);
      }
      const scores: Record<string, number> = {};
      for (const player of state.players) scores[player.id] = 0;
      for (const [id, score] of Object.entries(action.scores ?? {})) {
        requirePlayer(state, id);
        assertScore(score);
        scores[id] = score;
      }
      return commit(state, {
        players: state.players,
        rounds: [...state.rounds, { scores }],
        target: state.target,
      });
    }
    case "set-score": {
      requireRound(state, action.round);
      requirePlayer(state, action.playerId);
      assertScore(action.score);
      const current = state.rounds[action.round] as ScoreboardRound;
      if (current.scores[action.playerId] === action.score) return state;
      return commit(state, {
        players: state.players,
        rounds: state.rounds.map((played, index) =>
          index === action.round
            ? { scores: { ...played.scores, [action.playerId]: action.score } }
            : played,
        ),
        target: state.target,
      });
    }
    case "remove-round": {
      requireRound(state, action.round);
      return commit(state, {
        players: state.players,
        rounds: state.rounds.filter((_played, index) => index !== action.round),
        target: state.target,
      });
    }
    case "set-target": {
      if (action.target !== null && (!Number.isInteger(action.target) || action.target < 1)) {
        throw new ScoreboardError("target-range", "a target is a whole number of one or more");
      }
      if (action.target === state.target) return state;
      return commit(state, { players: state.players, rounds: state.rounds, target: action.target });
    }
  }
}

/** Rounds each player won outright, counted per round in `state.rounds` order. */
function roundsWon(state: ScoreboardState): Map<string, number> {
  const won = new Map<string, number>();
  for (const played of state.rounds) {
    let best: number | null = null;
    let winners = 0;
    let winnerId = "";
    for (const player of state.players) {
      const score = played.scores[player.id] ?? 0;
      if (best === null || score > best) {
        best = score;
        winners = 1;
        winnerId = player.id;
      } else if (score === best) {
        winners += 1;
      }
    }
    if (winners === 1) won.set(winnerId, (won.get(winnerId) ?? 0) + 1);
  }
  return won;
}

/**
 * The standings, best first. Equal totals share a rank and the following rank
 * skips (1, 1, 3), and `tied` says so on each of the rows that share one. Ties
 * keep the order the players were added in, so a board that has not been played
 * yet reads in the roster's order rather than an arbitrary one.
 */
export function scoreboardStandings(state: ScoreboardState): ScoreboardStanding[] {
  const won = roundsWon(state);
  const rows = state.players.map((player) => ({
    player,
    total: scoreboardTotalFor(state, player.id),
  }));
  rows.sort((left, right) => right.total - left.total);
  return rows.map((row) => ({
    player: row.player,
    total: row.total,
    rank: rows.filter((other) => other.total > row.total).length + 1,
    tied: rows.filter((other) => other.total === row.total).length > 1,
    roundsWon: won.get(row.player.id) ?? 0,
  }));
}

/**
 * Every player at the top total, in roster order. Before the first round that is
 * every player — the tie is stated rather than hidden behind an empty list — and
 * a board with no players has no leader at all.
 */
export function scoreboardLeaders(state: ScoreboardState): ScoreboardPlayer[] {
  if (state.players.length === 0) return [];
  const best = Math.max(...state.players.map((player) => scoreboardTotalFor(state, player.id)));
  return state.players.filter((player) => scoreboardTotalFor(state, player.id) === best);
}

/** True once any total reaches the target; a board without a target never ends. */
export function scoreboardIsOver(state: ScoreboardState): boolean {
  if (state.target === null) return false;
  return scoreboardReachedTarget(state).length > 0;
}

/** The players at or past the target, in roster order; empty when there is no target. */
export function scoreboardReachedTarget(state: ScoreboardState): ScoreboardPlayer[] {
  if (state.target === null) return [];
  const target = state.target;
  return state.players.filter((player) => scoreboardTotalFor(state, player.id) >= target);
}
