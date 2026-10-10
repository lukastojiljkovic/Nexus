// What the pack contains, and where each article comes from.
//
// The structure is the one `research/survival/report.md` §3 recommends, topic
// by topic, in its order: the ATP's own core chapters, water, fire, shelter,
// the plant and animal appendices of FM 21-76, food safety, clouds, tools and
// craft, the first-aid selection from ATP 4-02.11, and the disasters, each
// hazard once from Ready.gov and once from FEMA's 2004 guide. Two topics of
// that list are deliberately not built and `docs/packs/survival.md` says so:
// `signalling-morse` (the report's open question; the Signals module carries
// Morse) and `region-serbia` (no source with licence evidence was found).
//
// An article is a SPAN OF THE SOURCE between two of the source's own printed
// headings, found by their text. Nothing here is a page number: a span that
// follows the source's words survives a re-print, and a heading that cannot be
// found stops the build instead of quietly shifting every article after it.
// The text between two spans is not shipped, which is how the omissions this
// pack documents happen — the build prints every gap it left, and
// `docs/packs/survival.md` lists them with the source's own section numbers.

/**
 * One article.
 *
 * `start` is the printed heading the article starts at; `end` is the heading it
 * stops before (exclusive), and defaults to the next article in the source's
 * OWN reading order — the plan is grouped by topic, not by book, so the order
 * here is deliberately not the order in the document, and the builder sorts it
 * out from the headings themselves. `occurrence` picks which line, when a
 * source prints the same heading twice (FM 21-76 has a chapter and an appendix
 * both called "Poisonous Plants"). `entries: true` splits the span into one
 * article per entry heading — the shape FM 21-76's appendices have, where each
 * plant or animal is a heading, an illustration and a paragraph of its own.
 */
function article(id, title, source, start, options = {}) {
  return { id, title, source, start, ...options };
}

/** The ATP 3-50.21, chapter by chapter, for the topics the report assigns it. */
const atpSurvival = (heading, id, title, options) => article(id, title, "atp-3-50-21", heading, options);

/** The ATP 4-02.11, section by section: `docs/packs/survival.md` lists what a civilian cannot use. */
const firstAid = (heading, id, title, options) => article(id, title, "atp-4-02-11", heading, options);

