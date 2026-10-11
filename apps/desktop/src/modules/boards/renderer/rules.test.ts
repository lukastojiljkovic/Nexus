import { describe, expect, it } from "vitest";
import {
  backgammon,
  boardEngine,
  createSeededRandom,
  fourInARow,
  ludo,
  reversi,
} from "@nexus/core";
import type { BoardSeatKind } from "@nexus/core";
import {
  CUBE_DECLINE_PIPS,
  CUBE_OFFER_PIPS,
  awaitingHuman,
  beginTurn,
  canOfferCube,
  canUndo,
  computerOffersCube,
  computerTakesCube,
  cubeAnswerSeat,
  cubeAwaitingAnswer,
  isOver,
  legalMovesOf,
  moveSeed,
  mustRoll,
  newSession,
  outcomeOf,
  savedSession,
  turnSeatOf,
  withCubeAnswer,
  withDeclinedCube,
  withDouble,
  withMove,
  withPass,
  withRoll,
  withUndo,
} from "./rules.js";
import type { BoardSession, GameSetup } from "./rules.js";

/**
 * The page's own turn logic (ADR-090 stage 2). What is pinned here is what the
 * engines cannot answer: whose turn it is on the SCREEN, what one click does to the
 * session, when an undo exists and what it restores, and the two policies the
 * module owns (the computer's doubling cube, and the per-move search stream).
 */

const TWO_PLAYERS: readonly BoardSeatKind[] = ["human", "computer"];

