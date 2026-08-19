/**
 * What a circuit moves, sounds or switches.
 *
 * Almost every entry here is a current problem waiting to be found, which is why
 * `current.peak` is the column to read rather than `typical`. An SG90 idles at
 * 10 mA and stalls at 700; a 28BYJ-48 holds at 240 mA the whole time it is
 * energised. A board's 5 V regulator supplies a few hundred milliamps in total,
 * so „the servo worked on the bench and browned out with the display attached"
 * is arithmetic, and the numbers to do it with are here.
 *
 * The signal pin of a servo or an ESC is `pwm` — not `digital-out` — because a
 * 50 Hz pulse train is what it takes, and a board pin that cannot produce one is
 * a wire that will look connected and do nothing.
 */

import type { ComponentDef } from "../component.js";
import { gnd, pin, powerIn } from "./pins.js";

export const ACTUATORS: readonly ComponentDef[] = [
  // ── Servos and motors ─────────────────────────────────────────────────────
  {
    id: "servo-sg90",
    kind: "actuator",
    name: "SG90 (mikro servo)",
    summary: "Devet grama, ugao 0–180°; pri zastoju vuče 700 mA i obara regulator ploče.",
    supply: { min: 4.8, max: 6 },
    current: { typical: 10, peak: 700 },
    buses: [],
    pins: [powerIn(), gnd(), pin("SIG", ["pwm"])],
    library: "Servo",
  },
  {
    id: "servo-mg996r",
    kind: "actuator",
    name: "MG996R (servo sa metalnim zupčanicima)",
    summary: "Obrtni moment 10 kg·cm — traži zasebno napajanje, nikad pin ploče.",
    supply: { min: 4.8, max: 7.2 },
    current: { typical: 170, peak: 2500 },
    buses: [],
    pins: [powerIn(), gnd(), pin("SIG", ["pwm"])],
    library: "Servo",
  },
  {
    id: "servo-mg90s",
    kind: "actuator",
    name: "MG90S (metalni mikro servo)",
    summary: "Veličina SG90 sa metalnim prenosom — isti raspored, veći moment.",
    supply: { min: 4.8, max: 6 },
    current: { typical: 120, peak: 1400 },
    buses: [],
    pins: [powerIn(), gnd(), pin("SIG", ["pwm"])],
    library: "Servo",
  },
  {
    id: "servo-360",
    kind: "actuator",
    name: "Servo sa neprekidnom rotacijom",
    summary: "Ista veza kao SG90, ali impuls zadaje brzinu i smer, ne ugao.",
    supply: { min: 4.8, max: 6 },
    current: { typical: 10, peak: 700 },
    buses: [],
    pins: [powerIn(), gnd(), pin("SIG", ["pwm"])],
    library: "Servo",
  },
  {
    id: "dc-motor-tt",
    kind: "actuator",
    name: "TT motor sa reduktorom",
    summary: "Žuti motor iz svakog kompleta za robotska kolica — ide preko drajvera.",
    supply: { min: 3, max: 6 },
    current: { typical: 150, peak: 1200 },
    buses: [],
    // Two bare terminals: polarity decides direction, so neither is „anode".
    pins: [pin("M+", ["passive"]), pin("M-", ["passive"])],
  },
  {
    id: "stepper-28byj48",
    kind: "actuator",
    name: "28BYJ-48 (koračni motor)",
    summary: "Unipolarni motor sa ULN2003 pločicom; drži 240 mA i kad stoji.",
    supply: { min: 5, max: 5 },
    current: { typical: 240, peak: 320 },
    buses: [],
    pins: [
      powerIn(),
      gnd(),
      pin("IN1", ["digital-in"]),
      pin("IN2", ["digital-in"]),
      pin("IN3", ["digital-in"]),
      pin("IN4", ["digital-in"]),
    ],
    library: "Stepper",
  },
  {
    id: "stepper-nema17",
    kind: "actuator",
    name: "NEMA 17 (koračni motor)",
    summary: "Bipolarni motor za štampače i CNC; traži A4988 ili DRV8825.",
    supply: { min: 8, max: 35 },
    current: { typical: 1200, peak: 2000 },
    buses: [],
    pins: [
      pin("A+", ["passive"]),
      pin("A-", ["passive"]),
      pin("B+", ["passive"]),
      pin("B-", ["passive"]),
    ],
  },
  {
    id: "bldc-esc",
    kind: "actuator",
    name: "Brushless motor + ESC",
    summary: "Regulator prima servo impuls; motor je za dron ili propeler.",
    supply: { min: 7.4, max: 25 },
    current: { typical: 5000, peak: 30000 },
    buses: [],
    pins: [powerIn("VBAT"), gnd(), pin("SIG", ["pwm"])],
    library: "Servo",
  },

  // ── Switching ─────────────────────────────────────────────────────────────
  {
    id: "relay-1ch",
    kind: "actuator",
    name: "Relej modul 1 kanal",
    summary: "Optokuplerom odvojen kontakt; kalem vuče 70 mA dok je uključen.",
    supply: { min: 5, max: 5 },
    current: { typical: 5, peak: 75 },
    buses: [],
    pins: [powerIn(), gnd(), pin("IN", ["digital-in"])],
  },
  {
    id: "relay-2ch",
    kind: "actuator",
    name: "Relej modul 2 kanala",
    summary: "Dva nezavisna kontakta; oba kalema zajedno traže preko 140 mA.",
    supply: { min: 5, max: 5 },
    current: { typical: 8, peak: 150 },
    buses: [],
    pins: [powerIn(), gnd(), pin("IN1", ["digital-in"]), pin("IN2", ["digital-in"])],
  },
  {
    id: "relay-4ch",
    kind: "actuator",
    name: "Relej modul 4 kanala",
    summary: "Četiri kontakta — sa svima uključenim prelazi ono što USB daje.",
    supply: { min: 5, max: 5 },
    current: { typical: 15, peak: 300 },
    buses: [],
    pins: [
      powerIn(),
      gnd(),
      pin("IN1", ["digital-in"]),
      pin("IN2", ["digital-in"]),
      pin("IN3", ["digital-in"]),
      pin("IN4", ["digital-in"]),
    ],
  },
  {
    id: "solenoid-12v",
    kind: "actuator",
    name: "Solenoid 12 V",
    summary: "Povlači klip; obavezna je zaštitna dioda jer pri isključenju vraća napon.",
    supply: { min: 12, max: 12 },
    current: { typical: 0, peak: 650 },
    buses: [],
    pins: [powerIn("V+"), gnd()],
  },
  {
    id: "solenoid-valve-12v",
    kind: "actuator",
    name: "Elektromagnetni ventil 12 V",
    summary: "Otvara i zatvara protok vode; ide preko releja ili MOSFET modula.",
    supply: { min: 12, max: 12 },
    current: { typical: 0, peak: 500 },
    buses: [],
    pins: [powerIn("V+"), gnd()],
  },

  // ── Sound and touch ───────────────────────────────────────────────────────
  {
    id: "buzzer-active",
    kind: "actuator",
    name: "Aktivni zujalica",
    summary: "Ima sopstveni oscilator — jedan visok nivo i svira. Samo jedan ton.",
    supply: { min: 3.3, max: 5 },
    current: { typical: 25, peak: 35 },
    buses: [],
    pins: [powerIn(), gnd(), pin("IO", ["digital-in"])],
  },
  {
    id: "buzzer-passive",
    kind: "actuator",
    name: "Pasivna zujalica",
    summary: "Nema oscilator, pa ton zadaje ploča — otuda i melodije.",
    supply: { min: 3.3, max: 5 },
    current: { typical: 25, peak: 35 },
    buses: [],
    pins: [powerIn(), gnd(), pin("IO", ["pwm"])],
  },
  {
    id: "vibration-motor",
    kind: "actuator",
    name: "Vibracioni motor",
    summary: "Pljosnati motor iz telefona; preko tranzistora, ne direktno sa pina.",
    supply: { min: 3, max: 5 },
    current: { typical: 60, peak: 100 },
    buses: [],
    pins: [powerIn(), gnd(), pin("IN", ["digital-in"])],
  },

  // ── Pumps and air ─────────────────────────────────────────────────────────
  {
    id: "water-pump-5v",
    kind: "actuator",
    name: "Potapajuća pumpa 5 V",
    summary: "Za zalivanje saksija; nikada direktno na pin — preko releja ili MOSFET-a.",
    supply: { min: 3, max: 6 },
    current: { typical: 130, peak: 220 },
    buses: [],
    pins: [powerIn("V+"), gnd()],
  },
  {
    id: "peristaltic-pump-12v",
    kind: "actuator",
    name: "Peristaltička pumpa 12 V",
    summary: "Dozira tečnost kroz crevo — količina se meri vremenom rada.",
    supply: { min: 12, max: 12 },
    current: { typical: 200, peak: 400 },
    buses: [],
    pins: [powerIn("V+"), gnd()],
  },
  {
    id: "fan-5v",
    kind: "actuator",
    name: "Ventilator 5 V",
    summary: "Hlađenje kutije ili Raspberry Pi-ja; troši malo, ali stalno.",
    supply: { min: 5, max: 5 },
    current: { typical: 120, peak: 180 },
    buses: [],
    pins: [powerIn("V+"), gnd()],
  },
];
