import { useCallback, useEffect, useState } from "react";
import { formatRecordingDuration } from "@nexus/core";
import { EmptyState, Icon, ListRow } from "@nexus/ui";
import type {
  DashboardWidgetBodyProps,
  DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { activeLocale } from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { RecorderView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { entryTitle, formatTimeOfDay } from "./entries.js";

/**
 * The RECORDER's dashboard card: the newest recordings, and how long each runs
 * (ADR-090 §widgets).
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is
 * that file: the module brings its own card exactly as it brings its own page,
 * and the dashboard draws it with no edit to `DashboardWidgets.tsx`.
 *
 * **Why the card is capped and the page is not.** A dashboard card is a glance
 * at a fixed small size, and a diary can hold hundreds of recordings; the page
 * is where the list lives. The number is the card's own (`GLANCE_ROWS`), which
 * is why `shared/manifest.ts` declares no `count` field for it.
 *
 * **Why it re-reads.** A recording is written by the module's own page, on the
 * same machine: a card that only drew what it read once would keep showing the
 * library as it was when the dashboard opened. One read a minute is enough for
 * a card nobody is editing.
 */

/** How many recordings the card draws. */
const GLANCE_ROWS = 5;

/** How often the card asks main again. */
const RELOAD_MS = 60_000;

function RecordingsWidget({ profileId }: DashboardWidgetBodyProps) {
  const [view, setView] = useState<RecorderView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await window.nexus.modules.recorder.list({ profileId }));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the recordings card could not be loaded:", error);
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
  if (view === null) return <p className="nx-hint">{copy.widget.loading}</p>;
  if (view.entries.length === 0) {
    // No action slot: the card's own frame is what opens the module (DASH-005's
    // deep link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  const locale = activeLocale();
  return (
    <div className="rec__widget">
      {view.entries.slice(0, GLANCE_ROWS).map((entry) => (
        <ListRow key={entry.id} leading={<Icon name="mic" />}>
          <span className="rec__row-title">{entryTitle(entry.title, entry.createdAt, locale)}</span>
          <span className="rec__row-meta">
            {formatTimeOfDay(entry.createdAt, locale)} ·{" "}
            {formatRecordingDuration(entry.durationMs)}
          </span>
        </ListRow>
      ))}
    </div>
  );
}

/**
 * The widgets this module publishes, by their OWN ids — the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `snimci` is the id its contract declares in `shared/manifest.ts`, and the two
 * are compared by `modules.test.ts` through `ModuleRegistry.findWidget`, so a
 * typo here is a card the gallery offers and the page cannot draw.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  snimci: {
    Body: RecordingsWidget,
    // The card's own module is the only flag that matters: what it draws IS this
    // module's list, so a profile with „Snimač" switched off has nothing to see.
    visible: (enabled) => enabled.has("recorder"),
  },
};
