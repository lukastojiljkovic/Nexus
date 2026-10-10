import { describe, expect, it } from "vitest";
import { HANDS_FREE_MAX_UTTERANCE_MS } from "../../../../main/assistant/voice/capture.js";
import {
  VoiceController,
  type CaptureSession,
  type SpeechAudio,
  type SpeechPlayback,
  type VoiceDetail,
  type VoicePhase,
} from "./controller.js";

/**
 * The voice controller (ADR-105): push-to-talk, hands-free, barge-in, a
 * missing pack and the sentence-by-sentence reading of a streamed answer. Every
 * effect is a fake here - no microphone, no worker, no model - and the clock is
 * a number the test moves, which is what lets thirty seconds of hands-free audio
 * be a loop of six frames.
 */

/** A capture session that hands back canned audio and records what was asked of it. */
function fakeCapture(input: {
  readonly pcm?: Float32Array;
  readonly sampleRate?: number;
  readonly opened?: { count: number };
}): CaptureSession & { frames: ((frame: Float32Array) => void)[]; aborted: boolean; stopped: boolean } {
  const session = {
    sampleRate: input.sampleRate ?? 16_000,
    frames: [] as ((frame: Float32Array) => void)[],
    aborted: false,
    stopped: false,
    onFrame(report: (frame: Float32Array) => void): void {
      session.frames.push(report);
    },
    async stop() {
      session.stopped = true;
      const pcm = input.pcm ?? new Float32Array([0.5, -0.5, 0.5, -0.5]);
      return { pcm, sampleRate: session.sampleRate };
    },
    abort(): void {
      session.aborted = true;
    },
  };
  if (input.opened !== undefined) input.opened.count += 1;
  return session;
}

/** A playback whose ending the test decides, so speech can be interrupted mid-sentence. */
function fakePlayback(log: string[], text: string): SpeechPlayback & { finish(): void; stopped: boolean } {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const playback = {
    done,
    stopped: false,
    stop(): void {
      playback.stopped = true;
      log.push(`stop:${text}`);
      finish();
    },
    finish(): void {
      log.push(`played:${text}`);
      finish();
    },
  };
  return playback;
}

interface Harness {
  readonly controller: VoiceController;
  readonly phases: VoicePhase[];
  readonly details: VoiceDetail[];
  readonly delivered: string[];
  readonly spoken: string[];
  readonly playLog: string[];
  readonly playbacks: (SpeechPlayback & { finish(): void; stopped: boolean })[];
  readonly captures: ReturnType<typeof fakeCapture>[];
  /** The mutable half, shared by reference with the deps the controller was built with. */
  readonly state: { at: number; transcript: string | null; voice: "ok" | "missing" };
}

function harness(): Harness {
  const state = { at: 0, transcript: "Zdravo, kako si?" as string | null, voice: "ok" as const };
  const fake = {
    phases: [] as VoicePhase[],
    details: [] as VoiceDetail[],
    delivered: [] as string[],
    spoken: [] as string[],
    playLog: [] as string[],
    playbacks: [] as (SpeechPlayback & { finish(): void; stopped: boolean })[],
    captures: [] as ReturnType<typeof fakeCapture>[],
  };
  const mutable = state as { at: number; transcript: string | null; voice: "ok" | "missing" };
  const controller = new VoiceController(
    {
      async startCapture() {
        const session = fakeCapture({});
        fake.captures.push(session);
        return session;
      },
      async transcribe() {
        return mutable.transcript;
      },
      async speak(text: string): Promise<SpeechAudio | null> {
        if (mutable.voice === "missing") return null;
        fake.spoken.push(text);
        return { pcm: new Float32Array([0.1]), sampleRate: 16_000 };
      },
      play(audio: SpeechAudio): SpeechPlayback {
        const text = fake.spoken[fake.spoken.length - 1] ?? "";
        void audio;
        const playback = fakePlayback(fake.playLog, text);
        fake.playbacks.push(playback);
        return playback;
      },
      deliver(text: string) {
        fake.delivered.push(text);
      },
      setPhase(phase: VoicePhase, detail: VoiceDetail) {
        fake.phases.push(phase);
        fake.details.push(detail);
      },
    },
    () => mutable.at,
  );
  // The controller is built BEFORE the object that holds it, so nothing here is
  // assigned through a readonly member: the deps close over `fake`, and the
  // controller is handed back beside it.
  return { ...fake, controller, state: mutable };
}

/** Lets the controller's own async work run (the fakes resolve immediately). */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

describe("push to talk", () => {
  it("records while the key is down and delivers the transcript when it comes up", async () => {
    const fake = harness();
    await fake.controller.press();
    expect(fake.controller.current).toBe("listening");
    fake.state.at += 500;
    await fake.controller.release();
    await settle();
    expect(fake.delivered).toEqual(["Zdravo, kako si?"]);
    expect(fake.controller.current).toBe("off");
    expect(fake.captures).toHaveLength(1);
  });

  it("throws away a hold shorter than the threshold, and never transcribes it", async () => {
    const fake = harness();
    await fake.controller.press();
    fake.state.at += 40;
    await fake.controller.release();
    await settle();
    expect(fake.delivered).toEqual([]);
    expect(fake.captures[0]?.aborted).toBe(true);
    expect(fake.details).toContain("too-short");
  });

  it("reports a missing speech model instead of opening a microphone that records into nothing", async () => {
    const fake = harness();
    fake.state.transcript = null;
    await fake.controller.press();
    fake.state.at += 500;
    await fake.controller.release();
    await settle();
    expect(fake.delivered).toEqual([]);
    expect(fake.details).toContain("no-speech-model");
    expect(fake.controller.current).toBe("off");
  });
});

