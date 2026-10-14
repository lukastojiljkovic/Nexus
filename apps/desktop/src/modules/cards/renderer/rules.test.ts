import { describe, expect, it } from "vitest";
import {
  CARD_GAMES,
  CARD_GAME_VARIANTS,
  cardCode,
  isCardGameVariant,
  type CardGameId,
  type CardGameVariant,
} from "@nexus/core";
import {
  DEFAULT_LEVEL_NAME,
  GAME_ORDER,
  canUndo,
  hintMove,
  isComputerGame,
  isFinished,
  isWon,
  legalMoves,
  moveSeed,
  resumeGame,
  safeMoves,
  seatCount,
  seatNow,
  seatToAct,
  startGame,
  stepSession,
  undoSession,
  variantsOf,
  type CardSession,
} from "./rules.js";
import { boxKey, directMove, highlights, moveTo, picksRun, sourceBox, targetBox } from "./solitaire.js";
import { describeMove } from "./moves.js";

/**
 * The page's own turn logic (ADR-090 stage 2).
 *
 * What is pinned here is what the page promises about a game it is holding: that a
 * deal is a pure function of `(game, variant, seed)`, that a saved log replays to
 * the position it came from, that undo returns the table to where the turn began —
 * including the computer's answer, which is the one thing this module's undo has to
 * do that a solitaire's does not — and that the boxes the solitaire boards draw are
 * the boxes the engines' own enumerations name.
 */

/** Every game, with one variant each — the whole vocabulary, exercised once. */
const SAMPLES: readonly { readonly game: CardGameId; readonly variant: CardGameVariant }[] =
  CARD_GAMES.map((game) => ({ game, variant: CARD_GAME_VARIANTS[game][0]! }));

describe("a deal", () => {
  it("is a pure function of the game, the variant and the seed", () => {
    for (const { game, variant } of SAMPLES) {
      const first = startGame(game, variant, 4242);
      const second = startGame(game, variant, 4242);
      expect(JSON.stringify(first.state), game).toBe(JSON.stringify(second.state));
      // And a different seed is a different table, which is what makes the seed
      // worth storing rather than the position.
      const other = startGame(game, variant, 4243);
      expect(JSON.stringify(other.state), game).not.toBe(JSON.stringify(first.state));
      // The opening has moves in every game, or the deal would be a stuck table.
      expect(legalMoves(first).length, game).toBeGreaterThan(0);
    }
  });

  it("refuses a variant the game does not carry and a seed nobody could have meant", () => {
    // Every game but FreeCell refuses a variant it does not carry — FreeCell has
    // exactly ONE variant, so its deal never reads the argument at all.
    for (const game of CARD_GAMES.filter((id) => id !== "freecell")) {
      expect(() => startGame(game, "not-a-variant" as CardGameVariant, 1), game).toThrow();
    }
    // FreeCell's seed is a DEAL NUMBER, so zero and 32 001 are refused by the deal
    // itself rather than by a rule restated here.
    expect(() => startGame("freecell", "classic", 0)).toThrow();
    expect(() => startGame("freecell", "classic", 32_001)).toThrow();
    expect(startGame("freecell", "classic", 1).seed).toBe(1);
  });

  it("carries the level it was opened at, and opens at the default", () => {
    const opened = startGame("hearts", "standard", 7);
    expect(opened.level).toBe(DEFAULT_LEVEL_NAME);
    expect(startGame("hearts", "standard", 7, "hard").level).toBe("hard");
  });
});

describe("resume", () => {
  it("is replay and nothing else: a log replays to the position it came from", () => {
    for (const { game, variant } of SAMPLES) {
      const dealt = startGame(game, variant, 909);
      const played = playFor(dealt, 40);
      const restored = resumeGame({
        game,
        variant,
        seed: 909,
        moves: played.log,
        elapsedSeconds: 12,
      });
      expect(JSON.stringify(restored.state), game).toBe(JSON.stringify(played.state));
      expect(restored.score, game).toBe(played.score);
      expect(restored.elapsedSeconds).toBe(12);
    }
  });

  it("refuses a log its own engine will not fold", () => {
    const dealt = startGame("klondike", "draw1", 5);
    expect(() =>
      resumeGame({
        game: "klondike",
        variant: "draw1",
        seed: 5,
        moves: [{ kind: "draw" }, { kind: "recycle" }, { kind: "draw" }],
        elapsedSeconds: 0,
      }),
    ).toThrow();
    expect(dealt.log).toEqual([]);
  });
});

