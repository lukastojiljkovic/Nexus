/**
 * Backgammon (`Tavla`) — 24 points, fifteen checkers a side, the bar, bearing
 * off, and the doubling cube behind an option.
 *
 * Rules source: the standard rules as the U.S. Backgammon Federation states
 * them — the opening position, entering from the bar, a blocked point, the
 * compulsory use of both dice and of the larger one when only one can be
 * played, doubles counting four times, bearing off with an exact number or with
 * a number higher than any point that still holds a checker, and the single,
 * gammon and backgammon results. No existing engine's code was read or copied.
 *
 * ONE MOVE IS ONE TURN. A move is the whole set of checker plays for the dice
 * that were rolled, so `legalMoves` answers "what can be done with these two
 * numbers (or these four, for a double)" — the rules above included — and the
 * side to move changes exactly once per move. That is also the shape negamax
 * needs; see mlin's header. The dice themselves come from the caller's seeded
 * source: `rollFor` rolls them into the state, `legalMoves` and `bestMove`
 * refuse to work before that (they throw `must-roll`), and applying a move
 * clears them. A saved game therefore replays its dice.
 *
 * The cube is a state field and three functions rather than a move:
 * `canDouble`, `applyDouble` (the cube doubles and passes to the opponent) and
 * `declineDouble` (the doubler scores the cube as it stood). Stage 2 drives the
 * offer and the answer; whether the cube is in play at all is `cubeEnabled`.
 *
 * Pure: no I/O, no clock, no `Math.random`.
 */

import { InvalidStateError } from "../boards-shared/errors.js";
import type { Player } from "../boards-shared/outcome.js";
import type { SeededRandom } from "../random.js";
import { rollDice, shuffled } from "../random.js";
import type { Choice } from "../boards-shared/search.js";

export const BACKGAMMON_POINTS = 24;
export const BACKGAMMON_CHECKERS = 15;

/** A square, the bar, or off the board. A point is an index `0..23`. */
export type BackgammonSite = number | "bar" | "off";

/** One checker's play: the die it used, where it came from and where it went. */
export interface BackgammonPlay {
  readonly from: BackgammonSite;
  readonly to: BackgammonSite;
  readonly die: number;
}

/** A whole turn: the plays for the dice that were rolled, in order. */
export interface BackgammonMove {
  readonly plays: readonly BackgammonPlay[];
}

export interface BackgammonState {
  /** 24 points, positive for seat 0's checkers and negative for seat 1's. */
  readonly points: readonly number[];
  readonly bar: readonly [number, number];
  readonly off: readonly [number, number];
  readonly toMove: Player;
  /** The dice of the turn in progress; empty means the side has to roll. */
  readonly dice: readonly number[];
  readonly cube: number;
  /** `null` for a centred cube, which either side may double. */
  readonly cubeOwner: Player | null;
  readonly cubeEnabled: boolean;
}

export interface BackgammonOptions {
  readonly points?: readonly number[] | undefined;
  readonly bar?: readonly [number, number] | undefined;
  readonly off?: readonly [number, number] | undefined;
  readonly toMove?: Player | undefined;
  readonly dice?: readonly number[] | undefined;
  readonly cube?: number | undefined;
  readonly cubeOwner?: Player | null | undefined;
  readonly cubeEnabled?: boolean | undefined;
}

export interface BackgammonWin {
  readonly status: "win";
  readonly winner: Player;
  readonly kind: "single" | "gammon" | "backgammon";
  /** 1, 2 or 3 — what the kind multiplies the cube by. */
  readonly multiplier: 1 | 2 | 3;
  readonly cube: number;
  /** `multiplier * cube`: what the game is worth. */
  readonly points: number;
}

export type BackgammonResult = { readonly status: "in_progress" } | BackgammonWin;

/** What a refused double is worth: the cube as it stood, to the doubler. */
export interface BackgammonDecline {
  readonly winner: Player;
  readonly kind: "declined";
  readonly points: number;
}

