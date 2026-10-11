/**
 * The chat page's voice, as a state machine with every effect handed in
 * (ADR-105). `PushToTalk`, `HandsFreeGate` and `splitSentences` are the library
 * this wave wires in; what did not exist yet is the object that HOLDS the four
 * states a user sees and decides what each event does to them - and that is this
 * file, deliberately with no DOM in it, so the whole of it is testable.
 *
 * **Four states, one of them at a time.** `off` is the page at rest; `listening`
 * is an open microphone; `working` is an utterance that is being transcribed;
 * `speaking` is an answer being read aloud. The page draws exactly what these
 * say, which is what stops a spinner standing in for silence: a TTS model on
 * this machine runs at 0.63x real time (ADR-105 section 3), so "speaking" is a
 * state the user sits in rather than a moment they miss.
 *
 * **Talking interrupts speech.** A press while the assistant is speaking stops
 * the playback and drops the sentences queued behind it, because the user
 * talking is a better answer to "may I keep talking" than anything the page
 * could decide. The queued sentences are DROPPED rather than resumed: their
 * answer is already on screen, and reading the rest of it over the user's next
 * question is the behaviour nobody wants.
 *
 * **A sentence is spoken when it is complete, never when the turn is.** The page
 * feeds the answer's tokens as they arrive (`pushAnswer`), so speech starts on
 * the first finished sentence instead of on the whole answer - which at 0.63x
 * real time is the difference between an assistant and a wait.
 *
 * **The clock is an argument to the machines it belongs to.** `PushToTalk` and
 * `HandsFreeGate` take the time they are called at, so this file never reads one
 * itself and a test can drive an hour of audio in microseconds.
 */

import {
  HandsFreeGate,
  PushToTalk,
  type HandsFreeState,
} from "../../../../main/assistant/voice/capture.js";
import { MAX_SPEECH_CHARS, splitSentences } from "../../../../main/assistant/voice/sentences.js";
import { createStreamingVad, type StreamingVad } from "../../../../main/assistant/voice/vad.js";
import { VOICE_SAMPLE_RATE } from "../../../../main/assistant/voice/resample.js";

/** What the page draws, and the whole of what the user is told about the voice. */
export type VoicePhase = "off" | "listening" | "working" | "speaking";

/** One sentence's audio, as main synthesized it. */
export interface SpeechAudio {
  readonly pcm: Float32Array;
  readonly sampleRate: number;
}

/** Playback of one sentence: `done` resolves when it ends, or as soon as it is stopped. */
export interface SpeechPlayback {
  readonly done: Promise<void>;
  stop(): void;
}

/** One open capture: frames for the VAD, and a stop that answers what was recorded. */
export interface CaptureSession {
  /** The rate the device is delivering at, so the detector's frame length is right. */
  readonly sampleRate: number;
  /** Every frame, in order, from the moment the session opened. */
  onFrame(report: (frame: Float32Array) => void): void;
  /** Stops the device and answers the whole utterance, or `null` when there is none. */
  stop(): Promise<{ readonly pcm: Float32Array; readonly sampleRate: number } | null>;
  /** Stops the device and throws the audio away. */
  abort(): void;
}

/**
 * Everything the controller does to the world, so a test can watch it.
 *
 * `transcribe` answers `null` when no speech model is installed, and `speak`
 * answers `null` when no voice is: both are ordinary states (ADR-105's "no pack,
 * no service") rather than errors, and the page turns each into a sentence that
 * names the pack to install.
 */
export interface VoiceDeps {
  startCapture(): Promise<CaptureSession | null>;
  transcribe(pcm: Float32Array, sampleRate: number): Promise<string | null>;
  speak(text: string): Promise<SpeechAudio | null>;
  play(audio: SpeechAudio): SpeechPlayback;
  /** A finished utterance: the page puts it in the composer, or sends it. */
  deliver(text: string): void;
  setPhase(phase: VoicePhase, detail: VoiceDetail): void;
}

/** Why the phase changed, when the reason is not just "the user did something". */
export type VoiceDetail = "no-speech-model" | "no-voice" | "too-short" | null;

/** The shortest hold that counts as an utterance: `capture.ts`'s own default. */
export class VoiceController {
  private readonly ptt = new PushToTalk();
  private readonly gate = new HandsFreeGate();
  private capture: CaptureSession | null = null;
  private phase: VoicePhase = "off";
  private handsFree = false;
  private aloud = false;
  /** The sentences waiting to be spoken, oldest first. */
  private readonly pending: string[] = [];
  /** The answer text not yet cut into sentences. */
  private tail = "";
  private playback: SpeechPlayback | null = null;
  private draining = false;
  /** Built when a capture opens: the detector is the library's, not a threshold invented here. */
  private vad: StreamingVad | null = null;

  constructor(
    private readonly deps: VoiceDeps,
    private readonly now: () => number,
  ) {}

  get current(): VoicePhase {
    return this.phase;
  }

  get isListening(): boolean {
    return this.phase === "listening" || this.phase === "working";
  }

  /** Whether an answer is read aloud as it streams. */
  get answersAloud(): boolean {
    return this.aloud;
  }

  setAnswersAloud(on: boolean): void {
    this.aloud = on;
    if (!on) this.stopSpeaking();
  }

  private to(phase: VoicePhase, detail: VoiceDetail = null): void {
    if (this.phase === phase && detail === null) return;
    this.phase = phase;
    this.deps.setPhase(phase, detail);
  }

