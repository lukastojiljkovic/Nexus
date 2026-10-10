/**
 * Ludo (`Ne ljuti se, čoveče`) — two to four seats of four tokens each, a 52
 * square track, each seat's own home column, and an exact roll to finish.
 *
 * Rules source: the standard game as it is printed for the Serbian board
 * ("Ne ljuti se, čoveče") and for Ludo generally — a six to bring a token out
 * of its yard, a token that lands on another's square sending it home, every
 * seat entering the track at its own square and leaving it into its own home
 * column, and a roll that overshoots home being unplayable. The three variant
 * points the brief names as options are `extraTurnOnSix`, `threeSixesLoseTurn`
 * and `safeSquares`; see `LUDO_DEFAULTS` for what each defaults to and why.
 *
 * WHERE THE DICE COME FROM. `rollFor` rolls the die into the state from the
 * caller's seeded source, `legalMoves` and `bestMove` refuse to work before
 * that (`must-roll`), and a move clears the die. So the state machine is:
 * `die === null` means "roll", a playable die means "move", and a die with no
 * legal move at all means `endTurn` — which is also what a sixth that nothing
 * can use does, the extra roll being forfeited with it.
 *
 * The state alternates sides EXCEPT when a six grants another roll, so the
 * computer's search here is a hand-written expectimax over the six faces rather
 * than the shared negamax (`boards-shared/search.ts`), which flips the sign of
 * every child and would score a roll that never passed as if it had. See
 * mlin's header for the same hazard in a different costume.
 *
 * `Player` from `boards-shared/outcome.ts` is `0 | 1` and this game has up to
 * four seats, so the result type here is its own — the same reason backgammon's
 * is.
 *
 * Pure: no I/O, no clock, no `Math.random`.
 */

import { InvalidStateError } from "../boards-shared/errors.js";
import type { Rng } from "../boards-shared/rng.js";
import { rollDie, shuffled } from "../boards-shared/rng.js";
import type { Choice } from "../boards-shared/search.js";

/** The squares of the track. */
export const LUDO_TRACK = 52;
/** Tokens a seat. */
export const LUDO_TOKENS = 4;
/** Squares in a seat's own home column, the last of which is home. */
export const LUDO_HOME_COLUMN = 6;
/** The progress a token has when it is home: 51 track squares, then six more. */
export const LUDO_HOME = 51 + LUDO_HOME_COLUMN;
/** How far apart the seats' entry squares are. */
export const LUDO_STRIDE = 13;

/**
 * The three variants, with the defaults the game is played by here. An extra
 * roll for a six and losing the turn on a third six are the two the brief
 * names; the safe squares are the four entry squares, which is the Serbian
 * house rule and the reason a capture is not always available.
 */
export const LUDO_DEFAULTS = {
  extraTurnOnSix: true,
  threeSixesLoseTurn: true,
  safeSquares: true,
} as const;

/** Progress `0` in the yard, `1..51` on the track, `52..57` in the home column. */
export type LudoProgress = number;

export interface LudoState {
  /** How many seats are playing: 2..4, seated 0, 1, 2, 3 in turn order. */
  readonly seats: number;
  /** `tokens[seat][token]` is that token's progress. */
  readonly tokens: readonly (readonly number[])[];
  readonly toMove: number;
  /** The die awaiting a move, or `null` when the side to move must roll. */
  readonly die: number | null;
  /** Sixes rolled in a row this turn. */
  readonly sixes: number;
  readonly extraTurnOnSix: boolean;
  readonly threeSixesLoseTurn: boolean;
  readonly safeSquares: boolean;
}

/** A move is one token: the die decides where it goes. */
export interface LudoMove {
  readonly token: number;
}

export interface LudoOptions {
  readonly seats?: number | undefined;
  readonly tokens?: readonly (readonly number[])[] | undefined;
  readonly toMove?: number | undefined;
  readonly die?: number | null | undefined;
  readonly sixes?: number | undefined;
  readonly extraTurnOnSix?: boolean | undefined;
  readonly threeSixesLoseTurn?: boolean | undefined;
  readonly safeSquares?: boolean | undefined;
}

/** One difficulty: how deep the expectimax over the die may go, and its budget. */
export interface LudoLevel {
  /**
   * Faces examined. Level 1 reads the position after each move and nothing
   * else, level 2 adds the opponent's best answer to each face, level 3 adds
   * the mover's own answer behind that.
   */
  readonly plies: number;
  /** Positions expanded; reaching it returns the best move found so far. */
  readonly nodeBudget: number;
}

export const LUDO_LEVELS: readonly LudoLevel[] = [
  { plies: 0, nodeBudget: 500 },
  { plies: 1, nodeBudget: 3_000 },
  { plies: 2, nodeBudget: 12_000 },
];