/** One difficulty: how much the computer is allowed to look at. */
export interface BackgammonLevel {
  /**
   * Positions expanded while choosing. Reaching it stops the work where it
   * stands and returns the best play found so far, so a move never takes long.
   */
  readonly nodeBudget: number;
  /**
   * How many of the best-looking plays get the opponent's answer looked at,
   * roll by roll. Level 1 keeps the static evaluation, level 2 adds the shot
   * risk of every position, level 3 looks at the opponent's best answer to its
   * six best plays.
   */
  readonly replies: number;
}

export const BACKGAMMON_LEVELS: readonly BackgammonLevel[] = [
  { nodeBudget: 2_000, replies: 0 },
  { nodeBudget: 10_000, replies: 0 },
  { nodeBudget: 40_000, replies: 6 },
];

/** The 36 rolls of two dice, in order. */
const ROLLS: readonly (readonly [number, number])[] = buildRolls();

function buildRolls(): [number, number][] {
  const rolls: [number, number][] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) rolls.push([first, second]);
  }
  return rolls;
}

export function backgammonOpponent(player: Player): Player {
  return player === 0 ? 1 : 0;
}

/**
 * How many pips a checker on `index` is from bearing off, for `player`. Seat 0
 * bears off from points 1..6 and seat 1 from points 19..24, so the index runs
 * the other way for seat 1.
 */
export function backgammonDistance(player: Player, index: number): number {
  return player === 0 ? index + 1 : BACKGAMMON_POINTS - index;
}

/** The standard opening: fifteen checkers a side, cube centred at one. */
export function backgammonOpening(): Pick<BackgammonState, "points" | "bar" | "off"> {
  const points = new Array<number>(BACKGAMMON_POINTS).fill(0);
  points[23] = 2;
  points[12] = 5;
  points[7] = 3;
  points[5] = 5;
  points[0] = -2;
  points[11] = -5;
  points[16] = -3;
  points[18] = -5;
  return { points, bar: [0, 0], off: [0, 0] };
}

export function initialState(options: BackgammonOptions = {}): BackgammonState {
  const opening = backgammonOpening();
  const points = options.points ?? opening.points;
  if (points.length !== BACKGAMMON_POINTS) throw new InvalidStateError("points-length");
  for (const count of points) {
    if (!Number.isInteger(count) || Math.abs(count) > BACKGAMMON_CHECKERS) {
      throw new InvalidStateError("points-count");
    }
  }
  const bar = options.bar ?? opening.bar;
  const off = options.off ?? opening.off;
  for (const site of [bar, off]) {
    if (site.length !== 2) throw new InvalidStateError("sites-length");
    for (const count of site) {
      if (!Number.isInteger(count) || count < 0 || count > BACKGAMMON_CHECKERS) {
        throw new InvalidStateError("sites-count");
      }
    }
  }
  // Fifteen checkers a side, wherever they stand: a position that lost or gained
  // one is not a backgammon position, and stage 2 hands untrusted values here.
  for (let seat = 0; seat < 2; seat += 1) {
    let total = (bar[seat] as number) + (off[seat] as number);
    for (const count of points) total += seat === 0 ? Math.max(0, count) : Math.max(0, -count);
    if (total !== BACKGAMMON_CHECKERS) throw new InvalidStateError("checkers");
  }
  const toMove = options.toMove ?? 0;
  if (toMove !== 0 && toMove !== 1) throw new InvalidStateError("toMove");
  const dice = options.dice ?? [];
  if (dice.length !== 0 && dice.length !== 2 && dice.length !== 4) {
    throw new InvalidStateError("dice-length");
  }
  for (const die of dice) {
    if (!Number.isInteger(die) || die < 1 || die > 6) throw new InvalidStateError("dice-face");
  }
  const cube = options.cube ?? 1;
  if (!Number.isInteger(cube) || cube < 1 || (cube & (cube - 1)) !== 0) {
    throw new InvalidStateError("cube");
  }
  const cubeOwner = options.cubeOwner ?? null;
  if (cubeOwner !== null && cubeOwner !== 0 && cubeOwner !== 1) {
    throw new InvalidStateError("cubeOwner");
  }
  const cubeEnabled = options.cubeEnabled ?? false;
  if (typeof cubeEnabled !== "boolean") throw new InvalidStateError("cubeEnabled");
  return {
    points: points.slice(),
    bar: [bar[0], bar[1]],
    off: [off[0], off[1]],
    toMove,
    dice: dice.slice(),
    cube,
    cubeOwner,
    cubeEnabled,
  };
}

