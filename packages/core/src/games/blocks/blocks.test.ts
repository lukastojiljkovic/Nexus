import { describe, expect, it } from "vitest";
import {
  BLOCKS_BOARD_CAPACITY,
  BLOCKS_CLEAR_SCORES,
  BLOCKS_COLUMNS,
  BLOCKS_GRAVITY_BASE_MS,
  BLOCKS_LOCK_DELAY_MS,
  BLOCKS_MAX_LOCK_RESETS,
  BLOCKS_PREVIEW_COUNT,
  BLOCKS_ROWS,
  BLOCKS_TICK_MS,
  activeCells,
  blocksFrom,
  createBlocks,
  ghostCells,
  gravityIntervalMs,
  levelForLines,
  lineScore,
  step,
} from "./blocks.js";
import type { BlocksInput, BlocksState } from "./blocks.js";
import type { BlockCell, BlockPieceId } from "./pieces.js";

/** One letter per piece, ours: bar, square, tee, ell, jay, ess, zee. */
const LETTERS: Readonly<Record<string, BlockPieceId>> = {
  b: "bar",
  q: "square",
  t: "tee",
  l: "ell",
  y: "jay",
  e: "ess",
  z: "zee",
};

const SYMBOLS: Readonly<Record<BlockPieceId, string>> = {
  bar: "b",
  square: "q",
  tee: "t",
  ell: "l",
  jay: "y",
  ess: "e",
  zee: "z",
};

/**
 * A board written as bottom-aligned rows, which is how a stack is drawn: `rows[0]`
 * is the topmost filled row of the DRAWING rather than row 0 of the board, so a
 * three-row fixture means rows 19, 20 and 21.
 */
function boardOf(rows: readonly string[]): (BlockPieceId | null)[] {
  const board = new Array<BlockPieceId | null>(BLOCKS_BOARD_CAPACITY).fill(null);
  const offset = BLOCKS_ROWS - rows.length;
  rows.forEach((line, index) => {
    expect(line).toHaveLength(BLOCKS_COLUMNS);
    for (let column = 0; column < BLOCKS_COLUMNS; column += 1) {
      const symbol = line[column] as string;
      if (symbol === ".") continue;
      board[(offset + index) * BLOCKS_COLUMNS + column] = LETTERS[symbol] as BlockPieceId;
    }
  });
  return board;
}

/** The settled board as 22 strings of 12, top row first. */
function boardText(state: BlocksState): string[] {
  const rows: string[] = [];
  for (let row = 0; row < BLOCKS_ROWS; row += 1) {
    let line = "";
    for (let column = 0; column < BLOCKS_COLUMNS; column += 1) {
      const cell = state.board[row * BLOCKS_COLUMNS + column];
      line += cell === null || cell === undefined ? "." : SYMBOLS[cell];
    }
    rows.push(line);
  }
  return rows;
}

const EMPTY_ROW = ".".repeat(BLOCKS_COLUMNS);

/** Cells as an `x,y` list ordered top-to-bottom then left-to-right, so a shape compares as the drawing reads. */
function cellsText(cells: readonly BlockCell[]): string[] {
  return [...cells]
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map((cell) => `${cell.x},${cell.y}`);
}

describe("a fresh game", () => {
  it("starts with a piece in play, three in the queue, and nothing on the board", () => {
    const state = blocksFrom({ order: ["bar"], now: 0 });

    expect(state.active).toEqual({ id: "bar", rotation: 0, x: 4, y: 0 });
    expect(cellsText(activeCells(state))).toEqual(["4,1", "5,1", "6,1", "7,1"]);
    expect(state.next).toHaveLength(BLOCKS_PREVIEW_COUNT);
    expect(state.status).toBe("playing");
    expect(state.score).toBe(0);
    expect(state.lines).toBe(0);
    expect(state.level).toBe(1);
    expect(boardText(state).every((row) => row === EMPTY_ROW)).toBe(true);
  });

  it("centres every piece in its own frame", () => {
    expect(blocksFrom({ order: ["square"] }).active).toMatchObject({ x: 5 });
    expect(blocksFrom({ order: ["tee"] }).active).toMatchObject({ x: 4 });
    expect(blocksFrom({ order: ["bar"] }).active).toMatchObject({ x: 4 });
  });

  it("is a pure function of its seed: the same seed deals the same game", () => {
    const first = createBlocks(4242, 0);
    const again = createBlocks(4242, 0);
    const other = createBlocks(4243, 0);

    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(first));
  });
});

