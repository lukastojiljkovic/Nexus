import { describe, expect, it } from "vitest";

import type { WebConfig } from "./gate.js";
import { isPublicAddress, vetUrl, vetUrlShape, type AddressResolver, type ResolvedAddress } from "./target.js";

/**
 * The address rule and the destination rule (ADR-097).
 *
 * Every address below is written with the range it belongs to, because the two
 * failures this file exists to prevent are the ones where a range nobody thought
 * about is treated as public. The resolver is a table here and never a socket:
 * a test that needed DNS would fail on a train, and the rule under test has
 * nothing to do with the wire.
 */

const ON: WebConfig = { enabled: true, searxng: null };

/** The IPv4 ranges, from IANA's registries, and the answer each one must get. */
const IPV4_CASES: readonly (readonly [string, boolean])[] = [
  ["0.0.0.0", false],
  ["0.1.2.3", false],
  ["10.0.0.1", false],
  ["100.63.255.255", true],
  ["100.64.0.1", false],
  ["100.127.255.255", false],
  ["100.128.0.1", true],
  ["127.0.0.1", false],
  ["127.255.255.254", false],
  ["169.253.255.255", true],
  ["169.254.169.254", false],
  ["172.15.255.255", true],
  ["172.16.0.1", false],
  ["172.31.255.255", false],
  ["172.32.0.1", true],
  ["192.0.0.1", false],
  ["192.0.2.5", false],
  ["192.0.3.1", true],
  ["192.168.0.1", false],
  ["198.17.255.255", true],
  ["198.18.0.1", false],
  ["198.19.255.255", false],
  ["198.51.100.7", false],
  ["203.0.113.9", false],
  ["203.0.114.9", true],
  ["224.0.0.1", false],
  ["239.255.255.250", false],
  ["240.0.0.1", false],
  ["255.255.255.255", false],
  ["1.1.1.1", true],
  ["8.8.8.8", true],
  ["91.198.174.192", true],
];

/** The IPv6 ranges the same way. */
const IPV6_CASES: readonly (readonly [string, boolean])[] = [
  ["::", false],
  ["::1", false],
  ["fe80::1", false],
  ["febf::1", false],
  ["fec0::1", true],
  ["fc00::1", false],
  ["fd12:3456:789a::1", false],
  ["fbff::1", true],
  ["ff02::1", false],
  ["2001:db8::1", false],
  // Teredo and 6to4 make the TUNNEL the destination, so both are refused
  // wholesale rather than judged by an address this check cannot see.
  ["2001::1", false],
  ["2002::1", false],
  ["2001:4860:4860::8888", true],
  ["2606:4700:4700::1111", true],
  // A v4-mapped address is the IPv4 destination it carries, judged as that.
  ["::ffff:127.0.0.1", false],
  ["::ffff:10.0.0.1", false],
  ["::ffff:8.8.8.8", true],
  ["64:ff9b::169.254.169.254", false],
  ["64:ff9b::1.1.1.1", true],
];

describe("isPublicAddress", () => {
  it("refuses every private, loopback, link-local, CGNAT, multicast and reserved range", () => {
    for (const [address, expected] of [...IPV4_CASES, ...IPV6_CASES]) {
      expect(isPublicAddress(address), address).toBe(expected);
    }
  });

  it("refuses something that is not an address at all", () => {
    // „Not an address" is not „public": the resolver is what turns a name into
    // one, and an input this function cannot read is an input it cannot vouch
    // for.
    for (const notAnAddress of ["", "example.org", "127.0.0.1.1", "999.1.1.1", "1.2.3", ":::1", "0x7f.0.0.1"]) {
      expect(isPublicAddress(notAnAddress), notAnAddress).toBe(false);
    }
  });
});

/** A resolver that answers from a table, and counts how often it was asked. */
function resolverFor(table: Readonly<Record<string, readonly ResolvedAddress[]>>): {
  readonly resolve: AddressResolver;
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    resolve: (hostname: string) => {
      calls.push(hostname);
      const answers = table[hostname];
      if (answers === undefined) return Promise.reject(new Error(`no entry for ${hostname}`));
      return Promise.resolve(answers);
    },
  };
}

const PUBLIC: ResolvedAddress = { address: "93.184.216.34", family: 4 };

