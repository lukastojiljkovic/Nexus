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
 *     page they point at is the user's to read wherever they read things;
 *   - **anything else is refused**: `file:`, `mailto:`, a custom scheme, a data
 *     URL — none of them is a link a ZIM should be able to make this app follow,
 *     and a refusal that says nothing is the right answer for content this app
 *     is rendering rather than trusting.
 *
 * The handler is passed in rather than imported so this file has no Electron
 * import and the rule is testable — the same split the update feature's
 * `openReleasePage` is on the other side of.
 */

import { ZIM_SCHEME } from "./scheme.js";

/** The URL a frame navigation should hand to the OS browser, or `null` when it should not. */
export function externalUrlFor(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
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
