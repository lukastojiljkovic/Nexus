/**
 * „Stručne alatke" — the professional drawer's own copy: its chrome, the words
 * every one of its surfaces shares, and the name of each toolkit.
 *
 * **Why this is a group of its own and not part of `devtools`.** It used to be:
 * the drawer was „Programerske alatke", its chrome and its shared surface words
 * sat in `strings/devtools.ts` beside the forty-eight tool names, and that was
 * right for as long as the drawer and the toolkit were the same thing. They are
 * not any more — `devtools` is now the copy of ONE pack (`softver`), and this is
 * the copy of the drawer that hosts it and seventeen others. A pack's tool names
 * stay with the pack; the search field, the empty state and „Kopirano" belong to
 * the room they are all standing in.
 *
 * That split is also why `titleKey: "devtools.name.riscv"` did not have to move.
 * A tool names a string in its own family's group (`ToolRegistration`), and the
 * RISC-V decoder's family did not change when its neighbours arrived.
 *
 * Nothing here is a second copy layer. This is one leaf of the same table —
 * `strings.sr.ts` spreads it in as `pro`, `strings.ts` clones the whole thing,
 * and the locale switch rewrites these leaves exactly as it rewrites the rest. A
 * consumer reads `strings.pro.…` and never imports this file.
 */

import { PRO_GRADNJA_SR } from "./pro.gradnja.js";
import { PRO_INZENJERING_SR } from "./pro.inzenjering.js";
import { PRO_DIZAJN_SR } from "./pro.dizajn.js";
import { PRO_FOTO_SR } from "./pro.foto.js";
import { PRO_MUZIKA_SR } from "./pro.muzika.js";
import { PRO_PROSVETA_SR } from "./pro.prosveta.js";
import { PRO_TEKST_SR } from "./pro.tekst.js";
import { PRO_TRENING_SR } from "./pro.trening.js";
import { PRO_KUHINJA_SR } from "./pro.kuhinja.js";
import { PRO_PRAVO_SR } from "./pro.pravo.js";
import { PRO_RACUNOVODSTVO_SR } from "./pro.racunovodstvo.js";
import { PRO_BIZNIS_SR } from "./pro.biznis.js";
import { PRO_NEKRETNINE_SR } from "./pro.nekretnine.js";
import { PRO_TRANSPORT_SR } from "./pro.transport.js";
import { PRO_AGRO_SR } from "./pro.agro.js";
import { PRO_ZANAT_SR } from "./pro.zanat.js";
import { PRO_EVENT_SR } from "./pro.event.js";