describe("hands free", () => {
  it("ends the utterance when the user stops talking, and delivers it", async () => {
    const fake = harness();
    await fake.controller.setHandsFree(true);
    const session = fake.captures[0];
    expect(session).toBeDefined();
    const at = (atMs: number, loud: boolean): void => {
      fake.state.at = atMs;
      // The VAD's own frame length at the session's rate. The detector's floor
      // starts at the FIRST frame it is given, so the quiet frame is what a real
      // microphone hears before anybody speaks.
      session?.frames[0]?.(new Float32Array(320).fill(loud ? 0.5 : 0));
    };
    at(0, false);
    at(20, true);
    at(40, true);
    // 700 ms of silence, past the gate's own 600 ms end-of-utterance threshold.
    for (let atMs = 60; atMs <= 760; atMs += 20) at(atMs, false);
    await settle();
    expect(fake.delivered).toEqual(["Zdravo, kako si?"]);
    expect(fake.controller.current).toBe("off");
  });

  it("cuts an utterance that never ends at the gate's own maximum", async () => {
    const fake = harness();
    await fake.controller.setHandsFree(true);
    const session = fake.captures[0];
    const at = (atMs: number, loud: boolean): void => {
      fake.state.at = atMs;
      session?.frames[0]?.(new Float32Array(320).fill(loud ? 0.5 : 0));
    };
    at(0, false);
    // A speaker who never pauses: the gate's maximum is the only thing that ends it.
    for (let atMs = 20; atMs <= HANDS_FREE_MAX_UTTERANCE_MS + 40; atMs += 20) at(atMs, true);
    await settle();
    // The turn was cut rather than left running: a microphone that never stops
    // is the failure the gate's maximum exists for.
    expect(fake.delivered).toEqual(["Zdravo, kako si?"]);
    expect(fake.controller.current).toBe("off");
  });
});

describe("spoken answers", () => {
  it("speaks only the sentences the model has finished", async () => {
    const fake = harness();
    fake.controller.setAnswersAloud(true);
    fake.controller.pushAnswer("Helikopter dolazi u zoru.");
    fake.controller.pushAnswer(" Ostani na mestu");
    await settle();
    expect(fake.spoken).toEqual(["Helikopter dolazi u zoru."]);
    // The first sentence is still being played, so the second one waits: a queue
    // that spoke over itself would be two voices in one room.
    fake.playbacks[0]?.finish();
    await settle();
    fake.controller.pushAnswer(" i ne kreci.");
    await settle();
    expect(fake.spoken).toEqual([
      "Helikopter dolazi u zoru.",
      "Ostani na mestu i ne kreci.",
    ]);
    fake.controller.endAnswer();
    await settle();
  });

  it("speaks the tail of an answer that never ends in a terminator", async () => {
    const fake = harness();
    fake.controller.setAnswersAloud(true);
    fake.controller.pushAnswer("Nema tacke na kraju");
    await settle();
    expect(fake.spoken).toEqual([]);
    fake.controller.endAnswer();
    await settle();
    expect(fake.spoken).toEqual(["Nema tacke na kraju"]);
  });

  it("stops the playback and drops the queue when the user starts talking", async () => {
    const fake = harness();
    fake.controller.setAnswersAloud(true);
    fake.controller.pushAnswer("Prva recenica.");
    fake.controller.pushAnswer(" Druga recenica.");
    await settle();
    expect(fake.spoken).toEqual(["Prva recenica."]);
    // The first sentence is still playing: the user presses the key, which is
    // the barge-in the whole design is built around.
    await fake.controller.press();
    await settle();
    expect(fake.playLog).toEqual(["stop:Prva recenica."]);
    expect(fake.playbacks[0]?.stopped).toBe(true);
    expect(fake.controller.current).toBe("listening");
    // And the second sentence is never spoken: its answer is already on screen.
    fake.state.at += 500;
    await fake.controller.release();
    await settle();
    expect(fake.spoken).toEqual(["Prva recenica."]);
  });

  it("refuses to speak when no voice is installed, and says which pack is missing", async () => {
    const fake = harness();
    fake.state.voice = "missing";
    fake.controller.setAnswersAloud(true);
    fake.controller.pushAnswer("Zdravo.");
    await settle();
    expect(fake.spoken).toEqual([]);
    expect(fake.details).toContain("no-voice");
    expect(fake.controller.current).toBe("off");
  });
});

describe("one click to stop", () => {
  it("closes the microphone, the transcription and the speech together", async () => {
    const fake = harness();
    await fake.controller.press();
    fake.controller.stop();
    expect(fake.captures[0]?.aborted).toBe(true);
    expect(fake.controller.current).toBe("off");
  });
});
