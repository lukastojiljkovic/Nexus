/**
 * The two ways a user talks to the assistant, as state rather than as wiring.
 *
 * **Push-to-talk** is the mode a user in a hurry reaches for, and its whole
 * behaviour is the difference between a press and a mis-tap: holding a key for
 * 40 ms while typing is not an utterance, and treating it as one sends 40 ms of
 * key-clatter to a model that then answers it. The threshold is a duration, and
 * it is checked at RELEASE, because at press time there is nothing to check.
 *
 * **Hands-free** is the mode a user with their hands full reaches for, and its
 * behaviour is a timeout in both directions: the recording has to end when the
 * user stops talking (which is what the VAD is for), and it has to end even if
 * they never do, because a microphone that is never told to stop is a
 * microphone that fills the disk and transcribes a room for an hour. Both
 * endings are decided here, on frame verdicts, so the page can be a button and
 * a spinner rather than a timer of its own.
 *
 * Both machines are objects with no clock of their own: every method takes the
 * time it is called at, so a test drives an hour of audio in microseconds and
 * the page cannot accidentally measure time with a second, different clock.
 */

/** The default shortest hold that counts as an utterance, in milliseconds. */
export const PUSH_TO_TALK_MIN_HOLD_MS = 300;

/** The default longest a hands-free recording may run before it is cut, in milliseconds. */
export const HANDS_FREE_MAX_UTTERANCE_MS = 30_000;

/** What a push-to-talk release was. */
export type PushToTalkResult = "utterance" | "too-short" | "not-recording";

/**
 * A push-to-talk key.
 *
 * Two presses without a release in between are one recording, and the second
 * press does not move its start: the key is either down or up, and a repeat
 * event from the operating system is not a new utterance.
 */
export class PushToTalk {
  private startedAtMs: number | null = null;

  constructor(private readonly minHoldMs: number = PUSH_TO_TALK_MIN_HOLD_MS) {
    if (!Number.isFinite(minHoldMs) || minHoldMs < 0) {
      throw new RangeError("PushToTalk: minHoldMs must be zero or more milliseconds.");
    }
  }

  /** Whether the key is down, and therefore whether the microphone should be open. */
  get recording(): boolean {
    return this.startedAtMs !== null;
  }

  press(atMs: number): void {
    if (this.startedAtMs !== null) return;
    this.startedAtMs = atMs;
  }

  /** Ends the recording, if there was one, and says whether it was worth transcribing. */
  release(atMs: number): PushToTalkResult {
    const startedAtMs = this.startedAtMs;
    if (startedAtMs === null) return "not-recording";
    this.startedAtMs = null;
    return atMs - startedAtMs >= this.minHoldMs ? "utterance" : "too-short";
  }

  /** Drops the recording without an answer, for a page that is being closed. */
  reset(): void {
    this.startedAtMs = null;
  }
}

/** What a hands-free gate is doing. */
export type HandsFreeState = "idle" | "recording" | "finished" | "timed-out";

/**
 * A hands-free turn.
 *
 * The caller pushes the VAD's verdict for each frame, and the gate answers with
 * the state that frame produced. `finished` is the ordinary ending — the user
 * stopped talking — and `timed-out` is the safety net. The two are separate
 * states rather than one because the page says different things: a finished
 * utterance goes to the model, and a timed-out one is usually a stuck
 * microphone or a room with a television in it, so the page asks before
 * transcribing it.
 */
export class HandsFreeGate {
  private state: HandsFreeState = "idle";
  private startedAtMs = 0;
  private lastSpeechAtMs = 0;

  constructor(
    private readonly options: { readonly endSilenceMs: number; readonly maxUtteranceMs: number } = {
      endSilenceMs: 600,
      maxUtteranceMs: HANDS_FREE_MAX_UTTERANCE_MS,
    },
  ) {
    if (!Number.isFinite(options.endSilenceMs) || options.endSilenceMs < 0) {
      throw new RangeError("HandsFreeGate: endSilenceMs must be zero or more milliseconds.");
    }
    if (!Number.isFinite(options.maxUtteranceMs) || options.maxUtteranceMs <= 0) {
      throw new RangeError("HandsFreeGate: maxUtteranceMs must be a positive number of milliseconds.");
    }
  }

  get current(): HandsFreeState {
    return this.state;
  }

  /**
   * One frame. `speech` is the VAD's verdict and `atMs` is when the frame ended,
   * measured on the caller's own clock so that the two cannot disagree.
   */
  frame(atMs: number, speech: boolean): HandsFreeState {
    if (this.state === "finished" || this.state === "timed-out") return this.state;

    if (this.state === "idle") {
      if (!speech) return this.state;
      // The utterance starts here, and `lastSpeechAtMs` starts with it: a
      // detector that reports its first speech frame and then a long silence
      // has produced a cough, and the gate is the thing that declines it.
      this.state = "recording";
      this.startedAtMs = atMs;
      this.lastSpeechAtMs = atMs;
    } else if (speech) {
      this.lastSpeechAtMs = atMs;
    }

    if (this.state === "recording") {
      if (atMs - this.startedAtMs >= this.options.maxUtteranceMs) this.state = "timed-out";
      else if (!speech && atMs - this.lastSpeechAtMs >= this.options.endSilenceMs) this.state = "finished";
    }
    return this.state;
  }

  /** Back to idle, for the next turn. */
  reset(): void {
    this.state = "idle";
    this.startedAtMs = 0;
    this.lastSpeechAtMs = 0;
  }
}
