// The request-handling primitives every Nexus Edge Function shares.
//
// WHY THIS FILE EXISTS. `pair-complete` was the only function for a while, so
// these lived inside it. `sync-enable` needs five of them, and a hand-copied
// `readBounded` is the shape of defect this project's doctrine names outright:
// a rule that was right in one place and drifts in the other, silently, because
// nothing compares them. Every helper here is a CONTROL — a body cap that fails
// closed, an address reader that cannot be steered by the caller, a decoder that
// pins lengths the caller does not choose — so „copied and slightly different"
// is not a style problem, it is a hole in one endpoint and not the other.
//
// Nothing here reads `Deno.env`, touches a database, or knows what any endpoint
// is for. That is what lets `supabase/tests/static/edge-http.test.mjs` exercise
// all of it under plain Node.

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------
// A malformed request is a client bug rather than a guess about somebody's
// state, so unlike the uniform refusals each endpoint defines for ITS OWN
// failures, this one is allowed to say what was wrong.
export function badRequest(detail: string): Response {
  return new Response(
    JSON.stringify({ error: "bad_request", detail }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

// A server that cannot run its own controls refuses rather than running
// degraded — a missing rate-limit salt must never fall back to „no salt", and a
// missing service-role key must never fall back to „skip the write". 503 rather
// than an endpoint's uniform 401: the uniform refusal exists so the endpoint
// cannot be used as an oracle about an account, and a missing environment
// variable says nothing about any account — while a 401 for a server
// misconfiguration sends whoever is debugging it to look at the client.
export function unavailable(): Response {
  return new Response(
    JSON.stringify({ error: "unavailable" }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Input decoding
// ---------------------------------------------------------------------------
// Base64url, decoded to a fixed length that the caller does not get to choose.
// Returning null rather than throwing keeps every validation failure on one path
// — a thrown decode error inside a `try` that also wraps the database call would
// be reported as a server fault, and a malformed field would look like an outage.
export function decodeFixed(value: unknown, expectedBytes: number): Uint8Array | null {
  const out = decodeBase64(value, 4096);
  return out !== null && out.length === expectedBytes ? out : null;
}

export function decodeBounded(value: unknown, min: number, max: number): Uint8Array | null {
  const out = decodeBase64(value, 8192);
  return out !== null && out.length >= min && out.length <= max ? out : null;
}

function decodeBase64(value: unknown, maxChars: number): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) return null;
  // Accept both alphabets: the desktop and the web build encode with different
  // helpers, and rejecting `+`/`/` here would be a bug that only appears on one
  // of the two clients, which is the kind that ships.
  const normalised = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// PostgREST speaks `bytea` as a hex string with a leading backslash-x. Building
// it here rather than sending base64 keeps the database from having to guess an
// encoding, and a wrong guess would compare a digest against its own base64
// text and never match — a failure that looks exactly like „not found".
export function toPgBytea(bytes: Uint8Array): string {
  return `\\x${toHex(bytes)}`;
}

export async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  let total = 0;
  for (const part of parts) total += part.length;
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------
// The cheap refusal, and it FAILS CLOSED. The natural shape is
// `Number.isFinite(n) && n > MAX` — which skips the check whenever the header is
// absent (`Number("") === 0`) or unparseable (`Number("abc")` is NaN), i.e.
// exactly when the caller is not being straightforward. A guard whose condition
// is „the input was well-formed AND too big" declines to guard against malformed
// input, which is the input worth guarding against.
//
// This is a CLAIM and not the control: `content-length` is absent under chunked
// encoding and is free to be a lie. It is here because it costs nothing and
// refuses the honest oversized caller before a byte of body arrives.
// RFC 9110 spells `Content-Length` as `1*DIGIT`, and matching that grammar is
// not pedantry: `Number()` is a JavaScript literal parser, so it reads `0x10` as
// 16, `1e9` as a billion and `  12  ` as twelve. A guard written on `Number`
// alone therefore forms an opinion about strings no HTTP parser would accept,
// and forms the WRONG one — `0x10` sails under any budget. The real control
// below is unaffected either way, which is exactly why this one has to be exact:
// a courtesy check that quietly means something else is how a reader concludes
// the budget is enforced here.
export function declaredLengthOk(req: Request, maxBytes: number): boolean {
  const declared = req.headers.get("content-length");
  if (declared === null) return true;
  if (!/^\d+$/.test(declared)) return false;
  return Number(declared) <= maxBytes;
}

// The control. Reads at most `maxBytes` off the request body and returns null
// the instant the budget is exceeded, cancelling the stream rather than draining
// it. Returning null instead of throwing keeps every rejection on one path.
//
// `await req.text()` cannot play this role no matter what is asserted about its
// result: by the time it resolves the whole body has been received and decoded,
// and a length check there protects `JSON.parse` and nothing else.
export async function readBounded(req: Request, maxBytes: number): Promise<string | null> {
  if (req.body === null) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      // Cancelled, not broken out of. `break` alone leaves the sender writing
      // into a stream nobody is reading, which is the same transfer this limit
      // exists to refuse — just with the cost moved to the socket.
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/** A JSON object body, or null for „not an object". Arrays are not objects here. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Callers
// ---------------------------------------------------------------------------
// The address this request came from, as the PLATFORM reports it — which is not
// the same thing as what the caller says, and the difference is the whole of
// this function.
//
// `x-forwarded-for` is a list that grows to the RIGHT: each proxy appends the
// address it received the connection from. So the leftmost entry is whatever the
// original client wrote, and it is writable by anyone — `x-forwarded-for:
// 203.0.113.<random>` on every request yields a fresh rate-limit bucket every
// time, and a per-address limiter stops firing at all. Reading position [0] is
// the standard shape of this bug and it disables the control silently: the
// limiter still runs, still writes rows, still returns true.
//
// So: `cf-connecting-ip` first, because an edge that sets it overwrites whatever
// the client sent, and only then the RIGHTMOST forwarded hop, which is the entry
// the closest trusted proxy appended and therefore the only one the caller could
// not choose.
//
// THE CAVEAT, WHICH MUST BE CHECKED ON THE REAL PLATFORM AND NOT ASSUMED. If more
// than one proxy appends, the rightmost hop is an internal address shared by
// every caller, and the per-address limiter collapses into one global bucket.
// That fails in the safe direction — everyone is limited together rather than
// nobody being limited — but it is an outage rather than a control, so the
// deployment step in the README says to confirm which header actually carries
// the client address before trusting this.
export function callerAddress(req: Request): string {
  const direct = req.headers.get("cf-connecting-ip")?.trim();
  if (direct !== undefined && direct.length > 0) return direct;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter((hop) => hop.length > 0);
    const nearest = hops[hops.length - 1];
    if (nearest !== undefined) return nearest;
  }
  // Not a fallback to „no limit": every caller the platform cannot identify
  // shares this one bucket, so an unidentifiable flood limits itself.
  return "unknown";
}

// A request that carries an `Origin` header came from a browsing context. Both
// Nexus endpoints are called by the desktop's Electron MAIN process — a
// server-to-server fetch, which sends no `Origin` — so its presence means the
// caller is a web page, and no web page has business at either endpoint.
//
// WHY THIS IS NOT REDUNDANT WITH „WE SEND NO CORS HEADERS". Absent CORS headers
// stop a page from READING the response. They do not stop the request: a form
// post, or `fetch` with a `content-type` the spec calls simple, is sent
// cross-origin without a preflight and the server executes it. For an endpoint
// that changes state — and both of these do — an unreadable response is not a
// refusal. This is the refusal, and it happens before anything is parsed.
export function fromBrowsingContext(req: Request): boolean {
  return req.headers.get("origin") !== null;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
/**
 * The claims of a JWT, read WITHOUT VERIFYING ANYTHING — no signature, no
 * issuer, no expiry. The name says `unverified` because every call site has to
 * justify itself, and there are exactly two justifications:
 *
 *  1. The token did not come from a client (`pair-complete` reads the
 *     `session_id` out of a token its own auth server just minted), or
 *  2. the value is used only to decide whether to spend a network round trip on
 *     verifying it, and the verified answer replaces it afterwards.
 *
 * Anything else — deciding an account, an assurance level, an authorisation —
 * on the strength of this return value is forgery-by-typing: the payload of a
 * JWT is base64 of whatever the sender wrote.
 */
export interface UnverifiedClaims {
  readonly sub: string | null;
  readonly sessionId: string | null;
  readonly exp: number | null;
}

export function unverifiedClaims(accessToken: string): UnverifiedClaims | null {
  const parts = accessToken.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined) return null;
  try {
    const normalised = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
    const decoded: unknown = JSON.parse(atob(padded));
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return null;
    const claims = decoded as Record<string, unknown>;
    const str = (name: string): string | null => {
      const value = claims[name];
      return typeof value === "string" && value.length > 0 ? value : null;
    };
    const exp = claims["exp"];
    return {
      sub: str("sub"),
      sessionId: str("session_id"),
      exp: typeof exp === "number" && Number.isFinite(exp) ? exp : null,
    };
  } catch {
    return null;
  }
}
