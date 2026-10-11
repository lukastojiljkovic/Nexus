import { useCallback, useEffect, useState } from "react";
import { EmptyState, Icon, ListRow } from "@nexus/ui";
import type {
  DashboardWidgetBodyProps,
  DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { CookbookView, RecipeSummaryView } from "../shared/ipc.js";
import { courseLabel, formatTime, totalMinutes } from "./cookbook.js";
import { copy } from "./copy.js";

/**
 * COOKBOOK's dashboard card: this profile's recipes, newest first (ADR-090
 * §widgets).
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and the
 * dashboard draws what it finds with no edit to `DashboardWidgets.tsx`. What the
 * kit needs SYNCHRONOUSLY is `visible` — which is why this module is loaded with
 * the dashboard rather than with a page.
 *
 * **Newest first, and by `updatedAt` rather than `createdAt`.** The card answers
 * „what is in my cookbook and what did I touch last", which is what a person
 * opening the dashboard is asking; the full list on the page keeps the store's
 * own alphabetical order, where finding a recipe by name is the question.
 */

/** How many rows the card draws: a home-screen glance, not the cookbook. */
const ROWS = 5;

function RecipesWidget({ profileId }: DashboardWidgetBodyProps) {
  const [view, setView] = useState<CookbookView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await window.nexus.modules.cookbook.list({ profileId }));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the cookbook card could not be loaded:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className="nx-hint">{copy.widget.loadError}</p>;
  if (view === null) return <p className="nx-hint">{copy.widget.loading}</p>;

  const newest = [...view.recipes]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title))
    .slice(0, ROWS);

  if (newest.length === 0) {
    // No action slot: the card's own frame opens the module (DASH-005's deep
    // link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  return (
    <div className="cookbook__list">
      {newest.map((recipe) => (
        <ListRow key={recipe.id} leading={<Icon name="cookbook" />}>
          <span className="cookbook__row-title">{recipe.title}</span>
          <span className="cookbook__row-meta">
            {courseLabel(recipe.course)}
            {timeLabel(recipe) === null ? "" : ` · ${timeLabel(recipe) ?? ""}`}
          </span>
        </ListRow>
      ))}
    </div>
  );
}

/** A recipe's total time as text, or null when it states none. */
function timeLabel(recipe: RecipeSummaryView): string | null {
  const total = totalMinutes(recipe);
  return total === null ? null : formatTime(total);
}

/**
 * The widgets this module publishes, by their OWN ids — the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `recepti` is the id its contract declares in `shared/manifest.ts`, and the two
 * are compared through `ModuleRegistry.findWidget`, so a typo here is a failing
 * test rather than a card the gallery offers and the page cannot draw.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  recepti: {
    Body: RecipesWidget,
    // The card's own module is the only flag that matters: what it draws IS a
    // recipe list of this module, so a profile with „Kuvarica" switched off has
    // nothing here to see.
    visible: (enabled) => enabled.has("cookbook"),
  },
};
