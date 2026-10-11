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
 * PUZZLES' settings card body (ADR-090 §settings): one row, one checkbox, and
 * the module's whole preference.
 *
 * **Why the row's name is read from the manifest.** The declaration in
 * `shared/manifest.ts` is what the settings FILTER indexes and what the shots
 * harness looks for; this component draws the same words. Writing them twice —
 * once as a declaration, once as copy in this table — is how a card comes to
 * search under one name and render another, so the declaration is the one source
 * and the pair is resolved with `declaredText` (a manifest's `{ sr, en }` is not
 * rewritten in place the way this file's `copy` table is).
 *
 * **Why the value lives in the profile.** `storage: "profile"` in the
 * declaration and `puzzles_settings` in the database: main reads this boolean,
 * and it therefore travels in the profile's own archive. The card is a thin
 * client over two of the module's own ops — it reads the module's view and
 * writes one field of it — and it never touches `localStorage`, which is where a
 * DEVICE preference would go.
 */

/** The declared control this body draws. Found by KEY rather than by index, so reordering the card cannot silently repoint this row at another setting. */
const CHECK_ROW = manifest.settings?.controls.find((control) => control.key === "check-while-typing");

export default function PuzzlesSettings({ profileId, hits }: SettingsPanelProps) {
  const [checkWhileTyping, setCheckWhileTyping] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** The name is a `<span>` the checkbox points at, so the accessible name is the visible one (`SettingsField`'s own arrangement, one row here instead of four). */
  const labelId = useId();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const view = await window.nexus.modules.puzzles.list({ profileId });
        if (active) setCheckWhileTyping(view.settings.checkWhileTyping);
      } catch (loadError) {
        if (active) setError(copy.settings.loadError);
        console.error("Nexus: the puzzles setting could not be loaded:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function save(next: boolean): Promise<void> {
    setCheckWhileTyping(next);
    setSaved(false);
    setError(null);
    try {
      const view = await window.nexus.modules.puzzles.setCheckWhileTyping({
        profileId,
        checkWhileTyping: next,
      });
      setCheckWhileTyping(view.settings.checkWhileTyping);
      setSaved(true);
    } catch (saveError) {
      setError(copy.settings.saveError);
      console.error("Nexus: the puzzles setting was not saved:", saveError);
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
              hits.has(settingsEntryId("puzzles", "check-while-typing")),
            )}
          >
            {declaredText(CHECK_ROW?.labelKey)}
          </span>
          <span className="nx-hint">{copy.settings.hint}</span>
        </div>
        <Checkbox
          checked={checkWhileTyping ?? false}
          aria-labelledby={labelId}
          disabled={checkWhileTyping === null}
          onChange={(event) => void save(event.target.checked)}
        />
      </div>
      {error !== null && <p className="set__error">{error}</p>}
      {saved && error === null && <p className="nx-hint">{copy.settings.saved}</p>}
    </>
  );
}
