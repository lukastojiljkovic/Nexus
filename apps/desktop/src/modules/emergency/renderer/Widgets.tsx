import { useCallback, useEffect, useState } from "react";
import { Chip, EmptyState, ListRow } from "@nexus/ui";
import {
  activeLocale,
  type DashboardWidgetBodyProps,
  type DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { EmergencyView } from "../shared/ipc.js";
import { CARD_TEXT } from "../shared/cardText.js";
import { contactName } from "./card.js";
import { copy } from "./copy.js";

/**
 * EMERGENCY's dashboard card: who the card is about, the two facts a reader
 * reaches for first, and the number to dial (ADR-090 §widgets).
 *
 * **Why this is a file of its own rather than part of the page.** The kit
 * discovers a module's widget bodies from `renderer/Widgets.tsx`, and this is
 * that file: the module brings its own card exactly as it brings its own page,
 * and the dashboard draws it with no edit to `DashboardWidgets.tsx`. What the kit
 * needs synchronously is `visible` — which is why this module is loaded with the
 * dashboard rather than with a page.
 *
 * **Why there is no button here.** The card's own frame opens the module
 * (DASH-005's deep link), and the module's page opens on the card, so one click
 * is already the whole journey — a control inside the body would be the same
 * navigation twice. „Odbrojavanja" makes the same call for the same reason, and
 * this file keeps it.
 *
 * **Why it reads the card rather than remembering it.** Main is the only place
 * the card exists; a widget that cached one would show yesterday's blood type
 * after somebody corrected it on the page. There is no ticking clock here to
 * make a reload necessary — a card changes when its owner edits it — so the read
 * happens on mount, like every other card's.
 */
function CardWidget({ profileId }: DashboardWidgetBodyProps) {
  const [view, setView] = useState<EmergencyView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await window.nexus.modules.emergency.list({ profileId }));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the emergency card could not be loaded:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className="nx-hint">{copy.widget.loadError}</p>;
  if (view === null) return <p className="nx-hint">{copy.widget.loading}</p>;

  const card = view.card;
  if (card === null) return <EmptyState variant="inline" title={copy.widget.empty} />;

  const first = view.contacts[0];
  const firstName = first === undefined ? null : contactName(first, view.people);
  return (
    <div className="emergency__widget">
      {card.fullName !== null && <p className="emergency__widget-name">{card.fullName}</p>}
      {card.bloodType !== null && (
        <Chip variant="data">
          {card.bloodType === "unknown"
            ? CARD_TEXT.bloodTypeUnknown[activeLocale()]
            : card.bloodType}
        </Chip>
      )}
      {first !== undefined && (
        <ListRow
          trailing={
            first.phone === null ? null : (
              <span className="emergency__widget-phone">{first.phone}</span>
            )
          }
        >
          <span>{firstName ?? CARD_TEXT.contactMissing[activeLocale()]}</span>
        </ListRow>
      )}
    </div>
  );
}

/**
 * The widgets this module publishes, by their OWN ids — the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `karta` is the id its contract declares in `shared/manifest.ts`, and the two
 * are compared by `modules.test.ts` through `ModuleRegistry.findWidget`, so a
 * typo here is a card the gallery offers and the page cannot draw.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  karta: {
    Body: CardWidget,
    // The card's own module is the only flag that matters: what it draws IS the
    // card, so a profile with „Hitna karta" switched off has nothing to see here.
    visible: (enabled) => enabled.has("emergency"),
  },
};
