import type Database from "better-sqlite3-multiple-ciphers";
import {
  SCOREBOARD_MAX_NAME_LENGTH,
  SCOREBOARD_MAX_PLAYERS,
  SCOREBOARD_MAX_ROUNDS,
  SCOREBOARD_MAX_SCORE,
  TALLY_MAX_COUNTERS,
  TALLY_MAX_NAME_LENGTH,
  TALLY_MAX_STEP,
  TYPING_LAYOUTS,
  type ScoreboardBoard,
  type ScoreboardPlayer,
  type ScoreboardRound,
  type TallyCounter,
  type TypingLayoutId,
} from "@nexus/core";
import {
  MINIAPPS_MAX_CITIES,
  MINIAPPS_MAX_HISTORY,
  MINIAPPS_MAX_TYPING_RECORDS,
  MINIAPPS_MAX_ZONE_LENGTH,
  MiniappsStore,
} from "@nexus/db";
import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  contract,
  isMiniappsAppId,
  type MiniappsAppId,
  type MiniappsDiceEntryView,
  type MiniappsTypingProgressView,
  type MiniappsView,
} from "../shared/ipc.js";
import { buildMiniappsExport, parseMiniappsExport } from "./imex.js";

/**
 * MINI-APPS in the main process (ADR-090): its handlers and its archive section.
 *
 * **What the page does and what main does.** The engines live in `@nexus/core`
 * and run in the renderer, where the user is: a roll, a tally press, a keystroke
 * and a metronome click are the page's own business. Main owns exactly one
 * thing - `miniapps_state`, the kept document - and this file is the only route
 * to it. So the arithmetic is not here and neither is the state: the page hands
 * over what a tool now holds, main validates it field by field (SEC-EL-02),
 * writes it through the store, and answers with the whole view.
 *
 * **The validators are the store's bounds, restated at the wire.** Every limit
 * below comes from the engine that will hold the value (`TALLY_MAX_*`,
 * `SCOREBOARD_MAX_*`) or from the store (`MINIAPPS_MAX_*`), so a refusal names
 * the field and happens before a row is touched. The store validates the same
 * document again on the way in, which is not redundancy: the wire shapes what a
 * page may send, the store shapes what a database may hold, and the two are
 * checked against the same engines rather than against each other.
 *
 * **`lastApp` is the wire's vocabulary.** Which ids are legal is
 * `shared/ipc.ts`'s `MINIAPPS_APP_IDS`, and a stored id this build does not know
 * reads back as `null` - the grid - rather than as a page that cannot open. That
 * is also why the store deliberately does not police the vocabulary: a document
 * written by a later build must not brick an older one.
 *
 * **Nothing here is scheduled and nothing is announced.** A metronome ticks in
 * the page that is playing it, and no tool of this module has anything to say
 * when the user is not looking at it - so there is no `ctx.armUntil` and no
 * `ctx.notify`, which is the honest answer rather than an omission.
 */

