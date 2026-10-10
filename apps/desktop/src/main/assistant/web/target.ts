import type { NetworkMode } from "../../net/offline.js";
import { allowsWebRequest, webSearchActive, type WebConfig } from "./gate.js";
import { WEB_LIMITS } from "./limits.js";

/**
 * WHERE A WEB REQUEST MAY GO, WHICH IS NOT A HOST LIST (ADR-097).
 *
 * `net/offline.ts` states the door rule the rest of the product is built on:
 * https only, and the host matched EXACTLY against a compiled-in list. That
 * works because the reachable set is a fact about the binary — three GitHub
 * hosts, and whatever a download manifest names. A search the user asked for
 * has no such set: the destination is the RESULT, and a query is a question the
 * user typed into a browser that happens to be in the app.
 *
 * So this module states the other half of the boundary, and it is a different
 * half: not „which names" but „which ADDRESSES". Every request resolves the
 * host first and connects to an address that provably is not private, loopback,
 * link-local, carrier-grade NAT, multicast or reserved. That is the rule that
 * matters here, because the interesting attack on a fetch-the-URL-the-model-asked
 * -for feature is not a hostile web server — it is `http://192.168.1.1/` and
 * `https://[::1]/` and the cloud metadata service, and every one of those is
 * caught by the address and by nothing else.
 *
 * A LITERAL ADDRESS NEVER REACHES THE RESOLVER. `https://2130706433/` is
 * `127.0.0.1` written in decimal, and the WHATWG URL parser this code and Node
 * both use normalises it to `127.0.0.1` — so the check below sees an address
 * literal in `url.hostname` and judges it directly. A name is resolved only
 * when it is a name.
 *
 * EVERY ANSWER HAS TO BE PUBLIC, not just the one this process connects to. A
 * name that resolves to one public address and one private one is refused
 * outright: that is what a DNS-rebinding attempt looks like from here, and
 * picking „the public one" would be picking the answer the attacker did not
 * want this time. The connection that follows is pinned to an address this
 * function checked (`transport.ts` hands it to `https.request` as `lookup`), so
 * the name is not re-resolved behind the check's back.
 */

/** One address a host name resolved to, as `dns.lookup` reports it. */
export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** The resolver, as a port. `dns.promises.lookup(…, { all: true })` in main; a table in tests. */
export type AddressResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

/** Why a destination was refused. Machine codes; `copy.ts` maps each to its sentence. */
export type TargetProblem =
  /** Web search is off, or this launch's mode does not allow it. */
  | "off"
  /** Not https, not a URL, or a URL carrying a credential. */
  | "url"
  /** The host resolved to an address the product may not reach. */
  | "address"
  /** The host did not resolve at all, or answered with more addresses than one name may have. */
  | "resolve";

/**
 * A destination that passed every check, with the addresses it may connect to.
 *
 * This is the only thing `WebHttp.request` accepts, which is how „the SSRF check
 * happened" stops being a promise a caller keeps voluntarily: there is no way to
 * hand the transport a URL, so there is no way to skip the check that produces
 * this record. It is the same trick as the download service's required
 * `expectedSha256`, done in the type rather than in a rule.
 */
export interface VettedTarget {
  readonly url: URL;
  readonly hostname: string;
  /** Public addresses for `hostname`, in the resolver's order. Never empty. */
  readonly addresses: readonly ResolvedAddress[];
}

export type TargetOutcome =
  | { readonly ok: true; readonly target: VettedTarget }
  | { readonly ok: false; readonly problem: TargetProblem };

export type ShapeOutcome =
  | {
      readonly ok: true;
      readonly url: URL;
      readonly hostname: string;
      /** Already an address literal, which needs no resolver - see the header. */
      readonly literal: ResolvedAddress | null;
    }
  | { readonly ok: false; readonly problem: TargetProblem };

/**
 * The four bytes of an IPv4 literal, or `null`.
 *
 * `node:net`'s `isIP` is deliberately NOT used here, and the reason is the
 * boundary this module is: importing it would put a Node network module into
 * the file whose whole job is deciding what may be reached, and `check:egress`
 * treats `node:net` as a network module because it mostly is one. A dotted quad
 * is four decimal groups, and the WHATWG URL parser this file and the socket
 * share has already turned every other spelling of an IPv4 literal (decimal,
 * octal, hexadecimal) into that shape by the time a URL's hostname is read.
 */
function ipv4Parts(ip: string): readonly number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  // The text is checked as well as the number: `Number("")` is 0 and
  // `Number(" 1")` is 1, and neither `".1.2.3"` nor `"1.2.3. 4"` is an address.
  if (!parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map((part) => Number(part));
  return numbers.every((value) => value >= 0 && value <= 255) ? numbers : null;
}

