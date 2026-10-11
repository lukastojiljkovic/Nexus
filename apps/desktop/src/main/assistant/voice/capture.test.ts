import { describe, expect, it } from "vitest";

import { HandsFreeGate, PUSH_TO_TALK_MIN_HOLD_MS, PushToTalk } from "./capture.js";

describe("PushToTalk", () => {
  it("calls a hold of exactly the minimum an utterance", () => {
    const talk = new PushToTalk();
    talk.press(1_000);
    expect(talk.release(1_000 + PUSH_TO_TALK_MIN_HOLD_MS)).toBe("utterance");
  });

  it("calls a shorter hold a mis-tap", () => {
    const talk = new PushToTalk();
    talk.press(1_000);
    expect(talk.release(1_299)).toBe("too-short");
  });

  it("refuses a release it never saw pressed", () => {
    expect(new PushToTalk().release(5_000)).toBe("not-recording");
  });

  it("treats a repeated press as the same recording", () => {
    const talk = new PushToTalk();
    talk.press(1_000);
    talk.press(1_100);
    expect(talk.recording).toBe(true);
    expect(talk.release(1_400)).toBe("utterance");
    expect(talk.recording).toBe(false);
  });

  it("is idle after a release, and after a reset", () => {
    const talk = new PushToTalk();
    talk.press(0);
    talk.reset();
    expect(talk.recording).toBe(false);
    expect(talk.release(1_000)).toBe("not-recording");
  });

  it("can be told a different floor", () => {
    const talk = new PushToTalk(50);
    talk.press(0);
    expect(talk.release(40)).toBe("too-short");
    talk.press(0);
    expect(talk.release(60)).toBe("utterance");
  });

  it("refuses a floor that is not a duration", () => {
    expect(() => new PushToTalk(-1)).toThrow(RangeError);
  });
});

describe("HandsFreeGate", () => {
  it("stays idle while the room is quiet", () => {
    const gate = new HandsFreeGate();
    for (let at = 0; at < 5_000; at += 20) expect(gate.frame(at, false)).toBe("idle");
  });

  it("starts on the first speech frame and ends after the silence", () => {
    const gate = new HandsFreeGate({ endSilenceMs: 400, maxUtteranceMs: 30_000 });
    // 300 ms of speech, then silence.
    let at = 0;
    for (; at < 300; at += 20) expect(gate.frame(at, true)).toBe("recording");
    // 380 ms of silence is still the same turn...
    for (; at < 680; at += 20) expect(gate.frame(at, false)).toBe("recording");
    // ...and at 400 ms of silence the turn ends.
    expect(gate.frame(at, false)).toBe("finished");
    // A finished gate stays finished until it is reset.
    expect(gate.frame(10_000, true)).toBe("finished");
    gate.reset();
    expect(gate.frame(10_020, true)).toBe("recording");
  });

  it("restarts the silence timer on every speech frame, so a breath does not end the turn", () => {
    const gate = new HandsFreeGate({ endSilenceMs: 400, maxUtteranceMs: 30_000 });
    gate.frame(0, true);
    // Speech at 0, then 300 ms gaps with speech in between. Every gap is under
    // the 400 ms rule, so the turn runs on; the last one is 410 ms and ends it.
    expect(gate.frame(300, false)).toBe("recording");
    expect(gate.frame(320, true)).toBe("recording");
    expect(gate.frame(620, false)).toBe("recording");
    expect(gate.frame(650, true)).toBe("recording");
    expect(gate.frame(950, false)).toBe("recording");
    expect(gate.frame(1_060, false)).toBe("finished");
  });

  it("cuts a microphone that never stops", () => {
    const gate = new HandsFreeGate({ endSilenceMs: 600, maxUtteranceMs: 1_000 });
    expect(gate.frame(0, true)).toBe("recording");
    expect(gate.frame(980, true)).toBe("recording");
    expect(gate.frame(1_000, true)).toBe("timed-out");
  });

  it("does not start on a lone speech frame before the utterance has begun", () => {
    // A cough: one speech frame, then silence. The gate is recording — it has to
    // be, there is no way to know at that instant — and the silence ends it.
    const gate = new HandsFreeGate({ endSilenceMs: 200, maxUtteranceMs: 30_000 });
    expect(gate.frame(0, true)).toBe("recording");
    expect(gate.frame(200, false)).toBe("finished");
  });

  it("refuses options that are not durations", () => {
    expect(() => new HandsFreeGate({ endSilenceMs: -1, maxUtteranceMs: 1_000 })).toThrow(RangeError);
    expect(() => new HandsFreeGate({ endSilenceMs: 100, maxUtteranceMs: 0 })).toThrow(RangeError);
  });
});
