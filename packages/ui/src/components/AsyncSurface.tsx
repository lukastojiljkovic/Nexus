import type { ReactNode } from "react";

import { LoadingState } from "./LoadingState.js";
import { Notice } from "./Notice.js";

/**
 * Where one surface's read has got to.
 *
 * The same three states every isolated read in the app already keeps
 * (the dashboard's widgets keep exactly this shape), which is why it is a
 * type here rather than a fourth spelling of it.
 */
export type AsyncState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "failed" };

/** How a failed read asks again, when it can. */
export interface AsyncRetry {
  readonly label: string;
  readonly onClick: () => void;
}

/** Which arm the surface draws, as a value rather than as a branch inside JSX. */
export type AsyncPlan<T> =
  | { readonly arm: "loading"; readonly rows: number | undefined }
  | { readonly arm: "failed"; readonly retry: AsyncRetry | null }
  | { readonly arm: "ready"; readonly data: T };

/**
 * The arm a state draws, and the two facts the failure arm needs.
 *
 * Pure by construction, for the reason this package's other rules are: Vitest
 * runs in a Node environment with no DOM, so what can be pinned here is the
 * DECISION and not the pixels. Two of the three answers are properties worth
 * having a name for — a failed read never falls through to the body (stale rows
 * drawn as if the read had succeeded are the quiet version of a wrong screen),
 * and a failure with no way to ask again draws no button rather than a dead one.
 */
export function asyncSurfacePlan<T>(
  state: AsyncState<T>,
  retry: AsyncRetry | undefined,
  loadingRows: number | undefined,
): AsyncPlan<T> {
  if (state.status === "loading") return { arm: "loading", rows: loadingRows };
  if (state.status === "failed") return { arm: "failed", retry: retry ?? null };
  return { arm: "ready", data: state.data };
}

export interface AsyncSurfaceProps<T> {
  state: AsyncState<T>;
  /**
   * What a screen reader hears while the read is in flight — the page's own
   * word for it („Učitavanje…"), because the skeleton's bars say nothing and a
   * surface that is silent is a surface that looks finished and empty.
   */
  loadingLabel: string;
  /**
   * The failure's OWN heading, and never the empty state's words.
   *
   * „There is nothing here" and „we could not find out" are different facts,
   * and five pages in the app were saying the first while the second was true —
   * „Nema zadataka" over a read that had failed. A page that reports an empty
   * list it could not read has told the user their data is gone.
   */
  failureTitle: string;
  /** One sentence about what failed, in the page's register. */
  failureMessage: string;
  /**
   * How to ask again, when the read can be asked again. Both halves together: a
   * button with no handler is not an offer, and a surface that draws a Retry it
   * cannot honour is worse than one that admits there is no way back.
   */
  retry?: AsyncRetry | undefined;
  /** How many placeholder rows to draw while the read is in flight. Omitted, the skeleton's own default. */
  loadingRows?: number | undefined;
  /** The caller's own class, for a surface that places the body in its own grid. */
  className?: string | undefined;
  /**
   * The body, as a function of the data — because the body only exists in the
   * READY arm, and a signature that took `data | null` would put that check
   * back at every call site.
   */
  children: (data: T) => ReactNode;
}

/**
 * One read, drawn in its three states, with the page header above it rather
 * than inside it.
 *
 * **Why the frame is the caller's and the states are this component's.** The
 * app's pages were each answering the same three questions differently, and one
 * of the answers was missing outright: a failed read left the page with nothing
 * to press — thirteen surfaces, some of them telling the user to „close and
 * reopen the page" — while the read that failed could simply have been asked
 * again. The loading arm is the skeleton rather than the word „Učitavanje…", for
 * the reason `LoadingState` states.
 *
 * The header stays with the page: a page keeps its name and its gear while its
 * body is loading, and a surface that owned the header would be three surfaces
 * per page again the moment a page drew its own.
 */
export function AsyncSurface<T>({
  state,
  loadingLabel,
  failureTitle,
  failureMessage,
  retry,
  loadingRows,
  className,
  children,
}: AsyncSurfaceProps<T>) {
  const plan = asyncSurfacePlan(state, retry, loadingRows);

  if (plan.arm === "loading") {
    return (
      <div className={className}>
        <LoadingState label={loadingLabel} rows={plan.rows} />
      </div>
    );
  }

  if (plan.arm === "failed") {
    return (
      <div className={className}>
        {/* The heading sits ABOVE the announcement rather than inside it: a
            live region interrupts with the sentence that says what to do, and
            the heading is the line a reader scans to once it is on screen. */}
        <p className="nx-async__title">{failureTitle}</p>
        <Notice kind="danger" message={failureMessage} action={plan.retry ?? undefined} />
      </div>
    );
  }

  return <>{children(plan.data)}</>;
}
