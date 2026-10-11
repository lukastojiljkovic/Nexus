import { useEffect, useId, useState } from "react";
import { Checkbox } from "@nexus/ui";
import {
  declaredText,
  labelClass,
  settingsEntryId,
  type SettingsPanelProps,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import { copy } from "./copy.js";

/**
 * CULTURE's settings card body (ADR-090 §settings): one row, one checkbox, and
 * the module's whole preference.
 *
 * **Why the row's name is read from the manifest.** The declaration in
 * `shared/manifest.ts` is what the settings FILTER indexes and what the shots
 * harness looks for; this component draws the same words. Writing them twice is
 * how a card comes to search under one name and render another, so the
 * declaration is the one source and the pair is resolved with `declaredText`.
 *
 * **Why the value lives in the profile.** `storage: "profile"` in the
 * declaration and `culture_settings` in the database: main reads this boolean,
 * the programme's asking follows it, and it therefore travels in the profile's
 * own archive. The card is a thin client over two of this module's own ops -
 * it reads the module's view and writes one field of it - and it never touches
 * `localStorage`, which is where a DEVICE preference would go.
 */

/** The declared control this body draws, found by KEY so reordering the card cannot repoint the row. */
const PROMPT_ROW = manifest.settings?.controls.find((control) => control.key === "prompt-past-plans");

export default function CultureSettings({ profileId, hits }: SettingsPanelProps) {
  const [promptPastPlans, setPromptPastPlans] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** The name is a `<span>` the checkbox points at, so the accessible name is the visible one. */
  const labelId = useId();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const view = await window.nexus.modules.culture.list({ profileId });
        if (active) setPromptPastPlans(view.settings.promptPastPlans);
      } catch (loadError) {
        if (active) setError(copy.settings.loadError);
        console.error("Nexus: the culture setting could not be loaded:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function save(next: boolean): Promise<void> {
    setPromptPastPlans(next);
    setSaved(false);
    setError(null);
    try {
      const view = await window.nexus.modules.culture.setPromptPastPlans({
        profileId,
        promptPastPlans: next,
      });
      setPromptPastPlans(view.settings.promptPastPlans);
      setSaved(true);
    } catch (saveError) {
      setError(copy.settings.saveError);
      console.error("Nexus: the culture setting was not saved:", saveError);
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
              hits.has(settingsEntryId("culture", "prompt-past-plans")),
            )}
          >
            {declaredText(PROMPT_ROW?.labelKey)}
          </span>
          <span className="nx-hint">{copy.settings.hint}</span>
        </div>
        <Checkbox
          checked={promptPastPlans ?? true}
          aria-labelledby={labelId}
          disabled={promptPastPlans === null}
          onChange={(event) => void save(event.target.checked)}
        />
      </div>
      {error !== null && <p className="set__error">{error}</p>}
      {saved && error === null && <p className="nx-hint">{copy.settings.saved}</p>}
    </>
  );
}