/**
 * The IPv4 ranges this product refuses, from IANA's registries.
 *
 * Each entry is a list [network prefix, prefix length] in the notation the
 * registry uses, and each one is here for a stated reason rather than for
 * tidiness:
 *
 *   - `0.0.0.0/8` „this network": 0.0.0.0 is the unspecified address, and on
 *     some stacks an address in this block is interpreted as a LOCAL one.
 *   - `10/8`, `172.16/12`, `192.168/16` — RFC 1918, the private internets.
 *   - `100.64/10` — RFC 6598 carrier-grade NAT, which on a phone tether is the
 *     network this process is ON.
 *   - `127/8` — loopback, the whole block and not only 127.0.0.1.
 *   - `169.254/16` — link-local, which is where the cloud metadata services
 *     live (`169.254.169.254`).
 *   - `192.0.0/24`, `192.0.2/24`, `198.18/15`, `198.51.100/24`, `203.0.113/24`
 *     — protocol assignments and the three documentation blocks. Nothing
 *     answers there, and a name that resolves into one is a lookup something
 *     else has taken over.
 *   - `224/4` multicast and `240/4` reserved (which contains the broadcast
 *     address). Neither is a page.
 */
const PRIVATE_IPV4_RANGES: readonly (readonly [readonly number[], number])[] = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

/** True when an IPv4 literal falls inside `range`, compared as a 32-bit number. */
function isInIpv4Range(parts: readonly number[], range: readonly number[], bits: number): boolean {
  const value = parts.reduce((acc, part) => acc * 256 + part, 0);
  const base = range.reduce((acc, part) => acc * 256 + part, 0);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((value ^ base) & mask) >>> 0 === 0;
}

/**
 * The groups of one half of an IPv6 literal, with a dotted IPv4 tail expanded
 * into the TWO hex groups it stands for.
 *
 * The expansion is what the counting below depends on: `::ffff:1.2.3.4` is six
 * empty groups plus two, and a parser that counted the dotted tail as one group
 * would build fourteen bytes and refuse a perfectly ordinary address.
 */
