import { useId, useState } from "react";
import { Button, TextField } from "@nexus/ui";

import {
  declaredText,
  labelClass,
  settingsEntryId,
  type SettingsPanelProps,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import {
  TRANSLATOR_DIRECTION_CHOICES,
  type TranslatorDirectionChoice,
} from "../shared/ipc.js";
import { copy } from "./copy.js";
import {
  DEFAULT_RECENT_LIMIT,
  MAX_RECENT_LIMIT,
  MIN_RECENT_LIMIT,
  clearStoredTranslatorPreferences,
  parseRecentLimit,
  persistDirection,
  persistRecentLimit,
  readStoredDirection,
  readStoredRecentLimit,
} from "./prefs.js";

/**
 * TRANSLATOR's settings card body (ADR-090 §settings): two rows, both of them
 * preferences of THIS machine.
 *
 * **Why the rows' names come from the manifest.** The declaration in
 * `shared/manifest.ts` is what the settings filter indexes and what the shots
 * harness looks for; this component draws the same words. Writing them twice —
 * once as a declaration, once in this module's copy — is how a card comes to
 * search under one name and render another, so the declaration is the one source
 * and the pair is resolved with `declaredText` (a manifest's `{ sr, en }` is not
 * rewritten in place the way this file's `copy` table is).
 *
 * **Why nothing here talks to main.** Both values are `localStorage` keys
 * (`prefs.ts`) and the declaration says `storage: "device"` for both, which is
 * also what earns this card the „Vrati na podrazumevano" link: clearing them
 * changes nothing that exists. That link is drawn by the page and calls
 * `clearStoredTranslatorPreferences` — this body only reads and writes.
 *
 * The number field is TEXT while it is being typed and is committed only when it
 * parses in range, on the `FocusSettingsPanel` recipe: a control bound to a
 * number cannot represent „the user has cleared the field", and 0 is a value
 * here („keep nothing"), so a cleared field must be refused rather than stored.
 */

/** The declared controls this body draws, found by KEY so reordering the card cannot repoint a row. */
const DIRECTION_ROW = manifest.settings?.controls.find((control) => control.key === "direction");
const RECENT_ROW = manifest.settings?.controls.find((control) => control.key === "recent");

export default function TranslatorSettings({ hits }: SettingsPanelProps) {
  const [direction, setDirection] = useState<TranslatorDirectionChoice>(() => readStoredDirection());
  const [draft, setDraft] = useState(() => String(readStoredRecentLimit()));
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  /** The direction row's name, by reference — a wrapping `<label>` would take the whole row's text as the group's name. */
  const directionLabelId = useId();

  function choose(next: TranslatorDirectionChoice): void {
    setDirection(next);
    persistDirection(next);
    setSaved(true);
  }

  function commit(text: string): void {
    setDraft(text);
    setSaved(false);
    const parsed = parseRecentLimit(text);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    persistRecentLimit(parsed);
    setSaved(true);
  }

  const directionLabel = declaredText(DIRECTION_ROW?.labelKey);

  /**
   * „Vrati na podrazumevano", drawn by the body because this is a kit module.
   *
   * The settings page offers that link for a compiled-in card from
   * `MODULE_SETTINGS_PANELS`'s `resetDevice`, and a DISCOVERED module has no
   * entry there — its body is its own, and the body is the only thing that knows
   * which `localStorage` keys it read. So the link is here, and it does what the
   * shell's does: forget the two keys and put the controls back on the defaults,
   * live, without a reload.
   */
  function reset(): void {
    clearStoredTranslatorPreferences();
    setDirection("auto");
    setDraft(String(DEFAULT_RECENT_LIMIT));
    setInvalid(false);
    setSaved(false);
  }

  return (
    <>
      <p className="nx-hint">{copy.settings.caption}</p>

      <div className="set__field">
        <p
          id={directionLabelId}
          className={labelClass(
            "nx-hint",
            hits.has(settingsEntryId("translator", "direction")),
          )}
        >
          {directionLabel}
        </p>
        <div className="set__segmented" role="group" aria-labelledby={directionLabelId}>
          {TRANSLATOR_DIRECTION_CHOICES.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={direction === option ? "primary" : "ghost"}
              aria-pressed={direction === option}
              onClick={() => choose(option)}
            >
              {copy.search.directions[option]}
            </Button>
          ))}
        </div>
        <p className="nx-hint">{copy.settings.directionHint}</p>
      </div>

      <div className="set__study-fields">
        <div className="set__study-field">
          <TextField
            label={declaredText(RECENT_ROW?.labelKey)}
            labelClassName={labelClass(
              "set__study-label",
              hits.has(settingsEntryId("translator", "recent")),
            )}
            className="set__focus-input"
            inputMode="numeric"
            value={draft}
            aria-invalid={invalid}
            onChange={(event) => commit(event.target.value)}
            // A half-typed number is not a value; blur puts the STORED one back
            // rather than leaving the field showing something nothing holds.
            onBlur={() => {
              setDraft(String(readStoredRecentLimit()));
              setInvalid(false);
            }}
          />
          <span className="nx-hint">
            {copy.settings.recentHint} ({MIN_RECENT_LIMIT}-{MAX_RECENT_LIMIT})
          </span>
          {invalid && <span className="set__error">{copy.settings.recentInvalid}</span>}
        </div>
      </div>

      <div className="translator__settings-reset">
        <Button size="sm" variant="quiet" onClick={reset}>
          {copy.settings.reset}
        </Button>
      </div>

      {saved && !invalid && <p className="nx-hint">{copy.settings.saved}</p>}
    </>
  );
}