/** A working copy of everything a play changes. */
interface Turn {
  readonly board: number[];
  readonly bar: [number, number];
  readonly off: [number, number];
}

function turnOf(state: BackgammonState): Turn {
  return {
    board: state.points.slice(),
    bar: [state.bar[0], state.bar[1]],
    off: [state.off[0], state.off[1]],
  };
}

function withTurn(state: BackgammonState, turn: Turn): BackgammonState {
  return { ...state, points: turn.board, bar: turn.bar, off: turn.off };
}

function mineAt(turn: Turn, player: Player, index: number): boolean {
  const count = turn.board[index] as number;
  return player === 0 ? count > 0 : count < 0;
}

/** True when `player` may not land on `index`: two or more enemy checkers there. */
function blocked(turn: Turn, player: Player, index: number): boolean {
  const count = turn.board[index] as number;
  return player === 0 ? count <= -2 : count >= 2;
}

/** True when every one of `player`'s checkers is in its own home board. */
function allHome(turn: Turn, player: Player): boolean {
  if ((turn.bar[player] as number) > 0) return false;
  for (let index = 0; index < BACKGAMMON_POINTS; index += 1) {
    if (!mineAt(turn, player, index)) continue;
    if (backgammonDistance(player, index) > 6) return false;
  }
  return true;
}

/** The occupied point furthest from bearing off: the one a high die bears off. */
function furthest(turn: Turn, player: Player): number {
  let furthestIndex = -1;
  let furthestDistance = -1;
  for (let index = 0; index < BACKGAMMON_POINTS; index += 1) {
    if (!mineAt(turn, player, index)) continue;
    const distance = backgammonDistance(player, index);
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }
  return furthestIndex;
}

/**
 * Every single play of one die. Entering from the bar is compulsory when a
 * checker is there; a blocked point is no destination; and bearing off needs
 * either the exact number or a number larger than the distance of the checker
 * that is furthest from home — never a smaller one.
 */
function singlePlays(
  turn: Turn,
  player: Player,
  die: number,
): { from: BackgammonSite; to: BackgammonSite }[] {
  const plays: { from: BackgammonSite; to: BackgammonSite }[] = [];
  if ((turn.bar[player] as number) > 0) {
    const target = player === 0 ? BACKGAMMON_POINTS - die : die - 1;
    if (!blocked(turn, player, target)) plays.push({ from: "bar", to: target });
    return plays;
  }
  const bearingOff = allHome(turn, player);
  const highest = bearingOff ? furthest(turn, player) : -1;
  for (let index = 0; index < BACKGAMMON_POINTS; index += 1) {
    if (!mineAt(turn, player, index)) continue;
    const target = player === 0 ? index - die : index + die;
    if (target >= 0 && target < BACKGAMMON_POINTS) {
      if (!blocked(turn, player, target)) plays.push({ from: index, to: target });
      continue;
    }
    if (!bearingOff) continue;
    const distance = backgammonDistance(player, index);
    if (distance === die || (die > distance && index === highest)) {
      plays.push({ from: index, to: "off" });
    }
  }
  return plays;
}

