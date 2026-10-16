import { Button, EmptyState, ListDetail } from "@nexus/ui";
import type { MapsPinView } from "../shared/ipc.js";
import { copy } from "./copy.js";

/**
 * The pins as a list beside the map.
 *
 * **Why a list at all, when the pins are drawn on the map.** The map is a
 * canvas: a pin on it is reachable by pointer, and a person using a keyboard
 * cannot tab to a circle drawn into a WebGL surface. This list is the same set
 * of pins as a `ListDetail`, one row per pin, and it carries the two actions
 * that must not be pointer-only (edit, remove) in the detail pane, where they
 * have their own names. Selecting a row also jumps the camera to that pin, which
 * is the list's third job: it is the only way to say "take me to Vinarija"
 * without hunting for its dot.
 *
 * **A disclosure, not a permanent column.** At the minimum window (900 × 600) a
 * fixed column would take a third of the map, and the map is the content. The
 * page opens it (the toolbar's button, and a click on a pin), and Escape closes
 * it.
 */
export function PinList({
  pins,
  selectedId,
  onSelect,
  onEdit,
  onRemove,
}: {
  pins: readonly MapsPinView[];
  selectedId: string | null;
  onSelect: (pin: MapsPinView | null) => void;
  onEdit: (pin: MapsPinView) => void;
  onRemove: (pin: MapsPinView) => void;
}) {
  return (
    <div className="maps__list" role="group" aria-label={copy.pins.title}>
      <h2 className="maps__list-title">{copy.pins.title}</h2>
      {pins.length === 0 ? (
        <EmptyState
          variant="inline"
          title={copy.pins.emptyTitle}
          description={copy.pins.emptyBody}
        />
      ) : (
        <ListDetail
          className="maps__pins"
          items={pins}
          itemKey={(pin) => pin.id}
          listLabel={copy.pins.title}
          detailLabel={copy.pins.detailLabel}
          backLabel={copy.pins.back}
          renderRow={(pin) => (
            <>
              <span
                className="maps__list-dot"
                style={{ background: `var(--nx-swatch-${pin.color})` }}
                aria-hidden="true"
              />
              <span className="maps__list-name">{pin.title}</span>
            </>
          )}
          renderDetail={(pin) =>
            pin === null ? (
              <p className="nx-hint">{copy.pins.pickHint}</p>
            ) : (
              <>
                <span className="maps__list-name">{pin.title}</span>
                <span className="maps__list-note">{pin.note ?? copy.pins.noteEmpty}</span>
                <span className="maps__list-actions">
                  <Button size="sm" onClick={() => onEdit(pin)}>
                    {copy.pins.edit}
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => onRemove(pin)}>
                    {copy.pins.remove}
                  </Button>
                </span>
              </>
            )
          }
          selectedId={selectedId}
          onSelect={(id) => onSelect(pins.find((pin) => pin.id === id) ?? null)}
        />
      )}
    </div>
  );
}
