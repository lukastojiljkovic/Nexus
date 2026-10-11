/**
 * The serial permission rule, as a pure function (SEC-EL, and ADR-090's
 * shared-permission pattern).
 *
 * **Why this is its own file rather than a condition in `main/index.ts`.** The
 * session's permission handlers are one place several modules extend at once,
 * and a handler whose body was rewritten by every module that needed a rule is a
 * handler nobody can read. So the SHAPE is fixed here — `allows(permission,
 * origin, details)`, a pure function of what the handler was given — and the
 * handler's line is the call. `main/index.ts` states the same argument at the
 * session setup.
 *
 * **The rule.** `serial` and nothing else, from one of the app's OWN origins and
 * no other. Web Serial is the one web-platform capability this product touches
 * that reaches out of the machine, and the fence around it is two-part: the
 * origin (so a page this app did not serve cannot ask at all) and Electron's own
 * `select-serial-port` dialog (so a request from our own page still stops and
 * asks the user which port — `serialPicker.ts`). Nothing here grants a port:
 * this function answers „may this origin ask", which is the question a
 * permission handler is asked.
 *
 * **Why HTTP and HTTPS beyond the app's own origin are refused outright.** The
 * renderer's document is `file://` in a packaged build and the dev server's
 * loopback origin in development, and the download service is the only thing in
 * this product permitted to speak to a host besides those. A serial port is a
 * device on the user's desk; a remote page that could open one would be remote
 * code with a physical presence, which is exactly what this file exists to
 * prevent — and the request layer would have blocked that page from loading at
 * all (`main/net/offline.ts`).
 */

import { devServerOrigin } from "../../../main/net/offline.js";

/**
 * The origins the app's own pages are served from: `file://` for a packaged
 * build, and the dev server's loopback origin when one is running.
 *
 * `file://` is spelled as Chromium reports a file page's origin in a permission
 * check rather than as `URL.origin` would answer — the WHATWG URL parser treats
 * a `file:` URL's origin as opaque and returns the string `"null"`, which is why
 * `appOrigin` below normalises before comparing instead of comparing `origin`s.
 */
export function ownOrigins(env: NodeJS.ProcessEnv): readonly string[] {
  const dev = devServerOrigin(env);
  return dev === null ? ["file://"] : ["file://", dev];
}

/**
 * The app's own origin that `where` names, or `null` when it names anything
 * else — including nothing at all.
 *
 * `where` may be a document URL (`file:///C:/app/renderer/index.html`) or an
 * origin string as Electron reports it (`http://localhost:5173`); both are
 * normalised to an origin and then checked against `ownOrigins`. An unparseable
 * value is `null` rather than a throw: a permission check runs on whatever
 * Chromium hands over, and refusing an unreadable one is the same answer as
 * refusing a foreign one.
 */
export function appOrigin(
  where: string | null | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  if (where === null || where === undefined || where === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(where);
  } catch {
    return null;
  }
  const candidate = parsed.protocol === "file:" ? "file://" : parsed.origin;
  return ownOrigins(env).includes(candidate) ? candidate : null;
}

/**
 * Whether one permission request or check is answered `true`.
 *
 * `origin` is the app's own origin this request came from, or `null` — the
 * caller resolves it with `appOrigin`, because the two handlers are given
 * different things (a check carries `requestingOrigin`, a request carries the
 * web contents) and the resolution belongs at the call site rather than in a
 * second reading of the same rule.
 *
 * `details` is whatever the handler was handed. The one thing read out of it is
 * `securityOrigin` — Electron sets it for `serial` checks to name the frame that
 * asked — and a value that is not the same origin as the one that reached us is
 * a cross-origin frame asking on our behalf, which is refused.
 */
export function allows(permission: string, origin: string | null, details: unknown): boolean {
  if (permission !== "serial") return false;
  if (origin === null) return false;
  const security = securityOriginOf(details);
  if (security === null) return true;
  // A `securityOrigin` this code cannot read is refused rather than ignored: the
  // two are the same answer only if the value was absent, and a value present
  // and unreadable is a frame this rule cannot vouch for.
  return readableOrigin(security) === origin;
}

/** `details.securityOrigin` when it is a string, and `null` when the handler did not carry one. */
function securityOriginOf(details: unknown): string | null {
  if (typeof details !== "object" || details === null) return null;
  const value = (details as Record<string, unknown>)["securityOrigin"];
  if (typeof value !== "string" || value === "") return null;
  return value;
}

/** An origin string as Chromium reports it, or `null` when it is not one. */
function readableOrigin(value: string): string | null {
  try {
    // A `file:` URL's WHATWG origin is the opaque string `"null"`, and Chromium
    // reports a file page's origin as `file://` — so the scheme is what decides
    // here, whichever spelling arrived.
    const parsed = new URL(value);
    return parsed.protocol === "file:" ? "file://" : parsed.origin;
  } catch {
    return null;
  }
}
