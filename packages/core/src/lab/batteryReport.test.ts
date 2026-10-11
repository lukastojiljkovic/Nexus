import { describe, expect, it } from "vitest";

import { batteryHealth, parseBatteryReport } from "./batteryReport.js";

/**
 * The fixture below is SYNTHETIC, and its shape is not: every element and
 * attribute name in it was read off a report this repository's machine produced
 * with `powercfg /batteryreport /output <file> /xml` on 2026-10-10 (Windows 11
 * build 26100), and the report is not committed because it carries a machine's
 * own identifiers. The numbers are chosen so the arithmetic a reader can check
 * is exact:
 *
 *   - two entries whose timestamps are 2 h 39 min 44 s apart, which is 9584 s;
 *   - the first one's `Duration` is 95 840 000 000, and 95 840 000 000 / 9584 =
 *     10 000 000 ticks a second — the .NET `TimeSpan` tick, so the conversion in
 *     `batteryReport.ts` is `ticks / 10 000` milliseconds and the fixture proves
 *     it instead of asserting it;
 *   - design 90 000 mWh and full charge 81 000 mWh, so health is 0.9 exactly.
 *
 * The root's default namespace is written as the real report writes it, and a
 * second case below uses a prefixed child to prove the reader matches local
 * names rather than a spelling of somebody's schema.
 */
const REPORT = `<?xml version="1.0" encoding="utf-8"?>
<?xml-stylesheet type='text/xsl' href='C:\\battery-stylesheet.xsl'?>
<BatteryReport xmlns="http://schemas.microsoft.com/battery/2012">
  <ReportInformation>
    <ReportGuid>00000000-0000-0000-0000-000000000000</ReportGuid>
    <ScanTime>2026-10-10T02:41:06Z</ScanTime>
    <ReportDuration>7</ReportDuration>
  </ReportInformation>
  <Batteries>
    <Battery>
      <Id>TESTPACK</Id>
      <ManufactureDate></ManufactureDate>
      <Chemistry>OTI0</Chemistry>
      <DesignCapacity>90000</DesignCapacity>
      <FullChargeCapacity>81000</FullChargeCapacity>
      <CycleCount>0</CycleCount>
    </Battery>
  </Batteries>
  <RuntimeEstimates>
    <DesignCapacity>
      <Capacity>90000</Capacity>
      <ActiveRuntime>PT6H38M47S</ActiveRuntime>
    </DesignCapacity>
  </RuntimeEstimates>
  <RecentUsage>
    <UsageEntry
      Timestamp="2026-10-04T20:14:16Z"
      LocalTimestamp="2026-10-04T22:14:16"
      Duration="95840000000"
      Ac="1"
      EntryType="Active"
      ChargeCapacity="66751"
      Discharge="0"
      FullChargeCapacity="81000"
      IsNextOnBattery="0"
      />
    <UsageEntry
      Timestamp="2026-10-04T22:54:00Z"
      LocalTimestamp="2026-10-05T00:54:00"
      Duration="36000000000"
      Ac="0"
      EntryType="Suspend"
      ChargeCapacity="50000"
      Discharge="1200"
      FullChargeCapacity="81000"
      IsNextOnBattery="1"
      />
  </RecentUsage>
</BatteryReport>`;

