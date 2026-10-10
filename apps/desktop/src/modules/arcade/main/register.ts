import type Database from "better-sqlite3-multiple-ciphers";
import {
  ARCADE_GAMES,
  MAX_ARCADE_LINES,
  MAX_ARCADE_SCORE,
  MAX_ARCADE_TIME_MS,
  ArcadeScoreStore,
  type ArcadeResult,
} from "@nexus/db";
import {
  MINESWEEPER_MAX_COLUMNS,
  MINESWEEPER_MAX_ROWS,
  TILE_2048_SIZES,
  minesweeperVariant,
  validateMinesweeperConfig,
} from "@nexus/core";
import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  ARCADE_GAME_IDS,
  contract,
  type ArcadeScoreView,
  type ArcadeView,
} from "../shared/ipc.js";
import { buildArcadeExport, emptyArcadeExport, parseArcadeSection } from "./imex.js";

/**
 * ARCADE in the main process (ADR-090): two handlers, the board keys they
 * derive, and its archive section.
 *
 * **Main owns nothing but the row.** There is no clock to arm and no scheduler
 * to run: a game is a value the page holds, and all main ever sees of it is the
 * moment it ended. That is why this file is small where `timers/main/register.ts`
 * is long, and it is a property of the product rather than an unfinished edge -
 * closing the window during a game of Blocks loses that game, exactly as it
 * would in a game that never heard of a database.
 *
 * **The board key is derived HERE, from the numbers the page sent.** The store's
 * row is keyed by (profile, game, board) because a best time over a 9 x 9 board
 * says nothing about a 30 x 16 one, and `minesweeperVariant` is the one function
 * that turns a board into its key. A renderer that named its own bucket could
 * file a beginner time under the expert board, and nothing downstream could
 * notice - so the payload carries columns, rows and mines, `validateMinesweeper`
 * refuses a board that cannot be played at all (a first click has to be safe),
 * and the key falls out of the same values the engine was configured with.
 *
 * **A game's second count is read under the game's own name.** `ArcadeResultPayload`
 * is a union, so `lines` exists only on a Blocks result and `eaten` only on a
 * Snake one; `toStoreResult` is the single place either is read, and a game that
 * somehow arrived without its own field is refused by the store's validator
 * rather than recorded as a zero.
 */

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function store(call: StoreBearer, profileId: string): ArcadeScoreStore {
    return call.profileDb(profileId, (db, id) => new ArcadeScoreStore(db, id));
  }

  /**
   * The rows as the wire declares them. One mapping, so the store's shape and
   * the wire's cannot drift field by field - and the one place `bestLines`
   * becomes `bestCount`, because the wire names what the number IS for the game
   * being read rather than which column it came out of.
   */
  function viewOf(bearer: StoreBearer, profileId: string): ArcadeView {
    const scores: ArcadeScoreView[] = store(bearer, profileId)
      .list()
      .map((row) => ({
        game: row.game,
        variant: row.variant,
        played: row.played,
        won: row.won,
        bestTimeMs: row.bestTimeMs,
        bestScore: row.bestScore,
        bestCount: row.bestLines,
        currentStreak: row.currentStreak,
        longestStreak: row.longestStreak,
        lastPlayedAt: row.lastPlayedAt,
      }));
    return { scores };
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("record", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const result = toStoreResult(call, payload.result);
    store(call, profileId).record(result, instant(call.now()));
    return viewOf(call, profileId);
  });

  // --- The archive (ADR-090, the imex slot) ---------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return buildArcadeExport(store(session, profileId));
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: `@nexus/db` owns it, so the preview's answer and the store's own
    // revalidation are one function rather than two that agree today.
    parse: parseArcadeSection,
    // The writing half. `undefined` is an archive that says nothing about
    // Arcade, which for a restore that replaces a profile whole means empty.
    apply: (payload, session) => {
      const value = payload ?? emptyArcadeExport();
      for (const profileId of session.profileIds) {
        store(session, profileId).importData(value);
      }
    },
  });
}

/**
 * Something that can open this module's store for a profile: the shape a
 * handler's `ModuleCall` and a session both have, so the code above is one
 * implementation rather than two that drift.
 */
interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: DatabaseHandle, profileId: string) => T): T;
}

type DatabaseHandle = Database.Database;

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/**
 * One finished game from the wire, as the store's own union.
 *
 * Every field is validated here, at the boundary, and the ORDER is the
 * validator's rather than the game's: no branch reads a field before the record
 * around it has been checked. The variant is not on the wire at all (see
 * `shared/ipc.ts`), which is why each arm ends by deriving a board key.
 */
