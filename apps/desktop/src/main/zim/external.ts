/**
 * What happens when a page inside a ZIM asks to go somewhere.
 *
 * A pack is a website, and a website's links are written by whoever built it:
 * some point at another entry in the same file, some at `https://sr.wikipedia.org/…`,
 * and some at nothing this app should follow. The rule below is the whole of the
 * handling, and it is three lines because the useful statement is short —
 *
 *   - **inside the ZIM stays inside**: a link to another entry is the reader
 *     working as intended, and the frame loads it;
 *   - **`http`/`https` opens in the user's own browser**: the attribution links
 *     and the citations in a Wikipedia pack are the case this exists for, and the
 *     page they point at is the user's to read wherever they read things. WHICH
 *     schemes those are is not a second rule stated here — it is
 *     `allowsDocumentExternalUrl`, the document variant of the app's one
 *     external-link rule (ADR-107), and its `http` is exactly the one an old
 *     encyclopedia's own links need;
 *   - **anything else is refused**: `file:`, `mailto:`, a custom scheme, a data
 *     URL — none of them is a link a ZIM should be able to make this app follow,
 *     and a refusal that says nothing is the right answer for content this app
 *     is rendering rather than trusting.
 *
 * The handler is passed in rather than imported so this file has nothing to do
 * with a browser itself and the rule is testable — the same split the update
 * feature's `openReleasePage` is on the other side of. The hand-off the handler
 * performs is the one door's (`external.ts`), so a link this file selects can
 * still be refused where it is opened.
 */

import { allowsDocumentExternalUrl } from "../external.js";
import { ZIM_SCHEME } from "./scheme.js";

/**
 * The URL a frame navigation should hand to the OS browser, or `null` when it
 * should not.
 *
 * The scheme decision is the external-link rule's, not a copy of it: this
 * function normalises what that rule accepted, and nothing more. A malformed
 * address cannot reach `new URL` here, because the rule parsed it already.
 */
export function externalUrlFor(url: string): string | null {
  return allowsDocumentExternalUrl(url) ? new URL(url).toString() : null;
}

/** What one `will-frame-navigate` event needs of it, so the rule can be driven from a test. */
export interface FrameNavigation {
  readonly url: string;
  /** The URL the frame is on now — how this tells a ZIM frame from the shell's own. */
  readonly frameUrl: string;
}

/** What the event and the browser hand-off look like from here. */
export interface FrameNavigationSink {
  preventDefault(): void;
  openInBrowser(url: string): void;
}

/**
 * One frame navigation, decided.
 *
 * A frame that is not on `nx-zim:` is not this rule's business — the shell's own
 * window already has its navigation locked in `index.ts`, and a second opinion
 * about the app's own URLs is how the two come to disagree.
 *
 * A navigation inside the ZIM is a ZIM URL and is left alone. Everything else is
 * cancelled, and the browser is given the two protocols that are the user's.
 */
export function handleFrameNavigation(
  navigation: FrameNavigation,
  sink: FrameNavigationSink,
): void {
  if (!navigation.frameUrl.startsWith(`${ZIM_SCHEME}:`)) return;
  if (navigation.url.startsWith(`${ZIM_SCHEME}:`)) return;
  sink.preventDefault();
  const external = externalUrlFor(navigation.url);
  if (external !== null) sink.openInBrowser(external);
}
