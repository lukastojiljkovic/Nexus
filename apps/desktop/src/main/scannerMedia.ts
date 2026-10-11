import { devServerOrigin } from "./net/offline.js";

/**
 * The one web permission this application grants: the camera, to its own
 * renderer, for the scanner module (ADR-090's session handlers).
 *
 * **Why this is a file of its own.** The session's two permission handlers are
 * shared ground - several modules extend them, and every one of those edits is
 * a line in the same two callbacks. A rule about who may ask is not a line,
 * though: it is a decision with three inputs and a negative case, so it lives
 * here as a pure function the handler CONSULTS, exactly as `net/offline.ts`'s
 * `isRequestAllowed` is consulted by the request filter. The handler then holds
 * no policy at all, which is what keeps two runs' rules from interleaving into
 * a fourth, unintended one.
 *
 * **What is granted, precisely.**
 *
 *  1. The permission must be `media` - the one Electron reports for both camera
 *     and microphone. Nothing else is granted here, ever; the handlers' default
 *     is still a refusal for every other name.
 *  2. The requesting origin must be one this build actually serves the renderer
 *     from: `file:` in the packaged app, or the dev server's own origin while
 *     developing (the hole `devServerOrigin` documents). A page that is not this
 *     app's renderer can therefore never ask - which is the half that matters,
 *     because a permission request is a request from a DOCUMENT, and the only
 *     document this process ever loads is its own.
 *  3. Every media type asked for must be `video`. The scanner uses the camera
 *     and nothing else, so a request that also names `audio` is refused rather
 *     than partly granted: granting `media` would hand a future caller the
 *     microphone through a rule written for a camera.
 *
 * **A file URL has no origin.** `new URL("file:///C:/…/index.html").origin` is
 * the string `"null"` in Chromium, so `file:` is matched as a SCHEME rather than
 * compared as an origin - which is why `appMediaOrigins` answers a list that
 * mixes scheme markers and origins, and why the comparison below treats `file:`
 * separately instead of pretending the two are the same kind of value.
 */

/** The scheme marker for the packaged renderer, whose origin is opaque. */
const FILE_ORIGIN = "file:";

/**
 * The origins this build serves its own renderer from.
 *
 * `file:` is always present: the packaged app loads `out/renderer/index.html`
 * from disk. The dev server's origin is added only when `ELECTRON_RENDERER_URL`
 * names one, which electron-vite sets in development and nothing sets in a
 * packaged build - so the second entry cannot exist in a shipped app.
 */
export function appMediaOrigins(env: NodeJS.ProcessEnv): readonly string[] {
  const dev = devServerOrigin(env);
  return dev === null ? [FILE_ORIGIN] : [FILE_ORIGIN, dev];
}

/**
 * Whether one permission request or check may be granted.
 *
 * `origin` is the requesting document's URL - the request handler passes
 * `webContents.getURL()`, the check handler the origin Chromium names.
 * `details` is typed `unknown` because Electron declares the two handlers'
 * details as TWO DIFFERENT STRUCTURES (`MediaAccessPermissionRequest` carries
 * `mediaTypes: ["video"]`, `PermissionCheckHandlerHandlerDetails` a single
 * `mediaType: "video"`), and this one rule is consulted by both: a version that
 * understood only the first would refuse every check, which is refusing the
 * camera one layer down. `appOrigins` defaults to the packaged answer, so a
 * caller with no environment to read - a test, or a future caller holding the
 * list - still gets the strict rule rather than an accidental permit.
 */
export function allows(
  permission: string,
  origin: string | null,
  details: unknown,
  appOrigins: readonly string[] = [FILE_ORIGIN],
): boolean {
  if (permission !== "media") return false;
  if (origin === null || !isAppOrigin(origin, appOrigins)) return false;
  const mediaTypes = mediaTypesOf(details);
  if (mediaTypes === null || mediaTypes.length === 0) return false;
  return mediaTypes.every((mediaType) => mediaType === "video");
}

/**
 * The media types one handler's `details` names, in either shape, or `null` for
 * anything this rule cannot vouch for - a missing field, a field of the wrong
 * type, and the check handler's `"unknown"` all end in a refusal.
 */
function mediaTypesOf(details: unknown): readonly string[] | null {
  if (typeof details !== "object" || details === null) return null;
  const record = details as { readonly mediaTypes?: unknown; readonly mediaType?: unknown };
  if (Array.isArray(record.mediaTypes)) {
    const list: string[] = [];
    for (const entry of record.mediaTypes) {
      if (typeof entry !== "string") return null;
      list.push(entry);
    }
    return list;
  }
  if (typeof record.mediaType === "string") return [record.mediaType];
  return null;
}

/** Whether a document at `origin` is one this build served. An unparseable URL is not. */
function isAppOrigin(origin: string, appOrigins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol === FILE_ORIGIN) return appOrigins.includes(FILE_ORIGIN);
  return appOrigins.includes(parsed.origin);
}