export const PLAN = [
  {
    id: "survival",
    title: "Survival",
    children: [
      atpSurvival("Overview", "survival-overview", "Overview", { entries: true, prefix: "survival-overview" }),
      atpSurvival("Survival Medicine", "survival-medicine", "Survival Medicine", { entries: true, prefix: "medicine" }),
      atpSurvival("Movement and Navigation", "survival-movement-and-navigation", "Movement and Navigation", {
        entries: true,
        prefix: "navigation",
      }),
      atpSurvival("Survival Equipment", "survival-equipment", "Survival Equipment", { entries: true, prefix: "equipment" }),
      atpSurvival("Survival Knots and Rope", "survival-knots-and-rope", "Survival Knots and Rope", {
        entries: true,
        prefix: "knot",
        // The appendix ends at the glossary: without this the glossary, the
        // references and the index would ship inside the last knot entry,
        // because an article's span otherwise runs to the next one.
        end: "Glossary",
      }),
    ],
  },
  {
    id: "water",
    title: "Water",
    children: [
      atpSurvival("Water", "water", "Water", {
        entries: true,
        prefix: "water",
        // Chapter 4, Food, is not part of this topic and is not shipped: without
        // this, the whole of it would lie inside the last water entry, and it
        // did until the words of a table were checked against the article.
        end: "Food",
      }),
    ],
  },
  {
    id: "fire",
    title: "Fire",
    children: [atpSurvival("Fire", "fire", "Fire", { entries: true, prefix: "fire" })],
  },
  {
    id: "shelter",
    title: "Shelter and clothing",
    children: [
      atpSurvival("Shelter and Clothing", "shelter-and-clothing", "Shelter and Clothing", { entries: true, prefix: "shelter" }),
    ],
  },
  {
    id: "food-plants",
    title: "Food: plants",
    // The report's warning travels with this group: FM 21-76 is world-wide Army
    // material written for soldiers, not a regional identification guide, and
    // the doc and the pack description both say so.
    note: "world-wide Army reference, not a regional identification guide",
    children: [
      article("survival-use-of-plants", "Survival Use of Plants", "fm-21-76", "Survival Use of Plants", {
        entries: true,
        prefix: "plants",
      }),
      article("edible-and-medicinal-plants", "Edible and Medicinal Plants", "fm-21-76", "Edible and Medicinal Plants", {
        entries: true,
        prefix: "plant",
      }),
      article("poisonous-plants", "Poisonous Plants", "fm-21-76", "Poisonous Plants", { entries: true, prefix: "poison-plants" }),
      article("poisonous-plants-appendix", "Poisonous Plants: the appendix", "fm-21-76", "Poisonous Plants", {
        entries: true,
        prefix: "poisonous",
        occurrence: 2,
      }),
    ],
  },
  {
    id: "food-animals",
    title: "Food and dangerous animals",
    children: [
      article("food-procurement", "Food Procurement", "fm-21-76", "Food Procurement", { entries: true, prefix: "food" }),
      article("dangerous-animals", "Dangerous Animals", "fm-21-76", "Dangerous Animals", { entries: true, prefix: "dangerous" }),
      article("dangerous-insects-and-arachnids", "Dangerous Insects and Arachnids", "fm-21-76", "Dangerous Insects and Arachnids", {
        entries: true,
        prefix: "insect",
      }),
      article("venomous-snakes-and-lizards", "Poisonous Snakes and Lizards", "fm-21-76", "Poisonous Snakes and Lizards", {
        entries: true,
        prefix: "snake",
      }),
      article("dangerous-fish-and-mollusks", "Dangerous Fish and Mollusks", "fm-21-76", "Dangerous Fish and Mollusks", {
        entries: true,
        prefix: "fish",
      }),
    ],
  },
  {
    id: "meat-safety",
    title: "Meat and food safety",
    children: [
      article("safe-minimum-internal-temperatures", "Safe Minimum Internal Temperatures", "foodsafety-gov", "", {
        document: "/food-safety-charts/safe-minimum-internal-temperatures",
      }),
    ],
  },
  {
    id: "weather-clouds",
    title: "Weather and clouds",
    children: [
      article("clouds", "Clouds", "nws-jetstream", "", { document: "/jetstream/clouds" }),
      article("how-clouds-form", "How clouds form", "nws-jetstream", "", { document: "/jetstream/clouds/how-clouds-form" }),
      article("clouds-foretellers-of-weather", "Clouds: Foretellers of Weather", "fm-21-76", "Clouds: Foretellers of Weather", {
        entries: true,
        prefix: "clouds",
        end: "Contingency Plan of Action Format",
      }),
    ],
  },
  {
    id: "tools-and-craft",
    title: "Tools and craft",
    children: [
      article("lashing-and-cordage", "Lashing and Cordage", "fm-21-76", "Lashing and Cordage", {
        entries: true,
        prefix: "cordage",
      }),
      article("rucksack-construction", "Rucksack Construction", "fm-21-76", "Rucksack Construction", {
        entries: true,
        prefix: "rucksack",
      }),
      article("clothing-and-insulation", "Clothing and Insulation", "fm-21-76", "Clothing and Insulation", {
        entries: true,
        prefix: "clothing",
      }),
      article("cooking-and-eating-utensils", "Cooking and Eating Utensils", "fm-21-76", "Cooking and Eating Utensils", {
        entries: true,
        prefix: "cooking",
        // The chapters after chapter 12 (desert, tropical, cold, sea, crossings,
        // navigation, signalling, movement in hostile areas, camouflage, contact
        // with people, man-made hazards) and Appendix A are not shipped.
        end: "Desert Survival",
      }),
    ],
  },
  {
    id: "first-aid",
    title: "First aid",
    children: [
      firstAid("Overview of Massive Bleeding Control", "massive-bleeding-control-overview", "Massive Bleeding Control: overview"),
      firstAid("Equipment used for Massive Bleeding Control", "massive-bleeding-control-equipment", "Massive Bleeding Control: equipment"),
      firstAid("Tier 1 Skills for Massive Bleeding Control", "massive-bleeding-control-tier-1", "Massive Bleeding Control: Tier 1 skills"),
      firstAid("Tier 2 Skills for Massive Bleeding Control", "massive-bleeding-control-tier-2", "Massive Bleeding Control: Tier 2 skills"),
      firstAid("Expedient Techniques for Hemorrhage Control", "hemorrhage-control-expedient", "Hemorrhage control: expedient techniques"),
      firstAid("Overview of Airway Control", "airway-control-overview", "Airway control: overview"),
      firstAid("Equipment used for Airway Control", "airway-control-equipment", "Airway control: equipment"),
      firstAid("Tier 1 Skills for Airway Control", "airway-control-tier-1", "Airway control: Tier 1 skills"),
      firstAid("Tier 2 Skills for Airway Control", "airway-control-tier-2", "Airway control: Tier 2 skills"),
      firstAid("Expedient Techniques for Airway Control", "airway-control-expedient", "Airway control: expedient techniques"),
      firstAid("Overview of Respiration and Breathing", "respiration-overview", "Respiration and breathing: overview"),
      firstAid("Equipment used for Respiration and Breathing Control", "respiration-equipment", "Respiration and breathing: equipment"),
      firstAid("Tier 1 Skills for Respiration and Breathing Control", "respiration-tier-1", "Respiration and breathing: Tier 1 skills"),
      firstAid("Tier 2 Skills for Respiration and Breathing Control", "respiration-tier-2", "Respiration and breathing: Tier 2 skills"),
      firstAid("Expedient Techniques for Respiration and Breathing Control", "respiration-expedient", "Respiration and breathing: expedient techniques"),
      firstAid("Overview of Circulation Control", "circulation-control-overview", "Circulation control: overview"),
      firstAid("Equipment used for Circulation Control", "circulation-control-equipment", "Circulation control: equipment"),
      firstAid("Tier 1 Skills for Circulation Control", "circulation-control-tier-1", "Circulation control: Tier 1 skills"),
      firstAid("Tier 2 Skills for Circulation Control", "circulation-control-tier-2", "Circulation control: Tier 2 skills"),
      firstAid("Expedient Techniques for Circulation Control", "circulation-control-expedient", "Circulation control: expedient techniques"),
      firstAid("Overview of Hypothermia Control", "hypothermia-control-overview", "Hypothermia control: overview"),
      firstAid("Equipment used for Hypothermia Control", "hypothermia-control-equipment", "Hypothermia control: equipment"),
      firstAid("Tier 1 Skills Used for Hypothermia Control", "hypothermia-control-tier-1", "Hypothermia control: Tier 1 skills"),
      firstAid("Tier 2 Skills Used for Hypothermia Control", "hypothermia-control-tier-2", "Hypothermia control: Tier 2 skills"),
      firstAid("Expedient Skills Used for Hypothermia Control", "hypothermia-control-expedient", "Hypothermia control: expedient skills"),
      firstAid("Overview of Eye Trauma", "eye-trauma-overview", "Eye trauma: overview"),
      firstAid("Equipment used for the treatment of Eye Trauma", "eye-trauma-equipment", "Eye trauma: equipment"),
      firstAid("Tier 1 Skills used to Treat Eye Trauma", "eye-trauma-tier-1", "Eye trauma: Tier 1 skills"),
      firstAid("Tier 2 Skills used to Treat Eye Trauma", "eye-trauma-tier-2", "Eye trauma: Tier 2 skills"),
      firstAid("Expedient Skills used to Treat Eye Trauma", "eye-trauma-expedient", "Eye trauma: expedient skills"),
      firstAid("Overview of Head Injuries", "head-injury-overview", "Head injuries: overview"),
      firstAid("Equipment used for the Treatment of a Head Injury", "head-injury-equipment", "Head injuries: equipment"),
      firstAid("Tier 1 Skills for the Treatment of a Head Injury", "head-injury-tier-1", "Head injuries: Tier 1 skills"),
      firstAid("Tier 2 Skills for the Treatment of a Head Injury", "head-injury-tier-2", "Head injuries: Tier 2 skills"),
      firstAid("Expedient Skills used for the Treatment of Head, Neck, and Facial Injuries", "head-injury-expedient", "Head, neck and facial injuries: expedient skills"),
      firstAid("Overview of Burns", "burns-overview", "Burns: overview"),
      firstAid("Equipment used for the Treatment of Burns", "burns-equipment", "Burns: equipment"),
      firstAid("Tier 1 Skills for the Treatment of Burns", "burns-tier-1", "Burns: Tier 1 skills"),
      firstAid("Tier 2 Skills for the Treatment of Burns", "burns-tier-2", "Burns: Tier 2 skills"),
      firstAid("Expedient Skills used for the Treatment of Burns", "burns-expedient", "Burns: expedient skills"),
      firstAid("Overview of Fractures", "fractures-overview", "Fractures: overview"),
      firstAid("Equipment used for the Treatment of Fractures", "fractures-equipment", "Fractures: equipment"),
      firstAid("Tier 1 Skills for the Treatment of Fractures", "fractures-tier-1", "Fractures: Tier 1 skills"),
      firstAid("Tier 2 Skills for the Treatment of Fractures", "fractures-tier-2", "Fractures: Tier 2 skills"),
      firstAid("Expedient Techniques for Splints, Padding, Bandages, Slings, and Swathes", "fractures-expedient", "Splints, padding, bandages, slings and swathes"),
      firstAid("Overview of Secondary Injuries", "secondary-injuries-overview", "Secondary injuries: overview"),
      firstAid("Abdominal Wounds", "abdominal-wounds", "Abdominal wounds"),
      firstAid("Bandaging", "bandaging", "Bandaging"),
      firstAid("Impalement Injuries", "impalement-injuries", "Impalement injuries"),
      firstAid("Overview of Bites and Stings", "bites-and-stings-overview", "Bites and stings: overview"),
      firstAid("Human or Animal Bites", "animal-bites", "Human or animal bites"),
      firstAid("Insect (Arthropod) Bites and Stings", "insect-bites-and-stings", "Insect (arthropod) bites and stings"),
      firstAid("Overview of Climatic Injuries", "climatic-injuries-overview", "Climatic injuries: overview"),
      firstAid("Heat Injuries", "heat-injuries", "Heat injuries"),
      firstAid("Cold Weather Injuries", "cold-weather-injuries", "Cold weather injuries"),
      firstAid("Mountainous Terrain Injuries", "mountainous-terrain-injuries", "Mountainous terrain injuries", {
        end: "Sickle Cell Trait",
      }),
    ],
  },
  {
    id: "disasters",
    title: "Disasters",
    children: [
      article("floods", "Floods", "ready-gov", "", { document: "/floods" }),
      article("tornadoes", "Tornadoes", "ready-gov", "", { document: "/tornadoes" }),
      article("thunderstorms-and-lightning", "Thunderstorms and Lightning", "ready-gov", "", { document: "/thunderstorms-lightning" }),
      article("winter-weather", "Winter weather", "ready-gov", "", { document: "/winter-weather" }),
      article("extreme-heat", "Extreme heat", "ready-gov", "", { document: "/heat" }),
      article("earthquakes", "Earthquakes", "ready-gov", "", { document: "/earthquakes" }),
      article("landslides-and-debris-flow", "Landslides and debris flow", "ready-gov", "", { document: "/landslides-debris-flow" }),
      article("wildfires", "Wildfires", "ready-gov", "", { document: "/wildfires" }),
      article("power-outages", "Power outages", "ready-gov", "", { document: "/power-outages" }),
      article("hazardous-materials-incidents", "Chemicals and hazardous materials incidents", "ready-gov", "", {
        document: "/hazardous-materials-incidents",
      }),
      article("household-chemical-emergencies", "Household chemical emergencies", "ready-gov", "", {
        document: "/household-chemical-emergencies",
      }),
      article("pandemics", "Pandemics", "ready-gov", "", { document: "/pandemics" }),
      article("radiation-emergencies", "Radiation emergencies", "ready-gov", "", { document: "/radiation-emergencies" }),
      article("space-weather", "Space weather", "ready-gov", "", { document: "/space-weather" }),
      article("volcanoes", "Volcanoes", "ready-gov", "", { document: "/volcanoes" }),
      article("tsunamis", "Tsunamis", "ready-gov", "", { document: "/tsunamis" }),
      {
        id: "are-you-ready-2004",
        title: "Are You Ready? (FEMA, 2004)",
        children: [
          article("is22-why-prepare", "Why Prepare", "fema-is-22", "Why Prepare"),
          article("is22-getting-informed", "Getting Informed", "fema-is-22", "Getting Informed"),
          article("is22-emergency-planning", "Emergency Planning and Checklists", "fema-is-22", "Emergency Planning and Checklists"),
          article("is22-disaster-supplies-kit", "Assemble a Disaster Supplies Kit", "fema-is-22", "Assemble a Disaster Supplies Kit"),
          article("is22-shelter", "Shelter", "fema-is-22", "Shelter"),
          article("is22-practicing-and-maintaining", "Practicing and Maintaining Your Plan", "fema-is-22", "Practicing and Maintaining Your Plan"),
          article("is22-floods", "Floods", "fema-is-22", "Floods"),
          article("is22-tornadoes", "Tornadoes", "fema-is-22", "Tornadoes"),
          article("is22-hurricanes", "Hurricanes", "fema-is-22", "Hurricanes"),
          article("is22-thunderstorms", "Thunderstorms and Lightning", "fema-is-22", "Thunderstorms and Lightning"),
          article("is22-winter-storms", "Winter Storms and Extreme Cold", "fema-is-22", "Winter Storms and Extreme Cold"),
          article("is22-extreme-heat", "Extreme Heat", "fema-is-22", "Extreme Heat"),
          article("is22-earthquakes", "Earthquakes", "fema-is-22", "Earthquakes"),
          article("is22-volcanoes", "Volcanoes", "fema-is-22", "Volcanoes"),
          article("is22-landslides", "Landslides and Debris Flow (Mudslide)", "fema-is-22", "Landslides and Debris Flow (Mudslide)"),
          article("is22-tsunamis", "Tsunamis", "fema-is-22", "Tsunamis"),
          article("is22-fires", "Fires", "fema-is-22", "Fires"),
          article("is22-wildfires", "Wildfires", "fema-is-22", "Wildfires"),
          article("is22-hazardous-materials", "Hazardous Materials Incidents", "fema-is-22", "Hazardous Materials Incidents"),
          article("is22-household-chemical", "Household Chemical Emergencies", "fema-is-22", "Household Chemical Emergencies"),
          article("is22-nuclear-power-plants", "Nuclear Power Plants", "fema-is-22", "Nuclear Power Plants", {
            // Part 4, Terrorism, and Part 5, Recovering from Disaster, are not
            // shipped; the guide's three appendices are checklists and forms.
            end: "Terrorism",
          }),
        ],
      },
    ],
  },
];

