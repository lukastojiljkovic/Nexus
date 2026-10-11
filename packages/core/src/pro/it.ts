/**
 * „IT" — the arithmetic behind the IT toolkit: networks, storage and service.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains.
 * These are the everyday infrastructure figures — how long a copy takes, what a
 * RAID array leaves usable, how a rate converts, what a percentage of uptime
 * costs in minutes, how a block of addresses is carved up, and what a MAC
 * address says about itself.
 *
 * **Three tools that would have lived here already exist and are deliberately
 * absent.** `devtools/cidr` (the `softver` pack) is a full IPv4/IPv6 subnet
 * calculator — network, broadcast, host range, wildcard, CIDR ↔ mask and prefix
 * breakdown, for both families. `devtools/data-unit` converts storage sizes
 * across kB…PB and KiB…PiB and is the app's statement that kB is not KiB.
 * `devtools/number-base` and `devtools/hexdump` cover what a MAC address's
 * octets are; what is added here is the ADDRESS reading (notation, OUI,
 * multicast and locally-administered bits), which none of them does.
 *
 * **Decimal and binary are kept apart, and never by a factor that hides the
 * difference.** Every size and rate unit here is named for what it is: `kB` is
 * 10³ bytes, `KiB` is 2¹⁰, and the conversion table prints both. Mixing them is
 * the classic 4 % disk-size dispute, and a tool that silently picked one would
 * be reproducing the bug it exists to prevent.
 *
 * None of these tools is allowed to make a judgement. `raidCapacity` says how
 * much survives how many disk failures — which failure the array can tolerate
 * is the arithmetic's own statement, and whether that redundancy is enough for a
 * given service is the operator's call.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isKeyOf,
  isOneOf,
  quotient,
  type ProResult,
} from "./result.js";

/** Decimal and binary prefixes, spelled as IEC 80000-13 and the SI define them. */
const KILO = 1000;
const KIBI = 1024;

/** Bits in a byte — the one factor that separates a rate from a size. */
const BITS_PER_BYTE = 8;

/* -------------------------------------------------------------------------- */
/* transfer-time — vreme prenosa                                                */
/* -------------------------------------------------------------------------- */

/**
 * A size, in bits, per unit. The decimal units are powers of ten and the binary
 * ones are powers of two: `MB` and `MiB` differ by 4,86 % at that scale, and the
 * whole point of carrying both is that the difference is visible.
 */
export const DATA_UNITS = [
  "bit",
  "kbit",
  "Mbit",
  "Gbit",
  "Tbit",
  "B",
  "kB",
  "MB",
  "GB",
  "TB",
  "KiB",
  "MiB",
  "GiB",
  "TiB",
] as const;

export type DataUnit = (typeof DATA_UNITS)[number];

const DATA_UNIT_BITS: Readonly<Record<DataUnit, number>> = {
  bit: 1,
  kbit: KILO,
  Mbit: KILO ** 2,
  Gbit: KILO ** 3,
  Tbit: KILO ** 4,
  B: BITS_PER_BYTE,
  kB: BITS_PER_BYTE * KILO,
  MB: BITS_PER_BYTE * KILO ** 2,
  GB: BITS_PER_BYTE * KILO ** 3,
  TB: BITS_PER_BYTE * KILO ** 4,
  KiB: BITS_PER_BYTE * KIBI,
  MiB: BITS_PER_BYTE * KIBI ** 2,
  GiB: BITS_PER_BYTE * KIBI ** 3,
  TiB: BITS_PER_BYTE * KIBI ** 4,
};

/** The rate units, all per second. Decimal for the network names, binary where the name says so. */
export const RATE_UNITS = [
  "bitPerSecond",
  "kbitPerSecond",
  "MbitPerSecond",
  "GbitPerSecond",
  "bytePerSecond",
  "kBPerSecond",
  "MBPerSecond",
  "GBPerSecond",
  "KiBPerSecond",
  "MiBPerSecond",
  "GiBPerSecond",
] as const;

export type RateUnit = (typeof RATE_UNITS)[number];

