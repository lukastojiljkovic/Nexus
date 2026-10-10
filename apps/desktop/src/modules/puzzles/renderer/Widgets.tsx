import { useCallback, useEffect, useState } from "react";
import { Chip, EmptyState, Icon, ListRow } from "@nexus/ui";
import {
  type DashboardWidgetBodyProps,
  type DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { PuzzlesView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { formatClock } from "./format.js";
import { variantLabel } from "./panelKit.js";

/**
 * PUZZLES' dashboard card: the games somebody is in the middle of (ADR-090
 * §widgets).
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is
 * that file: the module brings its own card exactly as it brings its own page,
 * and the dashboard draws it with no edit to `DashboardWidgets.tsx`. What the kit
 * needs synchronously is `visible` — which is why this module is loaded with the
 * dashboard rather than with a page.
 *
 * **Why it re-reads.** The rows change while the card is on screen: a game is
 * finished, a new one is dealt, another window's page writes one. A card that
 * only drew what it read once would be a card that is wrong the moment anything
 * happens, so it reads again on the same minute tick a person would.
 *
 * The BOARD is deliberately not here: a playable sudoku is 81 controls, and a
 * dashboard tile that drew one would be a puzzle nobody could reach. What the
 * card says is which games are open, and its own frame is what opens the module
 * (DASH-005's deep link).
 */

/** How often the rows are read again — the period at which „still in progress" is asked. */
const RELOAD_MS = 60_000;

function StartedWidget({ profileId }: DashboardWidgetBodyProps) {
  const [view, setView] = useState<PuzzlesView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await window.nexus.modules.puzzles.list({ profileId }));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the puzzles card could not be loaded:", error);
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

  if (view.saves.length === 0) {
    // No action slot: the card's own frame is what opens the module (DASH-005's
    // deep link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  return (
    <div className="pz-widget">
      {view.saves.map((save) => (
        <ListRow
          key={`${save.puzzle}:${save.variant}`}
          leading={<Icon name="grid" />}
          trailing={<Chip>{formatClock(save.elapsedSeconds)}</Chip>}
        >
          <span className="pz-widget__name">
            {`${copy.tabs[save.puzzle]} · ${variantLabel(save.puzzle, save.variant)}`}
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
 * `zapoceto` is the id its contract declares in `shared/manifest.ts`, and the two
 * are compared by `modules.test.ts` through `ModuleRegistry.findWidget`, so a
 * typo here is a card the gallery offers and the page cannot draw — which is a
 * failing test rather than a blank card.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  zapoceto: {
    Body: StartedWidget,
    // The card's own module is the only flag that matters: what it draws IS a
    // puzzle of this module, so a profile with „Slagalice" switched off has
    // nothing here to see.
    visible: (enabled) => enabled.has("puzzles"),
  },
};
