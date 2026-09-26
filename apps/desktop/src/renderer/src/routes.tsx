import { Component, Suspense, lazy, type ReactNode } from "react";
import { EmptyState, LoadingState } from "@nexus/ui";
import { strings } from "./strings.js";

/**
 * Every page the shell draws, each loaded the first time it is opened.
 *
 * **Why.** Until 2026-09-26 `App.tsx` imported all sixteen pages statically, so
 * the renderer was one 11.26 MB chunk that every session parsed before its first
 * paint — Excalidraw, KaTeX, the note editor, every professional tool and the
 * developer drawer included, to show a dashboard. The shell itself (sidebar,
 * title strip, palette, the auth and onboarding screens) is what startup needs;
 * a page is needed when somebody opens it.
 *
 * **The rule this file is the whole of: a page is reached through here and
 * nowhere else.** A single value import of a page module from anything the
 * shell loads — a constant, a helper, one component — puts the entire page
 * back in the startup chunk, and nothing fails: the build succeeds, every test
 * passes and the app works, only slower. That is why `PRIV_LOCKED_EVENT` moved
 * out of `PrivPage.tsx` into `privEvents.ts` the day this landed, and why
 * `routes.test.ts` walks the static import graph from `main.tsx` and fails if
 * it reaches any module this file loads lazily. Types are free: an
 * `import type` is erased, so `App` keeps naming `TasksIntent` and friends.
 *
 * Each page keeps its named export and is adapted here, rather than growing a
 * `default` export for `lazy` to find, so the module's own tests and every
 * other importer keep reading it the way they always have.
 */
export const DashboardPage = lazy(() =>
  import("./DashboardPage.js").then((module) => ({ default: module.DashboardPage })),
);
export const TasksPage = lazy(() =>
  import("./TasksPage.js").then((module) => ({ default: module.TasksPage })),
);
export const CalendarPage = lazy(() =>
  import("./CalendarPage.js").then((module) => ({ default: module.CalendarPage })),
);
export const NotesPage = lazy(() =>
  import("./NotesPage.js").then((module) => ({ default: module.NotesPage })),
);
export const PrivPage = lazy(() =>
  import("./PrivPage.js").then((module) => ({ default: module.PrivPage })),
);
export const FilesPage = lazy(() =>
  import("./FilesPage.js").then((module) => ({ default: module.FilesPage })),
);
export const StudyPage = lazy(() =>
  import("./StudyPage.js").then((module) => ({ default: module.StudyPage })),
);
export const FinancePage = lazy(() =>
  import("./FinancePage.js").then((module) => ({ default: module.FinancePage })),
);
export const HabitsPage = lazy(() =>
  import("./HabitsPage.js").then((module) => ({ default: module.HabitsPage })),
);
export const FocusPage = lazy(() =>
  import("./FocusPage.js").then((module) => ({ default: module.FocusPage })),
);
export const ToolsPage = lazy(() =>
  import("./ToolsPage.js").then((module) => ({ default: module.ToolsPage })),
);
export const CanvasPage = lazy(() =>
  import("./CanvasPage.js").then((module) => ({ default: module.CanvasPage })),
);
export const ElectronicsPage = lazy(() =>
  import("./ElectronicsPage.js").then((module) => ({ default: module.ElectronicsPage })),
);
export const FitnessPage = lazy(() =>
  import("./FitnessPage.js").then((module) => ({ default: module.FitnessPage })),
);
export const SettingsPage = lazy(() =>
  import("./SettingsPage.js").then((module) => ({ default: module.SettingsPage })),
);
export const SearchPage = lazy(() =>
  import("./SearchPage.js").then((module) => ({ default: module.SearchPage })),
);

interface PageSlotProps {
  /** Which page `children` is. A change of page is what clears a failure. */
  readonly page: string;
  readonly children: ReactNode;
}

interface PageSlotState {
  readonly page: string;
  readonly failed: boolean;
}

/**
 * The main pane's one boundary: a skeleton while a page's chunk is arriving, a
 * sentence if it cannot be drawn.
 *
 * **The skeleton is seen for the first page after unlock, and after that almost
 * never.** `App` hands its pages the id through `useDeferredValue`, so a
 * navigation is rendered in the background and the page being left stays on
 * screen until the next one is ready — React only swaps a boundary that is
 * already showing content for its fallback when an URGENT render suspends. The
 * first page after unlock has nothing to stay on screen instead of it. That is
 * also why this boundary is never keyed by page: a boundary mounted fresh for
 * every page would have no content to keep, and every first visit would blink.
 *
 * **The failure state is new, and the lazy import is what made it necessary.**
 * A chunk that cannot be read — a damaged install, a file removed from under a
 * running app — rejects inside `lazy`, and an error nothing catches unmounts
 * the whole root: the window would go blank, sidebar and all. Caught here, it
 * costs the one page, and the sidebar still works. A page that throws while
 * RENDERING is caught by the same boundary for the same reason, which is a
 * behaviour change worth stating: before this existed, that too blanked the
 * window. React reports what it catches to the console on its own
 * (`onCaughtError`), so nothing is logged twice here.
 *
 * `lazy` caches a rejection, so revisiting a page whose chunk failed shows the
 * failure again rather than retrying. On a local disk that is the honest
 * answer: the file will not be there on the second attempt either.
 */
export class PageSlot extends Component<PageSlotProps, PageSlotState> {
  override state: PageSlotState = { page: this.props.page, failed: false };

  static getDerivedStateFromProps(
    props: PageSlotProps,
    state: PageSlotState,
  ): Partial<PageSlotState> | null {
    return props.page === state.page ? null : { page: props.page, failed: false };
  }

  static getDerivedStateFromError(): Partial<PageSlotState> {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        // The class is the smoke run's hook (`runSmokePageWalk`), which fails
        // on it; `role="alert"` is for everybody else, because this replaces
        // the page the user just asked for.
        <div className="app__page-failed" role="alert">
          <EmptyState
            title={strings.app.pageErrorTitle}
            description={strings.app.pageErrorDescription}
          />
        </div>
      );
    }
    return (
      <Suspense
        fallback={
          // The class is what the harnesses wait on (`shots/`, the smoke walk):
          // a frame taken while it is present is a frame of the wrong page.
          <LoadingState label={strings.app.loading} rows={6} className="app__page-pending" />
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
