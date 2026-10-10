/**
 * The main-process half of the module kit: one context per discovered module,
 * and the four rules that make it worth having.
 *
 * **What a module gets.** `register(ctx)` hands a module a context whose
 * `handle(op, handler)` registers one handler per DECLARED op, wraps it in
 * `assertTrustedSender` (SEC-EL-02), and gives the handler the shared payload
 * validators (`./ipcValidators.js`) and the profile's database the way every
 * store in this app gets it (`new XStore(db.raw, profileId)`).
 *
 * **The three refusals, all of them at registration or before the handler
 * runs**, because a refusal that arrives after a write has happened is not a
 * refusal:
 *
 *  1. an op the module did not declare in its own contract - thrown by
 *     `handle`, at registration, so a typo is a startup failure rather than a
 *     channel nobody answers;
 *  2. a channel outside the module's own `<id>:` prefix - thrown when the
 *     contract is adopted, so a hand-built contract cannot answer for another
 *     module;
 *  3. a message from an untrusted sender - thrown inside the wrapper, before
 *     the handler is called at all.
 *
 * **Why this file has no `electron` import.** Everything above is a rule about
 * payloads and channels, and rules are testable; `new Notification` and
 * `ipcMain.handle` are not, under Vitest. So the electron-shaped parts arrive as
 * `ModulePlatform` - the sender check, the database handle, the toast, the timer
 * and the clock - and `moduleHost.ts` is the thin wiring that supplies them.
 * That split is what lets `moduleIpc.test.ts` prove the three refusals.
 *
 * **What a timer is for.** A countdown outlives the page that started it, so a
 * module arms a timer in MAIN and main owns its lifetime: `armUntil` re-arms in
 * bounded hops (`SLEEP_SAFE_HOP_MS`) so a suspended machine cannot leave a
 * timer that never fires, and every armed timer is cancelled when the session
 * ends. A module that forgot to cancel one would keep a locked profile's timer
 * alive; that is the kit's problem to solve once, not each module's.
 */
import type Database from "better-sqlite3-multiple-ciphers";
import type { ExportModuleData, ModuleText } from "@nexus/core";
import type { ModuleContract, ModuleOps } from "../shared/moduleApi.js";
import { mainLocale } from "./locale.js";
import {
  asBoolean,
  asBoundedInteger,
  asBoundedNumber,
  asCappedChars,
  asId,
  asInteger,
  asNonEmptyString,
  asNullableString,
  asPositiveInteger,
  asRecord,
  asString,
} from "./ipcValidators.js";

type DatabaseHandle = Database.Database;

/**
 * The shared validators, by the names their handlers have always used, under
 * one object so a handler call site reads `call.as.id(...)` and nothing in this
 * kit can shadow one of them.
 */
export const MODULE_VALIDATORS = {
  asRecord,
  asId,
  asNonEmptyString,
  asString,
  asNullableString,
  asBoolean,
  asCappedChars,
  asInteger,
  asPositiveInteger,
  asBoundedInteger,
  asBoundedNumber,
} as const;

export type ModuleValidators = typeof MODULE_VALIDATORS;

/** Everything one module's handler is given beyond its own payload. */
export interface ModuleCall {
  /** The shared payload validators (SEC-EL-02). */
  readonly as: ModuleValidators;
  /**
   * Opens the profile's database for a store, exactly as `main/index.ts` does
   * it: `call.profileDb(profileId, (db, id) => new TimersStore(db, id))`. The
   * handle is the same one every compiled-in store is built on, so a module
   * store is a store like any other and never a second connection.
   */
  profileDb<T>(profileId: string, open: (db: DatabaseHandle, profileId: string) => T): T;
  /** Current wall-clock milliseconds. Injected so a test can move the clock. */
  now(): number;
}

/** An unlocked session, as the session hooks and the archive see it. */
export interface ModuleSession {
  /** Every profile this session has open, in the app's own order. */
  readonly profileIds: readonly string[];
  profileDb<T>(profileId: string, open: (db: DatabaseHandle, profileId: string) => T): T;
  now(): number;
}

/**
 * One module's archive import, in the two halves the kit runs at two different
 * moments and with two different promises.
 *
 * **`parse` is pure and total.** It validates the WHOLE payload - every field,
 * every row, every bound, and the version the payload was written with - and
 * throws on anything it will not take, naming what is wrong. The kit runs it at
 * the PREVIEW (so the refusal reaches the user before they confirm a restore
 * that replaces their profile) and again at apply time, before any module
 * writes. It must write nothing at all: the preview has nothing to protect
 * itself with if it does.
 *
 * **`apply` writes, and is handed exactly what this module's own `parse`
 * answered** - or `undefined` when the archive says nothing about this module.
 * A restore replaces a profile whole, so `undefined` is not "leave it alone":
 * it is this profile's archived state going back to empty, which every module
 * that archives anything has to express in its own tables.
 *
 * The pair is registered together so the two cannot disagree about the type:
 * `T` is inferred once, and `apply` receives what `parse` returned or nothing.
 */
