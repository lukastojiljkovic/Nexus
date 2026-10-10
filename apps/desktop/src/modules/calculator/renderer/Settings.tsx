import { useEffect, useState } from "react";
import { Button } from "@nexus/ui";
import {
  CALCULATOR_ANGLE_MODES,
  CALCULATOR_PRECISIONS,
  type CalculatorAngleMode,
  type CalculatorPrecision,
} from "@nexus/core";
import {
  declaredText,
  labelClass,
  settingsEntryId,
  type SettingsPanelProps,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { CalculatorView } from "../shared/ipc.js";
import { copy } from "./copy.js";
import { ANGLE_CONTROL, NUMBER_CONTROL, optionLabel } from "./modes.js";

/**
 * CALCULATOR's settings card body (ADR-090 §settings): two segmented rows, and
 * the module's whole preference.
 *
 * **Why the rows' names are read from the manifest.** The declaration in
 * `shared/manifest.ts` is what the settings FILTER indexes and what the shots
 * harness looks for; this component draws the same words, and so does the page's
 * own switch. Writing them twice - once as a declaration, once as copy in this
 * table - is how a card comes to search under one name and render another, so the
 * declaration is the one source and the pair is resolved with `declaredText` (a
 * manifest's `{ sr, en }` is not rewritten in place the way this file's `copy`
 * table is).
 *
 * **Why the values live in the profile.** `storage: "profile"` in the
 * declaration and `calc_settings` in the database: a restore REPLACES this card
 * (the kit's rule for every discovered module), so the two rows have to be rows an
 * archive can carry. The page's own switches write the very same two, which is
 * why this card carries no „Vrati na podrazumevano" - that link is for a machine's
 * keys, and `isDeviceOnlyPanel` is what decides it.
 *
 * The option ID SETS are core's own tuples rather than a list typed here: the
 * engine owns `deg`/`rad`/`grad` and `float`/`bignumber`, and a fourth mode added
 * to the engine must reach this card by being written there.
 */

export default function CalculatorSettings({ profileId, hits }: SettingsPanelProps) {
  const [view, setView] = useState<CalculatorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.modules.calculator.list({ profileId });
        if (active) setView(next);
      } catch (loadError) {
        if (active) setError(copy.settings.loadError);
        console.error("Nexus: the calculator settings could not be loaded:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  /**
   * One write, and the whole view back. `setAngleMode` changes one field and the
   * handler reads the other from the store, so a card holding a view from a moment
   * ago cannot overwrite a preference the page has just changed.
   */
  async function write(action: () => Promise<CalculatorView>): Promise<void> {
    setSaved(false);
    setError(null);
    try {
      setView(await action());
      setSaved(true);
    } catch (saveError) {
      setError(copy.settings.saveError);
      console.error("Nexus: the calculator setting was not saved:", saveError);
    }
  }

  return (
    <>
      <p className="nx-hint">{copy.settings.caption}</p>
      <div className="set__field">
        <p className={labelClass("nx-hint", hits.has(settingsEntryId("calculator", "angle-mode")))}>
          {declaredText(ANGLE_CONTROL?.labelKey)}
        </p>
        <div
          className="set__segmented"
          role="group"
          aria-label={declaredText(ANGLE_CONTROL?.labelKey)}
        >
          {CALCULATOR_ANGLE_MODES.map((mode: CalculatorAngleMode) => (
            <Button
              key={mode}
              size="sm"
              variant={view?.settings.angleMode === mode ? "primary" : "ghost"}
              aria-pressed={view?.settings.angleMode === mode}
              disabled={view === null}
              onClick={() =>
                void write(() => window.nexus.modules.calculator.setAngleMode({ profileId, angleMode: mode }))
              }
            >
              {optionLabel(ANGLE_CONTROL, mode)}
            </Button>
          ))}
        </div>
      </div>
      <div className="set__field">
        <p className={labelClass("nx-hint", hits.has(settingsEntryId("calculator", "number-mode")))}>
          {declaredText(NUMBER_CONTROL?.labelKey)}
        </p>
        <div
          className="set__segmented"
          role="group"
          aria-label={declaredText(NUMBER_CONTROL?.labelKey)}
        >
          {CALCULATOR_PRECISIONS.map((precision: CalculatorPrecision) => (
            <Button
              key={precision}
              size="sm"
              variant={view?.settings.precision === precision ? "primary" : "ghost"}
              aria-pressed={view?.settings.precision === precision}
              disabled={view === null}
              onClick={() =>
                void write(() =>
                  window.nexus.modules.calculator.setPrecision({ profileId, precision }),
                )
              }
            >
              {optionLabel(NUMBER_CONTROL, precision)}
            </Button>
          ))}
        </div>
        <p className="nx-hint">{copy.settings.hint}</p>
      </div>
      {error !== null && <p className="set__error">{error}</p>}
      {saved && error === null && <p className="nx-hint">{copy.settings.saved}</p>}
    </>
  );
}
