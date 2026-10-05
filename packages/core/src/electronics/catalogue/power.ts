/**
 * The parts whose job is to produce a rail.
 *
 * `kind: "power"` is the only kind other than `board` the validator lets carry a
 * `power-out` pin, and that is what the kind is FOR — see `boardProblems`. A
 * motor driver with a regulator on it is still a driver; a part is `power` when
 * supplying is the reason it exists.
 *
 * `current.peak` on these entries is what the part can DELIVER, not what it
 * draws, and that inversion is deliberate: it is the number the current budget
 * has to check every other part's draw against, and it is the only group where
 * the useful reading of the column is „how much is available". A linear
 * regulator's entry is worth reading twice for that reason — an AMS1117 gives
 * 800 mA on paper and burns (Vin − 3.3) V × I as heat doing it, so an ESP-01 fed
 * from 12 V through one is a thermal shutdown, not a wiring fault.
 */

import type { ComponentDef } from "../component.js";
import { gnd, pin, powerIn, powerOut } from "./pins.js";

export const POWER: readonly ComponentDef[] = [
  // ── Linear regulators ─────────────────────────────────────────────────────
  {
    id: "lm7805",
    kind: "power",
    name: "LM7805",
    nameEn: "LM7805",
    summary: "Klasičnih 5 V iz 7–35 V; višak napona pretvara u toplotu, pa traži hladnjak.",
    summaryEn: "Classic 5 V from 7–35 V; the excess voltage becomes heat, so it wants a heatsink.",
    supply: { min: 7, max: 35 },
    current: { typical: 5, peak: 1000 },
    buses: [],
    pins: [powerIn("IN"), gnd(), powerOut("OUT", 5)],
  },
  {
    id: "ams1117-33",
    kind: "power",
    name: "AMS1117-3.3",
    nameEn: "AMS1117-3.3",
    summary: "3.3 V za module koji ne trpe 5 V; razlika napona odlazi u toplotu.",
    summaryEn: "3.3 V for modules that will not take 5 V; the voltage difference turns into heat.",
    supply: { min: 4.5, max: 15 },
    current: { typical: 5, peak: 800 },
    buses: [],
    pins: [powerIn("IN"), gnd(), powerOut("OUT", 3.3)],
  },

  // ── Switching converters ──────────────────────────────────────────────────
  {
    id: "lm2596-buck",
    kind: "power",
    name: "LM2596 (spuštač napona)",
    nameEn: "LM2596 (buck converter)",
    summary: "Iz 12 V u 5 V bez gubitka u toplotu; izlaz se podešava trimerom pre povezivanja.",
    summaryEn: "12 V down to 5 V with no loss to heat; the output is set with a trimpot before wiring.",
    supply: { min: 4.5, max: 40 },
    current: { typical: 10, peak: 3000 },
    buses: [],
    // The output is adjustable, and 5 V is what it is set to in nearly every
    // build. The rules engine reads this number, so an entry that left it
    // unstated would be a rail nothing could check a peripheral against.
    pins: [powerIn("IN+"), gnd(), powerOut("OUT+", 5)],
  },
  {
    id: "mt3608-boost",
    kind: "power",
    name: "MT3608 (podizač napona)",
    nameEn: "MT3608 (boost converter)",
    summary: "Iz baterije od 3.7 V pravi 5 V ili 12 V — za kolo koje traži više nego izvor.",
    summaryEn: "Makes 5 V or 12 V from a 3.7 V battery — for a circuit that wants more than the source.",
    supply: { min: 2, max: 24 },
    current: { typical: 10, peak: 2000 },
    buses: [],
    pins: [powerIn("IN+"), gnd(), powerOut("OUT+", 5)],
  },
  {
    id: "mb102-breadboard-supply",
    kind: "power",
    name: "MB102 (napajanje za protobord)",
    nameEn: "MB102 (breadboard supply)",
    summary: "Nasađuje se na protobord i daje 5 V i 3.3 V na obe šine.",
    summaryEn: "It clips onto a breadboard and gives 5 V and 3.3 V on both rails.",
    supply: { min: 6.5, max: 12 },
    current: { typical: 10, peak: 700 },
    buses: [],
    pins: [powerIn("DC"), gnd(), powerOut("5V", 5), powerOut("3V3", 3.3)],
  },

  // ── Batteries and charging ────────────────────────────────────────────────
  {
    id: "tp4056",
    kind: "power",
    name: "TP4056 (punjač Li-Ion)",
    nameEn: "TP4056 (Li-Ion charger)",
    summary: "Puni jednu 18650 ćeliju preko USB-a; verzija sa zaštitom je jedina za nositi.",
    summaryEn: "Charges one 18650 cell over USB; the protected version is the only one to carry around.",
    supply: { min: 4, max: 8 },
    current: { typical: 1, peak: 1000 },
    buses: [],
    pins: [powerIn("IN+"), gnd(), powerOut("BAT+", 4.2), pin("BAT-", ["gnd"])],
  },
  {
    id: "battery-18650",
    kind: "power",
    name: "Ćelija 18650 sa držačem",
    nameEn: "18650 cell with a holder",
    summary: "Nominalno 3.7 V, puna 4.2 — ploča na 5 V traži podizač ispred sebe.",
    summaryEn: "Nominally 3.7 V, 4.2 V full — a 5 V board needs a boost converter in front of it.",
    current: { typical: 0, peak: 2000 },
    buses: [],
    // A cell is a source and nothing else: it has an output rail and a return,
    // and no input at all — which is why it states no supply of its own, and why
    // its `current.peak` reads as what it can deliver. The three entries below
    // it are the same shape.
    pins: [powerOut("+", 3.7), gnd("-", "−")],
  },
  {
    id: "battery-9v",
    kind: "power",
    name: "Baterija 9 V sa konektorom",
    nameEn: "9 V battery with a connector",
    summary: "Ide na VIN ili barrel — nikada na pin od 5 V, koji je već iza regulatora.",
    summaryEn: "It goes to VIN or the barrel jack — never to the 5 V pin, which is already past the regulator.",
    current: { typical: 0, peak: 500 },
    buses: [],
    pins: [powerOut("+", 9), gnd("-", "−")],
  },
  {
    id: "battery-holder-4xaa",
    kind: "power",
    name: "Držač za 4×AA",
    nameEn: "4×AA holder",
    summary: "Šest volti iz alkalnih baterija — dovoljno za servo, premalo za VIN.",
    summaryEn: "Six volts from alkaline cells — enough for a servo, too little for VIN.",
    current: { typical: 0, peak: 2000 },
    buses: [],
    pins: [powerOut("+", 6), gnd("-", "−")],
  },
  {
    id: "solar-panel-6v",
    kind: "power",
    name: "Solarni panel 6 V",
    nameEn: "6 V solar panel",
    summary: "Struja zavisi od sunca, pa iza njega uvek ide punjač i baterija.",
    summaryEn: "The current depends on the sun, so a charger and a battery always follow it.",
    current: { typical: 0, peak: 330 },
    buses: [],
    pins: [powerOut("+", 6), gnd("-", "−")],
  },
];