/** Where a seat enters the track. */
export function ludoEntry(seat: number): number {
  return (seat * LUDO_STRIDE) % LUDO_TRACK;
}

/** The track square a token of `seat` stands on at `progress`, or `null` in the yard. */
export function ludoSquare(seat: number, progress: LudoProgress): number | null {
  if (progress < 1 || progress > 51) return null;
  return (ludoEntry(seat) + progress - 1) % LUDO_TRACK;
}

/** True when every one of a seat's tokens is home. */
export function ludoFinished(state: LudoState, seat: number): boolean {
  const tokens = state.tokens[seat] as readonly number[];
  for (let token = 0; token < LUDO_TOKENS; token += 1) {
    if ((tokens[token] as number) !== LUDO_HOME) return false;
  }
  return true;
}

export interface LudoWin {
  readonly status: "win";
  readonly winner: number;
  readonly reason: "finished";
}

export type LudoResult = { readonly status: "in_progress" } | LudoWin;

export function initialState(options: LudoOptions = {}): LudoState {
  const seats = options.seats ?? 2;
  if (!Number.isInteger(seats) || seats < 2 || seats > 4) throw new InvalidStateError("seats");
  const tokens = options.tokens ?? Array.from({ length: seats }, () => new Array<number>(LUDO_TOKENS).fill(0));
  if (tokens.length !== seats) throw new InvalidStateError("tokens-seats");
  for (const seatTokens of tokens) {
    if (seatTokens.length !== LUDO_TOKENS) throw new InvalidStateError("tokens-length");
    for (const progress of seatTokens) {
      if (!Number.isInteger(progress) || progress < 0 || progress > LUDO_HOME) {
        throw new InvalidStateError("tokens-progress");
      }
    }
  }
  const toMove = options.toMove ?? 0;
  if (!Number.isInteger(toMove) || toMove < 0 || toMove >= seats) throw new InvalidStateError("toMove");
  const die = options.die ?? null;
  if (die !== null && (!Number.isInteger(die) || die < 1 || die > 6)) {
    throw new InvalidStateError("die");
  }
  const sixes = options.sixes ?? 0;
  if (!Number.isInteger(sixes) || sixes < 0 || sixes > 3) throw new InvalidStateError("sixes");
  return {
    seats,
    tokens: tokens.map((seatTokens) => seatTokens.slice()),
    toMove,
    die,
    sixes,
    extraTurnOnSix: options.extraTurnOnSix ?? LUDO_DEFAULTS.extraTurnOnSix,
    threeSixesLoseTurn: options.threeSixesLoseTurn ?? LUDO_DEFAULTS.threeSixesLoseTurn,
    safeSquares: options.safeSquares ?? LUDO_DEFAULTS.safeSquares,
  };
}

function nextSeat(state: LudoState): number {
  return (state.toMove + 1) % state.seats;
}

/**
 * Rolls the die for the side to move. Refuses when a die is already waiting,
 * and a third six in a row takes the turn away with it when the variant says
 * so — the roll that did it included.
 */
export function rollFor(state: LudoState, rng: Rng): LudoState {
  if (state.die !== null) throw new InvalidStateError("already-rolled");
  if (result(state).status !== "in_progress") throw new InvalidStateError("over");
  const die = rollDie(rng, 6);
  if (die === 6 && state.threeSixesLoseTurn && state.sixes >= 2) {
    return { ...state, die: null, sixes: 0, toMove: nextSeat(state) };
  }
  return { ...state, die, sixes: die === 6 ? state.sixes + 1 : 0 };
}

export function result(state: LudoState): LudoResult {
  for (let seat = 0; seat < state.seats; seat += 1) {
    if (ludoFinished(state, seat)) return { status: "win", winner: seat, reason: "finished" };
  }
  return { status: "in_progress" };
}

/** Every token the die can move: a six from the yard, otherwise an exact fit. */
export function legalMoves(state: LudoState): LudoMove[] {
  if (state.die === null) return [];
  if (result(state).status !== "in_progress") return [];
  const moves: LudoMove[] = [];
  const tokens = state.tokens[state.toMove] as readonly number[];
  for (let token = 0; token < LUDO_TOKENS; token += 1) {
    const progress = tokens[token] as number;
    if (progress === LUDO_HOME) continue;
    if (progress === 0) {
      if (state.die === 6) moves.push({ token });
      continue;
    }
    if (progress + state.die <= LUDO_HOME) moves.push({ token });
  }
  return moves;
}

