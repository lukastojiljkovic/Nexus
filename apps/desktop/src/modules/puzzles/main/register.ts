import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_PUZZLE_ELAPSED_SECONDS,
  MAX_PUZZLE_SEED,
  PUZZLE_VARIANTS,
  PuzzlesStore,
  readPuzzleId,
  readVariant,
} from "@nexus/db";
import type { ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  contract,
  type PuzzleSaveView,
  type PuzzlesView,
  type PuzzleStatsView,
} from "../shared/ipc.js";
import { buildPuzzlesExport, parsePuzzlesExport } from "./imex.js";

/**
 * PUZZLES in the main process (ADR-090): its handlers and its archive section.
 *
 * **No schedulers, no session hooks, and that is a decision rather than an
 * omission.** Everything this module stores is a POSITION — the digits entered, a
 * board's marks, the tiles that are left, an expression — and a position is only
 * ever changed by the page the person is looking at. There is nothing to notice
 * while a window is closed, which is the whole difference between this module and
 * the kit's countdown example one file over: a timer is a moment the app has to
 * catch, and a puzzle is a state the app has to keep.
 *
 * **The arithmetic is not here.** Every check on a state — is this board a
 * sudoku, are these tiles the ones the layout deals, is this expression one the
 * six numbers can make — lives in `PuzzlesStore`, which calls the engines. This
 * file validates the wire (SEC-EL-02) against the SAME readers the store uses,
 * hands the store a payload it will re-read anyway, and answers with the rows.
 */

/**
 * Something that can open this module's store for a profile: the shape a
 * handler's `ModuleCall` and a session both have, so the code below is one
 * implementation rather than two that drift.
 */
interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function puzzlesStore(bearer: StoreBearer, profileId: string): PuzzlesStore {
    return bearer.profileDb(profileId, (db, id) => new PuzzlesStore(db, id));
  }

  /**
   * The rows as the wire declares them. One mapping, so the store's shape and
   * the wire's cannot drift apart field by field: a column renamed in a migration
   * is a compile error here rather than `undefined` in the renderer.
   */
  function viewOf(bearer: StoreBearer, profileId: string): PuzzlesView {
    const puzzles = puzzlesStore(bearer, profileId);
    const saves: PuzzleSaveView[] = puzzles.listSaves().map((save) => ({
      puzzle: save.puzzle,
      variant: save.variant,
      seed: save.seed,
      state: save.state,
      elapsedSeconds: save.elapsedSeconds,
      createdAt: save.createdAt,
      updatedAt: save.updatedAt,
    }));
    const stats: PuzzleStatsView[] = puzzles.listStats().map((row) => ({
      puzzle: row.puzzle,
      variant: row.variant,
      played: row.played,
      solved: row.solved,
      bestTimeSeconds: row.bestTimeSeconds,
      bestDistance: row.bestDistance,
      updatedAt: row.updatedAt,
    }));
    return { saves, stats, settings: puzzles.settings(), variants: PUZZLE_VARIANTS };
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("save", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const puzzle = readPuzzleId(payload.puzzle);
    // The grade is held to the puzzle's own list here as well as in the store:
    // this is the boundary the renderer reaches, and a refusal that names the
    // field is worth more than one that names a row (SEC-EL-02).
    const variant = readVariant(puzzle, payload.variant);
    puzzlesStore(call, profileId).saveProgress(
      {
        puzzle,
        variant,
        seed: call.as.asBoundedInteger(payload.seed, "seed", 0, MAX_PUZZLE_SEED),
        // The state's fields are the store's own readers' business — one
        // definition of what a sudoku is, in the package that stores it — so
        // main checks that it is an object and hands it on.
        state: call.as.asRecord(payload.state),
        elapsedSeconds: elapsed(
          call,
          payload.elapsedSeconds,
          MAX_PUZZLE_ELAPSED_SECONDS,
        ),
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("clearSave", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const puzzle = readPuzzleId(payload.puzzle);
    puzzlesStore(call, profileId).clearSave(puzzle, readVariant(puzzle, payload.variant));
    return viewOf(call, profileId);
  });

  ctx.handle("finish", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const puzzle = readPuzzleId(payload.puzzle);
    const distance =
      payload.distance === undefined || payload.distance === null
        ? null
        : call.as.asBoundedInteger(payload.distance, "distance", 0, 1000);
    puzzlesStore(call, profileId).finish(
      {
        puzzle,
        variant: readVariant(puzzle, payload.variant),
        solved: call.as.asBoolean(payload.solved, "solved"),
        elapsedSeconds: elapsed(call, payload.elapsedSeconds, MAX_PUZZLE_ELAPSED_SECONDS),
        distance,
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("setCheckWhileTyping", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    puzzlesStore(call, profileId).setCheckWhileTyping(
      call.as.asBoolean(payload.checkWhileTyping, "checkWhileTyping"),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  // --- The archive (ADR-090 §imex) ------------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return buildPuzzlesExport(puzzlesStore(session, profileId).exportData());
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload - the version first - and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parsePuzzlesExport,
    // The writing half. `undefined` is an archive that says nothing about
    // Puzzles, which for a restore that replaces a profile whole means empty: no
    // games in progress, no record, and no preference row at all — so the
    // profile answers the store's own default rather than a boolean restated
    // here.
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        puzzlesStore(session, profileId).replaceFromArchive(
          {
            saves: payload?.saves ?? [],
            stats: payload?.stats ?? [],
            settings: payload?.settings ?? null,
          },
          instant(session.now()),
        );
      }
    },
  });
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written ONE profile at a time (`main/imex.ts`'s `handleExport`
 * gathers one profile's `ProfileData`), so „several" is not a shape the exporter
 * meets. Answering `null` rather than guessing is what keeps that true: if a
 * session ever did name several, this module has no single profile the games
 * belong to, and the honest payload is none at all rather than the first
 * profile's boards written under somebody else's name.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** A whole number of seconds one sitting took, bounded as the store's column bounds it. */
function elapsed(
  call: {
    readonly as: {
      asBoundedInteger(value: unknown, field: string, min: number, max: number): number;
    };
  },
  value: unknown,
  max: number,
): number {
  return call.as.asBoundedInteger(value, "elapsedSeconds", 0, max);
}
