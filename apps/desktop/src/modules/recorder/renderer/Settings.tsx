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
 * The RECORDER's settings card body (ADR-090 §settings): one row, one checkbox,
 * and the module's whole preference.
 *
 * **Why the row's name is read from the manifest.** The declaration in
 * `shared/manifest.ts` is what the settings FILTER indexes and what the shots
 * harness looks for; this component draws the same words. Writing them twice —
 * once as a declaration, once as copy in this table — is how a card comes to
 * search under one name and render another, so the declaration is the one source
 * and the pair is resolved with `declaredText`.
 *
 * **Why the value lives in the PROFILE.** `storage: "profile"` in the
 * declaration and `recorder_settings` in the database: main reads this row, the
 * capture on any machine of this profile obeys it, and it therefore travels in
 * the profile's own archive. The card is a thin client over two of this module's
 * own ops — it reads the module's view and writes one field of it — and it never
 * touches `localStorage`, which is where a DEVICE preference would go (and which
 * is why this card offers no „Vrati na podrazumevano": that link belongs to the
 * cards whose whole state is this machine's, SET §5).
 */

/** The declared control this body draws. Found by KEY rather than by index, so reordering the card cannot silently repoint this row at another setting. */
const COUNTDOWN_ROW = manifest.settings?.controls.find((control) => control.key === "countdown");

export default function RecorderSettings({ profileId, hits }: SettingsPanelProps) {
  const [countdown, setCountdown] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** The name is a `<span>` the checkbox points at, so the accessible name is the visible one — `SettingsField`'s own arrangement, one row here instead of four. */
  const labelId = useId();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const view = await window.nexus.modules.recorder.list({ profileId });
        if (active) setCountdown(view.settings.countdown);
      } catch (loadError) {
        if (active) setError(copy.settings.loadError);
        console.error("Nexus: the recorder setting could not be loaded:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function save(next: boolean): Promise<void> {
    setCountdown(next);
    setSaved(false);
    setError(null);
    try {
      const view = await window.nexus.modules.recorder.setCountdown({ profileId, countdown: next });
      setCountdown(view.settings.countdown);
      setSaved(true);
    } catch (failure) {
      setError(copy.settings.saveError);
      console.error("Nexus: the recorder setting was not saved:", failure);
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
              hits.has(settingsEntryId("recorder", "countdown")),
            )}
          >
            {declaredText(COUNTDOWN_ROW?.labelKey)}
          </span>
          <span className="nx-hint">{copy.settings.hint}</span>
        </div>
        <Checkbox
          checked={countdown ?? false}
          aria-labelledby={labelId}
          disabled={countdown === null}
          onChange={(event) => void save(event.target.checked)}
        />
      </div>
      {error !== null && <p className="set__error">{error}</p>}
      {saved && error === null && <p className="nx-hint">{copy.settings.saved}</p>}
    </>
  );
}
