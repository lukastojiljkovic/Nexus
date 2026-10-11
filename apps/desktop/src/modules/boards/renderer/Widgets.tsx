import { useCallback, useEffect, useState } from "react";
import { EmptyState, Icon, ListRow } from "@nexus/ui";
import type {
  DashboardWidgetBodyProps,
  DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { numberFormat } from "../../../renderer/src/intl.js";
import { fill } from "../../../renderer/src/strings.js";
import type { BoardsSaveView, BoardsView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import "./boards.css";

/**
 * BOARDS' dashboard card: the games somebody is in the middle of (ADR-090
 * §widgets).
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is that
 * file: the module brings its own card exactly as it brings its own page, and the
 * dashboard draws it with no edit to `DashboardWidgets.tsx`. What the kit needs
 * synchronously is `visible`, which is why this module is loaded with the
 * dashboard rather than with a page.
 *
 * **Why it re-reads instead of trusting what it drew.** A game saved from the page
 * is a row main wrote; this card is a second reader of the same rows, so it asks
 * again on a slow timer rather than keeping a copy that would go stale the moment
 * somebody played a move in another window. Six rows at most, so the read is a
 * handful of bytes and the timer is a minute.
 *
 * There is no action on the card: its own frame is what opens the module
 * (DASH-005's deep link), which is where a game is resumed.
 */

/** How often the rows are read again — the period at which "is this still here" is asked. */
const RELOAD_MS = 60_000;

function GamesWidget({ profileId }: DashboardWidgetBodyProps) {
  const [saves, setSaves] = useState<readonly BoardsSaveView[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const view: BoardsView = await window.nexus.modules.boards.list({ profileId });
      setSaves(view.saves);
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the board games card could not be loaded:", error);
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
  if (saves === null) return <p className="nx-hint">{copy.widget.loading}</p>;
  if (saves.length === 0) {
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  return (
    <div className="boards__widget">
      {saves.map((save) => (
        <ListRow key={save.game} leading={<Icon name="grid" />}>
          <span className="boards__row-name">{copy.games[save.game].name}</span>
          <span className="boards__row-about">
            {fill(copy.widget.moves, { count: numberFormat().format(save.moves) })}
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
 * `u-toku` is the id its contract declares in `shared/manifest.ts`, and the two are
 * compared by `modules.test.ts` through `ModuleRegistry.findWidget`, so a typo here
 * is a card the gallery offers and the page cannot draw — which is a failing test
 * rather than a blank card.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  "u-toku": {
    Body: GamesWidget,
    // The card's own module is the only flag that matters: what it draws IS a
    // board game of this module, so a profile with „Igre na tabli" switched off has
    // nothing here to see.
    visible: (enabled) => enabled.has("boards"),
  },
};