export interface ModuleImport<T> {
  parse(value: unknown): T;
  apply(parsed: T | undefined, session: ModuleSession): void;
}

/**
 * Why a kit section was refused: a module id this build did not adopt (or one
 * it cannot restore), or a payload the module's own `parse` will not take.
 *
 * A code rather than only a sentence, because the two become different problems
 * on the wire (`RestoreProblemCode`): `unknown-module` sends the reader to a
 * newer build, and `invalid-module-data` says the archive's own payload is what
 * is wrong. `main/restore.ts` maps one onto the other, which is why the class
 * lives here rather than being duplicated at the seam.
 */
export type ModuleImportProblemCode = "unknown-module" | "invalid-module-data";

export class ModuleImportError extends Error {
  readonly code: ModuleImportProblemCode;

  constructor(code: ModuleImportProblemCode, message: string) {
    super(message);
    this.name = "ModuleImportError";
    this.code = code;
  }
}

/** What one module's `register(ctx)` is handed. */
export interface ModuleContext<Id extends string, Ops extends ModuleOps> {
  readonly id: Id;
  /**
   * Registers the handler for one declared op. Throws at registration for an op
   * this contract does not declare - see the header's three refusals.
   */
  handle<K extends keyof Ops & string>(
    op: K,
    handler: (
      payload: Ops[K]["request"],
      call: ModuleCall,
    ) => Ops[K]["response"] | Promise<Ops[K]["response"]>,
  ): void;
  /**
   * An OS notification through the app's one notification path, in the language
   * main is writing in (`main/locale.ts`). `silent` is the one thing a module
   * may decide: whether this toast carries the OS's own notification sound.
   */
  notify(copy: { readonly title: ModuleText; readonly body: ModuleText }, silent?: boolean): void;
  /**
   * Runs `run` once the clock passes `atMs`, re-arming in bounded hops so a
   * machine that slept through the moment still fires on wake. Returns a
   * cancel function; every armed timer is also cancelled at `sessionEnd`.
   */
  armUntil(atMs: number, run: () => void): () => void;
  /** Runs at every unlock, after the database is open. */
  onSessionStart(run: (session: ModuleSession) => void): void;
  /** Runs when the session ends - a lock, a switch, a quit - after every armed timer is cancelled. */
  onSessionEnd(run: () => void): void;
  /**
   * Registers this module's archive payload: a versioned JSON value, or
   * `undefined` for a session with nothing to export (`ProfileData.modules`).
   */
  exportData(run: (session: ModuleSession) => unknown): void;
  /**
   * Registers this module's archive import (see `ModuleImport`): `parse` runs
   * when the section is read, `apply` inside the one transaction every module's
   * write shares.
   */
  importData<T>(spec: ModuleImport<T>): void;
}

/**
 * What main supplies that this file must not import: the two Electron-shaped
 * facts (a toast and the sender check) and the database's own handle.
 */
export interface ModulePlatform {
  /** Main's `assertTrustedSender` - the renderer is untrusted (SEC-EL-02). */
  assertTrustedSender(event: unknown): void;
  /** The open database's raw handle (`requireDb().raw`). */
  database(): DatabaseHandle;
  /** The app's notification path: one OS toast, in the active locale. */
  notify(copy: { readonly title: string; readonly body: string; readonly silent: boolean }): void;
  /** A timer main owns. `atMs` is wall-clock milliseconds (`Date.now()`). */
  schedule(atMs: number, run: () => void): () => void;
  now(): number;
}

/**
 * The non-generic face of the host, which is all the discovery glue sees: a
 * module's `main/register.ts` calls `host.adopt(its own contract)`, and the
 * per-op payload and result types then come from that contract rather than from
 * this file.
 */
export interface ModuleHostSurface {
  adopt<Id extends string, Ops extends ModuleOps>(
    contract: ModuleContract<Id, Ops>,
  ): ModuleContext<Id, Ops>;
}

/** One module's `main/register.ts`, exactly as the glue calls it. */
export interface ModuleRegisterModule {
  register(host: ModuleHostSurface): void;
}

/** How long one armed hop may be before `armUntil` re-checks the clock. */
const SLEEP_SAFE_HOP_MS = 30_000;

type Dispatch = (event: unknown, payload: unknown) => Promise<unknown>;

interface Armed {
  /** Replaced on every hop; the cancel function always tears down the latest one. */
  cancel: () => void;
}

