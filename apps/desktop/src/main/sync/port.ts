/**
 * The desktop's two ports — and the reason they are built here rather than
 * anywhere a renderer can reach.
 *
 * ─── The cloud-off boundary does not cover the main process for free ────────
 *
 * `net/offline.ts` installs four layers, and three of them are Chromium's: the
 * `webRequest` allowlist, the dead proxy, and the resolver block. All three act
 * on requests that go through a **session**. Node's global `fetch` in the main
 * process goes through none of them — it is undici on its own socket, and it
 * would have made the guarantee „cloud off means no packets" false the moment
 * the first sync call was written, with nothing in a code review to see.
 *
 * So this file never calls `fetch`. It takes a {@link CloudFetch} the caller
 * supplies, and the only implementation in the product is
 * `electronFetch.ts` — `net.fetch(url, { session: session.defaultSession })` —
 * which runs on the same session as everything else and is therefore cancelled
 * by layer 1 when cloud is off. That is the whole argument, and it is why this
 * module is pure and its one impure sibling is twenty lines.
 *
 * The second half of the guarantee is arithmetic rather than trust:
 * {@link createCloudPorts} returns `null` unless cloud is on AND a project is
 * configured. A build with neither has no port object in existence, and
 * `@nexus/sync-transport` holds no `fetch` of its own to fall back to.
 *
 * ─── What a port adds, and what it must never add ───────────────────────────
 *
 * It adds the origin, `apikey`, and `Authorization` — the long-lived
 * credentials, exactly as `@nexus/sync-transport`'s header says a port owns. It
 * does NOT add an `Origin` header: `sync-enable` refuses any request that
 * carries one, because a main-process fetch is not a browsing context and a
 * request that claims to be one is a web page trying to mint a master key.
 */

import type {
  AuthPort,
  AuthRequest,
  FunctionPort,
  FunctionRequest,
  HttpPort,
  HttpRequest,
  HttpResponse,
} from "@nexus/sync-transport";

import type { CloudConfig } from "./config.js";

/**
 * The one capability this module needs, as a parameter.
 *
 * Deliberately narrower than `fetch`: a URL string, a method, headers and an
 * optional body, answering with a status and text. Nothing here can set a
 * credential mode, follow a redirect chain by choice, or reach a stream — and a
 * seam that cannot express those is a seam nobody has to review for them.
 */
export type CloudFetch = (request: {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}) => Promise<HttpResponse>;

/** All three ports, or `null` — see the header on why that is the whole boundary. */
export interface CloudPorts {
  readonly http: HttpPort;
  readonly functions: FunctionPort;
  readonly auth: AuthPort;
  /**
   * A PostgREST port presenting a token this desktop is deliberately NOT keeping.
   *
   * Exactly one flow needs it. Adopting an account with the Sync Recovery Code
   * has to write a `devices` row, and `devices_insert_requires_aal2` means that
   * write is only legal from a stepped-up session — while `session.ts` refuses
   * to hold an `aal2` session at all, because `aal` survives every refresh and an
   * `aal2` desktop would have browser powers over every device row on the account
   * for the life of the machine.
   *
   * Both rules are right, and they meet here. The answer is a port that presents
   * a token passed to it, used for the two calls that must be `aal2` and dropped
   * with the function that made it — rather than relaxing the holder, which would
   * trade a five-second exposure for a permanent one.
   */
  readonly httpAs: (accessToken: string) => HttpPort;
}

export interface CloudPortOptions {
  readonly config: CloudConfig;
  /**
   * The access token to present, read at CALL time rather than captured.
   *
   * A token has a lifetime and is refreshed; a port that closed over one would
   * keep presenting the expired copy, and the failure — 401 on every request
   * after an hour — looks like a server problem. `null` means „send the anon key
   * as the bearer", which is what an unauthenticated call to a function looks
   * like on this platform.
   */
  readonly accessToken: () => string | null;
  readonly fetch: CloudFetch;
}

/** PostgREST lives under this prefix on every Supabase project. */
const REST_PREFIX = "/rest/v1";

/** Edge Functions live under this one. */
const FUNCTIONS_PREFIX = "/functions/v1";

/** And GoTrue under this one. */
const AUTH_PREFIX = "/auth/v1";

/**
 * Lower-case letters, digits and hyphens. A function name reaches a URL path,
 * and a name containing `/`, `..` or a percent escape would reach a different
 * endpoint than the one the caller asked for.
 */
const FUNCTION_NAME = /^[a-z][a-z0-9-]{0,62}$/;

/**
 * The cap on a response body.
 *
 * NOT a security bound — the origin allowlist already means the only reachable
 * host is the one that holds this account's ciphertext. It is the line between
 * a named refusal and an opaque runtime failure: `response.text()` builds a
 * JavaScript string, and V8 refuses one past roughly 512 MiB with `Invalid
 * string length`, which arrives with no indication of what asked for it.
 *
 * A pull page is 500 rows and a row's ciphertext is capped at 4 MiB by the
 * server, so a legitimate page can in principle be far larger than this. That is
 * a theoretical shape rather than a real one — it needs 500 consecutive
 * half-megabyte rows — and if it is ever reached, the fix is a smaller page,
 * not a bigger string.
 */
