import type Database from "better-sqlite3-multiple-ciphers";
import {
  CARD_GAME_VARIANTS,
  CARD_GAMES,
  isCardGameId,
  isCardGameVariant,
  isCardSeed,
  isFreeCellDeal,
} from "@nexus/core";
import type { CardGameId, CardGameVariant } from "@nexus/core";
import {
  CARD_GAME_ARCHIVE_VERSION,
  CardGameStore,
  MAX_CARD_GAME_ELAPSED_SECONDS,
  MAX_CARD_GAME_MOVES,
} from "@nexus/db";
import type { ModuleHostSurface, ModuleValidators } from "../../../main/moduleIpc.js";
import { contract, type CardsSaveView, type CardsStatView, type CardsView } from "../shared/ipc.js";
import { buildCardsExport, parseCardsExport } from "./imex.js";

/**
 * CARDS in the main process (ADR-090): its handlers and its archive section.
 *
 * **Nothing here computes a rule.** What a legal move is, whether a log produces the
 * position, how a score is folded and who has won are `CardGameStore`'s — which
 * reads them off the nine engines — and the computer's move is chosen in the page's
 * worker, never in main. This file's whole job is the wire: validate the payload
 * (SEC-EL-02), call the store, answer with the one view every op answers with.
 *
 * **Why the score is not on the wire.** The store folds the move list through the
 * game's own engine and reads the score off the state it lands in, so a page that
 * sent a score would be sending a number the engine already knows. `record` takes
 * `won` from the page because winning is the engine's own test (`isXWon`) and it is
 * the one fact that cannot be recovered from the score alone — Golf's score counts
 * cards left, and a smaller number is a better RESULT without saying who won.
 *
 * **Why there is no scheduler and no session hook.** A game's position is written
 * after every action and read back when somebody opens the page again, so there is
 * nothing for main to keep running between calls — the timers module's reason for
 * arming clocks does not apply one group over.
 */

