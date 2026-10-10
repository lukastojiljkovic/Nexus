/**
 * The one permission this module asks the session for, as a pure function.
 *
 * **Why the rule is here and not in `main/index.ts`.** The app denies every web
 * permission by default, and three of this module's four tools are useless
 * without a microphone — so the session's two permission handlers need one
 * exception, and an exception written inline in a 14 000-line file is an
 * exception nobody can test. The decision is therefore a function of three
 * things — the permission's name, the origin asking for it, and the details the
 * handler was given — and `main/index.ts` consults it in the two places the
 * session requires (both handlers, because Chromium asks the check handler as
 * well as the request handler).
 *
 * **What the rule says, and why each half is there.**
 *
 *   - the permission must be `media` — a camera, a serial port, a USB device, a
 *     notification and everything else this app has no business touching stays
 *     refused, exactly as it was;
 *   - the asking frame must be the MAIN frame — a subframe inside the app's own
 *     page is not the app's own page;
 *   - the request must be AUDIO and nothing else: a request that carries `video`
 *     is refused even if it also carries `audio`, because this module asks for a
 *     microphone and never for a camera;
 *   - the origin must be this application's own — the packaged `file://` bundle,
 *     or the electron-vite dev server, which is the same one origin
 *     `net/offline.ts` already admits as a hole that cannot exist in a shipped
 *     build (`ELECTRON_RENDERER_URL` is unset there).
 *
 * The two handlers report the same request in two shapes (`mediaTypes` is a list,
 * `mediaType` is one value) and name the source in two spellings (a serialized
 * origin, or the last URL the frame loaded), so this function accepts both and
 * normalises them rather than making the call site decide — a permission rule the
 * call site could get wrong is a rule with two implementations.
 */

/** What either session handler can say about the request, in the union of the two shapes Electron hands over. */
export interface MicrophonePermissionDetails {
  /** `MediaAccessPermissionRequest.mediaTypes` — the request handler's list, e.g. `["audio"]`. */
  readonly mediaTypes?: readonly string[];
  /** `PermissionCheckHandlerHandlerDetails.mediaType` — the check handler's single kind, `"audio" | "video" | "unknown"`. */
  readonly mediaType?: string;
  /** Both shapes carry it, and it is what a refusal would be about. */
  readonly requestingUrl?: string;
  /** False for a subframe. Absent is read as „not said", never as false. */
  readonly isMainFrame?: boolean;
}

/** The one permission name this module is allowed to answer yes to. */
const MICROPHONE_PERMISSION = "media";

/**
 * Whether `source` is this application's own page.
 *
 * `source` may be a serialized origin (`file://`, `http://localhost:5173`) or the
 * last URL the frame loaded (`file:///C:/…/index.html`), because the request
 * handler reports `securityOrigin`/`requestingUrl` and the check handler reports
 * `requestingOrigin` — and the honest rule has to be true whichever spelling
 * arrives. A file URL is this app's own renderer and nothing else's: the window
 * loads one document and navigation is locked (`SEC-EL`), so a `file:` source is
 * the bundle. The dev origin is compared exactly, never by prefix or wildcard, for
 * `net/offline.ts`'s own reason.
 */
function isOwnRenderer(source: string, devOrigin: string | null): boolean {
  if (source === "file://" || source.startsWith("file:///")) return true;
  if (devOrigin === null) return false;
  return source === devOrigin || source.startsWith(`${devOrigin}/`);
}

/**
 * The rule. `devOrigin` is the launch's own dev-server origin
 * (`devServerOrigin(process.env)` in main, which is null in a packaged build).
 */
export function allows(
  permission: string,
  source: string,
  details: MicrophonePermissionDetails,
  devOrigin: string | null,
): boolean {
  if (permission !== MICROPHONE_PERMISSION) return false;
  if (details.isMainFrame === false) return false;
  if (!isOwnRenderer(source, devOrigin)) return false;
  const kinds =
    details.mediaTypes ??
    (details.mediaType === undefined ? [] : [details.mediaType]);
  return kinds.includes("audio") && !kinds.includes("video");
}
