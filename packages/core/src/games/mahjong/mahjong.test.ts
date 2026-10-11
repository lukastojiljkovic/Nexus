import { describe, expect, it } from "vitest";

import {
  MAHJONG_FACES,
  MAHJONG_SOLVER_NODE_BUDGET,
  TURTLE,
  TURTLE_LAYER_COUNTS,
  TURTLE_SLOTS,
  createMahjongDeal,
  createMahjongGame,
  isMahjongFree,
  mahjongFacesMatch,
  mahjongFreeSlots,
  mahjongBoard,
  mahjongGameFrom,
  mahjongHint,
  mahjongLegalPairs,
  mahjongRemove,
  mahjongShuffle,
  mahjongUndo,
  mahjongWon,
  solveMahjong,
} from "./mahjong.js";

/** Slots drawn by hand, for a rule that only needs a small board. */
function slotsOf(rows: readonly (readonly [number, number, number])[]) {
  return rows.map(([x, y, z]) => ({ x, y, z }));
}

function boardOf(rows: readonly (readonly [number, number, number])[]) {
  return mahjongBoard(slotsOf(rows));
}

describe("the set of tiles", () => {
  it("is the traditional hundred and forty-four", () => {
    expect(MAHJONG_FACES).toHaveLength(144);
    const counts = new Map<string, number>();
    for (const face of MAHJONG_FACES) counts.set(face, (counts.get(face) ?? 0) + 1);
    for (const suit of ["bamboo", "circles", "characters"]) {
      for (let rank = 1; rank <= 9; rank += 1) {
        expect(counts.get(`${suit}-${rank}`)).toBe(4);
      }
    }
    for (const wind of ["east", "south", "west", "north"]) expect(counts.get(`wind-${wind}`)).toBe(4);
    for (const dragon of ["red", "green", "white"]) expect(counts.get(`dragon-${dragon}`)).toBe(4);
    for (let flower = 1; flower <= 4; flower += 1) expect(counts.get(`flower-${flower}`)).toBe(1);
    for (let season = 1; season <= 4; season += 1) expect(counts.get(`season-${season}`)).toBe(1);
    // 108 suit cards, 16 winds, 12 dragons, 4 flowers, 4 seasons.
    expect(MAHJONG_FACES.length).toBe(108 + 16 + 12 + 4 + 4);
  });

  it("matches faces by the traditional rule", () => {
    expect(mahjongFacesMatch("bamboo-3", "bamboo-3")).toBe(true);
    expect(mahjongFacesMatch("bamboo-3", "bamboo-4")).toBe(false);
    expect(mahjongFacesMatch("circles-9", "characters-9")).toBe(false);
    expect(mahjongFacesMatch("wind-north", "wind-north")).toBe(true);
    expect(mahjongFacesMatch("wind-north", "wind-east")).toBe(false);
    expect(mahjongFacesMatch("dragon-red", "dragon-white")).toBe(false);
    // Flowers match flowers and seasons match seasons, whichever they are.
    expect(mahjongFacesMatch("flower-1", "flower-3")).toBe(true);
    expect(mahjongFacesMatch("season-2", "season-4")).toBe(true);
    expect(mahjongFacesMatch("flower-1", "season-1")).toBe(false);
    expect(mahjongFacesMatch("flower-1", "bamboo-1")).toBe(false);
  });
});

describe("the turtle layout", () => {
  it("holds 144 tiles in the traditional layers", () => {
    expect(TURTLE_SLOTS).toHaveLength(144);
    const counts = TURTLE_LAYER_COUNTS.map(
      (_, layer) => TURTLE_SLOTS.filter((slot) => slot.z === layer).length,
    );
    expect(counts).toEqual([...TURTLE_LAYER_COUNTS]);
    expect(counts.reduce((total, count) => total + count, 0)).toBe(144);
  });

  it("keeps every layer's tiles a whole tile apart", () => {
    for (let first = 0; first < TURTLE_SLOTS.length; first += 1) {
      for (let second = first + 1; second < TURTLE_SLOTS.length; second += 1) {
        const a = TURTLE_SLOTS[first] as { x: number; y: number; z: number };
        const b = TURTLE_SLOTS[second] as { x: number; y: number; z: number };
        if (a.z !== b.z) continue;
        const overlapping = Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
        expect(overlapping).toBe(false);
      }
    }
  });

  it("rests every raised tile on the layer below it", () => {
    for (const slot of TURTLE_SLOTS) {
      if (slot.z === 0) continue;
      const supported = TURTLE_SLOTS.some(
        (below) =>
          below.z === slot.z - 1 &&
          Math.abs(below.x - slot.x) <= 1 &&
          Math.abs(below.y - slot.y) <= 1,
      );
      expect(supported).toBe(true);
    }
  });

  it("starts with the perimeter of every layer free", () => {
    const free = mahjongFreeSlots(TURTLE, new Array<boolean>(144).fill(true));
    // Every free tile at the start is at the end of a row of its own layer with
    // nothing on top of it; the top tile of the pile is one of them.
    expect(free).toContain(143);
    expect(free.length).toBeGreaterThan(20);
    expect(free.length).toBeLessThan(50);
  });
});