describe("the bag", () => {
  it("hands out each of the seven exactly once in every seven, over 14 pieces", () => {
    for (const seed of [1, 7, 2026]) {
      let state = createBlocks(seed, 0);
      const dealt: BlockPieceId[] = [];
      let now = 0;
      for (let index = 0; index < 14; index += 1) {
        dealt.push(state.active?.id as BlockPieceId);
        // Spread the stack sideways so no column reaches the ceiling and ends the
        // game partway through the run — the bag order is what is under test.
        for (let nudge = 0; nudge < index % 5; nudge += 1) {
          now += BLOCKS_TICK_MS;
          state = step(state, "right", now);
        }
        now += BLOCKS_TICK_MS;
        state = step(state, "hardDrop", now);
      }

      const seven = ["bar", "ell", "ess", "jay", "square", "tee", "zee"];
      expect({ seed, first: [...dealt.slice(0, 7)].sort() }).toEqual({ seed, first: seven });
      expect({ seed, second: [...dealt.slice(7)].sort() }).toEqual({ seed, second: seven });
    }
  });
});

describe("gravity", () => {
  it("drops one row per interval of the level's speed", () => {
    let state = blocksFrom({ order: ["bar"], now: 0 });

    state = step(state, "none", BLOCKS_GRAVITY_BASE_MS - 1);
    expect(state.active?.y).toBe(0);

    state = step(state, "none", BLOCKS_GRAVITY_BASE_MS);
    expect(state.active?.y).toBe(1);

    state = step(state, "none", BLOCKS_GRAVITY_BASE_MS + 1);
    expect(state.active?.y).toBe(1);

    // A gap of three intervals at once is three rows, not one.
    state = step(state, "none", BLOCKS_GRAVITY_BASE_MS + 1 + 3 * BLOCKS_GRAVITY_BASE_MS);
    expect(state.active?.y).toBe(4);
  });

  it("is 800 ms at level 1, 70 ms faster per level, and never below 80 ms", () => {
    expect(gravityIntervalMs(1)).toBe(800);
    expect(gravityIntervalMs(2)).toBe(730);
    expect(gravityIntervalMs(11)).toBe(100);
    expect(gravityIntervalMs(12)).toBe(80);
    expect(gravityIntervalMs(40)).toBe(80);
  });

  it("keeps no progress towards the next drop while a piece is resting", () => {
    let state = blocksFrom({ order: ["square", "tee"], now: 0 });
    let now = 0;
    for (let index = 0; index < 20; index += 1) {
      now += BLOCKS_GRAVITY_BASE_MS;
      state = step(state, "none", now);
    }
    expect(state.active?.y).toBe(20);
    expect(state.restingSinceMs).toBe(now);

    // Still inside the lock delay, and the accumulator is empty rather than
    // carrying the fraction the arrival left behind.
    const resting = step(state, "none", now + 400);
    expect(resting.active?.y).toBe(20);
    expect(resting.gravityAccMs).toBe(0);
  });
});

describe("the drops", () => {
  it("soft-drops one row and a point, and stops at the floor", () => {
    let state = blocksFrom({ order: ["square"], now: 0 });
    let now = 0;
    for (let index = 0; index < 20; index += 1) {
      now += BLOCKS_TICK_MS;
      state = step(state, "softDrop", now);
    }
    expect(state.active?.y).toBe(20);
    expect(state.score).toBe(20);

    now += BLOCKS_TICK_MS;
    const blocked = step(state, "softDrop", now);
    expect(blocked.active?.y).toBe(20);
    expect(blocked.score).toBe(20);
  });

  it("hard-drops to the floor, scores 2 a row, and locks at once", () => {
    const state = step(blocksFrom({ order: ["square"], now: 0 }), "hardDrop", BLOCKS_TICK_MS);

    // 20 rows, from y = 0 down to y = 20, two points each.
    expect(state.score).toBe(40);
    expect(boardText(state)).toEqual([
      ...new Array<string>(20).fill(EMPTY_ROW),
      ".....qq.....",
      ".....qq.....",
    ]);
    expect(state.active?.y).toBe(0);
    expect(state.holdUsed).toBe(false);
  });

  it("drops the ghost where the piece would really land", () => {
    const state = blocksFrom({ order: ["square"], now: 0 });

    expect(cellsText(ghostCells(state))).toEqual(["5,20", "6,20", "5,21", "6,21"]);
    expect(cellsText(activeCells(state))).toEqual(["5,0", "6,0", "5,1", "6,1"]);
  });
});