/** The engine's two typing layouts at runtime, without a second hand-written list. */
const TYPING_LAYOUT_IDS = Object.keys(TYPING_LAYOUTS) as TypingLayoutId[];

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

  function miniappsStore(bearer: StoreBearer, profileId: string): MiniappsStore {
    return bearer.profileDb(profileId, (db, id) => new MiniappsStore(db, id));
  }

  /**
   * The kept document as the wire declares it. One mapping, so the store's shape
   * and the view's cannot drift field by field, and the one place an unknown
   * `lastApp` is turned into "no tile open".
   */
  function viewOf(bearer: StoreBearer, profileId: string): MiniappsView {
    const data = miniappsStore(bearer, profileId).read();
    return {
      lastApp: isMiniappsAppId(data.lastApp) ? data.lastApp : null,
      counters: data.counters,
      scoreboard: data.scoreboard,
      typing: data.typing,
      cities: data.cities,
      diceHistory: data.diceHistory,
    };
  }

  /** A read into the wire's shape, and what every write answers with. */
  function changed(bearer: StoreBearer, profileId: string): MiniappsView {
    return viewOf(bearer, profileId);
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("setLastApp", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    miniappsStore(call, profileId).setLastApp(asLastApp(call, payload.app), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("saveCounters", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    miniappsStore(call, profileId).saveCounters(asCounters(call, payload.counters), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("saveScoreboard", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    miniappsStore(call, profileId).saveScoreboard(asBoard(call, payload.board), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("saveTyping", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    miniappsStore(call, profileId).saveTyping(asTyping(call, payload.progress), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("saveCities", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    miniappsStore(call, profileId).saveCities(asCities(call, payload.cities), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("saveDiceHistory", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    miniappsStore(call, profileId).saveDiceHistory(
      asHistory(call, payload.history),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  // --- The archive (ADR-090 section imex) -----------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return buildMiniappsExport(miniappsStore(session, profileId).read());
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload - the version first - and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseMiniappsExport,
    // The writing half. `undefined` is an archive that says nothing about
    // Mini-apps, which for a restore that replaces a profile whole means EMPTY:
    // the row is deleted, so the profile answers the empty document rather than
    // a boolean restated here.
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        miniappsStore(session, profileId).replaceFromArchive(
          payload,
          instant(session.now()),
        );
      }
    },
  });
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written one profile at a time, so "several" is not a shape the
 * exporter meets; answering `null` rather than guessing is what keeps that true
 * (`Timers`' own `soleProfile`, for the same reason).
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

// --- Wire validators --------------------------------------------------------
//
// One per payload field, each naming the field the caller sent. They are the
// engines' own bounds applied at the boundary: a payload that could never be
// stored is refused before the store sees it, and the store checks it again.

/** An array payload field, bounded before a single element is read. */
function asArray(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be an array.`);
  }
  if (value.length > max) {
    throw new Error(`Invalid IPC payload: "${field}" holds at most ${max} entries.`);
  }
  return value;
}

/** A finite number in `0..max` - what a metric (a speed, a fraction) is. */
function asMetric(value: unknown, field: string, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`Invalid IPC payload: "${field}" must be a number between 0 and ${max}.`);
  }
  return value;
}

/** One of the engine's two typing layouts. */
function asLayout(value: unknown, field: string): TypingLayoutId {
  if (typeof value !== "string" || !TYPING_LAYOUT_IDS.includes(value as TypingLayoutId)) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be one of ${TYPING_LAYOUT_IDS.join(", ")}.`,
    );
  }
  return value as TypingLayoutId;
}

/** A tile id, or an explicit `null` for the grid. */
function asLastApp(call: ModuleCall, value: unknown): MiniappsAppId | null {
  if (value === null) return null;
  const app = call.as.asNonEmptyString(value, "app");
  if (!isMiniappsAppId(app)) {
    throw new Error(`Invalid IPC payload: "app" is not a tile of this module.`);
  }
  return app;
}

function asCounters(call: ModuleCall, value: unknown): TallyCounter[] {
  return asArray(value, "counters", TALLY_MAX_COUNTERS).map((entry, index) => {
    const counter = call.as.asRecord(entry);
    const at = `counters[${index}]`;
    const floorZero = call.as.asBoolean(counter.floorZero, `${at}.floorZero`);
    return {
      id: call.as.asId(counter.id, `${at}.id`),
      name: call.as.asCappedChars(
        call.as.asNonEmptyString(counter.name, `${at}.name`),
        `${at}.name`,
        TALLY_MAX_NAME_LENGTH,
      ),
      value: call.as.asInteger(counter.value, `${at}.value`),
      step: call.as.asBoundedInteger(counter.step, `${at}.step`, 1, TALLY_MAX_STEP),
      floorZero,
    };
  });
}

function asBoard(call: ModuleCall, value: unknown): ScoreboardBoard {
  const board = call.as.asRecord(value);
  const players: ScoreboardPlayer[] = asArray(
    board.players,
    "board.players",
    SCOREBOARD_MAX_PLAYERS,
  ).map((entry, index) => {
    const player = call.as.asRecord(entry);
    const at = `board.players[${index}]`;
    return {
      id: call.as.asId(player.id, `${at}.id`),
      name: call.as.asCappedChars(
        call.as.asNonEmptyString(player.name, `${at}.name`),
        `${at}.name`,
        SCOREBOARD_MAX_NAME_LENGTH,
      ),
    };
  });
  const playerIds = new Set(players.map((player) => player.id));

  const rounds: ScoreboardRound[] = asArray(
    board.rounds,
    "board.rounds",
    SCOREBOARD_MAX_ROUNDS,
  ).map((entry, index) => {
    const round = call.as.asRecord(entry);
    const at = `board.rounds[${index}]`;
    const raw = call.as.asRecord(round.scores);
    const scores: Record<string, number> = {};
    for (const [playerId, score] of Object.entries(raw)) {
      // An id is bounded wherever it enters, including as a record's key: the
      // key becomes a column of this profile's board, and a round naming a
      // player nobody added is a board the store would refuse anyway.
      const id = call.as.asId(playerId, `${at}.scores[].id`);
      if (!playerIds.has(id)) {
        throw new Error(`Invalid IPC payload: "${at}" scores a player who is not on the board.`);
      }
      scores[id] = call.as.asBoundedInteger(
        score,
        `${at}.scores.${id}`,
        -SCOREBOARD_MAX_SCORE,
        SCOREBOARD_MAX_SCORE,
      );
    }
    return { scores };
  });

  return {
    players,
    rounds,
    target:
      board.target === null
        ? null
        : call.as.asBoundedInteger(board.target, "board.target", 1, Number.MAX_SAFE_INTEGER),
  };
}

function asTyping(call: ModuleCall, value: unknown): MiniappsTypingProgressView {
  const progress = call.as.asRecord(value);
  const records = asArray(
    progress.records,
    "progress.records",
    MINIAPPS_MAX_TYPING_RECORDS,
  ).map((entry, index) => {
    const record = call.as.asRecord(entry);
    const at = `progress.records[${index}]`;
    return {
      layout: asLayout(record.layout, `${at}.layout`),
      lessonId: call.as.asId(record.lessonId, `${at}.lessonId`),
      netWpm: asMetric(record.netWpm, `${at}.netWpm`, 1000),
      accuracy: asMetric(record.accuracy, `${at}.accuracy`, 1),
      atMs: call.as.asBoundedInteger(record.atMs, `${at}.atMs`, 0, Number.MAX_SAFE_INTEGER),
    };
  });
  return {
    layout: asLayout(progress.layout, "progress.layout"),
    lessonId: call.as.asId(progress.lessonId, "progress.lessonId"),
    records,
  };
}

/**
 * A city's time zone, as the world clock asks for it.
 *
 * Existence is checked HERE rather than in the store, and the split is
 * deliberate: this is the boundary the renderer may not cross, so a bogus id
 * typed into a field is refused where the user can be told, while the store
 * keeps a document whose ids a future tzdb release can still retire.
 */
function asZoneId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MINIAPPS_MAX_ZONE_LENGTH) {
    throw new Error(`Invalid IPC payload: "${field}" must be a time zone id.`);
  }
  try {
    // Constructing the formatter is the check: an id the runtime's time zone
    // database does not know throws a RangeError here.
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new Error(`Invalid IPC payload: "${field}" is not a known time zone.`);
  }
  return value;
}

function asCities(call: ModuleCall, value: unknown): string[] {
  const seen = new Set<string>();
  return asArray(value, "cities", MINIAPPS_MAX_CITIES).map((entry, index) => {
    const zone = asZoneId(entry, `cities[${index}]`);
    if (seen.has(zone)) {
      throw new Error(`Invalid IPC payload: "cities[${index}]" is listed twice.`);
    }
    seen.add(zone);
    return zone;
  });
}

function asHistory(call: ModuleCall, value: unknown): MiniappsDiceEntryView[] {
  return asArray(value, "history", MINIAPPS_MAX_HISTORY).map((entry, index) => {
    const item = call.as.asRecord(entry);
    const at = `history[${index}]`;
    return {
      atMs: call.as.asBoundedInteger(item.atMs, `${at}.atMs`, 0, Number.MAX_SAFE_INTEGER),
      label: call.as.asCappedChars(
        call.as.asNonEmptyString(item.label, `${at}.label`),
        `${at}.label`,
        120,
      ),
      result: call.as.asCappedChars(
        call.as.asNonEmptyString(item.result, `${at}.result`),
        `${at}.result`,
        200,
      ),
    };
  });
}