describe("undo", () => {
  it("returns a solitaire to where the last action began", () => {
    const dealt = startGame("klondike", "draw1", 11);
    const before = legalMoves(dealt)[0]!;
    const stepped = stepSession(dealt, before, 0);
    expect(canUndo(stepped)).toBe(true);
    const back = undoSession(stepped);
    // The POSITION is the dealt one again — the log is not, and should not be: the
    // undo is IN it, which is what makes the log the whole history of the game.
    expect(boardOf(back)).toBe(boardOf(dealt));
    expect(back.log.length).toBe(stepped.log.length + 1);
    expect(back.log[back.log.length - 1]).toEqual({ kind: "undo" });
  });

  it("takes back a whole turn against the computer: the person's move AND its answers", () => {
    // Hearts: the person plays one card and the other three seats answer before it
    // is the person's turn again. One press of undo has to come back to the top of the
    // person's own turn — the position they were given PLUS every card the machine
    // answered with — or the table is handed to a seat that has not played.
    let session = startGame("hearts", "standard", 31);
    // Four passes (the person's and the machine's three) put the table into the first
    // trick; the trick is then led by the seat after the dealer until it is the
    // person's turn.
    for (let step = 0; step < 8 && session.log.length < 4; step += 1) {
      session = stepSession(session, legalMoves(session)[0], 0);
    }
    for (let step = 0; step < 8 && seatNow(session) !== 0; step += 1) {
      session = stepSession(session, legalMoves(session)[0], 0);
    }
    expect(seatNow(session)).toBe(0);
    const anchor = session;
    // The person leads, and the three other seats answer with the first move each
    // enumeration offers — exactly what the page's worker loop does.
    const played = stepSession(session, legalMoves(session)[0], 0);
    let answered = played;
    for (let step = 0; step < 8 && seatNow(answered) !== 0; step += 1) {
      answered = stepSession(answered, legalMoves(answered)[0], 0);
    }
    expect(answered.log.length).toBeGreaterThan(anchor.log.length + 1);

    const back = undoSession(answered);
    expect(boardOf(back)).toBe(boardOf(anchor));
    expect(back.log.length).toBe(anchor.log.length);
  });
});

describe("the computer's turn", () => {
  it("knows which games have a machine in them", () => {
    for (const game of CARD_GAMES) {
      expect(isComputerGame(game), game).toBe(
        game === "hearts" || game === "spades" || game === "tablic",
      );
      expect(seatCount(game, CARD_GAME_VARIANTS[game][0]!), game).toBe(
        isComputerGame(game) ? (game === "tablic" ? 2 : 4) : 1,
      );
    }
  });

  it("gives every ply a different stream, so a search cannot shift the deal's dice", () => {
    expect(moveSeed(7, 0)).not.toBe(moveSeed(7, 1));
    expect(moveSeed(7, 1)).not.toBe(moveSeed(8, 0));
    // 32-bit arithmetic wraps on purpose: the stream is the generators' own width.
    for (let ply = 0; ply < 200; ply += 1) {
      const seed = moveSeed(4_294_967_295, ply);
      expect(Number.isSafeInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffff_ffff);
    }
  });

  it("reads the seat to act off the position exactly as the engine folds it", () => {
    for (const { game, variant } of SAMPLES) {
      let session = startGame(game, variant, 515);
      for (let step = 0; step < 60; step += 1) {
        // The engine's own `*ToAct` (through `seatToAct`) replays the whole log; the
        // page reads the same answer off the position (`seatNow`). A drift between
        // the two would put the wrong seat in charge of the table.
        expect(seatNow(session), `${game} at ${step}`).toBe(seatToAct(session));
        const moves = legalMoves(session);
        if (moves.length === 0 || moves.length > 4_000 || seatNow(session) < 0) break;
        session = stepSession(session, moves[0], 0);
      }
    }
  });
});

describe("the move list's own rendering", () => {
  it("names every kind of move in words rather than falling back to a blank", () => {
    const moves = [
      { kind: "draw" },
      { kind: "recycle" },
      { kind: "deal" },
      { kind: "collect" },
      { kind: "turn" },
      { kind: "match", first: { kind: "waste" } },
      { kind: "match", first: { kind: "waste" }, second: { kind: "pyramid", index: 4 } },
      { kind: "pass", cards: [] },
      { kind: "bid", bid: 0 },
      { kind: "bid", bid: 5 },
      { kind: "move", from: { kind: "waste" }, to: { kind: "tableau", column: 0 }, count: 1 },
      { kind: "play", card: { suit: "spades", rank: 1 } },
    ];
    for (const move of moves) {
      const text = describeMove(move);
      expect(text.label.length, JSON.stringify(move)).toBeGreaterThan(0);
      expect(text.label.includes("{"), JSON.stringify(move)).toBe(false);
    }
    expect(describeMove({ kind: "play", card: { suit: "spades", rank: 1 } }).card).toBeTruthy();
    expect(describeMove({ kind: "draw" }).card).toBeNull();
    expect(describeMove({ kind: "bid", bid: 0 }).label).not.toBe(describeMove({ kind: "bid", bid: 5 }).label);
  });
});

