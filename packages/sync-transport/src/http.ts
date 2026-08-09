/**
 * The one seam through which anything in this package can reach a network — and
 * it is a parameter, not a capability.
 *
 * ─── Why there is no `fetch` and no origin in this package ──────────────────
 *
 * `CLAUDE.md` states the cloud-off guarantee as a structural one: „the
 * local-only path must not be *able* to reach the network." A transport that
 * constructed its own client would hold that ability whether or not a user ever
 * switched cloud on, and the promise would be back to being a boolean somebody
 * remembers to consult. So this package holds no `fetch`, no `WebSocket`, no
 * base URL and no key. It builds a request and hands it to an {@link HttpPort}
 * the caller supplied. A desktop with cloud off supplies none, and there is
 * nothing here for it to supply one to.
 *
 * That is also why `@supabase/supabase-js` is absent. It is four clients in one
 * (auth, PostgREST, storage, realtime), each with its own `fetch` and its own
 * socket; it would land in the Electron main process beside the SQLCipher key,
 * and it would not have helped with the one genuinely fiddly part — how `bytea`
 * is spelled — which it leaves entirely to the caller. What this layer needs is
 * one table, two verbs and a broadcast channel.
 *
 * ─── The request carries its query already encoded, and that is deliberate ──
 *
 * {@link HttpRequest.path} is the complete path-and-query. A port therefore
 * prepends an origin and adds headers, and cannot get the encoding wrong,
 * because it never sees an unencoded value. That matters more than it sounds:
 * `filterValue` below is the rule that keeps a PATCH from silently matching
 * nothing, and a rule split across two packages is a rule that drifts.
 */

/** The three verbs this product uses. No DELETE: no table here grants one. */
export type HttpMethod = "GET" | "POST" | "PATCH";

export interface HttpRequest {
  readonly method: HttpMethod;
  /**
   * Path and encoded query UNDER the PostgREST root — `/sync_objects?seq=gt.4`.
   * Never a URL: the origin belongs to the port, which is the only place that
   * knows whether there is one.
   */
  readonly path: string;
  /**
   * Everything except authentication. A port adds `apikey` and `Authorization`
   * itself, because a token is a secret with a lifetime and this package has no
   * business holding one across calls.
   */
  readonly headers: Readonly<Record<string, string>>;
  /** Serialised JSON, or `null` for a GET. */
  readonly body: string | null;
}

export interface HttpResponse {
  readonly status: number;
  /** The raw body. Parsing is this package's job, so a port cannot mis-parse it. */
  readonly body: string;
}

export type HttpPort = (request: HttpRequest) => Promise<HttpResponse>;

/**
 * A call to an Edge Function, which is a different root and therefore a
 * different seam.
 *
 * {@link HttpRequest.path} is documented as being under the PostgREST root, and
 * an Edge Function is not: it lives at `/functions/v1/<name>`. Reusing the same
 * type would mean either a port that inspects paths to decide which root to
 * prepend, or a caller that writes `/functions/v1/…` into a field whose contract
 * says it never contains one. Both are the shape of mistake that shows up as a
 * 404 nobody can explain, so the two seams are two types.
 *
 * A port prepends the origin and `/functions/v1/`, and supplies `apikey` and
 * `Authorization` — the long-lived credentials it owns, exactly as for
 * {@link HttpRequest}. Anything in {@link headers} is a PARAMETER OF THE CALL:
 * `sync-enable` carries a second, ephemeral token that authorises one mint and is
 * signed out immediately afterwards, and no port could know it.
 */