function toStoreResult(call: ModuleCall, value: unknown): ArcadeResult {
  const raw = call.as.asRecord(value);
  const game = raw["game"];
  if (typeof game !== "string" || !(ARCADE_GAME_IDS as readonly string[]).includes(game)) {
    throw new Error(
      `Invalid IPC payload: "result.game" must be one of ${ARCADE_GAME_IDS.join(" / ")}.`,
    );
  }
  // The store's own list, restated by the compiler: a game added to one and not
  // the other is a type error rather than a channel that refuses live input.
  assertKnownGame(game);

  switch (game) {
    case "minesweeper": {
      const config = {
        columns: call.as.asBoundedInteger(raw["columns"], "columns", 1, MINESWEEPER_MAX_COLUMNS),
        rows: call.as.asBoundedInteger(raw["rows"], "rows", 1, MINESWEEPER_MAX_ROWS),
        mines: call.as.asBoundedInteger(raw["mines"], "mines", 1, MINESWEEPER_MAX_COLUMNS * MINESWEEPER_MAX_ROWS),
      };
      // The engine's own rule, which also refuses a board whose first click
      // could not be guaranteed safe - the promise the whole game rests on.
      const checked = validateMinesweeperConfig(config);
      if (!checked.ok) {
        throw new Error(
          `Invalid IPC payload: "result" is not a playable board (field ${checked.field ?? "whole value"}).`,
        );
      }
      const won = call.as.asBoolean(raw["won"], "won");
      // A loss has no time to keep, so the field is not even read for one: the
      // row can then never disagree with the rule the store enforces.
      const timeMs = won
        ? call.as.asBoundedInteger(raw["timeMs"], "timeMs", 1, MAX_ARCADE_TIME_MS)
        : null;
      return {
        game: "minesweeper",
        variant: minesweeperVariant(checked.config),
        won,
        timeMs,
      };
    }
    case "blocks":
      return {
        game: "blocks",
        variant: STANDARD_BOARD,
        score: call.as.asBoundedInteger(raw["score"], "score", 0, MAX_ARCADE_SCORE),
        lines: call.as.asBoundedInteger(raw["lines"], "lines", 0, MAX_ARCADE_LINES),
      };
    case "snake":
      return {
        game: "snake",
        variant: STANDARD_BOARD,
        score: call.as.asBoundedInteger(raw["score"], "score", 0, MAX_ARCADE_SCORE),
        eaten: call.as.asBoundedInteger(raw["eaten"], "eaten", 0, MAX_ARCADE_LINES),
      };
    case "bricks":
      return {
        game: "bricks",
        variant: STANDARD_BOARD,
        score: call.as.asBoundedInteger(raw["score"], "score", 0, MAX_ARCADE_SCORE),
        levels: call.as.asBoundedInteger(raw["levels"], "levels", 0, MAX_ARCADE_LINES),
      };
    case "tile2048": {
      const size = call.as.asBoundedInteger(raw["size"], "size", 1, 64);
      if (!(TILE_2048_SIZES as readonly number[]).includes(size)) {
        throw new Error(
          `Invalid IPC payload: "size" must be one of ${TILE_2048_SIZES.join(" / ")}.`,
        );
      }
      return {
        game: "tile2048",
        // The board IS the key, the store's own rule, and the engine is what
        // says which boards exist.
        variant: `${size}x${size}`,
        score: call.as.asBoundedInteger(raw["score"], "score", 0, MAX_ARCADE_SCORE),
        moves: call.as.asBoundedInteger(raw["moves"], "moves", 0, MAX_ARCADE_LINES),
        won: call.as.asBoolean(raw["won"], "won"),
      };
    }
  }
}

/** The variant of the three games whose whole board is fixed by their engine. */
const STANDARD_BOARD = "standard";

/**
 * Refuses a game id the STORE's list does not carry.
 *
 * `ARCADE_GAME_IDS` here is the wire's vocabulary and `ARCADE_GAMES` there is
 * the schema's, and the two are the same five words. They cannot be one constant
 * - no file under `shared/` may import `@nexus/db` - so this is the seam that
 * makes a drift a runtime refusal rather than a row the schema rejects: the
 * check is exhaustive by construction, and the switch after it is exhaustive by
 * the compiler.
 */
function assertKnownGame(game: string): asserts game is (typeof ARCADE_GAME_IDS)[number] {
  if (!(ARCADE_GAMES as readonly string[]).includes(game)) {
    throw new Error(`Invalid IPC payload: "result.game" is not one this build records.`);
  }
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written one profile at a time, so "several" is not a shape the
 * exporter meets; answering `null` rather than guessing is what keeps that true.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}
