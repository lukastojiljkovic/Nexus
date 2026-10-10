/**
 * Professional tools - the English copy of the professional drawer's own table:
 * its chrome, the words every one of its surfaces shares, and the name of each
 * toolkit.
 *
 * **Why this is a group of its own and not part of `devtools`.** It used to
 * be: the drawer was "Programmer's tools", its chrome and its shared surface
 * words sat in `strings/devtools.ts` beside the forty-eight tool names, and
 * that was right for as long as the drawer and the toolkit were the same thing.
 * They are not any more - `devtools` is now the copy of ONE pack
 * (`softver`), and this is the copy of the drawer that hosts it and seventeen
 * others. A pack's tool names stay with the pack; the search field, the empty
 * state and "Copied" belong to the room they are all standing in.
 *
 * That split is also why `titleKey: "devtools.name.riscv"` did not have to
 * move. A tool names a string in its own family's group
 * (`ToolRegistration`), and the RISC-V decoder's family did not change when
 * its neighbours arrived.
 *
 * Nothing here is a second copy layer. This is one leaf of the same table -
 * `strings.en.ts` imports it as `pro`, and `strings.ts` installs that whole
 * table when the reader picks English, so a locale switch rewrites these leaves
 * exactly as it rewrites the rest. A consumer reads `strings.pro.…` and never
 * imports this file.
 */

import { PRO_GRADNJA_EN } from "./pro.gradnja.en.js";
import { PRO_INZENJERING_EN } from "./pro.inzenjering.en.js";
import { PRO_DIZAJN_EN } from "./pro.dizajn.en.js";
import { PRO_FOTO_EN } from "./pro.foto.en.js";
import { PRO_MUZIKA_EN } from "./pro.muzika.en.js";
import { PRO_PROSVETA_EN } from "./pro.prosveta.en.js";
import { PRO_TEKST_EN } from "./pro.tekst.en.js";
import { PRO_TRENING_EN } from "./pro.trening.en.js";
import { PRO_KUHINJA_EN } from "./pro.kuhinja.en.js";
import { PRO_PRAVO_EN } from "./pro.pravo.en.js";
import { PRO_RACUNOVODSTVO_EN } from "./pro.racunovodstvo.en.js";
import { PRO_BIZNIS_EN } from "./pro.biznis.en.js";
import { PRO_NEKRETNINE_EN } from "./pro.nekretnine.en.js";
import { PRO_TRANSPORT_EN } from "./pro.transport.en.js";
import { PRO_AGRO_EN } from "./pro.agro.en.js";
import { PRO_ZANAT_EN } from "./pro.zanat.en.js";
import { PRO_EVENT_EN } from "./pro.event.en.js";

