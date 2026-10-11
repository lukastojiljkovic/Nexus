import type {
  AssistantPollView,
  AssistantTurnEventEntry,
  AssistantTurnEventView,
} from "../shared/ipc.js";

/**
 * THE TURN BUFFER: how a streamed turn becomes something a page can poll
 * (ADR-106, contract's `send`/`poll`/`stop`).
 *
 * **What a turn is, mechanically.** The loop pushes events as it produces them;
 * each one is numbered, and a page reads "everything after the cursor I last
 * saw" and gets back the number it should ask from next. That is the whole
 * protocol, and it is deliberately this small: the kit's ops are
 * request/response, so the alternative to a cursor would be either a push
 * channel every module's bridge would have to grow or a page that re-reads the
 * whole turn on every tick.
 *
 * **One turn at a time, per profile.** A second `open` for a profile that
 * already has one is refused BY NAME - the error carries the running turn's id -
 * because "a turn is already running" without saying which one leaves a page
 * with nothing to stop. The refusal is a property of this file rather than of a
 * handler, so a second caller cannot talk its way past it.
 *
 * **A finished turn is not dropped until it has been read.** A page that stops
 * polling a millisecond before the answer arrives must still be able to read it,
 * so the buffer outlives the turn and the registry is what removes it - by name,
 * once, when the page has read to the end. Nothing here holds a timer, so a page
 * that never comes back leaves one buffer behind for the life of the session;
 * that is bounded by `MAX_TURN_EVENTS` and freed the moment that profile's
 * session ends, and the alternative (a timer that deletes a turn a slow page was
 * still reading) is the failure a page cannot explain.
 *
 * **Nothing here knows what an event means.** It stores `AgentEvent`s and the
 * module's own `confirm`, counts them, and answers them in order; that is what
 * makes the cursor semantics testable without a model, a database or Electron.
 */

/**
 * The most events one turn may buffer.
 *
 * A token is an event, so this is not a bound a real answer reaches: eight
 * thousand events is a long answer streamed twice over. It is here because a
 * buffer with no ceiling is a page that can be made to run main out of memory by
 * a model that will not stop talking, and a turn that hits it stops emitting and
 * says so (`turn-overflow` below) rather than growing.
 */
export const MAX_TURN_EVENTS = 8000;

/** One turn's events, in order, with the cursor arithmetic a poll uses. */
export class TurnLog {
  private readonly entries: AssistantTurnEventEntry[] = [];
  private nextSeq = 1;
  private finished = false;
  private overflowed = false;

  constructor(
    readonly id: string,
    readonly profileId: string,
    readonly conversationId: string,
  ) {}

  /**
   * Adds one event and answers the entry it became, or `null` when the cap was
   * already reached - the caller decides what to tell the model, and this file
   * refuses to invent a reason.
   */
  emit(event: AssistantTurnEventView): AssistantTurnEventEntry | null {
    if (this.entries.length >= MAX_TURN_EVENTS) {
      this.overflowed = true;
      return null;
    }
    const entry: AssistantTurnEventEntry = { seq: this.nextSeq, event };
    this.nextSeq += 1;
    this.entries.push(entry);
    return entry;
  }

  /** Marks the turn over. Idempotent: a stopped turn and a finished one end the same way. */
  finish(): void {
    this.finished = true;
  }

  isFinished(): boolean {
    return this.finished;
  }

  didOverflow(): boolean {
    return this.overflowed;
  }

  /** The sequence number of the last event, or 0 while there is none. */
  lastSeq(): number {
    return this.entries.length === 0 ? 0 : (this.entries[this.entries.length - 1]?.seq ?? 0);
  }

  size(): number {
    return this.entries.length;
  }

  /** Every event after `cursor`, in order. A cursor past the end answers nothing. */
  since(cursor: number): readonly AssistantTurnEventEntry[] {
    return this.entries.filter((entry) => entry.seq > cursor);
  }

  /**
   * One read of the buffer: the events after `cursor`, the cursor to ask from
   * next, and whether the turn is over.
   *
   * The cursor is clamped rather than refused: a page that asks from a number
   * beyond the end (a reloaded page, a stale value) gets nothing new and its own
   * number back, which is the answer that lets it keep polling instead of
   * erroring out of a turn that is still running.
   */
  poll(cursor: number): AssistantPollView {
    const from = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
    const events = this.since(from);
    const last = events.length === 0 ? from : (events[events.length - 1]?.seq ?? from);
    return { events, nextCursor: last, done: this.finished, thread: null };
  }
}

