import { describe, expect, it } from "vitest";

import { microphoneFailure } from "./microphone.js";

/**
 * The one part of `microphone.ts` that can be tested here: which of the two
 * sentences a failed `getUserMedia` deserves.
 *
 * The session itself needs a real `navigator.mediaDevices`, an `AudioContext` and
 * a device — and this repository has no DOM environment on purpose
 * (`vitest.config.ts` states why) — so what is pinned is the CLASSIFICATION, not
 * the call: a refusal is a refusal, and a device that is missing, busy or unable
 * to meet the constraints asked for is a different sentence, because sending
 * somebody to a permission dialog that was never the problem is the defect this
 * function exists to prevent.
 */

describe("microphoneFailure", () => {
  it("reads a refusal as one, in both spellings the platform refuses with", () => {
    expect(microphoneFailure(new DOMException("denied", "NotAllowedError"))).toBe("denied");
    expect(microphoneFailure(new DOMException("denied", "SecurityError"))).toBe("denied");
  });

  it("reads everything else as a device this machine could not open", () => {
    expect(microphoneFailure(new DOMException("none", "NotFoundError"))).toBe("failed");
    expect(microphoneFailure(new DOMException("busy", "NotReadableError"))).toBe("failed");
    expect(microphoneFailure(new Error("something else"))).toBe("failed");
    expect(microphoneFailure(undefined)).toBe("failed");
    expect(microphoneFailure("denied")).toBe("failed");
  });
});
