import { useCallback, useEffect, useState } from "react";
import { EmptyState, ListRow } from "@nexus/ui";
import type {
  DashboardWidgetBodyProps,
  DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { WikiHistoryView } from "../shared/ipc.js";
import { copy } from "./copy.js";

/**
 * WIKI's dashboard card: the pages last read, newest first (ADR-090 §widgets).
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is
 * that file: the module brings its own card exactly as it brings its own page,
 * and the dashboard draws it with no edit to `DashboardWidgets.tsx`. What the kit
 * needs synchronously is `visible` — which is why this module is loaded with the
 * dashboard rather than with a page.
 *
 * **Why re-read rather than remembered.** The history changes while the card is
 * on screen — the user is reading in the module's page in the next window, and
 * the app has one window — so the card asks again on its own, at a period no
 * smaller than a person notices.
 *
 * The card is a LIST and not a count: „three libraries" is a number nobody acts
 * on, where „where was I" is the question a reference library answers. The row
 * cap is five, which is what the dashboard's own lists use.
 */

/** How often the card asks main again. A minute is under the notice of anybody reading. */
const RELOAD_MS = 60_000;

/** How many rows the card draws. The dashboard's own lists show five. */
const ROWS = 5;

function RecentWidget({ profileId }: DashboardWidgetBodyProps) {
  const [history, setHistory] = useState<readonly WikiHistoryView[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const view = await window.nexus.modules.wiki.list({ profileId });
      setHistory(view.history.slice(0, ROWS));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the wiki card could not be loaded:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handle = setInterval(() => void load(), RELOAD_MS);
    return () => clearInterval(handle);
  }, [load]);

  if (failed) return <p className="nx-hint">{copy.widget.loadError}</p>;
  if (history === null) return <p className="nx-hint">{copy.widget.loading}</p>;
  if (history.length === 0) {
    // No action slot: the card's own frame is what opens the module (DASH-005's
    // deep link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  return (
    <div className="wiki__widget">
      {history.map((row) => (
        <ListRow key={row.id}>
          <span className="wiki__title">{row.title}</span>
          <span className="wiki__meta">{row.libraryId}</span>
        </ListRow>
      ))}
    </div>
  );
}

/**
 * The widgets this module publishes, by their OWN ids — the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `skorije` is the id its contract declares in `shared/manifest.ts`, and the two
 * are compared by `modules.test.ts` through `ModuleRegistry.findWidget`, so a
 * typo here is a card the gallery offers and the page cannot draw.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  skorije: {
    Body: RecentWidget,
    // The card's own module is the only flag that matters: what it draws IS this
    // module's history, so a profile with „Reference" switched off has nothing
    // here to see.
    visible: (enabled) => enabled.has("wiki"),
  },
};