describe("vetUrlShape, which decides without the network", () => {
  it("returns the vetted literal for an address a URL states outright", () => {
    const outcome = vetUrlShape("https://8.8.8.8/dns?x=1", "downloads", ON);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.hostname).toBe("8.8.8.8");
      expect(outcome.literal).toEqual({ address: "8.8.8.8", family: 4 });
    }
  });

  it("refuses a private literal without asking a resolver, in every spelling a URL allows", () => {
    // The WHATWG parser is what the socket and this check share, and it
    // normalises every spelling of an IPv4 literal - so `2130706433` is judged
    // as `127.0.0.1` and never reaches a resolver.
    for (const url of [
      "https://127.0.0.1/x",
      "https://2130706433/x",
      "https://0177.0.0.1/x",
      "https://0x7f.0.0.1/x",
      "https://[::1]/x",
      "https://[::ffff:127.0.0.1]/x",
      "https://169.254.169.254/latest/meta-data/",
      "https://192.168.1.1/",
    ]) {
      expect(vetUrlShape(url, "downloads", ON), url).toEqual({ ok: false, problem: "address" });
    }
  });

  it("admits a public literal, IPv4 and IPv6, with the family the socket will use", () => {
    const v6 = vetUrlShape("https://[2606:4700:4700::1111]/", "downloads", ON);
    expect(v6.ok).toBe(true);
    if (v6.ok) expect(v6.literal).toEqual({ address: "2606:4700:4700::1111", family: 6 });
  });

  it("refuses a mode that allows nothing and a switch that is off", () => {
    expect(vetUrlShape("https://example.org/", "offline", ON).ok).toBe(false);
    expect(vetUrlShape("https://example.org/", "offline", ON)).toEqual({ ok: false, problem: "off" });
    expect(vetUrlShape("https://example.org/", "downloads", { enabled: false, searxng: null })).toEqual({
      ok: false,
      problem: "off",
    });
  });

  it("refuses anything that is not https, and a URL carrying a credential", () => {
    expect(vetUrlShape("http://example.org/", "downloads", ON)).toEqual({ ok: false, problem: "url" });
    expect(vetUrlShape("https://user:pass@example.org/", "downloads", ON)).toEqual({ ok: false, problem: "url" });
    expect(vetUrlShape("https://wikipedia.org@evil.example/", "downloads", ON)).toEqual({ ok: false, problem: "url" });
    expect(vetUrlShape("not a url", "downloads", ON)).toEqual({ ok: false, problem: "url" });
  });
});

describe("vetUrl, which resolves", () => {
  it("admits a name whose every answer is public", async () => {
    const { resolve, calls } = resolverFor({ "example.org": [PUBLIC] });
    const outcome = await vetUrl("https://example.org/", { mode: "downloads", config: ON, resolve });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.target.hostname).toBe("example.org");
      expect(outcome.target.addresses).toEqual([PUBLIC]);
    }
    expect(calls).toEqual(["example.org"]);
  });

  it("refuses a name that answers with ANY private address, not only the first", async () => {
    // A mixed answer is what a DNS-rebinding attempt looks like from here, and
    // picking „the public one" would be picking the answer the attacker did not
    // want this time.
    const { resolve } = resolverFor({
      "mixed.example": [PUBLIC, { address: "10.0.0.5", family: 4 }],
      "private.example": [{ address: "192.168.0.10", family: 4 }],
      "v6.example": [{ address: "fd00::1", family: 6 }],
    });
    for (const host of ["mixed.example", "private.example", "v6.example"]) {
      const outcome = await vetUrl(`https://${host}/`, { mode: "downloads", config: ON, resolve });
      expect(outcome, host).toEqual({ ok: false, problem: "address" });
    }
  });

  it("refuses a name that does not resolve, one that throws, and one with too many answers", async () => {
    const { resolve } = resolverFor({
      empty: [],
      many: Array.from({ length: 25 }, (_value, index) => ({
        address: `93.184.216.${String(index)}`,
        family: 4 as const,
      })),
    });
    expect(await vetUrl("https://empty/", { mode: "downloads", config: ON, resolve })).toEqual({
      ok: false,
      problem: "resolve",
    });
    expect(await vetUrl("https://throwing/", { mode: "downloads", config: ON, resolve })).toEqual({
      ok: false,
      problem: "resolve",
    });
    expect(await vetUrl("https://many/", { mode: "downloads", config: ON, resolve })).toEqual({
      ok: false,
      problem: "resolve",
    });
  });

  it("never asks a resolver when the gate already answered no", async () => {
    const { resolve, calls } = resolverFor({ "example.org": [PUBLIC] });
    expect(await vetUrl("https://example.org/", { mode: "offline", config: ON, resolve })).toEqual({
      ok: false,
      problem: "off",
    });
    expect(await vetUrl("https://127.0.0.1/", { mode: "downloads", config: ON, resolve })).toEqual({
      ok: false,
      problem: "address",
    });
    expect(await vetUrl("http://example.org/", { mode: "downloads", config: ON, resolve })).toEqual({
      ok: false,
      problem: "url",
    });
    expect(calls).toEqual([]);
  });
});