/**
 * What a person cannot use, or must not be handed, out of an otherwise shipped
 * chapter: the first-aid selection drops what needs a medic, a drug or a
 * weapon. Expressed as patterns over the whole text, because a rule that fires
 * is a refusal to ship that article, and the doc lists what it fired on.
 */
export const FORBIDDEN = [
  {
    id: "drug-dose",
    // A number with the unit a DRUG is dosed in. Mass in grams and volume in
    // cubic centimetres are deliberately absent: measured on FM 21-76, firing
    // on `gram` alone would refuse the edible-plants appendix (plants are
    // described by their vitamin and starch content, "56 grams of starch") and
    // on `cc` alone would refuse ATP 3-50.21's circulation section, which
    // describes how much blood an adult has. `mg`, `mcg` and `mL` have one
    // meaning in these sources and it is a dose.
    pattern:
      /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|milligrams?|micrograms?|mL|millilitres?|milliliters?|tablets?|capsules?|vials?|ampoules?|syrettes?|doses?)\b|1\s?:\s?(?:1|2|5|10)\s?0{3}/i,
  },
  {
    id: "combat",
    // Weapons doctrine, and THREE DISTINCT terms have to be named before a
    // section is refused. The threshold is the point: these manuals are written for
    // soldiers, so a single passing mention is their voice and not their
    // subject (measured: ATP 3-50.21's water chapter names a rifle once, in a
    // list of things that can serve as a container, and its food chapter says a
    // reader may be eluding an enemy; neither chapter is about weapons, and
    // neither sentence can be removed without editing the source. Measured the
    // other way too: FM 21-76's cooking chapter names `ammunition` three times,
    // for the cans a reader can cook in, and ATP 4-02.11's impalement section
    // names `grenade` and `artillery` as mechanisms of injury — both are first
    // aid and craft, and the terms that classify them are one or two).
    pattern:
      /\b(?:machine guns?|submachine guns?|assault rifles?|hand grenades?|fragmentation grenades?|grenades?|bayonets?|claymores?|land\s?mines?|minefields?|antipersonnel|booby traps?|explosive ordnance|artiller(?:y|ies)|mortar rounds?|ammunition|snipers?|ambush(?:es)?|hostile forces|enemy soldiers?)\b/gi,
    minimum: 3,
    distinct: true,
  },
];
