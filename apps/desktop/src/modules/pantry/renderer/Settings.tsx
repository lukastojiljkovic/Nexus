import { useEffect, useState } from "react";
import { TextField } from "@nexus/ui";
import {
  declaredText,
  labelClass,
  settingsEntryId,
  type SettingsPanelProps,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import { copy } from "./copy.js";

/**
 * OSTAVA's settings card body (ADR-090 §settings): one row, one number, and the
 * module's whole preference.
 *
 * **Why the row's name is read from the manifest.** The declaration in
 * `shared/manifest.ts` is what the settings FILTER indexes and what the shots
 * harness looks for, and this component draws the same words — so the card
 * cannot come to search under one name and render another. A manifest's
 * `{ sr, en }` is not rewritten in place the way this file's `copy` table is, so
 * the pair is resolved with `declaredText`.
 *
 * **Why the number is held as text while it is typed.** Backspacing "14" to "1"
 * fires a change on the intermediate state, and a field bound to a number cannot
 * represent "the user has cleared it" — the `FocusSettingsPanel` arrangement.
 * Only a value that parses inside the window is written; blur puts the stored
 * one back, so the card can never show a number the profile does not hold.
 *
 * **Why the value lives in the profile.** `storage: "profile"` in the
 * declaration and `pantry_settings` in the database: main reads this row when it
 * fires the reminder, with no page open at all, and it therefore travels in the
 * profile's own archive. That is also why this card offers no "Vrati na
 * podrazumevano" — that link clears a machine's keys, and this is a write about
 * the profile's data.
 */

/** The declared control this body draws. Found by KEY rather than by index, so reordering the card cannot silently repoint this row at another setting. */
const WINDOW_ROW = manifest.settings?.controls.find((control) => control.key === "expiry-window");

/** The window's own bounds, restated nowhere: the store's CHECK, the wire's validator and this field all move together. */
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 3_650;

export default function PantrySettings({ profileId, hits }: SettingsPanelProps) {
  const [stored, setStored] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const view = await window.nexus.modules.pantry.list({ profileId });
        if (!active) return;
        setStored(view.settings.expiryWindowDays);
        setDraft(String(view.settings.expiryWindowDays));
      } catch (loadError) {
        if (active) setError(copy.settings.loadError);
        console.error("Nexus: the pantry setting could not be loaded:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function commit(days: number): Promise<void> {
    setStored(days);
    setSaved(false);
    setError(null);
    try {
      const view = await window.nexus.modules.pantry.setExpiryWindow({ profileId, days });
      setStored(view.settings.expiryWindowDays);
      setDraft(String(view.settings.expiryWindowDays));
      setSaved(true);
    } catch (saveError) {
      setError(copy.settings.saveError);
      console.error("Nexus: the pantry setting was not saved:", saveError);
    }
  }

  return (
    <>
      <p className="nx-hint">{copy.settings.caption}</p>
      <div className="set__study-field">
        <TextField
          label={declaredText(WINDOW_ROW?.labelKey)}
          labelClassName={labelClass(
            "set__study-label",
            hits.has(settingsEntryId("pantry", "expiry-window")),
          )}
          inputMode="numeric"
          className="pantry__settings-input"
          value={draft}
          disabled={stored === null}
          aria-invalid={invalid}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            setSaved(false);
            const days = Number(text);
            if (
              !Number.isSafeInteger(days) ||
              days < MIN_WINDOW_DAYS ||
              days > MAX_WINDOW_DAYS
            ) {
              // A half-typed number is not a value, so nothing is written and the
              // refusal names the bound; blur puts the stored one back.
              setInvalid(true);
              return;
            }
            setInvalid(false);
            void commit(days);
          }}
          onBlur={() => {
            setInvalid(false);
            setSaved(false);
            if (stored !== null) setDraft(String(stored));
          }}
        />
        {/* The explanation sits BESIDE the control rather than inside its label:
            a wrapping label takes its whole text content as the field's
            accessible name, which is the defect `SettingsField` was built to
            stop repeating ([[DC-120]]). */}
        <span className="nx-hint">{copy.settings.hint}</span>
        {invalid && <span className="set__error">{copy.errors.days}</span>}
      </div>
      {error !== null && <p className="set__error">{error}</p>}
      {saved && error === null && <p className="nx-hint">{copy.settings.saved}</p>}
    </>
  );
}
