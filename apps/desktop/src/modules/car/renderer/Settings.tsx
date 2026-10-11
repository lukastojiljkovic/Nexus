import { useEffect, useState } from "react";
import { Button, TextField } from "@nexus/ui";
import {
  declaredText,
  labelClass,
  settingsEntryId,
  type SettingsPanelProps,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import { parseDecimal } from "./carView.js";
import { copy } from "./copy.js";

/**
 * CAR's settings card body (ADR-090 §settings): the two thresholds `whatIsDue`
 * judges "due soon" against.
 *
 * **Why the rows' names come from the manifest.** The declaration in
 * `shared/manifest.ts` is what the settings FILTER indexes and what the shots
 * harness looks for; this component draws the same words. Writing them twice --
 * once as a declaration, once as copy in this table -- is how a card comes to
 * search under one name and render another, so the declaration is the one source
 * and each pair is resolved with `declaredText`.
 *
 * **Why the values live in the profile.** `storage: "profile"` in the
 * declaration and `car_settings` in the database: main reads them to decide when
 * to remind, and they are a fact about the vehicle's owner rather than about this
 * machine, so they travel in the profile's own archive. This card is a thin
 * client over two of the module's own ops -- it reads the garage for the values
 * and writes them back through `setThresholds` -- and it never touches
 * `localStorage`, which is where a DEVICE preference would go.
 *
 * **One Save for the pair.** The two numbers are one judgement ("soon"), and a
 * card that saved them one at a time would let a user leave with a window of
 * thirty days against a distance from the previous arrangement.
 */

/** The declared controls this body draws, found by KEY rather than by index, so reordering the card cannot silently repoint a row. */
const DAYS_ROW = manifest.settings?.controls.find((control) => control.key === "due-soon-days");
const DISTANCE_ROW = manifest.settings?.controls.find(
  (control) => control.key === "due-soon-distance",
);

export default function CarSettings({ profileId, hits }: SettingsPanelProps) {
  const [days, setDays] = useState("");
  const [distance, setDistance] = useState("");
  const [unit, setUnit] = useState("km");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const view = await window.nexus.modules.car.list({ profileId });
        if (!active) return;
        setDays(String(view.settings.dueSoonDays));
        setDistance(String(view.settings.dueSoonDistance));
        // The unit is the open vehicle's, because a threshold is a distance in
        // whichever unit the car in the garage counts in. A garage with no
        // vehicle in it has no unit to state, and the field says km.
        setUnit(view.vehicles[0]?.distanceUnit ?? "km");
        setLoaded(true);
      } catch (loadError) {
        if (active) setError(copy.settings.loadError);
        console.error("Nexus: the car thresholds could not be loaded:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  return (
    <>
      <p className="nx-hint">{copy.settings.caption}</p>
      <div className="set__module-row">
        <div className="set__module-info">
          <span
            className={labelClass(
              "set__module-name",
              hits.has(settingsEntryId("car", "due-soon-days")),
            )}
          >
            {declaredText(DAYS_ROW?.labelKey)}
          </span>
          <TextField
            label={copy.settings.days}
            inputMode="numeric"
            className="car__threshold-field"
            value={days}
            disabled={!loaded}
            onChange={(event) => setDays(event.target.value)}
          />
        </div>
        <div className="set__module-info">
          <span
            className={labelClass(
              "set__module-name",
              hits.has(settingsEntryId("car", "due-soon-distance")),
            )}
          >
            {declaredText(DISTANCE_ROW?.labelKey)}
          </span>
          <TextField
            label={copy.settings.distance.replace("{unit}", unit)}
            inputMode="numeric"
            className="car__threshold-field"
            value={distance}
            disabled={!loaded}
            onChange={(event) => setDistance(event.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={!loaded}
          onClick={() => {
            const parsedDays = parseDecimal(days);
            const parsedDistance = parseDecimal(distance);
            if (
              parsedDays === null ||
              !Number.isInteger(parsedDays) ||
              parsedDays < 1 ||
              parsedDistance === null ||
              !Number.isInteger(parsedDistance) ||
              parsedDistance < 1
            ) {
              setProblem(true);
              setSaved(false);
              return;
            }
            setProblem(false);
            setSaved(false);
            setError(null);
            void (async () => {
              try {
                const view = await window.nexus.modules.car.setThresholds({
                  profileId,
                  dueSoonDays: parsedDays,
                  dueSoonDistance: parsedDistance,
                });
                setDays(String(view.settings.dueSoonDays));
                setDistance(String(view.settings.dueSoonDistance));
                setSaved(true);
              } catch (saveError) {
                setError(copy.settings.saveError);
                console.error("Nexus: the car thresholds were not saved:", saveError);
              }
            })();
          }}
        >
          {copy.settings.save}
        </Button>
      </div>
      <p className="nx-hint">{copy.settings.hint}</p>
      {problem && <p className="set__error">{copy.errors.integer}</p>}
      {error !== null && <p className="set__error">{error}</p>}
      {saved && error === null && <p className="nx-hint">{copy.settings.saved}</p>}
    </>
  );
}
