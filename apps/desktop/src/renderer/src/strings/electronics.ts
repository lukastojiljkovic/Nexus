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
  ChassisField,
  ChassisShape,
  CircuitProblemCode,
  CodeRefusal,
  ComponentKind,
  Mount,
  PinFunction,
  RosRole,
  RosSkip,
  RuleCode,
  RuleSeverity,
  UrdfSkip,
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

  /**
   * The machine the circuit is the electronics of (ADR-085 E4c).
   *
   * Every dimension is asked for in the unit it is typed in — centimetres and
   * grams — with the unit in the LABEL rather than in the field, so the number
   * on screen is the number stored. The conversion to metres and kilograms is
   * the generator's, where it is a fact about the URDF format.
   */
  chassis: {
    /** In „O kolu", under the counts. The ellipsis is the OS convention for „this opens a dialog". */
    open: "Mašina…",
    dialogTitle: "Mašina",
    /**
     * What the nine numbers are for, and — the load-bearing half — where they
     * come from. Nexus measures nothing; a dimension it guessed would be a
     * dimension a simulator treats as measured.
     */
    description:
      "Kolo opisuje elektroniku, a ovo opisuje mašinu na kojoj ta elektronika stoji. " +
      "Brojevi idu u model koji simulator čita, pa svaki mora doći sa merne trake — " +
      "Nexus nijedan ne pretpostavlja.",
    /** In the inspector when there is no machine — a fact, not a prompt. */
    none: "Za ovo kolo nije opisana nijedna mašina.",
    shapeLabel: "Oblik",
    /** The two shapes the generator has geometry for. */
    shapes: {
      "diff-rover": "Rover sa dva točka i osloncem",
      "four-wheel-rover": "Rover sa četiri točka",
    } satisfies Record<ChassisShape, string>,
    /** Under each, because „diferencijalni pogon" is the part that decides how it drives. */
    shapeHints: {
      "diff-rover":
        "Dva pogonska točka na istoj osovini, treća tačka je oslonac. Skreće razlikom " +
        "brzina.",
      "four-wheel-rover": "Četiri točka, po dva sa svake strane. Skreće razlikom brzina.",
    } satisfies Record<ChassisShape, string>,
    /** The nine fields, each with its unit. */
    fields: {
      bodyLength: "Dužina tela (cm)",
      bodyWidth: "Širina tela (cm)",
      bodyHeight: "Visina tela (cm)",
      wheelRadius: "Poluprečnik točka (cm)",
      wheelWidth: "Širina točka (cm)",
      wheelTrack: "Razmak točkova (cm)",
      wheelBase: "Međuosovinsko rastojanje (cm)",
      bodyMass: "Masa tela (g)",
      wheelMass: "Masa točka (g)",
    } satisfies Record<ChassisField, string>,
    /**
     * The two measurements that are not obvious from their name, said where
     * they are typed. „Razmak točkova" is centre-to-centre and not the gap
     * between them, which is the one a person measures by mistake — and the
     * one that makes wheels overlap through the middle of the robot.
     */
    hints: {
      wheelTrack: "Od sredine levog do sredine desnog točka.",
      wheelBase: "Od prednje do zadnje osovine. Kod rovera sa dva točka: do oslonca.",
    } satisfies Record<"wheelTrack" | "wheelBase", string>,
    save: "Sačuvaj mašinu",
    remove: "Ukloni mašinu",
    /** Said when a field holds something that is not a positive number. */
    invalid: "Svaka mera mora biti broj veći od nule.",
    /** The one cross-field rule, and the reason for it. */
    trackTooNarrow:
      "Razmak točkova mora biti veći od širine točka — inače se točkovi preklapaju " +
      "kroz sredinu mašine.",
    /** The mount picker, in the panel of a part the simulator has physics for. */
    mountLabel: "Strana mašine",
    /** The first option: the part is in the circuit but not on the robot. */
    mountNone: "nije na mašini",
    mounts: {
      front: "napred",
      rear: "nazad",
      left: "levo",
      right: "desno",
      top: "gore",
    } satisfies Record<Mount, string>,
    /**
     * Why a face is enough. The origin is derived from the body's own
     * dimensions, so nobody types three coordinates per sensor.
     */
    mountHint: "Iz strane i mera tela Nexus računa gde senzor stoji na modelu.",
  },

  /**
   * ADR-085 slice E4: the code the wiring implies — an Arduino sketch for a
   * microcontroller, a ROS 2 package for a board that runs Linux.
   *
   * **The copy states the boundary before the code is read, not after.** Both
   * generators emit the WIRING and refuse to invent the behaviour — see their
   * headers for why that is the only line that can be drawn honestly — and a
   * person who opened this dialog expecting a finished program would find that
   * out by reading the `loop` and being disappointed. Said first, it is a
   * design; said last, it is an excuse.
   *
   * **The shared copy is at the top and the artefact's own is nested.** The two
   * dialogs are one dialog, and „Kopiraj" is „Kopiraj" in both; what differs is
   * the tables, which differ because the artefacts do.
   *
   * The reason tables here are NOT the ones `ros.ts` prints into the generated
   * README, and deliberately: that text is the artefact's content and ships
   * inside a file the user takes away, this text is the app's own chrome. They
   * say the same thing at different lengths, and only this one is i18n's.
   */
  code: {
    /** The header action, beside „Preimenuj" and „Obriši". */
    open: "Kod",
    copy: "Kopiraj",
    copied: "Kopirano.",
    /** The ellipsis is the OS convention for „this opens a dialog". */
    saveAs: "Sačuvaj kao…",
    close: "Zatvori",
    /**
     * Said above the code when the checks panel is reporting errors. The code
     * describes the circuit as it stands, so a circuit with a short in it gets
     * a wiring table with that short in it — and nothing about generated code
     * should be read as an opinion that the bench is sound.
     */
    hasErrors: "Provere prijavljuju greške na ovom kolu. Kod opisuje veze kakve jesu.",
    /**
     * Why there is no code. Each is a fact about the circuit rather than a
     * failure: a refusal is a first-class answer here, exactly as it is in
     * `generateCode`, and the dialog opens and says which one it is instead of
     * a button quietly doing nothing.
     */
    refused: {
      "no-board": "U kolu nema ploče, pa nema ni programa koji bi se pisao za nju.",
      "many-boards": "U kolu je više ploča, a jedan program ide na jednu ploču.",
      "not-programmable":
        "Za ovu ploču katalog ne kaže kojim se lancem alata programira, pa Nexus " +
        "ne bira umesto nje.",
      "not-ros": "Ova ploča je mikrokontroler — za nju ide skica, ne ROS 2 paket.",
    } satisfies Record<CodeRefusal, string>,

    /** The Arduino half. */
    sketch: {
      dialogTitle: "Arduino skica",
      /** What the file holds, and what it deliberately does not. */
      description:
        "Fajl opisuje veze: pinove na koje su komponente vezane, njihove smerove i " +
        "magistrale. Šta uređaj radi ostaje na tebi — petlja samo očitava ulaze, da " +
        "se na serijskom monitoru vidi da li je sve povezano onako kako šema kaže.",
      /** The Library Manager names the sketch needs, listed rather than `#include`d. */
      librariesHeading: "Biblioteke",
      /** Where those names go — the IDE's own menu path, in the IDE's own English. */
      librariesHint: "Arduino IDE → Sketch → Include Library → Manage Libraries",
      /**
       * The wiring table — the same rows the sketch prints in its header
       * comment, on screen where they can be read while the wires are being
       * pushed in. Nobody counts pins out of a C comment with one hand on a
       * jumper.
       */
      wiringHeading: "Veze",
      wiringPin: "Pin ploče",
      wiringPart: "Komponenta",
      wiringConstant: "Konstanta",
      /** In the constant column, for a pin the sketch deliberately leaves unnamed. */
      wiringUnnamed: "—",
      /** Shown only when some row is unnamed, so it never explains an absence nobody saw. */
      wiringHint: "Pin bez konstante vodi biblioteka ili magistrala, pa mu skica ne daje ime.",
      /**
       * The machine, said only on a circuit that HAS one (ADR-085 E4c).
       *
       * The model is a file of the ROS 2 package, so this board produces none —
       * and „Mašina" has already told the user that their numbers go into a
       * model a simulator reads, which on this board nothing keeps. The last
       * sentence is the one that matters: the measurements are not lost, and a
       * user who reads „skica ih ne koristi" would otherwise reasonably wonder.
       */
      machineHeading: "Model mašine",
      machineNone:
        "Mašina je opisana, ali je skica ne koristi: model čita simulator, a on ide uz " +
        "ROS 2 paket — koji Nexus pravi za ploče sa Linuksom. Mere ostaju uz kolo.",
      /** Above the code itself, with the file name the save dialog will suggest. */
      sourceHeading: "Skica",
      saved: "Skica je sačuvana.",
      /**
       * Said after it, only when the sketch needs libraries.
       *
       * The count travels back from main with the path and used to go unread,
       * which made it a caveat nobody saw: „Skica je sačuvana." is a complete
       * sentence that leaves out the one thing the user must do next, because a
       * sketch whose `#include` is not installed does not compile. The list is
       * in the dialog above and the dialog has just closed.
       */
      savedLibraries: "Instaliraj još",
      libraryOne: "biblioteku",
      libraryFew: "biblioteke",
      libraryMany: "biblioteka",
    },

    /** The ROS 2 half. */
    ros: {
      dialogTitle: "ROS 2 paket",
      /** The same boundary, in the vocabulary of a node rather than a loop. */
      description:
        "Paket opisuje veze: svaki pin koji je u šemi zaista povezan dobija uređaj i " +
        "temu — ulaz se objavljuje, izlaz se sluša. Šta mašina radi sa tim temama " +
        "pišeš ti, u svom čvoru koji ih čita i piše.",
      topicsHeading: "Teme",
      topicTopic: "Tema",
      topicMessage: "Poruka",
      topicRole: "Čvor",
      topicPin: "Pin",
      topicPart: "Komponenta",
      /**
       * What the NODE does with the topic, keyed by `RosRole`. The subject is
       * in the column heading rather than repeated down every row — five
       * columns of a five-column table cost width, and „čvor" said twice on
       * every line is width spent on a word the header already said.
       */
      roles: {
        input: "objavljuje",
        output: "sluša",
        pwm: "sluša (PWM)",
      } satisfies Record<RosRole, string>,
      /** The second table: wires that are in the schematic and not in the node. */
      skippedHeading: "Šta nije izvedeno",
      skippedIntro:
        "Ove veze postoje u šemi, ali ih čvor ne dira — svaka bi tražila kod koji se " +
        "iz šeme ne može izvesti.",
      skippedReason: "Razlog",
      /** Why, keyed by `RosSkip`. */
      reasons: {
        bus: "magistrala",
        library: "vodi ga drajver komponente",
        shared: "na liniji je više komponenti",
        analog: "analogni signal",
        "no-direction": "iz šeme se ne vidi smer",
        "no-number": "pin nema BCM broj",
      } satisfies Record<RosSkip, string>,
      /**
       * The model of the machine, which rides inside the same package (ADR-085
       * E4c). A section rather than a dialog of its own: the URDF is a file in
       * this package and nothing else, so a second dialog would be a second
       * place to look for one artefact.
       */
      urdfHeading: "Model mašine",
      urdfIntro:
        "Uz čvor ide i model mašine — telo, točkovi i senzori na njima, u merama " +
        "koje su unete u „Mašina“. Simulator ga čita, a paket ga instalira uz sebe.",
      /** When the circuit has no chassis: the honest absence, said once. */
      urdfNone:
        "Za ovo kolo nije opisana nijedna mašina, pa paket nema model. Mere se unose " +
        "u „Mašina“, u panelu o kolu.",
      /** The sensors that made it into the model. */
      urdfSensorsHeading: "Senzori u modelu",
      urdfSensorPart: "Komponenta",
      urdfSensorMount: "Strana",
      urdfSensorTopic: "Tema",
      urdfSensorMessage: "Poruka",
      /**
       * The one thing about this file that a user WILL misread if it is not
       * said: the model's topics are not the node's topics. A ranger in
       * simulation publishes a distance; the node publishes whether a pin is
       * high. Two different quantities, and pretending otherwise would be the
       * dishonest half of generating both from one circuit.
       */
      urdfTopicsHint:
        "Ove teme dolaze iz simulatora i nose izmerene veličine. Teme čvora iznad " +
        "nose stanja pinova — to nisu iste teme i ne spajaju se same.",
      /**
       * The second table. Scoped to SENSORS, exactly as the generated README
       * is, because that is what the generator actually walks: a buzzer is an
       * actuator and has no place in a sensor list, so „šta nije u modelu" would have promised a
       * completeness the table does not have.
       */
      urdfSkippedHeading: "Senzori koji nisu u modelu",
      urdfSkippedReason: "Razlog",
      urdfReasons: {
        "no-equivalent": "fizika nema šta da simulira umesto njega",
        "no-mount": "nije postavljen ni na jednu stranu mašine",
      } satisfies Record<UrdfSkip, string>,
      /** Above the node's own source; the other seven files are the ament shape. */
      sourceHeading: "Čvor",
      /** Precedes the other seven paths, so the package's size is never a surprise. */
      filesRest: "uz još fajlova koje colcon traži:",
      /**
       * With the file count, because a package is a DIRECTORY: nothing opened,
       * nothing to look at, and „napravljen je" about a folder the user cannot
       * see is a claim rather than a confirmation. The number is the evidence.
       */
      saved: "Paket je napravljen —",
      fileOne: "fajl",
      fileFew: "fajla",
      fileMany: "fajlova",
      /**
       * Main's own refusal, and the only destructive thing it declines to do.
       * The generated README asks the user to fill in the licence and to write
       * their own node beside `wiring.py`, so overwriting would destroy work
       * Nexus itself asked for.
       */
      exists: "Tu već postoji direktorijum sa tim imenom. Nexus preko njega ne piše.",
    },
  },
} as const;
