/**
 * The session's MEDIA permission — the recorder's whole claim on it, and the
 * only exception this build makes to „answer no to every web permission"
 * (`main/index.ts`'s own comment on the two handlers).
 *
 * **What the rule is, in one sentence.** A `media` request is granted only when
 * it comes from this app's OWN document, from its MAIN frame, in a moment when
 * the recorder's page has just asked for a device — never because a page asked
 * for one, which is what the previous flat refusal existed to prevent.
 *
 * **Why „only while the recorder page asks" is state rather than a comment.**
 * `allow` is asked during `getUserMedia`, and nothing in the request says WHICH
 * page asked: the app is one document, so from `index.ts` a microphone request
 * from the notes page and one from the recorder page look identical. So the
 * recorder's own `beginCapture` arms a bounded window (`armMediaAccess`) that
 * the rule consults, and the window closes on its own after
 * `MEDIA_ARM_WINDOW_MS` — as does the module's session, through the kit's
 * `onSessionEnd`. A compromised renderer that never opens the recorder therefore
 * never reaches a granted microphone, and one that does gets a bounded few
 * seconds rather than a standing grant.
 *
 * **Why this file owns the decision rather than `index.ts`.** The same
 * `media`/`serial`/`hid`/`usb` handlers are being extended by several runs at
 * once, so each rule is a pure function in its own module's folder (testable
 * without an Electron session) and `index.ts` keeps one line per handler that
 * consults it.
 */

/** The permission name Electron reports for a microphone or camera request. */
const MEDIA = "media";

/**
 * How long one arming lasts.
 *
 * Long enough for the page's own next step — arm, then `getUserMedia`, then the
 * user picking a device in Chromium's picker — and short enough that it cannot
 * outlive the moment it was asked for. Nothing depends on the exact value: the
 * page arms again before every capture.
 */
export const MEDIA_ARM_WINDOW_MS = 60_000;

/** When the window closes, in the clock the caller supplies. Zero means „never armed". */
let armedUntilMs = 0;

/**
 * Arms the window from `nowMs`. Called by the recorder's `beginCapture`, which
 * validates the profile id first — arming grants nothing to anybody else, but a
 * caller that could arm it without a valid payload would be a way to make the
 * permission handler agree with a request that never happened.
 */
export function armMediaAccess(nowMs: number): void {
  armedUntilMs = nowMs + MEDIA_ARM_WINDOW_MS;
}

/** Whether a permission asked at `nowMs` is inside an armed window. */
export function mediaAccessArmedAt(nowMs: number): boolean {
  return nowMs < armedUntilMs;
}

/**
 * Closes the window now: the recorder module's `onSessionEnd`, so a lock, a
 * profile switch or a quit cannot leave a grant standing for the next session.
 */
export function disarmMediaAccess(): void {
  armedUntilMs = 0;
}

/**
 * The origins this launch serves its own interface from: the dev server's
 * origin while one is running, and `file://` otherwise — the packaged renderer
 * is loaded with `loadFile`, whose document origin Chromium reports as
 * `file://` (see `isRequestAllowed`'s `LOCAL_SCHEMES`, which treats the same
 * scheme as ours). A dev server URL this code cannot parse answers `[]` rather
 * than a guess, so a malformed `ELECTRON_RENDERER_URL` grants nothing at all.
 *
 * **Why an ORIGIN and not the document's whole URL.** In a packaged build
 * `file://` is every local file's origin, so this comparison is one step wider
 * than „the renderer's own index.html" — and it is still sound, because a file
 * document cannot BE shown in this window: `will-navigate` locks navigation to
 * the app's own document and `setWindowOpenHandler` denies every new one
 * (SEC-EL-03, `index.ts`). Comparing whole URLs instead would be a second,
 * weaker lock: Chromium normalises and percent-encodes a `file:` URL on its way
 * through the permission pipeline, and the day the two spellings differ the
 * recorder would stop recording for a reason nobody could see.
 */
export function selfOriginsFor(devOrigin: string | null): readonly string[] {
  if (devOrigin === null) return ["file://"];
  const origin = originOf(devOrigin);
  return origin === "" ? [] : [origin];
}

/**
 * The origin of a URL or origin string, with `file:` documents normalised to
 * `file://` — Chromium reports a `file://` frame's origin that way, and
 * `new URL("file:///…").origin` is the string `"null"` (an opaque origin),
 * which would never match. Anything unparseable answers the empty string, which
 * is deliberately not a valid origin: „could not tell" must never read as
 * „ours" (`net/offline.ts`'s rule for an unreadable URL).
 */
export function originOf(urlOrOrigin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(urlOrOrigin);
  } catch {
    return "";
  }
  return parsed.protocol === "file:" ? "file://" : parsed.origin;
}

