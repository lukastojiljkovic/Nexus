import { describe, expect, it } from "vitest";

import {
  convertRate,
  normaliseMac,
  raidCapacity,
  transferTime,
  uptimeDowntime,
  vlsmSplit,
} from "./it.js";

/**
 * The IT toolkit, against numbers worked out by hand.
 *
 * The decimal/binary distinction is the subject of half of these cases: 5 GB and
 * 5 GiB are 4 882,8… MiB apart, and a test that could not tell them apart would
 * be testing nothing.
 */

describe("transferTime", () => {
  it("takes the size in bits and the rate per second", () => {
    // 5 GB = 5·10⁹ B = 4·10¹⁰ bit; at 100 Mbit/s = 10⁸ bit/s → 400 s = 6 min 40 s
    const result = transferTime({
      size: 5,
      sizeUnit: "GB",
      rate: 100,
      rateUnit: "MbitPerSecond",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sizeBits).toBeCloseTo(4e10, 0);
    expect(result.rateBitsPerSecond).toBeCloseTo(1e8, 0);
    expect(result.totalSeconds).toBeCloseTo(400, 9);
    expect(result.minutes).toBe(6);
    expect(result.seconds).toBeCloseTo(40, 9);
    expect(result.days).toBe(0);
    expect(result.hours).toBe(0);
  });

  it("cancels the factor of eight between a binary size and a binary rate", () => {
    // 700 MiB at 10 MiB/s → 70 s, whatever the byte is worth
    const result = transferTime({
      size: 700,
      sizeUnit: "MiB",
      rate: 10,
      rateUnit: "MiBPerSecond",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalSeconds).toBeCloseTo(70, 9);
  });

  it("applies the overhead to the payload, not to the link", () => {
    const result = transferTime({
      size: 700,
      sizeUnit: "MiB",
      rate: 10,
      rateUnit: "MiBPerSecond",
      overheadPercent: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effectiveBits).toBeCloseTo((700 * 8 * 1024 ** 2 * 1.1), 0);
    expect(result.totalSeconds).toBeCloseTo(77, 9);
  });

  it("keeps GB and GiB apart", () => {
    // 1 GiB = 8·2³⁰ bit = 8589934592 bit; at 100 Mbit/s → 85,89934592 s
    const result = transferTime({
      size: 1,
      sizeUnit: "GiB",
      rate: 100,
      rateUnit: "MbitPerSecond",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sizeBits).toBeCloseTo(8589934592, 0);
    expect(result.totalSeconds).toBeCloseTo(85.89934592, 6);
    expect(result.minutes).toBe(1);
    expect(result.seconds).toBeCloseTo(25.89934592, 6);
  });

  it("refuses an empty size or rate rather than dividing by nothing", () => {
    const base = { size: 1, sizeUnit: "GB" as const, rate: 100, rateUnit: "MbitPerSecond" as const };
    expect(transferTime({ ...base, size: Number.NaN }).ok).toBe(false);
    expect(transferTime({ ...base, rate: 0 }).ok).toBe(false);
    expect(transferTime({ ...base, overheadPercent: -1 }).ok).toBe(false);
  });
});

describe("convertRate", () => {
  it("turns a line rate into bytes per second", () => {
    // 100 Mbit/s ÷ 8 = 12500000 B/s = 12,5 MB/s
    const result = convertRate({ value: 100, unit: "MbitPerSecond" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bitsPerSecond).toBeCloseTo(1e8, 0);
    expect(result.bytesPerSecond).toBeCloseTo(12_500_000, 0);
    expect(result.perUnit.MBPerSecond).toBeCloseTo(12.5, 9);
    // …and the same line in the binary unit, which is the number a download shows.
    expect(result.perUnit.MiBPerSecond).toBeCloseTo(11.920928955078125, 9);
  });

  it("keeps the binary prefixes binary", () => {
    const result = convertRate({ value: 1, unit: "MiBPerSecond" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bitsPerSecond).toBeCloseTo(8_388_608, 6);
    expect(result.perUnit.MbitPerSecond).toBeCloseTo(8.388608, 9);
  });

  it("refuses a negative rate", () => {
    expect(convertRate({ value: -1, unit: "MbitPerSecond" }).ok).toBe(false);
  });
});

describe("raidCapacity", () => {
  it("leaves three quarters of a four-disk RAID 5", () => {
    // usable = (4−1)·4·10¹² = 1,2·10¹³ B; raw = 1,6·10¹³ B; efficiency 75 %
    const result = raidCapacity({
      level: "5",
      diskCount: 4,
      diskSize: 4,
      diskSizeUnit: "TB",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usableBytes).toBeCloseTo(1.2e13, 0);
    expect(result.rawBytes).toBeCloseTo(1.6e13, 0);
    expect(result.efficiencyPercent).toBeCloseTo(75, 9);
    expect(result.toleratedFailures).toBe(1);
    expect(result.redundancyDisks).toBe(1);
    // 1,2·10¹³ / 2⁴⁰ = 10,91394 TiB
    expect(result.usableTiB).toBeCloseTo(10.91394, 4);
  });

  it("gives RAID 6 two disks of tolerance", () => {
    const result = raidCapacity({ level: "6", diskCount: 6, diskSize: 2, diskSizeUnit: "TB" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usableBytes).toBeCloseTo(8e12, 0);
    expect(result.toleratedFailures).toBe(2);
    expect(result.efficiencyPercent).toBeCloseTo(200 / 3, 9);
  });

  it("halves a mirrored stripe", () => {
    const result = raidCapacity({ level: "10", diskCount: 4, diskSize: 1, diskSizeUnit: "TB" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usableBytes).toBeCloseTo(2e12, 0);
    expect(result.efficiencyPercent).toBeCloseTo(50, 9);
    expect(result.toleratedFailures).toBe(1);
  });

  it("gives a stripe everything and tolerates nothing", () => {
    const result = raidCapacity({ level: "0", diskCount: 2, diskSize: 500, diskSizeUnit: "GB" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usableBytes).toBeCloseTo(1e12, 0);
    expect(result.efficiencyPercent).toBeCloseTo(100, 9);
    expect(result.toleratedFailures).toBe(0);
    expect(result.redundancyDisks).toBe(0);
  });

  it("counts a rebuild from the usable capacity and a measured rate", () => {
    // 1,2·10¹³ B ÷ 200 MB/s (2·10⁸ B/s) = 60000 s
    const result = raidCapacity({
      level: "5",
      diskCount: 4,
      diskSize: 4,
      diskSizeUnit: "TB",
      rebuildRateMbps: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rebuildSeconds).toBeCloseTo(60000, 6);
  });

  it("refuses a level with too few disks, an odd mirror set and a bad level", () => {
    expect(raidCapacity({ level: "5", diskCount: 2, diskSize: 1, diskSizeUnit: "TB" }).ok).toBe(
      false,
    );
    expect(raidCapacity({ level: "1", diskCount: 4, diskSize: 1, diskSizeUnit: "TB" }).ok).toBe(
      false,
    );
    expect(raidCapacity({ level: "10", diskCount: 5, diskSize: 1, diskSizeUnit: "TB" }).ok).toBe(
      false,
    );
    expect(
      raidCapacity({
        level: "7" as unknown as "5",
        diskCount: 4,
        diskSize: 1,
        diskSizeUnit: "TB",
      }).ok,
    ).toBe(false);
  });
});

describe("uptimeDowntime", () => {
  it("gives three nines forty-three minutes a month", () => {
    // 30-day month = 43200 min; 0,1 % = 43,2 min; 365-day year = 525600 min → 525,6
    const result = uptimeDowntime({ mode: "fromUptime", uptimePercent: 99.9 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nines).toBeCloseTo(3, 9);
    expect(result.unavailablePercent).toBeCloseTo(0.1, 9);
    expect(result.downtimeMinutesPerMonth).toBeCloseTo(43.2, 9);
    expect(result.downtimeMinutesPerYear).toBeCloseTo(525.6, 9);
    expect(result.downtimeMinutesPerDay).toBeCloseTo(1.44, 9);
    expect(result.downtimeSecondsPerMonth).toBeCloseTo(2592, 6);
  });

  it("gives four nines fifty-two minutes a year", () => {
    const result = uptimeDowntime({ mode: "fromUptime", uptimePercent: 99.99 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nines).toBeCloseTo(4, 9);
    expect(result.downtimeMinutesPerYear).toBeCloseTo(52.56, 9);
  });

  it("reads availability back from a month's downtime", () => {
    const result = uptimeDowntime({ mode: "fromMonthlyDowntime", monthlyDowntimeMinutes: 43.2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uptimePercent).toBeCloseTo(99.9, 9);
    expect(result.nines).toBeCloseTo(3, 9);
  });

  it("refuses a perfect service, which has no downtime figure and no nines", () => {
    expect(uptimeDowntime({ mode: "fromUptime", uptimePercent: 100 }).ok).toBe(false);
    expect(uptimeDowntime({ mode: "fromUptime", uptimePercent: 100.5 }).ok).toBe(false);
    expect(uptimeDowntime({ mode: "fromMonthlyDowntime", monthlyDowntimeMinutes: 0 }).ok).toBe(
      false,
    );
  });
});

describe("vlsmSplit", () => {
  it("places the largest request first and reports the leftover", () => {
    const result = vlsmSplit({
      baseAddress: "192.168.10.0",
      prefix: 24,
      hostCounts: [20, 100, 50],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseNetwork).toBe("192.168.10.0");
    expect(result.baseBroadcast).toBe("192.168.10.255");
    expect(result.blocks.map((block) => block.prefix)).toEqual([25, 26, 27]);
    expect(result.blocks.map((block) => block.network)).toEqual([
      "192.168.10.0",
      "192.168.10.128",
      "192.168.10.192",
    ]);
    expect(result.blocks[0]?.firstHost).toBe("192.168.10.1");
    expect(result.blocks[0]?.lastHost).toBe("192.168.10.126");
    expect(result.blocks[0]?.usableHosts).toBe(126);
    expect(result.blocks[2]?.broadcast).toBe("192.168.10.223");
    expect(result.freeAddresses).toBe(32);
  });

  it("masks the base address to its network", () => {
    const result = vlsmSplit({ baseAddress: "10.0.0.5", prefix: 8, hostCounts: [1000] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseNetwork).toBe("10.0.0.0");
    expect(result.blocks[0]?.prefix).toBe(22);
    expect(result.blocks[0]?.network).toBe("10.0.0.0");
    expect(result.blocks[0]?.usableHosts).toBe(1022);
  });

  it("rounds a request up to the next power of two", () => {
    // 1 host needs a /30 (2 usable), 2 needs a /30, 3 needs a /29 (6 usable)
    const result = vlsmSplit({ baseAddress: "172.16.0.0", prefix: 28, hostCounts: [3, 1] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks.map((block) => block.prefix)).toEqual([29, 30]);
    expect(result.blocks.map((block) => block.usableHosts)).toEqual([6, 2]);
  });

  it("refuses requests that do not fit instead of truncating them", () => {
    const result = vlsmSplit({ baseAddress: "192.168.0.0", prefix: 24, hostCounts: [200, 200] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("doesNotFit");
  });

  it("refuses a bad address, a /31 base and an empty list", () => {
    expect(vlsmSplit({ baseAddress: "192.168.0.256", prefix: 24, hostCounts: [10] }).ok).toBe(
      false,
    );
    expect(vlsmSplit({ baseAddress: "192.168.0.0", prefix: 31, hostCounts: [1] }).ok).toBe(false);
    expect(vlsmSplit({ baseAddress: "192.168.0.0", prefix: 24, hostCounts: [] }).ok).toBe(false);
    expect(vlsmSplit({ baseAddress: "192.168.0.0", prefix: 24, hostCounts: [0] }).ok).toBe(false);
  });
});

describe("normaliseMac", () => {
  it("writes one address in every notation", () => {
    const result = normaliseMac({ address: "aa:bb:cc:dd:ee:ff" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.octets).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    expect(result.colon).toBe("AA:BB:CC:DD:EE:FF");
    expect(result.dash).toBe("AA-BB-CC-DD-EE-FF");
    expect(result.dotted).toBe("AABB.CCDD.EEFF");
    expect(result.bare).toBe("AABBCCDDEEFF");
    expect(result.oui).toBe("AA:BB:CC");
  });

  it("reads the two bits the first octet carries", () => {
    // 0xAA = 1010 1010: I/G clear (unicast), U/L set (administered locally)
    const unicast = normaliseMac({ address: "AA:BB:CC:DD:EE:FF" });
    expect(unicast.ok).toBe(true);
    if (!unicast.ok) return;
    expect(unicast.multicast).toBe(false);
    expect(unicast.locallyAdministered).toBe(true);
    // 0x01 = 0000 0001: I/G set — every multicast group address ends this way
    const group = normaliseMac({ address: "01:00:5e:00:00:01" });
    expect(group.ok).toBe(true);
    if (!group.ok) return;
    expect(group.multicast).toBe(true);
    expect(group.locallyAdministered).toBe(false);
  });

  it("accepts the dotted and the bare spellings, and mixed separators", () => {
    for (const address of ["aabb.ccdd.eeff", "AABBCCDDEEFF", "aa-bb:cc.dd ee ff"]) {
      const result = normaliseMac({ address });
      expect(result.ok, address).toBe(true);
      if (result.ok) expect(result.colon, address).toBe("AA:BB:CC:DD:EE:FF");
    }
  });

  it("refuses anything that is not six bytes of hex", () => {
    for (const address of ["", "aabbccddee", "aa:bb:cc:dd:ee", "gg:bb:cc:dd:ee:ff"]) {
      expect(normaliseMac({ address }).ok, address).toBe(false);
    }
  });
});
