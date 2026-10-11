/**
 * The session's MEDIA permission, as the ASSISTANT sees it: a pure rule plus a
 * bounded arming window, on the recorder's own terms
 * (`modules/recorder/main/mediaAccess.ts`, which explains why each module owns
 * one of these rather than `main/index.ts` growing a switch).
 *
 * **What the rule is, in one sentence.** A `media` request is granted only when
 * it comes from this app's OWN document, from its MAIN frame, asks for AUDIO
 * and no camera, and arrives inside a window the assistant's page has just
 * armed by asking to talk. Nothing here grants a microphone because a page
 * asked for one, which is the flat refusal it replaces.
 *
 * **Why the window is state rather than a comment.** `allow` is asked during
 * `getUserMedia`, and nothing in the request says WHICH page asked: the app is
 * one document, so a microphone request from the recorder's page and one from
 * the assistant's look identical from `index.ts`. The page therefore arms a
 * bounded window (`arm`) immediately before it captures, and the window closes
 * on its own after `MIC_ARM_WINDOW_MS` - as does the module's session, through
 * the kit's `onSessionEnd`, so a lock or a profile switch cannot leave a
 * standing grant behind.
 *
 * **Why audio only, where the recorder also allows a camera.** The assistant
 * has no video surface: a request that carries `video` is refused even when it
 * also carries `audio`, because a camera nobody in this module can draw is a
 * capability asked for by something other than the feature that armed it.
 */

/** The permission name Electron reports for a microphone or camera request. */
const MICROPHONE_PERMISSION = "media";

/**
 * How long one arming lasts.
 *
 * Long enough for the page's next step - arm, then `getUserMedia`, then the
 * user answering Chromium's device prompt - and short enough that it cannot
 * outlive the moment it was asked for. Nothing depends on the exact value: the
 * page arms again before every capture.
 */
export const MIC_ARM_WINDOW_MS = 60_000;

/** When the window closes, in the clock the caller supplies. Zero means "never armed". */
let armedUntilMs = 0;

/**
 * Arms the window from `nowMs`.
 *
 * Called by the module's own `capture` op, which validates the payload first -
 * arming grants nothing to anybody else, but a caller that could arm it without
 * a valid request would be a way to make the permission handler agree with a
 * capture that never happened.
 */
export function armAssistantMic(nowMs: number): void {
  armedUntilMs = nowMs + MIC_ARM_WINDOW_MS;
}

/** Whether a permission asked at `nowMs` is inside an armed window. */
export function assistantMicArmedAt(nowMs: number): boolean {
  return nowMs < armedUntilMs;
}

/** Closes the window now: what the module's `onSessionEnd` calls. */
export function disarmAssistantMic(): void {
  armedUntilMs = 0;
}

/**
 * The origins this launch serves its own interface from: the dev server's origin
 * while one is running, and `file://` otherwise. A dev URL this code cannot
 * parse answers `[]` rather than a guess, so a malformed environment grants
 * nothing at all.
 */
export function selfOriginsFor(devOrigin: string | null): readonly string[] {
  if (devOrigin === null) return ["file://"];
  const origin = originOf(devOrigin);
  return origin === "" ? [] : [origin];
}

/**
 * The origin of a URL or origin string, with `file:` documents normalised to
 * `file://` - Chromium reports a `file://` frame's origin that way, and
 * `new URL("file:///...").origin` is the opaque string `"null"`, which would
 * never match. Anything unparseable answers the empty string, which is
 * deliberately not a valid origin: "could not tell" must never read as "ours".
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
 * What a permission request tells this rule beyond its name and origin - the
 * fields Electron's two detail shapes have in common, already normalised by the
 * caller.
 */
export interface MicRequestFacts {
  /** The media kinds named by the request. Chromium's request handler reports a list; its check handler one kind or `"unknown"`. */
  readonly mediaTypes: readonly string[];
  /** Whether the assistant's page has asked to talk inside `MIC_ARM_WINDOW_MS`. */
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
 *  - not `media` at all - a web permission nothing in this product uses is still
 *    answered no;
 *  - not armed - the assistant's own page has not asked to talk, so nothing here
 *    is asking for a microphone on the user's behalf;
 *  - not the main frame - the app draws no iframe, so a subframe asking is either
 *    a defect or an attack;
 *  - not our own document - a grant for a dev-server page or any other origin
 *    would be a microphone handed to whatever that page is;
 *  - a kind that is not audio (or the `"unknown"` a permission CHECK often
 *    carries, which grants no capture by itself).
 */
export function allows(permission: string, origin: string, details: MicRequestFacts): boolean {
  if (permission !== MICROPHONE_PERMISSION) return false;
  if (!details.armed) return false;
  if (!details.isMainFrame) return false;
  const requester = originOf(origin);
  if (requester === "" || !details.selfOrigins.includes(requester)) return false;
  return details.mediaTypes.every((type) => type === "audio" || type === "unknown");
}

/** The fields Electron's permission REQUEST details hold that this rule reads (`MediaAccessPermissionRequest`). */
export interface MicRequestShape {
  readonly requestingUrl?: string;
  readonly mediaTypes?: readonly string[];
  readonly isMainFrame?: boolean;
}

/**
 * The request handler's whole decision, so `index.ts` keeps ONE clause there: it
 * normalises Electron's shape into the rule's own facts and calls `allows`.
 */
export function allowsRequest(
  permission: string,
  request: MicRequestShape,
  devOrigin: string | null,
  nowMs: number,
): boolean {
  return allows(permission, request.requestingUrl ?? "", {
    mediaTypes: request.mediaTypes ?? [],
    armed: assistantMicArmedAt(nowMs),
    selfOrigins: selfOriginsFor(devOrigin),
    // The request handler does not report the frame; every request this app
    // makes comes from its own document, and one that arrived with no
    // `requestingUrl` is refused by `originOf`'s empty answer anyway.
    isMainFrame: request.isMainFrame ?? true,
  });
}

/** The fields Electron's permission CHECK details hold that this rule reads (`PermissionCheckHandlerHandlerDetails`). */
export interface MicCheckShape {
  readonly securityOrigin?: string;
  readonly mediaType?: string;
  readonly requestingUrl?: string;
  readonly isMainFrame?: boolean;
}

/**
 * The check handler's decision, on `allowsRequest`'s terms: the media kind is
 * normalised into the list `allows` reads, and a check that names none, or names
 * `"unknown"`, gives no capture away.
 */
export function allowsCheck(
  permission: string,
  requestingOrigin: string,
  check: MicCheckShape,
  devOrigin: string | null,
  nowMs: number,
): boolean {
  const request = check.requestingUrl ?? check.securityOrigin ?? requestingOrigin;
  return allows(permission, request, {
    mediaTypes: check.mediaType === undefined ? [] : [check.mediaType],
    armed: assistantMicArmedAt(nowMs),
    selfOrigins: selfOriginsFor(devOrigin),
    isMainFrame: check.isMainFrame ?? true,
  });
}
