/**
 * The canvas autosave: when to write a board, and WHAT — as a small state
 * machine with no editor in it.
 *
 * **Why it has no editor in it.** Until 2026-09-26 `CanvasPage` did this inline,
 * and its flush — the one that runs when the page is left — read the scene out
 * of the editor's imperative API. That flush is a `useEffect` cleanup, and React
 * runs those AFTER the subtree is torn down: Excalidraw's own
 * `componentWillUnmount` had already run `this.scene.destroy(); this.scene = new
 * Scene()`, so the API answered with an empty drawing, and the empty drawing was
 * written over the board. Opening a board and clicking another module within
 * 800 ms was enough — the load itself counts as a change — and the board was
 * gone from disk. Verified against the 1.3.0 build: „Arhitektura sistema" went
 * from 14 elements to 0.
 *
 * The rule that was wrong: a flush must write what the change callback SAW,
 * because nothing guarantees the thing that produced it is still alive when the
 * flush runs. So an observation carries its own scene, taken from `onChange`'s
 * arguments at the moment of the change, and this module cannot ask anyone for
 * anything — there is no way to write it that reads the editor late.
 *
 * **What it decides.**
 *  - The first thing reported for a board is that board as it was loaded: the
 *    BASELINE, not an edit. A board opened and closed is not rewritten.
 *  - A report for a DIFFERENT board than the last one is a board switch, and
 *    the autosave sees it itself: whatever the previous board still owes is
 *    written from its own last report, and the new board starts from a
 *    baseline. It does not wait to be told — a switch it had to be told about is
 *    a switch somebody can forget to tell it about, and the first report of the
 *    NEXT board would then be taken as an edit to be written.
 *  - A report whose version differs from what is on disk is an edit, written
 *    once the reports stop for `delayMs` — a continuous stroke is one write.
 *  - `flush` writes an owed edit now: on leaving the page, and before anything
 *    replaces the board on screen, so a switch writes at the click rather than
 *    when the next board has loaded. It also ANSWERS: it resolves once no write
 *    of any board it has handled is on the wire, so an exit that must not tear
 *    anything down under a write in flight can wait for what the canvas owes
 *    (DC-149).
 *  - A write that fails leaves the edit owed; the next report or flush sends it
 *    again rather than dropping it.
 *  - One write per board is on the wire at a time. A send asked for while one
 *    is out is made when it lands, from the newest report — so writes land in
 *    the order they left, and an undo made while its edit was still out is
 *    written after it rather than mistaken for what is already on disk. The
 *    first version of this module (2026-09-26) let a second write overtake the
 *    first and recorded whichever landed LAST as the version on disk.
 */

/** One `onChange`, as the autosave keeps it: the board it belongs to, its version, and the scene itself. */
export interface SceneObservation<S> {
  readonly boardId: string;
  /** The sum of the elements' own version counters — equal for a pan, different for an edit. */
  readonly version: number;
  readonly scene: S;
}

/** Writes one observation to disk. Resolves `true` when it is there. */
export type SceneWriter<S> = (observation: SceneObservation<S>) => Promise<boolean>;

/**
 * One board, from its first report until the next board's — and past that, for
 * as long as a write it owes is still on the wire. Its bookkeeping is its own,
 * so a write landing for one board can never be mistaken for another's.
 */
class BoardAutosave<S> {
  /** The last report. What a send writes. */
  latest: SceneObservation<S>;
  /** The version on disk: the baseline, or the last write that landed. */
  private written: number;
  /** The write on the wire. At most one, so writes land in the order they left. */
  private inFlight: SceneObservation<S> | null = null;
  /** A send was asked for while a write was out; it is made when that one lands. */
  private resend = false;
  /** Callers of `settled`, released the next time nothing is on the wire. */
  private waiting: (() => void)[] = [];

  constructor(
    baseline: SceneObservation<S>,
    private readonly write: SceneWriter<S>,
  ) {
    this.latest = baseline;
    this.written = baseline.version;
  }

  /**
   * Whether a send may still have something to do. A write on the wire counts
   * whatever the screen says: an undo back to the version on disk is an edit
   * too, once the write it undid lands.
   */
  get owes(): boolean {
    return this.inFlight !== null || this.latest.version !== this.written;
  }

  send(): void {
    if (this.inFlight !== null) {
      this.resend = true;
      return;
    }
    const observation = this.latest;
    if (observation.version === this.written) return;
    this.inFlight = observation;
    void this.write(observation)
      .catch((error: unknown) => {
        // A writer that throws has not written. Left on the wire, it would
        // hold every later edit of this board behind a write that never lands.
        console.error("Nexus: canvas autosave writer threw:", error);
        return false;
      })
      .then((saved) => {
        this.inFlight = null;
        if (saved) this.written = observation.version;
        const resend = this.resend;
        this.resend = false;
        // Only for a NEWER report: the one that just failed is not retried by
        // itself, it stays owed to the next report or flush.
        if (resend && this.latest !== observation) this.send();
        // Only once nothing is out: a resend has just put a newer write on the
        // wire, and a caller waiting for what this board owes is waiting for it.
        if (this.inFlight === null) this.waiting.splice(0).forEach((release) => release());
      });
  }

  /** Resolves once no write of this board is on the wire — at once when none is, otherwise when the write out, and any resend it triggers, has answered. */
  settled(): Promise<void> {
    if (this.inFlight === null) return Promise.resolve();
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }
}

export class CanvasAutosave<S> {
  /** The board on screen, or none before its first report. */
  private board: BoardAutosave<S> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The flush made when the previous board was left, for as long as its write is out — so a flush after a switch still waits for it. */
  private leaving: Promise<void> = Promise.resolve();

  constructor(
    private readonly write: SceneWriter<S>,
    private readonly delayMs: number,
  ) {}

  /** Every `onChange` goes through here. Cheap: it keeps references and, at most, restarts a timer. */
  observe(observation: SceneObservation<S>): void {
    if (this.board !== null && observation.boardId !== this.board.latest.boardId) {
      // A different board is on screen: settle the previous one from its own
      // last report, then start this one from nothing.
      this.leaving = this.flush();
      this.board = null;
    }
    this.clearTimer();
    if (this.board === null) {
      this.board = new BoardAutosave(observation, this.write);
      return;
    }
    const board = this.board;
    board.latest = observation;
    if (!board.owes) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      board.send();
    }, this.delayMs);
  }

  /**
   * Writes an owed edit NOW, and resolves once no write of any board handled so
   * far is on the wire: the one this asked for, a resend made after it lands, and
   * a board left by a switch whose write is still out. A write that failed
   * answers too — what it leaves owed is the next report's or flush's — so this
   * never rejects. Safe to call at any time, including after the editor is gone.
   */
  flush(): Promise<void> {
    this.clearTimer();
    const board = this.board;
    board?.send();
    return Promise.all([this.leaving, board?.settled()]).then(() => undefined);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