describe("isMahjongFree", () => {
  it("leaves the two ends of a row free and blocks the middle", () => {
    const board = boardOf([
      [0, 0, 0],
      [2, 0, 0],
      [4, 0, 0],
    ]);
    const remaining = [true, true, true];
    expect(isMahjongFree(board, remaining, 0)).toBe(true);
    expect(isMahjongFree(board, remaining, 1)).toBe(false);
    expect(isMahjongFree(board, remaining, 2)).toBe(true);
  });

  it("blocks a tile with something resting on it, even half a tile off", () => {
    const under = boardOf([
      [0, 0, 0],
      [1, 1, 1],
    ]);
    expect(isMahjongFree(under, [true, true], 0)).toBe(false);
    expect(isMahjongFree(under, [true, true], 1)).toBe(true);
    // Take the top tile away and the bottom one is open on both sides.
    expect(isMahjongFree(under, [true, false], 0)).toBe(true);
  });

  it("does not let a tile two quarters away and one row down block a side", () => {
    const board = boardOf([
      [0, 0, 0],
      [2, 2, 0],
    ]);
    // The neighbour is two quarters across but a full tile down: it is in
    // another row, so neither end of this tile is held.
    expect(isMahjongFree(board, [true, true], 0)).toBe(true);
    expect(isMahjongFree(board, [true, true], 1)).toBe(true);
  });

  it("keeps a tile held on one side only", () => {
    const board = boardOf([
      [0, 0, 0],
      [2, 0, 0],
    ]);
    // The left tile has the right one beside it and nothing on its left.
    expect(isMahjongFree(board, [true, true], 0)).toBe(true);
    expect(isMahjongFree(board, [true, true], 1)).toBe(true);
  });
});

describe("createMahjongDeal", () => {
  it("deals the whole set, one face per slot", () => {
    const deal = createMahjongDeal(1);
    expect(deal.faces).toHaveLength(144);
    expect([...deal.faces].sort()).toEqual([...MAHJONG_FACES].sort());
    expect(deal.witness).toHaveLength(72);
  });

  it("builds deals whose witness really can be played", () => {
    // The construction is the claim; this is the claim re-checked against the
    // rules, one pair at a time, without trusting the search that produced it.
    for (let seed = 0; seed < 25; seed += 1) {
      const deal = createMahjongDeal(seed);
      const remaining = new Array<boolean>(144).fill(true);
      for (const [a, b] of deal.witness) {
        expect(isMahjongFree(TURTLE, remaining, a)).toBe(true);
        expect(isMahjongFree(TURTLE, remaining, b)).toBe(true);
        expect(mahjongFacesMatch(deal.faces[a] as string, deal.faces[b] as string)).toBe(true);
        remaining[a] = false;
        remaining[b] = false;
      }
      expect(remaining.every((present) => present === false)).toBe(true);
    }
  });

  it("is stable for a seed and different between seeds", () => {
    expect(createMahjongDeal(9).faces).toEqual(createMahjongDeal(9).faces);
    expect(createMahjongDeal(9).faces).not.toEqual(createMahjongDeal(10).faces);
  });
});

describe("solveMahjong", () => {
  it("tries a pair, backs out of it and reports the board unsolvable", () => {
    // A row of four with only its two ends free. The ends match, so the search
    // takes them; what is left in the middle is a pair that does NOT match, so
    // the branch has to be abandoned and the position reported as lost. This is
    // the one case the thousand deals below never reach: they are solvable by
    // construction and the search walks down them without ever coming back.
    const game = mahjongGameFrom({
      slots: slotsOf([
        [0, 0, 0],
        [2, 0, 0],
        [4, 0, 0],
        [6, 0, 0],
      ]),
      faces: ["bamboo-1", "circles-2", "characters-3", "bamboo-1"],
    });
    const solution = solveMahjong(game);
    expect(solution.solved).toBe(false);
    expect(solution.exhausted).toBe(false);
    expect(solution.order).toEqual([]);
    // More than one position was looked at: the pair was tried and taken back.
    expect(solution.nodes).toBeGreaterThan(1);
    // And the pair really is legal, so the branch really was tried.
    expect(mahjongLegalPairs(game)).toEqual([[0, 3]]);
  });

  it("clears a thousand deals within the node budget", { timeout: 900_000 }, () => {
    let worstNodes = 0;
    for (let seed = 0; seed < 1_000; seed += 1) {
      const game = createMahjongGame(seed);
      const solution = solveMahjong(game);
      expect(solution.exhausted).toBe(false);
      expect(solution.solved).toBe(true);
      expect(solution.order).toHaveLength(72);
      worstNodes = Math.max(worstNodes, solution.nodes);
      // The order the solver found must itself be legal: this is the solver
      // being held to the same rule the player is.
      const remaining = [...game.remaining];
      for (const [a, b] of solution.order) {
        expect(isMahjongFree(game.board, remaining, a)).toBe(true);
        expect(isMahjongFree(game.board, remaining, b)).toBe(true);
        expect(mahjongFacesMatch(game.faces[a] as string, game.faces[b] as string)).toBe(true);
        remaining[a] = false;
        remaining[b] = false;
      }
    }
    // Recorded for the budget above: the worst of a thousand deals.
    expect(worstNodes).toBeLessThan(MAHJONG_SOLVER_NODE_BUDGET);
  });

  it("reports a board that cannot be cleared as unsolved", () => {
    // Two tiles stacked with nothing beside them: only the top one is free, so
    // no pair can be taken and the board is lost.
    const game = mahjongGameFrom({
      slots: slotsOf([
        [0, 0, 0],
        [0, 0, 1],
      ]),
      faces: ["bamboo-1", "bamboo-1"],
    });
    const solution = solveMahjong(game);
    expect(solution.solved).toBe(false);
    expect(solution.order).toEqual([]);
  });
});

