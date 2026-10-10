import { describe, expect, it } from "vitest";

import { pinnedLookup, type PinnedLookup } from "./transport.js";

/**
 * THE PINNING RULE, which is the half of the transport that decides something.
 *
 * `createHttpsTransport` opens a socket and needs no test that a unit suite can
 * honestly run; `pinnedLookup` is a function of a table, and it is the function
 * that makes the address check (`target.ts`) hold at the socket rather than only
 * on paper. Both reply shapes `dns.lookup` has are asserted, because which one
 * Node asks for depends on `autoSelectFamily`, and a lookup that answered the
 * wrong shape would fail only on some machines.
 */

const ADDRESSES = [
  { address: "93.184.216.34", family: 4 as const },
  { address: "2606:4700:4700::1111", family: 6 as const },
];

/**
 * The two shapes `dns.lookup` answers with, spelled here rather than imported:
 * `node:dns` is a network module as far as `check:egress` is concerned (my own
 * new rule), and a test that needed an exemption to describe a table would be
 * asking the gate to stop looking at the thing it is looking for.
 */
type LookupAnswer = string | readonly { readonly address: string; readonly family: number }[];

/** One call to the lookup, with the reply it produced. */
function callLookup(
  lookup: PinnedLookup,
  options: { readonly family?: number | "IPv4" | "IPv6"; readonly all?: boolean },
): {
  readonly error: NodeJS.ErrnoException | null;
  readonly address: LookupAnswer;
  readonly family: number | undefined;
} {
  let error: NodeJS.ErrnoException | null = null;
  let address: LookupAnswer = "";
  let family: number | undefined;
  lookup("example.org", options, (err, value, recordFamily) => {
    error = err;
    address = value;
    family = recordFamily;
  });
  return { error, address, family };
}

describe("pinnedLookup", () => {
  it("answers the vetted address and never asks DNS", () => {
    const answer = callLookup(pinnedLookup(ADDRESSES), { family: 4 });
    expect(answer.error).toBeNull();
    expect(answer.address).toBe("93.184.216.34");
    expect(answer.family).toBe(4);
  });

  it("answers the LIST when Node asks for one, in the resolver's order", () => {
    const answer = callLookup(pinnedLookup(ADDRESSES), { all: true });
    expect(answer.address).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
  });

  it("honours a requested family, and both spellings of it", () => {
    for (const family of [6, "IPv6" as const]) {
      const answer = callLookup(pinnedLookup(ADDRESSES), { family });
      expect(answer.address).toBe("2606:4700:4700::1111");
      expect(answer.family).toBe(6);
    }
    expect(callLookup(pinnedLookup(ADDRESSES), { family: "IPv4" }).address).toBe("93.184.216.34");
  });

  it("fails rather than substituting another family's address", () => {
    const answer = callLookup(pinnedLookup([{ address: "93.184.216.34", family: 4 }]), { family: 6 });
    expect(answer.error?.code).toBe("ENOTFOUND");
    expect(answer.address).toBe("");
  });
});