/**
 * What a permission request (or check) tells this rule beyond the permission
 * name and the origin — the fields Electron's two detail shapes have in common,
 * already normalised by the caller.
 */
export interface MediaRequestFacts {
  /**
   * The media kinds named by the request. Chromium's request handler reports a
   * list (`["audio", "video"]`); its check handler reports one kind or
   * `"unknown"`, and the caller passes `[]` for a check that names none.
   */
  readonly mediaTypes: readonly string[];
  /** Whether the recorder's page has asked inside `MEDIA_ARM_WINDOW_MS`. */
  readonly armed: boolean;
  /** The origins `selfOriginsFor` answered for this launch. */
  readonly selfOrigins: readonly string[];
  /** Whether the frame making the request is the document itself. */
  readonly isMainFrame: boolean;
}

/**
 * The rule, as one pure function: `permission`, the requesting `origin`, and the
 * facts above.
 *
 * Every arm is a refusal this app means:
 *  - not `media` at all — a web permission nothing in this product uses is still
 *    answered no, which is what the flat refusal was for;
 *  - not our own document — a `media` grant for a dev-server page or any other
 *    origin would be a microphone handed to whatever that page is;
 *  - not the main frame — the app draws no iframe, so a subframe asking is
 *    either a defect or an attack, and neither is a recording;
 *  - not armed — nobody opened the recorder, so nothing here is asking for a
 *    device on the user's behalf;
 *  - a kind that is neither audio nor video — a name this build cannot capture
 *    is a request that means something other than what the recorder does.
 *
 * A request that names no CAPTURE kind — `[]`, or Chromium's own `"unknown"` —
 * is granted when everything else holds, and that is deliberate: the permission
 * CHECK behind `navigator.mediaDevices.enumerateDevices()` labels often carries
 * no kind at all, and answering it no would empty the recorder's device picker
 * while granting no capture, because the request handler below is what actually
 * hands a microphone over.
 */
export function allows(permission: string, origin: string, details: MediaRequestFacts): boolean {
  if (permission !== MEDIA) return false;
  if (!details.armed) return false;
  if (!details.isMainFrame) return false;
  const requester = originOf(origin);
  if (requester === "" || !details.selfOrigins.includes(requester)) return false;
  return details.mediaTypes.every(
    (type) => type === "audio" || type === "video" || type === "unknown",
  );
}

/** The fields Electron's permission REQUEST details hold that this rule reads (`MediaAccessPermissionRequest`). */
export interface MediaRequestShape {
  readonly requestingUrl?: string;
  readonly mediaTypes?: readonly string[];
  readonly isMainFrame?: boolean;
}

/**
 * The request handler's whole decision, so `index.ts` keeps ONE line there: it
 * normalises Electron's shape into the rule's own facts and calls `allows`.
 *
 * `devOrigin` is the value `devServerOrigin(process.env)` answers — passed in
 * rather than read here, because the environment is `index.ts`'s business and
 * this file stays testable without one.
 */
export function allowsRequest(
  permission: string,
  request: MediaRequestShape,
  devOrigin: string | null,
  nowMs: number,
): boolean {
  return allows(permission, request.requestingUrl ?? "", {
    mediaTypes: request.mediaTypes ?? [],
    armed: mediaAccessArmedAt(nowMs),
    selfOrigins: selfOriginsFor(devOrigin),
    // Chromium's request handler does not report the frame; every request this
    // app makes comes from its own document, and a permission that arrived with
    // no `requestingUrl` at all is refused by `originOf`'s empty answer anyway.
    isMainFrame: request.isMainFrame ?? true,
  });
}

/** The fields Electron's permission CHECK details hold that this rule reads (`PermissionCheckHandlerHandlerDetails`). */
export interface MediaCheckShape {
  readonly securityOrigin?: string;
  readonly mediaType?: string;
  readonly requestingUrl?: string;
  readonly isMainFrame?: boolean;
}

/**
 * The check handler's decision, on `allowsRequest`'s terms.
 *
 * The requesting origin is the one Electron hands over as its own argument; the
 * `securityOrigin` on the details is the fallback for the shapes where it is
 * absent, and the media kind is normalised into the list `allows` reads — a
 * check that names none, or names `"unknown"`, gives no capture away.
 */
export function allowsCheck(
  permission: string,
  requestingOrigin: string,
  check: MediaCheckShape,
  devOrigin: string | null,
  nowMs: number,
): boolean {
  const request = check.requestingUrl ?? check.securityOrigin ?? requestingOrigin;
  return allows(permission, request, {
    mediaTypes: check.mediaType === undefined ? [] : [check.mediaType],
    armed: mediaAccessArmedAt(nowMs),
    selfOrigins: selfOriginsFor(devOrigin),
    isMainFrame: check.isMainFrame ?? true,
  });
}
