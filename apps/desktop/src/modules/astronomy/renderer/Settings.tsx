import { useState } from "react";
import { computerZone, type LatLon } from "@nexus/core";
import { Button } from "@nexus/ui";
import {
  declaredText,
  labelClass,
  settingsEntryId,
  type SettingsPanelProps,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import { manifest } from "../shared/manifest.js";
import { copy } from "./copy.js";
import {
  clearStoredAstronomyPreferences,
  persistAstronomyPrefs,
  readAstronomyPrefs,
  type AstronomyPrefs,
} from "./prefs.js";
import { PlacePicker } from "./sunmoon/PlacePicker.js";
import "./astronomy.css";

/**
 * ASTRONOMY's settings card body (ADR-090 §settings): the place the sky is
 * drawn for, which is the module's whole preference.
 *
 * **Why the row's name is read from the manifest.** The declaration in
 * `shared/manifest.ts` is what the settings FILTER indexes and what the shots
 * harness looks for; a body that drew its own words would let the card be found
 * under one name and render another. So the label comes from
 * `declaredText(PLACE_ROW.labelKey)`, and the filter's own highlight class goes
 * on it.
 *
 * **Why the picker is the page's own component, unframed.** The place is picked
 * in exactly one place in the product, and the settings card and the page must
 * not drift into two pickers; `framed={false}` is the one difference the shell
 * needs, because this card is drawn INSIDE a card the settings page already
 * provides.
 *
 * **„Vrati na zonu računara" is this body's own.** A compiled-in panel whose
 * declaration is all-`device` gets the shell's „Vrati na podrazumevano"; a kit
 * card's body is the module's (`moduleKit/settings.ts`), so the module brings
 * the reset it wants — a quiet button that removes exactly this profile's key.
 */

/** The declared control this body draws. Found by KEY rather than by index, so reordering the card cannot repoint this row at another setting. */
const PLACE_ROW = manifest.settings?.controls.find((control) => control.key === "place");

/** A place with nothing picked: the zone's city is the default. */
const NO_PLACE: AstronomyPrefs = { place: null };

export default function AstronomySettings({ profileId, hits }: SettingsPanelProps) {
  const [prefs, setPrefs] = useState<AstronomyPrefs>(() => readAstronomyPrefs(profileId));
  /** Read once, like the page does: the default is a fact about this machine. */
  const zone = computerZone();

  function change(place: LatLon | null): void {
    const next: AstronomyPrefs = { ...NO_PLACE, place };
    setPrefs(next);
    persistAstronomyPrefs(profileId, next);
  }

  return (
    <>
      <p className={labelClass("nx-hint", hits.has(settingsEntryId("astronomy", "place")))}>
        {declaredText(PLACE_ROW?.labelKey)}
      </p>
      <p className="nx-hint">{copy.settings.caption}</p>
      <PlacePicker framed={false} observer={prefs.place} zone={zone} onChange={change} />
      <p className="nx-hint">{copy.settings.hint}</p>
      <Button
        size="sm"
        variant="quiet"
        onClick={() => {
          clearStoredAstronomyPreferences(profileId);
          setPrefs(readAstronomyPrefs(profileId));
        }}
      >
        {copy.settings.reset}
      </Button>
    </>
  );
}