describe("playing", () => {
  it("takes a matching pair of free tiles and refuses everything else", () => {
    const game = mahjongGameFrom({
      slots: slotsOf([
        [0, 0, 0],
        [2, 0, 0],
        [4, 0, 0],
        [6, 0, 0],
      ]),
      faces: ["bamboo-1", "circles-2", "circles-2", "bamboo-1"],
    });
    // The two middle tiles are held on both sides, so they cannot be taken.
    expect(mahjongRemove(game, 1, 2)).toBeNull();
    // A free tile whose partner is held is not a play either.
    expect(mahjongRemove(game, 0, 1)).toBeNull();
    // A tile cannot be taken with itself.
    expect(mahjongRemove(game, 0, 0)).toBeNull();
    const taken = mahjongRemove(game, 0, 3) as NonNullable<ReturnType<typeof mahjongRemove>>;
    expect(taken.remaining).toEqual([false, true, true, false]);
    // Removing the ends opened both sides of the pair in the middle.
    expect(mahjongLegalPairs(taken)).toEqual([[1, 2]]);
    const finished = mahjongRemove(taken, 1, 2) as NonNullable<ReturnType<typeof mahjongRemove>>;
    expect(mahjongWon(finished)).toBe(true);
  });

  it("undoes a removal, faces and all, and then has nothing left to undo", () => {
    const game = createMahjongGame(3);
    const [firstPair] = mahjongLegalPairs(game);
    const [a, b] = firstPair as readonly [number, number];
    const taken = mahjongRemove(game, a, b) as NonNullable<ReturnType<typeof mahjongRemove>>;
    const undone = mahjongUndo(taken) as NonNullable<ReturnType<typeof mahjongUndo>>;
    expect(undone.remaining).toEqual(game.remaining);
    expect(undone.faces).toEqual(game.faces);
    expect(undone.moves).toEqual([]);
    expect(mahjongUndo(undone)).toBeNull();
  });

  it("is won when the witness order is played out", () => {
    const deal = createMahjongDeal(5);
    let game = createMahjongGame(5);
    for (const [a, b] of deal.witness) {
      const next = mahjongRemove(game, a, b);
      expect(next).not.toBeNull();
      game = next as NonNullable<typeof next>;
    }
    expect(mahjongWon(game)).toBe(true);
    expect(mahjongLegalPairs(game)).toEqual([]);
    expect(mahjongHint(game)).toBeNull();
  });

  it("hints a pair that is legal and on a winning line", () => {
    const game = createMahjongGame(21);
    const hint = mahjongHint(game);
    expect(hint).not.toBeNull();
    const [a, b] = hint as readonly [number, number];
    expect(mahjongFacesMatch(game.faces[a] as string, game.faces[b] as string)).toBe(true);
    const taken = mahjongRemove(game, a, b);
    expect(taken).not.toBeNull();
    expect(solveMahjong(taken as NonNullable<typeof taken>).solved).toBe(true);
  });
});

describe("mahjongShuffle", () => {
  it("rearranges the faces left without changing them, and keeps the board winnable", () => {
    for (let seed = 0; seed < 5; seed += 1) {
      let game = createMahjongGame(seed);
      for (let taken = 0; taken < 6; taken += 1) {
        const pairs = mahjongLegalPairs(game);
        const [a, b] = pairs[0] as readonly [number, number];
        game = mahjongRemove(game, a, b) as NonNullable<ReturnType<typeof mahjongRemove>>;
      }
      const before = game.faces.filter((_, index) => game.remaining[index] === true);
      const shuffledGame = mahjongShuffle(game, 99);
      const after = shuffledGame.faces.filter((_, index) => shuffledGame.remaining[index] === true);
      expect([...after].sort()).toEqual([...before].sort());
      expect(shuffledGame.remaining).toEqual(game.remaining);
      expect(shuffledGame.moves).toEqual(game.moves);
      expect(shuffledGame.shuffles).toBe(1);
      expect(solveMahjong(shuffledGame).solved).toBe(true);
    }
  });

  it("does change the arrangement for at least one seed in five", () => {
    const game = createMahjongGame(11);
    const shuffled = mahjongShuffle(game, 77);
    expect(shuffled.faces).not.toEqual(game.faces);
  });
});