/** Why a turn could not be opened: another one owns this profile. */
export class TurnBusyError extends Error {
  constructor(readonly turnId: string) {
    super(`An assistant turn is already running for this profile ("${turnId}").`);
    this.name = "TurnBusyError";
  }
}

/** Why a turn could not be read or stopped: this process is not holding one under that id. */
export class TurnUnknownError extends Error {
  constructor(turnId: string) {
    super(`No assistant turn "${turnId}" is running or waiting to be read.`);
    this.name = "TurnUnknownError";
  }
}

/**
 * THE CONFIRMATIONS OF ONE TURN: the questions a `write` or `network` tool is
 * parked on, and how each is answered.
 *
 * The rule this class makes unrepresentable is an answer with no question: an id
 * nobody is waiting on is `false`, and a question answered twice is `false` the
 * second time - so a page that answered the same dialog in two ways (which a
 * double click can produce) cannot resolve a tool twice, and a tool cannot run
 * on a promise that was never parked. `refuseAll` is what a stop and a session
 * end call, and it is the reason a page that walked away leaves no tool waiting:
 * every parked question is answered "no", which is an ordinary result.
 */
export class ConfirmPark {
  private readonly waiting = new Map<string, (allow: boolean) => void>();

  /** Parks on `requestId` and answers the promise the tool is waiting on. */
  park(requestId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.waiting.set(requestId, resolve);
    });
  }

  /** Answers one question. `false` when nothing was waiting on that id, or when it was already answered. */
  answer(requestId: string, allow: boolean): boolean {
    const resolve = this.waiting.get(requestId);
    if (resolve === undefined) return false;
    this.waiting.delete(requestId);
    resolve(allow);
    return true;
  }

  /** Answers every parked question with "no", which is what a stop and a session end do. */
  refuseAll(): void {
    for (const [requestId, resolve] of [...this.waiting]) {
      this.waiting.delete(requestId);
      resolve(false);
    }
  }

  size(): number {
    return this.waiting.size;
  }
}

/**
 * The turns one profile has at most one of, plus every turn whose events a page
 * has not finished reading.
 *
 * The registry is per profile because the rule is per profile: two profiles in
 * one window may each run a turn (the app keeps several open at once), a second
 * turn in ONE profile is what the refusal is for.
 */
export class TurnRegistry {
  private readonly logs = new Map<string, TurnLog>();
  private readonly running = new Map<string, string>();

  constructor(private readonly newId: () => string) {}

  /** Opens a turn for a profile, or refuses by name when one is already running. */
  open(profileId: string, conversationId: string): TurnLog {
    const active = this.running.get(profileId);
    if (active !== undefined) throw new TurnBusyError(active);
    const id = this.newId();
    const log = new TurnLog(id, profileId, conversationId);
    this.logs.set(id, log);
    this.running.set(profileId, id);
    return log;
  }

  /** The turn's log, whether it is running or waiting to be read. */
  get(turnId: string): TurnLog | null {
    return this.logs.get(turnId) ?? null;
  }

  /** The id of the profile's running turn, or `null`. */
  runningTurn(profileId: string): string | null {
    return this.running.get(profileId) ?? null;
  }

  /** Marks a turn over and frees the profile for a new one. Its events stay readable. */
  finish(profileId: string, turnId: string): void {
    const log = this.logs.get(turnId);
    if (log === undefined) return;
    log.finish();
    if (this.running.get(profileId) === turnId) this.running.delete(profileId);
  }

  /** Forgets a turn's events, once a page has read them to the end. */
  close(turnId: string): void {
    this.logs.delete(turnId);
  }

  /** Forgets every turn of a profile: what a session end does. */
  closeProfile(profileId: string): void {
    this.running.delete(profileId);
    for (const [turnId, log] of [...this.logs]) {
      if (log.profileId === profileId) this.logs.delete(turnId);
    }
  }

  /** Every id this registry still holds, for the tests and for a session end. */
  ids(): readonly string[] {
    return [...this.logs.keys()];
  }
}