export function applyMove(state: LudoState, move: LudoMove): LudoState {
  if (!legalMoves(state).some((candidate) => candidate.token === move.token)) {
    throw new InvalidStateError("illegal");
  }
  const die = state.die as number;
  const seat = state.toMove;
  const tokens = state.tokens.map((seatTokens) => seatTokens.slice());
  const mine = tokens[seat] as number[];
  const progress = mine[move.token] as number;
  const next = progress === 0 ? 1 : progress + die;
  mine[move.token] = next;
  const square = ludoSquare(seat, next);
  if (square !== null) {
    // A capture sends every enemy token on that square back to its yard, unless
    // the square is one of the four safe entry squares and the variant says so.
    const safe =
      state.safeSquares &&
      Array.from({ length: state.seats }, (_, other) => ludoEntry(other)).includes(square);
    if (!safe) {
      for (let other = 0; other < state.seats; other += 1) {
        if (other === seat) continue;
        const theirs = tokens[other] as number[];
        for (let token = 0; token < LUDO_TOKENS; token += 1) {
          const theirProgress = theirs[token] as number;
          if (ludoSquare(other, theirProgress) === square) theirs[token] = 0;
        }
      }
    }
  }
  if (die === 6 && state.extraTurnOnSix) {
    // The six earns another roll for the same seat, which is the one state here
    // in which the side to move does not change.
    return { ...state, tokens, die: null, sixes: state.sixes };
  }
  return { ...state, tokens, toMove: nextSeat(state), die: null, sixes: 0 };
}

/**
 * Passes the turn when the die cannot be played — including a six that nothing
 * can use, whose extra roll goes with it.
 */
export function endTurn(state: LudoState): LudoState {
  if (state.die === null) throw new InvalidStateError("must-roll");
  if (legalMoves(state).length > 0) throw new InvalidStateError("moves-remain");
  return { ...state, die: null, sixes: 0, toMove: nextSeat(state) };
}

/**
 * Our own evaluation of a position for one seat: how far the tokens have come,
 * how many are home, how many are exposed to capture within one die, and how
 * many enemy tokens this seat could take. Every OTHER seat's progress counts
 * against this one, which is what makes a capture worth something: sending a
 * token back to its yard takes back everything it had travelled.
 *
 * The weights are ours — a home token is worth a fifth of the journey on top of
 * the journey itself, an exposed track token costs about a sixth of the track,
 * and a capture opportunity is a chance rather than a gain.
 */
const HOME_WORTH = 20;
const THREAT = 6;
const HIT_CHANCE = 4;

export function evaluateFrom(state: LudoState, seat: number): number {
  const mine = state.tokens[seat] as readonly number[];
  let score = 0;
  for (let token = 0; token < LUDO_TOKENS; token += 1) {
    const progress = mine[token] as number;
    score += progress === LUDO_HOME ? LUDO_HOME + HOME_WORTH : progress;
  }
  for (let other = 0; other < state.seats; other += 1) {
    if (other === seat) continue;
    const theirs = state.tokens[other] as readonly number[];
    for (let token = 0; token < LUDO_TOKENS; token += 1) {
      const progress = theirs[token] as number;
      score -= progress === LUDO_HOME ? LUDO_HOME + HOME_WORTH : progress;
      const square = ludoSquare(other, progress);
      if (square === null) continue;
      if (state.safeSquares && isSafe(state, square)) continue;
      // The track runs the same way for every seat, so an enemy token one to
      // six squares BEHIND this one can take it.
      for (let mineToken = 0; mineToken < LUDO_TOKENS; mineToken += 1) {
        const mySquare = ludoSquare(seat, mine[mineToken] as number);
        if (mySquare === null) continue;
        const reach = (square - mySquare + LUDO_TRACK) % LUDO_TRACK;
        if (reach >= 1 && reach <= 6) score += HIT_CHANCE;
      }
    }
  }
  for (let token = 0; token < LUDO_TOKENS; token += 1) {
    const progress = mine[token] as number;
    const square = ludoSquare(seat, progress);
    if (square === null) continue;
    if (state.safeSquares && isSafe(state, square)) continue;
    for (let other = 0; other < state.seats; other += 1) {
      if (other === seat) continue;
      const theirs = state.tokens[other] as readonly number[];
      for (let enemy = 0; enemy < LUDO_TOKENS; enemy += 1) {
        const enemySquare = ludoSquare(other, theirs[enemy] as number);
        if (enemySquare === null) continue;
        const reach = (square - enemySquare + LUDO_TRACK) % LUDO_TRACK;
        if (reach >= 1 && reach <= 6) score -= THREAT;
      }
    }
  }
  return score;
}

function isSafe(state: LudoState, square: number): boolean {
  for (let seat = 0; seat < state.seats; seat += 1) {
    if (ludoEntry(seat) === square) return true;
  }
  return false;
}

interface Budget {
  nodes: number;
  readonly limit: number;
}

/**
 * The value for `seat` of a position in which `seat` is to roll: the average
 * over the six faces of the best move, recursing while `plies` lasts. The extra
 * roll a six grants is not a sign flip — the same seat keeps the turn, so the
 * value is taken from the same side and not negated.
 */
