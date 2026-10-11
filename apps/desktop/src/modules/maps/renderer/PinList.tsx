import { Button, EmptyState } from "@nexus/ui";
import type { MapsPinView } from "../shared/ipc.js";
import { copy } from "./copy.js";

/**
 * The pins as a list beside the map.
 *
 * **Why a list at all, when the pins are drawn on the map.** The map is a
 * canvas: a pin on it is reachable by pointer, and a person using a keyboard
 * cannot tab to a circle drawn into a WebGL surface. This list is the same set
 * of pins as buttons — one per pin, naming its title and its note — carrying the
 * two actions that must not be pointer-only (edit, remove). Selecting a row also
 * jumps the camera to that pin, which is the list's third job: it is the only
 * way to say "take me to Vinarija" without hunting for its dot.
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
  onSelect: (pin: MapsPinView) => void;
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
        <ul className="maps__list-rows">
          {pins.map((pin) => (
            <li key={pin.id} className="maps__list-row">
              <button
                type="button"
                className={`maps__list-pick${pin.id === selectedId ? " maps__list-pick--selected" : ""}`}
                aria-pressed={pin.id === selectedId}
                onClick={() => onSelect(pin)}
              >
                <span
                  className="maps__list-dot"
                  style={{ background: `var(--nx-swatch-${pin.color})` }}
                  aria-hidden="true"
                />
                <span className="maps__list-name">{pin.title}</span>
                <span className="maps__list-note">{pin.note ?? copy.pins.noteEmpty}</span>
              </button>
              <span className="maps__list-actions">
                <Button size="sm" onClick={() => onEdit(pin)}>
                  {copy.pins.edit}
                </Button>
                <Button size="sm" variant="quiet" onClick={() => onRemove(pin)}>
                  {copy.pins.remove}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