describe("rotation", () => {
  it("shifts a bar off the right wall to turn it horizontal", () => {
    let state = blocksFrom({ order: ["bar"], now: 0 });
    let now = 0;

    now += BLOCKS_TICK_MS;
    state = step(state, "rotateCW", now);
    // One quarter turn: the bar is a column at local x = 2, so board column 6.
    expect(cellsText(activeCells(state))).toEqual(["6,0", "6,1", "6,2", "6,3"]);

    for (let index = 0; index < 5; index += 1) {
      now += BLOCKS_TICK_MS;
      state = step(state, "right", now);
    }
    expect(state.active).toEqual({ id: "bar", rotation: 1, x: 9, y: 0 });

    // Turning again would need columns 9–12; the left-hand kick is what saves it.
    now += BLOCKS_TICK_MS;
    state = step(state, "rotateCW", now);
    expect(state.active).toEqual({ id: "bar", rotation: 2, x: 8, y: 0 });
    expect(cellsText(activeCells(state))).toEqual(["8,2", "9,2", "10,2", "11,2"]);
  });

  it("lifts a bar off the floor to stand it up", () => {
    let state = blocksFrom({ order: ["bar"], now: 0 });
    let now = 0;

    now += BLOCKS_TICK_MS;
    state = step(state, "rotateCW", now);
    now += BLOCKS_TICK_MS;
    state = step(state, "rotateCW", now);
    // Rotation 2 is the bar's lower row, so it is the one that reaches the floor.
    expect(cellsText(activeCells(state))).toEqual(["4,2", "5,2", "6,2", "7,2"]);

    for (let index = 0; index < 19; index += 1) {
      now += BLOCKS_GRAVITY_BASE_MS;
      state = step(state, "none", now);
    }
    expect(state.active?.y).toBe(19);
    expect(cellsText(activeCells(state))).toEqual(["4,21", "5,21", "6,21", "7,21"]);
    expect(state.restingSinceMs).toBe(now);

    // Standing it up would need rows 19–22; the upward kick is what saves it.
    now += BLOCKS_TICK_MS;
    state = step(state, "rotateCW", now);
    expect(state.active).toEqual({ id: "bar", rotation: 3, x: 4, y: 18 });
    expect(cellsText(activeCells(state))).toEqual(["5,18", "5,19", "5,20", "5,21"]);
  });

  it("refuses a rotation no offset rescues, and leaves the piece where it was", () => {
    // A one-column well, four rows deep, with the bar standing in it. Standing the
    // bar up the other way would need row 22 (out of bounds) or rows 19–21 of the
    // neighbouring columns, which are filled — so all four offsets are refused and
    // the piece must not silently move.
    const board = boardOf([
      "ttttt.tttttt",
      "ttttt.tttttt",
      "ttttt.tttttt",
      "ttttt.tttttt",
    ]);
    let state = blocksFrom({ order: ["bar"], board, now: 0 });
    let now = BLOCKS_TICK_MS;
    state = step(state, "rotateCW", now);
    now += BLOCKS_TICK_MS;
    state = step(state, "left", now);
    for (let index = 0; index < 18; index += 1) {
      now += BLOCKS_GRAVITY_BASE_MS;
      state = step(state, "none", now);
    }
    expect(state.active).toEqual({ id: "bar", rotation: 1, x: 3, y: 18 });

    now += BLOCKS_TICK_MS;
    const rotated = step(state, "rotateCW", now);
    expect(rotated.active).toEqual({ id: "bar", rotation: 1, x: 3, y: 18 });
    expect(cellsText(activeCells(rotated))).toEqual(["5,18", "5,19", "5,20", "5,21"]);
  });
});

