import { useState } from "react";
import { Button, ListRow } from "@nexus/ui";
import {
  declaredText,
  labelClass,
  settingsEntryId,
  type SettingsPanelProps,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import { copy } from "./copy.js";
import { pathParts } from "./format.js";
import { forgetRecentFiles, readRecentFiles } from "./recentFiles.js";

/**
 * RADIONICA's settings card body (ADR-090 §settings): the list of files this
 * machine opened, and the one button that forgets it.
 *
 * **Why the card is a list rather than a preference.** The module has nothing to
 * prefer - it stores no profile data at all - and the one thing it keeps is a
 * record of what was opened, on this machine. That is why its declaration is a
 * `fact` and not a `device` control: a `device` control is a value somebody
 * chooses, and this is a value they produce by working. The shell therefore
 * offers no "Vrati na podrazumevano" here, and this body carries the button that
 * actually means something.
 *
 * **Why the row's name is read from the manifest.** The declaration is what the
 * settings FILTER indexes and what the shots harness looks for; this component
 * draws the same words. Writing them twice - once as a declaration, once in this
 * table - is how a card comes to search under one name and render another, so
 * the declaration is the one source, resolved with `declaredText`.
 */

/** The declared control this body draws, found by KEY rather than by index. */
const RECENT_ROW = manifest.settings?.controls.find((control) => control.key === "recent-files");

export default function WorkshopSettings({ profileId, hits }: SettingsPanelProps) {
  const [files, setFiles] = useState(() => readRecentFiles(profileId));

  return (
    <>
      <p className="nx-hint">{copy.settings.caption}</p>
      <div className="set__module-row">
        <div className="set__module-info">
          <span
            className={labelClass(
              "set__module-name",
              hits.has(settingsEntryId("workshop", "recent-files")),
            )}
          >
            {declaredText(RECENT_ROW?.labelKey)}
          </span>
          <span className="nx-hint">{copy.recent.caption}</span>
        </div>
      </div>
      {files.length === 0 ? (
        <p className="nx-hint">{copy.recent.empty}</p>
      ) : (
        <div className="workshop__list">
          {files.map((entry) => (
            <ListRow key={entry.path}>
              <span className="workshop__recent-name">{entry.name}</span>
              <span className="workshop__recent-path">{pathParts(entry.path).directory}</span>
            </ListRow>
          ))}
        </div>
      )}
      {/* The row's action slot, on the dashboard card's `set__dash-actions`
          arrangement: the buttons sit together, trailing the list they act on. */}
      <div className="workshop__actions">
        <Button
          size="sm"
          variant="quiet"
          disabled={files.length === 0}
          onClick={() => {
            forgetRecentFiles(profileId);
            setFiles([]);
          }}
        >
          {copy.recent.forget}
        </Button>
      </div>
    </>
  );
}