  /**
   * The key went down: interrupt whatever is happening, then listen.
   *
   * The interruption comes FIRST, so a press while the assistant is speaking
   * both silences it and opens the microphone in one gesture - which is exactly
   * the moment a user reaches for the button.
   */
  async press(): Promise<void> {
    this.stopSpeaking();
    if (this.ptt.recording) return;
    this.ptt.press(this.now());
    await this.openCapture();
  }

  /** The key came up: transcribe what was said, or throw away a mis-tap. */
  async release(): Promise<void> {
    const result = this.ptt.release(this.now());
    if (result === "not-recording") return;
    if (result === "too-short") {
      this.capture?.abort();
      this.capture = null;
      this.vad = null;
      this.to("off", "too-short");
      return;
    }
    await this.finishUtterance();
  }

  /**
   * Hands-free on or off.
   *
   * On, the microphone stays open and the VAD decides when the user stopped; the
   * gate's own maximum (`HANDS_FREE_MAX_UTTERANCE_MS`) ends an utterance that
   * never stops on its own, because a stuck microphone is the failure that fills
   * a disk.
   */
  async setHandsFree(on: boolean): Promise<void> {
    this.handsFree = on;
    this.ptt.reset();
    if (!on) {
      this.capture?.abort();
      this.capture = null;
      this.vad = null;
      this.gate.reset();
      this.to("off");
      return;
    }
    this.gate.reset();
    await this.openCapture();
  }

  /** One click to stop: the capture, the transcription and the speech, together. */
  stop(): void {
    this.ptt.reset();
    this.gate.reset();
    this.capture?.abort();
    this.capture = null;
    this.vad = null;
    this.stopSpeaking();
    this.to("off");
  }

  /** One token of the answer being streamed, spoken sentence by sentence. */
  pushAnswer(delta: string): void {
    if (!this.aloud) return;
    this.tail += delta;
    const pieces = splitSentences(this.tail, MAX_SPEECH_CHARS);
    const last = pieces[pieces.length - 1];
    // An unterminated tail is kept back: it is the sentence still being written,
    // and speaking half of it and then the whole of it is one sentence twice.
    const held = last !== undefined && !endsSentence(last) ? last : "";
    for (const piece of pieces) {
      if (piece === held) continue;
      this.pending.push(piece);
    }
    this.tail = held;
    this.drain();
  }

  /** The turn is over: whatever is left is a sentence too, and it is spoken. */
  endAnswer(): void {
    if (!this.aloud) return;
    const rest = this.tail.trim();
    this.tail = "";
    if (rest !== "") this.pending.push(rest);
    this.drain();
  }

  private async openCapture(): Promise<void> {
    this.to("listening");
    const session = await this.deps.startCapture();
    if (session === null) {
      // No speech model installed: the page names the pack to install rather
      // than opening a microphone that would record into nothing.
      this.to("off", "no-speech-model");
      return;
    }
    this.capture = session;
    this.vad = createStreamingVad(session.sampleRate ?? VOICE_SAMPLE_RATE);
    session.onFrame((frame) => this.onFrame(frame));
  }

  /** One VAD-sized frame, in hands-free mode. */
  private onFrame(frame: Float32Array): void {
    if (!this.handsFree || this.capture === null || this.vad === null) return;
    const state: HandsFreeState = this.gate.frame(this.now(), this.vad.push(frame));
    if (state === "finished" || state === "timed-out") void this.finishUtterance();
  }

  private async finishUtterance(): Promise<void> {
    const session = this.capture;
    this.capture = null;
    this.vad = null;
    this.gate.reset();
    this.ptt.reset();
    if (session === null) return;
    const recorded = await session.stop();
    if (recorded === null || recorded.pcm.length === 0) {
      this.to("off");
      return;
    }
    this.to("working");
    const text = await this.deps.transcribe(recorded.pcm, recorded.sampleRate);
    if (text === null) {
      this.to("off", "no-speech-model");
      return;
    }
    this.to("off");
    if (text.trim() !== "") this.deps.deliver(text.trim());
  }

  /** Speaks the queue, one sentence at a time, until it is empty or stopped. */
  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    void this.runQueue().finally(() => {
      this.draining = false;
    });
  }

  private async runQueue(): Promise<void> {
    while (this.pending.length > 0) {
      const sentence = this.pending[0] as string;
      const audio = await this.deps.speak(sentence);
      if (audio === null) {
        // No voice for this language: REFUSED, never the English voice reading
        // Serbian (ADR-105 section 3). The queue is dropped and the page says
        // which pack is missing.
        this.pending.length = 0;
        this.tail = "";
        this.to("off", "no-voice");
        return;
      }
      this.pending.shift();
      // The sentence may have been dropped while the model was working (a
      // barge-in empties the queue), in which case this audio is not wanted.
      if (this.pending.length === 0 && this.playback !== null) return;
      this.to("speaking");
      const playback = this.deps.play(audio);
      this.playback = playback;
      await playback.done;
      if (this.playback === playback) this.playback = null;
    }
    if (this.phase === "speaking") this.to("off");
  }

  private stopSpeaking(): void {
    this.pending.length = 0;
    this.tail = "";
    const playback = this.playback;
    this.playback = null;
    playback?.stop();
    if (this.phase === "speaking") this.to("off");
  }
}

/**
 * Whether `text` is a finished sentence.
 *
 * The splitter's own terminators (`.` `!` `?` `…`), with a closing quote or
 * bracket allowed to follow one - the same rule `sentences.ts` uses to keep
 * `„Kako si?"` together. Used only to decide what may be SPOKEN now, so a
 * disagreement with the splitter costs a sentence its place in the stream, never
 * a character of the answer.
 */
function endsSentence(text: string): boolean {
  return /[.!?\u2026]["')\]]*$/.test(text.trimEnd());
}