function setup(overrides: Partial<GameSetup> = {}): GameSetup {
  return {
    seats: TWO_PLAYERS,
    level: 1,
    variant: null,
    cubeEnabled: false,
    ...overrides,
  };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

describe("a new session", () => {
  it("begins where the engine's own opening begins, per game", () => {
    expect(same(newSession("reversi", setup(), 1).state, reversi.initialState())).toBe(true);
    const russian = newSession("draughts", setup({ variant: "russian" }), 1);
    expect((russian.state as { kind: string }).kind).toBe("russian");
    const ludoThree = newSession("ludo", setup({ seats: ["human", "computer", "computer"] }), 1);
    expect((ludoThree.state as ludo.LudoState).seats).toBe(3);
    const cubed = newSession("backgammon", setup({ cubeEnabled: true }), 1);
    expect((cubed.state as backgammon.BackgammonState).cubeEnabled).toBe(true);
  });

  it("carries the seed, the seats and the level, and asks the computer's seat first when it is seat 0", () => {
    const session = newSession("four-in-a-row", setup({ seats: ["computer", "human"] }), 99);
    expect(session.seed).toBe(99);
    expect(session.rng).toBe(99);
    expect(session.seats).toEqual(["computer", "human"]);
    expect(session.level).toBe(1);
    expect(awaitingHuman(session)).toBe(false);
    expect(turnSeatOf(session)).toBe(0);
  });
});

describe("one click, one transition", () => {
  it("rolls from the game's own stream and records what came out", () => {
    const session = newSession("backgammon", setup(), 7);
    expect(mustRoll(session)).toBe(true);
    const rolled = withRoll(session);
    const dice = (rolled.state as backgammon.BackgammonState).dice;
    expect(rolled.events).toHaveLength(1);
    expect(rolled.events[0]).toEqual({ kind: "roll", dice: [...dice] });
    expect(rolled.rng).not.toBe(session.rng);
    // The same seed rolls the same dice: a game is its seed.
    const again = withRoll(newSession("backgammon", setup(), 7));
    expect(again.events).toEqual(rolled.events);
    expect(mustRoll(rolled)).toBe(false);
  });

  it("plays a legal move as the event the log records and the position it leads to", () => {
    const session = newSession("reversi", setup(), 3);
    const move = legalMovesOf(session)[0] as reversi.ReversiMove;
    const played = withMove(session, move);
    expect(played.events).toEqual([{ kind: "move", move }]);
    expect(same(played.state, reversi.applyMove(reversi.initialState(), move))).toBe(true);
    expect(turnSeatOf(played)).toBe(1);
    expect(awaitingHuman(played)).toBe(false);
  });

  it("passes a turn whose dice allow nothing, and only when they allow nothing", () => {
    // Seat 0 keeps one checker on the bar and seat 1 fills its home board: every
    // entry square is blocked, so the dice are unplayable and the turn passes.
    const points = new Array<number>(backgammon.BACKGAMMON_POINTS).fill(0);
    // Seat 0's entry squares are 18..23 (a die of 6 enters on 18, a die of 1 on
    // 23), and two checkers of seat 1 on each of them closes every door. Seat 1's
    // fifteen checkers are those twelve and three borne off; seat 0's are one on
    // the bar and fourteen borne off.
    for (let index = 18; index < 24; index += 1) points[index] = -2;
    const blocked = backgammon.initialState({ points, bar: [1, 0], off: [14, 3] });
    const session: BoardSession = {
      ...newSession("backgammon", setup(), 1),
      state: backgammon.fromJSON({ ...backgammon.toJSON(blocked), dice: [3, 4] }),
      events: [{ kind: "roll", dice: [3, 4] }],
    };
    expect(legalMovesOf(session)).toEqual([]);
    const passed = withPass(session);
    expect(passed.events.at(-1)).toEqual({ kind: "pass" });
    expect(turnSeatOf(passed)).toBe(1);
  });

  it("reads the doubling cube, and holds the board until somebody answers it", () => {
    const session = newSession("backgammon", setup({ cubeEnabled: true }), 5);
    expect(canOfferCube(session)).toBe(true);
    const offered = withDouble(session);
    expect((offered.state as backgammon.BackgammonState).cube).toBe(2);
    expect(cubeAwaitingAnswer(offered)).toBe(true);
    // The answer comes from the seat the cube passed to, not from the side to move.
    expect(cubeAnswerSeat(offered)).toBe(1);
    expect(cubeAwaitingAnswer(withCubeAnswer(offered))).toBe(false);
    const refused = withDeclinedCube(offered);
    expect(refused.ending).toBe("cube-declined");
    expect(isOver(refused)).toBe(true);
    expect(cubeAwaitingAnswer(refused)).toBe(false);
  });
});

describe("the undo against the computer", () => {
  it("anchors the start of a person's turn, once, and restores it whole", () => {
    let session = beginTurn(newSession("backgammon", setup(), 11));
    expect(session.undo).not.toBeNull();
    const anchor = session.undo;

    session = beginTurn(withRoll(session));
    expect(session.undo).toBe(anchor);
    const move = legalMovesOf(session)[0] as backgammon.BackgammonMove;
    session = beginTurn(withMove(session, move));
    // The turn passed to the computer, so the anchor is spent and the next turn
    // takes a fresh one.
    expect(session.anchored).toBe(false);
    expect(canUndo(session)).toBe(true);

    const undone = withUndo(session);
    expect(undone.events).toEqual([]);
    expect(undone.rng).toBe(anchor?.rng);
    expect(same(undone.state, anchor?.state)).toBe(true);
    // A second press cannot walk further back than the turn it took back.
    expect(withUndo(undone)).toBe(undone);
  });

  it("offers no undo between two people, or at a table of more than two", () => {
    const twoPeople = beginTurn(
      newSession("reversi", setup({ seats: ["human", "human"], level: null }), 1),
    );
    expect(canUndo(twoPeople)).toBe(false);
    const ludoTable = beginTurn(
      newSession("ludo", setup({ seats: ["human", "computer", "computer"] }), 1),
    );
    expect(canUndo(ludoTable)).toBe(false);
  });
});

describe("the search's own stream", () => {
  it("spreads move numbers apart, so a tie-break never touches the dice", () => {
    // The golden-ratio multiplier, hand-computed: 0x9e3779b9 is 2654435769, so
    // seed 0 at move 0 is that constant and seed 1 at move 0 is one more.
    expect(moveSeed(0, 0)).toBe(2654435769);
    expect(moveSeed(1, 0)).toBe(2654435770);
    expect(moveSeed(0, 1)).toBe((2654435769 * 2) >>> 0);
    const seeds = new Set(Array.from({ length: 64 }, (_, ply) => moveSeed(12345, ply)));
    expect(seeds.size).toBe(64);
  });
});

describe("the computer's doubling cube", () => {
  /** A backgammon position with all fifteen of a side's checkers on one point, for exact pip arithmetic. */
  function onePoint(seat0: number, seat1: number): backgammon.BackgammonState {
    const points = new Array<number>(backgammon.BACKGAMMON_POINTS).fill(0);
    points[seat0] = 15;
    points[seat1] = -15;
    return backgammon.initialState({ points, cubeEnabled: true });
  }

  function sessionOf(state: backgammon.BackgammonState): BoardSession {
    return { ...newSession("backgammon", setup({ cubeEnabled: true }), 1), state };
  }

  it("counts the race in pips, and offers the cube only when it is far enough ahead", () => {
    // Fifteen checkers on point 1 is fifteen pips from home for seat 0, and fifteen
    // checkers on point 24 is the same for seat 1: level, so no offer, and an offer
    // from the other side is taken.
    const level = sessionOf(onePoint(0, 23));
    expect(backgammon.pipCount(level.state as backgammon.BackgammonState, 0)).toBe(15);
    expect(backgammon.pipCount(level.state as backgammon.BackgammonState, 1)).toBe(15);
    expect(computerOffersCube(level, 0)).toBe(false);
    expect(computerTakesCube(level, 0)).toBe(true);

    // Seat 1 on point 13 is twelve pips a checker, 180 in all, so seat 0 leads by
    // 165 — far past the twenty-pip threshold, and past the refusal from the other
    // side of the board.
    const ahead = sessionOf(onePoint(0, 12));
    expect(backgammon.pipCount(ahead.state as backgammon.BackgammonState, 1)).toBe(180);
    expect(computerOffersCube(ahead, 0)).toBe(true);
    expect(computerTakesCube(ahead, 1)).toBe(false);
    expect(CUBE_OFFER_PIPS).toBeLessThan(CUBE_DECLINE_PIPS);
  });

  it("answers for games without a cube, and for a position with no race at all", () => {
    const game = newSession("reversi", setup(), 1);
    expect(computerOffersCube(game, 0)).toBe(false);
    expect(canOfferCube(game)).toBe(false);
    expect(cubeAnswerSeat(game)).toBeNull();
  });
});

describe("a resumed session", () => {
  it("folds the stored log back into the dice stream, so the next throw is the one the game would have made", () => {
    // Two whole turns, so the stored log holds two rolls and two moves and the
    // stream's position is not simply the seed.
    let played = newSession("backgammon", setup(), 21);
    for (let turn = 0; turn < 2; turn += 1) {
      played = withRoll(played);
      played = withMove(played, legalMovesOf(played)[0] as backgammon.BackgammonMove);
    }
    expect(played.events.filter((event) => event.kind === "roll")).toHaveLength(2);

    const resumed = savedSession({
      game: "backgammon",
      state: boardEngine("backgammon").json(played.state),
      events: played.events,
      seed: played.seed,
      level: 1,
      seats: TWO_PLAYERS,
    });

    expect(resumed.rng).toBe(played.rng);
    // And the next throw really is the same one: rolling the resumed session
    // equals rolling the session that never went to disk.
    const nextHere = withRoll(played);
    const nextThere = withRoll(resumed);
    expect(nextThere.events).toEqual(nextHere.events);
    expect(same(nextThere.state, nextHere.state)).toBe(true);
  });

  it("refuses a saved position its own log does not produce", () => {
    const played = newSession("four-in-a-row", setup(), 4);
    const moved = withMove(played, { column: 3 });
    const other = withMove(played, { column: 5 });
    expect(() =>
      savedSession({
        game: "four-in-a-row",
        state: boardEngine("four-in-a-row").json(other.state),
        events: moved.events,
        seed: 4,
        level: 1,
        seats: TWO_PLAYERS,
      }),
    ).toThrow(/move log/);
  });

  it("normalizes the stored position, so a field the JSON dropped comes back", () => {
    // Four in a row's winner is derived and `toJSON` does not write it, so a
    // session resumed from the stored bytes would read `undefined` without the
    // engines' own gate. With it, the game is over as it should be.
    //
    // The log is a real one — the store would refuse a slot whose log does not
    // produce its position — and it is four discs into column 0 by seat 0.
    let played = newSession("four-in-a-row", setup(), 1);
    for (const column of [0, 1, 0, 1, 0, 1, 0]) played = withMove(played, { column });
    const engine = boardEngine("four-in-a-row");
    expect(engine.json(played.state)).toEqual(
      engine.json(fourInARow.fromJSON({ cells: playedFourCells(), toMove: 1, moveCount: 7 })),
    );

    const session = savedSession({
      game: "four-in-a-row",
      state: boardEngine("four-in-a-row").json(played.state),
      events: played.events,
      seed: 1,
      level: 1,
      seats: TWO_PLAYERS,
    });
    expect(isOver(session)).toBe(true);
    expect(outcomeOf(session)).toEqual({ status: "win", winner: 0 });
  });

  it("rolls the same dice the engines' own stream would, from the seed a session carries", () => {
    const session = { ...newSession("ludo", setup(), 31), state: ludo.initialState({ seats: 2 }) };
    const rolled = withRoll(session);
    const stream = createSeededRandom(31);
    const expected = ludo.rollFor(ludo.initialState({ seats: 2 }), stream);
    expect(same(rolled.state, expected)).toBe(true);
    expect(rolled.rng).toBe(stream.state);
  });
});

/** The board the four-in-a-row game above reaches: four discs of seat 0 in column 0, three of seat 1 in column 1. */
function playedFourCells(): number[] {
  const cells = new Array<number>(fourInARow.FOUR_CELLS).fill(0);
  for (let row = 0; row < 4; row += 1) cells[fourInARow.fourIndex(0, row)] = 1;
  for (let row = 0; row < 3; row += 1) cells[fourInARow.fourIndex(1, row)] = 2;
  return cells;
}