/** Where one checker play leads, hits included. Never touches `turn`. */
function playOne(turn: Turn, player: Player, from: BackgammonSite, to: BackgammonSite): Turn {
  const board = turn.board.slice();
  const bar: [number, number] = [turn.bar[0], turn.bar[1]];
  const off: [number, number] = [turn.off[0], turn.off[1]];
  const sign = player === 0 ? 1 : -1;
  if (typeof from === "number") board[from] = (board[from] as number) - sign;
  else bar[player] -= 1;
  if (typeof to === "number") {
    // A blot is a single enemy checker, and landing on it sends it to the bar.
    const occupant = board[to] as number;
    if (player === 0 ? occupant === -1 : occupant === 1) {
      board[to] = 0;
      bar[backgammonOpponent(player)] += 1;
    }
    board[to] = (board[to] as number) + sign;
  } else {
    off[player] += 1;
  }
  return { board, bar, off };
}

function keyOf(turn: Turn): string {
  return `${turn.board.join(",")}|${turn.bar[0]},${turn.bar[1]}|${turn.off[0]},${turn.off[1]}`;
}

/**
 * Every legal turn for `dice`: as many dice played as possible, the larger die
 * when only one can be played at all, and one entry per distinct resulting
 * position — two play orders that end in the same place are one move.
 */
function playsFor(turn: Turn, player: Player, dice: readonly number[]): BackgammonPlay[][] {
  const complete: { plays: BackgammonPlay[]; key: string; largest: number }[] = [];
  const walk = (position: Turn, remaining: number[], plays: BackgammonPlay[]): void => {
    let extended = false;
    for (const die of new Set(remaining)) {
      for (const play of singlePlays(position, player, die)) {
        extended = true;
        const next = remaining.slice();
        next.splice(next.indexOf(die), 1);
        plays.push({ from: play.from, to: play.to, die });
        walk(playOne(position, player, play.from, play.to), next, plays);
        plays.pop();
      }
    }
    if (!extended) {
      complete.push({
        plays: plays.slice(),
        key: keyOf(position),
        largest: plays.reduce((most, play) => Math.max(most, play.die), 0),
      });
    }
  };
  walk(turn, dice.slice(), []);
  const most = complete.reduce((count, entry) => Math.max(count, entry.plays.length), 0);
  // A position where no die can be played at all has no turn, and the caller
  // ends the turn instead: an empty "move" would be a move that moves nothing.
  if (most === 0) return [];
  let best = complete.filter((entry) => entry.plays.length === most);
  const faces = [...new Set(dice)];
  if (most === 1 && faces.length > 1) {
    const larger = Math.max(...faces);
    const withLarger = best.filter((entry) => entry.largest === larger);
    if (withLarger.length > 0) best = withLarger;
  }
  const seen = new Set<string>();
  const legal: BackgammonPlay[][] = [];
  for (const entry of best) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    legal.push(entry.plays);
  }
  return legal;
}

/**
 * The dice for the side to move. Refuses when it already has dice — the caller
 * rolls once per turn — and a double is stored as the four plays it is worth.
 */
export function rollFor(state: BackgammonState, rng: SeededRandom): BackgammonState {
  if (state.dice.length > 0) throw new InvalidStateError("already-rolled");
  if (result(state).status === "win") throw new InvalidStateError("over");
  const [first, second] = rollDice(rng, 2, 6) as [number, number];
  const dice = first === second ? [first, first, first, first] : [first, second];
  return { ...state, dice };
}

/** Every legal turn of the dice already rolled; empty when there is none. */
export function legalMoves(state: BackgammonState): BackgammonMove[] {
  if (state.dice.length === 0) return [];
  return playsFor(turnOf(state), state.toMove, state.dice).map((plays) => ({ plays }));
}

export function applyMove(state: BackgammonState, move: BackgammonMove): BackgammonState {
  const match = legalMoves(state).find((candidate) => sameMove(candidate, move));
  if (match === undefined) throw new InvalidStateError("illegal");
  let turn = turnOf(state);
  for (const play of move.plays) turn = playOne(turn, state.toMove, play.from, play.to);
  return withTurn(
    { ...state, toMove: backgammonOpponent(state.toMove), dice: [] },
    turn,
  );
}

function sameMove(a: BackgammonMove, b: BackgammonMove): boolean {
  if (a.plays.length !== b.plays.length) return false;
  return a.plays.every((play, index) => {
    const other = b.plays[index] as BackgammonPlay;
    return play.from === other.from && play.to === other.to && play.die === other.die;
  });
}

