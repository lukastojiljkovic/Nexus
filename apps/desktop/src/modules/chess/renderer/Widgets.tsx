import { useCallback, useEffect, useState } from "react";
import { EmptyState, Icon, ListRow } from "@nexus/ui";
import type {
  DashboardWidgetBodyProps,
  DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { numberFormat } from "../../../renderer/src/intl.js";
import type { ChessView } from "../shared/ipc.js";
import { timeControlWords } from "./clock.js";
import { copy } from "./copy.js";

/**
 * CHESS' dashboard card: the game the profile was left in the middle of.
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is
 * that file: the module brings its own card exactly as it brings its own page,
 * and the dashboard draws it with no edit to `DashboardWidgets.tsx`. What the kit
 * needs synchronously is `visible` - which is why this module is loaded with the
 * dashboard rather than with a page.
 *
 * **Why the card draws a resumption rather than a record.** A half-played game is
 * the one fact here a home screen can act on: the position is already stored, and
 * the board is one click away. „Twelve games, five won" is a fact about the past,
 * and the module's manifest records that refusal beside the card it does publish.
 *
 * The card reads the module's whole view, because the view is what `list`
 * answers; the GAMES table's PGNs are not in it (see `shared/ipc.ts`), so this
 * costs a few hundred bytes rather than a game per row.
 */

function ResumeWidget({ profileId }: DashboardWidgetBodyProps) {
  const [view, setView] = useState<ChessView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await window.nexus.modules.chess.list({ profileId }));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the chess card could not be loaded:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className="nx-hint">{copy.widget.loadError}</p>;
  if (view === null) return <p className="nx-hint">{copy.widget.loading}</p>;
  if (view.resume === null) {
    // No action slot: the card's own frame is what opens the module (DASH-005's
    // deep link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  const resume = view.resume;
  const opponent =
    resume.opponent === "engine" ? copy.setup.opponentEngine : copy.setup.opponentHuman;
  const parts = [opponent];
  if (resume.level !== null) {
    parts.push(`${copy.setup.level} ${numberFormat().format(resume.level)}`);
  }
  if (resume.timeControl !== null) parts.push(timeControlWords(resume.timeControl));
  parts.push(`${numberFormat().format(resume.moves.length)} ${copy.games.moves}`);

  return (
    <div className="chess__widget">
      <ListRow leading={<Icon name="grid" />}>
        <span className="chess__row-label">{copy.games.resumeTitle}</span>
        <span className="chess__row-meta">{parts.join(" · ")}</span>
      </ListRow>
    </div>
  );
}

/**
 * The widgets this module publishes, by their OWN ids - the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `partija-u-toku` is the id its contract declares in `shared/manifest.ts`, and
 * the two are compared by `modules.test.ts` through `ModuleRegistry.findWidget`,
 * so a typo here is a card the gallery offers and the page cannot draw - which is
 * a failing test rather than a blank card.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  "partija-u-toku": {
    Body: ResumeWidget,
    // The card's own module is the only flag that matters: what it draws IS a
    // chess game, so a profile with „Šah" switched off has nothing here to see.
    visible: (enabled) => enabled.has("chess"),
  },
};
