import { Button } from "./Button.js";
import { Icon, type IconName } from "./Icon.js";

/** What a notice is saying, and therefore how loudly it says it. */
export type NoticeKind = "info" | "warning" | "danger";

/**
 * A notice's live region, as a value a test can pin.
 *
 * The three kinds are three DIFFERENT degrees of interruption rather than three
 * inks, and the glyph is what keeps the reading off the colour:
 *
 *   - `info` — something worth knowing, drawn where it belongs. `status`, so it
 *     waits for a pause.
 *   - `warning` — something that will cost the user if they carry on, or that
 *     has already cost them a little. Still `status`: it is a state, not an
 *     event, and interrupting for a state the reader is looking at is how a
 *     live region trains people to ignore it.
 *   - `danger` — a failure the user just caused. `alert`, because the thing they
 *     tried did not happen and every second they believe otherwise is a second
 *     they are not retrying.
 */
export function noticeAnnouncement(kind: NoticeKind): {
  role: "status" | "alert";
  "aria-live": "polite" | "assertive";
  icon: IconName;
} {
  switch (kind) {
    case "danger":
      return { role: "alert", "aria-live": "assertive", icon: "error" };
    case "warning":
      return { role: "status", "aria-live": "polite", icon: "warning" };
    case "info":
      return { role: "status", "aria-live": "polite", icon: "info" };
  }
}

export interface NoticeProps {
  kind: NoticeKind;
  /** One sentence: what is true, in the page's register. */
  message: string;
  /**
   * The way out of what the line reports — „Pokušaj ponovo", „Otvori
   * podešavanja". Optional, because plenty of notices report a state nothing
   * can be done about from here, and an action offered for its own sake is
   * worse than none.
   */
  action?: { readonly label: string; readonly onClick: () => void } | undefined;
  /** The caller's own class, for a surface that places the line. */
  className?: string | undefined;
}

/**
 * One inline line of news or refusal, in the one shape the app draws it.
 *
 * **Why a component rather than an ink.** The product had grown two ways of
 * saying „this did not work" beside a control: a hand-written `*__error`
 * paragraph in the danger colour (forty-odd classes of them, most with no live
 * region at all, so a screen reader was told nothing when a save refused), and
 * `Toast` for the failures that belonged to an action. The inline case is the
 * third and it had no component: it is not an offer to take something back and
 * it must not cover the thing it is about, so it is a line — but a line that
 * announces itself, carries a shape beside its colour, and has somewhere for
 * the way out to sit.
 *
 * Colour is never the whole of the message: each kind carries its own glyph
 * (`noticeAnnouncement`), and the danger kind is also the assertive one.
 */
export function Notice({ kind, message, action, className }: NoticeProps) {
  const announcement = noticeAnnouncement(kind);
  const classes = ["nx-notice", `nx-notice--${kind}`];
  if (className != null) classes.push(className);
  return (
    <div className={classes.join(" ")} role={announcement.role} aria-live={announcement["aria-live"]}>
      <span className="nx-notice__mark" aria-hidden="true">
        <Icon name={announcement.icon} size={15} />
      </span>
      <span className="nx-notice__text">{message}</span>
      {action != null && (
        <Button size="sm" className="nx-notice__action" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