function expectedValue(state: LudoState, seat: number, plies: number, budget: Budget): number {
  if (plies <= 0 || result(state).status !== "in_progress") return evaluateFrom(state, seat);
  let total = 0;
  for (let die = 1; die <= 6; die += 1) {
    const rolled: LudoState = { ...state, die, toMove: seat };
    const moves = legalMoves(rolled);
    budget.nodes += 1;
    if (budget.nodes > budget.limit) return total / 6;
    if (moves.length === 0) {
      const passed = endTurn(rolled);
      total += -expectedValue(passed, passed.toMove, plies - 1, budget);
      continue;
    }
    let best = Number.NEGATIVE_INFINITY;
    for (const move of moves) {
      const applied = applyMove(rolled, move);
      const value =
        applied.toMove === seat && applied.die === null
          ? expectedValue(applied, seat, plies - 1, budget)
          : -expectedValue(applied, applied.toMove, plies - 1, budget);
      if (value > best) best = value;
    }
    total += best;
  }
  return total / 6;
}

function levelLimit(level: number): LudoLevel {
  const index = Math.min(Math.max(Math.floor(level), 1), LUDO_LEVELS.length) - 1;
  return LUDO_LEVELS[index] as LudoLevel;
}

/**
 * The computer's move. `level` is 1..3, anything outside is clamped, and the
 * seeded `rng` only breaks ties — the faces are enumerated, never sampled, so
 * the answer is the same for the same seed. Refuses (`must-roll`) before the
 * die is rolled. `Choice.depth` is the level's `plies` and `Choice.cut` says
 * the budget ended the work.
 */
export function bestMove(state: LudoState, level: number, rng: Rng): Choice<LudoMove> {
  if (result(state).status !== "in_progress") {
    return { move: null, score: 0, depth: 0, nodes: 0, cut: false };
  }
  if (state.die === null) throw new InvalidStateError("must-roll");
  const limits = levelLimit(level);
  const moves = shuffled(rng, legalMoves(state));
  if (moves.length === 0) return { move: null, score: 0, depth: 0, nodes: 0, cut: false };
  const budget: Budget = { nodes: 0, limit: limits.nodeBudget };
  const seat = state.toMove;
  let best = moves[0] as LudoMove;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const move of moves) {
    const applied = applyMove(state, move);
    // Every play read is a node, so the budget and the reported count cover the
    // levels that only read the position as well as the ones that roll on.
    budget.nodes += 1;
    const value =
      applied.toMove === seat && applied.die === null
        ? expectedValue(applied, seat, limits.plies, budget)
        : -expectedValue(applied, applied.toMove, limits.plies, budget);
    if (value > bestScore) {
      bestScore = value;
      best = move;
    }
  }
  return {
    move: best,
    score: bestScore,
    depth: limits.plies,
    nodes: budget.nodes,
    cut: budget.nodes > budget.limit,
  };
}

/** The shape `toJSON` writes and `fromJSON` accepts. */
export interface LudoJson {
  readonly seats: number;
  readonly tokens: readonly (readonly number[])[];
  readonly toMove: number;
  readonly die: number | null;
  readonly sixes: number;
  readonly extraTurnOnSix: boolean;
  readonly threeSixesLoseTurn: boolean;
  readonly safeSquares: boolean;
}

export function toJSON(state: LudoState): LudoJson {
  return {
    seats: state.seats,
    tokens: state.tokens.map((seatTokens) => seatTokens.slice()),
    toMove: state.toMove,
    die: state.die,
    sixes: state.sixes,
    extraTurnOnSix: state.extraTurnOnSix,
    threeSixesLoseTurn: state.threeSixesLoseTurn,
    safeSquares: state.safeSquares,
  };
}

export function fromJSON(value: unknown): LudoState {
  if (typeof value !== "object" || value === null) throw new InvalidStateError("json");
  const record = value as Record<string, unknown>;
  const tokens = record["tokens"];
  if (!Array.isArray(tokens)) throw new InvalidStateError("tokens");
  const die = record["die"];
  if (die !== null && die !== undefined && typeof die !== "number") {
    throw new InvalidStateError("die");
  }
  const boolean = (field: string): boolean => {
    const raw = record[field];
    if (typeof raw !== "boolean") throw new InvalidStateError(field);
    return raw;
  };
  return initialState({
    seats: record["seats"] as number,
    tokens: tokens as readonly (readonly number[])[],
    toMove: record["toMove"] as number,
    die: die === undefined ? null : (die as number | null),
    sixes: record["sixes"] as number,
    extraTurnOnSix: boolean("extraTurnOnSix"),
    threeSixesLoseTurn: boolean("threeSixesLoseTurn"),
    safeSquares: boolean("safeSquares"),
  });
}
