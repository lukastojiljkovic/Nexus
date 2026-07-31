/**
 * Time-window coalescing for OS toasts (NTF-009, PRD 05 §5): the rule that
 * decides whether a batch of deliveries is put in front of the user one toast
 * at a time or as a single digest. Pure and clock-parameterized like every
 * other rule in this folder — `now` is a plain epoch-ms number the caller
 * reads, and the whole of the "what happened recently" state travels in and out
 * as a value — so the desktop scheduler owns the clock and this owns the rule.
 *
 * **The ledger is truth; the toast is politeness.** Nothing here decides what is
 * DELIVERED — `deriveNotificationCandidates` does that, and every occurrence is
 * recorded individually in the ledger (and so appears individually in the
 * notification center) no matter how it is shown. This module only decides how
 * many times the OS is asked to interrupt the user for them.
 *
 * Two rules produce a digest, and the caller is told which one fired so it can
 * word the toast accordingly:
 *
 * - **count** — more than `DIGEST_COUNT_THRESHOLD` deliveries land in ONE pass
 *   (the original storm guard; the first pass after unlock, which surfaces
 *   everything that came due while the app was closed, is exactly this case).
 * - **window** — a toast already fired less than `COALESCE_WINDOW_MS` ago, so
 *   whatever arrives now joins it instead of interrupting a second time.
 *
 * A window digest summarizes the WHOLE live window, the deliveries already
 * shown individually included, which is what makes a rolling storm read as one
 * running count („5 novih obaveštenja“ → „8 novih obaveštenja“) rather than as
 * a series of one-item digests, each less informative than the toast it
 * replaced. The window is re-armed by every toast it produces, and forgets its
 * deliveries the moment it lapses, so a quiet minute and a half resets
 * everything.
 */

import { isAlwaysOnSource } from "./notificationEngine.js";
import type { NotificationSource } from "./notificationEngine.js";

/**
 * The rolling window: deliveries landing this close to the previous toast
 * collapse into one digest instead of interrupting again.
 *
 * 90 seconds, deliberately longer than the scheduler's own 60-second pass: two
 * back-to-back passes are one burst as far as the user is concerned (a 09:00
 * event reminder and the 09:01 one behind it), while a reminder that arrives
 * two minutes after the last one is its own event and gets its own toast.
 */
export const COALESCE_WINDOW_MS = 90_000;

/** At most this many deliveries in one pass show individually; more collapse on the spot (the storm guard). */
export const DIGEST_COUNT_THRESHOLD = 3;

/**
 * What the caller carries between passes: when the last foldable toast fired,
 * and everything the still-live window has put in front of the user. Both are
 * meaningless once the window lapses, which is why `coalesceDeliveries`
 * discards them rather than ageing them out.
 */
export interface DeliveryWindow<T> {
  /** Epoch ms of the most recent foldable toast; null before the first one. */
  lastToastAt: number | null;
  /** Every foldable delivery the live window has covered — what a window digest summarizes. */
  delivered: readonly T[];
}

/** A window that has never shown anything — what a freshly started scheduler begins with. */
export function emptyDeliveryWindow<T>(): DeliveryWindow<T> {
  return { lastToastAt: null, delivered: [] };
}

/** Why a digest fired: one oversized pass (`"count"`) or a toast too recent to interrupt over (`"window"`). */
export type DigestReason = "count" | "window";

export interface CoalesceResult<T> {
  /**
   * The deliveries that get their own toast: always-on ones first (they are
   * never folded, so they never wait behind anything), then the foldable ones
   * when they are not collapsing.
   */
  individual: readonly T[];
  /** The deliveries one digest toast stands for, or null when nothing is collapsing. */
  digest: readonly T[] | null;
  /** Set exactly when `digest` is. */
  reason: DigestReason | null;
  /** The window to carry into the next pass. */
  window: DeliveryWindow<T>;
}

export interface CoalesceDeliveriesInput<T> {
  /** This pass's deliveries, in the order they should be shown. */
  arrivals: readonly T[];
  /** Epoch ms, the caller's clock. */
  now: number;
  /** The window the previous pass returned. */
  window: DeliveryWindow<T>;
  /** Defaults to `COALESCE_WINDOW_MS`. */
  windowMs?: number;
  /** Defaults to `DIGEST_COUNT_THRESHOLD`. */
  countThreshold?: number;
}

/**
 * Decides how one pass's deliveries are shown. Never mutates its input, and
 * reads no clock.
 *
 * **An always-on source is exempt** (`ALWAYS_ON_SOURCES`, NTF-007). A security
 * notice is the one thing the app must say when the user did not ask to hear
 * it, so it is never folded into a digest, never counted towards the threshold,
 * and never opens or extends the window: it is not part of the reminder stream
 * that the window is smoothing, and being told „5 novih obaveštenja“ when one of
 * the five is "your PIN was changed" would bury exactly the notice that must not
 * be buried.
 */
export function coalesceDeliveries<T extends { source: NotificationSource }>(
  input: CoalesceDeliveriesInput<T>,
): CoalesceResult<T> {
  const windowMs = input.windowMs ?? COALESCE_WINDOW_MS;
  const countThreshold = input.countThreshold ?? DIGEST_COUNT_THRESHOLD;

  const exempt = input.arrivals.filter((arrival) => isAlwaysOnSource(arrival.source));
  const foldable = input.arrivals.filter((arrival) => !isAlwaysOnSource(arrival.source));

  if (foldable.length === 0) {
    return { individual: exempt, digest: null, reason: null, window: input.window };
  }

  const live =
    input.window.lastToastAt !== null && input.now - input.window.lastToastAt < windowMs;

  if (!live && foldable.length <= countThreshold) {
    return {
      individual: [...exempt, ...foldable],
      digest: null,
      reason: null,
      window: { lastToastAt: input.now, delivered: foldable },
    };
  }

  const digest = live ? [...input.window.delivered, ...foldable] : foldable;
  return {
    individual: exempt,
    digest,
    reason: live ? "window" : "count",
    window: { lastToastAt: input.now, delivered: digest },
  };
}
