import { describe, expect, it } from "vitest";

import { BATTERY_REPORT_FLAGS, BATTERY_REPORT_FORMAT, POWERCFG_PROGRAM, batteryReportArgv } from "./powercfg.js";

/**
 * The command line is DEV-007's subject, so these assertions are about its SHAPE
 * rather than about the string it happens to be today: the program is the first
 * element, the flags come in the order `/output` requires, and the only thing a
 * caller contributes is the path — no element of the argv is ever assembled from
 * data, which is the property the spawn site depends on.
 */
describe("batteryReportArgv", () => {
  it("puts the program first, the path where /output expects it, and the format last", () => {
    const argv = batteryReportArgv("C:\\Temp\\nexus-battery\\report.xml");
    expect(argv).toEqual([
      POWERCFG_PROGRAM,
      ...BATTERY_REPORT_FLAGS,
      "C:\\Temp\\nexus-battery\\report.xml",
      BATTERY_REPORT_FORMAT,
    ]);
    // Stated again as positions, because the order IS the contract with the tool.
    expect(argv[0]).toBe("powercfg.exe");
    expect(argv[1]).toBe("/batteryreport");
    expect(argv[2]).toBe("/output");
    expect(argv[3]).toBe("C:\\Temp\\nexus-battery\\report.xml");
    expect(argv[4]).toBe("/xml");
    expect(argv).toHaveLength(5);
  });

  it("accepts a UNC path, which is the other shape an absolute path has here", () => {
    expect(batteryReportArgv("\\\\server\\share\\report.xml")[3]).toBe(
      "\\\\server\\share\\report.xml",
    );
  });

  it("refuses a relative path rather than resolving it against the app's own directory", () => {
    expect(() => batteryReportArgv("report.xml")).toThrow(/absolute/);
    expect(() => batteryReportArgv(".\\report.xml")).toThrow(/absolute/);
    expect(() => batteryReportArgv("C:report.xml")).toThrow(/absolute/);
  });

  it("refuses a path carrying a NUL or a line break", () => {
    expect(() => batteryReportArgv("C:\\Temp\\a\u0000b.xml")).toThrow(/NUL/);
    expect(() => batteryReportArgv("C:\\Temp\\a\nb.xml")).toThrow(/NUL/);
  });
});
