import { describe, expect, it } from "vitest";
import {
  HLC_MAX_FORWARD_DRIFT_MS,
  clampRemoteHlc,
  compareHlc,
  formatHlc,
  hlcReceive,
  hlcSend,
  hlcZero,
  parseHlc,
  type Hlc,
} from "./hlc.js";

const A = "device-a";
const B = "device-b";
const T0 = 1_800_000_000_000; // a plain millisecond wall clock

describe("hlcSend", () => {
  it("takes the wall clock and resets the counter when time has moved on", () => {
    const next = hlcSend({ wallMs: T0, counter: 5, nodeId: A }, T0 + 1);
    expect(next).toEqual({ wallMs: T0 + 1, counter: 0, nodeId: A });
  });

  it("increments the counter when the wall clock has not moved", () => {
    const next = hlcSend({ wallMs: T0, counter: 5, nodeId: A }, T0);
    expect(next).toEqual({ wallMs: T0, counter: 6, nodeId: A });
  });

  it("never goes backwards when the local clock does", () => {
    // NTP correction, a user changing the time zone the wrong way, a laptop
    // waking with a dead RTC — the physical clock can move back, the logical
    // one must not, or two writes get the same stamp and the merge is a coin flip.
    const next = hlcSend({ wallMs: T0, counter: 0, nodeId: A }, T0 - 60_000);
    expect(next).toEqual({ wallMs: T0, counter: 1, nodeId: A });
    expect(compareHlc(next, { wallMs: T0, counter: 0, nodeId: A })).toBe(1);
  });

  it("produces a strictly increasing sequence however the clock behaves", () => {
    const clocks = [T0, T0, T0 - 5, T0 + 1, T0 + 1, T0 - 1000, T0 + 2];
    let state = hlcZero(A);
    let previous = state;
    for (const now of clocks) {
      state = hlcSend(state, now);
      expect(compareHlc(state, previous)).toBe(1);
      previous = state;
    }
  });

  it("rejects a clock that is not a non-negative safe integer", () => {
    expect(() => hlcSend(hlcZero(A), Number.NaN)).toThrow(TypeError);
    expect(() => hlcSend(hlcZero(A), -1)).toThrow(TypeError);
    expect(() => hlcSend(hlcZero(A), 1.5)).toThrow(TypeError);
  });
});

describe("clampRemoteHlc", () => {
  it("leaves a timestamp inside the window untouched", () => {
    const remote: Hlc = { wallMs: T0 + HLC_MAX_FORWARD_DRIFT_MS, counter: 3, nodeId: B };
    expect(clampRemoteHlc(remote, T0)).toEqual(remote);
  });

  it("leaves a timestamp in the past untouched", () => {
    const remote: Hlc = { wallMs: T0 - 10_000_000, counter: 3, nodeId: B };
    expect(clampRemoteHlc(remote, T0)).toEqual(remote);
  });

  it("pulls a timestamp beyond the window back to exactly the window edge", () => {
    const remote: Hlc = { wallMs: T0 + 10 * 365 * 24 * 3600 * 1000, counter: 3, nodeId: B };
    expect(clampRemoteHlc(remote, T0)).toEqual({
      wallMs: T0 + HLC_MAX_FORWARD_DRIFT_MS,
      counter: 3,
      nodeId: B,
    });
  });
});

describe("hlcReceive", () => {
  it("advances to the remote time when the remote is ahead", () => {
    const next = hlcReceive({ wallMs: T0, counter: 4, nodeId: A }, { wallMs: T0 + 10, counter: 2, nodeId: B }, T0);
    expect(next).toEqual({ wallMs: T0 + 10, counter: 3, nodeId: A });
  });

  it("keeps local time and bumps the local counter when local is ahead", () => {
    const next = hlcReceive({ wallMs: T0 + 10, counter: 4, nodeId: A }, { wallMs: T0, counter: 9, nodeId: B }, T0);
    expect(next).toEqual({ wallMs: T0 + 10, counter: 5, nodeId: A });
  });

  it("takes the greater counter plus one when both sides sit on the same millisecond", () => {
    const next = hlcReceive({ wallMs: T0, counter: 4, nodeId: A }, { wallMs: T0, counter: 9, nodeId: B }, T0);
    expect(next).toEqual({ wallMs: T0, counter: 10, nodeId: A });
  });

  it("resets the counter when the physical clock has overtaken both", () => {
    const next = hlcReceive({ wallMs: T0, counter: 4, nodeId: A }, { wallMs: T0, counter: 9, nodeId: B }, T0 + 50);
    expect(next).toEqual({ wallMs: T0 + 50, counter: 0, nodeId: A });
  });

  it("keeps the local node id — receiving never changes who you are", () => {
    expect(hlcReceive(hlcZero(A), { wallMs: T0, counter: 0, nodeId: B }, T0).nodeId).toBe(A);
  });

  it("cannot be dragged into the far future by a device with an insane clock", () => {
    const insane: Hlc = { wallMs: T0 + 10 * 365 * 24 * 3600 * 1000, counter: 0, nodeId: B };
    const next = hlcReceive({ wallMs: T0, counter: 0, nodeId: A }, insane, T0);
    expect(next.wallMs).toBe(T0 + HLC_MAX_FORWARD_DRIFT_MS);
  });
});

