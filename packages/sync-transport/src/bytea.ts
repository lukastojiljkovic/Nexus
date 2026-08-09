/**
 * `bytea` ↔ base64url, which is the one translation nobody else in this product
 * can do for us.
 *
 * The crypto layer speaks base64url: `SealedRow.nonce` and `SealedRow.ciphertext`
 * are base64url strings, and `parsePulledRow` checks their decoded lengths
 * against the server's own CHECKs. PostgREST speaks Postgres' hex `bytea`
 * output — a JSON string whose first two characters are a backslash and an `x`,
 * followed by two lowercase hex digits per byte — in BOTH directions: it is what
 * a select returns and what an insert accepts. Neither side is going to move, so
 * the mapping lives here, in the layer `wire.ts` names as its owner: „mapping it
 * onto PostgREST's JSON — including how `bytea` is spelled — is the transport's
 * business and nobody else's."
 *
 * ─── The cost, stated rather than discovered ────────────────────────────────
 *
 * Hex is two characters per byte, so a row at the 4 MiB ciphertext ceiling
 * crosses the wire as 8 MiB of JSON, and again as 8 MiB coming back. That is the
 * price of PostgREST's representation and it is not avoidable from a client:
 * asking for base64 would need a computed column or a view, i.e. server surface,
 * and the server surface here is deliberately small. It is bounded — the CHECK
 * is 4 MiB and attachments are not in this table at all — so it is a cost, not a
 * risk, and it is written down so the next reader does not go looking for a leak
 * when a large note is slow.
 *
 * ─── Why the legacy `escape` format is refused rather than parsed ───────────
 *
 * `bytea_output` can be set to `escape`, in which case the same column comes
 * back as a mixture of printable characters and `\\nnn` octal escapes. Supabase
 * ships the default (`hex`) and nothing in this product changes it, so a value
 * in the other format means the database is not the one this client was written
 * against. Parsing it would be guessing at that point; refusing it names the
 * situation.
 */

import { base64urlToBytes, bytesToBase64url } from "@nexus/sync-crypto/web";

/**
 * Postgres' hex output. The `\x` prefix, then an EVEN number of hex digits.
 *
 * Upper case is accepted on the read side because the format permits it, even
 * though Postgres itself emits lower; the write side emits lower only, so a
 * round trip through this file is stable.
 */
const HEX_BYTEA = /^\\x(?:[0-9a-fA-F]{2})*$/;

/**
 * One `bytea` from a PostgREST response, as base64url — or `null` if it is not
 * a `bytea` at all.
 *
 * `null` rather than a throw for the reason the whole pull path returns rather
 * than throws: the input is a hostile server's, and every one of its shapes has
 * to be a value this client can decide about.
 */
export function byteaToBase64url(value: unknown): string | null {
  if (typeof value !== "string" || !HEX_BYTEA.test(value)) return null;
  const digits = value.length - 2;
  const bytes = new Uint8Array(digits / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    // `parseInt` on a two-character slice, not a lookup table: the regex has
    // already established that every character is a hex digit, so there is no
    // NaN to defend against and no radix to get wrong.
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return bytesToBase64url(bytes);
}

/**
 * The reverse, for a value this client produced.
 *
 * It THROWS on a malformed input, and that asymmetry with the function above is
 * the point: what goes out was made by `sealRow` two function calls ago, so a
 * bad value here is this client's own bug. Sending it would store 17 bytes of
 * something nobody can open under a version number that then cannot be reused,
 * which is a self-inflicted version of the tampering NX003 exists to refuse.
 */
export function base64urlToBytea(value: string): string {
  const bytes = base64urlToBytes(value);
  if (bytes === null) throw new TypeError("sync-transport: not base64url, refusing to send it as bytea");
  let hex = "\\x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