describe("line clears", () => {
  /**
   * Four boards, one per clear size, each with its hole shaped exactly like the
   * piece that will fill it — so the arithmetic below is the only thing this test
   * has to be right about. A hard drop scores 2 a row, and a clear scores
   * `BLOCKS_CLEAR_SCORES[cleared] × level`.
   *
   *  - one row:  row 21 short two cells, filled by a square dropped 20 rows
   *  - two rows: rows 20–21 short a 2 × 2 block
   *  - three:    rows 19–21 short the ell's standing shape
   *  - four:     rows 18–21 short one column, filled by a standing bar
   */
  it("clears one row for 100 plus the drop", () => {
    let state = blocksFrom({
      order: ["square"],
      board: boardOf(["tttttttttt.."]),
      now: 0,
    });
    let now = 0;
    for (let index = 0; index < 5; index += 1) {
      now += BLOCKS_TICK_MS;
      state = step(state, "right", now);
    }
    now += BLOCKS_TICK_MS;
    state = step(state, "hardDrop", now);

    expect(state.lines).toBe(1);
    expect(state.level).toBe(1);
    expect(state.score).toBe(2 * 20 + 100);
    // The square's upper half fell into the row that was cleared.
    expect(boardText(state)[21]).toBe("..........qq");
  });

  it("clears two rows for 300 plus the drop", () => {
    let state = blocksFrom({
      order: ["square"],
      board: boardOf(["tttttttttt..", "tttttttttt.."]),
      now: 0,
    });
    let now = 0;
    for (let index = 0; index < 5; index += 1) {
      now += BLOCKS_TICK_MS;
      state = step(state, "right", now);
    }
    now += BLOCKS_TICK_MS;
    state = step(state, "hardDrop", now);

    expect(state.lines).toBe(2);
    expect(state.score).toBe(2 * 20 + 300);
    expect(boardText(state).every((row) => row === EMPTY_ROW)).toBe(true);
  });

  it("clears three rows for 600 plus the drop", () => {
    // Rows 19, 20 and 21, short the ell's standing shape: its spine in column 5
    // and one cell at column 6, row 19.
    let state = blocksFrom({
      order: ["ell"],
      board: boardOf(["ttttt..ttttt", "ttttt.tttttt", "ttttt.tttttt"]),
      now: 0,
    });
    let now = BLOCKS_TICK_MS;
    state = step(state, "rotateCW", now);
    now += BLOCKS_TICK_MS;
    state = step(state, "hardDrop", now);

    expect(state.lines).toBe(3);
    expect(state.score).toBe(2 * 19 + 600);
    expect(boardText(state).every((row) => row === EMPTY_ROW)).toBe(true);
  });

  it("clears four rows for 1000 plus the drop", () => {
    let state = blocksFrom({
      order: ["bar"],
      board: boardOf([
        "tttttt.ttttt",
        "tttttt.ttttt",
        "tttttt.ttttt",
        "tttttt.ttttt",
      ]),
      now: 0,
    });
    let now = BLOCKS_TICK_MS;
    state = step(state, "rotateCW", now);
    now += BLOCKS_TICK_MS;
    state = step(state, "hardDrop", now);

    expect(state.lines).toBe(4);
    expect(state.score).toBe(2 * 18 + 1000);
    expect(boardText(state).every((row) => row === EMPTY_ROW)).toBe(true);
  });

  it("levels up every ten lines, and scores a clear at the level it happened at", () => {
    // A one-column well twenty rows deep, and four standing bars into it: 4, 8, 12
    // and 16 lines. The well refills from above after each clear, so every piece
    // falls the same 18 rows and the clears are worth 1000 until the level reaches
    // 2 — which the twelfth line does, so only the fourth clear is multiplied.
    let state = blocksFrom({
      order: ["bar", "bar", "bar", "bar"],
      board: boardOf(new Array<string>(20).fill("tttttt.ttttt")),
      now: 0,
    });
    let now = 0;
    for (let piece = 1; piece <= 4; piece += 1) {
      now += BLOCKS_TICK_MS;
      state = step(state, "rotateCW", now);
      now += BLOCKS_TICK_MS;
      state = step(state, "hardDrop", now);
      const lines = piece * 4;
      expect({ piece, lines: state.lines, level: state.level }).toEqual({
        piece,
        lines,
        level: levelForLines(lines),
      });
    }

    expect(state.lines).toBe(16);
    expect(state.level).toBe(2);
    expect(state.score).toBe(4 * 36 + 1000 + 1000 + 1000 + 2000);
  });

  it("prices the table itself", () => {
    expect(BLOCKS_CLEAR_SCORES).toEqual([0, 100, 300, 600, 1000]);
    expect(lineScore(4, 3)).toBe(3000);
    expect(lineScore(0, 9)).toBe(0);
    expect(levelForLines(0)).toBe(1);
    expect(levelForLines(9)).toBe(1);
    expect(levelForLines(10)).toBe(2);
    expect(levelForLines(95)).toBe(10);
  });
});