export const proEn = {
  title: "Professional tools",
  searchLabel: "Search professional tools",
  searchPlaceholder: "Search by name or term…",
  noMatches: "No tool matches the search.",
  clearSearch: "Clear search",

  /**
   * The line under the drawer's name: how much is standing behind it.
   *
   * Composed from the registry and never written down — a hand-typed count is a
   * number that goes stale the first time a tool is added, and this one also
   * moves with the profile's own toolkits.
   */
  subtitle: "{count} {unit}",
  /** Numeral agreement for the count above — three forms, through `countUnit`. */
  unitTool: { one: "tool", few: "tools", many: "tools" },

  /**
   * „Nedavno": the tools this device opened last, above the directory.
   *
   * Drawn only when there is something to draw. An empty „Nedavno" heading is a
   * promise the drawer has not kept yet, and on a fresh install it would be the
   * first thing anyone sees.
   */
  recentTitle: "Recent",
  /**
   * The directory that fills the surface before a tool is chosen — and the
   * reason that surface stopped being empty.
   *
   * With hundreds of tools behind one rail, „izaberi alatku sa liste" is the
   * hardest sentence in the drawer. The professional drawer
   * indexes itself by TOOLKIT rather than by subject, because the toolkits are
   * what this person chose and the rail already groups by subject — the two
   * views answer different questions instead of repeating one.
   */
  directoryTitle: "Your packs",

  /**
   * The state nothing else in the app has: the module is on and the drawer is
   * EMPTY, because every tool in it belongs to a pack and this profile has none.
   *
   * It is reachable — somebody switches „Stručne alatke" on from the Moduli
   * gallery without ever having answered the questionnaire — and it must not
   * read as a failure, because nothing failed. It says what is missing and where
   * the switch is, which is the `EmptyState` contract („says what to do, and
   * does not scold").
   */
  noPacksTitle: "No pack is enabled",
  noPacks:
    "The tools in this drawer come in packs by profession. Choose at least one to see what it carries.",
  choosePacks: "Choose packs",

  /**
   * Copy the surfaces share — the words that would otherwise be written once per
   * tool and drift on about one in eight.
   *
   * Moved here from `devtools` wholesale, and the move is the point rather than
   * tidying: „Kopiraj" is the drawer's word, not the developer pack's, and a
   * quantity-take-off surface reading it out of a group called `devtools` would
   * have been the first sign that the split was drawn in the wrong place.
   */
  common: {
    copy: "Copy",
    /** Replaces „Kopiraj" for a moment after a copy. Past tense: it has happened. */
    copied: "Copied",
    result: "Result",
    input: "Input",
    output: "Output",
    /** Before anything has been typed — the output box says this instead of standing empty. */
    awaitingInput: "Enter something above.",
    /** The one refusal every surface can need: the text is not what this tool reads. */
    invalid: "This is not a form this tool reads.",
    bytes: "Bytes",
    characters: "Characters",
    lines: "Lines",
    /** Under a table that stopped early — a table that stops silently misreports its input. */
    tableCapped: "The table shows the first {shown} of {total} rows.",
  },

  /**
   * The toolkits.
   *
   * **`name` is the subject; `who` is the vocabulary.** The packs are named after
   * what the work IS rather than after who does it (`TOOL_PACKS` argues why at
   * length), and that buys the design its most important property — a *geodeta*
   * recognises „Gradnja i projektovanje" without needing to be on a list. But it
   * costs the thing a job-title list gives away for free: a person scanning for
   * themselves wants to see their own word. `who` is that word, and it earns its
   * place three times over — it is read under the name in the pack picker, it is
   * what the questionnaire's cards say underneath, and its terms are folded into
   * the search index, so typing „geodeta" finds „Gradnja i projektovanje".
   *
   * There is deliberately NO description of what each pack contains. That line
   * exists on screen and is composed from the registry („14 alata: Zlatni čas,
   * Dubina oštrine, Ekspozicija…"), because a hand-written list of contents is a
   * promise that goes stale the first time a tool is added, and this house does
   * not ship copy that can quietly become false.
   */
  packs: {
    gradnja: {
      name: "Construction and design",
      who: "architects, civil engineers, surveyors, contractors",
    },
    inzenjering: {
      name: "Electrical and mechanical",
      who: "electrical engineers, mechanical engineers, electricians, technicians",
    },
    softver: {
      name: "Code and software",
      who: "programmers, system administrators, testers",
    },
    dizajn: {
      name: "Design and graphics",
      who: "graphic and UI designers, illustrators, print shops",
    },
    foto: {
      name: "Photography and filming",
      who: "photographers, videographers, editors",
    },
    muzika: {
      name: "Music and production",
      who: "musicians, producers, sound engineers",
    },
    prosveta: {
      name: "Teaching and grading",
      who: "professors, teachers, educators, lecturers",
    },
    tekst: {
      name: "Text and translation",
      who: "translators, proofreaders, journalists, writers",
    },
    // No „Medicina i nega" pack, and its absence is deliberate — see
    // `TOOL_PACKS`. These two lines are what a `who` line costs when it names
    // a regulated profession: „fizioterapeuti" and „nutricionisti" both stood
    // here, and both are health professions whose presence in an audience line
    // is a clinical intended-purpose claim about everything in the pack. The
    // trades that remain are the ones the tools are honestly for.
    trening: {
      name: "Training and fitness",
      who: "coaches, competitors, recreational athletes",
    },
    kuhinja: {
      name: "Kitchen and portions",
      who: "caterers, chefs, pastry chefs",
    },
    pravo: {
      name: "Law and deadlines",
      who: "lawyers, legal professionals, bailiffs, notaries",
    },
    racunovodstvo: {
      name: "Accounting and payroll",
      who: "accountants, bookkeepers, auditors",
    },
    biznis: {
      name: "Your own business and clients",
      who: "entrepreneurs, freelancers, agencies, small businesses",
    },
    nekretnine: {
      name: "Real estate",
      who: "agents, appraisers, investors, landlords",
    },
    transport: {
      name: "Driving and transport",
      who: "drivers, freight forwarders, couriers, taxi drivers",
    },
    agro: {
      name: "Agriculture",
      who: "crop farmers, fruit growers, vegetable growers, livestock farmers",
    },
    zanat: {
      name: "Trades and workshop",
      who: "tailors, carpenters, metalworkers, upholsterers, cobblers",
    },
    event: {
      name: "Events and organisation",
      who: "event, wedding and conference organisers",
    },
  },

  /**
   * The notices, one per risk class (`TOOL_RISK_CLASSES`).
   *
   * **Each one says what the tool IS; none of them apologises for what it might
   * do.** That is not a tone preference, it is the whole protective mechanism.
   * A notice characterises the tool — it establishes what the thing is for and
   * who is verifying the answer — and that is what a court, and a
   * medical-device qualification, actually read. „Rezultati mogu biti netačni"
   * does the opposite: it is the vendor conceding the product may be defective,
   * about arithmetic that simply has to be right.
   *
   * Four shapes are therefore banned here, and each is banned for its own
   * reason:
   *
   *  - **Enumerating a harm.** „Ne odgovaramo za povredu" proves the harm was
   *    foreseen, and then the question is why the answer to a foreseen harm was
   *    a sentence.
   *  - **Leading with a waiver.** A notice that opens „ne snosimo odgovornost"
   *    reads as a product that expects to hurt somebody.
   *  - **Hedging the accuracy.** See above — the computation is defended by
   *    tests and by showing its formula, never by a caveat.
   *  - **Claiming compliance.** „U skladu sa propisima" is a warranty. It is the
   *    opposite of a disclaimer, and it is the one sentence that could turn this
   *    block into the thing it exists to prevent.
   *
   * And what none of them can do, so nobody mistakes them for armour: Serbian
   * obligations law does not permit excluding liability in advance for intent or
   * gross negligence, consumer law voids unfair terms outright, and no text at
   * all binds the third party who never saw it — the patient, the family in the
   * house, the client. Those are answered by the refusal list and by
   * `toolForbidsVerdict`, not here. What a notice honestly achieves is narrow
   * and worth having: the person using it cannot afterwards say they thought
   * the app was the professional.
   *
   * `line` sits on the surface, always, in the same place on every affected
   * tool. `note` is the long form in „Podešavanja". `export` is appended to a
   * copied result, because the harm nearly always happens downstream of this
   * window — in the email, the site diary, the client memo — and that line is
   * the only one of the three that travels to where the decision is made.
   */
  risk: {
    detail: "More detail",
    "life-safety": {
      label: "Safety",
      line:
        "A calculation from the values you enter. It does not replace the calculation, checking or responsibility of a chartered engineer.",
      note:
        "The tools in this group calculate a size from the data you enter yourself. They do not choose a regulation, set a limit or judge whether something complies — that is the work of a chartered designer or contractor, who is responsible for that decision. The limits you enter are shown beside the result so you can see what it was derived from.",
      export: "Nexus — an informational calculation. It does not replace a chartered engineer's calculation.",
    },
    wellness: {
      label: "Body and fitness",
      line: "An informational calculation. It is not medical or training advice.",
      note:
        "The tools in this group calculate numbers about your own body — mass, ratios, training load — from the values you enter yourself. They do not diagnose, do not prescribe treatment and do not replace a doctor. For health questions, see a doctor.",
      export: "Nexus — an informational calculation. It is not medical advice.",
    },
    "legal-procedure": {
      label: "Deadlines",
      line:
        "Calculates dates by the rule you choose. Choosing the rule and checking the deadline are legal questions.",
      note:
        "The tools in this group add and subtract dates by the counting rule you choose yourself — whether the first day counts, how a deadline falling on a non-working day moves. That choice is a legal question and remains yours; the tool only applies it and writes it beside the result. This is not legal advice.",
      export: "Nexus — an informational date calculation. It is not legal advice.",
    },
    financial: {
      label: "Money",
      line:
        "An informational calculation from the rates and amounts you enter. It is not tax or accounting advice.",
      note:
        "The tools in this group calculate from the rates and amounts you enter yourself. No rate is built into the program — which rate applies today and to your case is a question of regulation and your decision, so the entered rate is written beside the result. This is not tax, accounting or financial advice.",
      export: "Nexus — an informational calculation. It is not tax or accounting advice.",
    },
    "food-safety": {
      label: "Food safety",
      line: "A calculation from the values you enter. Food safety is determined by your HACCP plan and by regulations.",
      note:
        "The tools in this group calculate quantities and times from the values you enter yourself. They do not determine a safe temperature, time or procedure — your HACCP plan and regulations do, and that judgement remains yours.",
      export: "Nexus — an informational calculation. It does not determine food safety.",
    },
  },

  /** The „Podešavanja" card that holds every long-form notice, and the one line above them. */
  riskSection: {
    description:
      "Some tools calculate numbers used in legally regulated work. Each such tool carries a short notice; here it is in full.",
  },

  /**
   * The pack picker — the drawer's own dialog, a „Podešavanja" card, and the
   * questionnaire's receipt, all reading from here.
   *
   * There is deliberately no „Uskoro" line for a pack whose tools are not
   * written yet: the list is derived from the registry (`packInventory`), so
   * such a pack has no row at all. A row somebody cannot press is an
   * advertisement, and this house does not ship copy that promises.
   */
  picker: {
    title: "Tool packs",
    description:
      "Each pack adds one profession's tools. Enable as many as you like — nothing is deleted when you switch a pack off, the tools simply disappear from the list.",
    /** Under each card, and beside each row of the questionnaire's receipt. */
    contains: "{count} tools",
    /** The header control on the drawer itself. */
    open: "Packs…",
    /**
     * The way out of the dialog. „Gotovo", not „U redu": every toggle is
     * already written by the time it is read.
     */
    done: "Done",
    /**
     * Under the list, once at the bottom: what a pack is NOT, said plainly so
     * nobody hunts for a page.
     */
    note:
      "A pack is a set of tools, not a module — it adds nothing to the sidebar menu and stores no data.",
    /**
     * The second line at the foot, and the only place the whole drawer is
     * characterised at once.
     *
     * This is the acknowledgement, and switching a toolkit on IS the act of
     * acknowledging — there is no modal and no „Razumem" button. A consent gate
     * would be worth less than it costs: it is dismissed without reading by the
     * second toolkit, it teaches the user that the app's warnings are furniture
     * on the way to the tool, and it would have to be re-shown to mean anything,
     * at which point it is a nag. The sentence that is read is the one standing
     * beside the thing being switched on.
     */
    responsibility:
      "The tools calculate sizes from the values you enter. They do not replace a qualified professional — a designer, doctor, lawyer, accountant — or the decision they make and are responsible for.",
    /**
     * The one failure this surface can have: the flag row did not get written.
     * Says what it cost, which is the press.
     */
    saveError: "The change was not saved. Try again.",
  },

  /**
   * Every tool's NAME, across every toolkit, in one table — the rail needs it
   * before any surface is opened, so it cannot live with the surface's own copy.
   *
   * The `softver` pack's forty-eight are not here: they are under `devtools`,
   * because a tool names a string in its own family's group and that family did
   * not change when its neighbours arrived (`./devtools.ts`).
   */
  name: {
    "allocation-remainder": "Split without a remainder",
    "amount-in-words": "Amount and number in words",
    "angle-of-view": "Angle of view",
    "angle-units": "Angles and bearing",
    "anuitet-otplatni-plan": "Annuity and repayment schedule",
    "aspect-ratio-fit": "Aspect ratio",
    "audio-level-reference": "dBu, dBV and volts",
    "average-to-target": "Grades to average",
    "awg-to-mm2": "AWG and mm²",
    "axle-load-distribution": "Axle load",
    "backwards-timeline": "Timeline backwards",
    "bakers-percentage": "Baker's percentage",
    "bale-count-storage": "Bales and storage",
    "bank-account-iban": "Account and IBAN",
    "bar-duration": "Duration of bars",
    "bar-spacing": "Equal spacings",
    "barbell-plate-loading": "Plate loading",
    "baseline-rhythm": "Leading and vertical rhythm",
    "battery-bank-runtime": "Battery and runtime",
    "beam-check": "Beam and cantilever",
    "beam-spot-diameter": "Floodlight beam",
    "bee-syrup-mix": "Syrup for bees",
    "belt-and-gear-drive": "Drive and belt",
    "benford-first-digit": "Benford's digit test",
    "billable-hours": "Hours calculation",
    "body-fat-target-mass": "Body composition",
    "body-indices": "Body indices",
    "book-spine": "Spine thickness",
    "bpm-delay-times": "Delay time by tempo",
    "bracket-balance": "Brackets and quotes",
    "break-even": "Break-even point",
    "breakeven-cvp": "Break-even point",
    "brine-salt": "Brine and curing",
    "budget-per-guest": "Budget per guest",
    "cable-cross-section": "Required cross-section",
    "cadastral-area-units": "Cadastral measures",
    "cadence-stride-length": "Cadence and stride",
    "cargo-centre-of-gravity": "Load centre of gravity",
    "cashflow-npv-irr": "Cash flow",
    "catering-per-guest": "Food and drink per guest",
    "cents-ratio": "Cents and frequency ratio",
    "chained-discount": "Cascading discounts",
    "chargeable-weight": "Chargeable weight",
    "check-digits-id": "PIB and JMBG check",
    "child-age": "Child's age",
    "coffee-extraction": "Coffee extraction",
    "column-grid": "Column grid",
    "combinatorics": "Combinatorics",
    "compressor-curve": "Compressor curve",
    "concrete-takeoff": "Concrete volume and formwork",
    "copyfitting": "Text extent calculation",
    "cost-allocation": "Cost allocation",
    "cost-per-km-transport": "Cost per kilometre",
    "crop-factor": "Crop factor",
    "css-typographic-units": "Typographic units",
    "decibel-ratio": "Decibels and ratios",
    "delta-e": "Colour difference ΔE",
    "deposit-instalments": "Deposit and instalments",
    "depreciation-schedule": "Depreciation of fixed assets",
    "depth-of-field": "Depth of field",
    "diffraction-limit": "Diffraction",
    "dough-water-temp": "Water temperature",
    "drawing-scale": "Drawing scale",
    "driving-hours-planner": "Driving and breaks",
    "ean-barcode": "EAN barcode",
    "earthwork-prismoidal": "Volume between profiles",
    "erg-split-watts": "Split and watts",
    "eta-with-breaks": "Arrival estimate",
    "exposure-equivalent": "Equivalent exposure",
    "fabric-yardage-repeat": "Fabric and repeat",
    "fertiliser-nutrient-blend": "Fertiliser conversion",
    "financial-ratios": "Balance-sheet ratios",
    "flash-guide-number": "Guide number",
    "font-metrics-trim": "Font metrics",
    "fractions-decimals": "Fractions and decimals",
    "frame-rate-conform": "Conform and slow motion",
    "fuel-consumption-cost": "Fuel consumption and cost",
    "fx-difference": "Exchange rate and differences",
    "gear-ratio-road-speed": "Gear ratio and speed",
    "generator-sizing": "Generator power",
    "glass-pane-weight": "Glass weight",
    "glossary-check": "Terminology check",
    "grade-scale-points": "Test score scale",
    "grade-statistics": "Grade statistics",
    "grain-moisture-shrink": "Grain drying loss",
    "gross-up": "Gross from net",
    "growing-degree-days": "Temperature sum",
    "guessing-correction": "Guessing correction",
    "gvw-payload": "Total mass and payload",
    "heart-rate-zones-karvonen": "Heart-rate zones",
    "hidden-characters": "Hidden characters",
    "honey-mass-moisture": "Honey, mass and moisture",
    "hourly-rate-target": "Hourly rate",
    "iban-check": "IBAN",
    "ice-and-chilling": "Ice for cooling",
    "ice-cream-overrun": "Ice cream overrun",
    "illuminance-to-aperture": "Lux to aperture",
    "induction-motor-rating": "Induction motor",
    "interest-periods": "Interest by period",
    "interval-session-timing": "Interval training",
    "inventory-costing": "FIFO and average inventory",
    "irrigation-depth-volume": "Irrigation rate",
    "isbn-issn-check": "ISBN and ISSN",
    "iso-286-fits": "Tolerances and fits",
    "iso-paper-sizes": "ISO paper formats",
    "item-analysis": "Item analysis",
    "iznos-slovima": "Amount in Serbian words",
    "jmbg-provera": "JMBG check",
    "jump-height-flight-time": "Jump height",
    "junction-temperature": "Thermal resistance",
    "katastarska-povrsina": "Cadastral area",
    "kazna-i-pritvor": "Penalty and credit",
    "lamination-layers": "Lamination layers",
    "late-payment-interest": "Late-payment interest",
    "lease-term-dates": "Contract deadlines",
    "led-wall-pitch-viewing": "LED wall",
    "lesson-count-period": "Fund of lessons",
    "lesson-timeline": "Lesson pace",
    "levain-hydration": "Hydration and starter",
    "level-run": "Levelling",
    "limb-symmetry-index": "Side symmetry",
    "linear-cutting-stock": "Bar cutting",
    "livestock-ration-dm": "Ration by dry matter",
    "load-lashing-force": "Lashing force",
    "loading-space-utilisation": "Cargo space utilisation",
    "loan-amortization": "Repayment plan",
    "loan-schedule": "Loan repayment schedule",
    "machine-field-capacity": "Machine output",
    "margin-markup": "Margin and markup",
    "metric-thread-strength": "Metric thread",
    "mired-shift": "Mired correction",
    "mitre-angles": "Mitre and compound mitre",
    "modular-type-scale": "Typographic scale",
    "mojibake-repair": "Encoding repair",
    "mortar-mix-quantity": "Mortar and adhesive",
    "motion-blur": "Motion blur",
    "nd-filter-exposure": "ND filter",
    "nominalna-efektivna-stopa": "Nominal and effective rate",
    "note-frequency": "Note, MIDI and frequency",
    "number-check": "Number check",
    "number-to-serbian-words": "Number in Serbian words",
    "nutrition-per-portion": "Nutritional values",
    "obracun-kamate": "Interest calculation",
    "ohms-law-power": "Ohm's law and power",
    "one-rep-max-table": "1RM and percentages",
    "orchard-trellis-layout": "Backrest and rows",
    "ownership-shares": "Co-ownership shares",
    "pallet-load-plan": "Pallet layout",
    "pan-area-volume": "Moulds and containers",
    "panel-cutting-yield": "Sheet cutting",
    "paper-weight": "Paper weight and mass",
    "parcel-polygon-area": "Plot area",
    "parking-cloakroom": "Parking and cloakroom",
    "payment-due-date": "Payment deadline",
    "payment-reference-97": "Reference number 97",
    "pcm-file-size": "PCM recording size",
    "pipe-flow-velocity": "Flow through a pipe",
    "plant-spacing-density": "Planting spacing",
    "plate-cost": "Dish costing",
    "plot-density-index": "Building index",
    "podela-iznosa": "Splitting an amount",
    "polygon-area": "Polygon area",
    "portions-from-pack": "Portions from a package",
    "power-factor-correction": "Reactive power compensation",
    "pq-nits": "PQ and nits",
    "pressure-and-piston-force": "Pressure and piston force",
    "print-resolution": "Print resolution",
    "pro-rata-days": "Pro rata by days",
    "projector-throw-screen": "Projection and screen",
    "racun-iban-provera": "Account, IBAN and modulus 97",
    "radni-dani": "Working days",
    "raster-image-size": "Raster size",
    "rate-conversion": "Proportional and conformal rate",
    "ratio-split": "Split by ratio",
    "reading-time": "Reading time",
    "rebar-weight": "Rebar mass",
    "rebate-chain": "Chain discounts",
    "recipe-scale": "Recipe scaling",
    "reefer-fuel-consumption": "Refrigeration consumption",
    "rent-escalation": "Rent indexation",
    "rent-gross-net": "Gross and net rent",
    "rental-yield": "Rental yield",
    "resistor-colour-code": "Resistor colours",
    "reverb-time": "Reverberation time RT60",
    "rigging-sling-angle-force": "Force in a leg",
    "rlc-impedance": "Impedance and resonance",
    "rok-poslednji-dan": "Deadline and last day",
    "roll-yield": "Roll utilisation",
    "roof-pitch": "Roof pitch",
    "room-modes": "Room modes",
    "room-quad-area": "Room area",
    "room-surfaces": "Room surfaces",
    "run-of-show": "Event schedule",
    "running-pace-splits": "Race pace",
    "saddle-stitch-imposition": "Booklet imposition",
    "sample-buffer-latency": "Buffers and latency",
    "scale-chord-speller": "Scales and chords",
    "seating-tables": "Tables and layout",
    "section-modulus": "Section properties",
    "seeding-rate": "Sowing rate",
    "sentence-length": "Sentence length",
    "serbian-transliteration": "Transliteration",
    "series-parallel-network": "Series and parallel",
    "service-interval-km-hours": "Service interval",
    "set-tempo-tut": "Set pace",
    "share-allocation": "Allocation by shares",
    "sheet-imposition": "Sheet imposition",
    "sheet-metal-bend": "Sheet metal development",
    "shelf-deflection": "Shelf deflection",
    "shelf-spacing": "Shelf layout",
    "simple-interest-days": "Interest by days",
    "slope-grade": "Slope and gradient",
    "smpte-timecode": "SMPTE timecode",
    "solution-concentration": "Solution concentration",
    "sound-wavelength": "Sound wavelength",
    "speaker-load": "Speaker impedance and power",
    "speedometer-tyre-deviation": "Speedometer error",
    "spl-distance": "SPL at a distance",
    "split-into-groups": "Group division",
    "split-times-fatigue": "Times and fatigue",
    "sprayer-calibration": "Sprayer calibration",
    "square-check": "Right-angle check",
    "stage-deck-layout": "Stage and platform",
    "stair-geometry": "Staircase",
    "standard-score": "Standard score",
    "strane-teksta": "Text page calculation",
    "subtitle-audit": "Subtitle check",
    "subtitle-retime": "Subtitle shifting",
    "survey-bearing-distance": "Surveying task",
    "suvlasnicki-udeli": "Shares and target denominator",
    "sweat-rate-hydration": "Sweat rate",
    "tank-mix-dose": "Dose per tank",
    "tank-volume-by-level": "Tank volume",
    "tap-drill-size": "Thread tapping",
    "tax-id-check": "PIB and company number",
    "tent-bay-layout": "Tent size",
    "test-printing": "Test duplication",
    "three-phase-load-balance": "Phase balance",
    "three-phase-power": "Three-phase power",
    "tiered-commission": "Tiered commission",
    "tile-count": "Number of tiles",
    "timber-volume": "Timber volume",
    "timelapse-planner": "Timelapse",
    "topic-hour-allocation": "Allocation by topics",
    "torque-speed-power": "Torque and power",
    "training-volume-load": "Tonnage and intensity",
    "translation-volume": "Translation volume",
    "transposition": "Transposition",
    "trench-volume": "Trench excavation",
    "trial-balance-check": "Sum check",
    "trip-cost-quote": "Tour price",
    "troskovi-srazmerno-uspehu": "Success-based costs",
    "truss-hoist-reactions": "Route and motor load",
    "tvm-solver": "Time value of money",
    "typography-cleanup": "Typographic cleanup",
    "ugovorna-kazna": "Contractual penalty",
    "unwrap-paragraphs": "Layout cleanup",
    "us-customary-kitchen-units": "American measures",
    "varispeed-repitch": "Detuning and speed",
    "venue-occupancy-area": "Venue capacity",
    "video-bitrate-storage": "Bitrate and card",
    "voltage-drop": "Line voltage drop",
    "wall-ceiling-area": "Walls and ceiling",
    "wall-u-value": "Assembly U-value",
    "wallpaper-rolls": "Number of wallpaper rolls",
    "weight-class-cut": "To the category limit",
    "weighted-area": "Chargeable area",
    "weighted-grade": "Weighted grade",
    "weld-consumable": "Welding consumption",
    "wood-moisture-movement": "Wood movement by moisture",
    "word-frequency": "Word frequency",
    "yield-estimate-samples": "Yield estimate",
    "yield-trim-cook": "Yield and loss",
    "zbir-perioda": "Sum of periods",
  },

  /**
   * The one line under each name. Says what the tool ANSWERS, never what it
   * guarantees — „daje visinu stepenika", not „proverava da li stepenište
   * zadovoljava", which would be a claim the tool is forbidden to make.
   */
  blurb: {
    "allocation-remainder":
      "Splits an amount by a given key so the parts add up to exactly the whole, with no penny lost to rounding.",
    "amount-in-words":
      "Writes an amount in words — with a currency, where the word form follows the number, or without a currency as a bare number.",
    "angle-of-view":
      "For the entered sensor dimensions and focal length, gives the angle of view across width, height and diagonal, and how many metres the frame covers at a given distance.",
    "angle-units":
      "Converts an angle between degrees-minutes-seconds, decimal degrees, gradians, radians and mils, and reduces it to a full circle.",
    "anuitet-otplatni-plan":
      "What the equal instalment is, and how each instalment splits into interest and principal when a debt is repaid in N equal instalments.",
    "aspect-ratio-fit":
      "The reduced whole-number aspect ratio and the dimensions when fitting into a frame, filling a frame or a given width, with the band or crop size.",
    "audio-level-reference":
      "Converts a line-signal level between dBu, dBV, dBm and volts — RMS, peak and peak-to-peak.",
    "average-to-target":
      "Calculates how many more grades of a given value are needed for the average to reach the target, or how many weaker grades the average can still absorb without falling below the target.",
    "awg-to-mm2":
      "Converts an AWG number into diameter and cross-section and back, with resistance per kilometre at 20 °C.",
    "axle-load-distribution":
      "From the load position and the wheelbase, calculates the front and rear axle load, and for a tractor unit the fifth-wheel load too.",
    "backwards-timeline":
      "From the serving time backwards, calculates when each preparation step must start and what time the whole job begins.",
    "bakers-percentage":
      "Converts a recipe into baker's percentages and back, and calculates ingredient weights for a target dough mass or a given number of pieces with baking loss.",
    "bale-count-storage":
      "How many bales a cut area yields, how much volume they take up, and how many fit by geometry into a given shed or trailer.",
    "bank-account-iban":
      "Checks the check digits of a domestic current account (3-13-2) and an IBAN, and computes them when missing, by the same MOD 97-10 arithmetic.",
    "bar-duration":
      "How long N bars last at a given tempo and time signature, and back — how many bars fit into a given duration.",
    "bar-spacing":
      "Splits a length into equal spacings that do not exceed a given maximum, and gives the number of pieces, the actual spacing and all positions.",
    "barbell-plate-loading":
      "For a desired total load, lists which plates to put on each side of the bar, and when an exact sum is impossible — the nearest load that is possible and by how much it misses.",
    "baseline-rhythm":
      "What the leading is in pixels, whether it lands on the baseline grid, and how many lines fit in a column of a given height.",
    "battery-bank-runtime":
      "Calculates pack voltage and energy, the usable part and runtime under a given load, with Peukert's correction when the user enters it.",
    "beam-check":
      "For four basic static schemes, gives the reactions, maximum moment, stress and deflection from the entered E and I.",
    "beam-spot-diameter":
      "From the beam angle and distance, gives the diameter of the lit circle, the illuminance at the centre and the spacing of the floodlights for a given overlap, including oblique incidence.",
    "bee-syrup-mix":
      "How much sugar and water go into a given quantity of syrup at the chosen ratio, what its calculated density and concentration are, and how much is needed for all the hives.",
    "belt-and-gear-drive":
      "Calculates the gear ratio and output speed, the belt speed, the exact length of an open belt, the wrap angles and the centre distance of a timing pair.",
    "benford-first-digit":
      "Compares the distribution of the first (or first two) digits in a pasted column of amounts with Benford's distribution, and gives chi-square, MAD and a z-value per digit.",
    "billable-hours":
      "Adds up times from a list, rounds them to the agreed interval and multiplies by the hourly rate.",
    "body-fat-target-mass":
      "From body mass and measured body-fat percentage, gives fat mass and lean mass, and how many kilograms the body would weigh at a desired fat percentage if lean mass stays the same.",
    "body-indices":
      "Calculates BMI, the ponderal index and waist/height and waist/hip ratios from the entered measurements, without a single category or a single table.",
    "book-spine":
      "How many millimetres the spine of a book is with a given page count, paper weight and bulk, and what the developed cover is.",
    "bpm-delay-times":
      "For a given tempo, gives the time in milliseconds for each note value — plain, dotted and triplet — and the matching frequency for an LFO.",
    "bracket-balance":
      "Shows which bracket or quote is not closed and at which line and column it sits.",
    "break-even":
      "How many units and how much revenue cover the fixed costs, and how much is needed for the desired profit.",
    "breakeven-cvp":
      "Calculates how many units and how much turnover cover the fixed costs, how much is needed for a target profit, and how far volume can fall before a loss.",
    "brine-salt":
      "How much salt goes into a brine or a dry cure for the percentage the user sets, by both common bases of calculation, and what the salt percentage is in a brine that already exists.",
    "budget-per-guest":
      "Adds fixed costs, per-guest and per-table costs, percentage items, contingency and tax, and gives the price per guest and the break-even ticket price.",
    "cable-cross-section":
      "From the voltage drop the user sets, calculates the minimum copper or aluminium needed to stay within that drop, and the drop obtained at the cross-section the user chooses.",
    "cadastral-area-units":
      "Converts cadastral acres and square fathoms into ares, hectares and square metres, and back.",
    "cadence-stride-length":
      "Links cadence, stride length and speed — from any two it gives the third, with steps per kilometre.",
    "cargo-centre-of-gravity":
      "From a list of items with mass and position, gives the load's centre of gravity along length, width and height, and its moments.",
    "cashflow-npv-irr":
      "Calculates the net present value and internal rate of return of a series of inflows and outflows by period.",
    "catering-per-guest":
      "From the quantity per guest, the share of guests who take an item and the contingency, calculates the total quantity, the number of packages and the surplus per item.",
    "cents-ratio":
      "Converts the difference of two frequencies into cents, semitones and a ratio, and calculates the frequency after detuning by a given number of cents.",
    "chained-discount":
      "Layers a series of discounts and surcharges on top of one another and says which single discount would give the same price.",
    "chargeable-weight":
      "From the dimensions and actual mass of a shipment, gives the volumetric mass by a given divisor and the chargeable mass that is invoiced.",
    "check-digits-id":
      "Calculates and checks the check digit of a PIB, a company number and a JMBG, so a typing error shows before the number goes onto a document.",
    "child-age":
      "For a date of birth and a given day, calculates the age in years, months and days, the total number of completed months and days, and the date on which the person reaches a given number of years.",
    "coffee-extraction":
      "From the dose, water, brew mass and measured TDS, calculates the brewing ratios and extraction percentage, and back — how much water goes with a given ratio.",
    "column-grid":
      "The width of one column and a span of k columns for a given width, the number of columns, the gutter and the margin, and how many columns fit at a given minimum width.",
    "combinatorics":
      "Calculates factorial, variations and combinations with and without repetition, and permutations with repetition, in integer arithmetic without rounding.",
    "compressor-curve":
      "For a given threshold, ratio and knee, shows what happens to the input level — output level, gain reduction and the makeup needed.",
    "concrete-takeoff":
      "For a slab, beam, column or footing, gives the concrete volume, the formwork area and the number of mixer loads.",
    "copyfitting":
      "How many lines, columns and pages a text of N characters takes at a given line width and column height, and what line count makes an exact number of pages.",
    "cost-allocation":
      "Splits a shared cost into parts by area or share, with rounding whose parts add up to exactly the whole.",
    "cost-per-km-transport":
      "From annual fixed costs and cost per kilometre, gives the cost price of a kilometre and of a kilometre under load.",
    "crop-factor":
      "From the entered sensor dimensions, calculates the crop factor relative to the 135 format and converts focal length and aperture to a full-frame equivalent.",
    "css-typographic-units":
      "Converts px, rem, em, pt, pica, mm, cm, inch, Q and dp into one another, and gives asset sizes for @2x and @3x.",
    "decibel-ratio":
      "Converts decibels into a linear ratio and back — separately for amplitude and separately for power — and adds several levels in decibels.",
    "delta-e":
      "How much two colours differ numerically by the ΔE*ab, ΔE94 and CIEDE2000 formulas; the acceptance threshold is set and interpreted by the user.",
    "deposit-instalments":
      "Splits a contract value into a deposit and equal instalments with dates, with no difference in the sum.",
    "depreciation-schedule":
      "Makes a depreciation plan by straight-line, declining-balance, sum-of-years or units-of-production method, with a pro-rata year of acquisition.",
    "depth-of-field":
      "For a given focal length, aperture, focus distance and circle of confusion, gives the hyperfocal distance and the near and far limits of sharpness.",
    "diffraction-limit":
      "Gives the diameter of the Airy disc for a given aperture, and the aperture at which the disc reaches the size of one pixel of the entered sensor.",
    "dough-water-temp":
      "Calculates the water temperature so the dough has the desired temperature after mixing and, conversely, extracts the mixer's friction factor from a measured batch.",
    "drawing-scale":
      "Converts a length on paper into a real length and back, and says which scale from the standard series fits the chosen sheet format.",
    "driving-hours-planner":
      "From the limits the user enters, lays out a planned drive into blocks with breaks and rests, and gives the schedule.",
    "ean-barcode":
      "Calculates the check digit for EAN-13, EAN-8 and UPC-A and gives the symbol's width and height at a given X-dimension.",
    "earthwork-prismoidal":
      "Adds the volume of cut and fill from cross-section areas, by the average-end-area method or the prismoidal formula.",
    "erg-split-watts":
      "Converts a 500-metre split into watts and back by the published Concept2 relation, and gives the time for a given distance at that split.",
    "eta-with-breaks":
      "From the distance, average speed and planned stops, gives the arrival time and the door-to-door average speed.",
    "exposure-equivalent":
      "From one combination of aperture, shutter and ISO, finds the third value for the same exposure, and the difference between two combinations in stops.",
    "fabric-yardage-repeat":
      "How many running metres of fabric are needed for given pieces, according to the roll width, seams and pattern repeat.",
    "fertiliser-nutrient-blend":
      "From the entered target nutrient quantities per hectare and the fertiliser composition in NPK percentages, gives kilograms of each fertiliser per hectare and in total, and what a given quantity of fertiliser supplies.",
    "financial-ratios":
      "From the entered balance-sheet and income-statement lines, calculates liquidity, leverage, turnover and profitability ratios, including the cash conversion cycle.",
    "flash-guide-number":
      "From the guide number and distance, gives the aperture, converts the guide number to another ISO and calculates the change in illumination when the distance changes.",
    "font-metrics-trim":
      "From unitsPerEm, ascender and descender, gives the cap height in pixels and the negative offsets so a text box sits on the cap line.",
    "fractions-decimals":
      "Adds, subtracts, multiplies and divides fractions in integer arithmetic, reduces the result, shows it as a mixed number and as a decimal with the repeating part marked, and turns a repeating decimal back into a fraction.",
    "frame-rate-conform":
      "When footage from one frame rate lands on a timeline at another, gives the playback speed, the new duration and the offset from the original.",
    "fuel-consumption-cost":
      "From the distance travelled and fuel used, gives consumption, cost per kilometre and cost per tonne-kilometre.",
    "fx-difference":
      "Converts a foreign-currency amount at the rate the user enters, calculates the exchange difference between two rates and derives a cross rate from two pairs.",
    "gear-ratio-road-speed":
      "Links engine speed, gearbox and final-drive ratios and tyre circumference to vehicle speed.",
    "generator-sizing":
      "Adds loads with power factor and simultaneity into a working apparent power, and calculates the peak apparent power at the moment the largest motor starts.",
    "glass-pane-weight":
      "The mass of monolithic, laminated and insulated glass per m², per piece and in total, from the dimensions and the composition of the pack.",
    "glossary-check":
      "For a glossary of terms you paste, checks whether every term from the source appeared in the translation and how many times.",
    "grade-scale-points":
      "Converts percentage thresholds the user enters into a score on a test with a given maximum, and shows which score band carries which grade.",
    "grade-statistics":
      "For an entered series of grades or scores, gives the mean, median, mode, standard deviation, quartiles, the distribution by value and the share of values above a threshold the user enters.",
    "grain-moisture-shrink":
      "How many kilograms remain when grain at a measured moisture content drops to the contract moisture, how much water left, and what the mass is after deductions for impurities.",
    "gross-up":
      "Solves the linear gross–net equation backwards: from the net amount and the rates the user enters, derives the gross, the tax and contribution amounts, and returns the check.",
    "growing-degree-days":
      "Adds daily temperature sums above a base temperature chosen by the user and shows how much has accumulated and when a given sum is reached at the same rate.",
    "guessing-correction":
      "For a multiple-choice test, calculates the score reduced by the expected contribution of guessing and shows what a clean hit would average.",
    "gvw-payload":
      "Adds tare, fuel, crew, equipment and payload into a total mass and compares it with the limits the user enters.",
    "heart-rate-zones-karvonen":
      "From the measured maximum and resting heart rate, gives the target heart rate by Karvonen and by percentage of maximum, and back — what percentage a measured rate is.",
    "hidden-characters":
      "Finds invisible and control characters in a text and words in which Cyrillic and Latin are mixed.",
    "honey-mass-moisture":
      "From the measured density and moisture, gives the net mass of honey in a container, the water-to-dry-matter ratio and the mass after drying to a lower moisture.",
    "hourly-rate-target":
      "From a desired annual income, costs and number of billable hours, calculates the hourly rate and the day rate.",
    "iban-check":
      "Checks the check digits of an IBAN and builds an IBAN from a country code and a domestic account number.",
    "ice-and-chilling":
      "How many kilograms of ice remove heat from a given mass of drink from a starting to a target temperature, and how much ice melts additionally during holding.",
    "ice-cream-overrun":
      "Calculates overrun from the mass of the same container filled with mix and with finished ice cream, and from a given overrun gives the volume and weight of a package.",
    "illuminance-to-aperture":
      "Converts lux and foot-candles and, with a calibration constant entered from your light meter, calculates the aperture for a given ISO and shutter time.",
    "induction-motor-rating":
      "From the nameplate data, calculates rated current, input power, synchronous speed, slip and torque.",
    "interest-periods":
      "Calculates interest on a principal across several periods with different rates and by the chosen day-count basis, showing the days and interest per period.",
    "interval-session-timing":
      "From the work duration, rest (or work:rest ratio) and the number of repetitions and sets, gives the set duration, the total training time and the actual work-to-rest ratio.",
    "inventory-costing":
      "From a list of inputs and outputs, calculates the cost of goods sold and the inventory balance by the FIFO method and by weighted average cost.",
    "irrigation-depth-volume":
      "Converts an entered irrigation rate in millimetres into cubic metres per hectare, gives the system's runtime at a given flow and the sprinkler's rainfall intensity.",
    "isbn-issn-check":
      "Checks the check digit of an ISBN, ISSN, ISMN and EAN-13 number and converts ISBN-10 to ISBN-13 and back.",
    "iso-286-fits":
      "The limit sizes of a hole and shaft for a tolerance designation and the clearance that results, for clearance fits.",
    "iso-paper-sizes":
      "The millimetre dimensions of A, B and C formats, which envelope takes which sheet, how many smaller formats fit into a larger one, and what the enlargement percentage is on a copier.",
    "item-analysis":
      "For a single test item, calculates the facility index (share of correct answers) and the discrimination index as the difference in success between the stronger and weaker group.",
    "iznos-slovima":
      "Writes a monetary amount in Serbian words, with the correct noun form beside the number.",
    "jmbg-provera":
      "Whether the check digit of an entered JMBG matches the other twelve, and what date, sex marker and registry number that record carries.",
    "jump-height-flight-time":
      "Converts flight time into jump height and back, and calculates the reactive strength index from height and ground contact time.",
    "junction-temperature":
      "From the power, ambient and chain of thermal resistances, calculates the junction temperature, or conversely the required heatsink thermal resistance and allowable power.",
    "katastarska-povrsina":
      "Converts an area between hectares, ares and square metres, in both directions, in the notation used in a land register.",
    "kazna-i-pritvor":
      "Calendar calculation: when an entered sentence duration expires after the entered days of deprivation of liberty are deducted, and on what date an entered fraction of that duration falls.",
    "lamination-layers":
      "From a series of folds, gives the exact number of layers of filling and dough and the thickness of one layer at a final developed thickness.",
    "late-payment-interest":
      "Calculates interest on a late payment by the annual rate, basis and method you enter.",
    "lease-term-dates":
      "From the start date and duration, gives the expiry date, the last day for cancellation by the deadline you enter, and all instalment due dates.",
    "led-wall-pitch-viewing":
      "From the pixel pitch and the number of panels, gives the wall dimensions, total resolution, the distance from which pixels are no longer distinguishable, the number of processor ports and the supply current.",
    "lesson-count-period":
      "Counts how many sessions of a course fall in a given period, by the chosen weekdays and hand-entered non-working dates, and converts them into minutes and hours.",
    "lesson-timeline":
      "From the start time and durations of individual activities, makes a schedule down to the hour and minute and shows how much time remains or is overrun.",
    "levain-hydration":
      "Separates the flour and water already in a starter or pre-ferment and calculates how much flour and water still need adding for the whole dough to have the desired hydration.",
    "level-run":
      "From level readings and the benchmark elevation, calculates the elevations of all points, the arithmetic check and the misclosure of the run.",
    "limb-symmetry-index":
      "The ratio of values on two sides of the body in percentages, the difference up to one hundred percent, and what value the weaker side needs to reach for a ratio the user sets.",
    "linear-cutting-stock":
      "From a list of required pieces, the bar length and the cut width, gives how many bars are needed, which pieces go on which bar and what offcut remains.",
    "livestock-ration-dm":
      "Converts an entered intake of dry matter per head into fresh kilograms of each feed, the daily and total consumption of the herd and the stock needed for a given number of days.",
    "load-lashing-force":
      "From the load mass and the coefficients the user enters, calculates the securing force and the force the entered lashing arrangement provides.",
    "loading-space-utilisation":
      "Compares a shipment's volume, floor area and loading metres with the available space and gives the utilisation by each basis.",
    "loan-amortization":
      "Gives a monthly repayment plan for an annuity loan, the remaining debt at any month and the effect of an early repayment.",
    "loan-schedule":
      "Makes a repayment schedule by instalments — annuity or equal principal — splitting each instalment into interest and principal.",
    "machine-field-capacity":
      "From the working width, speed and time utilisation, gives hectares per hour, the time for the whole plot and fuel consumption per hectare.",
    "margin-markup":
      "Links purchase price, sale price, margin and markup, and calculates the largest discount down to a given margin.",
    "metric-thread-strength":
      "From the nominal diameter and pitch, calculates the pitch, core and minor diameters, the stress area and the force matching the strength the user enters.",
    "mired-shift":
      "Calculates the difference in mireds between two colour temperatures and the temperature obtained after a given mired correction.",
    "mitre-angles":
      "The cutting angle for an N-sided frame and, when the side is sloped, both saw settings — mitre and blade tilt.",
    "modular-type-scale":
      "A series of type sizes obtained by multiplying the base size by the chosen ratio, in pixels, rem units and points.",
    "mojibake-repair":
      "Returns corrupted characters like “Å¡” and “Ä‡” to the correct letters, choosing which encoding the text was written in and which it was read in.",
    "mortar-mix-quantity":
      "The quantity of finished mix or ingredients to mix from the area and layer thickness, with water, number of bags and wastage.",
    "motion-blur":
      "How many pixels the subject smears during the exposure, and which shutter keeps it within a given number of pixels.",
    "nd-filter-exposure":
      "Converts an ND filter's strength between stops, optical density and factor, and calculates the exposure time after the filter.",
    "nominalna-efektivna-stopa":
      "What a nominal annual rate with m compounds per year is worth as an effective annual rate, and back.",
    "note-frequency":
      "Converts note and octave, MIDI number and frequency into one another in equal temperament, and for an entered frequency gives the nearest note and the deviation in cents.",
    "number-check":
      "Compares all numbers in the source and in the translation and reports which is missing or mistyped.",
    "number-to-serbian-words":
      "Writes a number in Serbian words, with the correct form beside thousand, million and billion.",
    "nutrition-per-portion":
      "Converts an entered nutrition table between values per 100 g, per serving and per package, and converts kilojoules into kilocalories and back exactly.",
    "obracun-kamate":
      "What the interest is on a principal from day to day, by the conformal or proportional method, at the rates the user enters for each period.",
    "ohms-law-power":
      "From any two of the four quantities (U, I, R, P), calculates the remaining two.",
    "one-rep-max-table":
      "From one set (kilograms and repetitions), gives the estimated 1RM by the Epley and Brzycki formulas and a table of loads by percentage, rounded to the weight increment.",
    "orchard-trellis-layout":
      "For a planting of given dimensions, gives the number and length of rows, the number of posts and anchors, the length and mass of wire and the number of seedlings.",
    "ownership-shares":
      "Adds co-ownership shares as exact fractions and converts them into square metres, and square metres back into a share.",
    "pallet-load-plan":
      "For the given internal dimensions of a cargo space, calculates how many pallets fit on the floor in each layout and how many with stacking in height.",
    "pan-area-volume":
      "Area and volume of round, square, rectangular and fluted moulds and pots, conversion of the mix quantity when the mould changes, and the filling height for a given volume.",
    "panel-cutting-yield":
      "How many pieces of a given format come out of one sheet with the cut width and edge trimming, how many sheets are needed and how much waste there is.",
    "paper-weight":
      "How much one sheet, ream or the whole print run weighs at a given paper weight, and what the paper weight is from a measured bundle.",
    "parcel-polygon-area":
      "From a series of vertex coordinates, calculates the area and perimeter of a plot by the surveyor's formula.",
    "parking-cloakroom":
      "From the number of guests, the share arriving by car and vehicle occupancy, calculates the number of vehicles and the parking area, the length of cloakroom rails and the number of staff for a given reception window.",
    "payment-due-date":
      "From a date and a term you enter, gives the due date, the day of the week and the number of days' difference to a reference date.",
    "payment-reference-97":
      "Calculates the two-digit check number of a reference number by the MOD 97-10 procedure and compares it with the one already entered.",
    "pcm-file-size":
      "How much an uncompressed recording of a given length takes at a given sample rate, resolution and number of channels — and what the data rate is.",
    "pipe-flow-velocity":
      "Links the internal diameter, flow and velocity in a pipe, and calculates the Reynolds number and mass flow from the properties the user enters.",
    "plant-spacing-density":
      "From the row spacing and the spacing within the row, gives the number of plants per hectare and the actual number of seedlings on a plot with headlands, and back — the spacing required for an entered stand.",
    "plate-cost":
      "Adds the cost of a dish's ingredients with the wastage included per ingredient, and gives the cost price of a portion and the selling price for the food-cost percentage the user sets.",
    "plot-density-index":
      "From the plot area, calculates the building and coverage index, or the gross floor area and footprint at an index you enter.",
    "podela-iznosa":
      "Splits an amount among several people by given shares so the parts add up to exactly the whole, with no penny lost.",
    "polygon-area":
      "From a list of vertex coordinates, calculates the area, perimeter, centroid and direction of traversal of the plot.",
    "portions-from-pack":
      "How many portions come out of a package and how many packages are needed for a given number of portions, with the remainder, portion cost and price per kilogram or litre.",
    "power-factor-correction":
      "Calculates the reactive power and capacitance needed to raise the power factor from the present one to the target, and the current before and after.",
    "pq-nits":
      "Converts a PQ signal into luminance in nits and back, by the curve from ST 2084, with 10-bit and 12-bit code in full and narrow range.",
    "pressure-and-piston-force":
      "Converts bar, Pa, psi, kgf/cm², mmHg and metres of water column, distinguishes gauge from absolute pressure and calculates the force on the piston and on the rod side.",
    "print-resolution":
      "How many millimetres an image of N pixels is at a given resolution, what the real resolution is at a desired width and what the uncompressed size is.",
    "pro-rata-days":
      "Splits an amount for a period between two users by the number of days, so the two parts add up to exactly the whole.",
    "projector-throw-screen":
      "From the throw ratio and the distance, gives the image width, height and diagonal, the screen illuminance and the contrast at the ambient light the user enters.",
    "racun-iban-provera":
      "Whether the check number of a typed account matches by modulus 97, what its IBAN is and what the check number is for an entered string of digits.",
    "radni-dani":
      "How many calendar, working and non-working days there are between two dates, by the list of non-working days the user enters.",
    "raster-image-size":
      "The uncompressed size of an image from its dimensions, number of channels and bit depth, and how many such files fit in a given space.",
    "rate-conversion":
      "Converts an interest rate between nominal annual with m compounds, effective annual and periodic, and shows the difference between the proportional and conformal periodic rate.",
    "ratio-split":
      "Splits a total quantity by a given ratio (2:1:1, 3:2:1 …) and rounds the parts so their sum stays exactly the whole.",
    "reading-time":
      "Calculates how long reading a text aloud takes at the pace you enter, paragraph by paragraph, with the entry time of each paragraph.",
    "rebar-weight":
      "Converts diameter, length and number of bars into kilograms, and kilograms back into metres and whole bars.",
    "rebate-chain":
      "Combines a series of successive discounts into one effective discount and gives the net price after all of them.",
    "recipe-scale":
      "Converts a whole list of ingredients to another number of portions, to a given factor or to a target total mass, reading fractions and rounding to a given increment.",
    "reefer-fuel-consumption":
      "From the generator's running hours and consumption by mode, gives the fuel used, the cost and the running hours covered by the fuel in the tank.",
    "rent-escalation":
      "Applies the index you enter to the rent from period to period and gives the amount per period, the total and the present value of the lease.",
    "rent-gross-net":
      "Converts a contract amount into the amount that remains and back, by the percentage of recognised costs and the rate you enter.",
    "rental-yield":
      "From the price, rent and costs you enter, gives the net income, gross and net yield and the payback period; or the value from a given rate.",
    "resistor-colour-code":
      "Reads a resistor's value from its bands and returns the bands for a given value, with tolerance, range and the nearest value from the E series.",
    "reverb-time":
      "Calculates RT60 by the Sabine and Eyring formulas from the room volume and surface areas with the entered absorption coefficients.",
    "rigging-sling-angle-force":
      "For a load mass, number of legs and sling angle, calculates the force per leg, the horizontal component and the angle factor, including an asymmetric two-point pick.",
    "rlc-impedance":
      "For R, L and C at a given frequency, calculates the reactances, impedance and phase angle, then the resonant and cutoff frequencies.",
    "rok-poslednji-dan":
      "Calculates the last day of a deadline from an entered start date and length, with the rule for moving off a non-working day chosen by the user.",
    "roll-yield":
      "How many running metres of roll go into a given print run, how many pieces fit across the width and whether it pays to turn the piece by 90°.",
    "roof-pitch":
      "From the pitch and the base, gives the height to the ridge, the rafter length, the actual roof-plane area and the hip length.",
    "room-modes":
      "From the room dimensions, calculates the axial, tangential and oblique room modes by the Rayleigh equation and shows where they cluster.",
    "room-quad-area":
      "From four measured sides and one diagonal, gives the room area and the corner angle, because a room is rarely a rectangle.",
    "room-surfaces":
      "From the room measurements and the list of openings, gives the net wall area, the ceiling, the reveals and the quantity of material needed.",
    "run-of-show":
      "From the durations of cues, the transitions between them and cues pinned to an exact hour, makes a running order forwards and backwards and shows gaps and overruns.",
    "running-pace-splits":
      "From any two of distance, time and pace, gives the third, with pace per kilometre, mile and hundred metres and a table of even splits.",
    "saddle-stitch-imposition":
      "Which two sides go on which side of the sheet in a saddle-stitched booklet, how many sheets are needed and how many blank pages remain.",
    "sample-buffer-latency":
      "Converts samples, milliseconds and buffer size at a given sample rate and gives the latency in one and in both directions.",
    "scale-chord-speller":
      "For a given root note, writes the notes of a scale or chord in letter order, with intervals, number of accidentals and triads on the degrees.",
    "seating-tables":
      "From the number of guests and the table size, calculates how many guests fit at a table, how many tables are needed and how much area they take with chairs and an aisle.",
    "section-modulus":
      "For a rectangle, circle, pipe, rectangular tube and I-section, calculates the area, moments of inertia, section moduli, radii of gyration and polar quantities.",
    "seeding-rate":
      "How many kilograms of seed per hectare a given plant stand yields at a measured thousand-grain mass, germination and purity, and how much seed is needed for the whole plot.",
    "sentence-length":
      "Splits a text into sentences by the written rule and shows which are longer than a given number of words.",
    "serbian-transliteration":
      "Converts a Serbian text from Cyrillic to Latin and back, with a list of every place where nj, lj or dž is ambiguous.",
    "series-parallel-network":
      "Adds resistors, inductors and capacitors in series and parallel, and calculates a voltage divider with the power per element.",
    "service-interval-km-hours":
      "Compares an interval by kilometres, engine hours and months and gives which of them expires first and on what date.",
    "set-tempo-tut":
      "From a tempo written as four numbers (e.g. 3-1-1-0) and the number of repetitions, gives the time under load per set and the total duration of the block with rests.",
    "share-allocation":
      "Splits an amount by shares so the parts add up to exactly the whole, down to the last penny.",
    "sheet-imposition":
      "How many pieces of a given size fit on a sheet with margins and cut spacing, in both orientations, and how much waste there is.",
    "sheet-metal-bend":
      "The developed length and bend-line positions from external dimensions, radius and K-factor, with the reverse calculation of the K-factor from a measured sample.",
    "shelf-deflection":
      "Deflection and stress in a shelf on two supports at an entered load, modulus of elasticity and section, with a limit the user enters.",
    "shelf-spacing":
      "Equal clear openings between shelves with the thickness included, the shelf positions and the nearest openings in a drilling grid.",
    "simple-interest-days":
      "Simple interest on an amount between two dates, at the rate and day-count basis you enter.",
    "slope-grade":
      "From any two of length, height difference or slope, gives the others, and the slope in percent, permille, degrees and 1:n ratio.",
    "smpte-timecode":
      "Adds and subtracts timecode and converts it into frames and elapsed time, including drop-frame notation.",
    "solution-concentration":
      "One mass balance for four questions: mixing two mixtures to a target concentration, dilution, evaporation and adding a pure ingredient, all in percentages by mass.",
    "sound-wavelength":
      "For a given frequency and air temperature, gives the speed of sound, the wavelength and its quarter, and the delay per distance travelled.",
    "speaker-load":
      "For speakers wired in parallel or series, gives the total impedance and how much power each cabinet receives.",
    "speedometer-tyre-deviation":
      "When the tyre size changes, calculates the true speed, the odometer error and the change in vehicle height.",
    "spl-distance":
      "What the sound pressure level is at a given distance for the entered cabinet sensitivity and power, and how much is lost by doubling the distance.",
    "split-into-groups":
      "Splits a class into groups — into a given number of groups or into groups of a given size — so the sizes are as even as possible and the total matches the number of pupils.",
    "split-times-fatigue":
      "From a list of measured times, gives the sum, mean, median, best and worst, the fatigue index and the percentage drop across repeated sprints.",
    "sprayer-calibration":
      "From the measured nozzle flow, travel speed and nozzle spacing, gives the spray rate in litres per hectare, and back — what nozzle flow the rate the user enters requires.",
    "square-check":
      "From two sides and a measured diagonal, gives the deviation of the angle from a right angle and the point displacement in millimetres.",
    "stage-deck-layout":
      "From the stage dimensions and the deck module, calculates the number of decks in both orientations, the area, the perimeter with a skirt and the even load per m².",
    "stair-geometry":
      "From the storey height and the number of steps, gives the step height, the number of treads, the total going, the pitch and the value 2r + g.",
    "standard-score":
      "Converts a raw score into a z-score and T-score using the mean and standard deviation the user enters, and returns the raw score for a given z-score.",
    "strane-teksta":
      "How many billable pages a text carries at an entered number of characters per page, and what the amount is at an entered rate.",
    "subtitle-audit":
      "Measures each subtitle and shows the measured value beside the limit you enter: line length, number of lines, duration, characters per second and the gap to the next.",
    "subtitle-retime":
      "Shifts all timestamps in an SRT or VTT subtitle and converts them for a different frame rate.",
    "survey-bearing-distance":
      "From two points, gives the length and bearing, and from a point, angle and length, gives the coordinates of the new point.",
    "suvlasnicki-udeli":
      "Whether the entered ideal parts make exactly a whole, what they are on a common denominator and how many squares each carries.",
    "sweat-rate-hydration":
      "From the mass before and after training, the fluid drunk and the duration, calculates sweat loss, the sweat rate per hour and the percentage of body mass lost.",
    "tank-mix-dose":
      "Converts an entered product dose per hectare into one tank fill and gives the total amounts of product and water for an entered area.",
    "tank-volume-by-level":
      "From a measured level in a horizontal or vertical tank, gives the volume, mass and fill level.",
    "tap-drill-size":
      "The drill diameter for tapping a thread at a given percentage of thread engagement, the engagement percentage for a drill you have, and the clearance hole diameter.",
    "tax-id-check":
      "Calculates the check digit by the MOD 11,10 procedure and compares it with the last digit of the entered number.",
    "tent-bay-layout":
      "From the required covered area and the tent module, calculates the number of bays, the length, the overall size with guy lines and the roof and side area.",
    "test-printing":
      "For a test's page count and number of copies, calculates how many sheets of paper are needed, how many backs stay blank, how many packs are opened and the amount at the per-sheet price the user enters.",
    "three-phase-load-balance":
      "From a list of loads distributed across phases, calculates the current of each phase, the neutral current, the imbalance and the total apparent power.",
    "three-phase-power":
      "Links line current, apparent, active and reactive power through the power factor, in a single-phase and three-phase network.",
    "tiered-commission":
      "Calculates commission by the scale you enter — marginal by tranche or a single rate on the whole amount.",
    "tile-count":
      "From the area and the piece format, with the joint and the layout, gives the number of pieces, the number of boxes and pieces per square.",
    "timber-volume":
      "Log volume by Huber or Smalian, the volume of sawn timber per piece and in total, conversion of stacked volume into cubic metres and mass by the entered density.",
    "timelapse-planner":
      "Links the interval, frame count, recording duration and finished clip length, with the speed factor.",
    "topic-hour-allocation":
      "Distributes a total fund of lessons across teaching topics by given shares, as whole numbers that add up to the given fund.",
    "torque-speed-power":
      "Links torque, power and speed and shows them in N·m, kgf·m, lbf·ft, W, kW, metric hp and hp.",
    "training-volume-load":
      "From programme rows (sets × repetitions × kilograms), adds up repetitions and tonnage and gives the average load per repetition, and with an entered 1RM the average intensity in percentages.",
    "translation-volume":
      "Counts characters, words and translator's pages in pasted text and multiplies them by the price you enter.",
    "transposition":
      "Transposes written notes or chord symbols by a given interval, or between the tuning of transposing instruments and concert pitch.",
    "trench-volume":
      "From the depth, bottom width and entered side slope, gives the volume of excavation, backfill and surplus soil for removal.",
    "trial-balance-check":
      "Adds the debit and credit side, shows the difference and lists the errors that would arithmetically give exactly that difference.",
    "trip-cost-quote":
      "Adds mileage, tolls, per diems and waiting into the cost price of a trip and, from the margin, gives the transport price.",
    "troskovi-srazmerno-uspehu":
      "What the ratio of the awarded and requested amount is, and what proportional share of its costs each party bears by that ratio.",
    "truss-hoist-reactions":
      "For a line hung from two points, calculates the force at each point from its own weight and individual loads, the centre of gravity and the possible lift of one end.",
    "tvm-solver":
      "From four known quantities — present value, future value, payment, number of periods, periodic rate — calculates the fifth.",
    "typography-cleanup":
      "Fixes quotes, dashes, ellipses and spaces in pasted text and counts each change by rule.",
    "ugovorna-kazna":
      "What the penalty is for days of delay at the entered daily rate, and on which day of delay an entered cap is reached.",
    "unwrap-paragraphs":
      "Joins lines broken by copying from a PDF back into paragraphs and reassembles words split by a hyphen at the end of a line.",
    "us-customary-kitchen-units":
      "Converts cups, ounces, pounds, pints and degrees Fahrenheit from foreign recipes into millilitres, grams and degrees Celsius, and refuses to convert volume into mass without a density.",
    "varispeed-repitch":
      "When a sample's pitch changes or a recording played at one frequency is played back at another — gives the speed ratio, the resulting tempo, the resulting duration and the shift in cents.",
    "venue-occupancy-area":
      "From the gross area and the deducted zones, calculates the net area and the number of people for the density the user enters, for each layout separately.",
    "video-bitrate-storage":
      "Links bitrate, duration and file size and calculates how much recording fits on a card or disk of a given capacity.",
    "voltage-drop":
      "For a given cross-section, length and current, calculates the line resistance, the voltage drop in volts and percent and the power loss.",
    "wall-ceiling-area":
      "Calculates the net area of walls and ceiling with openings deducted and the quantity of material by the coverage you enter.",
    "wall-u-value":
      "Adds the resistances of the layers of a wall or roof into a total R and U and gives the temperature at each layer interface.",
    "wallpaper-rolls":
      "From the wall perimeter, height and repeat, gives the number of strips, the length of one strip, how many strips come out of a roll and how many rolls are needed.",
    "weight-class-cut":
      "How many kilograms and what percentage of body mass separate a competitor from an entered weight-category limit, and what that is on average per day and per week until weigh-in.",
    "weighted-area":
      "Adds the areas of a flat's parts multiplied by the coefficients you enter and gives the chargeable area and price.",
    "weighted-grade":
      "Adds assessment components with different maxima and different weights into one total percentage and calculates how many points are missing on the remaining component for a desired overall result.",
    "weld-consumable":
      "The mass of weld metal and of the filler needed from the weld cross-section and length, with the length of wire or number of electrodes.",
    "wood-moisture-movement":
      "How much a piece of wood changes dimension when moisture changes, and what clearance remains for the expected moisture range in the room.",
    "word-frequency":
      "Counts how many times each word or n-word phrase repeats in a text and what its share is.",
    "yield-estimate-samples":
      "From sample counts — ears per square, grains per ear and thousand-grain mass, or the mass of a harvested sample — gives an estimated yield per hectare and the variation between samples.",
    "yield-trim-cook":
      "From the gross purchase, through cleaning loss and thermal-processing loss, gives the number of portions and the portion price, and back — how much gross to buy for a given number of portions.",
    "zbir-perioda":
      "How many total days a series of periods gives, how that sum breaks down into years, months and days, and where the periods overlap.",
  },

  /**
   * Where a `published`-tier constant came from — source AND edition, rendered
   * under the answer by the host (`ToolRegistration.sourceKey`).
   *
   * **This is provenance and never a compliance claim.** „Dimenzije listova
   * prema ISO 216:2007" says which table produced the numbers; „u skladu sa ISO
   * 216" would be a warranty that this app is in no position to give. The
   * difference is one word and it is the whole point of the field.
   *
   * An edition or a year is mandatory — `modules.test.ts` fails a source line
   * with no digit in it, because „ISO 216" alone names a family of standards
   * rather than a citation somebody can go and check.
   */
  sources: {
    // „AWG 36" i „4/0", a ne „#36" i „#0000" — ista dva broja u notaciji koju
    // koristi i sama alatka (v. `pro.inzenjering.ts`, „awg-to-mm2").
    "astm-b258-18-iec-60028-1925-iec-60889-1987":
      "Definition of the AWG series (AWG 36 = 0.005 in, 4/0 = 0.4600 in, 39 geometric steps) by ASTM B258-18; resistivities by IEC 60028:1925 (copper) and IEC 60889:1987 (aluminium).",
    "austrian-metrication-1871":
      "Austro-Hungarian metrication (Austria: act of 1871, in force from 1876): 1 Viennese fathom = 1.896484 m, 1 cadastral acre = 1600 square fathoms = 5754.6425 m².",
    "cabinet-hole-raster-system-32":
      "The 32 mm grid is the System 32 convention for cabinet furniture (hole spacing on the side panel). The distance of the first hole from the bottom edge is not part of that convention — it differs by jig and hardware, so the user enters it.",
    "cie-colour-difference":
      "CIE 142-2001 / ISO/CIE 11664-6:2014 (CIEDE2000), CIE 116-1995 (ΔE94), CIE 15 (CIELAB), IEC 61966-2-1:1999 (sRGB)",
    "concept2-pace-watts":
      "Concept2 — the published relation between pace and power for the performance monitor: watts = 2.80/(seconds per metre)³, with the 500 m split as the display unit.",
    "css-units-and-android-dp":
      "CSS Values and Units Module Level 3 (W3C) for px, pt, pc and Q; Android documentation for dp (baseline density 160 dpi)",
    "fuel-fluid-densities":
      "Densities: EN 590:2022 (diesel 820.0 to 845.0 kg/m³ at 15 °C) and ISO 22241-1:2019 (AUS 32 / AdBlue 1.087 to 1.093 kg/l at 20 °C).",
    "iec-60028-1925-iec-60889-1987":
      "Resistivities and temperature coefficients: IEC 60028:1925 (copper, 1/58 Ω·mm²/m at 20 °C) and IEC 60889:1987 (hard-drawn aluminium, 28.264 nΩ·m at 20 °C).",
    "iec-60062-2016-iec-60063-2015":
      "Colour coding by IEC 60062:2016 (with amendment A1:2019); preferred-value series E6, E12 and E24 by IEC 60063:2015.",
    "iec-60228-60287-conductor-constants":
      "IEC 60228, edition 3 (2004) — conventional conductor resistivities (copper 1/58, aluminium 1/35.38 Ω·mm²/m); IEC 60287-1-1, edition 2.1 (2014) — resistivities at 20 °C and temperature coefficients α₂₀ (copper 3.93·10⁻³, aluminium 4.03·10⁻³ 1/K)",
    "international-foot-1959":
      "International yard and pound agreement (1959) — 1 ft = 0.3048 m exactly, whence 1 fc = 10.763910416709722 lx.",
    "isbn-issn-ismn-ean-check-digits":
      "ISO 2108:2017 (ISBN), ISO 3297:2022 (ISSN), ISO 10957:2009 (ISMN) and the GS1 General Specifications — the check-digit algorithm.",
    "isda-2006-30e-360":
      "The 30E/360 basis is a named day-count convention (Eurobond basis) from the ISDA 2006 Definitions, section 4.16; you choose it explicitly, the tool does not choose it for you.",
    "isda-2006-day-count":
      "Day-count conventions: 2006 ISDA Definitions, section 4.16 (ACT/365 Fixed, ACT/360, 30E/360 Eurobond Basis).",
    "isda-2006-daycount":
      "The 360-day banking year: ISDA 2006 Definitions, section 4.16; the 365-day calendar year is the default.",
    "iso-1007-135-format":
      "ISO 1007:2000 — the 135 format, image 36 × 24 mm (reference frame).",
    "iso-13616-1-2020":
      "ISO 13616-1:2020 — Financial services, IBAN, Part 1: Structure of the IBAN; check digits by ISO/IEC 7064:2003 MOD 97-10.",
    "iso-13616-iban":
      "IBAN: ISO 13616-1:2020. Check digits: ISO 7064:2003 (MOD 97-10). Domestic account 3-13-2: the unique 18-digit account form in dinar payment transactions (NBS, in force since 2003).",
    "iso-16-1975":
      "Reference tone A4 = 440 Hz: ISO 16:1975 (Acoustics — Standard tuning frequency). Note numbering: MIDI 1.0 Detailed Specification, version 4.2 (MMA, 1996).",
    "iso-216-iso-5455":
      "Sheet formats: ISO 216:2007, A series. Scale series: ISO 5455:1979.",
    "iso-216-paper-series":
      "ISO 216:2007 (A and B series) and ISO 269:1985 (C series, envelopes)",
    "iso-286-1-2010":
      "Tolerances and fundamental deviations: ISO 286-1:2010 (range 1–500 mm).",
    "iso-68-1-1998-iso-898-1-2013":
      "Thread profile geometry by ISO 68-1:1998; definition of the stress area A_s by ISO 898-1:2013.",
    "iso-7064-13616":
      "ISO 7064:2003 (MOD 97-10) and ISO 13616-1:2020 (IBAN structure); the 3+13+2 domestic account structure is the payment-transaction format. The tool uses the arithmetic of those standards and does not claim compliance with them.",
    "iso-7064-jmbg":
      "Check digit of the PIB and company number: ISO 7064:2003, MOD 11,10. Check digit of the JMBG: the number structure laid down by the Act on the Unique Citizen Identification Number (“Official Gazette of the RS” no. 24/2011); the weights 7,6,5,4,3,2 and modulus 11 have been part of that structure since the number was introduced in 1976.",
    "iso-8601-2019-weekday":
      "Numbering of days of the week: ISO 8601-1:2019 (1 = Monday … 7 = Sunday).",
    "iso-9-1995-serbian":
      "ISO 9:1995 (transliteration of Cyrillic into Latin), Serbian rows — 30 letter pairs.",
    "iso-iec-15420-ean-upc":
      "ISO/IEC 15420:2009 — EAN/UPC symbology: number of modules, nominal X-dimension and heights; check digit by the same algorithm as in the GS1 General Specifications",
    "iso-iec-7064-2003":
      "ISO/IEC 7064:2003 — Information technology, Security techniques, Check character systems; the MOD 97-10 procedure.",
    "iso-metric-thread-261-273-68":
      "Thread pitches: ISO 261:1998. Profile and core diameter: ISO 68-1:1998. Clearance holes: ISO 273:1979 (fine, medium and coarse series). The percentage of engagement is a workshop convention chosen by the user and appears in none of those three standards.",
    "jmbg-check-digit":
      "JMBG structure (13 digits, weights 7,6,5,4,3,2 repeated twice, modulus 11) — the Act on the Unique Citizen Identification Number (SFRY); the structure has not changed since the register was introduced. The tool uses only that arithmetic and does not claim compliance with the regulation.",
    "mccall-t-score-1922":
      "T-scale (mean 50, standard deviation 10) after: W. A. McCall, How to Measure in Education, 1922.",
    "ntsc-1000-1001-rates":
      "SMPTE ST 170M-2004 and SMPTE ST 12-1:2014 — the 1000/1001 ratio and the exact fractions 24000/1001, 30000/1001, 60000/1001.",
    "one-rep-max-formulas":
      "Epley: Boyd Epley, “Poundage Chart”, Body Enterprises, Lincoln, 1985. Brzycki: Matt Brzycki, JOPERD 64(1), 1993. The numbers 30 and 36/37 belong to the published formulas themselves.",
    "pallet-footprints":
      "Pallet dimensions: EN 13698-1:2003 (EUR pallet 800 × 1200 mm) and ISO 6780:2003 (industrial pallet 1000 × 1200 mm).",
    "riff-wave-1991":
      "The 44-byte WAV header: Multimedia Programming Interface and Data Specifications 1.0 (IBM/Microsoft, August 1991), the PCM case with a 16-byte fmt block. MB/MiB/GB/GiB prefixes: IEC 80000-13:2008.",
    "serbian-numerals":
      "Serbian numbers and noun agreement with the number — Pravopis srpskoga jezika, Matica srpska, revised and expanded edition (2010).",
    "serbian-numerals-orthography":
      "Pravopis srpskoga jezika, Matica srpska (revised and expanded edition, 2010) — writing numbers and agreement with thousand, million and billion.",
    "smpte-broadcast-frame-rates":
      "SMPTE ST 12-1:2014 and SMPTE ST 170M-2004 — nominal frame rates (24000/1001, 30000/1001, 60000/1001 as exact fractions).",
    "smpte-st-12-1-2014":
      "SMPTE ST 12-1:2014 — exact rates 24000/1001, 30000/1001 and 60000/1001 as integer ratios.",
    "smpte-st-12-1-timecode":
      "SMPTE ST 12-1:2014 — timecode and drop-frame notation; SMPTE ST 170M-2004 for the exact fractions 30000/1001 and 60000/1001.",
    "smpte-st-2084-pq":
      "SMPTE ST 2084:2014 and ITU-R BT.2100-2 (2018) — the PQ transfer function and signal quantisation.",
    "sr-numerals-pravopis-2010":
      "Number words and agreement by gender and number: Pravopis srpskoga jezika, Matica srpska, revised and expanded edition (2010).",
    "steel-nominal-density":
      "Conventional density 7.85 kg/dm³ for the nominal mass of rebar by EN 10080:2005 and ISO 6935-2:2019.",
    "unicode-16-code-charts":
      "Unicode Standard 16.0 (2024) — Code Charts and Unicode Character Encoding Stability Policies; an assigned code point does not change in any later edition.",
    "unicode-white-space":
      "Unicode Standard 17.0 — PropList.txt, the White_Space property; in practice the version of the Unicode table carried by the application's runtime applies.",
    "us-imperial-unit-definitions":
      "The values are exact by definition: the International yard and pound agreement (1959) for the pound and inch, and the Weights and Measures Act 1985 (United Kingdom) for the imperial gallon.",
    "usda-wood-handbook-2021":
      "Fibre saturation point (nominally 30%): USDA Wood Handbook, FPL-GTR-282 (2021), ch. 4. The shrinkage coefficient for species and direction is entered by the user.",
    "whatwg-encoding-standard":
      "WHATWG Encoding Standard (Living Standard) — the index tables windows-1250, windows-1252 and iso-8859-2; UTF-8 by RFC 3629. The platform reads the tables; they are not copied into the code.",
  },

  /* One group per TOOLKIT — see the header. */
  gradnja: PRO_GRADNJA_EN,
  inzenjering: PRO_INZENJERING_EN,
  dizajn: PRO_DIZAJN_EN,
  foto: PRO_FOTO_EN,
  muzika: PRO_MUZIKA_EN,
  prosveta: PRO_PROSVETA_EN,
  tekst: PRO_TEKST_EN,
  trening: PRO_TRENING_EN,
  kuhinja: PRO_KUHINJA_EN,
  pravo: PRO_PRAVO_EN,
  racunovodstvo: PRO_RACUNOVODSTVO_EN,
  biznis: PRO_BIZNIS_EN,
  nekretnine: PRO_NEKRETNINE_EN,
  transport: PRO_TRANSPORT_EN,
  agro: PRO_AGRO_EN,
  zanat: PRO_ZANAT_EN,
  event: PRO_EVENT_EN,
} as const;