const RATE_UNIT_BITS: Readonly<Record<RateUnit, number>> = {
  bitPerSecond: 1,
  kbitPerSecond: KILO,
  MbitPerSecond: KILO ** 2,
  GbitPerSecond: KILO ** 3,
  bytePerSecond: BITS_PER_BYTE,
  kBPerSecond: BITS_PER_BYTE * KILO,
  MBPerSecond: BITS_PER_BYTE * KILO ** 2,
  GBPerSecond: BITS_PER_BYTE * KILO ** 3,
  KiBPerSecond: BITS_PER_BYTE * KIBI,
  MiBPerSecond: BITS_PER_BYTE * KIBI ** 2,
  GiBPerSecond: BITS_PER_BYTE * KIBI ** 3,
};

export interface TransferTimeInput {
  readonly size: number;
  readonly sizeUnit: DataUnit;
  readonly rate: number;
  readonly rateUnit: RateUnit;
  /** Protocol and framing overhead, % of the payload. Absent means 0 and the surface says so. */
  readonly overheadPercent?: number | undefined;
}

export interface TransferTimeResult {
  readonly sizeBits: number;
  readonly rateBitsPerSecond: number;
  readonly overheadPercentUsed: number;
  /** Payload plus overhead, in bits and in bytes. */
  readonly effectiveBits: number;
  readonly effectiveBytes: number;
  readonly totalSeconds: number;
  /** Whole days, hours, minutes and the fractional seconds left over. */
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

/**
 * How long a payload takes at a rate: `t = size/rate`.
 *
 * The size is converted to bits and the rate to bits per second, so `8` appears
 * exactly once and only when a byte-denominated unit meets a bit-denominated
 * one — writing the factor in by hand at the call site is where a factor of 8
 * goes missing. The overhead is applied to the PAYLOAD before the division,
 * which is what an overhead percentage means: it is more data to move, not a
 * slower link.
 *
 * The result is the ideal, and the surface says so: real transfers add per-packet
 * gaps, acknowledgement traffic and ramp-up, so a line-rate figure is a floor.
 */
export function transferTime(input: TransferTimeInput): ProResult<TransferTimeResult> {
  const { size, sizeUnit: sizeUnitInput, rate, rateUnit: rateUnitInput } = input;
  if (!isKeyOf(sizeUnitInput, DATA_UNIT_BITS)) return fail("sizeUnit");
  if (!isKeyOf(rateUnitInput, RATE_UNIT_BITS)) return fail("rateUnit");
  if (!isInRange(size, 0, 1e15)) return fail("size");
  if (!isInRange(rate, 0.000001, 1e15)) return fail("rate");
  const overhead = input.overheadPercent ?? 0;
  if (!isInRange(overhead, 0, 10000)) return fail("overhead");

  const sizeBits = size * DATA_UNIT_BITS[sizeUnitInput];
  const rateBitsPerSecond = rate * RATE_UNIT_BITS[rateUnitInput];
  const effectiveBits = sizeBits * (1 + overhead / 100);
  const totalSeconds = quotient(effectiveBits, rateBitsPerSecond);
  if (totalSeconds === undefined) return fail("rate");

  const days = Math.floor(totalSeconds / 86400);
  const afterDays = totalSeconds - days * 86400;
  const hours = Math.floor(afterDays / 3600);
  const afterHours = afterDays - hours * 3600;
  const minutes = Math.floor(afterHours / 60);
  return {
    ok: true,
    sizeBits,
    rateBitsPerSecond,
    overheadPercentUsed: overhead,
    effectiveBits,
    effectiveBytes: effectiveBits / BITS_PER_BYTE,
    totalSeconds,
    days,
    hours,
    minutes,
    seconds: afterHours - minutes * 60,
  };
}

/* -------------------------------------------------------------------------- */
/* bandwidth-units — brzina prenosa                                             */
/* -------------------------------------------------------------------------- */

export interface RateConversionInput {
  readonly value: number;
  readonly unit: RateUnit;
}

export interface RateConversionResult {
  readonly bitsPerSecond: number;
  readonly bytesPerSecond: number;
  /** The same rate in every unit the tool offers — see `transferTime` for the table. */
  readonly perUnit: Readonly<Record<RateUnit, number>>;
}

/**
 * A transfer rate, in every unit.
 *
 * `1 B/s = 8 bit/s` and nothing else: the prefixes are the IEC/SI ones, so
 * `1 MiB/s = 8,388608 Mbit/s`, which is the number that makes „I have a 100 Mbit
 * line, why is my download 11 MB/s" a question with an answer. `perUnit` is
 * keyed by the same union the surface labels, so a unit can never be added
 * without acquiring a name.
 */
export function convertRate(input: RateConversionInput): ProResult<RateConversionResult> {
  if (!isKeyOf(input.unit, RATE_UNIT_BITS)) return fail("unit");
  if (!isInRange(input.value, 0, 1e15)) return fail("value");
  const bitsPerSecond = input.value * RATE_UNIT_BITS[input.unit];
  const perUnit = {} as Record<RateUnit, number>;
  for (const unit of RATE_UNITS) perUnit[unit] = bitsPerSecond / RATE_UNIT_BITS[unit];
  return {
    ok: true,
    bitsPerSecond,
    bytesPerSecond: bitsPerSecond / BITS_PER_BYTE,
    perUnit,
  };
}

/* -------------------------------------------------------------------------- */
/* raid-capacity — RAID kapacitet                                               */
/* -------------------------------------------------------------------------- */

export const RAID_LEVELS = ["0", "1", "5", "6", "10"] as const;

export type RaidLevel = (typeof RAID_LEVELS)[number];

/** The size units a disk is sold in. Decimal TB is what the label says; TiB is what the OS reports. */
export const DISK_SIZE_UNITS = ["GB", "TB", "TiB"] as const;

export type DiskSizeUnit = (typeof DISK_SIZE_UNITS)[number];

const DISK_UNIT_BYTES: Readonly<Record<DiskSizeUnit, number>> = {
  GB: KILO ** 3,
  TB: KILO ** 4,
  TiB: KIBI ** 4,
};

export interface RaidInput {
  readonly level: RaidLevel;
  /** Data disks, not counting any hot spare. */
  readonly diskCount: number;
  readonly diskSize: number;
  readonly diskSizeUnit: DiskSizeUnit;
  /** Disks kept as spares, outside the array's capacity and parity. */
  readonly hotSpares?: number | undefined;
  /** Measured rebuild rate, MB/s (decimal) — switches the rebuild-time row on. */
  readonly rebuildRateMbps?: number | undefined;
}

export interface RaidResult {
  readonly level: RaidLevel;
  readonly dataDisks: number;
  readonly hotSpares: number;
  /** Disks given up to redundancy — parity in 5 and 6, mirror copies in 1 and 10. */
  readonly redundancyDisks: number;
  /** Whole disks that may fail before data is lost. */
  readonly toleratedFailures: number;
  readonly minimumDisks: number;
  readonly rawBytes: number;
  readonly usableBytes: number;
  /** Usable over raw, %. */
  readonly efficiencyPercent: number;
  /** Usable bytes as the operating system would report them, TiB. */
  readonly usableTiB: number;
  /** `usableBytes/rate`, seconds. Undefined without a measured rebuild rate. */
  readonly rebuildSeconds: number | undefined;
  /** The same time in hours, so a surface need not divide to print it. */
  readonly rebuildHours: number | undefined;
}

/** Whole data disks each level needs at a minimum, and what it gives up for redundancy. */
const RAID_MINIMUM: Readonly<Record<RaidLevel, number>> = { "0": 2, "1": 2, "5": 3, "6": 4, "10": 4 };

/**
 * Usable capacity and fault tolerance of the five ordinary RAID levels.
 *
 * - **0** — striping: `N·C`, no redundancy at all. Two disks are the minimum and
 *   either one failing loses everything, which the result says by carrying
 *   `toleratedFailures: 0` rather than by leaving a row out.
 * - **1** — mirroring: one disk's capacity, one disk may fail. This tool defines
 *   RAID 1 as exactly two disks; more than one mirror pair is what RAID 10 is
 *   for, and blurring the two would make the tolerance figure a guess.
 * - **5** — `(N−1)·C`, one parity disk, any one may fail.
 * - **6** — `(N−2)·C`, two independent parity disks, any two may fail.
 * - **10** — mirrored stripes: `N/2·C`, and each mirror may lose one disk. The
 *   guaranteed tolerance is ONE disk, because two failures in the same mirror
 *   take the array down; the surface states that rather than promising two.
 *
 * Capacity is `C·usable-disks` in bytes and is deliberately NOT reduced by the
 * filesystem's own overhead, which this tool cannot see. The TiB row is the same
 * capacity expressed the way an operating system reports it — the number that
 * makes a 4 TB array read as 3,64 TiB.
 */
export function raidCapacity(input: RaidInput): ProResult<RaidResult> {
  const { level, diskCount, diskSize, diskSizeUnit: unit } = input;
  if (!isOneOf(level, RAID_LEVELS)) return fail("level");
  if (!isKeyOf(unit, DISK_UNIT_BYTES)) return fail("diskSizeUnit");
  if (!isIntegerIn(diskCount, 2, 240)) return fail("diskCount");
  if (!isInRange(diskSize, 0.001, 1e6)) return fail("diskSize");
  const hotSpares = input.hotSpares ?? 0;
  if (!isIntegerIn(hotSpares, 0, 100)) return fail("hotSpares");
  if (input.rebuildRateMbps !== undefined && !isInRange(input.rebuildRateMbps, 0.001, 1e6)) {
    return fail("rebuildRate");
  }
  const minimum = RAID_MINIMUM[level];
  if (diskCount < minimum) return fail("diskCount");
  if (level === "10" && diskCount % 2 !== 0) return fail("diskCountEven");
  if (level === "1" && diskCount !== 2) return fail("diskCountTwo");

  const usableDisks =
    level === "0" ? diskCount : level === "1" ? 1 : level === "5" ? diskCount - 1 : level === "6" ? diskCount - 2 : diskCount / 2;
  const redundancyDisks =
    level === "0" ? 0 : level === "1" ? 1 : level === "5" ? 1 : level === "6" ? 2 : diskCount / 2;
  const toleratedFailures = level === "6" ? 2 : level === "0" ? 0 : 1;
  const diskBytes = diskSize * DISK_UNIT_BYTES[unit];
  const rawBytes = diskCount * diskBytes;
  const usableBytes = usableDisks * diskBytes;
  const rebuildRate = input.rebuildRateMbps;
  // MB/s here is the decimal megabyte a vendor's rebuild counter is quoted in.
  const rebuildSeconds =
    rebuildRate === undefined ? undefined : usableBytes / (rebuildRate * KILO ** 2);

  return {
    ok: true,
    level,
    dataDisks: diskCount,
    hotSpares,
    redundancyDisks,
    toleratedFailures,
    minimumDisks: minimum,
    rawBytes,
    usableBytes,
    efficiencyPercent: quotient(100 * usableBytes, rawBytes) ?? 0,
    usableTiB: usableBytes / KIBI ** 4,
    rebuildSeconds,
    rebuildHours: rebuildSeconds === undefined ? undefined : rebuildSeconds / 3600,
  };
}

/* -------------------------------------------------------------------------- */
/* uptime-downtime — dostupnost sistema                                         */
/* -------------------------------------------------------------------------- */

export type UptimeMode = "fromUptime" | "fromMonthlyDowntime";

/**
 * The two period lengths the arithmetic is stated in, and the only convention in
 * this tool: a year is 365 days and a month is 30 days. Service-level agreements
 * use either calendar months or a fixed 30-day month, and the surface names the
 * one it used so the user can tell which figure they are reading.
 */
const MINUTES_PER_DAY = 1440;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
const MINUTES_PER_MONTH = DAYS_PER_MONTH * MINUTES_PER_DAY;
const MINUTES_PER_YEAR = DAYS_PER_YEAR * MINUTES_PER_DAY;

export interface UptimeInput {
  readonly mode: UptimeMode;
  /** Availability, %. Below 100, always — a perfectly available service has no downtime row. */
  readonly uptimePercent?: number | undefined;
  /** Downtime in the reference month, minutes. */
  readonly monthlyDowntimeMinutes?: number | undefined;
}

export interface UptimeResult {
  readonly uptimePercent: number;
  /** `100 − availability`, in the same unit the availability is spoken in. */
  readonly unavailablePercent: number;
  /** The count of nines, `−log₁₀(1 − u)`. 4 for 99,99 %. */
  readonly nines: number;
  readonly downtimeMinutesPerYear: number;
  readonly downtimeMinutesPerMonth: number;
  readonly downtimeMinutesPerWeek: number;
  readonly downtimeMinutesPerDay: number;
  readonly downtimeSecondsPerMonth: number;
}

/**
 * Availability and the downtime it allows, in both directions.
 *
 * `downtime = (1 − u)·period`, and the period lengths are the convention above.
 * „Nines" is `−log₁₀(1 − u)`, which is why 99,9 % is three nines and 99,99 % is
 * four — the count is reported as a fraction, so 99,95 % reads as 3,30 and the
 * user sees the gap three nines and four nines leave rather than a rounded label
 * that hides it.
 *
 * Uptime of exactly 100 % is refused: it has no downtime figure and no nines,
 * and returning an infinity would look like a very good answer instead of an
 * unanswerable question.
 */
export function uptimeDowntime(input: UptimeInput): ProResult<UptimeResult> {
  let uptimePercent: number;
  if (input.mode === "fromUptime") {
    const u = input.uptimePercent;
    if (!isInRange(u, 0, 100)) return fail("uptime");
    if (u >= 100) return fail("uptimeHundred");
    uptimePercent = u;
  } else {
    const downtime = input.monthlyDowntimeMinutes;
    // Zero downtime is the same unanswerable case as 100 % uptime: there is no
    // nines figure for it, and returning one would look like a very good answer.
    if (!isInRange(downtime, 0.0001, MINUTES_PER_MONTH * 100)) return fail("downtime");
    uptimePercent = 100 * (1 - downtime / MINUTES_PER_MONTH);
    if (!isInRange(uptimePercent, 0, 100)) return fail("downtime");
  }
  const unavailable = 100 - uptimePercent;
  const nines = -Math.log10(unavailable / 100);
  const minutesPerMonth = (unavailable / 100) * MINUTES_PER_MONTH;
  return {
    ok: true,
    uptimePercent,
    unavailablePercent: unavailable,
    nines,
    downtimeMinutesPerYear: (unavailable / 100) * MINUTES_PER_YEAR,
    downtimeMinutesPerMonth: minutesPerMonth,
    downtimeMinutesPerWeek: (unavailable / 100) * 7 * MINUTES_PER_DAY,
    downtimeMinutesPerDay: (unavailable / 100) * MINUTES_PER_DAY,
    downtimeSecondsPerMonth: minutesPerMonth * 60,
  };
}

/* -------------------------------------------------------------------------- */
/* vlsm-split — podela podmreža                                                 */
/* -------------------------------------------------------------------------- */

/** 2³², the size of the whole IPv4 space, and 2³²−1, its last address. */
const IPV4_SPACE = 4294967296;
const IPV4_MAX = IPV4_SPACE - 1;

export interface VlsmInput {
  /** Base network in dotted quad, e.g. 192.168.10.0. */
  readonly baseAddress: string;
  /** Base prefix length, 0–30 — a /31 or /32 has no addressable hosts to allocate. */
  readonly prefix: number;
  /** Hosts each subnet must hold, in the order they were typed. */
  readonly hostCounts: readonly number[];
}

export interface VlsmBlock {
  readonly hostCount: number;
  /** `32 − ceil(log₂(hosts + 2))`. */
  readonly prefix: number;
  readonly network: string;
  readonly broadcast: string;
  readonly firstHost: string;
  readonly lastHost: string;
  readonly usableHosts: number;
}

export interface VlsmResult {
  readonly baseNetwork: string;
  readonly baseBroadcast: string;
  /** Largest request first, which is the order the blocks were placed in. */
  readonly blocks: readonly VlsmBlock[];
  readonly totalRequestedHosts: number;
  readonly totalAllocatedHosts: number;
  /** Addresses of the base block that no subnet claimed. */
  readonly freeAddresses: number;
}

function parseIpv4(text: string): number | undefined {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

function formatIpv4(value: number): string {
  const octets = [
    Math.floor(value / 16777216) % 256,
    Math.floor(value / 65536) % 256,
    Math.floor(value / 256) % 256,
    value % 256,
  ];
  return octets.join(".");
}

/** Host bits a block needs for `hosts` usable addresses: `ceil(log₂(hosts + 2))`. */
function hostBitsFor(hosts: number): number {
  let bits = 1;
  while (2 ** bits - 2 < hosts) bits += 1;
  return bits;
}

/**
 * Carving a base block into subnets sized to a list of host requirements — VLSM.
 *
 * The requests are sorted LARGEST FIRST, and that is not a preference: a subnet's
 * size is a power of two, so placing a small block first leaves a gap too small
 * for the large one behind it. Sorting descending and allocating on a growing
 * cursor is the standard packing and it is what makes the answer fit whenever a
 * fit exists.
 *
 * `/31` and `/32` are outside the model on purpose: their two addresses are a
 * point-to-point convention, not a host range, and a tool that silently produced
 * them from a request of zero hosts would be inventing one. The split is refused
 * when the requests do not fit rather than truncated, and the leftover addresses
 * are reported so the user can see how much of the block is unclaimed.
 */
export function vlsmSplit(input: VlsmInput): ProResult<VlsmResult> {
  const base = parseIpv4(input.baseAddress);
  if (base === undefined) return fail("baseAddress");
  if (!isIntegerIn(input.prefix, 0, 30)) return fail("prefix");
  if (input.hostCounts.length === 0 || input.hostCounts.length > 256) return fail("hostCounts");
  if (!input.hostCounts.every((count) => isIntegerIn(count, 1, 2 ** 24))) return fail("hostCounts");

  const mask = input.prefix === 0 ? 0 : (IPV4_MAX << (32 - input.prefix)) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network | (IPV4_MAX - mask)) >>> 0;

  const sorted = [...input.hostCounts].sort((left, right) => right - left);
  const blocks: VlsmBlock[] = [];
  let cursor = network;
  for (const hosts of sorted) {
    const prefix = 32 - hostBitsFor(hosts);
    if (prefix < input.prefix) return fail("doesNotFit");
    const size = 2 ** (32 - prefix);
    const end = cursor + size - 1;
    if (end > broadcast) return fail("doesNotFit");
    blocks.push({
      hostCount: hosts,
      prefix,
      network: formatIpv4(cursor),
      broadcast: formatIpv4(end),
      firstHost: formatIpv4(cursor + 1),
      lastHost: formatIpv4(end - 1),
      usableHosts: size - 2,
    });
    cursor = end + 1;
  }
  const totalRequestedHosts = sorted.reduce((sum, hosts) => sum + hosts, 0);
  const totalAllocatedHosts = blocks.reduce((sum, block) => sum + block.usableHosts, 0);
  return {
    ok: true,
    baseNetwork: formatIpv4(network),
    baseBroadcast: formatIpv4(broadcast),
    blocks,
    totalRequestedHosts,
    totalAllocatedHosts,
    freeAddresses: broadcast - cursor + 1,
  };
}

/* -------------------------------------------------------------------------- */
/* mac-normalise — MAC adresa                                                   */
/* -------------------------------------------------------------------------- */

export interface MacInput {
  /** Any ordinary spelling: `aa:bb:cc:dd:ee:ff`, `aa-bb-…`, `aabb.ccdd.eeff`, `aabbccddeeff`. */
  readonly address: string;
}

export interface MacResult {
  /** The six octets, in order. */
  readonly octets: readonly number[];
  readonly colon: string;
  readonly dash: string;
  /** The Cisco/dotted spelling: three groups of four hex digits. */
  readonly dotted: string;
  /** No separators, upper case — the form a switch's configuration file wants. */
  readonly bare: string;
  /** The first three bytes, the OUI an IEEE registry assigns, in colon form. */
  readonly oui: string;
  /** Set in the first octet's least significant bit: a group address, not a station. */
  readonly multicast: boolean;
  /** Set in the second least significant bit: an address an administrator assigned, not the vendor. */
  readonly locallyAdministered: boolean;
}

const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

/**
 * One MAC address in every notation, plus the two bits the first octet carries.
 *
 * The two bits are the reason this is not a formatting exercise. **The least
 * significant bit of the first octet is the I/G bit** — set on every multicast,
 * broadcast and spanning-tree group address — and **the next one is the U/L bit**,
 * set when somebody overrode the vendor's assignment. A tool that printed the
 * octets and nothing else would leave the reader to remember which bit of which
 * octet decides, which is exactly what the two booleans are for.
 */
export function normaliseMac(input: MacInput): ProResult<MacResult> {
  const compact = input.address.replace(/[\s:.-]/g, "");
  if (compact.length !== 12 || !/^[0-9a-fA-F]{12}$/.test(compact)) return fail("address");
  const octets: number[] = [];
  for (let at = 0; at < 12; at += 2) {
    const pair = compact.slice(at, at + 2);
    if (!HEX_PAIR.test(pair)) return fail("address");
    octets.push(Number.parseInt(pair, 16));
  }
  const hex = octets.map((octet) => octet.toString(16).padStart(2, "0").toUpperCase());
  const first = octets[0] ?? 0;
  return {
    ok: true,
    octets,
    colon: hex.join(":"),
    dash: hex.join("-"),
    dotted: `${hex.slice(0, 2).join("")}.${hex.slice(2, 4).join("")}.${hex.slice(4, 6).join("")}`,
    bare: hex.join(""),
    oui: hex.slice(0, 3).join(":"),
    multicast: (first & 1) === 1,
    locallyAdministered: (first & 2) === 2,
  };
}