describe("the lock delay", () => {
  /** A square dropped to the floor by gravity alone, with the tick it landed on. */
  function resting(): { state: BlocksState; landed: number } {
    let state = blocksFrom({ order: ["square", "tee"], now: 0 });
    let now = 0;
    for (let index = 0; index < 20; index += 1) {
      now += BLOCKS_GRAVITY_BASE_MS;
      state = step(state, "none", now);
    }
    expect(state.active?.y).toBe(20);
    return { state, landed: now };
  }

  it("locks a resting piece 500 ms after it came to rest, and not a tick sooner", () => {
    const { state, landed } = resting();

    const nearly = step(state, "none", landed + BLOCKS_LOCK_DELAY_MS - 1);
    expect(nearly.active?.id).toBe("square");

    const locked = step(state, "none", landed + BLOCKS_LOCK_DELAY_MS);
    expect(locked.board[21 * BLOCKS_COLUMNS + 5]).toBe("square");
    expect(locked.board[21 * BLOCKS_COLUMNS + 6]).toBe("square");
    expect(locked.active?.id).toBe("tee");
    expect(locked.restingSinceMs).toBeNull();
  });

  it("restarts on a nudge, and counts from the nudge rather than the landing", () => {
    const { state, landed } = resting();

    const nudged = step(state, "rotateCW", landed + 400);
    expect(nudged.lockResets).toBe(1);
    expect(nudged.restingSinceMs).toBe(landed + 400);

    // 450 ms after the nudge: still waiting, and still there.
    expect(step(nudged, "none", landed + 850).active?.id).toBe("square");
    // 500 ms after it: locked, and the queue has moved on.
    expect(step(nudged, "none", landed + 900).active?.id).toBe("tee");
  });

  it("stops restarting after fifteen, and locks on whatever delay is left", () => {
    const { state, landed } = resting();
    let now = landed;
    let current = state;
    for (let index = 1; index <= BLOCKS_MAX_LOCK_RESETS + 1; index += 1) {
      now += 100;
      current = step(current, "rotateCW", now);
      expect({ index, resets: current.lockResets }).toEqual({
        index,
        resets: Math.min(index, BLOCKS_MAX_LOCK_RESETS),
      });
    }

    // The sixteenth nudge was refused, so the timer still runs from the fifteenth,
    // which happened 1500 ms after the landing.
    expect(current.active?.id).toBe("square");
    expect(step(current, "none", landed + 1500 + BLOCKS_LOCK_DELAY_MS).active?.id).toBe("tee");
  });
});

describe("the hold slot", () => {
  it("takes one piece, once per drop, and gives it back after the next lock", () => {
    let state = blocksFrom({ order: ["bar", "tee"], now: 0 });
    expect(state.active?.id).toBe("bar");

    state = step(state, "hold", BLOCKS_TICK_MS);
    expect(state.hold).toBe("bar");
    expect(state.active?.id).toBe("tee");
    expect(state.holdUsed).toBe(true);

    // A second hold before the piece locks is not a second swap.
    const again = step(state, "hold", 2 * BLOCKS_TICK_MS);
    expect(again.hold).toBe("bar");
    expect(again.active?.id).toBe("tee");

    // After the lock the slot is open again, and the held piece comes back.
    const locked = step(again, "hardDrop", 3 * BLOCKS_TICK_MS);
    expect(locked.holdUsed).toBe(false);
    const dealt = locked.active?.id;
    const swapped = step(locked, "hold", 4 * BLOCKS_TICK_MS);
    expect(swapped.active?.id).toBe("bar");
    expect(swapped.hold).toBe(dealt);
  });
});

describe("the end of a game", () => {
  it("ends when the next piece cannot be dealt, and keeps it in the picture", () => {
    // Every column but the first is filled, and the bar's own spawn cells (row 1,
    // columns 4–7) are left open — so the game starts legally and the square that
    // follows has nowhere to appear.
    const rows = Array.from({ length: BLOCKS_ROWS }, (_, row) =>
      row === 1 ? ".ttt....tttt" : ".ttttttttttt",
    );
    let state = blocksFrom({ order: ["bar", "square"], board: boardOf(rows), now: 0 });
    expect(state.active).toEqual({ id: "bar", rotation: 0, x: 4, y: 0 });

    state = step(state, "hardDrop", BLOCKS_TICK_MS);

    expect(state.status).toBe("over");
    expect(state.active?.id).toBe("square");
    // Nothing at all gets through afterwards, and the renderer can tell by identity.
    expect(step(state, "hardDrop", 10 * BLOCKS_TICK_MS)).toBe(state);
  });
});

