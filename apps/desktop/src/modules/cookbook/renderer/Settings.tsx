import { useEffect, useId, useState } from "react";
import { Select } from "@nexus/ui";
import {
  declaredText,
  labelClass,
  settingsEntryId,
  type SettingsPanelProps,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { COOKBOOK_UNIT_SYSTEMS, type CookbookUnitSystem } from "../shared/ipc.js";
import { manifest } from "../shared/manifest.js";
import { copy } from "./copy.js";

/**
 * COOKBOOK's settings card body (ADR-090 §settings): one row, one choice, and
 * the module's whole preference.
 *
 * **Why the row's name is read from the manifest.** The declaration in
 * `shared/manifest.ts` is what the settings FILTER indexes and what the shots
 * harness looks for; this component draws the same words, resolved with
 * `declaredText` because a manifest's `{ sr, en }` pair is not rewritten in
 * place the way this file's `copy` table is.
 *
 * **Why the value lives in the profile.** `storage: "profile"` in the
 * declaration and `cookbook_settings` in the database: main reads this row when
 * it renders a recipe, and it therefore travels in the profile's own archive.
 * The card is a thin client over two of this module's own ops and never touches
 * `localStorage`, which is where a DEVICE preference would go.
 *
 * The two labels beside the choice are the module's own reading of a unit
 * (`copy`-free on purpose): „Metric" and „Kitchen" are the words the copy table
 * for the page carries as `units` names, and the manifest's option pairs are
 * what this row draws — one source for the name, as above.
 */

/** The declared control this body draws, found by KEY so reordering the card cannot repoint the row. */
const UNIT_ROW = manifest.settings?.controls.find((control) => control.key === "unit-system");

export default function CookbookSettings({ profileId, hits }: SettingsPanelProps) {
  const [unitSystem, setUnitSystem] = useState<CookbookUnitSystem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** The name is a `<span>` the select points at, so the accessible name is the visible one. */
  const labelId = useId();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const view = await window.nexus.modules.cookbook.list({ profileId });
        if (active) setUnitSystem(view.settings.unitSystem);
      } catch (loadError) {
        if (active) setError(copy.settings.loadError);
        console.error("Nexus: the cookbook setting could not be loaded:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function save(next: CookbookUnitSystem): Promise<void> {
    setUnitSystem(next);
    setSaved(false);
    setError(null);
    try {
      const view = await window.nexus.modules.cookbook.setUnitSystem({
        profileId,
        unitSystem: next,
      });
      setUnitSystem(view.settings.unitSystem);
      setSaved(true);
    } catch (saveError) {
      setError(copy.settings.saveError);
      console.error("Nexus: the cookbook setting was not saved:", saveError);
    }
  }

  return (
    <>
      <p className="nx-hint">{copy.settings.caption}</p>
      <div className="set__module-row">
        <div className="set__module-info">
          <span
            id={labelId}
            className={labelClass(
              "set__module-name",
              hits.has(settingsEntryId("cookbook", "unit-system")),
            )}
          >
            {declaredText(UNIT_ROW?.labelKey)}
          </span>
          <span className="nx-hint">{copy.settings.hint}</span>
        </div>
        <Select
          aria-labelledby={labelId}
          value={unitSystem ?? "metric"}
          disabled={unitSystem === null}
          onChange={(event) => void save(event.target.value as CookbookUnitSystem)}
        >
          {COOKBOOK_UNIT_SYSTEMS.map((option) => (
            <option key={option} value={option}>
              {declaredText(
                UNIT_ROW?.kind === "choice"
                  ? UNIT_ROW.options.find((candidate) => candidate.id === option)?.labelKey
                  : undefined,
              )}
            </option>
          ))}
        </Select>
      </div>
      {error !== null && <p className="set__error">{error}</p>}
      {saved && error === null && <p className="nx-hint">{copy.settings.saved}</p>}
    </>
  );
}
