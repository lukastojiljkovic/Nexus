import { describe, expect, it } from "vitest";

import {
  formatSensorCsv,
  formatSensorValue,
  parseSensorHeader,
  parseSensorLine,
} from "./sensorLines.js";

/**
 * The lines below are what the task's own sketch prints: a header naming the
 * three columns and then one line per reading. The values are the example
 * numbers from that brief (`temp,humidity,pressure`), so the parser is pinned
 * against the shape it was asked for rather than against a shape invented here.
 */
describe("parseSensorHeader", () => {
  it("reads the column names off a header line", () => {
    expect(parseSensorHeader("temp,humidity,pressure")).toEqual([
      "temp",
      "humidity",
      "pressure",
    ]);
    expect(parseSensorHeader(" temp , vlaga , pritisak ")).toEqual([
      "temp",
      "vlaga",
      "pritisak",
    ]);
    // A unit in the name is part of the name — this is what the sketch printed.
    expect(parseSensorHeader("t °C,h %,p hPa")).toEqual(["t °C", "h %", "p hPa"]);
  });

  it("refuses a data line as a header, which is how the two are told apart", () => {
    expect(parseSensorHeader("23.5,41,1009")).toBeNull();
    expect(parseSensorHeader("-12.5,0,1e3")).toBeNull();
    // One numeric field is enough to make the whole line not-a-header.
    expect(parseSensorHeader("temp,41,pressure")).toBeNull();
  });

  it("refuses an empty name, a repeated name and an over-long one", () => {
    expect(parseSensorHeader("temp,,pressure")).toBeNull();
    expect(parseSensorHeader("temp,humidity,temp")).toBeNull();
    expect(parseSensorHeader(`${"n".repeat(33)},humidity`)).toBeNull();
  });

  it("refuses a line with no fields at all", () => {
    // `"".split(",")` is one empty field, and an empty field is not a name.
    expect(parseSensorHeader("")).toBeNull();
  });
});

describe("parseSensorLine", () => {
  it("reads one line as the three values its header describes", () => {
    expect(parseSensorLine("23.5,41,1009", 3)).toEqual([23.5, 41, 1009]);
    expect(parseSensorLine(" -12.5 , 41.2 , 1009.75 ", 3)).toEqual([-12.5, 41.2, 1009.75]);
  });

  it("accepts the exponent form a sketch may print and refuses everything else", () => {
    expect(parseSensorLine("1e3,2E-1,0", 3)).toEqual([1000, 0.2, 0]);
    expect(parseSensorLine("nan,41,1009", 3)).toBeNull();
    expect(parseSensorLine("inf,41,1009", 3)).toBeNull();
    expect(parseSensorLine("0x10,41,1009", 3)).toBeNull();
    // The empty field is the one to be careful about: `Number("")` is 0, so a
    // parser built on `Number` alone reads a missing reading as a real zero.
    expect(parseSensorLine("23.5,,1009", 3)).toBeNull();
  });

  it("refuses a line whose field count is not the header's, in both directions", () => {
    expect(parseSensorLine("23.5,41", 3)).toBeNull();
    expect(parseSensorLine("23.5,41,1009,4", 3)).toBeNull();
    expect(parseSensorLine("temp,humidity,pressure", 3)).toBeNull();
  });

  it("refuses a column count that no header could have declared", () => {
    expect(parseSensorLine("23.5", 0)).toBeNull();
    expect(parseSensorLine("23.5", 13)).toBeNull();
  });
});

describe("formatSensorValue", () => {
  it("writes a machine-readable decimal with a point, whatever the interface's locale is", () => {
    expect(formatSensorValue(23.5)).toBe("23.5000");
    expect(formatSensorValue(-12.5)).toBe("-12.5000");
    expect(formatSensorValue(1009)).toBe("1009.0000");
    expect(formatSensorValue(0.000123)).toBe("0.0001");
  });

  it("refuses a value that is not a finite number rather than writing NaN into a file", () => {
    expect(() => formatSensorValue(Number.NaN)).toThrow(RangeError);
    expect(() => formatSensorValue(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("formatSensorCsv", () => {
  it("writes a header with the timestamp column, then one row per sample", () => {
    const csv = formatSensorCsv(
      ["temp", "humidity", "pressure"],
      [
        { at: "2026-10-10T08:00:00.000Z", values: [23.5, 41, 1009] },
        { at: "2026-10-10T08:00:01.000Z", values: [23.6, 41.1, 1008.5] },
      ],
    );
    expect(csv).toBe(
      "at,temp,humidity,pressure\r\n" +
        "2026-10-10T08:00:00.000Z,23.5000,41.0000,1009.0000\r\n" +
        "2026-10-10T08:00:01.000Z,23.6000,41.1000,1008.5000\r\n",
    );
  });

  it("quotes a column name that carries a comma or a quote", () => {
    const csv = formatSensorCsv(['temp, "vazduh"'], [{ at: "at-1", values: [1] }]);
    expect(csv).toBe('at,"temp, ""vazduh"""\r\nat-1,1.0000\r\n');
  });

  it("refuses a sample whose value count is not the log's", () => {
    expect(() =>
      formatSensorCsv(["a", "b"], [{ at: "at-1", values: [1] }]),
    ).toThrow(RangeError);
  });
});
