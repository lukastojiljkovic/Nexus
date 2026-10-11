import { useState } from "react";
import { Button } from "@nexus/ui";
import {
  declaredText,
  labelClass,
  settingsEntryId,
  type SettingsPanelProps,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import { copy } from "./copy.js";
import { NumberField } from "./fields.js";
import {
  clearStoredSignalsPreferences,
  parseA4Input,
  parsePitchInput,
  parseWpmInput,
  persistSignalsPrefs,
  readSignalsPrefs,
  type SignalsPrefs,
} from "./prefs.js";
import "./signals.css";

/**
 * SIGNALS' settings card body (ADR-090 §settings): the three device preferences
 * the module keeps — the Morse key's speed and tone, and the tuner's reference.
 *
 * **Every row's name is the DECLARED one, read in the language being spoken.**
 * The declaration in `shared/manifest.ts` is what the settings filter indexes and
 * what the shots harness looks for; a body that drew its own words would let the
 * card be found under one name and render another, which is exactly the drift
 * `declaredText` exists to prevent. Each field therefore carries the declared
 * label, and the second field of the speed row is the one label the declaration
 * does not name (the message speed) and takes from this module's copy.
 *
 * **These values are this machine's, per profile.** `prefs.ts` holds them in
 * `localStorage` under keys qualified by the profile, so they are device
 * preferences that belong to somebody: one player's 12 words a minute is not
 * another's 20. Nothing here rides in the profile's archive, which is why the
 * card says so once rather than repeating it per row.
 *
 * **„Vrati na podrazumevano" is the body's own.** The shell offers that link for
 * a compiled-in panel whose declaration is all-`device`; a kit card's body is the
 * module's (`moduleKit/settings.ts`), so the module brings the reset it wants —
 * a quiet button that forgets exactly this profile's four keys.
 */

/** The declared label of one control, resolved in the language being read. */
function controlLabel(key: string): string {
  return declaredText(manifest.settings?.controls.find((control) => control.key === key)?.labelKey);
}

export default function SignalsSettings({ profileId, hits }: SettingsPanelProps) {
  const [prefs, setPrefs] = useState<SignalsPrefs>(() => readSignalsPrefs(profileId));

  /** The one write path, exactly as the page's: state first, then the four keys. */
  function change(patch: Partial<SignalsPrefs>): void {
    const next: SignalsPrefs = { ...prefs, ...patch };
    setPrefs(next);
    persistSignalsPrefs(profileId, next);
  }

  return (
    <>
      <p className="nx-hint">{copy.settings.speedCaption}</p>
      <div className="signals__settings">
        <NumberField
          label={controlLabel("morse-speed")}
          labelClassName={labelClass(
            "signals__setting-label",
            hits.has(settingsEntryId("signals", "morse-speed")),
          )}
          className="signals__number"
          value={prefs.wpm}
          parse={parseWpmInput}
          commit={(wpm) => {
            // Farnsworth only ever slows a message down.
            change({ wpm, messageWpm: Math.min(prefs.messageWpm, wpm) });
          }}
          invalidMessage={copy.settings.invalid}
        />
        <NumberField
          label={copy.morse.messageSpeedLabel}
          className="signals__number"
          value={prefs.messageWpm}
          parse={parseWpmInput}
          commit={(messageWpm) => {
            change({ messageWpm: Math.min(messageWpm, prefs.wpm) });
          }}
          invalidMessage={copy.settings.invalid}
          hint={copy.settings.speedHint}
        />
        <NumberField
          label={controlLabel("morse-pitch")}
          labelClassName={labelClass(
            "signals__setting-label",
            hits.has(settingsEntryId("signals", "morse-pitch")),
          )}
          className="signals__number"
          value={prefs.pitchHz}
          parse={parsePitchInput}
          commit={(pitchHz) => {
            change({ pitchHz });
          }}
          invalidMessage={copy.settings.invalid}
          hint={copy.settings.pitchHint}
        />
        <NumberField
          label={controlLabel("tuner-a4")}
          labelClassName={labelClass(
            "signals__setting-label",
            hits.has(settingsEntryId("signals", "tuner-a4")),
          )}
          className="signals__number"
          value={prefs.a4Hz}
          parse={parseA4Input}
          commit={(a4Hz) => {
            change({ a4Hz });
          }}
          invalidMessage={copy.settings.invalid}
          hint={copy.settings.a4Hint}
        />
      </div>
      <Button
        size="sm"
        variant="quiet"
        onClick={() => {
          clearStoredSignalsPreferences(profileId);
          setPrefs(readSignalsPrefs(profileId));
        }}
      >
        {copy.settings.reset}
      </Button>
    </>
  );
}
