import { useEffect, useId, useState } from "react";
import { Select } from "@nexus/ui";
import {
  declaredText,
  labelClass,
  settingsEntryId,
  type SettingsPanelProps,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import { copy } from "./copy.js";
import "./boards.css";

/**
 * BOARDS' settings card body (ADR-090 §settings): one row, one choice, and the
 * module's whole preference — the level a new game against the computer opens at.
 *
 * **Why the row's name and its options are read from the manifest.** The
 * declaration in `shared/manifest.ts` is what the settings FILTER indexes and what
 * the shots harness looks for, and it is also what the page's new-game form draws
 * its levels from. Writing those words a second time here — once as a declaration,
 * once as copy — is how a card comes to search under one name and render another,
 * so the declaration is the one source and its pairs are resolved with
 * `declaredText` (a manifest's `{ sr, en }` is not rewritten in place the way this
 * file's `copy` table is).
 *
 * **Why the value lives in the profile.** `storage: "profile"` in the declaration
 * and `boards_settings` in the database: main reads this row, the page's form
 * opens on it, and it therefore travels in the profile's own archive. The card is a
 * thin client over two of this module's own ops — it reads the module's view and
 * writes one field of it — and it never touches `localStorage`, which is where a
 * DEVICE preference would go.
 */

/** The declared control this body draws. Found by KEY rather than by index, so reordering the card cannot silently repoint this row at another setting. */
const LEVEL_ROW = manifest.settings?.controls.find((control) => control.key === "default-level");

export default function BoardsSettings({ profileId, hits }: SettingsPanelProps) {
  const [level, setLevel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** The name is a `<span>` the control points at, so the accessible name is the visible one. */
  const labelId = useId();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const view = await window.nexus.modules.boards.list({ profileId });
        if (active) setLevel(view.settings.defaultLevel);
      } catch (loadError) {
        if (active) setError(copy.settings.loadError);
        console.error("Nexus: the board games setting could not be loaded:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function save(next: number): Promise<void> {
    setLevel(next);
    setSaved(false);
    setError(null);
    try {
      const view = await window.nexus.modules.boards.setDefaultLevel({ profileId, level: next });
      setLevel(view.settings.defaultLevel);
      setSaved(true);
    } catch (saveError) {
      setError(copy.settings.saveError);
      console.error("Nexus: the board games setting was not saved:", saveError);
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
              hits.has(settingsEntryId("boards", "default-level")),
            )}
          >
            {declaredText(LEVEL_ROW?.labelKey)}
          </span>
          <span className="nx-hint">{copy.settings.hint}</span>
        </div>
        <Select
          aria-labelledby={labelId}
          value={level === null ? "" : String(level)}
          disabled={level === null}
          onChange={(event) => void save(Number(event.target.value))}
        >
          {LEVEL_ROW?.kind === "choice" &&
            LEVEL_ROW.options.map((option) => (
              <option key={option.id} value={option.id}>
                {declaredText(option.labelKey)}
              </option>
            ))}
        </Select>
      </div>
      {error !== null && <p className="set__error">{error}</p>}
      {saved && error === null && <p className="nx-hint">{copy.settings.saved}</p>}
    </>
  );
}