describe("parseBatteryReport", () => {
  it("reads the scan time, the pack's capacities and its cycle count", () => {
    const report = parseBatteryReport(REPORT);
    expect(report.scannedAt).toBe("2026-10-10T02:41:06Z");
    expect(report.batteries).toEqual([
      {
        id: "TESTPACK",
        designCapacityMWh: 90_000,
        fullChargeCapacityMWh: 81_000,
        // `0` is a real answer and must not arrive as `null`: a pack with no
        // recorded cycles reports zero, and the page says "0" rather than "—".
        cycleCount: 0,
      },
    ]);
  });

  it("converts `Duration` from the report's 100-nanosecond ticks, which the timestamps prove", () => {
    const report = parseBatteryReport(REPORT);
    const [first, second] = report.recentUsage;
    expect(first?.durationMs).toBe(9_584_000);
    expect(second?.durationMs).toBe(3_600_000);
    // The proof, stated as arithmetic rather than trust: the two entries start
    // 9584 seconds apart and the first one's duration IS 9584 seconds, so a tick
    // is 100 ns and nothing else fits.
    const gapSeconds =
      (Date.parse(second?.at ?? "") - Date.parse(first?.at ?? "")) / 1000;
    expect(gapSeconds).toBe(9_584);
    expect((first?.durationMs ?? 0) / 1000).toBe(gapSeconds);
  });

  it("reads the usage entries' flags and capacities", () => {
    const report = parseBatteryReport(REPORT);
    expect(report.recentUsage.map((entry) => entry.entryType)).toEqual(["Active", "Suspend"]);
    expect(report.recentUsage.map((entry) => entry.ac)).toEqual([true, false]);
    expect(report.recentUsage[0]?.chargeCapacityMWh).toBe(66_751);
    expect(report.recentUsage[1]?.dischargeMWh).toBe(1_200);
  });

  it("matches local names, so a namespace prefix on a child element changes nothing", () => {
    const prefixed = REPORT.replace("<DesignCapacity>90000</DesignCapacity>", "<b:DesignCapacity>90000</b:DesignCapacity>");
    expect(parseBatteryReport(prefixed).batteries[0]?.designCapacityMWh).toBe(90_000);
  });

  it("reads a desktop's report — no battery, no usage — as an empty answer, not an error", () => {
    const desktop = `<?xml version="1.0" encoding="utf-8"?>
<BatteryReport xmlns="http://schemas.microsoft.com/battery/2012">
  <ReportInformation>
    <ScanTime>2026-10-10T02:41:06Z</ScanTime>
  </ReportInformation>
</BatteryReport>`;
    expect(parseBatteryReport(desktop)).toEqual({
      scannedAt: "2026-10-10T02:41:06Z",
      batteries: [],
      recentUsage: [],
    });
  });

  it("decodes the character references a document may carry", () => {
    const escaped = REPORT.replace("<Id>TESTPACK</Id>", "<Id>A&amp;B</Id>");
    expect(parseBatteryReport(escaped).batteries[0]?.id).toBe("A&B");
  });

  it("refuses a document it cannot read rather than reporting part of one", () => {
    expect(() => parseBatteryReport("<NotABatteryReport/>")).toThrow(/BatteryReport/);
    expect(() => parseBatteryReport("<BatteryReport><Batteries>")).toThrow();
    expect(() => parseBatteryReport("<BatteryReport><Batteries></BatteryReport>")).toThrow();
    expect(() => parseBatteryReport("")).toThrow();
    expect(() => parseBatteryReport("<BatteryReport/><BatteryReport/>")).toThrow();
    // A number the report states that is not a number is a refusal, not a zero.
    expect(() =>
      parseBatteryReport(REPORT.replace("<CycleCount>0</CycleCount>", "<CycleCount>many</CycleCount>")),
    ).toThrow();
  });
});

describe("batteryHealth", () => {
  it("is the report's own full ÷ design ratio", () => {
    expect(
      batteryHealth({
        id: null,
        designCapacityMWh: 90_000,
        fullChargeCapacityMWh: 81_000,
        cycleCount: null,
      }),
    ).toBe(0.9);
    // A pack whose firmware reports a full charge above its design capacity is
    // reported as it is rather than clamped to a reassuring 100 %.
    expect(
      batteryHealth({
        id: null,
        designCapacityMWh: 40_000,
        fullChargeCapacityMWh: 42_000,
        cycleCount: null,
      }),
    ).toBe(1.05);
  });

  it("is null when there is nothing to divide by", () => {
    expect(
      batteryHealth({ id: null, designCapacityMWh: null, fullChargeCapacityMWh: 81_000, cycleCount: null }),
    ).toBeNull();
    expect(
      batteryHealth({ id: null, designCapacityMWh: 0, fullChargeCapacityMWh: 81_000, cycleCount: null }),
    ).toBeNull();
  });
});
