/**
 * An editor's writes: one at a time, in the order asked for, and none of them
 * lost to the one before it failing.
 *
 * **Why not an in-flight flag.** Both note editors used to guard their flush
 * with one and RETURN when a write was out, leaving what was owed to whatever
 * ran next. On the way out of a note, nothing that runs next can still see the
 * document: the unmount cleanup asks for the flush and destroys the document
 * on the following line. So the owed edit was written later under the title an
 * absent document gives — the empty string — by `NoteEditor`, and not at all
 * by `PrivNoteEditor` (DC-148). And every caller that awaited a flush to mean
 * „what I owe is on disk" — a version restore's checkpoint, the private
 * section's close capture — was told so while it was not.
 *
 * Queued instead, a flush takes what it owes at the moment it is asked, while
 * the document is alive, and its write waits its turn rather than being
 * skipped. What resolves is then true: `send` once its write has answered, and
 * `settled` once every write asked for so far has.
 *
 * **A failure is carried, and said once.** What a write failed to land goes
 * out again with the next write, ahead of that write's own — `carry` says how
 * the two combine: a note's updates are appended, a whole-state write keeps
 * only the newer state. So a write that lands after a failure has landed both,
 * and a „Sačuvano" it sets is true. The failure is reported only when no later
 * write has been asked for to carry it; otherwise the later write speaks for
 * both, whichever way it goes. `owesFailure` is what lets a flush with nothing
 * new still send what an earlier write could not.
 */
export class OwedWrites<T> {
  private tail: Promise<void> = Promise.resolve();
  private failed: T | null = null;
  private asked = 0;

  constructor(
    private readonly options: {
      /** What goes out when a write follows one that failed. */
      readonly carry: (failed: T, next: T) => T;
      /** A write failed and nothing later was asked for to carry it. */
      readonly onFailed: (owed: T, error: unknown) => void;
    },
  ) {}

  /** A write failed and what it owed has not gone out since. */
  get owesFailure(): boolean {
    return this.failed !== null;
  }

  /**
   * Sends `owed` once every write asked for before it has answered. `write` is
   * handed what is actually owed when it runs — `owed`, carried onto whatever
   * the write before it failed to land — and throws if that did not land.
   */
  send(owed: T, write: (owed: T) => Promise<void>): Promise<void> {
    const asked = ++this.asked;
    this.tail = this.tail
      .then(async () => {
        const carried = this.failed === null ? owed : this.options.carry(this.failed, owed);
        this.failed = null;
        try {
          await write(carried);
        } catch (error) {
          this.failed = carried;
          if (asked === this.asked) this.options.onFailed(carried, error);
        }
      })
      .catch((error: unknown) => {
        console.error("Nexus: reporting a failed write threw:", error);
      });
    return this.tail;
  }

  /** Resolves once every write asked for so far has answered. */
  settled(): Promise<void> {
    return this.tail;
  }
}
