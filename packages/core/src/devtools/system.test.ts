import { describe, expect, it } from "vitest";

import {
  type CidrBlock,
  type CidrReport,
  HTTP_STATUSES,
  HTTP_STATUS_CLASSES,
  type IpAddress,
  type PathFlavour,
  type PathRefusal,
  type SemVer,
  cidrBlockOf,
  cidrContains,
  cmdExpandsPath,
  compareSemver,
  convertPath,
  createIdGenerator,
  describeCidr,
  findHttpStatus,
  formatCidr,
  formatIp,
  formatSemver,
  httpStatusClass,
  maxSatisfyingSemver,
  parseCidr,
  parseCidrList,
  parseIp,
  parsePath,
  parseSemver,
  parseSemverRange,
  parseUlid,
  parseUuid,
  pathNeedsQuoting,
  quotePath,
  satisfiesSemver,
  searchHttpStatuses,
  sortSemvers,
  splitCidr,
  summariseCidrs,
} from "./system.js";
import type { RandomPort } from "./random.js";

/** A port that always hands back the same byte, so every identifier below is an exact string. */
function fill(byte: number): RandomPort {
  return { bytes: (n) => new Uint8Array(n).fill(byte) };
}

/**
 * The millisecond RFC 9562 uses for its own UUIDv7 example (Appendix A.3):
 * 0x017F22E279B0, which the RFC states is 2022-02-22 14:22:22 GMT−05:00.
 * Re-derived here rather than taken on trust: 0x017F × 2^32 = 1 644 972 474 368
 * and 0x22E279B0 = 585 267 632, and the two sum to 1 645 557 742 000.
 */
const RFC_9562_MS = 1_645_557_742_000;