describe("a device with an insane clock cannot win every merge", () => {
  it("is bounded to at most the drift window of undeserved priority", () => {
    const insane: Hlc = { wallMs: T0 + 10 * 365 * 24 * 3600 * 1000, counter: 0, nodeId: B };
    const admitted = clampRemoteHlc(insane, T0);

    // An honest write made a minute after the window closes now beats it.
    const honest = hlcSend({ wallMs: T0, counter: 0, nodeId: A }, T0 + HLC_MAX_FORWARD_DRIFT_MS + 60_000);
    expect(compareHlc(honest, admitted)).toBe(1);

    // And an honest write from inside the window still loses — that residual
    // 24 hours of priority is the cost of admitting the row at all.
    const inside = hlcSend({ wallMs: T0, counter: 0, nodeId: A }, T0 + 3600_000);
    expect(compareHlc(inside, admitted)).toBe(-1);
  });
});

describe("compareHlc", () => {
  it("orders by wall clock, then counter, then node id", () => {
    expect(compareHlc({ wallMs: 1, counter: 0, nodeId: A }, { wallMs: 2, counter: 0, nodeId: A })).toBe(-1);
    expect(compareHlc({ wallMs: 1, counter: 1, nodeId: A }, { wallMs: 1, counter: 0, nodeId: A })).toBe(1);
    expect(compareHlc({ wallMs: 1, counter: 0, nodeId: A }, { wallMs: 1, counter: 0, nodeId: B })).toBe(-1);
    expect(compareHlc({ wallMs: 1, counter: 0, nodeId: A }, { wallMs: 1, counter: 0, nodeId: A })).toBe(0);
  });

  it("breaks node-id ties by UTF-16 code unit, never by locale", () => {
    const left: Hlc = { wallMs: 1, counter: 0, nodeId: "z-device" };
    const right: Hlc = { wallMs: 1, counter: 0, nodeId: "š-device" };
    // Code units put "z" (U+007A) before "š" (U+0161). Serbian collation puts
    // "š" before "z". The two answers genuinely disagree, which is the point:
    // an ordering that depends on the runtime's ICU tables would resolve one
    // merge two ways on two devices. This one never moves.
    expect(compareHlc(left, right)).toBe(-1);
    expect("z-device".localeCompare("š-device", "sr-Latn")).toBe(1);
  });

  it("is antisymmetric and total over a shuffled set", () => {
    const stamps: Hlc[] = [
      { wallMs: 2, counter: 0, nodeId: A },
      { wallMs: 1, counter: 9, nodeId: B },
      { wallMs: 1, counter: 9, nodeId: A },
      { wallMs: 1, counter: 0, nodeId: B },
      { wallMs: 3, counter: 0, nodeId: B },
    ];
    for (const x of stamps) {
      for (const y of stamps) {
        // Written as a sum rather than a negation so the assertion does not
        // trip over Object.is(-0, 0) on the equal case.
        expect(compareHlc(x, y) + compareHlc(y, x)).toBe(0);
      }
    }
    const sorted = [...stamps].sort(compareHlc).map(formatHlc);
    const reshuffled = [stamps[3], stamps[0], stamps[4], stamps[2], stamps[1]] as Hlc[];
    expect([...reshuffled].sort(compareHlc).map(formatHlc)).toEqual(sorted);
  });
});

describe("formatHlc / parseHlc", () => {
  it("round-trips", () => {
    const stamp: Hlc = { wallMs: T0, counter: 42, nodeId: A };
    expect(parseHlc(formatHlc(stamp))).toEqual(stamp);
  });

  it("sorts lexicographically in the same order compareHlc does", () => {
    const stamps: Hlc[] = [
      { wallMs: T0 + 1, counter: 0, nodeId: A },
      { wallMs: T0, counter: 16, nodeId: A },
      { wallMs: T0, counter: 2, nodeId: B },
      { wallMs: T0, counter: 2, nodeId: A },
    ];
    const byCompare = [...stamps].sort(compareHlc).map(formatHlc);
    const byString = stamps.map(formatHlc).sort();
    expect(byString).toEqual(byCompare);
  });

  it("rejects anything that is not a stamp", () => {
    expect(parseHlc("")).toBeNull();
    expect(parseHlc("nope")).toBeNull();
    expect(parseHlc("0000000000:00000000:a")).toBeNull(); // wall too short
    expect(parseHlc("00000000000g:00000000:a")).toBeNull(); // not hex
    expect(parseHlc("000000000000:00000000:")).toBeNull(); // empty node id
    expect(parseHlc("000000000000:00000000")).toBeNull(); // no node id
  });

  it("keeps a node id containing a colon intact", () => {
    const stamp: Hlc = { wallMs: T0, counter: 1, nodeId: "desktop:win:01" };
    expect(parseHlc(formatHlc(stamp))).toEqual(stamp);
  });
});

describe("counter overflow", () => {
  it("refuses to wrap, because a wrapped counter silently reorders writes", () => {
    const saturated: Hlc = { wallMs: T0, counter: 0xffffffff, nodeId: A };
    expect(() => hlcSend(saturated, T0)).toThrow(RangeError);
    expect(() => hlcReceive(saturated, { wallMs: T0, counter: 0, nodeId: B }, T0)).toThrow(RangeError);
  });
});
