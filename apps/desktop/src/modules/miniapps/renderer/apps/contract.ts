import type { MiniappsView } from "../../shared/ipc.js";

/**
 * What every mini-app's body is handed by the page.
 *
 * Three things, and each has a reason: the profile the page stands in (the
 * write payloads), the kept state as main last answered it (one source, so a
 * tool never renders a local guess), and `run`, which performs one write and
 * folds main's answer back into the page. A tool that needs none of them - the
 * metronome keeps nothing - simply takes no props, which is why this type is not
 * forced on every component.
 */
export interface MiniAppProps {
  readonly profileId: string;
  readonly view: MiniappsView;
  readonly run: Run;
}

/**
 * One write. The page owns the error state, so a tool hands over the call and
 * never touches the view itself: `run((api) => api.saveCounters({ profileId, counters }))`.
 */
export type Run = (
  action: (api: typeof window.nexus.modules.miniapps) => Promise<MiniappsView>,
) => Promise<void>;