describe("the boards' boxes", () => {
  it("reads a Klondike move's source and target off the move itself", () => {
    const session = startGame("klondike", "draw3", 3);
    const draw = legalMoves(session).find((move) => (move as { kind: string }).kind === "draw")!;
    expect(boxKey(sourceBox("klondike", draw)!)).toBe("stock");
    expect(targetBox("klondike", draw)).toBeNull();
  });

  it("lights the boxes the engine's enumeration names, and no others", () => {
    for (const game of ["klondike", "freecell", "spider", "pyramid", "tripeaks", "golf"] as const) {
      const session = startGame(game, CARD_GAME_VARIANTS[game][0]!, 77);
      const moves = legalMoves(session);
      const marks = highlights(game, moves, null);
      expect(marks.pickable.size, game).toBeGreaterThan(0);
      for (const move of moves) {
        const source = sourceBox(game, move);
        if (source !== null) expect(marks.pickable.has(boxKey(source)), game).toBe(true);
      }
      // A box that is not the source of any move is not offered.
      for (const key of marks.pickable) {
        expect(
          moves.some((move) => {
            const source = sourceBox(game, move);
            return source !== null && boxKey(source) === key;
          }),
          `${game}/${key}`,
        ).toBe(true);
      }
    }
  });

  it("finds the move a click would play by its two boxes", () => {
    const session = startGame("freecell", "classic", 617);
    const move = legalMoves(session)[0]!;
    const from = sourceBox("freecell", move);
    const to = targetBox("freecell", move);
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    const found = moveTo("freecell", legalMoves(session), from!, to!);
    expect(found).not.toBeNull();
    // The boxes name the same move the engine offered, by its own fields.
    expect(boxKey(sourceBox("freecell", found!)!)).toBe(boxKey(from!));
    expect(boxKey(targetBox("freecell", found!)!)).toBe(boxKey(to!));
  });

  it("plays the move into the box that was clicked, not the first one from the source", () => {
    // A card with two places to go must go to the one chosen: every legal move,
    // looked up by its own two boxes, comes back as a move into that same box.
    for (const game of ["klondike", "freecell", "spider", "golf"] as const) {
      for (const seed of [3, 77, 617]) {
        const moves = legalMoves(startGame(game, CARD_GAME_VARIANTS[game][0]!, seed));
        for (const move of moves) {
          const from = sourceBox(game, move);
          const to = targetBox(game, move);
          if (from === null || to === null) continue;
          const found = moveTo(game, moves, from, to);
          expect(boxKey(targetBox(game, found)!), `${game}/${seed}`).toBe(boxKey(to));
        }
      }
    }
  });

  it("turns the stock with one click, and only where nothing from the box needs a destination", () => {
    const klondike = startGame("klondike", "draw1", 3);
    const draw = directMove("klondike", legalMoves(klondike), { kind: "stock" });
    expect((draw as { kind: string }).kind).toBe("draw");
    const spider = startGame("spider", CARD_GAME_VARIANTS.spider[0]!, 3);
    expect((directMove("spider", legalMoves(spider), { kind: "stock" }) as { kind: string }).kind).toBe("deal");
    const freecell = legalMoves(startGame("freecell", "classic", 617));
    const column = sourceBox("freecell", freecell[0]);
    expect(directMove("freecell", freecell, column!)).toBeNull();
  });

  it("keeps the stock a control while a play is on the board, in TriPeaks and Golf alike", () => {
    // A turn is legal whenever the stock is not empty, so the pile stays clickable
    // beside the plays rather than only once the board is blocked — which is the
    // app's own rule, not the cited article's (see the engines' headers).
    for (const game of ["tripeaks", "golf"] as const) {
      const session = startGame(game, "classic", 617);
      const moves = legalMoves(session);
      expect(moves.some((move) => (move as { kind: string }).kind === "play"), game).toBe(true);
      expect(highlights(game, moves, null).pickable.has("stock"), game).toBe(true);
      expect((directMove(game, moves, { kind: "stock" }) as { kind: string }).kind, game).toBe("turn");
    }
  });

  it("reads both boxes of every move between piles, so a column can be picked up and built on", () => {
    // Klondike calls a column „tableau" and FreeCell „column"; unread, no Klondike
    // column was ever a source or a destination.
    for (const game of ["klondike", "freecell", "spider"] as const) {
      const between = [1, 2, 3, 4, 5].flatMap((seed) => {
        const moves = legalMoves(startGame(game, CARD_GAME_VARIANTS[game][0]!, seed));
        return moves
          .filter((move) => (move as { kind: string }).kind === "move")
          .map((move) => ({ moves, move }));
      });
      expect(between.length, game).toBeGreaterThan(0);
      for (const { moves, move } of between) {
        const from = sourceBox(game, move);
        const to = targetBox(game, move);
        expect(from, game).not.toBeNull();
        expect(to, game).not.toBeNull();
        expect(highlights(game, moves, from).targets.has(boxKey(to!)), game).toBe(true);
        if (from!.kind === "column") {
          expect(picksRun(game, moves, from!.column, (move as { count: number }).count), game).toBe(true);
        }
      }
    }
  });

  it("lets a click pick up a FreeCell column's top card, which a free cell always takes", () => {
    const moves = legalMoves(startGame("freecell", "classic", 617));
    for (let column = 0; column < 8; column++) expect(picksRun("freecell", moves, column, 1)).toBe(true);
    expect(picksRun("freecell", moves, 0, 0)).toBe(false);
  });
});