export interface FunctionRequest {
  /** The function's name — `sync-enable`. Never a path, never a URL. */
  readonly name: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type FunctionPort = (request: FunctionRequest) => Promise<HttpResponse>;

/** A PostgREST query parameter, value UNENCODED. */
export type QueryParam = readonly [name: string, value: string];

/**
 * PostgREST's error body, which is the same four fields for every failure it
 * reports — including one raised by a trigger, where `code` is the SQLSTATE the
 * `raise` named and `message`/`detail`/`hint` are the strings it wrote.
 */
export interface PostgrestFailure {
  readonly code: string | null;
  readonly message: string | null;
  readonly details: string | null;
  readonly hint: string | null;
}

/**
 * A filter value, percent-encoded and NEVER double-quoted.
 *
 * ─── This is the rule that stops a push from silently doing nothing ─────────
 *
 * A PATCH whose filter matches no row is HTTP 200 with an empty array. It is not
 * an error at any layer: PostgREST is content, the trigger never fires, and a
 * client that does not look at the body records a successful sync of a row that
 * was never written. So the way a filter value is spelled is a correctness rule,
 * not formatting.
 *
 * The instinct is to double-quote — PostgREST documents quoting for values that
 * contain reserved characters, and an object id here can contain anything: a
 * comma, a dot, a quotation mark, a backslash, U+001F (the `note_updates`
 * composite separator), or nothing at all (the six per-profile singletons).
 * **That instinct is wrong, and it fails silently.** Measured against PostgREST
 * as Supabase ships it, over twenty-one id shapes — plain, empty, `a,b`,
 * `2026-08-09.x`, `he said "hi"`, `back\slash`, U+001F, `f(x)`, `a*b`, `a:b`,
 * `a b`, `Ćevapčići`, `a+b`, `100%done`, `a&b`, `a#b`, `a/b`, `null`, `true`,
 * `..`, `is.null` — the percent-encoded bare value matched exactly one row for
 * every single one, and the double-quoted form matched NONE of them, including
 * the plain one. Quoting does not escape the value; it becomes part of it.
 *
 * `encodeURIComponent` is exactly what was measured, which is why it is exactly
 * what is used. Encoding more (`!'()*`, say) would be a guess dressed as
 * caution, and this file has no room for one.
 */
export function filterValue(raw: string): string {
  return encodeURIComponent(raw);
}

/**
 * `?a=b&c=d`, with names taken literally and EVERY value run through
 * {@link filterValue} — the structural ones (`select`, `order`, `limit`) exactly
 * as much as the filters.
 *
 * One rule rather than two, and it is safe because PostgREST percent-decodes the
 * whole query string before it parses anything. Measured, since „decodes first"
 * is the sort of thing that is true until it is not: `select=collection%2Cseq`
 * returns both columns, `order=seq%2Easc` orders, and even `collection=eq%2Eshapes`
 * filters. A second, unencoded path for „values we know are safe" would be one
 * more place for a value to arrive that nobody expected to be user input.
 */
export function queryString(params: readonly QueryParam[]): string {
  if (params.length === 0) return "";
  return `?${params.map(([name, value]) => `${name}=${filterValue(value)}`).join("&")}`;
}

/**
 * A path under the PostgREST root.
 *
 * The table name is NOT encoded and must not be: it is one of three literals in
 * this package, never user input, and encoding it would only make a typo harder
 * to read in a log.
 */
export function postgrestPath(table: string, params: readonly QueryParam[]): string {
  return `/${table}${queryString(params)}`;
}

/**
 * The headers every request carries.
 *
 * `Accept-Profile`/`Content-Profile` are absent on purpose: `config.toml`
 * exposes only `public`, so naming a schema per request would be a second place
 * for that decision to live and a first place for it to disagree.
 */
export function jsonHeaders(prefer?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (prefer !== undefined) headers["Prefer"] = prefer;
  return headers;
}

/**
 * The failure body, or a `PostgrestFailure` of nulls when the server sent
 * something that is not one.
 *
 * Never throws. A body this client cannot parse is itself a fact worth
 * reporting — it is what a proxy's HTML error page, a gateway timeout and a
 * truncated response all look like — and turning it into an exception would put
 * a hostile server in charge of which of this client's code paths run.
 */
export function parseFailure(body: string): PostgrestFailure {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { code: null, message: null, details: null, hint: null };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { code: null, message: null, details: null, hint: null };
  }
  const record = value as Record<string, unknown>;
  const text = (key: string): string | null => {
    const field = record[key];
    return typeof field === "string" ? field : null;
  };
  return {
    code: text("code"),
    message: text("message"),
    details: text("details"),
    hint: text("hint"),
  };
}

/** A successful body as an array of records, or `null` if it is not one. */
export function parseRows(body: string): readonly unknown[] | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  return Array.isArray(value) ? value : null;
}