/**
 * Passes the turn when the rolled dice have no legal turn at all. Refuses while
 * a turn exists: a side plays the dice it was given.
 */
export function endTurn(state: BackgammonState): BackgammonState {
  if (state.dice.length === 0) throw new InvalidStateError("must-roll");
  if (legalMoves(state).length > 0) throw new InvalidStateError("moves-remain");
  return { ...state, toMove: backgammonOpponent(state.toMove), dice: [] };
}

/**
 * The single, gammon and backgammon results. A gammon is the loser having borne
 * nothing off; a backgammon adds that the loser also has a checker in the
 * winner's home board or on the bar.
 */
export function result(state: BackgammonState): BackgammonResult {
  if ((state.off[0] as number) !== BACKGAMMON_CHECKERS && (state.off[1] as number) !== BACKGAMMON_CHECKERS) {
    return { status: "in_progress" };
  }
  const winner: Player = (state.off[0] as number) === BACKGAMMON_CHECKERS ? 0 : 1;
  const loser = backgammonOpponent(winner);
  let kind: BackgammonWin["kind"] = "single";
  if ((state.off[loser] as number) === 0) {
    kind = "gammon";
    if ((state.bar[loser] as number) > 0 || inWinnersHome(state, winner, loser)) {
      kind = "backgammon";
    }
  }
  const multiplier = kind === "single" ? 1 : kind === "gammon" ? 2 : 3;
  return {
    status: "win",
    winner,
    kind,
    multiplier,
    cube: state.cube,
    points: multiplier * state.cube,
  };
}

/** True when the loser still has a checker in the winner's home board. */
function inWinnersHome(state: BackgammonState, winner: Player, loser: Player): boolean {
  const turn = turnOf(state);
  for (let index = 0; index < BACKGAMMON_POINTS; index += 1) {
    if (!mineAt(turn, loser, index)) continue;
    if (backgammonDistance(winner, index) <= 6) return true;
  }
  return false;
}

/** True when `player` may offer the cube: it is in play, centred or theirs. */
export function canDouble(state: BackgammonState, player: Player): boolean {
  if (!state.cubeEnabled) return false;
  if (state.toMove !== player || state.dice.length > 0) return false;
  return state.cubeOwner === null || state.cubeOwner === player;
}

/** The double: the cube doubles and passes to the opponent, who must answer. */
export function applyDouble(state: BackgammonState, player: Player): BackgammonState {
  if (!canDouble(state, player)) throw new InvalidStateError("cannot-double");
  return { ...state, cube: state.cube * 2, cubeOwner: backgammonOpponent(player) };
}

/** The double refused: the doubler scores the cube as it stood. */
export function declineDouble(state: BackgammonState, player: Player): BackgammonDecline {
  if (!canDouble(state, player)) throw new InvalidStateError("cannot-double");
  return { winner: player, kind: "declined", points: state.cube };
}

/** How many pips `player` has left to travel, with 25 for a checker on the bar. */
export function pipCount(state: BackgammonState, player: Player): number {
  let pips = 25 * (state.bar[player] as number);
  for (let index = 0; index < BACKGAMMON_POINTS; index += 1) {
    const count = state.points[index] as number;
    const mine = player === 0 ? Math.max(0, count) : Math.max(0, -count);
    pips += mine * backgammonDistance(player, index);
  }
  return pips;
}

/** Points holding two or more of `player`'s checkers. */
function madePoints(state: BackgammonState, player: Player): number {
  const sign = player === 0 ? 1 : -1;
  let made = 0;
  for (const count of state.points) if (count * sign >= 2) made += 1;
  return made;
}

/** Points holding exactly one of `player`'s checkers — the ones that can be hit. */
function blotsOf(state: BackgammonState, player: Player): number[] {
  const sign = player === 0 ? 1 : -1;
  const blots: number[] = [];
  for (let index = 0; index < BACKGAMMON_POINTS; index += 1) {
    if ((state.points[index] as number) * sign === 1) blots.push(index);
  }
  return blots;
}

