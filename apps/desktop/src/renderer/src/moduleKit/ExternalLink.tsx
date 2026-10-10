import { useState, type ReactNode } from "react";

import { externalLinkLabel, followExternalLink, linkStateAfter } from "./externalLinkRule.js";
import "./externalLink.css";

/**
 * A kit module's external link (ADR-107): a button that LOOKS like a link,
 * because the renderer may not navigate itself (SEC-EL-03).
 *
 * **Why a button.** The rule that decides whether an address may leave this
 * machine lives in main, and a click is a call rather than a location. An `<a
 * href>` would be a navigation the window then has to refuse — which is what
 * made the shell's own links inert-but-looking-alive before this component
 * existed — and `target="_blank"` opens a window `setWindowOpenHandler` denies.
 *
 * **What it says, and what it does when refused.** The control reads the
 * address's host by default, because a host is the part a reader judges an
 * address by and a pack's URL is long. If main refuses the address, the control
 * is replaced by the address itself as selectable text: nothing is clickable any
 * more, and the reader still has the address to copy — which is the honest
 * outcome for an address this app will not open. A caller with its own label
 * (`children`) keeps it in the openable state; the refused state shows the
 * address, since that is what the reader would have to act on.
 */
export interface ExternalLinkProps {
  /** The address to open. It goes to main's rule unchanged. */
  readonly href: string;
  /** What the control reads. Defaults to the address's host. */
  readonly children?: ReactNode;
  /** The caller's own class, for a row that needs to place the control. */
  readonly className?: string;
}

export function ExternalLink({ href, children, className }: ExternalLinkProps) {
  const [refused, setRefused] = useState(false);
  const classes = className === undefined ? "nx-external-link" : `nx-external-link ${className}`;

  if (refused) {
    return (
      <span className={`${classes} nx-external-link--refused`}>
        {/* The address is a `<span>` and not a link: it is text the reader can
            select and copy, which is all a refused address can be. */}
        <span className="nx-external-link__address">{href}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      // The address in full, since the label is usually only its host: the
      // native tooltip is where a reader checks what they are about to open.
      title={href}
      onClick={() => {
        void followExternalLink(href).then((outcome) => {
          // `linkStateAfter` is the rule, read here rather than restated: only a
          // refusal turns the control into the address. A channel failure leaves
          // it alone, because the address may be perfectly openable and turning
          // a wiring bug into a dead link would make the second look like the
          // first.
          if (linkStateAfter(outcome) === "address") setRefused(true);
        });
      }}
    >
      {children ?? externalLinkLabel(href)}
    </button>
  );
}
