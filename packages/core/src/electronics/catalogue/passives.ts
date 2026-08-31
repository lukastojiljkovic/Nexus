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
    summary: "Ograničava struju. Vrednost se bira po kolu, ne po kataloškom broju.",
    valueUnit: "ohm",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "potentiometer",
    kind: "passive",
    name: "Potenciometar",
    summary: "Tri noge: krajevi na napajanje i masu, klizač daje analognu vrednost.",
    valueUnit: "ohm",
    buses: [],
    pins: [pin("1", ["passive"]), pin("W", ["analog-out"], undefined, "klizač"), pin("3", ["passive"])],
  },
  {
    id: "trimpot",
    kind: "passive",
    name: "Trimer potenciometar",
    summary: "Isti raspored, ali se podešava odvijačem i ostaje tako — kontrast, prag.",
    valueUnit: "ohm",
    buses: [],
    pins: [pin("1", ["passive"]), pin("W", ["analog-out"], undefined, "klizač"), pin("3", ["passive"])],
  },
  {
    id: "thermistor-ntc",
    kind: "passive",
    name: "NTC termistor",
    summary: "Otpor pada sa temperaturom; sa jednim otpornikom pravi delitelj i meri toplotu.",
    valueUnit: "ohm",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "photoresistor",
    kind: "passive",
    name: "Fotootpornik (LDR)",
    summary: "Gola komponenta bez pločice — traži otpornik da bi dala napon.",
    valueUnit: "ohm",
    buses: [],
    pins: twoLeg(),
  },

  // ── Reactive ──────────────────────────────────────────────────────────────
  {
    id: "capacitor-ceramic",
    kind: "passive",
    name: "Keramički kondenzator",
    summary: "Bez polariteta; 100 nF uz svaki modul smiruje napajanje.",
    valueUnit: "farad",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "capacitor-electrolytic",
    kind: "passive",
    name: "Elektrolitski kondenzator",
    summary: "Ima polaritet — obrnut se naduva i pukne. Traka označava minus.",
    valueUnit: "farad",
    buses: [],
    pins: polarised(),
  },
  {
    id: "inductor",
    kind: "passive",
    name: "Zavojnica",
    summary: "Opire se promeni struje; u pretvaračima napona i filterima.",
    valueUnit: "henry",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "crystal-16mhz",
    kind: "passive",
    name: "Kristal 16 MHz",
    summary: "Takt za mikrokontroler bez ploče; ide sa dva kondenzatora od 22 pF.",
    buses: [],
    pins: twoLeg(),
  },

  // ── Semiconductors ────────────────────────────────────────────────────────
  {
    id: "led",
    kind: "passive",
    name: "LED dioda",
    summary: "Nikad bez otpornika u nizu — direktno na pin traje nekoliko sekundi.",
    needsSeriesResistor: true,
    buses: [],
    pins: polarised(),
  },
  {
    id: "led-rgb",
    kind: "passive",
    name: "RGB LED (zajednička katoda)",
    summary: "Tri diode u jednom kućištu; svaka traži svoj otpornik i svoj PWM pin.",
    needsSeriesResistor: true,
    buses: [],
    pins: [
      pin("R", ["anode"], undefined, "crvena"),
      pin("G", ["anode"], undefined, "zelena"),
      pin("B", ["anode"], undefined, "plava"),
      pin("K", ["cathode"], undefined, "−"),
    ],
  },
  {
    id: "diode-1n4007",
    kind: "passive",
    name: "Dioda 1N4007",
    summary: "Propušta struju u jednom smeru; obavezna preko svakog kalema i motora.",
    buses: [],
    pins: polarised(),
  },
  {
    id: "diode-1n4148",
    kind: "passive",
    name: "Dioda 1N4148",
    summary: "Mala i brza — za signale, ne za napajanje.",
    buses: [],
    pins: polarised(),
  },
  {
    id: "zener-diode",
    kind: "passive",
    name: "Zener dioda",
    summary: "Ograničava napon odozgo; radi u obrnutom smeru, suprotno od obične.",
    valueUnit: "volt",
    buses: [],
    pins: polarised(),
  },
  {
    id: "transistor-2n2222",
    kind: "passive",
    name: "Tranzistor 2N2222 (NPN)",
    summary: "Mala struja na bazi pušta veliku kroz kolektor — prekidač za pin ploče.",
    buses: [],
    pins: [
      pin("B", ["passive"], undefined, "baza"),
      pin("C", ["passive"], undefined, "kolektor"),
      pin("E", ["passive"], undefined, "emiter"),
    ],
  },
  {
    id: "mosfet-irlz44n",
    kind: "passive",
    name: "MOSFET IRLZ44N",
    summary: "Logičkim nivoom uključuje desetine ampera — otvara se sa 5 V na gejtu.",
    buses: [],
    pins: [
      pin("G", ["passive"], undefined, "gejt"),
      pin("D", ["passive"], undefined, "drejn"),
      pin("S", ["passive"], undefined, "sors"),
    ],
  },
  {
    id: "optocoupler-pc817",
    kind: "passive",
    name: "Optokupler PC817",
    summary: "Prenosi signal svetlošću — dve strane kola nemaju zajedničku masu.",
    needsSeriesResistor: true,
    buses: [],
    pins: [
      pin("A", ["anode"], undefined, "LED +"),
      pin("K", ["cathode"], undefined, "LED −"),
      pin("C", ["passive"], undefined, "kolektor"),
      pin("E", ["passive"], undefined, "emiter"),
    ],
  },

  // ── Mechanical ────────────────────────────────────────────────────────────
  {
    id: "pushbutton",
    kind: "passive",
    name: "Taster",
    summary: "Spaja dve noge dok je pritisnut; traži pull-up otpornik ili onaj u ploči.",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "toggle-switch",
    kind: "passive",
    name: "Prekidač",
    summary: "Ostaje u položaju u koji je pomeren — za napajanje, ne za ulaz.",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "limit-switch",
    kind: "passive",
    name: "Krajnji prekidač",
    summary: "Mehanička granica hoda; tri noge, jer ima i normalno zatvoren kontakt.",
    buses: [],
    pins: [pin("C", ["passive"], undefined, "zajednički"), pin("NO", ["passive"]), pin("NC", ["passive"])],
  },
  {
    id: "reed-switch",
    kind: "passive",
    name: "Reed prekidač",
    summary: "Zatvara se kad mu se približi magnet — vrata i prozori.",
    buses: [],
    pins: twoLeg(),
  },
  {
    id: "dip-switch-4",
    kind: "passive",
    name: "DIP prekidač 4 pozicije",
    summary: "Četiri nezavisna prekidača u kućištu — adresa ili režim rada.",
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
