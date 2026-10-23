import { collator } from "../../../../renderer/src/moduleKit/moduleSurface.js";
import { disputesWithin } from "../../shared/world/disputed.js";
import { regionById } from "../../shared/world/outline.js";
import { en } from "../copy.en.js";
import { sr } from "../copy.sr.js";
import { territoryName, type Locale } from "./names.js";

const TABLES = { sr, en } as const;

export interface DisputeCardEntry {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly parties: string;
}

/**
 * Party names in the reader's language, sorted through the shell's collator.
 * The order is deliberately by what the reader sees, not by the stored ids:
 * Serbian puts Filipini before Kina and Malezija.
 */
export function disputePartyNames(parties: readonly string[], areaName: string, locale: Locale): string[] {
  const names = parties.map((id) => {
    if (id === "self") return areaName;
    const region = regionById(id);
    // A party with no outline territory (Tokelau) is stored as its name.
    return region === undefined ? id : territoryName(region, locale);
  });
  return [...new Set(names)].sort(collator({ sensitivity: "base" }, locale).compare);
}

/** The two neutral lines for each area in or overlapping one outline territory. */
export function cardDisputes(regionId: string, locale: Locale): readonly DisputeCardEntry[] {
  const text = TABLES[locale].regions.disputes;
  const areas = disputesWithin(regionId);
  const region = regionById(regionId);
  const ownNames = new Set(
    region === undefined ? [] : [region.name, territoryName(region, "en"), territoryName(region, locale)],
  );
  const own = areas.filter((area) => ownNames.has(area.name));
  const overlapping = areas.filter((area) => !ownNames.has(area.name));
  const ordered = [...own, ...overlapping];
  return ordered.map((area) => ({
    id: area.id,
    name: area.name,
    status: text.disputed,
    parties:
      area.note === "unclaimed"
        ? text.unclaimed
        : text.parties.replace("{parties}", disputePartyNames(area.parties, area.name, locale).join(", ")),
  }));
}
