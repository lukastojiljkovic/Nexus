/**
 * „Gradnja i projektovanje" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in the `name` and `blurb` tables of `./pro.ts`, because the drawer's rail
 * needs them before any surface is opened.
 *
 * **A unit is copy, not a constant.** „mm" and „m" are written here rather than
 * concatenated in the surface, so the day this table has a second locale the
 * units move with it — and because a unit hard-coded in a component is a string
 * `check:strings` cannot see and a translator cannot find.
 *
 * **Nothing in here judges.** Every tool in this pack that touches a load, a
 * height or a fall is `life-safety`, so its copy may name a quantity and may
 * name the user's own limit, and may not say what the two mean together
 * (`toolForbidsVerdict`). Where a limit appears below it is always „granica koju
 * si uneo" — whose it is, said in the label.
 */
export const PRO_GRADNJA_SR = {
  "stair-geometry": {
    rise: "Spratna visina",
    riseHint: "Od gotovog poda do gotovog poda, u milimetrima.",
    risers: "Broj visina stepenika",
    risersHint: "Broj podizanja, ne broj gazišta — gazišta ima jedno manje kad krak izlazi u ravan poda.",
    going: "Gazište",
    goingHint: "Dubina gazišta u milimetrima.",
    top: "Izlaz kraka",
    topFlush: "U ravan gornjeg poda",
    topLanding: "Na podest u nivou poslednjeg podizanja",
    riserLimit: "Granična visina stepenika koju si uneo",
    goingLimit: "Granično gazište koje si uneo",
    limitHint: "Iz propisa koji primenjuješ. Nexus ne zna koji je to propis i ne nudi vrednost.",

    results: "Rezultat",
    riser: "Visina stepenika",
    goings: "Broj gazišta",
    run: "Ukupan hod",
    pitch: "Nagib",
    blondel: "2r + g",
    blondelNote:
      "Blondelov izraz iz 1675. je definisana veličina, ne propis — prikazuje se kao broj i ne poredi se ni sa čim.",
    ratio: "Odnos prema tvojoj granici",
    riserRatio: "Visina ÷ tvoja granica",
    goingRatio: "Gazište ÷ tvoja granica",

    inputs: "Uneseno",
    formula: "r = H / n     θ = arctg(r / g)     B = 2r + g",

    /**
     * The refusals, keyed by the `reason` the core function returns. A surface
     * never composes its own: `stairFlight` names the input that made the answer
     * impossible, and this table is the only place that name becomes a sentence.
     */
    errorRise: "Spratna visina mora biti veća od nule.",
    errorRisers: "Broj visina stepenika je ceo broj od 1 do 60.",
    errorGoing: "Gazište mora biti veće od nule.",

    unitMm: "mm",
    unitM: "m",
    unitDeg: "°",
  },
} as const;