/**
 * Our own evaluation, in the order the brief names its terms: pip count, the
 * bar, made points, blots and safety. Pips are the race, one point each; a
 * checker on the bar is 20 because it has to enter and then travel; a made
 * point is 3 because it blocks; a blot is -8 because it can be hit and sent
 * back; and the shot term is -10 per blot the opponent can reach with one die,
 * averaged over the 36 rolls.
 */
const BAR_WEIGHT = 20;
const MADE_WEIGHT = 3;
const BLOT_WEIGHT = 8;
const SHOT_WEIGHT = 10;

export function evaluateFrom(state: BackgammonState, player: Player): number {
  const opponent = backgammonOpponent(player);
  return (
    pipCount(state, opponent) -
    pipCount(state, player) +
    BAR_WEIGHT * ((state.bar[opponent] as number) - (state.bar[player] as number)) +
    MADE_WEIGHT * (madePoints(state, player) - madePoints(state, opponent)) -
    BLOT_WEIGHT * (blotsOf(state, player).length - blotsOf(state, opponent).length) -
    SHOT_WEIGHT * shotRisk(state, player)
  );
}

/**
 * The average number of `player`'s blots an enemy checker can reach with ONE
 * die, over the 36 rolls. Deliberately a distance count and not a play search:
 * it asks whether the blot is reachable at all, which is what makes a position
 * unsafe, and it costs a constant per roll.
 */
function shotRisk(state: BackgammonState, player: Player): number {
  const opponent = backgammonOpponent(player);
  const blots = blotsOf(state, player);
  if (blots.length === 0) return 0;
  const onBar = (state.bar[opponent] as number) > 0;
  let hits = 0;
  for (const [first, second] of ROLLS) {
    for (const blot of blots) {
      const distance = backgammonDistance(opponent, blot);
      if (distance === first || distance === second) hits += 1;
      else if (onBar) {
        // A checker on the bar can enter with one die and reach a blot in the
        // opponent's home board with the other.
        const entered = opponent === 0 ? BACKGAMMON_POINTS - first : first - 1;
        if (backgammonDistance(opponent, blot) - backgammonDistance(opponent, entered) === second) {
          hits += 1;
        }
      }
    }
  }
  return hits / ROLLS.length;
}

interface Budget {
  nodes: number;
  readonly limit: number;
}

/**
 * The level-3 value: the static score of the position a play leads to, less the
 * opponent's best static answer averaged over the 36 rolls. The budget is
 * counted per roll examined, and a position whose examination the budget stops
 * keeps its static score.
 */
function valueWithReplies(after: BackgammonState, player: Player, budget: Budget): number {
  const opponent = backgammonOpponent(player);
  let total = 0;
  for (const [first, second] of ROLLS) {
    const dice = first === second ? [first, first, first, first] : [first, second];
    if (budget.nodes >= budget.limit) return evaluateFrom(after, player) - total / ROLLS.length;
    budget.nodes += 1;
    let best = evaluateFrom(after, opponent);
    for (const reply of playsFor(turnOf(after), opponent, dice)) {
      let turn = turnOf(after);
      for (const play of reply) turn = playOne(turn, opponent, play.from, play.to);
      const scored = evaluateFrom(withTurn(after, turn), opponent);
      if (scored > best) best = scored;
    }
    total += best;
  }
  return evaluateFrom(after, player) - total / ROLLS.length;
}

function levelLimit(level: number): BackgammonLevel {
  const index = Math.min(Math.max(Math.floor(level), 1), BACKGAMMON_LEVELS.length) - 1;
  return BACKGAMMON_LEVELS[index] as BackgammonLevel;
}

/**
 * The computer's turn. `level` is 1..3, anything outside is clamped. Refuses
 * (`must-roll`) before the dice are rolled, because a backgammon decision is a
 * decision about dice. `Choice.depth` is 1 at level 3, where the opponent's
 * answers are examined, and 0 at the levels that only read the position;
 * `Choice.cut` says the budget ended the work. The seeded `rng` breaks ties, so
 * the same seed plays the same move.
 */
