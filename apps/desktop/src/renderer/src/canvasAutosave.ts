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
 *    when the next board has loaded.
 *  - A write that fails leaves the edit owed; the next report or flush sends it
 *    again rather than dropping it.
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

export class CanvasAutosave<S> {
  /** The last report, whatever it was. What a flush writes. */
  private latest: SceneObservation<S> | null = null;
  /** The version on disk for the current board: the baseline, or the last successful write. */
  private written = -1;
  /** Whether the current board has reported at all yet. */
  private hasBaseline = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Bumped on every board change. A write that lands after one must not record
   * its version against the board that is open NOW.
   */
  private generation = 0;
  /** The version a write is on the wire for, so a flush behind the timer does not send it twice. */
  private sending: number | null = null;

  constructor(
    private readonly write: SceneWriter<S>,
    private readonly delayMs: number,
  ) {}

  /** Every `onChange` goes through here. Cheap: it keeps references and, at most, restarts a timer. */
  observe(observation: SceneObservation<S>): void {
    if (this.latest !== null && observation.boardId !== this.latest.boardId) {
      // A different board is on screen: settle the previous one from its own
      // last report, then start this one from nothing.
      this.flush();
      this.latest = null;
      this.written = -1;
      this.hasBaseline = false;
      this.sending = null;
      this.generation += 1;
    }
    this.latest = observation;
    if (!this.hasBaseline) {
      this.hasBaseline = true;
      this.written = observation.version;
      return;
    }
    if (observation.version === this.written) {
      // Back to what is on disk (or never left it): nothing is owed.
      this.clearTimer();
      return;
    }
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.send();
    }, this.delayMs);
  }

  /** Writes an owed edit NOW. Safe to call at any time, including after the editor is gone. */
  flush(): void {
    this.clearTimer();
    this.send();
  }

  private send(): void {
    const observation = this.latest;
    if (observation === null || !this.hasBaseline || observation.version === this.written) return;
    if (observation.version === this.sending) return;
    const generation = this.generation;
    this.sending = observation.version;
    void this.write(observation).then((saved) => {
      if (this.sending === observation.version) this.sending = null;
      if (saved && generation === this.generation) this.written = observation.version;
    });
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