function expandIpv6Groups(parts: readonly string[]): readonly string[] | null {
  const groups: string[] = [];
  for (const part of parts) {
    if (!part.includes(".")) {
      groups.push(part);
      continue;
    }
    const quad = part.split(".").map((piece) => Number(piece));
    if (quad.length !== 4 || quad.some((piece) => !Number.isInteger(piece) || piece < 0 || piece > 255)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = quad;
    groups.push(((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
  }
  return groups;
}

/** The sixteen bytes of an IPv6 address, or `null` when `ip` is not one this code can read. */
function ipv6Bytes(ip: string): readonly number[] | null {
  // A colon is what makes a literal IPv6, and it is also what keeps this
  // function from reading a host name as one.
  if (!ip.includes(":")) return null;
  // This parser owns the syntax, so it expands `::` and validates every group.
  const separator = ip.indexOf("::");
  const head = separator === -1 ? ip : ip.slice(0, separator);
  const tail = separator === -1 ? "" : ip.slice(separator + 2);
  const headParts = head === "" ? [] : head.split(":");
  const tailParts = tail === "" ? [] : tail.split(":");
  // An empty group means a second `::`, which no address has. (`1::2::3` is not
  // an address, and neither is `:::1`.)
  if ([...headParts, ...tailParts].some((part) => part === "")) return null;
  const headGroups = expandIpv6Groups(headParts);
  const tailGroups = expandIpv6Groups(tailParts);
  if (headGroups === null || tailGroups === null) return null;
  const missing = 8 - headGroups.length - tailGroups.length;
  // Without a `::` the eight groups have to be exactly eight; with one, `::`
  // stands for one group at the very least.
  if (separator === -1 ? missing !== 0 : missing < 0) return null;
  const groups = [...headGroups, ...Array.from({ length: missing }, () => "0"), ...tailGroups];
  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

/**
 * Which family an address literal belongs to, or `0` when this is a NAME.
 *
 * Exported because it is the question `vetUrlShape` asks before it decides
 * whether a resolver is needed at all: a literal is judged here and never
 * resolved, which is what makes `https://127.0.0.1/`, `https://2130706433/` and
 * `https://[::1]/` refusals that cost no lookup.
 */
export function ipFamilyOf(host: string): 0 | 4 | 6 {
  if (ipv4Parts(host) !== null) return 4;
  return ipv6Bytes(host) !== null ? 6 : 0;
}

/** The dotted IPv4 address a `::ffff:a.b.c.d` (or `64:ff9b::` NAT64) literal carries, or `null`. */
function embeddedIpv4(bytes: readonly number[]): string | null {
  const isMapped =
    bytes.slice(0, 10).every((byte) => byte === 0) && bytes.slice(10, 12).every((byte) => byte === 0xff);
  const isNat64 =
    bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0);
  if (!isMapped && !isNat64) return null;
  return bytes.slice(12).join(".");
}

/**
 * True when this address literal is one the product may reach.
 *
 * Deliberately a LIST of ranges rather than „anything that is not obviously
 * public", because the failure this function has to prevent is the one where an
 * address nobody thought about is treated as public. Where a range is not
 * obvious the comment above says why it is refused, and this function refuses
 * an address it cannot parse at all — `isIP` answering 0 is not „public", it is
 * „not an address", and the resolver is what turns a name into one.
 */
export function isPublicAddress(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4 !== null) {
    return !PRIVATE_IPV4_RANGES.some(([range, bits]) => isInIpv4Range(v4, range, bits));
  }
  const bytes = ipv6Bytes(ip);
  if (bytes === null) return false;
  // A v4-mapped (or NAT64) address is an IPv4 destination wearing IPv6 clothes,
  // so it is judged as the IPv4 address it carries — refusing it wholesale would
  // also refuse the public ones, and allowing it wholesale would admit
  // `::ffff:127.0.0.1`.
  const mapped = embeddedIpv4(bytes);
  if (mapped !== null) return isPublicAddress(mapped);
  const isUnspecified = bytes.every((byte) => byte === 0);
  const isLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const first = bytes[0] ?? -1;
  const second = bytes[1] ?? -1;
  const isUniqueLocal = (first & 0xfe) === 0xfc;
  const isLinkLocal = first === 0xfe && (second & 0xc0) === 0x80;
  // 2001:db8::/32 is the documentation prefix; 2001:0::/32 and 2002::/16
  // (Teredo and 6to4) tunnel an address this check cannot see, so the tunnel and
  // not the destination would be what the socket reaches.
  const isDocumentation = first === 0x20 && second === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
  const isTunnel = (first === 0x20 && second === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) || (first === 0x20 && second === 0x02);
  const isMulticast = first === 0xff;
  return !(
    isUnspecified ||
    isLoopback ||
    isUniqueLocal ||
    isLinkLocal ||
    isDocumentation ||
    isTunnel ||
    isMulticast
  );
}

/**
 * The half of the check that needs no network: the switch, the URL's shape, and
 * an address the URL states outright.
 *
 * It exists as its own function because the TOOL asks it before the user is
 * asked anything: a call the gate refuses on its face (`http:`, a credential, a
 * loopback literal) must not raise a confirmation dialog, and a name that has to
 * be resolved must not be resolved before the user has agreed to the request.
 * The split is therefore „everything decidable from the URL alone" here, and
 * „resolve, then judge every answer" in {@link vetUrl} - which the fetch calls
 * on every hop, after the dialog.
 */
export function vetUrlShape(rawUrl: string, mode: NetworkMode, config: WebConfig): ShapeOutcome {
  // The switch first, and it is not decoration: a user who has web search off
  // gets no DNS lookup either.
  if (!webSearchActive(mode, config)) return { ok: false, problem: "off" };
  if (!allowsWebRequest(mode, config, rawUrl)) return { ok: false, problem: "url" };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, problem: "url" };
  }
  // A credential in a URL is not a credential the user typed, and
  // `https://wikipedia.org@evil.example/` is a citation that names one host
  // while opening another. Nothing in this feature needs userinfo.
  if (url.username !== "" || url.password !== "") return { ok: false, problem: "url" };

  // `URL` keeps the brackets of an IPv6 literal, and `isIP` does not know them.
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (hostname === "") return { ok: false, problem: "resolve" };
  const literalFamily = ipFamilyOf(hostname);
  if (literalFamily !== 0) {
    return isPublicAddress(hostname)
      ? { ok: true, url, hostname, literal: { address: hostname, family: literalFamily } }
      : { ok: false, problem: "address" };
  }
  return { ok: true, url, hostname, literal: null };
}

/**
 * Vets one URL completely, and is called for EVERY hop a redirect takes this
 * process on.
 *
 * A hop that fails any check ends the chain with nothing sent to the host that
 * failed it.
 */
export async function vetUrl(
  rawUrl: string,
  deps: {
    readonly mode: NetworkMode;
    readonly config: WebConfig;
    readonly resolve: AddressResolver;
  },
): Promise<TargetOutcome> {
  const shape = vetUrlShape(rawUrl, deps.mode, deps.config);
  if (!shape.ok) return shape;
  const { url, hostname, literal } = shape;
  if (literal !== null) return { ok: true, target: { url, hostname, addresses: [literal] } };

  let resolved: readonly ResolvedAddress[];
  try {
    resolved = await deps.resolve(hostname);
  } catch {
    return { ok: false, problem: "resolve" };
  }
  if (resolved.length === 0) return { ok: false, problem: "resolve" };
  if (resolved.length > WEB_LIMITS.maxAddresses) return { ok: false, problem: "resolve" };
  for (const entry of resolved) {
    if (!isPublicAddress(entry.address)) return { ok: false, problem: "address" };
  }
  return { ok: true, target: { url, hostname, addresses: resolved } };
}