describe("the module's shelf", () => {
  it("lists the nine games in the vocabulary's own order, with their variants", () => {
    expect([...GAME_ORDER]).toEqual([...CARD_GAMES]);
    for (const game of CARD_GAMES) {
      expect(variantsOf(game).length, game).toBeGreaterThan(0);
      for (const variant of variantsOf(game)) {
        expect(isCardGameVariant(game, variant), `${game}/${variant}`).toBe(true);
      }
    }
  });

  it("knows a game is over when the engine says it is won or has no move left", () => {
    const dealt = startGame("golf", "classic", 2);
    expect(isWon(dealt)).toBe(false);
    expect(isFinished(dealt)).toBe(false);
    // A hint is offered only where the engine has one, and the safe-move button
    // only where there is a safe move.
    expect(hintMove(startGame("hearts", "standard", 1))).toBeNull();
    expect(safeMoves(startGame("hearts", "standard", 1))).toEqual([]);
  });
});

describe("a whole game", () => {
  it("plays every game through many of its own moves, using only what the engine enumerated", () => {
    for (const { game, variant } of SAMPLES) {
      let session = startGame(game, variant, 1234);
      let actions = 0;
      while (seatNow(session) >= 0 && actions < 400) {
        const moves = legalMoves(session);
        // Tablić's enumeration is a set of capture GROUPS and explodes when a
        // table is allowed to pile up — a table a real player never leaves, because
        // the rules make a capture compulsory. The cap keeps this suite quick rather
        // than documenting a limit on the game (`renderer/rules.ts` says the same).
        if (moves.length === 0 || moves.length > 4_000) break;
        session = stepSession(session, moves[0], 0);
        actions += 1;
      }
      expect(actions, game).toBeGreaterThan(0);
      // Every action is in the log, and the log replays — which is the store's own
      // promise, checked here against the page's own transitions.
      const restored = resumeGame({
        game,
        variant,
        seed: 1234,
        moves: session.log,
        elapsedSeconds: 0,
      });
      expect(JSON.stringify(restored.state), game).toBe(JSON.stringify(session.state));
      // The card codes the move list prints are the fixtures' two characters.
      const cards = JSON.stringify(session.state).match(/"suit":"[a-z]+","rank":\d+/g) ?? [];
      for (const code of cards.slice(0, 3)) {
        const [, suit, rank] = /"suit":"([a-z]+)","rank":(\d+)/.exec(code) ?? [];
        expect(cardCode({ suit: suit as never, rank: Number(rank) as never }).length).toBe(2);
      }
    }
  });
});

/**
 * Plays up to `actions` moves of a session, always the first the engine offers.
 *
 * The person's seat is 0 and every other seat is driven the same way, which is what
 * a game against the computer looks like from the engine's side: the enumeration is
 * the same list whoever is acting, and the log is one history of the table.
 */
function playFor(session: CardSession, actions: number): CardSession {
  let next = session;
  for (let step = 0; step < actions; step += 1) {
    const moves = legalMoves(next);
    if (moves.length === 0 || moves.length > 4_000 || seatNow(next) < 0) break;
    next = stepSession(next, moves[0], 0);
  }
  return next;
}

/** The position a session is in, without its log — what undo has to restore. */
function boardOf(session: CardSession): string {
  return JSON.stringify((session.state as { board?: unknown }).board ?? session.state);
}
