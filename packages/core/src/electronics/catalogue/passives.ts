/**
 * The parts a circuit cannot be drawn without, and the one group that is
 * catalogued by TYPE rather than by part number.
 *
 * There is one „resistor" entry, not one per resistance. The 220 Ω is the user's
 * decision about their circuit, so it belongs to the part row they place, and
 * `valueUnit` is what tells the canvas to ask for it and in which unit. A
 * catalogue with an entry per E12 value would be four hundred rows in which the
 * user still cannot find the one they soldered.
 *
 * **None of these states a supply or a draw, and the LED is the entry that
 * explains why.** A red LED does not „take 20 mA" — it drops about 1.8 V and
 * conducts whatever the rest of the circuit allows, which is why it is destroyed
 * by being wired straight across a rail and lives happily behind a resistor.
 * That behaviour is an I–V curve, not two numbers, and modelling it is the
 * electrical rules' job (E3) rather than something to half-state here. What this
 * slice owes is that the parts exist, carry the right legs, and can be wired;
 * what E3 adds is forward voltage, tolerance and the current-limit check that
 * reads them.
 */

import type { ComponentDef } from "../component.js";
import { pin } from "./pins.js";

/** Two interchangeable legs — the shape of everything unpolarised. */
const twoLeg = (a = "1", b = "2"): ComponentDef["pins"] => [
  pin(a, ["passive"]),
  pin(b, ["passive"]),
];

/** Anode and cathode, where fitting it backwards is the classic fault. */
const polarised = (): ComponentDef["pins"] => [
  pin("A", ["anode"], undefined, "+"),
  pin("K", ["cathode"], undefined, "−"),
];

