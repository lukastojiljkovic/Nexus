/**
 * Electronics - the English copy of the workbench's own table (ELEC, migration
 * 067).
 *
 * A group of its own rather than another section of `strings.en.ts`, on
 * `pro.en.ts`'s terms: this is one module's whole vocabulary, and four of its
 * tables are keyed by a closed list `@nexus/core` owns - component kinds, pin
 * functions, bus kinds, wire colours. Each is declared `satisfies Record<…,
 * string>`, so a member added to the model is a compile error here rather than
 * a blank label on the screen.
 *
 * Nothing here is a second copy layer. This is one leaf of the same table -
 * `strings.en.ts` imports it as `electronics`, and `strings.ts` installs
 * that whole table when the reader picks English, so a locale switch rewrites
 * these leaves exactly as it rewrites the rest. A consumer reads
 * `strings.electronics.…` and never imports this file.
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
  RunnerProfileId,
  SimFlow,
  SimRefusal,
  SimSkip,
  SimUnit,
  SimWave,
  UrdfSkip,
  ValueUnit,
  WireColour,
} from "@nexus/core";
// The one import here that comes from the IPC contract rather than from the
// domain model, and for the same reason the table below needs it: a runner
// refusal has SEVEN members, and four of them are main's own (`not-enabled`,
// `no-choice`, `no-distro`, `no-package`) because they are facts about the
// user's settings and their circuit rather than about the command line. Keying
// the table on core's three-member union would leave half of it untyped — which
// is exactly how a refusal added to the contract renders as a blank line.
import type { RunnerRefusal } from "../../../shared/ipc.js";

export const electronicsEn = {
  /** Above the circuit list. Names the SECTION, not the sidebar entry — `strings.modules` owns that. */
  circuitsLabel: "Circuits",
  /** The second line of a row in the circuit list: „izmenjeno 14:32". CANV's idiom, for its reason. */
  circuitUpdatedPrefix: "modified",
  /** The circuit a profile gets the first time it opens the page — an empty-state button whose only answer is „napravi kolo" is not a question. */
  firstCircuitName: "Circuit",
  newCircuit: "New circuit",
  nameLabel: "Circuit name",
  namePlaceholder: "Weather station",
  save: "Save",
  cancel: "Cancel",
  rename: "Rename",
  delete: "Delete",
  undo: "Undo",
  deletedNotice: "The circuit was deleted.",
  dismiss: "Close",
  loadErrorTitle: "Circuits not loaded",
  loadError: "Loading the circuits failed. Close and reopen the page.",
  actionError: "The action failed. Try again.",
  emptyTitle: "There is no circuit yet",
  emptyDescription: "Make a circuit, choose a board and connect sensors to it.",

  /** The component drawer down the left side. */
  palette: {
    title: "Components",
    searchLabel: "Component search",
    searchPlaceholder: "Name, description or protocol",
    /** The query matched nothing. Says what to do next, because „0 rezultata" does not. */
    empty: "No component matches the search. Try a shorter term.",
    /** On each row — the row IS the button, so this is what a screen reader reads before the name. */
    add: "Add to circuit",
    /** „24 pina" — the three Serbian forms, because „pin"/„pina" does not collapse into two. */
    pinsOne: "pin",
    pinsFew: "pins",
    pinsMany: "pins",
    /** „3,3–5 V" on the row's meta line, when the part has a supply to state. */
    supplyPrefix: "power",
    /**
     * The eight sections, keyed by `ComponentKind`. Plural, because each names a
     * SHELF rather than a single part.
     */
    kinds: {
      board: "Boards",
      sensor: "Sensors",
      actuator: "Actuators",
      driver: "Drivers and amplifiers",
      display: "Displays",
      comms: "Communication",
      power: "Power",
      passive: "Passive components",
    } satisfies Record<ComponentKind, string>,
  },

  /** The workbench itself. */
  bench: {
    label: "Workspace",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    /** Frames everything on the circuit — „prilagodi", not „resetuj": nothing is undone. */
    zoomFit: "Fit view",
    /** Live, beside the zoom controls: „120 %". */
    zoomLabel: "Zoom",
    wireColourLabel: "Wire colour",
    /**
     * The nine jumper colours by name (DEV-006). Lower-case: they are read as
     * „crvena žica", never as a heading, and they are what an engineer says out
     * loud — which is the whole reason the palette keeps the trade's own hues.
     */
    colours: {
      red: "red",
      black: "black",
      yellow: "yellow",
      green: "green",
      blue: "blue",
      white: "white",
      orange: "orange",
      brown: "brown",
      grey: "grey",
    } satisfies Record<WireColour, string>,
    /** Nothing armed: what a click on a pin will do. */
    wiringIdle: "Click a pin to start a wire.",
    /** One end armed: what the next click does, and how to change your mind. */
    wiringArmed: "Choose a second pin to connect the wire. Esc cancels.",
    /** The refusal the canvas can make on its own, before any write. */
    wiringSelf: "A wire cannot connect a pin to itself.",
    /** A part whose component this build does not ship — drawn as a dashed placeholder. */
    unknownPart: "Unknown component",
    /** Empty bench, with a circuit open. */
    emptyTitle: "Empty workspace",
    emptyDescription: "Choose a component on the left to place it in the circuit.",
  },

  /** The panel on the right: whatever is selected, or the circuit itself. */
  inspector: {
    circuitTitle: "About the circuit",
    partTitle: "Component",
    wireTitle: "Wire",
    /** The circuit's own note. One field, saved by its own button — never as you type. */
    notesLabel: "Note",
    notesPlaceholder: "What this circuit does, what is still left.",
    notesSave: "Save note",
    notesSaved: "The note was saved.",
    /** The two counts under the circuit's name. Both take all three Serbian forms. */
    partsOne: "component",
    partsFew: "components",
    partsMany: "components",
    wiresOne: "wire",
    wiresFew: "wires",
    wiresMany: "wires",
    /** The part's own name on the schematic — empty falls back to the component's. */
    labelField: "Name in the circuit",
    labelPlaceholder: "left motor",
    rotate: "Rotate",
    /** „90°" beside the rotate button. */
    rotationLabel: "Angle",
    removePart: "Remove component",
    /** Said before it happens, because removing a part takes its wires with it. */
    removePartHint: "Also removes every wire that goes to it.",
    removeWire: "Remove wire",
    /**
     * The value field, labelled by what the component actually measures. One
     * entry per `valueUnit` the model admits; the unit is in the label rather
     * than in the field, so the number the user types is the number stored.
     */
    valueLabels: {
      ohm: "Resistance (Ω)",
      farad: "Capacitance (F)",
      henry: "Inductance (H)",
      volt: "Voltage (V)",
      ampere: "Current (A)",
    } satisfies Record<ValueUnit, string>,
    /** The refusal a value field can make on its own. */
    valueInvalid: "The value must be a number greater than zero.",
    /** What the catalogue says about the selected part's component. */
    componentHeading: "About the component",
    supplyLabel: "Supply",
    currentLabel: "Consumption",
    /** „tipično 1,5 mA · najviše 120 mA" — two figures, said as two. */
    currentTypical: "typical",
    currentPeak: "maximum",
    libraryLabel: "Library",
    busesLabel: "Protocols",
    /** I²C addresses, printed in hex the way a datasheet prints them. */
    addressesLabel: "Addresses",
    logicLabel: "Logic level",
    pinsHeading: "Pins",
    /** Under a pin that has a wire on it, in place of „slobodno". */
    pinConnected: "connected",
    pinFree: "free",
    /** The wire's two ends: „ARDUINO UNO · D9". */
    wireFrom: "From",
    wireTo: "To",
    wireColour: "Colour",
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
      gnd: "ground",
      "power-in": "power (input)",
      "power-out": "power (output)",
      "digital-in": "digital input",
      "digital-out": "digital output",
      "analog-in": "analogue input",
      "analog-out": "analogue output",
      vref: "reference voltage",
      pwm: "PWM",
      "i2c-sda": "I²C SDA",
      "i2c-scl": "I²C SCL",
      "spi-mosi": "SPI MOSI",
      "spi-miso": "SPI MISO",
      "spi-sck": "SPI SCK",
      "spi-cs": "SPI CS",
      "uart-tx": "UART TX",
      "uart-rx": "UART RX",
      interrupt: "interrupt",
      onewire: "1-Wire",
      reset: "reset",
      passive: "passive terminal",
      anode: "anode",
      cathode: "cathode",
      nc: "unconnected",
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
    heading: "Checks",
    /** Said out loud rather than left as an empty panel: „nothing found" is a result. */
    none: "There are no findings on this circuit.",
    /** „3 primedbe" — all three forms. */
    countOne: "finding",
    countFew: "findings",
    countMany: "findings",
    codes: {
      shape: "The row is not of the right shape.",
      id: "The row has no valid identifier.",
      length: "The value is too long.",
      range: "The value is outside the range the workspace can draw.",
      duplicate: "Two rows carry the same identifier.",
      part: "The wire leads to a component that is not in this circuit.",
      pin: "The wire leads to a pin that component does not have.",
      self: "The wire connects a pin to itself.",
      component: "This version of Nexus does not know that component — it is drawn as an empty frame.",
      value: "The value is missing, or it is written on a component that does not have one.",
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
      error: "error",
      warning: "warning",
    } satisfies Record<RuleSeverity, string>,
    /** The third word, for the structural notices from `problems` above. */
    notice: "note",
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
      "supply-unreached": "The component needs power, and no wire leads it to a rail.",
      "ground-unreached": "The component's ground goes nowhere — the circuit has no return path.",
      "supply-range": "The rail voltage is outside the range the component tolerates.",
      "rail-conflict": "Two different rails are connected to the same point.",
      "rail-short": "The rail goes straight to ground — that is a short circuit.",
      "logic-level": "The signal crosses between two logic levels, with no level shifter.",
      "output-conflict": "Two outputs drive the same line.",
      "bus-role": "The bus pins are crossed — their roles do not match.",
      "i2c-address": "Two devices on the same I²C bus answer to the same address.",
      "current-budget": "More current is asked for than the board can supply.",
      "pin-capability": "The component needs PWM or an interrupt, and the board's pin has neither.",
      "analog-signal": "An analogue signal is brought to a pin that only tells zero from one.",
      "led-unprotected": "The diode is connected without a series resistor.",
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
    open: "Machine…",
    dialogTitle: "Machine",
    /**
     * What the nine numbers are for, and — the load-bearing half — where they
     * come from. Nexus measures nothing; a dimension it guessed would be a
     * dimension a simulator treats as measured.
     */
    description:
      "The circuit describes the electronics, and this describes the machine that electronics sits on. The numbers go into the model the simulator reads, so every one must come from a tape measure — Nexus assumes none of them.",
    /** In the inspector when there is no machine — a fact, not a prompt. */
    none: "No machine is described for this circuit.",
    shapeLabel: "Shape",
    /** The two shapes the generator has geometry for. */
    shapes: {
      "diff-rover": "Two-wheel rover with a caster",
      "four-wheel-rover": "Four-wheel rover",
    } satisfies Record<ChassisShape, string>,
    /** Under each, because „diferencijalni pogon" is the part that decides how it drives. */
    shapeHints: {
      "diff-rover":
        "Two drive wheels on the same axle, the third point is a caster. It steers by the difference in speed.",
      "four-wheel-rover": "Four wheels, two on each side. It steers by the difference in speed.",
    } satisfies Record<ChassisShape, string>,
    /** The nine fields, each with its unit. */
    fields: {
      bodyLength: "Body length (cm)",
      bodyWidth: "Body width (cm)",
      bodyHeight: "Body height (cm)",
      wheelRadius: "Wheel radius (cm)",
      wheelWidth: "Wheel width (cm)",
      wheelTrack: "Track width (cm)",
      wheelBase: "Wheelbase (cm)",
      bodyMass: "Body mass (g)",
      wheelMass: "Wheel mass (g)",
    } satisfies Record<ChassisField, string>,
    /**
     * The two measurements that are not obvious from their name, said where
     * they are typed. „Razmak točkova" is centre-to-centre and not the gap
     * between them, which is the one a person measures by mistake — and the
     * one that makes wheels overlap through the middle of the robot.
     */
    hints: {
      wheelTrack: "From the centre of the left wheel to the centre of the right.",
      wheelBase: "From the front axle to the rear. For a two-wheel rover: to the caster.",
    } satisfies Record<"wheelTrack" | "wheelBase", string>,
    save: "Save machine",
    remove: "Remove machine",
    /** Said when a field holds something that is not a positive number. */
    invalid: "Every measurement must be a number greater than zero.",
    /** The one cross-field rule, and the reason for it. */
    trackTooNarrow:
      "The track width must be greater than the wheel width — otherwise the wheels overlap through the middle of the machine.",
    /** The mount picker, in the panel of a part the simulator has physics for. */
    mountLabel: "Machine side",
    /** The first option: the part is in the circuit but not on the robot. */
    mountNone: "not on the machine",
    mounts: {
      front: "front",
      rear: "back",
      left: "left",
      right: "right",
      top: "top",
    } satisfies Record<Mount, string>,
    /**
     * Why a face is enough. The origin is derived from the body's own
     * dimensions, so nobody types three coordinates per sensor.
     */
    mountHint: "From the side and the body measurements Nexus computes where the sensor sits on the model.",
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
    open: "Code",
    copy: "Copy",
    copied: "Copied.",
    /** The ellipsis is the OS convention for „this opens a dialog". */
    saveAs: "Save as…",
    close: "Close",
    /**
     * Said above the code when the checks panel is reporting errors. The code
     * describes the circuit as it stands, so a circuit with a short in it gets
     * a wiring table with that short in it — and nothing about generated code
     * should be read as an opinion that the bench is sound.
     */
    hasErrors: "The checks report errors on this circuit. The code describes the connections as they are.",
    /**
     * Why there is no code. Each is a fact about the circuit rather than a
     * failure: a refusal is a first-class answer here, exactly as it is in
     * `generateCode`, and the dialog opens and says which one it is instead of
     * a button quietly doing nothing.
     */
    refused: {
      "no-board": "There is no board in the circuit, so there is no program to write for one.",
      "many-boards": "The circuit has several boards, and one program goes to one board.",
      "not-programmable":
        "The catalogue does not say which toolchain this board is programmed with, so Nexus does not choose for it.",
      "not-ros": "This board is a microcontroller — it gets a sketch, not a ROS 2 package.",
    } satisfies Record<CodeRefusal, string>,

    /** The Arduino half. */
    sketch: {
      dialogTitle: "Arduino sketch",
      /** What the file holds, and what it deliberately does not. */
      description:
        "The file describes the connections: the pins the components are wired to, their directions and the buses. What the device does is up to you — the loop only reads the inputs, so the serial monitor shows whether everything is wired the way the schematic says.",
      /** The Library Manager names the sketch needs, listed rather than `#include`d. */
      librariesHeading: "Libraries",
      /** Where those names go — the IDE's own menu path, in the IDE's own English. */
      librariesHint: "Arduino IDE → Sketch → Include Library → Manage Libraries",
      /**
       * The wiring table — the same rows the sketch prints in its header
       * comment, on screen where they can be read while the wires are being
       * pushed in. Nobody counts pins out of a C comment with one hand on a
       * jumper.
       */
      wiringHeading: "Connections",
      wiringPin: "Board pin",
      wiringPart: "Component",
      wiringConstant: "Constant",
      /** In the constant column, for a pin the sketch deliberately leaves unnamed. */
      wiringUnnamed: "—",
      /** Shown only when some row is unnamed, so it never explains an absence nobody saw. */
      wiringHint: "A pin without a constant is handled by a library or a bus, so the sketch does not give it a name.",
      /**
       * The machine, said only on a circuit that HAS one (ADR-085 E4c).
       *
       * The model is a file of the ROS 2 package, so this board produces none —
       * and „Mašina" has already told the user that their numbers go into a
       * model a simulator reads, which on this board nothing keeps. The last
       * sentence is the one that matters: the measurements are not lost, and a
       * user who reads „skica ih ne koristi" would otherwise reasonably wonder.
       */
      machineHeading: "Machine model",
      machineNone:
        "The machine is described, but the sketch does not use it: the model is read by the simulator, and that comes with the ROS 2 package — which Nexus makes for Linux boards. The measurements stay with the circuit.",
      /** Above the code itself, with the file name the save dialog will suggest. */
      sourceHeading: "Sketch",
      saved: "The sketch was saved.",
      /**
       * Said after it, only when the sketch needs libraries.
       *
       * The count travels back from main with the path and used to go unread,
       * which made it a caveat nobody saw: „Skica je sačuvana." is a complete
       * sentence that leaves out the one thing the user must do next, because a
       * sketch whose `#include` is not installed does not compile. The list is
       * in the dialog above and the dialog has just closed.
       */
      savedLibraries: "Install more",
      libraryOne: "library",
      libraryFew: "libraries",
      libraryMany: "libraries",
    },

    /** The ROS 2 half. */
    ros: {
      dialogTitle: "ROS 2 package",
      /** The same boundary, in the vocabulary of a node rather than a loop. */
      description:
        "The package describes the connections: every pin actually connected in the schematic gets a device and a topic — an input is published, an output is subscribed. What the machine does with those topics is written by you, in your own node that reads and writes them.",
      topicsHeading: "Topics",
      topicTopic: "Topic",
      topicMessage: "Message",
      topicRole: "Node",
      topicPin: "Pin",
      topicPart: "Component",
      /**
       * What the NODE does with the topic, keyed by `RosRole`. The subject is
       * in the column heading rather than repeated down every row — five
       * columns of a five-column table cost width, and „čvor" said twice on
       * every line is width spent on a word the header already said.
       */
      roles: {
        input: "publishes",
        output: "subscribes",
        pwm: "subscribes (PWM)",
      } satisfies Record<RosRole, string>,
      /** The second table: wires that are in the schematic and not in the node. */
      skippedHeading: "What is not derived",
      skippedIntro:
        "These connections exist in the schematic, but the node does not touch them — each would need code that cannot be derived from the schematic.",
      skippedReason: "Reason",
      /** Why, keyed by `RosSkip`. */
      reasons: {
        bus: "bus",
        library: "handled by the component's driver",
        shared: "several components share the line",
        analog: "analogue signal",
        "no-direction": "the direction is not visible from the schematic",
        "no-number": "the pin has no BCM number",
      } satisfies Record<RosSkip, string>,
      /**
       * The model of the machine, which rides inside the same package (ADR-085
       * E4c). A section rather than a dialog of its own: the URDF is a file in
       * this package and nothing else, so a second dialog would be a second
       * place to look for one artefact.
       */
      urdfHeading: "Machine model",
      urdfIntro:
        "The node comes with a machine model too — body, wheels and the sensors on them, in the measurements entered under “Machine”. The simulator reads it, and the package installs it alongside itself.",
      /** When the circuit has no chassis: the honest absence, said once. */
      urdfNone:
        "No machine is described for this circuit, so the package has no model. Measurements are entered under “Machine”, in the circuit panel.",
      /** The sensors that made it into the model. */
      urdfSensorsHeading: "Sensors in the model",
      urdfSensorPart: "Component",
      urdfSensorMount: "Side",
      urdfSensorTopic: "Topic",
      urdfSensorMessage: "Message",
      /**
       * The one thing about this file that a user WILL misread if it is not
       * said: the model's topics are not the node's topics. A ranger in
       * simulation publishes a distance; the node publishes whether a pin is
       * high. Two different quantities, and pretending otherwise would be the
       * dishonest half of generating both from one circuit.
       */
      urdfTopicsHint:
        "These topics come from the simulator and carry measured quantities. The node's topics above carry pin states — they are not the same topics and do not connect by themselves.",
      /**
       * The second table. Scoped to SENSORS, exactly as the generated README
       * is, because that is what the generator actually walks: a buzzer is an
       * actuator and has no place in a sensor list, so „šta nije u modelu" would have promised a
       * completeness the table does not have.
       */
      urdfSkippedHeading: "Sensors that are not in the model",
      urdfSkippedReason: "Reason",
      urdfReasons: {
        "no-equivalent": "the physics has nothing to simulate for it",
        "no-mount": "it is not placed on any side of the machine",
      } satisfies Record<UrdfSkip, string>,
      /** Above the node's own source; the other seven files are the ament shape. */
      sourceHeading: "Node",
      /** Precedes the other seven paths, so the package's size is never a surprise. */
      filesRest: "plus the other files colcon needs:",
      /**
       * With the file count, because a package is a DIRECTORY: nothing opened,
       * nothing to look at, and „napravljen je" about a folder the user cannot
       * see is a claim rather than a confirmation. The number is the evidence.
       */
      saved: "The package was created —",
      fileOne: "file",
      fileFew: "files",
      fileMany: "files",
      /**
       * Main's own refusal, and the only destructive thing it declines to do.
       * The generated README asks the user to fill in the licence and to write
       * their own node beside `wiring.py`, so overwriting would destroy work
       * Nexus itself asked for.
       */
      exists: "A directory with that name already exists there. Nexus does not write over it.",
    },
  },

  /**
   * „Klupa" — the bench (ADR-085 E5).
   *
   * The copy carries one idea the screen cannot: that the values are the
   * USER's. Everything here describes a chain the circuit really has — this pin
   * to that component, this pin to that topic — animated by a signal nobody
   * measured, and a word like „simulacija" invites the reader to expect physics
   * that is deliberately absent. So the description says what moves and who
   * decides it, in that order, before anything else is named.
   */
  sim: {
    /** The header action, beside „Kod". */
    open: "Bench",
    dialogTitle: "Bench",
    close: "Close",
    /**
     * The boundary, said once and at the top. The generators say the same thing
     * in their own words — the artefact describes the wiring and never the
     * behaviour — and this is that sentence for a thing that moves.
     */
    description:
      "The bench shows how the signal travels through the circuit while the clock runs: what the board reads from the sensors and what it sends to the component it drives. You supply the values — Nexus does not assume what your program does, so this checks the connections, not the logic.",
    /** Why there is no bench. `soleBoard`'s two refusals, in the dialog's own voice. */
    refused: {
      "no-board": "There is no board in the circuit, so there are no pins whose signals could be traced.",
      "many-boards": "The circuit has several boards, and the bench traces one board's pins.",
    } satisfies Record<SimRefusal, string>,

    /** The transport. */
    clockHeading: "Clock",
    run: "Start",
    pause: "Pause",
    /** One tick forward, which is the only way to read a fast waveform. */
    step: "Step",
    reset: "Restart",
    tickLabel: "Step (ms)",
    /**
     * The one thing about the clock that would otherwise be misread: the tick
     * is SIMULATED time. The bench advances at its own steady pace whatever the
     * step is set to, so a step of 1 ms is a slow-motion reading rather than a
     * thousand frames a second.
     */
    tickHint:
      "The step is simulated time. The clock runs at the same pace whatever the step length, so a smaller step means reading the same phenomenon more slowly.",
    /** Before the tick number in the readout: „korak 42 · 4 200 ms". */
    tickPrefix: "step",
    /** Beside the board's name, when it states a logic level. */
    logicPrefix: "Logic level:",

    /** The channels themselves. */
    channelsHeading: "Channels",
    channelsEmpty:
      "No board pin has a signal that can be traced. Connect a component to a board pin and the channel appears here.",
    /**
     * The two headings the „šta klupa ne prati" table uses.
     *
     * There were four. A channel is a CARD whose head reads as one sentence —
     * pin, part·pin, direction, topic — rather than as a row of five columns,
     * so „Signal", „Vrednost" and „Tema" were headings for a table that the
     * design does not have, left behind when it stopped being one.
     */
    channelPin: "Pin",
    channelPart: "Component",
    /**
     * Which way the wire goes, keyed by `SimFlow`. Written from the BOARD's
     * side, because the board is the thing the user's program runs on and the
     * only end both halves of the chain have in common.
     */
    flows: {
      sensor: "board reads",
      actuator: "board drives",
    } satisfies Record<SimFlow, string>,
    /**
     * What the number means, keyed by `SimUnit` — and `null` wherever the
     * NUMBER already says it.
     *
     * The caption under a readout exists because „1" on its own is not a
     * sentence. „3,3 V" is: the symbol names the quantity, so „napon" beside it
     * said volts twice. And „100 %" with „radni ciklus" under it was worse than
     * redundant — it is the same phrase as `waveDuty` („Radni ciklus (%)"),
     * three rows above and showing 50, because the field is the square wave's
     * duty and the readout is what the pin drives at THIS tick. Both numbers
     * were right and one card carried one label for them.
     *
     * So the rule is: the caption names the quantity only when the number
     * cannot. `string | null` rather than a partial record, because a new
     * `SimUnit` must still be made to choose.
     */
    units: {
      level: "state",
      percent: null,
      volts: null,
    } satisfies Record<SimUnit, string | null>,
    /** The waveform picker, keyed by `SimWave`'s own tag. */
    waves: {
      constant: "Constant value",
      square: "Square",
      ramp: "Ramp",
      steps: "Steps",
    } satisfies Record<SimWave["kind"], string>,
    waveKindLabel: "Shape",
    waveValue: "Value",
    waveFrom: "From",
    waveTo: "To",
    wavePeriod: "Period (ms)",
    waveHold: "Hold (ms)",
    waveDuty: "Duty cycle (%)",
    waveValues: "Readings",
    /**
     * The separator, said where it is typed. A semicolon rather than a comma
     * because the app writes decimals the Serbian way, and „1,5" in a
     * comma-separated list could be one number or two.
     */
    waveValuesHint: "Separate values with a semicolon: 0; 1.5; 3.3",
    /** What stands in a channel's topic slot when the board has no topics. */
    topicNone: "—",
    /**
     * Why a channel on a Linux board can still have no topic: the ROS package
     * declines an analogue line, because gpiozero reads high and low. The bench
     * carries it, which is why the row exists at all — but the row must not
     * look like a topic that failed to render.
     */
    topicHint:
      "A channel with no topic is not derived in the ROS 2 package — usually because it is analogue, and gpiozero reads only high and low. The bench still traces it.",

    /** The per-tick warning, which no static check can give. */
    overLogic: "above the level",
    overLogicHint:
      "The marked values are above the board's logic level. The checks report a level mismatch for the whole circuit; here you can see the moment it happens.",

    /** The wires the bench does not carry. Same vocabulary as the ROS table. */
    skippedHeading: "What the bench does not trace",
    skippedIntro:
      "These connections exist in the schematic, but they have no single signal to trace — each belongs to a protocol, a driver, or a line shared by several components.",
    skippedReason: "Reason",
    reasons: {
      bus: "bus",
      library: "handled by the component's driver",
      shared: "several components share the line",
      "no-direction": "the direction is not visible from the schematic",
    } satisfies Record<SimSkip, string>,
  },

  /**
   * ADR-085 slice E6: the external runner — the one part of Nexus that starts a
   * process on the user's own machine.
   *
   * **The copy IS the feature here.** Everywhere else in this app a sentence
   * explains a surface; on this screen the sentence carries the consent, so the
   * four promise lines under `consent` are written to be CHECKED against what
   * the code does rather than to sound reassuring — a program that runs with
   * the user's own rights, a build that only ever starts on a click, one
   * directory touched, and one network operation, named. Nothing is softened
   * (a screen that persuaded would be the wrong instrument for this) and
   * nothing is hidden (the Docker pull is the only part of this feature that
   * leaves the machine, and it is the product's promise that it stays the only
   * one).
   *
   * **Three distinctions the copy must not blur, because each is a place where
   * the shorter sentence would be a lie.** A probe that never answered is not a
   * tool that is absent: `wsl.exe` hangs when the WSL service is stopped, and
   * „nije nađen" would send the user looking for an installation they already
   * have. A stop that left the work going is not a stop: `docker.exe` exits
   * while the container it started builds on, which is why the ending is drawn
   * from `state` and never from the exit code. And a run that ended by itself
   * is not a run somebody stopped — two facts, two sentences, at the foot of
   * the log.
   */
  runner: {
    /** The header action, beside „Kod" and „Klupa". */
    open: "Runner",
    dialogTitle: "Runner",
    close: "Close",
    /**
     * Nothing could be read at all — a broken channel rather than a state of
     * the runner. Says what to do next, because the dialog has no retry.
     */
    loadError: "The runner settings were not loaded. Close the dialogue and open it again.",

    /**
     * The switch is OFF, and this block is the whole dialog.
     *
     * **A button and not a checkbox, deliberately.** The button IS the consent,
     * and a checkbox beside it would be a second thing to click that means the
     * same thing — the shape that teaches a user to tick without reading, on
     * the one screen in this app where reading is the point. The time of the
     * click is what gets recorded, which is why the acts are one act.
     */
    consent: {
      heading: "What switching it on means",
      external:
        "Nexus runs an external program on this computer — with the same rights you have.",
      manual: "Nothing runs on its own: every job starts when you start it.",
      writes: "The job reads and writes one directory — the one Nexus makes for that package.",
      network:
        "The Docker profile pulls an image from Docker Hub on first run. That is the only part of the runner that goes to the network.",
      enable: "Enable the runner",
      /**
       * The write that records the consent did not land.
       *
       * Its own sentence rather than the dialog's generic failure, because this
       * is the one write on the screen where „nešto nije uspelo" would leave the
       * reader unsure of the thing that matters: nothing was turned on. The
       * button is still there, and the panel says what state it is in.
       */
      rejected: "The switch-on was not remembered — the runner stayed off.",
    },

    /**
     * What is installed, asked of the tools themselves.
     *
     * **Nothing is shown until the button is pressed, and that is a fact about
     * the machine rather than a choice about the layout**: the probe SPAWNS a
     * process per profile, so it is the user's click that starts it and never
     * the dialog opening. The empty state therefore has to say what the button
     * does, because it is the only thing on the screen that explains why the
     * screen is empty.
     */
    detect: {
      heading: "What is on this computer",
      button: "Check the environment",
      checking: "Checking…",
      empty:
        "No profile is shown until the check runs. The check runs one short command for each profile and takes a few seconds.",
      /**
       * The probe's three answers. `found` takes the version beside it when the
       * tool printed one; `timedOut` is its own answer for the reason the file
       * header gives — it is the one that is not about installation at all.
       */
      states: {
        found: "found",
        missing: "not found",
        timedOut: "did not answer in time",
      },
      /** WSL's second question, per distribution — a list rather than a yes. */
      distroUsable: "colcon is in it",
      distroUnusable: "colcon was not found",
    },

    /**
     * Which toolchain the build runs in.
     *
     * The choice is a write and the panel shows the ANSWER (see the dialog's
     * own note): main is the one that validates a distribution, so a rejected
     * write must be a sentence rather than a radio that quietly snaps back to
     * where it was.
     */
    choice: {
      heading: "What to build with",
      /** Before the probe has run the three rows are disabled, and this says why. */
      needsDetection: "Check the environment first — without the check there is no knowing which profile works here.",
      rejected: "The choice was not accepted. Check the environment again, then try another profile.",
      /** The three profiles, each named by what it IS rather than by its id. */
      profiles: {
        native: "On this system",
        wsl: "WSL",
        docker: "Docker",
      } satisfies Record<RunnerProfileId, string>,
      hints: {
        native: "colcon that is already on this computer's PATH.",
        wsl: "colcon inside a Linux distribution in Windows.",
        docker: "colcon in a container from a pinned ROS 2 image.",
      } satisfies Record<RunnerProfileId, string>,
      distroLabel: "Distribution",
      /** The select's empty option, which is what it shows until one is chosen. */
      distroNone: "Choose a distribution",
    },

    /** The literal command, and the button that runs it. */
    command: {
      heading: "Command",
      /**
       * The sentence the whole dialog exists for. It says EXACT and not
       * „example", because the block below is the argv main will spawn —
       * `runner.ts` guarantees the two are one string, and a user checking a
       * command against a description has been given nothing to check.
       */
      exact:
        "This is the exact command that runs. Each argument sits on its own line, so you can see which is which.",
      workspaceLabel: "Directory",
      /** The one thing here that leaves the machine, said above the button that causes it. */
      pullsImage: "The first run pulls an image from Docker Hub.",
      start: "Run",
    },

    /**
     * Why there is no command line. Each is a fact about the machine or the
     * circuit rather than a failure, and all seven are refusals rather than
     * throws for `code.refused`'s reason: a caller with a `switch` is a caller
     * that has to decide what the app says, and an exception is that decision
     * made badly and late.
     */
    refused: {
      "path-not-absolute":
        "The path to the working directory is not absolute, so the command cannot be built.",
      "path-not-representable":
        "This path cannot be written in the form that profile needs.",
      "distro-leading-dash":
        "The distribution name starts with a dash, so it would be read as an option. Nexus does not run it.",
      "not-enabled": "The runner is off, so there is no command to run.",
      "no-choice": "No profile is chosen, so there is no command to run.",
      "no-distro": "WSL is chosen, but no distribution is chosen.",
      "no-package": "This circuit does not produce a ROS 2 package, so there is nothing to build.",
    } satisfies Record<RunnerRefusal, string>,

    /**
     * Why a start did not happen, on top of the six above — every one of which
     * a start can also answer with, which is why this table holds only the four
     * a plan cannot give. `not-enabled` is NOT here: it is a refusal like any
     * other, and one fact drawn from two tables is one fact that can disagree
     * with itself.
     */
    start: {
      alreadyRunning: "One job is already running — Nexus runs one at a time.",
      writeFailed: "The package was not written to disk, so the job was not started.",
      spawnFailed: "The program could not start. The message below is its own.",
      none: "The job was not started.",
    },

    /** The run itself: the phase, the output, and how it ended. */
    run: {
      heading: "Job",
      /**
       * The phase word, keyed by the contract's own closed union. `mirno` is
       * the word for „nothing is running" rather than for „the idea of idle":
       * the section outlives the run it describes, so it draws the ending of
       * the last one under this word.
       */
      phases: {
        idle: "idle",
        running: "running",
        stopping: "stopping",
      } satisfies Record<"idle" | "running" | "stopping", string>,
      /**
       * Above the log when output was dropped, with the cap filled in: the log
       * is then a WINDOW on the run — its latest output, with the earliest
       * gone — and a reader who does not know that reads the end of a build as
       * the whole of it.
       */
      dropped: "The output is larger than {cap} KB, so only its end is shown.",
      /** Before the first chunk arrives. */
      empty: "There is no output yet.",
      stop: "Stop",
      /** The stop answered that there was nothing to stop. */
      stopIdle: "There is no job to stop.",
      /** Who ended it. */
      endedStopped: "Stop requested.",
      endedAlone: "The job finished on its own.",
      /**
       * Whether the WORK is gone — the pair this dialog must never blur. For
       * Docker the process Nexus started can be gone while the container it
       * started is not, so `workStill` says the build is going rather than
       * reporting a success nobody established.
       */
      workExited: "The job has finished.",
      workStill:
        "The job is still running — the process Nexus started it through has exited, but what it started has not.",
      /** Above the exit code, which is a figure and not a verdict. */
      exitCodeLabel: "exit code",
      /**
       * Whether the build PRODUCED the package, which no exit code can say.
       *
       * The pair is the whole reason the field exists: `colcon` exits 0 over a
       * workspace with nothing in it, so „the code was 0" and „the package is
       * on the disk" are two different claims, and only the second one is what
       * the user asked for.
       */
      artifactBuilt: "The package was built — the install folder exists in the working directory.",
      artifactMissing:
        "The exit code is 0, but the package was not built: there is no install folder in the working directory. colcon reports success even when there is nothing to build.",
      /** Above the child's own words, printed as they arrived. */
      messageLabel: "Program message",
    },

    /** Turning it off again, which stops any run first. */
    off: {
      disable: "Disable the runner",
      /** While a run is going: the same act, and the label says it does two things. */
      disableRunning: "Stop and disable",
    },
  },
} as const;