export const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;

export function restUrl(config: CloudConfig, path: string): string {
  if (!path.startsWith("/")) {
    throw new TypeError(`sync: a PostgREST path must start with "/", got ${JSON.stringify(path)}`);
  }
  return `${config.url}${REST_PREFIX}${path}`;
}

export function functionUrl(config: CloudConfig, name: string): string {
  if (!FUNCTION_NAME.test(name)) {
    throw new TypeError(`sync: not a function name: ${JSON.stringify(name)}`);
  }
  return `${config.url}${FUNCTIONS_PREFIX}/${name}`;
}

export function authUrl(config: CloudConfig, path: string): string {
  if (!path.startsWith("/")) {
    throw new TypeError(`sync: an auth path must start with "/", got ${JSON.stringify(path)}`);
  }
  return `${config.url}${AUTH_PREFIX}${path}`;
}

/**
 * The caller's headers plus the two the port owns.
 *
 * The port's own headers are written LAST on purpose. `apikey` and
 * `Authorization` are this port's responsibility, and a request object that
 * happened to carry either — from a caller that thought it was helping — must
 * not be able to replace the credential the port was constructed with.
 */
export function cloudHeaders(
  config: CloudConfig,
  headers: Readonly<Record<string, string>>,
  accessToken: string | null,
): Record<string, string> {
  return {
    ...headers,
    apikey: config.anonKey,
    // The anon key doubles as the bearer for an unauthenticated call. That is
    // this platform's shape, not a fallback to „no authentication": what an
    // `anon` bearer may do is decided by row level security, and migration 002
    // revokes `anon` from every table in this schema.
    Authorization: `Bearer ${accessToken ?? config.anonKey}`,
  };
}

export function createHttpPort(options: CloudPortOptions): HttpPort {
  return async (request: HttpRequest): Promise<HttpResponse> =>
    options.fetch({
      url: restUrl(options.config, request.path),
      method: request.method,
      headers: cloudHeaders(options.config, request.headers, options.accessToken()),
      body: request.body,
    });
}

export function createFunctionPort(options: CloudPortOptions): FunctionPort {
  return async (request: FunctionRequest): Promise<HttpResponse> =>
    options.fetch({
      url: functionUrl(options.config, request.name),
      method: "POST",
      headers: cloudHeaders(options.config, request.headers, options.accessToken()),
      body: request.body,
    });
}

/**
 * The auth port, which adds `apikey` and DELIBERATELY NOT `Authorization`.
 *
 * `AuthRequest`'s doc comment carries the argument in full; the short form is
 * that auth is the one root where the bearer is a parameter of the call rather
 * than a property of the client. Signing in has none. Refreshing has none.
 * Stepping up carries the session being stepped up; signing out carries the
 * session being ended — which is by definition not the one being kept. A port
 * that wrote its own token last, as the other two correctly do, would sign the
 * DEVICE session out at the end of the enable flow and leave the desktop locked
 * out of the account it had just enabled.
 *
 * The port is named `send` and not `fetch` deliberately. A parameter called
 * `fetch` shadows the global one, so the day somebody deletes the parameter —
 * or reorders the arguments — `fetch({…})` keeps compiling and silently becomes
 * Node's global, which reaches the network through none of the four cloud-off
 * layers. There is no name in this file that a missing binding could turn into
 * a socket, and `check-egress`'s bare-`fetch(` rule is what keeps it that way.
 */
export function createAuthPort(config: CloudConfig, send: CloudFetch): AuthPort {
  return async (request: AuthRequest): Promise<HttpResponse> =>
    send({
      url: authUrl(config, request.path),
      method: request.method,
      headers: { ...request.headers, apikey: config.anonKey },
      body: request.body,
    });
}

/**
 * All three ports, or `null` when this device must not reach a network at all.
 *
 * The two conditions are separate facts and both are required: the user has
 * turned cloud on for this computer (`cloud.json`, read at launch), and this
 * build knows which project to talk to. Either one absent means no port object
 * exists — not a port that refuses, which is a thing somebody can later be
 * tempted to make an exception in.
 */
export function createCloudPorts(
  cloudEnabled: boolean,
  config: CloudConfig | null,
  rest: Omit<CloudPortOptions, "config">,
): CloudPorts | null {
  if (!cloudEnabled || config === null) return null;
  const options: CloudPortOptions = { ...rest, config };
  return {
    http: createHttpPort(options),
    functions: createFunctionPort(options),
    auth: createAuthPort(config, rest.fetch),
    // A CONSTANT `accessToken`, and the only one in this file. Everywhere else
    // the token is read at call time because it is refreshed; this port exists
    // for the length of one function call against a session that is signed out
    // at the end of it, so a token that could change under it would be the bug,
    // not the feature.
    httpAs: (accessToken: string) => createHttpPort({ ...options, accessToken: () => accessToken }),
  };
}