describe("uuid — generation", () => {
  it("mints a v4 with the version and variant bits set and every other bit random", () => {
    // 0xAA is 1010: the variant nibble already begins `10`, so only the version
    // nibble changes and the rest of the pattern survives untouched.
    expect(createIdGenerator(fill(0xaa)).uuidV4()).toBe("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
    // 0xF is 1111: the variant nibble must be forced to 10xx, i.e. 0xB.
    expect(createIdGenerator(fill(0xff)).uuidV4()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(createIdGenerator(fill(0x00)).uuidV4()).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("puts the millisecond in the first 48 bits of a v7, big-endian", () => {
    // 1 645 557 742 000 is 0x017F22E279B0, so the id opens `017f22e2-79b0`.
    // Version 7, then a zero counter, then the variant 10 over 62 zero bits.
    expect(createIdGenerator(fill(0x00)).uuidV7(RFC_9562_MS)).toBe(
      "017f22e2-79b0-7000-8000-000000000000",
    );
  });

  it("seeds the v7 counter from the port and keeps the rest of rand_b", () => {
    // Seed is one byte: 0xAA = 170 = 0x0AA, which fills rand_a. rand_b is
    // 0xAAAAAAAAAAAAAAAA with the top two bits replaced by the variant 10 —
    // which 0xA already is, so the tail is unchanged.
    expect(createIdGenerator(fill(0xaa)).uuidV7(RFC_9562_MS)).toBe(
      "017f22e2-79b0-70aa-aaaa-aaaaaaaaaaaa",
    );
  });

  it("advances the counter, not the clock, for ids minted inside one millisecond", () => {
    const generator = createIdGenerator(fill(0x00));
    expect(generator.uuidV7(RFC_9562_MS)).toBe("017f22e2-79b0-7000-8000-000000000000");
    expect(generator.uuidV7(RFC_9562_MS)).toBe("017f22e2-79b0-7001-8000-000000000000");
    expect(generator.uuidV7(RFC_9562_MS)).toBe("017f22e2-79b0-7002-8000-000000000000");
  });

  it("never lets a v7 go backwards when the clock does", () => {
    // An NTP step or a timezone change moves the clock back. The id must not
    // follow it: the previous millisecond is reused and the counter advances.
    const generator = createIdGenerator(fill(0x00));
    const first = generator.uuidV7(RFC_9562_MS);
    const second = generator.uuidV7(RFC_9562_MS - 5_000);
    expect(second > first).toBe(true);
    expect(parseUuid(second)?.timestampMs).toBe(RFC_9562_MS);
  });

  it("borrows a millisecond rather than repeat itself when the 12-bit counter rolls over", () => {
    // Seeded from 0xFF the counter starts at 255 and has 4095 − 255 = 3840
    // increments left, so call 3842 is the first that cannot be served inside
    // this millisecond and moves to the next one.
    const generator = createIdGenerator(fill(0xff));
    const ids: string[] = [];
    for (let i = 0; i < 3842; i += 1) ids.push(generator.uuidV7(RFC_9562_MS));

    expect(parseUuid(ids[3840] ?? "")?.timestampMs).toBe(RFC_9562_MS);
    expect(parseUuid(ids[3841] ?? "")?.timestampMs).toBe(RFC_9562_MS + 1);
    for (let i = 1; i < ids.length; i += 1) expect((ids[i] ?? "") > (ids[i - 1] ?? "")).toBe(true);
  });

  it("refuses a nowMs that cannot be a millisecond count, because that is a caller bug", () => {
    const generator = createIdGenerator(fill(0x00));
    expect(() => generator.uuidV7(-1)).toThrow(RangeError);
    expect(() => generator.uuidV7(1.5)).toThrow(RangeError);
    expect(() => generator.uuidV7(2 ** 48)).toThrow(RangeError);
  });
});

describe("ulid", () => {
  /**
   * Derived by hand from the millisecond above, ten Crockford digits, most
   * significant first: 1 645 557 742 000 = 1·32^8 + 15·32^7 + 28·32^6 + 17·32^5
   * + 14·32^4 + 4·32^3 + 30·32^2 + 13·32 + 16, with a leading zero digit — and
   * the alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` maps those to 0 1 F W H E 4
   * Y D G.
   */
  const TIME_CHARS = "01FWHE4YDG";

  it("writes the timestamp in ten Crockford characters and the randomness in sixteen", () => {
    expect(createIdGenerator(fill(0x00)).ulid(RFC_9562_MS)).toBe(`${TIME_CHARS}0000000000000000`);
  });

  it("increments the random component inside one millisecond, so the order is guaranteed", () => {
    const generator = createIdGenerator(fill(0x00));
    expect(generator.ulid(RFC_9562_MS)).toBe(`${TIME_CHARS}0000000000000000`);
    expect(generator.ulid(RFC_9562_MS)).toBe(`${TIME_CHARS}0000000000000001`);
  });

  it("sorts as text in the order it was minted, which is the whole reason for base32", () => {
    const generator = createIdGenerator(fill(0x00));
    const ids = [
      generator.ulid(RFC_9562_MS),
      generator.ulid(RFC_9562_MS),
      generator.ulid(RFC_9562_MS + 1),
    ];
    expect([...ids].sort()).toEqual(ids);
  });

  it("reads a ULID back, including the letters Crockford says decode to digits", () => {
    const parsed = parseUlid(`${TIME_CHARS}0000000000000001`);
    expect(parsed?.timestampMs).toBe(RFC_9562_MS);
    expect(parsed?.randomness).toBe(1n);
    // I and L decode to 1, O decodes to 0 — Crockford's own rule, so a ULID
    // read off a screen still resolves. The canonical form never spells them.
    expect(parseUlid(`${TIME_CHARS}00000000000000OI`)?.canonical).toBe(
      `${TIME_CHARS}0000000000000001`,
    );
  });

  it("refuses U, a wrong length, and a timestamp that will not fit in 48 bits", () => {
    expect(parseUlid(`${TIME_CHARS}000000000000000U`)).toBeNull();
    expect(parseUlid(`${TIME_CHARS}000`)).toBeNull();
    // Ten base32 characters carry 50 bits while the field is 48, so the top two
    // bits must be zero: anything above `7…` is not a ULID.
    expect(parseUlid("ZZZZZZZZZZ0000000000000000")).toBeNull();
    expect(parseUlid("8000000000" + "0000000000000000")).toBeNull();
  });
});

describe("uuid — parsing", () => {
  it("reads the RFC 9562 example vectors", () => {
    // Appendix A.3 — a v7 whose timestamp the RFC states in words.
    const v7 = parseUuid("017F22E2-79B0-7CC3-98C4-DC0C0C07398F");
    expect(v7?.version).toBe(7);
    expect(v7?.variant).toBe("rfc4122");
    expect(v7?.timestampMs).toBe(RFC_9562_MS);
    expect(v7?.canonical).toBe("017f22e2-79b0-7cc3-98c4-dc0c0c07398f");

    // Appendix A.1 — a v4, which carries no time at all.
    const v4 = parseUuid("919108f7-52d1-4320-9bac-f847db4148a8");
    expect(v4?.version).toBe(4);
    expect(v4?.timestampMs).toBeNull();
  });

  it("recovers the Gregorian timestamp from a v1 and from its v6 re-ordering", () => {
    // f81d4fae-7dec-11d0-…: time_hi 0x1D0, time_mid 0x7DEC, time_low 0xF81D4FAE.
    // (0x1D0 << 48) + (0x7DEC << 32) + 0xF81D4FAE
    //   = 130 604 389 193 744 384 + 138 452 565 753 856 + 4 162 670 510
    //   = 130 742 845 922 168 750 hundred-nanosecond ticks since 1582-10-15.
    // Less the 122 192 928 000 000 000 ticks to the Unix epoch, over 10 000:
    //   8 549 917 922 168 750 / 10 000 = 854 991 792 216 ms.
    expect(parseUuid("f81d4fae-7dec-11d0-a765-00a0c91e6bf6")?.timestampMs).toBe(854_991_792_216);

    // The SAME 60-bit count, re-cut for v6: the 15 hex digits 1D07DECF81D4FAE
    // split 8 / 4 / 3 instead of 8 / 4 / 3 the other way round.
    const v6 = parseUuid("1d07decf-81d4-6fae-a765-00a0c91e6bf6");
    expect(v6?.version).toBe(6);
    expect(v6?.timestampMs).toBe(854_991_792_216);
  });

  it("names the variant from the bits rather than assuming the RFC's", () => {
    expect(parseUuid("00000000-0000-1000-0000-000000000000")?.variant).toBe("ncs");
    expect(parseUuid("00000000-0000-1000-8000-000000000000")?.variant).toBe("rfc4122");
    expect(parseUuid("00000000-0000-1000-c000-000000000000")?.variant).toBe("microsoft");
    expect(parseUuid("00000000-0000-1000-e000-000000000000")?.variant).toBe("future");
    // A non-RFC variant has no version field, so no timestamp is claimed.
    expect(parseUuid("00000000-0000-1000-c000-000000000000")?.timestampMs).toBeNull();
  });

  it("marks the two ids the RFC gives fixed meanings", () => {
    expect(parseUuid("00000000-0000-0000-0000-000000000000")?.special).toBe("nil");
    expect(parseUuid("ffffffff-ffff-ffff-ffff-ffffffffffff")?.special).toBe("max");
    expect(parseUuid("017f22e2-79b0-7cc3-98c4-dc0c0c07398f")?.special).toBeNull();
  });

  it("accepts the four spellings a UUID actually arrives in", () => {
    const canonical = "919108f7-52d1-4320-9bac-f847db4148a8";
    expect(parseUuid(`{${canonical}}`)?.canonical).toBe(canonical);
    expect(parseUuid(`urn:uuid:${canonical}`)?.canonical).toBe(canonical);
    expect(parseUuid(canonical.replaceAll("-", ""))?.canonical).toBe(canonical);
    expect(parseUuid(`  ${canonical.toUpperCase()}  `)?.canonical).toBe(canonical);
  });

  it("refuses hyphens in the wrong places rather than stripping them", () => {
    // Not a UUID written differently — a different string. Repairing it would
    // report a confident version for a typo.
    expect(parseUuid("919108f7-52d14-320-9bac-f847db4148a8")).toBeNull();
    expect(parseUuid("919108f7-52d1-4320-9bac-f847db4148a")).toBeNull();
    expect(parseUuid("919108f7-52d1-4320-9bac-f847db4148ag")).toBeNull();
    expect(parseUuid("")).toBeNull();
  });
});

describe("http statuses", () => {
  it("keeps the table in ascending code order with no code twice", () => {
    const codes = HTTP_STATUSES.map((entry) => entry.code);
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every row the class its own code implies", () => {
    for (const entry of HTTP_STATUSES) {
      expect(entry.statusClass, String(entry.code)).toBe(httpStatusClass(entry.code));
      expect(HTTP_STATUS_CLASSES).toContain(entry.statusClass);
    }
  });

  it("gives every row a Serbian line and a reference, since a bare table is what it replaces", () => {
    for (const entry of HTTP_STATUSES) {
      expect(entry.noteSr.length, String(entry.code)).toBeGreaterThan(10);
      expect(entry.reference.length, String(entry.code)).toBeGreaterThan(2);
    }
  });

  it("has no class for a number that is not a status", () => {
    expect(httpStatusClass(99)).toBeNull();
    expect(httpStatusClass(600)).toBeNull();
    expect(httpStatusClass(404.5)).toBeNull();
    expect(httpStatusClass(200)).toBe("2xx");
    expect(httpStatusClass(599)).toBe("5xx");
  });

  it("finds a status by code", () => {
    expect(findHttpStatus(404)?.name).toBe("Not Found");
    expect(findHttpStatus(451)?.reference).toBe("RFC 7725");
    expect(findHttpStatus(999)).toBeUndefined();
  });

  it("marks the widely-deployed unregistered codes as unofficial and names the vendor", () => {
    for (const code of [218, 419, 499, 509, 520, 521, 522, 523, 524, 525, 526, 527, 530]) {
      expect(findHttpStatus(code)?.official, String(code)).toBe(false);
    }
    expect(findHttpStatus(521)?.reference).toBe("Cloudflare");
    expect(findHttpStatus(419)?.reference).toBe("Laravel");
    // Everything in an RFC is official, including the ones nobody should send.
    expect(findHttpStatus(418)?.official).toBe(true);
    expect(findHttpStatus(305)?.official).toBe(true);
  });

  it("treats a numeric query as a PREFIX over the whole family", () => {
    expect(searchHttpStatuses("40").map((entry) => entry.code)).toEqual([
      400, 401, 402, 403, 404, 405, 406, 407, 408, 409,
    ]);
    expect(searchHttpStatuses("404").map((entry) => entry.code)).toEqual([404]);

    const fourHundreds = searchHttpStatuses("4");
    expect(fourHundreds.every((entry) => entry.statusClass === "4xx")).toBe(true);
    expect(fourHundreds.map((entry) => entry.code)).toContain(419);
    expect(fourHundreds.map((entry) => entry.code)).toContain(499);
  });

  it("searches the reason phrase and the Serbian note, folded", () => {
    expect(searchHttpStatuses("gateway").map((entry) => entry.code)).toEqual([502, 504]);
    // „isteći" carries a diacritic the fold removes on both sides.
    expect(searchHttpStatuses("istekao").map((entry) => entry.code)).toContain(419);
    expect(searchHttpStatuses("cloudflare").every((entry) => entry.official === false)).toBe(true);
    expect(searchHttpStatuses("zzzz")).toEqual([]);
  });

  it("answers the whole table for an empty query", () => {
    expect(searchHttpStatuses("   ")).toEqual(HTTP_STATUSES);
  });
});

/** The path result unwrapped, so a test reads as the answer rather than as a union. */
function path(text: string, to: PathFlavour): string | PathRefusal {
  const result = convertPath(text, to);
  return result.ok ? result.path : result.reason;
}

describe("paths — the conversions that exist", () => {
  it("moves a drive-rooted Windows path to WSL and to a file URL", () => {
    expect(path("C:\\Users\\luka\\dev", "wsl")).toBe("/mnt/c/Users/luka/dev");
    expect(path("C:\\Users\\luka\\dev", "file-url")).toBe("file:///C:/Users/luka/dev");
    expect(path("C:\\", "wsl")).toBe("/mnt/c");
  });

  it("moves a WSL mount back to Windows, restoring the drive letter's case", () => {
    expect(path("/mnt/c/Users/luka", "windows")).toBe("C:\\Users\\luka");
    expect(path("/mnt/C/Users/luka", "windows")).toBe("C:\\Users\\luka");
    expect(path("/mnt/d", "windows")).toBe("D:\\");
  });

  it("treats a plain POSIX path as already being a WSL path", () => {
    expect(path("/home/luka/.config", "wsl")).toBe("/home/luka/.config");
    expect(path("/home/luka", "file-url")).toBe("file:///home/luka");
  });

  it("carries a UNC share through Windows and file-URL spellings", () => {
    expect(path("\\\\server\\share\\dir\\a.txt", "file-url")).toBe(
      "file://server/share/dir/a.txt",
    );
    expect(path("file://server/share/dir/a.txt", "unc")).toBe("\\\\server\\share\\dir\\a.txt");
    expect(path("\\\\server\\share", "windows")).toBe("\\\\server\\share");
  });

  it("normalises . and .. before writing anything back", () => {
    expect(path("C:\\Users\\luka\\..\\Public\\.\\docs", "windows")).toBe("C:\\Users\\Public\\docs");
    // A `..` that would climb above a root is dropped — `/..` is `/`, as it is
    // in both kernels.
    expect(path("/a/../../b", "unix")).toBe("/b");
    // A `..` at the head of a RELATIVE path names a real directory nobody here
    // knows, so it survives.
    expect(path("..\\..\\src\\a.ts", "unix")).toBe("../../src/a.ts");
    expect(path("docs/../src/a.ts", "unix")).toBe("src/a.ts");
    expect(path("./.", "unix")).toBe(".");
  });

  it("keeps a trailing separator, because it is a distinction the user typed", () => {
    expect(path("C:\\Users\\luka\\", "windows")).toBe("C:\\Users\\luka\\");
    expect(path("C:\\Users\\luka\\", "unix")).toBe("no-unix-root");
    expect(path("/home/luka/", "wsl")).toBe("/home/luka/");
    expect(path("/home/luka/", "file-url")).toBe("file:///home/luka/");
  });

  it("percent-escapes on the way into a URL and decodes on the way out", () => {
    expect(path("C:\\Program Files\\Nexus", "file-url")).toBe(
      "file:///C:/Program%20Files/Nexus",
    );
    expect(path("file:///C:/Program%20Files/Nexus", "windows")).toBe("C:\\Program Files\\Nexus");
    // Encoded per segment, so an escaped separator can never become a real one
    // — and since no filesystem here can hold a separator inside a name, a URL
    // that asks for one is refused rather than silently split into two.
    expect(parsePath("file:///home/a%2Fb/c")).toBeNull();
  });

  it("round-trips a backslash through a file URL, which only a slash may not do", () => {
    // The encoder escapes it and the parser has to accept its own output back;
    // refusing `%5C` made the tool contradict itself in one step.
    expect(path("/home/a\\b", "file-url")).toBe("file:///home/a%5Cb");
    expect(path("file:///home/a%5Cb", "unix")).toBe("/home/a\\b");
    expect(parsePath("file:///home/a%5Cb")?.segments).toEqual(["home", "a\\b"]);
    // `%2F` stays refused, because that reasoning was about a separator and is
    // still true for the one character that is a separator everywhere.
    expect(parsePath("file:///home/a%2Fb")).toBeNull();
    // Where the backslash WOULD be a separator the answer is a refusal by name,
    // not a name quietly cut into two directories.
    expect(path("file:///C:/a%5Cb", "windows")).toBe("illegal-windows-name");
  });

  it("round-trips a Windows path through a file URL and a WSL mount", () => {
    const original = "C:\\Users\\luka\\Moji dokumenti\\a.txt";
    const url = path(original, "file-url");
    expect(typeof url === "string" && path(url, "windows")).toBe(original);
    const mount = path(original, "wsl");
    expect(typeof mount === "string" && path(mount, "windows")).toBe(original);
  });

  it("accepts the file-URL forms RFC 8089 says are equivalent", () => {
    expect(path("file:///home/luka", "unix")).toBe("/home/luka");
    expect(path("file://localhost/home/luka", "unix")).toBe("/home/luka");
    expect(path("file:/home/luka", "unix")).toBe("/home/luka");
  });

  it("strips the quotes a path wears when it is copied out of a terminal", () => {
    expect(path('"C:\\Program Files\\Nexus"', "windows")).toBe("C:\\Program Files\\Nexus");
  });

  it("reports the flavour it recognised", () => {
    expect(parsePath("C:\\x")?.flavour).toBe("windows");
    expect(parsePath("/mnt/c/x")?.flavour).toBe("wsl");
    expect(parsePath("/home/x")?.flavour).toBe("unix");
    expect(parsePath("\\\\host\\share")?.flavour).toBe("unc");
    expect(parsePath("file:///x")?.flavour).toBe("file-url");
    expect(parsePath("a/b")?.root.kind).toBe("relative");
  });
});

describe("paths — the conversions that do not", () => {
  it("refuses to invent a drive for a UNIX path", () => {
    expect(path("/home/luka", "windows")).toBe("no-drive");
    expect(path("/home/luka", "unc")).toBe("no-host");
  });

  it("refuses to invent a UNIX root for a drive or a share", () => {
    // Answering `/c/Users/x` would name a directory that exists nowhere.
    expect(path("C:\\Users\\x", "unix")).toBe("no-unix-root");
    expect(path("\\\\server\\share\\x", "unix")).toBe("no-unix-root");
    expect(path("\\\\server\\share\\x", "wsl")).toBe("no-unix-root");
    expect(path("C:\\Users\\x", "unc")).toBe("no-host");
  });

  it("refuses a relative path where an absolute one is required", () => {
    expect(path("src/a.ts", "file-url")).toBe("not-absolute");
  });

  it("refuses a drive-relative path outright", () => {
    // `C:foo` resolves against a per-drive current directory that only the
    // running process has, so there is no path here to convert.
    expect(path("C:foo", "windows")).toBe("drive-relative");
    expect(path("C:", "unix")).toBe("drive-relative");
  });

  it("reads a leading double slash as a POSIX root, never as a host", () => {
    // Treating `//home/luka` as a share on a machine called „home" would send a
    // local path to the network.
    expect(path("//home/luka", "unix")).toBe("/home/luka");
    expect(path("//home/luka", "unc")).toBe("no-host");
  });

  it("refuses a segment Windows would read as syntax or as a device", () => {
    // `name:stream` addresses an NTFS Alternate Data Stream, so answering
    // `notes:v2\readme.md` would name a stream on a file called `notes`.
    expect(path("notes:v2/readme.md", "windows")).toBe("illegal-windows-name");
    // The device names are resolved at every level of a path, in any case, and
    // still resolved when the name carries an extension.
    expect(path("logs/con/output.txt", "windows")).toBe("illegal-windows-name");
    expect(path("logs/CoN.TXT", "windows")).toBe("illegal-windows-name");
    expect(path("logs/COM9/a", "windows")).toBe("illegal-windows-name");
    // The wildcards and the redirection operators, none of which a Win32 name
    // may hold.
    for (const bad of ["a*b", "a?b", 'a"b', "a<b", "a>b", "a|b"]) {
      expect(path(`dir/${bad}`, "windows")).toBe("illegal-windows-name");
    }
    // A trailing dot or space is not refused by Win32 but silently removed, so
    // emitting it would be naming a different file.
    expect(path("dir/report /a.txt", "windows")).toBe("illegal-windows-name");
    expect(path("dir/report./a.txt", "windows")).toBe("illegal-windows-name");
  });

  it("applies the Win32 name rules to every spelling that a path parser reads back", () => {
    // Relative, drive-rooted and UNC-rooted paths all reach the `windows`
    // formatter, and `unc` writes the same segments a second time.
    expect(path("C:\\logs\\con\\a.txt", "windows")).toBe("illegal-windows-name");
    expect(path("\\\\server\\share\\con\\a.txt", "windows")).toBe("illegal-windows-name");
    expect(path("\\\\server\\share\\con\\a.txt", "unc")).toBe("illegal-windows-name");
    expect(path("file:///C:/notes%3Av2/readme.md", "windows")).toBe("illegal-windows-name");
    // The spellings that are not read by the Win32 path parser keep the name,
    // because there it is an ordinary one.
    expect(path("notes:v2/readme.md", "unix")).toBe("notes:v2/readme.md");
    expect(path("/home/luka/notes:v2", "file-url")).toBe("file:///home/luka/notes%3Av2");
  });

  it("keeps a root, and a name that only starts like a device, legal", () => {
    // The drive letter's colon belongs to the ROOT: it is consumed before the
    // filename parser runs, so the rule that refuses `notes:v2` must not touch it.
    expect(path("C:\\Users\\luka", "windows")).toBe("C:\\Users\\luka");
    expect(path("\\\\server\\share\\dir", "unc")).toBe("\\\\server\\share\\dir");
    // `COM10` and `CONtact` are legal names — the device list stops at COM9 and
    // the match ends at the first dot, not part-way through a word.
    expect(path("logs/COM10/CONtact.txt", "windows")).toBe("logs\\COM10\\CONtact.txt");
    expect(path("logs/NULL.txt", "windows")).toBe("logs\\NULL.txt");
  });

  it("refuses URL text that is not a path", () => {
    expect(parsePath("file:///C:/x?q=1")).toBeNull();
    expect(parsePath("file:///C:/%zz")).toBeNull();
    expect(parsePath("file:")).toBeNull();
    expect(parsePath("\\\\server")).toBeNull();
    expect(parsePath("   ")).toBeNull();
  });
});

describe("paths — quoting", () => {
  it("quotes only what a shell would otherwise act on", () => {
    expect(pathNeedsQuoting("C:\\Users\\luka\\a.txt")).toBe(false);
    expect(pathNeedsQuoting("/home/luka/moji fajlovi")).toBe(true);
    // Diacritics are not shell syntax; quoting them would only make the answer
    // uglier than the question.
    expect(pathNeedsQuoting("/home/luka/Đorđe")).toBe(false);
  });

  it("uses the literal quoting form of each shell", () => {
    expect(quotePath("/home/luka/moji fajlovi", "posix")).toBe("'/home/luka/moji fajlovi'");
    expect(quotePath("/home/luka/moji fajlovi", "powershell")).toBe("'/home/luka/moji fajlovi'");
    expect(quotePath("C:\\Program Files\\Nexus", "cmd")).toBe('"C:\\Program Files\\Nexus"');
    // Single quotes, so `$HOME` in a filename is not substituted away.
    expect(quotePath("/tmp/$HOME x", "posix")).toBe("'/tmp/$HOME x'");
    expect(quotePath("/tmp/it's mine", "powershell")).toBe("'/tmp/it''s mine'");
    expect(quotePath("/tmp/it's mine", "posix")).toBe("'/tmp/it'\\''s mine'");
    expect(quotePath("/home/luka", "posix")).toBe("/home/luka");
  });

  it("says that cmd quoting cannot neutralise a percent instead of implying it can", () => {
    // cmd substitutes during tokenisation, before quotes are stripped, so the
    // quoted form expands exactly as the bare text does. The quoting still
    // happens — it is all cmd has for the space — and the claim about it is
    // what changes.
    expect(quotePath("C:\\%TEMP%\\build", "cmd")).toBe('"C:\\%TEMP%\\build"');
    expect(cmdExpandsPath("C:\\%TEMP%\\build")).toBe(true);
    // A single percent is no safer: a batch file reads `%1` as an argument and
    // drops a percent that begins no construct at all.
    expect(cmdExpandsPath("C:\\build\\report%1.txt")).toBe(true);
    expect(cmdExpandsPath("C:\\build\\100%")).toBe(true);
    expect(cmdExpandsPath("C:\\Program Files\\Nexus")).toBe(false);
    // The other two shells have a literal form, so for them the quoted answer
    // really is the whole answer.
    expect(quotePath("C:\\%TEMP%\\build", "powershell")).toBe("'C:\\%TEMP%\\build'");
    expect(quotePath("/tmp/%TEMP%/build", "posix")).toBe("'/tmp/%TEMP%/build'");
  });
});

/** `describeCidr` over text, so a test states the block it is about. */
function report(text: string): CidrReport {
  const input = parseCidr(text);
  if (input === null) throw new Error(`not a block: ${text}`);
  return describeCidr(input);
}

function block(text: string): CidrBlock {
  const input = parseCidr(text);
  if (input === null) throw new Error(`not a block: ${text}`);
  return cidrBlockOf(input);
}

function address(text: string): IpAddress {
  const parsed = parseIp(text);
  if (parsed === null) throw new Error(`not an address: ${text}`);
  return parsed;
}

describe("cidr — IPv4", () => {
  it("splits an address into its block, its edges and its counts", () => {
    // /26 keeps 26 bits: the last octet's mask is 1100 0000 = 192, and
    // 130 = 1000 0010 lands in the block that starts at 128.
    const answer = report("192.168.1.130/26");
    expect(answer.address).toBe("192.168.1.130");
    expect(answer.network).toBe("192.168.1.128");
    expect(answer.broadcast).toBe("192.168.1.191");
    expect(answer.firstHost).toBe("192.168.1.129");
    expect(answer.lastHost).toBe("192.168.1.190");
    expect(answer.total).toBe(64n);
    expect(answer.usable).toBe(62n);
    expect(answer.netmask).toBe("255.255.255.192");
    expect(answer.wildcard).toBe("0.0.0.63");
  });

  it("counts a /8 without losing precision", () => {
    const answer = report("10.0.0.1/8");
    expect(answer.network).toBe("10.0.0.0");
    expect(answer.broadcast).toBe("10.255.255.255");
    expect(answer.firstHost).toBe("10.0.0.1");
    expect(answer.lastHost).toBe("10.255.255.254");
    expect(answer.total).toBe(16_777_216n);
    expect(answer.usable).toBe(16_777_214n);
    expect(answer.netmask).toBe("255.0.0.0");
    expect(answer.wildcard).toBe("0.255.255.255");
  });

  it("gives a /31 both of its addresses, per RFC 3021", () => {
    // A point-to-point link has no host to broadcast to, so neither address is
    // sacrificed and neither is a broadcast address.
    const answer = report("192.0.2.1/31");
    expect(answer.network).toBe("192.0.2.0");
    expect(answer.broadcast).toBeNull();
    expect(answer.firstHost).toBe("192.0.2.0");
    expect(answer.lastHost).toBe("192.0.2.1");
    expect(answer.total).toBe(2n);
    expect(answer.usable).toBe(2n);
  });

  it("treats a /32 as the one host it is", () => {
    const answer = report("192.0.2.5/32");
    expect(answer.network).toBe("192.0.2.5");
    expect(answer.broadcast).toBeNull();
    expect(answer.firstHost).toBe("192.0.2.5");
    expect(answer.lastHost).toBe("192.0.2.5");
    expect(answer.total).toBe(1n);
    expect(answer.usable).toBe(1n);
    expect(answer.netmask).toBe("255.255.255.255");
    expect(answer.wildcard).toBe("0.0.0.0");
  });

  it("refuses the two shapes that mean different addresses to different resolvers", () => {
    // 010 is eight to a C-style parser and ten to a decimal one — the same text,
    // two addresses. Picking one is how an allow-list gets walked past.
    expect(parseIp("192.168.010.1")).toBeNull();
    // `10.1` is 10.0.0.1 to inet_aton and nothing at all to most parsers.
    expect(parseIp("10.1")).toBeNull();
    expect(parseIp("256.0.0.1")).toBeNull();
    expect(parseIp("192.168.1")).toBeNull();
    expect(parseIp("0.0.0.0")?.value).toBe(0n);
  });
});

describe("cidr — IPv6", () => {
  it("writes the RFC 5952 canonical short form", () => {
    // §4.1 leading zeros suppressed, §4.2.2 the longest zero run compressed.
    expect(formatIp(address("2001:0db8:0000:0000:0000:0000:1428:57ab"))).toBe(
      "2001:db8::1428:57ab",
    );
    // §4.2.3: two runs of two, so the FIRST is the one that becomes `::`.
    expect(formatIp(address("2001:db8:0:0:1:0:0:1"))).toBe("2001:db8::1:0:0:1");
    // §4.2.1: a single zero group is never shortened to `::`.
    expect(formatIp(address("2001:db8:0:1:1:1:1:1"))).toBe("2001:db8:0:1:1:1:1:1");
    // §4.3: lowercase.
    expect(formatIp(address("2001:DB8::1"))).toBe("2001:db8::1");
    expect(formatIp(address("::"))).toBe("::");
    expect(formatIp(address("::1"))).toBe("::1");
    expect(formatIp(address("1::"))).toBe("1::");
  });

  it("accepts an embedded IPv4 but does not write one back", () => {
    // RFC 4291 §2.2 form 3 on the way in; RFC 5952 §5 only says the mixed form
    // „can be" produced, so the canonical output stays single-formed.
    // 192.0.2.1 is 0xC0000201, i.e. the groups c000 and 0201.
    expect(formatIp(address("::ffff:192.0.2.1"))).toBe("::ffff:c000:201");
  });

  it("round-trips every canonical form it produces", () => {
    for (const text of ["::", "::1", "1::", "2001:db8::1:0:0:1", "fe80::1", "2001:db8:0:1:1:1:1:1"]) {
      expect(formatIp(address(text)), text).toBe(text);
    }
  });

  it("refuses the shapes that are not addresses", () => {
    // A zone id is what makes a link-local address resolvable; dropping it
    // would produce something that looks usable and is not.
    expect(parseIp("fe80::1%eth0")).toBeNull();
    expect(parseIp("1::2::3")).toBeNull();
    expect(parseIp("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIp("12345::")).toBeNull();
    // `::` must stand for at least one group, so eight groups leave it nothing.
    expect(parseIp("1:2:3:4:5:6:7:8::")).toBeNull();
    expect(parseIp("1:2:3:4:5:6:7")).toBeNull();
  });

  it("describes a v6 block with no broadcast, because v6 has none", () => {
    const answer = report("2001:db8::1/32");
    expect(answer.network).toBe("2001:db8::");
    expect(answer.broadcast).toBeNull();
    expect(answer.firstHost).toBe("2001:db8::");
    expect(answer.lastHost).toBe("2001:db8:ffff:ffff:ffff:ffff:ffff:ffff");
    // 2^96, which is why every count in this module is a bigint.
    expect(answer.total).toBe(79_228_162_514_264_337_593_543_950_336n);
    expect(answer.usable).toBe(answer.total);
    expect(answer.netmask).toBe("ffff:ffff::");
    expect(answer.wildcard).toBe("::ffff:ffff:ffff:ffff:ffff:ffff");
  });
});

describe("cidr — blocks", () => {
  it("refuses an address with no prefix, which is a statement about a host", () => {
    expect(parseCidr("10.0.0.1")).toBeNull();
    expect(parseCidr("10.0.0.0/33")).toBeNull();
    expect(parseCidr("2001:db8::/129")).toBeNull();
    expect(parseCidr("10.0.0.0/08")).toBeNull();
    expect(parseCidr("10.0.0.0/x")).toBeNull();
    expect(parseCidr("10.0.0.0/8/8")).toBeNull();
  });

  it("clears the host bits once, where the block is made", () => {
    expect(formatCidr(block("192.168.1.130/26"))).toBe("192.168.1.128/26");
    expect(formatCidr(block("2001:db8:1:2::5/48"))).toBe("2001:db8:1::/48");
  });

  it("answers whether an address is inside a block", () => {
    expect(cidrContains(block("10.0.0.0/8"), address("10.1.2.3"))).toBe(true);
    expect(cidrContains(block("10.0.0.0/8"), address("11.0.0.1"))).toBe(false);
    expect(cidrContains(block("192.168.1.128/26"), address("192.168.1.191"))).toBe(true);
    expect(cidrContains(block("192.168.1.128/26"), address("192.168.1.192"))).toBe(false);
    expect(cidrContains(block("2001:db8::/32"), address("2001:db8:ffff::1"))).toBe(true);
    // Two families are not two ends of one space, so the answer is „no", not an error.
    expect(cidrContains(block("10.0.0.0/8"), address("::1"))).toBe(false);
  });

  it("splits a block into equal subnets, and only into equal ones", () => {
    expect(splitCidr(block("192.168.0.0/24"), 4)?.map(formatCidr)).toEqual([
      "192.168.0.0/26",
      "192.168.0.64/26",
      "192.168.0.128/26",
      "192.168.0.192/26",
    ]);
    expect(splitCidr(block("192.168.0.0/24"), 1)?.map(formatCidr)).toEqual(["192.168.0.0/24"]);
    expect(splitCidr(block("2001:db8::/32"), 2)?.map(formatCidr)).toEqual([
      "2001:db8::/33",
      "2001:db8:8000::/33",
    ]);
    // Three equal subnets of a /24 do not exist; a prefix halves at every step.
    expect(splitCidr(block("192.168.0.0/24"), 3)).toBeNull();
    expect(splitCidr(block("192.168.0.1/32"), 2)).toBeNull();
    expect(splitCidr(block("192.168.0.0/24"), 0)).toBeNull();
  });

  it("summarises a list into the smallest block that covers it", () => {
    const summary = (list: string): string | null => {
      const blocks = parseCidrList(list);
      const covering = blocks === null ? null : summariseCidrs(blocks);
      return covering === null ? null : formatCidr(covering);
    };

    // 192.168.0.0 and 192.168.1.255 differ first at bit 8 of the last two
    // octets, so 23 bits are shared.
    expect(summary("192.168.0.0/24 192.168.1.0/24")).toBe("192.168.0.0/23");
    expect(summary("10.0.0.0/8, 192.168.1.0/24")).toBe("0.0.0.0/0");
    // 2001:db8:0:: and 2001:db8:1:ffff… differ at the low bit of the third
    // group, which sits 48 bits in, so 47 bits are shared.
    expect(summary("2001:db8::/48 2001:db8:1::/48")).toBe("2001:db8::/47");

    // No address space holds both families, so there is no covering block.
    expect(summariseCidrs([block("10.0.0.0/8"), block("2001:db8::/32")])).toBeNull();
    expect(summariseCidrs([])).toBeNull();
  });

  it("refuses a whole list when one entry is not a block", () => {
    expect(parseCidrList("10.0.0.0/8 nonsense")).toBeNull();
    expect(parseCidrList("   ")).toBeNull();
    expect(parseCidrList("10.0.0.0/8")?.length).toBe(1);
  });
});

/** A version, or a thrown test bug — these literals are all valid by construction. */
function v(text: string): SemVer {
  const parsed = parseSemver(text);
  if (parsed === null) throw new Error(`not a version: ${text}`);
  return parsed;
}

function inRange(versionText: string, rangeText: string): boolean {
  const range = parseSemverRange(rangeText);
  if (range === null) throw new Error(`not a range: ${rangeText}`);
  return satisfiesSemver(v(versionText), range);
}

describe("semver — parsing", () => {
  it("reads the four parts and writes them back unchanged", () => {
    const parsed = v("1.2.3-alpha.1+build.5");
    expect(parsed.major).toBe(1);
    expect(parsed.minor).toBe(2);
    expect(parsed.patch).toBe(3);
    expect(parsed.prerelease).toEqual(["alpha", "1"]);
    expect(parsed.build).toEqual(["build", "5"]);
    for (const text of ["1.2.3", "0.0.0", "1.2.3-0", "1.2.3-x.7.z.92", "1.2.3+21AF26D3"]) {
      expect(formatSemver(v(text)), text).toBe(text);
    }
  });

  it("accepts the tag prefix versions actually arrive with, and drops it on the way out", () => {
    expect(formatSemver(v("v1.2.3"))).toBe("1.2.3");
    expect(formatSemver(v("=1.2.3"))).toBe("1.2.3");
  });

  it("refuses what the published grammar refuses", () => {
    // A leading zero in a numeric identifier is what would make numeric
    // comparison ambiguous, so the spec forbids it and so does this.
    expect(parseSemver("01.2.3")).toBeNull();
    expect(parseSemver("1.2.3-01")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("1.2.3.4")).toBeNull();
    expect(parseSemver("1.2.3-")).toBeNull();
    expect(parseSemver("1.2.3+")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
});

describe("semver — precedence", () => {
  /**
   * SemVer 2.0.0 §11.4's own published chain, verbatim and in its order. This is
   * the table the whole comparison exists to satisfy.
   */
  const CHAIN = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ];

  it("orders the specification's prerelease chain exactly", () => {
    for (let i = 1; i < CHAIN.length; i += 1) {
      const lower = CHAIN[i - 1] ?? "";
      const higher = CHAIN[i] ?? "";
      expect(compareSemver(v(lower), v(higher)), `${lower} < ${higher}`).toBe(-1);
      expect(compareSemver(v(higher), v(lower)), `${higher} > ${lower}`).toBe(1);
    }
    // beta.11 after beta.2 is the case a string sort gets wrong: numeric
    // identifiers compare numerically (§11.4.1), so 11 > 2.
    expect(compareSemver(v("1.0.0-beta.11"), v("1.0.0-beta.2"))).toBe(1);
    // A numeric identifier always sorts below an alphanumeric one (§11.4.3).
    expect(compareSemver(v("1.0.0-1"), v("1.0.0-alpha"))).toBe(-1);
    // A longer identifier list sorts after a prefix of itself (§11.4.4).
    expect(compareSemver(v("1.0.0-alpha"), v("1.0.0-alpha.1"))).toBe(-1);
  });

  it("orders the specification's release chain", () => {
    // §11.2: 1.0.0 < 2.0.0 < 2.1.0 < 2.1.1.
    expect(compareSemver(v("1.0.0"), v("2.0.0"))).toBe(-1);
    expect(compareSemver(v("2.0.0"), v("2.1.0"))).toBe(-1);
    expect(compareSemver(v("2.1.0"), v("2.1.1"))).toBe(-1);
  });

  it("ignores build metadata, which §10 says carries no precedence", () => {
    expect(compareSemver(v("1.0.0+build.1"), v("1.0.0+build.2"))).toBe(0);
    expect(compareSemver(v("1.0.0"), v("1.0.0+anything"))).toBe(0);
  });

  it("compares numeric identifiers past what a double holds exactly", () => {
    // 2^53 and 2^53 + 1 are the same double; as identifiers they are not the
    // same version, and the one that is larger must be reported larger.
    expect(compareSemver(v("1.0.0-9007199254740993"), v("1.0.0-9007199254740992"))).toBe(1);
  });

  it("sorts a list into the published order, in a new array", () => {
    const shuffled = [CHAIN[3], CHAIN[7], CHAIN[0], CHAIN[4], CHAIN[1]].map((text) => v(text ?? ""));
    expect(sortSemvers(shuffled).map(formatSemver)).toEqual([
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0",
    ]);
    expect(shuffled.map(formatSemver)[0]).toBe("1.0.0-beta");
  });
});

describe("semver — ranges", () => {
  it("reads the caret at all three levels of significance", () => {
    expect(inRange("1.2.3", "^1.2.3")).toBe(true);
    expect(inRange("1.9.9", "^1.2.3")).toBe(true);
    expect(inRange("2.0.0", "^1.2.3")).toBe(false);
    expect(inRange("1.2.2", "^1.2.3")).toBe(false);
    // At 0.x the minor carries the weight of a major.
    expect(inRange("0.2.9", "^0.2.3")).toBe(true);
    expect(inRange("0.3.0", "^0.2.3")).toBe(false);
    // At 0.0.x so does the patch.
    expect(inRange("0.0.3", "^0.0.3")).toBe(true);
    expect(inRange("0.0.4", "^0.0.3")).toBe(false);
    expect(inRange("0.9.9", "^0.x")).toBe(true);
    expect(inRange("1.0.0", "^0.x")).toBe(false);
  });

  it("reads the tilde at each level of precision it is given", () => {
    expect(inRange("1.2.9", "~1.2.3")).toBe(true);
    expect(inRange("1.3.0", "~1.2.3")).toBe(false);
    expect(inRange("1.2.0", "~1.2")).toBe(true);
    expect(inRange("1.3.0", "~1.2")).toBe(false);
    expect(inRange("1.9.9", "~1")).toBe(true);
    expect(inRange("2.0.0", "~1")).toBe(false);
  });

  it("reads comparators, wildcards and the spaces npm allows inside them", () => {
    expect(inRange("1.2.7", ">=1.2.7 <1.3.0")).toBe(true);
    expect(inRange("1.3.0", ">=1.2.7 <1.3.0")).toBe(false);
    expect(inRange("1.2.7", ">= 1.2.7 < 1.3.0")).toBe(true);
    expect(inRange("1.9.9", "1.x")).toBe(true);
    expect(inRange("2.0.0", "1.x")).toBe(false);
    expect(inRange("1.2.9", "1.2.x")).toBe(true);
    expect(inRange("1.3.0", "1.2.x")).toBe(false);
    expect(inRange("4.5.6", "*")).toBe(true);
    expect(inRange("4.5.6", "")).toBe(true);
    // `>1.2.x` means past everything 1.2 covers, which starts at 1.3.0.
    expect(inRange("1.2.99", ">1.2.x")).toBe(false);
    expect(inRange("1.3.0", ">1.2.x")).toBe(true);
    expect(inRange("1.2.99", "<=1.2.x")).toBe(true);
    expect(inRange("1.3.0", "<=1.2.x")).toBe(false);
  });

  it("reads a hyphen range, including a partial upper bound", () => {
    expect(inRange("1.2.3", "1.2.3 - 2.3.4")).toBe(true);
    expect(inRange("2.3.4", "1.2.3 - 2.3.4")).toBe(true);
    expect(inRange("2.3.5", "1.2.3 - 2.3.4")).toBe(false);
    // A partial upper bound extends to the end of what it names.
    expect(inRange("2.3.9", "1.2.3 - 2.3")).toBe(true);
    expect(inRange("2.4.0", "1.2.3 - 2.3")).toBe(false);
    expect(inRange("1.2.0", "1.2 - 2.3.4")).toBe(true);
    expect(inRange("1.1.9", "1.2 - 2.3.4")).toBe(false);
  });

  it("reads alternatives", () => {
    expect(inRange("1.2.7", "1.2.7 || >=1.2.9 <2.0.0")).toBe(true);
    expect(inRange("1.2.8", "1.2.7 || >=1.2.9 <2.0.0")).toBe(false);
    expect(inRange("1.2.9", "1.2.7 || >=1.2.9 <2.0.0")).toBe(true);
    expect(inRange("2.0.0", "1.2.7 || >=1.2.9 <2.0.0")).toBe(false);
  });

  it("keeps a prerelease out of a range that never asked for one", () => {
    // The rule that matters: 2.0.0-alpha really does sort below 2.0.0, so
    // without it `^1.2.3` would pull in the next major's untested builds.
    expect(inRange("2.0.0-alpha", "^1.2.3")).toBe(false);
    expect(inRange("1.3.0-alpha", "^1.2.3")).toBe(false);
    // A range that named a prerelease on that exact version admits it.
    expect(inRange("1.2.3-beta", ">=1.2.3-alpha <2.0.0")).toBe(true);
    expect(inRange("1.2.3-a", ">=1.2.3-alpha <2.0.0")).toBe(false);
    expect(inRange("1.2.4", "^1.2.3-alpha")).toBe(true);
    expect(inRange("4.5.6-rc.1", "*")).toBe(false);
  });

  it("refuses a range with a part that is not one", () => {
    expect(parseSemverRange("^1.2.3 || not-a-range")).toBeNull();
    expect(parseSemverRange(">=1.0.0 <2.0.0 - 3.0.0")).toBeNull();
    expect(parseSemverRange("1.2.3 - 2.0.0 - 3.0.0")).toBeNull();
    expect(parseSemverRange("^01.2.3")).toBeNull();
  });

  it("picks the highest version a range admits", () => {
    const versions = ["1.2.3", "1.4.0", "1.9.9", "2.0.0", "2.1.0"].map(v);
    const best = (rangeText: string): string | null => {
      const range = parseSemverRange(rangeText);
      if (range === null) throw new Error(`not a range: ${rangeText}`);
      const winner = maxSatisfyingSemver(versions, range);
      return winner === null ? null : formatSemver(winner);
    };

    expect(best("^1.2.3")).toBe("1.9.9");
    expect(best(">=2.0.0")).toBe("2.1.0");
    expect(best("^3.0.0")).toBeNull();
  });
});
