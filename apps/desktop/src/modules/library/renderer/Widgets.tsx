import { useCallback, useEffect, useState } from "react";
import { EmptyState, Icon, ListRow } from "@nexus/ui";
import {
  activeLocale,
  type DashboardWidgetBodyProps,
  type DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { LibraryView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { KIND_ICONS, formatProgress } from "./library.js";
// The card is drawn on the dashboard, which never loads the module's page - so
// the stylesheet comes with the card. Vite deduplicates it against the page's
// own import, so opening both costs one copy.
import "./library.css";

/**
 * BIBLIOTEKA's dashboard card (ADR-090 §widgets): what is being read or watched
 * right now, with each work's own progress.
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is
 * that file: the module brings its own card exactly as it brings its own page,
 * and the dashboard draws it with no edit to `DashboardWidgets.tsx`. What the kit
 * needs synchronously is `visible`, which is why this module is loaded with the
 * dashboard rather than with a page.
 *
 * **Why it reads once and does not poll.** A work in progress changes only when
 * somebody writes to the library, and every such write happens on the module's
 * own page - which is not this surface. A minute-by-minute re-read would be a
 * query a minute for a fact that cannot move while the card is on screen; the
 * card reads when it mounts, which is when the dashboard opens, and that is the
 * moment the answer can have changed.
 *
 * The wish list and the finished works are deliberately NOT here: a card of what
 * you have already finished answers nothing, and the shelf of what is next is a
 * thing you browse. `shared/manifest.ts` records the same refusal beside the one
 * card this module publishes.
 */
function CurrentWidget({ profileId }: DashboardWidgetBodyProps) {
  const [view, setView] = useState<LibraryView | null>(null);
  const [failed, setFailed] = useState(false);
  const locale = activeLocale();

  const load = useCallback(async () => {
    try {
      setView(await window.nexus.modules.library.list({ profileId }));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the library card could not be loaded:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className="nx-hint">{copy.widget.loadError}</p>;
  if (view === null) return <p className="nx-hint">{copy.widget.loading}</p>;

  const current = view.items.filter((item) => item.status === "in-progress");
  if (current.length === 0) {
    // No action slot: the card's own frame is what opens the module (DASH-005's
    // deep link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  return (
    <div className="lib__widget">
      {current.map((item) => (
        <ListRow key={item.id} leading={<Icon name={KIND_ICONS[item.kind]} />}>
          <span className="lib__row-title">{item.title}</span>
          <span className="lib__row-meta">
            {formatProgress(item, locale, {
              pages: copy.units.pages,
              episodes: copy.units.episodes,
            })}
          </span>
        </ListRow>
      ))}
    </div>
  );
}

/**
 * The widgets this module publishes, by their OWN ids - the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `trenutno` is the id its contract declares in `shared/manifest.ts`, and the
 * two are compared by the kit's own discovery test through
 * `ModuleRegistry.findWidget`, so a typo here is a card the gallery offers and
 * the page cannot draw - which is a failing test rather than a blank card.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  trenutno: {
    Body: CurrentWidget,
    // The card's own module is the only flag that matters: what it draws IS a
    // work of this module, so a profile with „Biblioteka" switched off has
    // nothing here to see.
    visible: (enabled) => enabled.has("library"),
  },
};