/** Something that can open this module's store for a profile: a handler's `ModuleCall` or a session. */
interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function cardsStore(bearer: StoreBearer, profileId: string): CardGameStore {
    return bearer.profileDb(profileId, (db, id) => new CardGameStore(db, id));
  }

  /**
   * The rows as the wire declares them. One mapping, so the store's shape and the
   * wire's cannot drift apart field by field: a column renamed in a migration is a
   * compile error here rather than `undefined` in the renderer.
   *
   * The score of a game in progress is the one the STORE folded when the row was
   * written, not a number the page handed over — a saved game's score is a fact about
   * its log.
   */
  function viewOf(bearer: StoreBearer, profileId: string): CardsView {
    const cards = cardsStore(bearer, profileId);
    const saves: CardsSaveView[] = cards.listProgress().map((progress) => ({
      game: progress.game,
      variant: progress.variant,
      seed: progress.seed,
      moves: progress.moves as CardsSaveView["moves"],
      score: progress.score,
      elapsedSeconds: progress.elapsedSeconds,
      updatedAt: progress.updatedAt,
    }));
    const stats: CardsStatView[] = cards.listStats().map((row) => ({
      game: row.game,
      variant: row.variant,
      played: row.played,
      won: row.won,
      bestTimeMs: row.bestTimeMs,
      bestScore: row.bestScore,
      currentStreak: row.currentStreak,
      longestStreak: row.longestStreak,
      updatedAt: row.updatedAt,
    }));
    return { saves, stats };
  }

  /** A game id off the wire, or a refusal that names the field. */
  function asGame(as: ModuleValidators, value: unknown): CardGameId {
    const game = as.asString(value, "game");
    if (!isCardGameId(game)) {
      throw new Error(`Invalid IPC payload: "game" must be one of ${CARD_GAMES.join(", ")}.`);
    }
    return game;
  }

  /** A variant judged against the GAME's own closed list, which is the rule the store applies next. */
  function asVariant(as: ModuleValidators, game: CardGameId, value: unknown): CardGameVariant {
    const variant = as.asString(value, "variant");
    if (!isCardGameVariant(game, variant)) {
      throw new Error(
        `Invalid IPC payload: "variant" must be one of ${CARD_GAME_VARIANTS[game].join(", ")} for ${game}.`,
      );
    }
    return variant;
  }

  /**
   * A seed: a FreeCell deal number for FreeCell and a 32-bit unsigned integer for
   * the rest, by the SAME predicates the store and the deal refuse them with.
   */
  function asSeed(as: ModuleValidators, game: CardGameId, value: unknown): number {
    if (game === "freecell") {
      if (!isFreeCellDeal(value)) {
        throw new Error('Invalid IPC payload: "seed" must be a FreeCell deal number, 1 to 32000.');
      }
      return value;
    }
    if (!isCardSeed(value)) {
      throw new Error('Invalid IPC payload: "seed" must be a 32-bit unsigned integer.');
    }
    return value;
  }

  /**
   * A move list off the wire.
   *
   * The array's bounds are the WIRE's — the store's own ceilings, `MAX_CARD_GAME_MOVES`
   * — and each entry is only required to be an object with a string `kind`: whether a
   * move is a move is a question for the game's engine, and the store already asks it
   * by replaying the list. Restating it here would be a second implementation of nine
   * rule sets, which is the thing the one engine exists to avoid.
   */
  function asMoves(as: ModuleValidators, value: unknown): readonly unknown[] {
    if (!Array.isArray(value) || value.length > MAX_CARD_GAME_MOVES) {
      throw new Error(
        `Invalid IPC payload: "moves" must be an array of at most ${MAX_CARD_GAME_MOVES} entries.`,
      );
    }
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null || typeof (entry as { kind?: unknown }).kind !== "string") {
        throw new Error('Invalid IPC payload: every entry of "moves" must be an object with a "kind".');
      }
    }
    return value;
  }

  /** The whole clock, validated against the store's own ceiling here so a refusal names the field. */
  function asElapsed(as: ModuleValidators, value: unknown): number {
    return as.asBoundedInteger(value, "elapsedSeconds", 0, MAX_CARD_GAME_ELAPSED_SECONDS);
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("save", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const game = asGame(call.as, payload.game);
    const variant = asVariant(call.as, game, payload.variant);
    cardsStore(call, profileId).saveProgress(
      {
        game,
        variant,
        seed: asSeed(call.as, game, payload.seed),
        moves: asMoves(call.as, payload.moves),
        elapsedSeconds: asElapsed(call.as, payload.elapsedSeconds),
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("record", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const game = asGame(call.as, payload.game);
    const variant = asVariant(call.as, game, payload.variant);
    const store = cardsStore(call, profileId);
    const seed = asSeed(call.as, game, payload.seed);
    const moves = asMoves(call.as, payload.moves);
    const elapsedSeconds = asElapsed(call.as, payload.elapsedSeconds);
    if (typeof payload.won !== "boolean") {
      throw new Error('Invalid IPC payload: "won" must be a boolean.');
    }
    // The saved game is written first, so the SCORE is the store's own fold of the
    // log rather than a number off the wire; the record then takes that score and
    // the page's `won`. The two writes are one op because a finished deal that left
    // its saved game behind would be a game somebody can resume after it ended.
    const progress = store.saveProgress({ game, variant, seed, moves, elapsedSeconds }, instant(call.now()));
    store.recordResult(
      { game, variant, won: payload.won, elapsedSeconds, score: progress.score },
      instant(call.now()),
    );
    store.clearProgress(game, variant);
    return viewOf(call, profileId);
  });

  ctx.handle("clear", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const game = asGame(call.as, payload.game);
    const variant = asVariant(call.as, game, payload.variant);
    cardsStore(call, profileId).clearProgress(game, variant);
    return viewOf(call, profileId);
  });

  // --- The archive (ADR-090 §imex) -----------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return buildCardsExport(cardsStore(session, profileId));
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload — the version first — and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseCardsExport,
    // The writing half. `undefined` is an archive that says nothing about card
    // games, which for a restore that replaces a profile whole means empty: no
    // saved games and no record, so the profile answers the store's own zeroes.
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        const cards = cardsStore(session, profileId);
        if (payload === undefined) {
          cards.importData({ version: CARD_GAME_ARCHIVE_VERSION, stats: [], saves: [] });
          continue;
        }
        cards.importData(payload);
      }
    },
  });

}

/**
 * The one profile a session is about, or `null` when it names none or several — the
 * timers rule, for its reason: an archive is written ONE profile at a time.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}