export function bestMove(
  state: BackgammonState,
  level: number,
  rng: SeededRandom,
): Choice<BackgammonMove> {
  if (result(state).status === "win") {
    return { move: null, score: 0, depth: 0, nodes: 0, cut: false };
  }
  if (state.dice.length === 0) throw new InvalidStateError("must-roll");
  const limits = levelLimit(level);
  const budget: Budget = { nodes: 0, limit: limits.nodeBudget };
  const moves = shuffled(legalMoves(state), rng);
  if (moves.length === 0) return { move: null, score: 0, depth: 0, nodes: 0, cut: false };
  const player = state.toMove;
  const scored = moves.map((move) => ({
    move,
    after: applyMove(state, move),
    score: 0,
  }));
  for (const entry of scored) entry.score = evaluateFrom(entry.after, player);
  // Every play read is a node, so the budget and the reported count cover the
  // static levels too and not only the reply search.
  budget.nodes += scored.length;
  scored.sort((a, b) => b.score - a.score);
  if (limits.replies === 0) {
    const best = scored[0] as (typeof scored)[number];
    return { move: best.move, score: best.score, depth: 0, nodes: budget.nodes, cut: false };
  }
  const examined = Math.min(limits.replies, scored.length);
  for (let index = 0; index < examined; index += 1) {
    const entry = scored[index] as (typeof scored)[number];
    entry.score = valueWithReplies(entry.after, player, budget);
  }
  // Only the examined plays are ranked: a play no reply was looked at for
  // cannot be shown to beat one that was, and the budget says how many are.
  let best = scored[0] as (typeof scored)[number];
  for (let index = 1; index < examined; index += 1) {
    const entry = scored[index] as (typeof scored)[number];
    if (entry.score > best.score) best = entry;
  }
  return { move: best.move, score: best.score, depth: 1, nodes: budget.nodes, cut: budget.nodes >= budget.limit };
}

/** The shape `toJSON` writes and `fromJSON` accepts. */
export interface BackgammonJson {
  readonly points: readonly number[];
  readonly bar: readonly [number, number];
  readonly off: readonly [number, number];
  readonly toMove: Player;
  readonly dice: readonly number[];
  readonly cube: number;
  readonly cubeOwner: Player | null;
  readonly cubeEnabled: boolean;
}

export function toJSON(state: BackgammonState): BackgammonJson {
  return {
    points: state.points.slice(),
    bar: [state.bar[0], state.bar[1]],
    off: [state.off[0], state.off[1]],
    toMove: state.toMove,
    dice: state.dice.slice(),
    cube: state.cube,
    cubeOwner: state.cubeOwner,
    cubeEnabled: state.cubeEnabled,
  };
}

export function fromJSON(value: unknown): BackgammonState {
  if (typeof value !== "object" || value === null) throw new InvalidStateError("json");
  const record = value as Record<string, unknown>;
  const points = record["points"];
  const bar = record["bar"];
  const off = record["off"];
  if (!Array.isArray(points) || !Array.isArray(bar) || !Array.isArray(off)) {
    throw new InvalidStateError("json");
  }
  const toMove = record["toMove"];
  const dice = record["dice"];
  if (!Array.isArray(dice)) throw new InvalidStateError("dice");
  const cubeOwner = record["cubeOwner"];
  return initialState({
    points: points as readonly number[],
    bar: [bar[0] as number, bar[1] as number],
    off: [off[0] as number, off[1] as number],
    toMove: (toMove === 0 || toMove === 1 ? toMove : -1) as Player,
    dice: dice as readonly number[],
    cube: record["cube"] as number,
    cubeOwner:
      cubeOwner === null || cubeOwner === undefined ? (cubeOwner as null | undefined) : (cubeOwner as Player),
    cubeEnabled: record["cubeEnabled"] as boolean,
  });
}