/**
 * Holds every discovered module's handlers and session hooks for one main
 * process. Constructed once, in `moduleHost.ts`.
 */
export class ModuleHost implements ModuleHostSurface {
  private readonly dispatchers = new Map<string, Dispatch>();
  private readonly sessionStarts: ((session: ModuleSession) => void)[] = [];
  private readonly sessionEnds: (() => void)[] = [];
  private readonly exporters = new Map<string, (session: ModuleSession) => unknown>();
  private readonly importers = new Map<string, ModuleImport<unknown>>();
  private readonly armed: Armed[] = [];
  /** Every module this build adopted - which is what "a module id this build knows" means. */
  private readonly adoptedIds = new Set<string>();

  constructor(private readonly platform: ModulePlatform) {}

  /** Every channel this build answers on, in registration order. */
  channels(): readonly string[] {
    return [...this.dispatchers.keys()];
  }

  /**
   * Adopts one module: its contract's channels become dispatchable, and its
   * `register` runs. Throws if the module claims a channel that is not under its
   * own id, or one another module already answers.
   */
  adopt<Id extends string, Ops extends ModuleOps>(
    contract: ModuleContract<Id, Ops>,
  ): ModuleContext<Id, Ops> {
    const prefix = `${contract.id}:`;
    for (const op of contract.ops) {
      const channel = contract.channels[op];
      if (!channel.startsWith(prefix)) {
        throw new Error(
          `Module "${contract.id}" declares channel "${channel}", which is not under its own "${prefix}" prefix.`,
        );
      }
      if (this.dispatchers.has(channel)) {
        throw new Error(`Channel "${channel}" is already handled by another module.`);
      }
    }
    this.adoptedIds.add(contract.id);

    const context: ModuleContext<Id, Ops> = {
      id: contract.id,
      handle: (op, handler) => {
        if (!contract.ops.includes(op)) {
          throw new Error(
            `Module "${contract.id}" has no declared op "${String(op)}"; a handler may only answer an op its own contract declares.`,
          );
        }
        const channel = contract.channels[op];
        this.dispatchers.set(channel, async (event, payload) => {
          this.platform.assertTrustedSender(event);
          return await handler(payload as Ops[typeof op]["request"], this.call());
        });
      },
      notify: (copy, silent) => {
        this.platform.notify({
          title: copy.title[mainLocale()],
          body: copy.body[mainLocale()],
          silent: silent ?? false,
        });
      },
      armUntil: (atMs, run) => this.armUntil(atMs, run),
      onSessionStart: (run) => {
        this.sessionStarts.push(run);
      },
      onSessionEnd: (run) => {
        this.sessionEnds.push(run);
      },
      exportData: (run) => {
        this.exporters.set(contract.id, run);
      },
      importData: <T>(spec: ModuleImport<T>) => {
        this.importers.set(contract.id, {
          parse: spec.parse,
          // The map holds every module's pair under one key, so the payload type
          // is erased here. What keeps `apply` receiving exactly what this
          // module's own `parse` answered is the single `T` that produced both
          // halves - erasing it is the only cast that fact needs.
          apply: spec.apply as (parsed: unknown, session: ModuleSession) => void,
        });
      },
    };
    return context;
  }

  /**
   * Answers one IPC call. The channel must be one a module registered: an
   * undeclared channel is a bug in the calling code, never something to answer
   * with `undefined`.
   */
  async dispatch(channel: string, event: unknown, payload: unknown): Promise<unknown> {
    const dispatch = this.dispatchers.get(channel);
    if (dispatch === undefined) {
      throw new Error(`No module answers channel "${channel}".`);
    }
    return await dispatch(event, payload);
  }

  /** Arms a timer for one module and records it, so `sessionEnd` can cancel it. */
  private armUntil(atMs: number, run: () => void): () => void {
    const armed: Armed = { cancel: () => undefined };
    const step = (): void => {
      const remaining = atMs - this.platform.now();
      if (remaining <= 0) {
        armed.cancel = () => undefined;
        const index = this.armed.indexOf(armed);
        if (index >= 0) this.armed.splice(index, 1);
        run();
        return;
      }
      armed.cancel = this.platform.schedule(
        this.platform.now() + Math.min(remaining, SLEEP_SAFE_HOP_MS),
        step,
      );
    };
    this.armed.push(armed);
    step();
    return () => {
      armed.cancel();
      const index = this.armed.indexOf(armed);
      if (index >= 0) this.armed.splice(index, 1);
    };
  }

  /** Hands every module the just-unlocked session. */
  sessionStart(profileIds: readonly string[]): void {
    const session: ModuleSession = {
      profileIds,
      profileDb: (profileId, open) => open(this.platform.database(), profileId),
      now: () => this.platform.now(),
    };
    for (const run of this.sessionStarts) run(session);
  }

