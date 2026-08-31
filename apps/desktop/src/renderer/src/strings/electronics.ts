/**
 * „Elektronika" — the workbench's own copy (ELEC, migration 067).
 *
 * A group of its own rather than another section of `strings.sr.ts`, on
 * `strings/pro.ts`' terms: this is one module's whole vocabulary, and four of
 * its tables are keyed by a closed list `@nexus/core` owns — component kinds,
 * pin functions, bus kinds, wire colours. Each is declared `satisfies
 * Record<…, string>`, so a member added to the model is a compile error here
 * rather than a blank label on the screen.
 *
 * Nothing here is a second copy layer. This is one leaf of the same table —
 * `strings.sr.ts` spreads it in as `electronics`, `strings.ts` clones the whole
 * thing, and the locale switch rewrites these leaves exactly as it rewrites the
 * rest. A consumer reads `strings.electronics.…` and never imports this file.
 */

import type {
  BusKind,
  CircuitProblemCode,
  ComponentKind,
  PinFunction,
  RuleCode,
  RuleSeverity,
  ValueUnit,
  WireColour,
} from "@nexus/core";

export const electronicsSr = {
  /** Above the circuit list. Names the SECTION, not the sidebar entry — `strings.modules` owns that. */
  circuitsLabel: "Kola",
  /** The second line of a row in the circuit list: „izmenjeno 14:32". CANV's idiom, for its reason. */
  circuitUpdatedPrefix: "izmenjeno",
  /** The circuit a profile gets the first time it opens the page — an empty-state button whose only answer is „napravi kolo" is not a question. */
  firstCircuitName: "Kolo",
  newCircuit: "Novo kolo",
  nameLabel: "Naziv kola",
  namePlaceholder: "Stanica za vlažnost",
  save: "Sačuvaj",
  cancel: "Otkaži",
  rename: "Preimenuj",
  delete: "Obriši",
  undo: "Opozovi",
  deletedNotice: "Kolo je obrisano.",
  dismiss: "Zatvori",
  loadErrorTitle: "Kola nisu učitana",
  loadError: "Učitavanje kola nije uspelo. Zatvori i ponovo otvori stranicu.",
  actionError: "Radnja nije uspela. Pokušaj ponovo.",
  emptyTitle: "Još nema nijednog kola",
  emptyDescription: "Napravi kolo, izaberi ploču i poveži senzore na nju.",

  /** The component drawer down the left side. */
  palette: {
    title: "Komponente",
    searchLabel: "Pretraga komponenti",
    searchPlaceholder: "Naziv, opis ili protokol",
    /** The query matched nothing. Says what to do next, because „0 rezultata" does not. */
    empty: "Nijedna komponenta ne odgovara pretrazi. Probaj kraći pojam.",
    /** On each row — the row IS the button, so this is what a screen reader reads before the name. */
    add: "Dodaj u kolo",
    /** „24 pina" — the three Serbian forms, because „pin"/„pina" does not collapse into two. */
    pinsOne: "pin",
    pinsFew: "pina",
    pinsMany: "pinova",
    /** „3,3–5 V" on the row's meta line, when the part has a supply to state. */
    supplyPrefix: "napajanje",
    /**
     * The eight sections, keyed by `ComponentKind`. Plural, because each names a
     * SHELF rather than a single part.
     */
    kinds: {
      board: "Ploče",
      sensor: "Senzori",
      actuator: "Aktuatori",
      driver: "Drajveri i pojačavači",
      display: "Ekrani",
      comms: "Komunikacija",
      power: "Napajanje",
      passive: "Pasivne komponente",
    } satisfies Record<ComponentKind, string>,
  },

  /** The workbench itself. */
  bench: {
    label: "Radna površina",
    zoomIn: "Uvećaj",
    zoomOut: "Umanji",
    /** Frames everything on the circuit — „prilagodi", not „resetuj": nothing is undone. */
    zoomFit: "Prilagodi prikaz",
    /** Live, beside the zoom controls: „120 %". */
    zoomLabel: "Uvećanje",
    wireColourLabel: "Boja žice",
    /**
     * The nine jumper colours by name (DEV-006). Lower-case: they are read as
     * „crvena žica", never as a heading, and they are what an engineer says out
     * loud — which is the whole reason the palette keeps the trade's own hues.
     */
    colours: {
      red: "crvena",
      black: "crna",
      yellow: "žuta",
      green: "zelena",
      blue: "plava",
      white: "bela",
      orange: "narandžasta",
      brown: "braon",
      grey: "siva",
    } satisfies Record<WireColour, string>,
    /** Nothing armed: what a click on a pin will do. */
    wiringIdle: "Klikni na pin da počneš žicu.",
    /** One end armed: what the next click does, and how to change your mind. */
    wiringArmed: "Izaberi drugi pin da povežeš žicu. Esc otkazuje.",
    /** The refusal the canvas can make on its own, before any write. */
    wiringSelf: "Žica ne može da spoji pin sam sa sobom.",
    /** A part whose component this build does not ship — drawn as a dashed placeholder. */
    unknownPart: "Nepoznata komponenta",
    /** Empty bench, with a circuit open. */
    emptyTitle: "Prazna radna površina",
    emptyDescription: "Izaberi komponentu sa leve strane da je postaviš u kolo.",
  },

  /** The panel on the right: whatever is selected, or the circuit itself. */
  inspector: {
    circuitTitle: "O kolu",
    partTitle: "Komponenta",
    wireTitle: "Žica",
    /** The circuit's own note. One field, saved by its own button — never as you type. */
    notesLabel: "Beleška",
    notesPlaceholder: "Šta ovo kolo radi, na čemu je ostalo.",
    notesSave: "Sačuvaj belešku",
    notesSaved: "Beleška je sačuvana.",
    /** The two counts under the circuit's name. Both take all three Serbian forms. */
    partsOne: "komponenta",
    partsFew: "komponente",
    partsMany: "komponenti",
    wiresOne: "žica",
    wiresFew: "žice",
    wiresMany: "žica",
    /** The part's own name on the schematic — empty falls back to the component's. */
    labelField: "Naziv u kolu",
    labelPlaceholder: "levi motor",
    rotate: "Zarotiraj",
    /** „90°" beside the rotate button. */
    rotationLabel: "Ugao",
    removePart: "Ukloni komponentu",
    /** Said before it happens, because removing a part takes its wires with it. */
    removePartHint: "Uklanja i sve žice koje idu na nju.",
    removeWire: "Ukloni žicu",
    /**
     * The value field, labelled by what the component actually measures. One
     * entry per `valueUnit` the model admits; the unit is in the label rather
     * than in the field, so the number the user types is the number stored.
     */
    valueLabels: {
      ohm: "Otpornost (Ω)",
      farad: "Kapacitivnost (F)",
      henry: "Induktivnost (H)",
      volt: "Napon (V)",
      ampere: "Struja (A)",
    } satisfies Record<ValueUnit, string>,
    /** The refusal a value field can make on its own. */
    valueInvalid: "Vrednost mora biti broj veći od nule.",
    /** What the catalogue says about the selected part's component. */
    componentHeading: "O komponenti",
    supplyLabel: "Napajanje",
    currentLabel: "Potrošnja",
    /** „tipično 1,5 mA · najviše 120 mA" — two figures, said as two. */
    currentTypical: "tipično",
    currentPeak: "najviše",
    libraryLabel: "Biblioteka",
    busesLabel: "Protokoli",
    /** I²C addresses, printed in hex the way a datasheet prints them. */
    addressesLabel: "Adrese",
    logicLabel: "Logički nivo",
    pinsHeading: "Pinovi",
    /** Under a pin that has a wire on it, in place of „slobodno". */
    pinConnected: "povezano",
    pinFree: "slobodno",
    /** The wire's two ends: „ARDUINO UNO · D9". */
    wireFrom: "Sa",
    wireTo: "Na",
    wireColour: "Boja",
    /** Nothing selected and no circuit open. */
    emptyTitle: "Ništa nije izabrano",
    emptyDescription: "Klikni na komponentu ili žicu da vidiš njene podatke.",
    /**
     * Every protocol name, keyed by `BusKind`. Printed as the trade prints them
     * — „I²C" with the superscript, because that is what is on the datasheet.
     */
    buses: {
      i2c: "I²C",
      spi: "SPI",
      uart: "UART",
      onewire: "1-Wire",
    } satisfies Record<BusKind, string>,
    /**
     * What a pin can do, keyed by `PinFunction`.
     *
     * Lower-case and Serbian where Serbian has a word for it, and the protocol's
     * own name where it does not: nobody calls MOSI „glavni izlaz, sporedni
     * ulaz", and translating it would make the label harder to match against
     * the silkscreen the user is looking at.
     */
    pinFunctions: {
      gnd: "masa",
      "power-in": "napajanje (ulaz)",
      "power-out": "napajanje (izlaz)",
      "digital-in": "digitalni ulaz",
      "digital-out": "digitalni izlaz",
      "analog-in": "analogni ulaz",
      "analog-out": "analogni izlaz",
      vref: "referentni napon",
      pwm: "PWM",
      "i2c-sda": "I²C SDA",
      "i2c-scl": "I²C SCL",
      "spi-mosi": "SPI MOSI",
      "spi-miso": "SPI MISO",
      "spi-sck": "SPI SCK",
      "spi-cs": "SPI CS",
      "uart-tx": "UART TX",
      "uart-rx": "UART RX",
      interrupt: "prekid",
      onewire: "1-Wire",
      reset: "reset",
      passive: "pasivni kraj",
      anode: "anoda",
      cathode: "katoda",
      nc: "nepovezan",
    } satisfies Record<PinFunction, string>,
  },

  /**
   * What `circuitProblems` found, said in Serbian.
   *
   * **These are notices, not refusals.** Every one of them is about a circuit
   * that is already open and stays open: an unknown component is drawn as a
   * placeholder and named here, and a wire whose end went missing is listed
   * rather than deleted. The circuit is the user's work — a catalogue that
   * shrank between two versions is our problem, not theirs.
   */
  problems: {
    heading: "Provere",
    /** Said out loud rather than left as an empty panel: „nothing found" is a result. */
    none: "Nema primedbi na ovo kolo.",
    /** „3 primedbe" — all three forms. */
    countOne: "primedba",
    countFew: "primedbe",
    countMany: "primedbi",
    codes: {
      shape: "Red nije ispravnog oblika.",
      id: "Red nema ispravan identifikator.",
      length: "Vrednost je predugačka.",
      range: "Vrednost je izvan opsega koji radna površina može da nacrta.",
      duplicate: "Dva reda nose isti identifikator.",
      part: "Žica vodi ka komponenti koje nema u ovom kolu.",
      pin: "Žica vodi ka pinu koji ta komponenta nema.",
      self: "Žica spaja pin sam sa sobom.",
      component: "Ova verzija Nexusa ne poznaje tu komponentu — nacrtana je kao prazan okvir.",
      value: "Vrednost nedostaje, ili je upisana na komponenti koja je nema.",
    } satisfies Record<CircuitProblemCode, string>,
  },

  /**
   * ADR-085 slice E3: what is wrong with the ELECTRICITY, said in Serbian.
   *
   * These sit in the same panel as `problems` above and are a different kind of
   * statement. A structural problem is about the document — a row that is not a
   * row, a part this build does not ship. One of these is about the circuit: it
   * will not work, or it will destroy something the moment power arrives. They
   * share a panel because there is one place a person looks for „what is wrong
   * with this", and they are told apart by the severity word rather than by
   * being in two lists nobody reads both of.
   *
   * **Every sentence is static, and the numbers arrive separately.** The
   * finding carries its own figures — the rail it measured, the range the part
   * is rated for — and the panel prints them on the line beneath. Copy built by
   * interpolation is copy `check:address` cannot read, and it is how a table of
   * strings quietly turns into a template language.
   *
   * **They are notices, exactly as `problems` are.** Nothing here refuses a
   * save, and nothing here is certain: the catalogue knows a part number, not
   * the user's bench, and somebody wiring a level shifter this module has no
   * entry for is entitled to be told they are wrong and to carry on.
   */
  rules: {
    /**
     * The word that separates „this will destroy something" from „this is
     * probably not what you meant". Without it both are one grey line of the
     * same size and the panel teaches that neither is worth reading.
     */
    severity: {
      error: "greška",
      warning: "upozorenje",
    } satisfies Record<RuleSeverity, string>,
    /** The third word, for the structural notices from `problems` above. */
    notice: "napomena",
    /** Units. Symbols rather than translations, but they live here so a locale can move them. */
    volts: "V",
    milliamps: "mA",
    /** „1,7–3,6 V" — an en dash, because it is a span and not a minus sign. */
    rangeDash: "–",
    /** An I²C address is always read in hex, on the module and in every datasheet. */
    addressPrefix: "0x",
    /** Between the figures and the parts they are about: „5 V · BMP280". */
    separator: "·",
    codes: {
      "supply-unreached": "Komponenta traži napajanje, a nijedna žica je ne vodi do šine.",
      "ground-unreached": "Masa komponente nikuda ne vodi — kolo nema povratni put.",
      "supply-range": "Napon šine je izvan opsega koji komponenta podnosi.",
      "rail-conflict": "Dve različite šine spojene su u istu tačku.",
      "rail-short": "Šina ide pravo na masu — to je kratak spoj.",
      "logic-level": "Signal prelazi između dva logička nivoa, bez pretvarača nivoa.",
      "output-conflict": "Dva izlaza guraju isti vod.",
      "bus-role": "Pinovi magistrale su ukršteni — uloge im se ne poklapaju.",
      "i2c-address": "Dva uređaja na istoj I²C magistrali odazivaju se na istu adresu.",
      "current-budget": "Traži se više struje nego što ploča ume da isporuči.",
      "pin-capability": "Komponenta traži PWM ili prekid, a pin ploče nema ni jedno ni drugo.",
      "analog-signal": "Analogni signal je doveden na pin koji razlikuje samo nulu i jedinicu.",
      "led-unprotected": "Dioda je vezana bez otpornika u nizu.",
    } satisfies Record<RuleCode, string>,
  },
} as const;