export const PASSIVES: readonly ComponentDef[] = [
  // ── Resistive ─────────────────────────────────────────────────────────────
  {
    id: "resistor",
    kind: "passive",
    name: "Otpornik",
    nameEn: "Resistor",
    summary: "Ograničava struju. Vrednost se bira po kolu, ne po kataloškom broju.",
    summaryEn: "It limits current. The value is chosen for the circuit, not from a catalogue number.",
    valueUnit: "ohm",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "potentiometer",
    kind: "passive",
    name: "Potenciometar",
    nameEn: "Potentiometer",
    summary: "Tri noge: krajevi na napajanje i masu, klizač daje analognu vrednost.",
    summaryEn: "Three legs: the ends to supply and ground, the wiper gives an analogue value.",
    valueUnit: "ohm",
    buses: [],
    pins: [pin("1", ["passive"]), pin("W", ["analog-out"], undefined, "klizač", "wiper"), pin("3", ["passive"])],
  },
  {
    id: "trimpot",
    kind: "passive",
    name: "Trimer potenciometar",
    nameEn: "Trimpot",
    summary: "Isti raspored, ali se podešava odvijačem i ostaje tako — kontrast, prag.",
    summaryEn: "The same layout, but set with a screwdriver and left there — contrast, threshold.",
    valueUnit: "ohm",
    buses: [],
    pins: [pin("1", ["passive"]), pin("W", ["analog-out"], undefined, "klizač", "wiper"), pin("3", ["passive"])],
  },
  {
    id: "thermistor-ntc",
    kind: "passive",
    name: "NTC termistor",
    nameEn: "NTC thermistor",
    summary: "Otpor pada sa temperaturom; sa jednim otpornikom pravi delitelj i meri toplotu.",
    summaryEn: "Resistance falls with temperature; with one resistor it makes a divider and measures heat.",
    valueUnit: "ohm",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "photoresistor",
    kind: "passive",
    name: "Fotootpornik (LDR)",
    nameEn: "Photoresistor (LDR)",
    summary: "Gola komponenta bez pločice — traži otpornik da bi dala napon.",
    summaryEn: "A bare component with no board — it needs a resistor to give a voltage.",
    valueUnit: "ohm",
    buses: [],
    pins: twoLeg(),
  },

  // ── Reactive ──────────────────────────────────────────────────────────────
  {
    id: "capacitor-ceramic",
    kind: "passive",
    name: "Keramički kondenzator",
    nameEn: "Ceramic capacitor",
    summary: "Bez polariteta; 100 nF uz svaki modul smiruje napajanje.",
    summaryEn: "No polarity; 100 nF beside every module settles the supply.",
    valueUnit: "farad",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "capacitor-electrolytic",
    kind: "passive",
    name: "Elektrolitski kondenzator",
    nameEn: "Electrolytic capacitor",
    summary: "Ima polaritet — obrnut se naduva i pukne. Traka označava minus.",
    summaryEn: "It has a polarity — reversed, it swells and bursts. The stripe marks minus.",
    valueUnit: "farad",
    buses: [],
    pins: polarised(),
  },
  {
    id: "inductor",
    kind: "passive",
    name: "Zavojnica",
    nameEn: "Inductor",
    summary: "Opire se promeni struje; u pretvaračima napona i filterima.",
    summaryEn: "It resists a change in current; in voltage converters and filters.",
    valueUnit: "henry",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "crystal-16mhz",
    kind: "passive",
    name: "Kristal 16 MHz",
    nameEn: "16 MHz crystal",
    summary: "Takt za mikrokontroler bez ploče; ide sa dva kondenzatora od 22 pF.",
    summaryEn: "A clock for a microcontroller without a board; it goes with two 22 pF capacitors.",
    buses: [],
    pins: twoLeg(),
  },

  // ── Semiconductors ────────────────────────────────────────────────────────
  {
    id: "led",
    kind: "passive",
    name: "LED dioda",
    nameEn: "LED",
    summary: "Nikad bez otpornika u nizu — direktno na pin traje nekoliko sekundi.",
    summaryEn: "Never without a series resistor — straight on a pin it lasts a few seconds.",
    needsSeriesResistor: true,
    buses: [],
    pins: polarised(),
  },
  {
    id: "led-rgb",
    kind: "passive",
    name: "RGB LED (zajednička katoda)",
    nameEn: "RGB LED (common cathode)",
    summary: "Tri diode u jednom kućištu; svaka traži svoj otpornik i svoj PWM pin.",
    summaryEn: "Three diodes in one package; each wants its own resistor and its own PWM pin.",
    needsSeriesResistor: true,
    buses: [],
    pins: [
      pin("R", ["anode"], undefined, "crvena", "red"),
      pin("G", ["anode"], undefined, "zelena", "green"),
      pin("B", ["anode"], undefined, "plava", "blue"),
      pin("K", ["cathode"], undefined, "−"),
    ],
  },
  {
    id: "diode-1n4007",
    kind: "passive",
    name: "Dioda 1N4007",
    nameEn: "Diode 1N4007",
    summary: "Propušta struju u jednom smeru; obavezna preko svakog kalema i motora.",
    summaryEn: "It passes current one way; mandatory across every coil and motor.",
    buses: [],
    pins: polarised(),
  },
  {
    id: "diode-1n4148",
    kind: "passive",
    name: "Dioda 1N4148",
    nameEn: "Diode 1N4148",
    summary: "Mala i brza — za signale, ne za napajanje.",
    summaryEn: "Small and fast — for signals, not for power.",
    buses: [],
    pins: polarised(),
  },
  {
    id: "zener-diode",
    kind: "passive",
    name: "Zener dioda",
    nameEn: "Zener diode",
    summary: "Ograničava napon odozgo; radi u obrnutom smeru, suprotno od obične.",
    summaryEn: "It caps the voltage from above; it works in reverse, unlike an ordinary diode.",
    valueUnit: "volt",
    buses: [],
    pins: polarised(),
  },
  {
    id: "transistor-2n2222",
    kind: "passive",
    name: "Tranzistor 2N2222 (NPN)",
    nameEn: "Transistor 2N2222 (NPN)",
    summary: "Mala struja na bazi pušta veliku kroz kolektor — prekidač za pin ploče.",
    summaryEn: "A small current at the base lets a large one through the collector — a switch for a board pin.",
    buses: [],
    pins: [
      pin("B", ["passive"], undefined, "baza", "base"),
      pin("C", ["passive"], undefined, "kolektor", "collector"),
      pin("E", ["passive"], undefined, "emiter", "emitter"),
    ],
  },
  {
    id: "mosfet-irlz44n",
    kind: "passive",
    name: "MOSFET IRLZ44N",
    nameEn: "MOSFET IRLZ44N",
    summary: "Logičkim nivoom uključuje desetine ampera — otvara se sa 5 V na gejtu.",
    summaryEn: "A logic level turns on tens of amperes — it opens with 5 V at the gate.",
    buses: [],
    pins: [
      pin("G", ["passive"], undefined, "gejt", "gate"),
      pin("D", ["passive"], undefined, "drejn", "drain"),
      pin("S", ["passive"], undefined, "sors", "source"),
    ],
  },
  {
    id: "optocoupler-pc817",
    kind: "passive",
    name: "Optokupler PC817",
    nameEn: "Optocoupler PC817",
    summary: "Prenosi signal svetlošću — dve strane kola nemaju zajedničku masu.",
    summaryEn: "It carries a signal by light — the two sides of the circuit share no ground.",
    needsSeriesResistor: true,
    buses: [],
    pins: [
      pin("A", ["anode"], undefined, "LED +"),
      pin("K", ["cathode"], undefined, "LED −"),
      pin("C", ["passive"], undefined, "kolektor", "collector"),
      pin("E", ["passive"], undefined, "emiter", "emitter"),
    ],
  },

  // ── Mechanical ────────────────────────────────────────────────────────────
  {
    id: "pushbutton",
    kind: "passive",
    name: "Taster",
    nameEn: "Pushbutton",
    summary: "Spaja dve noge dok je pritisnut; traži pull-up otpornik ili onaj u ploči.",
    summaryEn: "It joins two legs while pressed; it wants a pull-up resistor, or the board's own.",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "toggle-switch",
    kind: "passive",
    name: "Prekidač",
    nameEn: "Toggle switch",
    summary: "Ostaje u položaju u koji je pomeren — za napajanje, ne za ulaz.",
    summaryEn: "It stays where it is moved — for power, not for an input.",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "limit-switch",
    kind: "passive",
    name: "Krajnji prekidač",
    nameEn: "Limit switch",
    summary: "Mehanička granica hoda; tri noge, jer ima i normalno zatvoren kontakt.",
    summaryEn: "A mechanical end of travel; three legs, because it also has a normally closed contact.",
    buses: [],
    pins: [pin("C", ["passive"], undefined, "zajednički", "common"), pin("NO", ["passive"]), pin("NC", ["passive"])],
  },
  {
    id: "reed-switch",
    kind: "passive",
    name: "Reed prekidač",
    nameEn: "Reed switch",
    summary: "Zatvara se kad mu se približi magnet — vrata i prozori.",
    summaryEn: "It closes when a magnet comes near — doors and windows.",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "dip-switch-4",
    kind: "passive",
    name: "DIP prekidač 4 pozicije",
    nameEn: "4-position DIP switch",
    summary: "Četiri nezavisna prekidača u kućištu — adresa ili režim rada.",
    summaryEn: "Four independent switches in one package — an address or a mode.",
    buses: [],
    pins: [
      pin("1A", ["passive"]),
      pin("1B", ["passive"]),
      pin("2A", ["passive"]),
      pin("2B", ["passive"]),
      pin("3A", ["passive"]),
      pin("3B", ["passive"]),
      pin("4A", ["passive"]),
      pin("4B", ["passive"]),
    ],
  },
];
