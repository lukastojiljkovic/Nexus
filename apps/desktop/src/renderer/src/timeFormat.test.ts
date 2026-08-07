import { describe, expect, it } from "vitest";
import { formatClockTime } from "./timeFormat.js";

describe("formatClockTime", () => {
  it("renders a two-digit 24-hour clock", () => {
    // Built from local parts on purpose: the function formats in the HOST's
    // zone, so a fixed UTC instant would assert the test machine's offset
    // rather than the formatter.
    const morning = new Date(2026, 7, 7, 9, 5);
    const evening = new Date(2026, 7, 7, 21, 40);
    expect(formatClockTime(morning)).toBe("09:05");
    expect(formatClockTime(evening)).toBe("21:40");
  });

  it("accepts an ISO string as well as a Date", () => {
    const at = new Date(2026, 7, 7, 14, 32);
    expect(formatClockTime(at.toISOString())).toBe("14:32");
  });

  it("hands back an unparseable string untouched rather than printing Invalid Date", () => {
    expect(formatClockTime("juče popodne")).toBe("juče popodne");
    expect(formatClockTime("")).toBe("");
  });

  it("answers with an empty string for an unparseable Date, which has nothing to hand back", () => {
    expect(formatClockTime(new Date(Number.NaN))).toBe("");
  });
});