  /** Cancels every armed timer, then tells each module the session is over. */
  sessionEnd(): void {
    for (const armed of [...this.armed]) armed.cancel();
    this.armed.length = 0;
    for (const run of this.sessionEnds) run();
  }

  /**
   * The archive's `modules` section for these profiles: module id to the value
   * that module exports. A module with nothing to say is omitted rather than
   * written as `undefined`, so an existing archive's shape does not change the
   * day a module is added.
   */
  collectExports(profileIds: readonly string[]): ExportModuleData[] {
    const session: ModuleSession = {
      profileIds,
      profileDb: (profileId, open) => open(this.platform.database(), profileId),
      now: () => this.platform.now(),
    };
    const section: ExportModuleData[] = [];
    for (const [moduleId, exportData] of this.exporters) {
      const value = exportData(session);
      if (value !== undefined) section.push({ moduleId, payload: value });
    }
    return section;
  }

  /**
   * Refuses an archive section this build cannot import whole, naming what is
   * wrong. Three refusals, in the order a reader would want them:
   *
   *  1. a module id this build did not adopt - the data would be lost, and the
   *     message says so;
   *  2. a module this build adopted but has no importer for - it cannot restore
   *     what the archive carries;
   *  3. a payload that module's own `parse` throws on, wrapped with the module's
   *     name and refused here rather than half-read later.
   *
   * **Its own method, called TWICE, and the second call is the point.** The
   * preview calls it so the user is told before they confirm a restore that
   * replaces their profile, and `applyImports` runs the same parse again before
   * any module writes - a plan confirmed against one build cannot be applied by
   * another that moved on. Nothing is written by either call: every refusal
   * leaves the profile exactly as it was found.
   */
  assertImportable(section: readonly ExportModuleData[]): void {
    this.parseImports(section);
  }

  /**
   * Reads every payload in the section, and answers them by module id. The one
   * place a payload is read, so `assertImportable` and `applyImports` cannot
   * disagree about what "this build can import it" means.
   */
  private parseImports(section: readonly ExportModuleData[]): Map<string, unknown> {
    const parsed = new Map<string, unknown>();
    for (const { moduleId } of section) {
      if (!this.adoptedIds.has(moduleId)) {
        throw new ModuleImportError(
          "unknown-module",
          `This archive carries data for module "${moduleId}", which this build does not know. Update Nexus or import the archive with the build that wrote it.`,
        );
      }
    }
    for (const { moduleId, payload } of section) {
      const importer = this.importers.get(moduleId);
      if (importer === undefined) {
        throw new ModuleImportError(
          "unknown-module",
          `This archive carries data for module "${moduleId}", which this build cannot restore.`,
        );
      }
      try {
        parsed.set(moduleId, importer.parse(payload));
      } catch (error) {
        // The module's own sentence rides inside this one: "which module refused,
        // and why" is what the reader can act on, and a swallowed reason would
        // leave the wire with a problem code and nothing to explain it.
        throw new ModuleImportError(
          "invalid-module-data",
          `This archive carries data for module "${moduleId}" that this build cannot read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return parsed;
  }

  /**
   * Applies the archive's `modules` section, all of it or none of it.
   *
   * **Parsed first, written second.** Every payload is read before a single
   * module writes, so a refusal costs nothing: a module that will not take its
   * payload is refused while the profile is still untouched, rather than after
   * the modules ahead of it have already written.
   *
   * **Then EVERY adopted module's `apply` runs, in one transaction**, inside
   * `platform.database().transaction(...)()` - where each store's own transaction
   * nests as a savepoint. A module the section names gets its parsed payload; a
   * module it does not name gets `undefined`, which is the module's instruction
   * to reset its archived state to empty (a restore replaces a profile whole).
   * Because the whole set is one transaction, a module that throws in its own
   * `apply` rolls back every module's writes with it, and the profile is left
   * exactly as the archive's reader found it.
   */
  applyImports(section: readonly ExportModuleData[], profileIds: readonly string[]): void {
    const parsed = this.parseImports(section);
    if (this.importers.size === 0) return;
    const session: ModuleSession = {
      profileIds,
      profileDb: (profileId, open) => open(this.platform.database(), profileId),
      now: () => this.platform.now(),
    };
    this.platform.database().transaction(() => {
      for (const [moduleId, importer] of this.importers) {
        importer.apply(parsed.get(moduleId), session);
      }
    })();
  }

  /** The call object one handler is given; built per call so a stale `now` is impossible. */
  private call(): ModuleCall {
    return {
      as: MODULE_VALIDATORS,
      profileDb: (profileId, open) => open(this.platform.database(), profileId),
      now: () => this.platform.now(),
    };
  }
}