describe("the state as a value", () => {
  it("never mutates the state it is handed", () => {
    const state = blocksFrom({ order: ["bar", "tee", "square"], now: 0 });
    const before = JSON.stringify(state);

    step(state, "left", 16);
    step(state, "rotateCW", 32);
    step(state, "hold", 48);
    step(state, "hardDrop", 64);

    expect(JSON.stringify(state)).toBe(before);
  });

  it("refuses a setup it could not have dealt", () => {
    expect(() => blocksFrom({ order: [] })).toThrow(RangeError);
    expect(() => blocksFrom({ order: ["bar"], board: [null] })).toThrow(RangeError);
    expect(() => blocksFrom({ order: ["bar"], board: boardOf(["tttttt.ttttt"]) })).not.toThrow();
    expect(() => blocksFrom({ order: ["bar"], board: boardOf(["...........x"]) })).toThrow(TypeError);
    expect(() => blocksFrom({ order: ["hexagon" as BlockPieceId] })).toThrow(TypeError);
  });
});

describe("a replayed game", () => {
  /**
   * Seed 6 and a forty-piece input log — four landing columns, cycled, each piece
   * dropped in three inputs — replayed twice: the runs must agree with each other
   * AND with the outcome recorded below, which is a game that ends by topping out
   * after clearing one line.
   *
   * **The recorded numbers are the engine's own output for this seed and log,**
   * taken when this test was written — an oracle rather than a derivation, and
   * deliberately so: the point of this test is that a change to the engine makes an
   * EXISTING game come out differently, which no amount of hand arithmetic can
   * detect. The arithmetic that has to be right is proven above, one rule at a
   * time.
   */
  const LOG: readonly BlocksInput[] = (() => {
    const inputs: BlocksInput[] = [];
    /** Four landing columns, cycled: the left wall, the spawn, three right, the right wall. */
    const plans: readonly (readonly BlocksInput[])[] = [
      ["left", "left", "left", "left", "left"],
      [],
      ["right", "right", "right"],
      ["right", "right", "right", "right", "right"],
    ];
    for (let piece = 0; piece < 40; piece += 1) {
      inputs.push(...(plans[piece % 4] as readonly BlocksInput[]));
      inputs.push("softDrop", "softDrop", "hardDrop");
    }
    return inputs;
  })();

  function replay(): BlocksState {
    let state = createBlocks(6, 0);
    LOG.forEach((input, index) => {
      state = step(state, input, (index + 1) * BLOCKS_TICK_MS);
    });
    return state;
  }

  it("reaches the same exact score, level and board every time", () => {
    const first = replay();

    expect(JSON.stringify(replay())).toBe(JSON.stringify(first));
    expect({
      status: first.status,
      score: first.score,
      lines: first.lines,
      level: first.level,
      next: first.next,
      hold: first.hold,
    }).toEqual({
      status: "over",
      score: 847,
      lines: 1,
      level: 1,
      next: ["bar", "jay", "zee"],
      hold: null,
    });
    expect(boardText(first)).toEqual([
      "......t.....",
      ".....tttee..",
      ".......ee..y",
      "........tyyy",
      ".......tttt.",
      ".........ttt",
      "........qq..",
      "l...zz..qq..",
      "lll..zz.bbbb",
      "bbbb.qq.ee..",
      "l....qqeezz.",
      "lll...y.t.zz",
      "qq..zz...ee.",
      "qq..lzz..y..",
      ".ee.lllyyy.y",
      "ee..bbbb.yyy",
      "l......zz.qq",
      "lll..t.lzzqq",
      "zz..tttlllee",
      ".zz.bbbb.ee.",
      ".t....y.qq..",
      "ttt.yyy.qq..",
    ]);
  });

  it("is a different game for a different seed", () => {
    let other = createBlocks(7, 0);
    LOG.forEach((input, index) => {
      other = step(other, input, (index + 1) * BLOCKS_TICK_MS);
    });

    expect(other.score).not.toBe(replay().score);
  });
});
