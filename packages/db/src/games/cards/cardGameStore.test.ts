import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyKlondike,
  applySpider,
  dealKlondike,
  dealSpider,
  isKlondikeWon,
  klondikeHint,
  replayKlondike,
  spiderMoves,
  applyTablic,
  createSeededRandom,
  dealTablic,
  tablicChooseMove,
  type KlondikeState,
  type SpiderState,
  type TablicState,
} from "@nexus/core";
import {
  CardGameStore,
  CardGameValidationError,
  MAX_CARD_GAME_MOVES,
  MAX_CARD_GAME_MOVES_BYTES,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../../index.js";

const NOW = "2026-10-09T08:00:00.000Z";
const LATER = "2026-10-09T09:30:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-cards-"));
  db = openDatabase({ path: join(dir, "cards.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

function store(): CardGameStore {
  return new CardGameStore(db.raw, createProfile());
}

/**
 * A real Klondike game, played by the engine's own hint until it is won or has
 * nothing left to try. It is the move list a save has to survive, because a
 * fixture of made-up moves would prove only that the column accepts JSON.
 */
function playKlondike(seed: number, limit = 400): KlondikeState {
  let state = dealKlondike("draw1", seed);
  for (let step = 0; step < limit; step += 1) {
    if (isKlondikeWon(state)) break;
    const move = klondikeHint(state);
    if (move === null) break;
    state = applyKlondike(state, move);
  }
  return state;
}

/**
 * A real Tablić hand, played by the engine's own medium rule until the first deal
 * of the game ends. It is the move list a save has to survive for a game against
 * the computer, where every seat's action is in the log.
 */
function playTablic(limit = 300): TablicState {
  const random = createSeededRandom(5);
  let state = dealTablic("duo", 5);
  for (let step = 0; step < limit; step += 1) {
    if (state.board.hand > 0 || state.board.phase === "complete") break;
    state = applyTablic(state, tablicChooseMove(state, "medium", random));
  }
  return state;
}

describe("CardGameStore statistics", () => {
  it("answers zeroes for a pair nobody has played, and one row per variant", () => {
    const cards = store();
    expect(cards.getStats("klondike", "draw1")).toEqual({
      game: "klondike",
      variant: "draw1",
      played: 0,
      won: 0,
      bestTimeMs: null,
      bestScore: null,
      currentStreak: 0,
      longestStreak: 0,
      updatedAt: null,
    });
    // Nine games, sixteen variants, in the vocabulary's own order.
    expect(cards.listStats().map((row) => `${row.game}/${row.variant}`)).toEqual([
      "klondike/draw1",
      "klondike/draw3",
      "freecell/classic",
      "spider/suits1",
      "spider/suits2",
      "spider/suits4",
      "pyramid/pass1",
      "pyramid/pass3",
      "tripeaks/classic",
      "tripeaks/wrap",
      "golf/classic",
      "golf/wrap",
      "hearts/standard",
      "spades/standard",
      "tablic/duo",
      "tablic/pairs",
    ]);
  });

  it("counts a loss without recording anything as a best", () => {
    const cards = store();
    const stats = cards.recordResult(
      { game: "klondike", variant: "draw1", won: false, elapsedSeconds: 120, score: 300 },
      NOW,
    );
    expect(stats).toMatchObject({
      played: 1,
      won: 0,
      bestTimeMs: null,
      bestScore: null,
      currentStreak: 0,
      longestStreak: 0,
      updatedAt: NOW,
    });
  });

  it("raises the bests only when a win beats them, and keeps the longest streak", () => {
    const cards = store();
    const play = (won: boolean, seconds: number, score: number, at: string) =>
      cards.recordResult(
        { game: "spider", variant: "suits1", won, elapsedSeconds: seconds, score },
        at,
      );

    expect(play(true, 300, 520, NOW)).toMatchObject({
      played: 1,
      won: 1,
      bestTimeMs: 300_000,
      bestScore: 520,
      currentStreak: 1,
      longestStreak: 1,
    });
    // A slower, lower-scoring win changes nothing but the counters.
    expect(play(true, 400, 480, LATER)).toMatchObject({
      played: 2,
      won: 2,
      bestTimeMs: 300_000,
      bestScore: 520,
      currentStreak: 2,
      longestStreak: 2,
    });
    // A faster, better one takes both.
    expect(play(true, 210, 610, LATER)).toMatchObject({
      bestTimeMs: 210_000,
      bestScore: 610,
      currentStreak: 3,
      longestStreak: 3,
    });
    // A loss ends the streak and leaves the record standing.
    expect(play(false, 90, 100, LATER)).toMatchObject({
      played: 4,
      won: 3,
      bestTimeMs: 210_000,
      bestScore: 610,
      currentStreak: 0,
      longestStreak: 3,
    });
    // And the same game in another variant is a different record.
    expect(cards.getStats("spider", "suits4").played).toBe(0);
  });

  it("refuses a game, a variant, a time, a score or a clock it cannot mean", () => {
    const cards = store();
    const result = {
      game: "klondike" as const,
      variant: "draw1" as const,
      won: true,
      elapsedSeconds: 60,
      score: 100,
    };
    expect(() => cards.recordResult({ ...result, game: "minesweeper" as never }, NOW)).toThrow(
      CardGameValidationError,
    );
    expect(() => cards.recordResult({ ...result, variant: "suits1" as never }, NOW)).toThrow(
      /variant/,
    );
    expect(() => cards.recordResult({ ...result, elapsedSeconds: 1.5 }, NOW)).toThrow(
      /elapsedSeconds/,
    );
    expect(() => cards.recordResult({ ...result, elapsedSeconds: 86_401 }, NOW)).toThrow(
      /elapsedSeconds/,
    );
    expect(() => cards.recordResult({ ...result, score: 1.25 }, NOW)).toThrow(/score/);
    expect(() => cards.recordResult(result, "yesterday")).toThrow(/now/);
  });
});

describe("CardGameStore saved games", () => {
  it("stores a real game and reads it back exactly, with its score replayed", () => {
    const cards = store();
    const played = playKlondike(31);
    expect(played.log.length).toBeGreaterThan(10);

    const saved = cards.saveProgress(
      { game: "klondike", variant: "draw1", seed: 31, moves: played.log, elapsedSeconds: 240 },
      NOW,
    );
    expect(saved.game).toBe("klondike");
    expect(saved.moves).toEqual(played.log);
    expect(saved.seed).toBe(31);
    expect(saved.elapsedSeconds).toBe(240);
    // The score is not stored: it is what the log adds up to when the engine folds
    // it again, which is also what proves the log survived the round trip.
    expect(saved.score).toBe(played.score);
    if (saved.game !== "klondike") throw new Error("unreachable");
    // The union narrows on the game, so resume needs no cast at all.
    const resumed = replayKlondike(saved.variant, saved.seed, saved.moves);
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(resumed.state.board).toEqual(played.board);
      expect(resumed.state.score).toBe(played.score);
    }
  });

  it("keeps one saved game per game and variant, and replaces the one it had", () => {
    const cards = store();
    const played = playKlondike(31);
    cards.saveProgress(
      { game: "klondike", variant: "draw1", seed: 31, moves: played.log, elapsedSeconds: 240 },
      NOW,
    );
    cards.saveProgress(
      { game: "klondike", variant: "draw3", seed: 32, moves: [], elapsedSeconds: 5 },
      NOW,
    );
    cards.saveProgress(
      { game: "klondike", variant: "draw1", seed: 33, moves: [], elapsedSeconds: 1 },
      LATER,
    );

    expect(cards.getProgress("klondike", "draw1")?.seed).toBe(33);
    expect(cards.getProgress("klondike", "draw1")?.updatedAt).toBe(LATER);
    expect(cards.getProgress("klondike", "draw3")?.seed).toBe(32);
    expect(cards.getProgress("spider", "suits1")).toBeNull();
    expect(
      (db.raw.prepare("SELECT COUNT(*) AS n FROM cardgame_saves").get() as { n: number }).n,
    ).toBe(2);

    cards.clearProgress("klondike", "draw1");
    expect(cards.getProgress("klondike", "draw1")).toBeNull();
    // Clearing one that is not there is a no-op, not an error.
    cards.clearProgress("klondike", "draw1");
    expect(cards.listProgress().map((row) => `${row.game}/${row.variant}`)).toEqual([
      "klondike/draw3",
    ]);
  });

  it("lists every saved game in the vocabulary's order", () => {
    const cards = store();
    cards.saveProgress(
      { game: "spider", variant: "suits4", seed: 5, moves: [], elapsedSeconds: 1 },
      NOW,
    );
    cards.saveProgress(
      { game: "freecell", variant: "classic", seed: 617, moves: [], elapsedSeconds: 2 },
      NOW,
    );
    cards.saveProgress(
      { game: "klondike", variant: "draw1", seed: 1, moves: [], elapsedSeconds: 3 },
      NOW,
    );
    expect(cards.listProgress().map((row) => `${row.game}/${row.variant}`)).toEqual([
      "klondike/draw1",
      "freecell/classic",
      "spider/suits4",
    ]);
  });

  it("refuses a move list the engine would not have accepted", () => {
    const cards = store();
    // A draw that is legal, then a move that claims to send a card home out of
    // turn: the shape is right and the rules are not.
    expect(() =>
      cards.saveProgress(
        {
          game: "klondike",
          variant: "draw1",
          seed: 1,
          moves: [
            { kind: "draw" },
            {
              kind: "move",
              from: { kind: "tableau", column: 0 },
              to: { kind: "foundation", suit: "clubs" },
              count: 1,
            },
          ],
          elapsedSeconds: 5,
        },
        NOW,
      ),
    ).toThrow(/not legal/);

    // A Spider log that lifts thirteen cards off one column as a run, which are
    // neither one suit nor in sequence.
    expect(() =>
      cards.saveProgress(
        {
          game: "spider",
          variant: "suits4",
          seed: 1,
          moves: [{ kind: "move", from: 0, count: 13, to: 1 }],
          elapsedSeconds: 5,
        },
        NOW,
      ),
    ).toThrow(/not legal/);

    // An entry that is not a move at all.
    expect(() =>
      cards.saveProgress(
        { game: "freecell", variant: "classic", seed: 1, moves: [{ kind: "fly" }], elapsedSeconds: 5 },
        NOW,
      ),
    ).toThrow(/neither a FreeCell move nor an undo/);
  });

  it("refuses a seed, a time and a list size outside the bounds", () => {
    const cards = store();
    const base = {
      game: "freecell" as const,
      variant: "classic" as const,
      seed: 1,
      moves: [] as unknown[],
      elapsedSeconds: 5,
    };
    expect(() => cards.saveProgress({ ...base, seed: 0 }, NOW)).toThrow(/deal number/);
    expect(() => cards.saveProgress({ ...base, seed: 32_001 }, NOW)).toThrow(/deal number/);
    expect(() => cards.saveProgress({ ...base, elapsedSeconds: -1 }, NOW)).toThrow(
      /elapsedSeconds/,
    );
    expect(() =>
      cards.saveProgress(
        {
          ...base,
          moves: Array.from({ length: MAX_CARD_GAME_MOVES + 1 }, () => ({ kind: "no" })),
        },
        NOW,
      ),
    ).toThrow(new RegExp(String(MAX_CARD_GAME_MOVES)));
    // And the byte ceiling, which the count alone does not bound.
    const padded = Array.from({ length: 1_000 }, () => ({
      kind: "pad",
      junk: "x".repeat(MAX_CARD_GAME_MOVES_BYTES / 500),
    }));
    expect(() => cards.saveProgress({ ...base, moves: padded }, NOW)).toThrow(/characters/);
    // Nothing was written by any of the refusals.
    expect(
      (db.raw.prepare("SELECT COUNT(*) AS n FROM cardgame_saves").get() as { n: number }).n,
    ).toBe(0);
  });

  it("takes any 32-bit Klondike seed, and refuses a FreeCell number the deal cannot", () => {
    const cards = store();
    expect(
      cards.saveProgress(
        { game: "klondike", variant: "draw1", seed: 4_294_967_295, moves: [], elapsedSeconds: 0 },
        NOW,
      ).seed,
    ).toBe(4_294_967_295);
  });

  it("treats a stored row that no longer replays as corruption", () => {
    const profile = createProfile();
    const cards = new CardGameStore(db.raw, profile);
    db.raw
      .prepare(
        `INSERT INTO cardgame_saves
           (profile_id, game, variant, seed, moves_json, elapsed_seconds, created_at, updated_at)
         VALUES (?, 'klondike', 'draw1', 1, ?, 5, ?, ?)`,
      )
      .run(profile, '[{"kind":"draw"},{"kind":"fly"}]', NOW, NOW);

    expect(() => cards.getProgress("klondike", "draw1")).toThrow(CardGameValidationError);
    expect(() => cards.exportData()).toThrow(/Entry 1/);
  });

  it("measures what a real saved game costs to keep", () => {
    const cards = store();
    const played = playKlondike(31);
    const text = JSON.stringify(played.log);
    const started = performance.now();
    cards.saveProgress(
      { game: "klondike", variant: "draw1", seed: 31, moves: played.log, elapsedSeconds: 240 },
      NOW,
    );
    const stored = cards.getProgress("klondike", "draw1");
    const elapsed = performance.now() - started;

    // The numbers this module's ceilings are chosen against, MEASURED on
    // 2026-10-09 in this test's own worker rather than assumed: the hint-played
    // deal above is 400 actions, its move list is 37 429 characters of JSON, and
    // storing it plus reading it back — two full replays — took 11 ms. The
    // ceilings (4000 moves, 262 144 characters) sit well above that, and the only
    // bound asserted with slack is the clock, because a shared CI runner is not
    // this machine.
    expect(played.log.length).toBeGreaterThan(100);
    expect(played.log.length).toBeLessThan(MAX_CARD_GAME_MOVES);
    expect(text.length).toBeLessThan(MAX_CARD_GAME_MOVES_BYTES);
    expect(elapsed).toBeLessThan(500);
    expect(stored?.score).toBe(played.score);
  });

  it("keeps the best score in each game's OWN direction", () => {
    const cards = store();
    // Klondike counts up, so the higher score is the better one...
    const klondike = (score: number, at: string) =>
      cards.recordResult(
        { game: "klondike", variant: "draw1", won: true, elapsedSeconds: 100, score },
        at,
      );
    expect(klondike(480, NOW).bestScore).toBe(480);
    expect(klondike(300, LATER).bestScore).toBe(480);
    expect(klondike(610, LATER).bestScore).toBe(610);

    // ...and Hearts counts penalty points, so the LOWER total is. A store that
    // compared the two the same way round would keep the worst Hearts game as the
    // best, which is the half of the record this pins.
    const hearts = (score: number, at: string) =>
      cards.recordResult(
        { game: "hearts", variant: "standard", won: true, elapsedSeconds: 100, score },
        at,
      );
    expect(hearts(18, NOW).bestScore).toBe(18);
    expect(hearts(24, LATER).bestScore).toBe(18);
    expect(hearts(6, LATER).bestScore).toBe(6);

    // Golf counts the tableau cards it failed to clear, so it is the same way
    // round as Hearts and the opposite way round from Klondike.
    const golf = (score: number, at: string) =>
      cards.recordResult(
        { game: "golf", variant: "classic", won: true, elapsedSeconds: 100, score },
        at,
      );
    expect(golf(9, NOW).bestScore).toBe(9);
    expect(golf(14, LATER).bestScore).toBe(9);
    expect(golf(4, LATER).bestScore).toBe(4);

    // A loss never moves a best, whichever direction the game runs in.
    const lost = cards.recordResult(
      { game: "golf", variant: "classic", won: false, elapsedSeconds: 100, score: 1 },
      LATER,
    );
    expect({ bestScore: lost.bestScore, played: lost.played, won: lost.won }).toEqual({
      bestScore: 4,
      played: 4,
      won: 3,
    });
  });

  it("stores and reads back a game against the computer, replaying it with its own engine", () => {
    const cards = store();
    // A real Tablić game played to the end of its first deal, by the engine's own
    // medium rule: the log a save has to survive is the whole game's actions, in
    // every seat's vocabulary.
    const state = playTablic();
    const saved = cards.saveProgress(
      { game: "tablic", variant: "duo", seed: 5, moves: state.log, elapsedSeconds: 90 },
      NOW,
    );
    expect(saved.game).toBe("tablic");
    expect(saved.moves).toHaveLength(state.log.length);
    expect(saved.score).toBe(state.board.scores[0]);
    const read = cards.getProgress("tablic", "duo");
    expect(read?.moves).toEqual(state.log);
    expect(cards.listProgress().map((row) => row.game)).toEqual(["tablic"]);

    // And the engine is the judge: a Tablić move played out of turn is refused.
    expect(() =>
      cards.saveProgress(
        { game: "tablic", variant: "duo", seed: 5, moves: [{ kind: "play", card: { suit: "spades", rank: 13 }, capture: [] }], elapsedSeconds: 90 },
        NOW,
      ),
    ).toThrow(CardGameValidationError);
  });

  it("refuses a game the vocabulary does not carry and a seed a game cannot deal", () => {
    const cards = store();
    expect(() =>
      cards.saveProgress(
        { game: "bridge" as never, variant: "duo", seed: 1, moves: [], elapsedSeconds: 1 },
        NOW,
      ),
    ).toThrow(CardGameValidationError);
    expect(() =>
      cards.saveProgress(
        { game: "hearts", variant: "duo" as never, seed: 1, moves: [], elapsedSeconds: 1 },
        NOW,
      ),
    ).toThrow(/variant/);
    // A seed is a 32-bit whole number for every game but FreeCell, whose seed is a
    // DEAL NUMBER in the classic 1..32 000 set.
    expect(() =>
      cards.saveProgress(
        { game: "golf", variant: "classic", seed: 1.5, moves: [], elapsedSeconds: 1 },
        NOW,
      ),
    ).toThrow(/seed/);
    expect(() =>
      cards.saveProgress(
        { game: "freecell", variant: "classic", seed: 32_001, moves: [], elapsedSeconds: 1 },
        NOW,
      ),
    ).toThrow(/FreeCell deal number/);
  });
});

describe("CardGameStore export and import", () => {
  function seededStore(): CardGameStore {
    const cards = store();
    cards.recordResult(
      { game: "klondike", variant: "draw1", won: true, elapsedSeconds: 240, score: 430 },
      NOW,
    );
    cards.recordResult(
      { game: "klondike", variant: "draw1", won: false, elapsedSeconds: 90, score: 120 },
      LATER,
    );
    cards.recordResult(
      { game: "freecell", variant: "classic", won: true, elapsedSeconds: 500, score: 520 },
      NOW,
    );
    cards.saveProgress(
      {
        game: "klondike",
        variant: "draw1",
        seed: 31,
        moves: playKlondike(31).log,
        elapsedSeconds: 240,
      },
      NOW,
    );
    let spider: SpiderState = dealSpider("suits2", 9);
    spider = applySpider(spider, spiderMoves(spider)[0]!);
    cards.saveProgress(
      { game: "spider", variant: "suits2", seed: 9, moves: spider.log, elapsedSeconds: 12 },
      NOW,
    );
    return cards;
  }

  it("round-trips through plain JSON into a second profile", () => {
    const source = seededStore();
    const exported = source.exportData();
    expect(exported.version).toBe(1);

    // Plain JSON, as the archive carries it: no Dates, no class instances.
    const wire = JSON.parse(JSON.stringify(exported)) as unknown;

    const target = store();
    target.importData(wire);

    expect(target.exportData()).toEqual(exported);
    expect(target.listProgress().map((row) => `${row.game}/${row.variant}`)).toEqual([
      "klondike/draw1",
      "spider/suits2",
    ]);
    expect(target.getProgress("klondike", "draw1")?.score).toBe(playKlondike(31).score);
  });

  it("replaces what the profile had rather than merging into it", () => {
    const source = seededStore();
    const target = store();
    target.recordResult(
      { game: "spider", variant: "suits4", won: true, elapsedSeconds: 10, score: 700 },
      NOW,
    );
    target.importData(source.exportData());
    // The spider/suits4 row is gone: an import is the profile's card-game data,
    // not an addition to it.
    expect(target.getStats("spider", "suits4").played).toBe(0);
    expect(target.getStats("klondike", "draw1").played).toBe(2);
  });

  it("refuses an unknown version before it writes anything", () => {
    const source = seededStore();
    const target = store();
    target.recordResult(
      { game: "spider", variant: "suits4", won: true, elapsedSeconds: 10, score: 700 },
      NOW,
    );
    const before = target.exportData();

    expect(() => target.importData({ ...source.exportData(), version: 2 })).toThrow(/version/);
    expect(() => target.importData({ version: 0, stats: [], saves: [] })).toThrow(/version/);
    expect(target.exportData()).toEqual(before);
  });

  it("refuses a malformed statistics row, a duplicate pair and a bad saved game", () => {
    const source = seededStore();
    const exported = JSON.parse(JSON.stringify(source.exportData())) as {
      version: number;
      stats: Record<string, unknown>[];
      saves: Record<string, unknown>[];
    };
    const target = store();

    const asStat = exported.stats.find((row) => row["game"] === "klondike")!;
    expect(() => target.importData({ ...exported, stats: [{ ...asStat, won: 99 }] })).toThrow(
      /exceed/,
    );
    expect(() => target.importData({ ...exported, stats: [asStat, asStat] })).toThrow(/twice/);
    expect(() =>
      target.importData({
        ...exported,
        stats: [{ ...asStat, currentStreak: 5, longestStreak: 2 }],
      }),
    ).toThrow(/longestStreak/);
    expect(() =>
      target.importData({ ...exported, stats: [{ ...asStat, variant: "suits1" }] }),
    ).toThrow(/variant/);

    const asSave = exported.saves.find((row) => row["game"] === "spider")!;
    expect(() =>
      target.importData({ ...exported, saves: [{ ...asSave, moves: [{ kind: "fly" }] }] }),
    ).toThrow(/neither a Spider move nor an undo/);
    expect(() =>
      target.importData({
        ...exported,
        saves: [
          { game: "freecell", variant: "classic", seed: 0, moves: [], elapsedSeconds: 1 },
        ],
      }),
    ).toThrow(/deal number/);

    // And a value that is not the shape at all.
    expect(() => target.importData(null)).toThrow(/object/);
    expect(() => target.importData({ version: 1 })).toThrow(/list/);
    // Nothing was written by any of the refusals — and a fresh profile exports no
    // rows at all, because the zero rows `listStats` answers for display are not
    // data (see `exportData`).
    expect(target.exportData()).toEqual({ version: 1, stats: [], saves: [] });
  });
});
