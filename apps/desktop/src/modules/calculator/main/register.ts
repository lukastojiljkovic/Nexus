import {
  CalculatorStore,
  MAX_CALC_HISTORY_RESULT_LENGTH,
  type CalculatorExport,
} from "@nexus/db";
import {
  CALCULATOR_ANGLE_MODES,
  CALCULATOR_PRECISIONS,
  MAX_CALCULATOR_VALUE_LENGTH,
  MAX_EXPRESSION_LENGTH,
  emptyCalculatorSession,
  parseCalculatorSession,
  type CalculatorAngleMode,
  type CalculatorPrecision,
  type CalculatorSession,
} from "@nexus/core";
import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  contract,
  type CalcHistoryEntryView,
  type CalculatorView,
} from "../shared/ipc.js";
import { buildCalculatorExport, emptyCalculatorExport, parseCalculatorExport } from "./imex.js";

/**
 * CALCULATOR in the main process (ADR-090): its handlers and its archive
 * section.
 *
 * **Main never evaluates anything.** The engine is a Web Worker in the renderer
 * (`renderer/engine.worker.ts`), and the reason is the one `engine.ts`'s own
 * header gives: an expression a user types is a program, and the guard in
 * `limits.ts` models the shapes it can see rather than every shape there is. A
 * process that ran one on the main thread would have no way to stop it, and the
 * whole application would stop with it. So this file is STORAGE: it validates
 * the wire (SEC-EL-02), reads and writes the store, and hands the session the
 * renderer just produced back to be written.
 *
 * **The session is re-validated here, and again in the store.** It arrives from
 * the renderer, which is untrusted (SEC-EL), so `parseCalculatorSession` runs on
 * the wire's value before it reaches the store - and the store runs the same
 * reader on its way in. Two boundaries, one reader: a session the engine could
 * not have produced is refused before a row is written rather than after.
 *
 * **A read that cannot parse the stored session answers an empty one and says
 * so** (`sessionReadable`): the store reports that corruption rather than
 * discarding it, and a page that could not load at all would take the history
 * down with it. The page draws the flag with the way out, which is
 * `clearSession`.
 */

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  /** The rows as the wire declares them: one mapping, so the store's shape and the wire's cannot drift field by field. */
  function viewOf(store: CalculatorStore): CalculatorView {
    const history: CalcHistoryEntryView[] = store.listHistory().map((entry) => ({
      id: entry.id,
      expression: entry.expression,
      value: entry.value,
      result: entry.result,
      pinned: entry.pinned,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
    let session = emptyCalculatorSession();
    let sessionReadable = true;
    try {
      session = store.getSession();
    } catch (error) {
      // A column that no longer parses. The page can still show the history and
      // still be told what to do about it; a thrown read would show neither.
      sessionReadable = false;
      console.error(
        `Nexus: the calculator session stored for this profile could not be read - ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const settings = store.settings();
    return {
      history,
      session,
      sessionReadable,
      settings: { angleMode: settings.angleMode, precision: settings.precision },
    };
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return call.profileDb(profileId, (db, id) => viewOf(new CalculatorStore(db, id)));
  });

  ctx.handle("commit", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const expression = expressionText(call, payload.expression);
    const result = resultText(call, payload.result);
    const value = valueText(call, payload.value);
    const session = sessionOf(payload.session);
    const now = instant(call.now());
    // ONE transaction for the pair: the row the user pressed Enter for and the
    // session it was evaluated against are the same act, and a half of it is a
    // state nobody could explain. The store's own statement transaction nests
    // inside this one as a savepoint.
    return call.profileDb(profileId, (db, id) => {
      const store = new CalculatorStore(db, id);
      db.transaction(() => {
        store.addEntry({ expression, result, value }, now);
        store.saveSession(session, now);
      })();
      return viewOf(store);
    });
  });

  ctx.handle("setPinned", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const id = call.as.asId(payload.id, "id");
    const pinned = call.as.asBoolean(payload.pinned, "pinned");
    return call.profileDb(profileId, (db, profile) => {
      const store = new CalculatorStore(db, profile);
      store.setPinned(id, pinned, instant(call.now()));
      return viewOf(store);
    });
  });

  ctx.handle("removeEntry", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const id = call.as.asId(payload.id, "id");
    return call.profileDb(profileId, (db, profile) => {
      const store = new CalculatorStore(db, profile);
      store.removeEntry(id);
      return viewOf(store);
    });
  });

  ctx.handle("clearHistory", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const keepPinned = call.as.asBoolean(payload.keepPinned, "keepPinned");
    return call.profileDb(profileId, (db, profile) => {
      const store = new CalculatorStore(db, profile);
      store.clearHistory({ keepPinned });
      return viewOf(store);
    });
  });

  ctx.handle("clearSession", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return call.profileDb(profileId, (db, profile) => {
      const store = new CalculatorStore(db, profile);
      store.clearSession();
      return viewOf(store);
    });
  });

  ctx.handle("setAngleMode", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const angleMode = angleModeOf(call, payload.angleMode);
    return call.profileDb(profileId, (db, profile) => {
      const store = new CalculatorStore(db, profile);
      // One field changes, so the other is read from the store rather than sent
      // from the page: a payload carrying both would let a stale view overwrite a
      // preference the user had already changed somewhere else.
      store.saveSettings(
        { angleMode, precision: store.settings().precision },
        instant(call.now()),
      );
      return viewOf(store);
    });
  });

  ctx.handle("setPrecision", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const precision = precisionOf(call, payload.precision);
    return call.profileDb(profileId, (db, profile) => {
      const store = new CalculatorStore(db, profile);
      store.saveSettings(
        { angleMode: store.settings().angleMode, precision },
        instant(call.now()),
      );
      return viewOf(store);
    });
  });

  // --- The archive (ADR-090 §imex) -----------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return session.profileDb(profileId, (db, id) =>
      buildCalculatorExport(new CalculatorStore(db, id).exportData()),
    );
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload - the version first - and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseCalculatorExport,
    // The writing half. `undefined` is an archive that says nothing about the
    // calculator, which for a restore that replaces a profile whole means empty:
    // no history and an empty session, rather than whatever the profile happened
    // to hold.
    apply: (payload: CalculatorExport | undefined, session) => {
      const value = payload ?? emptyCalculatorExport();
      for (const profileId of session.profileIds) {
        session.profileDb(profileId, (db, id) => {
          new CalculatorStore(db, id).importData(value, instant(session.now()));
        });
      }
    },
  });
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written ONE profile at a time (`main/imex.ts` gathers one
 * profile's `ProfileData`), so "several" is not a shape the exporter meets.
 * Answering `null` rather than guessing keeps that true: if a session ever named
 * several, this module has no single profile its history belongs to, and the
 * honest payload is none at all rather than the first profile's calculations
 * written under somebody else's name.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** An expression off the wire, bounded exactly as the store and the engine bound it. */
function expressionText(call: ModuleCall, value: unknown): string {
  return call.as.asCappedChars(
    call.as.asNonEmptyString(value, "expression"),
    "expression",
    MAX_EXPRESSION_LENGTH,
  );
}

/** The display string off the wire, bounded as the store's result column is. */
function resultText(call: ModuleCall, value: unknown): string {
  return call.as.asCappedChars(
    call.as.asNonEmptyString(value, "result"),
    "result",
    MAX_CALC_HISTORY_RESULT_LENGTH,
  );
}

/** The lexical value off the wire, bounded as the engine's own value cap is. */
function valueText(call: ModuleCall, value: unknown): string {
  return call.as.asCappedChars(
    call.as.asNonEmptyString(value, "value"),
    "value",
    MAX_CALCULATOR_VALUE_LENGTH,
  );
}

/**
 * A session off the wire, read by core's own validator.
 *
 * The renderer computed it, so it is untrusted input like every other field on
 * this wire; `parseCalculatorSession` is the reader the store runs, and running
 * the SAME one here is what keeps a session that would be refused at the store
 * from being written into a payload first.
 */
function sessionOf(value: unknown): CalculatorSession {
  const session = parseCalculatorSession(value);
  if (session === null) {
    throw new Error(
      'Invalid IPC payload: "session" must be a version-1 object of text values and named functions.',
    );
  }
  return session;
}

/** An angle mode off the wire: a non-empty string first (the shared validator), then core's own set. */
function angleModeOf(call: ModuleCall, value: unknown): CalculatorAngleMode {
  const text = call.as.asNonEmptyString(value, "angleMode");
  if (!isAngleMode(text)) {
    throw new Error(
      `Invalid IPC payload: "angleMode" must be one of ${CALCULATOR_ANGLE_MODES.join(", ")}.`,
    );
  }
  return text;
}

/** A number mode off the wire, on the same two steps. */
function precisionOf(call: ModuleCall, value: unknown): CalculatorPrecision {
  const text = call.as.asNonEmptyString(value, "precision");
  if (!isPrecision(text)) {
    throw new Error(
      `Invalid IPC payload: "precision" must be one of ${CALCULATOR_PRECISIONS.join(", ")}.`,
    );
  }
  return text;
}

function isAngleMode(value: string): value is CalculatorAngleMode {
  return (CALCULATOR_ANGLE_MODES as readonly string[]).includes(value);
}

function isPrecision(value: string): value is CalculatorPrecision {
  return (CALCULATOR_PRECISIONS as readonly string[]).includes(value);
}