export const proSr = {
  title: "Stručne alatke",
  searchLabel: "Pretraži stručne alatke",
  searchPlaceholder: "Pretraži po imenu ili pojmu…",
  noMatches: "Nijedna alatka ne odgovara pretrazi.",
  clearSearch: "Poništi pretragu",

  /**
   * The line under the drawer's name: how much is standing behind it.
   *
   * Composed from the registry and never written down — a hand-typed count is a
   * number that goes stale the first time a tool is added, and this one also
   * moves with the profile's own toolkits.
   */
  subtitle: "{count} {unit}",
  /** Numeral agreement for the count above — three forms, through `countUnit`. */
  unitTool: { one: "alatka", few: "alatke", many: "alatki" },

  /**
   * „Nedavno": the tools this device opened last, above the directory.
   *
   * Drawn only when there is something to draw. An empty „Nedavno" heading is a
   * promise the drawer has not kept yet, and on a fresh install it would be the
   * first thing anyone sees.
   */
  recentTitle: "Nedavno",
  /**
   * The directory that fills the surface before a tool is chosen — and the
   * reason that surface stopped being empty.
   *
   * With two hundred and seventy-four tools behind one rail, „izaberi alatku sa
   * liste" is the hardest sentence in the drawer. The professional drawer
   * indexes itself by TOOLKIT rather than by subject, because the toolkits are
   * what this person chose and the rail already groups by subject — the two
   * views answer different questions instead of repeating one.
   */
  directoryTitle: "Tvoji paketi",

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
  noPacksTitle: "Nijedan paket nije uključen",
  noPacks:
    "Alatke u ovom fioci dolaze u paketima po struci. Izaberi bar jedan da vidiš šta nosi.",
  choosePacks: "Izaberi pakete",

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
    copy: "Kopiraj",
    /** Replaces „Kopiraj" for a moment after a copy. Past tense: it has happened. */
    copied: "Kopirano",
    result: "Rezultat",
    input: "Ulaz",
    output: "Izlaz",
    /** Before anything has been typed — the output box says this instead of standing empty. */
    awaitingInput: "Upiši nešto gore.",
    /** The one refusal every surface can need: the text is not what this tool reads. */
    invalid: "Ovo nije oblik koji ova alatka čita.",
    bytes: "Bajtova",
    characters: "Znakova",
    lines: "Redova",
    /** Under a table that stopped early — a table that stops silently misreports its input. */
    tableCapped: "U tabeli je prvih {shown} od {total} redova.",
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
      name: "Gradnja i projektovanje",
      who: "arhitekte, građevinski inženjeri, geodeti, izvođači",
    },
    inzenjering: {
      name: "Struja i mašine",
      who: "elektroinženjeri, mašinci, elektroinstalateri, serviseri",
    },
    softver: {
      name: "Kod i softver",
      who: "programeri, administratori sistema, testeri",
    },
    dizajn: {
      name: "Dizajn i grafika",
      who: "grafički i UI dizajneri, ilustratori, štampari",
    },
    foto: {
      name: "Fotografija i snimanje",
      who: "fotografi, snimatelji, montažeri",
    },
    muzika: {
      name: "Muzika i produkcija",
      who: "muzičari, producenti, tonci",
    },
    prosveta: {
      name: "Nastava i ocenjivanje",
      who: "profesori, nastavnici, vaspitači, predavači",
    },
    tekst: {
      name: "Tekst i prevođenje",
      who: "prevodioci, lektori, novinari, pisci",
    },
    // No „Medicina i nega" pack, and its absence is deliberate — see
    // `TOOL_PACKS`. These two lines are what a `who` line costs when it names
    // a regulated profession: „fizioterapeuti" and „nutricionisti" both stood
    // here, and both are health professions whose presence in an audience line
    // is a clinical intended-purpose claim about everything in the pack. The
    // trades that remain are the ones the tools are honestly for.
    trening: {
      name: "Trening i forma",
      who: "treneri, takmičari, rekreativci",
    },
    kuhinja: {
      name: "Kuhinja i porcije",
      who: "ugostitelji, kuvari, poslastičari",
    },
    pravo: {
      name: "Pravo i rokovi",
      who: "advokati, pravnici, izvršitelji, notari",
    },
    racunovodstvo: {
      name: "Računovodstvo i obračuni",
      who: "računovođe, knjigovođe, revizori",
    },
    biznis: {
      name: "Svoj posao i klijenti",
      who: "preduzetnici, frilenseri, agencije, mali biznis",
    },
    nekretnine: {
      name: "Nekretnine",
      who: "agenti, procenitelji, investitori, izdavaoci",
    },
    transport: {
      name: "Vožnja i transport",
      who: "vozači, špediteri, dostavljači, taksisti",
    },
    agro: {
      name: "Poljoprivreda",
      who: "ratari, voćari, povrtari, stočari",
    },
    zanat: {
      name: "Zanat i radionica",
      who: "krojači, stolari, bravari, tapetari, obućari",
    },
    event: {
      name: "Događaji i organizacija",
      who: "organizatori događaja, venčanja, konferencija",
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
    detail: "Detaljnije",
    "life-safety": {
      label: "Bezbednost",
      line:
        "Račun iz vrednosti koje si uneo. Ne zamenjuje proračun, proveru ni odgovornost " +
        "ovlašćenog inženjera.",
      note:
        "Alatke u ovoj grupi računaju veličinu iz podataka koje sam uneseš. One ne biraju " +
        "propis, ne određuju granicu i ne ocenjuju da li nešto zadovoljava — to je posao " +
        "ovlašćenog projektanta ili izvođača, koji za tu odluku i odgovara. Granice koje uneseš " +
        "prikazuju se uz rezultat da bi se videlo iz čega je dobijen.",
      export: "Nexus — informativan račun. Ne zamenjuje proračun ovlašćenog inženjera.",
    },
    wellness: {
      label: "Telo i forma",
      line: "Informativan račun. Nije medicinski ni trenažni savet.",
      note:
        "Alatke u ovoj grupi računaju brojeve o sopstvenom telu — masu, odnose, opterećenje na " +
        "treningu — iz vrednosti koje sam uneseš. One ne postavljaju dijagnozu, ne određuju " +
        "terapiju i ne zamenjuju lekara. Za zdravstvena pitanja obrati se lekaru.",
      export: "Nexus — informativan račun. Nije medicinski savet.",
    },
    "legal-procedure": {
      label: "Rokovi",
      line:
        "Računa datume po pravilu koje si izabrao. Izbor pravila i provera roka su pravno " +
        "pitanje.",
      note:
        "Alatke u ovoj grupi sabiraju i oduzimaju datume po pravilu računanja koje sam izabereš " +
        "— da li se prvi dan računa, kako se pomera rok koji pada u neradni dan. Taj izbor je " +
        "pravno pitanje i ostaje tvoj; alatka ga samo primeni i ispiše uz rezultat. Ovo nije " +
        "pravni savet.",
      export: "Nexus — informativan račun datuma. Nije pravni savet.",
    },
    financial: {
      label: "Novac",
      line:
        "Informativan račun iz stopa i iznosa koje si uneo. Nije poreski ni računovodstveni " +
        "savet.",
      note:
        "Alatke u ovoj grupi računaju iz stopa i iznosa koje sam uneseš. Nijedna stopa nije " +
        "ugrađena u program — koja stopa važi danas i za tvoj slučaj je pitanje propisa i tvoja " +
        "odluka, pa se uneta stopa ispisuje uz rezultat. Ovo nije poreski, računovodstveni ni " +
        "finansijski savet.",
      export: "Nexus — informativan račun. Nije poreski ni računovodstveni savet.",
    },
    "food-safety": {
      label: "Bezbednost hrane",
      line: "Račun iz vrednosti koje si uneo. Bezbednost hrane određuju tvoj HACCP plan i propisi.",
      note:
        "Alatke u ovoj grupi računaju količine i vremena iz vrednosti koje sam uneseš. One ne " +
        "određuju bezbednu temperaturu, vreme ni postupak — to određuju tvoj HACCP plan i " +
        "propisi, i ta ocena ostaje tvoja.",
      export: "Nexus — informativan račun. Ne određuje bezbednost hrane.",
    },
  },

  /** The „Podešavanja" card that holds every long-form notice, and the one line above them. */
  riskSection: {
    description:
      "Neke alatke računaju brojeve koji se koriste u poslu koji je zakonski uređen. Uz svaku " +
      "takvu alatku stoji kratka napomena; ovde je cela.",
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
    title: "Paketi alatki",
    description:
      "Svaki paket dodaje alatke jedne struke. Uključi koliko god želiš — ništa se ne briše kad " +
      "isključiš paket, alatke samo nestanu sa liste.",
    /** Under each card, and beside each row of the questionnaire's receipt. */
    contains: "{count} alata",
    /** The header control on the drawer itself. */
    open: "Paketi…",
    /**
     * The way out of the dialog. „Gotovo", not „U redu": every toggle is
     * already written by the time it is read.
     */
    done: "Gotovo",
    /**
     * Under the list, once at the bottom: what a pack is NOT, said plainly so
     * nobody hunts for a page.
     */
    note:
      "Paket je skup alatki, ne modul — ne dodaje ništa u meni sa strane i ne čuva nikakve " +
      "podatke.",
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
      "Alatke računaju veličine iz vrednosti koje uneseš. One ne zamenjuju ovlašćenog stručnjaka " +
      "— projektanta, lekara, advokata, računovođu — niti odluku koju on donosi i za koju " +
      "odgovara.",
    /**
     * The one failure this surface can have: the flag row did not get written.
     * Says what it cost, which is the press.
     */
    saveError: "Promena nije sačuvana. Pokušaj ponovo.",
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
    "allocation-remainder": "Raspodela bez ostatka",
    "amount-in-words": "Iznos slovima",
    "angle-of-view": "Ugao vidnog polja",
    "angle-units": "Uglovi i direkcioni ugao",
    "anuitet-otplatni-plan": "Anuitet i otplatni plan",
    "aspect-ratio-fit": "Odnos stranica",
    "audio-level-reference": "dBu, dBV i volti",
    "average-to-target": "Ocene do proseka",
    "awg-to-mm2": "AWG i mm²",
    "axle-load-distribution": "Osovinsko opterećenje",
    "backwards-timeline": "Vremenska osa unazad",
    "bakers-percentage": "Bakerski procenat",
    "bale-count-storage": "Bale i skladište",
    "bank-account-iban": "Račun i IBAN",
    "bar-duration": "Trajanje taktova",
    "bar-spacing": "Jednaki razmaci",
    "barbell-plate-loading": "Nalaganje diskova",
    "baseline-rhythm": "Prored i vertikalni ritam",
    "battery-bank-runtime": "Baterija i autonomija",
    "beam-check": "Greda i konzola",
    "beam-spot-diameter": "Snop reflektora",
    "bee-syrup-mix": "Sirup za pčele",
    "belt-and-gear-drive": "Prenos i kaiš",
    "benford-first-digit": "Benfordov test cifara",
    "billable-hours": "Obračun sati",
    "body-fat-target-mass": "Sastav tela",
    "body-indices": "Telesni indeksi",
    "book-spine": "Debljina hrbata",
    "bpm-delay-times": "Delay vremena po tempu",
    "bracket-balance": "Zagrade i navodnici",
    "break-even": "Tačka pokrića",
    "breakeven-cvp": "Prelomna tačka rentabiliteta",
    "brine-salt": "Salamura i soljenje",
    "budget-per-guest": "Budžet po gostu",
    "cable-cross-section": "Potreban presek",
    "cadastral-area-units": "Katastarske mere",
    "cadence-stride-length": "Kadenca i korak",
    "cargo-centre-of-gravity": "Težište tereta",
    "cashflow-npv-irr": "Novčani tok",
    "catering-per-guest": "Hrana i piće po gostu",
    "cents-ratio": "Centi i odnos frekvencija",
    "chained-discount": "Kaskadni popusti",
    "chargeable-weight": "Obračunska masa",
    "check-digits-id": "Provera PIB i JMBG",
    "child-age": "Uzrast deteta",
    "coffee-extraction": "Ekstrakcija kafe",
    "column-grid": "Mreža kolona",
    "combinatorics": "Kombinatorika",
    "compressor-curve": "Kriva kompresora",
    "concrete-takeoff": "Kubatura i oplata",
    "copyfitting": "Proračun obima teksta",
    "cost-allocation": "Raspodela troškova",
    "cost-per-km-transport": "Trošak po kilometru",
    "crop-factor": "Crop faktor",
    "css-typographic-units": "Tipografske jedinice",
    "decibel-ratio": "Decibeli i odnosi",
    "delta-e": "Razlika boja ΔE",
    "deposit-instalments": "Avans i rate",
    "depreciation-schedule": "Amortizacija osnovnih sredstava",
    "depth-of-field": "Dubinska oštrina",
    "diffraction-limit": "Difrakcija",
    "dough-water-temp": "Temperatura vode",
    "drawing-scale": "Razmera crteža",
    "driving-hours-planner": "Vožnja i pauze",
    "ean-barcode": "EAN barkod",
    "earthwork-prismoidal": "Zapremina između profila",
    "erg-split-watts": "Split i vati",
    "eta-with-breaks": "Procena dolaska",
    "exposure-equivalent": "Ekvivalentna ekspozicija",
    "fabric-yardage-repeat": "Tkanina i raport",
    "fertiliser-nutrient-blend": "Preračun đubriva",
    "financial-ratios": "Pokazatelji iz bilansa",
    "flash-guide-number": "Vodeći broj blica",
    "font-metrics-trim": "Metrike fonta",
    "fractions-decimals": "Razlomci i decimale",
    "frame-rate-conform": "Konform i usporenje",
    "fuel-consumption-cost": "Potrošnja i cena goriva",
    "fx-difference": "Kurs i kursne razlike",
    "gear-ratio-road-speed": "Prenosni odnos i brzina",
    "generator-sizing": "Snaga agregata",
    "glass-pane-weight": "Masa stakla",
    "glossary-check": "Provera terminologije",
    "grade-scale-points": "Bodovna skala testa",
    "grade-statistics": "Statistika ocena",
    "grain-moisture-shrink": "Kalo sušenja zrna",
    "gross-up": "Bruto iz neta",
    "growing-degree-days": "Suma temperatura",
    "guessing-correction": "Korekcija za pogađanje",
    "gvw-payload": "Ukupna masa i nosivost",
    "heart-rate-zones-karvonen": "Zone pulsa",
    "hidden-characters": "Skriveni znakovi",
    "honey-mass-moisture": "Med, masa i vlaga",
    "hourly-rate-target": "Cena sata",
    "iban-check": "IBAN",
    "ice-and-chilling": "Led za rashlađivanje",
    "ice-cream-overrun": "Naduv sladoleda",
    "illuminance-to-aperture": "Luks u blendu",
    "induction-motor-rating": "Asinhroni motor",
    "interest-periods": "Kamata po periodima",
    "interval-session-timing": "Intervalni trening",
    "inventory-costing": "Zalihe FIFO i prosek",
    "irrigation-depth-volume": "Norma zalivanja",
    "isbn-issn-check": "ISBN i ISSN",
    "iso-286-fits": "Tolerancije i naleganje",
    "iso-paper-sizes": "ISO formati papira",
    "item-analysis": "Analiza zadatka",
    "iznos-slovima": "Iznos slovima",
    "jmbg-provera": "Provera JMBG-a",
    "jump-height-flight-time": "Visina skoka",
    "junction-temperature": "Termički otpor",
    "katastarska-povrsina": "Katastarska površina",
    "kazna-i-pritvor": "Kazna i uračunavanje",
    "lamination-layers": "Slojevi laminacije",
    "late-payment-interest": "Kamata na docnju",
    "lease-term-dates": "Rokovi ugovora",
    "led-wall-pitch-viewing": "LED zid",
    "lesson-count-period": "Fond časova",
    "lesson-timeline": "Tempo časa",
    "levain-hydration": "Hidratacija i starter",
    "level-run": "Nivelman",
    "limb-symmetry-index": "Simetrija strana",
    "linear-cutting-stock": "Krojenje šipki",
    "livestock-ration-dm": "Obrok po suvoj materiji",
    "load-lashing-force": "Sila u vezicama",
    "loading-space-utilisation": "Iskorišćenje tovarnog prostora",
    "loan-amortization": "Plan otplate",
    "loan-schedule": "Otplatni plan kredita",
    "machine-field-capacity": "Učinak mašine",
    "margin-markup": "Marža i markup",
    "metric-thread-strength": "Metrički navoj",
    "mired-shift": "Mired korekcija",
    "mitre-angles": "Gerung i složeni gerung",
    "modular-type-scale": "Tipografska skala",
    "mojibake-repair": "Popravka kodiranja",
    "mortar-mix-quantity": "Malter i lepak",
    "motion-blur": "Zamućenje pokreta",
    "nd-filter-exposure": "ND filter",
    "nominalna-efektivna-stopa": "Nominalna i efektivna stopa",
    "note-frequency": "Nota, MIDI i frekvencija",
    "number-check": "Provera brojeva",
    "number-to-serbian-words": "Broj slovima",
    "nutrition-per-portion": "Hranljive vrednosti",
    "obracun-kamate": "Obračun kamate",
    "ohms-law-power": "Omov zakon i snaga",
    "one-rep-max-table": "1RM i procenti",
    "orchard-trellis-layout": "Naslon i redovi",
    "ownership-shares": "Suvlasnički udeli",
    "pallet-load-plan": "Raspored paleta",
    "pan-area-volume": "Kalupi i posude",
    "panel-cutting-yield": "Raskroj ploče",
    "paper-weight": "Gramatura i masa papira",
    "parcel-polygon-area": "Površina parcele",
    "parking-cloakroom": "Parking i garderoba",
    "payment-due-date": "Rok plaćanja",
    "payment-reference-97": "Poziv na broj 97",
    "pcm-file-size": "Veličina PCM zapisa",
    "pipe-flow-velocity": "Protok kroz cev",
    "plant-spacing-density": "Razmak sadnje",
    "plate-cost": "Kalkulacija jela",
    "plot-density-index": "Indeks izgrađenosti",
    "podela-iznosa": "Podela iznosa",
    "polygon-area": "Površina poligona",
    "portions-from-pack": "Porcije iz pakovanja",
    "power-factor-correction": "Kompenzacija reaktivne snage",
    "pq-nits": "PQ i nitovi",
    "pressure-and-piston-force": "Pritisak i sila klipa",
    "print-resolution": "Rezolucija za štampu",
    "pro-rata-days": "Pro-rata po danima",
    "projector-throw-screen": "Projekcija i platno",
    "racun-iban-provera": "Račun i IBAN",
    "radni-dani": "Radni dani",
    "raster-image-size": "Veličina rastera",
    "rate-conversion": "Nominalna i efektivna stopa",
    "ratio-split": "Podela po odnosu",
    "reading-time": "Trajanje čitanja",
    "rebar-weight": "Masa armature",
    "rebate-chain": "Lančani rabati",
    "recipe-scale": "Skaliranje recepta",
    "reefer-fuel-consumption": "Potrošnja hladnjače",
    "rent-escalation": "Indeksacija zakupnine",
    "rent-gross-net": "Bruto i neto zakupnina",
    "rental-yield": "Prinos od zakupa",
    "resistor-colour-code": "Boje otpornika",
    "reverb-time": "Vreme reverberacije RT60",
    "rigging-sling-angle-force": "Sila u kraku",
    "rlc-impedance": "Impedansa i rezonansa",
    "rok-poslednji-dan": "Rok i poslednji dan",
    "roll-yield": "Iskoristivost rolne",
    "roof-pitch": "Nagib krova",
    "room-modes": "Modovi prostorije",
    "room-quad-area": "Površina prostorije",
    "room-surfaces": "Površine prostorije",
    "run-of-show": "Satnica događaja",
    "running-pace-splits": "Tempo trke",
    "saddle-stitch-imposition": "Slog knjižice",
    "sample-buffer-latency": "Baferi i latencija",
    "scale-chord-speller": "Skale i akordi",
    "seating-tables": "Stolovi i raspored",
    "section-modulus": "Karakteristike preseka",
    "seeding-rate": "Setvena norma",
    "sentence-length": "Dužina rečenica",
    "serbian-transliteration": "Preslovljavanje",
    "series-parallel-network": "Serija i paralela",
    "service-interval-km-hours": "Servisni interval",
    "set-tempo-tut": "Tempo serije",
    "share-allocation": "Raspodela po udelima",
    "sheet-imposition": "Uklapanje na tabak",
    "sheet-metal-bend": "Razvijena dužina lima",
    "shelf-deflection": "Ugib police",
    "shelf-spacing": "Raspored polica",
    "simple-interest-days": "Kamata po danima",
    "slope-grade": "Nagib i pad",
    "smpte-timecode": "SMPTE tajmkod",
    "solution-concentration": "Koncentracija rastvora",
    "sound-wavelength": "Talasna dužina zvuka",
    "speaker-load": "Impedansa i snaga zvučnika",
    "speedometer-tyre-deviation": "Odstupanje brzinomera",
    "spl-distance": "SPL na udaljenosti",
    "split-into-groups": "Podela na grupe",
    "split-times-fatigue": "Vremena i zamor",
    "sprayer-calibration": "Kalibracija prskalice",
    "square-check": "Provera pravouglosti",
    "stage-deck-layout": "Bina i podijum",
    "stair-geometry": "Stepenište",
    "standard-score": "Standardni bod",
    "strane-teksta": "Obračun strana teksta",
    "subtitle-audit": "Provera titlova",
    "subtitle-retime": "Pomeranje titlova",
    "survey-bearing-distance": "Geodetski zadatak",
    "suvlasnicki-udeli": "Suvlasnički udeli",
    "sweat-rate-hydration": "Stopa znojenja",
    "tank-mix-dose": "Doza po rezervoaru",
    "tank-volume-by-level": "Zapremina rezervoara",
    "tap-drill-size": "Bušenje za navoj",
    "tax-id-check": "PIB i matični broj",
    "tent-bay-layout": "Veličina šatora",
    "test-printing": "Umnožavanje testova",
    "three-phase-load-balance": "Balans faza",
    "three-phase-power": "Trofazna snaga",
    "tiered-commission": "Provizija po pragovima",
    "tile-count": "Broj pločica",
    "timber-volume": "Kubikaza drveta",
    "timelapse-planner": "Tajmlaps",
    "topic-hour-allocation": "Raspodela po temama",
    "torque-speed-power": "Moment i snaga",
    "training-volume-load": "Tonaža i intenzitet",
    "translation-volume": "Obim prevoda",
    "transposition": "Transpozicija",
    "trench-volume": "Iskop rova",
    "trial-balance-check": "Kontrola zbira",
    "trip-cost-quote": "Cena ture",
    "troskovi-srazmerno-uspehu": "Troškovi srazmerno uspehu",
    "truss-hoist-reactions": "Opterećenje trase i motora",
    "tvm-solver": "Vremenska vrednost novca",
    "typography-cleanup": "Tipografsko čišćenje",
    "ugovorna-kazna": "Ugovorna kazna",
    "unwrap-paragraphs": "Sređivanje preloma",
    "us-customary-kitchen-units": "Američke mere",
    "varispeed-repitch": "Rastimovanje i brzina",
    "venue-occupancy-area": "Kapacitet prostora",
    "video-bitrate-storage": "Bitrejt i kartica",
    "voltage-drop": "Pad napona na vodu",
    "wall-ceiling-area": "Zidovi i plafon",
    "wall-u-value": "U-vrednost sklopa",
    "wallpaper-rolls": "Broj rolni tapeta",
    "weight-class-cut": "Do granice kategorije",
    "weighted-area": "Obračunska površina",
    "weighted-grade": "Ponderisana ocena",
    "weld-consumable": "Potrošnja za zavarivanje",
    "wood-moisture-movement": "Rad drveta po vlazi",
    "word-frequency": "Učestalost reči",
    "yield-estimate-samples": "Procena prinosa",
    "yield-trim-cook": "Randman i kalo",
    "zbir-perioda": "Zbir perioda",
  },

  /**
   * The one line under each name. Says what the tool ANSWERS, never what it
   * guarantees — „daje visinu stepenika", not „proverava da li stepenište
   * zadovoljava", which would be a claim the tool is forbidden to make.
   */
  blurb: {
    "allocation-remainder":
      "Deli iznos po zadatom ključu tako da zbir delova bude tačno jednak celini, bez pare koja " +
      "se izgubi na zaokruživanju.",
    "amount-in-words":
      "Ispisuje novčani iznos slovima na srpskom, sa oblikom reči za dinare i pare koji odgovara " +
      "broju.",
    "angle-of-view":
      "Za unete dimenzije senzora i žižnu daljinu daje ugao snimanja po širini, visini i " +
      "dijagonali i koliko metara kadar obuhvata na zadatom rastojanju.",
    "angle-units":
      "Prevodi ugao između stepeni-minuta-sekundi, decimalnih stepeni, gona, radijana i mila i " +
      "svodi ga na pun krug.",
    "anuitet-otplatni-plan":
      "Koliki je jednak obrok i kako se svaka rata deli na kamatu i glavnicu kad se dug " +
      "isplaćuje u N jednakih rata.",
    "aspect-ratio-fit":
      "Skraćeni celobrojni odnos stranica i dimenzije pri uklapanju u okvir, popunjavanju okvira " +
      "ili zadatoj širini, sa veličinom traka odnosno reza.",
    "audio-level-reference":
      "Prevodi nivo linijskog signala između dBu, dBV, dBm i napona — efektivnog, vršnog i " +
      "međuvršnog.",
    "average-to-target":
      "Računa koliko još ocena zadate vrednosti treba da bi prosek dostigao cilj, ili koliko " +
      "slabijih ocena prosek još može da izdrži a da ne padne ispod cilja.",
    "awg-to-mm2":
      "Prevodi AWG broj u prečnik i presek i nazad, uz otpornost po kilometru na 20 °C.",
    "axle-load-distribution":
      "Iz položaja tereta i međuosovinskog rastojanja računa opterećenje prednje i zadnje " +
      "osovine, a za tegljač i opterećenje sedla.",
    "backwards-timeline":
      "Od sata serviranja unazad računa kada mora da počne svaki korak pripreme i u koliko sati " +
      "počinje ceo posao.",
    "bakers-percentage":
      "Prevodi recept u procente od brašna i nazad i računa težine sastojaka za ciljanu masu " +
      "testa ili za zadati broj komada uz gubitak pečenjem.",
    "bale-count-storage":
      "Koliko bala daje pokošena površina, koliko one zauzimaju zapremine i koliko ih po " +
      "geometriji staje u zadatu nadstrešnicu ili prikolicu.",
    "bank-account-iban":
      "Proverava kontrolne cifre domaćeg tekućeg računa (3-13-2) i IBAN-a i izračunava ih kad " +
      "nedostaju, po istoj MOD 97-10 aritmetici.",
    "bar-duration":
      "Koliko traje N taktova pri zadatom tempu i taktu, i obrnuto — koliko taktova stane u " +
      "zadato trajanje.",
    "bar-spacing":
      "Deli dužinu na jednake razmake koji ne prelaze zadati maksimum i daje broj komada, " +
      "stvarni razmak i sve pozicije.",
    "barbell-plate-loading":
      "Za željeno ukupno opterećenje ispisuje koje diskove staviti po strani šipke, a kada tačan " +
      "zbir nije moguć — najbliže opterećenje koje jeste i za koliko promašuje.",
    "baseline-rhythm":
      "Koliki je prored u pikselima, da li pada na osnovnu mrežu i koliko redova staje u kolonu " +
      "zadate visine.",
    "battery-bank-runtime":
      "Računa napon i energiju paketa, iskoristivi deo i vreme rada pod zadatim opterećenjem, sa " +
      "Pojkertovom korekcijom kada je korisnik unese.",
    "beam-check":
      "Za četiri osnovne statičke šeme daje reakcije, maksimalni moment, napon i ugib iz unetih " +
      "E i I.",
    "beam-spot-diameter":
      "Iz ugla snopa i rastojanja daje prečnik osvetljenog kruga, osvetljenost u centru i razmak " +
      "reflektora za zadato preklapanje, uključujući kosi upad.",
    "bee-syrup-mix":
      "Koliko šećera i vode ide u zadatu količinu sirupa po izabranom odnosu, kolika mu je " +
      "računata gustina i koncentracija, i koliko treba za sve košnice.",
    "belt-and-gear-drive":
      "Računa prenosni odnos i izlazni broj obrtaja, brzinu kaiša, tačnu dužinu otvorenog kaiša, " +
      "uglove obuhvata i osno rastojanje zupčastog para.",
    "benford-first-digit":
      "Poredi raspodelu prve (ili prve dve) cifre u nalepljenoj koloni iznosa sa Benfordovom " +
      "raspodelom i daje hi-kvadrat, MAD i z-vrednost po cifri.",
    "billable-hours":
      "Sabira vremena iz liste, zaokružuje ih na ugovoreni interval i množi satnicom.",
    "body-fat-target-mass":
      "Iz telesne mase i izmerenog procenta masti daje masnu i čistu masu i koliko bi telo imalo " +
      "kilograma na željenom procentu masti ako čista masa ostane ista.",
    "body-indices":
      "Računa BMI, ponderalni indeks i odnose struk/visina i struk/kuk iz unetih mera, bez " +
      "ijedne kategorije i bez ijedne tabele.",
    "book-spine":
      "Koliko milimetara ima hrbat knjige sa zadatim brojem strana, gramaturom i voluminoznošću " +
      "papira, i kolika je razvijena korica.",
    "bpm-delay-times":
      "Za zadati tempo daje vreme u milisekundama za svaku notnu vrednost — pravu, sa tačkom i " +
      "triolsku — i pripadajuću frekvenciju za LFO.",
    "bracket-balance":
      "Pokazuje koja zagrada ili navodnik nije zatvoren i u kom redu i koloni stoji.",
    "break-even":
      "Koliko komada i koliki prihod pokrivaju fiksne troškove, i koliko treba za željenu dobit.",
    "breakeven-cvp":
      "Računa koliko komada i koliki promet pokrivaju fiksne troškove, koliko treba za ciljnu " +
      "dobit i koliko obim može da padne pre gubitka.",
    "brine-salt":
      "Koliko soli ide u salamuru ili suvo soljenje za procenat koji zadaje korisnik, po obe " +
      "uobičajene osnove računanja, i koliki je procenat soli u salamuri koja već postoji.",
    "budget-per-guest":
      "Sabira fiksne troškove, troškove po gostu i po stolu, procentualne stavke, rezervu i " +
      "porez, i daje cenu po gostu i cenu karte na nuli.",
    "cable-cross-section":
      "Iz pada napona koji korisnik zada računa koliko je najmanje bakra ili aluminijuma " +
      "potrebno da se u taj pad stane, i pad koji se dobija na preseku koji korisnik izabere.",
    "cadastral-area-units":
      "Pretvara katastarska jutra i kvadratne hvate u are, hektare i kvadratne metre, i obrnuto.",
    "cadence-stride-length":
      "Povezuje kadencu, dužinu koraka i brzinu — iz bilo koja dva daje treći, uz broj koraka na " +
      "kilometar.",
    "cargo-centre-of-gravity":
      "Iz spiska komada sa masom i položajem daje težište tereta po dužini, širini i visini i " +
      "njegove momente.",
    "cashflow-npv-irr":
      "Računa neto sadašnju vrednost i internu stopu prinosa niza priliva i odliva po periodima.",
    "catering-per-guest":
      "Iz količine po gostu, udela gostiju koji uzimaju stavku i rezerve računa ukupnu količinu, " +
      "broj pakovanja i višak po svakoj stavci.",
    "cents-ratio":
      "Pretvara razliku dve frekvencije u cente, polutonove i odnos, i računa frekvenciju posle " +
      "rastimavanja za zadati broj centi.",
    "chained-discount":
      "Slaže niz popusta i doplata jedan na drugi i kaže koji bi jedan popust dao istu cenu.",
    "chargeable-weight":
      "Iz dimenzija i stvarne mase pošiljke daje zapreminsku masu po zadatom deliocu i " +
      "obračunsku masu koja se fakturiše.",
    "check-digits-id":
      "Računa i proverava kontrolnu cifru PIB-a, matičnog broja i JMBG-a, tako da se greška u " +
      "prekucavanju vidi pre nego što broj ode na dokument.",
    "child-age":
      "Za datum rođenja i zadati dan računa uzrast u godinama, mesecima i danima, ukupan broj " +
      "navršenih meseci i dana, i datum kada osoba navršava zadati broj godina.",
    "coffee-extraction":
      "Iz doze, vode, mase napitka i izmerenog TDS-a računa odnose kuvanja i procenat " +
      "ekstrakcije, i obrnuto — koliko vode ide na zadati odnos.",
    "column-grid":
      "Širina jedne kolone i raspona od k kolona za zadatu širinu, broj kolona, oluk i marginu, " +
      "i koliko kolona staje uz zadatu najmanju širinu.",
    "combinatorics":
      "Računa faktorijel, varijacije i kombinacije sa ponavljanjem i bez njega, i permutacije sa " +
      "ponavljanjem, u celobrojnoj aritmetici bez zaokruživanja.",
    "compressor-curve":
      "Za zadati prag, odnos i koleno pokazuje šta se dešava sa ulaznim nivoom — izlazni nivo, " +
      "redukciju pojačanja i potreban makeup.",
    "concrete-takeoff":
      "Za ploču, gredu, stub ili temelj daje zapreminu betona, površinu oplate i broj tura " +
      "mešalice.",
    "copyfitting":
      "Koliko će redova, kolona i strana zauzeti tekst od N znakova pri zadatoj širini reda i " +
      "visini kolone, i koliki red staje u tačan broj strana.",
    "cost-allocation":
      "Deli zajednički trošak na delove po površini ili udelu, sa zaokruživanjem čiji se delovi " +
      "tačno saberu u celinu.",
    "cost-per-km-transport":
      "Iz godišnjih fiksnih troškova i troškova po kilometru daje cenu koštanja kilometra i " +
      "kilometra pod teretom.",
    "crop-factor":
      "Iz unetih dimenzija senzora računa crop faktor u odnosu na format 135 i preračunava žižnu " +
      "daljinu i blendu u ekvivalent za pun kadar.",
    "css-typographic-units":
      "Pretvara px, rem, em, pt, piku, mm, cm, inč, Q i dp jednu u drugu i daje veličinu resursa " +
      "za @2x i @3x.",
    "decibel-ratio":
      "Pretvara decibele u linearni odnos i natrag — posebno za amplitudu i posebno za snagu — i " +
      "sabira više nivoa u decibelima.",
    "delta-e":
      "Koliko se dve boje brojčano razlikuju po formulama ΔE*ab, ΔE94 i CIEDE2000; granicu " +
      "prihvatljivosti postavlja i tumači korisnik.",
    "deposit-instalments":
      "Deli ugovorenu vrednost na avans i jednake rate sa datumima, bez razlike u zbiru.",
    "depreciation-schedule":
      "Pravi plan amortizacije po linearnom, degresivnom, metodu zbira godina ili funkcionalnom " +
      "metodu, sa srazmerom za godinu aktiviranja.",
    "depth-of-field":
      "Za zadatu žižnu daljinu, blendu, rastojanje fokusa i krug rasipanja daje hiperfokalnu " +
      "daljinu i bližu i dalju granicu oštrine.",
    "diffraction-limit":
      "Daje prečnik Erijevog diska za zadatu blendu i blendu na kojoj disk dostigne veličinu " +
      "jednog piksela unetog senzora.",
    "dough-water-temp":
      "Računa temperaturu vode da bi testo posle mešenja imalo željenu temperaturu i, obrnuto, " +
      "iz izmerene šarže izvlači faktor trenja mešalice.",
    "drawing-scale":
      "Prevodi dužinu sa papira u stvarnu i nazad i kaže koja razmera iz standardnog niza staje " +
      "na izabrani format lista.",
    "driving-hours-planner":
      "Iz granica koje korisnik unese raspoređuje planiranu vožnju na blokove sa pauzama i " +
      "odmorima i daje satnicu.",
    "ean-barcode":
      "Računa kontrolnu cifru za EAN-13, EAN-8 i UPC-A i daje širinu i visinu simbola pri " +
      "zadatoj X-dimenziji.",
    "earthwork-prismoidal":
      "Sabira zapreminu iskopa i nasipa iz površina poprečnih profila, po metodi srednjih " +
      "preseka ili prizmoidnoj formuli.",
    "erg-split-watts":
      "Pretvara split na 500 metara u vate i nazad po objavljenoj Concept2 relaciji i daje vreme " +
      "za zadatu distancu pri tom splitu.",
    "eta-with-breaks":
      "Iz rastojanja, prosečne brzine i planiranih zastoja daje vreme dolaska i prosečnu brzinu " +
      "od vrata do vrata.",
    "exposure-equivalent":
      "Iz jedne kombinacije blende, zatvarača i ISO-a nalazi treću vrednost za istu ekspoziciju " +
      "i razliku između dve kombinacije u blendama.",
    "fabric-yardage-repeat":
      "Koliko dužnih metara tkanine treba za zadate komade, prema širini rolne, šavovima i " +
      "raportu šare.",
    "fertiliser-nutrient-blend":
      "Iz unetih ciljanih količina hraniva po hektaru i sastava đubriva u NPK procentima daje " +
      "kilograme svakog đubriva po hektaru i ukupno, i šta zadata količina đubriva donosi " +
      "hraniva.",
    "financial-ratios":
      "Iz unetih pozicija bilansa stanja i uspeha računa pokazatelje likvidnosti, zaduženosti, " +
      "obrta i prinosa, uključujući ciklus konverzije gotovine.",
    "flash-guide-number":
      "Iz vodećeg broja i rastojanja daje blendu, preračunava vodeći broj na drugi ISO i računa " +
      "promenu osvetljenja pri promeni rastojanja.",
    "font-metrics-trim":
      "Iz unitsPerEm, ascendera i descendera daje visinu verzala u pikselima i negativne odmake " +
      "da okvir teksta legne na verzal.",
    "fractions-decimals":
      "Sabira, oduzima, množi i deli razlomke u celobrojnoj aritmetici, skraćuje rezultat, " +
      "prikazuje ga kao mešovit broj i kao decimalu sa obeleženim periodom, i vraća periodičnu " +
      "decimalu nazad u razlomak.",
    "frame-rate-conform":
      "Kada snimak sa jedne brzine kadrova legne na tajmlajn sa drugom, daje brzinu " +
      "reprodukcije, novo trajanje i pomeraj u odnosu na original.",
    "fuel-consumption-cost":
      "Iz pređenog puta i utrošenog goriva daje potrošnju, cenu po kilometru i cenu po " +
      "tona-kilometru.",
    "fx-difference":
      "Preračunava devizni iznos po kursu koji korisnik unosi, računa kursnu razliku između dva " +
      "kursa i izvodi unakrsni kurs iz dva odnosa.",
    "gear-ratio-road-speed":
      "Povezuje obrtaje motora, prenosni odnos menjača i zadnjeg mosta i obim gume sa brzinom " +
      "vozila.",
    "generator-sizing":
      "Sabira potrošače sa faktorom snage i istovremenošću u radnu prividnu snagu i računa vršnu " +
      "prividnu snagu u trenutku polaska najvećeg motora.",
    "glass-pane-weight":
      "Masa monolitnog, laminiranog i izo-stakla po m², po komadu i ukupno, iz dimenzija i " +
      "sastava paketa.",
    "glossary-check":
      "Za rečnik pojmova koji nalepiš proverava da li se svaki termin iz originala pojavio u " +
      "prevodu i koliko puta.",
    "grade-scale-points":
      "Pretvara procentualne pragove koje korisnik upiše u broj bodova na testu sa zadatim " +
      "maksimumom i pokazuje koji opseg bodova nosi koju oznaku.",
    "grade-statistics":
      "Za upisan niz ocena ili bodova daje prosek, medijanu, modu, standardnu devijaciju, " +
      "kvartile, raspodelu po vrednostima i udeo vrednosti iznad praga koji korisnik sam upiše.",
    "grain-moisture-shrink":
      "Koliko kilograma ostane kada zrno sa izmerene vlage padne na vlagu iz ugovora, koliko je " +
      "vode izašlo i kolika je masa posle odbitka primesa.",
    "gross-up":
      "Rešava linearnu jednačinu bruto–neto unazad: iz neto iznosa i stopa koje korisnik unosi " +
      "izvodi bruto, iznos poreza i doprinosa, i vraća kontrolu.",
    "growing-degree-days":
      "Sabira dnevne temperaturne sume iznad bazne temperature koju je izabrao korisnik i " +
      "pokazuje koliko je nakupljeno i kad se pri istom tempu dostiže uneta suma.",
    "guessing-correction":
      "Za test sa višestrukim izborom računa rezultat umanjen za očekivani doprinos pogađanja i " +
      "pokazuje koliko bi u proseku doneo čist pogodak.",
    "gvw-payload":
      "Sabira taru, gorivo, posadu, opremu i teret u ukupnu masu i poredi je sa granicama koje " +
      "korisnik unese.",
    "heart-rate-zones-karvonen":
      "Iz izmerenog maksimalnog pulsa i pulsa u mirovanju daje ciljni puls po Karvonenu i po " +
      "procentu maksimuma, i obrnuto — koji je procenat neki izmereni puls.",
    "hidden-characters":
      "Pronalazi nevidljive i kontrolne znakove u tekstu i reči u kojima su pomešane ćirilica i " +
      "latinica.",
    "honey-mass-moisture":
      "Iz izmerene gustine i vlage daje neto masu meda u posudi, odnos vode i suve materije i " +
      "masu posle sušenja na nižu vlagu.",
    "hourly-rate-target":
      "Od željene godišnje zarade, troškova i broja naplativih sati računa cenu sata i cenu dana.",
    "iban-check":
      "Proverava kontrolne cifre IBAN-a i sastavlja IBAN od oznake države i domaćeg broja računa.",
    "ice-and-chilling":
      "Koliko kilograma leda odvede toplotu zadatoj masi pića sa početne na ciljnu temperaturu i " +
      "koliko se leda dodatno istopi za vreme držanja.",
    "ice-cream-overrun":
      "Računa overrun iz mase iste posude napunjene smesom i gotovim sladoledom, i iz zadatog " +
      "overruna daje zapreminu i težinu pakovanja.",
    "illuminance-to-aperture":
      "Pretvara luks i fut-kandele i, uz konstantu kalibracije unetu sa tvog svetlomera, računa " +
      "blendu za zadati ISO i vreme zatvarača.",
    "induction-motor-rating":
      "Iz podataka sa natpisne pločice računa nazivnu struju, ulaznu snagu, sinhronu brzinu, " +
      "klizanje i obrtni moment.",
    "interest-periods":
      "Računa kamatu na glavnicu kroz više perioda sa različitim stopama i po izabranoj osnovi " +
      "za brojanje dana, sa prikazom dana i kamate po svakom periodu.",
    "interval-session-timing":
      "Iz trajanja rada, odmora (ili odnosa rad:odmor) i broja ponavljanja i serija daje " +
      "trajanje serije, ukupno vreme treninga i stvarni odnos rada i odmora.",
    "inventory-costing":
      "Iz liste ulaza i izlaza računa nabavnu vrednost prodate robe i stanje zaliha po FIFO " +
      "metodi i po prosečnoj ponderisanoj ceni.",
    "irrigation-depth-volume":
      "Pretvara unetu zalivnu normu u milimetrima u kubike po hektaru, daje vreme rada sistema " +
      "pri zadatom protoku i intenzitet kiše rasprskivača.",
    "isbn-issn-check":
      "Proverava kontrolnu cifru ISBN, ISSN, ISMN i EAN-13 broja i pretvara ISBN-10 u ISBN-13 i " +
      "nazad.",
    "iso-286-fits":
      "Granične mere rupe i osovine za oznaku tolerancije i zazor koji iz njih izlazi, za " +
      "naleganja sa zazorom.",
    "iso-paper-sizes":
      "Milimetarske dimenzije A, B i C formata, koji koverat prima koji list, koliko manjih " +
      "formata staje u veći i koji je procenat uvećanja na kopir-aparatu.",
    "item-analysis":
      "Za jedan zadatak sa testa računa indeks lakoće (udeo tačnih odgovora) i indeks " +
      "diskriminacije kao razliku uspešnosti bolje i slabije grupe.",
    "iznos-slovima":
      "Ispisuje novčani iznos rečima na srpskom, sa tačnim oblikom imenice uz broj.",
    "jmbg-provera":
      "Da li se kontrolna cifra unetog JMBG-a slaže sa ostalih dvanaest, i koji datum, oznaku " +
      "pola i registarski broj taj zapis nosi.",
    "jump-height-flight-time":
      "Pretvara vreme leta u visinu skoka i nazad i računa indeks reaktivne snage iz visine i " +
      "vremena kontakta sa podlogom.",
    "junction-temperature":
      "Iz snage, ambijenta i lanca termičkih otpora računa temperaturu spoja, ili obrnuto " +
      "potreban termički otpor hladnjaka i dozvoljenu snagu.",
    "katastarska-povrsina":
      "Prevod površine između hektara, ari i kvadratnih metara, u oba smera, u zapisu kakav " +
      "stoji u listu nepokretnosti.",
    "kazna-i-pritvor":
      "Kalendarski račun: kada ističe uneto trajanje kazne pošto se odbiju uneti dani lišenja " +
      "slobode i kog datuma pada uneti razlomak tog trajanja.",
    "lamination-layers":
      "Iz niza presavijanja daje tačan broj slojeva masti i testa i debljinu jednog sloja pri " +
      "završnoj debljini razvijenog testa.",
    "late-payment-interest":
      "Računa kamatu na zakasnelo plaćanje po godišnjoj stopi, osnovici i metodu koje sami " +
      "unesete.",
    "lease-term-dates":
      "Iz datuma početka i trajanja daje datum isteka, poslednji dan za otkaz po roku koji " +
      "unesete i sve datume dospeća rata.",
    "led-wall-pitch-viewing":
      "Iz koraka piksela i broja panela daje dimenziju zida, ukupnu rezoluciju, daljinu sa koje " +
      "se pikseli više ne razlikuju, broj portova procesora i struju napajanja.",
    "lesson-count-period":
      "Broji koliko termina jednog predmeta pada u zadati period, po izabranim danima u nedelji " +
      "i uz ručno upisane neradne datume, i pretvara ih u minute i sate.",
    "lesson-timeline":
      "Od vremena početka i trajanja pojedinih aktivnosti pravi raspored po satu i minutu i " +
      "pokazuje koliko vremena preostaje ili koliko se prekoračuje.",
    "levain-hydration":
      "Razdvaja brašno i vodu koji su već u starteru ili predfermentu i računa koliko brašna i " +
      "vode još treba dodati da bi celo testo imalo željenu hidrataciju.",
    "level-run":
      "Iz očitanja nivelira i kote repera računa kote svih tačaka, aritmetičku kontrolu i " +
      "nezatvaranje vlaka.",
    "limb-symmetry-index":
      "Odnos vrednosti sa dve strane tela u procentima, razlika do sto posto, i koju vrednost " +
      "slabija strana treba da dostigne za odnos koji korisnik sam zada.",
    "linear-cutting-stock":
      "Iz spiska potrebnih komada, dužine šipke i širine reza daje koliko šipki treba, koji " +
      "komadi idu na koju šipku i koliki ostatak pada.",
    "livestock-ration-dm":
      "Pretvara uneti unos suve materije po grlu u sveže kilograme svakog hraniva, dnevnu i " +
      "ukupnu potrošnju stada i potrebnu zalihu za zadat broj dana.",
    "load-lashing-force":
      "Iz mase tereta i koeficijenata koje korisnik unese računa silu obezbeđenja i silu koju " +
      "daje unesena postavka vezica.",
    "loading-space-utilisation":
      "Poredi zapreminu, podnu površinu i tovarne metre pošiljke sa raspoloživim prostorom i " +
      "daje iskorišćenje po svakoj osnovici.",
    "loan-amortization":
      "Daje plan otplate anuitetnog kredita po mesecima, ostatak duga na bilo koji mesec i " +
      "efekat prevremene uplate.",
    "loan-schedule":
      "Pravi otplatni plan po ratama — anuitetski ili sa jednakom glavnicom — sa podelom svake " +
      "rate na kamatu i glavnicu.",
    "machine-field-capacity":
      "Iz radnog zahvata, brzine i iskorišćenja vremena daje hektare na sat, vreme za celu " +
      "parcelu i potrošnju goriva po hektaru.",
    "margin-markup":
      "Povezuje nabavnu cenu, prodajnu cenu, maržu i markup i računa najveći popust do zadate " +
      "marže.",
    "metric-thread-strength":
      "Iz nominalnog prečnika i koraka računa srednji, jezgreni i unutrašnji prečnik, presek " +
      "napona i silu koja odgovara čvrstoći koju korisnik unese.",
    "mired-shift":
      "Računa razliku u miredima između dve temperature boje i temperaturu koja se dobija posle " +
      "zadate mired korekcije.",
    "mitre-angles":
      "Ugao reza za ram sa N stranica i, kada je stranica nagnuta, oba podešavanja testere — " +
      "gerung i nagib lista.",
    "modular-type-scale":
      "Niz veličina slova dobijen množenjem osnovne veličine izabranim odnosom, u pikselima, rem " +
      "jedinicama i tačkama.",
    "mojibake-repair":
      "Vraća pokvarene znakove tipa „Å¡\" i „Ä‡\" u ispravna slova, birajući kojim je kodiranjem " +
      "tekst pisan a kojim pročitan.",
    "mortar-mix-quantity":
      "Količina gotove smeše ili sastojaka za mešanje iz površine i debljine sloja, sa vodom, " +
      "brojem vreća i rasturom.",
    "motion-blur":
      "Koliko se piksela subjekat razmaže tokom ekspozicije i koji zatvarač ga zadržava unutar " +
      "zadatog broja piksela.",
    "nd-filter-exposure":
      "Pretvara jačinu ND filtera između blendi, optičke gustine i faktora i računa vreme " +
      "ekspozicije posle filtera.",
    "nominalna-efektivna-stopa":
      "Koliko nominalna godišnja stopa sa m obračuna godišnje vredi kao efektivna godišnja, i " +
      "obrnuto.",
    "note-frequency":
      "Prevodi notu i oktavu, MIDI broj i frekvenciju jedno u drugo u jednakoj temperaciji, i za " +
      "upisanu frekvenciju daje najbližu notu i odstupanje u centima.",
    "number-check":
      "Upoređuje sve brojeve u originalu i u prevodu i javlja koji nedostaje ili je pogrešno " +
      "prepisan.",
    "number-to-serbian-words":
      "Ispisuje broj rečima na srpskom, sa ispravnim oblikom uz hiljadu, milion i milijardu.",
    "nutrition-per-portion":
      "Prevodi unetu tabelu hranljivih vrednosti između vrednosti na 100 g, po porciji i po " +
      "pakovanju i tačno prevodi kilodžule u kilokalorije i nazad.",
    "obracun-kamate":
      "Kolika je kamata na glavnicu od dana do dana, konformnom ili proporcionalnom metodom, po " +
      "stopama koje korisnik unosi za svaki period.",
    "ohms-law-power":
      "Iz bilo koje dve od četiri veličine (U, I, R, P) računa preostale dve.",
    "one-rep-max-table":
      "Iz jedne serije (kilogrami i ponavljanja) daje procenjeni 1RM po Epli i po Bžicki formuli " +
      "i tabelu opterećenja po procentima, zaokruženu na korak tegova.",
    "orchard-trellis-layout":
      "Za zasad zadatih dimenzija daje broj i dužinu redova, broj stubova i sidara, dužinu i " +
      "masu žice i broj sadnica.",
    "ownership-shares":
      "Sabira suvlasničke udele kao tačne razlomke i prevodi ih u kvadrate, a kvadrate nazad u " +
      "udeo.",
    "pallet-load-plan":
      "Za date unutrašnje mere tovarnog prostora računa koliko paleta staje po podu u svakom " +
      "rasporedu i koliko sa slaganjem u visinu.",
    "pan-area-volume":
      "Površina i zapremina okruglih, četvrtastih, pravougaonih i venčastih kalupa i lonaca, " +
      "preračun količine smese pri promeni kalupa i visina punjenja za zadatu zapreminu.",
    "panel-cutting-yield":
      "Koliko komada zadatog formata izlazi iz jedne ploče uz širinu reza i obrezivanje ivica, " +
      "koliko ploča treba i koliki je otpad.",
    "paper-weight":
      "Koliko teži jedan tabak, ris ili ceo tiraž pri zadatoj gramaturi, i kolika je gramatura " +
      "izmerenog svežnja.",
    "parcel-polygon-area":
      "Iz niza koordinata prelomnih tačaka računa površinu i obim parcele Gausovom (surveyor's) " +
      "formulom.",
    "parking-cloakroom":
      "Iz broja gostiju, udela koji dolazi kolima i popunjenosti vozila računa broj vozila i " +
      "površinu parkinga, dužinu šipki u garderobi i broj radnika za zadati prozor prijema.",
    "payment-due-date":
      "Iz datuma i roka koji sam unosiš daje datum dospeća, dan u nedelji i broj dana razlike do " +
      "referentnog datuma.",
    "payment-reference-97":
      "Računa kontrolnu dvocifru poziva na broj po postupku MOD 97-10 i poredi je sa već upisanom.",
    "pcm-file-size":
      "Koliko zauzima nekompresovan snimak zadate dužine pri zadatoj frekvenciji, rezoluciji i " +
      "broju kanala — i koliki je protok podataka.",
    "pipe-flow-velocity":
      "Povezuje unutrašnji prečnik, protok i brzinu u cevi i računa Rejnoldsov broj i maseni " +
      "protok iz svojstava koja korisnik unese.",
    "plant-spacing-density":
      "Iz razmaka redova i razmaka u redu daje broj biljaka po hektaru i stvaran broj sadnica na " +
      "parceli sa uvratinama, i obrnuto — traženi razmak za uneti sklop.",
    "plate-cost":
      "Sabira cenu sastojaka jednog jela sa uračunatim kalom po sastojku i daje cenu koštanja " +
      "porcije i prodajnu cenu za procenat food-costa koji zadaje korisnik.",
    "plot-density-index":
      "Iz površine parcele računa indeks izgrađenosti i zauzetosti, ili BRGP i površinu pod " +
      "objektom pri indeksu koji unesete.",
    "podela-iznosa":
      "Deli iznos na više lica po zadatim udelima tako da zbir delova bude tačno jednak celini, " +
      "bez izgubljene pare.",
    "polygon-area":
      "Iz spiska koordinata temena računa površinu, obim, težište i smer obilaska parcele.",
    "portions-from-pack":
      "Koliko porcija izlazi iz pakovanja i koliko pakovanja treba za zadati broj porcija, sa " +
      "ostatkom, cenom porcije i cenom po kilogramu ili litru.",
    "power-factor-correction":
      "Računa reaktivnu snagu i kapacitivnost potrebne da se faktor snage podigne sa postojećeg " +
      "na ciljani, i struju pre i posle.",
    "pq-nits":
      "Pretvara PQ signal u luminanciju u nitovima i nazad, po krivoj iz ST 2084, uz 10-bitni i " +
      "12-bitni kod u punom i suženom opsegu.",
    "pressure-and-piston-force":
      "Prevodi bar, Pa, psi, kgf/cm², mmHg i metre vodenog stuba, razlikuje nadpritisak od " +
      "apsolutnog i računa silu na klipu i na strani klipnjače.",
    "print-resolution":
      "Koliko milimetara je slika od N piksela na zadatoj rezoluciji, koja je stvarna rezolucija " +
      "na željenoj širini i kolika je nekomprimovana veličina.",
    "pro-rata-days":
      "Deli iznos za period na dva korisnika po broju dana, tako da se dva dela tačno saberu u " +
      "celinu.",
    "projector-throw-screen":
      "Iz projekcionog odnosa i rastojanja daje širinu, visinu i dijagonalu slike, osvetljenost " +
      "platna i kontrast pri ambijentalnom svetlu koje korisnik unese.",
    "racun-iban-provera":
      "Da li se kontrolni broj otkucanog računa slaže po modulu 97, koji je njegov IBAN i koji " +
      "je kontrolni broj za uneti niz cifara.",
    "radni-dani":
      "Koliko kalendarskih, radnih i neradnih dana ima između dva datuma, po spisku neradnih " +
      "dana koji korisnik sam unosi.",
    "raster-image-size":
      "Nekompresovana veličina slike iz dimenzija, broja kanala i dubine bita, i koliko takvih " +
      "fajlova staje na dati prostor.",
    "rate-conversion":
      "Prevodi kamatnu stopu između nominalne godišnje sa m obračuna, efektivne godišnje i " +
      "periodične, i pokazuje razliku proporcionalne i konformne periodične stope.",
    "ratio-split":
      "Deli ukupnu količinu po zadatom odnosu (2:1:1, 3:2:1 …) i zaokružuje delove tako da im " +
      "zbir ostane tačno jednak celini.",
    "reading-time":
      "Računa koliko traje čitanje teksta naglas pri tempu koji upišeš, pasus po pasus, sa " +
      "vremenom ulaska svakog pasusa.",
    "rebar-weight":
      "Pretvara prečnik, dužinu i broj šipki u kilograme, i kilograme nazad u metre i cele šipke.",
    "rebate-chain":
      "Sklapa niz uzastopnih rabata u jedan efektivni i daje neto cenu posle svih.",
    "recipe-scale":
      "Preračunava ceo spisak sastojaka na drugi broj porcija, na zadati faktor ili na ciljanu " +
      "ukupnu masu, uz čitanje razlomaka i zaokruživanje na zadati korak.",
    "reefer-fuel-consumption":
      "Iz sati rada agregata i potrošnje po režimu daje utrošeno gorivo, cenu i sate rada koje " +
      "pokriva gorivo u rezervoaru.",
    "rent-escalation":
      "Primenjuje indeks koji unesete na zakupninu iz perioda u period i daje iznos po periodu, " +
      "zbir i sadašnju vrednost zakupa.",
    "rent-gross-net":
      "Preračunava ugovoreni iznos u iznos koji ostaje i nazad, po procentu priznatih troškova i " +
      "stopi koje sami unosite.",
    "rental-yield":
      "Iz cene, zakupnine i troškova koje unesete daje neto prihod, bruto i neto prinos i period " +
      "povraćaja; ili vrednost iz zadate stope.",
    "resistor-colour-code":
      "Čita vrednost otpornika iz prstenova i vraća prstenove za zadatu vrednost, sa " +
      "tolerancijom, opsegom i najbližom vrednošću iz E-niza.",
    "reverb-time":
      "Računa RT60 po Sabineovoj i po Eyringovoj formuli iz zapremine prostorije i površina sa " +
      "upisanim koeficijentima apsorpcije.",
    "rigging-sling-angle-force":
      "Za masu tereta, broj krakova i ugao vešanja računa silu po kraku, horizontalnu komponentu " +
      "i faktor ugla, uključujući nesimetričan zahvat u dve tačke.",
    "rlc-impedance":
      "Za R, L i C na zadatoj frekvenciji računa reaktanse, impedansu i fazni ugao, pa " +
      "rezonantnu i graničnu frekvenciju.",
    "rok-poslednji-dan":
      "Računa poslednji dan roka iz unetog početnog datuma i unete dužine, uz pravilo pomeranja " +
      "sa neradnog dana koje korisnik sam bira.",
    "roll-yield":
      "Koliko dužnih metara rolne odlazi na zadati tiraž, koliko komada staje u širinu i da li " +
      "se isplati okrenuti komad za 90°.",
    "roof-pitch":
      "Iz nagiba i osnove daje visinu do slemena, dužinu roga, stvarnu površinu krovne ravni i " +
      "dužinu grbine.",
    "room-modes":
      "Iz dimenzija prostorije računa aksijalne, tangencijalne i kose sopstvene modove po " +
      "Rejlijevoj jednačini i pokazuje gde se gomilaju.",
    "room-quad-area":
      "Iz četiri izmerene stranice i jedne dijagonale daje površinu prostorije i ugao u uglu, " +
      "jer soba retko jeste pravougaonik.",
    "room-surfaces":
      "Iz mera prostorije i spiska otvora daje neto zidnu površinu, plafon, špaletne i potrebnu " +
      "količinu materijala.",
    "run-of-show":
      "Iz trajanja tačaka, prelaza između njih i tačaka zakovanih za tačan sat pravi satnicu " +
      "unapred i unazad i pokazuje praznine i prekoračenje.",
    "running-pace-splits":
      "Iz bilo koja dva podatka — distance, vremena i tempa — daje treći, sa tempom po " +
      "kilometru, milji i sto metara i tabelom ravnomernih međuvremena.",
    "saddle-stitch-imposition":
      "Koje dve strane idu na koju stranu tabaka kod klamovane knjižice, koliko tabaka treba i " +
      "koliko praznih strana ostaje.",
    "sample-buffer-latency":
      "Pretvara odbirke, milisekunde i veličinu bafera pri zadatoj frekvenciji odabiranja i daje " +
      "kašnjenje u jednom i u oba smera.",
    "scale-chord-speller":
      "Za zadati osnovni ton ispisuje tonove skale ili akorda po slovnom redosledu, sa " +
      "intervalima, brojem predznaka i trozvucima na stupnjevima.",
    "seating-tables":
      "Iz broja gostiju i mere stola računa koliko gostiju staje za sto, koliko stolova treba i " +
      "koliku površinu zauzimaju sa stolicama i prolazom.",
    "section-modulus":
      "Za pravougaonik, krug, cev, pravougaonu cev i I-profil računa površinu, momente inercije, " +
      "otporne momente, poluprečnike inercije i polarne veličine.",
    "seeding-rate":
      "Koliko kilograma semena po hektaru daje uneti sklop biljaka pri izmerenoj masi 1000 zrna, " +
      "klijavosti i čistoći, i koliko semena treba za celu parcelu.",
    "sentence-length":
      "Deli tekst na rečenice po napisanom pravilu i pokazuje koje su duže od zadatog broja reči.",
    "serbian-transliteration":
      "Prebacuje srpski tekst iz ćirilice u latinicu i nazad, uz spisak svih mesta na kojima je " +
      "nj, lj ili dž dvosmisleno.",
    "series-parallel-network":
      "Sabira otpornike, kalemove i kondenzatore u rednoj i paralelnoj vezi i računa naponski " +
      "delilac sa snagom po elementu.",
    "service-interval-km-hours":
      "Poredi interval po kilometrima, motočasovima i mesecima i daje koji od njih prvi ističe i " +
      "kog datuma.",
    "set-tempo-tut":
      "Iz tempa u četiri broja (npr. 3-1-1-0) i broja ponavljanja daje vreme pod opterećenjem po " +
      "seriji i ukupno trajanje bloka sa pauzama.",
    "share-allocation":
      "Deli iznos po udelima tako da zbir delova bude tačno jednak celini, do poslednje pare.",
    "sheet-imposition":
      "Koliko komada zadate veličine staje na tabak sa marginama i razmakom za rez, u oba " +
      "položaja, i koliki je otpad.",
    "sheet-metal-bend":
      "Razvijena dužina i položaji linija savijanja iz spoljnih mera, radijusa i K-faktora, uz " +
      "obrnuti račun K-faktora iz izmerenog uzorka.",
    "shelf-deflection":
      "Ugib i napon u polici na dva oslonca pri unetom opterećenju, modulu elastičnosti i " +
      "preseku, sa granicom koju korisnik sam unese.",
    "shelf-spacing":
      "Jednaki svetli otvori između polica sa uračunatom debljinom, položaji polica i najbliži " +
      "otvori u rasteru bušenja.",
    "simple-interest-days":
      "Prosta kamata na iznos između dva datuma, po stopi i osnovi brojanja dana koje sam unosiš.",
    "slope-grade":
      "Iz bilo koja dva podatka — dužine, visinske razlike ili nagiba — daje ostale, i nagib u " +
      "procentu, promilu, stepenu i odnosu 1:n.",
    "smpte-timecode":
      "Sabira i oduzima tajmkod i pretvara ga u kadrove i u proteklo vreme, uključujući " +
      "drop-frame notaciju.",
    "solution-concentration":
      "Jedan bilans mase za četiri pitanja: mešanje dve smese do ciljane koncentracije, " +
      "razblaživanje, ukuvavanje i dodavanje čistog sastojka, sve u procentima po masi.",
    "sound-wavelength":
      "Za zadatu frekvenciju i temperaturu vazduha daje brzinu zvuka, talasnu dužinu i njenu " +
      "četvrtinu, i kašnjenje po pređenom rastojanju.",
    "speaker-load":
      "Za zvučnike vezane paralelno ili redno daje ukupnu impedansu i koliko snage dobija svaka " +
      "kutija.",
    "speedometer-tyre-deviation":
      "Pri promeni dimenzije gume računa stvarnu brzinu, grešku kilometraže i promenu visine " +
      "vozila.",
    "spl-distance":
      "Koliki je nivo zvučnog pritiska na zadatoj udaljenosti za upisanu osetljivost kutije i " +
      "snagu, i koliko se gubi udvostručavanjem rastojanja.",
    "split-into-groups":
      "Deli odeljenje na grupe — na zadati broj grupa ili na grupe zadate veličine — tako da su " +
      "veličine najravnomernije moguće i da se zbir poklopi sa brojem učenika.",
    "split-times-fatigue":
      "Iz spiska izmerenih vremena daje zbir, prosek, medijanu, najbolje i najslabije, indeks " +
      "zamora i procenat pada kroz ponovljene sprintove.",
    "sprayer-calibration":
      "Iz izmerenog protoka dizne, brzine kretanja i razmaka dizni daje normu prskanja u litrima " +
      "po hektaru, i obrnuto — koliki protok dizne traži norma koju je korisnik uneo.",
    "square-check":
      "Iz dve stranice i izmerene dijagonale daje odstupanje ugla od pravog i pomeranje tačke u " +
      "milimetrima.",
    "stage-deck-layout":
      "Iz mera bine i modula podesta računa broj podesta u obe orijentacije, površinu, obim sa " +
      "zavesom i ravnomerno opterećenje po m².",
    "stair-geometry":
      "Iz spratne visine i broja stepenika daje visinu stepenika, broj gazišta, ukupan hod, " +
      "nagib i vrednost 2r + g.",
    "standard-score":
      "Pretvara sirov bod u z-vrednost i T-bod prema sredini i standardnoj devijaciji koje " +
      "korisnik upiše, i vraća sirov bod za zadatu z-vrednost.",
    "strane-teksta":
      "Koliko obračunskih strana nosi tekst pri unetom broju karaktera po strani, i koliki je " +
      "iznos po unetoj ceni.",
    "subtitle-audit":
      "Meri svaki titl i pokazuje izmerenu vrednost pored granice koju si sam upisao: dužina " +
      "reda, broj redova, trajanje, znakova u sekundi i razmak do sledećeg.",
    "subtitle-retime":
      "Pomera sve vremenske oznake u SRT ili VTT titlu i preračunava ih za drugi broj slika u " +
      "sekundi.",
    "survey-bearing-distance":
      "Iz dve tačke daje dužinu i direkcioni ugao, a iz tačke, ugla i dužine daje koordinate " +
      "nove tačke.",
    "suvlasnicki-udeli":
      "Da li uneti idealni delovi daju tačno celinu, koliko su na zajedničkom imeniocu i koliko " +
      "kvadrata svaki nosi.",
    "sweat-rate-hydration":
      "Iz mase pre i posle treninga, popijene tečnosti i trajanja računa gubitak znojem, stopu " +
      "znojenja po satu i procenat izgubljene telesne mase.",
    "tank-mix-dose":
      "Preračunava unetu dozu preparata sa hektara na jedno punjenje rezervoara i daje ukupne " +
      "količine preparata i vode za unetu površinu.",
    "tank-volume-by-level":
      "Iz izmerenog nivoa u ležećem ili stojećem rezervoaru daje zapreminu, masu i popunjenost.",
    "tap-drill-size":
      "Prečnik burgije za urezivanje navoja pri zadatom procentu zahvata, procenat zahvata za " +
      "burgiju koju imate i prečnik prolazne rupe.",
    "tax-id-check":
      "Računa kontrolnu cifru po postupku MOD 11,10 i poredi je sa poslednjom cifrom unetog broja.",
    "tent-bay-layout":
      "Iz potrebne natkrivene površine i modula šatora računa broj polja, dužinu, gabarit sa " +
      "zategama i površinu krova i stranica.",
    "test-printing":
      "Za broj strana testa i broj primeraka računa koliko listova papira treba, koliko poleđina " +
      "ostaje prazno, koliko se pakovanja otvara i koliki je iznos po ceni lista koju korisnik " +
      "upiše.",
    "three-phase-load-balance":
      "Iz spiska potrošača raspoređenih po fazama računa struju svake faze, struju nule, " +
      "nesimetriju i zbirnu prividnu snagu.",
    "three-phase-power":
      "Povezuje linijsku struju, prividnu, aktivnu i reaktivnu snagu preko faktora snage, u " +
      "jednofaznoj i trofaznoj mreži.",
    "tiered-commission":
      "Računa proviziju po skali koju sam unosiš — marginalno po tranšama ili jednom stopom na " +
      "ceo iznos.",
    "tile-count":
      "Iz površine i formata komada, sa spojnicom i rasturom, daje broj komada, broj kutija i " +
      "komada po kvadratu.",
    "timber-volume":
      "Zapremina trupca po Huberu ili Smalianu, zapremina rezane građe po komadu i ukupno, " +
      "preračun prostornog u kubni metar i masa po unetoj gustini.",
    "timelapse-planner":
      "Povezuje interval, broj kadrova, trajanje snimanja i dužinu gotovog klipa, uz faktor " +
      "ubrzanja.",
    "topic-hour-allocation":
      "Raspodeljuje ukupan fond časova na nastavne teme po zadatim udelima, celim brojevima koji " +
      "se sabiraju u zadati fond.",
    "torque-speed-power":
      "Povezuje obrtni moment, snagu i broj obrtaja i prikazuje ih u N·m, kgf·m, lbf·ft, W, kW, " +
      "KS i hp.",
    "training-volume-load":
      "Iz redova programa (serije × ponavljanja × kilogrami) sabira ponavljanja i tonažu i daje " +
      "prosečno opterećenje po ponavljanju, a uz unet 1RM i prosečan intenzitet u procentima.",
    "translation-volume":
      "Broji znakove, reči i prevodilačke strane u nalepljenom tekstu i množi ih cenom koju " +
      "upišeš.",
    "transposition":
      "Transponuje upisane tonove ili akordske oznake za zadati interval, ili između štima " +
      "transponujućih instrumenata i realnog zvuka.",
    "trench-volume":
      "Iz dubine, širine dna i unetog nagiba kosina daje zapreminu iskopa, zasipanja i viška " +
      "zemlje za odvoz.",
    "trial-balance-check":
      "Sabira dugovnu i potražnu stranu, prikazuje razliku i nabraja greške koje bi aritmetički " +
      "dale tačno tu razliku.",
    "trip-cost-quote":
      "Sabira kilometražu, putarine, dnevnice i čekanje u cenu koštanja ture i iz marže daje " +
      "cenu prevoza.",
    "troskovi-srazmerno-uspehu":
      "Koliki je odnos usvojenog i traženog iznosa i koliki srazmerni deo svojih troškova nosi " +
      "svaka strana po tom odnosu.",
    "truss-hoist-reactions":
      "Za trasu obešenu o dve tačke računa silu na svakoj tački od sopstvene težine i " +
      "pojedinačnih tereta, položaj težišta i moguće podizanje kraja.",
    "tvm-solver":
      "Iz četiri poznate veličine — sadašnja vrednost, buduća vrednost, rata, broj perioda, " +
      "periodična stopa — računa petu.",
    "typography-cleanup":
      "Ispravlja navodnike, crte, tri tačke i razmake u nalepljenom tekstu i prebrojava svaku " +
      "izmenu po pravilu.",
    "ugovorna-kazna":
      "Koliko iznosi penal za dane docnje po unetoj dnevnoj stopi i kog dana docnje se dostiže " +
      "uneto ograničenje.",
    "unwrap-paragraphs":
      "Spaja redove prelomljene kopiranjem iz PDF-a natrag u pasuse i sastavlja reči rastavljene " +
      "crticom na kraju reda.",
    "us-customary-kitchen-units":
      "Pretvara šoljice, unce, funte, pinte i stepene Farenhajta iz stranih recepata u " +
      "mililitre, grame i stepene Celzijusa, i odbija da pretvori zapreminu u masu bez gustine.",
    "varispeed-repitch":
      "Kada se semplu promeni visina ili se snimak sviran na jednoj frekvenciji odsvira na " +
      "drugoj — daje odnos brzine, dobijeni tempo, dobijeno trajanje i pomeraj u centima.",
    "venue-occupancy-area":
      "Od bruto površine i oduzetih zona računa neto površinu i broj osoba za gustinu koju " +
      "korisnik unese, po svakom rasporedu posebno.",
    "video-bitrate-storage":
      "Veže bitrejt, trajanje i veličinu fajla i računa koliko snimka staje na karticu ili disk " +
      "zadatog kapaciteta.",
    "voltage-drop":
      "Za zadati presek, dužinu i struju računa otpornost voda, pad napona u voltima i " +
      "procentima i gubitak snage.",
    "wall-ceiling-area":
      "Računa neto površinu zidova i plafona uz odbitak otvora i količinu materijala po " +
      "izdašnosti koju unesete.",
    "wall-u-value":
      "Sabira otpore slojeva zida ili krova u ukupan R i U i daje temperaturu na svakom dodiru " +
      "slojeva.",
    "wallpaper-rolls":
      "Iz obima zida, visine i raporta daje broj traka, dužinu jedne trake, koliko traka izlazi " +
      "iz rolne i koliko rolni treba.",
    "weight-class-cut":
      "Koliko kilograma i koliko procenata telesne mase deli takmičara od unete granice " +
      "kategorije i koliko je to prosečno po danu i po nedelji do vaganja.",
    "weighted-area":
      "Sabira površine delova stana pomnožene koeficijentima koje unesete i daje obračunsku " +
      "kvadraturu i cenu.",
    "weighted-grade":
      "Sabira komponente ocenjivanja koje imaju različit maksimum i različitu težinu u jedan " +
      "ukupan procenat i računa koliko bodova nedostaje na preostaloj komponenti za željeni " +
      "ukupan rezultat.",
    "weld-consumable":
      "Masa navara i potrebnog dodatnog materijala iz preseka šava i dužine, sa dužinom žice ili " +
      "brojem elektroda.",
    "wood-moisture-movement":
      "Koliko se dimenzija drveta promeni pri promeni vlažnosti i koliki zazor ostaje za " +
      "očekivani raspon vlage u prostoriji.",
    "word-frequency":
      "Broji koliko se puta svaka reč ili fraza od n reči ponavlja u tekstu i koliki je to udeo.",
    "yield-estimate-samples":
      "Iz brojanja na uzorcima — klasova po kvadratu, zrna po klasu i mase 1000 zrna, ili mase " +
      "požnjevenog uzorka — daje procenjen prinos po hektaru i rasipanje između uzoraka.",
    "yield-trim-cook":
      "Od bruto nabavke, kroz kalo čišćenja i kalo termičke obrade, daje broj porcija i cenu " +
      "porcije, i obrnuto — koliko bruto treba kupiti za zadati broj porcija.",
    "zbir-perioda":
      "Koliko ukupno dana daje niz perioda, kako se taj zbir razlaže na godine, mesece i dane, i " +
      "gde se periodi preklapaju.",
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
      "Definicija AWG niza (AWG 36 = 0,005 in, 4/0 = 0,4600 in, 39 geometrijskih koraka) po ASTM " +
      "B258-18; specifične otpornosti po IEC 60028:1925 (bakar) i IEC 60889:1987 (aluminijum).",
    "austrian-metrication-1871":
      "Austrougarska metrikacija (Austrija: zakon iz 1871, u primeni od 1876): 1 bečki hvat = " +
      "1,896484 m, 1 katastarsko jutro = 1600 kvadratnih hvati = 5754,6425 m².",
    "cabinet-hole-raster-system-32":
      "Raster od 32 mm je konvencija sistema 32 za korpusni nameštaj (razmak otvora na bočnoj " +
      "strani). Rastojanje prvog otvora od donje ivice nije deo te konvencije — razlikuje se po " +
      "šabloni i okovu, pa ga korisnik unosi.",
    "cie-colour-difference":
      "CIE 142-2001 / ISO/CIE 11664-6:2014 (CIEDE2000), CIE 116-1995 (ΔE94), CIE 15 (CIELAB), " +
      "IEC 61966-2-1:1999 (sRGB)",
    "concept2-pace-watts":
      "Concept2 — objavljena relacija između tempa i snage za performance monitor: vati = " +
      "2,80/(sekunde po metru)³, sa splitom na 500 m kao jedinicom prikaza.",
    "css-units-and-android-dp":
      "CSS Values and Units Module Level 3 (W3C) za px, pt, pc i Q; Android dokumentacija za dp " +
      "(osnovna gustina 160 dpi)",
    "fuel-fluid-densities":
      "Gustine: EN 590:2022 (dizel 820,0 do 845,0 kg/m³ na 15 °C) i ISO 22241-1:2019 (AUS 32 / " +
      "AdBlue 1,087 do 1,093 kg/l na 20 °C).",
    "iec-60028-1925-iec-60889-1987":
      "Specifične otpornosti i temperaturni koeficijenti: IEC 60028:1925 (bakar, 1/58 Ω·mm²/m na " +
      "20 °C) i IEC 60889:1987 (tvrdo vučeni aluminijum, 28,264 nΩ·m na 20 °C).",
    "iec-60062-2016-iec-60063-2015":
      "Kodiranje boja po IEC 60062:2016 (sa izmenom A1:2019); nizovi preferiranih vrednosti E6, " +
      "E12 i E24 po IEC 60063:2015.",
    "iec-60228-60287-conductor-constants":
      "IEC 60228, izdanje 3 (2004) — konvencionalne otpornosti provodnika (bakar 1/58, " +
      "aluminijum 1/35,38 Ω·mm²/m); IEC 60287-1-1, izdanje 2.1 (2014) — otpornosti na 20 °C i " +
      "temperaturni koeficijenti α₂₀ (bakar 3,93·10⁻³, aluminijum 4,03·10⁻³ 1/K)",
    "international-foot-1959":
      "Međunarodni sporazum o jardu i funti (1959) — 1 ft = 0,3048 m tačno, odakle 1 fc = " +
      "10,763910416709722 lx.",
    "isbn-issn-ismn-ean-check-digits":
      "ISO 2108:2017 (ISBN), ISO 3297:2022 (ISSN), ISO 10957:2009 (ISMN) i GS1 General " +
      "Specifications — algoritam kontrolne cifre.",
    "isda-2006-30e-360":
      "Osnovica 30E/360 je imenovana konvencija brojanja dana (Eurobond basis) po ISDA 2006 " +
      "Definitions, odeljak 4.16; birate je izričito, alatka je ne bira umesto vas.",
    "isda-2006-day-count":
      "Konvencije brojanja dana: 2006 ISDA Definitions, odeljak 4.16 (ACT/365 Fixed, ACT/360, " +
      "30E/360 Eurobond Basis).",
    "isda-2006-daycount":
      "Bankarska godina od 360 dana: ISDA 2006 Definitions, odeljak 4.16; kalendarska godina od " +
      "365 dana je podrazumevana.",
    "iso-1007-135-format":
      "ISO 1007:2000 — format 135, slika 36 × 24 mm (referentni kadar).",
    "iso-13616-1-2020":
      "ISO 13616-1:2020 — Financial services, IBAN, Part 1: Structure of the IBAN; kontrolne " +
      "cifre po ISO/IEC 7064:2003 MOD 97-10.",
    "iso-13616-iban":
      "IBAN: ISO 13616-1:2020. Kontrolne cifre: ISO 7064:2003 (MOD 97-10). Domaći račun 3-13-2: " +
      "jedinstveni 18-cifreni oblik računa u dinarskom platnom prometu (NBS, u primeni od 2003).",
    "iso-16-1975":
      "Referentni ton A4 = 440 Hz: ISO 16:1975 (Acoustics — Standard tuning frequency). " +
      "Numeracija nota: MIDI 1.0 Detailed Specification, verzija 4.2 (MMA, 1996).",
    "iso-216-iso-5455":
      "Formati lista: ISO 216:2007, A-serija. Niz razmera: ISO 5455:1979.",
    "iso-216-paper-series":
      "ISO 216:2007 (serije A i B) i ISO 269:1985 (serija C, koverte)",
    "iso-286-1-2010":
      "Tolerancije i osnovna odstupanja: ISO 286-1:2010 (opseg 1–500 mm).",
    "iso-68-1-1998-iso-898-1-2013":
      "Geometrija profila po ISO 68-1:1998; definicija preseka napona A_s po ISO 898-1:2013.",
    "iso-7064-13616":
      "ISO 7064:2003 (MOD 97-10) i ISO 13616-1:2020 (struktura IBAN-a); struktura domaćeg računa " +
      "3+13+2 je format platnog prometa. Alatka koristi aritmetiku tih standarda i ne tvrdi " +
      "usklađenost sa njima.",
    "iso-7064-jmbg":
      "Kontrolna cifra PIB-a i matičnog broja: ISO 7064:2003, MOD 11,10. Kontrolna cifra JMBG-a: " +
      "struktura broja propisana Zakonom o jedinstvenom matičnom broju građana („Sl. glasnik RS“ " +
      "br. 24/2011), težine 7,6,5,4,3,2 i modul 11 deo su te strukture od uvođenja broja 1976.",
    "iso-8601-2019-weekday":
      "Numeracija dana u nedelji: ISO 8601-1:2019 (1 = ponedeljak … 7 = nedelja).",
    "iso-9-1995-serbian":
      "ISO 9:1995 (preslovljavanje ćirilice u latinicu), srpski redovi — 30 parova slova.",
    "iso-iec-15420-ean-upc":
      "ISO/IEC 15420:2009 — simbologija EAN/UPC: broj modula, nominalna X-dimenzija i visine; " +
      "kontrolna cifra po istom algoritmu kao u opštim specifikacijama GS1",
    "iso-iec-7064-2003":
      "ISO/IEC 7064:2003 — Information technology, Security techniques, Check character systems; " +
      "postupak MOD 97-10.",
    "iso-metric-thread-261-273-68":
      "Koraci navoja: ISO 261:1998. Profil i prečnik jezgra: ISO 68-1:1998. Prolazne rupe: ISO " +
      "273:1979 (fina, srednja i gruba serija). Procenat zahvata je radionička konvencija koju " +
      "bira korisnik i ne stoji ni u jednom od ta tri standarda.",
    "jmbg-check-digit":
      "Struktura JMBG-a (13 cifara, ponderi 7,6,5,4,3,2 ponovljeni dvaput, modul 11) — Zakon o " +
      "jedinstvenom matičnom broju građana (SFRJ); struktura nepromenjena od uvođenja registra. " +
      "Alatka koristi samo tu aritmetiku i ne tvrdi usklađenost sa propisom.",
    "mccall-t-score-1922":
      "T-skala (sredina 50, standardna devijacija 10) po: W. A. McCall, How to Measure in " +
      "Education, 1922.",
    "ntsc-1000-1001-rates":
      "SMPTE ST 170M-2004 i SMPTE ST 12-1:2014 — odnos 1000/1001 i tačni razlomci 24000/1001, " +
      "30000/1001, 60000/1001.",
    "one-rep-max-formulas":
      "Epli: Boyd Epley, „Poundage Chart“, Body Enterprises, Linkoln, 1985. Bžicki: Matt " +
      "Brzycki, JOPERD 64(1), 1993. Brojevi 30 i 36/37 pripadaju samim objavljenim formulama.",
    "pallet-footprints":
      "Mere paleta: EN 13698-1:2003 (EUR paleta 800 × 1200 mm) i ISO 6780:2003 (industrijska " +
      "paleta 1000 × 1200 mm).",
    "riff-wave-1991":
      "Zaglavlje WAV od 44 bajta: Multimedia Programming Interface and Data Specifications 1.0 " +
      "(IBM/Microsoft, avgust 1991), slučaj PCM sa fmt blokom od 16 bajtova. Prefiksi " +
      "MB/MiB/GB/GiB: IEC 80000-13:2008.",
    "serbian-numerals":
      "Srpski brojevi i slaganje imenice uz broj — Pravopis srpskoga jezika, Matica srpska, " +
      "izmenjeno i dopunjeno izdanje (2010).",
    "serbian-numerals-orthography":
      "Pravopis srpskoga jezika, Matica srpska (izmenjeno i dopunjeno izdanje, 2010) — pisanje " +
      "brojeva i slaganje uz hiljadu, milion i milijardu.",
    "smpte-broadcast-frame-rates":
      "SMPTE ST 12-1:2014 i SMPTE ST 170M-2004 — nominalne brzine kadrova (24000/1001, " +
      "30000/1001, 60000/1001 kao tačni razlomci).",
    "smpte-st-12-1-2014":
      "SMPTE ST 12-1:2014 — tačne brzine 24000/1001, 30000/1001 i 60000/1001 kao odnosi celih " +
      "brojeva.",
    "smpte-st-12-1-timecode":
      "SMPTE ST 12-1:2014 — tajmkod i drop-frame notacija; SMPTE ST 170M-2004 za tačne razlomke " +
      "30000/1001 i 60000/1001.",
    "smpte-st-2084-pq":
      "SMPTE ST 2084:2014 i ITU-R BT.2100-2 (2018) — PQ prenosna funkcija i kvantizacija signala.",
    "sr-numerals-pravopis-2010":
      "Brojevne reči i slaganje po rodu i broju: Pravopis srpskoga jezika, Matica srpska, " +
      "izmenjeno i dopunjeno izdanje (2010).",
    "steel-nominal-density":
      "Konvencionalna gustina 7,85 kg/dm³ za nominalnu masu armature po EN 10080:2005 i ISO " +
      "6935-2:2019.",
    "unicode-16-code-charts":
      "Unicode Standard 16.0 (2024) — Code Charts i Unicode Character Encoding Stability " +
      "Policies; dodeljena kodna tačka se ne menja ni u jednom kasnijem izdanju.",
    "unicode-white-space":
      "Unicode Standard 17.0 — PropList.txt, svojstvo White_Space; u praksi se primenjuje " +
      "verzija Unicode tabele koju nosi izvršno okruženje aplikacije.",
    "us-imperial-unit-definitions":
      "Vrednosti su tačne po definiciji: Međunarodni sporazum o jardu i funti (1959) za funtu i " +
      "inč, i Weights and Measures Act 1985 (Ujedinjeno Kraljevstvo) za imperijalni galon.",
    "usda-wood-handbook-2021":
      "Tačka zasićenja vlakana (nominalno 30 %): USDA Wood Handbook, FPL-GTR-282 (2021), pogl. " +
      "4. Koeficijent skupljanja za vrstu i pravac unosi korisnik.",
    "whatwg-encoding-standard":
      "WHATWG Encoding Standard (Living Standard) — indeksne tabele windows-1250, windows-1252 i " +
      "iso-8859-2; UTF-8 po RFC 3629. Tabele čita platforma, ne prepisuju se u kod.",
  },

  /* One group per TOOLKIT — see the header. */
  gradnja: PRO_GRADNJA_SR,
  inzenjering: PRO_INZENJERING_SR,
  dizajn: PRO_DIZAJN_SR,
  foto: PRO_FOTO_SR,
  muzika: PRO_MUZIKA_SR,
  prosveta: PRO_PROSVETA_SR,
  tekst: PRO_TEKST_SR,
  trening: PRO_TRENING_SR,
  kuhinja: PRO_KUHINJA_SR,
  pravo: PRO_PRAVO_SR,
  racunovodstvo: PRO_RACUNOVODSTVO_SR,
  biznis: PRO_BIZNIS_SR,
  nekretnine: PRO_NEKRETNINE_SR,
  transport: PRO_TRANSPORT_SR,
  agro: PRO_AGRO_SR,
  zanat: PRO_ZANAT_SR,
  event: PRO_EVENT_SR,
} as const;
